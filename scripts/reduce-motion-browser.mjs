#!/usr/bin/env node
/**
 * THE REDUCE MOTION ITEM STOPS CSS MOTION IN A REAL BROWSER (#1442).
 *
 * jsdom applies no stylesheet, so only a browser can show that turning on
 * Reduce motion in the controls menu actually stops a CSS transition, that the
 * choice survives a reload, and that a device asking for less motion does the
 * same without the item. Served from `boardsmith init`'s table sample; the
 * transition measured is the menu's own toggle pill.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/reduce-motion-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const ITEM = '[role="menuitemcheckbox"]:has-text("Reduce motion")';

/** Open the controls menu and read the Reduce motion item: checked, <html> marked, and its pill's transition. */
async function readItem(frame) {
  if (!(await frame.locator(ITEM).isVisible())) await frame.locator('button[aria-label="Game controls"]').click();
  const item = frame.locator(ITEM);
  await item.waitFor();
  return item.evaluate((el) => ({
    checked: el.getAttribute('aria-checked'),
    marked: el.ownerDocument.documentElement.classList.contains('bs-reduce-motion'),
    transitionMs: parseFloat(getComputedStyle(el.querySelector('.toggle')).transitionDuration) * 1000,
  }));
}

await runBrowserRegression({ script: 'reduce-motion-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    let frame = await openTableSample(page, hostUrl);

    const before = await readItem(frame);
    await check('with motion allowed, the item is off and the toggle pill transitions', async () => {
      assert(before.checked === 'false' && !before.marked, `item checked=${before.checked}, <html> marked=${before.marked}`);
      assert(before.transitionMs > 1, `the pill's transition is ${before.transitionMs}ms`);
    });

    await frame.locator(ITEM).click();
    const on = await readItem(frame);
    await check('turning Reduce motion on marks <html> and stops the transition', async () => {
      assert(on.checked === 'true' && on.marked, `item checked=${on.checked}, <html> marked=${on.marked}`);
      assert(on.transitionMs < 1, `the pill still transitions for ${on.transitionMs}ms`);
    });

    frame = await openTableSample(page, hostUrl);
    const reloaded = await readItem(frame);
    await check('the choice survives a reload', async () => {
      assert(reloaded.checked === 'true' && reloaded.marked && reloaded.transitionMs < 1, JSON.stringify(reloaded));
    });

    await frame.locator(ITEM).click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const device = await waitUntil(() => readItem(frame), (seen) => seen.marked, 5_000);
    await check('a device asking for less motion stops the transition with the item off', async () => {
      assert(device.checked === 'false' && device.marked && device.transitionMs < 1, JSON.stringify(device));
    });
    await context.close();
  } finally {
    await browser.close();
  }
  return summarise('with Reduce motion in the dev host');
});
