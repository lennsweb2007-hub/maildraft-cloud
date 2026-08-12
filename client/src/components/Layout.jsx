/**
 * Rahmen der Anwendung: Seitenleiste, Kopfzeile mit Refresh-Knopf, Inhalt.
 *
 * Die Kopfzeile zeigt dauerhaft an, wann zuletzt geprüft wurde. Das ist bei
 * einer App, die im Hintergrund arbeitet, die wichtigste Information: Sieht
 * man keine neuen Entwürfe, will man sofort wissen, ob gerade nichts kam oder
 * ob der Abruf hängt.
 */

/* eslint-disable react/prop-types */
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  IconMenu,
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
  const { pathname } = useLocation();

  /*
   * Auf schmalen Bildschirmen faehrt die Navigation als Schublade ueber den
   * Inhalt, statt ihm dauerhaft die halbe Breite zu nehmen. Ab der
   * lg-Schwelle steht sie wieder fest daneben; dann ist dieser Zustand ohne
   * Wirkung.
   */
  const [navOffen, setNavOffen] = useState(false);

  // Nach jedem Seitenwechsel zu: Sonst bleibt die Schublade offen und
  // verdeckt genau das, was man aufgerufen hat.
  useEffect(() => {
    setNavOffen(false);
  }, [pathname]);

  // Escape schliesst - erwartetes Verhalten bei allem, was sich ueberlagert.
  useEffect(() => {
    if (!navOffen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOffen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOffen]);

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
    <div className="flex min-h-screen bg-ink-50">
      {/* --- Seitenleiste --- */}
      {/* Abdunklung hinter der Schublade - nur auf schmalen Bildschirmen. */}
      {navOffen && (
        <button
          type="button"
          onClick={() => setNavOffen(false)}
          className="fixed inset-0 z-30 bg-ink-950/30 lg:hidden"
          aria-label="Menü schließen"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-ink-200 bg-gradient-to-b from-ink-100 to-[#f8f6f4] transition-transform duration-200 lg:static lg:z-auto lg:w-60 lg:translate-x-0 ${
          navOffen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2.5 px-5 py-6 text-left"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
            <IconMail size={19} />
          </span>
          <span>
            <span className="block text-[13px] font-bold uppercase tracking-[0.6px] text-brand-500">
              MailDraft AI
            </span>
            <span className="block text-[11px] text-ink-600">
              {user?.brand_name || 'Kundenservice'}
            </span>
          </span>
        </button>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              /*
               * Die Akzentkante liegt in beiden Zustaenden an, im Ruhezustand
               * nur durchsichtig. Sonst ruecken die Eintraege beim Wechsel um
               * drei Pixel zur Seite.
               */
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-brand-500 bg-brand-500/[0.12] text-brand-700'
                    : 'border-transparent text-ink-700 hover:bg-brand-500/[0.08] hover:text-ink-950'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-200 px-3 py-4">
          <button
            type="button"
            onClick={() => abmelden()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-brand-500/[0.08] hover:text-ink-950"
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
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 lg:justify-end lg:px-6">
          <button
            type="button"
            onClick={() => setNavOffen(true)}
            className="btn-ghost -ml-1.5 p-2 lg:hidden"
            aria-label="Menü öffnen"
            aria-expanded={navOffen}
          >
            <IconMenu size={20} />
          </button>

          <div className="min-w-0 text-right text-xs leading-tight text-ink-600">
            <p className="truncate">
              {/* Auf schmalen Schirmen faellt das Wort weg - die Uhrzeit
                  allein sagt bereits alles, was hier zaehlt. */}
              <span className="hidden sm:inline">Zuletzt geprueft: </span>
              <span className="text-ink-800">{lastSync ? formatRelative(lastSync) : 'noch nie'}</span>
            </p>
            {sync?.autoRefreshEnabled && sync?.nextSyncAt && (
              /* Zweitrangig: auf dem Handy wuerde diese Zeile die Kopfzeile
                 umbrechen lassen, ohne etwas Handlungsrelevantes zu sagen. */
              <p className="mt-0.5 hidden sm:block">
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
              <p className="mt-0.5 text-amber-600/80">Automatischer Abruf ist aus</p>
            )}
          </div>

          <button
            type="button"
            onClick={refreshEmails}
            disabled={syncing}
            className="btn-secondary shrink-0 px-3 sm:px-4"
            title="Jetzt nach neuen E-Mails suchen"
          >
            {syncing ? <Spinner size={15} /> : <IconRefresh size={15} />}
            {/* Auf dem Handy traegt das Symbol die Bedeutung allein - die
                Beschriftung wuerde den Knopf sonst umbrechen. */}
            <span className="hidden sm:inline">
              {syncing ? 'Wird geprüft ...' : 'Jetzt prüfen'}
            </span>
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
