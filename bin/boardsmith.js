#!/usr/bin/env node
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '../dist/cli.js');

// Detect if we're in the actual BoardSmith dev repo (not an installed package)
// Published packages don't include .git directory
const isDevRepo = existsSync(join(__dirname, '../.git'));

// Commands that should use compiled CLI (build first if needed)
const compiledCommands = ['pack', 'publish'];
const command = process.argv[2];

if (isDevRepo && compiledCommands.includes(command)) {
  // Always rebuild CLI for pack/publish to ensure latest source is bundled
  console.log('Building CLI...');
  execSync('npm run build:cli', {
    cwd: join(__dirname, '..'),
    stdio: 'inherit'
  });
  await import('../dist/cli.js');
} else if (isDevRepo) {
  // Development: use tsx to run TypeScript directly
  await import('tsx');
  await import('../src/cli/cli.ts');
} else {
  // Published: use pre-compiled version
  await import('../dist/cli.js');
}
