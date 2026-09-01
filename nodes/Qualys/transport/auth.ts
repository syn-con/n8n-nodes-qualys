import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

import type { QualysCredential, QualysPlane, QualysRequestContext } from './types';

/**
 * Which authentication each plane accepts, in preference order. Measured against
 * a live subscription; see stuff/00-verified-findings.md.
 *
 *   plane   client token   user token   HTTP Basic
 *   ot      yes            yes          no
 *   csam    NO             yes          no
 *   fo      yes            NO           yes
 */
export type AuthMode = 'client' | 'userToken' | 'basic';

export const PLANE_AUTH_ORDER: Record<QualysPlane, AuthMode[]> = {
  ot: ['client', 'userToken'],
  // Same host and same acceptance as `ot`; separate so messages can name the
  // right product.
  gateway: ['client', 'userToken'],
  csam: ['userToken'],
  fo: ['client', 'basic'],
};

const TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();

/** Refresh this many milliseconds before the token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;
/** Qualys tokens live 4 hours; used when the JWT carries no readable `exp`. */
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

export function hasClient(credentials: QualysCredential): boolean {
  return Boolean(credentials.clientId?.trim() && credentials.clientSecret?.trim());
}

/**
 * `client1Grant` is the pre-2.0 field name, still honoured so a stored credential
 * does not silently switch endpoints on upgrade. Either field asking for oauth is
 * enough: n8n fills a missing property with its declared default, so the new
 * field always arrives set and a `??` chain would never reach the old one.
 */
export function clientGrant(credentials: QualysCredential): 'oidc' | 'oauth' {
  return credentials.clientGrant === 'oauth' || credentials.client1Grant === 'oauth'
    ? 'oauth'
    : 'oidc';
}

export function hasUser(credentials: QualysCredential): boolean {
  return Boolean(credentials.username?.trim() && credentials.password?.trim());
}

export function isConfigured(credentials: QualysCredential, mode: AuthMode): boolean {
  // `userToken` and `basic` are two ways of using the same username and password.
  return mode === 'client' ? hasClient(credentials) : hasUser(credentials);
}

export function selectAuthMode(
  credentials: QualysCredential,
  plane: QualysPlane,
): AuthMode | undefined {
  return PLANE_AUTH_ORDER[plane].find((mode) => isConfigured(credentials, mode));
}

export function describeMissingAuth(plane: QualysPlane): string {
  if (plane === 'csam') {
    return 'This operation requires a Qualys username and password. The Asset Management API rejects API client credentials, returning a misleading "Invalid Subscription Id" error.';
  }

  if (plane === 'fo') {
    return 'This operation requires either an API client ID and secret, or a Qualys username and password.';
  }

  if (plane === 'ot') {
    return 'VMDR OT operations require either an API client ID and secret, or a Qualys username and password.';
  }

  return 'This operation requires either an API client ID and secret, or a Qualys username and password.';
}

function cacheKey(baseUrl: string, mode: AuthMode, credentials: QualysCredential): string {
  const identity = mode === 'client' ? credentials.clientId : credentials.username;
  const secret = mode === 'client' ? credentials.clientSecret : credentials.password;

  // Rotating a secret while keeping the same ID must not keep serving the token
  // minted from the old one, so the secret is fingerprinted into the key.
  return `${baseUrl}|${mode}|${identity ?? ''}|${fingerprint(secret ?? '')}`;
}

/** Non-cryptographic; only needs to change when the secret changes. */
function fingerprint(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Read `exp` out of a JWT without verifying it; the server is the authority. */
export function readJwtExpiry(token: string): number | undefined {
  const segments = token.split('.');
  if (segments.length < 2) {
    return undefined;
  }

  try {
    const payload = Buffer.from(segments[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const { exp } = JSON.parse(payload) as IDataObject;
    return typeof exp === 'number' ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export function readJwtClaims(token: string): IDataObject {
  const segments = token.split('.');
  if (segments.length < 2) {
    return {};
  }

  try {
    const payload = Buffer.from(segments[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    return JSON.parse(payload) as IDataObject;
  } catch {
    return {};
  }
}

function extractToken(body: unknown): string {
  if (typeof body === 'string') {
    return body.trim();
  }

  if (body && typeof body === 'object') {
    const data = body as IDataObject;
    for (const candidate of [
      data.access_token,
      data.accessToken,
      data.token,
      data.id_token,
      data.idToken,
      data.jwt,
    ]) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return '';
}

/** Shared by both token endpoints; neither should throw on a rejection. */
const TOKEN_REQUEST_DEFAULTS = {
  method: 'POST',
  json: false,
  returnFullResponse: true,
  ignoreHttpStatusErrors: true,
} as const;

function tokenRequest(
  credentials: QualysCredential,
  gatewayUrl: string,
  mode: AuthMode,
): IHttpRequestOptions {
  if (mode === 'userToken') {
    return {
      ...TOKEN_REQUEST_DEFAULTS,
      url: `${gatewayUrl}/auth`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: (credentials.username ?? '').trim(),
        password: credentials.password ?? '',
        token: 'true',
      }).toString(),
    };
  }

  return {
    ...TOKEN_REQUEST_DEFAULTS,
    url: `${gatewayUrl}/auth/${clientGrant(credentials)}`,
    headers: {
      clientId: (credentials.clientId ?? '').trim(),
      clientSecret: (credentials.clientSecret ?? '').trim(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  };
}

/** Whatever the endpoint said about the rejection, in one line. */
function describeTokenFailure(body: unknown, statusCode: number): string {
  if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }

  if (body && typeof body === 'object') {
    const message = String((body as IDataObject).message ?? '');
    if (message) {
      return message;
    }
  }

  return `HTTP ${statusCode}`;
}

async function mintToken(
  this: QualysRequestContext,
  credentials: QualysCredential,
  gatewayUrl: string,
  mode: AuthMode,
): Promise<string> {
  const response = (await this.helpers.httpRequest(
    tokenRequest(credentials, gatewayUrl, mode),
  )) as { statusCode?: number; body?: unknown };

  // POST /auth answers 201, POST /auth/{oidc,oauth} answers 200.
  const statusCode = response.statusCode ?? 0;
  if (statusCode < 200 || statusCode > 299) {
    throw new Error(
      `Qualys authentication failed (${mode}): ${describeTokenFailure(response.body, statusCode)}`,
    );
  }

  const token = extractToken(response.body);
  if (!token) {
    throw new Error(`Qualys authentication (${mode}) returned no token`);
  }

  return token;
}

export async function getToken(
  this: QualysRequestContext,
  credentials: QualysCredential,
  gatewayUrl: string,
  mode: AuthMode,
  forceRefresh = false,
): Promise<string> {
  const key = cacheKey(gatewayUrl, mode, credentials);
  const cached = TOKEN_CACHE.get(key);
  const now = Date.now();

  if (!forceRefresh && cached && cached.expiresAt > now + EXPIRY_MARGIN_MS) {
    return cached.token;
  }

  const token = await mintToken.call(this, credentials, gatewayUrl, mode);
  TOKEN_CACHE.set(key, {
    token,
    expiresAt: readJwtExpiry(token) ?? now + DEFAULT_TTL_MS,
  });

  return token;
}

export function invalidateToken(
  credentials: QualysCredential,
  gatewayUrl: string,
  mode: AuthMode,
): void {
  TOKEN_CACHE.delete(cacheKey(gatewayUrl, mode, credentials));
}

/** Exposed for tests; the cache is module scoped so it survives executions. */
export function clearTokenCache(): void {
  TOKEN_CACHE.clear();
}
