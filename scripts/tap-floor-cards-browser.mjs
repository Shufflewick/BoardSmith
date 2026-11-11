#!/usr/bin/env node
/**
 * ON A PHONE, THE TABLE SAMPLE'S CARDS AND DECK ARE AT LEAST A TAP WIDE (#1608).
 *
 * `boardsmith init`'s table sample is the card archetype: a deck and a hand
 * each. Its cards size from the board region's width, never under the 44px
 * tap floor, and nothing shrinks the board to fit. At 390x844 and 844x390, in
 * Chromium and WebKit, every card and the deck are at least 44px on their
 * shorter side and the page does not scroll sideways.
 * `tap-floor-phone-browser.mjs` checks the grid-board archetype.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/tap-floor-cards-browser.mjs`.
 */
import { assert, check, onEachPhone, runBrowserRegression, summarise, tapSizes, waitUntil } from './browser-harness.mjs';

/** The 44px tap floor, less a hundredth for the floating point in a hex's corners. */
const FLOOR = 44 - 0.01;

const TARGETS = {
  cards: { selector: '.card-face' },
  deck: { selector: '.deck-stack' },
};

const sampleReady = (page) => page.frameLocator('.dev-host__frame').locator('.card-face').first().waitFor({ timeout: 60_000 });

await runBrowserRegression(
  { script: 'tap-floor-cards-browser.mjs', engines: ['chromium', 'webkit'], table: true },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      await onEachPhone(browser, hostUrl, sampleReady, async (page, size) => {
        const frame = page.frameLocator('.dev-host__frame');
        const seen = await waitUntil(() => tapSizes(frame, TARGETS), (now) => now.targets.cards.smallest >= FLOOR && now.targets.deck.smallest >= FLOOR);
        for (const [name, { selector }] of Object.entries(TARGETS)) {
          await check(`${size}: every one of the ${name} is at least 44px on its shorter side`, () => {
            const target = seen.targets[name];
            assert(target.count > 0, `found none of ${selector}`);
            assert(target.smallest >= FLOOR, `the smallest of ${selector} is ${target.smallest}px on its shorter side, under the 44px tap floor`);
          });
        }
        await check(`${size}: the page does not scroll sideways`, () => {
          assert(seen.page.sideways <= 0, `the page scrolls ${seen.page.sideways}px sideways`);
        });
      });
    } finally {
      await browser.close();
    }
    return summarise('for the table sample\'s cards on a phone');
  },
);
