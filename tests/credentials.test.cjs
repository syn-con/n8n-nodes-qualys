'use strict';

/**
 * The credential's own test request.
 *
 * n8n runs this declaratively from the credential dialog, so there is no code
 * path to exercise - what matters is that the request it describes is the one
 * the transport would make, and that the host expression covers every platform
 * the credential offers.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

require('./support.cjs');

const {
  QualysVmdrOtApi,
} = require('../.test-build/credentials/QualysVmdrOtApi.credentials');
const { POD_HOSTS } = require('../.test-build/nodes/Qualys/transport/hosts');

const credential = new QualysVmdrOtApi();

test('declares a credential test, which n8n requires', () => {
  assert.ok(credential.test, 'the credential must declare a test');
  assert.ok(credential.test.request, 'the credential test must describe a request');
});

test('the test mints a token the way the transport does', () => {
  const { request } = credential.test;

  assert.equal(request.method, 'POST');
  // Only the client type decides the endpoint; a stored oauth client still works.
  assert.match(request.url, /auth\/oidc/);
  assert.match(request.url, /auth\/oauth/);
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('the test sends the client, and never the token', () => {
  const { headers } = credential.test.request;

  assert.equal(headers.clientId, '={{ $credentials.clientId }}');
  assert.equal(headers.clientSecret, '={{ $credentials.clientSecret }}');
  assert.ok(!('Authorization' in headers), 'the token is what this request mints');
});

test('the host expression covers every platform the credential offers', () => {
  const { baseURL } = credential.test.request;
  const offered = credential.properties
    .find((property) => property.name === 'pod')
    .options.map((option) => option.value);

  for (const pod of offered) {
    if (pod === 'custom') {
      // Custom has no fixed host: the URL is whatever was typed in.
      assert.match(baseURL, /\$credentials\.baseUrl/);
      continue;
    }

    const gateway = POD_HOSTS[pod]?.gateway;
    assert.ok(gateway, `${pod} is offered but has no gateway host`);
    assert.ok(
      baseURL.includes(gateway),
      `${pod} is offered but its gateway is missing from the credential test`,
    );
  }
});

test('a custom platform is defaulted to HTTPS rather than sent as typed', () => {
  // The secret travels on this request, so a bare host must not become http://.
  assert.match(credential.test.request.baseURL, /'https:\/\/' \+ \$credentials\.baseUrl/);
});
