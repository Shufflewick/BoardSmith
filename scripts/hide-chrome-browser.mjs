#!/usr/bin/env node
/**
 * A BOARD HIDES THE SHELL'S CHROME TO SHOW THE FIELD (#1538).
 *
 * A board that calls `useHideChrome` asks GameShell to hide the players panel
 * (the phone strip) and the action bar. jsdom can say they are `display: none`,
 * but not that the board region then reaches the screen's edges, which is what
 * the player pressing "Hide controls" wants. So at 1440px and 390px, in real
 * Chromium over the dev host, the board's own button hides the chrome, the board
 * region fills the whole frame, and pressing it again brings the chrome back.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/hide-chrome-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

const FIELD_BOARD = `<template>
  <button type="button" class="eye" @click="fieldOnly = !fieldOnly">{{ fieldOnly ? 'Show controls' : 'Hide controls' }}</button>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useHideChrome } from 'boardsmith/ui';

const fieldOnly = ref(false);
useHideChrome(() => fieldOnly.value);
</script>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Field from './components/Field.vue';

export default defineGameUIs({ Field: defaultUI(Field) });
`;

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

await runBrowserRegression(
  { script: 'hide-chrome-browser.mjs', engines: ['chromium', 'webkit'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Field.vue': FIELD_BOARD } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: VIEWPORTS[0] });
      const frame = await openTableSample(page, hostUrl);
      const eye = frame.locator('.eye');
      /** What the player sees: whether each piece of chrome shows, and the board region's box against the frame's. */
      const layout = () => frame.locator('body').evaluate((body) => {
        const doc = body.ownerDocument;
        const shows = (selector) => doc.querySelector(selector).checkVisibility();
        const region = doc.querySelector('.board-viewport').getBoundingClientRect();
        const view = doc.documentElement.getBoundingClientRect();
        return {
          seats: shows('[data-testid="bs-seats"]'),
          actionBar: shows('[data-testid="bs-actionbar"]'),
          toggle: shows('[data-testid="bs-actionbar-toggle"]'),
          fillsFrame: region.left === view.left && region.top === view.top && region.width === view.width && region.height === doc.documentElement.clientHeight,
          reserved: getComputedStyle(doc.querySelector('.boardregion')).paddingBottom,
          overlap: getComputedStyle(doc.querySelector('.board-viewport')).getPropertyValue('--bsg-panel-overlap'),
        };
      });

      for (const viewport of VIEWPORTS) {
        const { width } = viewport;
        await page.setViewportSize(viewport);
        await check(`the board's button hides the players panel and the action bar, and the field fills the frame, at ${width}px`, async () => {
          await eye.click();
          await frame.getByRole('button', { name: 'Show controls' }).waitFor({ timeout: 5_000 });
          const hidden = await layout();
          assert(!hidden.seats && !hidden.actionBar && !hidden.toggle, `chrome still shows: ${JSON.stringify(hidden)}`);
          assert(hidden.fillsFrame, `the board region does not fill the frame: ${JSON.stringify(hidden)}`);
          assert(hidden.reserved === '0px', `the region still reserves ${hidden.reserved} for a hidden bar`);
          assert(hidden.overlap === '0px', `--bsg-panel-overlap keeps a game overlay ${hidden.overlap} clear of a hidden bar`);
        });
        await check(`pressing it again brings the chrome back, at ${width}px`, async () => {
          await eye.click();
          await frame.getByRole('button', { name: 'Hide controls' }).waitFor({ timeout: 5_000 });
          const shown = await layout();
          assert(shown.seats && shown.actionBar && shown.toggle, `chrome did not come back: ${JSON.stringify(shown)}`);
          assert(!shown.fillsFrame, 'the board region still fills the frame with the chrome back');
        });
      }
    } finally {
      await browser.close();
    }
    return summarise('for a board that hides the chrome to show the field');
  },
);
