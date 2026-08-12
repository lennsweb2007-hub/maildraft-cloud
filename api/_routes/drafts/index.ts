/**
 * GET /api/drafts  - Liste der Entwuerfe
 *
 * Filter, Sortierung und Suche wie in der lokalen Fassung. Die Zaehler pro
 * Status kommen mit, damit die Oberflaeche die Reiterbeschriftung
 * ("Offen 12", "Aussortiert 80") ohne zweite Anfrage fuellen kann.
 *
 * Row Level Security greift ueber den Nutzer-Zugang - die Abfrage kann keine
 * fremden Zeilen sehen. Der zusaetzliche Filter auf user_id waere reine
 * Doppelung und bleibt deshalb weg.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { flach } from '../../_lib/relationen.js';
import { draftListeSchema, pruefe } from '../../_lib/validate.js';

/** Erlaubte Sortierfelder - schuetzt vor Injektion ueber Query-Parameter. */
const SORTIERUNG: Record<string, string> = {
  date: 'received_at',
  created: 'created_at',
  category: 'category_id',
  sender: 'from_email',
  subject: 'subject',
};

/** Felder, die die Liste braucht. Der Volltext bleibt der Detailansicht vorbehalten. */
const FELDER = `
  id, message_id, from_email, from_name, to_email, subject,
  body_draft, category_id, scenario_id, ai_generated, ai_note,
  relevance_kind, relevance_reason, relevance_confidence,
  status, send_error, received_at, created_at, sent_at,
  categories ( name, color, icon ),
  email_accounts ( email_address, provider )
`;

export default geschuetzt({ methoden: ['GET'] }, async ({ db, req }) => {
  const p = pruefe(draftListeSchema, req.query);

  let abfrage = db.from('drafts').select(FELDER, { count: 'exact' });

  if (p.status !== 'all') abfrage = abfrage.eq('status', p.status);
  if (p.categoryId) abfrage = abfrage.eq('category_id', p.categoryId);
  if (p.accountId) abfrage = abfrage.eq('email_account_id', p.accountId);
  if (p.search) {
    // or() erwartet die Bedingungen als Zeichenkette; Kommas und Klammern im
    // Suchbegriff wuerden sie zerlegen, deshalb werden sie entfernt.
    const sauber = p.search.replace(/[,()]/g, ' ');
    abfrage = abfrage.or(
      `subject.ilike.%${sauber}%,from_email.ilike.%${sauber}%,from_name.ilike.%${sauber}%`
    );
  }

  const spalte = SORTIERUNG[p.sort] ?? 'received_at';
  abfrage = abfrage
    .order(spalte, { ascending: p.order === 'asc', nullsFirst: false })
    .range(p.offset, p.offset + p.limit - 1);

  const { data, error, count } = await abfrage;
  if (error) throw new Error(`Entwuerfe konnten nicht geladen werden: ${error.message}`);

  // Zaehler pro Status fuer die Reiterbeschriftung.
  const { data: alle } = await db.from('drafts').select('status');
  const zaehler = { pending: 0, sent: 0, deleted: 0, ignored: 0 };
  for (const zeile of alle ?? []) {
    const s = (zeile as { status: keyof typeof zaehler }).status;
    if (s in zaehler) zaehler[s] += 1;
  }

  // Die verschachtelten Beziehungen flach machen - die Oberflaeche erwartet
  // category_name und account_email direkt am Objekt.
  const items = (data ?? []).map((zeile) => flach(zeile as unknown as Record<string, unknown>));

  return { items, total: count ?? items.length, counts: zaehler };
});
