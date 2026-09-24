/**
 * #357: THE BROWSER REGRESSIONS' FIXTURE WORLD STARTS, SERVES AND STOPS.
 *
 * Every browser regression in `scripts/*-browser.mjs` serves a throwaway world
 * project through the CLI's own world dev host. The call that started that
 * host lived in a `.mjs` file, which nothing type-checks, and the scripts need
 * a browser, so nothing runs them either. When #283 changed
 * `startWorldDevServer` to take a `runtime` instead of a `gameDefinition`,
 * every one of those scripts broke before its first check and nobody saw.
 *
 * The lifetime now lives in `fixture-world.test-helper.ts`, which
 * `boardsmith typecheck` compiles against the real `startWorldDevServer`, and
 * this test runs it without a browser: write the fixture, start the host, ask
 * it for something, stop, remove. A signature change is a type error, and a
 * host that no longer starts is a red test.
 *
 * What it asks for is the world's own surface and the module that surface
 * loads, which starts Vite's dependency optimiser, and then a path nothing
 * serves, which the world road answers itself. The host is stopped the moment
 * those answers are in, with the optimiser's first run still in flight: a stop
 * then used to never finish (#366).
 */
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withFixtureWorld } from './fixture-world.test-helper.js';
import { WORLD_IFRAME_PATH } from './dev-world.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

// Bundling the rules and starting Vite is the slow part, seconds on a busy
// machine. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Yard extends Space<YardGame> {}

export class YardGame extends Game<YardGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Yard]);
  }
}

export const gameDefinition: GameDefinition = {
  gameClass: YardGame,
  gameType: 'fixture-yard',
  displayName: 'Fixture Yard',
  world: {
    maxPlayers: 2,
    genesis: (game) => ({ yard: (game as YardGame).create(Yard, 'yard') as GameElement }),
    view: () => ['yard'],
    actions: [worldAction<YardGame>('look').needs(() => ['yard']).execute(() => {})],
  },
};
`;

const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'YardBoard',
  setup() {
    return () => h('div', { class: 'yard-board' }, 'the yard');
  },
});
`;

describe('withFixtureWorld (#357)', () => {
  it('serves a fixture world through the real world dev host, then stops it and removes the project', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let seen: { fixture: string; status: number; answer: string } | undefined;
    try {
      seen = await withFixtureWorld(
        {
          slug: 'fixture-yard',
          displayName: 'Fixture Yard',
          gameClass: 'YardGame',
          rules: RULES,
          boardFile: 'YardBoard',
          board: BOARD,
        },
        async ({ hostUrl, fixture }) => {
          // The fixture links its build-time packages from this checkout's
          // install, which a worktree finds in the main checkout (#358).
          expect(realpathSync(join(fixture, 'node_modules', 'vue'))).toBe(
            realpathSync(join(INSTALLED_MODULES, 'vue')),
          );
          const surface = await (await fetch(new URL(WORLD_IFRAME_PATH, hostUrl))).text();
          const entry = [...surface.matchAll(/<script type="module" src="([^"]+)"/g)].at(-1)?.[1];
          expect(entry, `the world surface has no module script:\n${surface}`).toBeDefined();
          const module = await (await fetch(new URL(entry!, hostUrl))).text();
          // The surface's module imports a pre-bundled dependency, so the
          // optimiser is running when the host is stopped.
          expect(module).toContain('/node_modules/.vite/deps/');
          const response = await fetch(new URL('/nothing-is-here', hostUrl));
          return { fixture, status: response.status, answer: await response.text() };
        },
      );
    } finally {
      log.mockRestore();
    }
    // The world road's own answer, naming the world surface: the host that
    // answered is the world dev host, serving this fixture.
    expect(seen?.status).toBe(404);
    expect(seen?.answer).toContain(`This is a persistent-world run. The world's own surface is ${WORLD_IFRAME_PATH}`);
    expect(existsSync(seen!.fixture), 'the fixture outlived its host').toBe(false);
  });
});
