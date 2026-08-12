/**
 * GET /api/accounts/callback?provider=...
 *
 * Rueckleitung von Google bzw. Microsoft nach der Anmeldung.
 *
 * Dieser Endpunkt wird vom Browser des Anbieters aufgerufen und kann deshalb
 * kein Anmelde-Token mitbringen. Geschuetzt ist er ueber den state-Parameter:
 * serverseitig erzeugt, genau einmal gueltig, nach 15 Minuten wertlos. Er
 * liefert zugleich die Zuordnung zum Nutzer.
 *
 * Antwortet mit einer kleinen HTML-Seite statt JSON - hier landet ein
 * Browserfenster, kein Programm.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { oeffentlich } from '../_lib/handler.js';
import { alsDienst } from '../_lib/supabase.js';
import { encrypt, encryptJson } from '../_lib/crypto.js';
import { protokolliere } from '../_lib/audit.js';
import { config } from '../_lib/config.js';
import * as gmail from '../_services/gmail.js';
import * as outlook from '../_services/outlook.js';

/** Abschlussseite: meldet das Ergebnis ans Hauptfenster und schliesst sich. */
function seite(erfolg: boolean, titel: string, text: string, detail?: string): string {
  const akzent = erfolg ? '#199e70' : '#e66767';
  const zeichen = erfolg ? '&#10003;' : '&#33;';

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titel}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:'Segoe UI',system-ui,sans-serif;background:#22252e;color:#eceef2}
  .karte{max-width:30rem;padding:2.5rem;text-align:center;background:#333846;
         border-radius:1rem;border:1px solid #424b60}
  .zeichen{width:3.5rem;height:3.5rem;margin:0 auto 1.25rem;border-radius:9999px;
           background:${akzent}22;color:${akzent};display:flex;align-items:center;
           justify-content:center;font-size:1.75rem;font-weight:700}
  h1{margin:0 0 .75rem;font-size:1.35rem}
  p{margin:0 0 .5rem;color:#b0b8c9;line-height:1.6}
  .detail{margin-top:1rem;padding:.75rem;background:#22252e;border-radius:.5rem;
          font-size:.8rem;color:#8591aa;word-break:break-word;text-align:left}
  .hinweis{margin-top:1.5rem;font-size:.8rem;color:#66738f}
</style></head>
<body><div class="karte">
  <div class="zeichen">${zeichen}</div>
  <h1>${titel}</h1>
  <p>${text}</p>
  ${detail ? `<div class="detail">${detail}</div>` : ''}
  <p class="hinweis">Dieses Fenster schliesst sich gleich von selbst.</p>
</div>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ source: 'maildraft-oauth', ok: ${erfolg} }, '*');
    }
  } catch (e) { /* egal */ }
  setTimeout(function () {
    window.close();
    // Falls der Browser das Schliessen verweigert: zurueck zur App.
    setTimeout(function () { window.location.href = '${config.appUrl}/settings'; }, 800);
  }, ${erfolg ? 1800 : 6000});
</script></body></html>`;
}

function antworte(res: VercelResponse, status: number, html: string): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(status).send(html);
}

export default oeffentlich({ methoden: ['GET'] }, async (req: VercelRequest, res: VercelResponse) => {
  const anbieter = String(req.query.provider ?? '');
  const code = req.query.code ? String(req.query.code) : '';
  const state = req.query.state ? String(req.query.state) : '';
  const fehlerVomAnbieter = req.query.error ? String(req.query.error) : '';

  const db = alsDienst();

  try {
    if (fehlerVomAnbieter) {
      throw new Error(
        fehlerVomAnbieter === 'access_denied'
          ? 'Der Zugriff wurde beim Anbieter abgelehnt.'
          : String(req.query.error_description ?? fehlerVomAnbieter)
      );
    }
    if (!code || !state) throw new Error('Die Antwort des Anbieters war unvollstaendig.');

    // --- state einloesen: genau einmal gueltig ---
    const { data: vorgang } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle();
    await db.from('oauth_states').delete().eq('state', state);

    if (!vorgang || vorgang.provider !== anbieter) {
      throw new Error(
        'Der Anmeldevorgang ist abgelaufen oder ungueltig. Bitte in den Einstellungen neu starten.'
      );
    }

    const alter = Date.now() - new Date(vorgang.created_at as string).getTime();
    if (alter > 15 * 60 * 1000) {
      throw new Error('Der Anmeldevorgang ist abgelaufen. Bitte in den Einstellungen neu starten.');
    }

    // --- Code einloesen und Postfach speichern ---
    let mailadresse: string;
    let anzeigename: string;
    let token: string | null;

    if (anbieter === 'gmail') {
      const ergebnis = await gmail.loeseCodeEin(code);
      mailadresse = ergebnis.emailAddress;
      anzeigename = ergebnis.emailAddress;
      token = encryptJson(ergebnis.tokens);
    } else if (anbieter === 'outlook') {
      const ergebnis = await outlook.loeseCodeEin(code, (vorgang.code_verifier as string) ?? '');
      mailadresse = ergebnis.emailAddress;
      anzeigename = ergebnis.displayName;
      token = encrypt(ergebnis.cache);
    } else {
      throw new Error(`Unbekannter Anbieter: ${anbieter}`);
    }

    // Upsert statt Insert: Meldet sich der Nutzer nach abgelaufenem Token
    // erneut an, soll kein Duplikat entstehen und die bestehenden Entwuerfe
    // muessen erhalten bleiben.
    const { error } = await db.from('email_accounts').upsert(
      {
        user_id: vorgang.user_id,
        provider: anbieter,
        email_address: mailadresse,
        display_name: anzeigename,
        oauth_token: token,
        status: 'ok',
        last_error: null,
        is_active: true,
      },
      { onConflict: 'user_id,email_address' }
    );

    if (error) throw new Error(`Postfach konnte nicht gespeichert werden: ${error.message}`);

    await protokolliere({
      userId: vorgang.user_id as string,
      action: 'account.connect',
      resourceType: 'account',
      details: { provider: anbieter },
    });

    antworte(
      res,
      200,
      seite(
        true,
        anbieter === 'gmail' ? 'Gmail verbunden' : 'Outlook verbunden',
        `Das Postfach ${mailadresse} ist jetzt mit MailDraft AI verbunden.`
      )
    );
  } catch (fehler) {
    antworte(
      res,
      400,
      seite(
        false,
        'Anmeldung fehlgeschlagen',
        'Das Postfach konnte nicht verbunden werden. Bitte in den Einstellungen erneut versuchen.',
        (fehler as Error).message
      )
    );
  }
});
