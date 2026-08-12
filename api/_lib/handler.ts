/**
 * Einheitlicher Rahmen um jeden API-Endpunkt.
 *
 * Nimmt jedem Endpunkt vier Dinge ab, die sonst ueberall wiederholt und
 * irgendwo vergessen wuerden: Methodenpruefung, Anmeldung, Ratenbegrenzung
 * und Fehlerbehandlung. Ein Endpunkt besteht dadurch nur noch aus seiner
 * eigentlichen Aufgabe.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';

import { config, zugangErlaubt } from './config.js';
import { ApiError, zuAntwort } from './errors.js';
import { fuerNutzer, nutzerAusToken } from './supabase.js';
import { pruefeRate } from './rateLimit.js';
import { protokolliere } from './audit.js';
import { geheimnisGleich } from './crypto.js';

export interface Kontext {
  /** Angemeldeter Nutzer. */
  user: { id: string; email: string | null };
  /**
   * Datenbankzugriff im Namen des Nutzers. Row Level Security greift -
   * diese Verbindung kann keine fremden Zeilen sehen, selbst wenn im Code
   * ein Filter fehlt.
   */
  db: SupabaseClient;
  req: VercelRequest;
  res: VercelResponse;
}

type Methode = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Optionen {
  /** Erlaubte HTTP-Methoden. */
  methoden: Methode[];
  /** Name der Aktion fuers Protokoll. Fehlt er, wird nichts protokolliert. */
  aktion?: string;
}

/**
 * Umhuellt einen Endpunkt, der eine Anmeldung voraussetzt.
 */
export function geschuetzt(
  optionen: Optionen,
  fn: (ctx: Kontext) => Promise<unknown>
): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (!optionen.methoden.includes(req.method as Methode)) {
        res.setHeader('Allow', optionen.methoden.join(', '));
        throw new ApiError(405, `Methode ${req.method} ist hier nicht erlaubt.`);
      }

      // --- Anmeldung ---
      const kopf = req.headers.authorization ?? '';
      const jwt = kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
      const user = await nutzerAusToken(jwt);

      if (!user) {
        throw ApiError.unauthorized(
          'Die Sitzung ist abgelaufen oder ungueltig. Bitte die Seite neu laden und erneut anmelden.'
        );
      }

      // --- Freigabeliste ---
      //
      // Die Anmeldung selbst laesst Supabase jeden durchfuehren, der ein
      // Google-Konto hat. Wer die App tatsaechlich benutzen darf, entscheidet
      // sich hier - sonst koennte jeder, der die Adresse kennt, auf dem
      // gemeinsamen Gemini-Kontingent arbeiten.
      if (!zugangErlaubt(user.email)) {
        await protokolliere({
          userId: user.id,
          action: 'auth.denied',
          details: { grund: 'nicht auf der Freigabeliste' },
        });
        throw ApiError.forbidden(
          'Kein Zugang. Diese App ist auf freigegebene Adressen beschraenkt - ' +
            'bitten Sie den Betreiber, Ihre Adresse freizuschalten.'
        );
      }

      // --- Ratenbegrenzung ---
      await pruefeRate(user.id, config.rateLimit.proMinute);

      // --- Eigentliche Arbeit ---
      const ergebnis = await fn({ user, db: fuerNutzer(jwt), req, res });

      // Hat der Endpunkt selbst geantwortet (Weiterleitung, HTML), ist hier
      // nichts mehr zu tun.
      if (res.writableEnded) return;

      if (optionen.aktion) {
        await protokolliere({ userId: user.id, action: optionen.aktion });
      }

      res.status(200).json(ergebnis ?? { ok: true });
    } catch (fehler) {
      const { status, body } = zuAntwort(fehler);
      if (!res.writableEnded) res.status(status).json(body);
    }
  };
}

/**
 * Umhuellt einen Endpunkt ohne Anmeldung - fuer den Cron und die
 * OAuth-Rueckleitung.
 *
 * Der Cron-Schluessel wird als Header erwartet, nicht als Query-Parameter:
 * Query-Strings landen in Server- und Proxy-Protokollen, ein Geheimnis hat
 * dort nichts zu suchen. Verglichen wird zeitkonstant, damit sich der
 * Schluessel nicht ueber die Antwortzeit Zeichen fuer Zeichen erraten laesst.
 */
export function oeffentlich(
  optionen: { methoden: Methode[]; cronGeschuetzt?: boolean },
  fn: (req: VercelRequest, res: VercelResponse) => Promise<unknown>
): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (!optionen.methoden.includes(req.method as Methode)) {
        res.setHeader('Allow', optionen.methoden.join(', '));
        throw new ApiError(405, `Methode ${req.method} ist hier nicht erlaubt.`);
      }

      if (optionen.cronGeschuetzt) {
        const mitgeschickt =
          (req.headers['x-cron-secret'] as string | undefined) ??
          // Vercel Cron schickt stattdessen einen eigenen Header mit.
          (req.headers.authorization === `Bearer ${process.env.CRON_SECRET}` ? config.sync.cronSecret : '');

        if (!mitgeschickt || !geheimnisGleich(mitgeschickt, config.sync.cronSecret)) {
          throw ApiError.unauthorized('Ungueltiges oder fehlendes Cron-Geheimnis.');
        }
      }

      const ergebnis = await fn(req, res);
      if (res.writableEnded) return;
      res.status(200).json(ergebnis ?? { ok: true });
    } catch (fehler) {
      const { status, body } = zuAntwort(fehler);
      if (!res.writableEnded) res.status(status).json(body);
    }
  };
}
