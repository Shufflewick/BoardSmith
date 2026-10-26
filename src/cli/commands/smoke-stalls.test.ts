/**
 * The in-browser smoke check (#453), run for real: a walk that nothing is offered to for a while
 * (#460, #473). smoke-walk.test-helper.ts says how each walk runs. The check's tests are split
 * across the smoke*.test.ts files so they run side by side (#1319).
 */
import { describe, expect, it, vi } from 'vitest';
import { smokeOf } from './smoke-walk.test-helper.js';
import { kettleGame, QUIET_CLAIM_REASON, smokeSpec, truceGame } from './smoke-fixtures.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

/** The scaffold's App.vue for a game whose action bar starts collapsed (#1439). */
const COLLAPSED_BAR_APP = `<script setup lang="ts">
import { GameShell } from 'boardsmith/ui';
import uis from './uis.js';
</script>

<template>
  <GameShell :uis="uis" action-bar-starts-collapsed />
</template>
`;

describe('boardsmith verify: the smoke check', () => {
  it('#1482: opens an action bar the game starts collapsed, as a player does, rather than reporting a stall', async () => {
    const { outcome } = await smokeOf(false, {
      ...truceGame(),
      'src/ui/App.vue': COLLAPSED_BAR_APP,
      'tests/browser/smoke.spec.ts': smokeSpec(['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'], {
        claimTruce: QUIET_CLAIM_REASON,
      }),
    });

    expect(outcome.summary).toMatch(/a seated player took "acceptTruce", "concede", "draw", "offerTruce", "play", "rally", "trade"/);
    expect(outcome.passed).toBe(true);
  });

  it('#460: says a walk that stopped because nothing was offered for a while stopped for that, not for want of steps', async () => {
    // A world's plot has two rows that each grow five times, so after ten tends nothing is offered
    // until the clock ripens them, ten minutes on. "harvest" is listed and the world never offers it.
    const { outcome } = await smokeOf(true, { 'tests/browser/smoke.spec.ts': smokeSpec(['tend', 'harvest']) });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /- The walk never saw "harvest" offered\. It stopped at step \d+, because no seat had been offered anything for 30s, so more `steps` would not help\./,
    );
    expect(outcome.summary).not.toMatch(/raise `steps`/);
  });

  it('#473: fails a table game that hangs once every listed action was taken, naming the step and the deal it stalled at', async () => {
    const { outcome } = await smokeOf(false, {
      ...kettleGame(),
      'tests/browser/smoke.spec.ts': smokeSpec(['draw', 'wait'], { wait: 'Greyed out until the kettle boils, and in this game it never does.' }),
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.summary).toMatch(
      /^The smoke walk, dealt from seed "smoke", found a problem: - The game stalled at step \d+ of the game dealt from seed "smoke": no seat was offered anything for 30s, and the game was not over, so the players at that table could never finish it\./,
    );
  });
});
