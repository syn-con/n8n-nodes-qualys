const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'n8n-workflow') {
    return {
      NodeConnectionType: { Main: 'main' },
      NodeApiError: class NodeApiError extends Error {},
      NodeOperationError: class NodeOperationError extends Error {},
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { QualysVmdrOtApi } = require('../.test-build/credentials/QualysVmdrOtApi.credentials');
const {
  QualysVmdrOt: QualysNodeClass,
} = require('../.test-build/nodes/Qualys/QualysVmdrOt.node');

const description = new QualysNodeClass().description;
const { OPERATIONS, RESOURCES } = require('../.test-build/nodes/Qualys/actions/resources');
const {
  buildBaseUrl,
  derivePlatformUrl,
  resolveHosts,
  parseQualysXml,
  findNextBatchUrl,
  pluck,
  PLANE_AUTH_ORDER,
  selectAuthMode,
  readJwtExpiry,
  isRateLimited,
  rateLimitWaitMs,
} = require('../.test-build/nodes/Qualys/transport');
const {
  buildComponentFilter,
  buildCsamFilter,
  buildCsamQuery,
  buildFilterExpression,
  buildFoParameters,
  buildOtQuery,
  buildSortExpression,
  clampCsamPageSize,
  extractRecords,
  flattenDetections,
  resolveItemIndices,
  formatCsamDate,
  resolveRecordLimit,
  takeRecordsFromPage,
  validateFoParameters,
} = require('../.test-build/nodes/Qualys/actions/router');

const propertyByName = (name) => description.properties.find((property) => property.name === name);

// --------------------------------------------------------------------- hosts

test('normalizes Qualys gateway base URLs', () => {
  assert.equal(buildBaseUrl('gateway.qg1.apps.qualys.com/'), 'https://gateway.qg1.apps.qualys.com');
  assert.equal(buildBaseUrl('https://gateway.qg1.apps.qualys.com/'), 'https://gateway.qg1.apps.qualys.com');
});

test('derives the platform host from the gateway host', () => {
  assert.equal(derivePlatformUrl('https://gateway.qg2.apps.qualys.eu'), 'https://qualysapi.qg2.apps.qualys.eu');
  // US1 and EU1 drop the qgN.apps segment on the platform host.
  assert.equal(derivePlatformUrl('https://gateway.qg1.apps.qualys.com'), 'https://qualysapi.qualys.com');
  assert.equal(derivePlatformUrl('https://gateway.qg1.apps.qualys.eu'), 'https://qualysapi.qualys.eu');
});

test('resolves both hosts from a pod, and from custom URLs', () => {
  assert.deepEqual(resolveHosts({ pod: 'eu2' }), {
    gateway: 'https://gateway.qg2.apps.qualys.eu',
    platform: 'https://qualysapi.qg2.apps.qualys.eu',
  });
  assert.deepEqual(resolveHosts({ pod: 'custom', baseUrl: 'gateway.example.com' }), {
    gateway: 'https://gateway.example.com',
    platform: 'https://qualysapi.example.com',
  });
  assert.deepEqual(
    resolveHosts({ pod: 'custom', baseUrl: 'https://gw.example.com', platformUrl: 'api.example.com' }),
    { gateway: 'https://gw.example.com', platform: 'https://api.example.com' },
  );
});

// ----------------------------------------------------------------------- auth

test('authenticates every plane with the API client, and nothing else', () => {
  for (const plane of ['ot', 'gateway', 'csam', 'fo']) {
    assert.deepEqual(PLANE_AUTH_ORDER[plane], ['client'], `${plane} is not client-only`);
  }

  // No username/password token and no HTTP Basic anywhere, including as a fallback.
  const modes = new Set(Object.values(PLANE_AUTH_ORDER).flat());
  assert.deepEqual([...modes], ['client']);
});

test('selects the client on every plane, or nothing without one', () => {
  const client = { clientId: 'a', clientSecret: 'b' };

  for (const plane of ['ot', 'gateway', 'csam', 'fo']) {
    // csam included: it does not accept the token yet, but the node sends it so
    // the operation starts working the day Qualys ships support.
    assert.equal(selectAuthMode(client, plane), 'client');
    assert.equal(selectAuthMode({}, plane), undefined);
  }

  // A leftover username and password from an older credential authenticates nothing.
  assert.equal(selectAuthMode({ username: 'u', password: 'p' }, 'csam'), undefined);
});

test('only treats an actual rejection as rate limited', () => {
  const res = (statusCode, headers = {}) => ({ statusCode, headers, body: '' });

  // A 200 whose window is exhausted is informational: the NEXT call will be
  // refused. Retrying here would discard a good response and spend another
  // call from an empty budget.
  assert.equal(isRateLimited(res(200, { 'x-ratelimit-remaining': '0' })), false);
  assert.equal(isRateLimited(res(200)), false);

  assert.equal(isRateLimited(res(409)), true);
  assert.equal(isRateLimited(res(429)), true);

  assert.equal(rateLimitWaitMs(res(409, { 'x-ratelimit-towait-sec': '300' })), 300000);
  assert.equal(rateLimitWaitMs(res(409)), 0);
  assert.equal(rateLimitWaitMs(res(409, { 'x-ratelimit-towait-sec': '0' })), 0);
});

test('reads the expiry out of a JWT payload', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1700000000 })).toString('base64url');
  assert.equal(readJwtExpiry(`header.${payload}.signature`), 1700000000000);
  assert.equal(readJwtExpiry('not-a-jwt'), undefined);
});

// -------------------------------------------------------------- OT plane (QQL)

test('builds list query string with optional filter and sort', () => {
  assert.deepEqual(buildOtQuery(0, 100, 'vendor : "Siemens"', '[{"lastUpdated":"desc"}]'), {
    pageNumber: 0,
    pageSize: 100,
    filter: 'vendor : "Siemens"',
    sort: '[{"lastUpdated":"desc"}]',
  });
  assert.deepEqual(buildOtQuery(2, 100, '', ''), { pageNumber: 2, pageSize: 100 });
});

test('builds grouped QQL filters and drops trailing joins', () => {
  assert.equal(
    buildFilterExpression({
      filterGroups: {
        filterGroups: [
          {
            filters: {
              filters: [
                { identifier: 'vulnerabilities.qid', operator: ':', value: '590191', join: 'AND' },
                { identifier: 'vulnerabilities.typeDetected', operator: ':', value: 'Confirmed', join: 'OR' },
                { identifier: 'vulnerabilities.lastDetected', operator: '>=', value: 'now-90d', join: 'AND' },
              ],
            },
            join: 'OR',
          },
          {
            filters: {
              filters: [
                { identifier: 'asset.name', operator: ':', value: 'PR_HOST_11', join: 'AND' },
                { identifier: 'asset.assetId', operator: '!=', value: '0', join: 'OR' },
              ],
            },
            join: 'AND',
          },
        ],
      },
    }),
    '(vulnerabilities.qid:590191 and vulnerabilities.typeDetected:Confirmed or vulnerabilities.lastDetected>=now-90d) or (asset.name:PR_HOST_11 and asset.assetId!=0)',
  );
});

test('builds sort JSON and maps bare aliases to Qualys tokens', () => {
  assert.equal(
    buildSortExpression('listOtVulnerabilities', {
      sorts: [
        { field: 'lastDetected', direction: 'desc' },
        { field: 'qid', direction: 'asc' },
      ],
    }),
    '[{"vulnerabilities.lastDetected":"desc"},{"vulnerabilities.qid":"asc"}]',
  );
  assert.equal(
    buildSortExpression('listHostAssets', { sorts: [{ field: 'risk', direction: 'desc' }] }),
    '[{"asset.risk":"desc"}]',
  );
  assert.equal(buildSortExpression('listHostAssets', {}), '');
  // Resources without an alias map must not throw.
  assert.equal(
    buildSortExpression('listHosts', { sorts: [{ field: 'anything', direction: 'asc' }] }),
    '[{"anything":"asc"}]',
  );
});

// ------------------------------------------------------------ CSAM plane (JSON)

test('builds the flat CSAM criteria document with a single join operator', () => {
  assert.deepEqual(
    buildCsamFilter({ filters: [{ field: 'software.product', operator: 'CONTAINS', value: 'Python' }] }, 'AND'),
    { filters: [{ field: 'software.product', operator: 'CONTAINS', value: 'Python' }] },
  );

  // The join is global; there is no nesting and no per-row operator.
  assert.deepEqual(
    buildCsamFilter(
      {
        filters: [
          { field: 'operatingSystem.category1', operator: 'EQUALS', value: 'Windows' },
          { field: 'hardware.category1', operator: 'EQUALS', value: 'Computers' },
        ],
      },
      'OR',
    ),
    {
      filters: [
        { field: 'operatingSystem.category1', operator: 'EQUALS', value: 'Windows' },
        { field: 'hardware.category1', operator: 'EQUALS', value: 'Computers' },
      ],
      operation: 'OR',
    },
  );

  assert.equal(buildCsamFilter({}, 'AND'), undefined);
  assert.equal(buildCsamFilter({ filters: [{ field: '  ', value: 'x' }] }, 'AND'), undefined);
});

test('routes component and asset criteria into their own filter blocks', () => {
  // The software component endpoints take two blocks ANDed together, not the
  // flat criteria list the asset endpoints use.
  assert.deepEqual(
    buildComponentFilter(
      {
        filters: [
          { field: 'component.name', operator: 'EQUALS', value: 'log4j' },
          { field: 'asset.riskScore', operator: 'GREATER', value: '800' },
        ],
      },
      'AND',
    ),
    {
      componentFilter: { filters: [{ field: 'component.name', operator: 'EQUALS', value: 'log4j' }] },
      assetSoftwareFilter: {
        filters: [{ field: 'asset.riskScore', operator: 'GREATER', value: '800' }],
      },
    },
  );

  // Only component rows -> only the component block.
  assert.deepEqual(
    buildComponentFilter({ filters: [{ field: 'component.version', operator: 'EQUALS', value: '2' }] }, 'AND'),
    { componentFilter: { filters: [{ field: 'component.version', operator: 'EQUALS', value: '2' }] } },
  );

  assert.equal(buildComponentFilter({}, 'AND'), undefined);
});

test('clamps the CSAM page size to the documented maximum', () => {
  assert.equal(clampCsamPageSize(0), 1);
  assert.equal(clampCsamPageSize(100), 100);
  assert.equal(clampCsamPageSize(5000), 300);
  assert.equal(clampCsamPageSize(Number.NaN), 100);
});

test('builds the CSAM query string and carries the cursor', () => {
  assert.deepEqual(buildCsamQuery({ pageSize: 50, includeFields: ' hardware ' }), {
    pageSize: 50,
    includeFields: 'hardware',
  });
  assert.deepEqual(buildCsamQuery({}, 6920718), { pageSize: 100, lastSeenAssetId: 6920718 });
});

test('uses each endpoint own cursor parameter and page size ceiling', () => {
  // Software components page on a differently named parameter and allow 1000.
  assert.deepEqual(buildCsamQuery({}, 42, OPERATIONS.listComponents), {
    pageSize: 500,
    lastSeenAssetComponentId: 42,
  });
  assert.deepEqual(buildCsamQuery({ pageSize: 1000 }, undefined, OPERATIONS.listComponents), {
    pageSize: 1000,
  });
  // The asset endpoints still cap at 300.
  assert.deepEqual(buildCsamQuery({ pageSize: 1000 }, undefined, OPERATIONS.listAssets), {
    pageSize: 300,
  });
  assert.deepEqual(buildCsamQuery({}, 7, OPERATIONS.listUnresolvedDomains), {
    pageSize: 100,
    lastFetchDomainId: 7,
  });
});

test('trims ISO timestamps to the minute precision the API expects', () => {
  assert.equal(formatCsamDate('2026-03-01T11:30:45.123Z'), '2026-03-01T11:30Z');
  assert.equal(formatCsamDate('not a date'), 'not a date');
});

// ------------------------------------------------------- platform plane (flat)

test('drops empty FO parameters and folds booleans to 0/1', () => {
  assert.deepEqual(buildFoParameters({ ids: '1-5', ips: '', show_qds: true, show_results: false }), {
    ids: '1-5',
    show_qds: 1,
    show_results: 0,
  });
});

test('passes extra FO parameters through verbatim', () => {
  assert.deepEqual(
    buildFoParameters({ extraParameters: { extraParameters: [{ name: 'os_hostname', value: '1' }] } }),
    { os_hostname: '1' },
  );
});

test('rejects FO parameter combinations Qualys answers with an opaque 400', () => {
  assert.match(validateFoParameters({ ag_ids: '1', ag_titles: 'x' }), /ag_ids.*ag_titles/);
  assert.match(validateFoParameters({ qids: '1', include_search_list_ids: '2' }), /Search list/);
  assert.match(validateFoParameters({ ipv6: '::1', ids: '5' }), /ipv6/);
  assert.match(validateFoParameters({ qds_min: 10 }), /show_qds/);
  assert.match(validateFoParameters({ show_qds: 1, qds_min: 90, qds_max: 10 }), /lower than/);
  assert.equal(validateFoParameters({ show_qds: 1, qds_min: 10, qds_max: 90 }), undefined);
  assert.equal(validateFoParameters({ ids: '1-5' }), undefined);
});

// -------------------------------------------------------------- XML handling

const DETECTION_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<HOST_LIST_VM_DETECTION_OUTPUT><RESPONSE><HOST_LIST>
  <HOST>
    <ID>4203254</ID>
    <IP>11.11.11.11</IP>
    <SERIAL_NUMBER><![CDATA[null]]></SERIAL_NUMBER>
    <DNS_DATA><HOSTNAME><![CDATA[web01]]></HOSTNAME><DOMAIN /><FQDN /></DNS_DATA>
    <DETECTION_LIST>
      <DETECTION>
        <QID>38170</QID><SEVERITY>2</SEVERITY>
        <QDS severity="LOW">25</QDS>
        <QDS_FACTORS>
          <QDS_FACTOR name="RTI"><![CDATA[No_Patch]]></QDS_FACTOR>
          <QDS_FACTOR name="CVSS"><![CDATA[3.1]]></QDS_FACTOR>
        </QDS_FACTORS>
      </DETECTION>
    </DETECTION_LIST>
  </HOST>
</HOST_LIST>
<WARNING><CODE>1980</CODE><URL><![CDATA[https://example.test/next?id_min=5]]></URL></WARNING>
</RESPONSE></HOST_LIST_VM_DETECTION_OUTPUT>`;

test('normalizes Qualys XML quirks seen on live responses', () => {
  const parsed = parseQualysXml(DETECTION_XML);
  const host = pluck(parsed, 'HOST_LIST_VM_DETECTION_OUTPUT.RESPONSE.HOST_LIST.HOST')[0];

  assert.equal(host.ID, 4203254);
  // <IP> is a scalar on a host, not a single-element array.
  assert.equal(host.IP, '11.11.11.11');
  // Qualys emits the literal four-character string "null".
  assert.equal(host.SERIAL_NUMBER, null);
  // Self-closing elements mean "no value".
  assert.deepEqual(host.DNS_DATA, { HOSTNAME: 'web01', DOMAIN: null, FQDN: null });

  const detection = host.DETECTION_LIST.DETECTION[0];
  // An attribute plus text content keeps both.
  assert.deepEqual(detection.QDS, { value: 25, severity: 'LOW' });
  // Attribute-keyed lists flatten, and the lone wrapper is hoisted away.
  assert.deepEqual(detection.QDS_FACTORS, { RTI: 'No_Patch', CVSS: '3.1' });
});

test('finds the next batch URL Qualys hands back in a WARNING', () => {
  assert.equal(findNextBatchUrl(parseQualysXml(DETECTION_XML)), 'https://example.test/next?id_min=5');
  assert.equal(findNextBatchUrl({ RESPONSE: {} }), undefined);
});

test('keeps repeated elements as arrays even when only one is present', () => {
  const single = parseQualysXml('<R><HOST_LIST><HOST><ID>1</ID></HOST></HOST_LIST></R>');
  assert.ok(Array.isArray(pluck(single, 'R.HOST_LIST.HOST')));

  for (const [xml, path] of [
    ['<D><NETBLOCK><RANGE><START>1.1.1.1</START></RANGE></NETBLOCK></D>', 'D.NETBLOCK.RANGE'],
    [
      '<N><SCANNER_APPLIANCE_LIST><SCANNER_APPLIANCE><ID>1</ID></SCANNER_APPLIANCE></SCANNER_APPLIANCE_LIST></N>',
      'N.SCANNER_APPLIANCE_LIST.SCANNER_APPLIANCE',
    ],
    ['<R><IP_SET><IP>1.2.3.4</IP></IP_SET></R>', 'R.IP_SET.IP'],
    ['<R><DOMAIN_LIST><DOMAIN><DOMAIN_ID>1</DOMAIN_ID></DOMAIN></DOMAIN_LIST></R>', 'R.DOMAIN_LIST.DOMAIN'],
    ['<R><NETWORK_LIST><NETWORK><ID>1</ID></NETWORK></NETWORK_LIST></R>', 'R.NETWORK_LIST.NETWORK'],
  ]) {
    assert.ok(Array.isArray(pluck(parseQualysXml(xml), path)), `${path} must be an array`);
  }
});

test('does not turn context-dependent element names into arrays', () => {
  // These names are records in one place and scalars in another; forcing them
  // to arrays everywhere corrupted host and detection records.
  const host = parseQualysXml(
    '<H><IP>1.2.3.4</IP><DNS_DATA><DOMAIN>x.example</DOMAIN></DNS_DATA>' +
      '<DETECTION_LIST><DETECTION><QID>38170</QID></DETECTION></DETECTION_LIST></H>',
  ).H;

  assert.equal(host.IP, '1.2.3.4');
  assert.equal(host.DNS_DATA.DOMAIN, 'x.example');
  assert.equal(host.DETECTION_LIST.DETECTION[0].QID, 38170);

  const domain = parseQualysXml(
    '<R><DOMAIN_LIST><DOMAIN><NETWORK><NETWORK_ID>0</NETWORK_ID></NETWORK></DOMAIN></DOMAIN_LIST></R>',
  );
  // NETWORK nested on a domain is a single object, not a list.
  assert.equal(pluck(domain, 'R.DOMAIN_LIST.DOMAIN')[0].NETWORK.NETWORK_ID, 0);
});

test('preserves values that must not be coerced to numbers', () => {
  const r = parseQualysXml(
    '<R><SERIAL>0012345</SERIAL><BIG>12345678901234567890</BIG><V>1.10</V><Z>0</Z></R>',
  ).R;
  // Leading zeros are significant in serials and asset tags.
  assert.equal(r.SERIAL, '0012345');
  // Beyond safe-integer precision, stay a string.
  assert.equal(r.BIG, '12345678901234567890');
  assert.equal(r.V, '1.10');
  assert.equal(r.Z, 0);
});

test('keeps container shapes stable regardless of optional siblings', () => {
  const withSibling = parseQualysXml(
    '<R><TRURISK_SCORE_FACTORS><TRURISK_SCORE_FORMULA>f</TRURISK_SCORE_FORMULA>' +
      '<VULN_COUNT qds_severity="2">50</VULN_COUNT></TRURISK_SCORE_FACTORS></R>',
  ).R.TRURISK_SCORE_FACTORS;
  const withoutSibling = parseQualysXml(
    '<R><TRURISK_SCORE_FACTORS><VULN_COUNT qds_severity="2">50</VULN_COUNT></TRURISK_SCORE_FACTORS></R>',
  ).R.TRURISK_SCORE_FACTORS;

  // Only QDS_FACTORS is hoisted; everything else keeps its wrapper so the shape
  // does not depend on which optional siblings a record happens to carry.
  assert.deepEqual(withSibling.VULN_COUNT, { 2: 50 });
  assert.deepEqual(withoutSibling.VULN_COUNT, { 2: 50 });
});

// ---------------------------------------------------------------- record shape

test('extracts records from every response shape the node meets', () => {
  assert.deepEqual(extractRecords({ assets: [{ assetId: 1 }] }, 'assets'), [{ assetId: 1 }]);
  assert.deepEqual(extractRecords({ assetListData: { asset: [{ assetId: 2 }] } }, 'assetListData.asset'), [
    { assetId: 2 },
  ]);
  assert.deepEqual(extractRecords([{ name: 'Project' }]), [{ name: 'Project' }]);
  // A CVE-keyed object becomes one record per CVE.
  assert.deepEqual(extractRecords({ 'CVE-1': { qvs: '100' } }, undefined, 'cve'), [
    { cve: 'CVE-1', qvs: '100' },
  ]);
  // An empty body is no records, not one empty record.
  assert.deepEqual(extractRecords({}), []);
  assert.deepEqual(extractRecords({ assets: [] }, 'assets'), []);
});

test('flattens detections onto their host context', () => {
  const hosts = [
    {
      ID: 1,
      IP: '10.0.0.1',
      DETECTION_LIST: { DETECTION: [{ QID: 11 }, { QID: 22 }] },
    },
    { ID: 2, IP: '10.0.0.2', DETECTION_LIST: { DETECTION: [] } },
  ];

  assert.deepEqual(flattenDetections(hosts), [
    { ID: 1, IP: '10.0.0.1', QID: 11 },
    { ID: 1, IP: '10.0.0.1', QID: 22 },
    { ID: 2, IP: '10.0.0.2' },
  ]);
});

test('runs get once per input item, and list once by default', () => {
  const ctx = (itemCount, params = {}) => ({
    getInputData: () => Array.from({ length: itemCount }, () => ({ json: {} })),
    getNodeParameter: (name, _index, fallback) => (name in params ? params[name] : fallback),
  });

  // `get` addresses one record, so every input item gets its own request.
  assert.deepEqual(resolveItemIndices.call(ctx(3), 'get'), [0, 1, 2]);

  // `list` describes a whole query; running per item would emit the full result
  // set once per item, which is the duplication fixed in 760689d.
  assert.deepEqual(resolveItemIndices.call(ctx(3), 'list'), [0]);
  assert.deepEqual(resolveItemIndices.call(ctx(3), 'count'), [0]);

  // Opting in gives one query per input item so expressions can reference each.
  assert.deepEqual(resolveItemIndices.call(ctx(3, { runOnce: false }), 'list'), [0, 1, 2]);
  assert.deepEqual(resolveItemIndices.call(ctx(3, { runOnce: true }), 'list'), [0]);

  // An empty input still runs once rather than doing nothing.
  assert.deepEqual(resolveItemIndices.call(ctx(0), 'list'), [0]);
  assert.deepEqual(resolveItemIndices.call(ctx(0), 'get'), [0]);
  assert.deepEqual(resolveItemIndices.call(ctx(0, { runOnce: false }), 'list'), [0]);
});

test('leaves every data field open to expressions', () => {
  // Only the fields that drive the UI may block expressions; anything carrying
  // a value must be settable from an upstream node.
  const blocked = [];
  const walk = (list, where) => {
    for (const property of list || []) {
      if (property.noDataExpression) blocked.push(`${where}${property.name}`);
      if (Array.isArray(property.options)) walk(property.options, `${where}${property.name}.`);
      if (Array.isArray(property.values)) walk(property.values, `${where}${property.name}.`);
    }
  };
  walk(description.properties, '');

  // A set, not a list: `operation` legitimately appears once per resource group,
  // and adding a group should not break this.
  assert.deepEqual([...new Set(blocked)].sort(), [
    'filterGroups.filterGroups.filters.filters.join',
    'filterGroups.filterGroups.filters.filters.operator',
    'filterGroups.filterGroups.join',
    'operation',
    'resource',
  ]);
});

test('gives every resource one Operation dropdown listing its records', () => {
  const dropdowns = description.properties.filter((property) => property.name === 'operation');

  for (const property of dropdowns) {
    const [resource] = property.displayOptions.show.resource;

    assert.deepEqual(
      property.options.map((option) => option.value).sort(),
      Object.keys(RESOURCES[resource].operations).sort(),
      `${resource} does not offer its own operations`,
    );
    assert.ok(
      property.options.every((option) => option.action && option.description),
      `${resource} has an operation with no action or description`,
    );
    assert.ok(
      Object.keys(RESOURCES[resource].operations).includes(property.default),
      `${resource} defaults to an operation it does not offer`,
    );
  }

  // Every resource is covered exactly once.
  const covered = dropdowns.flatMap((property) => property.displayOptions.show.resource);
  assert.equal(covered.length, new Set(covered).size, 'a resource is covered twice');
  assert.deepEqual(covered.sort(), Object.keys(RESOURCES).sort());
});

test('keeps every operation value unique, so displayOptions can key on it', () => {
  const declared = Object.values(RESOURCES).flatMap((resource) =>
    Object.keys(resource.operations),
  );

  assert.equal(declared.length, new Set(declared).size, 'two resources share an operation value');
  assert.deepEqual(declared.sort(), Object.keys(OPERATIONS).sort());
});

test('names every operation action distinctly, for the action picker', () => {
  const actions = Object.values(OPERATIONS).map((operation) => operation.action);
  assert.equal(actions.length, new Set(actions).size, 'two operations share an action label');
  assert.ok(actions.every(Boolean), 'an operation has no action label');
});

test('resolves list all and count limits', () => {
  assert.equal(resolveRecordLimit(100, false), 100);
  assert.equal(resolveRecordLimit(0, true), Number.POSITIVE_INFINITY);
  assert.equal(resolveRecordLimit(0, false), null);
  // A non-numeric Count must be rejected, not silently page everything and
  // then emit nothing.
  assert.equal(resolveRecordLimit(Number.NaN, false), null);
  assert.equal(resolveRecordLimit('abc', false), null);
  assert.equal(resolveRecordLimit(Number.NaN, true), Number.POSITIVE_INFINITY);
});

test('takes records from a page up to the remaining count', () => {
  assert.deepEqual(takeRecordsFromPage(['a', 'b', 'c', 'd'], 2), {
    records: ['a', 'b'],
    nextCount: 0,
  });
  // List All: every page is taken whole and the budget never runs down.
  assert.deepEqual(takeRecordsFromPage(['a', 'b'], Number.POSITIVE_INFINITY), {
    records: ['a', 'b'],
    nextCount: Number.POSITIVE_INFINITY,
  });
  // A page larger than the budget is truncated, not dropped.
  assert.deepEqual(takeRecordsFromPage(['a', 'b', 'c'], 1), { records: ['a'], nextCount: 0 });
});

// ------------------------------------------------------------- node metadata

test('publishes the Qualys credential with one API client and no password', () => {
  const credential = new QualysVmdrOtApi();
  assert.equal(credential.name, 'qualysVmdrOtApi');
  assert.equal(credential.displayName, 'Qualys API');

  const names = credential.properties.map((property) => property.name);
  assert.deepEqual(names, [
    'pod',
    'baseUrl',
    'platformUrl',
    'clientGrant',
    'clientId',
    'clientSecret',
    'xRequestedWith',
  ]);

  // Only User Level clients are offered. Subscription Level is still honoured
  // when a stored credential carries it - see the token endpoint tests - but it
  // is not something a new credential can be pointed at.
  const grant = credential.properties.find((property) => property.name === 'clientGrant');
  assert.deepEqual(
    grant.options.map((option) => option.value),
    ['oidc'],
  );
  assert.equal(grant.default, 'oidc');

  const pod = credential.properties.find((property) => property.name === 'pod');
  assert.equal(pod.default, 'eu1', 'the platform should default to EU1');
  // Custom is the escape hatch, so it sits at the end rather than the top.
  assert.equal(pod.options.at(-1).value, 'custom');
  assert.ok(
    pod.options.some((option) => option.value === pod.default),
    'the platform menu does not offer its own default',
  );

  // Secrets must never render in the clear.
  for (const secret of ['clientSecret']) {
    const property = credential.properties.find((entry) => entry.name === secret);
    assert.equal(property.typeOptions.password, true, `${secret} is not masked`);
  }
});

test('describes the node and its resource menu', () => {
  assert.equal(description.displayName, 'Qualys');
  assert.equal(description.name, 'qualysVmdrOt');
  assert.equal(description.credentials[0].name, 'qualysVmdrOtApi');
  assert.equal(require('../.test-build/nodes/Qualys/QualysVmdrOt.node').QualysVmdrOt.name, 'QualysVmdrOt');

  const menu = description.properties[0];
  assert.deepEqual(
    menu.options.map((option) => option.value).sort(),
    Object.keys(RESOURCES).sort(),
  );
  assert.ok(
    menu.options.some((option) => option.value === menu.default),
    'the resource menu does not offer its own default',
  );
  assert.ok(
    menu.options.every((option) => option.name && option.description),
    'a resource has no name or description',
  );

  assert.equal(propertyByName('listAll').type, 'boolean');
  assert.equal(propertyByName('count').default, 100);
  assert.equal(propertyByName('truncationLimit').default, 1000);
});

test('gives every platform operation a record path and an action parameter', () => {
  for (const [name, definition] of Object.entries(OPERATIONS)) {
    if (definition.plane !== 'fo') continue;
    assert.ok(definition.apiAction, `${name} needs an action parameter`);
    if (!definition.keyedRecords) {
      assert.ok(definition.recordPath, `${name} needs a record path`);
    }
  }
});

test('pins every operation to a currently supported API version', () => {
  assert.equal(OPERATIONS.listHosts.endpoint, '/api/5.0/fo/asset/host/');
  assert.equal(OPERATIONS.listDetections.endpoint, '/api/5.0/fo/asset/host/vm/detection/');
  assert.equal(OPERATIONS.listKnowledgeBase.endpoint, '/api/4.0/fo/knowledge_base/vuln/');
  assert.equal(OPERATIONS.listHostAssets.endpoint, '/ot/1.0/host/list');
  assert.equal(OPERATIONS.listAssets.endpoint, '/rest/2.0/search/am/asset');
  // Report and Dynamic Search List have each moved a version on.
  assert.equal(OPERATIONS.listReports.endpoint, '/api/3.0/fo/report/');
  assert.equal(OPERATIONS.listDynamicSearchLists.endpoint, '/api/3.0/fo/qid/search_list/dynamic/');

  for (const [name, definition] of Object.entries(OPERATIONS)) {
    assert.ok(['ot', 'gateway', 'csam', 'fo'].includes(definition.plane), `${name} has no plane`);
    assert.ok(['list', 'get', 'count'].includes(definition.kind), `${name} has no kind`);
  }
});
