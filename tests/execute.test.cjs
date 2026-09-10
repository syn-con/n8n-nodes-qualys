const assert = require('node:assert/strict');
const test = require('node:test');

const { makeContext, json, raw, params, listParams } = require('./support.cjs');

const { QualysVmdrOt } = require('../.test-build/nodes/Qualys/QualysVmdrOt.node');
const { clearTokenCache } = require('../.test-build/nodes/Qualys/transport');

/** Run the node the way n8n does, through the class rather than the router. */
async function execute(options) {
  clearTokenCache();
  const built = makeContext(options);
  const [items] = await new QualysVmdrOt().execute.call(built.context);
  return { items, calls: built.calls, authCalls: built.authCalls };
}

const hostXml = (id, warningUrl) =>
  `<HOST_LIST_OUTPUT><RESPONSE><HOST_LIST><HOST><ID>${id}</ID></HOST></HOST_LIST>` +
  (warningUrl ? `<WARNING><CODE>1980</CODE><URL><![CDATA[${warningUrl}]]></URL></WARNING>` : '') +
  `</RESPONSE></HOST_LIST_OUTPUT>`;

// --------------------------------------------------------------- node surface

test('the node exposes a description and delegates execution', async () => {
  const node = new QualysVmdrOt();
  assert.equal(node.description.name, 'qualysVmdrOt');
  assert.equal(typeof node.execute, 'function');

  const { items } = await execute({
    params: listParams('listHostAssets', { count: 1 }),
    script: () => json({ assets: [{ assetId: 1 }] }, { count: '1' }),
  });
  assert.deepEqual(items.map((i) => i.json.assetId), [1]);
});

// ------------------------------------------------------------ dispatch errors

test('rejects an operation it does not know', async () => {
  // A workflow saved against an older release can still hold a retired name.
  await assert.rejects(
    () => execute({ params: { operation: 'list', resource: 'ot' }, script: () => json({}) }),
    /Unsupported operation/,
  );
  await assert.rejects(
    () =>
      execute({
        params: { operation: 'deleteEverything', resource: 'ot' },
        script: () => json({}),
      }),
    /Unsupported operation/,
  );
});

test('rejects a zero Count unless List All is set', async () => {
  await assert.rejects(
    () => execute({ params: listParams('listHostAssets', { count: 0 }), script: () => json({}) }),
    /Count must be greater than 0/,
  );
});

test('reports a failure per input item when continuing on fail', async () => {
  const { items } = await execute({
    params: listParams('listHostAssets'),
    script: () => raw(500, JSON.stringify({ message: 'kaboom' })),
    continueOnFail: true,
  });
  assert.equal(items.length, 1);
  assert.match(items[0].json.error, /kaboom/);
  assert.deepEqual(items[0].pairedItem, { item: 0 });
});

// -------------------------------------------------------------- OT plane

test('pages the OT plane by page number and stops on a short page', async () => {
  const { items, calls } = await execute({
    params: listParams('listHostAssets', { listAll: true }),
    script: (options) => {
      const page = options.qs.pageNumber;
      const assets = page === 0 ? Array.from({ length: 100 }, (_, i) => ({ assetId: i })) : [{ assetId: 100 }];
      return json({ assets });
    },
  });
  assert.equal(items.length, 101);
  assert.deepEqual(calls.map((c) => c.qs.pageNumber), [0, 1]);
});

test('stops early when the OT count header is satisfied', async () => {
  const { calls } = await execute({
    params: listParams('listHostAssets', { listAll: true }),
    script: () => json(
      { assets: Array.from({ length: 100 }, (_, i) => ({ assetId: i })) },
      { count: '100' },
    ),
  });
  // A full final page needs no extra empty request to confirm the end.
  assert.equal(calls.length, 1);
});

test('sends the OT filter and sort when configured', async () => {
  const { calls } = await execute({
    params: listParams('listHostAssets', {
      count: 1,
      filterGroups: {
        filterGroups: [
          { filters: { filters: [{ identifier: 'hardware.class', operator: ':', value: 'IT' }] } },
        ],
      },
      sorts: { sorts: [{ field: 'lastUpdated', direction: 'desc' }] },
    }),
    script: () => json({ assets: [{ assetId: 1 }] }, { count: '1' }),
  });
  assert.equal(calls[0].qs.filter, 'hardware.class:IT');
  assert.equal(calls[0].qs.sort, '[{"asset.lastUpdated":"desc"}]');
});

test('treats a 404 as an empty OT project file list', async () => {
  const { items } = await execute({
    params: listParams('listProjectFiles'),
    script: () => raw(404, JSON.stringify({ _error: { code: 404, message: 'Files not found' } })),
  });
  assert.deepEqual(items, []);
});

// ------------------------------------------------------------ CSAM plane

test('follows the Asset Management cursor until it is exhausted', async () => {
  const { items, calls } = await execute({
    params: listParams('listAssets', { listAll: true, csamOptions: { pageSize: 2 } }),
    script: (options) => {
      const cursor = options.qs.lastSeenAssetId;
      if (!cursor) {
        return json({ count: 2, hasMore: 1, lastSeenAssetId: 2, assetListData: { asset: [{ assetId: 1 }, { assetId: 2 }] } });
      }
      return json({ count: 1, hasMore: 0, lastSeenAssetId: 3, assetListData: { asset: [{ assetId: 3 }] } });
    },
  });
  assert.deepEqual(items.map((i) => i.json.assetId), [1, 2, 3]);
  assert.deepEqual(calls.map((c) => c.qs.lastSeenAssetId), [undefined, 2]);
});

test('passes the Asset Management options through to the query', async () => {
  const { calls } = await execute({
    params: listParams('listAssets', {
      count: 1,
      csamOptions: {
        pageSize: 7,
        includeFields: 'hardware',
        excludeFields: 'software',
        softwareType: 'Application',
        assetLastUpdated: '2026-03-01T11:30:45.000Z',
      },
    }),
    script: () => json({ count: 1, hasMore: 0, assetListData: { asset: [{ assetId: 1 }] } }),
  });
  assert.deepEqual(calls[0].qs, {
    pageSize: 7,
    includeFields: 'hardware',
    excludeFields: 'software',
    softwareType: 'Application',
    assetLastUpdated: '2026-03-01T11:30Z',
  });
});

test('counts assets on the count endpoint', async () => {
  const { items, calls } = await execute({
    params: params('countAssets', {
      csamMatch: 'OR',
      csamFilters: {
        filters: [
          { field: 'operatingSystem.category1', operator: 'EQUALS', value: 'Windows' },
          { field: 'hardware.category1', operator: 'EQUALS', value: 'Computers' },
        ],
      },
    }),
    script: () => json({ count: 250, responseCode: 'SUCCESS' }),
  });
  assert.equal(items[0].json.count, 250);
  assert.deepEqual(JSON.parse(calls[0].body).operation, 'OR');
  assert.match(calls[0].url, /\/rest\/2\.0\/count\/am\/asset$/);
});

test('gets one asset, and validates the identifier', async () => {
  const { items, calls } = await execute({
    params: params('getAsset', { assetId: ' 42 ', csamOptions: { includeFields: 'hardware' } }),
    script: () => json({ assetListData: { asset: [{ assetId: 42 }] } }),
  });
  assert.equal(items[0].json.assetId, 42);
  assert.deepEqual(calls[0].qs, { assetId: '42', includeFields: 'hardware' });

  await assert.rejects(
    () => execute({ params: params('getAsset', { assetId: '  ' }), script: () => json({}) }),
    /Asset ID is required/,
  );
});

test('returns the raw body when a get finds no record array', async () => {
  const { items } = await execute({
    params: params('getAsset', { assetId: '42', csamOptions: {} }),
    script: () => json({ responseCode: 'SUCCESS', assetListData: { asset: [] } }),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].json.responseCode, 'SUCCESS');
});

test('sends the software component filter as two blocks', async () => {
  const { calls } = await execute({
    params: listParams('listComponents', {
      count: 1,
      csamMatch: 'AND',
      csamOptions: {},
      csamFilters: {
        filters: [
          { field: 'component.name', operator: 'EQUALS', value: 'log4j' },
          { field: 'asset.riskScore', operator: 'GREATER', value: '800' },
        ],
      },
    }),
    script: () => json({ count: 0, hasMore: 0, assetComponentsList: [] }),
  });
  const body = JSON.parse(calls[0].body);
  assert.ok(body.componentFilter);
  assert.ok(body.assetSoftwareFilter);
  assert.equal(calls[0].qs.pageSize, 500);
});

test('counts unresolved domains on its own endpoint', async () => {
  const { items, calls } = await execute({
    params: params('countUnresolvedDomains', { csamMatch: 'AND', csamFilters: {} }),
    script: () => json({ count: 291, responseCode: 'SUCCESS' }),
  });
  assert.equal(items[0].json.count, 291);
  // Not the asset count endpoint.
  assert.match(calls[0].url, /\/rest\/2\.0\/am\/domain\/count$/);
});

test('gets software components with the asset ID in the path', async () => {
  const { items, calls } = await execute({
    params: params('getComponents', { assetId: ' 23475705 ', csamOptions: { pageSize: 50 } }),
    script: () => json({ assetComponentsList: [{ assetId: 23475705, component: { name: 'log4j' } }] }),
  });

  assert.match(calls[0].url, /\/rest\/2\.0\/am\/asset\/component\/23475705$/);
  // The id goes in the path, so it must not also be a query parameter.
  assert.equal(calls[0].qs.assetId, undefined);
  assert.equal(calls[0].qs.pageSize, 50);
  assert.equal(calls[0].method, 'POST');
  assert.equal(items[0].json.component.name, 'log4j');
});

test('treats an empty component response as no records', async () => {
  const { items } = await execute({
    params: params('getComponents', { assetId: '1', csamOptions: {} }),
    script: () => raw(204, ''),
  });
  assert.deepEqual(items, []);
});

// -------------------------------------------------------------- gateway plane

test('pages the gateway plane while it reports another page', async () => {
  const { items, calls } = await execute({
    params: listParams('listProfiles', { listAll: true }),
    script: (options) => {
      const page = options.qs.pageNumber;
      if (page >= 2) return raw(404, JSON.stringify({ message: 'Profile does not exists.' }));
      return json({ hasNextPage: page < 1, profile: [{ name: `p${page}` }] });
    },
  });
  assert.deepEqual(items.map((i) => i.json.name), ['p0', 'p1']);
  assert.deepEqual(calls.map((c) => c.qs.pageNumber), [0, 1]);
});

// ------------------------------------------------------------- platform plane

test('follows the platform next-batch URL until it stops', async () => {
  const next = 'https://qualysapi.qg2.apps.qualys.eu/api/5.0/fo/asset/host/?action=list&id_min=2';
  const { items, calls } = await execute({
    params: listParams('listHosts', { listAll: true, hostOptions: {} }),
    script: (options) =>
      raw(200, options.url.includes('id_min=2') ? hostXml(2) : hostXml(1, next)),
  });
  assert.deepEqual(items.map((i) => i.json.ID), [1, 2]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, next);
});

test('stops when the next-batch URL repeats', async () => {
  const stuck = 'https://qualysapi.qg2.apps.qualys.eu/api/5.0/fo/asset/host/?action=list&stuck=1';
  const { calls } = await execute({
    params: listParams('listHosts', { listAll: true, hostOptions: {} }),
    script: () => raw(200, hostXml(1, stuck)),
  });
  // First request, the stuck URL once, then the repeat is refused.
  assert.equal(calls.length, 2);
});

test('builds the platform query from options, booleans and extras', async () => {
  const { calls } = await execute({
    params: listParams('listDetections', {
      count: 1,
      truncationLimit: 5,
      itemGranularity: 'detection',
      detectionOptions: {
        ids: '1-5',
        ips: '',
        show_qds: true,
        show_results: false,
        extraParameters: { extraParameters: [{ name: 'os_hostname', value: '1' }, { name: '', value: 'x' }] },
      },
    }),
    script: () =>
      raw(200, '<HOST_LIST_VM_DETECTION_OUTPUT><RESPONSE><HOST_LIST><HOST><ID>1</ID>' +
        '<DETECTION_LIST><DETECTION><QID>7</QID></DETECTION></DETECTION_LIST>' +
        '</HOST></HOST_LIST></RESPONSE></HOST_LIST_VM_DETECTION_OUTPUT>'),
  });
  assert.deepEqual(calls[0].qs, {
    action: 'list',
    ids: '1-5',
    show_qds: 1,
    show_results: 0,
    os_hostname: '1',
    truncation_limit: 5,
  });
});

test('falls back to the default batch size when it is not a number', async () => {
  const { calls } = await execute({
    params: listParams('listHosts', { count: 1, truncationLimit: 'abc', hostOptions: {} }),
    script: () => raw(200, hostXml(1)),
  });
  assert.equal(calls[0].qs.truncation_limit, 1000);
});

test('rejects mutually exclusive platform parameters before calling out', async () => {
  await assert.rejects(
    () =>
      execute({
        params: listParams('listDetections', { detectionOptions: { ag_ids: '1', ag_titles: 'x' } }),
        script: () => raw(200, '<R/>'),
      }),
    /does not accept "ag_ids" and "ag_titles"/,
  );
});

test('requires at least one CVE for the score resource', async () => {
  await assert.rejects(
    () => execute({ params: listParams('listCveScores', { cve: '  ', cveScoreOptions: {} }), script: () => json({}) }),
    /At least one CVE ID is required/,
  );
});

test('turns the CVE-keyed response into one item per CVE', async () => {
  const { items, calls } = await execute({
    params: listParams('listCveScores', { cve: 'CVE-1,CVE-2', cveScoreOptions: {} }),
    script: () => json({ 'CVE-1': { base: { qvs: '100' } }, 'CVE-2': { base: { qvs: '50' } } }),
  });
  assert.deepEqual(items.map((i) => i.json.cve), ['CVE-1', 'CVE-2']);
  assert.equal(calls[0].qs.details, 'Basic');
});

test('respects an explicit detail level for the score resource', async () => {
  const { calls } = await execute({
    params: listParams('listCveScores', { cve: 'CVE-1', cveScoreOptions: { details: 'All' } }),
    script: () => json({ 'CVE-1': { base: {} } }),
  });
  assert.equal(calls[0].qs.details, 'All');
});

// ------------------------------------------------------------ output shaping

test('emits one item per detection, or one per host', async () => {
  const body =
    '<HOST_LIST_VM_DETECTION_OUTPUT><RESPONSE><HOST_LIST><HOST><ID>1</ID><IP>10.0.0.1</IP>' +
    '<DETECTION_LIST><DETECTION><QID>11</QID></DETECTION><DETECTION><QID>22</QID></DETECTION></DETECTION_LIST>' +
    '</HOST></HOST_LIST></RESPONSE></HOST_LIST_VM_DETECTION_OUTPUT>';

  const flat = await execute({
    params: listParams('listDetections', { itemGranularity: 'detection', detectionOptions: {} }),
    script: () => raw(200, body),
  });
  assert.deepEqual(flat.items.map((i) => i.json.QID), [11, 22]);
  assert.equal(flat.items[0].json.IP, '10.0.0.1');

  const nested = await execute({
    params: listParams('listDetections', { itemGranularity: 'host', detectionOptions: {} }),
    script: () => raw(200, body),
  });
  assert.equal(nested.items.length, 1);
  assert.equal(nested.items[0].json.DETECTION_LIST.DETECTION.length, 2);
});

test('returns every page verbatim in raw mode', async () => {
  const { items } = await execute({
    params: listParams('listHostAssets', { listAll: true, outputMode: 'raw' }),
    script: (options) =>
      json({ assets: options.qs.pageNumber === 0 ? Array.from({ length: 100 }, (_, i) => ({ assetId: i })) : [] }),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].json.resource, 'ot');
  assert.equal(items[0].json.operation, 'listHostAssets');
  assert.equal(items[0].json.pagesFetched, 2);
  assert.equal(items[0].json.pages.length, 2);
});

test('attaches response metadata when asked', async () => {
  const { items } = await execute({
    params: listParams('listHostAssets', { count: 1, includeMetadata: true }),
    script: () =>
      json({ assets: [{ assetId: 1 }] }, {
        count: '319',
        'x-ratelimit-remaining': '297',
        'x-ratelimit-limit': '300',
        'x-ratelimit-window-sec': '3600',
        'x-ratelimit-towait-sec': '0',
        'x-concurrency-limit-limit': '2',
        'x-concurrency-limit-running': '0',
      }),
  });
  const meta = items[0].json._qualys;
  assert.equal(meta.resource, 'ot');
  assert.equal(meta.plane, 'ot');
  assert.equal(meta.count, 319);
  assert.equal(meta.batch, 1);
  assert.equal(meta.pagesFetched, 1);
  assert.deepEqual(meta.rateLimit, {
    remaining: 297,
    limit: 300,
    windowSec: 3600,
    toWaitSec: 0,
    concurrencyLimit: 2,
    concurrencyRunning: 0,
  });
});

test('leaves metadata fields undefined when the headers are absent', async () => {
  const { items } = await execute({
    params: listParams('listHostAssets', { count: 1, includeMetadata: true }),
    script: () => json({ assets: [{ assetId: 1 }] }, { count: '' }),
  });
  const meta = items[0].json._qualys;
  assert.equal(meta.count, undefined);
  assert.equal(meta.rateLimit.remaining, undefined);
});

test('wraps a scalar record so it still has a JSON shape', async () => {
  const { items } = await execute({
    params: listParams('listProjectFiles', { count: 2 }),
    script: () => json(['first', 'second']),
  });
  assert.deepEqual(items.map((i) => i.json.value), ['first', 'second']);
});

test('stops at Count part-way through a page', async () => {
  const { items } = await execute({
    params: listParams('listHostAssets', { count: 3 }),
    script: (options) =>
      json({
        assets: Array.from({ length: 100 }, (_, i) => ({ assetId: options.qs.pageNumber * 100 + i })),
      }),
  });
  assert.deepEqual(items.map((i) => i.json.assetId), [0, 1, 2]);
});

// -------------------------------------------------------- per-item execution

test('runs a get for every input item, pairing each result', async () => {
  const { items, calls } = await execute({
    inputItems: [{ json: { id: 11 } }, { json: { id: 22 } }],
    params: params('getAsset', { assetId: (item) => String(item.id), csamOptions: {} }),
    script: (options) => json({ assetListData: { asset: [{ assetId: Number(options.qs.assetId) }] } }),
  });
  assert.deepEqual(calls.map((c) => c.qs.assetId), ['11', '22']);
  assert.deepEqual(items.map((i) => i.pairedItem.item), [0, 1]);
});

test('runs a list once for many items, or once per item on request', async () => {
  const once = await execute({
    inputItems: [{ json: {} }, { json: {} }, { json: {} }],
    params: listParams('listHostAssets', { count: 1 }),
    script: () => json({ assets: [{ assetId: 1 }] }, { count: '1' }),
  });
  assert.equal(once.calls.length, 1);

  const each = await execute({
    inputItems: [{ json: { n: 1 } }, { json: { n: 2 } }],
    params: listParams('listHostAssets', {
      count: 1,
      runOnce: false,
      filterGroups: (item) => ({
        filterGroups: [{ filters: { filters: [{ identifier: 'asset.name', operator: ':', value: `host${item.n}` }] } }],
      }),
    }),
    script: () => json({ assets: [{ assetId: 1 }] }, { count: '1' }),
  });
  assert.deepEqual(each.calls.map((c) => c.qs.filter), ['asset.name:host1', 'asset.name:host2']);
  assert.deepEqual(each.items.map((i) => i.pairedItem.item), [0, 1]);
});

test('keeps going through later items when one fails', async () => {
  const { items } = await execute({
    inputItems: [{ json: { id: 1 } }, { json: { id: 2 } }, { json: { id: 3 } }],
    params: params('getAsset', { assetId: (i) => String(i.id), csamOptions: {} }),
    script: (options) =>
      options.qs.assetId === '2'
        ? raw(500, JSON.stringify({ responseMessage: 'boom' }))
        : json({ assetListData: { asset: [{ assetId: Number(options.qs.assetId) }] } }),
    continueOnFail: true,
  });
  assert.equal(items.length, 3);
  assert.match(items[1].json.error, /boom/);
  assert.deepEqual(items.map((i) => i.pairedItem.item), [0, 1, 2]);
});

test('runs once when there is no input at all', async () => {
  const { calls } = await execute({
    inputItems: [],
    params: listParams('listHostAssets', { count: 1 }),
    script: () => json({ assets: [{ assetId: 1 }] }, { count: '1' }),
  });
  assert.equal(calls.length, 1);
});

// ------------------------------------------------------------- paging backstop

test('fails loudly rather than paging forever', async () => {
  let page = 0;
  await assert.rejects(
    () =>
      execute({
        params: listParams('listProfiles', { listAll: true }),
        script: () => {
          page += 1;
          return json({ hasNextPage: true, profile: [{ name: `p${page}` }] });
        },
      }),
    /Stopped after \d+ requests/,
  );
});
