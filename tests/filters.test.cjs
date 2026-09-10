const assert = require('node:assert/strict');
const test = require('node:test');

require('./support.cjs');

const {
  buildComponentFilter,
  buildCsamFilter,
  buildFilterExpression,
  buildFoParameters,
  buildSortExpression,
  resolveSortField,
  validateFoParameters,
} = require('../.test-build/nodes/Qualys/actions/planes');

const {
  getCollectionEntries,
} = require('../.test-build/nodes/Qualys/actions/shared/collections');

const {
  extractRecords,
  flattenDetections,
  takeRecordsFromPage,
  clampCsamPageSize,
  formatCsamDate,
  buildCsamQuery,
  buildOtQuery,
} = require('../.test-build/nodes/Qualys/actions/router');

// ------------------------------------------------------- collection unwrapping

test('unwraps the several shapes n8n hands a fixedCollection back in', () => {
  // Already an array.
  assert.deepEqual(getCollectionEntries({ rows: [{ a: 1 }] }, 'rows'), [{ a: 1 }]);
  // Wrapped under a key of the same name.
  assert.deepEqual(getCollectionEntries({ rows: { rows: [{ a: 2 }] } }, 'rows'), [{ a: 2 }]);
  // Wrapped under some other key: take the first array found.
  assert.deepEqual(getCollectionEntries({ rows: { other: [{ a: 3 }] } }, 'rows'), [{ a: 3 }]);
  // Nothing usable.
  assert.deepEqual(getCollectionEntries({ rows: { other: 'x' } }, 'rows'), []);
  assert.deepEqual(getCollectionEntries({}, 'rows'), []);
  assert.deepEqual(getCollectionEntries(undefined, 'rows'), []);
  assert.deepEqual(getCollectionEntries({ rows: 'string' }, 'rows'), []);
});

// -------------------------------------------------------------- QQL formatting

test('quotes QQL values only where Qualys needs it', () => {
  const one = (value) =>
    buildFilterExpression({ filters: [{ identifier: 'f', operator: ':', value }] });

  // An empty value still has to be sent as an explicit empty string.
  assert.equal(one(''), 'f:""');
  // Values the user already quoted, or bracketed ranges, pass through.
  assert.equal(one('"already"'), 'f:"already"');
  assert.equal(one("'single'"), "f:'single'");
  assert.equal(one('`backtick`'), 'f:`backtick`');
  assert.equal(one('[1 .. 5]'), 'f:[1 .. 5]');
  // Numbers, booleans and relative dates are bare.
  assert.equal(one('42'), 'f:42');
  assert.equal(one('-4.5'), 'f:-4.5');
  assert.equal(one('true'), 'f:true');
  assert.equal(one('FALSE'), 'f:FALSE');
  assert.equal(one('now-90d'), 'f:now-90d');
  // Whitespace, commas and colons force quoting.
  assert.equal(one('two words'), 'f:"two words"');
  assert.equal(one('a,b'), 'f:"a,b"');
  assert.equal(one('a:b'), 'f:"a:b"');
  // Embedded quotes and backslashes are escaped.
  assert.equal(one('say "hi"'), 'f:"say \\"hi\\""');
  assert.equal(one('back\\slash here'), 'f:"back\\\\slash here"');
  // A plain single token needs nothing.
  assert.equal(one('Siemens'), 'f:Siemens');
});

test('renders the null operators without a value', () => {
  assert.equal(
    buildFilterExpression({ filters: [{ identifier: 'f', operator: 'is null', value: 'ignored' }] }),
    'f is null',
  );
  assert.equal(
    buildFilterExpression({ filters: [{ identifier: 'f', operator: 'is not null' }] }),
    'f is not null',
  );
});

test('skips filter rows and groups that carry no identifier', () => {
  // A row with no identifier contributes nothing, and drags no join with it.
  assert.equal(
    buildFilterExpression({
      filters: [
        { identifier: 'a', operator: ':', value: '1', join: 'OR' },
        { identifier: '   ', operator: ':', value: '2' },
        { identifier: 'b', operator: ':', value: '3' },
      ],
    }),
    'a:1 or b:3',
  );

  // A group whose rows are all empty is dropped entirely.
  assert.equal(
    buildFilterExpression({
      filterGroups: [
        { filters: { filters: [{ identifier: '' }] } },
        { filters: { filters: [{ identifier: 'b', operator: ':', value: '2' }] } },
      ],
    }),
    'b:2',
  );

  // No usable rows at all yields an empty expression.
  assert.equal(buildFilterExpression({ filters: [{ identifier: '' }] }), '');
  assert.equal(buildFilterExpression({}), '');
  assert.equal(buildFilterExpression({ filterGroups: [{ filters: { filters: [] } }] }), '');
});

test('defaults a missing QQL operator to the contains form', () => {
  assert.equal(buildFilterExpression({ filters: [{ identifier: 'f', value: 'v' }] }), 'f:v');
});

// -------------------------------------------------------------------- sorting

test('resolves sort fields, aliases and passthroughs', () => {
  assert.equal(resolveSortField('listHostAssets', ''), '');
  assert.equal(resolveSortField('listHostAssets', 'asset.already.dotted'), 'asset.already.dotted');
  assert.equal(resolveSortField('listHostAssets', 'risk'), 'asset.risk');
  assert.equal(resolveSortField('listOtVulnerabilities', 'severity'), 'vulnerabilities.severity');
  assert.equal(resolveSortField('listProjectFiles', 'vendor'), 'vendor');
  // Unknown alias falls through unchanged.
  assert.equal(resolveSortField('listHostAssets', 'unknownField'), 'unknownField');
  // A resource with no alias map at all must not throw.
  assert.equal(resolveSortField('listScans', 'anything'), 'anything');
});

test('skips sort rules with no field and defaults the direction', () => {
  assert.equal(
    buildSortExpression('listHostAssets', {
      sorts: [{ field: '  ' }, { field: 'name' }, { field: 'risk', direction: 'desc' }],
    }),
    '[{"asset.name":"asc"},{"asset.risk":"desc"}]',
  );
  // Every rule unusable still produces valid JSON rather than an empty string.
  assert.equal(buildSortExpression('listHostAssets', { sorts: [{ field: '' }] }), '[]');
});

// ------------------------------------------------------ Asset Management filter

test('defaults the criteria operator and keeps blank values', () => {
  assert.deepEqual(buildCsamFilter({ filters: [{ field: 'a' }] }, 'AND'), {
    filters: [{ field: 'a', operator: 'CONTAINS', value: '' }],
  });
  // An unrecognised match value falls back to AND rather than being passed on.
  assert.deepEqual(
    buildCsamFilter({ filters: [{ field: 'a', value: '1' }, { field: 'b', value: '2' }] }, 'maybe'),
    {
      filters: [
        { field: 'a', operator: 'CONTAINS', value: '1' },
        { field: 'b', operator: 'CONTAINS', value: '2' },
      ],
      operation: 'AND',
    },
  );
});

test('skips component rows with no field, and handles asset-only filters', () => {
  assert.deepEqual(
    buildComponentFilter({ filters: [{ field: '  ' }, { field: 'asset.riskScore', operator: 'GREATER', value: '800' }] }, 'AND'),
    { assetSoftwareFilter: { filters: [{ field: 'asset.riskScore', operator: 'GREATER', value: '800' }] } },
  );
  // Two component rows get the join operator applied to that block.
  assert.deepEqual(
    buildComponentFilter(
      { filters: [{ field: 'component.name', value: 'a' }, { field: 'component.version', value: '1' }] },
      'OR',
    ),
    {
      componentFilter: {
        filters: [
          { field: 'component.name', operator: 'CONTAINS', value: 'a' },
          { field: 'component.version', operator: 'CONTAINS', value: '1' },
        ],
        operation: 'OR',
      },
    },
  );
});

// ------------------------------------------------------- platform parameters

test('drops empties, keeps zero, and folds booleans', () => {
  assert.deepEqual(
    buildFoParameters({ a: 'x', b: '', c: null, d: undefined, e: 0, f: true, g: false }),
    { a: 'x', e: 0, f: 1, g: 0 },
  );
  assert.deepEqual(buildFoParameters({}), {});
});

test('validates every documented exclusive pair', () => {
  const cases = [
    [{ ag_ids: '1', ag_titles: 'x' }, /ag_ids/],
    [{ detection_updated_since: 'a', max_days_since_detection_updated: '1' }, /detection_updated_since/],
    [{ detection_last_tested_since: 'a', detection_last_tested_since_days: '1' }, /detection_last_tested_since/],
    [{ detection_last_tested_before: 'a', detection_last_tested_before_days: '1' }, /detection_last_tested_before/],
    [{ vm_scan_since: 'a', max_days_since_last_vm_scan: '1' }, /vm_scan_since/],
    [{ no_vm_scan_since: 'a', max_days_since_last_vm_scan: '1' }, /no_vm_scan_since/],
    [{ arf_filter_keys: 'a', arf_kernel_filter: '1' }, /arf_filter_keys/],
    [{ include_search_list_ids: '1', include_search_list_titles: 'x' }, /include_search_list/],
    [{ exclude_search_list_ids: '1', exclude_search_list_titles: 'x' }, /exclude_search_list/],
  ];
  for (const [qs, expected] of cases) {
    assert.match(String(validateFoParameters(qs)), expected, JSON.stringify(qs));
  }
});

test('validates search list, ipv6 and score-range rules', () => {
  assert.match(validateFoParameters({ severities: '5', exclude_search_list_ids: '1' }), /Search list/);
  assert.match(validateFoParameters({ ipv6: '::1', ag_titles: 'x' }), /ipv6/);
  assert.match(validateFoParameters({ ipv6: '::1', id_min: '1' }), /ipv6/);
  assert.match(validateFoParameters({ trurisk_max: 900 }), /show_trurisk/);
  assert.match(validateFoParameters({ show_trurisk: 1, trurisk_min: 900, trurisk_max: 100 }), /lower than/);
  // ipv6 alone, and a valid range, are both fine.
  assert.equal(validateFoParameters({ ipv6: '::1' }), undefined);
  assert.equal(validateFoParameters({ show_trurisk: 1, trurisk_min: 100, trurisk_max: 900 }), undefined);
  assert.equal(validateFoParameters({}), undefined);
});

// ------------------------------------------------------------- record shaping

test('extracts records from each response shape, including fallback keys', () => {
  // A single object at the record path becomes a one-item list.
  assert.deepEqual(extractRecords({ a: { b: { id: 1 } } }, 'a.b'), [{ id: 1 }]);
  // A record path that matches nothing yields nothing, not the whole body.
  assert.deepEqual(extractRecords({ other: 1 }, 'a.b'), []);
  // Without a record path, the common container keys are tried in turn.
  for (const key of ['data', 'items', 'records', 'results']) {
    assert.deepEqual(extractRecords({ [key]: [{ id: 2 }] }), [{ id: 2 }]);
  }
  // A bare value becomes a single record.
  assert.deepEqual(extractRecords('scalar'), ['scalar']);
  assert.deepEqual(extractRecords(undefined), []);
  assert.deepEqual(extractRecords({ a: 1 }), [{ a: 1 }]);
  // Keyed extraction ignores non-object values.
  assert.deepEqual(extractRecords({ 'CVE-1': { qvs: 1 }, note: 'x' }, undefined, 'cve'), [
    { cve: 'CVE-1', qvs: 1 },
  ]);
});

test('flattens detections defensively', () => {
  // A single detection object rather than an array.
  assert.deepEqual(flattenDetections([{ ID: 1, DETECTION_LIST: { DETECTION: { QID: 7 } } }]), [
    { ID: 1, QID: 7 },
  ]);
  // A host with no detections still emits its host row.
  assert.deepEqual(flattenDetections([{ ID: 2, DETECTION_LIST: { DETECTION: [] } }]), [{ ID: 2 }]);
  assert.deepEqual(flattenDetections([{ ID: 3 }]), [{ ID: 3 }]);
  // Non-object entries are skipped rather than crashing.
  assert.deepEqual(flattenDetections([null, undefined, 'x', { ID: 4 }]), [{ ID: 4 }]);
  // A non-object detection is preserved under its own key.
  assert.deepEqual(flattenDetections([{ ID: 5, DETECTION_LIST: { DETECTION: ['odd'] } }]), [
    { ID: 5, DETECTION: 'odd' },
  ]);
  assert.deepEqual(flattenDetections([]), []);
});

test('windows a page by the remaining count', () => {
  assert.deepEqual(takeRecordsFromPage([], 5), { records: [], nextCount: 5 });
  assert.deepEqual(takeRecordsFromPage(['a'], Number.POSITIVE_INFINITY), {
    records: ['a'],
    nextCount: Number.POSITIVE_INFINITY,
  });
});

test('clamps page sizes against each endpoint ceiling', () => {
  assert.equal(clampCsamPageSize(1000, 1000), 1000);
  assert.equal(clampCsamPageSize(5000, 1000), 1000);
  // The hard ceiling wins even if a definition asks for more.
  assert.equal(clampCsamPageSize(5000, 99999), 1000);
  assert.equal(clampCsamPageSize(Number.NaN, 50), 50);
  assert.equal(clampCsamPageSize(0, 300), 1);
  assert.equal(clampCsamPageSize(10, 0), 1);
});

test('formats dates and query strings', () => {
  assert.equal(formatCsamDate('2026-03-01'), '2026-03-01T00:00Z');
  assert.equal(formatCsamDate('   '), '');
  assert.deepEqual(buildCsamQuery({ includeFields: '   ' }), { pageSize: 100 });
  assert.deepEqual(buildCsamQuery({ assetLastUpdated: '   ' }), { pageSize: 100 });
  assert.deepEqual(buildOtQuery(-3, 100, '', ''), { pageNumber: 0, pageSize: 100 });
  assert.deepEqual(buildOtQuery(1.7, 100, '', ''), { pageNumber: 1, pageSize: 100 });
});
