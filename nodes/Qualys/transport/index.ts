import { NodeApiError, sleep, type IDataObject, type IHttpRequestOptions } from 'n8n-workflow';

import {
  describeMissingAuth,
  getToken,
  invalidateToken,
  selectAuthMode,
  type AuthMode,
} from './auth';
import { resolveHosts } from './hosts';
import type {
  QualysApiRequestOptions,
  QualysApiResponse,
  QualysCredential,
  QualysPlane,
  QualysRequestContext,
} from './types';
import {
  describeFailure,
  extractQualysCode,
  sanitizeForError,
  type FailureContext,
} from './errors';
import { extractXmlErrorMessage, parseQualysXml } from './xml';

export { buildBaseUrl, derivePlatformUrl, resolveHosts, POD_HOSTS } from './hosts';
export {
  PLANE_AUTH_ORDER,
  clearTokenCache,
  describeMissingAuth,
  isConfigured,
  readJwtClaims,
  readJwtExpiry,
  selectAuthMode,
} from './auth';
export { findNextBatchUrl, parseQualysXml, pluck } from './xml';
export {
  REDACTED,
  describeFailure,
  extractQualysCode,
  redactSecretsInText,
  sanitizeForError,
} from './errors';
export type {
  QualysApiRequestOptions,
  QualysApiResponse,
  QualysCredential,
  QualysPlane,
} from './types';

export const CREDENTIAL_NAME = 'qualysVmdrOtApi';

/** Beyond this the node fails with the wait time rather than blocking a workflow. */
const MAX_RATE_LIMIT_WAIT_MS = 90_000;

function header(headers: IDataObject, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return undefined;
}

/**
 * Only an actual rejection is worth waiting on. `X-RateLimit-Remaining: 0` on a
 * successful response is informational - it says the NEXT call will be refused,
 * not that this one failed - so retrying on it would discard a good response and
 * spend another call from an already empty budget.
 */
export function isRateLimited(response: QualysApiResponse): boolean {
  return response.statusCode === 409 || response.statusCode === 429;
}

export function rateLimitWaitMs(response: QualysApiResponse): number {
  const wait = Number(header(response.headers, 'x-ratelimit-towait-sec'));
  return Number.isFinite(wait) && wait > 0 ? wait * 1000 : 0;
}

export async function qualysApiRequest(
  this: QualysRequestContext,
  requestOptions: QualysApiRequestOptions,
): Promise<QualysApiResponse> {
  const credentials = (await this.getCredentials(CREDENTIAL_NAME)) as QualysCredential | undefined;

  if (!credentials) {
    throw new Error('No Qualys credentials were returned');
  }

  const hosts = resolveHosts(credentials);
  const mode = selectAuthMode(credentials, requestOptions.plane);

  if (!mode) {
    throw new Error(describeMissingAuth(requestOptions.plane));
  }

  const failure: FailureContext = {
    plane: requestOptions.plane,
    method: requestOptions.method ?? 'GET',
    endpoint: requestOptions.endpoint,
    mode,
  };

  const attempt: Attempt = { credentials, hosts, requestOptions, mode, forceRefresh: false };

  try {
    let response = await send.call(this, attempt);

    // A cached token can be revoked server-side before it expires; retry once.
    if (response.statusCode === 401 && mode !== 'basic') {
      response = await send.call(this, { ...attempt, forceRefresh: true });
    }

    // Qualys reports the wait in a header rather than a Retry-After, and a
    // rolling window means retrying immediately just burns the next allowance.
    if (isRateLimited(response)) {
      const wait = rateLimitWaitMs(response);
      if (wait > 0 && wait <= MAX_RATE_LIMIT_WAIT_MS) {
        await sleep(wait);
        response = await send.call(this, attempt);
      }
    }

    if (requestOptions.emptyOn404 && response.statusCode === 404) {
      return { ...response, body: {} };
    }

    assertSuccessfulResponse.call(this, response, failure);
    return finalizeBody(response, requestOptions.xml === true);
  } catch (error) {
    if (error instanceof NodeApiError) {
      // Raised by assertSuccessfulResponse, which has already attached the
      // Qualys message and the diagnostic block.
      // eslint-disable-next-line @n8n/community-nodes/require-node-api-error
      throw error;
    }

    // A transport failure (DNS, TLS, socket) arrives as an axios-shaped error
    // carrying the outgoing request - including the Authorization header. It is
    // sanitized before being handed on, because n8n renders this payload into
    // the execution data. The message itself is preserved: dropping it left
    // every failure showing as a bare "Qualys API error".
    const message = (error as Error | undefined)?.message;

    throw new NodeApiError(this.getNode(), sanitizeForError(error), {
      message: message ? `Qualys request failed: ${message}` : 'Qualys request failed',
      description: describeFailure(failure),
    });
  }
}

type Hosts = { gateway: string; platform: string };

/** Everything one attempt needs. Grouped so the signature stays readable. */
type Attempt = {
  credentials: QualysCredential;
  hosts: Hosts;
  requestOptions: QualysApiRequestOptions;
  mode: AuthMode;
  forceRefresh: boolean;
};

/** A relative endpoint is resolved against the plane's host; a paging link is not. */
function resolveUrl(endpoint: string, plane: QualysPlane, hosts: Hosts): string {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }

  return `${plane === 'fo' ? hosts.platform : hosts.gateway}${endpoint}`;
}

/** JSON bodies are serialised here so the Content-Type cannot drift from them. */
function applyBody(
  options: IHttpRequestOptions,
  headers: IDataObject,
  body: QualysApiRequestOptions['body'],
): void {
  if (body === undefined) {
    return;
  }

  if (typeof body === 'string') {
    options.body = body;
    return;
  }

  headers['Content-Type'] = 'application/json';
  options.body = JSON.stringify(body);
}

async function applyAuth(
  this: QualysRequestContext,
  options: IHttpRequestOptions,
  headers: IDataObject,
  attempt: Attempt,
): Promise<void> {
  const { credentials, hosts, mode, forceRefresh } = attempt;

  if (mode === 'basic') {
    options.auth = {
      username: (credentials.username ?? '').trim(),
      password: credentials.password ?? '',
    };
    return;
  }

  if (forceRefresh) {
    invalidateToken(credentials, hosts.gateway, mode);
  }

  headers.Authorization = `Bearer ${await getToken.call(
    this,
    credentials,
    hosts.gateway,
    mode,
    forceRefresh,
  )}`;
}

async function send(
  this: QualysRequestContext,
  attempt: Attempt,
): Promise<QualysApiResponse> {
  const { credentials, hosts, requestOptions } = attempt;
  const isFo = requestOptions.plane === 'fo';

  const headers: IDataObject = {
    Accept: requestOptions.xml ? 'application/xml' : 'application/json',
  };

  if (isFo) {
    headers['X-Requested-With'] = credentials.xRequestedWith?.trim() || 'n8n-nodes-qualys';
  }

  const options: IHttpRequestOptions = {
    method: requestOptions.method ?? 'GET',
    url: resolveUrl(requestOptions.endpoint, requestOptions.plane, hosts),
    headers,
    qs: requestOptions.qs,
    json: false,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  };

  await applyAuth.call(this, options, headers, attempt);
  applyBody(options, headers, requestOptions.body);

  const response = (await this.helpers.httpRequest(options)) as {
    statusCode?: number;
    body?: unknown;
    headers?: IDataObject;
  };

  return {
    statusCode: response.statusCode ?? 0,
    headers: response.headers ?? {},
    body: response.body,
  };
}

function finalizeBody(response: QualysApiResponse, xml: boolean): QualysApiResponse {
  const { body } = response;

  if (xml) {
    return {
      ...response,
      body: typeof body === 'string' ? parseQualysXml(body) : (body ?? {}),
    };
  }

  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) {
      return { ...response, body: {} };
    }

    try {
      return { ...response, body: JSON.parse(trimmed) };
    } catch {
      return { ...response, body: trimmed };
    }
  }

  return response;
}

/** Append a hint without doubling the punctuation Qualys already supplied. */
/** Append a hint without doubling the punctuation Qualys already supplied. */
function withHint(message: string, hint: string): string {
  return `${message.replace(/\s*\.\s*$/, '')}. ${hint}`;
}

/**
 * Turn Qualys' terser failures into something a workflow author can act on.
 * The hint is appended to the message Qualys sent rather than replacing it, so
 * nothing the API said is lost.
 */
function explain(statusCode: number, plane: QualysPlane, mode: AuthMode, message: string): string {
  if (plane === 'csam' && statusCode === 400 && /Invalid Subscription Id/i.test(message)) {
    return withHint(
      message,
      'The Asset Management API only accepts username/password authentication; API client credentials are rejected with this error even when the subscription is entitled.',
    );
  }

  if (plane === 'fo' && statusCode === 401 && /no access for the application/i.test(message)) {
    return withHint(
      message,
      'The VMDR platform API does not accept username-derived tokens; supply an API client ID and secret, which this node uses in preference, or rely on HTTP Basic.',
    );
  }

  if (statusCode === 403) {
    return withHint(
      message,
      'Check that the module is enabled for the subscription and that "App API Enabled" is set on the role of the user.',
    );
  }

  if (statusCode === 416) {
    return withHint(
      message,
      'Page Size is above the maximum the API allows (300 for IT Asset requests).',
    );
  }

  if (statusCode === 400 && plane === 'csam') {
    return withHint(
      message,
      'This is also returned when a filter uses an operator the field does not support.',
    );
  }

  if (statusCode === 401) {
    return withHint(
      message,
      `Authentication (${mode}) was rejected; check the credential and that SSO is disabled for the account.`,
    );
  }

  if (statusCode === 409 || statusCode === 429) {
    return withHint(
      message,
      'The API rate limit for this subscription is exhausted; Qualys reports the remaining wait in the X-RateLimit-ToWait-Sec header.',
    );
  }

  return message;
}

/** The headline Qualys put in an object body, whatever it called the field. */
function messageFromObject(body: object, fallback: string): string {
  const data = body as IDataObject;
  return String(data.responseMessage ?? data.message ?? data.error ?? fallback);
}

/**
 * Errors are raised before the body is parsed for the caller, so parse it here
 * too. Passing the payload on as a JSON string would stop a workflow branching
 * on, say, `error.body.responseCode`.
 */
function readFailureBody(
  body: unknown,
  fallback: string,
): { payload: unknown; message: string } {
  if (typeof body === 'string' && body.trim()) {
    const xmlMessage = extractXmlErrorMessage(body);
    if (xmlMessage) {
      return { payload: body, message: xmlMessage };
    }

    try {
      const parsed = JSON.parse(body) as IDataObject;
      return { payload: parsed, message: messageFromObject(parsed, body.trim()) };
    } catch {
      // The body still reaches the payload in full, so truncating only the
      // headline loses nothing.
      return { payload: body, message: body.trim().slice(0, 500) };
    }
  }

  if (body && typeof body === 'object') {
    return { payload: body, message: messageFromObject(body, fallback) };
  }

  return { payload: body, message: fallback };
}

function assertSuccessfulResponse(
  this: QualysRequestContext,
  response: QualysApiResponse,
  failure: FailureContext,
): void {
  const { statusCode, body } = response;

  if (statusCode >= 200 && statusCode <= 299) {
    return;
  }

  const { payload, message } = readFailureBody(
    body,
    `Qualys API request failed with HTTP ${statusCode}`,
  );

  throw new NodeApiError(this.getNode(), sanitizeForError(payload ?? {}), {
    httpCode: String(statusCode),
    message: explain(statusCode, failure.plane, failure.mode, message),
    description: describeFailure({
      ...failure,
      statusCode,
      qualysCode: extractQualysCode(body),
    }),
  });
}
