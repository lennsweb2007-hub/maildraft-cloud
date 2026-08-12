/**
 * GET /api/settings/test-ai  - Gemini-Verbindung pruefen
 *
 * Prueft den gemeinsamen Schluessel aus den Umgebungsvariablen. Bei einem
 * Fehler kommt eine Meldung zurueck, die sagt, was zu tun ist - "HTTP 400"
 * hilft niemandem weiter.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { testeVerbindung } from '../../_services/gemini.js';

export default geschuetzt({ methoden: ['GET'] }, async () => testeVerbindung());
