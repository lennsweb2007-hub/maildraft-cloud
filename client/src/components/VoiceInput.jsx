/**
 * Spracheingabe für ein beliebiges Textfeld.
 *
 * Ein Mikrofon-Knopf neben dem Feld, mehr nicht - die eigentliche Aufnahme
 * läuft in einer Leiste am unteren Bildschirmrand. Das ist bewusst so und
 * nicht als Aufklapper direkt am Knopf: Der Knopf sitzt mal in einer engen
 * Formularzeile, mal in einer Filterleiste, mal in einer Tabelle. Ein Feld,
 * das dort aufklappt, wird irgendwo abgeschnitten. Die Leiste unten hat
 * immer Platz, auch auf dem Handy.
 *
 * Die Aufnahme endet nur, wenn der Nutzer es sagt. Keine Pausenerkennung,
 * kein Zeitlimit - man darf mitten im Satz nachdenken. Was die Web Speech
 * API dafür braucht, steht in useSpeechRecognition.js.
 */

/* eslint-disable react/prop-types */
import { useEffect, useRef } from 'react';

import { useApp } from '../context/AppContext';
import { spracheingabeVerfuegbar, useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { IconCheck, IconMic, IconTrash, IconX } from './Icons';
import { Notice } from './ui';

/**
 * @param {string}   value     aktueller Feldinhalt
 * @param {Function} onChange  bekommt den neuen Feldinhalt
 * @param {'append'|'replace'} mode  anhängen (Standard) oder ersetzen
 * @param {string}   lang      Erkennungssprache, sonst die aus den Einstellungen
 * @param {string}   fieldLabel  Name des Feldes, erscheint in der Aufnahmeleiste
 */
export default function VoiceInput({
  value = '',
  onChange,
  mode = 'append',
  lang,
  fieldLabel,
  disabled = false,
  className = '',
}) {
  const { user, showToast } = useApp();

  // Die Sprache kommt aus den Einstellungen, solange nichts anderes gesagt
  // wird. Fehlt sie dort noch, bleibt es bei Deutsch.
  const sprache = lang || user?.speech_lang || 'de-DE';

  const { laeuft, endgueltig, zwischentext, gesamttext, fehler, starte, stoppe, leere } =
    useSpeechRecognition({ lang: sprache });

  const textEndeRef = useRef(null);
  const gemeldetRef = useRef(null);

  // Mitlaufen lassen, damit der zuletzt gesprochene Satz immer sichtbar ist.
  useEffect(() => {
    if (laeuft) textEndeRef.current?.scrollIntoView({ block: 'end' });
  }, [laeuft, endgueltig, zwischentext]);

  /*
   * Fehler ausserhalb der Aufnahmeleiste melden.
   *
   * Der haeufigste Fall ist die verweigerte Mikrofon-Berechtigung, und der
   * tritt ein, bevor die Leiste ueberhaupt steht: Der Browser meldet den
   * Fehler, die Aufnahme endet sofort, die Leiste verschwindet - und mit ihr
   * die Meldung darin. Ohne diesen Toast bliebe ein Knopf, der scheinbar
   * nichts tut.
   */
  useEffect(() => {
    if (!fehler) {
      gemeldetRef.current = null;
      return;
    }
    if (laeuft || gemeldetRef.current === fehler) return;

    gemeldetRef.current = fehler;
    showToast(fehler, 'error');
  }, [fehler, laeuft, showToast]);

  // Escape bricht ab - dieselbe Erwartung wie bei jedem Dialog.
  useEffect(() => {
    if (!laeuft) return undefined;

    function onKeyDown(ereignis) {
      if (ereignis.key !== 'Escape') return;
      ereignis.preventDefault();
      abbrechen();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laeuft]);

  /** Übernimmt das Erkannte ins Feld und beendet die Aufnahme. */
  function uebernehmen() {
    const erkannt = gesamttext.trim();

    if (erkannt) {
      const vorher = (value ?? '').trim();
      onChange(mode === 'replace' || !vorher ? erkannt : `${vorher} ${erkannt}`);
    }

    stoppe();
    leere();
  }

  function abbrechen() {
    stoppe();
    leere();
  }

  // Ohne Unterstützung im Browser gibt es den Knopf nicht. Ein dauerhaft
  // ausgegrautes Symbol in jedem Formular wäre nur Rauschen - getippt wird
  // ohnehin wie bisher.
  if (!spracheingabeVerfuegbar) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (laeuft ? uebernehmen() : starte())}
        disabled={disabled}
        aria-label={laeuft ? 'Aufnahme beenden und übernehmen' : 'Per Sprache eingeben'}
        title={laeuft ? 'Aufnahme beenden und übernehmen' : 'Per Sprache eingeben'}
        className={`btn-ghost shrink-0 px-2 py-2 ${
          laeuft ? 'bg-brand-500/15 text-brand-700' : 'text-ink-600'
        } ${className}`}
      >
        <IconMic size={16} />
      </button>

      {laeuft && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4"
          role="dialog"
          aria-modal="false"
          aria-label="Spracheingabe"
        >
          <div className="card w-full max-w-2xl animate-fade-in p-4 shadow-xl">
            {/* --- Kopf --- */}
            <div className="mb-3 flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">
                Aufnahme läuft{fieldLabel ? ` · ${fieldLabel}` : ''}
              </p>
              <span className="shrink-0 text-[11px] uppercase tracking-[0.5px] text-sage-600">
                {sprache}
              </span>
            </div>

            {/* --- Erkannter Text ---
                Der noch offene Teil steht blasser dahinter: Er kann sich beim
                nächsten Wort noch ändern, und das soll man sehen. */}
            <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-200 bg-ink-50 p-3">
              {gesamttext ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-950">
                  {endgueltig}
                  {zwischentext && (
                    <span className="text-ink-500">
                      {endgueltig ? ' ' : ''}
                      {zwischentext}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-ink-500">
                  Sprechen Sie einfach los. Sie können zwischendurch überlegen - die Aufnahme läuft
                  weiter, bis Sie sie beenden.
                </p>
              )}
              <div ref={textEndeRef} />
            </div>

            {fehler && (
              <div className="mt-3">
                <Notice type="warning">{fehler}</Notice>
              </div>
            )}

            {/* --- Bedienung --- */}
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={leere}
                disabled={!gesamttext}
                className="btn-ghost px-2.5 py-1.5 text-xs"
                title="Erkannten Text verwerfen und neu diktieren"
              >
                <IconTrash size={14} />
                Text leeren
              </button>

              <div className="flex gap-2">
                <button type="button" onClick={abbrechen} className="btn-secondary px-3 py-1.5 text-xs">
                  <IconX size={14} />
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={uebernehmen}
                  disabled={!gesamttext}
                  className="btn-primary px-3 py-1.5 text-xs"
                >
                  <IconCheck size={14} />
                  Übernehmen
                </button>
              </div>
            </div>

            <p className="hint">
              {mode === 'replace'
                ? 'Der Text ersetzt den bisherigen Inhalt des Feldes.'
                : 'Der Text wird an den bisherigen Inhalt angehängt.'}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
