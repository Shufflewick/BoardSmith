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
 * the phone tier (640 and 639) and a phone; the connection dot, which shows only
 * while the host is silent, is drawn with the shell's own scoped class.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/host-corner-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 640, height: 900 }, { width: 639, height: 900 }, { width: 390, height: 844 }];

await runBrowserRegression({ script: 'host-corner-browser.mjs', table: true }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORTS[0] });
    const frame = await openTableSample(page, hostUrl);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await check(`no shell control or text lands in the host's corner at ${viewport.width}px`, async () => {
        const read = await frame.locator('body').evaluate(async (body) => {
          const doc = body.ownerDocument;
          // The sidebar eases its width into a new tier; measure where it settles.
          // A tier change can cancel one easing and start another, so wait until none is left.
          const easing = () => doc.getAnimations().filter((a) => a.transitionProperty);
          while (easing().length > 0) await Promise.allSettled(easing().map((a) => a.finished));
          const root = getComputedStyle(doc.documentElement);
          const width = parseFloat(root.getPropertyValue('--bsg-host-corner-width'));
          const height = parseFloat(root.getPropertyValue('--bsg-host-corner-height'));
          const right = doc.documentElement.clientWidth;
          const region = doc.querySelector('.boardregion');
          // The dot shows only while the host is silent; draw it with PlayShell's own scoped attribute.
          const scope = [...region.attributes].find((a) => a.name.startsWith('data-v-')).name;
          const dot = doc.createElement('span');
          dot.className = 'conn-dot stale';
          dot.setAttribute(scope, '');
          region.prepend(dot);
          const board = doc.querySelector('.game-shell__zoom-container');
          const drawn = (el) =>
            el.checkVisibility() &&
            (el.matches('button, a, input, select, textarea, svg, img, [role="button"], .conn-dot') ||
              [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== ''));
          const inCorner = [...doc.querySelectorAll('.game-shell *')]
            .filter((el) => !board.contains(el) && drawn(el))
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && box.right > right - width && box.left < right && box.top < height;
            })
            .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
          dot.remove();
          return { width, height, inCorner };
        });
        assert(read.width > 0 && read.height > 0, `the shell declares no host corner: ${JSON.stringify(read)}`);
        assert(read.inCorner.length === 0, `these shell elements sit in the host's ${read.width}x${read.height}px corner: ${read.inCorner.join('; ')}`);
      });
    }
  } finally {
    await browser.close();
  }
  return summarise("for the host's reserved corner");
});
