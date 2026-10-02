/**
 * What the in-browser smoke walk reports once it has walked (#453). The walk itself runs in
 * Chromium under `boardsmith verify`; its verdict is decided here, from what it saw.
 */
import { describe, expect, it } from 'vitest';
import { rulesErrorSentence } from '../engine/action/rules-error.js';
import {
  actionFailed,
  answered,
  DEFAULT_SMOKE_SEED,
  inputFor,
  MOST_ANSWERS,
  readyToTake,
  recordGreyed,
  recordResolved,
  SMOKE_SPEC_PATH,
  startAnswering,
  walkStopped,
  smokeFailure,
  smokeProblems,
  smokeRecord,
  smokeSeeds,
  smokeSummary,
  smokeWorldSeats,
  type ResolvedMemory,
  type SmokeInputView,
  type SmokeWalk,
} from './browser-smoke-verdict.js';

function walk(overrides: Partial<SmokeWalk>): SmokeWalk {
  return {
    listed: [],
    unreachable: {},
    offered: new Set(),
    enabled: new Set(),
    taken: new Set(),
    steps: 60,
    errors: [],
    seeds: [DEFAULT_SMOKE_SEED],
    stalls: [],
    inputs: {},
    wanting: new Map(),
    fieldsMet: new Map(),
    greyed: new Map(),
    seats: [],
    ...overrides,
  };
}

describe('smokeSeeds: the deals a walk is dealt (#460)', () => {
  it('deals from one fixed seed when the spec names none, so every run walks the same game', () => {
    expect(smokeSeeds(undefined)).toEqual([DEFAULT_SMOKE_SEED]);
    expect(DEFAULT_SMOKE_SEED).toBe('smoke');
  });

  it('deals from the seed the spec names, or from each seed of a list, in order', () => {
    expect(smokeSeeds('opening')).toEqual(['opening']);
    expect(smokeSeeds(['opening', '7'])).toEqual(['opening', '7']);
  });

  it('deals from the seeds `boardsmith smoke --seed` names instead of the spec\'s, so any deal can be walked again', () => {
    expect(smokeSeeds('opening', ['7', '9'])).toEqual(['7', '9']);
    expect(() => smokeSeeds(undefined, ['7', '7'])).toThrow(
      '`boardsmith smoke --seed` lists "7" twice, which walks the same deal twice. List each seed once.',
    );
  });

  it('refuses an empty list, a blank seed and a seed listed twice, saying what to write instead', () => {
    expect(() => smokeSeeds([])).toThrow(
      `\`seed\` in ${SMOKE_SPEC_PATH} is an empty list, so the walk would deal no game. List at least one seed, or leave ` +
        `\`seed\` out to deal from "${DEFAULT_SMOKE_SEED}".`,
    );
    for (const blank of ['', '  ', ['7', ' ']]) {
      expect(() => smokeSeeds(blank)).toThrow(
        `\`seed\` in ${SMOKE_SPEC_PATH} has a blank seed. A seed is any text that is not blank, such as "7" or "opening".`,
      );
    }
    expect(() => smokeSeeds(['7', 'opening', '7'])).toThrow(
      `\`seed\` in ${SMOKE_SPEC_PATH} lists "7" twice, which walks the same deal twice. List each seed once.`,
    );
  });
});

describe('smokeWorldSeats: the seats a world walk plays (#471)', () => {
  it('plays the one seat the world gives the page when the spec names none', () => {
    expect(smokeWorldSeats(undefined)).toBeUndefined();
  });

  it('plays the first seats the world gives for a count, and the seats a list names, in order', () => {
    expect(smokeWorldSeats(2)).toEqual([1, 2]);
    expect(smokeWorldSeats([1, 169])).toEqual([1, 169]);
  });

  it('refuses a count or a seat that is not a whole number from 1, an empty list and a seat listed twice, saying what to write', () => {
    for (const seats of [0, 1.5, -2]) {
      expect(() => smokeWorldSeats(seats)).toThrow(
        `\`seats\` in ${SMOKE_SPEC_PATH} is ${seats}, which is not a number of seats. Give how many seats the walk plays, such as 2, or list them, such as [1, 4].`,
      );
    }
    expect(() => smokeWorldSeats([])).toThrow(
      `\`seats\` in ${SMOKE_SPEC_PATH} is an empty list, so the walk would play no seat. List at least one, or leave \`seats\` out to play one.`,
    );
    expect(() => smokeWorldSeats([1, 0])).toThrow(
      `\`seats\` in ${SMOKE_SPEC_PATH} lists 0, which is not a seat. Seats are numbered from 1.`,
    );
    expect(() => smokeWorldSeats([4, 1, 4])).toThrow(`\`seats\` in ${SMOKE_SPEC_PATH} lists seat 4 twice. List each seat once.`);
  });
});

const REASON = 'Offered only after fifty quiet moves, which a walk from a fresh game never plays.';

/** What a table walk that stalled at step 9 of the deal from "smoke" reports (#473). */
const TABLE_STALL =
  'The game stalled at step 9 of the game dealt from seed "smoke": no seat was offered anything for 30s, and the game ' +
  'was not over, so the players at that table could never finish it. Run `boardsmith smoke` to watch where the game ' +
  'stops offering actions: a step no seat can act in, or one waiting on something no player does.';

describe('smokeProblems', () => {
  it('passes a walk that took every listed action and saw no error', () => {
    expect(smokeProblems(walk({ listed: ['draw', 'play'], offered: new Set(['draw', 'play']), taken: new Set(['draw', 'play']) }))).toEqual([]);
  });

  it('passes a game with no actions yet that loaded and seated a player without an error', () => {
    expect(smokeProblems(walk({}))).toEqual([]);
  });

  it('reports every error the walk saw, in order, before anything else', () => {
    const problems = smokeProblems(walk({ errors: ['A console error: boom', 'An uncaught error in the page: bang'], offered: new Set(['x']) }));
    expect(problems.slice(0, 2)).toEqual(['A console error: boom', 'An uncaught error in the page: bang']);
  });

  it('names an offered action the spec does not list, and says where to add it', () => {
    expect(smokeProblems(walk({ offered: new Set(['swap', 'draw']), taken: new Set(['swap', 'draw']), listed: ['draw'] }))).toEqual([
      `The game offered "swap", which ${SMOKE_SPEC_PATH} does not list. Add it to \`actions\` there.`,
    ]);
  });

  it('names a listed action the walk never saw offered, and one it saw but could not take', () => {
    expect(smokeProblems(walk({ listed: ['draw', 'score'], offered: new Set(['draw']), enabled: new Set(['draw']), steps: 12 }))).toEqual([
      'The panel offered "draw", but the walk never took it in 12 steps. The errors above, if any, say why.',
      `The walk never saw "score" offered in 12 steps from a fresh game dealt from seed "smoke". If a fresh game takes ` +
        `longer to reach it, raise \`steps\` in ${SMOKE_SPEC_PATH}. If the deal decides whether it is offered (the cards a ` +
        `player is dealt, say), choose a seed whose deal offers it, and list it in \`seed\` there. If no walk from a fresh game ` +
        `can reach it whatever the deal (it needs a long game, or a position play does not get to), name it in ` +
        `\`unreachable\` there with the reason. If the game no longer has it, remove it from \`actions\`.`,
    ]);
  });

  it('#460: names every deal a listed action was missed on', () => {
    expect(smokeProblems(walk({ listed: ['score'], seeds: ['opening', '7'], steps: 12 }))).toEqual([
      expect.stringMatching(/^The walk never saw "score" offered in 12 steps from a fresh game dealt from seed "opening", nor from seed "7"\. /),
    ]);
  });

  it('#460, #473: fails a table game that stalled, and says a listed action it never saw was missed for that, not for want of steps', () => {
    const stalled = walk({ listed: ['draw', 'score'], offered: new Set(['draw']), taken: new Set(['draw']), stalls: [{ step: 9, seed: 'smoke', seconds: 30 }] });
    expect(smokeProblems(stalled)).toEqual([
      TABLE_STALL,
      'The walk never saw "score" offered: the game stalled first (above), so more `steps` would not help. Fix the stall, then run it again.',
    ]);
  });

  it('#473: fails a table game that stalled with the game not over, though every listed action was taken', () => {
    const stalled = walk({ listed: ['draw'], offered: new Set(['draw']), taken: new Set(['draw']), stalls: [{ step: 9, seed: 'smoke', seconds: 30 }] });
    expect(smokeProblems(stalled)).toEqual([TABLE_STALL]);
  });

  it('#473: passes a world that offered nothing for a while once every listed action was taken, since a world may wait on its clock', () => {
    expect(smokeProblems(walk({ listed: ['tend'], seeds: [], offered: new Set(['tend']), taken: new Set(['tend']), stalls: [{ step: 9, seed: null, seconds: 30 }] }))).toEqual([]);
  });

  it('#472: says a listed action the panel only ever showed greyed out could never be taken, with the reason the panel gave, and what to do', () => {
    const greyed = walk({ listed: ['draw', 'bank'], offered: new Set(['draw', 'bank']), taken: new Set(['draw']), greyed: new Map([['bank', ['There is no bank in this town.']]]), steps: 12 });
    expect(smokeProblems(greyed)).toEqual([
      'The panel offered "bank" only greyed out in 12 steps from a fresh game dealt from seed "smoke", so the walk could ' +
        'never take it. The panel said why: "There is no bank in this town." If a fresh game takes longer to get past ' +
        `that, raise \`steps\` in ${SMOKE_SPEC_PATH}. If the deal decides it (the cards a player is dealt, say), choose a ` +
        'seed whose deal lets a player take it, and list it in `seed` there. If no walk from a fresh game can reach it ' +
        'whatever the deal (it needs a long game, or a position play does not get to), name it in `unreachable` there ' +
        'with the reason.',
    ]);
  });

  it('#472: in a world played from one seat, also says a second seat may be what a greyed-out action needs', () => {
    const greyed = walk({ listed: ['wave'], seeds: [], offered: new Set(['wave']), greyed: new Map([['wave', ['Nobody else is here.']]]), steps: 12 });
    expect(smokeProblems(greyed)).toEqual([
      'The panel offered "wave" only greyed out in 12 steps from a fresh game, so the walk could never take it. The ' +
        'panel said why: "Nobody else is here." If a fresh game takes longer to get past that, raise `steps` in ' +
        `${SMOKE_SPEC_PATH}. If it needs another player there too, list the seats the walk plays in \`seats\` there, ` +
        'choosing seats the world brings together. If no walk from a fresh game can reach it (it needs a long game, or ' +
        'a position play does not get to), name it in `unreachable` there with the reason.',
    ]);
  });

  it('#471: in a world played from one seat, says a second seat may be what an action never offered needs', () => {
    expect(smokeProblems(walk({ listed: ['trade'], seeds: [], steps: 12 }))).toEqual([
      'The walk never saw "trade" offered in 12 steps from a fresh game. If a fresh game takes longer to reach it, raise ' +
        `\`steps\` in ${SMOKE_SPEC_PATH}. If it needs another player there too, list the seats the walk plays in \`seats\` ` +
        'there, choosing seats the world brings together. If no walk from a fresh game can reach it (it needs a long ' +
        'game, or a position play does not get to), name it in `unreachable` there with the reason. If the game no ' +
        'longer has it, remove it from `actions`.',
    ]);
    // A walk already playing several seats is not told to add one.
    expect(smokeProblems(walk({ listed: ['trade'], seeds: [], seats: [1, 2], steps: 12 }))[0]).not.toMatch(/seats/);
  });

  it('#472: gives every reason the panel gave at one time or another, the latest three when it gave more', () => {
    const reasons = (greyed: string[]) =>
      smokeProblems(walk({ listed: ['bank'], offered: new Set(['bank']), greyed: new Map([['bank', greyed]]), steps: 12 }))[0];
    expect(reasons(['Arrive first.', 'There is no bank in this town.'])).toContain(
      'The panel gave these reasons, the latest last: "Arrive first."; "There is no bank in this town." If a fresh game',
    );
    expect(reasons(['One.', 'Two.', 'Three.', 'Four.', 'Five.'])).toContain(
      'The panel gave these reasons, the latest last: "Three."; "Four."; "Five." (and 2 more) If a fresh game',
    );
  });

  it('#472: keeps saying an action the panel offered ready to take, and the walk never took, was offered', () => {
    const missed = walk({ listed: ['bank'], offered: new Set(['bank']), enabled: new Set(['bank']), greyed: new Map([['bank', ['Closed for lunch.']]]), steps: 12 });
    expect(smokeProblems(missed)).toEqual(['The panel offered "bank", but the walk never took it in 12 steps. The errors above, if any, say why.']);
  });

  it('#460: says where a world walk stalled, with no seed to name', () => {
    expect(smokeProblems(walk({ listed: ['tend'], seeds: [], stalls: [{ step: 3, seed: null, seconds: 30 }] }))[0]).toMatch(
      /^The walk never saw "tend" offered\. It stopped at step 3, because no seat had been offered anything for 30s/,
    );
  });

  describe('#458: actions the spec declares a fresh game cannot reach', () => {
    it('does not require a declared action', () => {
      expect(smokeProblems(walk({ listed: ['move', 'claim'], unreachable: { claim: REASON }, offered: new Set(['move']), taken: new Set(['move']) }))).toEqual([]);
    });

    it('still fails on a declared action that was offered and failed, as on any other', () => {
      const failed = 'The panel offered "claim", and taking it failed: no repetition yet';
      const declared = walk({ listed: ['move', 'claim'], unreachable: { claim: REASON }, offered: new Set(['claim']), enabled: new Set(['claim']), taken: new Set(['move']), errors: [failed] });
      const undeclared = walk({ ...declared, unreachable: {} });
      expect(smokeProblems(declared)).toEqual(smokeProblems(undeclared));
      expect(smokeProblems(declared)[0]).toBe(failed);
    });

    it('fails a declared action the panel offered enabled that the walk never took, as it fails an undeclared one', () => {
      // An enabled button that does nothing when pressed is a dead action, not an unreachable one.
      const declared = walk({ listed: ['move', 'claim'], unreachable: { claim: REASON }, offered: new Set(['move', 'claim']), enabled: new Set(['move', 'claim']), taken: new Set(['move']), steps: 9 });
      expect(smokeProblems(declared)).toEqual(['The panel offered "claim", but the walk never took it in 9 steps. The errors above, if any, say why.']);
      expect(smokeProblems(declared)).toEqual(smokeProblems(walk({ ...declared, unreachable: {} })));
      expect(smokeRecord(declared, { controls: 0, games: 1 }).excused).toEqual([]);
    });

    it('still excuses a declared action the panel showed only greyed out', () => {
      const greyed = walk({ listed: ['move', 'claim'], unreachable: { claim: REASON }, offered: new Set(['move', 'claim']), enabled: new Set(['move']), taken: new Set(['move']) });
      expect(smokeProblems(greyed)).toEqual([]);
      expect(smokeRecord(greyed, { controls: 0, games: 1 }).excused).toEqual([{ action: 'claim', reason: REASON }]);
    });

    it('fails a spec that names every listed action in `unreachable`', () => {
      expect(smokeProblems(walk({ listed: ['move', 'claim'], unreachable: { move: REASON, claim: REASON } }))).toEqual([
        `${SMOKE_SPEC_PATH} names every action in \`actions\` in \`unreachable\`, so the walk would require none of them. ` +
          'A fresh game offers at least the first action a player takes: take the ones a walk reaches out of `unreachable`.',
      ]);
    });

    it('accepts a declared action the walk took anyway (smokeRecord reports it, so the declaration can go)', () => {
      expect(smokeProblems(walk({ listed: ['move', 'claim'], unreachable: { claim: REASON }, offered: new Set(['move', 'claim']), enabled: new Set(['move', 'claim']), taken: new Set(['move', 'claim']) }))).toEqual([]);
    });

    it('fails a declared action that `actions` does not list', () => {
      expect(smokeProblems(walk({ unreachable: { claim: REASON } }))).toEqual([
        `${SMOKE_SPEC_PATH} names "claim" in \`unreachable\`, but \`actions\` does not list it. \`actions\` lists every action ` +
          `the game has; add it there, or remove it from \`unreachable\` if the game no longer has it.`,
      ]);
    });

    it('fails a declaration that does not say why in a sentence', () => {
      for (const reason of ['', '   ', 'unreachable', 'needs long game']) {
        expect(smokeProblems(walk({ listed: ['move', 'claim'], unreachable: { claim: reason }, taken: new Set(['move']) }))).toEqual([
          `${SMOKE_SPEC_PATH} names "claim" in \`unreachable\` without saying why. Write a sentence saying what game state ` +
            'offers it and why a walk from a fresh game does not get there.',
        ]);
      }
    });

    it('does not excuse an undeclared action that was never offered', () => {
      expect(smokeProblems(walk({ listed: ['claim', 'accept'], unreachable: { claim: REASON }, steps: 5 }))).toEqual([
        expect.stringMatching(/^The walk never saw "accept" offered in 5 steps/),
      ]);
    });
  });
});

describe('smokeRecord and smokeSummary: what a passing walk reports', () => {
  it('says what was taken and pressed, in one game, with no error, and the seed it was dealt from', () => {
    const record = smokeRecord(walk({ listed: ['draw', 'play'], taken: new Set(['play', 'draw']) }), { controls: 1, games: 1 });
    expect(record).toEqual({ seeds: ['smoke'], seats: [], taken: ['draw', 'play'], controls: 1, games: 1, excused: [], reachedAnyway: [] });
    expect(smokeSummary(record)).toBe(
      'Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "play" and ' +
        'pressed 1 board control, with no error.',
    );
  });

  it('#460: names every seed a walk of several deals was dealt from', () => {
    const record = smokeRecord(walk({ seeds: ['opening', '7'], listed: ['draw'], taken: new Set(['draw']) }), { controls: 0, games: 3 });
    expect(smokeSummary(record)).toBe(
      'Served by `boardsmith dev` from a fresh start and dealt from seed "opening", then from seed "7", a seated player ' +
        'took "draw" and pressed 0 board controls, with no error, over 3 games (a new one each time a game ended with ' +
        'listed actions still to take).',
    );
    expect(smokeSummary({ ...record, games: 2 })).not.toMatch(/over 2 games/);
  });

  it('#471: names the seats a world walk played, when it played more than one', () => {
    const record = smokeRecord(walk({ seeds: [], seats: [1, 4], listed: ['wave'], taken: new Set(['wave']) }), { controls: 0, games: 1 });
    expect(record.seats).toEqual([1, 4]);
    expect(smokeSummary(record)).toBe(
      'Served by `boardsmith dev` from a fresh start, players at seats 1 and 4 took "wave" and pressed 0 board controls, with no error.',
    );
    expect(smokeSummary({ ...record, seats: [2, 7, 9] })).toMatch(/, players at seats 2, 7 and 9 took "wave"/);
  });

  it('#460: names no seed for a world, which `boardsmith dev` deals from its own', () => {
    const record = smokeRecord(walk({ seeds: [], listed: ['tend'], taken: new Set(['tend']) }), { controls: 0, games: 1 });
    expect(smokeSummary(record)).toBe(
      'Served by `boardsmith dev` from a fresh start, a seated player took "tend" and pressed 0 board controls, with no error.',
    );
  });

  it('says how many games the walk played, and which declared actions it did not require', () => {
    const record = smokeRecord(
      walk({ listed: ['move', 'resign', 'claim'], unreachable: { claim: REASON }, taken: new Set(['move', 'resign']) }),
      { controls: 0, games: 2 },
    );
    expect(record).toMatchObject({ games: 2, excused: [{ action: 'claim', reason: REASON }], reachedAnyway: [] });
    expect(smokeSummary(record)).toBe(
      'Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "move", "resign" and pressed 0 board controls, ' +
        'with no error, over 2 games (a new one each time a game ended with listed actions still to take). ' +
        `Not required, as ${SMOKE_SPEC_PATH} says a walk from a fresh game cannot reach them: "claim" ("${REASON}").`,
    );
  });

  it('reports a declared action the walk took anyway, and says to remove the declaration', () => {
    const record = smokeRecord(
      walk({ listed: ['offer', 'accept'], unreachable: { accept: REASON }, taken: new Set(['offer', 'accept']) }),
      { controls: 0, games: 1 },
    );
    expect(record).toMatchObject({ excused: [], reachedAnyway: ['accept'] });
    expect(smokeSummary(record)).toMatch(
      new RegExp(
        `with no error\\. The walk took "accept", which ${SMOKE_SPEC_PATH.replace(/\./g, '\\.')} says a walk from a fresh game ` +
          'cannot reach: remove it from `unreachable` there, so the walk requires it\\.$',
      ),
    );
  });
});

describe('smokeFailure: what a failing walk says (#460)', () => {
  it('names the seed it was dealt from, so `boardsmith smoke` walks the same game again', () => {
    expect(smokeFailure(walk({}), ['A console error: boom'])).toBe(
      'The smoke walk, dealt from seed "smoke", found a problem:\n  - A console error: boom',
    );
    expect(smokeFailure(walk({ seeds: ['a', 'b'] }), ['one', 'two'])).toBe(
      'The smoke walk, dealt from seed "a", then from seed "b", found 2 problems:\n  - one\n  - two',
    );
    expect(smokeFailure(walk({ seeds: [] }), ['one'])).toBe('The smoke walk found a problem:\n  - one');
  });
});

describe('answered: when the walk gives up on an open action (#463, #467)', () => {
  const at = 'at step 7 of the game dealt from seed "smoke"';

  it('goes on while each press changes the panel to something new', () => {
    const trail = startAnswering('modify-die', at, 'Choose a die');
    expect(answered(trail, '4', 'Raise or lower the 4?', [])).toBeUndefined();
    expect(answered(trail, 'Raise', 'Done?', [])).toBeUndefined();
  });

  it('gives up on a panel that offers nothing to press', () => {
    const trail = startAnswering('modify-die', at, 'Choose a die');
    expect(answered(trail, undefined, 'Choose a die', [])).toBe(
      `The panel opened "modify-die" ${at} and offered nothing to choose or press: Choose a die`,
    );
  });

  it('gives up on a panel three presses leave as it was', () => {
    const trail = startAnswering('kindle', at, 'How many logs?');
    expect(answered(trail, 'Done', 'How many logs?', [])).toBeUndefined();
    expect(answered(trail, 'Done', 'How many logs?', [])).toBeUndefined();
    expect(answered(trail, 'Done', 'How many logs?', [])).toBe(
      `The panel opened "kindle" ${at}, and pressing its choices changed nothing: How many logs?`,
    );
  });

  it('gives up at once on a panel that comes back to a state it showed, naming the presses that went round', () => {
    const trail = startAnswering('modify-die', at, 'Choose a die');
    expect(answered(trail, '6', 'Lower the 6?', [])).toBeUndefined();
    expect(answered(trail, 'Back', 'Choose a die', [])).toBe(
      `Answering "modify-die" ${at} went round in a loop: pressing "6", "Back" brought its panel back to a state it had ` +
        'shown before ("Choose a die"), so the action never finishes that way.',
    );
  });

  it('does not count a state as seen again when the board picks differ', () => {
    const trail = startAnswering('trade', at, 'Choose cards');
    expect(answered(trail, 'AH', 'Chosen 1', ['AH'])).toBeUndefined();
    expect(answered(trail, '2H', 'Choose cards', ['AH', '2H'])).toBeUndefined();
  });

  it(`gives up after ${MOST_ANSWERS} presses with the action still open, naming the last ones`, () => {
    const trail = startAnswering('count', at, 'n=0');
    for (let n = 1; n < MOST_ANSWERS; n++) expect(answered(trail, `+${n}`, `n=${n}`, [])).toBeUndefined();
    expect(answered(trail, `+${MOST_ANSWERS}`, `n=${MOST_ANSWERS}`, [])).toMatch(
      new RegExp(`^Answering "count" ${at.replace(/"/g, '"')} took ${MOST_ANSWERS} presses and the action was still open\\. The last ones: "\\+41", .*"\\+50"\\. Its panel: n=50$`),
    );
  });
});

describe('walkStopped: why a walk could not go on (#464)', () => {
  it('names the step and the deal, and says a page that stopped answering did so', () => {
    const timeout = Object.assign(new Error('locator.click: Timeout 5000ms exceeded.\nCall log: ...'), { name: 'TimeoutError' });
    expect(walkStopped(timeout, 5, { step: 54, seed: 'smoke' })).toBe(
      'The walk could not go on at step 54 of the game dealt from seed "smoke": the page did not answer within 5s ' +
        '(locator.click: Timeout 5000ms exceeded.). Run `boardsmith smoke` to watch that step.',
    );
  });

  it("gives any other error's first line, with no step before the walk began", () => {
    expect(walkStopped(new Error('The dev host never showed the game.\nmore'), 5)).toBe(
      'The walk could not go on: The dev host never showed the game.',
    );
    expect(walkStopped(new Error('boom'), 5, { step: 3, seed: null })).toBe('The walk could not go on at step 3: boom');
  });
});

describe('recordGreyed: the reasons a greyed-out action was given (#472)', () => {
  it('keeps each reason once, the one given most recently last', () => {
    const w = walk({});
    recordGreyed(w, [['bank', 'Arrive first.']]);
    recordGreyed(w, [['bank', 'Closed.'], ['wave', undefined]]);
    recordGreyed(w, [['bank', 'Arrive first.']]);
    expect(w.greyed).toEqual(new Map([['bank', ['Closed.', 'Arrive first.']]]));
  });
});

describe('readyToTake: an action whose input reads a value off the page now (#471)', () => {
  const page = (shown: string[]): SmokeInputView => ({ texts: async () => shown, otherSeats: [4] });
  const reading = (inputs: SmokeWalk['inputs'], fieldsMet: SmokeWalk['fieldsMet'] = new Map()) => walk({ inputs, fieldsMet });

  it('is ready when every input of the action that reads the page gives a value', async () => {
    const w = reading({ greet: { whom: async ({ texts }: SmokeInputView) => (await texts('li'))[0], note: 'hi' } });
    expect(await readyToTake(w, 'greet', page(['seat 4']))).toBe(true);
    expect(await readyToTake(w, 'greet', page([]))).toBe(false);
  });

  it('is never ready for an action whose inputs read nothing off the page', async () => {
    expect(await readyToTake(reading({ greet: { whom: 'seat 4' } }), 'greet', page(['x']))).toBe(false);
    expect(await readyToTake(reading({}), 'greet', page(['x']))).toBe(false);
  });

  it('checks the value for a number field the walk has met as a number', async () => {
    const inputs = { bid: { amount: async ({ texts }: SmokeInputView) => (await texts('.price'))[0] } };
    const met = new Map([['bid', new Map([['amount', 'number' as const]])]]);
    expect(await readyToTake(reading(inputs, met), 'bid', page(['forty']))).toBe(false);
    expect(await readyToTake(reading(inputs, met), 'bid', page(['40']))).toBe(true);
  });
});

describe('#470: the values a spec gives the walk to type, in `inputs`', () => {
  /** A page whose elements, by selector, read as `shown`. */
  const page = (shown: Record<string, string[]> = {}, otherSeats: number[] = []): SmokeInputView => ({
    texts: async (selector) => shown[selector] ?? [],
    otherSeats,
  });

  it('gives no value for a field the spec names none for, so the walk types its own', async () => {
    expect(await inputFor({}, 'attack', 'target', 'text', page())).toBeUndefined();
    expect(await inputFor({ attack: { weapon: 'axe' } }, 'attack', 'target', 'text', page())).toBeUndefined();
    expect(await inputFor({ attack: { target: 'p2' } }, 'heal', 'target', 'text', page())).toBeUndefined();
    // Only the spec's own keys: an action named like an object's built-in member gets nothing from it.
    expect(await inputFor({}, 'constructor', 'name', 'text', page())).toBeUndefined();
  });

  it('gives the text or number the spec names for the field, as text to type', async () => {
    expect(await inputFor({ attack: { target: 'p2' } }, 'attack', 'target', 'text', page())).toEqual({ value: 'p2' });
    expect(await inputFor({ bid: { amount: 40 } }, 'bid', 'amount', 'number', page())).toEqual({ value: '40' });
  });

  it('gives what a function of the page returns, reading what a player reads there', async () => {
    const inputs = { attack: { target: async ({ texts }: SmokeInputView) => (await texts('.nearby li'))[0] } };
    expect(await inputFor(inputs, 'attack', 'target', 'text', page({ '.nearby li': ['p2', 'p3'] }))).toEqual({ value: 'p2' });
  });

  it('#471: gives a function the other seats the walk plays, so it can name a player standing with this one', async () => {
    const inputs = {
      attack: {
        target: async ({ texts, otherSeats }: SmokeInputView) => (await texts('.nearby li')).find((name) => otherSeats.some((seat) => name === `p${seat}`)),
      },
    };
    expect(await inputFor(inputs, 'attack', 'target', 'text', page({ '.nearby li': ['p9', 'p4'] }, [4]))).toEqual({ value: 'p4' });
    expect(await inputFor(inputs, 'attack', 'target', 'text', page({ '.nearby li': ['p9'] }, [4]))).toEqual({ wanting: true });
  });

  it('says the page gives no value yet when the function returns nothing, or blank text', async () => {
    const inputs = { attack: { target: async ({ texts }: SmokeInputView) => (await texts('.nearby li'))[0] } };
    expect(await inputFor(inputs, 'attack', 'target', 'text', page())).toEqual({ wanting: true });
    expect(await inputFor({ attack: { target: () => '   ' } }, 'attack', 'target', 'text', page())).toEqual({ wanting: true });
  });

  it('refuses a value for a number field that is not a number, naming the input', async () => {
    expect(await inputFor({ pledge: { coins: 'seven' } }, 'pledge', 'coins', 'number', page())).toEqual({
      problem: `\`inputs.pledge.coins\` in ${SMOKE_SPEC_PATH} gives "seven" for a number field. Give a number, such as 7.`,
    });
    expect(await inputFor({ pledge: { coins: () => '7x' } }, 'pledge', 'coins', 'number', page())).toEqual({
      problem: `\`inputs.pledge.coins\` in ${SMOKE_SPEC_PATH} gives "7x" for a number field. Give a number, such as 7.`,
    });
    expect(await inputFor({ pledge: { coins: ' 7 ' } }, 'pledge', 'coins', 'number', page())).toEqual({ value: '7' });
  });

  it('says which input failed, and how, when its function throws', async () => {
    const inputs = { attack: { target: () => { throw new Error('no such list'); } } };
    expect(await inputFor(inputs, 'attack', 'target', 'text', page())).toEqual({
      problem: `\`inputs.attack.target\` in ${SMOKE_SPEC_PATH} failed while the walk answered "attack": no such list`,
    });
  });

  it('fails a spec whose inputs name an action `actions` does not list, or give blank text', () => {
    expect(smokeProblems(walk({ listed: ['attack'], taken: new Set(['attack']), inputs: { atack: { target: 'p2' }, attack: { target: ' ' } } }))).toEqual([
      `${SMOKE_SPEC_PATH} gives \`inputs\` for "atack", but \`actions\` does not list it. Name the action as \`actions\` ` +
        'does, or remove it from `inputs` if the game no longer has it.',
      `\`inputs.attack.target\` in ${SMOKE_SPEC_PATH} is blank, so the walk would type nothing there. Give the text a ` +
        'player types in that field.',
    ]);
  });

  it('fails an input whose field the walk never met in an action it opened, as a misspelt pick name is, naming those it met', () => {
    const opened = walk({
      listed: ['wave', 'greet'],
      taken: new Set(['wave', 'greet']),
      inputs: { wave: { whim: 'p2', whom: 'p2' }, greet: { whom: 'p2' } },
      fieldsMet: new Map([['wave', new Map([['whom', 'text' as const]])]]),
    });
    expect(smokeProblems(opened)).toEqual([
      `\`inputs.wave.whim\` in ${SMOKE_SPEC_PATH} names a field the walk never met in "wave", whose fields it met are ` +
        '"whom". Name the field by the pick name its rules give it.',
    ]);
    // An action the walk gave up on before it reached any field says nothing about the names.
    const stopped = walk({ listed: ['wave'], taken: new Set(), inputs: { wave: { whim: 'p2' } }, fieldsMet: new Map([['wave', new Map()]]) });
    expect(smokeProblems(stopped).filter((p) => p.includes('never met'))).toEqual([]);
  });

  it('says why the walk never took an action whose input the page never gave', () => {
    const wanted = walk({ listed: ['attack'], offered: new Set(['attack']), enabled: new Set(['attack']), wanting: new Map([['attack', 'target']]), steps: 30 });
    expect(smokeProblems(wanted)).toEqual([
      `The panel offered "attack", but the walk never took it in 30 steps: when it last opened it, \`inputs.attack.target\` ` +
        `in ${SMOKE_SPEC_PATH} gave no text for its field "target", so the walk cancelled it. Make it return the text a ` +
        'player would type there whenever the game offers the action.',
    ]);
  });

  describe('actionFailed: an action the game refused', () => {
    it('says what the game said, as before, when the walk typed nothing', () => {
      expect(actionFailed('draw', 'the deck is empty', [], 0)).toBe('The panel offered "draw", and taking it failed: the deck is empty');
      expect(actionFailed('draw', undefined, [], 0)).toBe('The panel offered "draw", and taking it failed: no reason given');
    });

    it('names the value the spec gave, so a refused input fails the walk and says which', () => {
      expect(actionFailed('attack', "There's no one here by that name.", [{ field: 'target', value: 'p2', from: 'inputs', kind: 'text' }], 0)).toBe(
        `The panel offered "attack", and taking it failed: There's no one here by that name. The walk typed "p2" in its ` +
          `field "target", as \`inputs.attack.target\` in ${SMOKE_SPEC_PATH} gives it.`,
      );
    });

    it('names the text the walk typed itself, and says how to give the game the text it needs', () => {
      expect(actionFailed('attack', "There's no one here by that name.", [{ field: 'target', value: 'smoke test', from: 'walk', kind: 'text' }], 0)).toBe(
        `The panel offered "attack", and taking it failed: There's no one here by that name. The walk typed "smoke test" ` +
          `in its field "target". If the game needs a particular value there, such as a name the board shows, give it in ` +
          `\`inputs\` in ${SMOKE_SPEC_PATH}.`,
      );
    });

    it("names what the walk typed in an action whose rules crashed, without suggesting the game wants another value", () => {
      const crash = `${rulesErrorSentence('kindle')} Nothing was changed. (the hearth cracked)`;
      expect(actionFailed('kindle', crash, [{ field: 'logs', value: '1', from: 'walk', kind: 'number' }], 0)).toBe(
        `The panel offered "kindle", and taking it failed: ${crash} The walk typed "1" in its field "logs".`,
      );
    });

    it('says how many numbers the game refused, when it refused every one the walk tried', () => {
      expect(actionFailed('kindle', 'Too few logs.', [{ field: 'logs', value: '3', from: 'walk', kind: 'number' }], 2)).toBe(
        'The panel offered "kindle", and taking it failed: Too few logs. The game refused each of the 3 numbers the walk ' +
          `entered. The walk typed "3" in its field "logs". If the game needs a particular value there, such as a name the ` +
          `board shows, give it in \`inputs\` in ${SMOKE_SPEC_PATH}.`,
      );
    });
  });
});

describe('recordResolved: what a resolved action leaves the walk remembering (#466)', () => {
  function memory(): ResolvedMemory {
    return {
      resolved: new Map(),
      lastResolved: undefined,
      failed: new Set(),
      refused: new Map(),
      refusals: new Set(),
      typed: new Map(),
      moves: 0,
    };
  }
  const failed = (action: string, error: string) => ({ action, success: false, error });
  /** The walk typed `value` in the number field `field` of `action`, a number it chose itself. */
  const typedANumber = (m: ResolvedMemory, action: string, field: string, value: string, from: 'walk' | 'inputs' = 'walk') =>
    m.typed.set(action, [{ field, value, from, kind: 'number' }]);

  it('#471: names the browser a failed action was taken in, in a world walk of several seats', () => {
    const w = walk({});
    recordResolved([failed('arrive', 'The glade is shut.')], w, memory(), "In seat 4's browser: ");
    expect(w.errors).toEqual([`In seat 4's browser: The panel offered "arrive", and taking it failed: The glade is shut.`]);
  });

  it('records a taken action as offered, enabled and taken, and reports one that failed, which is not taken again', () => {
    const w = walk({});
    const m = memory();
    recordResolved([{ action: 'draw', success: true }, failed('play', 'No card to play.')], w, m);
    expect([...w.taken]).toEqual(['draw']);
    expect([...w.offered].sort()).toEqual(['draw', 'play']);
    expect(m.resolved.get('draw')).toBe(1);
    expect(m.lastResolved).toBe('draw');
    expect([...m.failed]).toEqual(['play']);
    expect(w.errors).toEqual(['The panel offered "play", and taking it failed: No card to play.']);
  });

  it('takes a failure after a typed number for the game refusing it, up to three numbers, then reports the action with how many it refused', () => {
    const w = walk({});
    const m = memory();
    for (const [logs, error] of [['1', 'A fire needs two logs.'], ['2', 'A fire needs three logs.']]) {
      typedANumber(m, 'kindle', 'logs', logs);
      recordResolved([failed('kindle', error)], w, m);
    }
    expect(w.errors).toEqual([]);
    expect(m.failed.size).toBe(0);
    expect(m.refused.get('kindle')).toBe(2);
    expect([...m.refusals]).toEqual(['A fire needs two logs.', 'A fire needs three logs.']);
    // The typed number is spent either way, so the next attempt types the next one up.
    expect(m.typed.has('kindle')).toBe(false);

    typedANumber(m, 'kindle', 'logs', '3');
    recordResolved([failed('kindle', 'A fire needs four logs.')], w, m);
    expect(w.errors).toEqual([
      'The panel offered "kindle", and taking it failed: A fire needs four logs. The game refused each of the 3 numbers the walk ' +
        `entered. The walk typed "3" in its field "logs". If the game needs a particular value there, such as a name the board ` +
        `shows, give it in \`inputs\` in ${SMOKE_SPEC_PATH}.`,
    ]);
    expect([...m.failed]).toEqual(['kindle']);
  });

  it('clears the typed number when the action succeeds, so a later failure without one is reported, not taken for a refused number', () => {
    const w = walk({});
    const m = memory();
    typedANumber(m, 'kindle', 'logs', '2');
    recordResolved([{ action: 'kindle', success: true }], w, m);
    expect(m.typed.has('kindle')).toBe(false);

    recordResolved([failed('kindle', 'The hearth is cold.')], w, m);
    expect(w.errors).toEqual(['The panel offered "kindle", and taking it failed: The hearth is cold.']);
    expect(m.refused.get('kindle')).toBeUndefined();
  });

  it('#470: reports a failed action with what the walk typed in it, and counts each taken action as the game moving on', () => {
    const w = walk({ wanting: new Map([['greet', 'whom'], ['wave', 'whom']]) });
    const m = memory();
    const nobody = { field: 'whom', value: 'Nobody', from: 'inputs', kind: 'text' } as const;
    m.typed.set('greet', [nobody]);
    recordResolved([failed('greet', 'Nobody is called that.'), { action: 'wave', success: true }], w, m);
    expect(w.errors).toEqual([actionFailed('greet', 'Nobody is called that.', [nobody], 0)]);
    expect(m.typed.size).toBe(0);
    // Resolved either way, so neither is waiting on an input any more; only the taken one moved the game on.
    expect(w.wanting.size).toBe(0);
    expect(m.moves).toBe(1);
  });

  it('#470: reports a number from `inputs` the game refuses at once, never trying the next one up: it is the spec\'s answer', () => {
    const w = walk({});
    const m = memory();
    typedANumber(m, 'pledge', 'coins', '3', 'inputs');
    recordResolved([failed('pledge', 'The pot takes seven coins.')], w, m);
    expect(w.errors).toEqual([
      'The panel offered "pledge", and taking it failed: The pot takes seven coins. The walk typed "3" in its field "coins", ' +
        `as \`inputs.pledge.coins\` in ${SMOKE_SPEC_PATH} gives it.`,
    ]);
    expect(m.refused.get('pledge')).toBeUndefined();
    expect([...m.failed]).toEqual(['pledge']);
  });

  it('#470: tells the numbers apart by field: a refusal is the walk\'s to answer with the next number up only when it chose a number', () => {
    const w = walk({});
    const m = memory();
    m.typed.set('bid', [
      { field: 'note', value: 'smoke test', from: 'walk', kind: 'text' },
      { field: 'amount', value: '40', from: 'inputs', kind: 'number' },
    ]);
    recordResolved([failed('bid', 'Too low.')], w, m);
    expect(m.refused.get('bid')).toBeUndefined();
    expect(w.errors).toHaveLength(1);
  });

  it('never takes a failure the engine words as an error in the rules for a refused number, whatever the walk typed', () => {
    const w = walk({});
    const m = memory();
    typedANumber(m, 'kindle', 'logs', '1');
    recordResolved([failed('kindle', `${rulesErrorSentence('kindle')} (the hearth cracked)`)], w, m);
    expect(w.errors).toHaveLength(1);
    expect(w.errors[0]).toContain('taking it failed: The "kindle" action could not be completed');
    expect(m.refused.get('kindle')).toBeUndefined();
  });
});
