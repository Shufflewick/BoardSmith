#!/usr/bin/env node
/**
 * `window.__BOARDSMITH_DEVTOOLS` READS THE GAME'S CURRENT STATE ON DEMAND (#960).
 *
 * The game iframe used to post its whole state to the dev host on every update,
 * read or not. Now the dev host's global calls a reader on the iframe's window
 * when it is read. This checks that the call crosses the frame: the global
 * answers with the game's state, and after a move it answers with the new one.
 *
 * Served from `boardsmith init`'s table sample. One browser holds seat 1 and
 * plays one choice through the Action Panel with the Debug panel open.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/devtools-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

/** What the dev host's global answers right now, as JSON so two reads compare. */
const readDevtools = (page) => page.evaluate(() => {
  const dt = window.__BOARDSMITH_DEVTOOLS;
  return dt ? JSON.stringify({ state: dt.getState(), actions: dt.getAvailableActions() }) : null;
});

await runBrowserRegression({ script: 'devtools-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const frame = await openTableSample(page, hostUrl);
    await page.locator('[data-testid="debug-toggle"]').click();
    await frame.locator('#debug-tab-history').waitFor();

    const before = await readDevtools(page);
    await check('the devtools global reads the game state and its available actions', async () => {
      assert(before !== null, 'window.__BOARDSMITH_DEVTOOLS is not defined on the dev host page');
      const { state, actions } = JSON.parse(before);
      assert(state !== null, 'getState() returned null with a game on the board');
      assert(actions.length > 0, 'getAvailableActions() returned no actions while the Action Panel offers a choice');
    });

    await check('a read hands the dev host page its own arrays, not the game frame\'s', async () => {
      const ownArray = await page.evaluate(() => window.__BOARDSMITH_DEVTOOLS.getAvailableActions() instanceof Array);
      assert(ownArray, 'getAvailableActions() returned an array from the game frame, so `instanceof Array` is false');
    });

    await frame.locator('[data-testid="bs-actionbar"] .choice-btn').first().click();
    const after = await waitUntil(() => readDevtools(page), (seen) => seen !== before);
    await check('after a move the devtools global reads the new state', async () => {
      assert(after !== before, 'the devtools global still answers with the state from before the move');
    });
  } finally {
    await browser.close();
  }
  return summarise('through window.__BOARDSMITH_DEVTOOLS in the dev host');
});
