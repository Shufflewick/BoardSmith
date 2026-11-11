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
import { assert, check, openTableSample, runBrowserRegression, summarise } from './browser-harness.mjs';

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
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const frame = await openTableSample(page, hostUrl);
      for (const [viewport, expected] of [[{ width: 390, height: 844 }, 'compact portrait'], [{ width: 1440, height: 900 }, 'wide landscape']]) {
        await check(`at ${viewport.width}x${viewport.height} it renders the default UI, told it is ${expected}`, async () => {
          await page.setViewportSize(viewport);
          const boards = frame.locator('.layout-board');
          await boards.filter({ hasText: expected }).waitFor({ timeout: 10_000 });
          const texts = await boards.allTextContents();
          assert(texts.length === 1, `expected one board, found ${JSON.stringify(texts)}`);
        });
      }
    } finally {
      await browser.close();
    }
    return summarise('for a game without a phone UI');
  },
);
