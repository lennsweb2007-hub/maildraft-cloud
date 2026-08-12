-- ============================================================================
--  MailDraft AI - Cloud-Schema (Supabase / PostgreSQL)
--
--  In Supabase unter "SQL Editor" ausfuehren. Reihenfolge beachten:
--    01-schema.sql  -> Tabellen, Indizes, Trigger
--    02-rls.sql     -> Row Level Security
--    03-seed.sql    -> Standardkategorien fuer neue Nutzer
--
--  Abweichung von der Vorlage, bewusst:
--  Eingegangene Mail und Antwortentwurf liegen in EINER Tabelle (drafts)
--  statt in zwei. Grund: Jede Mail bekommt genau einen Entwurf, und die
--  Relevanzpruefung entscheidet ueber beide gemeinsam. Zwei Tabellen wuerden
--  bei jeder Abfrage einen Join erzwingen und die Frage aufwerfen, was mit
--  einer eingegangenen Mail ohne Entwurf passiert. Die lokale Fassung laeuft
--  seit Wochen mit dieser Struktur.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Nutzerprofil
--
--  Haengt an auth.users von Supabase. Enthaelt alles, was die KI zum Schreiben
--  braucht: Tonfall, Signatur und die Beschreibung des Geschaefts, an der sich
--  die Relevanzpruefung orientiert.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id                       UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email                    TEXT UNIQUE,

  setup_completed          BOOLEAN NOT NULL DEFAULT FALSE,
  brand_name               TEXT    NOT NULL DEFAULT 'unsere Marke',
  tone                     TEXT    NOT NULL DEFAULT 'freundlich'
                           CHECK (tone IN ('formal', 'freundlich', 'technisch', 'custom')),
  custom_tone              TEXT,
  signature                TEXT,

  -- Steuert die Relevanzpruefung
  business_context         TEXT,
  blocked_senders          JSONB   NOT NULL DEFAULT '[]'::jsonb,
  relevance_filter_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  auto_refresh_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  auto_refresh_interval    INTEGER NOT NULL DEFAULT 3600
                           CHECK (auto_refresh_interval BETWEEN 300 AND 86400),
  last_sync_at             TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
--  Verbundene Postfaecher
--
--  Alle Geheimnisse liegen AES-256-GCM-verschluesselt vor - der Schluessel
--  steht ausschliesslich in den Vercel-Umgebungsvariablen. Selbst wer die
--  Datenbank einsieht, kommt damit nicht an fremde Postfaecher.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,

  provider       TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'imap')),
  email_address  TEXT NOT NULL,
  display_name   TEXT,

  -- Gmail: Tokenset als JSON. Outlook: serialisierter MSAL-Cache. Beides verschluesselt.
  oauth_token    TEXT,

  imap_host      TEXT,
  imap_port      INTEGER,
  imap_user      TEXT,
  imap_password  TEXT,                    -- verschluesselt
  imap_secure    BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_host      TEXT,
  smtp_port      INTEGER,
  smtp_secure    BOOLEAN NOT NULL DEFAULT TRUE,

  last_sync      TIMESTAMPTZ,
  last_error     TEXT,
  status         TEXT NOT NULL DEFAULT 'ok'
                 CHECK (status IN ('ok', 'needs_reauth', 'error')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,

  connected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, email_address)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON public.email_accounts (user_id, is_active);

-- ----------------------------------------------------------------------------
--  Kategorien
--
--  Die Farben stammen aus einer fuer dunkle Oberflaechen geprueften Palette.
--  Die Reihenfolge ist der Mechanismus, der benachbarte Segmente im Diagramm
--  auch bei Rot-Gruen-Schwaeche unterscheidbar haelt.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#3987e5',
  icon       TEXT NOT NULL DEFAULT 'tag',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, name)
);

-- ----------------------------------------------------------------------------
--  Szenarien - die Beispielantworten, an denen sich die KI orientiert
--
--  Der wirksamste Hebel fuer die Qualitaet der Entwuerfe. In der Vorlage hiess
--  das "email_templates"; der Name aus der Oberflaeche ist treffender, weil
--  ein Szenario nicht eingesetzt, sondern nachgeahmt wird.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scenarios (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  trigger_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  example_response TEXT NOT NULL,
  tone             TEXT,
  category_id      UUID REFERENCES public.categories (id) ON DELETE SET NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scenarios_user ON public.scenarios (user_id, is_active);

-- ----------------------------------------------------------------------------
--  Entwuerfe - eingegangene Mail und Antwort in einem Datensatz
--
--  status:
--    pending  wartet auf Freigabe
--    sent     versendet (Wortlaut zusaetzlich in sent_emails)
--    deleted  verworfen (bleibt fuer die Statistik)
--    ignored  von der Relevanzpruefung aussortiert - kein Kundenservice.
--             Der Datensatz verhindert, dass dieselbe Mail bei jedem Lauf
--             erneut an die KI geht, und macht die Entscheidung nachvollziehbar.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drafts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  email_account_id UUID NOT NULL REFERENCES public.email_accounts (id) ON DELETE CASCADE,

  -- Threading
  message_id       TEXT NOT NULL,      -- providerseitige ID bzw. IMAP-UID
  thread_id        TEXT,
  in_reply_to      TEXT,
  references_hdr   TEXT,

  from_email       TEXT NOT NULL,
  from_name        TEXT,
  -- Antwortziel. Bei weitergeleiteten Kontaktformularen NICHT der Absender,
  -- sondern die Adresse aus Reply-To - sonst ginge die Antwort an
  -- no-reply@shopify.com und damit ins Leere.
  to_email         TEXT NOT NULL,
  subject          TEXT,

  body_original    TEXT,
  body_draft       TEXT,

  category_id      UUID REFERENCES public.categories (id) ON DELETE SET NULL,
  scenario_id      UUID REFERENCES public.scenarios (id) ON DELETE SET NULL,
  ai_generated     BOOLEAN NOT NULL DEFAULT TRUE,
  ai_note          TEXT,

  -- Ergebnis der Relevanzpruefung
  relevance_kind       TEXT,
  relevance_reason     TEXT,
  relevance_confidence REAL,

  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sent', 'deleted', 'ignored')),
  send_error       TEXT,

  received_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ
);

-- Verhindert, dass dieselbe Mail zweimal verarbeitet wird. Traegt den Abruf,
-- der sich nach dem Eingangsdatum richtet und dabei bewusst ueberlappt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_unique_message
  ON public.drafts (email_account_id, message_id);

CREATE INDEX IF NOT EXISTS idx_drafts_status
  ON public.drafts (user_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_category
  ON public.drafts (user_id, category_id);
-- Fuer die Nachpruefung des Altbestands
CREATE INDEX IF NOT EXISTS idx_drafts_unchecked
  ON public.drafts (user_id, status) WHERE relevance_confidence IS NULL;

-- ----------------------------------------------------------------------------
--  Fassungen eines Entwurfs - erlaubt das Zurueckholen einer Bearbeitung
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.draft_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id       UUID NOT NULL REFERENCES public.drafts (id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  version_text   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (draft_id, version_number)
);

-- ----------------------------------------------------------------------------
--  Versandhistorie
--
--  Bewusst redundant zu drafts: Wird ein Entwurf spaeter bearbeitet oder das
--  Konto entfernt, bleibt der tatsaechlich versendete Wortlaut hier unveraendert.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sent_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id            UUID REFERENCES public.drafts (id) ON DELETE SET NULL,
  user_id             UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  email_account_id    UUID REFERENCES public.email_accounts (id) ON DELETE SET NULL,

  to_email            TEXT NOT NULL,
  subject             TEXT,
  body                TEXT,
  body_original       TEXT,
  category_id         UUID REFERENCES public.categories (id) ON DELETE SET NULL,
  provider_message_id TEXT,
  response_time_sec   INTEGER,

  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sent_user_date ON public.sent_emails (user_id, sent_at DESC);

-- ----------------------------------------------------------------------------
--  Statistik-Rollup: eine Zeile pro Tag und Kategorie
--
--  Wird beim Anlegen und beim Versenden fortgeschrieben, damit das Dashboard
--  auch nach Jahren sofort erscheint. ignored_count zaehlt getrennt - was kein
--  Kundenservice war, soll die Kennzahlen nicht verfaelschen.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.statistics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  stat_date         DATE NOT NULL,
  category_id       UUID REFERENCES public.categories (id) ON DELETE SET NULL,

  email_count       INTEGER NOT NULL DEFAULT 0,
  sent_count        INTEGER NOT NULL DEFAULT 0,
  ignored_count     INTEGER NOT NULL DEFAULT 0,
  avg_response_time INTEGER
);

-- COALESCE, weil NULL in Unique-Indizes nicht als gleich gilt und die Zeile
-- "ohne Kategorie" sonst mehrfach entstuende.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_unique
  ON public.statistics (user_id, stat_date, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_stats_date ON public.statistics (user_id, stat_date);

-- ----------------------------------------------------------------------------
--  OAuth-Zwischenstaende
--
--  Haelt state und PKCE-Verifier zwischen Weiterleitung und Rueckkehr des
--  Browsers. Genau einmal gueltig, nach 15 Minuten wertlos.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  code_verifier TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
--  Sperre gegen gleichzeitige Abrufe
--
--  Der wichtigste Unterschied zur lokalen Fassung. Dort verhinderte eine
--  Variable im Prozess, dass zwei Abrufe gleichzeitig laufen. Serverless gibt
--  es diesen gemeinsamen Prozess nicht - jeder Cron-Aufruf ist eine eigene
--  Instanz. Ohne Sperre wuerden mehrere Instanzen gleichzeitig Gemini
--  anfragen, das gemeinsame Kontingent sprengen und dieselben Mails doppelt
--  verarbeiten.
--
--  expires_at faengt den Fall ab, dass eine Funktion mitten im Lauf vom
--  Zeitlimit beendet wird und die Sperre nicht freigibt.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_locks (
  lock_key   TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- ----------------------------------------------------------------------------
--  Anfragezaehler fuer die Ratenbegrenzung
--
--  Ebenfalls eine Folge von Serverless: Ein Zaehler im Arbeitsspeicher waere
--  pro Instanz getrennt und damit wirkungslos.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id      UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (user_id, window_start)
);

-- ----------------------------------------------------------------------------
--  Protokoll aller veraendernden Aktionen
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_date ON public.audit_log (user_id, created_at DESC);

-- ============================================================================
--  Trigger
-- ============================================================================

-- updated_at automatisch fortschreiben
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_touch ON public.profiles;
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_accounts_touch ON public.email_accounts;
CREATE TRIGGER trg_accounts_touch BEFORE UPDATE ON public.email_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_scenarios_touch ON public.scenarios;
CREATE TRIGGER trg_scenarios_touch BEFORE UPDATE ON public.scenarios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_drafts_touch ON public.drafts;
CREATE TRIGGER trg_drafts_touch BEFORE UPDATE ON public.drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----------------------------------------------------------------------------
--  Neues Konto -> Profil und Standardkategorien anlegen
--
--  Laeuft als SECURITY DEFINER, weil der Trigger im Kontext der Anmeldung
--  feuert und dort noch keine Rechte auf public.profiles bestehen.
--  search_path wird festgenagelt - ohne das koennte ein veraenderter
--  search_path den Trigger auf fremde Tabellen umlenken.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.categories (user_id, name, color, icon, is_default, sort_order)
  VALUES
    (NEW.id, 'Retouren',      '#d95926', 'package', TRUE, 1),
    (NEW.id, 'Kundensupport', '#3987e5', 'headset', TRUE, 2),
    (NEW.id, 'Produkt',       '#199e70', 'shirt',   TRUE, 3),
    (NEW.id, 'Allgemein',     '#9085e9', 'tag',     TRUE, 4)
  ON CONFLICT (user_id, name) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
--  Hilfsfunktionen
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Anfragezaehler atomar hochsetzen
--
--  Lesen und Schreiben in zwei Schritten waere hier falsch: Zwei gleichzeitige
--  Anfragen laesen beide denselben Stand und schrieben beide denselben Wert
--  zurueck - der Zaehler bliebe stehen. ON CONFLICT erledigt beides in einem
--  Schritt.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_user_id UUID,
  p_window_start TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  neuer_stand INTEGER;
BEGIN
  INSERT INTO public.rate_limits (user_id, window_start, request_count)
  VALUES (p_user_id, p_window_start, 1)
  ON CONFLICT (user_id, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO neuer_stand;

  RETURN neuer_stand;
END;
$$;

-- ----------------------------------------------------------------------------
--  Abruf-Sperre setzen
--
--  Liefert TRUE, wenn die Sperre erlangt wurde. Eine abgelaufene Sperre wird
--  dabei uebernommen - das faengt den Fall ab, dass eine Funktion vom
--  Zeitlimit beendet wurde und nicht mehr aufraeumen konnte.
--
--  Ohne diese Sperre wuerden mehrere Cron-Aufrufe gleichzeitig arbeiten,
--  dieselben Mails doppelt verarbeiten und das gemeinsame Gemini-Kontingent
--  sprengen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_sync_lock(
  p_key TEXT,
  p_holder TEXT,
  p_ttl_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  erlangt BOOLEAN;
BEGIN
  INSERT INTO public.sync_locks (lock_key, holder, acquired_at, expires_at)
  VALUES (p_key, p_holder, NOW(), NOW() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (lock_key) DO UPDATE
    SET holder = EXCLUDED.holder,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at
    WHERE public.sync_locks.expires_at < NOW()
  RETURNING TRUE INTO erlangt;

  RETURN COALESCE(erlangt, FALSE);
END;
$$;

-- ----------------------------------------------------------------------------
--  Abruf-Sperre freigeben - nur durch den Inhaber
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_sync_lock(p_key TEXT, p_holder TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.sync_locks WHERE lock_key = p_key AND holder = p_holder;
$$;

-- ----------------------------------------------------------------------------
--  Statistik fortschreiben
--
--  Eine Zeile pro Tag und Kategorie. Der Durchschnitt der Antwortzeit wird
--  inkrementell fortgeschrieben: neu = (alt * n + wert) / (n + 1).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_statistics(
  p_user_id UUID,
  p_date DATE,
  p_category_id UUID,
  p_received INTEGER DEFAULT 0,
  p_sent INTEGER DEFAULT 0,
  p_ignored INTEGER DEFAULT 0,
  p_response_time INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  zeile public.statistics%ROWTYPE;
BEGIN
  SELECT * INTO zeile
  FROM public.statistics
  WHERE user_id = p_user_id
    AND stat_date = p_date
    AND COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_category_id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF NOT FOUND THEN
    INSERT INTO public.statistics (user_id, stat_date, category_id, email_count, sent_count, ignored_count, avg_response_time)
    VALUES (
      p_user_id, p_date, p_category_id,
      GREATEST(p_received, 0), GREATEST(p_sent, 0), GREATEST(p_ignored, 0),
      p_response_time
    );
    RETURN;
  END IF;

  UPDATE public.statistics
  SET email_count   = GREATEST(email_count + p_received, 0),
      sent_count    = GREATEST(sent_count + p_sent, 0),
      ignored_count = GREATEST(ignored_count + p_ignored, 0),
      avg_response_time = CASE
        WHEN p_response_time IS NULL THEN avg_response_time
        WHEN avg_response_time IS NULL THEN p_response_time
        ELSE ((avg_response_time * sent_count) + p_response_time) / (sent_count + 1)
      END
  WHERE id = zeile.id;
END;
$$;
