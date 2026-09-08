import type {
  ICredentialTestFunctions,
  ICredentialsDecrypted,
  INodeCredentialTestResult,
} from 'n8n-workflow';

import { clientGrant } from './auth';
import { resolveHosts } from './hosts';
import { redactSecretsInText } from './errors';
import type { QualysCredential } from './types';

/**
 * Mint a token the same way the transport does, and report what came back.
 * `simple: false` keeps a rejection as a response rather than an exception, so a
 * wrong client type reads as "HTTP 401" instead of an opaque throw.
 */
async function probe(
  context: ICredentialTestFunctions,
  options: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = (await context.helpers.request({
      ...options,
      simple: false,
      resolveWithFullResponse: true,
    })) as { statusCode?: number; body?: unknown };

    const statusCode = response?.statusCode ?? 0;
    const body = typeof response?.body === 'string' ? response.body : '';

    if (statusCode >= 200 && statusCode <= 299 && body.trim()) {
      return { ok: true, detail: 'accepted' };
    }

    return {
      ok: false,
      detail: body.trim() ? redactSecretsInText(body.trim()).slice(0, 160) : `HTTP ${statusCode}`,
    };
  } catch (error) {
    // Truthiness, not `??`: an Error carrying an empty message would otherwise
    // report the failure with nothing after it.
    const message = (error as Error | undefined)?.message;

    return { ok: false, detail: redactSecretsInText(message || 'request failed').slice(0, 160) };
  }
}

/**
 * Checks the API client against the token endpoint its Client Type selects.
 *
 * A working client reaches every operation except IT Asset and the EASM domain
 * ones: CyberSecurity Asset Management does not accept client credentials yet.
 * That is said here rather than left for a workflow to discover, because the
 * error Qualys returns for it blames the subscription.
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

  if (!credentials.clientId?.trim() || !credentials.clientSecret?.trim()) {
    return { status: 'Error', message: 'Enter an API client ID and secret.' };
  }

  const result = await probe(this, {
    method: 'POST',
    uri: `${gateway}/auth/${clientGrant(credentials)}`,
    headers: {
      clientId: credentials.clientId.trim(),
      clientSecret: credentials.clientSecret.trim(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });

  if (!result.ok) {
    return { status: 'Error', message: `API client: ${result.detail}` };
  }

  return {
    status: 'OK',
    message:
      'Connected. IT Asset and EASM domain operations will still fail until Qualys ships client-credential support for Asset Management.',
  };
}
