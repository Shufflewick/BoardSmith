/**
 * Tree-shaking bundle proof — SHIP-02
 *
 * Verifies empirically that a production Vite/Rollup build of a game project:
 *   NEGATIVE CASE: uses a custom UI → AutoRenderer/AutoUI are absent from the bundle
 *   POSITIVE CONTROL: uses "ui":"auto" → AutoRenderer IS present in the bundle
 *
 * This is a REAL build (viteBuild) + REAL bundle grep, not a mock or code-review
 * claim. The tree-shaking guarantee comes from the single static import in the
 * generated App.vue (Plan 01 fix); this test guards against future regression.
 *
 * Infrastructure deviations from the real `boardsmith build` pipeline (none affect
 * tree-shaking behavior, which is a Rollup analysis-time property):
 *   - configFile: false   – avoids loading fixture's vite.config.ts (deps not installed there)
 *   - resolve.alias       – maps boardsmith/ui → real repo source (equivalent to npm install)
 *   - plugins: [vue()]    – same as what fixture's vite.config.ts provides
 *
 * Minification is left at the Vite default (esbuild). Comments are stripped during
 * minification, which prevents false positives from comments that mention "AutoUI"
 * in included components (e.g. ActionPanel.vue). The string "AutoRenderer" survives
 * minification as a string value: @vue/compiler-sfc unconditionally emits
 * __name: 'AutoRenderer' in the compiled component object, and esbuild does NOT
 * mangle object property values (only local identifiers).
 *
 * Fixtures are placed inside the BoardSmith repo tree (at .treeshake-test-fixtures/)
 * so that Rollup's node_modules walk finds the repo's node_modules for vue/etc.
 * Each fixture is cleaned up in afterEach.
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import vue from '@vitejs/plugin-vue';
import { generateScaffoldFiles } from './project-scaffold.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/cli/lib/ → go up 3 dirs to reach the BoardSmith repo root
const BOARDSMITH_ROOT = join(__dirname, '..', '..', '..');
// Fixture parent: inside the repo so Rollup's node_modules walk reaches repo's node_modules.
// Cleaned up entirely in afterAll.
const FIXTURE_PARENT = join(BOARDSMITH_ROOT, '.treeshake-test-fixtures');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .js files under a directory, return concatenated content.
 */
function readBundleJs(dir: string): string {
  let content = '';
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        content += readFileSync(full, 'utf-8');
      }
    }
  }
  walk(dir);
  return content;
}

/**
 * Write scaffold files for a fixture game to `dir`.
 *
 * @param ui  If undefined → "auto" (AutoUI imported in App.vue).
 *            If a relative path → custom component (no AutoUI import).
 *            Use './components/GameTable.vue' for the custom case — this path
 *            resolves correctly from App.vue (src/ui/App.vue) to the GameTable
 *            stub that generateScaffoldFiles creates at src/ui/components/GameTable.vue.
 */
function writeFixtureFiles(dir: string, ui?: string): void {
  const files = generateScaffoldFiles({
    name: 'treeshake-test',
    displayName: 'TreeShake Test',
    description: 'Test fixture for tree-shaking verification',
    playerCount: { min: 2, max: 2 },
    ui,
  });
  for (const { path: relPath, content } of files) {
    const fullPath = join(dir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }
}

/**
 * Run a real Vite production UI build of the fixture at `fixtureDir`.
 * Returns the path to the dist/ui directory containing the JS bundle.
 *
 * Uses the same viteBuild path as `boardsmith build`'s UI step:
 *   viteBuild({ root: cwd, base: './', build: { outDir: dist/ui, ... } })
 */
async function buildFixtureUi(fixtureDir: string): Promise<string> {
  const outDir = join(fixtureDir, 'dist', 'ui');
  await viteBuild({
    // Skip reading the fixture's vite.config.ts — its @vitejs/plugin-vue dep is
    // not installed in the fixture directory.
    configFile: false,
    root: fixtureDir,
    base: './',
    plugins: [vue()],
    resolve: {
      alias: [
        // Map boardsmith/ui to the real source — equivalent to having the package
        // installed in node_modules. Tree-shaking is unaffected.
        {
          find: /^boardsmith\/ui$/,
          replacement: join(BOARDSMITH_ROOT, 'src/ui/index.ts'),
        },
        // Map boardsmith (engine) for any transitive imports.
        {
          find: /^boardsmith$/,
          replacement: join(BOARDSMITH_ROOT, 'src/engine/index.ts'),
        },
      ],
    },
    build: {
      outDir,
      copyPublicDir: false,
      emptyOutDir: true,
      // Use Vite's default minification (esbuild). Comments are stripped,
      // preventing false positives from comments in included components.
      // The "AutoRenderer" string survives as __name:"AutoRenderer" in the
      // compiled component object (property values are not mangled by esbuild).
    },
    logLevel: 'silent',
  });
  return outDir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tree-shaking bundle proof (real Vite/Rollup build)', () => {
  let fixtureDir = '';

  afterEach(() => {
    if (fixtureDir && existsSync(fixtureDir)) {
      rmSync(fixtureDir, { recursive: true, force: true });
      fixtureDir = '';
    }
  });

  afterAll(() => {
    // Clean up the parent fixtures dir if it exists and is now empty.
    if (existsSync(FIXTURE_PARENT)) {
      try {
        rmSync(FIXTURE_PARENT, { recursive: true, force: true });
      } catch {
        // Ignore — another test run may have cleaned up already.
      }
    }
  });

  it(
    'SHIP-02 negative case: custom-UI fixture bundle contains no AutoRenderer or AutoUI',
    { timeout: 180_000 },
    async () => {
      // Fixture with a custom UI component: App.vue imports GameTable only,
      // NOT AutoUI. Rollup tree-shaking should eliminate AutoRenderer entirely.
      const fixId = `custom-${Date.now()}`;
      fixtureDir = join(FIXTURE_PARENT, fixId);
      mkdirSync(fixtureDir, { recursive: true });

      // './components/GameTable.vue' resolves from src/ui/App.vue to
      // src/ui/components/GameTable.vue — the stub that generateScaffoldFiles creates.
      writeFixtureFiles(fixtureDir, './components/GameTable.vue');
      const distUi = await buildFixtureUi(fixtureDir);
      const bundle = readBundleJs(distUi);

      // AutoRenderer must be absent: the single static import of GameTable in App.vue
      // causes Rollup to drop the entire auto-UI module chain. We assert AutoRenderer
      // specifically because:
      //   - AutoUI.vue imports AutoRenderer, so AutoRenderer absent ↔ AutoUI absent
      //   - `__name:"AutoRenderer"` is emitted by @vue/compiler-sfc for every compiled
      //     component and is not stripped by esbuild (property values are not mangled)
      //   - Checking only for "AutoUI" as a string would be unreliable: the GameTable
      //     stub template has a comment "AutoUI handles everything until you're ready."
      //     which Vue compiles into a createTextVNode() call — that string literal
      //     survives minification and appears in the bundle even though AutoUI itself
      //     is tree-shaken out. AutoRenderer has no such false-positive risk.
      expect(bundle, 'AutoRenderer must not appear in custom-UI bundle').not.toContain('AutoRenderer');
    },
  );

  it(
    'SHIP-02 positive control: auto-UI fixture bundle contains AutoRenderer',
    { timeout: 180_000 },
    async () => {
      // Fixture with "ui":"auto": App.vue imports AutoUI which imports AutoRenderer.
      // Rollup must include AutoRenderer — this proves the negative case is a genuine
      // tree-shake drop, not a build that silently emits nothing.
      const fixId = `auto-${Date.now()}`;
      fixtureDir = join(FIXTURE_PARENT, fixId);
      mkdirSync(fixtureDir, { recursive: true });

      writeFixtureFiles(fixtureDir, undefined); // ui defaults to 'auto'
      const distUi = await buildFixtureUi(fixtureDir);
      const bundle = readBundleJs(distUi);

      // AutoRenderer must be present when AutoUI is selected: proves the negative
      // case assertion is meaningful (we would catch a leak if it occurred).
      expect(bundle, 'AutoRenderer must appear in auto-UI bundle').toContain('AutoRenderer');
    },
  );
});
