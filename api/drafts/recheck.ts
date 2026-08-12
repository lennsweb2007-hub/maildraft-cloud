/**
 * Nachpruefung des Altbestands.
 *
 * GET  /api/drafts/recheck   wie viele Entwuerfe sind noch ungeprueft
 * POST /api/drafts/recheck   die naechsten pruefen
 *
 * Noetig fuer alles, was vor der Einfuehrung des Relevanzfilters entstanden
 * ist - damals bekam jede Mail einen Entwurf, auch die Rechnung von PayPal.
 * Ohne diesen Weg muesste der Nutzer den Altbestand von Hand durchgehen.
 *
 * Arbeitet in Haeppchen statt alles auf einmal: Bei mehreren hundert
 * Altbestaenden wuerde ein Durchlauf sonst in das Zeitlimit der Funktion oder
 * in das Gemini-Kontingent laufen und mittendrin abbrechen. So bleibt jeder
 * Aufruf fuer sich abgeschlossen, und die Oberflaeche zeigt den Fortschritt.
 */

import { geschuetzt } from '../_lib/handler.js';
import { alsDienst } from '../_lib/supabase.js';
import { protokolliere } from '../_lib/audit.js';
import * as gemini from '../_services/gemini.js';
import { vorfilter } from '../_services/relevanceFilter.js';
import type { Profil } from '../_services/typen.js';

function heute(datum = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

export default geschuetzt({ methoden: ['GET', 'POST'] }, async ({ db, req, user }) => {
  // --- Wie viele sind noch offen? ---
  if (req.method === 'GET') {
    const { count } = await db
      .from('drafts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .is('relevance_confidence', null);

    return { offen: count ?? 0 };
  }

  // --- Die naechsten pruefen ---
  const limit = Math.min(30, Math.max(1, Number((req.body as { limit?: number })?.limit ?? 15)));

  const { data: kandidaten } = await db
    .from('drafts')
    .select('id, from_email, subject, body_original, category_id, received_at, created_at')
    .eq('status', 'pending')
    .is('relevance_confidence', null)
    .order('received_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  const ergebnis = { geprueft: 0, aussortiert: 0, behalten: 0, abgebrochen: false };

  if (!kandidaten || kandidaten.length === 0) {
    return { ...ergebnis, offen: 0, message: 'Es gibt keine ungeprueften Entwuerfe mehr.' };
  }

  const { data: profil } = await db.from('profiles').select('*').eq('id', user.id).single();
  const sperrliste = Array.isArray(profil?.blocked_senders)
    ? (profil!.blocked_senders as string[])
    : [];

  const dienst = alsDienst();

  for (const entwurf of kandidaten) {
    if (gemini.vollstaendigGesperrt()) {
      ergebnis.abgebrochen = true;
      break;
    }

    const mail = {
      from: entwurf.from_email as string,
      subject: (entwurf.subject as string) ?? '',
      text: entwurf.body_original as string | null,
      listUnsubscribe: null,
      replyTo: null,
    };

    // Erst der Vorfilter - spart bei offensichtlichem Rauschen die KI-Anfrage.
    const vor = vorfilter(mail, sperrliste);
    const urteil = vor.ignore
      ? { relevant: false, kind: vor.kind ?? 'sonstiges', reason: vor.reason ?? '', confidence: 1 }
      : await gemini.pruefeRelevanz(profil as Profil, mail);

    ergebnis.geprueft += 1;

    await db
      .from('drafts')
      .update({
        relevance_kind: urteil.kind,
        relevance_reason: urteil.reason,
        relevance_confidence: urteil.confidence,
        ...(urteil.relevant ? {} : { status: 'ignored' }),
      })
      .eq('id', entwurf.id);

    if (urteil.relevant) {
      ergebnis.behalten += 1;
      continue;
    }

    ergebnis.aussortiert += 1;

    // Rollup korrigieren: zaehlt ab jetzt als aussortiert.
    const datum = heute(new Date((entwurf.received_at as string) ?? (entwurf.created_at as string)));
    await dienst.rpc('bump_statistics', {
      p_user_id: user.id, p_date: datum, p_category_id: entwurf.category_id ?? null,
      p_received: -1, p_sent: 0, p_ignored: 0, p_response_time: null,
    });
    await dienst.rpc('bump_statistics', {
      p_user_id: user.id, p_date: datum, p_category_id: null,
      p_received: 0, p_sent: 0, p_ignored: 1, p_response_time: null,
    });
  }

  const { count: offen } = await db
    .from('drafts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .is('relevance_confidence', null);

  await protokolliere({ userId: user.id, action: 'drafts.recheck', details: { ...ergebnis } });

  return {
    ...ergebnis,
    offen: offen ?? 0,
    message: ergebnis.abgebrochen
      ? `${ergebnis.geprueft} geprueft, ${ergebnis.aussortiert} aussortiert. Das KI-Kontingent ist erschoepft - bitte in ein paar Minuten fortsetzen.`
      : `${ergebnis.geprueft} geprueft, ${ergebnis.aussortiert} aussortiert, ${ergebnis.behalten} behalten.` +
        ((offen ?? 0) > 0 ? ` Noch ${offen} offen.` : ''),
  };
});
