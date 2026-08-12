/**
 * GET /api/settings   Profil und Systemzustand
 * PUT /api/settings   Einstellungen aendern
 *
 * Das Profil enthaelt alles, was die KI zum Schreiben braucht - Tonfall,
 * Signatur, Markenname - sowie die Stellschrauben der Relevanzpruefung.
 */

import { geschuetzt } from '../../_lib/handler.js';
import { protokolliere } from '../../_lib/audit.js';
import { einstellungenSchema, pruefe } from '../../_lib/validate.js';
import { config, verfuegbareAnbieter } from '../../_lib/config.js';
import type { Profil } from '../../_services/typen.js';

function antwort(profil: Profil) {
  return {
    user: {
      id: profil.id,
      email: profil.email,
      setup_completed: profil.setup_completed,
      brand_name: profil.brand_name,
      tone: profil.tone,
      custom_tone: profil.custom_tone,
      signature: profil.signature,
      business_context: profil.business_context,
      blocked_senders: profil.blocked_senders ?? [],
      relevance_filter_enabled: profil.relevance_filter_enabled,
      auto_refresh_enabled: profil.auto_refresh_enabled,
      auto_refresh_interval: profil.auto_refresh_interval,
      last_sync_at: profil.last_sync_at,
    },
    system: {
      version: '2.0.0',
      aiModel: config.ai.model,
      aiTriageModel: config.ai.triageModel,
      aiConfigured: config.ai.istKonfiguriert,
      providers: verfuegbareAnbieter(),
      // Der Abruf laeuft in der Cloud ueber einen externen Cron-Dienst, nicht
      // ueber einen Zeitplan im Prozess. Die Oberflaeche soll das erklaeren
      // koennen, statt ein Intervall zu versprechen, das sie nicht steuert.
      cronExtern: true,
    },
  };
}

export default geschuetzt({ methoden: ['GET', 'PUT'] }, async ({ db, req, user }) => {
  if (req.method === 'GET') {
    const { data } = await db.from('profiles').select('*').eq('id', user.id).single();
    return antwort(data as Profil);
  }

  const daten = pruefe(einstellungenSchema, req.body ?? {});

  // Nur uebergebene Felder anfassen - ein undefined wuerde sonst einen Wert
  // ueberschreiben, den der Nutzer gar nicht bearbeitet hat.
  const aenderung: Record<string, unknown> = {};
  for (const [schluessel, wert] of Object.entries(daten)) {
    if (wert !== undefined) aenderung[schluessel] = wert;
  }

  const { data, error } = await db
    .from('profiles')
    .update(aenderung)
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw new Error(`Einstellungen konnten nicht gespeichert werden: ${error.message}`);

  await protokolliere({
    userId: user.id,
    action: 'settings.update',
    details: { felder: Object.keys(aenderung) },
  });

  return { ...antwort(data as Profil), message: 'Einstellungen gespeichert.' };
});
