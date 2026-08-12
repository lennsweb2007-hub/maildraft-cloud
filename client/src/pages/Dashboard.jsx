/**
 * Dashboard - die Arbeitsfläche.
 *
 * Die offenen Entwürfe stehen ganz oben; Kennzahlen und Filter sind bewusst
 * knapp gehalten. Wer täglich 40 Mails abarbeitet, will scrollen und klicken,
 * nicht erst ein Dashboard lesen.
 *
 * Freigeben und Verwerfen gehen direkt aus der Liste - der Umweg über die
 * Detailseite lohnt nur, wenn wirklich etwas geändert werden muss.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import api from '../api/client';
import { useApp } from '../context/AppContext';
import {
  IconCheck,
  IconFilter,
  IconInbox,
  IconInboxCheck,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTrash,
  IconUndo,
} from '../components/Icons';
import {
  CategoryBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Spinner,
  StatTile,
} from '../components/ui';
import { colorFor, formatSmartDate, initialsOf, truncate } from '../utils/format';

const STATUS_TABS = [
  { id: 'pending', label: 'Offen' },
  { id: 'sent', label: 'Versendet' },
  { id: 'ignored', label: 'Aussortiert' },
  { id: 'deleted', label: 'Verworfen' },
];

/** Klartext für die Einstufung der Relevanzprüfung. */
const RELEVANCE_LABELS = {
  benachrichtigung: 'Benachrichtigung',
  rechnung: 'Rechnung / Zahlung',
  bestellbestaetigung: 'Bestellbestätigung',
  newsletter: 'Newsletter',
  spam: 'Spam',
  gesperrt: 'Gesperrter Absender',
  manuell: 'Von Ihnen aussortiert',
  sonstiges: 'Sonstiges',
};

const SORT_OPTIONS = [
  { id: 'date:desc', label: 'Neueste zuerst' },
  { id: 'date:asc', label: 'Älteste zuerst' },
  { id: 'category:asc', label: 'Kategorie A-Z' },
  { id: 'sender:asc', label: 'Absender A-Z' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { categories, showToast, refreshEmails, syncing } = useApp();

  const [status, setStatus] = useState('pending');
  const [categoryId, setCategoryId] = useState('');
  const [sortValue, setSortValue] = useState('date:desc');
  const [search, setSearch] = useState('');

  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [busyId, setBusyId] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  // Entwürfe aus der Zeit vor dem Relevanzfilter
  const [ungeprueft, setUngeprueft] = useState(0);
  const [pruefeNach, setPruefeNach] = useState(false);

  const [sort, order] = sortValue.split(':');

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      setError(null);

      try {
        const [drafts, stats, recheck] = await Promise.all([
          api.drafts.list({ status, categoryId, sort, order, search: search.trim() || undefined }),
          api.stats.summary(),
          api.drafts.recheckStatus(),
        ]);
        setData(drafts);
        setSummary(stats);
        setUngeprueft(recheck.offen);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [status, categoryId, sort, order, search]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Nach einem Abruf die Liste nachziehen.
  useEffect(() => {
    if (!syncing) load({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing]);

  /** Versendet einen Entwurf direkt aus der Liste. */
  async function send(draft) {
    setBusyId(draft.id);
    try {
      const { message } = await api.drafts.send(draft.id);
      showToast(message, 'success');
      await load({ quiet: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    setBusyId(toDelete.id);
    try {
      await api.drafts.remove(toDelete.id);
      showToast('Entwurf verworfen.', 'success');
      await load({ quiet: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
      setToDelete(null);
    }
  }

  async function restore(draft) {
    setBusyId(draft.id);
    try {
      await api.drafts.restore(draft.id);
      showToast('Entwurf wiederhergestellt.', 'success');
      await load({ quiet: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  /** Holt eine aussortierte Mail zurück und lässt einen Entwurf schreiben. */
  async function approve(draft) {
    setBusyId(draft.id);
    try {
      const { message } = await api.drafts.approve(draft.id);
      showToast(message, 'success');
      await load({ quiet: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Lässt die Relevanzprüfung über den Altbestand laufen.
   *
   * Häppchenweise, in einer Schleife bis nichts mehr offen ist. Der Server
   * begrenzt jeden Aufruf, damit ein großer Altbestand nicht in einer einzigen
   * langen Anfrage hängt und das KI-Kontingent sprengt.
   */
  async function nachpruefen() {
    setPruefeNach(true);
    try {
      let durchgaenge = 0;
      let gesamtAussortiert = 0;

      // Obergrenze als Sicherheitsnetz gegen eine Endlosschleife, falls der
      // Server wider Erwarten immer dieselben Datensätze zurückgibt.
      while (durchgaenge < 40) {
        // eslint-disable-next-line no-await-in-loop
        const r = await api.drafts.recheck(20);
        gesamtAussortiert += r.aussortiert;
        setUngeprueft(r.offen);
        durchgaenge += 1;

        if (r.abgebrochen) {
          showToast(r.message, 'error');
          break;
        }
        if (r.offen === 0 || r.geprueft === 0) {
          showToast(
            `Nachprüfung fertig: ${gesamtAussortiert} von ${gesamtAussortiert + (r.behalten || 0)} aussortiert.`,
            'success'
          );
          break;
        }
      }

      await load({ quiet: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setPruefeNach(false);
    }
  }

  /** Sortiert einen offenen Entwurf nachträglich aus. */
  async function ignore(draft) {
    setBusyId(draft.id);
    try {
      await api.drafts.ignore(draft.id, 'Von Ihnen als nicht relevant markiert.');
      showToast('Mail wurde aussortiert.', 'success');
      await load({ quiet: true });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const counts = data?.counts ?? { pending: 0, sent: 0, deleted: 0 };

  const kpis = useMemo(
    () => [
      {
        label: 'Offene Entwürfe',
        value: counts.pending,
        hint: counts.pending === 0 ? 'Alles abgearbeitet' : 'warten auf Freigabe',
        icon: IconInbox,
      },
      {
        label: 'Heute eingegangen',
        value: summary?.today?.received ?? 0,
        hint: `${summary?.today?.sent ?? 0} bereits beantwortet`,
        icon: IconSparkles,
      },
      {
        label: 'Diese Woche',
        value: summary?.week?.received ?? 0,
        hint: summary?.week?.avgResponseTimeText
          ? `Ø Antwortzeit ${summary.week.avgResponseTimeText}`
          : 'noch keine Antwortzeit',
        icon: IconCheck,
      },
      {
        label: 'Aussortiert heute',
        value: summary?.today?.ignored ?? 0,
        hint:
          (summary?.today?.ignored ?? 0) + (summary?.today?.received ?? 0) > 0
            ? `${Math.round(
                ((summary?.today?.ignored ?? 0) /
                  ((summary?.today?.ignored ?? 0) + (summary?.today?.received ?? 0))) *
                  100
              )} % des Posteingangs`
            : 'kein Rauschen bisher',
        icon: IconFilter,
        accent: 'text-ink-600',
      },
    ],
    [counts.pending, summary]
  );

  return (
    <div className="p-4 lg:p-6">
      {/* --- Kennzahlen ---
          Auf dem Handy zwei nebeneinander statt vier untereinander: gestapelt
          fuellen sie den ganzen Bildschirm, und die Entwuerfe - worum es hier
          eigentlich geht - waeren erst nach langem Scrollen zu sehen. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:mb-6 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* --- Altbestand aus der Zeit vor dem Relevanzfilter --- */}
      {ungeprueft > 0 && status === 'pending' && (
        <div className="mb-4">
          <Notice
            type="info"
            title={`${ungeprueft} ${ungeprueft === 1 ? 'Entwurf stammt' : 'Entwürfe stammen'} aus der Zeit vor dem Relevanzfilter`}
            action={
              <button
                type="button"
                onClick={nachpruefen}
                disabled={pruefeNach}
                className="btn-primary text-xs"
              >
                {pruefeNach ? <Spinner size={13} /> : <IconFilter size={13} />}
                {pruefeNach ? `Wird geprüft ... noch ${ungeprueft}` : 'Jetzt nachprüfen'}
              </button>
            }
          >
            Damals bekam jede ungelesene Mail einen Entwurf - auch Rechnungen und
            Benachrichtigungen. Die Nachprüfung sortiert das nachträglich aus. Nichts geht dabei
            verloren: Alles landet im Reiter &bdquo;Aussortiert&ldquo; und lässt sich
            zurückholen.
          </Notice>
        </div>
      )}

      {/* --- Filterleiste --- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-ink-200 bg-ink-100/50 p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatus(tab.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                status === tab.id
                  ? 'bg-brand-600 text-white'
                  : 'text-ink-700 hover:bg-ink-200 hover:text-ink-900'
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs opacity-70">{counts[tab.id] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[14rem] flex-1">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            className="input pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nach Betreff oder Absender suchen"
          />
        </div>

        <select
          className="input w-auto"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Alle Kategorien</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <select
          className="input w-auto"
          value={sortValue}
          onChange={(event) => setSortValue(event.target.value)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* --- Liste --- */}
      {loading && !data ? (
        <div className="card">
          <LoadingState text="Entwürfe werden geladen ..." />
        </div>
      ) : error ? (
        <div className="card">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={IconInbox}
            title={
              status === 'pending'
                ? search || categoryId
                  ? 'Keine Treffer'
                  : 'Keine offenen Entwürfe'
                : status === 'sent'
                  ? 'Noch nichts versendet'
                  : status === 'ignored'
                    ? 'Nichts aussortiert'
                    : 'Nichts verworfen'
            }
            description={
              status === 'ignored'
                ? 'Hier landen Mails, die kein Kundenservice sind - Rechnungen, Zahlungsbenachrichtigungen, Newsletter. Wurde etwas falsch einsortiert, holen Sie es mit einem Klick zurück.'
                : status === 'pending' && !search && !categoryId
                  ? 'Sobald neue Kundenmails eintreffen, erscheinen hier die Entwürfe. Der nächste Abruf läuft automatisch.'
                  : 'Passen Sie die Filter an oder suchen Sie nach etwas anderem.'
            }
            action={
              status === 'pending' && !search && !categoryId ? (
                <button type="button" onClick={refreshEmails} disabled={syncing} className="btn-primary">
                  {syncing ? <Spinner size={15} /> : null}
                  Jetzt nach E-Mails suchen
                </button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((draft) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              busy={busyId === draft.id}
              onOpen={() => navigate(`/drafts/${draft.id}`)}
              onSend={() => send(draft)}
              onDelete={() => setToDelete(draft)}
              onRestore={() => restore(draft)}
              onApprove={() => approve(draft)}
              onIgnore={() => ignore(draft)}
            />
          ))}

          {data.total > data.items.length && (
            <p className="pt-2 text-center text-xs text-ink-500">
              {data.items.length} von {data.total} werden angezeigt. Nutzen Sie die Suche, um
              gezielter zu filtern.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Entwurf verwerfen?"
        description={
          toDelete
            ? `Die Antwort an ${toDelete.from_email} wird verworfen. Die Kundenmail bleibt in Ihrem Postfach, und Sie können den Entwurf unter "Verworfen" wiederherstellen.`
            : ''
        }
        confirmLabel="Verwerfen"
        danger
        busy={busyId === toDelete?.id}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

/** Eine Zeile in der Entwurfsliste. */
function DraftRow({ draft, busy, onOpen, onSend, onDelete, onRestore, onApprove, onIgnore }) {
  const isPending = draft.status === 'pending';
  const isIgnored = draft.status === 'ignored';
  const avatarColor = colorFor(draft.from_email);

  // Die Relevanzprüfung war sich unsicher - die Mail liegt nur deshalb bei
  // den Entwürfen. Das gehört sichtbar gemacht, damit der Nutzer weiß,
  // dass hier ein Blick lohnt.
  const unsicher =
    isPending &&
    typeof draft.relevance_confidence === 'number' &&
    draft.relevance_confidence > 0 &&
    draft.relevance_confidence < 0.75;

  return (
    <article className="card group p-3.5 transition-colors hover:border-ink-300 sm:p-4">
      {/*
        flex-wrap zusammen mit w-full an der Aktionsspalte: Auf schmalen
        Schirmen rutscht sie dadurch von selbst auf eine eigene Zeile unter
        den Text, ab lg steht sie wieder rechts daneben. So gibt es die
        Knoepfe nur einmal im Quelltext.
      */}
      <div className="flex flex-wrap items-start gap-3 sm:gap-4">
        {/* Absender-Kreis */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: avatarColor }}
          aria-hidden="true"
        >
          {initialsOf(draft.from_name || draft.from_email)}
        </div>

        {/* Inhalt */}
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink-900">
              {draft.from_name || draft.from_email}
            </span>
            {draft.category_name && (
              <CategoryBadge
                name={draft.category_name}
                color={draft.category_color}
                icon={draft.category_icon}
                size="sm"
              />
            )}
            {isIgnored && draft.relevance_kind && (
              <span className="badge bg-ink-300/60 px-1.5 py-0.5 text-[11px] text-ink-700">
                {RELEVANCE_LABELS[draft.relevance_kind] || draft.relevance_kind}
              </span>
            )}
            {unsicher && (
              <span className="badge bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700">
                unsicher
              </span>
            )}
            {!draft.ai_generated && !isIgnored && (
              <span className="badge bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700">
                Vorlage
              </span>
            )}
            {draft.send_error && (
              <span className="badge bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-700">
                Versand fehlgeschlagen
              </span>
            )}
          </div>

          <p className="mb-1.5 truncate text-sm text-ink-800">{draft.subject}</p>

          {isIgnored ? (
            <p className="text-xs leading-relaxed text-ink-500">
              {draft.relevance_reason || 'Keine Begründung hinterlegt.'}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-ink-600">{truncate(draft.body_draft, 160)}</p>
          )}
        </button>

        {/* Zeit und Aktionen */}
        <div className="flex w-full items-center justify-between gap-2 border-t border-ink-200 pt-2.5 lg:w-auto lg:shrink-0 lg:flex-col lg:items-end lg:border-0 lg:pt-0">
          <span className="whitespace-nowrap text-xs text-ink-500">
            {formatSmartDate(draft.received_at || draft.created_at)}
          </span>

          {/*
            Auf Beruehrungsgeraeten gibt es kein hover - dort waeren die
            Knoepfe sonst nie erreichbar. Deshalb erst ab lg ausgeblendet.
          */}
          <div className="flex gap-1 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100">
            {isPending ? (
              <>
                <Link to={`/drafts/${draft.id}`} className="btn-ghost px-2 py-1 text-xs">
                  Öffnen
                </Link>
                <button
                  type="button"
                  onClick={onSend}
                  disabled={busy}
                  className="btn-primary px-2.5 py-1 text-xs"
                  title="Entwurf unverändert absenden"
                >
                  {busy ? <Spinner size={12} /> : <IconSend size={12} />}
                  Senden
                </button>
                <button
                  type="button"
                  onClick={onIgnore}
                  disabled={busy}
                  className="btn-ghost px-2 py-1 text-xs"
                  title="Ist keine Kundenanfrage - aussortieren"
                >
                  <IconFilter size={13} />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  className="btn-ghost px-2 py-1 text-xs text-red-600 hover:bg-red-500/10"
                  title="Entwurf verwerfen"
                >
                  <IconTrash size={13} />
                </button>
              </>
            ) : isIgnored ? (
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className="btn-secondary px-2.5 py-1 text-xs"
                title="Ist doch eine Kundenanfrage - Entwurf erstellen lassen"
              >
                {busy ? <Spinner size={12} /> : <IconInboxCheck size={13} />}
                Doch beantworten
              </button>
            ) : draft.status === 'deleted' ? (
              <button
                type="button"
                onClick={onRestore}
                disabled={busy}
                className="btn-ghost px-2 py-1 text-xs"
              >
                {busy ? <Spinner size={12} /> : <IconUndo size={13} />}
                Wiederherstellen
              </button>
            ) : (
              <Link to={`/drafts/${draft.id}`} className="btn-ghost px-2 py-1 text-xs">
                Ansehen
              </Link>
            )}
          </div>
        </div>
      </div>

      {draft.ai_note && isPending && (
        <div className="mt-3">
          <Notice type="warning">{draft.ai_note}</Notice>
        </div>
      )}
    </article>
  );
}
