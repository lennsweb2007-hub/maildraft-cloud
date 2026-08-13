/**
 * Einrichtungsassistent - fünf Schritte beim ersten Start.
 *
 *   1. Willkommen und Markenname
 *   2. E-Mail-Konto verbinden (Gmail, Outlook oder IMAP)
 *   3. Szenarien anlegen
 *   4. Tonfall und Signatur
 *   5. Kategorien prüfen und abschließen
 *
 * Der Zustand liegt bewusst nicht komplett im Browser: Jeder Schritt speichert
 * sofort auf dem Server. Bricht die Einrichtung ab - Fenster zu, Stromausfall -,
 * ist nichts verloren, und der Assistent lässt sich dort fortsetzen, wo er
 * aufgehört hat.
 */

/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';

import api from '../api/client';
import { useApp } from '../context/AppContext';
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconLink,
  IconMail,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconX,
} from '../components/Icons';
import {
  CategoryBadge,
  ConfirmDialog,
  EmptyState,
  Notice,
  Spinner,
  StatusDot,
  ToastContainer,
} from '../components/ui';
import VoiceInput from '../components/VoiceInput';

const STEPS = [
  { id: 1, title: 'Willkommen', short: 'Start' },
  { id: 2, title: 'E-Mail-Konto verbinden', short: 'Konto' },
  { id: 3, title: 'Szenarien definieren', short: 'Szenarien' },
  { id: 4, title: 'Tonfall wählen', short: 'Tonfall' },
  { id: 5, title: 'Kategorien und Abschluss', short: 'Fertig' },
];

/** Vorschläge, damit niemand vor einem leeren Formular sitzt. */
const SCENARIO_TEMPLATES = [
  {
    title: 'Retourenfrage',
    trigger_keywords: 'rücksendung, retoure, zurückschicken, umtausch, zurückgeben',
    example_response:
      'vielen Dank für Ihre Nachricht.\n\nSelbstverständlich können Sie den Artikel innerhalb von 30 Tagen nach Erhalt zurücksenden. Legen Sie die Ware bitte ungetragen und mit Etikett in die Originalverpackung und nutzen Sie das beiliegende Retourenlabel.\n\nSobald das Paket bei uns eingetroffen ist, erstatten wir Ihnen den Betrag innerhalb von 5 Werktagen auf Ihr ursprüngliches Zahlungsmittel.\n\nBei Fragen melden Sie sich jederzeit gern.',
  },
  {
    title: 'Lieferstatus',
    trigger_keywords: 'wo ist meine bestellung, lieferung, versand, sendungsverfolgung, paket',
    example_response:
      'vielen Dank für Ihre Nachricht.\n\nIch habe Ihre Bestellung nachgesehen: Das Paket wurde bereits an unseren Versanddienstleister übergeben und ist auf dem Weg zu Ihnen. Üblicherweise dauert die Zustellung 2 bis 4 Werktage.\n\nDie Sendungsverfolgung haben Sie separat per E-Mail erhalten. Sollte das Paket nicht ankommen, melden Sie sich bitte kurz – dann kümmere ich mich sofort darum.',
  },
  {
    title: 'Größenberatung',
    trigger_keywords: 'größe, passform, size, fällt aus, maße, welche größe',
    example_response:
      'vielen Dank für Ihre Nachricht und Ihr Interesse.\n\nUnsere Artikel fallen grundsätzlich normal aus. Wenn Sie zwischen zwei Größen liegen, empfehle ich die größere – so sitzt das Stück angenehmer.\n\nIn der Größentabelle auf der Produktseite finden Sie die genauen Maße zum Nachmessen. Und falls die Größe doch nicht passt, ist der Umtausch für Sie kostenlos.',
  },
];

export default function Setup() {
  const navigate = useNavigate();
  const { user, categories, loadSettings, loadCategories, showToast, toasts, dismissToast } = useApp();

  const [step, setStep] = useState(1);
  const [accounts, setAccounts] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [finishing, setFinishing] = useState(false);

  /** Lädt Konten und Szenarien neu - nach jeder Änderung nötig. */
  async function reloadData() {
    const [accountData, scenarioData] = await Promise.all([
      api.accounts.list(),
      api.scenarios.list(),
    ]);
    setAccounts(accountData.items);
    setScenarios(scenarioData.items);
  }

  useEffect(() => {
    reloadData().catch((err) => showToast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Schließt die Einrichtung ab. */
  async function finish() {
    setFinishing(true);
    try {
      await api.settings.completeSetup();
      await loadSettings();
      showToast('Einrichtung abgeschlossen. Die ersten Mails werden abgerufen.', 'success');
      navigate('/dashboard');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setFinishing(false);
    }
  }

  const canContinue = {
    1: true,
    2: accounts.some((account) => account.is_active),
    3: scenarios.length > 0,
    4: true,
    5: true,
  }[step];

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
        {/* --- Kopf mit Fortschritt --- */}
        <header className="mb-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
              <IconMail size={21} />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-ink-950">MailDraft AI einrichten</h1>
              <p className="text-xs text-ink-600">
                Schritt {step} von {STEPS.length} &middot; {STEPS[step - 1].title}
              </p>
            </div>
          </div>

          <ol className="flex items-center gap-1.5">
            {STEPS.map((item) => {
              const done = item.id < step;
              const active = item.id === step;

              return (
                <li key={item.id} className="flex flex-1 flex-col gap-1.5">
                  <div
                    className={`h-1 rounded-full transition-colors ${
                      done ? 'bg-brand-500' : active ? 'bg-brand-400' : 'bg-ink-200'
                    }`}
                  />
                  <span
                    className={`text-[11px] ${
                      active ? 'font-medium text-brand-700' : 'text-ink-500'
                    }`}
                  >
                    {item.short}
                  </span>
                </li>
              );
            })}
          </ol>
        </header>

        {/* --- Inhalt --- */}
        <div className="flex-1">
          {step === 1 && <StepWelcome user={user} onSaved={loadSettings} />}
          {step === 2 && <StepAccounts accounts={accounts} onChanged={reloadData} />}
          {step === 3 && <StepScenarios scenarios={scenarios} onChanged={reloadData} />}
          {step === 4 && <StepTone user={user} onSaved={loadSettings} />}
          {step === 5 && (
            <StepCategories
              categories={categories}
              accounts={accounts}
              scenarios={scenarios}
              onChanged={loadCategories}
            />
          )}
        </div>

        {/* --- Navigation --- */}
        <footer className="mt-8 flex items-center justify-between border-t border-ink-200 pt-5">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            disabled={step === 1}
            className="btn-ghost"
          >
            <IconArrowLeft size={15} />
            Zurück
          </button>

          {step < STEPS.length ? (
            <button
              type="button"
              onClick={() => setStep((current) => current + 1)}
              disabled={!canContinue}
              className="btn-primary"
              title={canContinue ? undefined : 'Dieser Schritt ist noch nicht abgeschlossen'}
            >
              Weiter
            </button>
          ) : (
            <button type="button" onClick={finish} disabled={finishing} className="btn-primary">
              {finishing ? <Spinner size={15} /> : <IconCheck size={15} />}
              Einrichtung abschliessen
            </button>
          )}
        </footer>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Schritt 1: Willkommen
// ---------------------------------------------------------------------------

function StepWelcome({ user, onSaved }) {
  const { showToast } = useApp();
  const [brand, setBrand] = useState(user?.brand_name || '');
  const [saving, setSaving] = useState(false);

  /**
   * Speichert den Markennamen.
   *
   * Der Wert wird uebergeben statt aus dem State gelesen: Nach einer
   * Spracheingabe steht der neue Text im selben Durchlauf noch nicht im State,
   * und gespeichert wuerde der alte.
   */
  async function save(wert = brand) {
    if (!wert.trim()) return;
    setSaving(true);
    try {
      await api.settings.update({ brand_name: wert.trim() });
      await onSaved();
      showToast('Markenname gespeichert.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-6">
      <h2 className="mb-2 text-xl font-semibold text-ink-950">Willkommen bei MailDraft AI</h2>
      <p className="mb-6 text-sm leading-relaxed text-ink-700">
        Diese App liest Ihren Posteingang, schreibt zu jeder Kundenanfrage einen Antwortentwurf und
        legt ihn Ihnen zur Freigabe vor. Nichts wird ohne Ihren Klick versendet.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { title: 'Automatisch', text: 'Stündlicher Abruf im Hintergrund' },
          { title: 'In Ihrem Stil', text: 'Die KI lernt aus Ihren Beispielantworten' },
          { title: 'Lokal', text: 'Alle Daten bleiben auf diesem PC' },
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-ink-200 bg-ink-50/50 p-3.5">
            <p className="mb-1 text-sm font-medium text-brand-700">{item.title}</p>
            <p className="text-xs leading-relaxed text-ink-600">{item.text}</p>
          </div>
        ))}
      </div>

      <label className="label" htmlFor="brand">
        Wie heißt Ihre Marke?
      </label>
      <div className="flex gap-2">
        <input
          id="brand"
          className="input"
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
          onBlur={() => save()}
          placeholder="z.B. Nordlicht Studio"
        />
        <VoiceInput
          value={brand}
          onChange={(text) => {
            setBrand(text);
            save(text);
          }}
          mode="replace"
          fieldLabel="Markenname"
        />
        <button
          type="button"
          onClick={() => save()}
          disabled={saving || !brand.trim()}
          className="btn-secondary"
        >
          {saving ? <Spinner size={15} /> : 'Speichern'}
        </button>
      </div>
      <p className="hint">
        Der Name taucht im KI-Prompt auf, damit die Antworten zu Ihrem Geschäft passen.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Schritt 2: Konten
// ---------------------------------------------------------------------------

function StepAccounts({ accounts, onChanged }) {
  const { showToast } = useApp();
  const [providers, setProviders] = useState([]);
  const [showImapForm, setShowImapForm] = useState(false);
  const [connecting, setConnecting] = useState(null);

  useEffect(() => {
    api.accounts
      .providers()
      .then((data) => setProviders(data.items))
      .catch((err) => showToast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Öffnet die Anmeldeseite des Anbieters in einem eigenen Fenster. */
  async function startOAuth(provider) {
    setConnecting(provider);
    try {
      const { url } = await api.accounts.oauthUrl(provider);

      const popup = window.open(url, 'maildraft-oauth', 'width=560,height=720');
      if (!popup) {
        showToast('Der Browser hat das Anmeldefenster blockiert. Bitte Pop-ups erlauben.', 'error');
        return;
      }

      // Das Anmeldefenster meldet sich nicht zuverlässig zurück (der Nutzer
      // kann es auch einfach schließen). Deshalb pollen wir, bis es weg ist.
      const watcher = setInterval(async () => {
        if (!popup.closed) return;
        clearInterval(watcher);
        setConnecting(null);
        try {
          await onChanged();
        } catch {
          /* Fehler zeigt die Liste selbst */
        }
      }, 800);
    } catch (err) {
      showToast(err.message, 'error');
      setConnecting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold text-ink-950">E-Mail-Konto verbinden</h2>
        <p className="mb-5 text-sm leading-relaxed text-ink-700">
          Mindestens ein Konto wird benötigt. Sie können später jederzeit weitere hinzufügen -
          mehrere Postfächer laufen parallel.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              disabled={!provider.configured || connecting !== null}
              onClick={() =>
                provider.id === 'imap' ? setShowImapForm(true) : startOAuth(provider.id)
              }
              className="rounded-lg border border-ink-300 bg-ink-50/50 p-4 text-left transition-colors hover:border-brand-500 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-ink-300"
            >
              <div className="mb-2 flex items-center gap-2">
                <IconLink size={16} className="text-brand-600" />
                <span className="text-sm font-medium text-ink-900">{provider.name}</span>
                {connecting === provider.id && <Spinner size={13} className="text-brand-600" />}
              </div>
              <p className="text-xs leading-relaxed text-ink-600">
                {provider.configured
                  ? provider.id === 'imap'
                    ? 'Zugangsdaten selbst eingeben'
                    : 'Anmeldung im Browser'
                  : provider.hint}
              </p>
            </button>
          ))}
        </div>

        {providers
          .filter((provider) => !provider.configured)
          .map((provider) => (
            <div key={provider.id} className="mt-3">
              <OAuthSetupGuide provider={provider} />
            </div>
          ))}
      </div>

      {showImapForm && (
        <ImapForm
          onCancel={() => setShowImapForm(false)}
          onSaved={async () => {
            setShowImapForm(false);
            await onChanged();
          }}
        />
      )}

      <AccountList accounts={accounts} onChanged={onChanged} />
    </div>
  );
}

/**
 * Aufklappbare Einrichtungsanleitung für einen OAuth-Anbieter.
 *
 * Die Rückleitungsadresse kommt vom Server und nicht aus einer Konstante im
 * Frontend: Sie hängt vom konfigurierten Port ab, und eine falsch abgetippte
 * Adresse ist die häufigste Ursache für eine gescheiterte Anmeldung. Deshalb
 * gibt es sie hier zum Kopieren, nicht zum Abschreiben.
 */
function OAuthSetupGuide({ provider }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(provider.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Zwischenablage nicht verfügbar - der Text steht ohnehin lesbar da.
    }
  }

  return (
    <div className="rounded-lg border border-ink-300 bg-ink-50/40">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink-900">
            {provider.name} einrichten
          </span>
          <span className="block text-xs text-ink-600">
            Einmalig etwa zehn Minuten. Danach melden Sie sich direkt bei{' '}
            {provider.id === 'gmail' ? 'Google' : 'Microsoft'} an - Ihr Passwort sieht diese App
            nie.
          </span>
        </span>
        <IconChevronDown
          size={17}
          className={`shrink-0 text-ink-600 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-ink-200 px-4 py-4">
          <ol className="space-y-2.5">
            {provider.setupSteps.map((step, index) => (
              <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-ink-700">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-semibold text-ink-800">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <div>
            <p className="label text-xs">Diese Adresse dort eintragen</p>
            <div className="flex gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-ink-300 bg-ink-50 px-3 py-2 font-mono text-xs text-brand-700">
                {provider.redirectUri}
              </code>
              <button type="button" onClick={copyRedirect} className="btn-secondary shrink-0 text-xs">
                {copied ? <IconCheck size={14} /> : null}
                {copied ? 'Kopiert' : 'Kopieren'}
              </button>
            </div>
            <p className="hint">
              Muss zeichengenau übereinstimmen. Ein <span className="font-mono">127.0.0.1</span>{' '}
              statt <span className="font-mono">localhost</span> reicht schon, damit die Anmeldung
              mit &bdquo;redirect_uri_mismatch&ldquo; abbricht.
            </p>
          </div>

          <div>
            <p className="label text-xs">Danach in die Datei .env eintragen</p>
            <pre className="overflow-x-auto rounded-lg border border-ink-300 bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700">
              {provider.envKeys.map((key) => `${key}=...`).join('\n')}
            </pre>
            <p className="hint">
              Die .env liegt im Projektordner. Nach dem Speichern den Server neu starten - dann ist
              die Kachel oben anklickbar.
            </p>
          </div>

          <a
            href={provider.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary w-full text-xs"
          >
            <IconLink size={14} />
            {provider.id === 'gmail' ? 'Google Cloud Console' : 'Azure Portal'} oeffnen
          </a>
        </div>
      )}
    </div>
  );
}

/** Liste der bereits verbundenen Konten. */
function AccountList({ accounts, onChanged, compact = false }) {
  const { showToast } = useApp();
  const [busyId, setBusyId] = useState(null);
  const [toRemove, setToRemove] = useState(null);

  async function test(account) {
    setBusyId(account.id);
    try {
      const result = await api.accounts.test(account.id);
      showToast(
        result.ok ? `${account.email_address} ist erreichbar.` : result.error,
        result.ok ? 'success' : 'error'
      );
      await onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    setBusyId(toRemove.id);
    try {
      const { message } = await api.accounts.remove(toRemove.id);
      showToast(message, 'success');
      await onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
      setToRemove(null);
    }
  }

  if (accounts.length === 0) {
    return compact ? null : (
      <div className="card">
        <EmptyState
          icon={IconMail}
          title="Noch kein Konto verbunden"
          description="Wählen Sie oben einen Anbieter, um zu beginnen."
        />
      </div>
    );
  }

  return (
    <>
      <div className="card divide-y divide-ink-200">
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-900">{account.email_address}</p>
              <div className="mt-1 flex items-center gap-3">
                <span className="text-xs uppercase tracking-wide text-ink-500">
                  {account.provider}
                </span>
                <StatusDot status={account.status} />
              </div>
              {account.last_error && (
                <p className="mt-1.5 text-xs leading-relaxed text-red-600">{account.last_error}</p>
              )}
            </div>

            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => test(account)}
                disabled={busyId === account.id}
                className="btn-ghost text-xs"
              >
                {busyId === account.id ? <Spinner size={13} /> : 'Testen'}
              </button>
              <button
                type="button"
                onClick={() => setToRemove(account)}
                className="btn-ghost text-xs text-red-600 hover:bg-red-500/10"
              >
                <IconTrash size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(toRemove)}
        title="Konto wirklich trennen?"
        description={
          toRemove
            ? `${toRemove.email_address} wird entfernt. Offene Entwürfe dieses Kontos gehen verloren, die Versandhistorie bleibt erhalten.`
            : ''
        }
        confirmLabel="Trennen"
        danger
        busy={busyId === toRemove?.id}
        onConfirm={remove}
        onCancel={() => setToRemove(null)}
      />
    </>
  );
}

/** Formular für ein generisches IMAP-Konto. */
function ImapForm({ onCancel, onSaved }) {
  const { showToast } = useApp();
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: { imap_port: 993, smtp_port: 587 },
  });

  const email = watch('email_address');

  /** Trägt bekannte Serverdaten automatisch ein. */
  async function applySuggestion() {
    if (!email?.includes('@')) return;
    try {
      const { suggestion } = await api.accounts.suggestImap(email);
      if (!suggestion) return;

      setValue('imap_host', suggestion.imap_host);
      setValue('imap_port', suggestion.imap_port);
      setValue('smtp_host', suggestion.smtp_host);
      setValue('smtp_port', suggestion.smtp_port);
      showToast('Serverdaten wurden automatisch ergänzt.', 'info');
    } catch {
      // Kein Vorschlag vorhanden - der Nutzer trägt die Daten selbst ein.
    }
  }

  async function onSubmit(values) {
    setSaving(true);
    try {
      const { message } = await api.accounts.createImap(values);
      showToast(message, 'success');
      await onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink-950">IMAP-Konto einrichten</h3>
          <p className="mt-1 text-xs text-ink-600">
            Funktioniert mit GMX, Web.de, IONOS, Strato, Posteo und jedem anderen Anbieter.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="btn-ghost p-1">
          <IconX size={16} />
        </button>
      </div>

      <div>
        <label className="label" htmlFor="imap-email">
          E-Mail-Adresse
        </label>
        <input
          id="imap-email"
          className="input"
          placeholder="service@meine-marke.de"
          onBlurCapture={applySuggestion}
          {...register('email_address', {
            required: 'Die E-Mail-Adresse wird benötigt.',
            pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Das sieht nicht nach einer gültigen Adresse aus.' },
          })}
        />
        {errors.email_address && <p className="hint text-red-600">{errors.email_address.message}</p>}
      </div>

      <div>
        <label className="label" htmlFor="imap-password">
          Passwort
        </label>
        <input
          id="imap-password"
          type="password"
          className="input"
          autoComplete="off"
          {...register('password', { required: 'Das Passwort wird benötigt.' })}
        />
        {errors.password && <p className="hint text-red-600">{errors.password.message}</p>}
        <p className="hint">
          Wird verschlüsselt auf diesem PC gespeichert. Bei aktiver Zwei-Faktor-Anmeldung wird ein
          App-Passwort des Anbieters benötigt, nicht das normale Kennwort.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="imap-host">
            IMAP-Server (Posteingang)
          </label>
          <input
            id="imap-host"
            className="input"
            placeholder="imap.anbieter.de"
            {...register('imap_host', { required: 'Der IMAP-Server wird benötigt.' })}
          />
          {errors.imap_host && <p className="hint text-red-600">{errors.imap_host.message}</p>}
        </div>
        <div>
          <label className="label" htmlFor="imap-port">
            IMAP-Port
          </label>
          <input id="imap-port" type="number" className="input" {...register('imap_port')} />
        </div>
        <div>
          <label className="label" htmlFor="smtp-host">
            SMTP-Server (Postausgang)
          </label>
          <input
            id="smtp-host"
            className="input"
            placeholder="smtp.anbieter.de"
            {...register('smtp_host')}
          />
        </div>
        <div>
          <label className="label" htmlFor="smtp-port">
            SMTP-Port
          </label>
          <input id="smtp-port" type="number" className="input" {...register('smtp_port')} />
        </div>
      </div>

      <Notice type="info">
        Die Verbindung wird vor dem Speichern getestet. Stimmt etwas nicht, erscheint hier eine
        konkrete Meldung - gespeichert wird dann nichts.
      </Notice>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Abbrechen
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving && <Spinner size={15} />}
          {saving ? 'Verbindung wird geprüft ...' : 'Verbinden'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
//  Schritt 3: Szenarien
// ---------------------------------------------------------------------------

function StepScenarios({ scenarios, onChanged }) {
  const { showToast } = useApp();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  /** Übernimmt eine Vorlage als neues Szenario. */
  async function useTemplate(template) {
    setBusy(true);
    try {
      await api.scenarios.create(template);
      showToast(`Szenario "${template.title}" wurde angelegt.`, 'success');
      await onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(scenario) {
    try {
      await api.scenarios.remove(scenario.id);
      showToast(`"${scenario.title}" wurde gelöscht.`, 'success');
      await onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const usedTitles = new Set(scenarios.map((scenario) => scenario.title));

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold text-ink-950">Szenarien definieren</h2>
        <p className="text-sm leading-relaxed text-ink-700">
          Ein Szenario ist eine Beispielantwort für einen wiederkehrenden Fall. Die KI orientiert
          sich daran - je genauer Ihre Beispiele Ihren eigenen Stil treffen, desto weniger müssen
          Sie später nachbessern. Drei bis fünf Szenarien sind ein guter Anfang.
        </p>
      </div>

      {/* Vorlagen */}
      {SCENARIO_TEMPLATES.some((template) => !usedTitles.has(template.title)) && (
        <div className="card p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-800">
            <IconSparkles size={15} className="text-brand-600" />
            Vorlagen zum schnellen Start
          </p>
          <div className="flex flex-wrap gap-2">
            {SCENARIO_TEMPLATES.filter((template) => !usedTitles.has(template.title)).map((template) => (
              <button
                key={template.title}
                type="button"
                onClick={() => useTemplate(template)}
                disabled={busy}
                className="btn-secondary text-xs"
              >
                <IconPlus size={13} />
                {template.title}
              </button>
            ))}
          </div>
          <p className="hint">
            Vorlagen lassen sich nach dem Anlegen bearbeiten - passen Sie Fristen und Formulierungen
            an Ihre Bedingungen an.
          </p>
        </div>
      )}

      {/* Liste */}
      {scenarios.length > 0 && (
        <div className="card divide-y divide-ink-200">
          {scenarios.map((scenario) => (
            <div key={scenario.id} className="p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{scenario.title}</p>
                  {scenario.trigger_keywords.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {scenario.trigger_keywords.map((keyword) => (
                        <span
                          key={keyword}
                          className="rounded bg-ink-200 px-1.5 py-0.5 text-[11px] text-ink-700"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => setEditing(scenario)} className="btn-ghost text-xs">
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(scenario)}
                    className="btn-ghost text-xs text-red-600 hover:bg-red-500/10"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-600">
                {scenario.example_response.length > 220
                  ? `${scenario.example_response.slice(0, 220)}...`
                  : scenario.example_response}
              </p>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <ScenarioForm
          scenario={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditing('new')} className="btn-secondary w-full">
          <IconPlus size={15} />
          Eigenes Szenario anlegen
        </button>
      )}
    </div>
  );
}

/** Formular für ein Szenario - wird auch in den Einstellungen verwendet. */
export function ScenarioForm({ scenario, onCancel, onSaved }) {
  const { showToast, categories } = useApp();
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      title: scenario?.title || '',
      trigger_keywords: scenario?.trigger_keywords?.join(', ') || '',
      example_response: scenario?.example_response || '',
      category_id: scenario?.category_id || '',
    },
  });

  /*
   * Spracheingabe und react-hook-form zusammenbringen: Das Formular haelt den
   * Wert, deshalb wird er hier gelesen und zurueckgeschrieben. shouldDirty,
   * damit das Formular die Aenderung als solche erkennt.
   */
  const setzePerSprache = (feld) => (text) =>
    setValue(feld, text, { shouldDirty: true, shouldValidate: true });

  async function onSubmit(values) {
    setSaving(true);
    try {
      const payload = { ...values, category_id: values.category_id || null };

      if (scenario) {
        await api.scenarios.update(scenario.id, payload);
        showToast('Szenario aktualisiert.', 'success');
      } else {
        await api.scenarios.create(payload);
        showToast('Szenario angelegt.', 'success');
      }

      await onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
      <div className="flex items-start justify-between">
        <h3 className="text-base font-semibold text-ink-950">
          {scenario ? 'Szenario bearbeiten' : 'Neues Szenario'}
        </h3>
        <button type="button" onClick={onCancel} className="btn-ghost p-1">
          <IconX size={16} />
        </button>
      </div>

      <div>
        <label className="label" htmlFor="scenario-title">
          Titel
        </label>
        <div className="flex gap-2">
          <input
            id="scenario-title"
            className="input"
            placeholder="z.B. Retourenfrage"
            {...register('title', { required: 'Ein Titel wird benötigt.' })}
          />
          <VoiceInput
            value={watch('title')}
            onChange={setzePerSprache('title')}
            mode="replace"
            fieldLabel="Titel des Szenarios"
          />
        </div>
        {errors.title && <p className="hint text-red-600">{errors.title.message}</p>}
      </div>

      <div>
        <label className="label" htmlFor="scenario-keywords">
          Stichwörter
        </label>
        <input
          id="scenario-keywords"
          className="input"
          placeholder="rücksendung, retoure, zurückschicken"
          {...register('trigger_keywords')}
        />
        <p className="hint">
          Durch Komma getrennt. Sie helfen der Zuordnung und dienen als Rückfallebene, wenn die KI
          gerade nicht erreichbar ist.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="scenario-category">
          Bevorzugte Kategorie (optional)
        </label>
        <select id="scenario-category" className="input" {...register('category_id')}>
          <option value="">Keine Vorgabe</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="label" htmlFor="scenario-example">
            Beispielantwort
          </label>
          <VoiceInput
            value={watch('example_response')}
            onChange={setzePerSprache('example_response')}
            fieldLabel="Beispielantwort"
            className="-mt-1"
          />
        </div>
        <textarea
          id="scenario-example"
          rows={9}
          className="input font-mono text-[13px] leading-relaxed"
          placeholder={'vielen Dank für Ihre Nachricht.\n\n...'}
          {...register('example_response', {
            required: 'Eine Beispielantwort wird benötigt.',
            minLength: { value: 20, message: 'Bitte mindestens ein bis zwei vollständige Sätze.' },
          })}
        />
        {errors.example_response && (
          <p className="hint text-red-600">{errors.example_response.message}</p>
        )}
        <p className="hint">
          Schreiben Sie so, wie Sie tatsächlich antworten würden - ohne Anrede und ohne Signatur.
          Beides ergänzt die App automatisch.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Abbrechen
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving && <Spinner size={15} />}
          Speichern
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
//  Schritt 4: Tonfall
// ---------------------------------------------------------------------------

const TONE_OPTIONS = [
  {
    id: 'formal',
    name: 'Formal',
    description: 'Geschäftlich und zurückhaltend. Vollständige Sätze, keine Emojis.',
    sample: 'Sehr geehrte Frau Weber,\n\nvielen Dank für Ihre Anfrage. Gern teile ich Ihnen mit ...',
  },
  {
    id: 'freundlich',
    name: 'Freundlich',
    description: 'Warm und nahbar, aber professionell. Für die meisten Marken die richtige Wahl.',
    sample: 'Hallo Frau Weber,\n\nvielen Dank für Ihre Nachricht! Das kläre ich gern für Sie ...',
  },
  {
    id: 'technisch',
    name: 'Technisch',
    description: 'Sachlich und präzise. Konkrete Schritte, Nummern und Fristen.',
    sample: 'Guten Tag Frau Weber,\n\nzu Ihrer Anfrage: Die Retoure erfolgt in drei Schritten ...',
  },
  {
    id: 'custom',
    name: 'Eigener Ton',
    description: 'Sie beschreiben selbst, wie die Antworten klingen sollen.',
    sample: null,
  },
];

function StepTone({ user, onSaved }) {
  const { showToast } = useApp();
  const [tone, setTone] = useState(user?.tone || 'freundlich');
  const [customTone, setCustomTone] = useState(user?.custom_tone || '');
  const [signature, setSignature] = useState(user?.signature || '');
  const [saving, setSaving] = useState(false);

  async function save(next = {}) {
    setSaving(true);
    try {
      await api.settings.update({
        tone: next.tone ?? tone,
        custom_tone: next.customTone ?? customTone,
        signature: next.signature ?? signature,
      });
      await onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold text-ink-950">Tonfall wählen</h2>
        <p className="mb-5 text-sm leading-relaxed text-ink-700">
          Der Ton gilt für alle Entwürfe. Einzelne Szenarien können später davon abweichen.
        </p>

        <div className="space-y-2.5">
          {TONE_OPTIONS.map((option) => (
            <label
              key={option.id}
              className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
                tone === option.id
                  ? 'border-brand-500 bg-brand-500/10'
                  : 'border-ink-300 bg-ink-50/40 hover:border-ink-400'
              }`}
            >
              <input
                type="radio"
                name="tone"
                value={option.id}
                checked={tone === option.id}
                onChange={() => {
                  setTone(option.id);
                  save({ tone: option.id });
                }}
                className="mt-0.5 accent-brand-500"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">{option.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{option.description}</p>
                {option.sample && tone === option.id && (
                  <pre className="mt-2.5 whitespace-pre-wrap rounded bg-ink-50 p-2.5 font-mono text-[11px] leading-relaxed text-ink-700">
                    {option.sample}
                  </pre>
                )}
              </div>
            </label>
          ))}
        </div>

        {tone === 'custom' && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <label className="label" htmlFor="custom-tone">
                Beschreiben Sie den gewünschten Ton
              </label>
              <VoiceInput
                value={customTone}
                onChange={(text) => {
                  setCustomTone(text);
                  save({ customTone: text });
                }}
                fieldLabel="Eigener Tonfall"
                className="-mt-1"
              />
            </div>
            <textarea
              id="custom-tone"
              rows={3}
              className="input"
              value={customTone}
              onChange={(event) => setCustomTone(event.target.value)}
              onBlur={() => save()}
              placeholder="z.B. Locker und persönlich, duzen, kurze Sätze, gern mal ein Wortspiel."
            />
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between gap-2">
          <label className="label" htmlFor="signature">
            Signatur
          </label>
          <VoiceInput
            value={signature}
            onChange={(text) => {
              setSignature(text);
              save({ signature: text });
            }}
            fieldLabel="Signatur"
            className="-mt-1"
          />
        </div>
        <textarea
          id="signature"
          rows={4}
          className="input font-mono text-[13px]"
          value={signature}
          onChange={(event) => setSignature(event.target.value)}
          onBlur={() => save()}
          placeholder={'Herzliche Grüße\nAnna Beispiel\nNordlicht Studio'}
        />
        <p className="hint">
          Wird automatisch an jeden Entwurf angehängt. Die KI schreibt selbst keine Signatur -
          so bleibt sie exakt so, wie Sie sie hier eintragen.
        </p>
        {saving && <p className="hint">Wird gespeichert ...</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Schritt 5: Kategorien und Abschluss
// ---------------------------------------------------------------------------

function StepCategories({ categories, accounts, scenarios, onChanged }) {
  const { showToast } = useApp();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.categories.create({ name: name.trim() });
      setName('');
      await onChanged();
      showToast('Kategorie angelegt.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(category) {
    try {
      const { message } = await api.categories.remove(category.id);
      showToast(message, 'success');
      await onChanged();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const activeAccounts = accounts.filter((account) => account.is_active);

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h2 className="mb-2 text-lg font-semibold text-ink-950">Kategorien</h2>
        <p className="mb-5 text-sm leading-relaxed text-ink-700">
          Jede eingehende Mail wird automatisch einer Kategorie zugeordnet. Die vier
          Standardkategorien decken die meisten Fälle ab - ergänzen Sie, was Ihnen fehlt.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          {categories.map((category) => (
            <span key={category.id} className="group inline-flex items-center gap-1">
              <CategoryBadge name={category.name} color={category.color} icon={category.icon} />
              <button
                type="button"
                onClick={() => remove(category)}
                className="rounded p-0.5 text-ink-500 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                aria-label={`${category.name} löschen`}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder="Neue Kategorie, z.B. Reklamation"
          />
          <button type="button" onClick={add} disabled={saving || !name.trim()} className="btn-secondary">
            {saving ? <Spinner size={15} /> : <IconPlus size={15} />}
            Hinzufuegen
          </button>
        </div>
      </div>

      {/* Zusammenfassung */}
      <div className="card p-6">
        <h3 className="mb-4 text-base font-semibold text-ink-950">Alles bereit</h3>

        <dl className="space-y-2.5 text-sm">
          <SummaryRow
            label="E-Mail-Konten"
            value={
              activeAccounts.length > 0
                ? activeAccounts.map((account) => account.email_address).join(', ')
                : 'keines'
            }
            ok={activeAccounts.length > 0}
          />
          <SummaryRow
            label="Szenarien"
            value={`${scenarios.length} ${scenarios.length === 1 ? 'Szenario' : 'Szenarien'}`}
            ok={scenarios.length > 0}
          />
          <SummaryRow label="Kategorien" value={`${categories.length}`} ok={categories.length > 0} />
        </dl>

        <div className="mt-5">
          <Notice type="info" title="Was jetzt passiert">
            Nach dem Abschluss wird sofort der erste Abruf gestartet. Danach prüft die App
            stündlich automatisch nach neuen Mails. Sie können das Intervall in den Einstellungen
            ändern.
          </Notice>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink-200 pb-2.5 last:border-0">
      <dt className="text-ink-600">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className="truncate text-ink-900">{value}</span>
        <span className={ok ? 'text-emerald-600' : 'text-amber-600'}>
          {ok ? <IconCheck size={15} /> : <IconX size={15} />}
        </span>
      </dd>
    </div>
  );
}

export { AccountList, ImapForm, OAuthSetupGuide };
