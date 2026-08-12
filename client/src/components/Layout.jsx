/**
 * Rahmen der Anwendung: Seitenleiste, Kopfzeile mit Refresh-Knopf, Inhalt.
 *
 * Die Kopfzeile zeigt dauerhaft an, wann zuletzt geprüft wurde. Das ist bei
 * einer App, die im Hintergrund arbeitet, die wichtigste Information: Sieht
 * man keine neuen Entwürfe, will man sofort wissen, ob gerade nichts kam oder
 * ob der Abruf hängt.
 */

/* eslint-disable react/prop-types */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { useApp } from '../context/AppContext';
import { formatRelative } from '../utils/format';
import { abmelden } from '../api/supabase';
import {
  IconChart,
  IconHistory,
  IconInbox,
  IconLogout,
  IconMail,
  IconRefresh,
  IconSettings,
} from './Icons';
import { Spinner, ToastContainer } from './ui';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Entwürfe', icon: IconInbox },
  { to: '/history', label: 'Historie', icon: IconHistory },
  { to: '/statistics', label: 'Statistik', icon: IconChart },
  { to: '/settings', label: 'Einstellungen', icon: IconSettings },
];

export default function Layout() {
  const { user, sync, syncing, refreshEmails, toasts, dismissToast, loadSettings } = useApp();
  const navigate = useNavigate();

  // Sorgt dafür, dass "vor 3 Minuten" nicht einfriert.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Während ein Abruf läuft, häufiger nachfragen - der Cron-Job kann im
  // Hintergrund Entwürfe erzeugen, ohne dass wir davon wissen.
  useEffect(() => {
    const timer = setInterval(() => {
      loadSettings().catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, [loadSettings]);

  const lastSync = sync?.lastSyncAt;

  return (
    <div className="flex min-h-screen bg-ink-950">
      {/* --- Seitenleiste --- */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900/40">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2.5 px-5 py-5 text-left"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 text-white">
            <IconMail size={19} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ink-50">MailDraft AI</span>
            <span className="block text-[11px] text-ink-400">
              {user?.brand_name || 'Kundenservice'}
            </span>
          </span>
        </button>

        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-500/15 text-brand-200'
                    : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-800 px-3 py-3">
          <button
            type="button"
            onClick={() => abmelden()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          >
            <IconLogout size={17} />
            Abmelden
          </button>
          <p className="mt-2 px-3 text-[11px] leading-relaxed text-ink-500">
            {user?.email}
            <br />
            Version 2.0.0
          </p>
        </div>
      </aside>

      {/* --- Inhalt --- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-end gap-4 border-b border-ink-800 bg-ink-950/80 px-6 backdrop-blur">
          <div className="text-right text-xs leading-tight text-ink-400">
            <p>
              Zuletzt geprueft:{' '}
              <span className="text-ink-200">{lastSync ? formatRelative(lastSync) : 'noch nie'}</span>
            </p>
            {sync?.autoRefreshEnabled && sync?.nextSyncAt && (
              <p className="mt-0.5">
                {/*
                  Liegt der berechnete Zeitpunkt in der Vergangenheit, stand der
                  Abruf länger an als geplant - etwa weil der Rechner aus war.
                  "Nächster Abruf vor 34 Minuten" wäre hier schlicht Unsinn.
                */}
                {new Date(sync.nextSyncAt) > new Date()
                  ? `Nächster Abruf ${formatRelative(sync.nextSyncAt)}`
                  : 'Nächster Abruf steht an'}
              </p>
            )}
            {sync && !sync.autoRefreshEnabled && (
              <p className="mt-0.5 text-amber-400/80">Automatischer Abruf ist aus</p>
            )}
          </div>

          <button
            type="button"
            onClick={refreshEmails}
            disabled={syncing}
            className="btn-secondary"
            title="Jetzt nach neuen E-Mails suchen"
          >
            {syncing ? <Spinner size={15} /> : <IconRefresh size={15} />}
            {syncing ? 'Wird geprüft ...' : 'Jetzt prüfen'}
          </button>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
