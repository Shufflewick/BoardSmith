/**
 * A GAME WITHOUT DICE COMPILES WITHOUT three (BoardSmith #590).
 *
 * #276 made `three` and `@types/three` optional peers: only a game that imports
 * `boardsmith/ui/dice` installs them. That holds only while nothing else we
 * ship reaches the dice module. `dice-typecheck.test.ts` compiles the dice
 * entry itself; this gate compiles the other side, a game that never asks for
 * dice, in a sandbox holding every declared peer EXCEPT three, so any path
 * from `boardsmith/ui` or `boardsmith/ui/auto-ui` into three.js fails here with
 * the compiler's own `Cannot find module 'three'`.
 */
import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateTsConfig } from '../cli/lib/project-scaffold.js';
import { consumerInstall, declaredPeers } from './consumer-install.test-helper.js';
import { expectCleanCompile } from './vue-tsc-run.test-helper.js';

/** The optional peers only `boardsmith/ui/dice` needs. */
const DICE_PEERS = new Set(['three', '@types/three']);

/** The smallest auto-UI game: the UI registry and App.vue that `boardsmith init` writes. */
const UIS_TS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import AutoUI from 'boardsmith/ui/auto-ui';

export default defineGameUIs({ Auto: defaultUI(AutoUI) });
`;

const APP_VUE = `<script setup lang="ts">
import { GameShell } from 'boardsmith/ui';
import uis from './uis.js';
</script>

<template>
  <GameShell :uis="uis" />
</template>
`;

/** The game's tsconfig as `boardsmith init` writes it, compiling the game's UI. */
function gameTsConfig(): string {
  const scaffolded = JSON.parse(generateTsConfig()) as { compilerOptions: Record<string, unknown> };
  return JSON.stringify(
    {
      ...scaffolded,
      compilerOptions: {
        ...scaffolded.compilerOptions,
        noEmit: true,
        // Resolve from where the file SITS, not from where it really lives (see consumerInstall).
        preserveSymlinks: true,
      },
      include: ['src/**/*.ts', 'src/**/*.vue'],
    },
    null,
    2,
  );
}

describe('a game that does not use dice type-checks without three installed (#590)', () => {
  it('reports zero vue-tsc errors for an auto-UI game holding every declared peer but three', () => {
    const root = consumerInstall({
      entryPoints: [],
      alsoInstalled: declaredPeers().filter((name) => !DICE_PEERS.has(name)),
    });
    const ui = join(root, 'src', 'ui');
    mkdirSync(ui, { recursive: true });
    writeFileSync(join(ui, 'uis.ts'), UIS_TS);
    writeFileSync(join(ui, 'App.vue'), APP_VUE);
    writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig());

    expectCleanCompile(
      root,
      'game.tsconfig.json',
      'an auto-UI game (src/ui/uis.ts and src/ui/App.vue) that never imports boardsmith/ui/dice, with three ' +
        'and @types/three absent as an optional peer allows',
      'A "Cannot find module \'three\'" means boardsmith/ui or boardsmith/ui/auto-ui reaches the dice module: ' +
        'only src/ui/components/dice/index.ts may import Die3D, and nothing outside that entry may import it.',
    );
  }, 180_000);
});
