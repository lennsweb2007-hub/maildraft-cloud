/**
 * Gemeinsame Typen der Datenschicht.
 *
 * Spiegeln die Tabellen aus supabase/01-schema.sql. Bewusst von Hand
 * geschrieben statt generiert: Es sind wenige Tabellen, und die Kommentare
 * erklaeren, was aus dem Spaltennamen allein nicht hervorgeht.
 */

export interface Profil {
  id: string;
  email: string | null;
  setup_completed: boolean;
  brand_name: string;
  tone: 'formal' | 'freundlich' | 'technisch' | 'custom';
  custom_tone: string | null;
  signature: string | null;
  business_context: string | null;
  blocked_senders: string[];
  relevance_filter_enabled: boolean;
  auto_refresh_enabled: boolean;
  auto_refresh_interval: number;
  last_sync_at: string | null;
}

export type Anbieter = 'gmail' | 'outlook' | 'imap';

export interface Postfach {
  id: string;
  user_id: string;
  provider: Anbieter;
  email_address: string;
  display_name: string | null;
  /** Verschluesselt: Gmail-Tokenset bzw. serialisierter MSAL-Cache. */
  oauth_token: string | null;
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  /** Verschluesselt. */
  imap_password: string | null;
  imap_secure: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  last_sync: string | null;
  last_error: string | null;
  status: 'ok' | 'needs_reauth' | 'error';
  is_active: boolean;
}

export interface Kategorie {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  is_default: boolean;
  sort_order: number;
}

export interface Szenario {
  id: string;
  user_id: string;
  title: string;
  trigger_keywords: string[];
  example_response: string;
  tone: string | null;
  category_id: string | null;
  is_active: boolean;
}

/**
 * Normalisierte Nachricht - das gemeinsame Format aller drei Anbieter.
 *
 * Der Rest der Anwendung muss dadurch nicht wissen, ob im Hintergrund die
 * Gmail-API, Microsoft Graph oder IMAP gearbeitet hat.
 */
export interface Nachricht {
  /** Providerseitige Kennung bzw. IMAP-UID. Eindeutig je Postfach. */
  messageId: string;
  threadId: string | null;
  /** RFC-822 Message-ID der Originalmail - fuer korrektes Threading. */
  rfcMessageId: string | null;
  references: string | null;
  /**
   * Setzen ausschliesslich Verteiler - der zuverlaessigste
   * Newsletter-Hinweis, den es gibt.
   */
  listUnsubscribe: string | null;
  /**
   * Entscheidend bei weitergeleiteten Kontaktformularen: Der Absender ist dann
   * das Shopsystem, die Kundin steht hier.
   */
  replyTo: string | null;
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  receivedAt: string;
}

/** Ergebnis eines Verbindungstests. */
export interface Verbindungstest {
  ok: boolean;
  error?: string;
  needsReauth?: boolean;
}
