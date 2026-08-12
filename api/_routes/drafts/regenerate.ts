/**
 * POST /api/drafts/regenerate?id=...  - Entwurf von der KI neu schreiben lassen
 *
 * Anders als beim automatischen Abruf duerfen Fehler hier durchschlagen: Der
 * Nutzer hat die Aktion bewusst ausgeloest und will die Fehlermeldung sehen,
 * statt stillschweigend eine Vorlage zu bekommen.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { ApiError } from '../../_lib/errors.js';
import { protokolliere } from '../../_lib/audit.js';
import { pruefe, uuid } from '../../_lib/validate.js';
import * as gemini from '../../_services/gemini.js';
import type { Kategorie, Profil, Szenario } from '../../_services/typen.js';

export default geschuetzt({ methoden: ['POST'] }, async ({ db, req, user }) => {
  const id = pruefe(uuid, req.query.id);

  const { data: entwurf } = await db.from('drafts').select('*').eq('id', id).maybeSingle();
  if (!entwurf) throw ApiError.notFound('Dieser Entwurf existiert nicht (mehr).');

  if (entwurf.status === 'sent') {
    throw ApiError.conflict('Versendete Nachrichten koennen nicht neu generiert werden.');
  }

  const [{ data: profil }, { data: szenarien }, { data: kategorien }] = await Promise.all([
    db.from('profiles').select('*').eq('id', user.id).single(),
    db.from('scenarios').select('*').eq('is_active', true),
    db.from('categories').select('*').order('sort_order'),
  ]);

  let erzeugt;
  try {
    erzeugt = await gemini.erzeugeEntwurfNeu(
      profil as Profil,
      (szenarien ?? []) as Szenario[],
      (kategorien ?? []) as Kategorie[],
      {
        from: entwurf.from_email as string,
        fromName: entwurf.from_name as string | null,
        subject: entwurf.subject as string,
        text: entwurf.body_original as string | null,
      }
    );
  } catch (fehler) {
    throw ApiError.badGateway(
      `Die KI konnte keinen neuen Entwurf erstellen: ${(fehler as Error).message}`,
      'AI_FAILED'
    );
  }

  // Vorherige Fassung sichern, damit sich die alte zurueckholen laesst.
  if (entwurf.body_draft) {
    const { count } = await db
      .from('draft_versions')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', id);

    await db.from('draft_versions').insert({
      draft_id: id,
      user_id: user.id,
      version_number: (count ?? 0) + 1,
      version_text: entwurf.body_draft as string,
    });
  }

  const { data } = await db
    .from('drafts')
    .update({
      body_draft: erzeugt.draft,
      category_id: erzeugt.categoryId,
      scenario_id: erzeugt.scenarioId,
      ai_generated: true,
      ai_note: null,
    })
    .eq('id', id)
    .select()
    .single();

  await protokolliere({
    userId: user.id,
    action: 'draft.regenerate',
    resourceType: 'draft',
    resourceId: id,
  });

  return { draft: data, message: 'Neuer Entwurf erstellt.' };
});
