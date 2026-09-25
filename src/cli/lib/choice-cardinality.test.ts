import { describe, it, expect } from 'vitest';
import {
  MAX_FLAT_CHOICE_CANDIDATES,
  auditChoiceCardinality,
  auditWorldChoiceCardinality,
  observeChoiceStep,
  findUnboundedChoiceSteps,
  describeUnboundedChoiceStep,
  type ChoiceStepObservation,
} from './choice-cardinality.js';
import {
  LateWideGame,
  NarrowGame,
  ThreeSeatWideGame,
  TypedNameGame,
  UnfinishedWideGame,
  WideGame,
  cardinalityWorld,
} from './choice-cardinality.fixture.js';

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
  const step = { action: 'build', selection: 'target', maxCandidates: 120 };

  it('names the action, the step, the count and the two ways out', () => {
    const message = describeUnboundedChoiceStep(step, 'table');
    expect(message).toContain("build");
    expect(message).toContain('target');
    expect(message).toContain('120');
    expect(message).toContain('boardRef');
    expect(message).toContain('dependsOn');
  });

  // #323: a world action may not declare dependsOn, so telling a world author
  // to add one sends them into a refusal.
  it('gives a world the way out a world has: an earlier question, never dependsOn', () => {
    const message = describeUnboundedChoiceStep(step, 'world');
    expect(message).toContain('120');
    expect(message).toContain('boardRef');
    expect(message).toMatch(/earlier question/);
    expect(message).not.toContain('dependsOn');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: real engine, real move enumeration, real counts.
// ---------------------------------------------------------------------------

describe('auditChoiceCardinality', () => {
  it('flags a flat unanchored step and leaves a board-anchored one alone', async () => {
    const findings = await auditChoiceCardinality(WideGame, { seed: 'audit', games: 1 });

    expect(findings).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  it('finds nothing in a game whose steps are all small', async () => {
    expect(await auditChoiceCardinality(NarrowGame, { seed: 'audit', games: 1 })).toEqual([]);
  });

  // #306: a game the simulator could not play offers no choice steps to count,
  // so an empty findings list from it would read as a clean game.
  it('refuses to report a game that crashed as having no findings', async () => {
    await expect(
      auditChoiceCardinality(ThreeSeatWideGame, { seed: 'audit', games: 1, players: 2 }),
    ).rejects.toThrow(/crashed.*seed audit-2-0.*needs at least 3 players.*boardsmith simulate --replay audit-2-0 --players 2"/s);
  });

  it('refuses to report a game that got stuck as having no findings', async () => {
    await expect(auditChoiceCardinality(TypedNameGame, { seed: 'audit', games: 1 })).rejects.toThrow(
      /got stuck.*seed audit-2-0.*text input 'nickname'/s,
    );
  });

  // #317: a game built chunk by chunk stops with no move left until the chunk
  // that ends it exists. Every choice it offered was counted, so that stop is
  // a finished walk, not a game the simulator could not play.
  it('counts a game whose ending is not built yet, which stops with no move left', async () => {
    expect(await auditChoiceCardinality(UnfinishedWideGame, { seed: 'audit', games: 2 })).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  // #383: the simulator asks isResting after every move, so the audit's rest
  // must name only the no-move stop, or the walk would end after one move.
  it('keeps walking past the first move to a step that opens later', async () => {
    expect(await auditChoiceCardinality(LateWideGame, { seed: 'audit', games: 2 })).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  it('plays at the seat count it is given', async () => {
    expect(await auditChoiceCardinality(ThreeSeatWideGame, { seed: 'audit', games: 1, players: 3 })).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Worlds (#323): driven the way a host drives one -- seats arrive, offers are
// enumerated per seat, later picks are re-asked with earlier answers bound,
// random offers are taken, and what falls due is fired.
// ---------------------------------------------------------------------------

describe('auditWorldChoiceCardinality', () => {
  it('flags a flat unanchored step and leaves a board-anchored one alone', async () => {
    expect(await auditWorldChoiceCardinality(cardinalityWorld(['shout', 'mark']), { seed: 'audit' })).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  it('finds nothing in a world whose steps are all small', async () => {
    expect(await auditWorldChoiceCardinality(cardinalityWorld(['nod']), { seed: 'audit' })).toEqual([]);
  });

  it('counts a later question with the earlier answers bound, as the panel re-asks it', async () => {
    expect(await auditWorldChoiceCardinality(cardinalityWorld(['pair']), { seed: 'audit' })).toEqual([
      { action: 'pair', selection: 'second', maxCandidates: 40 },
    ]);
  });

  it('announces each driven seat’s arrival, so what arrivals build is counted', async () => {
    // Ten lanterns per arrival: thirty once all three seats are here.
    expect(
      await auditWorldChoiceCardinality(cardinalityWorld(['light', 'hang', 'nod'], 'hang'), { seed: 'audit' }),
    ).toEqual([{ action: 'light', selection: 'lantern', maxCandidates: 30 }]);
  });

  it('takes offers and fires what falls due, so a list that only grows in play is counted', async () => {
    const findings = await auditWorldChoiceCardinality(cardinalityWorld(['plant', 'sprout', 'harvest']), {
      seed: 'audit',
    });

    expect(findings.map(({ action, selection }) => ({ action, selection }))).toEqual([
      { action: 'harvest', selection: 'shoot' },
    ]);
    expect(findings[0]!.maxCandidates).toBeGreaterThan(MAX_FLAT_CHOICE_CANDIDATES);
  });

  it('is reproducible from its seed', async () => {
    const run = () => auditWorldChoiceCardinality(cardinalityWorld(['plant', 'sprout', 'harvest']), { seed: 'same' });

    expect(await run()).toEqual(await run());
  });

  it('refuses to call a world clean when no seat was offered anything it could take', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['say']), { seed: 'audit' })).rejects.toThrow(
      /no seat was offered an action it could take.*'say' asks for text input 'line'/s,
    );
  });

  it('stops and names the seat when the world refuses to enumerate its offers', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['flood']), { seed: 'audit' })).rejects.toThrow(
      /seat 1's offers.*250 candidates.*200/s,
    );
  });

  it('stops and names the move when the world itself refuses one', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['trespass']), { seed: 'audit' })).rejects.toThrow(
      /seat 1's 'trespass'.*"how":"quietly".*elsewhere/s,
    );
  });
});
