import { NodeOperationError, type IDataObject, type IExecuteFunctions } from 'n8n-workflow';

import {
  buildComponentFilter,
  buildCsamFilter,
  buildFilterExpression,
  buildFoParameters,
  buildSortExpression,
  validateFoParameters,
} from './filters';
import {
  CSAM_PAGE_SIZE_HARD_MAX,
  CSAM_PAGE_SIZE_MAX,
  FO_DEFAULT_TRUNCATION,
  OT_PAGE_SIZE,
  type Operation,
  type OperationDefinition,
} from './resources';
import { readHeader } from './records';
import { findNextBatchUrl, qualysApiRequest } from '../transport';

export type PagedRequest = Parameters<typeof qualysApiRequest>[0];

/**
 * Each plane advertises "there is more" differently, so paging is expressed as a
 * tiny state machine rather than a shared loop: `next` builds the request for
 * the page we are on, `advance` reads the response and decides whether another
 * one exists.
 */
export type Pager = {
  next: () => PagedRequest | undefined;
  advance: (body: IDataObject, pageRecordCount: number) => void;
  /** Optional hook for pagers that need the response headers. */
  observe?: (body: IDataObject, headers: IDataObject) => void;
};

/** VMDR OT: a zero-based page number, with the grand total in a `count` header. */
function otPager(this: IExecuteFunctions, definition: Operation, itemIndex: number): Pager {
  const filter = buildFilterExpression({
    filterGroups: this.getNodeParameter('filterGroups', itemIndex, {}) as IDataObject,
    filters: this.getNodeParameter('filters', itemIndex, {}) as IDataObject,
  });
  const sort = buildSortExpression(
    definition.operation,
    this.getNodeParameter('sorts', itemIndex, {}) as IDataObject,
  );

  let pageNumber = 0;
  let exhausted = false;
  let seen = 0;
  let total: number | undefined;

  return {
    next: () =>
      exhausted
        ? undefined
        : {
            plane: 'ot' as const,
            endpoint: definition.endpoint,
            method: 'GET' as const,
            qs: buildOtQuery(pageNumber, OT_PAGE_SIZE, filter, sort),
            emptyOn404: definition.emptyOn404,
          },
    advance: (_body, pageRecordCount) => {
      if (pageRecordCount < OT_PAGE_SIZE) {
        exhausted = true;
        return;
      }

      seen += pageRecordCount;
      // The OT endpoints report the grand total in a `count` header, so a full
      // final page does not need an extra empty request to confirm it.
      if (total !== undefined && seen >= total) {
        exhausted = true;
        return;
      }

      pageNumber += 1;
    },
    observe: (_body, headers) => {
      const parsed = Number(readHeader(headers, 'count'));
      if (Number.isFinite(parsed)) {
        total = parsed;
      }
    },
  };
}

/** EASM on the gateway: a zero-based page number and a `hasNextPage` flag. */
function gatewayPager(definition: Operation): Pager {
  let pageNumber = 0;
  let exhausted = false;

  return {
    next: () =>
      exhausted
        ? undefined
        : {
            plane: 'gateway' as const,
            endpoint: definition.endpoint,
            method: definition.method,
            qs: { pageNumber },
            emptyOn404: definition.emptyOn404,
          },
    advance: (body) => {
      // `hasNextPage` is the only progress signal; a page past the end answers
      // 404, which emptyOn404 turns into an empty body.
      if (body.hasNextPage !== true) {
        exhausted = true;
        return;
      }

      pageNumber += 1;
    },
  };
}

/** Asset Management: a cursor carried forward from the previous response. */
function csamPager(this: IExecuteFunctions, definition: Operation, itemIndex: number): Pager {
  const options = this.getNodeParameter('csamOptions', itemIndex, {}) as IDataObject;
  const match = this.getNodeParameter('csamMatch', itemIndex, 'AND') as string;
  const rows = this.getNodeParameter('csamFilters', itemIndex, {}) as IDataObject;
  const filter = buildCsamBody(definition, rows, match);

  let cursor: number | undefined;
  let exhausted = false;

  return {
    next: () =>
      exhausted
        ? undefined
        : {
            plane: 'csam' as const,
            endpoint: definition.endpoint,
            method: 'POST' as const,
            qs: buildCsamQuery(options, cursor, definition),
            body: filter,
          },
    advance: (body) => {
      const hasMore = Number(body.hasMore ?? 0);
      // The request parameter and the response field are not the same name on
      // every Asset Management endpoint.
      const field = definition.cursor?.responseField ?? 'lastSeenAssetId';
      const lastSeen = Number(body[field] ?? 0);

      if (hasMore !== 1 || !lastSeen || lastSeen === cursor) {
        exhausted = true;
        return;
      }

      cursor = lastSeen;
    },
  };
}

/** Query-string parameters for the first platform API call. */
function buildFoQuery(
  this: IExecuteFunctions,
  definition: Operation,
  itemIndex: number,
): IDataObject {
  const options = definition.optionsProperty
    ? (this.getNodeParameter(definition.optionsProperty, itemIndex, {}) as IDataObject)
    : {};
  const qs = buildFoParameters(options);
  qs.action = definition.apiAction ?? 'list';

  if (definition.truncatable) {
    const requested = Number(
      this.getNodeParameter('truncationLimit', itemIndex, FO_DEFAULT_TRUNCATION),
    );
    qs.truncation_limit = Number.isFinite(requested)
      ? Math.max(0, requested)
      : FO_DEFAULT_TRUNCATION;
  }

  if (definition.operation === 'listCveScores') {
    const cve = String(this.getNodeParameter('cve', itemIndex, '')).trim();
    if (!cve) {
      throw new NodeOperationError(this.getNode(), 'At least one CVE ID is required.', {
        itemIndex,
      });
    }
    qs.cve = cve;
    qs.details = qs.details ?? 'Basic';
  }

  const problem = validateFoParameters(qs);
  if (problem) {
    throw new NodeOperationError(this.getNode(), problem, { itemIndex });
  }

  return qs;
}

/**
 * Platform API: the first call is built from parameters, every later call
 * follows the URL Qualys hands back in the WARNING element.
 */
function foPager(this: IExecuteFunctions, definition: Operation, itemIndex: number): Pager {
  const qs = buildFoQuery.call(this, definition, itemIndex);

  let nextUrl: string | undefined;
  let first = true;

  return {
    next: () => {
      if (first) {
        return {
          plane: 'fo' as const,
          endpoint: definition.endpoint,
          method: 'GET' as const,
          qs,
          xml: definition.xml,
        };
      }

      return nextUrl
        ? { plane: 'fo' as const, endpoint: nextUrl, method: 'GET' as const, xml: definition.xml }
        : undefined;
    },
    advance: (body) => {
      first = false;
      nextUrl = findNextBatchUrl(body);
    },
  };
}

export function createPager(
  this: IExecuteFunctions,
  definition: Operation,
  itemIndex: number,
): Pager {
  if (definition.plane === 'ot') {
    return otPager.call(this, definition, itemIndex);
  }

  if (definition.plane === 'gateway') {
    return gatewayPager(definition);
  }

  if (definition.plane === 'csam') {
    return csamPager.call(this, definition, itemIndex);
  }

  return foPager.call(this, definition, itemIndex);
}

export function buildOtQuery(
  pageNumber: number,
  pageSize: number,
  filter: string,
  sort: string,
): IDataObject {
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

export function buildCsamBody(
  definition: Pick<OperationDefinition, 'filterShape'>,
  rows: IDataObject,
  match: string,
): IDataObject | undefined {
  return definition.filterShape === 'componentFilter'
    ? buildComponentFilter(rows, match)
    : (buildCsamFilter(rows, match) as unknown as IDataObject | undefined);
}

export function buildCsamQuery(
  options: IDataObject,
  cursor?: number,
  definition?: Pick<OperationDefinition, 'cursor' | 'pageSize'>,
): IDataObject {
  const sizing = definition?.pageSize ?? { default: 100, max: CSAM_PAGE_SIZE_MAX };
  const qs: IDataObject = {
    pageSize: clampCsamPageSize(Number(options.pageSize ?? sizing.default), sizing.max),
  };

  if (cursor) {
    qs[definition?.cursor?.requestParam ?? 'lastSeenAssetId'] = cursor;
  }

  for (const key of ['includeFields', 'excludeFields', 'softwareType'] as const) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) {
      qs[key] = value.trim();
    }
  }

  if (typeof options.assetLastUpdated === 'string' && options.assetLastUpdated.trim()) {
    qs.assetLastUpdated = formatCsamDate(options.assetLastUpdated);
  }

  return qs;
}

/** The API wants `yyyy-MM-ddTHH:mmZ`; n8n hands over a full ISO timestamp. */
export function formatCsamDate(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value.trim();
  }

  return `${parsed.toISOString().slice(0, 16)}Z`;
}

export function clampCsamPageSize(value: number, max = CSAM_PAGE_SIZE_MAX): number {
  const ceiling = Math.max(1, Math.min(max, CSAM_PAGE_SIZE_HARD_MAX));
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return Math.min(100, ceiling);
  }

  return Math.max(1, Math.min(ceiling, Math.floor(parsed)));
}
