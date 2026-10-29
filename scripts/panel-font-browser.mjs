#!/usr/bin/env node
/**
 * THE ACTION PANEL'S BUTTONS DRAW IN THE GAME'S OWN FONT (#1511).
 *
 * A game sets its text font through the theme's `--bsg-font`, and GameShell
 * draws in it. Browsers do not let a button inherit `font-family`, so a panel
 * button with no `font-family` of its own draws in the user agent's button font
 * (Arial in Chromium) instead. jsdom applies no stylesheet, so only a real
 * browser can see it.
 *
 * Served from `boardsmith init`'s table sample, with `--bsg-font` set on the
 * game document's root the way `applyTheme` sets it. Every button in the action
 * bar must compute the same font family as the shell.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/panel-font-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

const GAME_FONT = "'Courier New', monospace";

await runBrowserRegression({ script: 'panel-font-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const frame = await openTableSample(await browser.newPage(), hostUrl);

    await check('every Action Panel button draws in the game font', async () => {
      const read = await frame.locator('body').evaluate((body, font) => {
        const doc = body.ownerDocument;
        doc.documentElement.style.setProperty('--bsg-font', font);
        const shell = getComputedStyle(doc.querySelector('.game-shell')).fontFamily;
        const buttons = [...doc.querySelectorAll('[data-testid="bs-actionbar"] button')];
        const off = buttons.filter((b) => getComputedStyle(b).fontFamily !== shell);
        return { shell, count: buttons.length, off: off.map((b) => `.${b.className.split(' ').join('.')} in ${getComputedStyle(b).fontFamily}`) };
      }, GAME_FONT);
      assert(read.shell.includes('Courier New'), `the shell draws in ${read.shell}, not the --bsg-font it was given`);
      assert(read.count > 0, 'the action bar offered no buttons to check');
      assert(read.off.length === 0, `these panel buttons ignore --bsg-font (${read.shell}): ${read.off.join('; ')}`);
    });
  } finally {
    await browser.close();
  }
  return summarise('for the Action Panel font');
});
