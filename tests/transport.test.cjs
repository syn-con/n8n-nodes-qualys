const assert = require('node:assert/strict');
const test = require('node:test');

const { makeContext, jwt, json, raw, CREDENTIALS } = require('./support.cjs');

const {
  qualysApiRequest,
  buildBaseUrl,
  derivePlatformUrl,
  resolveHosts,
  POD_HOSTS,
  clearTokenCache,
  describeMissingAuth,
  isConfigured,
  selectAuthMode,
  readJwtClaims,
  readJwtExpiry,
  parseQualysXml,
  findNextBatchUrl,
  pluck,
  isRateLimited,
  rateLimitWaitMs,
} = require('../dist/nodes/Qualys/transport');

const call = (options, ctx) => qualysApiRequest.call(ctx, options);

// ---------------------------------------------------------------------- hosts

test('rejects an empty base URL', () => {
  assert.throws(() => buildBaseUrl('   '), /Base URL is required/);
  assert.throws(() => buildBaseUrl(''), /Base URL is required/);
});

test('derives the platform host for every known pod', () => {
  for (const [pod, hosts] of Object.entries(POD_HOSTS)) {
    assert.equal(
      derivePlatformUrl(`https://${hosts.gateway}`),
      `https://${hosts.platform}`,
      `pod ${pod}`,
    );
  }
});

test('falls back sensibly for hosts outside the pod table', () => {
  // A private platform still following the gateway.* convention.
  assert.equal(derivePlatformUrl('https://gateway.internal.example'), 'https://qualysapi.internal.example');
  // Anything else is used as-is rather than mangled.
  assert.equal(derivePlatformUrl('https://qualys.example.test'), 'https://qualys.example.test');
  assert.equal(derivePlatformUrl('api.example.test'), 'https://api.example.test');
});

test('an unknown pod value falls through to the custom URLs', () => {
  assert.deepEqual(resolveHosts({ pod: 'nope', baseUrl: 'gateway.x.test' }), {
    gateway: 'https://gateway.x.test',
    platform: 'https://qualysapi.x.test',
  });
  // A blank platform override is ignored rather than producing an empty host.
  assert.deepEqual(resolveHosts({ baseUrl: 'gateway.y.test', platformUrl: '   ' }), {
    gateway: 'https://gateway.y.test',
    platform: 'https://qualysapi.y.test',
  });
});

// ----------------------------------------------------------------------- auth

test('reports which authentication each credential shape supports', () => {
  assert.equal(isConfigured({ clientId: 'a', clientSecret: 'b' }, 'client'), true);
  assert.equal(isConfigured({ clientId: 'a' }, 'client'), false);
  assert.equal(isConfigured({ clientId: ' ', clientSecret: 'b' }, 'client'), false);
  assert.equal(isConfigured({ clientSecret: 'b' }, 'client'), false);
  assert.equal(isConfigured({ username: 'u', password: 'p' }, 'userToken'), true);
  assert.equal(isConfigured({ username: 'u', password: 'p' }, 'basic'), true);
  assert.equal(isConfigured({ username: 'u' }, 'basic'), false);
});

test('leaves the client unusable on the plane that rejects it', () => {
  const client = { clientId: 'a', clientSecret: 'b' };
  assert.equal(selectAuthMode(client, 'ot'), 'client');
  assert.equal(selectAuthMode(client, 'fo'), 'client');
  assert.equal(selectAuthMode(client, 'gateway'), 'client');
  // Asset Management takes a user token only, so a client alone reaches nothing.
  assert.equal(selectAuthMode(client, 'csam'), undefined);
});

test('names what is missing for every plane', () => {
  assert.match(describeMissingAuth('csam'), /username and password/);
  assert.match(describeMissingAuth('fo'), /API client ID and secret/);
  assert.match(describeMissingAuth('ot'), /VMDR OT operations/);
  assert.match(describeMissingAuth('gateway'), /API client/);
});

test('decodes JWT claims and tolerates malformed tokens', () => {
  assert.deepEqual(readJwtClaims(jwt({ sub: 'me' })).sub, 'me');
  assert.deepEqual(readJwtClaims('nonsense'), {});
  assert.deepEqual(readJwtClaims('a.!!!not-base64!!!.c'), {});
  assert.equal(readJwtExpiry('a.!!!.c'), undefined);
  // A token without `exp` falls back to the documented four-hour lifetime.
  assert.equal(readJwtExpiry(jwt({ exp: undefined })), undefined);
});

test('caches a token and reuses it across requests', async () => {
  clearTokenCache();
  const { context, authCalls } = makeContext({
    script: () => json({ ok: true }),
  });

  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context);
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context);

  assert.equal(authCalls.length, 1, 'the cached token should be reused');
});

test('re-mints when the secret changes even if the client ID does not', async () => {
  clearTokenCache();
  const script = () => json({ ok: true });

  const first = makeContext({ script, credentials: { ...CREDENTIALS, clientSecret: 'one' } });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, first.context);

  const rotated = makeContext({ script, credentials: { ...CREDENTIALS, clientSecret: 'two' } });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, rotated.context);

  assert.equal(rotated.authCalls.length, 1, 'a rotated secret must not reuse the old token');
});

test('uses the token endpoint the client type selects', async () => {
  clearTokenCache();
  const oauth = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b', clientGrant: 'oauth' },
  });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, oauth.context);
  assert.match(oauth.authCalls[0].url, /\/auth\/oauth$/);

  clearTokenCache();
  const oidc = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b', clientGrant: 'oidc' },
  });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, oidc.context);
  assert.match(oidc.authCalls[0].url, /\/auth\/oidc$/);

  // A credential saved before the rename still carries `client1Grant`. n8n fills
  // the new field with its default, so both arrive and the old one must still win.
  clearTokenCache();
  const legacy = makeContext({
    script: () => json({ ok: true }),
    credentials: {
      pod: 'eu2',
      clientId: 'a',
      clientSecret: 'b',
      clientGrant: 'oidc',
      client1Grant: 'oauth',
    },
  });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, legacy.context);
  assert.match(legacy.authCalls[0].url, /\/auth\/oauth$/);

  clearTokenCache();
  const legacyOnly = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b', client1Grant: 'oauth' },
  });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, legacyOnly.context);
  assert.match(legacyOnly.authCalls[0].url, /\/auth\/oauth$/);

  // An unset client type falls back to the documented default.
  clearTokenCache();
  const unset = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b' },
  });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, unset.context);
  assert.match(unset.authCalls[0].url, /\/auth\/oidc$/);

  clearTokenCache();
  const user = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', username: 'u', password: 'p' },
  });
  await call({ plane: 'csam', endpoint: '/rest/2.0/count/am/asset', method: 'POST' }, user.context);
  assert.match(user.authCalls[0].url, /\/auth$/);
  assert.match(String(user.authCalls[0].body), /username=u&password=p&token=true/);
});

test('surfaces an authentication failure with the server message', async () => {
  clearTokenCache();
  const { context } = makeContext({ script: () => json({ ok: true }), token: null });
  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context),
    /bad credentials/,
  );
});

test('rejects an authentication response that carries no token', async () => {
  clearTokenCache();
  const { context } = makeContext({ script: () => json({ ok: true }), token: '   ' });
  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context),
    /returned no token/,
  );
});

test('accepts a token under any of the documented response keys', async () => {
  // Qualys answers with a bare JWT, but an HTTP helper may hand back a parsed
  // object, and different Qualys services name the field differently.
  for (const key of ['access_token', 'accessToken', 'token', 'id_token', 'idToken', 'jwt']) {
    clearTokenCache();
    const { context, calls } = makeContext({
      script: () => json({ ok: true }),
      token: { [key]: ` ${jwt()} ` },
    });
    const response = await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context);
    assert.equal(response.statusCode, 200, key);
    assert.match(String(calls[0].headers.Authorization), /^Bearer header\./, key);
  }
});

test('rejects an object response that carries no usable token', async () => {
  clearTokenCache();
  const empty = makeContext({ script: () => json({ ok: true }), token: { unrelated: 'x' } });
  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, empty.context),
    /returned no token/,
  );

  clearTokenCache();
  const blank = makeContext({ script: () => json({ ok: true }), token: { access_token: '   ' } });
  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, blank.context),
    /returned no token/,
  );
});

test('reports an authentication failure whose body is an object', async () => {
  clearTokenCache();
  const { context } = makeContext({ script: () => json({ ok: true }) });
  context.helpers.httpRequest = async (options) =>
    /\/auth/.test(options.url)
      ? { statusCode: 500, headers: {}, body: { message: 'auth service down' } }
      : json({ ok: true });
  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context),
    /auth service down/,
  );
});

// -------------------------------------------------------------- credentials

test('refuses to run without credentials', async () => {
  const { context } = makeContext({ script: () => json({}), credentials: null });
  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/x' }, context),
    /No Qualys credentials/,
  );
});

test('refuses a plane the credential cannot authenticate', async () => {
  const { context } = makeContext({
    script: () => json({}),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b' },
  });
  await assert.rejects(
    () => call({ plane: 'csam', endpoint: '/rest/2.0/count/am/asset', method: 'POST' }, context),
    /username and password/,
  );
});

// ------------------------------------------------------------------ requests

test('sends Basic auth and the CSRF header on the platform plane', async () => {
  clearTokenCache();
  const { context, calls } = makeContext({
    script: () => raw(200, '<R><A>1</A></R>'),
    credentials: { pod: 'eu2', username: 'u', password: 'p' },
  });

  await call({ plane: 'fo', endpoint: '/api/5.0/fo/asset/host/', xml: true }, context);

  assert.deepEqual(calls[0].auth, { username: 'u', password: 'p' });
  assert.equal(calls[0].headers['X-Requested-With'], 'n8n-nodes-qualys');
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('honours a custom X-Requested-With and omits it off the platform plane', async () => {
  clearTokenCache();
  const fo = makeContext({ script: () => raw(200, '<R/>') });
  await call({ plane: 'fo', endpoint: '/api/5.0/fo/asset/host/', xml: true }, fo.context);
  assert.equal(fo.calls[0].headers['X-Requested-With'], 'n8n-tests');

  clearTokenCache();
  const ot = makeContext({ script: () => json({}) });
  await call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, ot.context);
  assert.equal(ot.calls[0].headers['X-Requested-With'], undefined);
});

test('serialises an object body as JSON and passes a string body through', async () => {
  clearTokenCache();
  const obj = makeContext({ script: () => json({ ok: true }) });
  await call(
    { plane: 'csam', endpoint: '/rest/2.0/search/am/asset', method: 'POST', body: { filters: [] } },
    obj.context,
  );
  assert.equal(obj.calls[0].headers['Content-Type'], 'application/json');
  assert.equal(obj.calls[0].body, '{"filters":[]}');

  clearTokenCache();
  const str = makeContext({ script: () => json({ ok: true }) });
  await call(
    { plane: 'csam', endpoint: '/rest/2.0/search/am/asset', method: 'POST', body: 'raw-body' },
    str.context,
  );
  assert.equal(str.calls[0].body, 'raw-body');
  assert.equal(str.calls[0].headers['Content-Type'], undefined);
});

test('uses an absolute endpoint verbatim, as paging links require', async () => {
  clearTokenCache();
  const { context, calls } = makeContext({ script: () => raw(200, '<R/>') });
  await call(
    { plane: 'fo', endpoint: 'https://elsewhere.test/api/next?id_min=5', xml: true },
    context,
  );
  assert.equal(calls[0].url, 'https://elsewhere.test/api/next?id_min=5');
});

test('parses JSON, falls back to text, and tolerates an empty body', async () => {
  clearTokenCache();
  const good = makeContext({ script: () => json({ a: 1 }) });
  assert.deepEqual((await call({ plane: 'ot', endpoint: '/x' }, good.context)).body, { a: 1 });

  clearTokenCache();
  const text = makeContext({ script: () => raw(200, 'not json at all') });
  assert.equal((await call({ plane: 'ot', endpoint: '/x' }, text.context)).body, 'not json at all');

  clearTokenCache();
  const empty = makeContext({ script: () => raw(200, '   ') });
  assert.deepEqual((await call({ plane: 'ot', endpoint: '/x' }, empty.context)).body, {});

  clearTokenCache();
  const already = makeContext({ script: () => ({ statusCode: 200, headers: {}, body: { a: 2 } }) });
  assert.deepEqual((await call({ plane: 'ot', endpoint: '/x' }, already.context)).body, { a: 2 });
});

test('parses XML, and tolerates a non-string XML body', async () => {
  clearTokenCache();
  const xml = makeContext({ script: () => raw(200, '<R><A>7</A></R>') });
  const parsed = await call({ plane: 'fo', endpoint: '/x', xml: true }, xml.context);
  assert.equal(parsed.body.R.A, 7);

  clearTokenCache();
  const notString = makeContext({ script: () => ({ statusCode: 200, headers: {}, body: undefined }) });
  const fallback = await call({ plane: 'fo', endpoint: '/x', xml: true }, notString.context);
  assert.deepEqual(fallback.body, {});
});

test('treats 404 as empty only when the resource opts in', async () => {
  clearTokenCache();
  const opted = makeContext({ script: () => raw(404, JSON.stringify({ message: 'none' })) });
  const empty = await call({ plane: 'ot', endpoint: '/x', emptyOn404: true }, opted.context);
  assert.deepEqual(empty.body, {});

  clearTokenCache();
  const strict = makeContext({ script: () => raw(404, JSON.stringify({ message: 'none' })) });
  await assert.rejects(() => call({ plane: 'ot', endpoint: '/x' }, strict.context), /none/);
});

test('retries once after a 401, and does not retry Basic auth', async () => {
  clearTokenCache();
  let n = 0;
  const bearer = makeContext({
    script: () => {
      n += 1;
      return n === 1 ? raw(401, 'expired') : json({ ok: true });
    },
  });
  const response = await call({ plane: 'ot', endpoint: '/x' }, bearer.context);
  assert.equal(response.statusCode, 200);
  assert.equal(n, 2);
  assert.equal(bearer.authCalls.length, 2);

  clearTokenCache();
  let m = 0;
  const basic = makeContext({
    script: () => {
      m += 1;
      return raw(401, 'nope');
    },
    credentials: { pod: 'eu2', username: 'u', password: 'p' },
  });
  await assert.rejects(() => call({ plane: 'fo', endpoint: '/x' }, basic.context));
  assert.equal(m, 1, 'Basic auth has no token to refresh');
});

test('waits and retries a rate-limit rejection, once', async () => {
  clearTokenCache();
  let n = 0;
  const { context } = makeContext({
    script: () => {
      n += 1;
      return n === 1 ? raw(429, 'slow down', { 'x-ratelimit-towait-sec': '0.01' }) : json({ ok: true });
    },
  });
  const response = await call({ plane: 'ot', endpoint: '/x' }, context);
  assert.equal(response.statusCode, 200);
  assert.equal(n, 2);
});

test('does not wait when the rejection carries no wait time', async () => {
  clearTokenCache();
  let n = 0;
  const { context } = makeContext({
    script: () => {
      n += 1;
      return raw(409, 'exhausted');
    },
  });
  await assert.rejects(() => call({ plane: 'ot', endpoint: '/x' }, context), /rate limit/i);
  assert.equal(n, 1, 'without ToWait-Sec there is nothing to wait for');
});

test('refuses to sleep longer than the cap', async () => {
  clearTokenCache();
  let n = 0;
  const { context } = makeContext({
    script: () => {
      n += 1;
      return raw(409, 'exhausted', { 'x-ratelimit-towait-sec': '3600' });
    },
  });
  await assert.rejects(() => call({ plane: 'ot', endpoint: '/x' }, context));
  assert.equal(n, 1, 'an hour-long wait must fail rather than block the workflow');
});

test('classifies rate-limit signals', () => {
  const res = (statusCode, headers = {}) => ({ statusCode, headers, body: '' });
  assert.equal(isRateLimited(res(200, { 'x-ratelimit-remaining': '0' })), false);
  assert.equal(isRateLimited(res(409)), true);
  assert.equal(isRateLimited(res(429)), true);
  assert.equal(rateLimitWaitMs(res(409, { 'x-ratelimit-towait-sec': '2' })), 2000);
  assert.equal(rateLimitWaitMs(res(409, { 'x-ratelimit-towait-sec': 'nonsense' })), 0);
  // Array-valued headers happen with some HTTP clients.
  assert.equal(rateLimitWaitMs({ statusCode: 409, headers: { 'X-RateLimit-ToWait-Sec': ['3'] } }), 3000);
});

// -------------------------------------------------------------- error detail

const explainCases = [
  ['csam', 400, JSON.stringify({ responseMessage: 'Error validating customer from token - Invalid Subscription Id' }), /only accepts username\/password/],
  ['fo', 401, '<SIMPLE_RETURN><RESPONSE><TEXT>Token has no access for the application.</TEXT></RESPONSE></SIMPLE_RETURN>', /does not accept username-derived tokens/],
  ['ot', 403, JSON.stringify({ message: 'forbidden' }), /App API Enabled/],
  ['csam', 416, JSON.stringify({ responseMessage: 'too big' }), /above the maximum/],
  ['csam', 400, JSON.stringify({ responseMessage: 'bad operator' }), /operator the field does not support/],
  ['ot', 401, 'unauthorized', /SSO is disabled/],
  ['ot', 409, 'exhausted', /rate limit for this subscription is exhausted/],
  ['ot', 500, JSON.stringify({ error: 'kaboom' }), /kaboom/],
];

for (const [plane, statusCode, body, expected] of explainCases) {
  test(`explains HTTP ${statusCode} on the ${plane} plane`, async () => {
    clearTokenCache();
    const { context } = makeContext({ script: () => raw(statusCode, body) });
    await assert.rejects(
      () => call({ plane, endpoint: '/x', xml: statusCode === 401 && plane === 'fo' }, context),
      expected,
    );
  });
}

test('falls back to a generic message when the body carries none', async () => {
  clearTokenCache();
  const emptyBody = makeContext({ script: () => raw(500, '') });
  await assert.rejects(() => call({ plane: 'ot', endpoint: '/x' }, emptyBody.context), /HTTP 500/);

  clearTokenCache();
  const objBody = makeContext({ script: () => ({ statusCode: 500, headers: {}, body: {} }) });
  await assert.rejects(() => call({ plane: 'ot', endpoint: '/x' }, objBody.context), /HTTP 500/);

  clearTokenCache();
  const longText = makeContext({ script: () => raw(500, 'x'.repeat(900)) });
  await assert.rejects(() => call({ plane: 'ot', endpoint: '/x' }, longText.context), /x{100}/);
});

test('wraps a transport-level failure', async () => {
  clearTokenCache();
  const { context } = makeContext({
    script: () => {
      throw new Error('socket hang up');
    },
  });
  await assert.rejects(() => call({ plane: 'ot', endpoint: '/x' }, context));
});

// ------------------------------------------------------------------ XML odds

test('handles XML shapes the node meets only rarely', () => {
  // Attributes alongside child elements.
  const withAttrs = parseQualysXml('<R><N id="7" kind="a"><C>1</C></N></R>').R.N;
  assert.equal(withAttrs.id, 7);
  assert.equal(withAttrs.kind, 'a');
  assert.equal(withAttrs.C, 1);

  // A document whose root is a bare value still yields an object.
  assert.ok(typeof parseQualysXml('<R>text</R>') === 'object');

  // Mixed text and elements keeps both.
  const mixed = parseQualysXml('<R><N>text<C>1</C></N></R>').R.N;
  assert.equal(mixed.C, 1);

  // Unparseable input must not throw.
  assert.doesNotThrow(() => parseQualysXml('not xml at all'));
});

test('ignores attribute-keyed entries that carry no key', () => {
  const factors = parseQualysXml(
    '<R><QDS_FACTORS><QDS_FACTOR name="CVSS">4.7</QDS_FACTOR>' +
      '<QDS_FACTOR>no name attribute</QDS_FACTOR></QDS_FACTORS></R>',
  ).R.QDS_FACTORS;
  // The unkeyed entry is dropped, and a decimal stays a string so version-like
  // values are not mangled.
  assert.deepEqual(factors, { CVSS: '4.7' });
});

test('pluck walks partial paths without throwing', () => {
  assert.equal(pluck({ a: { b: 1 } }, 'a.b'), 1);
  assert.equal(pluck({ a: 1 }, 'a.b.c'), undefined);
  assert.equal(pluck(null, 'a'), undefined);
  assert.equal(pluck({ a: [1] }, 'a.0'), undefined);
});

test('finds a next-batch URL wherever it is nested, and ignores blanks', () => {
  assert.equal(
    findNextBatchUrl(parseQualysXml('<A><B><WARNING><URL>https://x/1</URL></WARNING></B></A>')),
    'https://x/1',
  );
  assert.equal(
    findNextBatchUrl(parseQualysXml('<A><WARNING><URL>   </URL></WARNING></A>')),
    undefined,
  );
  assert.equal(findNextBatchUrl({ WARNING: { URL: 'https://x/2' } }), 'https://x/2');
  assert.equal(findNextBatchUrl({ WARNING: [{ CODE: 1 }, { URL: 'https://x/3' }] }), 'https://x/3');
  assert.equal(findNextBatchUrl({ list: [{ WARNING: { URL: 'https://x/4' } }] }), 'https://x/4');
  assert.equal(findNextBatchUrl({ nothing: true }), undefined);
  assert.equal(findNextBatchUrl({ WARNING: 'not an object' }), undefined);
});

// ------------------------------------------------------------ credential test

const {
  testQualysCredential,
} = require('../dist/nodes/Qualys/transport/credentialTest');

/**
 * The credential-test context is not the execute context: n8n hands it only a
 * logger and the legacy `request` helper.
 */
function testContext(script) {
  const calls = [];
  const context = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    helpers: {
      request: async (options) => {
        calls.push(options);
        return script(options, calls);
      },
    },
  };

  return { context, calls };
}

const runTest = async (data, script) => {
  const { context, calls } = testContext(script);
  const result = await testQualysCredential.call(context, { data });
  return { result, calls };
};

const accepted = { statusCode: 200, body: 'header.payload.signature' };

test('refuses a credential that carries no secret at all', async () => {
  const { result, calls } = await runTest({ pod: 'eu2' }, () => accepted);

  assert.equal(result.status, 'Error');
  assert.match(result.message, /Enter an API client ID and secret/);
  // Nothing is sent when there is nothing to test.
  assert.equal(calls.length, 0);
});

test('reports an unusable host before reaching the network', async () => {
  const { result, calls } = await runTest({ pod: 'custom', baseUrl: '  ' }, () => accepted);

  assert.equal(result.status, 'Error');
  assert.match(result.message, /Base URL is required/);
  assert.equal(calls.length, 0);
});

test('tests the client against the endpoint its type selects', async () => {
  const { result, calls } = await runTest(
    { pod: 'eu2', clientId: 'a', clientSecret: 'b', clientGrant: 'oauth' },
    () => accepted,
  );

  assert.equal(result.status, 'OK');
  assert.match(calls[0].uri, /\/auth\/oauth$/);
  assert.equal(calls[0].headers.clientId, 'a');
  // A client cannot reach Asset Management, so the result says so.
  assert.match(result.message, /need a username and password/);
});

test('tests the username and password against the user token endpoint', async () => {
  const { result, calls } = await runTest(
    { pod: 'eu2', username: 'u', password: 'p' },
    () => accepted,
  );

  assert.equal(result.status, 'OK');
  assert.equal(result.message, 'Connection successful');
  assert.match(calls[0].uri, /\/auth$/);
  assert.match(String(calls[0].body), /username=u&password=p&token=true/);
});

test('tests both secrets and names the one that was rejected', async () => {
  const { result, calls } = await runTest(
    { pod: 'eu2', clientId: 'a', clientSecret: 'b', username: 'u', password: 'p' },
    (options) =>
      /\/auth\/oidc$/.test(options.uri)
        ? { statusCode: 401, body: 'Bad client credentials' }
        : accepted,
  );

  assert.equal(calls.length, 2);
  // One secret working is still a usable credential.
  assert.equal(result.status, 'OK');
  assert.match(result.message, /API client was rejected \(Bad client credentials\)/);
  assert.doesNotMatch(result.message, /need a username and password/);
});

test('fails when every secret is rejected', async () => {
  const { result } = await runTest(
    { pod: 'eu2', clientId: 'a', clientSecret: 'b', username: 'u', password: 'p' },
    () => ({ statusCode: 401, body: '' }),
  );

  assert.equal(result.status, 'Error');
  assert.match(result.message, /API client: HTTP 401/);
  assert.match(result.message, /Username and password: HTTP 401/);
});

test('treats an accepted response with no token as a failure', async () => {
  const { result } = await runTest({ pod: 'eu2', username: 'u', password: 'p' }, () => ({
    statusCode: 200,
    body: '   ',
  }));

  assert.equal(result.status, 'Error');
  assert.match(result.message, /HTTP 200/);
});

test('survives a transport-level throw and redacts what it reports', async () => {
  const { result } = await runTest({ pod: 'eu2', username: 'u', password: 'p' }, () => {
    throw new Error('connect ETIMEDOUT, sent Authorization: Bearer abc.def.ghi');
  });

  assert.equal(result.status, 'Error');
  assert.match(result.message, /ETIMEDOUT/);
  assert.doesNotMatch(result.message, /abc\.def\.ghi/);
});

test('reports a rejection body with any JWT in it redacted', async () => {
  const leaky = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZSJ9.c2lnbmF0dXJl';
  const { result } = await runTest({ pod: 'eu2', clientId: 'a', clientSecret: 'b' }, () => ({
    statusCode: 400,
    // Qualys has echoed a token back in an error body before now.
    body: `rejected for ref/9912 token=${leaky}`,
  }));

  assert.equal(result.status, 'Error');
  assert.doesNotMatch(result.message, new RegExp(leaky));
  // The diagnostic parts survive: only the credential material goes.
  assert.match(result.message, /rejected for ref\/9912/);
});

test('tolerates a credential with no data at all', async () => {
  const { context } = testContext(() => accepted);
  const result = await testQualysCredential.call(context, {});

  assert.equal(result.status, 'Error');
});

test('falls back when the request helper answers nothing usable', async () => {
  // A helper that resolves to undefined, and a throw carrying no message: both
  // must still produce a readable result rather than crashing the test button.
  const { result: empty } = await runTest(
    { pod: 'eu2', username: 'u', password: 'p' },
    () => undefined,
  );
  assert.equal(empty.status, 'Error');
  assert.match(empty.message, /HTTP 0/);

  const { result: silent } = await runTest({ pod: 'eu2', username: 'u', password: 'p' }, () => {
    throw new Error('');
  });
  assert.equal(silent.status, 'Error');
  assert.match(silent.message, /request failed/);
});

test('reads a non-string body as an unusable response', async () => {
  const { result } = await runTest({ pod: 'eu2', clientId: 'a', clientSecret: 'b' }, () => ({
    statusCode: 200,
    body: { token: 'parsed-already' },
  }));

  // The helper is asked for the raw body; an object means the shape changed, so
  // it is reported rather than assumed good.
  assert.equal(result.status, 'Error');
  assert.match(result.message, /HTTP 200/);
});

test('surfaces the message from an object-bodied auth rejection', async () => {
  clearTokenCache();
  const { context } = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b' },
    // A helper that has already parsed the error body hands back an object.
    authResponse: { statusCode: 401, body: { message: 'Client is disabled' } },
  });

  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context),
    /Client is disabled/,
  );
});

test('falls back to the status code when an auth rejection says nothing', async () => {
  clearTokenCache();
  const bare = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b' },
    authResponse: { statusCode: 503, body: '' },
  });

  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, bare.context),
    /HTTP 503/,
  );

  // An object body with no recognisable message field lands in the same place.
  clearTokenCache();
  const shapeless = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b' },
    authResponse: { statusCode: 500, body: { unexpected: true } },
  });

  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, shapeless.context),
    /HTTP 500/,
  );
});

test('rejects an auth response that carries no token at all', async () => {
  clearTokenCache();
  const { context } = makeContext({
    script: () => json({ ok: true }),
    credentials: { pod: 'eu2', clientId: 'a', clientSecret: 'b' },
    authResponse: { statusCode: 200, body: '' },
  });

  await assert.rejects(
    () => call({ plane: 'ot', endpoint: '/ot/1.0/host/list' }, context),
    /returned no token/,
  );
});
