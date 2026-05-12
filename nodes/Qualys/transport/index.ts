import type {
  IDataObject,
  IExecuteFunctions,
  IExecuteSingleFunctions,
  IHookFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type QualysVmdrOtApiRequestContext =
  | IExecuteFunctions
  | IExecuteSingleFunctions
  | IHookFunctions
  | ILoadOptionsFunctions;

export type QualysCredential = {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
};

export type QualysApiRequestOptions = {
  endpoint: string;
  qs?: IDataObject;
};

export type QualysApiResponse = {
  statusCode: number;
  headers: IDataObject;
  body: unknown;
};

export async function qualysVmdrOtApiRequest(
  this: QualysVmdrOtApiRequestContext,
  requestOptions: QualysApiRequestOptions,
): Promise<QualysApiResponse> {
  const credentials = (await this.getCredentials('qualysVmdrOtApi')) as QualysCredential;

  if (credentials === undefined) {
    throw new Error('No Qualys VMDR OT credentials were returned');
  }

  const baseUrl = buildBaseUrl(credentials.baseUrl ?? '');
  const token = await getBearerToken.call(this, credentials, baseUrl);

  const options: IHttpRequestOptions = {
    method: 'GET',
    url: `${baseUrl}${requestOptions.endpoint}`,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    qs: requestOptions.qs,
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  };

  try {
    const response = await this.helpers.httpRequest(options);
    assertSuccessfulResponse.call(this, response);
    return normalizeFullResponse(response);
  } catch (error) {
    if (error instanceof NodeApiError) {
      throw error;
    }

    throw new NodeApiError(this.getNode(), error as JsonObject);
  }
}

async function getBearerToken(
  this: QualysVmdrOtApiRequestContext,
  credentials: QualysCredential,
  baseUrl: string,
): Promise<string> {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error('Client ID and Client Secret are required to generate a Qualys OIDC JWT token');
  }

  const headers: IDataObject = {
    clientId: credentials.clientId.trim(),
    clientSecret: credentials.clientSecret.trim(),
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const options: IHttpRequestOptions = {
    method: 'POST',
    url: `${baseUrl}/auth/oidc`,
    headers,
    body: '',
    json: false,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  };

  try {
    const response = await this.helpers.httpRequest(options);
    assertSuccessfulResponse.call(this, response);
    const normalized = normalizeFullResponse(response);
    const token = extractToken(normalized.body);

    if (!token) {
      throw new Error('Qualys authentication response did not contain a token');
    }

    return token;
  } catch (error) {
    if (error instanceof NodeApiError) {
      throw error;
    }

    throw new NodeApiError(this.getNode(), error as JsonObject, {
      message: 'Qualys authentication failed',
    });
  }
}

function extractToken(body: unknown): string {
  if (typeof body === 'string') {
    return body.trim();
  }

  if (body && typeof body === 'object') {
    const data = body as IDataObject;
    const candidates = [
      data.access_token,
      data.accessToken,
      data.token,
      data.id_token,
      data.idToken,
      data.jwt,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return '';
}

function assertSuccessfulResponse(
  this: QualysVmdrOtApiRequestContext,
  response: { statusCode?: number; body?: unknown; headers?: IDataObject },
): void {
  const statusCode = response?.statusCode ?? 0;

  if (statusCode >= 200 && statusCode <= 299) {
    return;
  }

  const body = response?.body;
  const message =
    (body && typeof body === 'object' && ((body as IDataObject).message ?? (body as IDataObject).error)) ||
    (typeof body === 'string' && body.trim()) ||
    `Qualys API request failed with HTTP ${statusCode}`;

  throw new NodeApiError(this.getNode(), (body || {}) as JsonObject, {
    httpCode: String(statusCode),
    message: String(message),
  });
}

function normalizeFullResponse(response: {
  statusCode?: number;
  body?: unknown;
  headers?: IDataObject;
}): QualysApiResponse {
  return {
    statusCode: response.statusCode ?? 0,
    headers: response.headers ?? {},
    body: response.body,
  };
}

export function buildBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');

  if (!trimmed) {
    throw new Error('Qualys API Gateway Base URL is required');
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
