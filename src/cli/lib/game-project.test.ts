import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  requireGameProject,
  requireGameProjectManifests,
  resolveRulesDir,
  requireRulesIndex,
} from './game-project.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * Every guard in this module ends in `process.exit(1)`, which is the behaviour
 * the call sites depend on: a command that cannot find its project must not
 * carry on with an undefined config. So the exit is what these assert, not
 * merely the message.
 */
class ExitCalled extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe('game-project guards', () => {
  let projectDir: string;
  let exitSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    projectDir = tempTree('bs-game-project-');
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitCalled(code);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const errors = (): string => errorSpy.mock.calls.map((call) => String(call[0])).join('\n');

  describe('requireGameProject', () => {
    it('returns the manifest path when the project has one', () => {
      writeFileSync(join(projectDir, 'boardsmith.json'), '{"name":"x"}');
      expect(requireGameProject(projectDir)).toBe(join(projectDir, 'boardsmith.json'));
    });

    it('exits 1 and names the missing manifest', () => {
      expect(() => requireGameProject(projectDir)).toThrow(ExitCalled);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errors()).toContain('boardsmith.json not found');
      expect(errors()).toContain('BoardSmith game project directory');
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

    it('exits 1 when boardsmith.json is missing, before it ever looks for package.json', () => {
      writeFileSync(join(projectDir, 'package.json'), '{"version":"1.0.0"}');
      expect(() => requireGameProjectManifests(projectDir)).toThrow(ExitCalled);
      expect(errors()).toContain('boardsmith.json not found');
    });

    it('exits 1 when package.json is missing, and says where a version comes from', () => {
      writeFileSync(join(projectDir, 'boardsmith.json'), '{"name":"x"}');
      expect(() => requireGameProjectManifests(projectDir)).toThrow(ExitCalled);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errors()).toContain('package.json not found');
      expect(errors()).toContain('version');
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

    it('exits 1 naming the path it looked at and the export it wanted', () => {
      const rulesDir = join(projectDir, 'src', 'rules');
      expect(() => requireRulesIndex(rulesDir)).toThrow(ExitCalled);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errors()).toContain(join(rulesDir, 'index.ts'));
      expect(errors()).toContain('gameDefinition');
    });
  });
});
