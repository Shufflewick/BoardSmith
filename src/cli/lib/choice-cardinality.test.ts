import { describe, it, expect } from 'vitest';
import {
  MAX_FLAT_CHOICE_CANDIDATES,
  observeChoiceStep,
  findUnboundedChoiceSteps,
  describeUnboundedChoiceStep,
  type ChoiceStepObservation,
} from './choice-cardinality.js';

function obs(over: Partial<ChoiceStepObservation> = {}): ChoiceStepObservation {
  return {
    action: 'build',
    selection: 'target',
    candidateCount: 100,
    boardAnchored: false,
    dependent: false,
    ...over,
  };
}

describe('MAX_FLAT_CHOICE_CANDIDATES', () => {
  it('is the documented threshold', () => {
    expect(MAX_FLAT_CHOICE_CANDIDATES).toBe(24);
  });
});

describe('observeChoiceStep', () => {
  it('treats a boardRef as a board anchor', () => {
    const o = observeChoiceStep('placeStone', {
      name: 'cell',
      type: 'element',
      boardRef: () => ({ id: 1 }),
    }, 50);
    expect(o).toEqual({
      action: 'placeStone',
      selection: 'cell',
      candidateCount: 50,
      boardAnchored: true,
      dependent: false,
    });
  });

  it('treats boardRefs (choice steps) as a board anchor', () => {
    const o = observeChoiceStep('move', { name: 'dest', type: 'choice', boardRefs: () => [] }, 30);
    expect(o.boardAnchored).toBe(true);
  });

  it('treats dependsOn as a dependent filter', () => {
    const o = observeChoiceStep('drop', { name: 'item', type: 'element', dependsOn: 'merc' }, 40);
    expect(o.dependent).toBe(true);
    expect(o.boardAnchored).toBe(false);
  });

  it('reports a bare step as neither anchored nor dependent', () => {
    const o = observeChoiceStep('pick', { name: 'verb', type: 'choice' }, 300);
    expect(o).toEqual({
      action: 'pick',
      selection: 'verb',
      candidateCount: 300,
      boardAnchored: false,
      dependent: false,
    });
  });
});

describe('findUnboundedChoiceSteps', () => {
  it('reports a step above the threshold with no anchor and no dependency', () => {
    expect(findUnboundedChoiceSteps([obs({ candidateCount: 25 })])).toEqual([
      { action: 'build', selection: 'target', maxCandidates: 25 },
    ]);
  });

  it('leaves a step exactly at the threshold alone', () => {
    expect(findUnboundedChoiceSteps([obs({ candidateCount: 24 })])).toEqual([]);
  });

  it('exempts a board-anchored step however large — the board is its surface', () => {
    expect(findUnboundedChoiceSteps([obs({ candidateCount: 500, boardAnchored: true })])).toEqual([]);
  });

  it('exempts a step narrowed by an earlier choice', () => {
    expect(findUnboundedChoiceSteps([obs({ candidateCount: 500, dependent: true })])).toEqual([]);
  });

  it('keeps the largest count seen for a step across the whole run', () => {
    expect(
      findUnboundedChoiceSteps([
        obs({ candidateCount: 30 }),
        obs({ candidateCount: 120 }),
        obs({ candidateCount: 7 }),
      ]),
    ).toEqual([{ action: 'build', selection: 'target', maxCandidates: 120 }]);
  });

  it('does not merge same-named selections belonging to different actions', () => {
    const findings = findUnboundedChoiceSteps([
      obs({ action: 'a', candidateCount: 40 }),
      obs({ action: 'b', candidateCount: 90 }),
    ]);
    expect(findings).toEqual([
      { action: 'b', selection: 'target', maxCandidates: 90 },
      { action: 'a', selection: 'target', maxCandidates: 40 },
    ]);
  });

  it('honours an explicit threshold', () => {
    expect(findUnboundedChoiceSteps([obs({ candidateCount: 10 })], 5)).toEqual([
      { action: 'build', selection: 'target', maxCandidates: 10 },
    ]);
  });

  it('exempts a step whose largest observation is anchored even when an earlier one was not', () => {
    // A selection is anchored or not by its definition, not by a moment in a
    // game — an observation stream that disagrees means the definition changed
    // mid-run, which cannot happen. The anchored flag therefore latches.
    expect(
      findUnboundedChoiceSteps([obs({ candidateCount: 90, boardAnchored: true }), obs({ candidateCount: 30 })]),
    ).toEqual([]);
  });
});

describe('describeUnboundedChoiceStep', () => {
  it('names the action, the step, the count and the two ways out', () => {
    const message = describeUnboundedChoiceStep({
      action: 'build',
      selection: 'target',
      maxCandidates: 120,
    });
    expect(message).toContain("build");
    expect(message).toContain('target');
    expect(message).toContain('120');
    expect(message).toContain('boardRef');
    expect(message).toContain('dependsOn');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: real engine, real move enumeration, real counts.
// ---------------------------------------------------------------------------

describe('auditChoiceCardinality', () => {
  it('flags a flat unanchored step and leaves a board-anchored one alone', async () => {
    const { WideGame } = await import('./choice-cardinality.fixture.js');
    const { auditChoiceCardinality } = await import('./choice-cardinality.js');

    const findings = await auditChoiceCardinality(WideGame, { seed: 'audit', games: 1 });

    expect(findings).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  it('finds nothing in a game whose steps are all small', async () => {
    const { NarrowGame } = await import('./choice-cardinality.fixture.js');
    const { auditChoiceCardinality } = await import('./choice-cardinality.js');

    expect(await auditChoiceCardinality(NarrowGame, { seed: 'audit', games: 1 })).toEqual([]);
  });
});
