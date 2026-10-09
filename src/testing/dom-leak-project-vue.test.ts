/**
 * `renderAsSeat` MOUNTS ON THE PROJECT'S OWN VUE (#389).
 *
 * A game installs `boardsmith` as a symlink to a checkout, and the checkout
 * carries its own devDependencies, `vue` and `@vue/test-utils` among them. The
 * game's `resolve.dedupe: ['vue']` makes every `import 'vue'` in its components
 * and in BoardSmith's UI source resolve to the game's copy. It cannot reach
 * `@vue/test-utils`: vitest hands a package in `node_modules` to Node, and Node
 * resolves the checkout's `@vue/test-utils` from the checkout, which then loads
 * the checkout's `vue`. The board rendered on one Vue runtime while its
 * computeds ran on the other, so `setProps` changed nothing on screen and every
 * mount warned "Missing ref owner context".
 *
 * These run vitest in a throwaway project installed the way a game is: its own
 * copy of `vue` (a separate runtime, even at the same version), `boardsmith`
 * as a symlink to this checkout, and the rest of the toolchain linked from this
 * checkout's install. Nothing here is visible from inside this checkout's own
 * suite, where there is only one `vue`.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTALLED_MODULES } from './installed-modules.test-helper.js';
import { tempTree } from './temp-tree.test-helper.js';

/** This checkout: the `boardsmith` every project here installs. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VITEST = join(INSTALLED_MODULES, 'vitest', 'vitest.mjs');

/** A game's vitest config, as `boardsmith init` writes it: the Vue plugin and one copy of vue. */
const DEDUPED_CONFIG = `import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], resolve: { dedupe: ['vue'] } });
`;

/**
 * A board whose text is a computed over its props, which is the shape that
 * stopped re-rendering: the computed belongs to the project's Vue, the render
 * effect to whichever Vue mounted it, and one runtime's effect never tracks the
 * other's computed. (Vue shares the current component instance across copies,
 * so asking `getCurrentInstance()` cannot tell the two apart; only a render can.)
 */
const BOARD_TEST = `// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { computed, defineComponent, h } from 'vue';
import { Game, Action, actionStep } from 'boardsmith';
import { createTestGame, renderAsSeat, preloadSeatRenderer } from 'boardsmith/testing';

class TurnGame extends Game {
  constructor(options) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1), repeatUntil: () => false, maxMoves: 5 }),
    });
  }
}

await preloadSeatRenderer();

const Board = defineComponent({
  props: { gameView: { type: Object, default: null } },
  setup(props) {
    const shown = computed(() => String(props.gameView?.id ?? 'none'));
    return () => h('p', shown.value);
  },
});

it('mounts on this project vue and re-renders when its props change', async () => {
  const wrapper = await renderAsSeat(createTestGame(TurnGame, { playerCount: 2 }), 1, { component: Board });
  await wrapper.setProps({ gameView: { id: 4242 } });
  expect(wrapper.text()).toBe('4242');
  wrapper.unmount();
});
`;

/** Loads the renderer and reports how it refused, for the projects that must be refused. */
const REFUSAL_TEST = `// @vitest-environment jsdom
import { it } from 'vitest';
import { preloadSeatRenderer } from 'boardsmith/testing';

it('reports the refusal', async () => {
  const refusal = await preloadSeatRenderer().then(() => 'NO REFUSAL', (error) => error.message);
  console.log('REFUSAL<<' + refusal + '>>');
});
`;

/**
 * Write a project installed the way a game is. `vue` and every `@vue/*`
 * package are COPIES, so they are a second runtime from this checkout's even at
 * the same version; `@vue/test-utils` is left out when `withTestUtils` is false.
 */
function gameProject(prefix: string, withTestUtils: boolean): string {
  // realpath: on macOS the temp root is a symlink, and Vite resolves ids to
  // real paths, which would put the project's own files outside its root.
  const tree = tempTree(prefix);
  const dir = realpathSync(tree);
  const modules = join(dir, 'node_modules');
  mkdirSync(join(dir, 'tests'), { recursive: true });
  mkdirSync(modules);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'project', private: true, type: 'module' }));
  writeFileSync(join(dir, 'vitest.config.ts'), DEDUPED_CONFIG);
  writeFileSync(join(dir, 'tests', 'board.test.ts'), BOARD_TEST);
  writeFileSync(join(dir, 'tests', 'refusal.test.ts'), REFUSAL_TEST);

  symlinkSync(REPO, join(modules, 'boardsmith'), 'dir');
  cpSync(join(INSTALLED_MODULES, 'vue'), join(modules, 'vue'), { recursive: true });
  mkdirSync(join(modules, '@vue'));
  for (const name of readdirSync(join(INSTALLED_MODULES, '@vue'))) {
    if (name === 'test-utils' && !withTestUtils) continue;
    cpSync(join(INSTALLED_MODULES, '@vue', name), join(modules, '@vue', name), { recursive: true });
  }
  for (const name of readdirSync(INSTALLED_MODULES)) {
    // `node_modules` would be a stray link inside the install, not a package (#455).
    if (['.bin', 'vue', '@vue', 'boardsmith', 'node_modules'].includes(name) || name.startsWith('.')) continue;
    symlinkSync(join(INSTALLED_MODULES, name), join(modules, name), 'dir');
  }
  return dir;
}

/**
 * A game project whose `@vue/test-utils` carries its OWN nested `vue` and
 * `@vue/*` copies (#455). Node resolves test-utils' `import 'vue'` to the
 * nested copy, while the project's components and BoardSmith's UI resolve to
 * the project's copy: two Vue runtimes in one run, built here explicitly so the
 * case does not depend on what the developer's install happens to hold.
 */
function projectWithTwoVues(prefix: string): string {
  const dir = gameProject(prefix, true);
  const nested = join(dir, 'node_modules', '@vue', 'test-utils', 'node_modules');
  mkdirSync(join(nested, '@vue'), { recursive: true });
  cpSync(join(INSTALLED_MODULES, 'vue'), join(nested, 'vue'), { recursive: true });
  for (const name of readdirSync(join(INSTALLED_MODULES, '@vue'))) {
    if (name === 'test-utils') continue;
    cpSync(join(INSTALLED_MODULES, '@vue', name), join(nested, '@vue', name), { recursive: true });
  }
  return dir;
}

/** Run one of the project's test files under one of its configs; the combined output. */
function runVitest(project: string, file: string, config: string): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [VITEST, 'run', file, '--config', config], {
    cwd: project,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

/** The refusal message a REFUSAL_TEST run printed. */
function refusalIn(output: string): string {
  const match = /REFUSAL<<([\s\S]*?)>>/.exec(output);
  if (!match) throw new Error(`The project's run printed no refusal line. Its output was:\n${output}`);
  return match[1];
}

// Built here rather than in a test: copying a Vue install is setup, and no
// test timeout should be spent on it.
const withTestUtils = gameProject('bs-389-project-', true);
const withoutTestUtils = gameProject('bs-389-no-test-utils-', false);
const twoVues = projectWithTwoVues('bs-455-two-vues-');

describe("renderAsSeat renders on the project's own Vue (#389)", () => {
  it("mounts a board with the project's @vue/test-utils, so the board re-renders on setProps", () => {
    const { status, output } = runVitest(withTestUtils, 'tests/board.test.ts', 'vitest.config.ts');
    expect(status, `The project's board test failed. Repeat it with:\n  cd ${withTestUtils} && node ${VITEST} run tests/board.test.ts\n\n${output}`).toBe(0);
  }, 180_000);

  it("refuses, saying what to change, when the project's components and its @vue/test-utils run different copies of vue", () => {
    const { output } = runVitest(twoVues, 'tests/refusal.test.ts', 'vitest.config.ts');
    const refusal = refusalIn(output);
    expect(refusal).toMatch(/two copies of Vue/);
    expect(refusal).toContain("dedupe: ['vue']");
    expect(refusal).toContain('do not alias `vue`');
  }, 180_000);

  it('refuses, naming the install, when the project has no @vue/test-utils', () => {
    const { output } = runVitest(withoutTestUtils, 'tests/refusal.test.ts', 'vitest.config.ts');
    const refusal = refusalIn(output);
    expect(refusal).toContain('npm install --save-dev @vue/test-utils');
    expect(refusal).toContain(withoutTestUtils);
  }, 180_000);
});
