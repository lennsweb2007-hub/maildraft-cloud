/**
 * Zentraler API-Client.
 *
 * Unterschied zur lokalen Fassung: Statt eines Session-Tokens, das der Server
 * beim Start erzeugt, wird das Anmelde-Token von Supabase mitgeschickt. Der
 * Server prueft es und leitet daraus ab, wessen Daten sichtbar sind.
 *
 * Die Aufrufe darunter behalten bewusst dieselben Namen und Rueckgabeformen
 * wie in der lokalen Fassung - so laufen die bestehenden Seiten ohne
 * Anpassung weiter.
 */

import axios from 'axios';
import { holeToken, supabase } from './supabase.js';

const http = axios.create({
  baseURL: '/api',
  // 60 Sekunden: Ein manueller Abruf mit KI-Aufrufen dauert laenger als eine
  // uebliche Web-Anfrage. Laenger als das Zeitlimit der Funktion braucht es
  // aber nicht - danach antwortet sie ohnehin mit "noch offen".
  timeout: 70_000,
  headers: { 'Content-Type': 'application/json' },
});

// --- Anfragen: Anmelde-Token anhaengen -------------------------------------

http.interceptors.request.use(async (konfiguration) => {
  const token = await holeToken();
  if (token) konfiguration.headers.Authorization = `Bearer ${token}`;
  return konfiguration;
});

// --- Antworten: Fehler uebersetzen, Sitzung erneuern -----------------------

http.interceptors.response.use(
  (antwort) => antwort,
  async (fehler) => {
    const original = fehler.config;

    // Token abgelaufen: einmal erneuern lassen und wiederholen. Supabase macht
    // das normalerweise selbst; dieser Weg faengt den Fall ab, dass die
    // Erneuerung genau zwischen zwei Anfragen faellig wurde.
    if (fehler.response?.status === 401 && original && !original._wiederholt) {
      original._wiederholt = true;
      const { data } = await supabase.auth.refreshSession();
      if (data.session) {
        original.headers.Authorization = `Bearer ${data.session.access_token}`;
        return http.request(original);
      }
    }

    throw new ApiError(fehler);
  }
);

/** Fehler mit einer Meldung, die man einer Nutzerin zeigen kann. */
export class ApiError extends Error {
  constructor(axiosFehler) {
    const antwort = axiosFehler.response;

    let meldung;
    if (antwort?.data?.error) {
      meldung = antwort.data.error;
    } else if (axiosFehler.code === 'ECONNABORTED') {
      meldung = 'Die Anfrage hat zu lange gedauert. Bitte erneut versuchen.';
    } else if (!antwort) {
      meldung = 'Keine Verbindung zum Server. Besteht eine Internetverbindung?';
    } else {
      meldung = `Unerwarteter Fehler (HTTP ${antwort.status}).`;
    }

    super(meldung);
    this.name = 'ApiError';
    this.status = antwort?.status ?? 0;
    this.code = antwort?.data?.code ?? null;
    this.needsReauth = Boolean(antwort?.data?.needsReauth);
  }
}

/** Haengt Query-Parameter an, laesst leere Werte weg. */
function mitParams(params = {}) {
  const sauber = {};
  for (const [schluessel, wert] of Object.entries(params)) {
    if (wert !== undefined && wert !== null && wert !== '') sauber[schluessel] = wert;
  }
  return { params: sauber };
}

const auspacken = (versprechen) => versprechen.then((antwort) => antwort.data);

export const api = {
  // --- Entwuerfe ---
  drafts: {
    list: (params) => auspacken(http.get('/drafts', mitParams(params))),
    get: (id) => auspacken(http.get(`/drafts/${id}`)),
    update: (id, daten) => auspacken(http.put(`/drafts/${id}`, daten)),
    send: (id, daten = {}) => auspacken(http.post('/drafts/send', daten, mitParams({ id }))),
    regenerate: (id) => auspacken(http.post('/drafts/regenerate', {}, mitParams({ id }))),
    remove: (id) => auspacken(http.delete(`/drafts/${id}`)),
    restore: (id) => auspacken(http.post(`/drafts/${id}`, {}, mitParams({ tat: 'restore' }))),
    /** Aussortierte Mail doch beantworten - die KI schreibt dabei einen Entwurf. */
    approve: (id) => auspacken(http.post(`/drafts/${id}`, {}, mitParams({ tat: 'approve' }))),
    /** Offenen Entwurf nachtraeglich als irrelevant aussortieren. */
    ignore: (id, reason) =>
      auspacken(http.post(`/drafts/${id}`, { reason }, mitParams({ tat: 'ignore' }))),
    /** Relevanzpruefung ueber den Altbestand laufen lassen (haeppchenweise). */
    recheck: (limit = 15) => auspacken(http.post('/drafts/recheck', { limit })),
    recheckStatus: () => auspacken(http.get('/drafts/recheck')),
  },

  // --- Abruf ---
  emails: {
    refresh: () => auspacken(http.post('/emails/refresh')),
  },

  // --- Historie ---
  history: {
    list: (params) => auspacken(http.get('/history', mitParams(params))),
  },

  // --- Statistik ---
  stats: {
    all: () => auspacken(http.get('/stats/dashboard', mitParams({ period: 'all' }))),
    period: (period) => auspacken(http.get('/stats/dashboard', mitParams({ period }))),
    summary: () =>
      auspacken(http.get('/stats/dashboard', mitParams({ period: 'all' }))).then((d) => d.summary),
  },

  // --- Postfaecher ---
  accounts: {
    list: () => auspacken(http.get('/accounts')),
    providers: () => auspacken(http.get('/accounts')).then((d) => ({ items: d.providers })),
    suggestImap: (email) => auspacken(http.get('/accounts', mitParams({ suggest: email }))),
    createImap: (daten) => auspacken(http.post('/accounts', daten)),
    test: (id) => auspacken(http.post('/accounts', {}, mitParams({ id, tat: 'test' }))),
    setActive: (id, isActive) =>
      auspacken(http.post('/accounts', { is_active: isActive }, mitParams({ id, tat: 'toggle' }))),
    remove: (id) => auspacken(http.delete('/accounts', mitParams({ id }))),
    oauthUrl: (provider) => auspacken(http.get('/accounts/connect', mitParams({ provider }))),
  },

  // --- Szenarien ---
  scenarios: {
    list: () => auspacken(http.get('/scenarios')),
    create: (daten) => auspacken(http.post('/scenarios', daten)),
    update: (id, daten) => auspacken(http.put('/scenarios', daten, mitParams({ id }))),
    remove: (id) => auspacken(http.delete('/scenarios', mitParams({ id }))),
  },

  // --- Kategorien ---
  categories: {
    list: () => auspacken(http.get('/categories')),
    create: (daten) => auspacken(http.post('/categories', daten)),
    update: (id, daten) => auspacken(http.put('/categories', daten, mitParams({ id }))),
    remove: (id) => auspacken(http.delete('/categories', mitParams({ id }))),
  },

  // --- Einstellungen ---
  settings: {
    get: () => auspacken(http.get('/settings')),
    update: (daten) => auspacken(http.put('/settings', daten)),
    completeSetup: () => auspacken(http.put('/settings', { setup_completed: true })),
    resetSetup: () => auspacken(http.put('/settings', { setup_completed: false })),
    testAi: () => auspacken(http.get('/settings/test-ai')),
  },
};

export default api;
