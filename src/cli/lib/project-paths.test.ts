import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { designRecordPath, resolveDesignRelative } from './project-paths.js';

/**
 * WHERE A PATH IN A DESIGN RECORD POINTS (#409). A ledger entry, a Build Manifest row, a claim's
 * `Source:` line and a verified chunk's evidence citation are all read through this one rule, so
 * the same written path can never be accepted by one check and refused by another.
 */

const project = join('/work', 'game');

describe('designRecordPath — the one rule for a path written in a design record', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads what design/ owns from design/: the rulebook, the chunks, the run logs and every named ledger', () => {
    expect(designRecordPath(project, 'rulebook/08-combat.md')).toBe('design/rulebook/08-combat.md');
    expect(designRecordPath(project, 'chunks/a/evidence/x.mjs')).toBe('design/chunks/a/evidence/x.mjs');
    expect(designRecordPath(project, 'run-log/a.md')).toBe('design/run-log/a.md');
    for (const ledger of ['SKETCH.md', 'RULINGS.md', 'DECISIONS.md', 'CONSTRAINTS.md', 'QUESTIONS.md', 'FILINGS.md', 'RUN.md']) {
      expect(designRecordPath(project, ledger)).toBe(`design/${ledger}`);
    }
  });

  it('reads a path that climbs out of design/ with ../ from design/, so ../src/x.ts is the project\'s src/x.ts', () => {
    expect(designRecordPath(project, '../src/rules/world.ts')).toBe('src/rules/world.ts');
    expect(designRecordPath(project, '../old/lib/combat.pm')).toBe('old/lib/combat.pm');
  });

  it('reads everything else from the project root', () => {
    expect(designRecordPath(project, 'src/rules/world.ts')).toBe('src/rules/world.ts');
    expect(designRecordPath(project, 'tests/a.test.ts')).toBe('tests/a.test.ts');
    expect(designRecordPath(project, 'design/chunks/a/evidence/x.png')).toBe('design/chunks/a/evidence/x.png');
    expect(designRecordPath(project, 'boardsmith.json')).toBe('boardsmith.json');
    expect(designRecordPath(project, '.boardsmith/scratch/probe.mjs')).toBe('.boardsmith/scratch/probe.mjs');
  });

  it('reads ~/ as the home directory and an absolute path as itself', () => {
    vi.stubEnv('HOME', '/work');
    expect(designRecordPath(project, '~/game/tests/food.test.ts')).toBe('tests/food.test.ts');
    expect(designRecordPath(project, '~/BoardSmith/src/engine/game.ts')).toBeUndefined();
    expect(designRecordPath(project, join(project, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(designRecordPath(project, '/tmp/driver.mjs')).toBeUndefined();
  });

  it('is undefined for a path that leaves the project, whichever base it is read from', () => {
    expect(designRecordPath(project, '../../elsewhere.md')).toBeUndefined();
    expect(designRecordPath(project, 'rulebook/../../../x.md')).toBeUndefined();
    expect(designRecordPath(project, 'src/../../x.ts')).toBeUndefined();
  });

  it('agrees with resolveDesignRelative, which gives the same place as an absolute path', () => {
    for (const written of ['rulebook/a.md', '../src/a.ts', 'src/a.ts', 'DECISIONS.md', 'boardsmith.json']) {
      expect(resolveDesignRelative(project, written)).toBe(join(project, designRecordPath(project, written)!));
    }
  });
});
