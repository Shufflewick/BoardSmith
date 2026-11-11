#!/usr/bin/env node
/**
 * A FLYING CARD MOVES BY ITS TRANSFORM, NOT BY LEFT AND TOP (#1612).
 *
 * A card in flight used to have its `left` and `top` rewritten every frame,
 * which makes a slow phone lay the page out again each frame. Its transform is
 * the only thing that may change: so a board flies a card across itself, and
 * over the frames of the flight the card's `left` and `top` stay where it
 * started while its transform moves it.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/flying-card-transform-browser.mjs`.
 */
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

// The flight is long so it is still under way for every frame sampled, however busy the machine is.
const FLIGHT_BOARD = `<template>
  <div style="position: relative; height: 200px">
    <div ref="from" style="position: absolute; left: 0; top: 0; width: 60px; height: 84px"></div>
    <div ref="to" style="position: absolute; left: 300px; top: 100px; width: 60px; height: 84px"></div>
    <button type="button" class="fly" style="position: absolute; left: 0; top: 150px" @click="launch">Fly</button>
    <FlyingCardsOverlay :flying-cards="flyingElements" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { FlyingCardsOverlay, useFlyingElements } from 'boardsmith/ui';

const from = ref<HTMLElement | null>(null);
const to = ref<HTMLElement | null>(null);
const { fly, flyingElements } = useFlyingElements({ duration: 600_000, holdDuration: 0 });

function launch() {
  void fly({ id: 'card', startRect: from.value!, endRect: to.value!, elementData: { rank: 'A', suit: 'S' }, flip: true });
}
</script>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Flight from './components/Flight.vue';

export default defineGameUIs({ Flight: defaultUI(Flight) });
`;

/** The flying card's left, top and transform on each of the next `count` animation frames. */
const sampleFrames = (frame, count) =>
  frame.locator('body').evaluate(
    (body, count) =>
      new Promise((resolve) => {
        const doc = body.ownerDocument;
        const win = doc.defaultView;
        const seen = [];
        const sample = () => {
          const card = doc.querySelector('.flying-card');
          seen.push(card && { left: card.style.left, top: card.style.top, transform: card.style.transform });
          if (seen.length < count) win.requestAnimationFrame(sample);
          else resolve(seen);
        };
        win.requestAnimationFrame(sample);
      }),
    count,
  );

await runBrowserRegression(
  { script: 'flying-card-transform-browser.mjs', engines: ['chromium'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Flight.vue': FLIGHT_BOARD } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const frame = await openTableSample(page, hostUrl);
      await frame.locator('.fly').click();
      await frame.locator('.flying-card').waitFor({ timeout: 10_000 });
      const frames = await sampleFrames(frame, 12);
      console.log(`  first: ${JSON.stringify(frames[0])}, last: ${JSON.stringify(frames.at(-1))}`);
      await check('a flying card keeps its left and top for the whole flight, and moves by its transform', async () => {
        assert(frames.every(Boolean), `the card left flight early: ${JSON.stringify(frames)}`);
        const positions = new Set(frames.map(({ left, top }) => `${left},${top}`));
        assert(positions.size === 1, `left and top were rewritten during the flight: ${[...positions].join(' then ')}`);
        const transforms = new Set(frames.map(({ transform }) => transform));
        assert(transforms.size > 1, `the transform never changed over ${frames.length} frames: ${[...transforms][0]}`);
      });
    } finally {
      await browser.close();
    }
    return summarise('for a flying card');
  },
);
