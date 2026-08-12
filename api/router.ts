/**
 * Ein Eingang fuer die gesamte API.
 *
 * Warum nicht eine Datei je Endpunkt, wie es Vercels Dateirouting nahelegt?
 * Weil jede Datei unter api/ als eigene Serverless Function zaehlt und der
 * Hobby-Tarif hoechstens zwoelf davon je Bereitstellung erlaubt - die App
 * hatte sechzehn. Statt Endpunkte zu streichen oder einen Bezahltarif zu
 * verlangen, uebernimmt dieser Verteiler die Zuordnung selbst.
 *
 * Die eigentlichen Endpunkte liegen unveraendert unter api/_routes/. Der
 * Unterstrich haelt sie aus der Funktionszaehlung heraus; jeder von ihnen ist
 * weiterhin ein fertig umhuellter Handler, der Anmeldung, Ratenbegrenzung und
 * Fehlerbehandlung selbst mitbringt.
 *
 * Die Adressen nach aussen bleiben Zeichen fuer Zeichen dieselben - weder der
 * Client noch die OAuth-Rueckleitung noch der Cron merken etwas davon.
 *
 * Die Importe sind bewusst statisch und nicht dynamisch: So faellt ein
 * falscher Pfad schon beim Typecheck auf statt erst zur Laufzeit in der
 * Produktion.
 *
 * Wie die Anfragen hier ankommen: ueber eine Rewrite-Regel in der
 * vercel.json, die /api/(.*) auf /api/router?pfad=$1 umschreibt. Der erste
 * Versuch lief ueber eine Datei namens [...pfad].ts - Vercel hat die
 * Klammernschreibweise aber nicht als Catch-all gelesen, sondern als
 * gewoehnliches dynamisches Segment: Pfade mit zwei Abschnitten
 * (/api/emails/fetch) erreichten die Funktion gar nicht, und bei einem
 * Abschnitt kam der Wert unter einem anderen Namen an. Die Rewrite-Regel ist
 * eindeutig und braucht keine Annahme darueber, wie Vercel Dateinamen deutet.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { zuAntwort, ApiError } from './_lib/errors.js';

import kategorien from './_routes/categories.js';
import historie from './_routes/history.js';
import szenarien from './_routes/scenarios/index.js';
import auswertung from './_routes/stats/dashboard.js';

import entwuerfeListe from './_routes/drafts/index.js';
import entwurfDetail from './_routes/drafts/detail.js';
import entwurfSenden from './_routes/drafts/send.js';
import entwurfNeuSchreiben from './_routes/drafts/regenerate.js';
import entwuerfeNachpruefen from './_routes/drafts/recheck.js';

import postfaecher from './_routes/accounts/index.js';
import postfachVerbinden from './_routes/accounts/connect.js';
import postfachRueckleitung from './_routes/accounts/callback.js';

import abruf from './_routes/emails/fetch.js';
import abrufManuell from './_routes/emails/refresh.js';

import einstellungen from './_routes/settings/index.js';
import kiTest from './_routes/settings/test-ai.js';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/**
 * Feste Adressen. Der Schluessel ist der Pfad hinter /api, mit Schraegstrich
 * verbunden.
 */
const ROUTEN: Record<string, Handler> = {
  'categories': kategorien,
  'history': historie,
  'scenarios': szenarien,
  'stats/dashboard': auswertung,

  'drafts': entwuerfeListe,
  'drafts/send': entwurfSenden,
  'drafts/regenerate': entwurfNeuSchreiben,
  'drafts/recheck': entwuerfeNachpruefen,

  'accounts': postfaecher,
  'accounts/connect': postfachVerbinden,
  'accounts/callback': postfachRueckleitung,

  'emails/fetch': abruf,
  'emails/refresh': abrufManuell,

  'settings': einstellungen,
  'settings/test-ai': kiTest,
};

/**
 * Der angefragte Pfad hinter /api, ohne fuehrenden und abschliessenden
 * Schraegstrich.
 *
 * Erste Quelle ist der Parameter aus der Rewrite-Regel. Schlaegt der fehl -
 * etwa weil jemand die Regel aendert oder die Funktion direkt aufruft -,
 * wird die Adresse selbst ausgewertet. Zwei Quellen, weil ein stiller
 * Fehlschlag hier die gesamte API auf 404 setzen wuerde.
 */
function ermittlePfad(req: VercelRequest): string {
  const ausRegel = req.query.pfad;
  const roh = Array.isArray(ausRegel) ? ausRegel.join('/') : ausRegel;
  if (roh) return roh.replace(/^\/+|\/+$/g, '');

  const adresse = req.url ?? '';
  const ohneQuery = adresse.split('?')[0] ?? '';
  return ohneQuery.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
}

export default async function verteile(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const pfad = ermittlePfad(req);
    const segmente = pfad ? pfad.split('/') : [];

    const route = ROUTEN[pfad];
    if (route) return route(req, res);

    // Uebrig bleibt /api/drafts/<kennung>. Frueher erledigte das die Datei
    // [id].ts, und Vercel legte die Kennung als req.query.id ab - der
    // Endpunkt liest sie dort bis heute. Das holen wir hier nach.
    //
    // Die Reihenfolge ist wichtig: Erst die festen Adressen oben, dann diese
    // Auffangregel. Sonst wuerde /api/drafts/send als Entwurf mit der
    // Kennung "send" gelesen - und an der Pruefung auf eine gueltige UUID
    // scheitern.
    const kennung = segmente[1];
    if (segmente.length === 2 && segmente[0] === 'drafts' && kennung) {
      req.query.id = kennung;
      return entwurfDetail(req, res);
    }

    throw ApiError.notFound(`Den Endpunkt /api/${pfad} gibt es nicht.`);
  } catch (fehler) {
    const { status, body } = zuAntwort(fehler);
    if (!res.writableEnded) res.status(status).json(body);
  }
}
