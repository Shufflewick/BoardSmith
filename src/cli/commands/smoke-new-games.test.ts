/**
 * The in-browser smoke check (#453), run for real: a walk over several games, one after another
 * (#458, #459). smoke-walk.test-helper.ts says how each walk runs. The check's tests are split
 * across the smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { QUIET_CLAIM_REASON, smokeSpec, truceGame } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

describe('boardsmith verify: the smoke check', () => {
  it(
    '#458, #459: takes a game-ending action once and starts a new game for the rest, then stops taking it so a game can go ' +
      'on, acts for the other seat to accept an offer, ' +
      'completes a two-card pick in the panel and a two-to-three-card pick on the board, and does not require the action the spec declares out of reach',
    async () => {
      const { outcome } = await smokeOf(false, {
        ...truceGame(),
        'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
          claimTruce: QUIET_CLAIM_REASON,
        }),
      });

      expect(outcome.summary).toMatch(
        /^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "acceptTruce", "concede", "draw", "offerTruce", "play", "rally", "trade" and pressed \d+ board controls?, with no error, over [3-9] games \(a new one each time a game ended with listed actions still to take\)\. Not required, as tests\/browser\/smoke\.spec\.ts says a walk from a fresh game cannot reach them: "claimTruce" \("Offered only after forty rounds in which nobody played a card, and the walk plays cards every round\."\)\.$/,
      );
      expect(outcome.passed).toBe(true);
    },
  );

  it('#458: reports an action the spec declares out of reach that the walk took anyway, so the declaration can go', async () => {
    const { outcome } = await smokeOf(false, {
      ...truceGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
        acceptTruce: 'Only the other seat may accept a truce, and a walk plays one seat.',
        claimTruce: QUIET_CLAIM_REASON,
      }),
    });

    expect(outcome.passed).toBe(true);
    expect(outcome.summary).toMatch(
      /The walk took "acceptTruce", which tests\/browser\/smoke\.spec\.ts says a walk from a fresh game cannot reach: remove it from `unreachable` there, so the walk requires it\.$/,
    );
  });

  it('#458: fails on an error raised only in a later game, after the first one ended, and walks on past it', async () => {
    const { outcome } = await smokeOf(false, {
      ...truceGame({ acceptTruceFails: true }),
      'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
        claimTruce: QUIET_CLAIM_REASON,
      }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(/- The panel offered "acceptTruce", and taking it failed: .*the truce table collapsed/);
    // The failure is reported once, and the walk goes on rather than retrying it: it still reaches
    // "rally", which only a game that goes on after the failure offers.
    expect(outcome.summary.match(/taking it failed/g)).toHaveLength(1);
    expect(outcome.summary).not.toContain('"rally"');
  });
});
