/**
 * Ein einzelner Entwurf.
 *
 * GET    /api/drafts/:id            anzeigen
 * PUT    /api/drafts/:id            Betreff, Text und Kategorie aendern
 * DELETE /api/drafts/:id            verwerfen (Soft-Delete)
 * POST   /api/drafts/:id?tat=...    restore | approve | ignore
 *
 * Die Zusatzaktionen laufen ueber einen Query-Parameter statt ueber eigene
 * Dateien: Vercel legt pro Datei eine Funktion an, und vier weitere Funktionen
 * fuer je zwei Zeilen Logik waeren reine Verschwendung - jede haette ihre
 * eigene Kaltstartzeit.
 */

import { geschuetzt } from '../_lib/handler.js';
import { ApiError } from '../_lib/errors.js';
import { protokolliere } from '../_lib/audit.js';
import { draftAendernSchema, pruefe, uuid } from '../_lib/validate.js';
import { alsDienst } from '../_lib/supabase.js';
import * as gemini from '../_services/gemini.js';
import type { Kategorie, Profil, Szenario } from '../_services/typen.js';

/** Lokales Datum als YYYY-MM-DD. */
function heute(datum = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

export default geschuetzt(
  { methoden: ['GET', 'PUT', 'DELETE', 'POST'] },
  async ({ db, req, user }) => {
    const id = pruefe(uuid, req.query.id);

    const { data: entwurf } = await db
      .from('drafts')
      .select('*, categories ( name, color, icon ), email_accounts ( email_address, provider )')
      .eq('id', id)
      .maybeSingle();

    if (!entwurf) throw ApiError.notFound('Dieser Entwurf existiert nicht (mehr).');

    // ---------------------------------------------------------------- GET --
    if (req.method === 'GET') {
      const e = entwurf as Record<string, unknown> & {
        categories?: { name: string; color: string; icon: string } | null;
        email_accounts?: { email_address: string } | null;
      };
      const { categories, email_accounts, ...rest } = e;
      return {
        ...rest,
        category_name: categories?.name ?? null,
        category_color: categories?.color ?? null,
        category_icon: categories?.icon ?? null,
        account_email: email_accounts?.email_address ?? null,
      };
    }

    // ---------------------------------------------------------------- PUT --
    if (req.method === 'PUT') {
      if (entwurf.status === 'sent') {
        throw ApiError.conflict('Bereits versendete Nachrichten koennen nicht mehr geaendert werden.');
      }

      const daten = pruefe(draftAendernSchema, req.body ?? {});

      if (daten.category_id) {
        const { data: kategorie } = await db
          .from('categories')
          .select('id')
          .eq('id', daten.category_id)
          .maybeSingle();
        if (!kategorie) throw ApiError.badRequest('Die gewaehlte Kategorie existiert nicht.');
      }

      // Vorherige Fassung sichern, damit sich eine Bearbeitung zurueckholen laesst.
      if (daten.body_draft !== undefined && entwurf.body_draft) {
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

      const aenderung: Record<string, unknown> = {};
      if (daten.subject !== undefined) aenderung.subject = daten.subject;
      if (daten.body_draft !== undefined) aenderung.body_draft = daten.body_draft;
      if (daten.category_id !== undefined) aenderung.category_id = daten.category_id;

      const { data, error } = await db.from('drafts').update(aenderung).eq('id', id).select().single();
      if (error) throw new Error(`Speichern fehlgeschlagen: ${error.message}`);

      await protokolliere({ userId: user.id, action: 'draft.update', resourceType: 'draft', resourceId: id });
      return data;
    }

    // ------------------------------------------------------------- DELETE --
    if (req.method === 'DELETE') {
      if (entwurf.status === 'sent') {
        throw ApiError.conflict(
          'Versendete Nachrichten bleiben in der Historie und koennen nicht geloescht werden.'
        );
      }

      const { data } = await db
        .from('drafts')
        .update({ status: 'deleted' })
        .eq('id', id)
        .select()
        .single();

      await protokolliere({ userId: user.id, action: 'draft.delete', resourceType: 'draft', resourceId: id });
      return { draft: data, message: 'Entwurf verworfen.' };
    }

    // ---------------------------------------------------------------- POST --
    const tat = String(req.query.tat ?? '');
    const dienst = alsDienst(); // fuer die Statistik-Funktion

    if (tat === 'restore') {
      if (entwurf.status !== 'deleted') {
        throw ApiError.badRequest('Nur verworfene Entwuerfe koennen wiederhergestellt werden.');
      }
      const { data } = await db.from('drafts').update({ status: 'pending' }).eq('id', id).select().single();
      return { draft: data, message: 'Entwurf wiederhergestellt.' };
    }

    if (tat === 'ignore') {
      if (entwurf.status === 'sent') {
        throw ApiError.conflict('Versendete Nachrichten koennen nicht aussortiert werden.');
      }

      const grund = String(
        (req.body as { reason?: string })?.reason ?? 'Von Ihnen als nicht relevant markiert.'
      ).slice(0, 200);

      const { data } = await db
        .from('drafts')
        .update({ status: 'ignored', relevance_kind: 'manuell', relevance_reason: grund })
        .eq('id', id)
        .select()
        .single();

      // Rollup korrigieren: zaehlt ab jetzt als aussortiert, nicht als Anfrage.
      const datum = heute(new Date((entwurf.received_at as string) ?? (entwurf.created_at as string)));
      await dienst.rpc('bump_statistics', {
        p_user_id: user.id,
        p_date: datum,
        p_category_id: entwurf.category_id ?? null,
        p_received: -1,
        p_sent: 0,
        p_ignored: 0,
        p_response_time: null,
      });
      await dienst.rpc('bump_statistics', {
        p_user_id: user.id,
        p_date: datum,
        p_category_id: null,
        p_received: 0,
        p_sent: 0,
        p_ignored: 1,
        p_response_time: null,
      });

      await protokolliere({ userId: user.id, action: 'draft.ignore', resourceType: 'draft', resourceId: id });
      return { draft: data, message: 'Mail wurde aussortiert.' };
    }

    if (tat === 'approve') {
      // Holt eine aussortierte Mail zurueck in die Bearbeitung und laesst die
      // KI einen Entwurf schreiben. Der Korrekturweg fuer Fehlurteile der
      // Relevanzpruefung - bei einer Filterquote um 95 Prozent kein Randfall,
      // sondern die wichtigste Sicherung gegen verlorene Kundenanfragen.
      if (entwurf.status !== 'ignored') {
        throw ApiError.badRequest('Nur aussortierte Mails koennen freigegeben werden.');
      }

      const [{ data: profil }, { data: szenarien }, { data: kategorien }] = await Promise.all([
        db.from('profiles').select('*').eq('id', user.id).single(),
        db.from('scenarios').select('*').eq('is_active', true),
        db.from('categories').select('*').order('sort_order'),
      ]);

      let entwurfstext = (entwurf.body_draft as string) ?? '';
      let kategorieId = entwurf.category_id as string | null;
      let mitKi = true;
      let hinweis: string | null = null;

      try {
        const erzeugt = await gemini.erzeugeEntwurfNeu(
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
        entwurfstext = erzeugt.draft;
        kategorieId = erzeugt.categoryId;
      } catch {
        // Der Entwurf soll auch dann entstehen, wenn die KI gerade streikt -
        // sonst haengt die Mail weiter im Aussortiert-Reiter fest.
        mitKi = false;
        hinweis =
          'Nachtraeglich freigegeben, die KI war dabei nicht erreichbar. Bitte den Text selbst schreiben.';
      }

      const { data } = await db
        .from('drafts')
        .update({
          status: 'pending',
          body_draft: entwurfstext,
          category_id: kategorieId,
          ai_generated: mitKi,
          ai_note: hinweis,
        })
        .eq('id', id)
        .select()
        .single();

      const datum = heute(new Date((entwurf.received_at as string) ?? (entwurf.created_at as string)));
      await dienst.rpc('bump_statistics', {
        p_user_id: user.id, p_date: datum, p_category_id: null,
        p_received: 0, p_sent: 0, p_ignored: -1, p_response_time: null,
      });
      await dienst.rpc('bump_statistics', {
        p_user_id: user.id, p_date: datum, p_category_id: kategorieId,
        p_received: 1, p_sent: 0, p_ignored: 0, p_response_time: null,
      });

      await protokolliere({ userId: user.id, action: 'draft.approve', resourceType: 'draft', resourceId: id });
      return { draft: data, message: 'Mail wurde freigegeben, ein Entwurf steht bereit.' };
    }

    throw ApiError.badRequest(
      `Unbekannte Aktion "${tat}". Erlaubt sind: restore, approve, ignore.`
    );
  }
);
