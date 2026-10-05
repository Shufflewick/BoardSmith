import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  requireGameProject,
  requireGameProjectManifests,
  resolveRulesDir,
  requireRulesIndex,
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

    it('throws naming the missing manifest', () => {
      expect(() => requireGameProject(projectDir)).toThrow(/boardsmith\.json not found[\s\S]*BoardSmith game project directory/);
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
      expect(() => requireGameProjectManifests(projectDir)).toThrow(/boardsmith\.json not found/);
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
});
