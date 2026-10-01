/**
 * What the in-browser smoke walk reports once it has walked (#453). The walk itself runs in
 * Chromium under `boardsmith verify`; its verdict is decided here, from what it saw.
 */
import { describe, expect, it } from 'vitest';
import { SMOKE_SPEC_PATH, smokeProblems, type SmokeWalk } from './browser-smoke-verdict.js';

function walk(overrides: Partial<SmokeWalk>): SmokeWalk {
  return { listed: [], offered: new Set(), taken: new Set(), steps: 60, errors: [], ...overrides };
}

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
      `The walk never saw "score" offered in 12 steps from a fresh game. If a fresh game takes longer to reach it, raise \`steps\` in ${SMOKE_SPEC_PATH}; if the game no longer has it, remove it from \`actions\`.`,
    ]);
  });
});
