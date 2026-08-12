/**
 * Statistik-Dashboard.
 *
 * Drei Fragen soll die Seite beantworten:
 *   1. Wie viel kam herein, wie viel ging heraus?         -> Kennzahlen
 *   2. Wie verteilt sich das auf die Kategorien?          -> Ring-Chart
 *   3. Wird es mehr oder weniger?                         -> Verlauf
 *
 * Zur Farbgebung: Die Kategoriefarben kommen aus der Datenbank und gehören
 * damit fest zur Kategorie - eine Kategorie hat überall in der App dieselbe
 * Farbe, unabhängig von ihrer Position im Chart. Die Palette selbst ist für
 * dunkle Oberflächen geprüft. Ab acht Kategorien wird zu "Weitere"
 * zusammengefasst, statt neue Farben zu erfinden.
 *
 * Jede Kategorie steht zusätzlich als Text in Legende und Tabelle - die Farbe
 * ist nie das einzige Unterscheidungsmerkmal.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import api from '../api/client';
import { IconChart, IconClock, IconFilter, IconInbox, IconSend } from '../components/Icons';
import { EmptyState, ErrorState, LoadingState, StatTile } from '../components/ui';

/* --- Design-Token für die Charts ---------------------------------------- */
const INK = {
  grid: '#e8e4e0',
  axis: '#8f8781',
  surface: '#ffffff',
  border: '#e8e4e0',
  textPrimary: '#2a2622',
  textSecondary: '#6f6862',
};

/*
 * Serienfarben: Terrakotta und Salbei, die beiden Akzente des Designs.
 * Sie unterscheiden sich nicht nur im Farbton, sondern auch deutlich in der
 * Helligkeit - damit bleiben die Reihen auch bei Rot-Gruen-Schwaeche und im
 * Ausdruck unterscheidbar.
 */
const SERIES = {
  received: '#d97757',
  sent: '#6f8f84',
};

/** Sammelfarbe für zusammengefasste Kategorien. */
const OTHER_COLOR = '#b3aba3';

const PERIODS = [
  { id: 'today', label: 'Heute' },
  { id: 'week', label: 'Diese Woche' },
  { id: 'month', label: 'Dieser Monat' },
];

/** Höchstzahl einzeln dargestellter Kategorien, danach greift "Weitere". */
const MAX_SLICES = 7;

export default function Statistics() {

  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.stats.all());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) return <LoadingState text="Statistik wird berechnet ..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const current = data[period === 'today' ? 'today' : period === 'week' ? 'week' : 'month'];
  const trend = data.trend30;

  const hasAnyData = trend.totals.received > 0 || trend.totals.sent > 0;

  return (
    <div className="p-4 lg:p-6">
      {/* --- Kopf --- */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-950">Statistik</h1>
          <p className="mt-0.5 text-sm text-ink-600">
            Zeitraum: {current.label} ({formatRange(current.from, current.to)})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-ink-200 bg-ink-100/50 p-0.5">
            {PERIODS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriod(option.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  period === option.id
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-700 hover:bg-ink-200 hover:text-ink-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

        </div>
      </header>

      {!hasAnyData ? (
        <div className="card">
          <EmptyState
            icon={IconChart}
            title="Noch keine Daten"
            description="Sobald die ersten Kundenmails eingegangen und beantwortet sind, entstehen hier Auswertungen."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* --- Kennzahlen --- */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Eingegangen"
              value={current.totals.received}
              hint={current.label}
              icon={IconInbox}
            />
            <StatTile
              label="Beantwortet"
              value={current.totals.sent}
              hint={
                current.totals.received > 0
                  ? `${Math.round((current.totals.sent / current.totals.received) * 100)} % der Anfragen`
                  : 'noch nichts versendet'
              }
              icon={IconSend}
              accent="text-emerald-700"
            />
            <StatTile
              label="Aussortiert"
              value={current.totals.ignored}
              hint={
                current.totals.ignored > 0
                  ? `${current.totals.filteredPercentage.toLocaleString('de-DE', { maximumFractionDigits: 1 })} % des Posteingangs`
                  : 'kein Rauschen gefiltert'
              }
              icon={IconFilter}
              accent="text-ink-600"
            />
            <StatTile
              label="Ø Antwortzeit"
              value={current.totals.avgResponseTimeText ?? '-'}
              hint="vom Eingang bis zum Versand"
              icon={IconClock}
              accent="text-brand-700"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* --- Verlauf im gewählten Zeitraum --- */}
            <section className="card p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink-900">E-Mails pro Tag</h2>
              <p className="mb-4 text-xs text-ink-600">{current.label}</p>

              {current.daily.length === 0 ? (
                <p className="py-12 text-center text-sm text-ink-500">Keine Daten im Zeitraum.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={current.daily} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={{ stroke: INK.grid }}
                      tick={{ fill: INK.axis, fontSize: 11 }}
                      interval="preserveStartEnd"
                      minTickGap={12}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: INK.axis, fontSize: 11 }}
                      allowDecimals={false}
                      width={40}
                    />
                    <Tooltip content={<ChartTooltip unit="Mails" />} cursor={{ fill: '#ffffff08' }} />
                    <Legend content={<ChartLegend />} />
                    {/* Beide Reihen zählen Mails - eine gemeinsame Achse, nie zwei. */}
                    <Bar
                      dataKey="received"
                      name="Eingegangen"
                      fill={SERIES.received}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={22}
                    />
                    <Bar
                      dataKey="sent"
                      name="Beantwortet"
                      fill={SERIES.sent}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={22}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* --- Kategorien --- */}
            <section className="card p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink-900">Verteilung nach Kategorie</h2>
              <p className="mb-4 text-xs text-ink-600">
                {current.totals.received} eingegangene Mails, {current.label.toLowerCase()}
              </p>

              <CategoryBreakdown categories={current.categories} total={current.totals.received} />
            </section>
          </div>

          {/* --- 30-Tage-Verlauf --- */}
          <section className="card p-5">
            <h2 className="mb-1 text-sm font-semibold text-ink-900">Verlauf der letzten 30 Tage</h2>
            <p className="mb-4 text-xs text-ink-600">
              {trend.totals.received} eingegangen, {trend.totals.sent} beantwortet
            </p>

            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend.daily} margin={{ top: 4, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: INK.grid }}
                  tick={{ fill: INK.axis, fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: INK.axis, fontSize: 11 }}
                  allowDecimals={false}
                  width={40}
                />
                <Tooltip content={<ChartTooltip unit="Mails" />} cursor={{ stroke: INK.axis, strokeWidth: 1 }} />
                <Legend content={<ChartLegend />} />
                <Line
                  type="monotone"
                  dataKey="received"
                  name="Eingegangen"
                  stroke={SERIES.received}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: INK.surface }}
                />
                <Line
                  type="monotone"
                  dataKey="sent"
                  name="Beantwortet"
                  stroke={SERIES.sent}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: INK.surface }}
                />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Ring-Chart plus Tabelle. Die Tabelle ist nicht optional: Sie macht die Zahlen
 * exakt ablesbar und ersetzt das Chart für alle, die Farben schlecht
 * unterscheiden.
 */
function CategoryBreakdown({ categories, total }) {
  if (!categories || categories.length === 0 || total === 0) {
    return <p className="py-12 text-center text-sm text-ink-500">Keine Daten im Zeitraum.</p>;
  }

  // Ab acht Kategorien wird der Rest gebündelt, statt Farben zu erfinden.
  const slices =
    categories.length <= MAX_SLICES
      ? categories
      : [
          ...categories.slice(0, MAX_SLICES),
          {
            id: '__other__',
            name: 'Weitere',
            color: OTHER_COLOR,
            received: categories.slice(MAX_SLICES).reduce((sum, item) => sum + item.received, 0),
            sent: categories.slice(MAX_SLICES).reduce((sum, item) => sum + item.sent, 0),
            percentage:
              Math.round(
                (categories.slice(MAX_SLICES).reduce((sum, item) => sum + item.received, 0) / total) *
                  1000
              ) / 10,
          },
        ];

  return (
    <div className="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-center">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="received"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={44}
            outerRadius={72}
            // 2px Abstand zwischen den Segmenten, damit gleich helle Nachbarn
            // nicht ineinanderlaufen.
            paddingAngle={2}
            stroke={INK.surface}
            strokeWidth={2}
          >
            {slices.map((slice) => (
              <Cell key={slice.id || slice.name} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip unit="Mails" />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Tabelle: Name und Zahl im Klartext, Farbe nur als Zusatz. */}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ink-500">
            <th className="pb-1.5 text-left font-medium">Kategorie</th>
            <th className="pb-1.5 text-right font-medium">Mails</th>
            <th className="pb-1.5 text-right font-medium">Anteil</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.id || slice.name} className="border-t border-ink-200">
              <td className="py-1.5">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: slice.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-ink-800">{slice.name}</span>
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums text-ink-800">{slice.received}</td>
              <td className="py-1.5 text-right tabular-nums text-ink-600">
                {slice.percentage.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tooltip im Stil der Anwendung - Recharts' Standard passt nicht zum Dunkeldesign. */
/* eslint-disable react/prop-types */
function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{ backgroundColor: INK.surface, borderColor: INK.border }}
    >
      {label && <p className="mb-1.5 font-medium text-ink-900">{label}</p>}
      {payload.map((item) => (
        <p key={item.name} className="flex items-center gap-2 leading-relaxed">
          <span
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color || item.payload?.color }}
            aria-hidden="true"
          />
          <span className="text-ink-700">{item.name}:</span>
          <span className="tabular-nums font-medium text-ink-900">
            {item.value} {unit}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Legende: Text in Textfarbe, die Serienfarbe trägt nur das Kästchen. */
function ChartLegend({ payload }) {
  if (!payload) return null;

  return (
    <div className="mt-2 flex flex-wrap justify-center gap-4">
      {payload.map((item) => (
        <span key={item.value} className="flex items-center gap-1.5 text-xs text-ink-700">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.value}
        </span>
      ))}
    </div>
  );
}
/* eslint-enable react/prop-types */

/** "01.08. bis 09.08.2026" */
function formatRange(from, to) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);

  const short = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
  const full = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return from === to ? full.format(toDate) : `${short.format(fromDate)} bis ${full.format(toDate)}`;
}
