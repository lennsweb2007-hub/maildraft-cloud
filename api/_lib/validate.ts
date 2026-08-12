/**
 * Eingabepruefung mit zod.
 *
 * Jeder Wert, der von aussen kommt, laeuft hier durch - Anfragekoerper wie
 * Query-Parameter. Zwei Gruende: Ein falscher Typ soll eine verstaendliche
 * deutsche Meldung erzeugen statt eines Datenbankfehlers, und die Schemata
 * sind zugleich die Dokumentation dessen, was ein Endpunkt akzeptiert.
 */

import { z } from 'zod';
import { ApiError } from './errors.js';

/**
 * Prueft einen Wert und wirft bei Verstoss einen ApiError mit lesbarer
 * Meldung. zod nennt den Pfad des fehlerhaften Feldes - der gehoert in die
 * Meldung, sonst raetselt man, welches von zehn Feldern gemeint ist.
 */
export function pruefe<T extends z.ZodTypeAny>(schema: T, wert: unknown): z.infer<T> {
  const ergebnis = schema.safeParse(wert);
  if (ergebnis.success) return ergebnis.data;

  const meldungen = ergebnis.error.issues.map((issue) => {
    const pfad = issue.path.join('.');
    return pfad ? `${pfad}: ${issue.message}` : issue.message;
  });

  throw ApiError.badRequest(meldungen.join(' · '), 'VALIDATION_FAILED');
}

/** Wiederverwendbare Bausteine. */
export const uuid = z.string().uuid('keine gueltige Kennung');
export const email = z.string().trim().toLowerCase().email('keine gueltige E-Mail-Adresse');

/** Ganzzahl aus einem Query-Parameter, der immer als String ankommt. */
export const zahlAusQuery = (standard: number, min: number, max: number) =>
  z
    .union([z.string(), z.number(), z.undefined()])
    .transform((v) => (v === undefined || v === '' ? standard : Number(v)))
    .pipe(z.number().int().min(min).max(max));

// ---------------------------------------------------------------------------
//  Entwuerfe
// ---------------------------------------------------------------------------

export const draftListeSchema = z.object({
  status: z.enum(['pending', 'sent', 'deleted', 'ignored', 'all']).default('pending'),
  categoryId: uuid.optional(),
  accountId: uuid.optional(),
  sort: z.enum(['date', 'created', 'category', 'sender', 'subject']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
  limit: zahlAusQuery(100, 1, 500),
  offset: zahlAusQuery(0, 0, 100_000),
});

export const draftAendernSchema = z.object({
  subject: z.string().max(500).optional(),
  body_draft: z.string().trim().min(1, 'Der Entwurfstext darf nicht leer sein.').max(50_000).optional(),
  category_id: uuid.nullable().optional(),
});

export const draftSendenSchema = z.object({
  subject: z.string().max(500).optional(),
  body_draft: z.string().trim().min(1, 'Ein leerer Entwurf kann nicht versendet werden.').max(50_000).optional(),
});

// ---------------------------------------------------------------------------
//  Postfaecher
// ---------------------------------------------------------------------------

export const imapKontoSchema = z.object({
  email_address: email,
  display_name: z.string().trim().max(120).optional(),
  password: z.string().min(1, 'Das Passwort wird benoetigt.').max(500),
  imap_host: z.string().trim().min(3, 'Der IMAP-Server wird benoetigt.').max(255),
  imap_port: z.coerce.number().int().min(1).max(65535).default(993),
  imap_user: z.string().trim().max(255).optional(),
  smtp_host: z.string().trim().max(255).optional(),
  smtp_port: z.coerce.number().int().min(1).max(65535).default(587),
});

// ---------------------------------------------------------------------------
//  Szenarien und Kategorien
// ---------------------------------------------------------------------------

export const szenarioSchema = z.object({
  title: z.string().trim().min(1, 'Ein Titel wird benoetigt.').max(120),
  trigger_keywords: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) => {
      const liste = Array.isArray(v) ? v : String(v ?? '').split(',');
      return [
        ...new Set(liste.map((k) => String(k).trim().toLowerCase()).filter(Boolean)),
      ].slice(0, 50);
    }),
  example_response: z
    .string()
    .trim()
    .min(20, 'Bitte mindestens ein bis zwei vollstaendige Saetze - daran lernt die KI Ihren Stil.')
    .max(10_000),
  tone: z.enum(['formal', 'freundlich', 'technisch']).nullable().optional(),
  category_id: uuid.nullable().optional(),
  is_active: z.boolean().optional(),
});

export const kategorieSchema = z.object({
  name: z.string().trim().min(1, 'Ein Name wird benoetigt.').max(40),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Die Farbe muss als Hex-Wert angegeben werden, z.B. #3987e5.')
    .optional(),
  icon: z.string().trim().max(30).optional(),
});

// ---------------------------------------------------------------------------
//  Einstellungen
// ---------------------------------------------------------------------------

export const einstellungenSchema = z
  .object({
    brand_name: z.string().trim().min(1, 'Der Markenname darf nicht leer sein.').max(120).optional(),
    tone: z.enum(['formal', 'freundlich', 'technisch', 'custom']).optional(),
    custom_tone: z.string().trim().max(1000).nullable().optional(),
    signature: z.string().max(2000).nullable().optional(),
    business_context: z.string().trim().max(2000).nullable().optional(),
    blocked_senders: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .transform((v) => {
        const liste = Array.isArray(v) ? v : String(v ?? '').split(/[\n,;]/);
        return [
          ...new Set(
            liste
              .map((e) => String(e).trim().toLowerCase().replace(/^@/, ''))
              .filter((e) => e.length > 2 && e.includes('.'))
          ),
        ].slice(0, 200);
      }),
    relevance_filter_enabled: z.boolean().optional(),
    auto_refresh_enabled: z.boolean().optional(),
    auto_refresh_interval: z.coerce
      .number()
      .int()
      .min(300, 'Das Abrufintervall muss mindestens 5 Minuten betragen.')
      .max(86_400, 'Das Abrufintervall darf hoechstens 24 Stunden betragen.')
      .optional(),
    setup_completed: z.boolean().optional(),
  })
  .refine(
    (daten) => daten.tone !== 'custom' || Boolean(daten.custom_tone?.trim()),
    {
      message:
        'Fuer einen eigenen Tonfall muss beschrieben werden, wie die Antworten klingen sollen.',
      path: ['custom_tone'],
    }
  );
