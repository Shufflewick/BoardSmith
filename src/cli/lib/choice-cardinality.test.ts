import { describe, it, expect } from 'vitest';
import type { ActionMetadata } from '../../types/protocol.js';
import type { CrowdedLevel } from './choice-cardinality.js';
import {
  MAX_FLAT_CHOICE_CANDIDATES,
  auditChoiceCardinality,
  auditWorldChoiceCardinality,
  observeChoiceStep,
  findUnboundedChoiceSteps,
  describeUnboundedChoiceStep,
  MAX_LEVEL_BUTTONS,
  startButtonLevels,
  findCrowdedLevels,
  describeCrowdedLevel,
  type ChoiceStepObservation,
} from './choice-cardinality.js';
import {
  CrowdedGame,
  GroupedChoresGame,
  PromptCrashGame,
  LateWideGame,
  NarrowGame,
  ThreeSeatWideGame,
  TypedNameGame,
  UnfinishedWideGame,
  WideGame,
  balked,
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
    const o = observeChoiceStep('drop', { name: 'item', type: 'element', dependsOn: 'hero' }, 40);
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
    const findings = (await auditChoiceCardinality(WideGame, { seed: 'audit', games: 1 })).unbounded;

    expect(findings).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  it('finds nothing in a game whose steps are all small', async () => {
    expect((await auditChoiceCardinality(NarrowGame, { seed: 'audit', games: 1 })).unbounded).toEqual([]);
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
    expect((await auditChoiceCardinality(UnfinishedWideGame, { seed: 'audit', games: 2 })).unbounded).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  // #383: the simulator asks isResting after every move, so the audit's rest
  // must name only the no-move stop, or the walk would end after one move.
  it('keeps walking past the first move to a step that opens later', async () => {
    expect((await auditChoiceCardinality(LateWideGame, { seed: 'audit', games: 2 })).unbounded).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  it('plays at the seat count it is given', async () => {
    expect((await auditChoiceCardinality(ThreeSeatWideGame, { seed: 'audit', games: 1, players: 3 })).unbounded).toEqual([
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
    expect((await auditWorldChoiceCardinality(cardinalityWorld(['shout', 'mark']), { seed: 'audit' })).unbounded).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
  });

  it('finds nothing in a world whose steps are all small', async () => {
    expect((await auditWorldChoiceCardinality(cardinalityWorld(['nod']), { seed: 'audit' })).unbounded).toEqual([]);
  });

  it('counts a later question with the earlier answers bound, as the panel re-asks it', async () => {
    expect((await auditWorldChoiceCardinality(cardinalityWorld(['pair']), { seed: 'audit' })).unbounded).toEqual([
      { action: 'pair', selection: 'second', maxCandidates: 40 },
    ]);
  });

  it('announces each driven seat’s arrival, so what arrivals build is counted', async () => {
    // Ten lanterns per arrival: thirty once all three seats are here.
    expect(
      (await auditWorldChoiceCardinality(cardinalityWorld(['light', 'hang', 'nod'], 'hang'), { seed: 'audit' })).unbounded,
    ).toEqual([{ action: 'light', selection: 'lantern', maxCandidates: 30 }]);
  });

  it('takes offers and fires what falls due, so a list that only grows in play is counted', async () => {
    const findings = (await auditWorldChoiceCardinality(cardinalityWorld(['plant', 'sprout', 'harvest']), {
      seed: 'audit',
    })).unbounded;

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

  it('treats an empty-string `optional` as required, as the engine does (#476)', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['scrawl']), { seed: 'audit' })).rejects.toThrow(
      /no seat was offered an action it could take.*'scrawl' asks for text input 'line'/s,
    );
  });

  it('stops and names the seat when the world refuses to enumerate its offers', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['flood']), { seed: 'audit' })).rejects.toThrow(
      /seat 1's offers.*250 candidates.*200/s,
    );
  });

  it('stops and names the move when the rules crash on it, rather than counting the crash as a no (#847)', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['grow', 'shout']), { seed: 'audit' })).rejects.toThrow(
      /seat \d's 'grow'.*"how":"tall".*crashed.*error in the game's rules/s,
    );
  });

  it('stops and names the move when a selection callback crashes on it with a plain Error, never counting it as a no (#847, #1015)', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['sift', 'shout']), { seed: 'audit' })).rejects.toThrow(
      /seat \d's 'sift' with \{"how":"finely"\} crashed in the game's rules.*the sieve is undefined/,
    );
  });

  it('counts the rules refusing a move as part of driving the world (#847)', async () => {
    balked.times = 0;
    expect((await auditWorldChoiceCardinality(cardinalityWorld(['balk', 'shout']), { seed: 'audit' })).unbounded).toEqual([
      { action: 'shout', selection: 'verb', maxCandidates: 40 },
    ]);
    expect(balked.times).toBeGreaterThan(0);
  });

  it('stops and names the move when the world itself refuses one', async () => {
    await expect(auditWorldChoiceCardinality(cardinalityWorld(['trespass']), { seed: 'audit' })).rejects.toThrow(
      /seat 1's 'trespass'.*"how":"quietly".*elsewhere/s,
    );
  });
});

// ---------------------------------------------------------------------------
// Start buttons per level (#1639): one Action Panel level shows at most nine
// buttons that are not groups, counted the way the panel draws the level.
// ---------------------------------------------------------------------------

const verb = (name: string, over: Partial<ActionMetadata> = {}): ActionMetadata => ({ name, prompt: name, selections: [], ...over });
const tenVerbs = Array.from({ length: 10 }, (_, i) => verb(`chore${i}`));
const CHORE_NAMES = tenVerbs.map((a) => a.name);
const never = () => false;

describe('MAX_LEVEL_BUTTONS', () => {
  it('is nine, the most any trial game needed at one level', () => {
    expect(MAX_LEVEL_BUTTONS).toBe(9);
  });
});

describe('startButtonLevels', () => {
  const top = (levels: CrowdedLevel[]) => levels.find((level) => level.path.length === 0)!;

  it('reads every level as the panel draws it, a lone group drawn as its button', () => {
    const levels = startButtonLevels([verb('a'), verb('b', { group: ['Lone'] }), verb('c', { group: ['G'] }), verb('d', { group: ['G'] })], never);
    expect(levels).toEqual([{ path: [], actions: ['a', 'b'] }, { path: ['G'], actions: ['c', 'd'] }]);
  });

  it('leaves out disabled actions, which fold into one row', () => {
    expect(top(startButtonLevels(tenVerbs, (name) => name === 'chore0')).actions).toHaveLength(9);
  });

  it('leaves out suppressed actions while anything else is offered', () => {
    expect(top(startButtonLevels([...tenVerbs.slice(0, 9), verb('chore9', { suppressFromActionPanel: true })], never)).actions).toHaveLength(9);
  });

  it('keeps a lone destructive action in its group', () => {
    expect(top(startButtonLevels([verb('a'), verb('scuttle', { group: ['Fleet'], destructive: true })], never)).actions).toEqual(['a']);
  });

  it('reports a second crowded level beside a busier one (#1639 review F2)', () => {
    const levels = startButtonLevels([...tenVerbs, verb('x'), verb('y'), ...tenVerbs.map((a) => verb(`build-${a.name}`, { group: ['Build'] }))], never);
    expect(findCrowdedLevels(levels).map((level) => [level.path, level.actions.length])).toEqual([[[], 12], [['Build'], 10]]);
  });
});

describe('findCrowdedLevels', () => {
  it('reports a level over the limit once, with the most buttons it was seen with', () => {
    const levels = [
      { path: [], actions: CHORE_NAMES.slice(0, 9) },
      { path: [], actions: CHORE_NAMES },
      { path: ['G'], actions: CHORE_NAMES.slice(0, 9) },
    ];
    expect(findCrowdedLevels(levels)).toEqual([{ path: [], actions: CHORE_NAMES }]);
  });
});

describe('describeCrowdedLevel', () => {
  it('names the level, the count, the actions and the way out', () => {
    const text = describeCrowdedLevel({ path: ['Buildings'], actions: CHORE_NAMES });
    expect(text).toContain('Buildings');
    expect(text).toContain('10');
    expect(text).toContain('chore0');
    expect(text).toContain('.group(');
    expect(describeCrowdedLevel({ path: [], actions: CHORE_NAMES })).toContain('top level');
  });
});

describe('the audits count start buttons per level', () => {
  it('finds a table level of ten ungrouped buttons', async () => {
    expect((await auditChoiceCardinality(CrowdedGame, { seed: 'audit', games: 1 })).crowded)
      .toEqual([{ path: [], actions: CHORE_NAMES }]);
  });

  it('finds nothing in a table game whose levels are grouped', async () => {
    expect((await auditChoiceCardinality(GroupedChoresGame, { seed: 'audit', games: 1 })).crowded).toEqual([]);
  });

  it('finds a world level of ten ungrouped buttons', async () => {
    expect((await auditWorldChoiceCardinality(cardinalityWorld(['chores']), { seed: 'audit' })).crowded)
      .toEqual([{ path: [], actions: CHORE_NAMES }]);
  });

  it('says a seat\'s panel could not be built, not that the simulator crashed (#1639 review F4)', async () => {
    const audit = auditChoiceCardinality(PromptCrashGame, { seed: 'audit', games: 1 });
    await expect(audit).rejects.toThrow(/seat 1's Action Panel could not be built.*the banner is undefined/s);
    await expect(audit).rejects.not.toThrow(/shows the same failure/);
  });

  it('finds nothing in a world with a few buttons', async () => {
    expect((await auditWorldChoiceCardinality(cardinalityWorld(['shout', 'mark']), { seed: 'audit' })).crowded).toEqual([]);
  });
});
