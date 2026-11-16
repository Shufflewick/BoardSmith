#!/usr/bin/env node
/**
 * A FLYING CARD IS THE SIZE OF THE CARDS IT FLIES BETWEEN, AT ANY BOARD ZOOM (#1664).
 *
 * The flying card is drawn in an overlay on the page, outside the board the
 * player's magnifier scales, so at 200% a card the board draws at 120x168
 * screen pixels used to fly at 60x84 and snap back to full size when it landed.
 * So at 200% zoom a board flies a card the size of its own cards, and on the
 * screen the card in flight is the size of the card it left.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/flying-zoom-browser.mjs`.
 */
import { assert, check, onDesktopTable, runBrowserRegression, summarise } from './browser-harness.mjs';

// The flight is long so it is still under way when it is measured, however busy the machine is.
const FLIGHT_BOARD = `<template>
  <div style="position: relative; width: 400px; height: 200px">
    <div ref="from" class="from" style="position: absolute; left: 0; top: 0; width: 60px; height: 84px"></div>
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
const { fly, flyingElements } = useFlyingElements({ duration: 600_000, holdDuration: 0, elementSize: { width: 60, height: 84 } });

function launch() {
  void fly({ id: 'card', startRect: from.value!, endRect: to.value!, elementData: { rank: 'A', suit: 'S' } });
}
</script>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Flight from './components/Flight.vue';

export default defineGameUIs({ Flight: defaultUI(Flight) });
`;

/** Set the board magnifier from the controls menu, then close the menu. */
async function zoomTo(frame, level) {
  await frame.getByRole('button', { name: 'Game controls' }).click();
  await frame.getByRole('slider', { name: 'Zoom' }).fill(level);
  await frame.getByRole('slider', { name: 'Zoom' }).press('Escape');
}

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
  { script: 'flying-zoom-browser.mjs', engines: ['chromium', 'webkit'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Flight.vue': FLIGHT_BOARD } } },
  async ({ launch, hostUrl }) => {
    await onDesktopTable(launch, hostUrl, async (_page, frame) => {
      await zoomTo(frame, '2');
      await frame.locator('.fly').click();
      await frame.locator('.flying-card').waitFor({ timeout: 10_000 });
      const sizes = await screenSizes(frame);
      console.log(`  ${JSON.stringify(sizes)}`);
      await check('at 200% zoom, a flying card is the size of the card it left', async () => {
        assert(sizes.from.width === 120 && sizes.from.height === 168,
          `the board's card is ${sizes.from.width}x${sizes.from.height} on screen, not the 120x168 a 200% zoom makes it`);
        assert(Math.abs(sizes.flying.width - sizes.from.width) <= 1 && Math.abs(sizes.flying.height - sizes.from.height) <= 1,
          `the board's card is ${sizes.from.width}x${sizes.from.height} on screen and the flying card is ${sizes.flying.width}x${sizes.flying.height}`);
      });
    });
    return summarise('for a flying card under the board zoom');
  },
);
