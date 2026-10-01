/**
 * `boardsmith verify` on a whole game, as a user runs it (#453): a table and a world as
 * `boardsmith init` scaffolds them, through all six real checks, the smoke check against
 * `boardsmith dev` in Chromium included.
 *
 * These are the slowest verify runs, each serving the game and walking it in a browser, so they
 * live in their own file: vitest runs it alongside `verify.test.ts` rather than after it.
 */
import { describe, expect, it, vi } from 'vitest';

import { verifiedProblem } from '../lib/verify-result.js';
import { commitAll, git, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { smokeProject } from './smoke-project.test-helper.js';
import { check, verifyAsAUser } from './verify-cli.test-helper.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

/**
 * The table `boardsmith init` scaffolds, smoke test and all, built on a branch that adds `fee`:
 * a whole game every one of the six real checks can run, the smoke check against `boardsmith dev`
 * in Chromium included.
 */
async function scaffoldedTableOnBranch(): Promise<string> {
  const dir = await smokeProject(false);
  git(dir, 'checkout', '-q', '-b', 'fee');
  await write(dir, {
    'src/rules/fee.ts': 'export function fee(price: number): number {\n  return price * 2;\n}\n',
    'tests/fee.test.ts':
      "import { it, expect } from 'vitest';\nimport { fee } from '../src/rules/fee.js';\n" +
      "it('the fee is twice the price', () => { expect(fee(3)).toBe(6); });\n",
  });
  commitAll(dir, 'add the fee');
  return dir;
}

/**
 * THE ACCEPTANCE FIXTURE (#453): the world `boardsmith init --world` scaffolds, whose board reads a
 * table's whole game context with `useGameContext()`. A world's shell never provides a table's
 * `gameState`, `dueSeats`, `timeTravelDiff` or `turnDeadline`, so the board throws the moment it
 * renders in a real world. Its unit test mounts the board with a context built by hand, table keys
 * and all, the way a board test once passed while its board crashed in play.
 */
const TABLE_KEY_WORLD_BOARD = `<script setup lang="ts">
import { useGameContext } from 'boardsmith/ui';

const { gameState, availableActions } = useGameContext();
</script>

<template>
  <div class="world-board">Round {{ gameState ? 1 : 0 }}: {{ availableActions.join(', ') }}</div>
</template>
`;

/** The fixture test's jsdom pragma, built so vitest does not read it as this file's own. */
const JSDOM_PRAGMA = ['// @vitest', 'environment jsdom'].join('-');

const HAND_BUILT_STUB_TEST = `${JSDOM_PRAGMA}
import { it, expect } from 'vitest';
import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { GAME_CONTEXT_KEYS } from 'boardsmith/ui';
import WorldBoard from '../src/ui/components/WorldBoard.vue';

it('draws the board with the actions it is offered', () => {
  const k = GAME_CONTEXT_KEYS;
  const wrapper = mount(WorldBoard, {
    global: {
      provide: {
        [k.gameState as symbol]: ref(null),
        [k.dueSeats as symbol]: computed(() => [1]),
        [k.timeTravelDiff as symbol]: ref(null),
        [k.turnDeadline as symbol]: computed(() => null),
        [k.gameView as symbol]: computed(() => ({})),
        [k.players as symbol]: computed(() => []),
        [k.myPlayer as symbol]: computed(() => undefined),
        [k.playerSeat as symbol]: ref(1),
        [k.isMyTurn as symbol]: ref(true),
        [k.availableActions as symbol]: computed(() => ['tend']),
        [k.actionController as symbol]: {},
        [k.platformRequest as symbol]: async () => ({}),
        [k.presentation as symbol]: ref(undefined),
        [k.debugHighlight as symbol]: ref(null),
      },
    },
  });
  expect(wrapper.text()).toContain('tend');
});
`;

describe('boardsmith verify on a whole game, as a user runs it', () => {
  it('passes all six real checks on the scaffolded table, the smoke test in Chromium included, and --check then accepts the commit', async () => {
    const dir = await scaffoldedTableOnBranch();
    const { run, result } = await verifyAsAUser(dir);
    expect(result.checks.map((c) => [c.name, c.passed, c.summary])).toEqual([
      ['test', true, expect.stringMatching(/^\d+ tests passed in \d+ files\.$/)],
      ['typecheck', true, 'No type errors.'],
      ['build', true, '`boardsmith build` passed.'],
      ['validate', true, '`boardsmith validate` passed.'],
      // #460: the verify result records the seed the walk dealt from, so the walk can be repeated exactly.
      ['smoke', true, expect.stringMatching(/^Served by `boardsmith dev` from a fresh start and dealt from seed "smoke", a seated player took "draw", "play"/)],
      ['mutation', true, expect.stringMatching(/^Every one of 3 mutants of the lines changed since (main|master)/)],
    ]);
    expect(run.code).toBe(0);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect((await spawnCli(['verify', '--check', '--project', dir])).code).toBe(0);
  });

  it('fails a world whose board reads a table-only context key, though its unit test with a hand-built stub passes (#453)', async () => {
    const dir = await smokeProject(true, {
      'src/ui/components/WorldBoard.vue': TABLE_KEY_WORLD_BOARD,
      'tests/board.test.ts': HAND_BUILT_STUB_TEST,
    });

    const { run, result } = await verifyAsAUser(dir, ['--base', 'HEAD']);

    expect(run.code).toBe(1);
    expect(result.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(['smoke']);
    expect(check(result, 'test').counts).toMatchObject({ failed: 0 });
    expect(check(result, 'smoke').summary).toMatch(
      /useGameContext\(\) reads a table's whole game context, and this component is inside a world's shell.*gameState, dueSeats, timeTravelDiff, turnDeadline/s,
    );
    expect(await verifiedProblem(dir)).toMatch(/smoke: /);
  });
});
