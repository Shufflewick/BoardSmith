#!/usr/bin/env node
/**
 * A BOARD THAT FITS SHOWS NO SCROLL BAR WHILE THE BAR STAYS DOWN (#1525).
 *
 * A game that starts the Action Panel put down and keeps it from opening for
 * actions (`action-bar-starts-collapsed`, `:action-bar-opens-for-actions="false"`)
 * has nothing floating over its board but the thin line, until the player's own
 * toggle. The board region still ended in scroll room for a two-row
 * bar, so it scrolled, and the collapsed bar's 20px dots hung below its 14px
 * line, off the bottom of the screen, so the page scrolled too.
 *
 * Served from `boardsmith init`'s table sample with that App.vue and a board
 * that fits the region at 1440px and at 390px, in Chromium with classic
 * (space-taking) scrollbars. Neither the game's page nor its board region may scroll.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/fitted-board-no-scroll-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const APP = `<script setup lang="ts">
import { GameShell } from 'boardsmith/ui';
import uis from './uis.js';
</script>

<template>
  <GameShell :uis="uis" action-bar-starts-collapsed :action-bar-opens-for-actions="false" />
</template>
`;

// Small enough to fit the region at both widths, as the board is never zoomed to fit (#1608).
const TALL_BOARD = `<template>
  <div class="tall-board"></div>
</template>

<style>
.tall-board { width: 300px; height: 500px; background: rebeccapurple; }
</style>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Tall from './components/Tall.vue';

export default defineGameUIs({ Tall: defaultUI(Tall) });
`;

/** How far the frame's page and its board region scroll, and whether the board fits the region. */
function overflow(frame) {
  return frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const page = doc.scrollingElement;
    const region = doc.querySelector('.boardregion');
    const board = doc.querySelector('.game-shell__zoom-container').getBoundingClientRect();
    const box = region.getBoundingClientRect();
    return {
      page: { down: page.scrollHeight - page.clientHeight, sideways: page.scrollWidth - page.clientWidth },
      region: { down: region.scrollHeight - region.clientHeight, sideways: region.scrollWidth - region.clientWidth },
      fits: board.bottom <= box.top + region.clientHeight && board.right <= box.left + region.clientWidth,
      barDown: doc.querySelector('.actionbar.collapsed') !== null,
    };
  });
}

// Chromium only: classic scrollbars are what it measures, and WebKit cannot show them.
await runBrowserRegression(
  { script: 'fitted-board-no-scroll-browser.mjs', engines: ['chromium'], table: { files: { 'src/ui/App.vue': APP, 'src/ui/uis.ts': UIS, 'src/ui/components/Tall.vue': TALL_BOARD } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch({ classicScrollbars: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const frame = page.frameLocator('.dev-host__frame');
      await page.goto(hostUrl);
      await frame.locator('.tall-board').waitFor({ timeout: 60_000 });
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const at = `${viewport.width}px`;
        await page.setViewportSize(viewport);
        const seen = await waitUntil(() => overflow(frame), (now) => now.barDown && now.fits, 10_000);
        await check(`${at}: the bar is down and the board fits its region`, () => {
          assert(seen.barDown, 'the Action Panel is not down');
          assert(seen.fits, 'the board is larger than its region, so scrolling it is expected');
        });
        await check(`${at}: the board region does not scroll`, () => {
          assert(seen.region.down <= 0 && seen.region.sideways <= 0,
            `the region scrolls ${seen.region.down}px down and ${seen.region.sideways}px sideways`);
        });
        await check(`${at}: the page does not scroll`, () => {
          assert(seen.page.down <= 0 && seen.page.sideways <= 0,
            `the page scrolls ${seen.page.down}px down and ${seen.page.sideways}px sideways`);
        });
      }
    } finally {
      await browser.close();
    }
    return summarise('with a board that fits and the action bar kept down');
  },
);
