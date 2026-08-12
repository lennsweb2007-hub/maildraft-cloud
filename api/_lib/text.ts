/**
 * Textaufbereitung fuer E-Mail-Inhalte.
 *
 * Unveraendert aus der lokalen Fassung uebernommen - diese Funktionen haben
 * sich im Betrieb bewaehrt und haben keinen Bezug zur Ablaufumgebung.
 */

/** Wandelt HTML in lesbaren Klartext um. */
export function htmlZuText(html: string | null | undefined): string {
  if (!html) return '';
  return (
    html
      // Nicht sichtbare Bereiche komplett entfernen
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Blockelemente in Zeilenumbrueche uebersetzen
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      // HTML-Entities aufloesen
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Schneidet die zitierte Vorgeschichte ab. Erkennt die ueblichen Trenner von
 * Outlook, Gmail, Thunderbird und Apple Mail auf Deutsch und Englisch.
 */
export function ohneZitat(text: string): string {
  if (!text) return '';

  const marker = [
    /^-{2,}\s*(Urspr[uü]ngliche Nachricht|Original Message)\s*-{2,}/im,
    /^_{5,}\s*$/m,
    /^Von:\s.+$/im,
    /^From:\s.+$/im,
    /^Am\s.+\sschrieb\s.+:$/im,
    /^On\s.+\swrote:$/im,
    /^Gesendet von (meinem|Mail f[uü]r)/im,
    /^Sent from my /im,
  ];

  let schnitt = text.length;
  for (const m of marker) {
    const treffer = m.exec(text);
    // Nur schneiden, wenn schon genug Text davor steht - sonst wuerde eine
    // Mail, die mit "Von:" beginnt, komplett verschwinden.
    if (treffer && treffer.index > 40 && treffer.index < schnitt) schnitt = treffer.index;
  }

  let ergebnis = text.slice(0, schnitt);

  // Zeilen, die mit ">" beginnen, sind Zitat-Text.
  const zeilen = ergebnis.split('\n');
  const erstesZitat = zeilen.findIndex((z) => /^\s*>/.test(z));
  if (erstesZitat > 3) ergebnis = zeilen.slice(0, erstesZitat).join('\n');

  return ergebnis.trim();
}

/** Kuerzt auf maxLaenge Zeichen und haengt einen Hinweis an. */
export function kuerze(text: string, maxLaenge = 6000): string {
  if (!text || text.length <= maxLaenge) return text || '';
  return `${text.slice(0, maxLaenge)}\n\n[... gekuerzt, ${text.length - maxLaenge} Zeichen ausgelassen]`;
}

/** Komplette Aufbereitung fuer den KI-Prompt. */
export function fuerKi(body: string | null | undefined, maxLaenge = 6000): string {
  return kuerze(ohneZitat(body || ''), maxLaenge);
}

/** Stellt sicher, dass der Betreff genau ein "Re:" traegt. */
export function antwortBetreff(betreff: string | null | undefined): string {
  const sauber = (betreff || '(kein Betreff)').trim();
  return /^(re|aw|antwort)\s*:/i.test(sauber) ? sauber : `Re: ${sauber}`;
}

/** Wandelt Klartext in einfaches HTML fuer den multipart-Versand. */
export function textZuHtml(text: string): string {
  const maskiert = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${maskiert}</div>`;
}

/** Extrahiert die reine Adresse aus "Name <adresse@host>". */
export function adresse(wert: string | null | undefined): string {
  if (!wert) return '';
  const treffer = /<([^>]+)>/.exec(wert);
  return (treffer?.[1] ?? wert).trim().toLowerCase();
}

/** Extrahiert den Anzeigenamen aus "Name <adresse@host>", sonst die Adresse. */
export function anzeigename(wert: string | null | undefined): string {
  if (!wert) return '';
  const treffer = /^\s*"?([^"<]+?)"?\s*</.exec(wert);
  return treffer?.[1]?.trim() ?? adresse(wert);
}

/**
 * Repariert Escape-Sequenzen, die als sichtbarer Text im Entwurf landen.
 *
 * Im JSON-Modus escapen Sprachmodelle Zeilenumbrueche gelegentlich doppelt.
 * Nach JSON.parse steht dann die Zeichenfolge Backslash-n im Text, statt dass
 * ein Umbruch entsteht. Das passiert unzuverlaessig - mal so, mal so - und
 * faellt deshalb im Betrieb leicht durch.
 */
export function normalisiereModelltext(text: unknown): string {
  return String(text ?? '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Uebliche deutsche Grussformeln am Ende einer Mail. */
const GRUSSFORMEL =
  /\n+\s*(mit\s+)?(herzlichen?|viele[nm]?|beste[nm]?|liebe|freundlichen?|sonnige)\s+(gr[uü](ss|ß)e?n?)\s*,?\s*$/i;

/**
 * Haengt die Signatur an und verhindert dabei eine doppelte Grussformel.
 *
 * Trotz klarer Anweisung im Prompt schreiben Sprachmodelle die Grussformel
 * gelegentlich doch - dann staende sie zweimal untereinander.
 */
export function mitSignatur(entwurf: string, signatur: string | null | undefined): string {
  const sauber = signatur?.trim();
  if (!sauber) return entwurf;
  return `${entwurf.replace(GRUSSFORMEL, '').trimEnd()}\n\n${sauber}`;
}
