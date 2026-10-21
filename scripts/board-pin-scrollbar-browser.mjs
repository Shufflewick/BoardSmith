#!/usr/bin/env node
/**
 * A PINNED BOARD'S WIDTH AND ZOOM DO NOT DEPEND ON THE REGION'S VERTICAL SCROLLBAR (#1343).
 *
 * In a browser without `scrollbar-gutter` (Safari before 18.2) and with classic
 * scrollbars, `.boardregion` loses the scrollbar's width while its vertical
 * scrollbar shows. `useBoardSize` pinned the board to that width, so the pin
 * changed as the scrollbar came and went, and `useAutoZoom` fitted the board
 * against a pin from the other scrollbar state, at about 0.98 or 1.02. That
 * zoom moved the board across the region's overflow point, so the pin and the
 * zoom flipped every frame. Both now measure the region with its vertical
 * scrollbar showing, whether or not it shows.
 *
 * Served from `boardsmith init`'s table sample with a board that calls
 * `useBoardSize`, in Chromium with classic scrollbars and the region's gutter
 * turned off, which is how such a Safari lays the region out.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/board-pin-scrollbar-browser.mjs`; a missing Chromium says to run
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
  <div ref="boardRef" class="pinned-board" :style="boardStyle"></div>
</template>

<style>
.pinned-board { height: 100px; background: rebeccapurple; }
</style>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Pinned from './components/Pinned.vue';

export default defineGameUIs({ Pinned: defaultUI(Pinned) });
`;

/** Turn the region's gutter off and count ResizeObserver loop errors from here on. */
function withoutGutter(frame) {
  return frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const style = doc.createElement('style');
    style.textContent = '.boardregion { scrollbar-gutter: auto !important; }';
    doc.head.append(style);
    doc.defaultView.loopErrors = 0;
    doc.defaultView.addEventListener('error', (event) => {
      if (/ResizeObserver loop/.test(event.message)) doc.defaultView.loopErrors += 1;
    });
  });
}

/**
 * Make the board just shorter, then just taller, than the region's room for it,
 * and read, ten frames after each, the pin, the zoom, and whether the region
 * scrolls either way.
 */
function crossTheOverflowPoint(frame) {
  return frame.locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const region = doc.querySelector('.boardregion');
    const board = doc.querySelector('.pinned-board');
    const zoomed = doc.querySelector('.game-shell__zoom-container');
    const nextFrame = () => new Promise((settle) => win.requestAnimationFrame(settle));
    const cs = win.getComputedStyle(region);
    const room = region.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const seen = [];
    for (const height of [room - 4, room + 4, room - 4]) {
      board.style.height = `${height}px`;
      const frames = [];
      for (let i = 0; i < 10; i++) {
        await nextFrame();
        frames.push({
          pin: board.style.width,
          zoom: win.getComputedStyle(zoomed).zoom,
          down: region.scrollHeight > region.clientHeight,
          sideways: region.scrollWidth > region.clientWidth,
        });
      }
      seen.push({ height, frames });
    }
    return { seen, loopErrors: win.loopErrors };
  });
}

/**
 * Give the board an aspect ratio that makes it taller than the region's room at
 * the region's full width and shorter at that width less a scrollbar, and read
 * the zoom, and whether the region scrolls sideways, on each of the next twenty frames.
 */
function heightFollowsWidth(frame) {
  return frame.locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const region = doc.querySelector('.boardregion');
    const board = doc.querySelector('.pinned-board');
    const zoomed = doc.querySelector('.game-shell__zoom-container');
    const nextFrame = () => new Promise((settle) => win.requestAnimationFrame(settle));
    const cs = win.getComputedStyle(region);
    const room = region.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const width = region.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    board.style.height = 'auto';
    board.style.aspectRatio = `${width - 7} / ${room}`;
    const frames = [];
    for (let i = 0; i < 20; i++) {
      await nextFrame();
      frames.push({
        zoom: win.getComputedStyle(zoomed).zoom,
        sideways: region.scrollWidth > region.clientWidth,
      });
    }
    return frames;
  });
}

await runBrowserRegression(
  {
    script: 'board-pin-scrollbar-browser.mjs',
    table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Pinned.vue': PINNED_BOARD } },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch({ classicScrollbars: true });
    try {
      // 1024 wide puts the region's content box on a fraction of a pixel (#1336).
      const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
      const frame = await openTableSample(page, hostUrl);
      await withoutGutter(frame);

      const { seen, loopErrors } = await crossTheOverflowPoint(frame);
      const frames = seen.flatMap((step) => step.frames);
      const pins = [...new Set(frames.map((f) => f.pin))];
      const zooms = [...new Set(frames.map((f) => f.zoom))];

      await check('the region shows its vertical scrollbar only while the board is taller than its room', async () => {
        const shows = seen.map((step) => step.frames.at(-1).down);
        assert(shows.join() === 'false,true,false', `the region scrolled down: ${shows.join(', ')}, for boards ${seen.map((s) => s.height).join(', ')}px tall`);
      });
      await check('the pin stays the same whether or not the vertical scrollbar shows', async () => {
        assert(pins.length === 1, `the pin was ${pins.join(', then ')}`);
      });
      await check('the zoom stays at 1 whether or not the vertical scrollbar shows', async () => {
        assert(zooms.length === 1 && zooms[0] === '1', `the zoom was ${zooms.join(', then ')}`);
      });
      await check('the region never scrolls sideways', async () => {
        const at = frames.findIndex((f) => f.sideways);
        assert(at === -1, `the region scrolled sideways at frame ${at}`);
      });
      await check('the browser reports no ResizeObserver loop', async () => {
        assert(loopErrors === 0, `${loopErrors} ResizeObserver loop errors`);
      });

      const following = await heightFollowsWidth(frame);
      await check('a board whose height follows its width stays at a zoom of 1, with nothing to scroll sideways', async () => {
        const off = following.findIndex((f) => f.zoom !== '1' || f.sideways);
        assert(off === -1, `at frame ${off} the zoom was ${following[off]?.zoom}${following[off]?.sideways ? ' and the region scrolled sideways' : ''}`);
      });
    } finally {
      await browser.close();
    }
    return summarise('the pinned board as the region\'s vertical scrollbar comes and goes');
  },
);
