import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  requireGameProject,
  requireGameProjectManifests,
  resolveRulesDir,
  requireRulesIndex,
  requireTableUi,
  tableUiState,
} from './game-project.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * Every guard in this module throws a readable error rather than ending the process (#532), so a
 * command can run inside another one (`boardsmith verify` runs `validate` and `build`) and still
 * stop there. The CLI entry turns the throw into its message and a non-zero exit.
 */
describe('game-project guards', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = tempTree('bs-game-project-');
  });

  describe('requireGameProject', () => {
    it('returns the manifest path when the project has one', () => {
      writeFileSync(join(projectDir, 'boardsmith.json'), '{"name":"x"}');
      expect(requireGameProject(projectDir)).toBe(join(projectDir, 'boardsmith.json'));
    });

    it('throws naming the directory and the missing manifest (#733)', () => {
      expect(() => requireGameProject(projectDir)).toThrow(
        `${projectDir} has no boardsmith.json, so it is not a BoardSmith game project. Run this in the game's directory.`,
      );
    });
  });

  describe('requireGameProjectManifests', () => {
    it('parses both manifests', () => {
      writeFileSync(join(projectDir, 'boardsmith.json'), '{"name":"x","displayName":"X"}');
      writeFileSync(join(projectDir, 'package.json'), '{"name":"x","version":"1.2.3"}');

      const { configPath, config, pkg } = requireGameProjectManifests(projectDir);

      expect(configPath).toBe(join(projectDir, 'boardsmith.json'));
      expect(config.displayName).toBe('X');
      expect(pkg.version).toBe('1.2.3');
    });

    it('throws when boardsmith.json is missing, before it ever looks for package.json', () => {
      writeFileSync(join(projectDir, 'package.json'), '{"version":"1.0.0"}');
      expect(() => requireGameProjectManifests(projectDir)).toThrow(/has no boardsmith\.json/);
    });

    it('throws when package.json is missing, and says where a version comes from', () => {
      writeFileSync(join(projectDir, 'boardsmith.json'), '{"name":"x"}');
      expect(() => requireGameProjectManifests(projectDir)).toThrow(/package\.json not found[\s\S]*version/);
    });
  });

  describe('resolveRulesDir', () => {
    it('defaults to src/rules', () => {
      expect(resolveRulesDir(projectDir, {})).toBe(join(projectDir, 'src', 'rules'));
    });

    it('resolves a declared paths.rules against the project directory', () => {
      expect(resolveRulesDir(projectDir, { paths: { rules: 'rules' } })).toBe(
        join(projectDir, 'rules'),
      );
    });
  });

  describe('requireRulesIndex', () => {
    it('returns the index path when the rules exist', () => {
      const rulesDir = join(projectDir, 'src', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'index.ts'), 'export const gameDefinition = {};');

      expect(requireRulesIndex(rulesDir)).toBe(join(rulesDir, 'index.ts'));
    });

    it('throws naming the path it looked at, the export it wanted and paths.rules', () => {
      const rulesDir = join(projectDir, 'custom', 'rules');
      expect(() => requireRulesIndex(rulesDir)).toThrow(join(rulesDir, 'index.ts'));
      expect(() => requireRulesIndex(rulesDir)).toThrow(/gameDefinition[\s\S]*"paths\.rules"/);
    });
  });

  describe('tableUiState and requireTableUi (#556)', () => {
    const touch = (path: string) => {
      mkdirSync(join(projectDir, path, '..'), { recursive: true });
      writeFileSync(join(projectDir, path), '');
    };

    it('a table with none of the UI files has no UI yet, and is told to run add-ui', () => {
      expect(tableUiState(projectDir)).toEqual({ state: 'none' });
      expect(() => requireTableUi(projectDir, {})).toThrow('This project has no UI yet. Run `boardsmith add-ui`.');
    });

    it('a table with index.html has a UI', () => {
      touch('index.html');
      touch('src/ui/App.vue');
      expect(tableUiState(projectDir)).toEqual({ state: 'present', files: ['index.html', 'src/ui/App.vue'] });
      expect(() => requireTableUi(projectDir, {})).not.toThrow();
    });

    it('a table missing index.html but keeping other UI files is broken, and is told to restore it', () => {
      touch('src/ui/App.vue');
      touch('tests/browser/smoke.spec.ts');
      expect(tableUiState(projectDir)).toEqual({ state: 'broken', files: ['src/ui/App.vue', 'tests/browser/smoke.spec.ts'] });
      expect(() => requireTableUi(projectDir, {})).toThrow(
        'index.html is missing, but this project has UI files (src/ui/App.vue, tests/browser/smoke.spec.ts); ' +
          'restore index.html, or remove them and run `boardsmith add-ui`.',
      );
    });

    it('a world always has its UI, whatever table files it holds', () => {
      touch('src/ui/uis.ts');
      expect(() => requireTableUi(projectDir, { backend: 'world' })).not.toThrow();
    });
  });
});
