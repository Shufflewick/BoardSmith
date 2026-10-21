#!/usr/bin/env node
/**
 * A PINNED BOARD NEVER OVERFLOWS ITS REGION SIDEWAYS WHILE THE REGION NARROWS (#1336).
 *
 * `useBoardSize` pins a board to `.boardregion`'s width, and the pin is
 * re-measured by a ResizeObserver, which runs after layout. When the region
 * narrows with no window `resize` (the sidebar's width transition), the old pin
 * was one pixel wider than the region for that layout: with classic scrollbars
 * the region showed a horizontal scrollbar, lost its height to it, and the
 * browser reported `ResizeObserver loop completed with undelivered notifications`.
 *
 * Served from `boardsmith init`'s table sample with a board that calls
 * `useBoardSize`, in Chromium with classic (space-taking) scrollbars. The
 * sidebar is widened a quarter pixel per frame, so the region crosses several
 * whole pixels with no resize event, and each frame is read before the
 * ResizeObserver can re-pin.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/board-pin-overflow-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

const PINNED_BOARD = `<script setup lang="ts">
import { ref } from 'vue';
import { useBoardSize } from 'boardsmith/ui';

const boardRef = ref<HTMLElement | null>(null);
const { boardStyle } = useBoardSize(boardRef);
</script>

<template>
  <div ref="boardRef" class="pinned-board" :style="boardStyle">
    <span v-for="n in 40" :key="n" class="chip">{{ n }}</span>
  </div>
</template>

<style>
.pinned-board { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { width: 48px; height: 32px; background: rebeccapurple; color: white; }
</style>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Pinned from './components/Pinned.vue';

export default defineGameUIs({ Pinned: defaultUI(Pinned) });
`;

/** Widen the sidebar 0.25px a frame and, each frame, read the region before the ResizeObserver runs. */
function narrowTheRegion(frame) {
  return frame.locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const region = doc.querySelector('.boardregion');
    const sidebar = doc.querySelector('.sidebar');
    const nextFrame = () => new Promise((settle) => win.requestAnimationFrame(settle));

    const start = sidebar.getBoundingClientRect().width;
    const regionBefore = region.clientWidth;
    sidebar.style.transition = 'none';
    const overflows = [];
    for (let step = 1; step <= 24; step++) {
      await nextFrame();
      sidebar.style.width = `${start + step * 0.25}px`;
      if (region.scrollWidth > region.clientWidth) {
        overflows.push(`at +${step * 0.25}px: content ${region.scrollWidth}px wide in a ${region.clientWidth}px region`);
      }
    }
    return { overflows, narrowedBy: regionBefore - region.clientWidth };
  });
}

/** Once layout settles: the board's rendered width, the region's available width, and whether it scrolls sideways. */
function settledBoard(frame) {
  return frame.locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    await new Promise((settle) => win.requestAnimationFrame(() => win.requestAnimationFrame(settle)));
    const region = doc.querySelector('.boardregion');
    const pad = parseFloat(win.getComputedStyle(region).paddingLeft) + parseFloat(win.getComputedStyle(region).paddingRight);
    const board = doc.querySelector('.pinned-board').getBoundingClientRect().width;
    return { board, available: region.clientWidth - pad, scrolls: region.scrollWidth > region.clientWidth };
  });
}

await runBrowserRegression(
  {
    script: 'board-pin-overflow-browser.mjs',
    table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Pinned.vue': PINNED_BOARD } },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch({ classicScrollbars: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1025, height: 900 } });
      const frame = await openTableSample(page, hostUrl);

      const seen = await narrowTheRegion(frame);

      await check('widening the sidebar narrows the region', async () => {
        assert(seen.narrowedBy >= 5, `the region narrowed by ${seen.narrowedBy}px, so nothing below was exercised`);
      });
      await check('the pinned board never overflows the region sideways while the region narrows', async () => {
        assert(seen.overflows.length === 0, `the region scrolled sideways ${seen.overflows.length} times: ${seen.overflows.join('; ')}`);
      });
      const settled = await settledBoard(frame);
      await check('the pinned board still fills the region once it settles', async () => {
        assert(Math.abs(settled.board - settled.available) <= 1, `the board is ${settled.board}px wide in ${settled.available}px of region`);
      });

      await frame.getByRole('button', { name: 'Game controls' }).click();
      await frame.getByRole('slider', { name: 'Zoom' }).fill('1.5');
      await frame.getByRole('slider', { name: 'Zoom' }).press('Escape');
      const zoomed = await settledBoard(frame);
      const scale = zoomed.board / zoomed.available;
      await check('at 150% zoom the capped pin scales with the board, which scrolls sideways', async () => {
        assert(Math.abs(scale - 1.5) < 0.01 && zoomed.scrolls,
          `the board renders at ${scale.toFixed(3)}x the region's width${zoomed.scrolls ? '' : ' and the region does not scroll'}`);
      });
    } finally {
      await browser.close();
    }
    return summarise('the pinned board in a narrowing region');
  },
);
