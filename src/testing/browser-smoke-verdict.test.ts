/**
 * What the in-browser smoke walk reports once it has walked (#453). The walk itself runs in
 * Chromium under `boardsmith verify`; its verdict is decided here, from what it saw.
 */
import { describe, expect, it } from 'vitest';
import { SMOKE_SPEC_PATH, smokeProblems, smokeRecord, smokeSummary, type SmokeWalk } from './browser-smoke-verdict.js';

function walk(overrides: Partial<SmokeWalk>): SmokeWalk {
  return { listed: [], unreachable: {}, offered: new Set(), enabled: new Set(), taken: new Set(), steps: 60, errors: [], ...overrides };
}

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
      `The walk never saw "score" offered in 12 steps from a fresh game. If a fresh game takes longer to reach it, raise ` +
        `\`steps\` in ${SMOKE_SPEC_PATH}. If no walk from a fresh game can reach it (it needs a long game, or a position ` +
        `play does not get to), name it in \`unreachable\` there with the reason. If the game no longer has it, remove it from \`actions\`.`,
    ]);
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
  it('says what was taken and pressed, in one game, with no error', () => {
    const record = smokeRecord(walk({ listed: ['draw', 'play'], taken: new Set(['play', 'draw']) }), { controls: 1, games: 1 });
    expect(record).toEqual({ taken: ['draw', 'play'], controls: 1, games: 1, excused: [], reachedAnyway: [] });
    expect(smokeSummary(record)).toBe(
      'Served by `boardsmith dev` from a fresh start, a seated player took "draw", "play" and pressed 1 board control, with no error.',
    );
  });

  it('says how many games the walk played, and which declared actions it did not require', () => {
    const record = smokeRecord(
      walk({ listed: ['move', 'resign', 'claim'], unreachable: { claim: REASON }, taken: new Set(['move', 'resign']) }),
      { controls: 0, games: 2 },
    );
    expect(record).toMatchObject({ games: 2, excused: [{ action: 'claim', reason: REASON }], reachedAnyway: [] });
    expect(smokeSummary(record)).toBe(
      'Served by `boardsmith dev` from a fresh start, a seated player took "move", "resign" and pressed 0 board controls, ' +
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
