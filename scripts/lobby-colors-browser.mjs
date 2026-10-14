#!/usr/bin/env node
/**
 * THE DEV LOBBY'S COLOUR SWATCHES STAY INSIDE THEIR CARD (#702, #703).
 *
 * `boardsmith dev` seats the first browser; every other browser lands in the
 * join lobby, which offers the game's colour palette as a row of swatches. With
 * the default 16 colours that row was wider than the lobby card at a phone
 * width, so the swatches ran out of the card and the page scrolled sideways.
 *
 * Served from `boardsmith init`'s own table sample, which declares no palette
 * and so gets the default one. A first browser takes the seat the host gives
 * it; a second, at 390px and then 1440px, lands in the lobby, where every
 * swatch must sit inside the card and the page must be no wider than the
 * viewport.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/lobby-colors-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise } from './browser-harness.mjs';

/** The engine's DEFAULT_COLOR_PALETTE, which a game declaring none is offered. */
const DEFAULT_PALETTE_SIZE = 16;

const WIDTHS = [390, 1440];

/** Where each swatch sits against the lobby card, and how wide the page is against the viewport. */
function lobbyGeometry(page) {
  return page.locator('.lobby').evaluate((card) => {
    const box = card.getBoundingClientRect();
    const swatches = [...card.querySelectorAll('.lobby__colors .color-swatch')];
    return {
      swatches: swatches.length,
      outside: swatches
        .map((swatch) => swatch.getBoundingClientRect())
        .filter((r) => r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)
        .length,
      pageWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
}

await runBrowserRegression({ script: 'lobby-colors-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    // The first browser is seated by the host, so it must be there before the second arrives.
    const seated = await (await browser.newContext()).newPage();
    await seated.goto(hostUrl);
    await seated.locator('.dev-host__frame').waitFor({ timeout: 60_000 });

    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      try {
        const page = await context.newPage();
        await page.goto(hostUrl);
        await page.locator('.lobby__colors').waitFor({ timeout: 60_000 });
        const seen = await lobbyGeometry(page);
        await check(`the lobby offers the default palette at ${width}px`, async () => {
          assert(seen.swatches === DEFAULT_PALETTE_SIZE, `the lobby showed ${seen.swatches} swatches, not ${DEFAULT_PALETTE_SIZE}`);
        });
        await check(`every colour swatch sits inside the lobby card at ${width}px`, async () => {
          assert(seen.outside === 0, `${seen.outside} of ${seen.swatches} swatches overflow the lobby card`);
        });
        await check(`the lobby page is no wider than the viewport at ${width}px`, async () => {
          assert(seen.pageWidth <= seen.viewport, `the page is ${seen.pageWidth}px wide in a ${seen.viewport}px viewport`);
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return summarise('in the dev host\'s join lobby');
});
