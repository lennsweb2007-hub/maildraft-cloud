/**
 * Routing und Einstiegslogik.
 *
 * Drei Weichen entscheiden, was die Nutzerin sieht:
 *
 *  1. Wird die Anmeldung noch geprueft, kommt ein Ladebildschirm.
 *  2. Ohne Anmeldung fuehrt jeder Pfad zur Anmeldeseite.
 *  3. Ist der Einrichtungsassistent noch nicht abgeschlossen, fuehrt jeder
 *     Pfad dorthin - ein halb eingerichtetes Dashboard waere nur verwirrend.
 */

import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { supabase } from './api/supabase';
import { useApp } from './context/AppContext';
import Layout from './components/Layout';
import { ErrorState, LoadingState, ToastContainer } from './components/ui';

import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import DraftDetail from './pages/DraftDetail';
import History from './pages/History';
import Statistics from './pages/Statistics';
import Settings from './pages/Settings';

export default function App() {
  const [sitzung, setSitzung] = useState(undefined); // undefined = wird geprueft
  const { loading, loadError, user, reload, toasts, dismissToast } = useApp();
  const location = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSitzung(data.session ?? null));

    // Hoert auf An- und Abmeldung sowie auf erneuerte Tokens.
    const { data: abo } = supabase.auth.onAuthStateChange((_ereignis, neueSitzung) => {
      setSitzung(neueSitzung ?? null);
    });

    return () => abo.subscription.unsubscribe();
  }, []);

  // --- 1. Anmeldung wird geprueft ---
  if (sitzung === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <LoadingState text="Anmeldung wird geprüft …" />
      </div>
    );
  }

  // --- 2. Nicht angemeldet ---
  if (!sitzung) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // --- Profil wird geladen ---
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <LoadingState text="MailDraft AI wird geladen …" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
        <div className="card w-full max-w-lg">
          <ErrorState message={loadError} onRetry={() => reload().catch(() => {})} />
        </div>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // --- 3. Einrichtung noch offen ---
  const setupFertig = Boolean(user?.setup_completed);
  if (!setupFertig && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />

      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/drafts/:id" element={<DraftDetail />} />
        <Route path="/history" element={<History />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
