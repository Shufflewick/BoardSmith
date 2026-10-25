#!/usr/bin/env node
/**
 * THE FIRST CLICK ON A SCROLLED ACTION-BAR BUTTON STARTS ITS ACTION (#1473).
 *
 * While the game frame has no focus, the Action Panel puts off its repair of
 * stranded focus until the window regains it (#649). A click inside the frame
 * is what gives it back, during `mousedown`, and the repair used to focus the
 * first button then: the bar scrolled to its top under the pressed mouse, the
 * button came up under a different button, and no click reached either. A
 * press now places focus itself. Only a real mouse, over a real iframe that
 * does not have focus, shows it; Playwright's `locator.click()` checks its
 * target before pressing and reports success.
 *
 * A world whose idle bar holds far more buttons than it shows. At 1440px and
 * 390px, in a frame that has never been focused, the bar is scrolled to its
 * last button, and one real click on that button must open the action.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/scrolled-bar-first-click-browser.mjs`; a missing Chromium says
 * to run `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise, surfaceOf, waitForAction, waitUntil } from './browser-harness.mjs';

const VERBS = Array.from({ length: 24 }, (_, i) => `survey${i + 1}`);
const LAST = VERBS.at(-1);

/** Two dozen idle verbs, the last of which asks a question so a started action is visible. */
const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Sector extends Space<Expanse> {}

export class Expanse extends Game<Expanse, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Sector]);
  }
}

const SECTOR = 'sector';
const verbs = ${JSON.stringify(VERBS)};
const last = verbs.length - 1;

export const gameDefinition: GameDefinition = {
  gameClass: Expanse,
  gameType: 'scrolled-bar-expanse',
  displayName: 'Scrolled Bar Expanse',
  world: {
    maxPlayers: 1,
    genesis: (game) => ({ [SECTOR]: (game as Expanse).create(Sector, 'sector') as GameElement }),
    view: () => [SECTOR],
    actions: verbs.map((name, i) => {
      const action = worldAction<Expanse>(name).prompt(\`Survey sector \${i + 1}\`).order(i).needs(() => [SECTOR]);
      return (i === last ? action.chooseFrom('depth', { prompt: 'How deep?', choices: ['Shallow', 'Deep'] }) : action)
        .execute((_args, ctx) => ctx.world.emit(SECTOR, { surveyed: name }, \`Sector \${i + 1} was surveyed.\`));
    }),
  },
};
`;

const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'ExpanseBoard',
  setup() {
    return () => h('div', { class: 'expanse-board' }, 'The expanse is here.');
  },
});
`;

/** The bar's scroll offset, and whether the frame's document has focus. */
const barState = (surface) => surface.locator('[data-testid="bs-actionbar"]').evaluate((bar) => ({
  scrollTop: Math.round(bar.scrollTop),
  scrolls: bar.scrollHeight > bar.clientHeight + 1,
  focused: bar.ownerDocument.hasFocus(),
}));

await runBrowserRegression(
  {
    script: 'scrolled-bar-first-click-browser.mjs',
    fixture: {
      slug: 'scrolled-bar-expanse',
      displayName: 'Scrolled Bar Expanse',
      gameClass: 'Expanse',
      rules: RULES,
      boardFile: 'ExpanseBoard',
      board: BOARD,
    },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        const at = `${viewport.width}px`;
        const page = await browser.newPage({ viewport });
        await page.goto(hostUrl);
        await waitForAction(page, LAST);
        const surface = surfaceOf(page);
        const button = surface.locator(`[data-bs-action="${LAST}"]`);

        // Scroll the bar by script, so nothing focuses the frame before the click under test.
        await surface.locator('[data-testid="bs-actionbar"]').evaluate((bar) => { bar.scrollTop = bar.scrollHeight; });
        const before = await barState(surface);
        await check(`${at}: the bar scrolls, is scrolled away from its top, and the frame has no focus`, () => {
          assert(before.scrolls, 'every button fits the bar, so nothing here scrolls');
          assert(before.scrollTop > 0, 'the bar did not scroll');
          assert(!before.focused, 'the frame already has focus, so the click cannot be the one that gives it back');
        });

        await check(`${at}: one real click on the last button opens its action`, async () => {
          const box = await button.boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          const prompt = await waitUntil(
            () => surface.locator('.action-config').count(),
            (count) => count > 0,
            5_000,
          );
          const after = await barState(surface);
          assert(after.focused, 'the click did not give the frame focus');
          assert(prompt > 0, `the action did not start; the bar is scrolled to ${after.scrollTop}px, from ${before.scrollTop}px`);
        });
        await page.close();
      }
    } finally {
      await browser.close();
    }
    return summarise('clicking a scrolled action-bar button in an unfocused frame');
  },
);
