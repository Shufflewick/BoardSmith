#!/usr/bin/env node
/**
 * ON A PHONE THE BOARD'S SCROLL ROOM IS ONLY WHAT THE BAR HAS COVERED (#1755).
 *
 * The board region ends in scroll room so the player can scroll what the
 * Action Panel covers into view. It was sized for a menu level's cap, half the
 * screen on an upright phone, whatever the bar showed, and stayed while the
 * player had the bar put down, so a board that fit ended in half a screen of
 * empty page.
 *
 * Served from `boardsmith init`'s table sample with a board that fits the
 * region at 390x844, with the bar left free to come up for a question. Up, the
 * room is the tallest the bar has been past the reserved row since it came up,
 * so it never shrinks as the bar changes (#1514 review F1); put down, there is
 * none, and brought up again it starts from the bar's own height.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/phone-scroll-room-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const FITTED_BOARD = `<template>
  <div class="fitted-board"></div>
</template>

<style>
.fitted-board { width: 300px; height: 300px; background: rebeccapurple; }
</style>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Fitted from './components/Fitted.vue';

export default defineGameUIs({ Fitted: defaultUI(Fitted) });
`;

/** The scroll room under the board, how far the bar reaches past the reserved row, and what it shows. */
function room(frame) {
  return frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const region = doc.querySelector('.boardregion');
    const bar = doc.querySelector('[data-testid="bs-actionbar"]');
    return {
      room: parseFloat(getComputedStyle(region, '::after').height),
      past: bar.getBoundingClientRect().height - parseFloat(getComputedStyle(region).paddingBottom),
      barDown: bar.classList.contains('collapsed'),
      menuLevel: bar.querySelector('[data-bs-menu-level]') !== null,
    };
  });
}

// Chromium only: classic scrollbars are what it measures, and WebKit cannot show them.
await runBrowserRegression(
  { script: 'phone-scroll-room-browser.mjs', engines: ['chromium'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Fitted.vue': FITTED_BOARD } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch({ classicScrollbars: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const frame = page.frameLocator('.dev-host__frame');
      await page.goto(hostUrl);
      await frame.locator('.fitted-board').waitFor({ timeout: 60_000 });
      await frame.locator('[data-testid="bs-actionbar"] .choice-btn').first().waitFor({ timeout: 60_000 });

      const pick = await room(frame);
      await check('the bar up on a pick leaves room for what it covers past the reserved row', () => {
        assert(!pick.barDown && !pick.menuLevel, 'the Action Panel is not up on a pick');
        assert(Math.abs(pick.room - pick.past) <= 1, `the board ends in ${pick.room}px of room for a bar ${pick.past}px past its row`);
      });

      await frame.locator('[data-testid="bs-actionbar"] .cancel-btn').click();
      const menu = await waitUntil(() => room(frame), (now) => now.menuLevel, 10_000);
      await check('the bar changing to a menu level keeps room for the tallest it has been', () => {
        assert(menu.menuLevel, 'the Action Panel does not show a menu level');
        const tallest = Math.max(pick.past, menu.past);
        assert(Math.abs(menu.room - tallest) <= 1, `the board ends in ${menu.room}px of room for a bar that has reached ${tallest}px past its row`);
      });

      await frame.locator('[data-testid="bs-actionbar-toggle"]').click();
      const down = await waitUntil(() => room(frame), (now) => now.barDown, 10_000);
      await check('the bar put down leaves no room under the board', () => {
        assert(down.room <= 0, `the board ends in ${down.room}px of room with only the line over it`);
      });

      await frame.locator('[data-testid="bs-actionbar-toggle"]').click();
      const again = await waitUntil(() => room(frame), (now) => !now.barDown, 10_000);
      await check('the bar brought up again leaves room for what it covers now', () => {
        assert(Math.abs(again.room - Math.max(0, again.past)) <= 1, `the board ends in ${again.room}px of room for a bar ${again.past}px past its row`);
      });
    } finally {
      await browser.close();
    }
    return summarise('on an upright phone with a board that fits');
  },
);
