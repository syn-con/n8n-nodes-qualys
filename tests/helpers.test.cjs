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

const { QualysVmdrOtApi } = require('../dist/credentials/QualysVmdrOtApi.credentials');
const { description } = require('../dist/nodes/Qualys/actions/description');
const { buildBaseUrl } = require('../dist/nodes/Qualys/transport');
const {
  buildFilterExpression,
  buildQueryString,
  buildSortExpression,
  clampPageSize,
  extractRecords,
  resolveRecordLimit,
  takeRecordsFromPage,
} = require('../dist/nodes/Qualys/actions/router');

test('normalizes Qualys gateway base URLs', () => {
  assert.equal(buildBaseUrl('gateway.qg1.apps.qualys.com/'), 'https://gateway.qg1.apps.qualys.com');
  assert.equal(buildBaseUrl('https://gateway.qg1.apps.qualys.com/'), 'https://gateway.qg1.apps.qualys.com');
});

test('clamps page size to Qualys maximum', () => {
  assert.equal(clampPageSize(0), 1);
  assert.equal(clampPageSize(50), 50);
  assert.equal(clampPageSize(500), 100);
});

test('resolves list all and count limits', () => {
  assert.equal(resolveRecordLimit(100, false), 100);
  assert.equal(resolveRecordLimit(0, true), Number.POSITIVE_INFINITY);
  assert.equal(resolveRecordLimit(0, false), null);
});

test('builds list query string with optional filter and sort', () => {
  assert.deepEqual(buildQueryString(0, 100, 'vendor : "Siemens"', '[{"lastUpdated":"desc"}]'), {
    pageNumber: 0,
    pageSize: 100,
    filter: 'vendor : "Siemens"',
    sort: '[{"lastUpdated":"desc"}]',
  });
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
                {
                  identifier: 'vulnerabilities.typeDetected',
                  operator: ':',
                  value: 'Confirmed',
                  join: 'OR',
                },
                {
                  identifier: 'vulnerabilities.lastDetected',
                  operator: '>=',
                  value: 'now-90d',
                  join: 'AND',
                },
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

test('builds sort JSON from structured rules', () => {
  assert.equal(
    buildSortExpression('vulnerability', {
      sorts: [
        { field: 'lastDetected', direction: 'desc' },
        { field: 'qid', direction: 'asc' },
      ],
    }),
    '[{"vulnerabilities.lastDetected":"desc"},{"vulnerabilities.qid":"asc"}]',
  );
});

test('maps bare resource sort aliases to Qualys tokens', () => {
  assert.equal(
    buildSortExpression('vulnerability', {
      sorts: [{ field: 'severity', direction: 'asc' }],
    }),
    '[{"vulnerabilities.severity":"asc"}]',
  );
  assert.equal(
    buildSortExpression('asset', {
      sorts: [{ field: 'risk', direction: 'desc' }],
    }),
    '[{"asset.risk":"desc"}]',
  );
});

test('extracts records from Qualys resource response shapes', () => {
  assert.deepEqual(extractRecords({ assets: [{ assetId: 1 }] }, 'assets'), [{ assetId: 1 }]);
  assert.deepEqual(extractRecords({ vulnerabilities: [{ qid: 590191 }] }, 'vulnerabilities'), [
    { qid: 590191 },
  ]);
  assert.deepEqual(extractRecords([{ name: 'Project' }]), [{ name: 'Project' }]);
});

test('takes records from a page with skip and count', () => {
  assert.deepEqual(takeRecordsFromPage(['a', 'b', 'c', 'd'], 1, 2), {
    records: ['b', 'c'],
    nextSkip: 0,
    nextCount: 0,
  });
  assert.deepEqual(takeRecordsFromPage(['a', 'b'], 5, Number.POSITIVE_INFINITY), {
    records: [],
    nextSkip: 3,
    nextCount: Number.POSITIVE_INFINITY,
  });
});

test('publishes the VMDR OT credential definition', () => {
  const credential = new QualysVmdrOtApi();
  assert.equal(credential.name, 'qualysVmdrOtApi');
  assert.equal(credential.displayName, 'Qualys VMDR OT API');
  assert.equal(credential.properties.length, 3);
});

test('describes the VMDR OT node', () => {
  assert.equal(description.displayName, 'Qualys VMDR OT');
  assert.equal(description.name, 'qualysVmdrOt');
  assert.equal(description.credentials[0].name, 'qualysVmdrOtApi');
  assert.equal(require('../dist/nodes/Qualys/Qualys.node').Qualys.name, 'Qualys');
  assert.equal(description.properties[2].name, 'listAll');
  assert.equal(description.properties[3].default, 100);
  assert.deepEqual(
    description.properties[0].options.map((option) => option.value),
    ['asset', 'vulnerability', 'projectFile'],
  );
});
