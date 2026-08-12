/**
 * Generische IMAP-/SMTP-Anbindung.
 *
 * Lesen:  imapflow (aktiv gepflegt, moderne TLS-Unterstuetzung, Promise-API)
 * Parsen: mailparser (haendelt MIME, Encodings und Umlaute zuverlaessig)
 * Senden: nodemailer ueber SMTP
 *
 * Verbindungen werden pro Vorgang geoeffnet und garantiert wieder geschlossen.
 * In einer Serverless-Funktion ist das nicht nur sauber, sondern zwingend: Die
 * Instanz verschwindet nach der Antwort, eine offen gelassene Verbindung
 * bliebe beim Mailserver als halboffener Socket haengen.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';

import { decrypt } from '../_lib/crypto.js';
import { ReauthRequiredError } from '../_lib/errors.js';
import { adresse, anzeigename, antwortBetreff, htmlZuText, textZuHtml } from '../_lib/text.js';
import type { Nachricht, Postfach, Verbindungstest } from './typen.js';

/** Bekannte Anbieter - erspart dem Nutzer das Nachschlagen der Servernamen. */
export const VORLAGEN: Record<string, { imap: string; smtp: string }> = {
  'gmail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'googlemail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com' },
  'outlook.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'outlook.de': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'hotmail.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'hotmail.de': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'live.com': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'live.de': { imap: 'outlook.office365.com', smtp: 'smtp.office365.com' },
  'gmx.net': { imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  'gmx.de': { imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  'gmx.at': { imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  'gmx.ch': { imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  'web.de': { imap: 'imap.web.de', smtp: 'smtp.web.de' },
  't-online.de': { imap: 'secureimap.t-online.de', smtp: 'securesmtp.t-online.de' },
  'freenet.de': { imap: 'mx.freenet.de', smtp: 'mx.freenet.de' },
  'ionos.de': { imap: 'imap.ionos.de', smtp: 'smtp.ionos.de' },
  '1und1.de': { imap: 'imap.1und1.de', smtp: 'smtp.1und1.de' },
  'strato.de': { imap: 'imap.strato.de', smtp: 'smtp.strato.de' },
  'mail.de': { imap: 'imap.mail.de', smtp: 'smtp.mail.de' },
  'posteo.de': { imap: 'posteo.de', smtp: 'posteo.de' },
  'mailbox.org': { imap: 'imap.mailbox.org', smtp: 'smtp.mailbox.org' },
  'zoho.com': { imap: 'imap.zoho.eu', smtp: 'smtp.zoho.eu' },
  'yahoo.com': { imap: 'imap.mail.yahoo.com', smtp: 'smtp.mail.yahoo.com' },
  'icloud.com': { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com' },
  'aol.com': { imap: 'imap.aol.com', smtp: 'smtp.aol.com' },
  'fastmail.com': { imap: 'imap.fastmail.com', smtp: 'smtp.fastmail.com' },
};

/** Schlaegt Serverdaten anhand der Mailadresse vor. */
export function schlageVor(mailadresse: string): {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
} | null {
  const domain = String(mailadresse ?? '').split('@').pop()?.toLowerCase();
  const vorlage = domain ? VORLAGEN[domain] : undefined;
  if (!vorlage) return null;

  return { imap_host: vorlage.imap, imap_port: 993, smtp_host: vorlage.smtp, smtp_port: 587 };
}

/**
 * Liefert den Textwert eines Adressfelds.
 *
 * mailparser gibt bei mehreren Empfaengern ein Array zurueck, bei einem
 * einzelnen ein Objekt. Fuer unseren Zweck genuegt der erste Eintrag - die
 * Antwort geht ohnehin an den Absender.
 */
function empfaengertext(feld: AddressObject | AddressObject[] | undefined): string {
  if (!feld) return '';
  return Array.isArray(feld) ? (feld[0]?.text ?? '') : feld.text;
}

/** Entschluesselt die Zugangsdaten eines Postfachs. */
function zugangsdaten(postfach: Postfach): { user: string; pass: string } {
  const passwort = decrypt(postfach.imap_password);
  if (!passwort) throw new Error('Fuer dieses IMAP-Postfach ist kein Passwort gespeichert.');
  return { user: postfach.imap_user || postfach.email_address, pass: passwort };
}

/** Uebersetzt kryptische IMAP-/SMTP-Fehler in verstaendliche Meldungen. */
function uebersetze(fehler: unknown, postfach: Postfach): Error {
  const meldung = String((fehler as Error)?.message ?? fehler);
  const code = (fehler as { code?: string; responseCode?: number })?.code;

  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|535/i.test(meldung) || code === 'AUTHENTICATIONFAILED') {
    return new ReauthRequiredError(
      `Anmeldung bei ${postfach.imap_host ?? 'dem Mailserver'} fehlgeschlagen. ` +
        'Benutzername oder Passwort stimmen nicht. Bei Anbietern mit Zwei-Faktor-Anmeldung ' +
        'wird ein App-Passwort benoetigt, nicht das normale Kennwort.'
    );
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(meldung)) {
    return new Error(`Der Server "${postfach.imap_host}" wurde nicht gefunden. Bitte die Serveradresse pruefen.`);
  }
  if (code === 'ECONNREFUSED') {
    return new Error(`Der Server "${postfach.imap_host}" hat die Verbindung abgelehnt. Stimmt der Port?`);
  }
  if (code === 'ETIMEDOUT' || /timeout/i.test(meldung)) {
    return new Error('Zeitueberschreitung beim Mailserver.');
  }
  if (/certificate|self signed|DEPTH_ZERO/i.test(meldung)) {
    return new Error(
      'Das TLS-Zertifikat des Servers konnte nicht geprueft werden. ' +
        'Bei selbst gehosteten Servern muss ein gueltiges Zertifikat eingerichtet sein.'
    );
  }
  return fehler instanceof Error ? fehler : new Error(meldung);
}

/** Baut eine IMAP-Verbindung auf. */
async function verbinde(postfach: Postfach): Promise<ImapFlow> {
  const { user, pass } = zugangsdaten(postfach);

  const client = new ImapFlow({
    host: postfach.imap_host ?? '',
    port: postfach.imap_port ?? 993,
    secure: postfach.imap_secure !== false,
    auth: { user, pass },
    logger: false, // imapflow wuerde sonst Mailinhalte auf stdout schreiben
    // Kurze Zeitgrenzen: In einer Funktion mit Zeitbudget ist ein haengender
    // Socket teurer als ein zweiter Versuch beim naechsten Lauf.
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
  });

  // Ohne Handler wuerde ein spaeter Socket-Fehler den Prozess beenden.
  client.on('error', () => undefined);

  try {
    await client.connect();
  } catch (fehler) {
    throw uebersetze(fehler, postfach);
  }
  return client;
}

/**
 * Holt Nachrichten aus INBOX, die seit `seit` eingegangen sind.
 *
 * Bewusst nicht nach Lesestatus - Begruendung siehe gmail.ts. IMAP kennt bei
 * SINCE nur Tagesgenauigkeit; die Feinabgrenzung uebernimmt der Aufrufer ueber
 * das Eingangsdatum.
 */
export async function holeNachrichten(
  postfach: Postfach,
  limit: number,
  seit: Date
): Promise<Nachricht[]> {
  const client = await verbinde(postfach);
  const ergebnis: Nachricht[] = [];

  try {
    // getMailboxLock statt mailboxOpen: garantiert die Freigabe auch im Fehlerfall.
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ since: seit }, { uid: true });
      if (!uids || uids.length === 0) return [];

      // Die neuesten zuerst, dann auf das Limit kuerzen.
      const ausgewaehlt = uids.slice(-limit).reverse();

      for await (const nachricht of client.fetch(
        ausgewaehlt,
        { uid: true, source: true, envelope: true, internalDate: true },
        { uid: true }
      )) {
        if (!nachricht.source) continue;

        let geparst: ParsedMail;
        try {
          // Die Typdefinition von mailparser kennt eine Rueckruf-Variante;
          // ohne diese Zusicherung waere der Rueckgabetyp "void & Promise".
          geparst = (await simpleParser(nachricht.source)) as ParsedMail;
        } catch {
          // Eine kaputte Mail darf den ganzen Abruf nicht kippen.
          continue;
        }

        const vonRoh = geparst.from?.value?.[0];
        const vonAdresse = vonRoh?.address ?? adresse(geparst.from?.text ?? '');

        ergebnis.push({
          // Die UID ist innerhalb einer Mailbox stabil und eindeutig.
          messageId: String(nachricht.uid),
          threadId: geparst.messageId ?? String(nachricht.uid),
          rfcMessageId: geparst.messageId ?? null,
          references: Array.isArray(geparst.references)
            ? geparst.references.join(' ')
            : (geparst.references ?? null),
          listUnsubscribe: geparst.headers?.get('list-unsubscribe')
            ? String(geparst.headers.get('list-unsubscribe'))
            : null,
          replyTo: adresse(geparst.replyTo?.text ?? '') || null,
          from: (vonAdresse ?? '').toLowerCase(),
          fromName: vonRoh?.name || anzeigename(geparst.from?.text ?? '') || null,
          // "to" kann mehrere Empfaenger enthalten und ist dann ein Array.
          to: adresse(empfaengertext(geparst.to) || postfach.email_address),
          subject: geparst.subject ?? '(kein Betreff)',
          text: geparst.text ?? htmlZuText(geparst.html || ''),
          html: typeof geparst.html === 'string' ? geparst.html : null,
          receivedAt: new Date(
            geparst.date ?? nachricht.internalDate ?? new Date()
          ).toISOString(),
        });
      }
    } finally {
      lock.release();
    }
  } catch (fehler) {
    throw uebersetze(fehler, postfach);
  } finally {
    // logout() statt close(): verabschiedet sich sauber beim Server.
    await client.logout().catch(() => undefined);
  }

  return ergebnis;
}

/** Erzeugt einen SMTP-Transport. */
function transport(postfach: Postfach) {
  const { user, pass } = zugangsdaten(postfach);
  const port = postfach.smtp_port ?? 587;

  return nodemailer.createTransport({
    host: postfach.smtp_host ?? postfach.imap_host ?? '',
    port,
    // Port 465 spricht von Anfang an TLS, 587 startet im Klartext und
    // wechselt per STARTTLS.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 25_000,
  });
}

/** Sendet die Antwort per SMTP. */
export async function sendeAntwort(
  postfach: Postfach,
  entwurf: {
    to_email: string;
    subject: string | null;
    body_draft: string | null;
    in_reply_to: string | null;
    references_hdr: string | null;
  }
): Promise<{ providerMessageId: string | null }> {
  const smtp = transport(postfach);

  try {
    const info = await smtp.sendMail({
      from: postfach.display_name
        ? { name: postfach.display_name, address: postfach.email_address }
        : postfach.email_address,
      to: entwurf.to_email,
      subject: antwortBetreff(entwurf.subject),
      text: entwurf.body_draft ?? '',
      html: textZuHtml(entwurf.body_draft ?? ''),
      // Sorgt fuer die korrekte Einordnung im Mailprogramm der Kundin.
      inReplyTo: entwurf.in_reply_to ?? undefined,
      references: entwurf.references_hdr
        ? `${entwurf.references_hdr} ${entwurf.in_reply_to ?? ''}`.trim()
        : (entwurf.in_reply_to ?? undefined),
    });

    return { providerMessageId: info.messageId ?? null };
  } catch (fehler) {
    throw uebersetze(fehler, postfach);
  } finally {
    smtp.close();
  }
}

/**
 * Prueft IMAP und SMTP. Wird vor dem Speichern eines neuen Postfachs
 * aufgerufen - so scheitert die Einrichtung sofort und nicht erst beim ersten
 * Abruf.
 */
export async function testeVerbindung(postfach: Postfach): Promise<Verbindungstest> {
  let client: ImapFlow | null = null;
  try {
    client = await verbinde(postfach);
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
  } catch (fehler) {
    const uebersetzt = uebersetze(fehler, postfach);
    return {
      ok: false,
      error: uebersetzt.message,
      needsReauth: uebersetzt instanceof ReauthRequiredError,
    };
  } finally {
    await client?.logout().catch(() => undefined);
  }

  const smtp = transport(postfach);
  try {
    await smtp.verify();
  } catch (fehler) {
    const uebersetzt = uebersetze(fehler, postfach);
    return {
      ok: false,
      error: `IMAP funktioniert, aber der Postausgang (SMTP) nicht: ${uebersetzt.message}`,
      needsReauth: uebersetzt instanceof ReauthRequiredError,
    };
  } finally {
    smtp.close();
  }

  return { ok: true };
}
