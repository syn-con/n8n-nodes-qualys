import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type {
  QualysVmdrOtOperation,
  QualysVmdrOtOutputMode,
  QualysVmdrOtResource,
} from './node.type';
import { qualysVmdrOtApiRequest, type QualysApiResponse } from '../transport';

type ResourceDefinition = {
  endpoint: string;
  recordKey?: string;
};

type QualysRateLimitMetadata = {
  remaining?: number;
  limit?: number;
  windowSec?: number;
  toWaitSec?: number;
};

type QualysResponseMetadata = {
  resource: QualysVmdrOtResource;
  endpoint: string;
  pageNumber: number;
  pageSize: number;
  statusCode: number;
  count?: number;
  rateLimit: QualysRateLimitMetadata;
};

type QualysItemMetadata = QualysResponseMetadata & {
  pagesFetched: number;
};

const QUALYS_API_PAGE_SIZE = 100;

const resourceDefinitions: Record<QualysVmdrOtResource, ResourceDefinition> = {
  asset: {
    endpoint: '/ot/1.0/host/list',
    recordKey: 'assets',
  },
  vulnerability: {
    endpoint: '/ot/1.0/detection/list',
    recordKey: 'vulnerabilities',
  },
  projectFile: {
    endpoint: '/ot/1.0/projectfile/list',
  },
};

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const returnData: INodeExecutionData[] = [];

  // A `list` operation is parameterized entirely by the node's own parameters,
  // not by the incoming item data, so it must run exactly once. Looping over
  // every input item would fetch and emit the full result set once per item,
  // producing duplicated records when the node receives more than one item.
  const itemIndex = 0;

  try {
    const operation = this.getNodeParameter('operation', itemIndex) as QualysVmdrOtOperation;

    if (operation !== 'list') {
      throw new NodeOperationError(this.getNode(), `Unsupported operation: ${String(operation)}`, {
        itemIndex,
      });
    }

    const records = await executeList.call(this, itemIndex);
    returnData.push(...records);
  } catch (error) {
    if (this.continueOnFail()) {
      returnData.push({
        json: {
          error: (error as Error).message,
        },
        pairedItem: {
          item: itemIndex,
        },
      });

      return [returnData];
    }

    throw error;
  }

  return [returnData];
}

async function executeList(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData[]> {
  const resource = this.getNodeParameter('resource', itemIndex) as QualysVmdrOtResource;
  const definition = resourceDefinitions[resource];

  if (!definition) {
    throw new NodeOperationError(this.getNode(), `Unsupported resource: ${String(resource)}`, {
      itemIndex,
    });
  }

  const listAll = this.getNodeParameter('listAll', itemIndex, false) as boolean;
  const count = Math.max(0, Number(this.getNodeParameter('count', itemIndex, 100)));
  const skip = Math.max(0, Number(this.getNodeParameter('skip', itemIndex, 0)));
  const limit = resolveRecordLimit(count, listAll);

  if (limit === null) {
    throw new NodeOperationError(this.getNode(), 'Count must be greater than 0 unless List All is enabled.', {
      itemIndex,
    });
  }

  const filter = buildFilterExpression({
    filterGroups: this.getNodeParameter('filterGroups', itemIndex, {}) as IDataObject,
    filters: this.getNodeParameter('filters', itemIndex, {}) as IDataObject,
  });
  const sort = buildSortExpression(
    resource,
    this.getNodeParameter('sorts', itemIndex, {}) as IDataObject,
  );
  const outputMode = this.getNodeParameter('outputMode', itemIndex, 'items') as QualysVmdrOtOutputMode;
  const includeMetadata = this.getNodeParameter('includeMetadata', itemIndex, false) as boolean;
  let pageNumber = 0;

  const records: unknown[] = [];
  const rawPages: Array<{ body: IDataObject; metadata: QualysResponseMetadata }> = [];
  let pagesFetched = 0;
  let knownTotal: number | undefined;
  let latestMetadata: QualysResponseMetadata | undefined;
  let remainingSkip = skip;
  let remainingCount = limit;

  while (true) {
    const response = await qualysVmdrOtApiRequest.call(this, {
      endpoint: definition.endpoint,
      qs: buildQueryString(pageNumber, QUALYS_API_PAGE_SIZE, filter, sort),
    });

    pagesFetched += 1;
    const metadata = buildMetadata(response, resource, definition.endpoint, pageNumber, QUALYS_API_PAGE_SIZE);
    latestMetadata = metadata;

    if (metadata.count !== undefined) {
      knownTotal = metadata.count;
    }

    const pageRecords = extractRecords(response.body, definition.recordKey);
    const pageWindow = takeRecordsFromPage(pageRecords, remainingSkip, remainingCount);
    remainingSkip = pageWindow.nextSkip;
    remainingCount = pageWindow.nextCount;

    if (outputMode === 'raw') {
      rawPages.push({
        body: response.body as IDataObject,
        metadata,
      });
    } else {
      records.push(...pageWindow.records);
    }

    if (remainingCount === 0) {
      break;
    }

    if (knownTotal !== undefined && records.length + skip >= knownTotal) {
      break;
    }

    if (pageRecords.length === 0 || pageRecords.length < QUALYS_API_PAGE_SIZE) {
      break;
    }

    pageNumber += 1;
  }

  if (outputMode === 'raw') {
    return [
      {
        json: {
          resource,
          pagesFetched,
          pages: rawPages,
        },
        pairedItem: {
          item: itemIndex,
        },
      },
    ];
  }

  const fallbackMetadata: QualysResponseMetadata = latestMetadata ?? {
    resource,
    endpoint: definition.endpoint,
    pageNumber,
    pageSize: QUALYS_API_PAGE_SIZE,
    statusCode: 0,
    rateLimit: {},
  };

  return records.map((record) => ({
    json: normalizeRecord(record, includeMetadata, {
      ...fallbackMetadata,
      count: knownTotal ?? latestMetadata?.count,
      pagesFetched,
    }),
    pairedItem: {
      item: itemIndex,
    },
  }));
}

export function buildQueryString(pageNumber: number, pageSize: number, filter: string, sort: string): IDataObject {
  const qs: IDataObject = {
    pageNumber: Math.max(0, Math.floor(pageNumber)),
    pageSize,
  };

  if (filter) {
    qs.filter = filter;
  }

  if (sort) {
    qs.sort = sort;
  }

  return qs;
}

export function resolveRecordLimit(count: number, listAll: boolean): number | null {
  const normalizedCount = Math.max(0, Math.floor(Number(count)));

  if (normalizedCount === 0) {
    return listAll ? Number.POSITIVE_INFINITY : null;
  }

  return listAll ? Number.POSITIVE_INFINITY : normalizedCount;
}

export function buildFilterExpression(parameters: IDataObject): string {
  const groups = getCollectionEntries(parameters, 'filterGroups') as Array<Record<string, unknown>>;

  if (groups.length === 0) {
    return buildFlatFilterExpression(getCollectionEntries(parameters, 'filters') as Array<Record<string, unknown>>);
  }

  const expressions: string[] = [];
  let pendingJoin: 'AND' | 'OR' = 'AND';

  for (const group of groups) {
    const expression = buildGroupedFilterExpression(group);
    if (!expression) {
      continue;
    }

    if (expressions.length > 0) {
      expressions.push(pendingJoin.toLowerCase());
    }

    expressions.push(expression);
    pendingJoin = normalizeJoin(String(group.join ?? 'AND'));
  }

  return expressions.join(' ');
}

export function buildSortExpression(resource: QualysVmdrOtResource, sorts: IDataObject): string {
  const rules = getCollectionEntries(sorts, 'sorts') as Array<Record<string, unknown>>;
  if (rules.length === 0) {
    return '';
  }
  const sortRules: Array<Record<string, string>> = [];

  for (const rule of rules) {
    const field = resolveSortField(resource, String(rule.field ?? '').trim());
    if (!field) {
      continue;
    }

    const direction = String(rule.direction ?? 'asc').trim() === 'desc' ? 'desc' : 'asc';
    sortRules.push({ [field]: direction });
  }

  return JSON.stringify(sortRules);
}

function resolveSortField(resource: QualysVmdrOtResource, field: string): string {
  if (!field) {
    return '';
  }

  if (field.includes('.')) {
    return field;
  }

  const aliases: Record<QualysVmdrOtResource, Record<string, string>> = {
    asset: {
      created: 'asset.created',
      lastUpdated: 'asset.lastUpdated',
      name: 'asset.name',
      risk: 'asset.risk',
      vulnerabilityCount: 'asset.vulnerabilityCount',
    },
    vulnerability: {
      criticality: 'vulnerabilities.criticality',
      lastDetected: 'vulnerabilities.lastDetected',
      qid: 'vulnerabilities.qid',
      severity: 'vulnerabilities.severity',
      typeDetected: 'vulnerabilities.typeDetected',
      vulnCategory: 'vulnerabilities.vulnCategory',
    },
    projectFile: {
      assetCount: 'assetCount',
      engineeringToolName: 'engineeringToolName',
      engineeringToolVersion: 'engineeringToolVersion',
      fileHash: 'fileHash',
      lastUpdated: 'lastUpdated',
      name: 'name',
      plantLocation: 'plantLocation',
      status: 'status',
      uploadedBy: 'uploadedBy',
      vendor: 'vendor',
    },
  };

  return aliases[resource][field] ?? field;
}

export function clampPageSize(value: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

export function extractRecords(body: unknown, recordKey?: string): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }

  if (body && typeof body === 'object') {
    const data = body as IDataObject;

    if (recordKey && Array.isArray(data[recordKey])) {
      return data[recordKey] as unknown[];
    }

    const commonKeys = ['data', 'items', 'records', 'results'];
    for (const key of commonKeys) {
      if (Array.isArray(data[key])) {
        return data[key] as unknown[];
      }
    }
  }

  return body === undefined || body === null ? [] : [body];
}

function buildRuleExpression(rule: Record<string, unknown>): string {
  const identifier = String(rule.identifier ?? '').trim();
  if (!identifier) {
    return '';
  }

  const operator = String(rule.operator ?? ':').trim();
  const value = String(rule.value ?? '').trim();

  if (operator === 'is null' || operator === 'is not null') {
    return `${identifier} ${operator}`;
  }

  return `${identifier}${operator}${formatQqlValue(value)}`;
}

function buildFlatFilterExpression(rows: Array<Record<string, unknown>>): string {
  const expressions: string[] = [];
  let pendingJoin: 'AND' | 'OR' = 'AND';

  for (const row of rows) {
    const expression = buildRuleExpression(row);
    if (!expression) {
      continue;
    }

    if (expressions.length > 0) {
      expressions.push(pendingJoin.toLowerCase());
    }

    expressions.push(expression);
    pendingJoin = normalizeJoin(String(row.join ?? 'AND'));
  }

  return expressions.join(' ');
}

function buildGroupedFilterExpression(group: Record<string, unknown>): string {
  const rows = getCollectionEntries(group, 'filters') as Array<Record<string, unknown>>;
  const expression = buildFlatFilterExpression(rows);

  if (!expression) {
    return '';
  }

  return rows.length > 1 ? `(${expression})` : expression;
}

function getCollectionEntries(value: Record<string, unknown> | IDataObject, collectionName: string): unknown[] {
  const direct = value?.[collectionName];

  if (Array.isArray(direct)) {
    return direct;
  }

  if (direct && typeof direct === 'object') {
    const directObject = direct as IDataObject;
    const named = directObject[collectionName];

    if (Array.isArray(named)) {
      return named;
    }

    for (const candidate of Object.values(directObject)) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  return [];
}

function normalizeJoin(value: string): 'AND' | 'OR' {
  return value.trim().toUpperCase() === 'OR' ? 'OR' : 'AND';
}

export function takeRecordsFromPage(
  pageRecords: unknown[],
  skipRemaining: number,
  countRemaining: number,
): {
  records: unknown[];
  nextSkip: number;
  nextCount: number;
} {
  const startIndex = Math.min(skipRemaining, pageRecords.length);
  const nextSkip = Math.max(0, skipRemaining - pageRecords.length);
  const available = pageRecords.slice(startIndex);
  const takeCount =
    countRemaining === Number.POSITIVE_INFINITY
      ? available.length
      : Math.min(available.length, countRemaining);

  return {
    records: available.slice(0, takeCount),
    nextSkip,
    nextCount:
      countRemaining === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, countRemaining - takeCount),
  };
}

function formatQqlValue(value: string): string {
  if (!value) {
    return '""';
  }

  if (/^(?:".*"|'.*'|`.*`|\[.*\])$/.test(value)) {
    return value;
  }

  if (
    /^[+-]?(?:\d+|\d+\.\d+)$/.test(value) ||
    /^(?:true|false)$/i.test(value) ||
    /^now[-+].+$/i.test(value)
  ) {
    return value;
  }

  if (/\s/.test(value) || /[,:]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  return value;
}

function normalizeRecord(record: unknown, includeMetadata: boolean, metadata: QualysItemMetadata): IDataObject {
  const json: IDataObject =
    record && typeof record === 'object' && !Array.isArray(record)
      ? { ...(record as IDataObject) }
      : { value: record as IDataObject['value'] };

  if (includeMetadata) {
    json._qualys = metadata as unknown as IDataObject;
  }

  return json;
}

function buildMetadata(
  response: QualysApiResponse,
  resource: QualysVmdrOtResource,
  endpoint: string,
  pageNumber: number,
  pageSize: number,
): QualysResponseMetadata {
  return {
    resource,
    endpoint,
    pageNumber,
    pageSize,
    statusCode: response.statusCode,
    count: parseOptionalInt(getHeader(response.headers, 'count')),
    rateLimit: {
      remaining: parseOptionalInt(getHeader(response.headers, 'x-ratelimit-remaining')),
      limit: parseOptionalInt(getHeader(response.headers, 'x-ratelimit-limit')),
      windowSec: parseOptionalInt(getHeader(response.headers, 'x-ratelimit-window-sec')),
      toWaitSec: parseOptionalInt(getHeader(response.headers, 'x-ratelimit-towait-sec')),
    },
  };
}

function getHeader(headers: IDataObject, name: string): string | undefined {
  const target = name.toLowerCase();

  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }

  return undefined;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
