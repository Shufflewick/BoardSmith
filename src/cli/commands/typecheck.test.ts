import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * `boardsmith typecheck` runs `vue-tsc` over the workspace's tsconfig.json, and
 * in the BoardSmith repository `boardsmith test` runs it first (#312).
 *
 * Each case plants an error in a workspace shaped like this repository (it has
 * `src/engine/`) and proves the command sees it: once in a `.ts` file and once
 * in a `.vue` `<script setup>` block, the file kind plain `tsc` cannot read.
 */
const CLEAN_TS = "export const answer: number = 42;\n";
const BAD_TS = "export const answer: string = 42;\n";
const CLEAN_VUE = '<script setup lang="ts">\nconst count: number = 1;\n</script>\n\n<template><p>{{ count }}</p></template>\n';
const BAD_VUE = '<script setup lang="ts">\nconst count: number = \'one\';\n</script>\n\n<template><p>{{ count }}</p></template>\n';

async function workspace(files: Record<string, string>): Promise<string> {
  const tree = tempTree('bs-typecheck-');
  const root = join(tree, 'boardsmith');
  const all: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: ['src/**/*.ts', 'src/**/*.vue'],
    }),
    'src/engine/answer.ts': CLEAN_TS,
    'src/ui/Counter.vue': CLEAN_VUE,
    'src/engine/answer.test.ts':
      "import { it, expect } from 'vitest';\nimport { answer } from './answer.js';\nit('answers', () => { expect(answer).toBe(42); });\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await fs.mkdir(join(root, path, '..'), { recursive: true });
    await fs.writeFile(join(root, path), content);
  }
  await fs.symlink(INSTALLED_MODULES, join(root, 'node_modules'), 'dir');
  return root;
}

describe('boardsmith typecheck', () => {
  it('passes a workspace with no type errors', async () => {
    const run = await spawnCli(['typecheck'], await workspace({}));
    expect(run.stdout + run.stderr).not.toMatch(/error TS/);
    expect(run.code).toBe(0);
  });

  it('fails on a type error in a .ts file, and names it', async () => {
    const run = await spawnCli(['typecheck'], await workspace({ 'src/engine/answer.ts': BAD_TS }));
    expect(run.stdout + run.stderr).toMatch(/src\/engine\/answer\.ts.*error TS2322/);
    expect(run.code).not.toBe(0);
  });

  it('fails on a type error in a .vue <script setup> block, and names it', async () => {
    const run = await spawnCli(['typecheck'], await workspace({ 'src/ui/Counter.vue': BAD_VUE }));
    expect(run.stdout + run.stderr).toMatch(/src\/ui\/Counter\.vue.*error TS2322/);
    expect(run.code).not.toBe(0);
  });
});

describe('boardsmith test in the BoardSmith repository', () => {
  it('type-checks first, then runs the tests', async () => {
    const run = await spawnCli(['test'], await workspace({}));
    expect(run.stdout).toContain('answer.test.ts');
    expect(run.code).toBe(0);
  });

  it('runs no test at all when the type check fails', async () => {
    const run = await spawnCli(['test'], await workspace({ 'src/engine/answer.ts': BAD_TS }));
    expect(run.stdout + run.stderr).toMatch(/error TS2322/);
    expect(run.stdout + run.stderr).toContain('boardsmith typecheck');
    expect(run.stdout).not.toContain('answer.test.ts');
    expect(run.code).not.toBe(0);
  });
});
