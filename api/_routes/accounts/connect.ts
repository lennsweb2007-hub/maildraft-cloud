/**
 * GET /api/accounts/connect?provider=gmail|outlook
 *
 * Startet die Anmeldung beim Mailanbieter und liefert die URL, die die
 * Oberflaeche in einem neuen Fenster oeffnet. Ab dort gibt der Nutzer seine
 * Zugangsdaten direkt bei Google bzw. Microsoft ein - diese App bekommt das
 * Passwort nie zu sehen, nur einen widerrufbaren Zugriffsschluessel.
 *
 * Der state-Parameter wird serverseitig erzeugt, ist genau einmal gueltig und
 * laeuft nach 15 Minuten ab. Er ist der einzige Schutz der Rueckleitung, denn
 * die kommt vom Browser des Anbieters und kann kein Anmelde-Token mitbringen.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { ApiError } from '../../_lib/errors.js';
import { zufallsToken } from '../../_lib/crypto.js';
import { alsDienst } from '../../_lib/supabase.js';
import * as gmail from '../../_services/gmail.js';
import * as outlook from '../../_services/outlook.js';

export default geschuetzt({ methoden: ['GET'] }, async ({ req, user }) => {
  const anbieter = String(req.query.provider ?? '');
  const state = zufallsToken(24);

  if (anbieter === 'gmail') {
    // Der Dienst-Zugang ist noetig, weil die Rueckleitung spaeter ohne
    // angemeldeten Nutzer auf diese Zeile zugreifen muss.
    await alsDienst().from('oauth_states').insert({
      state,
      user_id: user.id,
      provider: 'gmail',
      code_verifier: null,
    });

    return { url: gmail.anmeldeUrl(state) };
  }

  if (anbieter === 'outlook') {
    // Der PKCE-Verifier muss bis zur Rueckleitung aufbewahrt werden.
    const { url, codeVerifier } = await outlook.anmeldeUrl(state);

    await alsDienst().from('oauth_states').insert({
      state,
      user_id: user.id,
      provider: 'outlook',
      code_verifier: codeVerifier,
    });

    // Den echten state in die URL setzen - MSAL hat oben nur einen Platzhalter
    // bekommen, weil der state erst nach Erzeugen des Verifiers feststand.
    const fertig = new URL(url);
    fertig.searchParams.set('state', state);
    return { url: fertig.toString() };
  }

  throw ApiError.badRequest(
    `Unbekannter Anbieter "${anbieter}". Erlaubt sind: gmail, outlook. ` +
      'Andere Anbieter werden ueber das IMAP-Formular verbunden.'
  );
});
