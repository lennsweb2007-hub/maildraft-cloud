# MailDraft AI — Cloud

Dieselbe App wie die lokale Fassung, aber unter einer festen Adresse erreichbar
und für mehrere Personen nutzbar. Kein Server auf dem eigenen PC nötig.

**Funktional 1:1 zur lokalen Fassung** — Relevanzfilter, Szenarien,
Reply-To-Erkennung, Aussortiert-Reiter, Nachprüfung, Historie, Statistik.

---

## Architektur

| Teil | Wo | Warum |
|---|---|---|
| Oberfläche | Vercel (statisch) | React-Build, ausgeliefert vom CDN |
| API | Vercel Functions | 15 Endpunkte, TypeScript |
| Datenbank | Supabase PostgreSQL | mit Row Level Security |
| Anmeldung | Supabase Auth (Google) | kein eigenes Passwortverfahren |
| Abruf | EasyCron → `/api/emails/fetch` | Serverless kennt keine Zeitpläne |
| KI | Google Gemini | ein gemeinsamer Schlüssel für alle Nutzer |

---

## Einrichtung

Reihenfolge einhalten — jeder Schritt braucht Werte aus dem vorigen.

### 1. Supabase

1. [supabase.com](https://supabase.com) → **New project**, Region Frankfurt
2. Im **SQL Editor** nacheinander ausführen:
   - `supabase/01-schema.sql` — Tabellen, Indizes, Trigger, Funktionen
   - `supabase/02-rls.sql` — Zugriffsregeln
3. **Authentication → Providers → Google** aktivieren
   - Client-ID und Secret einer Google-OAuth-App eintragen *(kann dieselbe wie
     unten sein)*
   - Die von Supabase angezeigte Callback-URL bei Google als Redirect-URI
     hinterlegen
4. Unter **Project Settings → API** notieren:
   - Project URL
   - `anon` public key
   - `service_role` secret key ← **niemals ins Frontend**

### 2. Google Cloud (Postfach-Zugriff)

Getrennt von der Anmeldung: Hier geht es um den Zugriff auf Gmail-Postfächer.

1. [console.cloud.google.com](https://console.cloud.google.com) → Projekt anlegen
2. **APIs & Services → Library** → *Gmail API* → **Enable**
3. **OAuth consent screen**: External, App-Name, Support-Mail
   - **Publishing status auf „In production"** ⚠️ — bei „Testing" verfallen die
     Zugangsdaten nach 7 Tagen
4. **Credentials → OAuth client ID → Webanwendung**
   - Redirect-URI: `https://DEINE-APP.vercel.app/api/accounts/callback?provider=gmail`

### 3. Vercel

1. Repository importieren, Framework-Erkennung auf **Other** lassen
2. Unter **Settings → Environment Variables** alle Werte aus `.env.example`
   eintragen — für **Production, Preview und Development** denselben
   `ENCRYPTION_KEY`, sonst funktionieren Vorschau-Bereitstellungen nicht
3. Bereitstellen, dann die tatsächliche Adresse als `APP_URL` nachtragen und
   erneut bereitstellen

### 4. EasyCron

- URL: `https://DEINE-APP.vercel.app/api/emails/fetch`
- Intervall: **alle 5 Minuten**
- HTTP-Header: `X-Cron-Secret: <dein CRON_SECRET>`

> Das Geheimnis gehört in den Header, **nicht** in die URL — Query-Strings
> landen in Server- und Proxy-Protokollen.

Fünf Minuten klingt oft, ist es aber nicht: Jeder Aufruf arbeitet nur bis zu
seinem Zeitbudget. Läuft nichts an, endet er nach Millisekunden.

### 5. Zugang freischalten

```
ALLOWED_EMAILS=deine@adresse.de,freund@adresse.de
```

Ohne diese Liste kann sich **jeder** registrieren, der die Adresse kennt — und
arbeitet dann auf deinem Gemini-Kontingent. `*` hebt die Beschränkung auf.

---

## Was gegenüber lokal anders ist

Vier Dinge musste die Umstellung ändern. Alle vier haben denselben Grund:
Serverless hat keinen Prozess, der zwischen Anfragen weiterläuft.

| Lokal | Cloud | Warum |
|---|---|---|
| Sperr-Flag im Speicher | **Sperre in der Datenbank** | Jeder Cron-Aufruf ist eine eigene Instanz. Ohne Sperre liefen mehrere gleichzeitig und würden das gemeinsame Gemini-Kontingent sprengen. |
| Abruf läuft, bis er fertig ist | **Häppchen mit Zeitbudget** | Funktionen haben ein Zeitlimit. Jeder Aufruf arbeitet ~45 s und meldet den Rest; der nächste macht weiter. |
| `node-cron` im Prozess | **EasyCron von außen** | Es gibt keinen Prozess, in dem ein Zeitplan leben könnte. |
| Zähler im Speicher | **Zähler in der Datenbank** | Gleicher Grund wie die Sperre. |

Dazu: **SQLite-Backups entfallen** — Supabase sichert selbst.

### Zeitlimits der Funktionen

In `vercel.json` stehen drei Werte ohne Erklärung, weil die Datei streng
validiert wird und keine Kommentare erlaubt:

| Funktion | `maxDuration` | Warum |
|---|---|---|
| `api/emails/fetch.ts` | 60 s | Die einzige laufzeitintensive Funktion. 60 s sind auch im kostenlosen Tarif erlaubt; sie arbeitet in Häppchen und meldet den Restbestand, statt in ein Zeitlimit zu laufen. Im Pro-Tarif sind bis 300 s möglich — dann `SYNC_TIME_BUDGET_MS` entsprechend anheben. |
| `api/drafts/send.ts` | 30 s | Versand über SMTP oder Provider-API kann bei trägen Servern dauern. |
| `api/drafts/regenerate.ts` | 30 s | Ein einzelner Gemini-Aufruf, mit Wiederholung bei Überlastung. |

Die `rewrites`-Regel schickt alles, was keine Datei und kein `/api`-Pfad ist,
an `index.html` — das Routing übernimmt React Router im Browser.

---

## Sicherheit

- **Zugangsdaten verschlüsselt.** OAuth-Tokens und IMAP-Passwörter liegen mit
  AES-256-GCM verschlüsselt in der Datenbank; der Schlüssel steht
  ausschließlich in den Vercel-Umgebungsvariablen. Wer nur die Datenbank
  einsieht, kommt nicht an die Postfächer.
- **Row Level Security auf jeder Tabelle**, jede Regel mit `USING` *und*
  `WITH CHECK` — ohne letzteres wäre nur das Lesen geschützt.
- **Der Service-Role-Key umgeht RLS.** Er wird nur an drei Stellen benutzt
  (Cron, OAuth-Rückleitung, Protokoll); dort filtert der Code selbst nach
  `user_id`. Die Stellen sind im Quelltext markiert.
- **Protokoll ohne Inhalte.** Mailtexte, Betreffzeilen und Adressen werden
  nicht protokolliert — bei einer App, die fremde Kundenpostfächer liest, wäre
  das eine zweite Kopie genau der Daten, die man schützen will.
- **Kein Passwort wird gespeichert**, außer dem IMAP-App-Passwort (verschlüsselt).

---

## Bedienung

Unverändert zur lokalen Fassung:

1. Anmelden mit Google
2. Einrichtungsassistent: Markenname → Postfach → Szenarien → Tonfall → Kategorien
3. Der Abruf läuft automatisch; „Jetzt prüfen" stößt ihn sofort an
4. Entwürfe prüfen, bearbeiten, freigeben

**Wichtig für gute Entwürfe:** *Einstellungen → Relevanzprüfung →
Geschäftskontext* ausfüllen. Das ist der wirksamste Hebel gegen
Fehleinschätzungen.

---

## Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/drafts` | Liste (`status`, `categoryId`, `sort`, `search`, …) |
| `GET/PUT/DELETE` | `/api/drafts/:id` | anzeigen, ändern, verwerfen |
| `POST` | `/api/drafts/:id?tat=restore\|approve\|ignore` | Zusatzaktionen |
| `POST` | `/api/drafts/send?id=` | versenden |
| `POST` | `/api/drafts/regenerate?id=` | neu schreiben lassen |
| `GET/POST` | `/api/drafts/recheck` | Altbestand nachprüfen |
| `GET/POST` | `/api/emails/fetch` | **Cron** (Header `X-Cron-Secret`) |
| `POST` | `/api/emails/refresh` | manueller Abruf |
| `GET/POST/DELETE` | `/api/accounts` | Postfächer, IMAP anlegen |
| `GET` | `/api/accounts/connect?provider=` | OAuth starten |
| `GET` | `/api/accounts/callback?provider=` | OAuth-Rückleitung |
| `GET` | `/api/stats/dashboard?period=` | Auswertung |
| `GET` | `/api/history` | Versandhistorie |
| `GET/PUT` | `/api/settings` | Profil |
| `GET/POST/PUT/DELETE` | `/api/scenarios`, `/api/categories` | Stammdaten |

Alle außer `/api/emails/fetch` und `/api/accounts/callback` erwarten
`Authorization: Bearer <Supabase-JWT>`.

---

## Fehlerbehebung

| Meldung | Ursache |
|---|---|
| „Kein Zugang" | Adresse fehlt in `ALLOWED_EMAILS` |
| `redirect_uri_mismatch` | Redirect-URI bei Google stimmt nicht zeichengenau mit `APP_URL` überein |
| Anmeldung verfällt wöchentlich | Google-App steht auf „Testing" statt „In production" |
| „Kontingent erschöpft" | Gemini-Limit erreicht. Die App setzt automatisch aus und macht später weiter. |
| Abruf endet mit „noch offen" | Normal bei größerem Rückstand — der nächste Cron-Lauf macht weiter |
| „Zugangsdaten konnten nicht entschlüsselt werden" | `ENCRYPTION_KEY` wurde geändert → Postfächer neu verbinden |
| Entwürfe als „Vorlage" markiert | Gemini war nicht erreichbar; Fallback aus dem Szenario |

---

## Entwicklung

```bash
npm install
npm run typecheck    # TypeScript der API
npm run build        # Oberfläche bauen
vercel dev           # API und Oberfläche lokal
```

Für `vercel dev` eine `.env` im Projektwurzelverzeichnis anlegen (steht in der
`.gitignore`) und bei Google zusätzlich
`http://localhost:3000/api/accounts/callback?provider=gmail` hinterlegen.

---

## Grenzen

- **Der Abruf hängt an EasyCron.** Fällt der Dienst aus, holt die App keine
  Mails mehr. Der Knopf „Jetzt prüfen" funktioniert weiterhin.
- **Ein gemeinsames Gemini-Kontingent.** Bei ein bis drei Nutzern trägt der
  kostenlose Tarif das. Kommen mehr dazu, braucht es einen Bezahltarif oder
  einen Schlüssel pro Nutzer.
- **IMAP in Serverless.** Funktioniert, weil jeder Abruf Sekunden dauert. Bei
  sehr trägen Mailservern kann eine Verbindung ins Zeitlimit laufen; die
  betroffenen Mails kommen beim nächsten Lauf.
- **Datenschutz.** Wer fremde Kundenpostfächer verarbeitet, ist dafür
  verantwortlich. Für den Betrieb mit Freunden sollte klar sein, wessen
  Kundendaten wo liegen.
