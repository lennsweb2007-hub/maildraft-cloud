/**
 * Protokoll aller veraendernden Aktionen.
 *
 * Wichtig fuer den Datenschutz: Hier landen ausschliesslich Kennungen und
 * Kennzahlen - niemals Mailinhalte, Betreffzeilen, Adressen oder Zugangsdaten.
 * Bei einer App, die fremde Kundenpostfaecher liest, waere ein Protokoll mit
 * Inhalten eine zweite Kopie genau der Daten, die man schuetzen will.
 */

import { alsDienst } from './supabase.js';

/** Felder, die niemals ins Protokoll gelangen duerfen. */
const GEHEIM = new Set([
  'password',
  'imap_password',
  'oauth_token',
  'access_token',
  'refresh_token',
  'token',
  'apiKey',
  'client_secret',
  'body',
  'body_draft',
  'body_original',
  'subject',
  'text',
  'html',
  'from_email',
  'to_email',
  'email_address',
]);

/** Entfernt sensible Werte rekursiv. */
function redigiere(wert: unknown, tiefe = 0): unknown {
  if (tiefe > 4 || wert === null || wert === undefined) return wert;
  if (Array.isArray(wert)) return wert.map((v) => redigiere(v, tiefe + 1));
  if (wert instanceof Error) return { name: wert.name, message: wert.message };
  if (typeof wert !== 'object') return wert;

  const aus: Record<string, unknown> = {};
  for (const [schluessel, v] of Object.entries(wert as Record<string, unknown>)) {
    aus[schluessel] = GEHEIM.has(schluessel) ? '[redigiert]' : redigiere(v, tiefe + 1);
  }
  return aus;
}

export interface Protokolleintrag {
  userId: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Schreibt einen Protokolleintrag.
 *
 * Schlaegt das Schreiben fehl, wird der Fehler verschluckt: Ein Protokoll, das
 * die eigentliche Aktion scheitern laesst, waere ein schlechter Tausch.
 */
export async function protokolliere(eintrag: Protokolleintrag): Promise<void> {
  try {
    await alsDienst()
      .from('audit_log')
      .insert({
        user_id: eintrag.userId,
        action: eintrag.action,
        resource_type: eintrag.resourceType ?? null,
        resource_id: eintrag.resourceId ?? null,
        details: eintrag.details ? (redigiere(eintrag.details) as Record<string, unknown>) : null,
      });
  } catch {
    // bewusst still
  }
}
