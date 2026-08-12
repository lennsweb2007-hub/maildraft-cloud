/**
 * POST /api/emails/refresh  - manueller Abruf aus der Oberflaeche
 *
 * Ruft nur die Postfaecher des angemeldeten Nutzers ab. Die Sperre gilt
 * global: Laeuft gerade der Cron, meldet dieser Aufruf das und endet - sonst
 * wuerden beide gleichzeitig auf dasselbe Gemini-Kontingent zugreifen.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { fuehreAbrufAus } from '../../_services/sync.js';

export default geschuetzt(
  { methoden: ['POST'], aktion: 'emails.refresh' },
  async ({ user }) => {
    const ergebnis = await fuehreAbrufAus(user.id);

    return {
      result: ergebnis,
      message: ergebnis.gesperrt
        ? 'Es laeuft bereits ein Abruf. Bitte einen Moment warten.'
        : ergebnis.entwuerfeErstellt > 0
          ? `${ergebnis.entwuerfeErstellt} neue${ergebnis.entwuerfeErstellt === 1 ? 'r Entwurf' : ' Entwuerfe'} erstellt.` +
            (ergebnis.aussortiert > 0 ? ` ${ergebnis.aussortiert} aussortiert.` : '')
          : ergebnis.aussortiert > 0
            ? `Keine neuen Kundenanfragen. ${ergebnis.aussortiert} Mails aussortiert.`
            : 'Keine neuen E-Mails gefunden.',
    };
  }
);
