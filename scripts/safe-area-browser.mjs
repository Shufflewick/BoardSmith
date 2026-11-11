#!/usr/bin/env node
/**
 * THE SHELL KEEPS OUT OF THE SAFE AREAS THE HOST SENDS, AND SIZES ITS CONTROLS FOR A FINGER (#1611).
 *
 * Inside an iframe `env(safe-area-inset-*)` cannot be trusted (Chrome reads 0,
 * Safari the parent's values), so the host page sends the frame's four insets
 * in a `safe_area` message and the shell pads itself by them. No emulated
 * viewport has a notch, so this script gives the dev host's page the insets an
 * iPhone reports, by padding the probe it reads them from, and holds the shell
 * to what the dev host sends: the part of each inset over the frame. On a phone
 * held either way no control sits inside an inset, with the action bar up and
 * put down, the controls menu open and the phone strip expanded, and on a
 * coarse pointer every shell control takes a 44px tap (WCAG 2.5.5, Apple's 44pt).
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/safe-area-browser.mjs`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

/** What a notched iPhone reports to the page in each orientation. */
const PHONES = [
  { viewport: { width: 390, height: 844 }, page: { top: 47, right: 0, bottom: 34, left: 0 } },
  { viewport: { width: 844, height: 390 }, page: { top: 0, right: 47, bottom: 21, left: 47 } },
];

const SIDES = ['top', 'right', 'bottom', 'left'];

const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

/**
 * Each control a tap inside an inset would reach, found by tapping every 4px
 * of the four insets: what a finger hits, so a control drawn under the bar or
 * scrolled out of its region does not count, and a hit area a pseudo-element
 * draws does.
 */
function inInsets(frame, insets) {
  return frame.locator('body').evaluate(async (body, { insets, controls }) => {
    const doc = body.ownerDocument;
    const easing = () => doc.getAnimations().filter((a) => a.transitionProperty);
    while (easing().length > 0) await Promise.allSettled(easing().map((a) => a.finished));
    const name = (el) => (el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : 'nothing');
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    const found = new Map();
    for (let y = 0.5; y < height; y += 4) {
      for (let x = 0.5; x < width; x += 4) {
        const inset = y < insets.top || y > height - insets.bottom || x < insets.left || x > width - insets.right;
        const control = inset ? doc.elementFromPoint(x, y)?.closest(controls) : null;
        if (control && !found.has(control)) found.set(control, `${name(control)} at ${Math.round(x)},${Math.round(y)}`);
      }
    }
    return [...found.values()];
  }, { insets, controls: CONTROLS });
}

/**
 * Each shell control (not the board's own pieces) a tap can reach where a 44px
 * cross centred on it, moved inside the insets, is not its own at every end:
 * inside its box, or a tap there lands on it, so a hit area drawn by a
 * pseudo-element counts.
 */
function smallTargets(frame, insets) {
  return frame.locator('body').evaluate(async (body, { insets, controls }) => {
    const doc = body.ownerDocument;
    const easing = () => doc.getAnimations().filter((a) => a.transitionProperty);
    while (easing().length > 0) await Promise.allSettled(easing().map((a) => a.finished));
    const name = (el) => (el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : 'nothing');
    const board = doc.querySelector('.game-shell__zoom-container');
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    const half = 21.5;
    const within = (value, low, high) => Math.min(Math.max(value, low + half + 0.5), high - half - 0.5);
    return [...doc.querySelectorAll(controls)]
      .filter((el) => el.checkVisibility() && !board.contains(el))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      // Reachable: what a tap on its centre lands on, so one off screen or under the phone strip's scrim is left out.
      .filter(({ el, box }) => el.contains(doc.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)))
      .map(({ el, box }) => {
        const x = within((box.left + box.right) / 2, insets.left, width - insets.right);
        const y = within((box.top + box.bottom) / 2, insets.top, height - insets.bottom);
        // A point inside its own box counts even under a neighbour: that is an overlap, not a size.
        const own = ([px, py]) => px >= box.left && px <= box.right && py >= box.top && py <= box.bottom;
        const missed = [[x, y], [x - half, y], [x + half, y], [x, y - half], [x, y + half]]
          .filter((point) => !own(point))
          .map(([px, py]) => doc.elementFromPoint(px, py))
          .filter((hit) => !el.contains(hit));
        return { el, box, missed };
      })
      .filter(({ missed }) => missed.length > 0)
      .map(({ el, box, missed }) => `${name(el)} (${Math.round(box.width)}x${Math.round(box.height)}, a tap beside it lands on ${missed.map(name).join(', ')})`);
  }, { insets, controls: CONTROLS });
}

/** How far each of the page's insets reaches over the game frame: what the dev host must send. */
function overFrame(page, insets) {
  return page.locator('.dev-host__frame').evaluate((frame, insets) => {
    const box = frame.getBoundingClientRect();
    const gaps = { top: box.top, right: innerWidth - box.right, bottom: innerHeight - box.bottom, left: box.left };
    return Object.fromEntries(Object.entries(insets).map(([side, inset]) => [side, Math.max(0, inset - gaps[side])]));
  }, insets);
}

/** The four `--bsg-safe-*` the shell resolved, in px, once its easing has settled. */
function shellInsets(frame) {
  return frame.locator('body').evaluate(async (body, sides) => {
    const doc = body.ownerDocument;
    const easing = () => doc.getAnimations().filter((a) => a.transitionProperty);
    while (easing().length > 0) await Promise.allSettled(easing().map((a) => a.finished));
    const root = getComputedStyle(doc.documentElement);
    return Object.fromEntries(sides.map((side) => [side, parseFloat(root.getPropertyValue(`--bsg-safe-${side}`))]));
  }, SIDES);
}

await runBrowserRegression({ script: 'safe-area-browser.mjs', engines: ['chromium', 'webkit'], table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  let player;
  try {
    for (const { viewport, page: notch } of PHONES) {
      const size = `${viewport.width}x${viewport.height}`;
      // One seat throughout: a later page reclaims the first page's client id, as `onEachPhone` does.
      const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, reducedMotion: 'reduce', storageState: player });
      try {
        const page = await context.newPage();
        const frame = await openTableSample(page, hostUrl);
        player ??= await context.storageState();

        // The page's own insets, where the dev host reads them, then the resize a rotation brings.
        await page.addStyleTag({ content: `.bsg-safe-area-probe { padding: ${notch.top}px ${notch.right}px ${notch.bottom}px ${notch.left}px !important; }` });
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        const insets = await overFrame(page, notch);
        await check(`the dev host sends the frame its safe areas, and the shell takes them, at ${size}: ${JSON.stringify(insets)}`, async () => {
          assert(SIDES.some((side) => insets[side] > 0), `the page's insets ${JSON.stringify(notch)} reach nowhere over the frame, so nothing is tested`);
          const read = await waitUntil(() => shellInsets(frame), (read) => SIDES.every((side) => read[side] === insets[side]));
          assert(SIDES.every((side) => read[side] === insets[side]), `the shell resolved ${JSON.stringify(read)}, not ${JSON.stringify(insets)}`);
        });

        await check(`no control sits inside an inset with the action bar up at ${size}`, async () => {
          const found = await inInsets(frame, insets);
          assert(found.length === 0, `inside ${JSON.stringify(insets)}: ${found.join('; ')}`);
        });
        await check(`every shell control takes a 44px tap with the action bar up at ${size}`, async () => {
          const found = await smallTargets(frame, insets);
          assert(found.length === 0, `smaller than 44px: ${found.join('; ')}`);
        });

        await frame.locator('[data-testid="bs-actionbar"] .menubtn').click();
        await frame.locator('.menu').waitFor();
        await check(`no control sits inside an inset with the controls menu open at ${size}`, async () => {
          const found = await inInsets(frame, insets);
          assert(found.length === 0, `inside ${JSON.stringify(insets)}: ${found.join('; ')}`);
        });
        await check(`every shell control takes a 44px tap with the controls menu open at ${size}`, async () => {
          const found = await smallTargets(frame, insets);
          assert(found.length === 0, `smaller than 44px: ${found.join('; ')}`);
        });
        await page.keyboard.press('Escape');
        await frame.locator('.menu').waitFor({ state: 'detached' });

        if (viewport.width < 640) {
          await frame.locator('.mobile-strip__toggle').click();
          await frame.locator('.sidebar.mobile-expanded .side-scroll').waitFor();
          await check(`no control sits inside an inset with the phone strip expanded at ${size}`, async () => {
            const found = await inInsets(frame, insets);
            assert(found.length === 0, `inside ${JSON.stringify(insets)}: ${found.join('; ')}`);
          });
          await check(`every shell control takes a 44px tap with the phone strip expanded at ${size}`, async () => {
            const found = await smallTargets(frame, insets);
            assert(found.length === 0, `smaller than 44px: ${found.join('; ')}`);
          });
          await frame.locator('.mobile-strip__toggle').click();
          await frame.locator('.sidebar.mobile-expanded').waitFor({ state: 'detached' });
        }

        await frame.locator('.bar-edge').click();
        await frame.locator('.actionbar.collapsed').waitFor();
        await check(`no control sits inside an inset with the action bar put down at ${size}`, async () => {
          const found = await inInsets(frame, insets);
          assert(found.length === 0, `inside ${JSON.stringify(insets)}: ${found.join('; ')}`);
        });
        await check(`every shell control takes a 44px tap with the action bar put down at ${size}`, async () => {
          const found = await smallTargets(frame, insets);
          assert(found.length === 0, `smaller than 44px: ${found.join('; ')}`);
        });
        await frame.locator('.bar-edge').click();
        await frame.locator('.actionbar.collapsed').waitFor({ state: 'detached' });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return summarise('for the safe areas and touch target sizes');
});
