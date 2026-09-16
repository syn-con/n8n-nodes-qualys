/**
 * The polling trigger.
 *
 * What matters here is the high-water mark: every poll must start where the
 * last one ended, a poll that stops early must not move the mark past records
 * it never read, and testing the node from the editor must not disturb either.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const { makePollContext, raw } = require('./support.cjs');

const { QualysVmdrOtTrigger } = require('../.test-build/nodes/Qualys/QualysVmdrOtTrigger.node');
const { clearTokenCache } = require('../.test-build/nodes/Qualys/transport');

async function poll(options) {
  clearTokenCache();
  const built = makePollContext(options);
  const result = await new QualysVmdrOtTrigger().poll.call(built.context);
  return { result, calls: built.calls, staticData: built.staticData };
}

const QUALYS_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const detectionXml = (hosts, warningUrl) =>
  `<HOST_LIST_VM_DETECTION_OUTPUT><RESPONSE><HOST_LIST>` +
  hosts
    .map(
      ([id, qid]) =>
        `<HOST><ID>${id}</ID><DETECTION_LIST><DETECTION><QID>${qid}</QID></DETECTION></DETECTION_LIST></HOST>`,
    )
    .join('') +
  `</HOST_LIST>` +
  (warningUrl ? `<WARNING><CODE>1980</CODE><URL><![CDATA[${warningUrl}]]></URL></WARNING>` : '') +
  `</RESPONSE></HOST_LIST_VM_DETECTION_OUTPUT>`;

const NEXT_BATCH =
  'https://qualysapi.qg2.apps.qualys.eu/api/5.0/fo/asset/host/vm/detection/?action=list&id_min=2';

// ------------------------------------------------------------- the first poll

test('the first poll reaches back over the lookback window', async () => {
  const { result, calls, staticData } = await poll({
    params: { event: 'detectionUpdated', lookbackMinutes: 60 },
    script: () => raw(200, detectionXml([[1, 90001]])),
  });

  const since = new Date(calls[0].qs.detection_updated_since);
  const minutesBack = (Date.now() - since.getTime()) / 60_000;
  assert.ok(minutesBack > 59 && minutesBack < 61, `looked back ${minutesBack} minutes`);

  assert.equal(calls[0].qs.action, 'list');
  // Fixed detections are the event a remediation workflow waits for, and the
  // API leaves them out unless asked.
  assert.match(calls[0].qs.status, /Fixed/);

  assert.deepEqual(result[0].map((i) => i.json.QID), [90001]);
  assert.match(staticData.since, QUALYS_DATE);
});

test('a later poll starts where the previous one ended', async () => {
  const { calls, staticData } = await poll({
    params: { event: 'hostScanned' },
    staticData: { since: '2026-09-01T00:00:00Z' },
    script: () => raw(200, '<HOST_LIST_OUTPUT><RESPONSE><HOST_LIST><HOST><ID>7</ID></HOST></HOST_LIST></RESPONSE></HOST_LIST_OUTPUT>'),
  });

  assert.equal(calls[0].qs.vm_scan_since, '2026-09-01T00:00:00Z');
  assert.notEqual(staticData.since, '2026-09-01T00:00:00Z');
});

test('reports nothing rather than an empty item when nothing changed', async () => {
  const { result, staticData } = await poll({
    params: { event: 'scanLaunched' },
    script: () => raw(200, '<SCAN_LIST_OUTPUT><RESPONSE></RESPONSE></SCAN_LIST_OUTPUT>'),
  });

  assert.equal(result, null);
  // The window still drained, so the mark moves: an empty interval is covered.
  assert.match(staticData.since, QUALYS_DATE);
});

// ------------------------------------------------------------------- backlog

test('a window that stops early keeps the mark and resumes next time', async () => {
  const { result, staticData } = await poll({
    params: { event: 'detectionUpdated', maxRecords: 1 },
    staticData: { since: '2026-09-01T00:00:00Z' },
    script: () => raw(200, detectionXml([[1, 90001]], NEXT_BATCH)),
  });

  assert.equal(result[0].length, 1);
  // The rest of the window is unread, so the mark stays put and the next-batch
  // URL is remembered instead.
  assert.equal(staticData.since, '2026-09-01T00:00:00Z');
  assert.equal(staticData.resumeUrl, NEXT_BATCH);
  assert.match(staticData.resumeUntil, QUALYS_DATE);
});

test('the next poll carries on from the remembered batch', async () => {
  const { calls, staticData } = await poll({
    params: { event: 'detectionUpdated' },
    staticData: {
      since: '2026-09-01T00:00:00Z',
      resumeUrl: NEXT_BATCH,
      resumeUntil: '2026-09-02T00:00:00Z',
    },
    script: () => raw(200, detectionXml([[2, 90002]])),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, NEXT_BATCH);
  // Drained at last, so the mark moves to the bound that window was opened
  // with - not to now, which would skip whatever changed in between.
  assert.equal(staticData.since, '2026-09-02T00:00:00Z');
  assert.equal(staticData.resumeUrl, undefined);
});

test('follows the next-batch URL until the window is covered', async () => {
  const { result, calls } = await poll({
    params: { event: 'detectionUpdated' },
    script: (_options, made) =>
      raw(200, detectionXml([[made.length, 90000 + made.length]], made.length < 3 ? NEXT_BATCH : undefined)),
  });

  assert.equal(calls.length, 3);
  assert.equal(result[0].length, 3);
});

// -------------------------------------------------------------- editor safety

test('a manual poll reads the lookback and leaves the mark alone', async () => {
  const { result, calls, staticData } = await poll({
    params: { event: 'detectionUpdated', lookbackMinutes: 5 },
    mode: 'manual',
    staticData: { since: '2026-09-01T00:00:00Z' },
    script: () => raw(200, detectionXml([[1, 90001]])),
  });

  assert.notEqual(calls[0].qs.detection_updated_since, '2026-09-01T00:00:00Z');
  assert.equal(result[0].length, 1);
  // Testing a workflow must not make the live trigger skip what it just showed.
  assert.deepEqual(staticData, { since: '2026-09-01T00:00:00Z' });
});

// ---------------------------------------------------------------- the records

test('emits one item per detection, or one per host on request', async () => {
  const twoDetections =
    `<HOST_LIST_VM_DETECTION_OUTPUT><RESPONSE><HOST_LIST><HOST><ID>1</ID><DETECTION_LIST>` +
    `<DETECTION><QID>1</QID></DETECTION><DETECTION><QID>2</QID></DETECTION>` +
    `</DETECTION_LIST></HOST></HOST_LIST></RESPONSE></HOST_LIST_VM_DETECTION_OUTPUT>`;

  const flattened = await poll({
    params: { event: 'detectionUpdated' },
    script: () => raw(200, twoDetections),
  });
  assert.deepEqual(flattened.result[0].map((i) => i.json.QID), [1, 2]);
  assert.equal(flattened.result[0][0].json.ID, 1);

  const nested = await poll({
    params: { event: 'detectionUpdated', itemGranularity: 'host' },
    script: () => raw(200, twoDetections),
  });
  assert.equal(nested.result[0].length, 1);
  assert.equal(nested.result[0][0].json.DETECTION_LIST.DETECTION.length, 2);
});

test('passes the watch filters and extra parameters through', async () => {
  const { calls } = await poll({
    params: {
      event: 'detectionUpdated',
      options: {
        severities: '4-5',
        extraParameters: { extraParameters: [{ name: 'show_qds', value: '1' }] },
      },
    },
    script: () => raw(200, detectionXml([])),
  });

  assert.equal(calls[0].qs.severities, '4-5');
  assert.equal(calls[0].qs.show_qds, '1');
});

test('rejects an event it does not know', async () => {
  await assert.rejects(
    () => poll({ params: { event: 'somethingRetired' }, script: () => raw(200, '') }),
    /Unsupported event/,
  );
});

test('stops after the page backstop, leaving the backlog for the next poll', async () => {
  const { calls, staticData } = await poll({
    params: { event: 'detectionUpdated', maxRecords: 0 },
    script: (_options, made) => raw(200, detectionXml([[made.length, 90000]], NEXT_BATCH)),
  });

  assert.equal(calls.length, 100);
  assert.equal(staticData.since, undefined);
  assert.equal(staticData.resumeUrl, NEXT_BATCH);
});

// ------------------------------------------------------------- the node panel

test('presents itself as the Qualys node trigger rather than a node of its own', () => {
  const { description } = new QualysVmdrOtTrigger();
  const node = require('../.test-build/nodes/Qualys/QualysVmdrOt.node').QualysVmdrOt;
  const action = new node().description;

  // n8n's node panel merges a trigger into its action node by name: the
  // trigger's must be the action node's plus "Trigger", or the two show up as
  // separate apps in search.
  assert.equal(description.name, `${action.name}Trigger`);
  assert.equal(description.displayName, `${action.displayName} Trigger`);
  assert.deepEqual(description.credentials, action.credentials);
  assert.ok(description.group.includes('trigger'));
  assert.equal(description.polling, true);
  assert.deepEqual(description.inputs, []);

  // Each event is one entry under the merged node's Triggers tab.
  const events = description.properties[0];
  assert.equal(events.name, 'event');
  for (const option of events.options) {
    assert.match(option.action, /^On /, `${option.value} has no trigger action`);
  }
  assert.ok(events.options.some((option) => option.value === events.default));
});

test('ships a codex naming the node it belongs to', () => {
  const codex = require('../nodes/Qualys/QualysVmdrOtTrigger.node.json');
  assert.match(codex.node, /\.qualysVmdrOtTrigger$/);
});
