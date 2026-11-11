#!/usr/bin/env node
/**
 * A GAME WITHOUT A PHONE UI RENDERS ITS DEFAULT ON A PHONE TOO (#1610).
 *
 * The phone UI is opt-in: a game that declares only `defaultUI()` gets that
 * one responsive board at every size, handed the size it is drawn at. The
 * other half, a game with a phone UI, is `phone-ui-browser.mjs`.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/default-ui-phone-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, onTablePage, runBrowserRegression, summarise, textsAt } from './browser-harness.mjs';

const TABLE = `<template>
  <p class="layout-board">{{ formFactor }} {{ orientation }}</p>
</template>

<script setup lang="ts">
import type { TableBoardProps } from 'boardsmith/ui';
defineProps<Pick<TableBoardProps, 'formFactor' | 'orientation'>>();
</script>
`;

const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import Table from './components/Table.vue';

export default defineGameUIs({ Table: defaultUI(Table) });
`;

await runBrowserRegression(
  { script: 'default-ui-phone-browser.mjs', engines: ['chromium', 'webkit'], table: { files: { 'src/ui/uis.ts': UIS, 'src/ui/components/Table.vue': TABLE } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      const sizes = [[{ width: 1440, height: 900 }, 'wide landscape'], [{ width: 390, height: 844 }, 'compact portrait']];
      await onTablePage(browser, hostUrl, sizes[0][0], async (page, frame) => {
        for (const [viewport, expected] of sizes) {
          await check(`at ${viewport.width}x${viewport.height} it renders the default UI, told it is ${expected}`, async () => {
            const boards = await textsAt(page, frame.locator('.layout-board'), viewport, expected);
            assert(boards.length === 1, `expected one board, found ${JSON.stringify(boards)}`);
          });
        }
      });
    } finally {
      await browser.close();
    }
    return summarise('for a game without a phone UI');
  },
);
