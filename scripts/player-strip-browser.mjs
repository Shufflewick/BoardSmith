#!/usr/bin/env node
/**
 * THE PHONE STRIP IS ONE ROW, WITH EACH SEAT'S EXTRA BESIDE ITS BADGE (#1647).
 *
 * A game's `#player-strip-extra` content (an HP gauge) sat under each badge, and
 * the phone strip also showed the "is playing" sentence, so the strip took two
 * rows on a 375px phone. On phones the content sits beside the badge, the
 * sentence is only for screen readers, and a looping outline on the acting
 * badge says whose turn it is, still under reduced motion. The desktop rail
 * keeps the content under the badge. jsdom does no layout and runs no CSS
 * animation, so only a browser can say any of this.
 *
 * Served from `boardsmith init`'s table sample with a 32px box in the slot, the
 * size of Wind Up Warfare's compact gauge.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/player-strip-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const APP = `<script setup lang="ts">
import { GameShell } from 'boardsmith/ui';
import uis from './uis.js';
</script>

<template>
  <GameShell :uis="uis">
    <template #player-strip-extra>
      <span class="extra" style="display: block; width: 32px; height: 32px; background: gray"></span>
    </template>
  </GameShell>
</template>
`;

const PHONES = [320, 375, 390];

/** Each strip seat's token and extra box, the status sentence, and the acting token's outline animation. */
function readStrip(frame, strip) {
  return frame.locator(strip).evaluate((root) => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const status = root.querySelector('.strip-status');
    const acting = root.querySelector('.pt.strip-active > .tok');
    const ring = acting && root.ownerDocument.getAnimations().find((a) => a.effect.target === acting && a.effect.pseudoElement === '::after');
    const after = acting && getComputedStyle(acting, '::after');
    return {
      root: box(root),
      seats: [...root.querySelectorAll('.strip-tokens .pt')].map((pt) => ({ tok: box(pt.querySelector('.tok')), extra: box(pt.querySelector('.extra')) })),
      status: { text: status.textContent, shown: status.getBoundingClientRect().width > 1, inTree: getComputedStyle(status).display !== 'none' },
      acting: !!acting,
      ring: ring && {
        iterations: ring.effect.getTiming().iterations,
        properties: [...new Set(ring.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)),
      },
      still: after && { content: after.content, opacity: after.opacity, borderStyle: after.borderTopStyle },
    };
  });
}

await runBrowserRegression({ script: 'player-strip-browser.mjs', table: { files: { 'src/ui/App.vue': APP } } }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const frame = await openTableSample(page, hostUrl);

    for (const width of PHONES) {
      await page.setViewportSize({ width, height: 800 });
      const read = await readStrip(frame, '.mobile-strip .seat-strip');
      const toggle = await frame.locator('.mobile-strip__toggle').evaluate((el) => el.getBoundingClientRect().left);
      await check(`at ${width}px the strip is one row, each extra beside its badge`, async () => {
        const rows = new Set(read.seats.map((s) => Math.round((s.tok.top + s.tok.bottom) / 2)));
        assert(read.seats.length > 1 && rows.size === 1, `the badges sit on ${rows.size} rows: ${JSON.stringify(read.seats)}`);
        for (const { tok, extra } of read.seats) {
          assert(extra.left >= tok.right && extra.top < tok.bottom && extra.bottom > tok.top, `an extra is not beside its badge: ${JSON.stringify({ tok, extra })}`);
        }
        assert(read.seats.at(-1).extra.right <= toggle, `the last extra runs under the toggle: ${read.seats.at(-1).extra.right} > ${toggle}`);
        assert(read.root.bottom - read.root.top <= 34 + 1, `the strip's players are ${read.root.bottom - read.root.top}px tall, more than one 34px row`);
      });
      await check(`at ${width}px the turn sentence is not drawn but stays for screen readers`, async () => {
        assert(read.status.text !== '' && !read.status.shown && read.status.inTree, JSON.stringify(read.status));
      });
      await check(`at ${width}px the acting badge has a looping outline animated on transform and opacity only`, async () => {
        assert(read.acting, 'no seat is acting');
        assert(read.ring && read.ring.iterations === Infinity, `the outline does not loop: ${JSON.stringify(read.ring)}`);
        assert(read.ring.properties.every((p) => p === 'transform' || p === 'opacity'), `the outline animates ${read.ring.properties.join(', ')}`);
      });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await frame.getByRole('button', { name: 'Collapse panel' }).click();
    await frame.locator('.side-scroll .seat-strip').waitFor();
    await check('the desktop rail keeps each extra under its badge', async () => {
      const read = await readStrip(frame, '.side-scroll .seat-strip');
      for (const { tok, extra } of read.seats) {
        assert(extra.top >= tok.bottom, `an extra is not under its badge: ${JSON.stringify({ tok, extra })}`);
      }
    });

    await page.setViewportSize({ width: 375, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await waitUntil(() => frame.locator('html').evaluate((el) => el.classList.contains('bs-reduce-motion')), Boolean, 5_000);
    await check('under reduced motion the acting badge keeps a still outline', async () => {
      const read = await readStrip(frame, '.mobile-strip .seat-strip');
      assert(read.acting && !read.ring, `the outline still animates: ${JSON.stringify(read.ring)}`);
      assert(read.still.content !== 'none' && read.still.opacity === '1' && read.still.borderStyle === 'solid', `no still outline: ${JSON.stringify(read.still)}`);
    });
  } finally {
    await browser.close();
  }
  return summarise('for the player strip');
});
