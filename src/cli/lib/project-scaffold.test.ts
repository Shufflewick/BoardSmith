import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  generateAppVue,
  generateBoardsmithJson,
  generateGameTableVue,
  generateRulesIndexTs,
  generateUiIndexTs,
  generatePackageJson,
  generateScaffoldFiles,
  generateA11yExampleTestTs,
  type ProjectConfig,
} from './project-scaffold.js';
import {
  generateGameTs,
  generateElementsTs,
  generateActionsTs,
  generateFlowTs,
} from '../commands/init.js';

const config: ProjectConfig = {
  name: 'my-game',
  displayName: 'My Game',
  description: 'A test game',
  playerCount: { min: 2, max: 4 },
};

describe('generateAppVue (ui: auto)', () => {
  it('imports only AutoUI — no GameTable import', () => {
    const out = generateAppVue(config);
    expect(out).toContain("import { GameShell, AutoUI } from 'boardsmith/ui'");
    expect(out).not.toContain('GameTable');
  });

  it('has no split-screen markup', () => {
    const out = generateAppVue(config);
    expect(out).not.toContain('board-comparison');
    expect(out).not.toContain('board-section');
    expect(out).not.toContain('Auto-Generated UI');
    expect(out).not.toContain('Custom UI');
  });

  it('renders AutoUI inside GameShell game-board slot', () => {
    const out = generateAppVue(config);
    expect(out).toContain('#game-board');
    expect(out).toContain('<AutoUI');
  });
});

describe('generateAppVue (ui: custom path)', () => {
  it('imports the custom component — no AutoUI import', () => {
    const out = generateAppVue({ ...config, ui: './ui/components/GameTable.vue' });
    expect(out).toContain("import GameTable from './ui/components/GameTable.vue'");
    expect(out).not.toContain('AutoUI');
  });

  it('has no split-screen markup with custom ui', () => {
    const out = generateAppVue({ ...config, ui: './ui/components/GameTable.vue' });
    expect(out).not.toContain('board-comparison');
    expect(out).not.toContain('board-section');
    expect(out).not.toContain('Auto-Generated UI');
  });

  it('falls back to GameUI for a path with no filename segment (no empty import)', () => {
    // A path ending in "/" yields an empty filename segment; the generator must
    // not emit `import  from '...'`. (boardsmith validate rejects this up front.)
    const out = generateAppVue({ ...config, ui: './ui/components/' });
    expect(out).not.toMatch(/import\s+from/);
    expect(out).not.toContain('<  ');
    expect(out).toContain("import GameUI from './ui/components/'");
  });
});

describe('generateBoardsmithJson', () => {
  it('contains the "ui" field set to "auto"', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed.ui).toBe('auto');
  });

  it('does not emit a playerCount key (PROC-02 regression: gameDefinition is the sole source of player count)', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed).not.toHaveProperty('playerCount');
  });

  it('does not emit a dead $schema URL', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed).not.toHaveProperty('$schema');
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

describe('generateUiIndexTs', () => {
  it('does not re-export GameTable (tree-shaking landmine)', () => {
    const out = generateUiIndexTs();
    expect(out).not.toContain('GameTable');
  });
});

describe('generatePackageJson — axe-core scaffold devDependency', () => {
  it('includes axe-core in devDependencies', () => {
    const parsed = JSON.parse(generatePackageJson(config));
    expect(parsed.devDependencies).toHaveProperty('axe-core');
  });

  it('includes @vue/test-utils in devDependencies (needed to mount components for the a11y example)', () => {
    const parsed = JSON.parse(generatePackageJson(config));
    expect(parsed.devDependencies).toHaveProperty('@vue/test-utils');
  });
});

describe('generateScaffoldFiles — a11y example test harness', () => {
  it('includes tests/a11y.example.test.ts', () => {
    const files = generateScaffoldFiles(config);
    expect(files.some((f) => f.path === 'tests/a11y.example.test.ts')).toBe(true);
  });

  it('the a11y example harness imports axe-core and calls axe.run(', () => {
    const files = generateScaffoldFiles(config);
    const entry = files.find((f) => f.path === 'tests/a11y.example.test.ts');
    expect(entry).toBeDefined();
    expect(entry!.content).toContain("from 'axe-core'");
    expect(entry!.content).toContain('axe.run(');
  });

  it('generateA11yExampleTestTs output matches the generateScaffoldFiles entry', () => {
    expect(generateA11yExampleTestTs()).toContain('axe.run(');
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
