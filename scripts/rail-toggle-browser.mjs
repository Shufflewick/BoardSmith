#!/usr/bin/env node
/**
 * THE SHELL SAYS HOW FAR ITS RAIL TOGGLE REACHES OVER THE BOARD (#1722).
 *
 * At 640px and wider the players panel's expand toggle sits on the panel's right
 * edge and overhangs the board region's top-left corner, 13px with a mouse and
 * 22px on a touch screen. `--bsg-rail-toggle-overhang` tells a board how far, so
 * it can keep what it draws in that corner clear, and is 0 wherever no toggle is
 * beside the board: below 640px and with the chrome hidden. The board is zoomed
 * inside a scaled container, so the token there is in board pixels, and padding
 * by it clears the toggle on screen at any zoom. jsdom does no layout,
 * so only a real browser can say the token matches where the toggle lands.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/rail-toggle-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, settle, summarise } from './browser-harness.mjs';

/** The token as a board pads by it, in screen pixels, and how far the visible toggle reaches past the board region's left edge (null when hidden). */
async function measure(frame, { hideChrome = false } = {}) {
  await settle(frame);
  return frame.locator('body').evaluate((body, hide) => {
    const doc = body.ownerDocument;
    const game = doc.querySelector('.game-shell__game');
    if (hide) game.classList.add('chrome-hidden');
    // Pad a box inside the board by the token, as a board does, and see how wide it lands on screen under the zoom.
    const probe = doc.createElement('div');
    probe.style.width = 'var(--bsg-rail-toggle-overhang)';
    doc.querySelector('.game-shell__zoom-container').append(probe);
    const token = probe.getBoundingClientRect().width;
    probe.remove();
    const toggle = doc.querySelector('.side-edge');
    const region = doc.querySelector('.boardregion').getBoundingClientRect();
    const overhang = toggle.checkVisibility() ? toggle.getBoundingClientRect().right - region.left : null;
    if (hide) game.classList.remove('chrome-hidden');
    return { token, overhang };
  }, hideChrome);
}

function assertOverhang(read, px) {
  assert(read.token === px, `padding by --bsg-rail-toggle-overhang gives ${read.token}px on screen, expected ${px}px`);
  assert(read.overhang === px, `the rail toggle reaches ${read.overhang}px over the board region, expected ${px}px`);
}

function assertNoToggle(read) {
  assert(read.token === 0, `padding by --bsg-rail-toggle-overhang gives ${read.token}px on screen with no toggle beside it, expected 0px`);
  assert(read.overhang === null, `the rail toggle shows, reaching ${read.overhang}px over the board region`);
}

await runBrowserRegression({ script: 'rail-toggle-browser.mjs', engines: ['chromium', 'webkit'], table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const frame = await openTableSample(await context.newPage(), hostUrl);
    await check('with a mouse at 1440px the token is the 13px the toggle overhangs, panel open', async () => {
      assertOverhang(await measure(frame), 13);
    });
    await check('and with the panel collapsed to its rail', async () => {
      await frame.locator('.side-edge').click();
      await frame.locator('.sidebar.rail').waitFor();
      assertOverhang(await measure(frame), 13);
    });
    await check('at 200% zoom padding by the token still clears the 13px on screen', async () => {
      await frame.getByRole('button', { name: 'Game controls' }).click();
      await frame.getByRole('slider', { name: 'Zoom' }).fill('2');
      await frame.getByRole('slider', { name: 'Zoom' }).press('Escape');
      assertOverhang(await measure(frame), 13);
    });
    await check('the token is 0 with the chrome hidden', async () => {
      assertNoToggle(await measure(frame, { hideChrome: true }));
    });
    const player = await context.storageState();
    await context.close();

    for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
      const phone = await browser.newContext({ viewport, hasTouch: true, isMobile: true, storageState: player });
      const touch = await openTableSample(await phone.newPage(), hostUrl);
      await check(`on a touch screen at ${viewport.width}x${viewport.height}`, async () => {
        const read = await measure(touch);
        if (viewport.width >= 640) assertOverhang(read, 22);
        else assertNoToggle(read);
      });
      await phone.close();
    }
  } finally {
    await browser.close();
  }
  return summarise("for the rail toggle's overhang");
});
