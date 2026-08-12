/**
 * Gmail ueber die offizielle API (OAuth2).
 *
 * Ablauf der Anmeldung:
 *   1. anmeldeUrl()   -> Nutzer wird zu Google weitergeleitet
 *   2. loeseCodeEin() -> Tokenset wird verschluesselt gespeichert
 *   3. Danach erneuert der googleapis-Client das Access-Token selbst; das
 *      "tokens"-Ereignis liefert die aktualisierten Werte zum Speichern.
 *
 * Wichtig: Google gibt das Refresh-Token nur beim allerersten Consent heraus.
 * Deshalb wird prompt=consent angefordert - sonst steht man nach einem
 * versehentlichen erneuten Verbinden ohne Refresh-Token da.
 */

import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';

import { config } from '../_lib/config.js';
import { ReauthRequiredError, ApiError } from '../_lib/errors.js';
import { decryptJson, encryptJson } from '../_lib/crypto.js';
import { adresse, anzeigename, antwortBetreff, htmlZuText } from '../_lib/text.js';
import type { Nachricht, Postfach, Verbindungstest } from './typen.js';

/** Wird aufgerufen, wenn Google ein erneuertes Tokenset liefert. */
export type TokenSpeicher = (postfachId: string, verschluesselt: string) => Promise<void>;

function pruefeKonfiguration(): void {
  if (!config.google.istKonfiguriert) {
    throw ApiError.badRequest(
      'Gmail ist nicht eingerichtet. GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET fehlen in den Umgebungsvariablen.'
    );
  }
}

function neuerClient() {
  pruefeKonfiguration();
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/** Baut die Google-Zustimmungs-URL. */
export function anmeldeUrl(state: string): string {
  return neuerClient().generateAuthUrl({
    access_type: 'offline', // liefert ein Refresh-Token
    prompt: 'consent', // erzwingt die Herausgabe auch bei erneuter Anmeldung
    // Kopie, weil die Konfiguration als "as const" schreibgeschuetzt ist und
    // googleapis eine veraenderbare Liste erwartet.
    scope: [...config.google.scopes],
    state,
    include_granted_scopes: true,
  });
}

/** Tauscht den Authorization-Code gegen ein Tokenset. */
export async function loeseCodeEin(code: string): Promise<{
  tokens: Record<string, unknown>;
  emailAddress: string;
}> {
  const client = neuerClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw ApiError.badRequest(
      'Google hat kein Refresh-Token geliefert. Bitte den Zugriff unter ' +
        'https://myaccount.google.com/permissions entfernen und erneut verbinden.'
    );
  }

  client.setCredentials(tokens);
  const profil = await google.gmail({ version: 'v1', auth: client }).users.getProfile({
    userId: 'me',
  });

  return {
    tokens: tokens as Record<string, unknown>,
    emailAddress: String(profil.data.emailAddress ?? '').toLowerCase(),
  };
}

/** Liefert einen authentifizierten Client; erneuerte Tokens werden gespeichert. */
function clientFuer(postfach: Postfach, speichere: TokenSpeicher): gmail_v1.Gmail {
  const client = neuerClient();

  let tokens: Record<string, unknown> | null;
  try {
    tokens = decryptJson<Record<string, unknown>>(postfach.oauth_token);
  } catch (fehler) {
    throw new ReauthRequiredError((fehler as Error).message);
  }
  if (!tokens) {
    throw new ReauthRequiredError('Fuer dieses Postfach sind keine Zugangsdaten gespeichert.');
  }

  client.setCredentials(tokens);

  // googleapis erneuert das Access-Token selbsttaetig und meldet das Ergebnis
  // hier. Das Refresh-Token fehlt in dieser Meldung meist - deshalb mergen wir.
  client.on('tokens', (frisch) => {
    const zusammen = { ...tokens, ...frisch };
    if (!zusammen.refresh_token && tokens.refresh_token) {
      zusammen.refresh_token = tokens.refresh_token as string;
    }
    const verschluesselt = encryptJson(zusammen);
    if (verschluesselt) {
      // Bewusst ohne await: Das Ereignis ist synchron, und ein fehlgeschlagenes
      // Speichern darf den laufenden Abruf nicht abbrechen - beim naechsten
      // Lauf wird ohnehin neu erneuert.
      void speichere(postfach.id, verschluesselt).catch(() => undefined);
    }
  });

  return google.gmail({ version: 'v1', auth: client });
}

/** Uebersetzt Google-Fehler in unsere Fehlertypen. */
function uebersetze(fehler: unknown): Error {
  const f = fehler as { response?: { status?: number; data?: { error?: string } }; code?: number; message?: string };
  const status = f?.response?.status ?? f?.code;
  const grund = f?.response?.data?.error;

  if (status === 401 || grund === 'invalid_grant' || f?.message?.includes('invalid_grant')) {
    return new ReauthRequiredError(
      'Die Google-Anmeldung ist abgelaufen oder wurde widerrufen. Bitte das Postfach neu verbinden.\n\n' +
        'Passiert das etwa jede Woche, liegt es am Veroeffentlichungsstatus: Steht die App in der ' +
        'Google Cloud Console unter "OAuth consent screen" auf "Testing", laesst Google die ' +
        'Zugangsdaten nach 7 Tagen verfallen. Ein Umschalten auf "In production" behebt das dauerhaft.'
    );
  }
  if (status === 403) {
    return new Error(
      'Google verweigert den Zugriff (403). Ist die Gmail API in der Cloud Console aktiviert?'
    );
  }
  if (status === 429) {
    return new Error('Google-Rate-Limit erreicht. Der naechste Abruf versucht es erneut.');
  }
  return fehler instanceof Error ? fehler : new Error(String(fehler));
}

/** Sucht einen Header unabhaengig von Gross-/Kleinschreibung. */
function header(kopf: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
  return kopf?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/** Holt Text und HTML aus der verschachtelten MIME-Struktur. */
function inhalt(teil: gmail_v1.Schema$MessagePart | undefined): { text: string; html: string } {
  const ergebnis = { text: '', html: '' };
  if (!teil) return ergebnis;

  const gehe = (p: gmail_v1.Schema$MessagePart) => {
    const daten = p.body?.data;
    if (daten) {
      const dekodiert = Buffer.from(daten, 'base64url').toString('utf8');
      if (p.mimeType === 'text/plain' && !ergebnis.text) ergebnis.text = dekodiert;
      else if (p.mimeType === 'text/html' && !ergebnis.html) ergebnis.html = dekodiert;
    }
    for (const kind of p.parts ?? []) gehe(kind);
  };

  gehe(teil);
  return ergebnis;
}

/**
 * Holt Nachrichten, die seit `seit` eingegangen sind.
 *
 * Bewusst NICHT nach Lesestatus: Wer seine Mails zwischendurch am Handy
 * ansieht, hat sie beim naechsten Abruf laengst gelesen - die App wuerde genau
 * die Kundenanfragen verpassen, die den Nutzer interessiert haben. Welche Mail
 * bereits verarbeitet ist, weiss die App aus ihrer eigenen Datenbank.
 */
export async function holeNachrichten(
  postfach: Postfach,
  limit: number,
  seit: Date,
  speichere: TokenSpeicher
): Promise<Nachricht[]> {
  const gmail = clientFuer(postfach, speichere);

  try {
    // Gmail kennt bei "after:" nur Sekundengenauigkeit als Unix-Zeit.
    const ab = Math.floor(seit.getTime() / 1000);
    const liste = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox -from:me -category:promotions -category:social after:${ab}`,
      maxResults: limit,
    });

    const ergebnis: Nachricht[] = [];

    for (const verweis of liste.data.messages ?? []) {
      if (!verweis.id) continue;

      const voll = await gmail.users.messages.get({ userId: 'me', id: verweis.id, format: 'full' });
      const kopf = voll.data.payload?.headers ?? undefined;
      const vonRoh = header(kopf, 'From') ?? '';
      const koerper = inhalt(voll.data.payload ?? undefined);

      ergebnis.push({
        messageId: voll.data.id!,
        threadId: voll.data.threadId ?? null,
        rfcMessageId: header(kopf, 'Message-ID'),
        references: header(kopf, 'References'),
        listUnsubscribe: header(kopf, 'List-Unsubscribe'),
        replyTo: adresse(header(kopf, 'Reply-To') ?? '') || null,
        from: adresse(vonRoh),
        fromName: anzeigename(vonRoh) || null,
        to: adresse(header(kopf, 'To') ?? postfach.email_address),
        subject: header(kopf, 'Subject') ?? '(kein Betreff)',
        text: koerper.text || htmlZuText(koerper.html),
        html: koerper.html || null,
        receivedAt: voll.data.internalDate
          ? new Date(Number(voll.data.internalDate)).toISOString()
          : new Date().toISOString(),
      });
    }

    return ergebnis;
  } catch (fehler) {
    throw uebersetze(fehler);
  }
}

/**
 * Kodiert einen Header-Wert RFC-2047-konform, falls er Nicht-ASCII enthaelt.
 * Ohne das landen Umlaute im Betreff als Zeichensalat beim Empfaenger.
 */
function kodiereHeader(wert: string): string {
  const text = String(wert ?? '');
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** Sendet eine Antwort im richtigen Thread. */
export async function sendeAntwort(
  postfach: Postfach,
  entwurf: {
    to_email: string;
    subject: string | null;
    body_draft: string | null;
    thread_id: string | null;
    in_reply_to: string | null;
    references_hdr: string | null;
  },
  speichere: TokenSpeicher
): Promise<{ providerMessageId: string | null }> {
  const gmail = clientFuer(postfach, speichere);

  const zeilen = [
    `From: ${postfach.email_address}`,
    `To: ${entwurf.to_email}`,
    `Subject: ${kodiereHeader(antwortBetreff(entwurf.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];

  // Diese beiden Header sorgen dafuer, dass die Antwort im Mailprogramm der
  // Kundin unter der urspruenglichen Nachricht einsortiert wird.
  if (entwurf.in_reply_to) {
    zeilen.push(`In-Reply-To: ${entwurf.in_reply_to}`);
    const refs = entwurf.references_hdr
      ? `${entwurf.references_hdr} ${entwurf.in_reply_to}`
      : entwurf.in_reply_to;
    zeilen.push(`References: ${refs}`);
  }

  const raw = Buffer.from(
    `${zeilen.join('\r\n')}\r\n\r\n${Buffer.from(entwurf.body_draft ?? '', 'utf8').toString('base64')}`,
    'utf8'
  ).toString('base64url');

  try {
    const antwort = await gmail.users.messages.send({
      userId: 'me',
      requestBody: entwurf.thread_id ? { raw, threadId: entwurf.thread_id } : { raw },
    });
    return { providerMessageId: antwort.data.id ?? null };
  } catch (fehler) {
    throw uebersetze(fehler);
  }
}

/** Kurzer Verbindungstest fuer die Kontoliste. */
export async function testeVerbindung(
  postfach: Postfach,
  speichere: TokenSpeicher
): Promise<Verbindungstest> {
  try {
    await clientFuer(postfach, speichere).users.getProfile({ userId: 'me' });
    return { ok: true };
  } catch (fehler) {
    const uebersetzt = uebersetze(fehler);
    return {
      ok: false,
      error: uebersetzt.message,
      needsReauth: uebersetzt instanceof ReauthRequiredError,
    };
  }
}
