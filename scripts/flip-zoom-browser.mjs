#!/usr/bin/env node
/**
 * A FLIP STARTS WHERE THE PIECE WAS, AT ANY BOARD ZOOM (#1619).
 *
 * FLIP measures a move in screen pixels and plays it back as a translate
 * inside the board, which the player's magnifier scales. At 200% a piece that
 * moved 100 screen pixels used to start 200 away and jump. So at 200% zoom a
 * board moves a piece with `useFLIP` and another with `createFLIPSnapshot`,
 * and on the first frame of each animation the piece is where it was.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/flip-zoom-browser.mjs`.
 */
import { assert, check, onTablePage, runBrowserRegression, summarise } from './browser-harness.mjs';

// The animations are long and linear, so the first frame sampled is still at their start.
const MOVE_BOARD = `<template>
  <div ref="board" style="position: relative; width: 300px; height: 200px">
    <div data-element-id="a" :style="{ position: 'absolute', top: '0px', left: movedA ? '100px' : '0px', width: '20px', height: '20px' }"></div>
    <div data-element-id="b" :style="{ position: 'absolute', top: '50px', left: movedB ? '100px' : '0px', width: '20px', height: '20px' }"></div>
    <button type="button" class="move-a" style="position: absolute; left: 0; top: 150px" @click="moveA">Move A</button>
    <button type="button" class="move-b" style="position: absolute; left: 100px; top: 150px" @click="moveB">Move B</button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { createFLIPSnapshot, useFLIP } from 'boardsmith/ui';

const board = ref<HTMLElement | null>(null);
const movedA = ref(false);
const movedB = ref(false);
const options = { duration: 600_000, easing: 'linear' };
const { capture, animate } = useFLIP({ containerRef: board, selector: '[data-element-id="a"]', ...options });

async function moveA() {
  capture();
  movedA.value = true;
  await nextTick();
  void animate();
}

async function moveB() {
  const snapshot = createFLIPSnapshot(board, '[data-element-id="b"]', options);
  movedB.value = true;
  await nextTick();
  void snapshot.animate();
}
</script>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Move from './components/Move.vue';

export default defineGameUIs({ Move: defaultUI(Move) });
`;

/** The piece's screen left, then its screen left on the next animation frame after `click`. */
const leftAcrossMove = (frame, id, button) =>
  frame.locator('body').evaluate(
    (body, { id, button }) =>
      new Promise((resolve) => {
        const doc = body.ownerDocument;
        const piece = doc.querySelector(`[data-element-id="${id}"]`);
        const before = piece.getBoundingClientRect().left;
        doc.querySelector(button).click();
        doc.defaultView.requestAnimationFrame(() =>
          doc.defaultView.requestAnimationFrame(() => resolve({ before, first: piece.getBoundingClientRect().left })),
        );
      }),
    { id, button },
  );

await runBrowserRegression(
  { script: 'flip-zoom-browser.mjs', engines: ['chromium', 'webkit'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Move.vue': MOVE_BOARD } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      await onTablePage(browser, hostUrl, { width: 1440, height: 900 }, async (_page, frame) => {
        await frame.getByRole('button', { name: 'Game controls' }).click();
        await frame.getByRole('slider', { name: 'Zoom' }).fill('2');
        await frame.getByRole('slider', { name: 'Zoom' }).press('Escape');
        await frame.locator('.move-a').waitFor();

        const flip = await leftAcrossMove(frame, 'a', '.move-a');
        await check('at 200% zoom, a piece useFLIP animates starts where it was', async () => {
          assert(Math.abs(flip.first - flip.before) <= 1,
            `the piece was at ${flip.before}px and its animation started at ${flip.first}px`);
        });

        const snapshot = await leftAcrossMove(frame, 'b', '.move-b');
        await check('at 200% zoom, a piece createFLIPSnapshot animates starts where it was', async () => {
          assert(Math.abs(snapshot.first - snapshot.before) <= 1,
            `the piece was at ${snapshot.before}px and its animation started at ${snapshot.first}px`);
        });
      });
    } finally {
      await browser.close();
    }
    return summarise('for a FLIP under the board zoom');
  },
);
