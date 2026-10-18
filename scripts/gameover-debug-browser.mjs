#!/usr/bin/env node
/**
 * THE DEBUG PANEL STAYS USABLE ONCE THE GAME IS OVER (#1106).
 *
 * The game-over card is a modal for players: its focus trap makes the rest of
 * the page inert. The Debug panel (dev only) sat in that inert background, so
 * once a game ended its tabs could not be clicked; the click fell through to
 * the card's scrim. The end of a game is when the panel is most useful.
 *
 * Served from `boardsmith init`'s table sample. One browser holds seat 1 (the
 * open seat plays as bot, and debugging is on), plays the game to its end
 * through the Action Panel, opens the Debug panel from the Dev header and
 * clicks a tab with a real pointer, at 1440px and 390px. The card must still
 * be up and the board behind it still inert: the fix must not loosen the modal.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/gameover-debug-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import {
  assert, check, openTableSample, playTableSampleToTheEnd, runBrowserRegression, summarise, waitUntil,
} from './browser-harness.mjs';

const WIDTHS = [1440, 390];

await runBrowserRegression({ script: 'gameover-debug-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: 900 } });
    const page = await context.newPage();
    const frame = await openTableSample(page, hostUrl);

    const ended = await playTableSampleToTheEnd(frame);
    await check('the game plays to its end and shows the game-over card', async () => {
      assert(ended, 'the game-over card never appeared');
    });

    await page.locator('[data-testid="debug-toggle"]').click();
    await frame.locator('#debug-tab-history').waitFor();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
      for (const tab of ['history', 'logs']) {
        const button = frame.locator(`#debug-tab-${tab}`);
        await button.click({ timeout: 5_000 }).catch(() => {});
        const selected = await waitUntil(() => button.getAttribute('aria-selected'), (seen) => seen === 'true', 3_000);
        await check(`the Debug panel's ${tab} tab takes a click with the game-over card open at ${width}px`, async () => {
          const hit = await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const top = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { on: el.contains(top) ? 'the tab' : top?.className || top?.tagName, inert: el.closest('[inert]') !== null };
          });
          assert(selected === 'true', `the click did not select the tab; the pointer landed on "${hit.on}"${hit.inert ? ' (the tab is inside an inert element)' : ''}`);
        });
      }
      await check(`the game-over card is still a modal over the board at ${width}px`, async () => {
        const modal = await frame.locator('.game-over-card').evaluate((card) => ({
          open: card.isConnected,
          boardInert: card.ownerDocument.querySelector('[data-testid="bs-actionbar"]')?.closest('[inert]') !== null,
        }));
        assert(modal.open, 'the game-over card closed');
        assert(modal.boardInert, 'the Action Panel behind the game-over card is no longer inert');
      });
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return summarise('with the game-over card open in the dev host');
});
