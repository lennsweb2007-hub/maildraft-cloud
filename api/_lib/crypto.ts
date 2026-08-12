/**
 * Verschluesselung fuer OAuth-Tokens und IMAP-Passwoerter.
 *
 * Verfahren: AES-256-GCM. GCM liefert nicht nur Vertraulichkeit, sondern auch
 * Integritaet - ein manipulierter Datenbankeintrag faellt beim Entschluesseln
 * sofort auf, statt stillschweigend Muell zu liefern.
 *
 * In der Cloud wiegt das schwerer als lokal: Die Datenbank liegt bei einem
 * Dienstleister und enthaelt die Zugangsdaten mehrerer Postfaecher. Der
 * Schluessel steht ausschliesslich in den Vercel-Umgebungsvariablen und nie
 * in der Datenbank - wer also nur die Datenbank einsieht, kommt nicht an die
 * Postfaecher.
 */

import crypto from 'node:crypto';
import { config } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 Bit, der von NIST empfohlene Wert fuer GCM
const TAG_LENGTH = 16;
const SALT = 'maildraft-ai::v1';
const PREFIX = 'enc:v1:';

/**
 * Abgeleiteter Schluessel. Wird beim ersten Zugriff berechnet und gehalten -
 * scrypt ist absichtlich langsam, das darf nicht pro Anfrage passieren.
 *
 * In einer Serverless-Umgebung ueberlebt der Zwischenspeicher genau so lange
 * wie die Instanz. Das ist gewollt: Der Schluessel liegt damit nur so lange im
 * Speicher, wie tatsaechlich gearbeitet wird.
 */
let zwischengespeicherterSchluessel: Buffer | null = null;

function schluessel(): Buffer {
  if (zwischengespeicherterSchluessel) return zwischengespeicherterSchluessel;

  const master = config.crypto.masterKey;
  if (master.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY ist zu kurz (mindestens 32 Zeichen, empfohlen 64 Hex-Zeichen). ' +
        'Erzeugen mit: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  zwischengespeicherterSchluessel = crypto.scryptSync(master, SALT, 32);
  return zwischengespeicherterSchluessel;
}

/**
 * Verschluesselt einen String.
 * Format: enc:v1:<iv>:<authTag>:<ciphertext>, alle Teile base64.
 */
export function encrypt(klartext: string | null | undefined): string | null {
  if (klartext === null || klartext === undefined || klartext === '') return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, schluessel(), iv, { authTagLength: TAG_LENGTH });
  const verschluesselt = Buffer.concat([cipher.update(String(klartext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${verschluesselt.toString('base64')}`;
}

/**
 * Entschluesselt einen mit encrypt() erzeugten String.
 * @throws wenn der Wert manipuliert wurde oder der Schluessel nicht passt
 */
export function decrypt(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined || wert === '') return null;

  const roh = String(wert);
  if (!roh.startsWith(PREFIX)) {
    throw new Error('Wert ist nicht im erwarteten Verschluesselungsformat.');
  }

  const teile = roh.slice(PREFIX.length).split(':');
  if (teile.length !== 3) {
    throw new Error('Verschluesselter Wert ist beschaedigt (falsche Anzahl Segmente).');
  }

  const [ivB64, tagB64, datenB64] = teile as [string, string, string];

  const decipher = crypto.createDecipheriv(ALGORITHM, schluessel(), Buffer.from(ivB64, 'base64'), {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(datenB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM-Tag stimmt nicht: entweder wurde die Datenbank manipuliert oder der
    // ENCRYPTION_KEY wurde nachtraeglich geaendert.
    throw new Error(
      'Zugangsdaten konnten nicht entschluesselt werden. Vermutlich wurde der ' +
        'ENCRYPTION_KEY geaendert - in dem Fall muessen die Postfaecher neu verbunden werden.'
    );
  }
}

/** Bequemer Wrapper fuer Objekte (OAuth-Tokensets, MSAL-Cache). */
export function encryptJson(obj: unknown): string | null {
  return obj === null || obj === undefined ? null : encrypt(JSON.stringify(obj));
}

/** Gegenstueck zu encryptJson. */
export function decryptJson<T = unknown>(wert: string | null | undefined): T | null {
  const klartext = decrypt(wert);
  return klartext === null ? null : (JSON.parse(klartext) as T);
}

/** Zufaelliges URL-sicheres Token, z.B. fuer den OAuth-State. */
export function zufallsToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Zeitkonstanter Vergleich zweier Geheimnisse.
 *
 * Ein einfaches === bricht beim ersten abweichenden Zeichen ab. Aus der
 * Antwortzeit liesse sich damit Zeichen fuer Zeichen das richtige Geheimnis
 * erraten - fuer den Cron-Schluessel, der von aussen erreichbar ist, ein
 * realistischer Angriff.
 */
export function geheimnisGleich(a: string, b: string): boolean {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
