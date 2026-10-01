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
  SMOKE_SPEC_PATH,
  startAnswering,
  walkStopped,
  smokeFailure,
  smokeProblems,
  smokeRecord,
  smokeSeeds,
  smokeSummary,
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

const REASON = 'Offered only after fifty quiet moves, which a walk from a fresh game never plays.';

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
    expect(smokeProblems(walk({ listed: ['draw', 'score'], offered: new Set(['draw']), steps: 12 }))).toEqual([
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

  it('#460: says a walk that stopped because nothing was offered stopped for that, and does not suggest more steps', () => {
    const stalled = walk({ listed: ['draw', 'score'], offered: new Set(['draw']), taken: new Set(['draw']), stalls: [{ step: 9, seed: 'smoke', seconds: 30 }] });
    expect(smokeProblems(stalled)).toEqual([
      `The walk never saw "score" offered. It stopped at step 9 of the game dealt from seed "smoke", because no seat had ` +
        'been offered anything for 30s, so more `steps` would not help. Run `boardsmith smoke` to watch where the game ' +
        'stops offering actions: a step no seat can act in, or one waiting on something no player does. Fix that, then run it again.',
    ]);
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
    expect(record).toEqual({ seeds: ['smoke'], taken: ['draw', 'play'], controls: 1, games: 1, excused: [], reachedAnyway: [] });
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

describe('#470: the values a spec gives the walk to type, in `inputs`', () => {
  /** A page whose elements, by selector, read as `shown`. */
  const page = (shown: Record<string, string[]> = {}): SmokeInputView => ({ texts: async (selector) => shown[selector] ?? [] });

  it('gives no value for a field the spec names none for, so the walk types its own', async () => {
    expect(await inputFor({}, 'attack', 'target', page())).toBeUndefined();
    expect(await inputFor({ attack: { weapon: 'axe' } }, 'attack', 'target', page())).toBeUndefined();
    expect(await inputFor({ attack: { target: 'p2' } }, 'heal', 'target', page())).toBeUndefined();
    // Only the spec's own keys: an action named like an object's built-in member gets nothing from it.
    expect(await inputFor({}, 'constructor', 'name', page())).toBeUndefined();
  });

  it('gives the text or number the spec names for the field, as text to type', async () => {
    expect(await inputFor({ attack: { target: 'p2' } }, 'attack', 'target', page())).toEqual({ value: 'p2' });
    expect(await inputFor({ bid: { amount: 40 } }, 'bid', 'amount', page())).toEqual({ value: '40' });
  });

  it('gives what a function of the page returns, reading what a player reads there', async () => {
    const inputs = { attack: { target: async ({ texts }: SmokeInputView) => (await texts('.nearby li'))[0] } };
    expect(await inputFor(inputs, 'attack', 'target', page({ '.nearby li': ['p2', 'p3'] }))).toEqual({ value: 'p2' });
  });

  it('says the page gives no value yet when the function returns nothing, or blank text', async () => {
    const inputs = { attack: { target: async ({ texts }: SmokeInputView) => (await texts('.nearby li'))[0] } };
    expect(await inputFor(inputs, 'attack', 'target', page())).toEqual({ wanting: true });
    expect(await inputFor({ attack: { target: () => '   ' } }, 'attack', 'target', page())).toEqual({ wanting: true });
  });

  it('says which input failed, and how, when its function throws', async () => {
    const inputs = { attack: { target: () => { throw new Error('no such list'); } } };
    expect(await inputFor(inputs, 'attack', 'target', page())).toEqual({
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
      expect(actionFailed('attack', "There's no one here by that name.", [{ field: 'target', value: 'p2', from: 'inputs' }], 0)).toBe(
        `The panel offered "attack", and taking it failed: There's no one here by that name. The walk typed "p2" in its ` +
          `field "target", as \`inputs.attack.target\` in ${SMOKE_SPEC_PATH} gives it.`,
      );
    });

    it('names the text the walk typed itself, and says how to give the game the text it needs', () => {
      expect(actionFailed('attack', "There's no one here by that name.", [{ field: 'target', value: 'smoke test', from: 'walk' }], 0)).toBe(
        `The panel offered "attack", and taking it failed: There's no one here by that name. The walk typed "smoke test" ` +
          `in its field "target". If the game needs a particular value there, such as a name the board shows, give it in ` +
          `\`inputs\` in ${SMOKE_SPEC_PATH}.`,
      );
    });

    it("names what the walk typed in an action whose rules crashed, without suggesting the game wants another value", () => {
      const crash = `${rulesErrorSentence('kindle')} Nothing was changed. (the hearth cracked)`;
      expect(actionFailed('kindle', crash, [{ field: 'logs', value: '1', from: 'walk' }], 0)).toBe(
        `The panel offered "kindle", and taking it failed: ${crash} The walk typed "1" in its field "logs".`,
      );
    });

    it('says how many numbers the game refused, when it refused every one the walk tried', () => {
      expect(actionFailed('kindle', 'Too few logs.', [{ field: 'logs', value: '3', from: 'walk' }], 2)).toBe(
        'The panel offered "kindle", and taking it failed: Too few logs. The game refused each of the 3 numbers the walk ' +
          `entered. The walk typed "3" in its field "logs". If the game needs a particular value there, such as a name the ` +
          `board shows, give it in \`inputs\` in ${SMOKE_SPEC_PATH}.`,
      );
    });
  });
});
