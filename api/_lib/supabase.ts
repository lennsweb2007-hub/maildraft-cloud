/**
 * Zugriff auf Supabase.
 *
 * Es gibt bewusst ZWEI Wege in die Datenbank, und die Unterscheidung ist
 * sicherheitsrelevant:
 *
 *  fuerNutzer(jwt)  - arbeitet mit dem Anmelde-Token des Nutzers. Row Level
 *                     Security greift, jede Abfrage sieht ausschliesslich
 *                     eigene Zeilen. Das ist der Normalfall fuer alle
 *                     Endpunkte, die eine Nutzeranfrage bedienen.
 *
 *  alsDienst()      - arbeitet mit dem Service-Role-Key und UMGEHT RLS
 *                     vollstaendig. Noetig fuer den Cron-Abruf (es gibt dort
 *                     keinen angemeldeten Nutzer) und fuer die
 *                     OAuth-Rueckleitung. An diesen Stellen schuetzt die
 *                     Datenbank NICHT - der Code muss selbst nach user_id
 *                     filtern. Jede Verwendung ist unten entsprechend
 *                     kommentiert.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

/** Gemeinsame Optionen: keine Sitzungsverwaltung, das erledigt der Browser. */
const optionen = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/**
 * Client im Namen eines angemeldeten Nutzers.
 *
 * Das JWT wird als Authorization-Header mitgeschickt; Supabase leitet daraus
 * auth.uid() ab, und die RLS-Policies greifen. Selbst wenn im Code ein Filter
 * auf user_id vergessen wird, kann diese Verbindung keine fremden Daten sehen.
 */
export function fuerNutzer(jwt: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    ...optionen,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

/**
 * Client mit vollen Rechten. UMGEHT alle Zugriffsregeln.
 *
 * Nur dort verwenden, wo es keinen angemeldeten Nutzer gibt:
 *   - der Cron-Abruf, der fuer alle Nutzer arbeitet
 *   - die OAuth-Rueckleitung, die vom Browser des Anbieters kommt
 *   - das Schreiben von Protokoll und Statistik
 *
 * Jede Abfrage hier MUSS selbst nach user_id filtern.
 */
export function alsDienst(): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, optionen);
}

/**
 * Prueft ein Anmelde-Token und liefert die Nutzerkennung.
 * @returns null, wenn das Token fehlt, abgelaufen oder gefaelscht ist
 */
export async function nutzerAusToken(
  jwt: string
): Promise<{ id: string; email: string | null } | null> {
  if (!jwt) return null;

  const client = alsDienst();
  const { data, error } = await client.auth.getUser(jwt);

  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Fuegt eine Zeile ein oder gibt die vorhandene zurueck, und wirft bei einem
 * echten Fehler. Spart in den Diensten die immer gleiche Fehlerbehandlung.
 */
export function pruefe<T>(ergebnis: { data: T; error: { message: string } | null }, kontext: string): T {
  if (ergebnis.error) {
    throw new Error(`${kontext}: ${ergebnis.error.message}`);
  }
  return ergebnis.data;
}
