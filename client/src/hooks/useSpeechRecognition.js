/**
 * Spracherkennung über die Web Speech API.
 *
 * Browsernativ, ohne zusätzliche Abhängigkeit. Chrome und Edge schicken das
 * Audio zur Erkennung an Google-Server - das ist bei dieser Schnittstelle so
 * und lässt sich nicht abstellen. Firefox unterstützt sie gar nicht; dort
 * meldet der Hook einfach "nicht verfügbar" und getippt wird wie bisher.
 *
 * Zwei Eigenheiten der Schnittstelle bestimmen den Aufbau dieser Datei:
 *
 *  1. Chrome beendet die Erkennung trotz continuous=true nach einigen Sekunden
 *     Stille von selbst. Wer beim Diktieren nachdenkt, wäre danach stumm
 *     geschaltet, ohne es zu merken. Deshalb startet onEnde die Erkennung neu,
 *     solange der Nutzer nicht bestätigt oder abgebrochen hat.
 *
 *  2. Nach einem Neustart beginnt die Ergebnisliste wieder bei null. Der
 *     bereits erkannte Text muss deshalb hier gesammelt werden und nicht aus
 *     event.results gelesen werden.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const Erkenner =
  typeof window === 'undefined'
    ? undefined
    : window.SpeechRecognition || window.webkitSpeechRecognition;

/** Kann dieser Browser überhaupt Sprache erkennen? */
export const spracheingabeVerfuegbar = Boolean(Erkenner);

const FEHLERTEXTE = {
  'not-allowed':
    'Der Zugriff auf das Mikrofon wurde abgelehnt. Sie können ihn im Browser über das Symbol links in der Adresszeile wieder erlauben.',
  'service-not-allowed':
    'Der Browser lässt die Spracherkennung nicht zu. Bitte die Mikrofon-Berechtigung für diese Seite prüfen.',
  'audio-capture':
    'Es wurde kein Mikrofon gefunden. Bitte prüfen, ob eines angeschlossen und im System ausgewählt ist.',
  network: 'Die Spracherkennung ist gerade nicht erreichbar. Besteht eine Internetverbindung?',
};

/**
 * Fehler, nach denen ein Neustart sinnlos ist. Bei allen anderen - vor allem
 * "no-speech", das schon nach kurzer Stille kommt - wird weitergemacht.
 */
const ENDGUELTIG = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/**
 * Zwei Aufnahmen gleichzeitig kann die Schnittstelle nicht, und ein vergessenes
 * Mikrofon im Hintergrund wäre unangenehm. Deshalb merkt sich das Modul die
 * laufende Aufnahme und beendet sie, sobald irgendwo eine neue beginnt.
 */
let laufendeAufnahme = null;

export function useSpeechRecognition({ lang = 'de-DE' } = {}) {
  const [laeuft, setLaeuft] = useState(false);
  const [endgueltig, setEndgueltig] = useState('');
  const [zwischentext, setZwischentext] = useState('');
  const [fehler, setFehler] = useState(null);

  const erkennerRef = useRef(null);
  /** Will der Nutzer weiter sprechen? Steuert den automatischen Neustart. */
  const gewolltRef = useRef(false);
  /** Gesammelter Text - überlebt die Neustarts, die Chrome erzwingt. */
  const endgueltigRef = useRef('');
  /** Zeitpunkte der letzten Neustarts, gegen eine Endlosschleife. */
  const neustartsRef = useRef([]);

  const stoppe = useCallback(() => {
    gewolltRef.current = false;
    if (laufendeAufnahme === erkennerRef.current) laufendeAufnahme = null;

    const erkenner = erkennerRef.current;
    if (erkenner) {
      // abort() statt stop(): stop() liefert noch ein letztes Ergebnis nach,
      // das nach dem Beenden niemanden mehr interessiert.
      try {
        erkenner.abort();
      } catch {
        /* War bereits beendet - kein Grund für eine Meldung. */
      }
    }

    setLaeuft(false);
    setZwischentext('');
  }, []);

  const leere = useCallback(() => {
    endgueltigRef.current = '';
    setEndgueltig('');
    setZwischentext('');
  }, []);

  const starte = useCallback(() => {
    if (!Erkenner) {
      setFehler('Dieser Browser unterstützt keine Spracheingabe. Chrome oder Edge können es.');
      return;
    }

    // Läuft woanders noch eine Aufnahme, hat sie hiermit ausgedient.
    if (laufendeAufnahme && laufendeAufnahme !== erkennerRef.current) {
      try {
        laufendeAufnahme.abort();
      } catch {
        /* egal */
      }
      laufendeAufnahme = null;
    }

    setFehler(null);
    neustartsRef.current = [];
    gewolltRef.current = true;

    const erkenner = new Erkenner();
    erkenner.lang = lang;
    erkenner.continuous = true;
    erkenner.interimResults = true;
    erkenner.maxAlternatives = 1;

    erkenner.onresult = (ereignis) => {
      let offen = '';

      // Ab resultIndex, weil davor liegende Ergebnisse bereits verarbeitet
      // sind. Ein Ergebnis wandert dabei von "offen" zu "endgültig", sobald
      // die Erkennung sich sicher ist.
      for (let i = ereignis.resultIndex; i < ereignis.results.length; i += 1) {
        const ergebnis = ereignis.results[i];
        const text = ergebnis[0]?.transcript ?? '';
        if (ergebnis.isFinal) {
          endgueltigRef.current = `${endgueltigRef.current} ${text}`.trim();
        } else {
          offen += text;
        }
      }

      setEndgueltig(endgueltigRef.current);
      setZwischentext(offen.trim());
    };

    erkenner.onerror = (ereignis) => {
      const art = ereignis.error;

      // "aborted" entsteht durch unser eigenes stoppe() - keine Meldung wert.
      if (art === 'aborted') return;

      if (ENDGUELTIG.has(art)) {
        gewolltRef.current = false;
        setFehler(FEHLERTEXTE[art] ?? `Die Spracherkennung meldet einen Fehler (${art}).`);
        setLaeuft(false);
        return;
      }

      // "no-speech" kommt schon nach wenigen Sekunden Stille. Das ist beim
      // Nachdenken der Normalfall und darf nicht als Fehler erscheinen.
      if (art !== 'no-speech') {
        setFehler(FEHLERTEXTE[art] ?? `Die Spracherkennung meldet einen Fehler (${art}).`);
      }
    };

    erkenner.onend = () => {
      if (!gewolltRef.current) {
        setLaeuft(false);
        return;
      }

      // Neustart - aber nicht um jeden Preis. Endet die Erkennung immer wieder
      // sofort, liegt etwas im Argen, und eine Schleife würde den Browser nur
      // beschäftigen.
      const jetzt = Date.now();
      neustartsRef.current = [...neustartsRef.current.filter((t) => jetzt - t < 10_000), jetzt];

      if (neustartsRef.current.length > 8) {
        gewolltRef.current = false;
        setLaeuft(false);
        setFehler(
          'Die Spracherkennung bricht immer wieder ab. Bitte das Mikrofon prüfen und es erneut versuchen.'
        );
        return;
      }

      try {
        erkenner.start();
      } catch {
        // InvalidStateError: läuft in Wahrheit noch. Dann ist nichts zu tun.
      }
    };

    try {
      erkenner.start();
      erkennerRef.current = erkenner;
      laufendeAufnahme = erkenner;
      setLaeuft(true);
    } catch {
      setFehler('Die Aufnahme konnte nicht gestartet werden. Bitte erneut versuchen.');
      gewolltRef.current = false;
    }
  }, [lang]);

  // Beim Aushängen der Komponente darf kein Mikrofon offen bleiben.
  useEffect(() => () => {
    gewolltRef.current = false;
    try {
      erkennerRef.current?.abort();
    } catch {
      /* egal */
    }
    if (laufendeAufnahme === erkennerRef.current) laufendeAufnahme = null;
  }, []);

  /** Alles, was bisher erkannt wurde - inklusive des noch offenen Teils. */
  const gesamttext = [endgueltig, zwischentext].filter(Boolean).join(' ').trim();

  return {
    verfuegbar: spracheingabeVerfuegbar,
    laeuft,
    endgueltig,
    zwischentext,
    gesamttext,
    fehler,
    starte,
    stoppe,
    leere,
  };
}
