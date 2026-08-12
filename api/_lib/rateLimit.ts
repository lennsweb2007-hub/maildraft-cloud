/**
 * Ratenbegrenzung pro Nutzer.
 *
 * Der Zaehler steht in der Datenbank, nicht im Arbeitsspeicher. Das ist der
 * entscheidende Unterschied zur lokalen Fassung: Vercel startet fuer jede
 * Anfrage moeglicherweise eine eigene Instanz, ein Zaehler im Speicher waere
 * pro Instanz getrennt und damit wirkungslos.
 *
 * Verfahren: feste Minutenfenster. Einfacher als ein gleitendes Fenster und
 * fuer den Zweck ausreichend - es geht darum, eine ausser Kontrolle geratene
 * Schleife in der Oberflaeche zu bremsen, nicht darum, einen Angriff
 * abzuwehren.
 */

import { alsDienst } from './supabase.js';
import { ApiError } from './errors.js';

/**
 * Zaehlt eine Anfrage und wirft, wenn das Kontingent erschoepft ist.
 *
 * Faellt die Datenbank aus, wird die Anfrage durchgelassen statt abgewiesen:
 * Eine Ratenbegrenzung, die bei einer Stoerung die ganze App blockiert,
 * richtet mehr Schaden an als der Missbrauch, den sie verhindern soll.
 */
export async function pruefeRate(userId: string, proMinute: number): Promise<void> {
  const jetzt = new Date();
  // Auf die volle Minute abrunden - das ist der Fensterschluessel.
  const fenster = new Date(
    Date.UTC(
      jetzt.getUTCFullYear(),
      jetzt.getUTCMonth(),
      jetzt.getUTCDate(),
      jetzt.getUTCHours(),
      jetzt.getUTCMinutes()
    )
  ).toISOString();

  const client = alsDienst();

  try {
    // Atomar hochzaehlen. Ohne die Datenbankfunktion waeren Lesen und
    // Schreiben zwei Schritte, und zwei gleichzeitige Anfragen wuerden sich
    // gegenseitig ueberschreiben.
    const { data, error } = await client.rpc('increment_rate_limit', {
      p_user_id: userId,
      p_window_start: fenster,
    });

    if (error) {
      // Fehlt die Funktion noch (Schema nicht vollstaendig eingespielt),
      // nicht die ganze App lahmlegen.
      return;
    }

    const anzahl = typeof data === 'number' ? data : 0;
    if (anzahl > proMinute) {
      throw ApiError.tooManyRequests(
        `Zu viele Anfragen (${anzahl} in dieser Minute, erlaubt sind ${proMinute}). ` +
          'Bitte einen Moment warten.'
      );
    }
  } catch (fehler) {
    if (fehler instanceof ApiError) throw fehler;
    // Netzwerkfehler zur Datenbank: durchlassen, siehe oben.
  }
}

/**
 * Raeumt alte Fensterzeilen weg. Wird gelegentlich vom Cron mitgemacht,
 * damit die Tabelle nicht unbegrenzt waechst.
 */
export async function raeumeRateAuf(): Promise<void> {
  const grenze = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await alsDienst().from('rate_limits').delete().lt('window_start', grenze);
}
