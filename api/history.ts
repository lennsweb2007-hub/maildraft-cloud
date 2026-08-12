/**
 * GET /api/history  - Versandhistorie
 *
 * Sortierbar nach Datum, Kategorie und Empfaenger, mit Suche und Zeitraum.
 * Die Eintraege sind unveraenderlich: Was einmal beim Kunden angekommen ist,
 * darf nachtraeglich nicht mehr bearbeitet werden - sonst waere die Historie
 * als Nachweis wertlos. Entsprechend erlaubt die Zugriffsregel hier nur Lesen.
 */

import { z } from 'zod';

import { geschuetzt } from './_lib/handler.js';
import { pruefe, zahlAusQuery } from './_lib/validate.js';

const SORTIERUNG: Record<string, string> = {
  date: 'sent_at',
  category: 'category_id',
  recipient: 'to_email',
  subject: 'subject',
};

const schema = z.object({
  categoryId: z.string().uuid().optional(),
  sort: z.enum(['date', 'category', 'recipient', 'subject']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: zahlAusQuery(50, 1, 200),
  offset: zahlAusQuery(0, 0, 100_000),
});

export default geschuetzt({ methoden: ['GET'] }, async ({ db, req }) => {
  const p = pruefe(schema, req.query);

  let abfrage = db
    .from('sent_emails')
    .select('*, categories ( name, color )', { count: 'exact' });

  if (p.categoryId) abfrage = abfrage.eq('category_id', p.categoryId);
  if (p.search) {
    const sauber = p.search.replace(/[,()]/g, ' ');
    abfrage = abfrage.or(`subject.ilike.%${sauber}%,to_email.ilike.%${sauber}%`);
  }
  // Der Tag "bis" soll vollstaendig enthalten sein.
  if (p.from) abfrage = abfrage.gte('sent_at', `${p.from}T00:00:00.000Z`);
  if (p.to) abfrage = abfrage.lte('sent_at', `${p.to}T23:59:59.999Z`);

  const spalte = SORTIERUNG[p.sort] ?? 'sent_at';
  abfrage = abfrage
    .order(spalte, { ascending: p.order === 'asc', nullsFirst: false })
    .range(p.offset, p.offset + p.limit - 1);

  const { data, error, count } = await abfrage;
  if (error) throw new Error(`Historie konnte nicht geladen werden: ${error.message}`);

  const items = (data ?? []).map((zeile) => {
    const z = zeile as Record<string, unknown> & {
      categories?: { name: string; color: string } | null;
    };
    const { categories, ...rest } = z;
    return {
      ...rest,
      category_name: categories?.name ?? null,
      category_color: categories?.color ?? null,
    };
  });

  return { items, total: count ?? items.length, limit: p.limit, offset: p.offset };
});
