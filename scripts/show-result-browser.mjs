#!/usr/bin/env node
/**
 * A STUCK HOLD CANNOT HIDE A FINISHED GAME'S RESULT FOR GOOD.
 *
 * A board that holds its ending back (`holdGameOverUntil`) while it replays the
 * deciding moment can get stuck, and then the result, its announcement and
 * `game_over_shown` never come. GameShell offers "Show result" while a hold
 * keeps a finished game's ending back; pressing it reveals the ending.
 *
 * Served from `boardsmith init`'s table sample with a board whose hold never
 * releases and whose replay is a modal teleported into `#bs-game-modal`, the
 * layer a stuck replay most likely sits in. At 1440px and 390px the button must
 * sit over that modal, and a real click on it must bring up the game-over card.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/show-result-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

const STUCK_BOARD = `<template>
  <div>board</div>
  <Teleport to="#bs-game-modal" defer>
    <div v-if="gameState?.flowState?.complete" class="stuck-replay">Replaying the final hand</div>
  </Teleport>
</template>

<script setup lang="ts">
import { holdGameOverUntil, useGameContext } from 'boardsmith/ui';

const { gameState } = useGameContext();
holdGameOverUntil(() => false);
</script>

<style>
.stuck-replay { position: absolute; inset: 0; background: rebeccapurple; color: white; }
</style>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Stuck from './components/Stuck.vue';

export default defineGameUIs({ Stuck: defaultUI(Stuck) });
`;

const WIDTHS = [1440, 390];

await runBrowserRegression(
  { script: 'show-result-browser.mjs', table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Stuck.vue': STUCK_BOARD } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: WIDTHS[0], height: 900 } });
      const frame = await openTableSample(page, hostUrl);
      // Driving is not under test: the sample's first offered choice, until the stuck replay shows.
      await frame.locator('body').evaluate(async (body) => {
        const doc = body.ownerDocument;
        for (let step = 0; step < 2000 && !doc.querySelector('.stuck-replay'); step++) {
          doc.querySelector('[data-testid="bs-actionbar"] .choice-btn')?.click();
          await new Promise((settle) => setTimeout(settle, 100));
        }
      });
      await frame.locator('.stuck-replay').waitFor({ timeout: 10_000 });
      const button = frame.getByRole('button', { name: 'Show result' });

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        await check(`a finished game held by a stuck replay shows no card, and Show result sits over the replay, at ${width}px`, async () => {
          assert((await frame.locator('.game-over-card').count()) === 0, 'the game-over card showed while the board held the ending');
          const on = await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const top = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return el.contains(top) ? null : top?.className || top?.tagName || 'nothing';
          });
          assert(on === null, `a pointer over Show result lands on "${on}" instead`);
        });
      }

      await check('Show result takes a real click and reveals the result', async () => {
        await button.click({ timeout: 5_000 });
        await frame.locator('.game-over-card').waitFor({ timeout: 5_000 });
        assert((await button.count()) === 0, 'Show result stayed after the result showed');
      });
    } finally {
      await browser.close();
    }
    return summarise('for a finished game whose hold never releases');
  },
);
