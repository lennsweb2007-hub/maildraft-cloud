/**
 * Postfaecher verwalten.
 *
 * GET    /api/accounts              Liste (ohne Geheimnisse)
 * POST   /api/accounts              IMAP-Postfach anlegen
 * DELETE /api/accounts?id=...       trennen
 * POST   /api/accounts?id=...&tat=test    Verbindung pruefen
 * POST   /api/accounts?id=...&tat=toggle  aktiv schalten
 */

import { geschuetzt } from '../_lib/handler.js';
import { ApiError } from '../_lib/errors.js';
import { protokolliere } from '../_lib/audit.js';
import { encrypt } from '../_lib/crypto.js';
import { imapKontoSchema, pruefe, uuid } from '../_lib/validate.js';
import { verfuegbareAnbieter } from '../_lib/config.js';
import * as mail from '../_services/mail.js';
import { schlageVor } from '../_services/imap.js';
import type { Postfach } from '../_services/typen.js';

/**
 * Entfernt alle Geheimnisse, bevor ein Postfach die API verlaesst.
 *
 * Row Level Security schuetzt die Zeile vor fremdem Zugriff, aber nicht davor,
 * dass der eigene Browser den verschluesselten Token zu sehen bekaeme. Tokens
 * und Passwoerter gehoeren nie in eine Antwort.
 */
function oeffentlich(p: Postfach) {
  return {
    id: p.id,
    provider: p.provider,
    email_address: p.email_address,
    display_name: p.display_name,
    imap_host: p.imap_host,
    imap_port: p.imap_port,
    smtp_host: p.smtp_host,
    smtp_port: p.smtp_port,
    last_sync: p.last_sync,
    last_error: p.last_error,
    status: p.status,
    is_active: p.is_active,
  };
}

export default geschuetzt({ methoden: ['GET', 'POST', 'DELETE'] }, async ({ db, req, user }) => {
  // ------------------------------------------------------------------ GET --
  if (req.method === 'GET') {
    // Serverdaten zu einer Adresse vorschlagen
    if (req.query.suggest) {
      const adresse = String(req.query.suggest);
      if (!adresse.includes('@')) {
        throw ApiError.badRequest('Bitte eine vollstaendige E-Mail-Adresse angeben.');
      }
      return { suggestion: schlageVor(adresse) };
    }

    const { data } = await db.from('email_accounts').select('*').order('connected_at');
    return {
      items: ((data ?? []) as Postfach[]).map(oeffentlich),
      providers: verfuegbareAnbieter(),
    };
  }

  // --------------------------------------------------------------- DELETE --
  if (req.method === 'DELETE') {
    const id = pruefe(uuid, req.query.id);

    const { data: postfach } = await db
      .from('email_accounts')
      .select('email_address')
      .eq('id', id)
      .maybeSingle();

    if (!postfach) throw ApiError.notFound('Dieses Postfach existiert nicht.');

    // Achtung: Ueber ON DELETE CASCADE verschwinden auch die Entwuerfe dieses
    // Postfachs. Die Historie bleibt, weil sent_emails den Bezug nur ueber
    // eine nullbare Spalte haelt.
    await db.from('email_accounts').delete().eq('id', id);

    await protokolliere({ userId: user.id, action: 'account.remove', resourceType: 'account', resourceId: id });

    return {
      message:
        `Postfach ${postfach.email_address} wurde getrennt. Offene Entwuerfe dieses Postfachs ` +
        'wurden entfernt, die Historie bleibt erhalten.',
    };
  }

  // ----------------------------------------------------------------- POST --
  const id = req.query.id ? pruefe(uuid, req.query.id) : null;
  const tat = String(req.query.tat ?? '');

  if (id && tat === 'test') {
    const { data: postfach } = await db.from('email_accounts').select('*').eq('id', id).maybeSingle();
    if (!postfach) throw ApiError.notFound('Dieses Postfach existiert nicht.');

    const ergebnis = await mail.testeVerbindung(postfach as Postfach);

    await db
      .from('email_accounts')
      .update(
        ergebnis.ok
          ? { status: 'ok', last_error: null }
          : { status: ergebnis.needsReauth ? 'needs_reauth' : 'error', last_error: ergebnis.error?.slice(0, 500) }
      )
      .eq('id', id);

    const { data: aktuell } = await db.from('email_accounts').select('*').eq('id', id).single();
    return { ...ergebnis, account: oeffentlich(aktuell as Postfach) };
  }

  if (id && tat === 'toggle') {
    const aktiv = Boolean((req.body as { is_active?: boolean })?.is_active);
    const { data } = await db
      .from('email_accounts')
      .update({ is_active: aktiv })
      .eq('id', id)
      .select()
      .single();
    return { account: oeffentlich(data as Postfach) };
  }

  // --- Neues IMAP-Postfach ---
  //
  // Gmail und Outlook laufen ueber /api/accounts/connect - die Anmeldung
  // passiert dort beim Anbieter, nicht in einem Formular.
  const daten = pruefe(imapKontoSchema, req.body ?? {});

  // Google und Microsoft zeigen App-Passwoerter in vier Vierergruppen an
  // ("abcd efgh ijkl mnop"). Kopiert man sie samt Leerzeichen, lehnt der
  // Mailserver die Anmeldung ab - ein Fehler, der sich als "falsches Passwort"
  // tarnt. Die Leerzeichen werden deshalb entfernt, aber nur bei genau diesem
  // Muster. Echte Passwoerter mit Leerzeichen bleiben unangetastet.
  const passwort = /^[a-z]{4}( [a-z]{4}){3}$/i.test(daten.password.trim())
    ? daten.password.replace(/\s+/g, '')
    : daten.password;

  const kandidat = {
    user_id: user.id,
    provider: 'imap' as const,
    email_address: daten.email_address,
    display_name: daten.display_name ?? null,
    imap_host: daten.imap_host,
    imap_port: daten.imap_port,
    imap_user: daten.imap_user || daten.email_address,
    imap_password: encrypt(passwort),
    imap_secure: true,
    smtp_host: daten.smtp_host || daten.imap_host,
    smtp_port: daten.smtp_port,
    smtp_secure: true,
  };

  // Erst testen, dann speichern. Ein Postfach, das sich nicht verbinden laesst,
  // soll gar nicht erst in der Liste auftauchen.
  const test = await mail.testeVerbindung({ ...kandidat, id: 'test', status: 'ok', is_active: true, oauth_token: null, last_sync: null, last_error: null } as Postfach);
  if (!test.ok) throw ApiError.badRequest(test.error ?? 'Verbindung fehlgeschlagen.');

  const { data, error } = await db
    .from('email_accounts')
    .upsert(kandidat, { onConflict: 'user_id,email_address' })
    .select()
    .single();

  if (error) throw new Error(`Postfach konnte nicht gespeichert werden: ${error.message}`);

  await protokolliere({
    userId: user.id,
    action: 'account.connect',
    resourceType: 'account',
    resourceId: data.id,
    details: { provider: 'imap' },
  });

  return { account: oeffentlich(data as Postfach), message: 'Postfach wurde verbunden.' };
});
