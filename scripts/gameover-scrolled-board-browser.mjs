#!/usr/bin/env node
/**
 * THE GAME-OVER CARD STAYS OVER THE VISIBLE BOARD WHEN THE BOARD SCROLLS (#1068).
 *
 * A board wider than its region scrolls inside `.boardregion`. The game-over
 * scrim used to be a child of that scroller, so it was sized to the scroller's
 * client box and moved with the board's content: on a phone, once the player
 * had scrolled the board sideways, the card ended the game cut off on the left
 * or off screen entirely. Hex's Auto UI at 390px is where it was seen.
 *
 * Served from `boardsmith init`'s table sample at 390px. Zooming the board to
 * the slider's maximum makes it wider than the region, the way Hex's board is
 * at its smallest zoom; the board is scrolled to its right edge, the game is
 * played to its end through the Action Panel, and the card must then be
 * centred on the visible board and wholly inside it.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/gameover-scrolled-board-browser.mjs`; a missing Chromium says to
 * run `boardsmith install-browser`.
 */
import {
  assert, check, openTableSample, playTableSampleToTheEnd, runBrowserRegression, summarise,
} from './browser-harness.mjs';

await runBrowserRegression({ script: 'gameover-scrolled-board-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const frame = await openTableSample(page, hostUrl);

    await frame.getByRole('button', { name: 'Game controls' }).click();
    await frame.getByRole('slider', { name: 'Zoom' }).fill('2');
    await frame.getByRole('slider', { name: 'Zoom' }).press('Escape');

    const region = frame.locator('[data-testid="bs-board"]');
    const scrolled = await region.evaluate(async (el) => {
      await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
      el.scrollLeft = el.scrollWidth;
      return { overflow: el.scrollWidth - el.clientWidth, left: el.scrollLeft };
    });
    await check('the zoomed board is wider than its region and is scrolled sideways', async () => {
      assert(scrolled.overflow > 0, 'the board fits its region at 200% zoom, so nothing here scrolls');
      assert(scrolled.left > 0, 'the board region did not scroll');
    });

    await check('the empty overlay layer lets a pointer through to the board', async () => {
      const hit = await region.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 3);
        return el.contains(top) ? null : top?.className || top?.tagName;
      });
      assert(hit === null, `a pointer over the board lands on "${hit}" instead`);
    });

    const ended = await playTableSampleToTheEnd(frame);
    await check('the game plays to its end and shows the game-over card', async () => {
      assert(ended, 'the game-over card never appeared');
    });

    await check('the game-over card is centred on the visible board and wholly inside it at 390px', async () => {
      const seen = await frame.locator('.game-over-card').evaluate((card) => {
        const view = card.ownerDocument.querySelector('[data-testid="bs-board"]').getBoundingClientRect();
        const box = card.getBoundingClientRect();
        return {
          left: box.left - view.left,
          right: view.right - box.right,
          top: box.top - view.top,
          bottom: view.bottom - box.bottom,
        };
      });
      assert(
        seen.left >= 0 && seen.right >= 0 && seen.top >= 0 && seen.bottom >= 0,
        `the card is not wholly on the visible board: ${JSON.stringify(seen)} px of room on each side (a negative side is cut off)`,
      );
      assert(Math.abs(seen.left - seen.right) <= 1, `the card is off centre: ${seen.left}px of room on its left, ${seen.right}px on its right`);
    });

    await check('the game-over card takes a real click on its close button', async () => {
      await frame.locator('.game-over-card .goc-close').click({ timeout: 5_000 });
      await frame.locator('.game-over-card').waitFor({ state: 'detached', timeout: 5_000 });
    });
  } finally {
    await browser.close();
  }
  return summarise('with the game-over card over a board scrolled sideways');
});
