import { describe, it, expect } from 'vitest';
import {
  compareHealthBaselines,
  describeBaselineDrift,
  type HealthBaseline,
} from './health-baseline.js';

/**
 * Issue #159: the committed `.fallow-health-baseline.json` drifts from what
 * `fallow health` produces from `main`, silently. The failure mode is "an
 * unrelated file becomes uneditable" — `fallow audit` stops excluding that
 * file's long-standing debt and reports all of it against whatever change
 * happened to touch it, which reads as a gate catching something rather than
 * as a stale generated file.
 */

const baseline = (counts: Record<string, Record<string, number>>): HealthBaseline => ({
  finding_counts: Object.fromEntries(
    Object.entries(counts).map(([file, cats]) => [
      file,
      Object.fromEntries(Object.entries(cats).map(([cat, count]) => [cat, { count }])),
    ]),
  ),
  production_coverage_findings: [],
  target_keys: [],
});

describe('compareHealthBaselines', () => {
  it('reports no drift when the committed baseline still describes the tree', () => {
    const committed = baseline({ 'src/a.ts': { complexity_critical: 7 } });
    const fresh = baseline({ 'src/a.ts': { complexity_critical: 7 } });
    expect(compareHealthBaselines(committed, fresh)).toEqual([]);
  });

  it('reports the file whose real debt outgrew its baseline — the false-block case', () => {
    const committed = baseline({ 'src/engine/action/action.ts': { complexity_critical: 5 } });
    const fresh = baseline({ 'src/engine/action/action.ts': { complexity_critical: 7 } });

    expect(compareHealthBaselines(committed, fresh)).toEqual([
      {
        file: 'src/engine/action/action.ts',
        category: 'complexity_critical',
        baseline: 5,
        current: 7,
        direction: 'unrecorded',
      },
    ]);
  });

  it('reports a baseline that still forgives debt the tree no longer has', () => {
    const committed = baseline({ 'src/a.ts': { crap_high: 1 } });
    const fresh = baseline({ 'src/a.ts': { crap_high: 0 } });

    expect(compareHealthBaselines(committed, fresh)).toEqual([
      { file: 'src/a.ts', category: 'crap_high', baseline: 1, current: 0, direction: 'stale' },
    ]);
  });

  it('sees a file that has appeared and one that has gone', () => {
    const committed = baseline({ 'src/gone.ts': { complexity_high: 2 } });
    const fresh = baseline({ 'src/new.ts': { complexity_high: 1 } });

    expect(compareHealthBaselines(committed, fresh)).toEqual([
      { file: 'src/gone.ts', category: 'complexity_high', baseline: 2, current: 0, direction: 'stale' },
      { file: 'src/new.ts', category: 'complexity_high', baseline: 0, current: 1, direction: 'unrecorded' },
    ]);
  });
});

describe('describeBaselineDrift', () => {
  it('names the files, which direction each drifted, and how to regenerate', () => {
    const message = describeBaselineDrift([
      {
        file: 'src/engine/action/action.ts',
        category: 'complexity_critical',
        baseline: 5,
        current: 7,
        direction: 'unrecorded',
      },
    ]);

    expect(message).toContain('src/engine/action/action.ts');
    expect(message).toContain('complexity_critical');
    expect(message).toContain('fallow health --save-baseline');
    expect(message).toContain('docs/fallow-gate.md');
  });
});
