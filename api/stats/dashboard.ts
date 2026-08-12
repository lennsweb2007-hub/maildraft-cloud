/**
 * GET /api/stats/dashboard?period=today|week|month|30days|all
 *
 * Liefert die Auswertung fuer einen Zeitraum. Mit period=all kommen alle
 * Zeitraeume in einer Antwort - die Statistikseite braucht sie ohnehin
 * gleichzeitig, und vier Anfragen statt einer waeren in einer Serverless-
 * Umgebung vier Kaltstarts.
 *
 * Die Zeitraeume werden hier zentral berechnet, damit "diese Woche" ueberall
 * dasselbe bedeutet: Montag bis heute, in lokaler Zeit.
 */

import { geschuetzt } from '../_lib/handler.js';
import { ApiError } from '../_lib/errors.js';

type Zeitraum = 'today' | 'week' | 'month' | '30days';

function alsDatum(datum: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

function plusTage(datum: Date, tage: number): Date {
  const kopie = new Date(datum);
  kopie.setDate(kopie.getDate() + tage);
  return kopie;
}

function grenzen(zeitraum: Zeitraum): { von: string; bis: string; label: string } {
  const heute = new Date();

  switch (zeitraum) {
    case 'today':
      return { von: alsDatum(heute), bis: alsDatum(heute), label: 'Heute' };
    case 'week': {
      // getDay(): 0 = Sonntag. Wir wollen Montag als Wochenstart.
      const bisMontag = (heute.getDay() + 6) % 7;
      return { von: alsDatum(plusTage(heute, -bisMontag)), bis: alsDatum(heute), label: 'Diese Woche' };
    }
    case 'month': {
      const erster = new Date(heute.getFullYear(), heute.getMonth(), 1);
      return { von: alsDatum(erster), bis: alsDatum(heute), label: 'Dieser Monat' };
    }
    case '30days':
      return { von: alsDatum(plusTage(heute, -29)), bis: alsDatum(heute), label: 'Letzte 30 Tage' };
  }
}

/** Wandelt Sekunden in eine lesbare Angabe wie "2 Std. 15 Min.". */
function dauer(sekunden: number | null): string | null {
  if (sekunden === null || sekunden === undefined) return null;
  if (sekunden < 60) return `${sekunden} Sek.`;
  if (sekunden < 3600) return `${Math.round(sekunden / 60)} Min.`;

  const stunden = Math.floor(sekunden / 3600);
  const minuten = Math.round((sekunden % 3600) / 60);
  if (stunden < 24) return minuten > 0 ? `${stunden} Std. ${minuten} Min.` : `${stunden} Std.`;

  const tage = Math.floor(stunden / 24);
  const restStunden = stunden % 24;
  return restStunden > 0 ? `${tage} Tg. ${restStunden} Std.` : `${tage} Tg.`;
}

interface Zeile {
  stat_date: string;
  category_id: string | null;
  email_count: number;
  sent_count: number;
  ignored_count: number;
  avg_response_time: number | null;
}

interface KategorieInfo {
  id: string;
  name: string;
  color: string;
}

/**
 * Fuellt Tage ohne Daten mit Nullwerten auf.
 *
 * Ohne das haette der Verlauf Luecken statt leerer Tage - und ein Diagramm,
 * das fehlende Tage einfach ueberspringt, zeigt einen Trend, den es nicht gibt.
 */
function tageAuffuellen(zeilen: Zeile[], von: string, bis: string) {
  const proTag = new Map<string, { received: number; sent: number; ignored: number }>();
  for (const zeile of zeilen) {
    const eintrag = proTag.get(zeile.stat_date) ?? { received: 0, sent: 0, ignored: 0 };
    eintrag.received += zeile.email_count;
    eintrag.sent += zeile.sent_count;
    eintrag.ignored += zeile.ignored_count;
    proTag.set(zeile.stat_date, eintrag);
  }

  const ergebnis = [];
  const cursor = new Date(`${von}T00:00:00`);
  const ende = new Date(`${bis}T00:00:00`);

  // Schutz gegen Endlosschleifen bei unsinnigen Eingaben.
  let schutz = 0;
  while (cursor <= ende && schutz < 400) {
    const schluessel = alsDatum(cursor);
    const werte = proTag.get(schluessel) ?? { received: 0, sent: 0, ignored: 0 };
    ergebnis.push({
      date: schluessel,
      // Kurzform fuer die Achsenbeschriftung: 09.08.
      label: `${schluessel.slice(8, 10)}.${schluessel.slice(5, 7)}.`,
      ...werte,
    });
    cursor.setDate(cursor.getDate() + 1);
    schutz += 1;
  }

  return ergebnis;
}

function werteAus(zeilen: Zeile[], kategorien: KategorieInfo[], zeitraum: Zeitraum) {
  const { von, bis, label } = grenzen(zeitraum);
  const imZeitraum = zeilen.filter((z) => z.stat_date >= von && z.stat_date <= bis);

  const eingegangen = imZeitraum.reduce((s, z) => s + z.email_count, 0);
  const versendet = imZeitraum.reduce((s, z) => s + z.sent_count, 0);
  const aussortiert = imZeitraum.reduce((s, z) => s + z.ignored_count, 0);

  const antwortzeiten = imZeitraum.map((z) => z.avg_response_time).filter((w): w is number => Boolean(w));
  const schnitt = antwortzeiten.length
    ? Math.round(antwortzeiten.reduce((s, w) => s + w, 0) / antwortzeiten.length)
    : null;

  // Aufschluesselung nach Kategorie
  const proKategorie = new Map<string, { received: number; sent: number }>();
  for (const zeile of imZeitraum) {
    const schluessel = zeile.category_id ?? '';
    const eintrag = proKategorie.get(schluessel) ?? { received: 0, sent: 0 };
    eintrag.received += zeile.email_count;
    eintrag.sent += zeile.sent_count;
    proKategorie.set(schluessel, eintrag);
  }

  const kategorieListe = [...proKategorie.entries()]
    .filter(([, w]) => w.received > 0 || w.sent > 0)
    .map(([id, w]) => {
      const kategorie = kategorien.find((k) => k.id === id);
      return {
        id: id || null,
        name: kategorie?.name ?? 'Ohne Kategorie',
        color: kategorie?.color ?? '#66738f',
        received: w.received,
        sent: w.sent,
        percentage: eingegangen > 0 ? Math.round((w.received / eingegangen) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.received - a.received);

  return {
    period: zeitraum,
    label,
    from: von,
    to: bis,
    totals: {
      received: eingegangen,
      sent: versendet,
      pending: Math.max(0, eingegangen - versendet),
      ignored: aussortiert,
      // Anteil des Posteingangs, der gar kein Kundenservice war. Bei einem
      // Wert um 90 Prozent zeigt das unmittelbar, wie viel Arbeit der Filter
      // abnimmt - und faellt er ab, stimmt etwas nicht.
      filteredPercentage:
        eingegangen + aussortiert > 0
          ? Math.round((aussortiert / (eingegangen + aussortiert)) * 1000) / 10
          : 0,
      avgResponseTimeSeconds: schnitt,
      avgResponseTimeText: dauer(schnitt),
    },
    categories: kategorieListe,
    daily: tageAuffuellen(imZeitraum, von, bis),
  };
}

export default geschuetzt({ methoden: ['GET'] }, async ({ db, req }) => {
  const gewuenscht = String(req.query.period ?? 'all');

  // Immer 30 Tage laden - alle Zeitraeume liegen darin, eine Abfrage genuegt.
  const seit = grenzen('30days').von;

  const [{ data: zeilen }, { data: kategorien }, { data: entwuerfe }] = await Promise.all([
    db.from('statistics').select('*').gte('stat_date', seit),
    db.from('categories').select('id, name, color'),
    db.from('drafts').select('status'),
  ]);

  const daten = (zeilen ?? []) as Zeile[];
  const kats = (kategorien ?? []) as KategorieInfo[];

  const zaehler = { pending: 0, sent: 0, deleted: 0, ignored: 0 };
  for (const zeile of entwuerfe ?? []) {
    const s = (zeile as { status: keyof typeof zaehler }).status;
    if (s in zaehler) zaehler[s] += 1;
  }

  if (gewuenscht === 'all') {
    const today = werteAus(daten, kats, 'today');
    const week = werteAus(daten, kats, 'week');

    return {
      today,
      week,
      month: werteAus(daten, kats, 'month'),
      trend30: werteAus(daten, kats, '30days'),
      summary: {
        pendingDrafts: zaehler.pending,
        sentTotal: zaehler.sent,
        deletedTotal: zaehler.deleted,
        ignoredTotal: zaehler.ignored,
        today: today.totals,
        week: week.totals,
        topCategoryToday: today.categories[0] ?? null,
      },
    };
  }

  if (!['today', 'week', 'month', '30days'].includes(gewuenscht)) {
    throw ApiError.badRequest(
      `Unbekannter Zeitraum "${gewuenscht}". Erlaubt sind: today, week, month, 30days, all.`
    );
  }

  return werteAus(daten, kats, gewuenscht as Zeitraum);
});
