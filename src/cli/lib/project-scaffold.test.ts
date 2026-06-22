import { describe, it, expect } from 'vitest';
import {
  generateAppVue,
  generateBoardsmithJson,
  generateGameTableVue,
  generateUiIndexTs,
  type ProjectConfig,
} from './project-scaffold.js';

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
});

describe('generateBoardsmithJson', () => {
  it('contains the "ui" field set to "auto"', () => {
    const parsed = JSON.parse(generateBoardsmithJson(config));
    expect(parsed.ui).toBe('auto');
  });
});

describe('generateUiIndexTs', () => {
  it('does not re-export GameTable (tree-shaking landmine)', () => {
    const out = generateUiIndexTs();
    expect(out).not.toContain('GameTable');
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
