/**
 * Kategorien.
 *
 * GET    /api/categories          alle
 * POST   /api/categories          neu
 * PUT    /api/categories?id=...   umbenennen, Farbe oder Symbol aendern
 * DELETE /api/categories?id=...   loeschen
 *
 * Neue Kategorien bekommen automatisch die naechste freie Farbe aus einer
 * fuer dunkle Oberflaechen geprueften Palette. Die Reihenfolge ist der
 * Mechanismus, der benachbarte Segmente im Diagramm auch bei Rot-Gruen-
 * Schwaeche unterscheidbar haelt - deshalb wird sie nicht umsortiert.
 */

import { geschuetzt } from '../_lib/handler.js';
import { ApiError } from '../_lib/errors.js';
import { protokolliere } from '../_lib/audit.js';
import { kategorieSchema, pruefe, uuid } from '../_lib/validate.js';

const PALETTE = [
  '#3987e5', // blau
  '#d95926', // orange
  '#199e70', // aqua
  '#9085e9', // violett
  '#c98500', // gelb
  '#d55181', // magenta
  '#e66767', // rot
  '#008300', // gruen
];

export default geschuetzt(
  { methoden: ['GET', 'POST', 'PUT', 'DELETE'] },
  async ({ db, req, user }) => {
    if (req.method === 'GET') {
      const { data } = await db
        .from('categories')
        .select('*')
        .order('sort_order')
        .order('name');
      return { items: data ?? [] };
    }

    if (req.method === 'POST') {
      const daten = pruefe(kategorieSchema, req.body ?? {});

      const { data: vorhanden } = await db.from('categories').select('id, name, color, sort_order');

      if ((vorhanden ?? []).some((k) => k.name.toLowerCase() === daten.name.toLowerCase())) {
        throw ApiError.conflict(`Es gibt bereits eine Kategorie mit dem Namen "${daten.name}".`);
      }

      // Naechste noch nicht vergebene Farbe. Erst wenn alle acht belegt sind,
      // wird von vorn begonnen - dann liegen ohnehin so viele Kategorien vor,
      // dass das Diagramm sie zu "Weitere" zusammenfasst.
      const belegt = new Set((vorhanden ?? []).map((k) => k.color?.toLowerCase()));
      const frei = PALETTE.find((f) => !belegt.has(f.toLowerCase()));
      const maxOrder = Math.max(0, ...(vorhanden ?? []).map((k) => k.sort_order ?? 0));

      const { data, error } = await db
        .from('categories')
        .insert({
          user_id: user.id,
          name: daten.name,
          color: daten.color ?? frei ?? PALETTE[belegt.size % PALETTE.length],
          icon: daten.icon ?? 'tag',
          sort_order: maxOrder + 1,
        })
        .select()
        .single();

      if (error) throw new Error(`Kategorie konnte nicht angelegt werden: ${error.message}`);

      await protokolliere({ userId: user.id, action: 'category.create', resourceId: data.id });
      return { category: data, message: 'Kategorie angelegt.' };
    }

    const id = pruefe(uuid, req.query.id);

    const { data: vorhanden } = await db.from('categories').select('*').eq('id', id).maybeSingle();
    if (!vorhanden) throw ApiError.notFound('Diese Kategorie existiert nicht.');

    if (req.method === 'PUT') {
      const daten = pruefe(kategorieSchema.partial(), req.body ?? {});

      if (daten.name) {
        const { data: alle } = await db.from('categories').select('id, name');
        const doppelt = (alle ?? []).find(
          (k) => k.name.toLowerCase() === daten.name!.toLowerCase() && k.id !== id
        );
        if (doppelt) {
          throw ApiError.conflict(`Es gibt bereits eine Kategorie mit dem Namen "${daten.name}".`);
        }
      }

      const aenderung: Record<string, unknown> = {};
      for (const [schluessel, wert] of Object.entries(daten)) {
        if (wert !== undefined) aenderung[schluessel] = wert;
      }

      const { data } = await db.from('categories').update(aenderung).eq('id', id).select().single();
      return { category: data, message: 'Kategorie aktualisiert.' };
    }

    // DELETE
    const { count } = await db.from('categories').select('id', { count: 'exact', head: true });
    if ((count ?? 0) <= 1) {
      throw ApiError.conflict('Die letzte Kategorie kann nicht geloescht werden.');
    }

    // Entwuerfe und Historie bleiben erhalten und rutschen durch die
    // Fremdschluesselregel in "Ohne Kategorie".
    await db.from('categories').delete().eq('id', id);

    await protokolliere({ userId: user.id, action: 'category.delete', resourceId: id });

    return {
      message:
        `Kategorie "${vorhanden.name}" wurde geloescht. Zugeordnete Mails stehen jetzt ` +
        'unter "Ohne Kategorie".',
    };
  }
);
