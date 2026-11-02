#!/usr/bin/env node
/**
 * THE SHELL LEAVES THE TOP-RIGHT CORNER TO THE HOST (#1548).
 *
 * A host such as ShufflewickPub draws its own control (its menu tab) over the
 * game frame's top-right corner. The shell declares that corner as
 * `--bsg-host-corner-width` by `--bsg-host-corner-height` and keeps every piece
 * of its own chrome out of it, so the host sizes its control to the corner
 * instead of copying the shell's pixel offsets. jsdom does no layout, so only a
 * real browser can say nothing the shell draws lands there.
 *
 * Served from `boardsmith init`'s table sample at a desktop width, both sides of
 * the phone tier (640 and 639), a phone and a landscape phone, with the chrome
 * that comes and goes showing: the connection dot (the frame stops hearing the
 * host's heartbeat), and the unread-log badge and a long bot-demo narration,
 * drawn with the shell's own scoped classes. The dot is checked again over a board
 * scrolled down, since it must not scroll into the corner with the board.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/host-corner-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 640, height: 900 },
  { width: 639, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

const NARRATION = 'Player 2 draws the top card of the deck and plays it onto the discard pile, ending their turn';

/** The shell elements drawn in the host's corner, after the shell's easing settles. */
function inCorner(frame) {
  return frame.locator('body').evaluate(async (body, narration) => {
    const doc = body.ownerDocument;
    // A tier change can cancel one easing and start another, so wait until none is left.
    const easing = () => doc.getAnimations().filter((a) => a.transitionProperty);
    while (easing().length > 0) await Promise.allSettled(easing().map((a) => a.finished));

    // A bot demo's narration and the unread-log badge need a demo and a game that logs; draw them with their components' own scoped classes.
    const scopeOf = (cls) => {
      const walk = (rules) => {
        for (const rule of rules) {
          const found = rule.selectorText?.match(new RegExp(`\\.${cls}\\[(data-v-[a-z0-9]+)\\]`))?.[1] ?? (rule.cssRules && walk(rule.cssRules));
          if (found) return found;
        }
        return null;
      };
      return [...doc.styleSheets].map((sheet) => walk(sheet.cssRules)).find(Boolean);
    };
    const scope = scopeOf('bsg-board-message--narration');
    const card = doc.createElement('div');
    card.className = 'bsg-board-message bsg-board-message--narration';
    card.setAttribute(scope, '');
    card.innerHTML = `<div class="bsg-board-message__content bsg-board-message__content--narration" ${scope}></div>`;
    card.firstChild.textContent = narration;
    doc.querySelector('.game-shell').append(card);
    const badge = doc.createElement('span');
    badge.className = 'mobile-strip__unread';
    badge.setAttribute(scopeOf('mobile-strip__unread'), '');
    badge.setAttribute('data-bs-unread', '');
    badge.textContent = '99+';
    doc.querySelector('.mobile-strip__toggle').append(badge);

    const root = getComputedStyle(doc.documentElement);
    const width = parseFloat(root.getPropertyValue('--bsg-host-corner-width'));
    const height = parseFloat(root.getPropertyValue('--bsg-host-corner-height'));
    const corner = { left: doc.documentElement.clientWidth - width, top: 0, right: doc.documentElement.clientWidth, bottom: height };
    const board = doc.querySelector('.game-shell__zoom-container');
    const drawn = (el) =>
      el.checkVisibility() &&
      (el.matches('button, a, input, select, textarea, svg, img, [role="button"], [data-testid="bs-connection"], [data-bs-unread]') ||
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== ''));
    // What of the element is on screen: its box cut by every ancestor that clips its overflow.
    const shown = (el) => {
      let box = el.getBoundingClientRect();
      for (let up = el.parentElement; up; up = up.parentElement) {
        if (getComputedStyle(up).overflow === 'visible') continue;
        const clip = up.getBoundingClientRect();
        box = { left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top), right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom) };
      }
      return box;
    };
    const found = [...doc.querySelectorAll('.game-shell *')]
      .filter((el) => !board.contains(el) && drawn(el))
      .filter((el) => {
        const box = shown(el);
        return box.left < corner.right && box.right > corner.left && box.top < corner.bottom && box.bottom > corner.top;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
    card.remove();
    badge.remove();
    return { width, height, found };
  }, NARRATION);
}

function assertClear(read) {
  assert(read.width > 0 && read.height > 0, `the shell declares no host corner: ${JSON.stringify(read)}`);
  assert(read.found.length === 0, `these shell elements sit in the host's ${read.width}x${read.height}px corner: ${read.found.join('; ')}`);
}

await runBrowserRegression({ script: 'host-corner-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORTS[0] });
    const frame = await openTableSample(page, hostUrl);

    await check('the connection dot shows', async () => {
      // The dot shows only while the host is silent: drop the host's heartbeat until the shell calls it stale.
      await frame.locator('body').evaluate((body) => {
        const doc = body.ownerDocument;
        const win = doc.defaultView;
        const post = win.postMessage.bind(win);
        win.postMessage = (message, ...rest) => (message?.type === 'heartbeat' ? undefined : post(message, ...rest));
      });
      await frame.locator('[data-testid="bs-connection"]').waitFor({ timeout: 30_000 });
    });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await check(`no shell control or text lands in the host's corner at ${viewport.width}x${viewport.height}`, async () => {
        assertClear(await inCorner(frame));
      });
    }

    await page.setViewportSize(VIEWPORTS[0]);
    await check('the connection dot stays out of the corner over a board scrolled down', async () => {
      await frame.locator('.boardregion').evaluate((region) => {
        region.querySelector('.game-shell__zoom-container').style.minHeight = '4000px';
        region.scrollTop = 30;
      });
      assertClear(await inCorner(frame));
    });
  } finally {
    await browser.close();
  }
  return summarise("for the host's reserved corner");
});
