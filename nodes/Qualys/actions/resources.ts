import type { QualysOperationKind, QualysPlane, QualysResource } from './node.type';

export type OperationDefinition = {
  /** Menu entry. Operation values are globally unique, so `displayOptions` can key on them alone. */
  name: string;
  /** Shown in n8n's action picker; distinct per operation. */
  action: string;
  description: string;
  /** What the router does with the response. */
  kind: QualysOperationKind;

  plane: QualysPlane;
  endpoint: string;
  method: 'GET' | 'POST';
  /** Dotted path to the record array in the parsed response. */
  recordPath?: string;
  /** Response is XML rather than JSON. */
  xml?: boolean;
  /** `action=list` and friends, required on the platform plane. */
  apiAction?: string;
  /**
   * Response is an object keyed by identifier rather than a record array. The
   * key is injected into each record under this name.
   */
  keyedRecords?: string;
  /** Endpoints that answer 404 or 204 when the account holds no records. */
  emptyOn404?: boolean;
  /**
   * Asset Management cursor paging. The request parameter and the response field
   * are NOT the same name on every endpoint.
   */
  cursor?: { requestParam: string; responseField: string };
  pageSize?: { default: number; max: number };
  /** Which filter document the endpoint expects. */
  filterShape?: 'assetCriteria' | 'componentFilter';
  /** Node property holding this operation's Options collection, if it has one. */
  optionsProperty?: string;
  /** Batch size is controlled by `truncation_limit`. */
  truncatable?: boolean;
  /** The record id goes in the path rather than the query string. */
  idInPath?: boolean;
};

export type ResourceDefinition = {
  name: string;
  description: string;
  operations: Record<string, OperationDefinition>;
};

const list = (over: Omit<OperationDefinition, 'kind' | 'method'> & { method?: 'GET' | 'POST' }) =>
  ({ kind: 'list', method: 'GET', ...over }) as OperationDefinition;

/**
 * Resources group endpoints by what the data is; the operation names the record.
 *
 * Endpoint versions are pinned to the only ones Qualys still marks Active. Host
 * List and Host List Detection 2.0-4.0 reached End-of-Support in December 2025;
 * the KnowledgeBase, Report and Dynamic Search List APIs have each since moved
 * a version on.
 */
export const RESOURCES: Record<QualysResource, ResourceDefinition> = {
  ot: {
    name: 'OT',
    description: 'Operational technology inventory from VMDR OT',
    operations: {
      listHostAssets: list({
        name: 'List Host Assets',
        action: 'List OT host assets',
        description: 'Assets discovered on the OT network',
        plane: 'ot',
        endpoint: '/ot/1.0/host/list',
        recordPath: 'assets',
      }),
      listOtVulnerabilities: list({
        name: 'List Vulnerabilities',
        action: 'List OT vulnerabilities',
        description: 'Vulnerabilities detected on OT assets',
        plane: 'ot',
        endpoint: '/ot/1.0/detection/list',
        recordPath: 'vulnerabilities',
      }),
      listProjectFiles: list({
        name: 'List Project Files',
        action: 'List OT project files',
        description: 'Engineering project files found on OT assets',
        plane: 'ot',
        endpoint: '/ot/1.0/projectfile/list',
        emptyOn404: true,
      }),
    },
  },

  itAsset: {
    name: 'IT Asset',
    description: 'IT asset inventory from CyberSecurity Asset Management',
    operations: {
      listAssets: list({
        name: 'List Assets',
        action: 'List IT assets',
        description: 'Assets matching the filter',
        plane: 'csam',
        endpoint: '/rest/2.0/search/am/asset',
        method: 'POST',
        recordPath: 'assetListData.asset',
        cursor: { requestParam: 'lastSeenAssetId', responseField: 'lastSeenAssetId' },
        pageSize: { default: 100, max: 300 },
        filterShape: 'assetCriteria',
      }),
      getAsset: {
        name: 'Get Asset',
        action: 'Get an IT asset',
        description: 'One asset by ID',
        kind: 'get',
        plane: 'csam',
        endpoint: '/rest/2.0/get/am/asset',
        method: 'GET',
        recordPath: 'assetListData.asset',
      },
      countAssets: {
        name: 'Count Assets',
        action: 'Count IT assets',
        description: 'How many assets match the filter',
        kind: 'count',
        plane: 'csam',
        endpoint: '/rest/2.0/count/am/asset',
        method: 'POST',
        filterShape: 'assetCriteria',
      },
      listComponents: list({
        name: 'List Software Components',
        action: 'List software components',
        description: 'Components found across assets by software composition analysis',
        plane: 'csam',
        endpoint: '/rest/2.0/am/asset/component',
        method: 'POST',
        recordPath: 'assetComponentsList',
        // Note the asymmetry: the request takes lastSeenAssetComponentId, the
        // response reports lastAssetComponentId.
        cursor: { requestParam: 'lastSeenAssetComponentId', responseField: 'lastAssetComponentId' },
        pageSize: { default: 500, max: 1000 },
        filterShape: 'componentFilter',
      }),
      getComponents: {
        name: 'Get Software Components',
        action: 'Get software components of an asset',
        description: 'Components on one asset',
        kind: 'get',
        plane: 'csam',
        endpoint: '/rest/2.0/am/asset/component/{assetId}',
        method: 'POST',
        recordPath: 'assetComponentsList',
        pageSize: { default: 500, max: 1000 },
        idInPath: true,
      },
    },
  },

  vmdr: {
    name: 'VMDR',
    description:
      'Vulnerability Management, Detection and Response: detections, hosts, scan scope, scans and search lists',
    operations: {
      listDetections: list({
        name: 'List Detections',
        action: 'List vulnerability detections',
        description: 'Per-host detections with Qualys Detection Scores',
        plane: 'fo',
        endpoint: '/api/5.0/fo/asset/host/vm/detection/',
        xml: true,
        apiAction: 'list',
        recordPath: 'HOST_LIST_VM_DETECTION_OUTPUT.RESPONSE.HOST_LIST.HOST',
        optionsProperty: 'detectionOptions',
        truncatable: true,
      }),
      listKnowledgeBase: list({
        name: 'List KnowledgeBase',
        action: 'List KnowledgeBase entries',
        description: 'QID metadata: description, threat, solution, CVEs',
        plane: 'fo',
        endpoint: '/api/4.0/fo/knowledge_base/vuln/',
        xml: true,
        apiAction: 'list',
        recordPath: 'KNOWLEDGE_BASE_VULN_LIST_OUTPUT.RESPONSE.VULN_LIST.VULN',
        optionsProperty: 'knowledgeBaseOptions',
      }),
      listCveScores: list({
        name: 'List CVE Scores',
        action: 'List CVE risk scores',
        description: 'Qualys Vulnerability Score per CVE',
        plane: 'fo',
        endpoint: '/api/2.0/fo/knowledge_base/qvs/',
        apiAction: 'list',
        keyedRecords: 'cve',
        optionsProperty: 'cveScoreOptions',
      }),
      listHosts: list({
        name: 'List Hosts',
        action: 'List scanned hosts',
        description: 'Scanned hosts with TruRisk scores',
        plane: 'fo',
        endpoint: '/api/5.0/fo/asset/host/',
        xml: true,
        apiAction: 'list',
        recordPath: 'HOST_LIST_OUTPUT.RESPONSE.HOST_LIST.HOST',
        optionsProperty: 'hostOptions',
        truncatable: true,
      }),
      listVirtualHosts: list({
        name: 'List Virtual Hosts',
        action: 'List virtual hosts',
        description: 'Virtual host configuration',
        plane: 'fo',
        endpoint: '/api/2.0/fo/asset/vhost/',
        xml: true,
        apiAction: 'list',
        recordPath: 'VIRTUAL_HOST_LIST_OUTPUT.RESPONSE.VIRTUAL_HOST_LIST.VHOST',
      }),
      listAssetGroups: list({
        name: 'List Asset Groups',
        action: 'List asset groups',
        description: 'Asset groups and their members',
        plane: 'fo',
        endpoint: '/api/2.0/fo/asset/group/',
        xml: true,
        apiAction: 'list',
        recordPath: 'ASSET_GROUP_LIST_OUTPUT.RESPONSE.ASSET_GROUP_LIST.ASSET_GROUP',
        optionsProperty: 'assetGroupOptions',
        truncatable: true,
      }),
      listNetworks: list({
        name: 'List Networks',
        action: 'List networks',
        description: 'Custom networks, when network support is enabled',
        plane: 'fo',
        endpoint: '/api/2.0/fo/network/',
        xml: true,
        apiAction: 'list',
        recordPath: 'NETWORK_LIST_OUTPUT.RESPONSE.NETWORK_LIST.NETWORK',
      }),
      listDomains: list({
        name: 'List Domains',
        action: 'List domains',
        description: 'Domains registered in the subscription',
        plane: 'fo',
        endpoint: '/api/2.0/fo/asset/domain/',
        xml: true,
        apiAction: 'list',
        // This endpoint answers without the usual _OUTPUT/RESPONSE envelope.
        recordPath: 'DOMAIN_LIST.DOMAIN',
      }),
      listIpAddresses: list({
        name: 'List IP Addresses',
        action: 'List IP addresses',
        description: 'Addresses and ranges in the subscription',
        plane: 'fo',
        endpoint: '/api/2.0/fo/asset/ip/',
        xml: true,
        apiAction: 'list',
        // IP_SET carries bare addresses and ranges side by side, so it is
        // emitted whole rather than split into heterogeneous items.
        recordPath: 'IP_LIST_OUTPUT.RESPONSE.IP_SET',
        optionsProperty: 'ipOptions',
      }),
      listExcludedHosts: list({
        name: 'List Excluded Hosts',
        action: 'List excluded hosts',
        description: 'Hosts excluded from scanning',
        plane: 'fo',
        endpoint: '/api/2.0/fo/asset/excluded_ip/',
        xml: true,
        apiAction: 'list',
        recordPath: 'IP_LIST_OUTPUT.RESPONSE.IP_SET',
      }),
      listScans: list({
        name: 'List Scans',
        action: 'List scans',
        description: 'Scan history and status',
        plane: 'fo',
        endpoint: '/api/2.0/fo/scan/',
        xml: true,
        apiAction: 'list',
        recordPath: 'SCAN_LIST_OUTPUT.RESPONSE.SCAN_LIST.SCAN',
        optionsProperty: 'scanOptions',
      }),
      listAppliances: list({
        name: 'List Scanner Appliances',
        action: 'List scanner appliances',
        description: 'Scanner appliances and their status',
        plane: 'fo',
        endpoint: '/api/2.0/fo/appliance/',
        xml: true,
        apiAction: 'list',
        recordPath: 'APPLIANCE_LIST_OUTPUT.RESPONSE.APPLIANCE_LIST.APPLIANCE',
      }),
      listReports: list({
        name: 'List Reports',
        action: 'List reports',
        description: 'Generated reports and their status',
        plane: 'fo',
        endpoint: '/api/3.0/fo/report/',
        xml: true,
        apiAction: 'list',
        recordPath: 'REPORT_LIST_OUTPUT.RESPONSE.REPORT_LIST.REPORT',
        optionsProperty: 'reportOptions',
      }),
      listStaticSearchLists: list({
        name: 'List Static Search Lists',
        action: 'List static search lists',
        description: 'Search lists with a fixed set of QIDs',
        plane: 'fo',
        endpoint: '/api/2.0/fo/qid/search_list/static/',
        xml: true,
        apiAction: 'list',
        recordPath: 'STATIC_SEARCH_LIST_OUTPUT.RESPONSE.STATIC_LISTS.STATIC_LIST',
        optionsProperty: 'searchListOptions',
      }),
      listDynamicSearchLists: list({
        name: 'List Dynamic Search Lists',
        action: 'List dynamic search lists',
        description:
          'Search lists built from a query. Qualys evaluates these server side and they can be slow.',
        plane: 'fo',
        endpoint: '/api/3.0/fo/qid/search_list/dynamic/',
        xml: true,
        apiAction: 'list',
        recordPath: 'DYNAMIC_SEARCH_LIST_OUTPUT.RESPONSE.DYNAMIC_LISTS.DYNAMIC_LIST',
        optionsProperty: 'searchListOptions',
      }),
    },
  },

  easm: {
    name: 'EASM',
    description: 'External attack surface discovery',
    operations: {
      listProfiles: list({
        name: 'List Profiles',
        action: 'List EASM profiles',
        description: 'Discovery profiles and their seeds',
        plane: 'gateway',
        endpoint: '/easm/v2/profile',
        recordPath: 'profile',
        // Pages on a zero-based pageNumber and answers 404 past the last page.
        emptyOn404: true,
      }),
      listUnresolvedDomains: list({
        name: 'List Unresolved Domains',
        action: 'List unresolved domains',
        description: 'Domains discovered but not yet resolved to assets',
        plane: 'csam',
        endpoint: '/rest/2.0/am/domain/list',
        method: 'POST',
        recordPath: 'domainListData.domains',
        cursor: { requestParam: 'lastFetchDomainId', responseField: 'lastFetchDomainId' },
        pageSize: { default: 100, max: 300 },
        filterShape: 'assetCriteria',
      }),
      countUnresolvedDomains: {
        name: 'Count Unresolved Domains',
        action: 'Count unresolved domains',
        description: 'How many unresolved domains match the filter',
        kind: 'count',
        plane: 'csam',
        endpoint: '/rest/2.0/am/domain/count',
        method: 'POST',
        filterShape: 'assetCriteria',
      },
    },
  },
};

/** An operation definition that knows its own name and which resource owns it. */
export type Operation = OperationDefinition & {
  operation: string;
  resource: QualysResource;
};

/** Every operation, flattened, so the UI and router can look one up directly. */
export const OPERATIONS: Record<string, Operation> = Object.fromEntries(
  Object.entries(RESOURCES).flatMap(([resource, definition]) =>
    Object.entries(definition.operations).map(([operation, spec]) => [
      operation,
      { ...spec, operation, resource: resource as QualysResource },
    ]),
  ),
);

/** Operation values matching a predicate, for building `displayOptions`. */
export const operationsWhere = (
  predicate: (operation: OperationDefinition) => boolean | undefined,
): string[] => Object.keys(OPERATIONS).filter((name) => Boolean(predicate(OPERATIONS[name])));

export const CSAM_PAGE_SIZE_MAX = 300;
export const CSAM_PAGE_SIZE_HARD_MAX = 1000;
export const OT_PAGE_SIZE = 100;
export const FO_DEFAULT_TRUNCATION = 1000;
