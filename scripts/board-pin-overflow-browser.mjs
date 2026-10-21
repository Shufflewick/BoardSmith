#!/usr/bin/env node
/**
 * A PINNED BOARD NEVER OVERFLOWS ITS REGION SIDEWAYS WHILE THE REGION NARROWS (#1336),
 * AND ITS WIDTH AND ZOOM DO NOT DEPEND ON THE REGION'S VERTICAL SCROLLBAR (#1343).
 *
 * `useBoardSize` pins a board to `.boardregion`'s width, and the pin is
 * re-measured by a ResizeObserver, which runs after layout. When the region
 * narrows with no window `resize` (the sidebar's width transition), the old pin
 * was one pixel wider than the region for that layout: with classic scrollbars
 * the region showed a horizontal scrollbar, lost its height to it, and the
 * browser reported `ResizeObserver loop completed with undelivered notifications`.
 *
 * In a browser without `scrollbar-gutter` (Safari before 18.2) and with classic
 * scrollbars, the region loses the scrollbar's width while its vertical
 * scrollbar shows. The pin followed that width, so it changed as the scrollbar
 * came and went, and the zoom fit read a pin from the other scrollbar state, at
 * about 0.98 or 1.02. That zoom moved the board across the region's overflow
 * point, so the pin and the zoom flipped every frame. Both now measure the
 * region with its vertical scrollbar showing, whether or not it shows.
 *
 * Without a gutter, Chromium and WebKit also resolve `100cqw` as if the
 * region's vertical scrollbar were not there, so the #1336 cap was a scrollbar
 * too wide and a stale pin overflowed while the region narrowed (#1353).
 *
 * Served from `boardsmith init`'s table sample with a board that calls
 * `useBoardSize`, in Chromium with classic (space-taking) scrollbars. The
 * board is first moved across the region's overflow point with the region's
 * gutter turned off, which is how such a Safari lays the region out. Then the
 * sidebar is widened a quarter pixel per frame, so the region crosses several
 * whole pixels with no resize event, and each frame is read before the
 * ResizeObserver can re-pin; once with the gutter, and once without it and
 * with the vertical scrollbar showing.
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

/**
 * With the region's gutter off, make the board just shorter, just taller, then
 * just shorter than the region's room for it, and last give it an aspect ratio
 * that makes it taller than that room at the region's full width and shorter at
 * that width less a scrollbar. Ten frames after each, read the pin, the zoom,
 * and whether the region scrolls either way. Puts the gutter and the board back.
 */
function crossTheOverflowPoint(frame) {
  return frame.locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const region = doc.querySelector('.boardregion');
    const board = doc.querySelector('.pinned-board');
    const zoomed = doc.querySelector('.game-shell__zoom-container');
    const nextFrame = () => new Promise((settle) => win.requestAnimationFrame(settle));
    const noGutter = doc.createElement('style');
    noGutter.textContent = '.boardregion { scrollbar-gutter: auto !important; }';
    doc.head.append(noGutter);
    let loopErrors = 0;
    const countLoop = (event) => { if (/ResizeObserver loop/.test(event.message)) loopErrors += 1; };
    win.addEventListener('error', countLoop);
    await nextFrame();

    const cs = win.getComputedStyle(region);
    const room = region.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const width = region.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const steps = [
      { height: `${room - 4}px` },
      { height: `${room + 4}px` },
      { height: `${room - 4}px` },
      { height: 'auto', aspectRatio: `${width - 7} / ${room}` },
    ];
    const seen = [];
    for (const step of steps) {
      Object.assign(board.style, step);
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
      seen.push({ step, frames });
    }

    win.removeEventListener('error', countLoop);
    noGutter.remove();
    Object.assign(board.style, { height: '', aspectRatio: '' });
    await nextFrame();
    return { seen, loopErrors };
  });
}

/**
 * Widen the sidebar 0.25px a frame and, each frame, read the region before the
 * ResizeObserver runs. `scrolling` first turns the region's gutter off and makes
 * the board taller than the region, so its vertical scrollbar shows (#1353);
 * both are put back after.
 */
function narrowTheRegion(frame, scrolling = false) {
  return frame.locator('body').evaluate(async (body, scrolling) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const region = doc.querySelector('.boardregion');
    const sidebar = doc.querySelector('.sidebar');
    const board = doc.querySelector('.pinned-board');
    const nextFrame = () => new Promise((settle) => win.requestAnimationFrame(settle));
    const noGutter = doc.createElement('style');
    if (scrolling) {
      noGutter.textContent = '.boardregion { scrollbar-gutter: auto !important; }';
      // Off while the board is short, so the region widens and the pin is re-measured, as it is from mount in such a browser.
      doc.head.append(noGutter);
      for (let i = 0; i < 5; i++) await nextFrame();
      board.style.height = `${region.scrollHeight + 40}px`;
      for (let i = 0; i < 5; i++) await nextFrame();
    }
    const scrollbarShows = region.scrollHeight > region.clientHeight;

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
    const narrowedBy = regionBefore - region.clientWidth;
    noGutter.remove();
    board.style.height = '';
    await nextFrame();
    return { overflows, narrowedBy, scrollbarShows };
  }, scrolling);
}

/**
 * Narrow the sidebar in three steps, one a frame, each before the zoom's queued
 * re-fit runs, so that re-fit reads the wider region against the last pin, as
 * when the sidebar's width transition or a host frame widens the region (#1357).
 * The last step is under half a percent of the region. Ten frames later, read
 * the zoom and whether the region scrolls sideways.
 */
function widenTheRegionInSteps(frame) {
  return frame.locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument;
    const win = doc.defaultView;
    const region = doc.querySelector('.boardregion');
    const sidebar = doc.querySelector('.sidebar');
    const zoomed = doc.querySelector('.game-shell__zoom-container');
    const nextFrame = () => new Promise((settle) => win.requestAnimationFrame(settle));
    sidebar.style.transition = 'none';
    const start = sidebar.getBoundingClientRect().width;
    const regionBefore = region.clientWidth;
    for (const narrowedBy of [50, 60, 62]) {
      await nextFrame();
      sidebar.style.width = `${start - narrowedBy}px`;
    }
    for (let i = 0; i < 10; i++) await nextFrame();
    return {
      widenedBy: region.clientWidth - regionBefore,
      zoom: win.getComputedStyle(zoomed).zoom,
      sideways: region.scrollWidth > region.clientWidth,
    };
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

      const crossing = await crossTheOverflowPoint(frame);
      const frames = crossing.seen.flatMap((step) => step.frames);
      const pins = [...new Set(frames.map((f) => f.pin))];
      const zooms = [...new Set(frames.map((f) => f.zoom))];
      await check('without a gutter, the region scrolls down only while the board is taller than its room', async () => {
        const shows = crossing.seen.slice(0, 3).map((step) => step.frames.at(-1).down);
        assert(shows.join() === 'false,true,false', `the region scrolled down: ${shows.join(', ')}`);
      });
      await check('without a gutter, the pin stays the same whether or not the vertical scrollbar shows', async () => {
        assert(pins.length === 1, `the pin was ${pins.join(', then ')}`);
      });
      await check('without a gutter, the zoom stays at 1, even for a board whose height follows its width', async () => {
        assert(zooms.length === 1 && zooms[0] === '1', `the zoom was ${zooms.join(', then ')}`);
      });
      await check('without a gutter, the region never scrolls sideways', async () => {
        const at = frames.findIndex((f) => f.sideways);
        assert(at === -1, `the region scrolled sideways on frame ${at % 10} of step ${Math.floor(at / 10) + 1}`);
      });
      await check('without a gutter, the browser reports no ResizeObserver loop', async () => {
        assert(crossing.loopErrors === 0, `${crossing.loopErrors} ResizeObserver loop errors`);
      });

      const seen = await narrowTheRegion(frame);

      await check('widening the sidebar narrows the region', async () => {
        assert(seen.narrowedBy >= 5, `the region narrowed by ${seen.narrowedBy}px, so nothing below was exercised`);
      });
      await check('the pinned board never overflows the region sideways while the region narrows', async () => {
        assert(seen.overflows.length === 0, `the region scrolled sideways ${seen.overflows.length} times: ${seen.overflows.join('; ')}`);
      });
      const scrolling = await narrowTheRegion(frame, true);
      await check('without a gutter, the region shows its vertical scrollbar and narrows', async () => {
        assert(scrolling.scrollbarShows && scrolling.narrowedBy >= 5,
          `the scrollbar ${scrolling.scrollbarShows ? 'showed' : 'did not show'} and the region narrowed by ${scrolling.narrowedBy}px`);
      });
      await check('without a gutter and with the vertical scrollbar showing, the pinned board never overflows the region sideways while it narrows', async () => {
        assert(scrolling.overflows.length === 0, `the region scrolled sideways ${scrolling.overflows.length} times: ${scrolling.overflows.join('; ')}`);
      });
      const settled = await settledBoard(frame);
      await check('the pinned board still fills the region once it settles', async () => {
        assert(Math.abs(settled.board - settled.available) <= 1, `the board is ${settled.board}px wide in ${settled.available}px of region`);
      });
      const widened = await widenTheRegionInSteps(frame);
      await check('once the region has widened in steps, the zoom is back at 1 and the region does not scroll sideways', async () => {
        assert(widened.widenedBy >= 60 && widened.zoom === '1' && !widened.sideways,
          `the region widened by ${widened.widenedBy}px and the zoom is ${widened.zoom}${widened.sideways ? ', so the region scrolls sideways' : ''}`);
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
    return summarise('the pinned board as its region narrows and its scrollbar comes and goes');
  },
);
