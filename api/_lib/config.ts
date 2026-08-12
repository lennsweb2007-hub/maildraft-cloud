/**
 * Zentrale Konfiguration.
 *
 * Liest ausschliesslich hier aus process.env, damit es genau eine Stelle mit
 * Defaults und Pruefungen gibt. Fehlt ein Pflichtwert, faellt das beim ersten
 * Aufruf mit einer verstaendlichen Meldung auf statt mit einem Folgefehler
 * tief im Code.
 */

/** Liest einen Pflichtwert. Wirft, wenn er fehlt. */
function pflicht(name: string): string {
  const wert = process.env[name];
  if (!wert || !wert.trim()) {
    throw new Error(
      `Die Umgebungsvariable ${name} fehlt. In Vercel unter ` +
        'Settings > Environment Variables eintragen und neu bereitstellen.'
    );
  }
  return wert.trim();
}

/** Liest einen optionalen Wert. */
function optional(name: string, standard = ''): string {
  return (process.env[name] ?? standard).trim();
}

/** Liest eine Ganzzahl mit Bereichspruefung. */
function zahl(name: string, standard: number, min: number, max: number): number {
  const roh = process.env[name];
  if (roh === undefined || roh === '') return standard;

  const wert = Number.parseInt(roh, 10);
  if (Number.isNaN(wert) || wert < min || wert > max) {
    throw new Error(
      `Ungueltiger Wert fuer ${name}: "${roh}". Erwartet wird eine Zahl zwischen ${min} und ${max}.`
    );
  }
  return wert;
}

/** Adresse der App ohne Schraegstrich am Ende. */
function appUrl(): string {
  const gesetzt = optional('APP_URL');
  if (gesetzt) return gesetzt.replace(/\/+$/, '');

  // Vercel stellt die Adresse der aktuellen Bereitstellung bereit. Nuetzlich
  // fuer Vorschau-Bereitstellungen, bei denen APP_URL nicht passt - fuer
  // OAuth aber unbrauchbar, weil die Adresse bei jeder Bereitstellung wechselt
  // und nicht bei Google hinterlegt sein kann.
  const vercel = optional('VERCEL_URL');
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}

export const config = {
  appUrl: appUrl(),
  istProduktion: optional('NODE_ENV') === 'production',

  supabase: {
    get url() {
      return optional('SUPABASE_URL') || pflicht('VITE_SUPABASE_URL');
    },
    get serviceRoleKey() {
      return pflicht('SUPABASE_SERVICE_ROLE_KEY');
    },
    /**
     * Oeffentlicher Schluessel, auch serverseitig gebraucht: Verbindungen im
     * Namen eines Nutzers muessen ihn als apikey senden, nicht den
     * Service-Role-Key - sonst haengt es vom Schluesselformat ab, ob die
     * Zugriffsregeln ueberhaupt greifen. Siehe fuerNutzer() in supabase.ts.
     */
    get anonKey() {
      return optional('SUPABASE_ANON_KEY') || pflicht('VITE_SUPABASE_ANON_KEY');
    },
  },

  crypto: {
    get masterKey() {
      return pflicht('ENCRYPTION_KEY');
    },
  },

  ai: {
    get apiKey() {
      return pflicht('GEMINI_API_KEY');
    },
    get istKonfiguriert() {
      return Boolean(optional('GEMINI_API_KEY'));
    },
    /** Modell fuer die Entwuerfe - trifft nur die echten Kundenanfragen. */
    model: optional('GEMINI_MODEL', 'gemini-3.6-flash'),
    /**
     * Modell fuer die Relevanzpruefung.
     *
     * Bewusst ein anderes und kleineres: Die Vorpruefung laeuft ueber JEDE
     * eingehende Mail, die Entwurfserstellung nur ueber die wenigen echten
     * Anfragen. Google fuehrt die Kontingente pro Modell - die Trennung
     * entlastet damit beide Grenzen. Nebeneffekt: rund 300 statt 7000
     * Millisekunden pro Aufruf.
     */
    triageModel: optional('GEMINI_TRIAGE_MODEL', 'gemini-3.1-flash-lite'),
    maxRetries: 4,
    retryBaseDelayMs: 1500,
    /**
     * Anfragen pro Minute ueber ALLE Nutzer hinweg. Der kostenlose Tarif
     * erlaubt je nach Modell nur 15 bis 30. Weil sich alle Nutzer einen
     * Schluessel teilen, wird die Taktung ueber die Datenbanksperre
     * durchgesetzt: Es laeuft immer nur ein Abruf gleichzeitig.
     */
    requestsPerMinute: zahl('GEMINI_REQUESTS_PER_MINUTE', 15, 1, 600),
  },

  google: {
    get clientId() {
      return pflicht('GOOGLE_CLIENT_ID');
    },
    get clientSecret() {
      return pflicht('GOOGLE_CLIENT_SECRET');
    },
    get istKonfiguriert() {
      return Boolean(optional('GOOGLE_CLIENT_ID') && optional('GOOGLE_CLIENT_SECRET'));
    },
    get redirectUri() {
      return `${appUrl()}/api/accounts/callback?provider=gmail`;
    },
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  },

  microsoft: {
    get clientId() {
      return pflicht('MICROSOFT_CLIENT_ID');
    },
    tenantId: optional('MICROSOFT_TENANT_ID', 'common'),
    get istKonfiguriert() {
      return Boolean(optional('MICROSOFT_CLIENT_ID'));
    },
    get redirectUri() {
      return `${appUrl()}/api/accounts/callback?provider=outlook`;
    },
    scopes: ['User.Read', 'Mail.ReadWrite', 'Mail.Send'],
    graphBaseUrl: 'https://graph.microsoft.com/v1.0',
  },

  sync: {
    get cronSecret() {
      return pflicht('CRON_SECRET');
    },
    /**
     * Zeitbudget eines Abruf-Aufrufs. Wird es erreicht, endet die Funktion
     * geordnet und meldet den Restbestand - der naechste Cron-Lauf macht
     * weiter. So passt der Abruf in jedes Zeitlimit, auch im kostenlosen
     * Tarif, und ein grosser Rueckstand baut sich ueber mehrere Laeufe ab.
     */
    timeBudgetMs: zahl('SYNC_TIME_BUDGET_MS', 45_000, 5_000, 280_000),
    maxEmailsPerSync: zahl('MAX_EMAILS_PER_SYNC', 40, 1, 200),
    initialLookbackDays: zahl('INITIAL_LOOKBACK_DAYS', 3, 1, 90),
    overlapMinutes: zahl('SYNC_OVERLAP_MINUTES', 90, 0, 1440),
  },

  rateLimit: {
    /** Anfragen pro Minute und Nutzer an die API. */
    proMinute: zahl('RATE_LIMIT_PER_MINUTE', 100, 10, 10_000),
  },

  zugang: {
    /**
     * Freigegebene Mailadressen, durch Komma getrennt.
     *
     * Eine oeffentlich erreichbare Adresse plus Google-Anmeldung heisst: Jeder,
     * der die URL kennt, kann sich registrieren - und wuerde dann auf dem
     * GEMEINSAMEN Gemini-Kontingent arbeiten. Die Liste ist der Schutz davor.
     *
     * Der Wert "*" hebt die Beschraenkung auf. Ist gar nichts gesetzt, kommt
     * ebenfalls jeder rein - dann steht aber ein deutlicher Hinweis im
     * Protokoll, damit das nicht unbemerkt bleibt.
     */
    get erlaubteAdressen(): string[] {
      return optional('ALLOWED_EMAILS')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    },
  },
} as const;

/**
 * Darf sich diese Adresse anmelden?
 */
export function zugangErlaubt(email: string | null): boolean {
  const liste = config.zugang.erlaubteAdressen;
  if (liste.length === 0 || liste.includes('*')) return true;
  return Boolean(email && liste.includes(email.toLowerCase()));
}

/** Welche Anbieter stehen laut Konfiguration zur Verfuegung? */
export function verfuegbareAnbieter() {
  return [
    {
      id: 'gmail' as const,
      name: 'Gmail',
      configured: config.google.istKonfiguriert,
      hint: config.google.istKonfiguriert
        ? null
        : 'GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET fehlen in den Umgebungsvariablen',
      redirectUri: config.google.istKonfiguriert ? config.google.redirectUri : null,
    },
    {
      id: 'outlook' as const,
      name: 'Outlook / Microsoft 365',
      configured: config.microsoft.istKonfiguriert,
      hint: config.microsoft.istKonfiguriert
        ? null
        : 'MICROSOFT_CLIENT_ID fehlt in den Umgebungsvariablen',
      redirectUri: config.microsoft.istKonfiguriert ? config.microsoft.redirectUri : null,
    },
    {
      id: 'imap' as const,
      name: 'Anderer Anbieter (IMAP)',
      // IMAP braucht keine Vorkonfiguration, nur Zugangsdaten im Formular.
      configured: true,
      hint: null,
      redirectUri: null,
    },
  ];
}
