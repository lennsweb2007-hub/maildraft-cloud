/**
 * Einstellungen.
 *
 * Vier Bereiche als Reiter: Konten, Szenarien, Kategorien, Allgemein.
 * Die Formulare aus dem Setup-Wizard werden hier wiederverwendet - eine zweite
 * Fassung derselben Eingabemaske wäre nur eine weitere Stelle, an der man
 * Änderungen vergisst.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import api from '../api/client';
import { useApp } from '../context/AppContext';
import { AccountList, ImapForm, OAuthSetupGuide, ScenarioForm } from './Setup';
import {
  IconDatabase,
  IconLink,
  IconMail,
  IconPlus,
  IconSparkles,
  IconTag,
  IconTrash,
} from '../components/Icons';
import {
  CategoryBadge,
  ConfirmDialog,
  LoadingState,
  Notice,
  Spinner,
} from '../components/ui';
import { formatInterval } from '../utils/format';

const TABS = [
  { id: 'accounts', label: 'E-Mail-Konten', icon: IconMail },
  { id: 'scenarios', label: 'Szenarien', icon: IconSparkles },
  { id: 'categories', label: 'Kategorien', icon: IconTag },
  { id: 'general', label: 'Allgemein', icon: IconDatabase },
];

export default function Settings() {
  const [tab, setTab] = useState('accounts');

  return (
    <div className="p-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold text-ink-50">Einstellungen</h1>
        <p className="mt-0.5 text-sm text-ink-400">
          Konten, Antwortvorlagen und Verhalten der App
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-ink-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-brand-500 text-brand-300'
                : 'border-transparent text-ink-400 hover:text-ink-200'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'accounts' && <AccountsTab />}
      {tab === 'scenarios' && <ScenariosTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'general' && <GeneralTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Konten
// ---------------------------------------------------------------------------

function AccountsTab() {
  const { showToast } = useApp();
  const [accounts, setAccounts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [showImapForm, setShowImapForm] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [accountData, providerData] = await Promise.all([
        api.accounts.list(),
        api.accounts.providers(),
      ]);
      setAccounts(accountData.items);
      setProviders(providerData.items);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startOAuth(provider) {
    try {
      const { url } = await api.accounts.oauthUrl(provider);
      const popup = window.open(url, 'maildraft-oauth', 'width=560,height=720');

      if (!popup) {
        showToast('Der Browser hat das Anmeldefenster blockiert. Bitte Pop-ups erlauben.', 'error');
        return;
      }

      const watcher = setInterval(() => {
        if (popup.closed) {
          clearInterval(watcher);
          load();
        }
      }, 800);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (loading) return <LoadingState />;

  const needsReauth = accounts.filter((account) => account.status === 'needs_reauth');

  return (
    <div className="space-y-4">
      {needsReauth.length > 0 && (
        <Notice type="warning" title="Anmeldung abgelaufen">
          {needsReauth.map((account) => account.email_address).join(', ')} muss neu verbunden werden.
          Bis dahin werden fuer dieses Konto keine Mails abgerufen. Waehlen Sie den Anbieter unten
          erneut aus - bestehende Entwuerfe bleiben erhalten.
        </Notice>
      )}

      <AccountList accounts={accounts} onChanged={load} />

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-100">Weiteres Konto verbinden</h2>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              disabled={!provider.configured}
              onClick={() =>
                provider.id === 'imap' ? setShowImapForm(true) : startOAuth(provider.id)
              }
              className="rounded-lg border border-ink-700 bg-ink-950/50 p-3.5 text-left transition-colors hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-ink-700"
            >
              <span className="mb-1 flex items-center gap-2 text-sm font-medium text-ink-100">
                <IconLink size={15} className="text-brand-400" />
                {provider.name}
              </span>
              <span className="block text-xs leading-relaxed text-ink-400">
                {provider.configured ? 'Verbinden' : provider.hint}
              </span>
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
            await load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Szenarien
// ---------------------------------------------------------------------------

function ScenariosTab() {
  const { showToast } = useApp();
  const [scenarios, setScenarios] = useState([]);
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await api.scenarios.list();
      setScenarios(data.items);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove() {
    try {
      const { message } = await api.scenarios.remove(toDelete.id);
      showToast(message, 'success');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setToDelete(null);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Notice type="info">
        Die KI orientiert sich an diesen Beispielantworten. Wenn Entwürfe regelmäßig danebenliegen,
        liegt es fast immer an den Szenarien - dort nachzuschärfen wirkt schneller als jede
        Einstellung.
      </Notice>

      {scenarios.length > 0 && (
        <div className="card divide-y divide-ink-800">
          {scenarios.map((scenario) => (
            <div key={scenario.id} className="p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100">{scenario.title}</p>
                  {scenario.trigger_keywords.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {scenario.trigger_keywords.map((keyword) => (
                        <span
                          key={keyword}
                          className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(scenario)}
                    className="btn-ghost text-xs"
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete(scenario)}
                    className="btn-ghost text-xs text-red-400 hover:bg-red-500/10"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-400">
                {scenario.example_response.length > 260
                  ? `${scenario.example_response.slice(0, 260)}...`
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
            await load();
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditing('new')} className="btn-secondary w-full">
          <IconPlus size={15} />
          Neues Szenario
        </button>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Szenario löschen?"
        description={
          toDelete
            ? `"${toDelete.title}" wird entfernt. Bereits erstellte Entwürfe bleiben unverändert.`
            : ''
        }
        confirmLabel="Löschen"
        danger
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Kategorien
// ---------------------------------------------------------------------------

function CategoriesTab() {
  const { categories, loadCategories, showToast } = useApp();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.categories.create({ name: name.trim() });
      setName('');
      await loadCategories();
      showToast('Kategorie angelegt.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function rename(category) {
    if (!editName.trim() || editName.trim() === category.name) {
      setEditing(null);
      return;
    }
    try {
      await api.categories.update(category.id, { name: editName.trim() });
      await loadCategories();
      showToast('Kategorie umbenannt.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setEditing(null);
    }
  }

  async function remove() {
    try {
      const { message } = await api.categories.remove(toDelete.id);
      showToast(message, 'success');
      await loadCategories();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setToDelete(null);
    }
  }

  return (
    <div className="space-y-4">
      <Notice type="info">
        Die KI ordnet jede eingehende Mail einer dieser Kategorien zu. Neue Kategorien bekommen
        automatisch eine Farbe aus der geprüften Palette - so bleiben die Diagramme auch bei
        Farbsehschwäche lesbar.
      </Notice>

      <div className="card divide-y divide-ink-800">
        {categories.map((category) => (
          <div key={category.id} className="flex items-center gap-3 p-3.5">
            {editing === category.id ? (
              <input
                className="input"
                value={editName}
                autoFocus
                onChange={(event) => setEditName(event.target.value)}
                onBlur={() => rename(category)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') rename(category);
                  if (event.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditing(category.id);
                  setEditName(category.name);
                }}
                className="flex flex-1 items-center gap-3 text-left"
              >
                <CategoryBadge name={category.name} color={category.color} icon={category.icon} />
                {category.is_default === 1 && (
                  <span className="text-[11px] text-ink-500">Standard</span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setToDelete(category)}
              className="btn-ghost p-1.5 text-red-400 hover:bg-red-500/10"
              aria-label={`${category.name} löschen`}
            >
              <IconTrash size={15} />
            </button>
          </div>
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
          placeholder="Neue Kategorie"
        />
        <button type="button" onClick={add} disabled={saving || !name.trim()} className="btn-secondary">
          {saving ? <Spinner size={15} /> : <IconPlus size={15} />}
          Hinzufuegen
        </button>
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Kategorie löschen?"
        description={
          toDelete
            ? `"${toDelete.name}" wird entfernt. Zugeordnete Mails erscheinen danach unter "Ohne Kategorie" - es gehen keine Daten verloren.`
            : ''
        }
        confirmLabel="Löschen"
        danger
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Allgemein
// ---------------------------------------------------------------------------

const INTERVALS = [
  { value: 900, label: '15 Minuten' },
  { value: 1800, label: '30 Minuten' },
  { value: 3600, label: '1 Stunde' },
  { value: 10800, label: '3 Stunden' },
  { value: 21600, label: '6 Stunden' },
  { value: 43200, label: '12 Stunden' },
];

const TONES = [
  { id: 'formal', label: 'Formal' },
  { id: 'freundlich', label: 'Freundlich' },
  { id: 'technisch', label: 'Technisch' },
  { id: 'custom', label: 'Eigener Ton' },
];

function GeneralTab() {
  const { user, system, loadSettings, showToast } = useApp();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    brand_name: user?.brand_name || '',
    tone: user?.tone || 'freundlich',
    custom_tone: user?.custom_tone || '',
    signature: user?.signature || '',
    auto_refresh_interval: user?.auto_refresh_interval || 3600,
    auto_refresh_enabled: Boolean(user?.auto_refresh_enabled),
    relevance_filter_enabled: user?.relevance_filter_enabled !== false,
    business_context: user?.business_context || '',
    // Im Formular eine Zeile pro Eintrag - deutlich angenehmer zu pflegen
    // als eine Komma-Liste.
    blocked_senders: (user?.blocked_senders || []).join('\n'),
  });

  const [saving, setSaving] = useState(false);
  const [aiTest, setAiTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);


  function set(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.settings.update({
        ...form,
        // Zeilen zu einer Liste machen; der Server bereinigt und entdoppelt.
        blocked_senders: form.blocked_senders
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean),
      });
      await loadSettings();
      showToast('Einstellungen gespeichert.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testAi() {
    setTesting(true);
    setAiTest(null);
    try {
      setAiTest(await api.settings.testAi());
    } catch (err) {
      setAiTest({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  }


  async function resetSetup() {
    try {
      await api.settings.resetSetup();
      await loadSettings();
      navigate('/setup');
    } catch (err) {
      showToast(err.message, 'error');
      setConfirmReset(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* --- Antwortverhalten --- */}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-100">Antwortverhalten</h2>

        <div>
          <label className="label" htmlFor="set-brand">
            Markenname
          </label>
          <input
            id="set-brand"
            className="input"
            value={form.brand_name}
            onChange={(event) => set('brand_name', event.target.value)}
          />
        </div>

        <div>
          <span className="label">Tonfall</span>
          <div className="flex flex-wrap gap-2">
            {TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                onClick={() => set('tone', tone.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  form.tone === tone.id
                    ? 'border-brand-500 bg-brand-500/15 text-brand-200'
                    : 'border-ink-700 text-ink-300 hover:border-ink-600'
                }`}
              >
                {tone.label}
              </button>
            ))}
          </div>
        </div>

        {form.tone === 'custom' && (
          <div>
            <label className="label" htmlFor="set-custom-tone">
              Eigener Tonfall
            </label>
            <textarea
              id="set-custom-tone"
              rows={3}
              className="input"
              value={form.custom_tone}
              onChange={(event) => set('custom_tone', event.target.value)}
              placeholder="z.B. Locker und persönlich, duzen, kurze Sätze."
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="set-signature">
            Signatur
          </label>
          <textarea
            id="set-signature"
            rows={4}
            className="input font-mono text-[13px]"
            value={form.signature}
            onChange={(event) => set('signature', event.target.value)}
          />
          <p className="hint">Wird an jeden neuen Entwurf angehängt.</p>
        </div>
      </section>

      {/* --- Relevanzprüfung --- */}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-100">Relevanzprüfung</h2>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={form.relevance_filter_enabled}
            onChange={(event) => set('relevance_filter_enabled', event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span>
            <span className="block text-sm text-ink-100">
              Vor der Entwurfserstellung prüfen, ob es überhaupt Kundenservice ist
            </span>
            <span className="block text-xs leading-relaxed text-ink-400">
              Rechnungen, Zahlungsbenachrichtigungen, Newsletter und Werbung bekommen keinen
              Entwurf, sondern landen im Reiter &bdquo;Aussortiert&ldquo;. Ohne diese Prüfung
              erzeugt die App zu jeder ungelesenen Mail eine Antwort.
            </span>
          </span>
        </label>

        <div>
          <label className="label" htmlFor="set-context">
            Was macht Ihr Geschäft, und was ist für Sie Kundenservice?
          </label>
          <textarea
            id="set-context"
            rows={5}
            className="input"
            value={form.business_context}
            disabled={!form.relevance_filter_enabled}
            onChange={(event) => set('business_context', event.target.value)}
            placeholder={
              'z.B. Wir verkaufen Damenmode aus Leinen über unseren eigenen Onlineshop und über Etsy.\n' +
              'Kundenservice heißt bei uns: Fragen zu Bestellungen, Lieferung, Retouren, Größen und Produkten.\n' +
              'Anfragen von Boutiquen und Wiederverkäufern sind ebenfalls wichtig.\n' +
              'Nicht relevant: Buchhaltung, Steuerberater, Zahlungsdienste, Werbung.'
            }
          />
          <p className="hint">
            Der wirksamste Hebel gegen Fehleinschätzungen. Je konkreter Sie beschreiben, was bei
            Ihnen als Kundenanfrage zählt und was nicht, desto sauberer trennt die KI.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="set-blocked">
            Absender immer aussortieren
          </label>
          <textarea
            id="set-blocked"
            rows={4}
            className="input font-mono text-[13px]"
            value={form.blocked_senders}
            disabled={!form.relevance_filter_enabled}
            onChange={(event) => set('blocked_senders', event.target.value)}
            placeholder={'paypal.de\nlexoffice.de\nwerbung@agentur-xy.de'}
          />
          <p className="hint">
            Eine Angabe pro Zeile. Eine ganze Domain (<span className="font-mono">paypal.de</span>)
            oder eine einzelne Adresse. Diese Mails kosten keine KI-Anfrage und landen sofort im
            Reiter &bdquo;Aussortiert&ldquo;.
          </p>
        </div>
      </section>

      {/* --- Abruf --- */}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-100">Automatischer Abruf</h2>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={form.auto_refresh_enabled}
            onChange={(event) => set('auto_refresh_enabled', event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span>
            <span className="block text-sm text-ink-100">
              E-Mails automatisch im Hintergrund abrufen
            </span>
            <span className="block text-xs text-ink-400">
              Ist das aus, passiert nur beim Klick auf &bdquo;Jetzt prüfen&ldquo; etwas.
            </span>
          </span>
        </label>

        <div>
          <label className="label" htmlFor="set-interval">
            Abrufintervall
          </label>
          <select
            id="set-interval"
            className="input w-auto"
            value={form.auto_refresh_interval}
            disabled={!form.auto_refresh_enabled}
            onChange={(event) => set('auto_refresh_interval', Number(event.target.value))}
          >
            {INTERVALS.map((interval) => (
              <option key={interval.value} value={interval.value}>
                {interval.label}
              </option>
            ))}
          </select>
          <p className="hint">
            Derzeit: alle {formatInterval(user?.auto_refresh_interval)}. Kuerzere Intervalle bringen
            bei 30 bis 50 Mails am Tag keinen Vorteil und belasten nur die Kontingente der Anbieter.
          </p>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className="btn-primary">
          {saving && <Spinner size={15} />}
          Einstellungen speichern
        </button>
      </div>

      {/* --- KI --- */}
      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-100">KI-Verbindung</h2>
            <p className="mt-0.5 text-xs text-ink-400">
              Modell: <span className="font-mono">{system?.aiModel}</span>
            </p>
          </div>
          <button type="button" onClick={testAi} disabled={testing} className="btn-secondary">
            {testing ? <Spinner size={15} /> : null}
            Verbindung testen
          </button>
        </div>

        {aiTest && (
          <Notice
            type={aiTest.ok ? 'success' : 'error'}
            title={aiTest.ok ? 'Gemini antwortet' : 'Gemini ist nicht erreichbar'}
          >
            {aiTest.ok
              ? `Das Modell ${aiTest.model} hat geantwortet. Entwürfe können erzeugt werden.`
              : aiTest.error}
          </Notice>
        )}

        {!system?.aiConfigured && (
          <Notice type="warning" title="Kein API-Schlüssel hinterlegt">
            Ohne GEMINI_API_KEY in der .env erstellt die App nur Vorlagen aus den Szenarien statt
            echter KI-Entwürfe. Der Schlüssel ist kostenlos: aistudio.google.com/apikey
          </Notice>
        )}
      </section>

      {/* --- Daten --- */}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-100">Daten und Sicherung</h2>

        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">Angemeldet als</dt>
            <dd className="truncate text-ink-300">{user?.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">KI-Modell (Entwürfe)</dt>
            <dd className="truncate font-mono text-ink-300">{system?.aiModel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">KI-Modell (Relevanzprüfung)</dt>
            <dd className="truncate font-mono text-ink-300">{system?.aiTriageModel}</dd>
          </div>
        </dl>

        <Notice type="info" title="Sicherung übernimmt Supabase">
          Anders als in der lokalen Fassung macht die App keine eigenen Backups mehr - die
          Datenbank sichert sich selbst. Ihre Daten sind durch Zugriffsregeln in der Datenbank
          von denen anderer Nutzer getrennt: Jede Abfrage sieht ausschließlich eigene Zeilen.
          Zugangsdaten zu Ihren Postfächern liegen verschlüsselt vor.
        </Notice>
      </section>

      {/* --- Zurücksetzen --- */}
      <section className="card p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink-100">Einrichtung erneut durchlaufen</h2>
        <p className="mb-3 text-xs leading-relaxed text-ink-400">
          Startet den Einrichtungsassistenten neu. Konten, Szenarien, Entwürfe und die Historie
          bleiben dabei vollständig erhalten.
        </p>
        <button type="button" onClick={() => setConfirmReset(true)} className="btn-secondary">
          Assistent neu starten
        </button>
      </section>

      <ConfirmDialog
        open={confirmReset}
        title="Assistent neu starten?"
        description="Sie werden zum Einrichtungsassistenten geleitet. Es gehen keine Daten verloren."
        confirmLabel="Starten"
        onConfirm={resetSetup}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
