/**
 * Anmeldeseite.
 *
 * Eine einzige Schaltflaeche: Anmeldung ueber Google. Ein eigenes
 * Passwortverfahren waere hier nur zusaetzliche Angriffsflaeche - die App
 * arbeitet ohnehin mit Google-Konten, und ein Passwort weniger ist ein
 * Passwort weniger, das verloren gehen kann.
 */

import { useState } from 'react';
import { anmeldenMitGoogle } from '../api/supabase';
import { IconMail } from '../components/Icons';
import { Notice, Spinner } from '../components/ui';

export default function Login() {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(null);

  async function anmelden() {
    setLaeuft(true);
    setFehler(null);
    try {
      await anmeldenMitGoogle();
      // Der Browser wird zu Google weitergeleitet - ab hier passiert hier
      // nichts mehr.
    } catch (err) {
      setFehler(err.message);
      setLaeuft(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-white">
            <IconMail size={24} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-ink-950">MailDraft AI</h1>
            <p className="text-xs text-ink-600">Kundenservice-Antworten mit KI</p>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="mb-2 text-lg font-semibold text-ink-950">Anmelden</h2>
          <p className="mb-6 text-sm leading-relaxed text-ink-700">
            Melden Sie sich mit Ihrem Google-Konto an. Ihr Passwort geben Sie dabei
            ausschließlich bei Google ein — diese App bekommt es nie zu sehen.
          </p>

          {fehler && (
            <div className="mb-4">
              <Notice type="error" title="Anmeldung fehlgeschlagen">
                {fehler}
              </Notice>
            </div>
          )}

          <button type="button" onClick={anmelden} disabled={laeuft} className="btn-primary w-full">
            {laeuft ? <Spinner size={16} /> : null}
            {laeuft ? 'Weiterleitung zu Google …' : 'Mit Google anmelden'}
          </button>

          <p className="hint mt-4">
            Der Zugang ist auf freigegebene Adressen beschränkt. Erscheint nach der Anmeldung
            „Kein Zugang", bitten Sie den Betreiber, Ihre Adresse freizuschalten.
          </p>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Die App liest Ihren Posteingang und schreibt Antwortentwürfe.
          <br />
          Versendet wird ausschließlich, was Sie freigeben.
        </p>
      </div>
    </div>
  );
}
