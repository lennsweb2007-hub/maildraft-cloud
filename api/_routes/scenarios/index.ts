/**
 * Szenarien - die Beispielantworten, an denen sich die KI orientiert.
 *
 * GET    /api/scenarios          alle
 * POST   /api/scenarios          neu
 * PUT    /api/scenarios?id=...   aendern
 * DELETE /api/scenarios?id=...   loeschen
 *
 * Der wirksamste Hebel fuer die Qualitaet der Entwuerfe: Wenn Antworten
 * regelmaessig danebenliegen, liegt es fast immer hier und nicht am Tonfall.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { ApiError } from '../../_lib/errors.js';
import { protokolliere } from '../../_lib/audit.js';
import { pruefe, szenarioSchema, uuid } from '../../_lib/validate.js';

export default geschuetzt(
  { methoden: ['GET', 'POST', 'PUT', 'DELETE'] },
  async ({ db, req, user }) => {
    if (req.method === 'GET') {
      const { data } = await db.from('scenarios').select('*').order('created_at');
      return { items: data ?? [] };
    }

    if (req.method === 'POST') {
      const daten = pruefe(szenarioSchema, req.body ?? {});

      if (daten.category_id) {
        const { data: kategorie } = await db
          .from('categories')
          .select('id')
          .eq('id', daten.category_id)
          .maybeSingle();
        if (!kategorie) throw ApiError.badRequest('Die gewaehlte Kategorie existiert nicht.');
      }

      const { data, error } = await db
        .from('scenarios')
        .insert({ ...daten, user_id: user.id })
        .select()
        .single();

      if (error) throw new Error(`Szenario konnte nicht gespeichert werden: ${error.message}`);

      await protokolliere({
        userId: user.id,
        action: 'scenario.create',
        resourceType: 'scenario',
        resourceId: data.id,
      });

      return { scenario: data, message: 'Szenario gespeichert.' };
    }

    const id = pruefe(uuid, req.query.id);

    const { data: vorhanden } = await db.from('scenarios').select('id, title').eq('id', id).maybeSingle();
    if (!vorhanden) throw ApiError.notFound('Dieses Szenario existiert nicht.');

    if (req.method === 'PUT') {
      const daten = pruefe(szenarioSchema.partial(), req.body ?? {});

      const aenderung: Record<string, unknown> = {};
      for (const [schluessel, wert] of Object.entries(daten)) {
        if (wert !== undefined) aenderung[schluessel] = wert;
      }

      const { data, error } = await db
        .from('scenarios')
        .update(aenderung)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(`Szenario konnte nicht gespeichert werden: ${error.message}`);

      await protokolliere({
        userId: user.id,
        action: 'scenario.update',
        resourceType: 'scenario',
        resourceId: id,
      });

      return { scenario: data, message: 'Szenario aktualisiert.' };
    }

    // DELETE - bereits erstellte Entwuerfe bleiben unveraendert, die
    // Fremdschluesselregel setzt dort nur die Zuordnung auf NULL.
    await db.from('scenarios').delete().eq('id', id);

    await protokolliere({
      userId: user.id,
      action: 'scenario.delete',
      resourceType: 'scenario',
      resourceId: id,
    });

    return { message: `Szenario "${vorhanden.title}" wurde geloescht.` };
  }
);
