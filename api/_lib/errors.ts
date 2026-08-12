/**
 * Fehlertypen und deren Uebersetzung in HTTP-Antworten.
 *
 * Alle Meldungen sind auf Deutsch und an die Nutzerin gerichtet - sie landen
 * unveraendert in der Oberflaeche. Interne Details bleiben bei Serverfehlern
 * bewusst drin: Die App hat wenige Nutzer, die sich alle kennen, und eine
 * konkrete Meldung spart hier mehr Zeit, als sie an Information preisgibt.
 */

/** Fehler mit HTTP-Status - fuer erwartbare Faelle. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  needsReauth = false;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string, code?: string) {
    return new ApiError(400, message, code ?? null);
  }

  static unauthorized(message = 'Bitte melden Sie sich an.') {
    return new ApiError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Kein Zugriff auf diese Ressource.') {
    return new ApiError(403, message, 'FORBIDDEN');
  }

  static notFound(message = 'Nicht gefunden.') {
    return new ApiError(404, message, 'NOT_FOUND');
  }

  static conflict(message: string, code?: string) {
    return new ApiError(409, message, code ?? null);
  }

  static tooManyRequests(message: string) {
    return new ApiError(429, message, 'RATE_LIMITED');
  }

  static badGateway(message: string, code?: string) {
    return new ApiError(502, message, code ?? null);
  }
}

/** Signalisiert, dass sich der Nutzer beim Mailanbieter neu anmelden muss. */
export class ReauthRequiredError extends Error {
  readonly needsReauth = true;

  constructor(message: string) {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

/** Signalisiert ein erschoepftes KI-Kontingent. */
export class QuotaExhaustedError extends Error {
  readonly quotaExhausted = true;
  readonly remainingMs: number;

  constructor(remainingMs: number) {
    super(
      `Das Gemini-Kontingent ist erschoepft. Naechster Versuch in etwa ${Math.ceil(
        remainingMs / 1000
      )} Sekunden.`
    );
    this.name = 'QuotaExhaustedError';
    this.remainingMs = remainingMs;
  }
}

/** Form der Fehlerantwort, die die Oberflaeche erwartet. */
export interface FehlerAntwort {
  error: string;
  code?: string;
  needsReauth?: boolean;
}

/** Uebersetzt einen beliebigen Fehler in Status und Antwortkoerper. */
export function zuAntwort(fehler: unknown): { status: number; body: FehlerAntwort } {
  if (fehler instanceof ApiError) {
    const body: FehlerAntwort = { error: fehler.message };
    if (fehler.code) body.code = fehler.code;
    if (fehler.needsReauth) body.needsReauth = true;
    return { status: fehler.status, body };
  }

  if (fehler instanceof ReauthRequiredError) {
    return {
      status: 401,
      body: { error: fehler.message, code: 'REAUTH_REQUIRED', needsReauth: true },
    };
  }

  if (fehler instanceof QuotaExhaustedError) {
    return { status: 503, body: { error: fehler.message, code: 'QUOTA_EXHAUSTED' } };
  }

  const meldung = fehler instanceof Error ? fehler.message : String(fehler);
  return { status: 500, body: { error: `Unerwarteter Fehler: ${meldung}` } };
}
