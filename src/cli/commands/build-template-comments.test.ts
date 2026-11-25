/**
 * A built bundle keeps no template comments (#1817). A component whose template starts with one
 * compiles to a fragment, and Vue's production runtime drops a parent's attributes (a test id, a
 * class) on a fragment. The CLI may have loaded Vue's development compiler, which keeps comments,
 * before a build starts; this test process has (NODE_ENV is `test`). The build runs while the file
 * is collected, where no test timeout applies (#363).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildProject } from './build.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
// The build reads these by path; this links them, loading nothing (#1415).
import.meta.glob(['./simulate.fixture.ts', '/src/vite-config/index.js']);

const game = tempTree('boardsmith-build-template-comments-');
mkdirSync(join(game, 'src', 'rules'), { recursive: true });
const files: Record<string, string> = {
  'boardsmith.json': JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table' }),
  'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0' }),
  'index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n',
  'vite.config.mjs': `import { defineGameViteConfig } from ${JSON.stringify(pathToFileURL(join(repo, 'src', 'vite-config', 'index.js')).href)};\nexport default defineGameViteConfig();\n`,
  'src/rules/index.ts':
    `import { DeadEndGame } from ${JSON.stringify(join(here, 'simulate.fixture.ts'))};\n` +
    "export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', minPlayers: 3, maxPlayers: 4 };\n",
  'src/Panel.vue': '<template>\n  <!-- the panel comment -->\n  <div class="panel">actions</div>\n</template>\n',
  'src/main.ts': "import { createApp, h } from 'vue';\nimport Panel from './Panel.vue';\ncreateApp({ render: () => h(Panel, { 'data-testid': 'bs-action-panel' }) }).mount('#app');\n",
};
for (const [path, text] of Object.entries(files)) writeFileSync(join(game, path), text);
symlinkSync(join(repo, 'node_modules'), join(game, 'node_modules'));
const log = vi.spyOn(console, 'log').mockImplementation(() => {});
await buildProject(game, {});
log.mockRestore();
const assets = join(game, 'dist', 'ui', 'assets');
const bundle = readdirSync(assets).filter((file) => file.endsWith('.js')).map((file) => readFileSync(join(assets, file), 'utf-8')).join('\n');

describe('boardsmith build', () => {
  it("drops template comments, so a component whose template starts with one keeps a parent's attributes (#1817)", () => {
    expect(bundle).toContain('actions');
    expect(bundle.includes('the panel comment')).toBe(false);
  });
});
