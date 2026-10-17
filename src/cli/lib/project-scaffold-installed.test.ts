import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi } from 'vitest';
import { generatePackageJson, boardsmithDependencySpec, type ProjectConfig } from './project-scaffold.js';

// An installed copy of BoardSmith: a package root with no checkout around it (#849).
const INSTALLED_ROOT = join(tmpdir(), 'bs849', 'lib', 'node_modules', 'boardsmith');

vi.mock('./boardsmith-version.js', () => ({ boardsmithPackageRoot: () => INSTALLED_ROOT }));

const config: ProjectConfig = {
  name: 'my-game',
  displayName: 'My Game',
  description: 'A game',
  backend: 'table',
  playerCount: { min: 2, max: 4 },
};

describe('boardsmithDependencySpec from an installed copy (#849)', () => {
  const projectPath = join(tmpdir(), 'bs849', 'games', 'my-game');

  it('links to the BoardSmith install that ran init', () => {
    const spec = boardsmithDependencySpec(projectPath);
    expect(spec).toBe('file:../../lib/node_modules/boardsmith');
    expect(resolve(projectPath, spec.replace(/^file:/, ''))).toBe(INSTALLED_ROOT);
  });

  it('never writes a registry spec into package.json', () => {
    const pkg = JSON.parse(generatePackageJson(config, projectPath));
    expect(pkg.dependencies.boardsmith).toMatch(/^file:/);
    expect(pkg.dependencies.boardsmith).not.toBe('^0.0.1');
  });
});
