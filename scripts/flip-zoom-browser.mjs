#!/usr/bin/env node
/**
 * A FLIP STARTS WHERE THE PIECE WAS, AND A FLYING CARD IS THE SIZE OF THE
 * CARD IT LEFT, AT ANY BOARD ZOOM (#1619, #1664).
 *
 * FLIP measures a move in screen pixels and plays it back as a translate
 * inside the board, which the player's magnifier scales. At 200% a piece that
 * moved 100 screen pixels used to start 200 away and jump. So at 200% zoom a
 * board moves a piece with `useFLIP` and another with `createFLIPSnapshot`,
 * and on the first frame of each animation the piece is where it was.
 *
 * A flying card is drawn in an overlay outside the board the magnifier scales,
 * so at 200% it used to fly at half the size of the cards it left and snap back
 * when it landed. So the board also flies a card, and on screen the card in
 * flight is the size of the card it left.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/flip-zoom-browser.mjs`.
 */
import { assert, check, onDesktopTable, runBrowserRegression, summarise } from './browser-harness.mjs';

// The animations are long and linear, so the first frame sampled is still at their start.
const MOVE_BOARD = `<template>
  <div ref="board" style="position: relative; width: 300px; height: 200px">
    <div data-element-id="a" :style="{ position: 'absolute', top: '0px', left: movedA ? '100px' : '0px', width: '20px', height: '20px' }"></div>
    <div data-element-id="b" :style="{ position: 'absolute', top: '50px', left: movedB ? '100px' : '0px', width: '20px', height: '20px' }"></div>
    <button type="button" class="move-a" style="position: absolute; left: 0; top: 150px" @click="moveA">Move A</button>
    <button type="button" class="move-b" style="position: absolute; left: 100px; top: 150px" @click="moveB">Move B</button>
    <div ref="from" class="from" style="position: absolute; left: 200px; top: 0; width: 60px; height: 84px"></div>
    <button type="button" class="fly" style="position: absolute; left: 200px; top: 150px" @click="launch">Fly</button>
    <FlyingCardsOverlay :flying-cards="flyingElements" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { FlyingCardsOverlay, createFLIPSnapshot, useFLIP, useFlyingElements } from 'boardsmith/ui';

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

const from = ref<HTMLElement | null>(null);
const { fly, flyingElements } = useFlyingElements({ duration: 600_000, holdDuration: 0, elementSize: { width: 60, height: 84 } });

function launch() {
  void fly({ id: 'card', startRect: from.value!, endRect: board.value!, elementData: { rank: 'A', suit: 'S' } });
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

/** Set the board magnifier from the controls menu, then close the menu. */
async function zoomTo(frame, level) {
  await frame.getByRole('button', { name: 'Game controls' }).click();
  await frame.getByRole('slider', { name: 'Zoom' }).fill(level);
  await frame.getByRole('slider', { name: 'Zoom' }).press('Escape');
}

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

/** The on-screen size of the card the flight leaves and of the card in flight. */
const screenSizes = (frame) =>
  frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const size = (el) => {
      const { width, height } = el.getBoundingClientRect();
      return { width: Math.round(width), height: Math.round(height) };
    };
    return { from: size(doc.querySelector('.from')), flying: size(doc.querySelector('.flying-card')) };
  });

await runBrowserRegression(
  { script: 'flip-zoom-browser.mjs', engines: ['chromium', 'webkit'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Move.vue': MOVE_BOARD } } },
  async ({ launch, hostUrl }) => {
    await onDesktopTable(launch, hostUrl, async (_page, frame) => {
      await zoomTo(frame, '2');

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

      await frame.locator('.fly').click();
      await frame.locator('.flying-card').waitFor({ timeout: 10_000 });
      const sizes = await screenSizes(frame);
      await check('at 200% zoom, a flying card is the size of the card it left', async () => {
        assert(sizes.from.width === 120 && sizes.from.height === 168,
          `the board's card is ${sizes.from.width}x${sizes.from.height} on screen, not the 120x168 a 200% zoom makes it`);
        assert(Math.abs(sizes.flying.width - sizes.from.width) <= 1 && Math.abs(sizes.flying.height - sizes.from.height) <= 1,
          `the board's card is ${sizes.from.width}x${sizes.from.height} on screen and the flying card is ${sizes.flying.width}x${sizes.flying.height}`);
      });
    });
    return summarise('for a FLIP and a flying card under the board zoom');
  },
);
