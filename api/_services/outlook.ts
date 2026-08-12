/**
 * Microsoft Outlook / Microsoft 365.
 *
 * Authentifizierung: @azure/msal-node als PublicClientApplication mit
 * Authorization-Code-Flow und PKCE - der fuer installierte Anwendungen
 * vorgesehene Weg. Ein Client-Secret gibt es bewusst nicht.
 *
 * Token-Haltung: Statt Access- und Refresh-Token einzeln zu verwalten, wird
 * der komplette MSAL-Token-Cache serialisiert und verschluesselt abgelegt.
 * MSAL erneuert damit selbstaendig und kennt auch Sonderfaelle wie
 * Conditional-Access-Claims.
 *
 * Mailzugriff: Microsoft Graph v1.0 ueber das eingebaute fetch.
 */

import { PublicClientApplication, CryptoProvider, LogLevel } from '@azure/msal-node';

import { config } from '../_lib/config.js';
import { ApiError, ReauthRequiredError } from '../_lib/errors.js';
import { decrypt, encrypt } from '../_lib/crypto.js';
import { adresse, anzeigename, antwortBetreff, htmlZuText } from '../_lib/text.js';
import type { Nachricht, Postfach, Verbindungstest } from './typen.js';

export type TokenSpeicher = (postfachId: string, verschluesselt: string) => Promise<void>;

function pruefeKonfiguration(): void {
  if (!config.microsoft.istKonfiguriert) {
    throw ApiError.badRequest(
      'Outlook ist nicht eingerichtet. MICROSOFT_CLIENT_ID fehlt in den Umgebungsvariablen.'
    );
  }
}

/** Erzeugt eine MSAL-Anwendung und spielt optional einen Token-Cache ein. */
function msalApp(cache: string | null = null): PublicClientApplication {
  pruefeKonfiguration();

  const app = new PublicClientApplication({
    auth: {
      clientId: config.microsoft.clientId,
      authority: `https://login.microsoftonline.com/${config.microsoft.tenantId}`,
    },
    system: {
      loggerOptions: {
        // MSAL-Meldungen niemals mit personenbezogenen Daten.
        loggerCallback: () => undefined,
        piiLoggingEnabled: false,
        logLevel: LogLevel.Error,
      },
    },
  });

  if (cache) app.getTokenCache().deserialize(cache);
  return app;
}

/**
 * Baut die Microsoft-Anmelde-URL.
 * @returns der Verifier muss bis zum Rueckruf aufbewahrt werden
 */
export async function anmeldeUrl(state: string): Promise<{ url: string; codeVerifier: string }> {
  const app = msalApp();
  const { verifier, challenge } = await new CryptoProvider().generatePkceCodes();

  const url = await app.getAuthCodeUrl({
    scopes: [...config.microsoft.scopes],
    redirectUri: config.microsoft.redirectUri,
    state,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    // Erzwingt die Kontoauswahl, damit ein zweites Postfach verbunden werden
    // kann, ohne sich vorher ueberall abzumelden.
    prompt: 'select_account',
  });

  return { url, codeVerifier: verifier };
}

/** Tauscht den Code gegen Tokens und liefert den serialisierten Cache. */
export async function loeseCodeEin(
  code: string,
  codeVerifier: string
): Promise<{ cache: string; emailAddress: string; displayName: string }> {
  const app = msalApp();

  const ergebnis = await app.acquireTokenByCode({
    code,
    codeVerifier,
    scopes: [...config.microsoft.scopes],
    redirectUri: config.microsoft.redirectUri,
  });

  const claims = ergebnis.idTokenClaims as Record<string, string> | undefined;
  const mailadresse = (
    ergebnis.account?.username ??
    claims?.preferred_username ??
    claims?.email ??
    ''
  ).toLowerCase();

  if (!mailadresse) throw new Error('Microsoft hat keine Mailadresse zum Konto geliefert.');

  return {
    cache: app.getTokenCache().serialize(),
    emailAddress: mailadresse,
    displayName: ergebnis.account?.name ?? claims?.name ?? mailadresse,
  };
}

/** Besorgt ein gueltiges Access-Token und speichert einen erneuerten Cache. */
async function accessToken(postfach: Postfach, speichere: TokenSpeicher): Promise<string> {
  let cache: string | null;
  try {
    cache = decrypt(postfach.oauth_token);
  } catch (fehler) {
    throw new ReauthRequiredError((fehler as Error).message);
  }
  if (!cache) {
    throw new ReauthRequiredError('Fuer dieses Postfach sind keine Zugangsdaten gespeichert.');
  }

  const app = msalApp(cache);
  const tokenCache = app.getTokenCache();
  const konten = await tokenCache.getAllAccounts();

  const konto =
    konten.find((k) => (k.username ?? '').toLowerCase() === postfach.email_address.toLowerCase()) ??
    konten[0];

  if (!konto) {
    throw new ReauthRequiredError(
      'Im gespeicherten Anmeldestatus ist kein Konto mehr enthalten. Bitte neu verbinden.'
    );
  }

  let ergebnis;
  try {
    ergebnis = await app.acquireTokenSilent({ account: konto, scopes: [...config.microsoft.scopes] });
  } catch (fehler) {
    // Refresh-Token abgelaufen (nach 90 Tagen Inaktivitaet) oder widerrufen.
    const f = fehler as { errorCode?: string; message?: string };
    throw new ReauthRequiredError(
      `Die Microsoft-Anmeldung ist nicht mehr gueltig (${f.errorCode ?? f.message}). Bitte das Postfach neu verbinden.`
    );
  }

  const aktualisiert = tokenCache.serialize();
  if (aktualisiert !== cache) {
    const verschluesselt = encrypt(aktualisiert);
    if (verschluesselt) await speichere(postfach.id, verschluesselt).catch(() => undefined);
  }

  return ergebnis!.accessToken;
}

/** Ruft einen Graph-Endpunkt auf und uebersetzt Fehler. */
async function graph(
  token: string,
  pfad: string,
  optionen: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const { method = 'GET', body = null } = optionen;

  const antwort = await fetch(`${config.microsoft.graphBaseUrl}${pfad}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (antwort.status === 204 || antwort.status === 202) return null;

  const roh = await antwort.text();
  let daten: unknown = null;
  if (roh) {
    try {
      daten = JSON.parse(roh);
    } catch {
      daten = { raw: roh };
    }
  }

  if (!antwort.ok) {
    const meldung =
      (daten as { error?: { message?: string } })?.error?.message ?? `HTTP ${antwort.status}`;

    if (antwort.status === 401) {
      throw new ReauthRequiredError(
        'Microsoft hat den Zugriff abgelehnt (401). Bitte das Postfach neu verbinden.'
      );
    }
    if (antwort.status === 403) {
      throw new Error(
        `Microsoft verweigert den Zugriff: ${meldung}. ` +
          'Sind Mail.ReadWrite und Mail.Send in der App-Registrierung freigegeben?'
      );
    }
    if (antwort.status === 429) {
      const retry = antwort.headers.get('retry-after');
      throw new Error(
        `Microsoft-Rate-Limit erreicht${retry ? ` (erneut in ${retry}s)` : ''}.`
      );
    }
    throw new Error(`Microsoft Graph: ${meldung}`);
  }

  return daten;
}

interface GraphNachricht {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  replyTo?: { emailAddress?: { address?: string } }[];
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  internetMessageHeaders?: { name?: string; value?: string }[];
}

/** Holt Nachrichten, die seit `seit` eingegangen sind. */
export async function holeNachrichten(
  postfach: Postfach,
  limit: number,
  seit: Date,
  speichere: TokenSpeicher
): Promise<Nachricht[]> {
  const token = await accessToken(postfach, speichere);

  const felder = [
    'id',
    'conversationId',
    'internetMessageId',
    'subject',
    'from',
    'replyTo',
    'toRecipients',
    'receivedDateTime',
    'body',
    'bodyPreview',
    // Nur so kommt man an List-Unsubscribe - Graph liefert Rohheader
    // ausschliesslich, wenn sie ausdruecklich angefordert werden.
    'internetMessageHeaders',
  ].join(',');

  const daten = (await graph(
    token,
    `/me/mailFolders/inbox/messages?$filter=receivedDateTime ge ${seit.toISOString()}` +
      `&$orderby=receivedDateTime desc&$top=${limit}&$select=${felder}`
  )) as { value?: GraphNachricht[] } | null;

  return (daten?.value ?? []).map((msg) => {
    const vonAdresse = msg.from?.emailAddress?.address ?? '';
    const istHtml = (msg.body?.contentType ?? '').toLowerCase() === 'html';
    const inhalt = msg.body?.content ?? msg.bodyPreview ?? '';

    const abmelden = (msg.internetMessageHeaders ?? []).find(
      (h) => (h.name ?? '').toLowerCase() === 'list-unsubscribe'
    );

    return {
      messageId: msg.id,
      threadId: msg.conversationId ?? null,
      rfcMessageId: msg.internetMessageId ?? null,
      references: null, // Graph verwaltet das Threading selbst ueber createReply
      listUnsubscribe: abmelden?.value ?? null,
      replyTo: adresse(msg.replyTo?.[0]?.emailAddress?.address ?? '') || null,
      from: adresse(vonAdresse),
      fromName: msg.from?.emailAddress?.name ?? anzeigename(vonAdresse) ?? null,
      to: adresse(msg.toRecipients?.[0]?.emailAddress?.address ?? postfach.email_address),
      subject: msg.subject ?? '(kein Betreff)',
      text: istHtml ? htmlZuText(inhalt) : inhalt,
      html: istHtml ? inhalt : null,
      receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
    };
  });
}

/**
 * Sendet die Antwort ueber createReply -> anpassen -> send.
 *
 * Der Umweg statt des einfacheren /reply hat einen Grund: /reply akzeptiert
 * nur einen Kommentartext und uebernimmt den Betreff unveraendert. Hat der
 * Nutzer den Betreff im Entwurf angepasst, ginge diese Aenderung verloren.
 * createReply setzt Empfaenger, Conversation-Zuordnung und Zitat-Historie
 * automatisch korrekt, laesst uns aber beide Felder ueberschreiben.
 */
export async function sendeAntwort(
  postfach: Postfach,
  entwurf: { message_id: string; subject: string | null; body_draft: string | null },
  speichere: TokenSpeicher
): Promise<{ providerMessageId: string | null }> {
  const token = await accessToken(postfach, speichere);

  const antwort = (await graph(
    token,
    `/me/messages/${encodeURIComponent(entwurf.message_id)}/createReply`,
    { method: 'POST', body: {} }
  )) as { id?: string } | null;

  if (!antwort?.id) throw new Error('Microsoft Graph hat keinen Antwortentwurf zurueckgeliefert.');

  await graph(token, `/me/messages/${encodeURIComponent(antwort.id)}`, {
    method: 'PATCH',
    body: {
      subject: antwortBetreff(entwurf.subject),
      body: { contentType: 'Text', content: entwurf.body_draft ?? '' },
    },
  });

  await graph(token, `/me/messages/${encodeURIComponent(antwort.id)}/send`, { method: 'POST' });

  return { providerMessageId: antwort.id };
}

/** Verbindungstest fuer die Kontoliste. */
export async function testeVerbindung(
  postfach: Postfach,
  speichere: TokenSpeicher
): Promise<Verbindungstest> {
  try {
    const token = await accessToken(postfach, speichere);
    await graph(token, '/me?$select=id,mail,userPrincipalName');
    return { ok: true };
  } catch (fehler) {
    return {
      ok: false,
      error: (fehler as Error).message,
      needsReauth: fehler instanceof ReauthRequiredError,
    };
  }
}
