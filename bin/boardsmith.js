#!/usr/bin/env node
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect if we're in the actual BoardSmith dev repo (not an installed package).
// Published packages don't include a .git directory.
const isDevRepo = existsSync(join(__dirname, '../.git'));

if (isDevRepo) {
  // Development: run the TypeScript sources directly, so every command reflects
  // the working tree with no build step and no chance of running a stale
  // bundle. `dist/cli.js` is produced explicitly by `boardsmith build` and
  // `boardsmith pack`; it is never what this repo executes.
  await import('tsx');
  await import('../src/cli/cli.ts');
} else {
  // Installed package: run the pre-compiled bundle.
  await import('../dist/cli.js');
}
