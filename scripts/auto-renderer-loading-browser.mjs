#!/usr/bin/env node
/**
 * AUTORENDERER'S LOADING TEXT IS FOR SCREEN READERS ONLY (#1213).
 *
 * While AutoRenderer has no game view it shows a skeleton with a "Loading
 * game…" span styled by the shared `sr-only.css` (#929). In the dev host that
 * state lasts only until the first view arrives, so the fixture's board mounts
 * AutoRenderer itself with no view, holding the loading state in the real
 * iframe with the real stylesheet. The span must have its text and take no
 * space, at 1440px and 390px.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/auto-renderer-loading-browser.mjs`; a missing Chromium says to
 * run `boardsmith install-browser`.
 */
import { assert, check, onFreshPage, runBrowserRegression, summarise, surfaceOf } from './browser-harness.mjs';

const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';

class Hall extends Space<Waiting> {}

export class Waiting extends Game<Waiting, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Hall]);
  }
}

const HALL = 'hall';

export const gameDefinition: GameDefinition = {
  gameClass: Waiting,
  gameType: 'auto-renderer-loading',
  displayName: 'AutoRenderer Loading',
  world: {
    maxPlayers: 2,
    genesis: (game) => ({ [HALL]: (game as Waiting).create(Hall, 'hall') as GameElement }),
    view: () => [HALL],
    actions: [],
  },
};
`;

const BOARD = `import { defineComponent, h } from 'vue';
import { AutoRenderer } from 'boardsmith/ui/auto-ui';

export default defineComponent({
  name: 'WaitingBoard',
  // The shell hands every board the real gameView; inherited, it would replace the null.
  inheritAttrs: false,
  setup() {
    return () => h(AutoRenderer, { gameView: null });
  },
});
`;

const WIDTHS = [1440, 390];

await runBrowserRegression(
  {
    script: 'auto-renderer-loading-browser.mjs',
    fixture: {
      slug: 'auto-renderer-loading',
      displayName: 'AutoRenderer Loading',
      gameClass: 'Waiting',
      rules: RULES,
      boardFile: 'WaitingBoard',
      board: BOARD,
    },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      for (const width of WIDTHS) {
        const viewport = { width, height: width < 600 ? 844 : 900 };
        const span = (surface) => surface.locator('.auto-renderer-skeleton > span').first();
        await onFreshPage(browser, hostUrl, { viewport }, (page) => span(surfaceOf(page)).waitFor({ state: 'attached' }), async (_page, surface) => {
          await check(`AutoRenderer's loading text is in the page but takes no space at ${width}px`, async () => {
            // Text and box in one read, so both describe the same element.
            const { text, box, barShift } = await span(surface).evaluate((el) => {
              const { width, height } = el.getBoundingClientRect();
              // A 1px box can still sit in the flow and push the bars below it down.
              const barShift = el.nextElementSibling.getBoundingClientRect().top - el.parentElement.getBoundingClientRect().top;
              return { text: el.textContent.trim(), box: { width, height }, barShift };
            });
            assert(text !== '', "AutoRenderer's loading span has no text, so there was nothing to measure; check that it still says \"Loading game…\"");
            assert(box.width <= 1 && box.height <= 1, `AutoRenderer's loading text "${text}" took ${JSON.stringify(box)}; check that it still has the sr-only class`);
            assert(barShift === 0, `AutoRenderer's loading text "${text}" pushed the skeleton bars down ${barShift}px; check that the sr-only class still takes it out of the layout`);
          });
        });
      }
    } finally {
      await browser.close();
    }
    return summarise("in AutoRenderer's loading state in a real browser");
  },
);
