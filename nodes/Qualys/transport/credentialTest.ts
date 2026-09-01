import type {
  ICredentialTestFunctions,
  ICredentialsDecrypted,
  INodeCredentialTestResult,
} from 'n8n-workflow';

import { clientGrant } from './auth';
import { resolveHosts } from './hosts';
import { redactSecretsInText } from './errors';
import type { QualysCredential } from './types';

type Probe = { label: string; ok: boolean; detail: string };

/**
 * Mint a token the same way the transport does, and report what came back.
 * `simple: false` keeps a rejection as a response rather than an exception, so a
 * wrong client type reads as "HTTP 401" instead of an opaque throw.
 */
async function probe(
  context: ICredentialTestFunctions,
  label: string,
  options: Record<string, unknown>,
): Promise<Probe> {
  try {
    const response = (await context.helpers.request({
      ...options,
      simple: false,
      resolveWithFullResponse: true,
    })) as { statusCode?: number; body?: unknown };

    const statusCode = response?.statusCode ?? 0;
    const body = typeof response?.body === 'string' ? response.body : '';

    if (statusCode >= 200 && statusCode <= 299 && body.trim()) {
      return { label, ok: true, detail: 'accepted' };
    }

    const reason = body.trim() ? redactSecretsInText(body.trim()).slice(0, 120) : `HTTP ${statusCode}`;
    return { label, ok: false, detail: reason };
  } catch (error) {
    // Truthiness, not `??`: an Error carrying an empty message would otherwise
    // report the failure as a bare label with nothing after it.
    const message = (error as Error | undefined)?.message;

    return {
      label,
      ok: false,
      detail: redactSecretsInText(message || 'request failed').slice(0, 120),
    };
  }
}

/** Which secrets are present and usable. */
function readSecrets(credentials: QualysCredential): { client: boolean; user: boolean } {
  return {
    client: Boolean(credentials.clientId?.trim() && credentials.clientSecret?.trim()),
    user: Boolean(credentials.username?.trim() && credentials.password?.trim()),
  };
}

function clientRequest(credentials: QualysCredential, gateway: string): Record<string, unknown> {
  return {
    method: 'POST',
    uri: `${gateway}/auth/${clientGrant(credentials)}`,
    headers: {
      clientId: credentials.clientId?.trim(),
      clientSecret: credentials.clientSecret?.trim(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  };
}

function userRequest(credentials: QualysCredential, gateway: string): Record<string, unknown> {
  return {
    method: 'POST',
    uri: `${gateway}/auth`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: credentials.username?.trim() ?? '',
      password: credentials.password ?? '',
      token: 'true',
    }).toString(),
  };
}

/** Turn the probe results into the one line n8n shows under the credential. */
function summarise(probes: Probe[], hasUser: boolean): INodeCredentialTestResult {
  const failed = probes.filter((entry) => !entry.ok);

  if (failed.length === probes.length) {
    return {
      status: 'Error',
      message: failed.map((entry) => `${entry.label}: ${entry.detail}`).join('; '),
    };
  }

  const notes = failed.map((entry) => `${entry.label} was rejected (${entry.detail})`);

  if (!hasUser) {
    notes.push('IT Asset and EASM domain operations need a username and password');
  }

  return {
    status: 'OK',
    message: notes.length > 0 ? `Connected. ${notes.join('. ')}.` : 'Connection successful',
  };
}

/**
 * Checks each secret against the token endpoint that will actually be used, and
 * says which Qualys APIs the credential can reach. A client alone cannot reach
 * CyberSecurity Asset Management, so that is called out rather than left to fail
 * later inside a workflow.
 */
export async function testQualysCredential(
  this: ICredentialTestFunctions,
  credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
  const credentials = (credential.data ?? {}) as QualysCredential;

  let gateway: string;
  try {
    ({ gateway } = resolveHosts(credentials));
  } catch (error) {
    return { status: 'Error', message: (error as Error).message };
  }

  const secrets = readSecrets(credentials);

  if (!secrets.client && !secrets.user) {
    return {
      status: 'Error',
      message:
        'Enter an API client ID and secret, a username and password, or both. Asset Management operations require the username and password.',
    };
  }

  const probes: Probe[] = [];

  if (secrets.client) {
    probes.push(await probe(this, 'API client', clientRequest(credentials, gateway)));
  }

  if (secrets.user) {
    probes.push(
      await probe(this, 'Username and password', userRequest(credentials, gateway)),
    );
  }

  return summarise(probes, secrets.user);
}
