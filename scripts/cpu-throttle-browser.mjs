#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR HOW MUCH WORK A PHONE'S CPU IS ASKED TO DO (#1604).
 *
 * A cheap phone runs the page at a fraction of a desktop's speed, and what
 * costs it most is layout and style work, which grows with the page. So this
 * renders the table sample's whole game, then plays a card so the host
 * pushes a new state, at 390x844 with the CPU slowed fourfold
 * (`Emulation.setCPUThrottlingRate`, Chromium's DevTools protocol only), and
 * counts what the page did: layouts and style recalculations, from
 * `Performance.getMetrics`, and the elements the game frame holds after.
 *
 * It asserts counts, never time, so a busy machine cannot fail it. Each count
 * is held to the figure recorded in `RECORDED` below: a change that makes the
 * page do more fails until it is made cheaper again, or the figure is raised in
 * the same change, deliberately. A change that does less should lower it.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/cpu-throttle-browser.mjs`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

/**
 * The most work each step may do. `elements` is the game frame's element count
 * once the step is done, which is exact. Layouts and style recalculations vary
 * by a few from run to run with how the frames fall, so their figures are twice
 * the most seen when recorded: a change that thrashes layout multiplies them.
 */
const RECORDED = {
  render: { layouts: 64, styles: 116, elements: 322 },
  push: { layouts: 52, styles: 110, elements: 322 },
};

/** The layouts and style recalculations the page has done so far, and the game frame's elements now. */
async function counts(cdp, frame) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const metric = (name) => metrics.find((each) => each.name === name).value;
  const elements = await frame.locator('body').evaluate((body) => body.ownerDocument.querySelectorAll('*').length);
  return { layouts: metric('LayoutCount'), styles: metric('RecalcStyleCount'), elements };
}

/** Hold each of `now`'s counts to the one recorded for `step`. */
function holdTo(step, now) {
  const over = Object.entries(RECORDED[step]).filter(([name, most]) => now[name] > most);
  assert(
    over.length === 0,
    `${over.map(([name, most]) => `${name} is ${now[name]}, over the ${most} recorded`).join('; ')}. ` +
      `Make the ${step} cheaper again, or raise RECORDED.${step} in scripts/cpu-throttle-browser.mjs on purpose.`,
  );
}

// Chromium only: CPU throttling and these counts come from Chromium's DevTools protocol.
await runBrowserRegression({ script: 'cpu-throttle-browser.mjs', engines: ['chromium'], table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Performance.enable');

    const frame = await openTableSample(page, hostUrl);
    const rendered = await counts(cdp, frame);
    console.log(`  render: ${JSON.stringify(rendered)}`);
    await check('rendering the whole game at a quarter of the CPU does no more work than recorded', () => holdTo('render', rendered));

    // The sample draws by itself, so its first question is which card to play. The push measured is that play,
    // seat 2's turn and this seat's next draw, which all follow by themselves: it is over when the hand is full again.
    const hand = frame.locator('[data-bs-el-name="hand-1"] .hand-card');
    const full = await hand.count();
    await frame.locator('[data-testid="bs-actionbar"] .choice-btn').first().click();
    await waitUntil(() => hand.count(), (now) => now < full, 30_000);
    const refilled = await waitUntil(() => hand.count(), (now) => now === full, 60_000);
    assert(refilled === full, `the hand never filled again after the play: ${refilled} cards, not ${full}`);
    const after = await counts(cdp, frame);
    const pushed = { layouts: after.layouts - rendered.layouts, styles: after.styles - rendered.styles, elements: after.elements };
    console.log(`  push: ${JSON.stringify(pushed)}`);
    await check('a state push at a quarter of the CPU does no more work than recorded', () => holdTo('push', pushed));
  } finally {
    await browser.close();
  }
  return summarise('for the work a slow CPU is asked to do');
});
