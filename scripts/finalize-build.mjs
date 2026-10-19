/**
 * Post-build finalizer.
 *
 * - Writes dist/cjs/package.json so Node treats the CommonJS build as CJS
 *   even though the package root declares "type": "module".
 * - Makes the CLI entry points executable for local/bin usage.
 * - Ensures the CLI files carry a Node shebang (tsc preserves it, this is a guard).
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cjsPackageJson = fileURLToPath(new URL('../dist/cjs/package.json', import.meta.url));
writeFileSync(cjsPackageJson, `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

const shebang = '#!/usr/bin/env node';
for (const cliPath of ['../dist/cli.js', '../dist/cjs/cli.js']) {
  const absolute = fileURLToPath(new URL(cliPath, import.meta.url));
  if (!existsSync(absolute)) continue;
  const source = readFileSync(absolute, 'utf8');
  if (!source.startsWith(shebang)) {
    writeFileSync(absolute, `${shebang}\n${source}`);
  }
  chmodSync(absolute, 0o755);
}

console.log('finalize-build: dist/cjs/package.json written, CLI entry points marked executable.');
