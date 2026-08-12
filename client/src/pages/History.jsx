/**
 * Versandhistorie.
 *
 * Links die Liste, rechts die Gegenüberstellung von Kundenmail und
 * versendeter Antwort. Die Aufteilung hat einen praktischen Grund: Man sucht
 * hier meist nach "was habe ich der Kundin damals eigentlich geschrieben" -
 * und will die Antwort sehen, ohne die Liste zu verlieren.
 */
import { useCallback, useEffect, useState } from 'react';

import api from '../api/client';
import { useApp } from '../context/AppContext';
import { IconHistory, IconSearch } from '../components/Icons';
import {
  CategoryBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Spinner,
} from '../components/ui';
import { colorFor, formatDateTime, formatDuration, initialsOf, truncate } from '../utils/format';

const SORT_OPTIONS = [
  { id: 'date:desc', label: 'Neueste zuerst' },
  { id: 'date:asc', label: 'Älteste zuerst' },
  { id: 'category:asc', label: 'Kategorie A-Z' },
  { id: 'recipient:asc', label: 'Empfänger A-Z' },
];

const PAGE_SIZE = 40;

export default function History() {
  const { categories } = useApp();

  const [categoryId, setCategoryId] = useState('');
  const [sortValue, setSortValue] = useState('date:desc');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [sort, order] = sortValue.split(':');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.history.list({
        categoryId,
        sort,
        order,
        search: search.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setData(result);

      // Beim ersten Laden gleich den obersten Eintrag öffnen.
      setSelected((current) => {
        if (current && result.items.some((item) => item.id === current.id)) return current;
        return result.items[0] ?? null;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [categoryId, sort, order, search, from, to, offset]);

  useEffect(() => {
    load();
  }, [load]);

  // Filteränderung setzt die Seitenzahl zurück.
  useEffect(() => {
    setOffset(0);
  }, [categoryId, sortValue, search, from, to]);

  const hasMore = data ? offset + data.items.length < data.total : false;

  return (
    <div className="flex h-full flex-col p-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-ink-950">Versandhistorie</h1>
        <p className="mt-0.5 text-sm text-ink-600">
          {data ? `${data.total} versendete ${data.total === 1 ? 'Antwort' : 'Antworten'}` : 'Wird geladen ...'}
        </p>
      </header>

      {/* --- Filter --- */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[13rem] flex-1">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            className="input pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Betreff oder Empfänger"
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

        <div className="flex items-center gap-1.5 text-xs text-ink-600">
          <input
            type="date"
            className="input w-auto py-1.5"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Von"
          />
          <span>bis</span>
          <input
            type="date"
            className="input w-auto py-1.5"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="Bis"
          />
        </div>
      </div>

      {/* --- Inhalt --- */}
      {loading && !data ? (
        <div className="card">
          <LoadingState text="Historie wird geladen ..." />
        </div>
      ) : error ? (
        <div className="card">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={IconHistory}
            title="Keine versendeten Antworten"
            description={
              search || categoryId || from || to
                ? 'Zu diesen Filtern gibt es keine Einträge.'
                : 'Sobald Sie den ersten Entwurf freigeben, erscheint er hier.'
            }
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_1fr]">
          {/* Liste */}
          <div className="card flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 divide-y divide-ink-200 overflow-y-auto">
              {data.items.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelected(entry)}
                  className={`flex w-full gap-3 p-3.5 text-left transition-colors ${
                    selected?.id === entry.id ? 'bg-brand-500/10' : 'hover:bg-ink-200/50'
                  }`}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ backgroundColor: colorFor(entry.to_email) }}
                    aria-hidden="true"
                  >
                    {initialsOf(entry.to_email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{entry.to_email}</p>
                    <p className="truncate text-xs text-ink-600">{entry.subject}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[11px] text-ink-500">{formatDateTime(entry.sent_at)}</span>
                      {entry.category_name && (
                        <CategoryBadge
                          name={entry.category_name}
                          color={entry.category_color}
                          size="sm"
                        />
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {(hasMore || offset > 0) && (
              <div className="flex items-center justify-between gap-2 border-t border-ink-200 p-2.5">
                <button
                  type="button"
                  onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
                  disabled={offset === 0 || loading}
                  className="btn-ghost text-xs"
                >
                  Zurück
                </button>
                <span className="text-[11px] text-ink-500">
                  {offset + 1} bis {offset + data.items.length} von {data.total}
                </span>
                <button
                  type="button"
                  onClick={() => setOffset((current) => current + PAGE_SIZE)}
                  disabled={!hasMore || loading}
                  className="btn-ghost text-xs"
                >
                  {loading ? <Spinner size={12} /> : 'Weiter'}
                </button>
              </div>
            )}
          </div>

          {/* Gegenüberstellung */}
          {selected && <HistoryDetail entry={selected} />}
        </div>
      )}
    </div>
  );
}

/** Zeigt Kundenmail und Antwort nebeneinander. */
function HistoryDetail({ entry }) {
  return (
    <div className="card flex min-h-0 flex-col">
      <header className="border-b border-ink-200 px-5 py-4">
        <h2 className="text-base font-semibold text-ink-950">{entry.subject}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs text-ink-600">
          <span>an {entry.to_email}</span>
          <span aria-hidden="true">&middot;</span>
          <span>versendet {formatDateTime(entry.sent_at)}</span>
          {entry.response_time_sec !== null && entry.response_time_sec !== undefined && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span>Antwortzeit {formatDuration(entry.response_time_sec)}</span>
            </>
          )}
          {entry.category_name && (
            <CategoryBadge name={entry.category_name} color={entry.category_color} size="sm" />
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 divide-y divide-ink-200 overflow-y-auto md:grid-cols-2 md:divide-x md:divide-y-0">
        <section className="p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-600">
            Nachricht der Kundin
          </h3>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">
            {entry.body_original || '(nicht mehr verfügbar)'}
          </pre>
        </section>

        <section className="p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600">
            Ihre Antwort
          </h3>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-800">
            {entry.body}
          </pre>
        </section>
      </div>
    </div>
  );
}
