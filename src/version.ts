import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Name this lookup must match so a consumer's package.json is never picked up. */
const PACKAGE_NAME = 'docx-thai-cleaner';

/** How far to walk up from the entry file before giving up. */
const MAX_DEPTH = 10;

/** Fallback when package.json cannot be located (e.g. stripped or exotic install). */
const FALLBACK_VERSION = '0.0.0';

function findPackageVersion(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string' && pkg.version !== '') {
          return pkg.version;
        }
      } catch {
        // Corrupt package.json — keep walking upward.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve this package's version from package.json at runtime.
 *
 * Starts from the directory of `entryPath` (defaults to the running script,
 * `process.argv[1]`) so the answer is correct for both the ESM build
 * (`dist/cli.js`) and the CommonJS build (`dist/cjs/cli.js`). The path is
 * `realpath`-ed first so the `node_modules/.bin` symlink npm creates for the
 * `docx-thai-cleaner` binary still lands inside this package.
 *
 * @param entryPath File whose directory begins the upward search.
 * @returns The version string from package.json, or `'0.0.0'` if not found.
 */
export function readPackageVersion(entryPath: string | undefined = process.argv[1]): string {
  if (entryPath === undefined) return FALLBACK_VERSION;

  const candidates = new Set<string>();
  try {
    candidates.add(dirname(realpathSync(entryPath)));
  } catch {
    // Entry does not exist on disk (e.g. evaluated from a string) — fall back
    // to the plain resolved directory below.
  }
  candidates.add(dirname(resolve(entryPath)));

  for (const dir of candidates) {
    const version = findPackageVersion(dir);
    if (version !== undefined) return version;
  }
  return FALLBACK_VERSION;
}
