/**
 * Shared test scaffolding. Requiring this first stubs `n8n-workflow` so the
 * compiled node can be loaded outside n8n, and provides a scripted execute
 * context so every code path can be driven without touching the network.
 *
 * Node's test runner gives each test file its own process, so each file must
 * require this before anything from `dist/`.
 */
const Module = require('node:module');

class NodeApiError extends Error {
  constructor(node, body, options) {
    super((options && options.message) || 'Qualys API error');
    this.name = 'NodeApiError';
    this.node = node;
    this.body = body;
    this.description = options && options.description;
    this.httpCode = options && options.httpCode;
  }
}

class NodeOperationError extends Error {
  constructor(node, message, options) {
    super(typeof message === 'string' ? message : JSON.stringify(message));
    this.name = 'NodeOperationError';
    this.node = node;
    this.itemIndex = options && options.itemIndex;
  }
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'n8n-workflow') {
    return {
      NodeConnectionType: { Main: 'main' },
      NodeApiError,
      NodeOperationError,
      // Real waits would make the rate-limit tests take a minute and a half.
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

/** Every wait the transport asked for, so a test can assert on it. */
const sleeps = [];

/** A JWT whose payload decodes; only `exp` is read by the transport. */
function jwt(claims = {}) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

const CREDENTIALS = {
  pod: 'eu2',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  clientGrant: 'oidc',
  xRequestedWith: 'n8n-tests',
};

/**
 * Build an IExecuteFunctions-shaped stub.
 *
 * `script(options, calls)` returns the canned response for each request.
 * Parameter values may be functions of `(itemJson, itemIndex)`, standing in for
 * n8n's expression engine resolving against a given input item.
 */
function makeContext({
  params = {},
  script,
  credentials = CREDENTIALS,
  inputItems = [{ json: {} }],
  continueOnFail = false,
  token = jwt(),
  /** A verbatim auth response, for exercising the token endpoint's failures. */
  authResponse,
} = {}) {
  const calls = [];
  const authCalls = [];

  const context = {
    getInputData: () => inputItems,
    getCredentials: async () => credentials,
    getNode: () => ({ name: 'Qualys', type: 'qualysVmdrOt', typeVersion: 1 }),
    continueOnFail: () => continueOnFail,
    getNodeParameter: (name, index, fallback) => {
      if (!(name in params)) return fallback;
      const value = params[name];
      return typeof value === 'function' ? value(inputItems[index]?.json ?? {}, index) : value;
    },
    helpers: {
      httpRequest: async (options) => {
        if (/\/auth(\/|$)/.test(options.url)) {
          authCalls.push(options);
          if (authResponse !== undefined) {
            return { headers: {}, ...authResponse };
          }
          if (token === null) {
            return { statusCode: 401, headers: {}, body: 'bad credentials' };
          }
          // A non-string token stands in for an HTTP helper that has already
          // parsed the response body.
          return { statusCode: 200, headers: {}, body: token };
        }

        calls.push(options);
        return script(options, calls);
      },
    },
  };

  return { context, calls, authCalls };
}

const json = (body, headers = {}) => ({
  statusCode: 200,
  headers,
  body: JSON.stringify(body),
});

const raw = (statusCode, body, headers = {}) => ({ statusCode, headers, body });

const { OPERATIONS } = require('../.test-build/nodes/Qualys/actions/resources');

/**
 * Node parameters for one operation. Operation values are unique across
 * resources, so the resource is derived and a test only ever names the
 * operation it is exercising.
 */
const params = (operation, extra = {}) => ({
  operation,
  resource: OPERATIONS[operation]?.resource,
  ...extra,
});

/** Shorthand adding the paging and output defaults every list shares. */
const listParams = (operation, extra = {}) => ({
  operation,
  resource: OPERATIONS[operation]?.resource,
  outputMode: 'items',
  includeMetadata: false,
  listAll: false,
  count: 100,
  truncationLimit: 100,
  ...extra,
});

module.exports = {
  sleeps,
  NodeApiError,
  NodeOperationError,
  CREDENTIALS,
  makeContext,
  jwt,
  json,
  raw,
  params,
  listParams,
};
