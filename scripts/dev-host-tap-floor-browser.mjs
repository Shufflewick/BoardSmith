#!/usr/bin/env node
/**
 * ON A PHONE, EVERY DEV HOST CONTROL TAKES A 44PX TAP (#1668).
 *
 * #1611 gave the shell's controls a 44px target on a coarse pointer (WCAG 2.5.5,
 * Apple's 44pt); the `boardsmith dev` page's own chrome around the game frame is
 * held to the same floor here. On a touch phone at 390x844 and 844x390, in
 * Chromium and WebKit, every control of the outer page a tap can reach is at
 * least 44px each way: in the bar, with the seat menu open, with the … menu open
 * (the compact tier's alone), with table setup open, and on the lobby the seat
 * menu goes back to.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/dev-host-tap-floor-browser.mjs`.
 */
import { assert, check, onEachPhone, runBrowserRegression, step, summarise } from './browser-harness.mjs';

const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

/** Each control of the dev host page a tap on its centre reaches that is under 44px either way, as a line naming it. */
function small(page) {
  return page.locator('.dev-host').evaluate((host, controls) => {
    const doc = host.ownerDocument;
    return [...host.querySelectorAll(controls)]
      .filter((el) => el.checkVisibility())
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ el, box }) => el.contains(doc.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)))
      .filter(({ box }) => box.width < 44 || box.height < 44)
      .map(({ el, box }) => `${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? el.textContent.trim()}" (${Math.round(box.width)}x${Math.round(box.height)})`);
  }, CONTROLS);
}

/** Hold every reachable dev host control to 44px in `state`. */
async function checkTaps(page, state, size) {
  const found = await step(`measuring the dev host's controls with ${state} at ${size}`, () => small(page));
  await check(`every dev host control takes a 44px tap with ${state} at ${size}`, () => {
    assert(found.length === 0, `smaller than 44px: ${found.join('; ')}`);
  });
}

/** Open a state with `open`, hold the page to the check in it, and leave it with `close`. */
async function inState(page, size, state, { open, close }) {
  await step(`opening ${state} at ${size}`, open);
  await checkTaps(page, state, size);
  await step(`closing ${state} at ${size}`, close);
}

/** The bar's own table setup toggle, hidden on the compact tier; a click through the DOM because driving is not under test. */
const toggleTableSetup = () => document.querySelector('.dev-chrome__bar-wide [data-testid="table-setup-toggle"]').click();

const seated = (page) => page.locator('[data-testid="seat-switcher"]').waitFor({ timeout: 60_000 });

await runBrowserRegression({ script: 'dev-host-tap-floor-browser.mjs', engines: ['chromium', 'webkit'], table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    await onEachPhone(browser, hostUrl, seated, async (page, size) => {
      await checkTaps(page, 'the bar', size);
      await inState(page, size, 'the seat menu open', {
        open: async () => {
          await page.locator('[data-testid="seat-switcher"]').click();
          await page.locator('#dev-seat-menu').waitFor();
        },
        close: async () => {
          await page.locator('[data-testid="seat-switcher"]').click();
          await page.locator('#dev-seat-menu').waitFor({ state: 'detached' });
        },
      });
      // The … menu is the compact tier's alone.
      if (page.viewportSize().width < 640) {
        await inState(page, size, 'the … menu open', {
          open: async () => {
            await page.locator('button[aria-label="More dev controls"]').click();
            await page.locator('#dev-overflow-menu').waitFor();
          },
          close: async () => {
            await page.locator('button[aria-label="More dev controls"]').click();
            await page.locator('#dev-overflow-menu').waitFor({ state: 'detached' });
          },
        });
      }
      await inState(page, size, 'table setup open', {
        open: async () => {
          await page.evaluate(toggleTableSetup);
          await page.locator('.table-setup').waitFor();
        },
        close: async () => {
          await page.evaluate(toggleTableSetup);
          await page.locator('.table-setup').waitFor({ state: 'detached' });
        },
      });
      await inState(page, size, 'the lobby', {
        open: async () => {
          await page.locator('[data-testid="seat-switcher"]').click();
          await page.locator('[data-testid="leave-seat"]').click();
          await page.locator('.lobby').waitFor();
        },
        close: async () => {
          await page.locator('button[aria-label="Take seat 1"]').click();
          await seated(page);
        },
      });
    });
  } finally {
    await step('closing the browser', () => browser.close());
  }
  return summarise('for the dev host tap sizes');
});
