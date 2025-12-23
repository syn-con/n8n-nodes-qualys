import type { IDataObject, IExecuteFunctions, INodeExecutionData, IHttpRequestMethods } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export async function qualysApiRequest(
  this: IExecuteFunctions,
  endpoint: string,
  form: IDataObject = {},
  method: IHttpRequestMethods = 'POST',
  headers: IDataObject = {},
): Promise<{ items: INodeExecutionData[] }> {
  const creds = await this.getCredentials('qualysApi');
  const baseUrl = (creds.baseUrl as string).replace(/\/+$/, '');
  const authMethod = (creds.authMethod as string) || 'basic';
  const defaultHeaders =
    typeof creds.headersJson === 'string' && (creds.headersJson as string).trim()
      ? JSON.parse(creds.headersJson as string)
      : {};

  const url = `${baseUrl}${endpoint}`;
  const hdrs: IDataObject = {
    Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
    'X-Requested-With': 'n8n',
    ...defaultHeaders,
    ...headers,
  };
  if (authMethod !== 'basic') hdrs.Authorization = `Bearer ${creds.token}` as string;

  try {
    const res = (await this.helpers.request({
      method,
      uri: url,
      form,
      headers: hdrs,
      json: false,
      resolveWithFullResponse: true,
      ...(authMethod === 'basic'
        ? { auth: { user: creds.username as string, pass: creds.password as string } }
        : {}),
    })) as any;

    const ct = String(res.headers['content-type'] || '');
    const body = String(res.body ?? '');

    const items: INodeExecutionData[] = [];
    if (ct.includes('xml') || /^\s*</.test(body)) {
      let xml2js: any;
      try { xml2js = require('xml2js'); } catch {}
      if (xml2js?.parseStringPromise) {
        const parsed = await xml2js.parseStringPromise(body, { explicitArray: false, mergeAttrs: true });
        items.push({ json: parsed as IDataObject });
      } else {
        items.push({ json: { xml: body } as IDataObject });
      }
    } else if (/^\s*[\[{]/.test(body)) {
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed)) for (const el of parsed) items.push({ json: el as IDataObject });
        else items.push({ json: parsed as IDataObject });
      } catch {
        items.push({ json: { data: body } as IDataObject });
      }
    } else {
      items.push({ json: { data: body } as IDataObject });
    }

    return { items };
  } catch (error) {
    if (this.continueOnFail()) {
      return { items: [{ json: { error: (error as Error).message } }] };
    }
    if (error instanceof Error) throw error;
    throw new NodeOperationError(this.getNode(), error as string);
  }
}
