/**
 * Build the publishable artifact.
 *
 * `n8n-node build` is `tsc` plus a copy of `**\/*.{png,svg}`. That is not enough
 * here for two reasons:
 *
 *   - Community nodes may not declare runtime dependencies, so `fast-xml-parser`
 *     has to be bundled into the emitted JavaScript rather than resolved from
 *     `node_modules` on the n8n host. Qualys' platform API answers only in XML,
 *     so the parser is not optional.
 *   - n8n reads a node's codex from `<node>.node.json` sitting beside the
 *     compiled node. `tsc` does not copy it, so the categories and the
 *     documentation links were silently absent from every published version.
 *
 * Entry points stay separate, and `outbase` keeps the source tree's shape,
 * because n8n loads the paths named in package.json's `n8n` field.
 */
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const OUT = 'dist';

await rm(OUT, { recursive: true, force: true });

await build({
  entryPoints: [
    'index.ts',
    'nodes/Qualys/QualysVmdrOt.node.ts',
    'credentials/QualysVmdrOtApi.credentials.ts',
  ],
  outdir: OUT,
  outbase: '.',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  // Provided by the n8n instance that loads the node; everything else is inlined.
  external: ['n8n-workflow'],
  logLevel: 'info',
});

// Types are published alongside the bundle, so emit them from tsc separately.
// Invoked through node with tsc's own entry point rather than through `npx`,
// which resolves to a shell wrapper that spawnSync cannot run on Windows.
const tsc = spawnSync(
  process.execPath,
  [require.resolve('typescript/bin/tsc'), '--emitDeclarationOnly', '--declaration', '--outDir', OUT],
  { stdio: 'inherit' },
);

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

// Icons, and the codex `tsc` would otherwise leave behind.
for await (const file of glob('**/*.{png,svg,node.json}', {
  exclude: (name) => name === 'dist' || name === 'node_modules',
})) {
  const dest = path.join(OUT, file);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(file, dest);
}

console.log('Build complete');
