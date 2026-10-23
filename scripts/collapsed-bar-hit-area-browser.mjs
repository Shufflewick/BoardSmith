#!/usr/bin/env node
/**
 * THE COLLAPSED BAR'S CONTROLS ARE HIT ABOVE THE LINE, AND NOT BEYOND (#1445).
 *
 * #1444 thinned the collapsed action bar to a 14px line. The dots of the
 * controls menu keep a 24px hit area drawn nowhere, reaching 10px up over the
 * board, and the edge toggle is a 26px circle riding the line's top edge. A
 * stylesheet test sees the declarations; only a real click shows what is hit.
 *
 * Served from `boardsmith init`'s table sample, whose shell fills the controls
 * menu. With the bar down, at 1440px and 390px, real mouse clicks a few pixels
 * above the line must open the menu and restore the bar, and clicks just past
 * each hit area must reach what lies under them: the board under the toggle,
 * and under the dots the board on a phone or the sidebar on a desktop.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/collapsed-bar-hit-area-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

/**
 * The line's top edge and the centres of the dots and toggle, in the frame's
 * coordinates, the frame's offset on the page, and whether the layout has
 * settled: the frame at the page's width, the line down at its foot, and no
 * transition running (the closed Debug drawer slides across a resize).
 */
async function targets(page, frame) {
  const offset = await page.locator('.dev-host__frame').boundingBox();
  const inner = await frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const centre = (el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    };
    const line = doc.querySelector('[data-testid="bs-actionbar"]').getBoundingClientRect().top;
    return {
      line,
      down: line >= doc.defaultView.innerHeight - 15,
      width: doc.defaultView.innerWidth,
      moving: doc.getAnimations().length > 0,
      dots: centre(doc.querySelector('[data-testid="bs-actionbar"] .menubtn')),
      toggle: centre(doc.querySelector('[data-testid="bs-actionbar-toggle"]')),
    };
  });
  return { offset, ...inner };
}

const menuOpen = (frame) => frame.locator('[data-testid="bs-actionbar"] .menubtn').getAttribute('aria-expanded');
const barUp = (frame) => frame.locator('[data-testid="bs-actionbar-toggle"]').getAttribute('aria-expanded');

/**
 * Click at (x, y) in the frame with the real mouse, and name what got the click:
 * `beneath` is whether it went past the bar's controls to the page under the line,
 * and `board` whether that was the board region.
 */
async function clickAt(page, frame, offset, x, y) {
  await frame.locator('body').evaluate(() => {
    window.__clicked = null;
    window.addEventListener('click', (event) => (window.__clicked = event.target), { capture: true, once: true });
  });
  await page.mouse.click(offset.x + x, offset.y + y);
  return frame.locator('body').evaluate(() => {
    const el = window.__clicked;
    if (!el) return { beneath: false, board: false, on: 'nothing' };
    return { beneath: !el.closest('.actionbar-frame'), board: el.closest('.boardregion') !== null, on: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` };
  });
}

await runBrowserRegression(
  {
    script: 'collapsed-bar-hit-area-browser.mjs',
    table: true,
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const frame = await openTableSample(page, hostUrl);
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const at = `${viewport.width}px`;
        await page.setViewportSize(viewport);
        // Down, whatever a failed check at the last width left it as.
        if (await barUp(frame) === 'true') await frame.locator('[data-testid="bs-actionbar-toggle"]').click();
        await waitUntil(() => barUp(frame), (up) => up === 'false', 5_000);
        const { offset, line, dots, toggle } = await waitUntil(
          () => targets(page, frame),
          (seen) => seen.down && !seen.moving && Math.abs(seen.width - seen.offset.width) < 1,
          5_000,
        );

        // The dots' hit area is 24px tall on a 14px line: it reaches 10px above it.
        await check(`${at}: a click 8px above the line opens the controls menu`, async () => {
          const click = await clickAt(page, frame, offset, dots, line - 8);
          const open = await waitUntil(() => menuOpen(frame), (seen) => seen === 'true', 2_000);
          assert(open === 'true', `the menu stayed shut; the click landed on ${click.on}`);
          assert(!click.beneath, `the click went to ${click.on}, under the line`);
          await page.keyboard.press('Escape');
          await waitUntil(() => menuOpen(frame), (seen) => seen === 'false', 2_000);
        });
        await check(`${at}: a click 13px above the line, past the dots' hit area, reaches the page beneath`, async () => {
          const click = await clickAt(page, frame, offset, dots, line - 13);
          assert(click.beneath, `the click went to ${click.on}, not to the page under the line`);
          assert(await menuOpen(frame) === 'false', 'the controls menu opened');
        });

        // The toggle is a 26px circle centred on the line's top edge: it reaches 13px above it.
        await check(`${at}: a click 16px above the line, past the toggle, reaches the board and the bar stays down`, async () => {
          const click = await clickAt(page, frame, offset, toggle, line - 16);
          assert(click.board, `the click went to ${click.on}, not to the board`);
          assert(await barUp(frame) === 'false', 'the bar came up');
        });
        await check(`${at}: a click 11px above the line, on the toggle, brings the bar back up`, async () => {
          const click = await clickAt(page, frame, offset, toggle, line - 11);
          const up = await waitUntil(() => barUp(frame), (seen) => seen === 'true', 2_000);
          assert(up === 'true', `the bar stayed down; the click landed on ${click.on}`);
          assert(!click.beneath, `the click went to ${click.on}, under the line`);
        });
      }
    } finally {
      await browser.close();
    }
    return summarise('with the action bar down in the dev host');
  },
);
