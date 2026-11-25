/**
 * A built bundle keeps no template comments (#1817). A component whose template starts with one
 * compiles to a fragment, and Vue's production runtime drops a parent's attributes (a test id, a
 * class) on a fragment. Vue's development compiler keeps comments, and Node keeps whichever of its
 * builds loaded first, so a build that loads it before vite sets NODE_ENV ships them. The builds run
 * while the file is collected, where no test timeout applies (#363).
 */
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { buildProject } from './build.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { CLI_BIN } from '../spawn-cli.test-helper.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
// The builds read these by path, and the CLI loads its command tree; this links them, loading nothing (#1415).
import.meta.glob(['./simulate.fixture.ts', '/src/vite-config/index.js', '/src/cli/**/*.ts', '!**/*.test.ts']);

/** A table game whose UI mounts a component whose template starts with a comment, under `viteConfig`. */
function game(viteConfig: string): string {
  const dir = tempTree('boardsmith-build-template-comments-');
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  const files: Record<string, string> = {
    'boardsmith.json': JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table' }),
    'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0' }),
    'index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
    'vite.config.mjs': viteConfig,
    'src/rules/index.ts':
      `import { DeadEndGame } from ${JSON.stringify(join(here, 'simulate.fixture.ts'))};\n` +
      "export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', minPlayers: 3, maxPlayers: 4 };\n",
    'src/Panel.vue': '<template>\n  <!-- the panel comment -->\n  <div class="panel">actions</div>\n</template>\n',
    'src/main.ts': "import { createApp, h } from 'vue';\nimport Panel from './Panel.vue';\ncreateApp({ render: () => h(Panel, { 'data-testid': 'bs-action-panel' }) }).mount('#app');\n",
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

/** Every built JavaScript file of `dir`, joined. */
const bundle = (dir: string) => {
  const assets = join(dir, 'dist', 'ui', 'assets');
  return readdirSync(assets).filter((file) => file.endsWith('.js')).map((file) => readFileSync(join(assets, file), 'utf-8')).join('\n');
};

// In this process Vue's development compiler is already loaded (NODE_ENV is `test`).
const shipped = game(`import { defineGameViteConfig } from ${JSON.stringify(pathToFileURL(join(repo, 'src', 'vite-config', 'index.js')).href)};\nexport default defineGameViteConfig();\n`);
const log = vi.spyOn(console, 'log').mockImplementation(() => {});
await buildProject(shipped, {});
log.mockRestore();

// The CLI as a shell runs it, with NODE_ENV unset and a config that sets no compiler options.
const plain = game("import vue from '@vitejs/plugin-vue';\nexport default { plugins: [vue()] };\n");
const { NODE_ENV: _unset, ...env } = process.env;
await promisify(execFile)(process.execPath, [CLI_BIN, 'build'], { cwd: plain, env });

describe('boardsmith build', () => {
  it("drops template comments under defineGameViteConfig, so a component whose template starts with one keeps a parent's attributes", () => {
    expect(bundle(shipped)).toContain('actions');
    expect(bundle(shipped).includes('the panel comment')).toBe(false);
  });

  it("compiles with Vue's production compiler, which drops template comments, when NODE_ENV is unset", () => {
    expect(bundle(plain)).toContain('actions');
    expect(bundle(plain).includes('the panel comment')).toBe(false);
  });
});
