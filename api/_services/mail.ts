/**
 * Fassade ueber die drei Anbieter.
 *
 * Der Rest der Anwendung kennt nur dieses Modul und muss nicht wissen, ob im
 * Hintergrund die Gmail-API, Microsoft Graph oder IMAP arbeitet. Alle Anbieter
 * liefern dasselbe normalisierte Nachrichtenformat (siehe typen.ts).
 */

import { config } from '../_lib/config.js';
import { alsDienst } from '../_lib/supabase.js';
import type { Nachricht, Postfach, Verbindungstest } from './typen.js';

import * as gmail from './gmail.js';
import * as outlook from './outlook.js';
import * as imap from './imap.js';

/**
 * Speichert ein erneuertes Tokenset.
 *
 * Nutzt bewusst den Dienst-Zugang: Der Aufruf kann waehrend des Cron-Laufs
 * passieren, wo es keinen angemeldeten Nutzer gibt. Die Postfach-Kennung
 * stammt aus einer Zeile, die zuvor bereits nach user_id gefiltert wurde -
 * ein zusaetzlicher Filter waere hier also nur Scheinsicherheit.
 */
export const speichereToken = async (postfachId: string, verschluesselt: string): Promise<void> => {
  await alsDienst()
    .from('email_accounts')
    .update({ oauth_token: verschluesselt, status: 'ok', last_error: null })
    .eq('id', postfachId);
};

/**
 * Bestimmt, ab welchem Zeitpunkt gesucht wird.
 *
 * Normalfall: seit dem letzten erfolgreichen Abruf, mit Vorlauf. Der Vorlauf
 * faengt zwei Dinge ab - Mails, die beim Anbieter mit Verzoegerung ankommen,
 * und Uhrzeitunterschiede zwischen Server und Mailanbieter. Dass dabei
 * dieselbe Mail mehrfach geholt wird, ist unkritisch: Der Unique-Index auf
 * (email_account_id, message_id) laesst nur einen Entwurf zu.
 */
export function startzeitpunkt(postfach: Postfach): Date {
  if (!postfach.last_sync) {
    return new Date(Date.now() - config.sync.initialLookbackDays * 86_400_000);
  }
  return new Date(new Date(postfach.last_sync).getTime() - config.sync.overlapMinutes * 60_000);
}

/** Holt neue Nachrichten fuer ein Postfach. */
export async function holeNachrichten(
  postfach: Postfach,
  limit: number = config.sync.maxEmailsPerSync,
  seit?: Date
): Promise<Nachricht[]> {
  const ab = seit ?? startzeitpunkt(postfach);

  switch (postfach.provider) {
    case 'gmail':
      return gmail.holeNachrichten(postfach, limit, ab, speichereToken);
    case 'outlook':
      return outlook.holeNachrichten(postfach, limit, ab, speichereToken);
    case 'imap':
      return imap.holeNachrichten(postfach, limit, ab);
    default:
      throw new Error(`Unbekannter Anbieter: ${postfach.provider}`);
  }
}

export interface EntwurfZumSenden {
  message_id: string;
  to_email: string;
  subject: string | null;
  body_draft: string | null;
  thread_id: string | null;
  in_reply_to: string | null;
  references_hdr: string | null;
}

/** Versendet einen Entwurf als Antwort auf die Originalmail. */
export async function sendeAntwort(
  postfach: Postfach,
  entwurf: EntwurfZumSenden
): Promise<{ providerMessageId: string | null }> {
  switch (postfach.provider) {
    case 'gmail':
      return gmail.sendeAntwort(postfach, entwurf, speichereToken);
    case 'outlook':
      return outlook.sendeAntwort(postfach, entwurf, speichereToken);
    case 'imap':
      return imap.sendeAntwort(postfach, entwurf);
    default:
      throw new Error(`Unbekannter Anbieter: ${postfach.provider}`);
  }
}

/** Prueft, ob ein Postfach erreichbar und angemeldet ist. */
export async function testeVerbindung(postfach: Postfach): Promise<Verbindungstest> {
  try {
    switch (postfach.provider) {
      case 'gmail':
        return await gmail.testeVerbindung(postfach, speichereToken);
      case 'outlook':
        return await outlook.testeVerbindung(postfach, speichereToken);
      case 'imap':
        return await imap.testeVerbindung(postfach);
      default:
        return { ok: false, error: `Unbekannter Anbieter: ${postfach.provider}` };
    }
  } catch (fehler) {
    return {
      ok: false,
      error: (fehler as Error).message,
      needsReauth: Boolean((fehler as { needsReauth?: boolean }).needsReauth),
    };
  }
}

export { gmail, outlook, imap };
