#!/usr/bin/env node
/**
 * FOLLOW ACTIVE SEAT NEVER SHOWS A BOARD ONE SEAT OVER ANOTHER SEAT'S VIEW (#1135).
 *
 * Follow active seat moves the page to the next seat with two host messages,
 * `init` and then that seat's `game_state`. The shell applied the seat on
 * `init`, so the board rendered once as the new seat over the old seat's view.
 * A board that read its own seat's private data there threw, Vue's patch of the
 * shell broke, and the Action Panel stayed drawn mid-submission ("Finishing
 * your last move") until a page reload. `GameShell.follow-seat.test.ts` proves
 * the order in jsdom; this proves it through the real dev host, socket and
 * iframe, where the two messages are separate tasks with a render between them.
 *
 * Served from `boardsmith init`'s table sample, whose hands are visible only to
 * their owner, with its board replaced by one that records, on every render,
 * whether the seat it was handed can see its own cards. The page follows the
 * active seat and plays through the Action Panel, so the seat changes after
 * every move.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/follow-seat-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, check, runBrowserRegression, summarise } from './browser-harness.mjs';

/** Records each render's seat and whether that seat's own hand shows its cards. */
const RECORDING_BOARD = `<script setup lang="ts">
import type { TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

type Node = { name?: string; attributes?: Record<string, unknown>; children?: Node[] };
const named = (node: Node | undefined, name: string): Node | undefined => {
  if (!node) return undefined;
  if ((node.name ?? node.attributes?.name) === name) return node;
  for (const child of node.children ?? []) {
    const found = named(child, name);
    if (found) return found;
  }
  return undefined;
};

const renders: Array<{ seat: number; ownCards: boolean }> = ((window as any).__followRenders ??= []);
function record(): string {
  const hand = named(props.gameView as Node | undefined, \`hand-\${props.playerSeat}\`);
  renders.push({ seat: props.playerSeat, ownCards: (hand?.children ?? []).some((card) => card.attributes?.rank !== undefined) });
  return \`Seat \${props.playerSeat}\`;
}
</script>

<template>
  <div class="recording-board">{{ record() }}</div>
</template>
`;

const RECORDING_UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import RecordingBoard from './components/RecordingBoard.vue';

export default defineGameUIs({ Recording: defaultUI(RecordingBoard) });
`;

/** Play whatever the Action Panel offers, `moves` times; clicks go through the DOM because driving is not under test. */
function play(frame, moves) {
  return frame.locator('body').evaluate(async (body, count) => {
    const doc = body.ownerDocument;
    let played = 0;
    for (let step = 0; step < count * 50 && played < count; step++) {
      const button = doc.querySelector('[data-testid="bs-actionbar"] .choice-btn:not([aria-disabled])');
      if (button) {
        button.click();
        played++;
      }
      await new Promise((settle) => setTimeout(settle, 100));
    }
    return played;
  }, moves);
}

await runBrowserRegression({ script: 'follow-seat-browser.mjs', table: true }, async ({ launch, hostUrl, fixture }) => {
  // Before the first page load, so Vite compiles the recording board and never the sample's.
  writeFileSync(join(fixture, 'src/ui/components/RecordingBoard.vue'), RECORDING_BOARD);
  writeFileSync(join(fixture, 'src/ui/uis.ts'), RECORDING_UIS);

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(hostUrl);
    await page.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
    const frame = page.frameLocator('.dev-host__frame');
    await frame.locator('.recording-board').waitFor({ timeout: 60_000 });

    await page.locator('[data-testid="seat-switcher"]').click();
    await page.locator('[data-testid="follow-active-seat"]').click();
    const played = await play(frame, 12);
    const renders = await frame.locator('body').evaluate(() => window.__followRenders);

    await check('following the active seat shows the board both seats', async () => {
      assert(played > 0, 'the Action Panel never offered a move');
      const seats = new Set(renders.map((render) => render.seat));
      assert(seats.has(1) && seats.has(2), `the board was only ever shown seat(s) ${[...seats].join(', ')}`);
    });
    await check('the board is never shown a seat over another seat\'s view', async () => {
      const torn = renders.filter((render) => render.seat > 0 && !render.ownCards);
      assert(torn.length === 0, `${torn.length} of ${renders.length} renders showed seat ${torn.map((r) => r.seat).join(', ')} without its own cards`);
    });
    await check('the Action Panel is not left mid-submission', async () => {
      const submitting = await frame.locator('.action-panel-root').first().getAttribute('data-bs-submitting');
      assert(submitting === null, 'the Action Panel still says it is finishing the last move');
    });
  } finally {
    await browser.close();
  }
  return summarise('while following the active seat in the dev host');
});
