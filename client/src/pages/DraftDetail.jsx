/**
 * Detailansicht eines Entwurfs.
 *
 * Links die Kundenmail, rechts der bearbeitbare Entwurf - nebeneinander,
 * damit man beim Anpassen nicht scrollen muss.
 *
 * Ungespeicherte Änderungen werden mitverfolgt und beim Verlassen der Seite
 * abgefragt. Beim Senden wird der aktuelle Text ohnehin mitgeschickt, ein
 * vergessenes Speichern kann also keinen Schaden anrichten.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import api from '../api/client';
import { useApp } from '../context/AppContext';
import {
  IconArrowLeft,
  IconMail,
  IconSave,
  IconSend,
  IconSparkles,
  IconTrash,
} from '../components/Icons';
import {
  CategoryBadge,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  Notice,
  Spinner,
} from '../components/ui';
import { colorFor, formatDateTime, initialsOf } from '../utils/format';

export default function DraftDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { categories, showToast } = useApp();

  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const textareaRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.drafts.get(id);
      setDraft(data);
      setBody(data.body_draft || '');
      setSubject(data.subject || '');
      setCategoryId(data.category_id || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty =
    draft &&
    (body !== (draft.body_draft || '') ||
      subject !== (draft.subject || '') ||
      categoryId !== (draft.category_id || ''));

  // Warnt beim Schließen des Fensters, wenn noch etwas ungespeichert ist.
  useEffect(() => {
    if (!dirty) return undefined;

    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Strg+S speichert, Strg+Enter sendet - beides spart bei 40 Mails am Tag
  // spürbar Zeit.
  useEffect(() => {
    function onKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey)) return;

      if (event.key === 's') {
        event.preventDefault();
        if (dirty) save();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        send();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, body, subject, categoryId]);

  async function save() {
    if (!body.trim()) {
      showToast('Der Entwurf darf nicht leer sein.', 'error');
      return;
    }

    setSaving(true);
    try {
      const updated = await api.drafts.update(id, {
        body_draft: body,
        subject,
        category_id: categoryId || null,
      });
      setDraft(updated);
      showToast('Änderungen gespeichert.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    if (!body.trim()) {
      showToast('Ein leerer Entwurf kann nicht versendet werden.', 'error');
      return;
    }

    setSending(true);
    try {
      // Der aktuelle Text geht direkt mit - so kann nichts verloren gehen.
      const { message } = await api.drafts.send(id, { body_draft: body, subject });
      showToast(message, 'success');
      navigate('/dashboard');
    } catch (err) {
      showToast(err.message, 'error');
      await load();
    } finally {
      setSending(false);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const { draft: updated } = await api.drafts.regenerate(id);
      setDraft(updated);
      setBody(updated.body_draft || '');
      setCategoryId(updated.category_id || '');
      showToast('Die KI hat einen neuen Entwurf geschrieben.', 'success');
      textareaRef.current?.focus();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setRegenerating(false);
    }
  }

  async function remove() {
    try {
      await api.drafts.remove(id);
      showToast('Entwurf verworfen.', 'success');
      navigate('/dashboard');
    } catch (err) {
      showToast(err.message, 'error');
      setConfirmDelete(false);
    }
  }

  function goBack() {
    if (dirty && !window.confirm('Es gibt ungespeicherte Änderungen. Trotzdem zurück?')) return;
    navigate('/dashboard');
  }

  if (loading) return <LoadingState text="Entwurf wird geladen ..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!draft) return null;

  const readOnly = draft.status === 'sent';

  return (
    <div className="p-6">
      {/* --- Kopfzeile --- */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <button type="button" onClick={goBack} className="btn-ghost mt-0.5 p-1.5">
            <IconArrowLeft size={17} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-ink-50">{draft.subject}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-400">
              <span>
                von {draft.from_name ? `${draft.from_name} (${draft.from_email})` : draft.from_email}
              </span>
              <span aria-hidden="true">&middot;</span>
              <span>{formatDateTime(draft.received_at || draft.created_at)}</span>
              {draft.account_email && (
                <>
                  <span aria-hidden="true">&middot;</span>
                  <span>an {draft.account_email}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {!readOnly && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating || sending}
              className="btn-secondary"
              title="Die KI schreibt den Entwurf komplett neu"
            >
              {regenerating ? <Spinner size={15} /> : <IconSparkles size={15} />}
              Neu generieren
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving || sending}
              className="btn-secondary"
              title="Strg + S"
            >
              {saving ? <Spinner size={15} /> : <IconSave size={15} />}
              Speichern
            </button>
            <button
              type="button"
              onClick={send}
              disabled={sending || regenerating}
              className="btn-primary"
              title="Strg + Enter"
            >
              {sending ? <Spinner size={15} /> : <IconSend size={15} />}
              Freigeben und senden
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={sending}
              className="btn-ghost text-red-400 hover:bg-red-500/10"
            >
              <IconTrash size={16} />
            </button>
          </div>
        )}
      </div>

      {/* --- Hinweise --- */}
      <div className="mb-4 space-y-3">
        {readOnly && (
          <Notice type="success" title="Bereits versendet">
            Diese Antwort ging am {formatDateTime(draft.sent_at)} an {draft.to_email} heraus und
            kann nicht mehr geaendert werden.
          </Notice>
        )}
        {draft.send_error && !readOnly && (
          <Notice type="error" title="Letzter Sendeversuch ist fehlgeschlagen">
            {draft.send_error}
          </Notice>
        )}
        {draft.ai_note && (
          <Notice type="warning" title="Ohne KI erstellt">
            {draft.ai_note}
          </Notice>
        )}
        {dirty && !readOnly && (
          <Notice type="info">
            Ungespeicherte Änderungen. Beim Senden wird der aktuelle Text verwendet - Speichern ist
            also nicht zwingend nötig.
          </Notice>
        )}
      </div>

      {/* --- Gegenüberstellung --- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Kundenmail */}
        <section className="card flex flex-col">
          <header className="flex items-center gap-2.5 border-b border-ink-800 px-4 py-3">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ backgroundColor: colorFor(draft.from_email) }}
              aria-hidden="true"
            >
              {initialsOf(draft.from_name || draft.from_email)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-100">Nachricht der Kundin</p>
              <p className="truncate text-xs text-ink-500">{draft.from_email}</p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-300">
              {draft.body_original || '(Die Mail enthielt keinen lesbaren Text.)'}
            </pre>
          </div>
        </section>

        {/* Entwurf */}
        <section className="card flex flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
                <IconMail size={14} />
              </div>
              <div>
                <p className="text-sm font-medium text-ink-100">Ihre Antwort</p>
                <p className="text-xs text-ink-500">an {draft.to_email}</p>
              </div>
            </div>

            {readOnly ? (
              draft.category_name && (
                <CategoryBadge
                  name={draft.category_name}
                  color={draft.category_color}
                  icon={draft.category_icon}
                  size="sm"
                />
              )
            ) : (
              <select
                className="input w-auto py-1 text-xs"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                aria-label="Kategorie"
              >
                <option value="">Ohne Kategorie</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            )}
          </header>

          <div className="flex flex-1 flex-col gap-3 p-4">
            <div>
              <label className="label text-xs" htmlFor="draft-subject">
                Betreff
              </label>
              <input
                id="draft-subject"
                className="input"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                disabled={readOnly}
              />
            </div>

            <div className="flex flex-1 flex-col">
              <label className="label text-xs" htmlFor="draft-body">
                Nachricht
              </label>
              <textarea
                id="draft-body"
                ref={textareaRef}
                className="input min-h-[22rem] flex-1 resize-y leading-relaxed"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={readOnly}
                spellCheck
                lang="de"
              />
              <p className="hint flex items-center justify-between">
                <span>{body.length} Zeichen</span>
                {!readOnly && <span>Strg + S speichert, Strg + Enter sendet</span>}
              </p>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Entwurf verwerfen?"
        description={`Die Antwort an ${draft.from_email} wird verworfen. Sie finden den Entwurf danach unter "Verworfen" und können ihn wiederherstellen.`}
        confirmLabel="Verwerfen"
        danger
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
