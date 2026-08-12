/**
 * Vorfilter ohne KI.
 *
 * Erkennt Mails, bei denen die Antwort ohnehin feststeht - Newsletter,
 * Zustellberichte, Zahlungsbenachrichtigungen. Zwei Gruende, das vor der KI zu
 * tun:
 *
 *  1. Kosten und Tempo. Bei rund 95 Prozent Rauschen spart der Vorfilter den
 *     Grossteil der Anfragen an Gemini - bei einem geteilten Schluessel der
 *     entscheidende Punkt.
 *  2. Verlaesslichkeit. Ein List-Unsubscribe-Header ist ein harter Beweis,
 *     dass es sich um einen Verteiler handelt - da braucht es kein Modell.
 *
 * Der Filter sortiert nur aus, was eindeutig ist. Er sagt nie "das ist eine
 * Kundenanfrage" - diese Richtung waere zu riskant fuer eine Handvoll
 * Schluesselwoerter.
 */

import type { Nachricht } from './typen.js';

/** Absender-Bestandteile, die auf einen Automaten hindeuten. */
const AUTOMATEN = [
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'nicht-antworten',
  'nichtantworten',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'notification',
  'notifications',
  'benachrichtigung',
  'newsletter',
  'mailing',
  'automail',
  'autoreply',
];

/** Betreffzeilen, die eine reine Systemnachricht ankuendigen. */
const SYSTEM_BETREFFE = [
  'abwesenheitsnotiz',
  'automatische antwort',
  'automatic reply',
  'out of office',
  'undeliverable',
  'unzustellbar',
  'delivery status notification',
  'zustellungsfehler',
  'read receipt',
  'lesebestätigung',
];

/**
 * Betreffzeilen, hinter denen eine weitergeleitete Kundennachricht steckt.
 *
 * Shopsysteme verschicken Kontaktformulare ueber ihre eigene Adresse -
 * typischerweise no-reply@shopify.com. Die eigentliche Anfrage steht im Text,
 * die Kundin im Reply-To. Ohne diese Ausnahme fallen genau die wichtigsten
 * Mails durch den Automatenfilter.
 */
const WEITERLEITUNGEN = [
  'form has a new submission',
  'new customer message',
  'neue kundennachricht',
  'kontaktformular',
  'contact form',
  'neue nachricht von',
  'neue anfrage',
  'new inquiry',
  'customer inquiry',
];

/**
 * Domains, deren Mails praktisch nie eine Antwort brauchen. Greift nur
 * zusammen mit einem passenden Betreff - bei einem Zahlungsdienst kann
 * durchaus auch mal ein Mensch schreiben.
 */
const DIENST_DOMAINS = [
  'paypal.com', 'paypal.de', 'klarna.com', 'klarna.de', 'stripe.com', 'mollie.com',
  'shopify.com', 'etsy.com', 'amazon.de', 'amazon.com', 'ebay.de', 'ebay.com',
  'dhl.de', 'dpd.de', 'hermesworld.com', 'ups.com', 'gls-group.eu',
  'lexoffice.de', 'lexware.de', 'sevdesk.de', 'datev.de',
  'facebook.com', 'facebookmail.com', 'instagram.com', 'linkedin.com',
  'google.com', 'googlemail.com', 'microsoft.com', 'apple.com', 'tiktok.com',
];

/** Betreff-Begriffe, die auf Rechnung oder Zahlung hindeuten. */
const TRANSAKTIONEN = [
  'rechnung', 'invoice', 'zahlungseingang', 'zahlungsbestätigung', 'zahlung erhalten',
  'quittung', 'receipt', 'beleg', 'mahnung', 'lastschrift', 'gutschrift',
  'kontoauszug', 'abrechnung', 'sendungsverfolgung', 'versandbestätigung',
  'auszahlung', 'tracking',
];

const klein = (wert: unknown) => String(wert ?? '').trim().toLowerCase();

/**
 * Macht Text vergleichbar, unabhaengig von der Umlautschreibung.
 *
 * Betreffzeilen kommen mal als "Zahlungsbestätigung", mal als
 * "Zahlungsbestaetigung" - je nachdem, wie das versendende System kodiert.
 * Ohne diese Angleichung greift ein Suchbegriff nur bei einer der beiden
 * Schreibweisen, und die Erkennung haengt am Zufall.
 */
function falte(wert: unknown): string {
  return klein(wert)
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function domainVon(adresse: string): string {
  const at = klein(adresse).lastIndexOf('@');
  return at === -1 ? '' : klein(adresse).slice(at + 1);
}

/**
 * Prueft, ob der Absender auf der Sperrliste steht.
 * Eintraege koennen vollstaendige Adressen oder blosse Domains sein.
 */
export function istGesperrt(absender: string, sperrliste: string[]): boolean {
  const von = klein(absender);
  const domain = domainVon(von);
  if (!von) return false;

  return sperrliste.some((roh) => {
    const eintrag = klein(roh).replace(/^@/, '');
    if (!eintrag) return false;
    return eintrag.includes('@') ? von === eintrag : domain === eintrag || domain.endsWith(`.${eintrag}`);
  });
}

export interface VorfilterErgebnis {
  ignore: boolean;
  kind?: string;
  reason?: string;
  /** Weitergeleitete Kundennachricht - der Automatenfilter greift nicht. */
  weitergeleitet?: boolean;
}

/**
 * Wendet den Vorfilter an.
 */
export function vorfilter(
  mail: Pick<Nachricht, 'from' | 'subject' | 'listUnsubscribe' | 'replyTo'>,
  sperrliste: string[] = []
): VorfilterErgebnis {
  const von = klein(mail.from);
  const lokalteil = von.split('@')[0] ?? '';
  const domain = domainVon(von);
  const betreff = falte(mail.subject);

  if (istGesperrt(von, sperrliste)) {
    return { ignore: true, kind: 'gesperrt', reason: 'Absender steht auf Ihrer Sperrliste.' };
  }

  // --- Weitergeleitete Kundennachricht? Dann greift kein Automatenfilter ---
  //
  // Zwei unabhaengige Hinweise, jeder fuer sich aussagekraeftig:
  //   1. Ein Reply-To, das auf eine andere, nicht-automatische Adresse zeigt.
  //      Genau so leiten Shopsysteme Kontaktformulare weiter.
  //   2. Eine Betreffzeile, die eine Formularnachricht ankuendigt.
  //
  // In beiden Faellen wird nicht entschieden, sondern an die KI uebergeben -
  // sie liest den Text und urteilt. Eine hier faelschlich aussortierte Mail
  // waere eine verlorene Kundenanfrage.
  const antwortZiel = klein(mail.replyTo);
  const hatEigenesAntwortziel =
    Boolean(antwortZiel) &&
    antwortZiel !== von &&
    !AUTOMATEN.some((n) => (antwortZiel.split('@')[0] ?? '').includes(n));

  const istWeiterleitung =
    hatEigenesAntwortziel || WEITERLEITUNGEN.some((n) => betreff.includes(falte(n)));

  if (istWeiterleitung && !mail.listUnsubscribe) {
    return { ignore: false, weitergeleitet: true };
  }

  // Der List-Unsubscribe-Header ist der eindeutigste Hinweis ueberhaupt.
  if (mail.listUnsubscribe) {
    return {
      ignore: true,
      kind: 'newsletter',
      reason: 'Verteilermail mit Abmeldelink (List-Unsubscribe).',
    };
  }

  if (SYSTEM_BETREFFE.some((n) => betreff.includes(falte(n)))) {
    return {
      ignore: true,
      kind: 'benachrichtigung',
      reason: 'Automatische Systemnachricht laut Betreff.',
    };
  }

  const istAutomat = AUTOMATEN.some((n) => lokalteil.includes(n));
  const istDienstDomain = DIENST_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
  const istTransaktion = TRANSAKTIONEN.some((n) => betreff.includes(falte(n)));

  // Ein Automaten-Absender allein reicht: Von noreply@ kommt keine
  // Kundenanfrage, und eine Antwort dorthin erreicht ohnehin niemanden.
  if (istAutomat) {
    return {
      ignore: true,
      kind: istTransaktion ? 'rechnung' : 'benachrichtigung',
      reason: 'Absender ist eine Adresse, die keine Antworten entgegennimmt.',
    };
  }

  // Bei Dienstleister-Domains braucht es zusaetzlich einen passenden Betreff -
  // ein Mensch bei Etsy oder DHL koennte durchaus schreiben.
  if (istDienstDomain && istTransaktion) {
    return {
      ignore: true,
      kind: 'rechnung',
      reason: `Zahlungs- oder Versandbenachrichtigung von ${domain}.`,
    };
  }

  return { ignore: false };
}
