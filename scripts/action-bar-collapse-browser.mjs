#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR PUTTING THE ACTION BAR DOWN (#230).
 *
 * #230 is entirely about what is ON SCREEN, and CLAUDE.md's own warning names
 * the two ways a component test signs off on a feature that does not work:
 *
 *   - a bar that collapses in the DOM while its box still covers the board, and
 *   - a restore control that lands off screen at a narrow width.
 *
 * Both pass every assertion anybody would write in jsdom, which measures
 * nothing. So the geometry is measured here, in real Chromium, over the real
 * dev server, inside the real `world.html` iframe -- the harness shape #227
 * established -- at a desktop width and a phone width, with the action panel
 * both idle and mid-question.
 *
 * ## What is asserted, and why each one is a real failure mode
 *
 *   1. The toggle's box is inside the viewport at both widths, collapsed and
 *      open. A restore control you cannot reach is not a restore control.
 *   2. Collapsing shrinks the bar's rendered box, and the collapsed box fits
 *      inside the footprint the board region reserved for it -- so there is no
 *      board under the bar at all, rather than board hidden under an empty bar.
 *   3. The board's usable area grows by what the bar gave up. That is the whole
 *      ask: get the screen back.
 *   4. What survives the collapse is what must: the seat token, with a real box.
 *      What goes is the panel's own controls. (The controls menu is the
 *      adapter's slot content and a world fills none; that it survives where
 *      there IS one is asserted against a real slot in the unit suite.)
 *   5. Mid-question the bar comes back up even though the preference says down,
 *      and pushing it down again mid-question leaves the prompt readable on the
 *      one remaining row.
 *   6. And it comes up for a QUESTION, not for any click: a board click that
 *      asks nothing leaves the bar where the player put it.
 *
 * ## Why this is not in `npx vitest run`
 *
 * It needs Chromium, and BoardSmith depends on no browser -- the suite stays
 * hermetic and this is run deliberately, the same split #227 made. It never
 * skips: with no Playwright reachable it says how to give it one and exits
 * non-zero, because a browser regression that quietly passes when it did not run
 * is the thing it exists to replace.
 *
 *   node scripts/action-bar-collapse-browser.mjs
 *   BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
 *     node scripts/action-bar-collapse-browser.mjs
 *
 * The world it drives is written into a temp directory per run and removed
 * afterwards, for the reason #227 gives: a checked-in game project inside the
 * library would be a second thing to keep compiling.
 */
import {
  assert,
  check,
  runBrowserRegression,
  summarise,
  surfaceOf,
} from './browser-harness.mjs';

// ── The fixture world ────────────────────────────────────────────────────────

/**
 * A garden of nine plots and one action that asks which one.
 *
 * The action needs a real answer -- nine choices, so nothing is auto-selected
 * and auto-executed -- because "the bar is up mid-question" is half of what is
 * measured here.
 */
const RULES = `import { Game, Piece, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Ground extends Space<Garden> {}

class Plot extends Space<Garden> {
  tended = 0;
}

export class Garden extends Game<Garden, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Ground, Plot]);
  }
}

const GROUND = 'ground';

const tend = worldAction<Garden>('tend')
  .prompt('Tend a plot')
  .needs(() => [GROUND])
  .chooseFrom('plot', {
    prompt: 'Which plot?',
    choices: ({ game }) => game.all(Plot).map((plot) => plot.name!),
  })
  .execute(({ plot }, ctx) => {
    ctx.world.emit(GROUND, { plot }, \`Seat \${ctx.player.seat} tended \${plot as string}.\`);
  });

export const gameDefinition: GameDefinition = {
  gameClass: Garden,
  gameType: 'collapse-garden',
  displayName: 'Collapse Garden',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const ground = game.create(Ground, 'ground');
      for (let i = 1; i <= 9; i++) ground.create(Plot, \`plot-\${i}\`);
      return { [GROUND]: ground as GameElement };
    },
    view: () => [GROUND],
    actions: [tend],
  },
};
`;

/**
 * A board that is deliberately TALLER than any viewport this drives.
 *
 * The measurement only means something if there is board under the bar to
 * begin with: a board that ends above the bar would show a growing usable area
 * with nothing in it.
 */
const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'GardenBoard',
  setup() {
    return () =>
      h('div', {
        'data-fixture': 'garden',
        style: 'width: 900px; height: 1600px; background: linear-gradient(#dfe7d8, #b7c9a8);',
      }, 'garden');
  },
});
`;

/** Wait for the panel to be offering the world's verb to a seated player. */
async function seated(page) {
  await surfaceOf(page).locator('[data-bs-action="tend"]').waitFor({ timeout: 30_000 });
}

/**
 * Every measurement this script reasons about, taken inside the frame in one
 * pass so no two of them can describe different layouts.
 */
async function measure(page) {
  return page.frameLocator('.world-dev__frame').locator('body').evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const { top, bottom, left, right, width, height } = el.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    const region = document.querySelector('[data-testid="bs-board"]');
    const reserved = region
      ? parseFloat(getComputedStyle(region).paddingBottom)
      : Number.NaN;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bar: box('[data-testid="bs-actionbar"]'),
      toggle: box('[data-testid="bs-actionbar-toggle"]'),
      token: box('[data-testid="bs-actionbar"] .turn-token'),
      summary: box('[data-testid="bs-actionbar-summary"]'),
      // The panel's own start button: present and boxed while the bar is up,
      // absent while it is down.
      start: box('[data-bs-action="tend"]'),
      // A choice control, which only exists mid-question.
      choice: box('.action-config .choice-btn'),
      reserved,
      regionHeight: region ? region.clientHeight : Number.NaN,
      // What the player can actually see board in: the region minus the strip
      // the bar reserved at its foot.
      usableBoardHeight: region ? region.clientHeight - reserved : Number.NaN,
    };
  });
}

/** The toggle is on screen, whole, with room to be hit. */
function assertToggleReachable(shot, where) {
  const { toggle, viewport } = shot;
  assert(toggle !== null, `${where}: there is no restore control in the document at all`);
  assert(toggle.width >= 24 && toggle.height >= 24,
    `${where}: the toggle renders ${toggle.width}x${toggle.height}, too small to hit`);
  assert(toggle.left >= 0 && toggle.right <= viewport.width,
    `${where}: the toggle spans x ${toggle.left}..${toggle.right} in a ${viewport.width}px viewport`);
  assert(toggle.top >= 0 && toggle.bottom <= viewport.height,
    `${where}: the toggle spans y ${toggle.top}..${toggle.bottom} in a ${viewport.height}px viewport`);
}

const collapse = async (page) => {
  await surfaceOf(page).locator('[data-testid="bs-actionbar-toggle"]').click();
  // One frame for the class, one for the transition-free relayout.
  await page.waitForTimeout(150);
};

async function drive({ chromium, hostUrl }) {
  const browser = await chromium.launch();

  // A desktop and a phone. The phone is the width the issue's "get it off the
  // screen" matters most at, and the width an edge control is likeliest to fall
  // off at.
  const VIEWPORTS = [
    { name: 'desktop 1280x800', viewport: { width: 1280, height: 800 } },
    { name: 'phone 375x667', viewport: { width: 375, height: 667 } },
  ];

  try {
    for (const { name, viewport } of VIEWPORTS) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(hostUrl);
      await seated(page);
      await page.waitForTimeout(300);

      const open = await measure(page);
      await check(`${name}: the toggle is on screen with the bar up`, () => {
        assertToggleReachable(open, name);
      });

      await collapse(page);
      const down = await measure(page);

      await check(`${name}: the toggle is on screen with the bar down`, () => {
        assertToggleReachable(down, name);
      });

      await check(`${name}: the bar's own box shrinks, and fits what the board reserved`, () => {
        assert(down.bar !== null, 'the bar left the document entirely');
        assert(down.bar.height < open.bar.height,
          `the bar measured ${down.bar.height}px down and ${open.bar.height}px up`);
        // The failure this exists for: a bar that empties in the DOM and keeps
        // its box, so the board is still hidden underneath it.
        assert(down.bar.height <= down.reserved + 0.5,
          `the collapsed bar is ${down.bar.height}px over a ${down.reserved}px reservation, ` +
          'so it covers board the region never made room for');
      });

      await check(`${name}: the board gets the space back, not an empty hole`, () => {
        assert(down.usableBoardHeight > open.usableBoardHeight,
          `the board's usable height stayed at ${down.usableBoardHeight}px ` +
          `(it was ${open.usableBoardHeight}px with the bar up)`);
        // The other half of it: the reservation has to give up at least what the
        // bar gave up. A bar that shrinks while the region keeps reserving the
        // old strip leaves a band of board reserved for nothing -- the panel is
        // gone and the hole it sat in is still there.
        const barGaveUp = open.bar.height - down.bar.height;
        const reservationGaveUp = open.reserved - down.reserved;
        assert(reservationGaveUp >= barGaveUp,
          `the bar gave up ${barGaveUp}px but the region gave up only ` +
          `${reservationGaveUp}px, so that difference is board reserved for nothing`);
      });

      // The controls menu is the ADAPTER's slot content and a world fills none,
      // so what a world's collapsed bar has to keep is the seat token and the
      // prompt. That the menu survives where there IS one is asserted against a
      // real slot in `PlayShell.action-bar.test.ts`.
      await check(`${name}: what has to survive the collapse is still drawn`, () => {
        assert(down.token !== null && down.token.height > 0, 'the seat token went with the panel');
        assert(down.start === null, 'the panel is still offering its start buttons');
      });

      // ── Mid-question: the bar comes back, because the answer lives in it ──
      await collapse(page); // back up, to start the action from the panel
      await surfaceOf(page).locator('[data-bs-action="tend"]').click();
      await page.waitForTimeout(200);
      await collapse(page); // the player puts it down while the question is open
      await page.waitForTimeout(200);
      const midQuestionDown = await measure(page);

      await check(`${name}: a bar put down mid-question still says what is wanted`, () => {
        assert(midQuestionDown.summary !== null && midQuestionDown.summary.height > 0,
          'the prompt went down with the bar, so the player is asked nothing visible');
        assert(midQuestionDown.choice === null, 'the choice controls are still on screen');
        assertToggleReachable(midQuestionDown, name);
      });

      await check(`${name}: the next question brings the bar back up by itself`, async () => {
        const surface = surfaceOf(page);
        await surface.locator('.action-config .cancel-btn').waitFor({ state: 'detached', timeout: 5_000 })
          .catch(() => undefined);
        // Cancel through the panel means opening it once; the point is what the
        // NEXT start does with the preference still set to down.
        await surface.locator('[data-testid="bs-actionbar-toggle"]').click();
        await page.waitForTimeout(150);
        const cancel = surface.locator('.action-config .cancel-btn');
        if (await cancel.count()) await cancel.click();
        await page.waitForTimeout(150);
        await surface.locator('[data-testid="bs-actionbar-toggle"]').click();
        await page.waitForTimeout(200);

        const idle = await measure(page);
        assert(idle.start === null, 'the bar did not go back down between questions');

        await surface.locator('[data-fixture="garden"]').click({ position: { x: 5, y: 5 } });
        await page.waitForTimeout(200);
        // Nothing on this board starts an action, so the bar must still be down:
        // it opens for a QUESTION, not for a click.
        const afterClick = await measure(page);
        assert(afterClick.start === null,
          'the bar came up for a board click that asked nothing');
      });

      await context.close();
    }
  } finally {
    await browser.close();
  }

  return summarise('measured on screen in a real browser at both widths.');
}

// THE WHOLE RUN, IN THE HARNESS'S ORDER (#231). It checks the checkout is
// installed, finds a Chromium or refuses, serves the fixture world, stops the
// host before removing its project, and exits on what `drive` reports.
await runBrowserRegression(
  {
    script: 'action-bar-collapse-browser.mjs',
    fixture: {
      slug: 'collapse-garden',
      displayName: 'Collapse Garden',
      gameClass: 'Garden',
      rules: RULES,
      boardFile: 'GardenBoard',
      board: BOARD,
    },
  },
  drive,
);
