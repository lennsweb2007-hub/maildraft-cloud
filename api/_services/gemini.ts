/**
 * Gemini: Relevanzpruefung und Entwurfserstellung.
 *
 * Zwei Stufen, bewusst getrennt:
 *
 *   classifyRelevance()  laeuft ueber JEDE eingehende Mail und beantwortet nur
 *                        eine Frage - erwartet hier ein Mensch eine Antwort?
 *                        Kurzer Prompt ohne Szenarien, kleines Modell.
 *
 *   generateDraft()      laeuft nur ueber die wenigen echten Anfragen und
 *                        schreibt die Antwort im Stil der hinterlegten
 *                        Szenarien.
 *
 * Der Grund fuer die Trennung ist nicht nur Sparsamkeit: Bekommt das Modell
 * die Szenarien mit in die Pruefung, wird es in Richtung "schreib eine
 * Antwort" gedraengt und urteilt weniger nuechtern.
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../_lib/config.js';
import { QuotaExhaustedError } from '../_lib/errors.js';
import { fuerKi, mitSignatur, normalisiereModelltext } from '../_lib/text.js';
import type { Kategorie, Profil, Szenario } from './typen.js';

let client: GoogleGenAI | null = null;

function holeClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: config.ai.apiKey });
  return client;
}

// ---------------------------------------------------------------------------
//  Taktbremse
// ---------------------------------------------------------------------------

/**
 * Serialisiert alle Gemini-Anfragen dieser Instanz und haelt einen
 * Mindestabstand ein.
 *
 * Der kostenlose Tarif erlaubt je nach Modell nur 15 bis 30 Anfragen pro
 * Minute - und alle Nutzer teilen sich einen Schluessel. Ohne Bremse feuert
 * ein Abruf mit 40 Mails alles auf einmal los, kassiert reihenweise HTTP 429
 * und erzeugt am Ende lauter Vorlagen statt echter Entwuerfe.
 *
 * Wichtig: Diese Bremse wirkt nur INNERHALB einer Instanz. Dass nicht mehrere
 * Abrufe gleichzeitig laufen, stellt die Sperre in der Datenbank sicher
 * (siehe sync.ts) - ohne sie waere die Taktung hier wirkungslos.
 */
let letzterAufruf = 0;
let warteschlange: Promise<unknown> = Promise.resolve();

const schlafe = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mindestabstandMs(): number {
  return Math.ceil(60_000 / Math.max(1, config.ai.requestsPerMinute));
}

function getaktet<T>(fn: () => Promise<T>): Promise<T> {
  const lauf = warteschlange.then(async () => {
    const wartezeit = Math.max(0, mindestabstandMs() - (Date.now() - letzterAufruf));
    if (wartezeit > 0) await schlafe(wartezeit);
    letzterAufruf = Date.now();
    return fn();
  });

  // Die Warteschlange darf durch einen Fehler nicht abreissen.
  warteschlange = lauf.then(
    () => undefined,
    () => undefined
  );
  return lauf;
}

// ---------------------------------------------------------------------------
//  Kontingent-Sperre
// ---------------------------------------------------------------------------

/**
 * Bis wann fuer ein Modell keine Anfragen mehr gestellt werden.
 *
 * Pro Modell, weil Google die Kontingente pro Modell fuehrt: Ein erschoepftes
 * Entwurfsmodell darf die Vorpruefung, die auf einem anderen Modell laeuft,
 * nicht mit blockieren.
 */
const sperren = new Map<string, number>();

export function kontingentGesperrt(model: string = config.ai.model): boolean {
  return Date.now() < (sperren.get(model) ?? 0);
}

export function sperrRestMs(model: string = config.ai.model): number {
  return Math.max(0, (sperren.get(model) ?? 0) - Date.now());
}

/** Sind beide Modelle gesperrt? Dann lohnt kein weiterer Versuch. */
export function vollstaendigGesperrt(): boolean {
  return kontingentGesperrt(config.ai.model) && kontingentGesperrt(config.ai.triageModel);
}

/**
 * Liest die von Google vorgegebene Wartezeit aus einer 429-Antwort.
 * Google nennt sie im Klartext ("Please retry in 33.86s") - danach zu warten
 * ist verlaesslicher als ein geratener exponentieller Backoff, der bei einem
 * Minutenlimit typischerweise zu kurz ausfaellt.
 */
function empfohleneWartezeit(fehler: unknown): number | null {
  const treffer = /retry in ([\d.]+)\s*s/i.exec(String((fehler as Error)?.message ?? ''));
  if (!treffer?.[1]) return null;
  return Math.ceil(Number.parseFloat(treffer[1]) * 1000) + 750;
}

/** Erkennt Fehler, bei denen ein erneuter Versuch sinnvoll ist. */
function wiederholbar(fehler: unknown): boolean {
  const f = fehler as { status?: number; code?: number; message?: string };
  const status = f?.status ?? f?.code;
  const meldung = String(f?.message ?? '');
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /rate.?limit|quota|overloaded|unavailable|deadline|ECONNRESET|ETIMEDOUT|fetch failed/i.test(meldung)
  );
}

// ---------------------------------------------------------------------------
//  Aufruf
// ---------------------------------------------------------------------------

interface AufrufOptionen {
  schema: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
}

async function rufeGemini<T>(prompt: string, optionen: AufrufOptionen): Promise<T> {
  const {
    schema,
    temperature = 0.7,
    // Grosszuegig bemessen: Die aktuellen Modelle verbrauchen interne
    // "Denk-Tokens", die auf dieses Limit angerechnet werden. Ist es zu knapp,
    // bricht die Antwort mitten im JSON ab - ohne Fehlermeldung, man bekommt
    // einfach unvollstaendigen Text.
    maxOutputTokens = 4096,
    model = config.ai.model,
  } = optionen;

  const ai = holeClient();
  let letzterFehler: unknown;

  for (let versuch = 0; versuch < config.ai.maxRetries; versuch += 1) {
    if (kontingentGesperrt(model)) throw new QuotaExhaustedError(sperrRestMs(model));

    try {
      const antwort = await getaktet(() =>
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature,
            maxOutputTokens,
          },
        })
      );

      const text = antwort.text;
      if (!text) throw new Error('Gemini hat eine leere Antwort geliefert.');

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(
          'Gemini hat unvollstaendiges JSON geliefert (Antwort vermutlich abgeschnitten).'
        );
      }
    } catch (fehler) {
      letzterFehler = fehler;

      const vorgabe = empfohleneWartezeit(fehler);
      const f = fehler as { status?: number; code?: number; message?: string };
      const istKontingent =
        (f?.status ?? f?.code) === 429 || /quota|RESOURCE_EXHAUSTED/i.test(String(f?.message ?? ''));

      // Verlangt Google eine laengere Pause, ist das Kontingent erschoepft und
      // nicht nur kurz ueberlastet. Dann wird gesperrt statt gewartet - sonst
      // liefe die Funktion minutenlang gegen eine geschlossene Tuer.
      if (istKontingent && vorgabe !== null && vorgabe > 15_000) {
        sperren.set(model, Date.now() + vorgabe);
        throw new QuotaExhaustedError(vorgabe);
      }

      if (!wiederholbar(fehler) || versuch === config.ai.maxRetries - 1) break;

      const wartezeit =
        vorgabe ?? config.ai.retryBaseDelayMs * 2 ** versuch + Math.random() * 500;
      await schlafe(wartezeit);
    }
  }

  throw letzterFehler;
}

// ---------------------------------------------------------------------------
//  Relevanzpruefung
// ---------------------------------------------------------------------------

const RELEVANZ_SCHEMA = {
  type: 'object',
  properties: {
    isCustomerInquiry: {
      type: 'boolean',
      description: 'true, wenn eine echte Person eine Antwort vom Kundenservice erwartet',
    },
    kind: {
      type: 'string',
      description:
        'kundenanfrage, benachrichtigung, rechnung, bestellbestaetigung, newsletter, spam oder sonstiges',
    },
    reason: { type: 'string', description: 'Begruendung in maximal 12 Woertern auf Deutsch' },
    confidence: { type: 'number', description: 'Sicherheit zwischen 0 und 1' },
  },
  required: ['isCustomerInquiry', 'kind', 'reason', 'confidence'],
};

/** Unterhalb dieser Sicherheit wird im Zweifel ein Entwurf erstellt. */
export const UNSICHER_SCHWELLE = 0.75;

export interface EingehendeMail {
  from: string;
  fromName?: string | null;
  subject: string;
  text?: string | null;
}

function relevanzPrompt(profil: Profil, mail: EingehendeMail): string {
  const marke = profil.brand_name || 'unsere Marke';
  const kontext = profil.business_context?.trim();

  return `Du sortierst den Posteingang eines Kundenservice-Postfachs der Marke "${marke}".

${kontext ? `ZUM GESCHAEFT:\n${kontext}\n` : ''}
Deine einzige Aufgabe: Entscheide, ob diese E-Mail eine Antwort vom Kundenservice braucht.

EINE ANTWORT BRAUCHT SIE, wenn ein Mensch eine Frage, ein Anliegen oder eine Beschwerde an uns richtet. Beispiele:
- Fragen zu Bestellung, Lieferung, Retoure, Widerruf, Umtausch, Groesse, Produkt, Verfuegbarkeit
- Reklamationen, Beschwerden, Nachfragen zu einer laufenden Sache
- Anfragen von Geschaeftspartnern, Presse oder Bewerbern, die eine Reaktion erwarten
- Kundennachrichten, die ueber ein Kontaktformular des Shopsystems weitergeleitet wurden

KEINE ANTWORT BRAUCHT SIE bei automatisch versendeten Nachrichten und allem, was uns nur informiert:
- Zahlungsbenachrichtigungen von PayPal, Klarna, Stripe, Banken
- Rechnungen, Mahnungen, Kontoauszuege, Steuerunterlagen
- Bestell- und Versandbestaetigungen von Dienstleistern, Sendungsverfolgungen
- Newsletter, Werbung, Rabattaktionen, Einladungen zu Webinaren
- Benachrichtigungen von Plattformen und Werkzeugen (Shopsystem, Social Media, Buchhaltung)
- Spam, Phishing, unaufgeforderte Kaltakquise und SEO-Angebote
- Automatische Abwesenheitsnotizen und Zustellberichte

EINGEHENDE E-MAIL:
Von: ${mail.fromName ? `${mail.fromName} <${mail.from}>` : mail.from}
Betreff: ${mail.subject}
Text:
"""
${fuerKi(mail.text, 2500) || '(kein lesbarer Text)'}
"""

WICHTIG: Im Zweifelsfall entscheide auf isCustomerInquiry=true und setze confidence niedrig. Eine faelschlich aussortierte Kundenanfrage ist deutlich teurer als ein ueberfluessiger Entwurf.`;
}

export interface RelevanzUrteil {
  relevant: boolean;
  kind: string;
  reason: string;
  confidence: number;
  unsure: boolean;
  checkedByAi: boolean;
}

/**
 * Prueft, ob eine E-Mail ueberhaupt eine Kundenservice-Antwort braucht.
 *
 * Wirft nie. Faellt die KI aus, gilt die Mail als relevant - lieber ein
 * ueberfluessiger Entwurf als eine verlorene Kundenanfrage.
 */
export async function pruefeRelevanz(
  profil: Profil,
  mail: EingehendeMail
): Promise<RelevanzUrteil> {
  const ausfall = (grund: string): RelevanzUrteil => ({
    relevant: true,
    kind: 'unbekannt',
    reason: grund,
    confidence: 0,
    unsure: true,
    checkedByAi: false,
  });

  if (!config.ai.istKonfiguriert) {
    return ausfall('Ohne KI-Schluessel findet keine Vorpruefung statt.');
  }

  let ergebnis: {
    isCustomerInquiry?: boolean;
    kind?: string;
    reason?: string;
    confidence?: number;
  };

  try {
    ergebnis = await rufeGemini(relevanzPrompt(profil, mail), {
      // Eigenes, kleineres Modell - Begruendung in config.ts
      model: config.ai.triageModel,
      schema: RELEVANZ_SCHEMA,
      temperature: 0,
      maxOutputTokens: 1024,
    });
  } catch {
    return ausfall('Vorpruefung war nicht moeglich, Mail wurde vorsichtshalber uebernommen.');
  }

  const sicherheit = typeof ergebnis.confidence === 'number' ? ergebnis.confidence : 0.5;
  const relevant = Boolean(ergebnis.isCustomerInquiry);
  const unsicher = sicherheit < UNSICHER_SCHWELLE;

  return {
    // Im Zweifel entsteht ein Entwurf: Ist sich das Modell unsicher, landet
    // die Mail auch dann bei den Entwuerfen, wenn es sie aussortieren wollte.
    relevant: relevant || unsicher,
    kind: String(ergebnis.kind ?? 'sonstiges').toLowerCase(),
    reason: normalisiereModelltext(ergebnis.reason).slice(0, 200),
    confidence: sicherheit,
    unsure: unsicher,
    checkedByAi: true,
  };
}

// ---------------------------------------------------------------------------
//  Entwurfserstellung
// ---------------------------------------------------------------------------

const ENTWURF_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', description: 'Name genau einer der vorgegebenen Kategorien' },
    scenarioId: { type: 'string', description: 'Kennung des gewaehlten Szenarios, oder "null"' },
    draft: { type: 'string', description: 'Der fertige Antworttext auf Deutsch' },
    confidence: { type: 'number', description: 'Sicherheit der Zuordnung zwischen 0 und 1' },
  },
  required: ['category', 'draft'],
};

const TONFALL: Record<string, string> = {
  formal:
    'Formell und geschaeftlich. Siezen, vollstaendige Saetze, keine Umgangssprache, keine Emojis.',
  freundlich:
    'Freundlich, warm und nahbar, aber professionell. Siezen. Kurze, klare Saetze. Hoechstens ein dezentes Emoji, wenn es wirklich passt.',
  technisch:
    'Sachlich und praezise. Konkrete Schritte, Nummern und Fristen nennen. Keine Floskeln, keine Emojis.',
};

function beschreibeTonfall(profil: Profil): string {
  const ton = profil.tone || 'freundlich';
  if (ton === 'custom') return profil.custom_tone?.trim() || TONFALL.freundlich!;
  return TONFALL[ton] ?? TONFALL.freundlich!;
}

function entwurfPrompt(
  profil: Profil,
  szenarien: Szenario[],
  kategorien: Kategorie[],
  mail: EingehendeMail
): string {
  const marke = profil.brand_name || 'unsere Marke';

  const szenarioBlock =
    szenarien.length > 0
      ? szenarien
          .map(
            (s, i) =>
              `--- Szenario ${i + 1} ---\n` +
              `ID: ${s.id}\n` +
              `Titel: ${s.title}\n` +
              `Typische Stichwoerter: ${(s.trigger_keywords ?? []).join(', ') || '(keine)'}\n` +
              `So antworte ich in diesem Fall:\n"""\n${s.example_response}\n"""`
          )
          .join('\n\n')
      : '(Noch keine Szenarien hinterlegt - antworte allgemein und hilfsbereit.)';

  // Hat der Nutzer eine Signatur hinterlegt, bringt sie ihre eigene
  // Grussformel mit. Die KI muss dann darauf verzichten - sonst staende am
  // Ende zweimal "Herzliche Gruesse" untereinander.
  const hatSignatur = Boolean(profil.signature?.trim());
  const abschlussRegel = hatSignatur
    ? '- Beginne mit einer passenden Anrede. Schreibe KEINE Grussformel und KEINEN Namen am Ende - die Nachricht endet mit dem letzten inhaltlichen Satz. Gruss und Signatur werden automatisch angehaengt.'
    : '- Beginne mit einer passenden Anrede und ende mit einer Grussformel. Setze KEINEN Namen darunter.';

  return `Du bist die Kundenservice-Mitarbeiterin der Marke "${marke}" und beantwortest eine echte Kundenanfrage per E-Mail.

=== SZENARIEN (Beispielantworten der Inhaberin) ===
${szenarioBlock}

=== TONFALL ===
${beschreibeTonfall(profil)}

=== VERFUEGBARE KATEGORIEN ===
${kategorien.map((k) => `- ${k.name}`).join('\n')}

=== EINGEHENDE E-MAIL ===
Von: ${mail.fromName || mail.from}
Betreff: ${mail.subject}
Text:
"""
${fuerKi(mail.text) || '(Die Mail enthaelt keinen lesbaren Text.)'}
"""

=== DEINE AUFGABE ===
1. Ordne die E-Mail genau einer der oben genannten Kategorien zu.
2. Waehle das inhaltlich passendste Szenario. Passt keines, gib scenarioId null zurueck.
3. Schreibe die fertige Antwort-E-Mail auf Deutsch.

REGELN FUER DIE ANTWORT:
${abschlussRegel}
- KEINE Signatur und KEIN Firmenname im Text.
- KEINE Betreffzeile und keine Kopfzeilen, nur der Fliesstext der Nachricht.
- Uebernimm den Stil des gewaehlten Szenarios, aber gehe konkret auf DIESE Anfrage ein.
- Erfinde niemals Bestellnummern, Preise, Fristen, Adressen oder Zusagen, die nicht in der Kundenmail oder im Szenario stehen. Fehlt eine Information, frage danach.
- Ist die Anfrage unklar oder ein Sonderfall, schreibe eine kurze Rueckfrage statt einer erfundenen Loesung.
- Laenge: hoechstens 150 Woerter.`;
}

export interface Entwurfsergebnis {
  categoryId: string | null;
  categoryName: string | null;
  scenarioId: string | null;
  draft: string;
  aiGenerated: boolean;
  note: string | null;
  confidence: number | null;
}

/**
 * Fallback ohne KI: waehlt das Szenario mit den meisten Treffern in Betreff
 * und Text und verwendet dessen Beispielantwort unveraendert.
 */
function vorlageAusSzenario(
  szenarien: Szenario[],
  kategorien: Kategorie[],
  mail: EingehendeMail,
  grund: string
): Entwurfsergebnis {
  const heuhaufen = `${mail.subject ?? ''} ${mail.text ?? ''}`.toLowerCase();

  let bestes: Szenario | null = null;
  let bestePunkte = 0;
  for (const szenario of szenarien) {
    const punkte = (szenario.trigger_keywords ?? []).filter(
      (kw) => kw && heuhaufen.includes(kw)
    ).length;
    if (punkte > bestePunkte) {
      bestes = szenario;
      bestePunkte = punkte;
    }
  }

  const kategorie =
    (bestes?.category_id && kategorien.find((k) => k.id === bestes!.category_id)) ||
    kategorien.find((k) => k.name.toLowerCase() === 'allgemein') ||
    kategorien[0] ||
    null;

  const text =
    bestes?.example_response ||
    'vielen Dank für Ihre Nachricht.\n\n' +
      'Wir haben Ihre Anfrage erhalten und melden uns schnellstmöglich persönlich bei Ihnen.\n\n' +
      'Freundliche Grüße';

  return {
    categoryId: kategorie?.id ?? null,
    categoryName: kategorie?.name ?? null,
    scenarioId: bestes?.id ?? null,
    draft: text,
    aiGenerated: false,
    note: grund,
    confidence: bestePunkte > 0 ? 0.4 : 0.1,
  };
}

/** Bildet den vom Modell genannten Kategorienamen auf eine echte Kategorie ab. */
function findeKategorie(kategorien: Kategorie[], genannt: unknown): Kategorie | null {
  const gesucht = String(genannt ?? '').trim().toLowerCase();
  return (
    kategorien.find((k) => k.name.toLowerCase() === gesucht) ??
    // Modelle halluzinieren gelegentlich Varianten wie "Retoure" statt "Retouren".
    kategorien.find((k) => k.name.toLowerCase().startsWith(gesucht.slice(0, 5))) ??
    kategorien.find((k) => k.name.toLowerCase() === 'allgemein') ??
    kategorien[0] ??
    null
  );
}

/**
 * Erzeugt einen Antwortentwurf. Wirft nie - bei einem Ausfall entsteht die
 * Vorlage aus dem passendsten Szenario.
 */
export async function erzeugeEntwurf(
  profil: Profil,
  szenarien: Szenario[],
  kategorien: Kategorie[],
  mail: EingehendeMail
): Promise<Entwurfsergebnis> {
  if (!config.ai.istKonfiguriert) {
    return vorlageAusSzenario(
      szenarien,
      kategorien,
      mail,
      'Kein GEMINI_API_KEY hinterlegt - Vorlage aus dem passendsten Szenario verwendet.'
    );
  }

  let ergebnis: { category?: string; scenarioId?: string; draft?: string; confidence?: number };
  try {
    ergebnis = await rufeGemini(entwurfPrompt(profil, szenarien, kategorien, mail), {
      schema: ENTWURF_SCHEMA,
    });
  } catch (fehler) {
    const grund = wiederholbar(fehler)
      ? 'Gemini war nicht erreichbar oder das Limit war erschöpft - Vorlage aus dem passendsten Szenario verwendet.'
      : `Gemini-Fehler (${(fehler as Error).message}) - Vorlage aus dem passendsten Szenario verwendet.`;
    return vorlageAusSzenario(szenarien, kategorien, mail, grund);
  }

  const entwurf = normalisiereModelltext(ergebnis.draft);
  if (!entwurf) {
    return vorlageAusSzenario(
      szenarien,
      kategorien,
      mail,
      'Gemini hat einen leeren Entwurf geliefert - Vorlage aus dem Szenario verwendet.'
    );
  }

  const kategorie = findeKategorie(kategorien, ergebnis.category);
  const szenarioId =
    ergebnis.scenarioId &&
    ergebnis.scenarioId !== 'null' &&
    szenarien.some((s) => s.id === ergebnis.scenarioId)
      ? ergebnis.scenarioId
      : null;

  return {
    categoryId: kategorie?.id ?? null,
    categoryName: kategorie?.name ?? null,
    scenarioId: szenarioId,
    // Signatur bewusst hier und nicht im Prompt: So bleibt sie exakt so, wie
    // der Nutzer sie eingegeben hat.
    draft: mitSignatur(entwurf, profil.signature),
    aiGenerated: true,
    note: null,
    confidence: typeof ergebnis.confidence === 'number' ? ergebnis.confidence : null,
  };
}

/**
 * Erzeugt einen Entwurf neu - fuer den "Neu generieren"-Knopf.
 *
 * Hier duerfen Fehler durchschlagen: Der Nutzer hat die Aktion bewusst
 * ausgeloest und will die Fehlermeldung sehen, statt stillschweigend eine
 * Vorlage zu bekommen.
 */
export async function erzeugeEntwurfNeu(
  profil: Profil,
  szenarien: Szenario[],
  kategorien: Kategorie[],
  mail: EingehendeMail
): Promise<Omit<Entwurfsergebnis, 'note'>> {
  const ergebnis = await rufeGemini<{
    category?: string;
    scenarioId?: string;
    draft?: string;
    confidence?: number;
  }>(entwurfPrompt(profil, szenarien, kategorien, mail), { schema: ENTWURF_SCHEMA });

  const kategorie = findeKategorie(kategorien, ergebnis.category);

  return {
    categoryId: kategorie?.id ?? null,
    categoryName: kategorie?.name ?? null,
    scenarioId:
      ergebnis.scenarioId &&
      ergebnis.scenarioId !== 'null' &&
      szenarien.some((s) => s.id === ergebnis.scenarioId)
        ? ergebnis.scenarioId
        : null,
    draft: mitSignatur(normalisiereModelltext(ergebnis.draft), profil.signature),
    aiGenerated: true,
    confidence: typeof ergebnis.confidence === 'number' ? ergebnis.confidence : null,
  };
}

/** Prueft Schluessel und Modell. */
export async function testeVerbindung(): Promise<{ ok: boolean; model?: string; error?: string }> {
  if (!config.ai.istKonfiguriert) {
    return { ok: false, error: 'GEMINI_API_KEY ist nicht hinterlegt.' };
  }

  try {
    const antwort = await holeClient().models.generateContent({
      model: config.ai.model,
      contents: 'Antworte mit genau einem Wort: bereit',
      // 512 statt eines knappen Werts: Die aktuellen Modelle rechnen ihre
      // internen Denk-Tokens mit ein und liefern sonst eine leere Antwort.
      config: { maxOutputTokens: 512, temperature: 0 },
    });
    return { ok: true, model: config.ai.model, ...(antwort.text ? {} : {}) };
  } catch (fehler) {
    let hinweis = (fehler as Error).message;

    if (/API key not valid|API_KEY_INVALID/i.test(hinweis)) {
      hinweis =
        'Der GEMINI_API_KEY wird von Google abgelehnt. Bitte unter https://aistudio.google.com/apikey pruefen.';
    } else if (/no longer available/i.test(hinweis)) {
      hinweis = `Google hat das Modell "${config.ai.model}" fuer neue Schluessel abgeschaltet. Bitte GEMINI_MODEL auf ein aktuelles Modell setzen, z.B. gemini-3.6-flash.`;
    } else if (/not found|NOT_FOUND/i.test(hinweis)) {
      hinweis = `Das Modell "${config.ai.model}" ist fuer diesen Schluessel nicht verfuegbar. GEMINI_MODEL anpassen.`;
    } else if (/quota|RESOURCE_EXHAUSTED|429/i.test(hinweis)) {
      hinweis =
        'Das Kontingent fuer dieses Modell ist erschoepft. Im kostenlosen Tarif setzt Google ein Limit - in ein paar Minuten erneut versuchen.';
    }

    return { ok: false, error: hinweis };
  }
}
