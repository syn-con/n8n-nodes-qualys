const assert = require('node:assert/strict');
const test = require('node:test');

const { makeContext, listParams, raw } = require('./support.cjs');

const { QualysVmdrOt } = require('../dist/nodes/Qualys/QualysVmdrOt.node');
const {
  clearTokenCache,
  describeFailure,
  extractQualysCode,
  redactSecretsInText,
  sanitizeForError,
  REDACTED,
} = require('../dist/nodes/Qualys/transport');

/** Serialise the way n8n does when it persists execution data. */
function render(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'object' && entry !== null) {
      if (seen.has(entry)) return '[circular]';
      seen.add(entry);
    }
    return entry;
  });
}

// -------------------------------------------------------------- text redaction

test('redacts credentials that appear inside free text', () => {
  assert.equal(
    redactSecretsInText('Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJhIjoxfQ.sig'),
    `Authorization: Bearer ${REDACTED}`,
  );
  assert.equal(redactSecretsInText('used Basic dXNlcjpwYXNz=='), `used Basic ${REDACTED}`);
  // A bare JWT with no scheme in front of it is still a credential.
  assert.equal(
    redactSecretsInText('token eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJ4In0.abc-DEF_123'),
    `token ${REDACTED}`,
  );
  // Ordinary text is untouched.
  assert.equal(redactSecretsInText('connect ETIMEDOUT 10.0.0.1:443'), 'connect ETIMEDOUT 10.0.0.1:443');
  assert.equal(redactSecretsInText(''), '');
});

// ---------------------------------------------------------- payload sanitising

test('redacts every credential-bearing key, at any depth', () => {
  const payload = sanitizeForError({
    config: {
      headers: { Authorization: 'Bearer secret-token', Accept: 'application/json' },
      auth: { username: 'u', password: 'hunter2' },
    },
    clientSecret: 'cl1ent',
    client_secret: 'cl1ent',
    nested: { deeper: { token: 'abc', jwt: 'x', apiKey: 'k', 'x-api-key': 'k' } },
    cookie: 'session=1',
  });

  const text = render(payload);
  for (const secret of ['secret-token', 'hunter2', 'cl1ent', 'session=1']) {
    assert.ok(!text.includes(secret), `${secret} must not survive`);
  }
  assert.equal(payload.config.headers.Authorization, REDACTED);
  assert.equal(payload.config.auth, REDACTED);
  assert.equal(payload.clientSecret, REDACTED);
  assert.equal(payload.nested.deeper.token, REDACTED);
  // Non-secret siblings are kept, because they are the diagnostic value.
  assert.equal(payload.config.headers.Accept, 'application/json');
});

test('drops transport internals that carry raw headers', () => {
  const payload = sanitizeForError({
    request: { _header: 'GET / HTTP/1.1\r\nAuthorization: Bearer leak\r\n' },
    socket: { remoteAddress: '10.0.0.1' },
    agent: {},
    res: {},
    keepMe: 'yes',
  });

  assert.equal(payload.request, undefined);
  assert.equal(payload.socket, undefined);
  assert.equal(payload.agent, undefined);
  assert.equal(payload.res, undefined);
  assert.equal(payload.keepMe, 'yes');
  assert.ok(!render(payload).includes('leak'));
});

test('breaks cycles so the payload can always be serialised', () => {
  const node = { name: 'a' };
  node.self = node;
  node.list = [node];

  const payload = sanitizeForError(node);
  assert.doesNotThrow(() => JSON.stringify(payload));
  assert.equal(payload.name, 'a');
});

test('bounds depth, array length and string size', () => {
  let deep = { end: 'bottom' };
  for (let i = 0; i < 12; i += 1) deep = { down: deep };
  assert.ok(render(sanitizeForError(deep)).includes('[truncated]'));

  const long = sanitizeForError({ items: Array.from({ length: 120 }, (_, i) => i) });
  assert.equal(long.items.length, 51);
  assert.match(String(long.items[50]), /70 more/);

  const big = sanitizeForError({ blob: 'x'.repeat(5000) });
  assert.ok(String(big.blob).endsWith('(truncated)'));
  assert.ok(String(big.blob).length < 5000);
});

test('keeps the useful parts of an Error, and handles odd inputs', () => {
  const err = new TypeError('bad shape');
  err.code = 'ERR_BAD';
  const payload = sanitizeForError(err);
  assert.equal(payload.name, 'TypeError');
  assert.equal(payload.message, 'bad shape');
  assert.equal(payload.code, 'ERR_BAD');

  // A non-object thrown value still yields an object payload.
  assert.deepEqual(sanitizeForError('just a string'), { value: 'just a string' });
  assert.deepEqual(sanitizeForError(null), { value: null });
  assert.deepEqual(sanitizeForError(undefined), { value: null });
  assert.deepEqual(sanitizeForError(42), { value: 42 });
  assert.deepEqual(sanitizeForError(true), { value: true });
  assert.deepEqual(sanitizeForError([1, 'two']), { value: [1, 'two'] });
  assert.deepEqual(sanitizeForError(() => 1), { value: '() => 1' });
});

// ------------------------------------------------------------------ diagnostics

test('describes a failure with everything needed to identify it', () => {
  const full = describeFailure({
    plane: 'csam',
    method: 'POST',
    endpoint: '/rest/2.0/search/am/asset',
    mode: 'client',
    statusCode: 400,
    qualysCode: 'FAILED',
  });
  assert.match(full, /Request: POST \/rest\/2\.0\/search\/am\/asset/);
  assert.match(full, /API: CyberSecurity Asset Management/);
  assert.match(full, /Authenticated with: API client/);
  assert.match(full, /HTTP status: 400/);
  assert.match(full, /Qualys code: FAILED/);

  // The optional lines are omitted rather than shown empty.
  const minimal = describeFailure({ plane: 'ot', method: 'GET', endpoint: '/ot/1.0/host/list', mode: 'client' });
  assert.doesNotMatch(minimal, /HTTP status/);
  assert.doesNotMatch(minimal, /Qualys code/);
  assert.match(minimal, /API: VMDR OT/);

  // A zero status is a transport failure, not an HTTP one.
  assert.doesNotMatch(
    describeFailure({ plane: 'fo', method: 'GET', endpoint: '/x', mode: 'client', statusCode: 0 }),
    /HTTP status/,
  );
});

test('labels every plane and authentication mode', () => {
  for (const [plane, label] of [
    ['ot', 'VMDR OT'],
    ['gateway', 'Qualys gateway'],
    ['csam', 'CyberSecurity Asset Management'],
    ['fo', 'VMDR platform API'],
  ]) {
    assert.match(describeFailure({ plane, method: 'GET', endpoint: '/x', mode: 'client' }), new RegExp(label));
  }
  assert.match(
    describeFailure({ plane: 'ot', method: 'GET', endpoint: '/x', mode: 'client' }),
    /Authenticated with: API client/,
  );
});

test('redacts a credential that somehow reached the endpoint', () => {
  const described = describeFailure({
    plane: 'fo',
    method: 'GET',
    endpoint: '/api/5.0/fo/asset/host/?token=eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig',
    mode: 'client',
  });
  assert.ok(described.includes(REDACTED));
  assert.ok(!described.includes('eyJhbGciOiJIUzI1NiJ9'));
});

test('finds a Qualys code in either response format', () => {
  assert.equal(extractQualysCode('<RESPONSE><CODE>1980</CODE></RESPONSE>'), '1980');
  assert.equal(extractQualysCode('<RESPONSE><CODE><![CDATA[ 2001 ]]></CODE></RESPONSE>'), '2001');
  assert.equal(extractQualysCode(JSON.stringify({ responseCode: 'FAILED' })), 'FAILED');
  assert.equal(extractQualysCode({ code: 1904 }), '1904');
  assert.equal(extractQualysCode({ errorCode: 140001 }), '140001');
  assert.equal(extractQualysCode({ status: 404 }), '404');
  assert.equal(extractQualysCode({ responseCode: '   ' }), undefined);
  assert.equal(extractQualysCode('plain text'), undefined);
  assert.equal(extractQualysCode({ nothing: true }), undefined);
  assert.equal(extractQualysCode(undefined), undefined);
});

// ------------------------------------------------------------------ end to end

/** An axios-shaped error, as n8n's HTTP helper throws for transport failures. */
function transportError(options) {
  const error = new Error('connect ETIMEDOUT 10.0.0.1:443');
  error.code = 'ETIMEDOUT';
  error.config = {
    url: options.url,
    method: options.method,
    headers: { ...options.headers },
    auth: options.auth,
  };
  error.request = { _header: `GET / HTTP/1.1\r\nAuthorization: ${options.headers.Authorization}\r\n` };
  error.request.self = error.request;
  return error;
}

test('a transport failure keeps its diagnostics and leaks no credentials', async () => {
  clearTokenCache();
  const { context } = makeContext({
    params: listParams('listHostAssets', { count: 1 }),
    credentials: {
      pod: 'eu2',
      username: 'someone',
      password: 'sup3rSecret',
      clientId: 'client-1',
      clientSecret: 'cl1entSecret',
      clientGrant: 'oidc',
    },
    token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.SIGNATURE_PART',
    script: (options) => {
      throw transportError(options);
    },
  });

  await assert.rejects(
    async () => {
      await new QualysVmdrOt().execute.call(context);
    },
    (error) => {
      const text = render({ message: error.message, description: error.description, body: error.body });

      // Nothing secret survives.
      for (const secret of ['sup3rSecret', 'cl1entSecret', 'SIGNATURE_PART', 'GET / HTTP/1.1']) {
        assert.ok(!text.includes(secret), `${secret} leaked into the error`);
      }

      // Everything diagnostic does.
      assert.match(error.message, /connect ETIMEDOUT 10\.0\.0\.1:443/);
      assert.match(error.description, /Request: GET \/ot\/1\.0\/host\/list/);
      assert.match(error.description, /API: VMDR OT/);
      assert.match(error.description, /Authenticated with: API client/);
      assert.equal(error.body.code, 'ETIMEDOUT');
      assert.equal(error.body.config.url, 'https://gateway.qg2.apps.qualys.eu/ot/1.0/host/list');
      assert.equal(error.body.config.headers.Authorization, REDACTED);
      return true;
    },
  );
});

test('an HTTP failure keeps the response body and adds context', async () => {
  clearTokenCache();
  const body = { responseCode: 'FAILED', responseMessage: 'Invalid Subscription Id', count: 0 };
  const { context } = makeContext({
    params: listParams('listAssets', { count: 1, csamOptions: {} }),
    script: () => raw(400, JSON.stringify(body)),
  });

  await assert.rejects(
    async () => {
      await new QualysVmdrOt().execute.call(context);
    },
    (error) => {
      // Qualys' own words are kept, and the hint is appended rather than replacing them.
      assert.match(error.message, /Invalid Subscription Id/);
      assert.match(error.message, /still a work in progress/);
      assert.equal(error.httpCode, '400');
      // The full response body is still available to branch on.
      assert.deepEqual(error.body, body);
      assert.match(error.description, /HTTP status: 400/);
      assert.match(error.description, /Qualys code: FAILED/);
      return true;
    },
  );
});

test('continueOnFail passes the enriched message through as data', async () => {
  clearTokenCache();
  const { context } = makeContext({
    params: listParams('listHostAssets', { count: 1 }),
    script: () => raw(403, JSON.stringify({ message: 'forbidden' })),
    continueOnFail: true,
  });

  const [items] = await new QualysVmdrOt().execute.call(context);
  assert.match(items[0].json.error, /forbidden/);
  assert.match(items[0].json.error, /App API Enabled/);
});
