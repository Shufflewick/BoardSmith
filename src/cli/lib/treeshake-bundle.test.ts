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
  return readBundleFiles(dir, '.js');
}

/**
 * Same, for emitted CSS.
 *
 * Asserting on JS alone is NOT sufficient and this is the bug that motivated it:
 * a Vue SFC's `<style>` block compiles to a side-effectful CSS import, which
 * Rollup preserves even when it eliminates every byte of the component's
 * JavaScript. A component can be fully tree-shaken from the JS bundle and still
 * ship its entire stylesheet. SHIP-02 is only met when BOTH are absent.
 */
function readBundleCss(dir: string): string {
  return readBundleFiles(dir, '.css');
}

function readBundleFiles(dir: string, ext: string): string {
  let content = '';
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
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
  // This build runs inside vitest, whose ambient NODE_ENV=test drives Vite's
  // `isProduction` (and thus `import.meta.env.DEV`) regardless of the `mode`
  // option below. Pin NODE_ENV=production for the duration of the build so it
  // faithfully matches `boardsmith build` (dev-only branches fold away). Restore
  // afterward so the rest of the test run is unaffected.
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
  await viteBuild({
    // Skip reading the fixture's vite.config.ts — its @vitejs/plugin-vue dep is
    // not installed in the fixture directory.
    configFile: false,
    // Match real `boardsmith build`: a production build so `import.meta.env.DEV`
    // is statically `false` and Vue compiles in production mode. Without this,
    // dev-only branches gated on `import.meta.env.DEV` (e.g. GameShell's auto-UI
    // peek) stay live and the dead-code import is not tree-shaken — a false
    // positive that does not reflect what `boardsmith build` ships.
    //
    // `process.env.NODE_ENV` is pinned because this build runs INSIDE vitest,
    // whose ambient `NODE_ENV=test` would otherwise leak in and force Vue's dev
    // build (and keep the dev-only peek live). Pinning it makes the build
    // faithfully production — matching what a real `boardsmith build` produces.
    mode: 'production',
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    root: fixtureDir,
    base: './',
    plugins: [vue()],
    resolve: {
      alias: [
        // Map boardsmith/ui to the real source — equivalent to having the package
        // installed in node_modules. Tree-shaking is unaffected.
        //
        // The auto-ui subpath is a SEPARATE entry, mirroring the `exports` map in
        // package.json. AutoUI deliberately does not live on the `boardsmith/ui`
        // barrel: pulling it through the barrel put AutoUI.vue in every game's
        // module graph, and its side-effectful `<style>` import shipped the auto-UI
        // stylesheet even where the JS was tree-shaken (SHIP-02). Both aliases are
        // `$`-anchored, so the subpath never falls through to the barrel.
        {
          find: /^boardsmith\/ui\/auto-ui$/,
          replacement: join(BOARDSMITH_ROOT, 'src/ui/components/auto-ui/index.ts'),
        },
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
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
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

      // ...and neither may its CSS. The JS assertion above passed for months while
      // the auto-UI stylesheet shipped in every custom-UI game, because
      // `boardsmith/ui` re-exported AutoUI from its barrel: the JS was shaken out,
      // the side-effectful `<style>` import was not. These scoped class names come
      // from AutoUI.vue and AutoRenderer.vue and can only appear if one of those
      // SFCs entered the module graph.
      const css = readBundleCss(distUi);
      expect(css, 'AutoUI scoped styles must not appear in custom-UI bundle').not.toMatch(/\.auto-ui[\s{[]/);
      expect(css, 'AutoRenderer scoped styles must not appear in custom-UI bundle').not.toContain('.auto-renderer');
    },
  );

  it(
    'SHIP-02 registry: a devUI() alternate is absent from the bundle in JS, CSS, and chunks',
    { timeout: 180_000 },
    async () => {
      // The guarantee that matters now: a game can keep an old board around for
      // comparison in `boardsmith dev` and pay NOTHING for it in production.
      // Elimination must be total — not "the JS got shaken but the stylesheet
      // shipped", which is exactly how the auto-UI leak survived a green suite.
      const fixId = `registry-${Date.now()}`;
      fixtureDir = join(FIXTURE_PARENT, fixId);
      mkdirSync(fixtureDir, { recursive: true });
      writeFixtureFiles(fixtureDir, './components/GameTable.vue');

      // A second board with a scoped style whose class name cannot collide.
      writeFileSync(
        join(fixtureDir, 'src/ui/components/RetiredBoard.vue'),
        `<template><div class="retired-board-marker">retired</div></template>
<style scoped>.retired-board-marker { color: #123456; }</style>
`,
        'utf-8',
      );
      writeFileSync(
        join(fixtureDir, 'src/ui/uis.ts'),
        `import { defineGameUIs, defaultUI, devUI } from 'boardsmith/ui';

export default defineGameUIs({
  GameTable: defaultUI(() => import('./components/GameTable.vue')),
  Retired: devUI(() => import('./components/RetiredBoard.vue')),
});
`,
        'utf-8',
      );

      const distUi = await buildFixtureUi(fixtureDir);
      const bundle = readBundleJs(distUi);
      const css = readBundleCss(distUi);

      expect(bundle, 'devUI component JS must not ship').not.toContain('RetiredBoard');
      expect(css, 'devUI component CSS must not ship').not.toContain('retired-board-marker');
      // A lazily-imported dead branch must not emit a chunk either — a chunk no
      // player ever loads is still bytes in the published package.
      const chunkNames = readdirSync(distUi, { recursive: true } as never) as unknown as string[];
      expect(
        chunkNames.filter((f) => String(f).includes('RetiredBoard')),
        'devUI component must not emit a code-split chunk',
      ).toEqual([]);

      // Positive control: the default board DID make it in, so absence above is
      // a real drop and not an empty build.
      expect(bundle, 'the defaultUI board must ship').toContain('GameTable');
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

      // Positive control for the CSS assertion too — proves the negative case is a
      // genuine drop and not a build that emits no CSS at all.
      const css = readBundleCss(distUi);
      expect(css, 'AutoRenderer styles must appear in auto-UI bundle').toContain('.auto-renderer');
    },
  );
});
