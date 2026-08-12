/**
 * Kleine, wiederverwendbare Bausteine der Oberfläche.
 *
 * Alles hier ist bewusst zustandslos und ohne Datenzugriff - so bleiben die
 * Seiten für den Ablauf zuständig und diese Datei nur für die Darstellung.
 */

/* eslint-disable react/prop-types */
import { useEffect, useRef } from 'react';
import { IconAlert, IconCheck, IconInfo, IconX, categoryIcon } from './Icons';

// ---------------------------------------------------------------------------
//  Ladeanzeigen
// ---------------------------------------------------------------------------

export function Spinner({ size = 18, className = '' }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingState({ text = 'Wird geladen ...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-600">
      <Spinner size={26} />
      <p className="text-sm">{text}</p>
    </div>
  );
}

/** Platzhalter während des Ladens - ruhiger als ein springender Spinner. */
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-ink-200 ${className}`} />;
}

// ---------------------------------------------------------------------------
//  Leerzustände und Fehler
// ---------------------------------------------------------------------------

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ink-200 text-ink-600">
          <Icon size={26} />
        </div>
      )}
      <h3 className="mb-1.5 text-base font-semibold text-ink-900">{title}</h3>
      {description && <p className="max-w-md text-sm leading-relaxed text-ink-600">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-600">
        <IconAlert size={26} />
      </div>
      <h3 className="mb-1.5 text-base font-semibold text-ink-900">Etwas ist schiefgelaufen</h3>
      <p className="max-w-md text-sm leading-relaxed text-ink-600">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary mt-5">
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Hinweise
// ---------------------------------------------------------------------------

/*
 * Der Akzent sitzt als Kante links, nicht als Rahmen ringsum: Auf hellem Grund
 * wirkt ein umlaufender farbiger Rahmen wie eine Warnung, auch wenn nur ein
 * Hinweis gemeint ist. Die Flaeche bleibt eine sehr zarte Tönung derselben
 * Farbe, die Schrift dunkel genug zum Lesen.
 */
const NOTICE_STYLES = {
  info: { box: 'border-brand-500 bg-brand-500/[0.08] text-[#5a4a42]', icon: IconInfo },
  success: { box: 'border-emerald-600 bg-emerald-500/[0.08] text-emerald-800', icon: IconCheck },
  warning: { box: 'border-amber-600 bg-amber-500/[0.10] text-amber-800', icon: IconAlert },
  error: { box: 'border-red-600 bg-red-500/[0.08] text-red-800', icon: IconAlert },
};

export function Notice({ type = 'info', title, children, action }) {
  const style = NOTICE_STYLES[type] || NOTICE_STYLES.info;
  const Icon = style.icon;

  return (
    <div className={`flex gap-3 rounded-r-lg border-l-[3px] py-3 pl-4 pr-4 text-sm ${style.box}`}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        <div className="leading-relaxed opacity-90">{children}</div>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Kategorie-Kennzeichnung
// ---------------------------------------------------------------------------

export function CategoryBadge({ name, color = '#6f8f84', icon = 'tag', size = 'md' }) {
  const Icon = categoryIcon(icon);
  const isSmall = size === 'sm';

  return (
    <span
      className={`badge ${isSmall ? 'px-1.5 py-0.5 text-[11px]' : ''}`}
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <Icon size={isSmall ? 11 : 13} />
      {name || 'Ohne Kategorie'}
    </span>
  );
}

/** Farbiger Punkt für den Kontostatus. */
export function StatusDot({ status }) {
  const colors = {
    ok: 'bg-emerald-400',
    needs_reauth: 'bg-amber-400',
    error: 'bg-red-400',
  };

  const labels = {
    ok: 'Verbunden',
    needs_reauth: 'Anmeldung abgelaufen',
    error: 'Fehler',
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-700">
      <span className={`h-2 w-2 rounded-full ${colors[status] || 'bg-ink-500'}`} />
      {labels[status] || 'Unbekannt'}
    </span>
  );
}

// ---------------------------------------------------------------------------
//  Toasts
// ---------------------------------------------------------------------------

const TOAST_STYLES = {
  success: { box: 'border-emerald-500/40 bg-emerald-50 text-emerald-800', icon: IconCheck },
  error: { box: 'border-red-500/40 bg-red-50 text-red-800', icon: IconAlert },
  info: { box: 'border-ink-300 bg-ink-100/95 text-ink-900', icon: IconInfo },
};

export function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
        const Icon = style.icon;

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex animate-slide-in items-start gap-3 rounded-lg border p-3.5 shadow-xl backdrop-blur ${style.box}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="min-w-0 flex-1 text-sm leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Meldung schließen"
            >
              <IconX size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Dialog
// ---------------------------------------------------------------------------

/**
 * Modaler Dialog. Schließt per Escape und Klick auf den Hintergrund und
 * setzt den Fokus beim Öffnen auf den Bestätigen-Knopf.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    confirmRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      /* Warmes Dunkelbraun statt Schwarz und deutlich durchsichtiger: Auf
         hellem Grund wirkt ein schwarzer Schleier wie ein Fehler. */
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/30 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div className="card w-full max-w-md animate-fade-in p-6">
        <h2 id="dialog-title" className="mb-2 text-lg font-semibold text-ink-950">
          {title}
        </h2>
        {description && <p className="text-sm leading-relaxed text-ink-700">{description}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={danger ? 'btn-danger' : 'btn-primary'}
          >
            {busy && <Spinner size={15} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Kennzahl-Kachel
// ---------------------------------------------------------------------------

export function StatTile({ label, value, hint, icon: Icon, accent = 'text-brand-500' }) {
  /*
   * Auf dem Handy stehen zwei dieser Kacheln nebeneinander, also rund 170 px
   * breit. Beschriftung und Zahl sind dort eine Stufe kleiner; das Symbol
   * darf nicht schrumpfen, sonst zerdrueckt es eine umbrechende Beschriftung.
   */
  return (
    <div className="card p-3.5 sm:p-4">
      <div className="mb-1.5 flex items-start justify-between gap-2 sm:mb-2">
        <p className="min-w-0 text-[10px] font-bold uppercase leading-tight tracking-[0.5px] text-sage-600 sm:text-[11px]">
          {label}
        </p>
        {Icon && <Icon size={15} className={`shrink-0 ${accent}`} />}
      </div>
      <p className="text-xl font-semibold tabular-nums text-ink-950 sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-ink-600 sm:text-xs">{hint}</p>}
    </div>
  );
}
