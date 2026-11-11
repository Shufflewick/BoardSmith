#!/usr/bin/env node
/**
 * A GAME'S PHONE UI RENDERS ON A PHONE, AND ITS DEFAULT EVERYWHERE ELSE (#1610).
 *
 * A game marks one board `phoneUI()` in `src/ui/uis.ts`, and GameShell renders
 * it below `BREAKPOINTS.compact` in place of the default. jsdom has no
 * viewport, so only a real browser over the dev host can show which board a
 * 390x844 phone gets, which a 1440x900 desktop gets, and that a rotation hands
 * the board its new `formFactor` and `orientation` and swaps the board when
 * the size crosses the line. `default-ui-phone-browser.mjs` is the same
 * question for a game without a phone UI.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/phone-ui-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, onTablePage, runBrowserRegression, summarise, textsAt } from './browser-harness.mjs';

/** A board that says which it is and the layout size it was handed. */
const board = (kind) => `<template>
  <p class="layout-board">${kind} {{ formFactor }} {{ orientation }}</p>
</template>

<script setup lang="ts">
import type { TableBoardProps } from 'boardsmith/ui';
defineProps<Pick<TableBoardProps, 'formFactor' | 'orientation'>>();
</script>
`;

const UIS = `import { defineGameUIs, defaultUI, phoneUI } from 'boardsmith/ui';
import Table from './components/Table.vue';
import Pocket from './components/Pocket.vue';

export default defineGameUIs({ Table: defaultUI(Table), Pocket: phoneUI(Pocket) });
`;

const FILES = { 'src/ui/uis.ts': UIS, 'src/ui/components/Table.vue': board('default'), 'src/ui/components/Pocket.vue': board('phone') };

await runBrowserRegression(
  { script: 'phone-ui-browser.mjs', engines: ['chromium', 'webkit'], table: { files: FILES } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      await onTablePage(browser, hostUrl, { width: 390, height: 844 }, async (page, frame) => {
        /** Resize to `viewport`, then expect exactly the one board saying `expected`. */
        const at = async (viewport, expected) => {
          const boards = await textsAt(page, frame.locator('.layout-board'), viewport, expected);
          assert(boards.length === 1, `expected only "${expected}", found ${JSON.stringify(boards)}`);
        };
        await check('a 390x844 phone renders the phone UI, told it is compact and portrait', () =>
          at({ width: 390, height: 844 }, 'phone compact portrait'));
        await check('rotating it to 844x390 swaps to the default UI, told it is medium and landscape', () =>
          at({ width: 844, height: 390 }, 'default medium landscape'));
        await check('rotating it back renders the phone UI again', () =>
          at({ width: 390, height: 844 }, 'phone compact portrait'));
        await check('a 1440x900 desktop renders the default UI, told it is wide and landscape', () =>
          at({ width: 1440, height: 900 }, 'default wide landscape'));
      });
    } finally {
      await browser.close();
    }
    return summarise('for a game with a phone UI');
  },
);
