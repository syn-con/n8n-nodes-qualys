import { createHash } from 'node:crypto';

import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

import type { QualysCredential, QualysPlane, QualysRequestContext } from './types';

/**
 * Every plane authenticates with the API client. There is one mode, and no
 * fallback: neither HTTP Basic nor a username/password token is used anywhere.
 *
 * CyberSecurity Asset Management does not accept a client token yet. It answers
 * `400 Error validating customer from token - Invalid Subscription Id`, which
 * blames the subscription rather than the credential; Qualys support confirms
 * client support there is a work in progress, whatever the documentation says.
 * It is wired up as a client plane regardless, so those operations start working
 * the day Qualys ships it, with no change here. `explain()` in ./index.ts turns
 * that 400 into a message saying as much.
 */
export type AuthMode = 'client';

export const PLANE_AUTH_ORDER: Record<QualysPlane, AuthMode[]> = {
  ot: ['client'],
  // Same host as `ot`; separate so error messages can name the right product.
  gateway: ['client'],
  csam: ['client'],
  fo: ['client'],
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

/**
 * Whether the credential can satisfy an auth mode. There is only one mode, so
 * this is the same question as "is there a client", but the modes are kept
 * distinct in `PLANE_AUTH_ORDER` for when a second one returns.
 */
export function isConfigured(credentials: QualysCredential): boolean {
  return hasClient(credentials);
}

export function selectAuthMode(
  credentials: QualysCredential,
  plane: QualysPlane,
): AuthMode | undefined {
  return PLANE_AUTH_ORDER[plane].find(() => isConfigured(credentials));
}

export function describeMissingAuth(plane: QualysPlane): string {
  if (plane === 'ot') {
    return 'VMDR OT operations require an API client ID and secret.';
  }

  return 'This operation requires an API client ID and secret.';
}

function cacheKey(baseUrl: string, mode: AuthMode, credentials: QualysCredential): string {
  const identity = credentials.clientId;
  const secret = credentials.clientSecret;

  // Rotating a secret while keeping the same ID must not keep serving the token
  // minted from the old one, so the secret is fingerprinted into the key.
  return `${baseUrl}|${mode}|${identity ?? ''}|${fingerprint(secret ?? '')}`;
}

/**
 * Distinguishes one secret from another in the cache key without holding the
 * secret itself.
 *
 * This has to be collision resistant, not merely fast. The cache is module
 * scoped, so every credential in the n8n process shares it, and the rest of the
 * key is guessable - host, mode and client ID. A 32-bit non-cryptographic hash
 * would let someone who knows another tenant's client ID craft a secret that
 * collides with theirs and be served their cached token.
 */
function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

function tokenRequest(credentials: QualysCredential, gatewayUrl: string): IHttpRequestOptions {
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
  const response = (await this.helpers.httpRequest(tokenRequest(credentials, gatewayUrl))) as {
    statusCode?: number;
    body?: unknown;
  };

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
