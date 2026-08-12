-- ============================================================================
--  Row Level Security
--
--  Nach 01-schema.sql ausfuehren.
--
--  Zwei Dinge, die in der Vorlage fehlten und die den Schutz aushebeln:
--
--  1. Eine Policy nur mit USING schuetzt ausschliesslich das LESEN. Ohne
--     WITH CHECK koennte ein angemeldeter Nutzer Datensaetze mit fremder
--     user_id einfuegen oder eigene auf eine fremde user_id umschreiben.
--     Deshalb hat hier jede Policy beides.
--
--  2. Der Service-Role-Key UMGEHT RLS vollstaendig. Der Cron-Endpunkt und die
--     OAuth-Rueckleitung arbeiten mit diesem Schluessel - dort schuetzt die
--     Datenbank also gar nichts, und der Code muss selbst nach user_id
--     filtern. Die betreffenden Stellen sind im Backend entsprechend
--     kommentiert.
--
--  Tabellen, auf die ausschliesslich der Server zugreift (oauth_states,
--  sync_locks, rate_limits), bekommen RLS OHNE Policies. Damit ist der Zugriff
--  fuer angemeldete Nutzer vollstaendig gesperrt; nur der Service-Role-Key
--  kommt heran. Das ist Absicht und kein vergessener Eintrag.
-- ============================================================================

ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sent_emails    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statistics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log      ENABLE ROW LEVEL SECURITY;

-- Nur ueber den Service-Role-Key erreichbar:
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_locks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits  ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
--  Profil
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigenes Profil lesen" ON public.profiles;
CREATE POLICY "Eigenes Profil lesen" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Eigenes Profil aendern" ON public.profiles;
CREATE POLICY "Eigenes Profil aendern" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Kein INSERT und kein DELETE: Profile entstehen ueber den Trigger auf
-- auth.users und verschwinden mit dem Konto.

-- ----------------------------------------------------------------------------
--  Postfaecher
--
--  Die verschluesselten Zugangsdaten stehen zwar in diesen Zeilen, verlassen
--  den Server aber nie: Die API liefert nur die unbedenklichen Felder aus.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigene Postfaecher" ON public.email_accounts;
CREATE POLICY "Eigene Postfaecher" ON public.email_accounts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
--  Kategorien
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigene Kategorien" ON public.categories;
CREATE POLICY "Eigene Kategorien" ON public.categories
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
--  Szenarien
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigene Szenarien" ON public.scenarios;
CREATE POLICY "Eigene Szenarien" ON public.scenarios
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
--  Entwuerfe
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigene Entwuerfe" ON public.drafts;
CREATE POLICY "Eigene Entwuerfe" ON public.drafts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Eigene Entwurfsfassungen" ON public.draft_versions;
CREATE POLICY "Eigene Entwurfsfassungen" ON public.draft_versions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
--  Historie
--
--  Bewusst nur lesbar. Was einmal beim Kunden angekommen ist, darf nachtraeglich
--  nicht mehr veraendert werden - sonst waere die Historie als Nachweis wertlos.
--  Geschrieben wird ausschliesslich serverseitig beim Versand.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigene Historie lesen" ON public.sent_emails;
CREATE POLICY "Eigene Historie lesen" ON public.sent_emails
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
--  Statistik - lesbar, geschrieben wird serverseitig
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigene Statistik lesen" ON public.statistics;
CREATE POLICY "Eigene Statistik lesen" ON public.statistics
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
--  Protokoll - lesbar, geschrieben wird serverseitig
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Eigenes Protokoll lesen" ON public.audit_log;
CREATE POLICY "Eigenes Protokoll lesen" ON public.audit_log
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
--  Kontrolle
--
--  Nach dem Einspielen ausfuehren. Erwartet wird: rowsecurity = true fuer alle
--  Tabellen, und fuer oauth_states, sync_locks und rate_limits jeweils
--  0 Policies.
-- ============================================================================
-- SELECT tablename, rowsecurity,
--        (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.tablename) AS policies
-- FROM pg_tables t
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
