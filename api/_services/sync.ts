/**
 * Abrufsteuerung.
 *
 * Der groesste Unterschied zur lokalen Fassung. Dort lief ein Dauerprozess mit
 * einem Sperr-Flag im Speicher und beliebig viel Zeit. Hier gilt beides nicht:
 *
 *  - Jeder Aufruf ist eine eigene Instanz. Ein Flag im Speicher waere
 *    wirkungslos, deshalb liegt die Sperre in der Datenbank. Ohne sie wuerden
 *    mehrere Cron-Aufrufe gleichzeitig arbeiten, dieselben Mails doppelt
 *    verarbeiten und das GEMEINSAME Gemini-Kontingent sprengen.
 *
 *  - Jeder Aufruf hat ein Zeitlimit. Der Abruf arbeitet deshalb bis zu einem
 *    Zeitbudget und meldet dann, was noch offen ist. Der naechste Cron-Lauf
 *    macht weiter. So passt der Abruf in jedes Limit, auch in die 60 Sekunden
 *    des kostenlosen Tarifs, und ein Rueckstand baut sich ueber mehrere Laeufe
 *    ab, statt eine Funktion zu sprengen.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { config } from '../_lib/config.js';
import { alsDienst } from '../_lib/supabase.js';
import { zufallsToken } from '../_lib/crypto.js';
import { protokolliere } from '../_lib/audit.js';

import * as mail from './mail.js';
import * as gemini from './gemini.js';
import { vorfilter } from './relevanceFilter.js';
import type { Kategorie, Nachricht, Postfach, Profil, Szenario } from './typen.js';

const SPERRE = 'email-sync';

export interface AbrufErgebnis {
  postfaecherVerarbeitet: number;
  entwuerfeErstellt: number;
  aussortiert: number;
  uebersprungen: number;
  /** True, wenn das Zeitbudget erreicht wurde und noch Mails offen sind. */
  nochOffen: boolean;
  gesperrt: boolean;
  fehler: { postfach: string; message: string; needsReauth?: boolean }[];
  dauerMs: number;
}

/** Lokales Datum als YYYY-MM-DD - "heute" soll dem Kalendertag entsprechen. */
function heute(datum = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

/** Schreibt den Statistik-Rollup fort. */
async function zaehle(
  db: SupabaseClient,
  userId: string,
  datum: string,
  werte: { kategorie?: string | null; received?: number; sent?: number; ignored?: number; responseTime?: number | null }
): Promise<void> {
  await db.rpc('bump_statistics', {
    p_user_id: userId,
    p_date: datum,
    p_category_id: werte.kategorie ?? null,
    p_received: werte.received ?? 0,
    p_sent: werte.sent ?? 0,
    p_ignored: werte.ignored ?? 0,
    p_response_time: werte.responseTime ?? null,
  });
}

interface NutzerKontext {
  profil: Profil;
  szenarien: Szenario[];
  kategorien: Kategorie[];
  sperrliste: string[];
}

/** Laedt alles, was fuer die Verarbeitung eines Nutzers gebraucht wird. */
async function ladeKontext(db: SupabaseClient, userId: string): Promise<NutzerKontext | null> {
  const [{ data: profil }, { data: szenarien }, { data: kategorien }] = await Promise.all([
    db.from('profiles').select('*').eq('id', userId).single(),
    db.from('scenarios').select('*').eq('user_id', userId).eq('is_active', true),
    db.from('categories').select('*').eq('user_id', userId).order('sort_order'),
  ]);

  if (!profil) return null;

  const sperrliste = Array.isArray(profil.blocked_senders) ? (profil.blocked_senders as string[]) : [];

  return {
    profil: profil as Profil,
    szenarien: (szenarien ?? []) as Szenario[],
    kategorien: (kategorien ?? []) as Kategorie[],
    sperrliste,
  };
}

/** Ist diese Nachricht schon verarbeitet? */
async function bereitsVerarbeitet(
  db: SupabaseClient,
  postfachId: string,
  messageId: string
): Promise<boolean> {
  const { data } = await db
    .from('drafts')
    .select('id')
    .eq('email_account_id', postfachId)
    .eq('message_id', messageId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Verarbeitet eine einzelne Nachricht.
 *
 * Ablauf:
 *   1. Vorfilter ohne KI - erkennt Newsletter und Automaten sofort
 *   2. KI-Relevanzpruefung - ist das ueberhaupt eine Kundenanfrage?
 *   3. Nur bei "ja": Entwurf erzeugen
 *
 * Das Postfach selbst wird nicht veraendert - keine Mail wird als gelesen
 * markiert. Welche Nachricht verarbeitet ist, steht in der eigenen Datenbank.
 */
async function verarbeiteNachricht(
  db: SupabaseClient,
  postfach: Postfach,
  nachricht: Nachricht,
  kontext: NutzerKontext
): Promise<'erstellt' | 'aussortiert'> {
  // Antwortziel: normalerweise der Absender - bei weitergeleiteten
  // Kontaktformularen aber die Adresse aus Reply-To. Ohne diese
  // Unterscheidung ginge die Antwort an no-reply@shopify.com und damit ins
  // Leere, waehrend die Kundin auf eine Rueckmeldung wartet.
  const antwortAn =
    nachricht.replyTo && nachricht.replyTo !== nachricht.from ? nachricht.replyTo : nachricht.from;

  const basis = {
    user_id: kontext.profil.id,
    email_account_id: postfach.id,
    message_id: nachricht.messageId,
    thread_id: nachricht.threadId,
    in_reply_to: nachricht.rfcMessageId,
    references_hdr: nachricht.references,
    from_email: nachricht.from,
    from_name: nachricht.fromName,
    to_email: antwortAn,
    subject: nachricht.subject,
    body_original: nachricht.text,
    received_at: nachricht.receivedAt,
  };

  const datum = heute(new Date(nachricht.receivedAt));

  const aussortieren = async (kind: string, reason: string, confidence: number) => {
    await db.from('drafts').insert({
      ...basis,
      status: 'ignored',
      relevance_kind: kind,
      relevance_reason: reason,
      relevance_confidence: confidence,
      ai_generated: false,
    });
    await zaehle(db, kontext.profil.id, datum, { ignored: 1 });
  };

  if (kontext.profil.relevance_filter_enabled) {
    // --- Stufe 1: Vorfilter ohne KI ---
    const vor = vorfilter(nachricht, kontext.sperrliste);
    if (vor.ignore) {
      await aussortieren(vor.kind ?? 'sonstiges', vor.reason ?? '', 1);
      return 'aussortiert';
    }

    // --- Stufe 2: KI-Relevanzpruefung ---
    const urteil = await gemini.pruefeRelevanz(kontext.profil, nachricht);
    if (!urteil.relevant) {
      await aussortieren(urteil.kind, urteil.reason, urteil.confidence);
      return 'aussortiert';
    }

    Object.assign(basis, {
      relevance_kind: urteil.kind,
      relevance_reason: urteil.reason,
      relevance_confidence: urteil.confidence,
    });
  }

  // --- Entwurf erzeugen ---
  const erzeugt = await gemini.erzeugeEntwurf(
    kontext.profil,
    kontext.szenarien,
    kontext.kategorien,
    nachricht
  );

  await db.from('drafts').insert({
    ...basis,
    body_draft: erzeugt.draft,
    category_id: erzeugt.categoryId,
    scenario_id: erzeugt.scenarioId,
    ai_generated: erzeugt.aiGenerated,
    ai_note: erzeugt.note,
    status: 'pending',
  });

  await zaehle(db, kontext.profil.id, datum, { kategorie: erzeugt.categoryId, received: 1 });
  return 'erstellt';
}

/**
 * Fuehrt einen Abruf aus.
 *
 * @param nurFuerNutzer Wenn gesetzt, wird nur dieses Konto abgerufen (manueller
 *                      Refresh). Ohne Angabe laufen alle Nutzer durch (Cron).
 */
export async function fuehreAbrufAus(nurFuerNutzer?: string): Promise<AbrufErgebnis> {
  const start = Date.now();
  const ergebnis: AbrufErgebnis = {
    postfaecherVerarbeitet: 0,
    entwuerfeErstellt: 0,
    aussortiert: 0,
    uebersprungen: 0,
    nochOffen: false,
    gesperrt: false,
    fehler: [],
    dauerMs: 0,
  };

  const db = alsDienst();
  const inhaber = zufallsToken(8);

  // --- Sperre holen ---
  //
  // Die Lebensdauer liegt bewusst knapp ueber dem Zeitbudget: Wird die
  // Funktion vom Zeitlimit hart beendet, gibt sie die Sperre nicht frei -
  // dann muss sie von selbst verfallen, sonst blockiert sie alle weiteren
  // Laeufe dauerhaft.
  const { data: erlangt } = await db.rpc('acquire_sync_lock', {
    p_key: SPERRE,
    p_holder: inhaber,
    p_ttl_seconds: Math.ceil(config.sync.timeBudgetMs / 1000) + 30,
  });

  if (!erlangt) {
    ergebnis.gesperrt = true;
    ergebnis.dauerMs = Date.now() - start;
    return ergebnis;
  }

  try {
    // Postfaecher einsammeln. Der Dienst-Zugang umgeht RLS - deshalb wird bei
    // einem manuellen Refresh hier ausdruecklich nach user_id gefiltert.
    let abfrage = db.from('email_accounts').select('*').eq('is_active', true).neq('status', 'needs_reauth');
    if (nurFuerNutzer) abfrage = abfrage.eq('user_id', nurFuerNutzer);

    const { data: postfaecher } = await abfrage;
    const kontexte = new Map<string, NutzerKontext | null>();

    for (const roh of (postfaecher ?? []) as Postfach[]) {
      // Zeitbudget erreicht? Dann geordnet enden - der naechste Lauf macht weiter.
      if (Date.now() - start > config.sync.timeBudgetMs) {
        ergebnis.nochOffen = true;
        break;
      }

      // Beide Modelle gesperrt? Dann bringt kein weiterer Versuch etwas.
      if (gemini.vollstaendigGesperrt()) {
        ergebnis.nochOffen = true;
        ergebnis.fehler.push({
          postfach: roh.email_address,
          message:
            'Das Gemini-Kontingent ist erschoepft. Die uebrigen Mails werden beim naechsten Abruf verarbeitet.',
        });
        break;
      }

      if (!kontexte.has(roh.user_id)) {
        kontexte.set(roh.user_id, await ladeKontext(db, roh.user_id));
      }
      const kontext = kontexte.get(roh.user_id);
      if (!kontext) continue;

      try {
        const nachrichten = await mail.holeNachrichten(roh);
        ergebnis.postfaecherVerarbeitet += 1;

        for (const nachricht of nachrichten) {
          if (Date.now() - start > config.sync.timeBudgetMs || gemini.vollstaendigGesperrt()) {
            ergebnis.nochOffen = true;
            break;
          }

          if (await bereitsVerarbeitet(db, roh.id, nachricht.messageId)) {
            ergebnis.uebersprungen += 1;
            continue;
          }

          const wie = await verarbeiteNachricht(db, roh, nachricht, kontext);
          if (wie === 'erstellt') ergebnis.entwuerfeErstellt += 1;
          else ergebnis.aussortiert += 1;
        }

        // last_sync nur setzen, wenn das Postfach vollstaendig durchlief.
        // Sonst wuerde der naechste Lauf die noch offenen Mails ueberspringen.
        if (!ergebnis.nochOffen) {
          await db
            .from('email_accounts')
            .update({ last_sync: new Date().toISOString(), status: 'ok', last_error: null })
            .eq('id', roh.id);
        }
      } catch (fehler) {
        // Ein kaputtes Postfach darf die anderen nicht blockieren.
        const needsReauth = Boolean((fehler as { needsReauth?: boolean }).needsReauth);
        const meldung = (fehler as Error).message;

        await db
          .from('email_accounts')
          .update({ status: needsReauth ? 'needs_reauth' : 'error', last_error: meldung.slice(0, 500) })
          .eq('id', roh.id);

        ergebnis.fehler.push({ postfach: roh.email_address, message: meldung, needsReauth });
      }
    }

    // Zeitpunkt des letzten Laufs je Nutzer vermerken
    for (const userId of kontexte.keys()) {
      await db.from('profiles').update({ last_sync_at: new Date().toISOString() }).eq('id', userId);
    }

    // Abgelaufene OAuth-Vorgaenge wegraeumen
    await db
      .from('oauth_states')
      .delete()
      .lt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());
  } finally {
    await db.rpc('release_sync_lock', { p_key: SPERRE, p_holder: inhaber });
  }

  ergebnis.dauerMs = Date.now() - start;

  await protokolliere({
    userId: nurFuerNutzer ?? null,
    action: 'sync.run',
    details: {
      postfaecher: ergebnis.postfaecherVerarbeitet,
      entwuerfe: ergebnis.entwuerfeErstellt,
      aussortiert: ergebnis.aussortiert,
      nochOffen: ergebnis.nochOffen,
      fehler: ergebnis.fehler.length,
      dauerMs: ergebnis.dauerMs,
    },
  });

  return ergebnis;
}
