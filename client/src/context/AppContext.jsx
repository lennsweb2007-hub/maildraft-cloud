/**
 * Anwendungsweiter Zustand.
 *
 * Hält genau das, was auf mehreren Seiten gebraucht wird: Einstellungen,
 * Kategorien, Sync-Status und die Toast-Meldungen. Alles andere lädt jede
 * Seite selbst - ein globaler Speicher für Listen wäre bei dieser Größe
 * nur eine zusätzliche Quelle veralteter Daten.
 */
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';

const AppContext = createContext(null);

/** Zugriff auf den App-Zustand. */
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp muss innerhalb von <AppProvider> verwendet werden.');
  return context;
}

let toastCounter = 0;

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [syncing, setSyncing] = useState(false);

  // Timer merken, damit sie beim Aushängen aufgeräumt werden können.
  const toastTimers = useRef(new Map());

  // --- Toasts ---------------------------------------------------------------

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message, type = 'info', durationMs = null) => {
      toastCounter += 1;
      const id = toastCounter;

      setToasts((current) => [...current, { id, message, type }]);

      // Fehler bleiben länger stehen - man will sie lesen können.
      const duration = durationMs ?? (type === 'error' ? 8000 : 4000);
      const timer = setTimeout(() => dismissToast(id), duration);
      toastTimers.current.set(id, timer);

      return id;
    },
    [dismissToast]
  );

  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) clearTimeout(timer);
      toastTimers.current.clear();
    },
    []
  );

  // --- Daten laden ----------------------------------------------------------

  const loadSettings = useCallback(async () => {
    const data = await api.settings.get();
    setSettings(data);
    return data;
  }, []);

  const loadCategories = useCallback(async () => {
    const data = await api.categories.list();
    setCategories(data.items);
    return data.items;
  }, []);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      await Promise.all([loadSettings(), loadCategories()]);
    } catch (err) {
      setLoadError(err.message);
      throw err;
    }
  }, [loadSettings, loadCategories]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await reload();
      } catch {
        // Fehler steht bereits in loadError; die Oberfläche zeigt ihn an.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reload]);

  // --- Abruf ----------------------------------------------------------------

  /**
   * Stößt einen Mail-Abruf an und meldet das Ergebnis als Toast.
   * @returns {Promise<object|null>} das Ergebnis oder null bei einem Fehler
   */
  const refreshEmails = useCallback(async () => {
    if (syncing) return null;
    setSyncing(true);

    try {
      const { result, message } = await api.emails.refresh();

      showToast(message, result.gesperrt ? 'info' : 'success');

      // Das Zeitbudget einer Serverless-Funktion ist begrenzt. Wurde es
      // erreicht, ist das kein Fehler - der Cron holt den Rest.
      if (result.nochOffen && !result.gesperrt) {
        showToast(
          'Es sind noch Mails offen. Der automatische Abruf verarbeitet sie in den nächsten Minuten.',
          'info'
        );
      }

      for (const fehler of result.fehler ?? []) {
        showToast(`${fehler.postfach || 'Postfach'}: ${fehler.message}`, 'error');
      }

      await loadSettings();
      return result;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    } finally {
      setSyncing(false);
    }
  }, [syncing, showToast, loadSettings]);

  // --- Auf OAuth-Fenster reagieren -----------------------------------------

  useEffect(() => {
    function handleMessage(event) {
      // Nur Nachrichten aus dem eigenen Fenster akzeptieren.
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== 'maildraft-oauth') return;

      if (event.data.ok) {
        showToast('Konto wurde verbunden.', 'success');
        loadSettings().catch(() => {});
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [showToast, loadSettings]);

  const value = useMemo(
    () => ({
      settings,
      user: settings?.user ?? null,
      system: settings?.system ?? null,
      // In der Cloud gibt es keinen Zeitplan im Prozess - der Abruf laeuft
      // ueber einen externen Cron-Dienst. Die Oberflaeche zeigt deshalb nur,
      // wann zuletzt geprueft wurde, und verspricht keinen naechsten Termin,
      // den sie nicht kennt.
      sync: settings?.user
        ? {
            lastSyncAt: settings.user.last_sync_at,
            nextSyncAt: null,
            autoRefreshEnabled: settings.user.auto_refresh_enabled,
            intervalSeconds: settings.user.auto_refresh_interval,
          }
        : null,
      categories,
      loading,
      loadError,
      syncing,
      toasts,
      showToast,
      dismissToast,
      reload,
      loadSettings,
      loadCategories,
      refreshEmails,
      setSettings,
    }),
    [
      settings,
      categories,
      loading,
      loadError,
      syncing,
      toasts,
      showToast,
      dismissToast,
      reload,
      loadSettings,
      loadCategories,
      refreshEmails,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
