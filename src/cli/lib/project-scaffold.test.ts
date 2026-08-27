import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  generateAppVue,
  generateUisTs,
  generateBoardsmithJson,
  generateGameTableVue,
  generateRulesIndexTs,
  generateUiIndexTs,
  generatePackageJson,
  generateScaffoldFiles,
  generateA11yExampleTestTs,
  generateTsConfig,
  generateViteConfig,
  getDependencyPaths,
  getMonorepoRoot,
  type ProjectConfig,
} from './project-scaffold.js';
import {
  generateGameTs,
  generateElementsTs,
  generateActionsTs,
  generateFlowTs,
} from '../commands/init.js';

/** Where a scaffolded project would live; the `file:` link is relative to it. */
const PROJECT_PATH = '/tmp/boardsmith-scaffold-fixture/my-game';

const config: ProjectConfig = {
  name: 'my-game',
  displayName: 'My Game',
  description: 'A test game',
  playerCount: { min: 2, max: 4 },
};

describe('generateAppVue', () => {
  it('renders the board from the UI registry, never a #game-board slot', () => {
    const out = generateAppVue(config);
    expect(out).toContain("import { GameShell } from 'boardsmith/ui'");
    expect(out).toContain("import uis from './uis.js'");
    expect(out).toContain(':uis="uis"');
    // The slot is gone on purpose: a second way to name the default UI is a
    // second thing that can disagree with src/ui/uis.ts.
    expect(out).not.toContain('#game-board');
  });

  it('does not import any board component directly — the registry owns that', () => {
    const out = generateAppVue(config);
    expect(out).not.toContain('AutoUI');
    expect(out).not.toContain('GameTable');
  });

  it('is identical whether or not a custom ui path was chosen (only uis.ts differs)', () => {
    // App.vue is now board-agnostic. Which board ships is decided in uis.ts,
    // so the scaffold no longer forks App.vue on the init-time answer.
    expect(generateAppVue({ ...config, ui: './ui/components/GameTable.vue' })).toBe(
      generateAppVue(config),
    );
  });

  it('has no split-screen markup', () => {
    const out = generateAppVue(config);
    expect(out).not.toContain('board-comparison');
    expect(out).not.toContain('board-section');
    expect(out).not.toContain('Auto-Generated UI');
  });
});

describe('generateUisTs — the single source of truth for a game\'s UIs', () => {
  it('auto default: auto-UI ships, the custom stub is dev-only', () => {
    const out = generateUisTs(config);
    expect(out).toContain("import { defineGameUIs, defaultUI, devUI } from 'boardsmith/ui'");
    expect(out).toContain('Auto: defaultUI(AutoUI)');
    expect(out).toContain("import AutoUI from 'boardsmith/ui/auto-ui'");
    expect(out).toContain("Custom: devUI(() => import('./components/GameTable.vue'))");
  });

  it('custom ui path: the custom board ships and auto-UI drops to dev-only', () => {
    const out = generateUisTs({ ...config, ui: './ui/components/GameTable.vue' });
    expect(out).toContain('GameTable: defaultUI(GameTable)');
    expect(out).toContain("import GameTable from './ui/components/GameTable.vue'");
    expect(out).toContain("Auto: devUI(() => import('boardsmith/ui/auto-ui'))");
  });

  // AutoUI must come from the `boardsmith/ui/auto-ui` subpath, never the main
  // barrel: re-exporting it from `boardsmith/ui` puts AutoUI.vue in EVERY game's
  // module graph, and an SFC `<style>` is a side-effectful CSS import that
  // survives JS tree-shaking — which shipped the auto-UI stylesheet to every
  // custom-UI game (SHIP-02).
  it('reaches AutoUI through the auto-ui subpath, never the main barrel', () => {
    for (const out of [generateUisTs(config), generateUisTs({ ...config, ui: './x/Y.vue' })]) {
      expect(out).toContain("'boardsmith/ui/auto-ui'");
      expect(out).not.toMatch(/AutoUI[^']*from 'boardsmith\/ui'/);
    }
  });

  it('marks exactly one UI as defaultUI in every generated variant', () => {
    for (const out of [generateUisTs(config), generateUisTs({ ...config, ui: './x/Y.vue' })]) {
      // Match the call site, not the prose in the file's doc comment. The
      // shipped board is passed as a component (eager), never as a loader.
      expect(out.match(/defaultUI\([A-Za-z]/g)).toHaveLength(1);
      expect(out).not.toMatch(/defaultUI\(\(\) =>/);
    }
  });
});

describe('generateBoardsmithJson', () => {
  // The manifest no longer describes UIs at all — src/ui/uis.ts does. The old
  // `"ui"` key was scaffold-emitted but read by nothing after init, so it rotted.
  it('emits no "ui" key (UIs are declared in src/ui/uis.ts)', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed).not.toHaveProperty('ui');
  });

  it('does not emit a playerCount key (PROC-02 regression: gameDefinition is the sole source of player count)', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed).not.toHaveProperty('playerCount');
  });

  it('does not emit a dead $schema URL', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed).not.toHaveProperty('$schema');
  });

  it('emits the taxonomy fields (audience/tags/playtime/cooperative), not the removed categories/estimatedDuration', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed.audience).toBe('casual');
    expect(parsed.tags).toEqual([]);
    expect(parsed.playtime).toEqual({ min: 15, max: 30 });
    expect(parsed.cooperative).toBe(false);
    expect(parsed).not.toHaveProperty('categories');
    expect(parsed).not.toHaveProperty('estimatedDuration');
  });

  // Issue 142: the scaffold used to emit `thumbnail: './public/thumbnail.png'`
  // for a file it never created, and `deriveManifest` stamped that dangling
  // path into every dist/manifest.json.
  it('emits no thumbnail key — the scaffold creates no thumbnail image', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed).not.toHaveProperty('thumbnail');
  });

  it('threads a caller-supplied audience and tags through', () => {
    const parsed = JSON.parse(generateBoardsmithJson({ ...config, audience: 'strategy', tags: ['abstract'] }));
    expect(parsed.audience).toBe('strategy');
    expect(parsed.tags).toEqual(['abstract']);
  });
});

describe('getDependencyPaths — local-dev boardsmith link (issue 142)', () => {
  // This suite runs FROM the monorepo, so the local-dev branch is the one under test.
  const monorepoRoot = getMonorepoRoot();

  it('emits a path relative to the project, never one carrying a home directory', () => {
    expect(monorepoRoot).not.toBeNull();
    const projectPath = join(monorepoRoot as string, '..', 'BoardSmithGames', 'my-game');
    const deps = getDependencyPaths(projectPath);

    expect(deps.isLocalDev).toBe(true);
    const linked = deps.boardsmith.replace(/^file:/, '');
    expect(isAbsolute(linked)).toBe(false);
    expect(deps.boardsmith).toBe('file:../../BoardSmith');
  });

  it('resolves from the project directory back to the monorepo root', () => {
    const projectPath = join(monorepoRoot as string, '..', 'elsewhere', 'nested', 'game');
    const deps = getDependencyPaths(projectPath);
    const linked = deps.boardsmith.replace(/^file:/, '');
    expect(resolve(projectPath, linked)).toBe(resolve(monorepoRoot as string));
  });

  it('puts the same relative path into the scaffolded package.json', () => {
    const projectPath = join(monorepoRoot as string, '..', 'BoardSmithGames', 'my-game');
    const pkg = JSON.parse(generatePackageJson(config, projectPath));
    expect(pkg.dependencies.boardsmith).toBe('file:../../BoardSmith');
  });
});

describe('generateRulesIndexTs', () => {
  it('still authors minPlayers/maxPlayers from config.playerCount (the sole legitimate write site)', () => {
    const out = generateRulesIndexTs(config);
    expect(out).toContain(`minPlayers: ${config.playerCount.min}`);
    expect(out).toContain(`maxPlayers: ${config.playerCount.max}`);
  });

  it('re-exports the Player class from game.js, where it is defined (CR-01 regression)', () => {
    const out = generateRulesIndexTs(config);
    // MyGamePlayer is defined in game.ts (init.ts generateGameTs), not elements.ts —
    // re-exporting it from './elements.js' makes every fresh project fail tsc/build.
    expect(out).toMatch(/export \{[^}]*MyGamePlayer[^}]*\} from '\.\/game\.js'/);
    expect(out).not.toMatch(/export \{[^}]*MyGamePlayer[^}]*\} from '\.\/elements\.js'/);
  });

  it('the full generated rules module set type-checks cleanly against the real engine (CR-01 regression)', () => {
    // Write the exact rules files `boardsmith init` generates and run the same
    // gate `boardsmith validate` runs (tsc). This is the check that catches an
    // unresolved re-export like `export { MyGamePlayer } from './elements.js'`
    // (TS2305) — esbuild silently tolerates missing named re-exports on .ts
    // files (it cannot know they aren't type-only), which is exactly how
    // `boardsmith dev` masked the broken scaffold.
    const dir = mkdtempSync(join(tmpdir(), 'bs-scaffold-compile-'));
    try {
      const rulesDir = join(dir, 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'index.ts'), generateRulesIndexTs(config));
      writeFileSync(join(rulesDir, 'game.ts'), generateGameTs('MyGame'));
      writeFileSync(join(rulesDir, 'elements.ts'), generateElementsTs());
      writeFileSync(join(rulesDir, 'actions.ts'), generateActionsTs('MyGame'));
      writeFileSync(join(rulesDir, 'flow.ts'), generateFlowTs('MyGame'));

      // 'boardsmith' resolves to the same entry the package.json "." export
      // points at (src/engine/index.ts), matching a real scaffolded project.
      const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
      const program = ts.createProgram([join(rulesDir, 'index.ts')], {
        // Mirrors the scaffold's generateTsConfig() compiler options.
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        baseUrl: dir,
        paths: { boardsmith: [join(repoRoot, 'src', 'engine', 'index.ts')] },
      });
      const diagnostics = ts.getPreEmitDiagnostics(program)
        .filter((d) => d.file && d.file.fileName.startsWith(dir))
        .map((d) => `${d.file!.fileName.replace(dir, '')} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
      expect(diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generateTsConfig — vite/client types (Phase 149 dry-run Defect 1)', () => {
  // A freshly-scaffolded, unmodified project failed `tsc --noEmit` out of the
  // box: `src/ui/index.ts` re-exports a type from `boardsmith/ui`, and
  // `GameTable.vue` imports `UseActionControllerReturn` from `boardsmith/ui`
  // directly. In local-monorepo dev mode `boardsmith`'s `./ui` export
  // resolves to raw source, so tsc fully type-checks that module graph —
  // reaching `useActionController.ts`'s `import.meta.env.DEV`, which is
  // unresolvable without the `vite/client` ambient types. These tests pin the
  // fix so it can't silently regress.
  it('includes "vite/client" in compilerOptions.types', () => {
    const parsed = JSON.parse(generateTsConfig());
    expect(parsed.compilerOptions.types).toContain('vite/client');
  });

  it('the UI type-graph compiles clean ONLY when vite/client types are present (WR-02: Defect 1 is load-bearing)', () => {
    // The string assertion above proves the config CONTAINS 'vite/client'; it
    // does not prove that removing it re-breaks a fresh scaffold. This test
    // reproduces the actual failing graph: a UI entry that re-exports a type
    // from `boardsmith/ui`, which reaches `useActionController.ts`'s
    // `import.meta.env.DEV` (a Vite-ambient global). We compile that graph
    // twice — without and with `types: ['vite/client']` — and assert the
    // ImportMeta.env error appears without it and vanishes with it. Dropping
    // 'vite/client' from generateTsConfig() therefore turns this test RED.
    const dir = mkdtempSync(join(tmpdir(), 'bs-scaffold-ui-compile-'));
    try {
      const uiDir = join(dir, 'ui');
      mkdirSync(uiDir, { recursive: true });
      // Same re-export the scaffold's src/ui/index.ts carries (minus the .vue
      // value import, which is irrelevant to the ImportMeta.env resolution).
      writeFileSync(
        join(uiDir, 'index.ts'),
        "export type { UseActionControllerReturn } from 'boardsmith/ui';\n",
      );

      const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
      const uiEntry = join(repoRoot, 'src', 'ui', 'index.ts');

      const importMetaEnvErrors = (types: string[]): string[] => {
        const program = ts.createProgram([join(uiDir, 'index.ts')], {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
          types,
          baseUrl: dir,
          paths: { 'boardsmith/ui': [uiEntry] },
        });
        return ts
          .getPreEmitDiagnostics(program)
          // TS2339 "Property 'env' does not exist on type 'ImportMeta'" — the
          // exact diagnostic a fresh scaffold hit before the fix.
          .filter((d) => d.code === 2339)
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
          .filter((m) => m.includes('env'));
      };

      // Without vite/client: the original bug reproduces.
      expect(importMetaEnvErrors([]).length).toBeGreaterThan(0);
      // With vite/client: the ImportMeta.env access resolves cleanly.
      expect(importMetaEnvErrors(['vite/client'])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('generatePackageJson — explicit vite devDependency (Phase 149 dry-run Defect 1)', () => {
  it('includes vite explicitly (not relying on @vitejs/plugin-vue hoisting) so "vite/client" types always resolve', () => {
    const parsed = JSON.parse(generatePackageJson(config, PROJECT_PATH));
    expect(parsed.devDependencies).toHaveProperty('vite');
  });
});

describe('generateUiIndexTs', () => {
  it('does not re-export GameTable (tree-shaking landmine)', () => {
    const out = generateUiIndexTs();
    expect(out).not.toContain('GameTable');
  });
});

describe('generatePackageJson — axe-core scaffold devDependency', () => {
  it('includes axe-core in devDependencies', () => {
    const parsed = JSON.parse(generatePackageJson(config, PROJECT_PATH));
    expect(parsed.devDependencies).toHaveProperty('axe-core');
  });

  it('includes @vue/test-utils in devDependencies (needed to mount components for the a11y example)', () => {
    const parsed = JSON.parse(generatePackageJson(config, PROJECT_PATH));
    expect(parsed.devDependencies).toHaveProperty('@vue/test-utils');
  });

  it('includes jsdom in devDependencies (CR-02 regression: the a11y example runs in `@vitest-environment jsdom`, which vitest v2 does not bundle)', () => {
    const parsed = JSON.parse(generatePackageJson(config, PROJECT_PATH));
    // Without jsdom installed, `boardsmith test` in a fresh scaffold is red out of the
    // box: requesting the jsdom environment fails with `Cannot find package 'jsdom'`.
    expect(parsed.devDependencies).toHaveProperty('jsdom');
  });
});

describe('generateScaffoldFiles — a11y example test harness', () => {
  it('includes tests/a11y.example.test.ts', () => {
    const files = generateScaffoldFiles(config, PROJECT_PATH);
    expect(files.some((f) => f.path === 'tests/a11y.example.test.ts')).toBe(true);
  });

  it('the a11y example harness imports axe-core and calls axe.run(', () => {
    const files = generateScaffoldFiles(config, PROJECT_PATH);
    const entry = files.find((f) => f.path === 'tests/a11y.example.test.ts');
    expect(entry).toBeDefined();
    expect(entry!.content).toContain("from 'axe-core'");
    expect(entry!.content).toContain('axe.run(');
  });

  it('generateA11yExampleTestTs output matches the generateScaffoldFiles entry', () => {
    expect(generateA11yExampleTestTs()).toContain('axe.run(');
  });

  it('mounts with attachTo: document.body so axe.run scans an attached node (CR-01 regression)', () => {
    // axe.run() throws "No elements found for include in page Context" on a
    // DETACHED node — @vue/test-utils `mount` without `attachTo` renders detached.
    // The executable proof that attachTo is what makes the node attached lives in
    // project-scaffold.a11y.test.ts; this pins the generated string carries it.
    const out = generateA11yExampleTestTs();
    expect(out).toContain('attachTo: document.body');
  });

  it('detaches the mounted node after the scan so it does not leak into the next test (CR-01 regression)', () => {
    const out = generateA11yExampleTestTs();
    expect(out).toContain('wrapper.unmount()');
    // The unmount must be unconditional (a `finally`), not skipped when axe throws.
    expect(out).toMatch(/finally\s*\{[^}]*wrapper\.unmount\(\)/s);
  });

  it('runs in the jsdom vitest environment the a11y scan requires', () => {
    const out = generateA11yExampleTestTs();
    expect(out).toContain('// @vitest-environment jsdom');
  });
});

describe('generateGameTableVue', () => {
  it('has no placeholder warning text', () => {
    const out = generateGameTableVue();
    expect(out).not.toContain('placeholder UI');
    expect(out).not.toContain('placeholder-notice');
    expect(out).not.toContain('⚠️');
  });

  it('has "start here" guidance for custom UI authors', () => {
    const out = generateGameTableVue();
    expect(out.toLowerCase()).toContain('start here');
  });
});

describe('generateScaffoldFiles — AssetImage comes from boardsmith/ui (issue #81)', () => {
  it('stamps no per-project AssetImage.vue', () => {
    const files = generateScaffoldFiles(config, PROJECT_PATH);
    // A scaffold-stamped copy is a copy that drifts. The load/error state machine
    // lives in the library exactly once, as `AssetImage` on the boardsmith/ui barrel.
    expect(files.find((f) => f.path === 'src/ui/components/AssetImage.vue')).toBeUndefined();
  });
});

describe('single-vue guarantee — the symlinked-boardsmith duplicate-vue trap', () => {
  // `boardsmith` installs as a SYMLINK to a checkout carrying its own `vue`
  // devDependency, so one compilation can end up with TWO vue type packages:
  // the game's files resolve `vue` to `<game>/node_modules/vue`, while
  // BoardSmith's source (reached through the `boardsmith/ui` export) resolves it
  // to `<boardsmith>/node_modules/vue`. Nominally distinct `Ref` /
  // `DefineComponent` types then meet at any API boundary — passing a template
  // ref into a BoardSmith composable fails on `[RefSymbol]`, and `createApp(App)`
  // failed with TS2321 + TS2345.
  //
  // The alias below names a LOCATION, never a version, so it does not constrain
  // which vue a game installs — it is what makes upgrading vue freely SAFE.
  // Verified against vue 3.5.40 while BoardSmith sat on 3.5.26.
  //
  // The trap hid for a long time because it only bites once the two versions
  // drift far enough apart to stop being structurally identical — a game that
  // installed a vue close to BoardSmith's passed by luck.

  it('aliases vue AND @vue/* to the project\'s own copies', () => {
    const parsed = JSON.parse(generateTsConfig());
    // `@vue/*` matters as much as `vue`: `Ref` comes from @vue/reactivity, so
    // aliasing only `vue` still left composable boundaries mismatched.
    expect(parsed.compilerOptions.paths).toEqual({
      vue: ['./node_modules/vue'],
      '@vue/*': ['./node_modules/@vue/*'],
    });
  });

  it('dedupes vue in the vite config, so the RUNTIME graph gets one Vue too', () => {
    // Types are only half of it: two Vue runtimes mean two reactivity systems
    // and two provide/inject registries, silently breaking state shared across
    // the game/library boundary.
    expect(generateViteConfig()).toContain("dedupe: ['vue']");
  });

  it('the alias actually collapses two vue copies onto one (it is load-bearing)', () => {
    // The assertion above proves the config CONTAINS the pin; it does not prove
    // the pin changes resolution. This reproduces the real layout — a game copy
    // and a symlinked-library copy of vue — and resolves `vue` from BOTH sides
    // with and without the pin. Dropping `paths` from generateTsConfig()
    // therefore turns this test RED.
    const dir = mkdtempSync(join(tmpdir(), 'bs-scaffold-vue-pin-'));
    try {
      const game = join(dir, 'game');
      const library = join(dir, 'library');

      // Two distinct vue packages, exactly as npm lays them out.
      for (const [root, version] of [[game, '3.5.40'], [library, '3.5.26']] as const) {
        const vueDir = join(root, 'node_modules', 'vue');
        mkdirSync(vueDir, { recursive: true });
        writeFileSync(
          join(vueDir, 'package.json'),
          JSON.stringify({ name: 'vue', version, types: './index.d.ts' }),
        );
        writeFileSync(join(vueDir, 'index.d.ts'), 'export declare const createApp: unknown;\n');
      }

      // The game's own entry, and a library source file standing in for
      // BoardSmith's `src/ui/*` reached through the symlinked export.
      writeFileSync(join(game, 'main.ts'), "import 'vue';\n");
      mkdirSync(join(library, 'src'), { recursive: true });
      writeFileSync(join(library, 'src', 'ui.ts'), "import 'vue';\n");

      const resolveVueFrom = (importer: string, paths?: ts.MapLike<string[]>) =>
        ts.resolveModuleName(
          'vue',
          importer,
          { moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: game, paths },
          ts.sys,
        ).resolvedModule?.resolvedFileName;

      const withoutPin = [
        resolveVueFrom(join(game, 'main.ts')),
        resolveVueFrom(join(library, 'src', 'ui.ts')),
      ];
      // The bug: the two sides land on two different vue packages.
      expect(withoutPin[0]).toBeDefined();
      expect(withoutPin[1]).toBeDefined();
      expect(withoutPin[0]).not.toBe(withoutPin[1]);

      // Read the pin from the GENERATOR, not a literal — otherwise this test
      // would keep passing after `paths` was dropped from generateTsConfig().
      const pin = JSON.parse(generateTsConfig()).compilerOptions.paths;
      const withPin = [
        resolveVueFrom(join(game, 'main.ts'), pin),
        resolveVueFrom(join(library, 'src', 'ui.ts'), pin),
      ];
      // The fix: both sides land on the GAME's copy, so there is one vue.
      expect(withPin[0]).toBe(withPin[1]);
      expect(withPin[0]).toContain(join('game', 'node_modules', 'vue'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('no ambient *.vue shim (SFCs are type-checked by vue-tsc)', () => {
  // BoardSmith's `src/ui/global.d.ts` is ambient AND `boardsmith/ui` resolves to
  // raw TypeScript source, so anything declared there leaks into the compilation
  // of every game. A `declare module '*.vue'` shim therefore:
  //
  //   1. typed every SFC everywhere as `DefineComponent<object, object, unknown>`,
  //      erasing prop checking (bogus props compiled clean);
  //   2. bound each game's SFC types to BOARDSMITH's vue, so a game whose own vue
  //      had drifted failed with TS2321 + TS2345;
  //   3. matched ANY `*.vue` specifier — including files that do not exist, which
  //      is how a game shipped a broken `export ... from './GameBoard.vue'`;
  //   4. hid real type errors in BoardSmith's own components.
  //
  // Re-adding it would silently undo all four. `boardsmith validate` runs
  // vue-tsc, which needs no shim.
  const globalDts = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui', 'global.d.ts'),
    'utf-8',
  );
  // Strip `//` comments: the file DOCUMENTS the removed shim by name, and that
  // prose must not read as the declaration itself.
  const globalDtsCode = globalDts.replace(/^\s*\/\/.*$/gm, '');

  it('global.d.ts declares no *.vue module', () => {
    expect(globalDtsCode).not.toMatch(/declare\s+module\s+['"]\*\.vue['"]/);
  });

  it('still declares the non-Vue ambients it legitimately owns', () => {
    // Guards against "fixing" the rule above by deleting the whole file.
    expect(globalDtsCode).toMatch(/declare\s+module\s+['"]\*\.mp3['"]/);
    expect(globalDts).toContain('__BOARDSMITH_DEVTOOLS');
  });

  it('scaffolds vue-tsc, which is what replaces the shim', () => {
    const pkg = JSON.parse(
      generatePackageJson({ name: 'x', displayName: 'X', description: 'x' } as ProjectConfig, PROJECT_PATH),
    );
    expect(pkg.devDependencies).toHaveProperty('vue-tsc');
  });
});
