/**
 * GET /api/emails/fetch   - der Cron-Endpunkt
 *
 * Wird von EasyCron aufgerufen. Das Geheimnis gehoert in den Header
 * "X-Cron-Secret", nicht in die URL: Query-Strings landen in Server- und
 * Proxy-Protokollen, ein Geheimnis hat dort nichts zu suchen.
 *
 * Empfohlene Taktung: alle 5 Minuten. Jeder Aufruf arbeitet bis zum
 * Zeitbudget und meldet, ob noch etwas offen ist - haeufigere Aufrufe bauen
 * einen Rueckstand damit zuegig ab, ohne dass eine einzelne Funktion in ihr
 * Zeitlimit laeuft.
 *
 * Der Endpunkt ist bewusst genuegsam: Laeuft bereits ein Abruf, meldet er das
 * und endet sofort, statt zu warten.
 */

import { oeffentlich } from '../_lib/handler.js';
import { fuehreAbrufAus } from '../_services/sync.js';
import { raeumeRateAuf } from '../_lib/rateLimit.js';

export default oeffentlich({ methoden: ['GET', 'POST'], cronGeschuetzt: true }, async () => {
  const ergebnis = await fuehreAbrufAus();

  // Gelegenheit zum Aufraeumen - kostet nichts und haelt die Tabelle klein.
  if (!ergebnis.gesperrt) await raeumeRateAuf();

  return {
    ok: true,
    ...ergebnis,
    hinweis: ergebnis.gesperrt
      ? 'Es laeuft bereits ein Abruf. Dieser Aufruf wurde uebersprungen.'
      : ergebnis.nochOffen
        ? 'Zeitbudget erreicht. Die uebrigen Mails werden beim naechsten Aufruf verarbeitet.'
        : 'Alle Postfaecher vollstaendig abgerufen.',
  };
});
