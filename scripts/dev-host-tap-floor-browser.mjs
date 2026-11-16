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
 * menu goes back to. The sample declares a game option and a player option of
 * every type, so the lobby and table setup draw a select, a number, a checkbox
 * and a radio; a checkbox or radio's target is the label around it, and the
 * glyph itself keeps its own size rather than being stretched to 44px.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/dev-host-tap-floor-browser.mjs`.
 */
import { assert, check, onEachPhone, runBrowserRegression, step, summarise } from './browser-harness.mjs';

const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

const OPTION_TYPES = `
    { "id": "rounds", "type": "number", "label": "Rounds", "min": 1, "max": 9, "step": 1, "default": 3 },
    { "id": "variant", "type": "select", "label": "Variant", "choices": [{ "value": "standard", "label": "Standard" }, { "value": "speed", "label": "Speed" }], "default": "standard" },
    { "id": "jokers", "type": "boolean", "label": "Jokers", "default": false }`;

/** The sample's own boardsmith.json, with a game option and a player option of every type. */
const BOARDSMITH_JSON = `{
  "name": "table-fixture",
  "backend": "table",
  "displayName": "Table Fixture",
  "description": "A fun game for 2-4 players",
  "audience": "casual",
  "tags": [],
  "playtime": { "min": 15, "max": 30 },
  "cooperative": false,
  "complexity": 2,
  "gameOptions": [${OPTION_TYPES}
  ],
  "playerOptions": [${OPTION_TYPES.replace(/"(rounds|variant|jokers)"/g, '"seat-$1"')},
    { "id": "dealer", "type": "exclusive", "label": "Dealer", "default": "last", "choices": [{ "value": "dealer", "label": "Dealer" }] }
  ]
}
`;

/**
 * How many controls of the dev host page a tap on their centre reaches, and each of
 * those under 44px either way, as a line naming it; and each checkbox or radio
 * drawn past 24px, a glyph stretched to the floor rather than its label grown.
 */
function measure(page) {
  return page.locator('.dev-host').evaluate((host, controls) => {
    const doc = host.ownerDocument;
    const visible = [...host.querySelectorAll(controls)].filter((el) => el.checkVisibility());
    const name = (el, box) => `${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? el.textContent.trim()}" (${Math.round(box.width)}x${Math.round(box.height)})`;
    const stretched = visible
      .filter((el) => el.matches('[type="checkbox"], [type="radio"]'))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 24 || box.height > 24)
      .map(({ el, box }) => name(el, box));
    const reached = visible
      .map((el) => (el.matches('[type="checkbox"], [type="radio"]') ? el.closest('label') : el))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ el, box }) => el.contains(doc.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)));
    const small = reached
      .filter(({ box }) => box.width < 44 || box.height < 44)
      .map(({ el, box }) => name(el, box));
    return { reached: reached.length, small, stretched };
  }, CONTROLS);
}

/** Hold every reachable dev host control to 44px in `state`. */
async function checkTaps(page, state, size) {
  const found = await step(`measuring the dev host's controls with ${state} at ${size}`, () => measure(page));
  await check(`every dev host control takes a 44px tap with ${state} at ${size}`, () => {
    assert(found.reached > 0, 'no control of the dev host page was reached, so nothing was measured');
    assert(found.small.length === 0, `smaller than 44px: ${found.small.join('; ')}`);
  });
  await check(`every checkbox and radio keeps its own size with ${state} at ${size}`, () => {
    assert(found.stretched.length === 0, `stretched past 24px: ${found.stretched.join('; ')}`);
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

await runBrowserRegression({ script: 'dev-host-tap-floor-browser.mjs', engines: ['chromium', 'webkit'], table: { files: { 'boardsmith.json': BOARDSMITH_JSON } } }, async ({ launch, hostUrl }) => {
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
          await page.locator('.table-setup input[type="radio"]').first().waitFor();
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
          await page.locator('.lobby input[type="checkbox"]').waitFor();
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
