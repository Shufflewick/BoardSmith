#!/usr/bin/env node
/**
 * ON A PHONE THE BOARD'S SCROLL ROOM IS ONLY WHAT THE BAR COVERS (#1755).
 *
 * The board region ends in scroll room so the player can scroll what the
 * Action Panel covers into view. It was sized for a menu level's cap, half the
 * screen on an upright phone, whatever the bar showed, and stayed while the
 * player had the bar put down, so a board ended in half a screen of empty page.
 *
 * Served from `boardsmith init`'s table sample with a board taller than the
 * region at 390x844, with the bar left free to come up for a question. At the
 * top of the board the room is what the bar covers past the reserved row, and
 * none while it is down. Scrolled to the bottom, a bar that shrinks or goes
 * down leaves the board where it was (#1514 review F1), and the room it no
 * longer needs goes once the player scrolls back up.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/phone-scroll-room-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const TALL_BOARD = `<template>
  <div class="tall-board"></div>
</template>

<style>
.tall-board { width: 300px; height: 1200px; background: rebeccapurple; }
</style>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Tall from './components/Tall.vue';

export default defineGameUIs({ Tall: defaultUI(Tall) });
`;

/** The scroll room under the board, how far the bar reaches past the reserved row, what it shows, and the region's scroll. */
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
      top: region.scrollTop,
      bottom: region.scrollHeight - region.clientHeight,
    };
  });
}

// Chromium only: classic scrollbars are what it measures, and WebKit cannot show them.
await runBrowserRegression(
  { script: 'phone-scroll-room-browser.mjs', engines: ['chromium'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Tall.vue': TALL_BOARD } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch({ classicScrollbars: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const frame = page.frameLocator('.dev-host__frame');
      await page.goto(hostUrl);
      await frame.locator('.tall-board').waitFor({ timeout: 60_000 });
      await frame.locator('[data-testid="bs-actionbar"] .choice-btn').first().waitFor({ timeout: 60_000 });

      const scroll = (to) => frame.locator('.boardregion').evaluate((region, top) => {
        region.scrollTop = top === 'bottom' ? region.scrollHeight : top;
        region.dispatchEvent(new Event('scroll'));
      }, to);
      const toggle = () => frame.locator('[data-testid="bs-actionbar-toggle"]').click();

      const pick = await room(frame);
      await check('the bar up on a pick leaves room for what it covers past the reserved row', () => {
        assert(!pick.barDown && !pick.menuLevel, 'the Action Panel is not up on a pick');
        assert(Math.abs(pick.room - pick.past) <= 1, `the board ends in ${pick.room}px of room for a bar ${pick.past}px past its row`);
      });

      await scroll('bottom');
      const scrolled = await room(frame);
      await frame.locator('[data-testid="bs-actionbar"] .cancel-btn').click();
      const menu = await waitUntil(() => room(frame), (now) => now.menuLevel, 10_000);
      await check('the bar shrinking to a menu level leaves a board scrolled to the bottom where it was', () => {
        assert(menu.past < pick.past, `the menu level is ${menu.past}px past its row, no shorter than the pick's ${pick.past}px, so nothing shrank`);
        assert(Math.abs(menu.top - scrolled.top) <= 1, `the board moved from ${scrolled.top}px to ${menu.top}px`);
      });

      await scroll(0);
      const top = await waitUntil(() => room(frame), (now) => Math.abs(now.room - now.past) <= 1, 10_000);
      await check('scrolled back up, the room is what the menu level covers', () => {
        assert(Math.abs(top.room - top.past) <= 1, `the board ends in ${top.room}px of room for a bar ${top.past}px past its row`);
      });

      await scroll('bottom');
      const beforeDown = await room(frame);
      await toggle();
      const down = await waitUntil(() => room(frame), (now) => now.barDown, 10_000);
      await check('the bar put down leaves a board scrolled to the bottom where it was', () => {
        assert(Math.abs(down.top - beforeDown.top) <= 1, `the board moved from ${beforeDown.top}px to ${down.top}px`);
      });

      await scroll(0);
      const gone = await waitUntil(() => room(frame), (now) => now.room <= 0, 10_000);
      await check('the bar put down leaves no room under the board once scrolled away from it', () => {
        assert(gone.room <= 0, `the board ends in ${gone.room}px of room with only the line over it`);
      });

      await toggle();
      const again = await waitUntil(() => room(frame), (now) => !now.barDown, 10_000);
      await check('the bar brought up again leaves room for what it covers', () => {
        assert(Math.abs(again.room - Math.max(0, again.past)) <= 1, `the board ends in ${again.room}px of room for a bar ${again.past}px past its row`);
      });
    } finally {
      await browser.close();
    }
    return summarise('on an upright phone with a tall board');
  },
);
