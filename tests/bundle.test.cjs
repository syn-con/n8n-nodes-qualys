'use strict';

/**
 * Guards the published artifact rather than the source.
 *
 * Community nodes may not declare runtime dependencies, so `fast-xml-parser` is
 * bundled into `dist` at build time. Nothing in the source tree can catch a
 * regression there - a stray `require` only fails on an n8n host, where the
 * package is not installed. These tests read `dist` directly.
 */

const assert = require('node:assert/strict');
const { builtinModules } = require('node:module');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');

const BUNDLED_ENTRIES = [...pkg.n8n.nodes, ...pkg.n8n.credentials];

/** Anything the n8n host is guaranteed to provide. */
const PROVIDED = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  ...Object.keys(pkg.peerDependencies ?? {}),
]);

test('every entry point n8n loads is present in dist', () => {
  for (const entry of BUNDLED_ENTRIES) {
    assert.ok(existsSync(path.join(root, entry)), `${entry} is missing from the build`);
  }
});

test('the package declares no runtime dependencies', () => {
  assert.equal(
    pkg.dependencies,
    undefined,
    'community nodes must not ship dependencies; bundle them instead',
  );
});

test('bundled entry points require nothing the n8n host does not provide', () => {
  for (const entry of BUNDLED_ENTRIES) {
    const source = readFileSync(path.join(root, entry), 'utf8');
    const required = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);

    for (const request of required) {
      if (request.startsWith('.') || request.startsWith('/')) {
        continue;
      }
      assert.ok(
        PROVIDED.has(request),
        `${entry} requires "${request}", which is not installed on an n8n host`,
      );
    }
  }
});

test('the XML parser is inlined rather than required', () => {
  const node = readFileSync(path.join(root, pkg.n8n.nodes[0]), 'utf8');
  assert.ok(
    !/require\(["']fast-xml-parser["']\)/.test(node),
    'fast-xml-parser must be bundled, not required',
  );
  // The bundled parser has to actually be in there, or XML responses break.
  assert.ok(node.includes('XMLParser'), 'the bundled parser is missing from the node');
});

test('the bundled node loads and describes itself', () => {
  const { QualysVmdrOt } = require(path.join(root, pkg.n8n.nodes[0]));
  const node = new QualysVmdrOt();

  assert.equal(node.description.name, 'qualysVmdrOt');
  assert.ok(node.description.properties.length > 0);
  assert.equal(typeof node.execute, 'function');
});

test('the bundled credential loads', () => {
  const { QualysVmdrOtApi } = require(path.join(root, pkg.n8n.credentials[0]));
  const credential = new QualysVmdrOtApi();

  assert.equal(credential.name, 'qualysVmdrOtApi');
  assert.ok(credential.documentationUrl);
});

test('the codex ships beside the compiled node, naming this package', () => {
  const codexPath = path.join(root, pkg.n8n.nodes[0].replace(/\.js$/, '.json'));
  assert.ok(existsSync(codexPath), 'the .node.json codex is missing from dist');

  const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
  assert.equal(codex.node, `${pkg.name}.qualysVmdrOt`);
});

test('every declared icon resolves to a file that shipped', () => {
  // n8n resolves a `file:` icon against the directory of the class that
  // declares it, so the assertion follows the same path the loader will.
  const declared = [
    [pkg.n8n.nodes[0], new (require(path.join(root, pkg.n8n.nodes[0]))).QualysVmdrOt().description.icon],
    [
      pkg.n8n.credentials[0],
      new (require(path.join(root, pkg.n8n.credentials[0]))).QualysVmdrOtApi().icon,
    ],
  ];

  for (const [entry, icon] of declared) {
    assert.ok(icon, `${entry} declares no icon`);
    const dir = path.dirname(path.join(root, entry));

    for (const theme of ['light', 'dark']) {
      const declaredPath = icon[theme];
      assert.ok(declaredPath?.startsWith('file:'), `${entry} ${theme} icon must use file:`);

      const resolved = path.resolve(dir, declaredPath.slice('file:'.length));
      assert.ok(existsSync(resolved), `${entry} ${theme} icon is missing from the build: ${resolved}`);
    }

    assert.notEqual(icon.light, icon.dark, `${entry} uses the same file for both themes`);
  }
});
