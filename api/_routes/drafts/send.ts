/**
 * POST /api/drafts/send?id=...  - Entwurf versenden
 *
 * Der einzige Endpunkt, der etwas nach aussen bewirkt und sich nicht
 * rueckgaengig machen laesst. Entsprechend vorsichtig:
 *
 *  - Der aktuelle Text darf mitgeschickt werden, damit ein vergessener
 *    Speichern-Klick nichts kostet.
 *  - Scheitert der Versand, bleibt der Entwurf bestehen und traegt den Fehler.
 *    Ein zweiter Versuch ist damit jederzeit moeglich.
 *  - Erst nach erfolgreichem Versand wird die Historie geschrieben.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { ApiError, ReauthRequiredError } from '../../_lib/errors.js';
import { protokolliere } from '../../_lib/audit.js';
import { draftSendenSchema, pruefe, uuid } from '../../_lib/validate.js';
import { alsDienst } from '../../_lib/supabase.js';
import * as mail from '../../_services/mail.js';
import type { Postfach } from '../../_services/typen.js';

function heute(datum = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

export default geschuetzt({ methoden: ['POST'] }, async ({ db, req, user }) => {
  const id = pruefe(uuid, req.query.id);
  const eingabe = pruefe(draftSendenSchema, req.body ?? {});

  const { data: entwurf } = await db.from('drafts').select('*').eq('id', id).maybeSingle();
  if (!entwurf) throw ApiError.notFound('Dieser Entwurf existiert nicht (mehr).');

  if (entwurf.status === 'sent') {
    throw ApiError.conflict('Diese Nachricht wurde bereits versendet.');
  }

  // Der Nutzer kann Text und Betreff direkt beim Absenden mitschicken.
  const text = eingabe.body_draft ?? (entwurf.body_draft as string | null);
  const betreff = eingabe.subject ?? (entwurf.subject as string | null);

  if (!text || !text.trim()) {
    throw ApiError.badRequest('Ein leerer Entwurf kann nicht versendet werden.');
  }

  const { data: postfach } = await db
    .from('email_accounts')
    .select('*')
    .eq('id', entwurf.email_account_id)
    .maybeSingle();

  if (!postfach) {
    throw ApiError.badRequest(
      'Das zugehoerige Postfach wurde entfernt. Die Antwort kann nicht versendet werden.'
    );
  }

  let providerMessageId: string | null = null;
  try {
    const ergebnis = await mail.sendeAntwort(postfach as Postfach, {
      message_id: entwurf.message_id as string,
      to_email: entwurf.to_email as string,
      subject: betreff,
      body_draft: text,
      thread_id: entwurf.thread_id as string | null,
      in_reply_to: entwurf.in_reply_to as string | null,
      references_hdr: entwurf.references_hdr as string | null,
    });
    providerMessageId = ergebnis.providerMessageId;
  } catch (fehler) {
    const meldung = (fehler as Error).message;
    const needsReauth = fehler instanceof ReauthRequiredError;

    // Der Entwurf bleibt bestehen, damit ein zweiter Versuch moeglich ist.
    await db.from('drafts').update({ send_error: meldung.slice(0, 500) }).eq('id', id);

    if (needsReauth) {
      await db
        .from('email_accounts')
        .update({ status: 'needs_reauth', last_error: meldung.slice(0, 500) })
        .eq('id', postfach.id);
    }

    const api = ApiError.badGateway(`Versand fehlgeschlagen: ${meldung}`, 'SEND_FAILED');
    api.needsReauth = needsReauth;
    throw api;
  }

  // --- Ab hier ist die Mail beim Empfaenger ---

  const gesendetAm = new Date();
  const empfangen = new Date((entwurf.received_at as string) ?? (entwurf.created_at as string));
  const antwortzeit = Number.isNaN(empfangen.getTime())
    ? null
    : Math.max(0, Math.round((gesendetAm.getTime() - empfangen.getTime()) / 1000));

  const { data: aktualisiert } = await db
    .from('drafts')
    .update({
      status: 'sent',
      sent_at: gesendetAm.toISOString(),
      send_error: null,
      body_draft: text,
      subject: betreff,
    })
    .eq('id', id)
    .select()
    .single();

  // Historie: bewusst redundant. Wird der Entwurf spaeter bearbeitet oder das
  // Postfach entfernt, bleibt der tatsaechlich versendete Wortlaut erhalten.
  await db.from('sent_emails').insert({
    draft_id: id,
    user_id: user.id,
    email_account_id: postfach.id,
    to_email: entwurf.to_email,
    subject: betreff,
    body: text,
    body_original: entwurf.body_original,
    category_id: entwurf.category_id,
    provider_message_id: providerMessageId,
    response_time_sec: antwortzeit,
    sent_at: gesendetAm.toISOString(),
  });

  await alsDienst().rpc('bump_statistics', {
    p_user_id: user.id,
    p_date: heute(gesendetAm),
    p_category_id: entwurf.category_id ?? null,
    p_received: 0,
    p_sent: 1,
    p_ignored: 0,
    p_response_time: antwortzeit,
  });

  await protokolliere({
    userId: user.id,
    action: 'draft.send',
    resourceType: 'draft',
    resourceId: id,
    details: { provider: postfach.provider, responseTimeSec: antwortzeit },
  });

  return { draft: aktualisiert, message: 'Antwort wurde versendet.' };
});
