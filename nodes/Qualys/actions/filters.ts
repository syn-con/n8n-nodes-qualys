import type { IDataObject } from 'n8n-workflow';

export function getCollectionEntries(
  value: Record<string, unknown> | IDataObject | undefined,
  collectionName: string,
): unknown[] {
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

// ---------------------------------------------------------------- QQL (OT plane)

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

export function buildFilterExpression(parameters: IDataObject): string {
  const groups = getCollectionEntries(parameters, 'filterGroups') as Array<Record<string, unknown>>;

  if (groups.length === 0) {
    return buildFlatFilterExpression(
      getCollectionEntries(parameters, 'filters') as Array<Record<string, unknown>>,
    );
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

// ------------------------------------------------------------- sorts (OT plane)

/**
 * Sortable fields per operation. The OT API wants fully qualified tokens; these
 * aliases let the short name in the UI stand in for the long one.
 */
const SORT_ALIASES: Record<string, Record<string, string>> = {
  listHostAssets: {
    created: 'asset.created',
    lastUpdated: 'asset.lastUpdated',
    name: 'asset.name',
    risk: 'asset.risk',
    vulnerabilityCount: 'asset.vulnerabilityCount',
  },
  listOtVulnerabilities: {
    criticality: 'vulnerabilities.criticality',
    lastDetected: 'vulnerabilities.lastDetected',
    qid: 'vulnerabilities.qid',
    severity: 'vulnerabilities.severity',
    typeDetected: 'vulnerabilities.typeDetected',
    vulnCategory: 'vulnerabilities.vulnCategory',
  },
  listProjectFiles: {
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

export function resolveSortField(operation: string, field: string): string {
  if (!field) {
    return '';
  }

  if (field.includes('.')) {
    return field;
  }

  return SORT_ALIASES[operation]?.[field] ?? field;
}

export function buildSortExpression(operation: string, sorts: IDataObject): string {
  const rules = getCollectionEntries(sorts, 'sorts') as Array<Record<string, unknown>>;
  if (rules.length === 0) {
    return '';
  }

  const sortRules: Array<Record<string, string>> = [];

  for (const rule of rules) {
    const field = resolveSortField(operation, String(rule.field ?? '').trim());
    if (!field) {
      continue;
    }

    const direction = String(rule.direction ?? 'asc').trim() === 'desc' ? 'desc' : 'asc';
    sortRules.push({ [field]: direction });
  }

  return JSON.stringify(sortRules);
}

// ------------------------------------------------------ structured JSON (CSAM)

export type CsamFilter = {
  filters: Array<{ field: string; operator: string; value: string }>;
  operation?: 'AND' | 'OR';
};

/**
 * The Asset Management API takes a flat criteria list joined by one top-level
 * `operation`. There is no nesting and no per-row join, so the grouped QQL
 * builder above does not apply here.
 */
export function buildCsamFilter(parameters: IDataObject, match: string): CsamFilter | undefined {
  const rows = getCollectionEntries(parameters, 'filters') as Array<Record<string, unknown>>;
  const filters: CsamFilter['filters'] = [];

  for (const row of rows) {
    const field = String(row.field ?? '').trim();
    if (!field) {
      continue;
    }

    filters.push({
      field,
      operator: String(row.operator ?? 'CONTAINS').trim(),
      value: String(row.value ?? '').trim(),
    });
  }

  if (filters.length === 0) {
    return undefined;
  }

  const operation = normalizeJoin(match);
  return filters.length > 1 ? { filters, operation } : { filters };
}

/**
 * The software component endpoints take a different document: component-scoped
 * criteria and asset-scoped criteria in separate blocks, ANDed together. Rows
 * are routed by their field prefix so one filter UI can serve both.
 */
export function buildComponentFilter(
  parameters: IDataObject,
  match: string,
): IDataObject | undefined {
  const rows = getCollectionEntries(parameters, 'filters') as Array<Record<string, unknown>>;
  const component: CsamFilter['filters'] = [];
  const asset: CsamFilter['filters'] = [];

  for (const row of rows) {
    const field = String(row.field ?? '').trim();
    if (!field) {
      continue;
    }

    const criteria = {
      field,
      operator: String(row.operator ?? 'CONTAINS').trim(),
      value: String(row.value ?? '').trim(),
    };

    (field.startsWith('component.') ? component : asset).push(criteria);
  }

  if (component.length === 0 && asset.length === 0) {
    return undefined;
  }

  const operation = normalizeJoin(match);
  const block = (filters: CsamFilter['filters']): CsamFilter =>
    filters.length > 1 ? { filters, operation } : { filters };

  const body: IDataObject = {};
  if (component.length > 0) {
    body.componentFilter = block(component) as unknown as IDataObject['value'];
  }
  if (asset.length > 0) {
    body.assetSoftwareFilter = block(asset) as unknown as IDataObject['value'];
  }

  return body;
}

// ------------------------------------------------- flat query parameters (FO)

/**
 * The platform API takes a fixed set of named parameters rather than a filter
 * expression. Empty values are dropped so an untouched collection field does
 * not narrow the result set.
 */
export function buildFoParameters(options: IDataObject): IDataObject {
  const qs: IDataObject = {};

  for (const [key, value] of Object.entries(options ?? {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (typeof value === 'boolean') {
      qs[key] = value ? 1 : 0;
      continue;
    }

    qs[key] = value as IDataObject['value'];
  }

  const extras = getCollectionEntries(options, 'extraParameters') as Array<Record<string, unknown>>;
  delete qs.extraParameters;

  for (const extra of extras) {
    const name = String(extra.name ?? '').trim();
    if (!name) {
      continue;
    }
    qs[name] = String(extra.value ?? '');
  }

  return qs;
}

/** Parameter pairs Qualys refuses to accept together. */
const MUTUALLY_EXCLUSIVE: Array<[string, string]> = [
  ['ag_ids', 'ag_titles'],
  ['detection_updated_since', 'max_days_since_detection_updated'],
  ['detection_last_tested_since', 'detection_last_tested_since_days'],
  ['detection_last_tested_before', 'detection_last_tested_before_days'],
  ['vm_scan_since', 'max_days_since_last_vm_scan'],
  ['no_vm_scan_since', 'max_days_since_last_vm_scan'],
  ['arf_filter_keys', 'arf_kernel_filter'],
  ['include_search_list_ids', 'include_search_list_titles'],
  ['exclude_search_list_ids', 'exclude_search_list_titles'],
];

const SEARCH_LIST_PARAMS = [
  'include_search_list_ids',
  'include_search_list_titles',
  'exclude_search_list_ids',
  'exclude_search_list_titles',
];

const HOST_TARGET_PARAMS = ['ids', 'ips', 'ag_ids', 'ag_titles', 'id_min', 'id_max'];

/** Score ranges, each gated behind the toggle that makes the score available. */
const SCORE_RANGES: Array<[string, string, string]> = [
  ['qds_min', 'qds_max', 'show_qds'],
  ['trurisk_min', 'trurisk_max', 'show_trurisk'],
];

type Predicate = (key: string) => boolean;

function findExclusiveClash(has: Predicate): string | undefined {
  for (const [first, second] of MUTUALLY_EXCLUSIVE) {
    if (has(first) && has(second)) {
      return `Qualys does not accept "${first}" and "${second}" in the same request.`;
    }
  }

  return undefined;
}

function findTargetClash(has: Predicate): string | undefined {
  if (SEARCH_LIST_PARAMS.some(has) && (has('qids') || has('severities'))) {
    return 'Search list parameters cannot be combined with "qids" or "severities".';
  }

  if (has('ipv6') && HOST_TARGET_PARAMS.some(has)) {
    return 'When "ipv6" is used, no other host target parameter is accepted.';
  }

  return undefined;
}

function findRangeProblem(qs: IDataObject, has: Predicate): string | undefined {
  for (const [min, max, toggle] of SCORE_RANGES) {
    if ((has(min) || has(max)) && !has(toggle)) {
      return `"${min}"/"${max}" require "${toggle}" to be enabled.`;
    }

    if (has(min) && has(max) && Number(qs[min]) >= Number(qs[max])) {
      return `"${min}" must be lower than "${max}".`;
    }
  }

  return undefined;
}

/**
 * Qualys rejects several parameter combinations with an opaque 400. Catching
 * them here turns that into an actionable message.
 */
export function validateFoParameters(qs: IDataObject): string | undefined {
  const has: Predicate = (key) =>
    qs[key] !== undefined && qs[key] !== null && qs[key] !== '' && qs[key] !== 0;

  return findExclusiveClash(has) ?? findTargetClash(has) ?? findRangeProblem(qs, has);
}
