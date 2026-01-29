#!/usr/bin/env node
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../src/cli/cli.ts');

if (existsSync(srcPath)) {
  // Development: use tsx to run TypeScript directly
  await import('tsx');
  await import('../src/cli/cli.ts');
} else {
  // Published: use pre-compiled version
  await import('../dist/cli.js');
}
