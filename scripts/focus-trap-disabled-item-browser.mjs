#!/usr/bin/env node
/**
 * ESCAPE STILL CLOSES THE CONTROLS MENU AFTER ITS FOCUSED ITEM TURNS DISABLED (#1453).
 *
 * When a focused button turns disabled, the browser drops focus to `<body>`, so
 * a keydown listener on the menu no longer hears Escape while the rest of the
 * page stays inert. "Undo last action" does this when another seat's move
 * clears `canUndo`. jsdom keeps the focus on the disabled button, so only a
 * real browser shows it.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/focus-trap-disabled-item-browser.mjs`; a missing Chromium says
 * to run `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

await runBrowserRegression({ script: 'focus-trap-disabled-item-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const frame = await openTableSample(page, hostUrl);
    const trigger = frame.getByRole('button', { name: 'Game controls' });
    const menu = frame.getByRole('menu', { name: 'Game controls' });
    const focusedItem = frame.locator('.menu button:focus');
    const focused = () => frame.locator('body').evaluate((body) => {
      const el = body.ownerDocument.activeElement;
      return el?.getAttribute('aria-label') || el?.textContent?.trim() || el?.tagName;
    });

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const at = `at ${viewport.width}px`;
      await page.setViewportSize(viewport);
      await trigger.focus();
      await page.keyboard.press('Enter');
      await focusedItem.waitFor({ timeout: 5_000 });

      const dropped = await focusedItem.evaluate(async (button) => {
        button.disabled = true;
        // The browser moves focus off a disabled element when it next renders.
        await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
        return button.ownerDocument.activeElement?.tagName;
      });
      await check(`disabling the focused menu item drops focus to the page body ${at}`, async () => {
        assert(dropped === 'BODY', `focus stayed on ${dropped}, so this run does not reproduce #1453`);
      });

      await page.keyboard.press('Escape');
      await check(`Escape closes the menu while focus is on the page body ${at}`, async () => {
        await menu.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {
          throw new Error('the controls menu stayed open after Escape');
        });
      });
      await check(`closing the menu hands focus back to its trigger ${at}`, async () => {
        const now = await focused();
        assert(now === 'Game controls', `focus is on "${now}", not the Game controls button`);
      });
    }
  } finally {
    await browser.close();
  }
  return summarise('with a controls menu item disabled while focused');
});
