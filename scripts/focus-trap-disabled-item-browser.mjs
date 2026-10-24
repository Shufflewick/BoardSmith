#!/usr/bin/env node
/**
 * FOCUS STAYS IN THE CONTROLS MENU AFTER ITS FOCUSED ITEM TURNS DISABLED (#1453, #1457),
 * AND THE ARROW KEYS MOVE BETWEEN ITS ITEMS (#1458).
 *
 * When a focused button turns disabled, the browser drops focus to `<body>`
 * (firing focusout with no relatedTarget), where no key reaches the menu while
 * the rest of the page stays inert. "Undo last action" does this when another
 * seat's move clears `canUndo`. The trap moves focus to the next item, so every
 * key keeps working. jsdom keeps the focus on the disabled button, so only a
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
      // Arrow keys move between the menu's items and wrap at either end (#1458).
      await page.setViewportSize(viewport);
      await trigger.focus();
      await page.keyboard.press('Enter');
      await focusedItem.waitFor({ timeout: 5_000 });
      const items = await menu.evaluate((el) => Array.from(el.querySelectorAll('[role^="menuitem"]:not(:disabled)'), (item) => item.getAttribute('aria-label') || item.textContent.trim()));
      const firstItem = await focused();
      await page.keyboard.press('ArrowDown');
      const second = await focused();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      const wrapped = await focused();
      await page.keyboard.press('ArrowDown');
      const back = await focused();
      await check(`Down and Up move between the menu items and wrap at ${viewport.width}px`, async () => {
        assert(firstItem === items[0], `the menu opened with focus on "${firstItem}", not its first item "${items[0]}"`);
        assert(second === items[1], `Down moved focus to "${second}", not the next item "${items[1]}"`);
        assert(wrapped === items.at(-1), `Up from the first item moved focus to "${wrapped}", not the last item "${items.at(-1)}"`);
        assert(back === items[0], `Down from the last item moved focus to "${back}", not the first item "${items[0]}"`);
      });
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached', timeout: 5_000 });

      // "removed" is a focused item a v-if unmounts, such as action help when no action has any.
      for (const how of ['disabled', 'removed']) {
        const at = `when ${how} at ${viewport.width}px`;
        await page.setViewportSize(viewport);
        await trigger.focus();
        await page.keyboard.press('Enter');
        await focusedItem.waitFor({ timeout: 5_000 });

        const after = await focusedItem.evaluate(async (button, how) => {
          const doc = button.ownerDocument;
          const menuEl = button.closest('[role="menu"]');
          let dropped = false;
          doc.addEventListener('focusout', (e) => { dropped ||= e.target === button && e.relatedTarget === null; });
          if (how === 'disabled') button.disabled = true;
          else button.remove();
          // The browser moves focus off a disabled element when it next renders.
          await new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle)));
          const active = doc.activeElement;
          return { dropped, inMenu: active !== button && active !== menuEl && menuEl.contains(active), on: active === doc.body ? 'the page body' : active?.getAttribute('aria-label') || active?.textContent?.trim() };
        }, how);
        await check(`the focused menu item drops its focus ${at}`, async () => {
          assert(after.dropped, 'the browser fired no focusout with an empty relatedTarget, so this run does not reproduce #1453');
        });
        await check(`focus moves to another item in the menu ${at}`, async () => {
          assert(after.inMenu, `focus is on "${after.on}", not on an enabled item in the controls menu`);
        });

        await page.keyboard.press('Escape');
        await check(`Escape closes the menu ${at}`, async () => {
          await menu.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {
            throw new Error('the controls menu stayed open after Escape');
          });
        });
        await check(`closing the menu hands focus back to its trigger ${at}`, async () => {
          const now = await focused();
          assert(now === 'Game controls', `focus is on "${now}", not the Game controls button`);
        });
      }
    }
  } finally {
    await browser.close();
  }
  return summarise('with a focused controls menu item disabled or removed');
});
