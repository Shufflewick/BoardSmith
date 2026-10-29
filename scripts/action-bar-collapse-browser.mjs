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
 *   2. Collapsing shrinks the bar's rendered box.
 *   3. The board is fitted above one row of bar, so a one-row bar sits under it
 *      and only rows beyond the first float over it (#1514, #1517). Its size is
 *      the same with the bar up and grown to two rows. Put down by the player,
 *      the board reaches the line (#1518), and a question bringing the bar up
 *      over that preference leaves the board's size alone.
 *   4. Down, the bar is a thin line (#1439, #1444): no taller than 14px plus the safe
 *      area, with the seat token and the panel's own controls gone. (The
 *      controls menu is the adapter's slot content and a world fills none; that
 *      it survives where there IS one is asserted against a real slot in the
 *      unit suite.)
 *   5. Mid-question the bar comes back up even though the preference says down,
 *      and pushing it down again mid-question leaves the attention mark on the
 *      toggle, which says the game is waiting on this seat.
 *   6. And it comes up for a QUESTION, not for any click: a board click that
 *      asks nothing leaves the bar where the player put it.
 *   7. Issue 444's headline case (#486): an element pick after an earlier
 *      choice, at 375x812 and 844x390, keeps the bar inside its two-row cap,
 *      with nothing scrolling inside the bar, and leaves the board's size alone.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/action-bar-collapse-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 *
 * The world it drives is written into a temp directory per run and removed
 * afterwards, for the reason #227 gives: a checked-in game project inside the
 * library would be a second thing to keep compiling.
 */
import {
  assert,
  barGeometry,
  check,
  onFreshPage,
  runBrowserRegression,
  summarise,
  surfaceOf,
  waitForAction,
  waitUntil,
} from './browser-harness.mjs';

// ── The fixture world ────────────────────────────────────────────────────────

/**
 * A garden of nine plots and one action that asks which one.
 *
 * The action needs a real answer -- nine choices, so nothing is auto-selected
 * and auto-executed -- because "the bar is up mid-question" is half of what is
 * measured here.
 *
 * And a second action, `plant`, for issue 444's headline case (#486): an
 * element pick made after an earlier choice. Once a crop is chosen the panel
 * shows the action's name, the crop as a chip, the prompt and -- because there
 * are more beds than the panel lists and each is a board element -- "Choose on
 * the board". The beds are their own class so `tend` keeps its nine choices.
 */
const RULES = `import { Game, Piece, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Ground extends Space<Garden> {}

class Plot extends Space<Garden> {
  tended = 0;
}

class Bed extends Space<Garden> {}

export class Garden extends Game<Garden, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Ground, Plot, Bed]);
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

/**
 * A unit chosen, then a bed handed to the board, under the action prompt given.
 *
 * \`plant\` uses Windup Warfare's wording, where #444 was found: the panel's fit
 * depends on the length of what it says, so the measured case uses the real
 * one. \`muster\` has an action prompt far longer than one line, which must wrap
 * rather than be cut short, since a prompt can carry rules text. It is offered
 * to seat 2 only, so seat 1's resting bar -- which the collapse checks measure
 * -- is not a different bar because of it.
 */
const packPick = (name: string, prompt: string, seat: number) =>
  worldAction<Garden>(name)
    .prompt(prompt)
    .condition({ [\`seat \${seat} only\`]: ({ player }) => player.seat === seat })
    .needs(() => [GROUND])
    .chooseFrom('crop', {
      prompt: 'Which unit?',
      choices: () => ['Scuttlers', 'Rollers'],
    })
    .chooseElement('bed', {
      prompt: 'Choose where the middle of the front row goes',
      elements: ({ game }) => game.all(Bed),
    })
    .execute(({ crop }, ctx) => {
      ctx.world.emit(GROUND, { crop }, \`Seat \${ctx.player.seat} placed \${crop as string}.\`);
    });

const plant = packPick('plant', 'Buy and place a pack', 1);
const muster = packPick(
  'muster',
  'Wind up every soldier in a fresh pack, pay for it from the war chest, and march it onto the field',
  2,
);

export const gameDefinition: GameDefinition = {
  gameClass: Garden,
  gameType: 'collapse-garden',
  displayName: 'Collapse Garden',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const ground = game.create(Ground, 'ground');
      for (let i = 1; i <= 9; i++) ground.create(Plot, \`plot-\${i}\`);
      // More than the panel lists (MAX_FLAT_CHOICE_CANDIDATES), so the pick
      // goes to the board.
      for (let i = 1; i <= 30; i++) ground.create(Bed, \`bed-\${i}\`);
      return { [GROUND]: ground as GameElement };
    },
    view: () => [GROUND],
    actions: [tend, plant, muster],
  },
};
`;

/**
 * A board that is deliberately TALLER than any viewport this drives.
 *
 * The measurement only means something if there is board under the bar to
 * begin with: a board that ends above the bar would show a growing usable area
 * with nothing in it. Its one button starts `tend` through the shared action
 * controller, so a question can start while the bar is down (#922).
 */
const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'GardenBoard',
  props: {
    actionController: { type: Object, required: true },
  },
  setup(props) {
    const controller = props.actionController as { start(name: string, options?: Record<string, unknown>): Promise<unknown> };
    return () =>
      h('div', {
        'data-fixture': 'garden',
        style: 'width: 900px; height: 1600px; background: linear-gradient(#dfe7d8, #b7c9a8);',
      }, [
        'garden',
        h('button', {
          'data-fixture': 'start-tend',
          style: 'display: block; margin: 40px;',
          onClick: () => void controller.start('tend', {}),
        }, 'Tend from the board'),
      ]);
  },
});
`;

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
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bar: box('[data-testid="bs-actionbar"]'),
      toggle: box('[data-testid="bs-actionbar-toggle"]'),
      token: box('[data-testid="bs-actionbar"] .turn-token'),
      attention: box('[data-testid="bs-actionbar-attention"]'),
      // The panel's own start button: present and boxed while the bar is up,
      // absent while it is down.
      start: box('[data-bs-action="tend"]'),
      // A choice control, which only exists mid-question.
      choice: box('.action-config .choice-btn'),
      // The content box: what the board is fitted to.
      region: region ? (() => {
        const cs = getComputedStyle(region);
        const top = region.getBoundingClientRect().top + region.clientTop + parseFloat(cs.paddingTop);
        const height = region.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const width = region.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { width, height, bottom: top + height, scrollTop: region.scrollTop };
      })() : null,
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

/** A one-row bar: one 44px control row and the bar's 9px padding above and below it. */
const ONE_ROW = 44 + 2 * 9;

const collapse = async (page) => {
  await surfaceOf(page).locator('[data-testid="bs-actionbar-toggle"]').click();
  // One frame for the class, one for the transition-free relayout.
  await page.waitForTimeout(150);
};

async function drive({ launch, hostUrl }) {
  const browser = await launch();

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
      await waitForAction(page, 'tend');
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

      await check(`${name}: the bar's own box shrinks`, () => {
        assert(down.bar !== null, 'the bar left the document entirely');
        assert(down.bar.height < open.bar.height,
          `the bar measured ${down.bar.height}px down and ${open.bar.height}px up`);
      });

      await check(`${name}: put down, the board reaches the line, with no band above it (#1518)`, () => {
        assert(down.region.width === open.region.width,
          `the board region is ${down.region.width}px wide with the bar down and ${open.region.width}px with it up`);
        assert(Math.abs(down.region.bottom - down.bar.top) <= 0.5,
          `the board region's content box ends at ${down.region.bottom} and the line's top is at ${down.bar.top}`);
      });

      // The controls menu is the ADAPTER's slot content and a world fills none.
      // That it survives where there IS one is asserted against a real slot in
      // `PlayShell.action-bar.test.ts`.
      await check(`${name}: down, the bar is a thin line (#1439, #1444)`, () => {
        assert(down.bar.height <= 14.5, `the collapsed bar is ${down.bar.height}px tall, not a thin line`);
        assert(down.token === null, 'the seat token is still drawn on the line');
        assert(down.start === null, 'the panel is still offering its start buttons');
      });

      // ── Mid-question: the bar comes back, because the answer lives in it ──
      await collapse(page); // back up, to start the action from the panel
      await surfaceOf(page).locator('[data-bs-action="tend"]').click();
      await page.waitForTimeout(200);
      await collapse(page); // the player puts it down while the question is open
      await page.waitForTimeout(200);
      const midQuestionDown = await measure(page);

      await check(`${name}: a bar put down mid-question still says the game is waiting`, () => {
        assert(midQuestionDown.attention !== null && midQuestionDown.attention.height > 0,
          'the toggle carries no attention mark, so nothing says the game is waiting');
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
        // The click lands on empty board, which starts nothing, so the bar must
        // still be down: it opens for a QUESTION, not for a click.
        const afterClick = await measure(page);
        assert(afterClick.start === null,
          'the bar came up for a board click that asked nothing');

        // The next question, started from the board with the bar still down.
        await surface.locator('[data-fixture="start-tend"]').click();
        const nextQuestion = await waitUntil(
          () => measure(page),
          (shot) => shot.choice !== null && shot.choice.height > 0,
          5_000,
        );
        assert(nextQuestion.choice !== null && nextQuestion.choice.height > 0,
          'a new question started with the bar down, and its choice controls stayed hidden');
        // The bar came up for the question, not by the player's toggle, so the board must not refit (#13, #1518).
        assert(nextQuestion.region.height === afterClick.region.height,
          `the board region is ${nextQuestion.region.height}px tall with the bar up for the question and ` +
          `${afterClick.region.height}px with it put down`);
      });

      await context.close();
    }

    for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      await oneRowReserve(browser, hostUrl, viewport);
    }

    for (const viewport of [{ width: 375, height: 812 }, { width: 844, height: 390 }]) {
      for (const colorScheme of ['light', 'dark']) {
        await pickAfterAChoice(browser, hostUrl, viewport, colorScheme);
      }
    }
  } finally {
    await browser.close();
  }

  return summarise('measured on screen in a real browser at both widths.');
}

/** Take seat 2 and start its long-prompt pick (`muster`, see `packPick`) up to the board handoff. */
async function musterAsSeat2(page, surface) {
  await page.locator('[data-testid="world-seat-switcher"]').click();
  await page.locator('[data-testid="world-take-seat"][data-seat="2"]').click();
  await surface.locator('[data-bs-action="muster"]').click();
  await surface.locator('.action-config .choice-btn', { hasText: 'Scuttlers' }).click();
  await surface.locator('.board-handoff-btn').waitFor({ timeout: 15_000 });
}

/**
 * ONE ROW OF BAR IS RESERVED UNDER THE BOARD, AND ONLY THE ROWS ABOVE IT FLOAT (#1517).
 *
 * Seat 1's bar at rest is one row: the board region's content box, which a
 * fitted board fills, ends exactly at its top, on a desktop and on a short
 * landscape screen, where the bar's padding is smaller. Seat 2's long prompt
 * grows the bar past one row and the region keeps its size, so the board never
 * refits on a pick. Putting the bar down drops the reserve to the line, and the
 * region ends at the line's top (#1518).
 */
async function oneRowReserve(browser, hostUrl, viewport) {
  const size = `${viewport.width}x${viewport.height}`;
  await onFreshPage(browser, hostUrl, { viewport }, (page) => waitForAction(page, 'tend'), async (page, surface) => {
    const rest = await measure(page);
    await check(`${size}: the board is fitted exactly above a one-row bar, not under it and not short of it (#1517)`, () => {
      assert(rest.bar.height <= ONE_ROW + 1, `the bar at rest is ${rest.bar.height}px tall, more than one row, so this proves nothing`);
      assert(Math.abs(rest.region.bottom - rest.bar.top) <= 0.5,
        `the board region's content box ends at ${rest.region.bottom} and the one-row bar's top is at ${rest.bar.top}`);
    });

    await check(`${size}: put down, the board region ends at the line's top (#1518)`, async () => {
      await collapse(page);
      const down = await measure(page);
      assert(down.bar.height <= 14.5, `the collapsed bar is ${down.bar.height}px tall, not the line`);
      assert(Math.abs(down.region.bottom - down.bar.top) <= 0.5,
        `the board region's content box ends at ${down.region.bottom} and the line's top is at ${down.bar.top}`);
      await collapse(page);
      const up = await measure(page);
      assert(up.region.height === rest.region.height,
        `the board region is ${up.region.height}px tall after the bar comes back up and ${rest.region.height}px before`);
    });

    // A short landscape screen caps the bar at one row, so nothing there grows it past the reserve.
    if (viewport.height > 600) await check(`${size}: the board keeps its size with a one-row bar and a taller bar (#1517)`, async () => {
      // Seat 2's action prompt is long enough to wrap the bar at this width.
      await musterAsSeat2(page, surface);
      const pick = await measure(page);
      assert(pick.bar.height > ONE_ROW + 1, `the bar during the pick is ${pick.bar.height}px tall, one row, so this proves nothing`);
      assert(pick.region.width === rest.region.width && pick.region.height === rest.region.height,
        `the board region is ${pick.region.width}x${pick.region.height} with the bar taller and ` +
        `${rest.region.width}x${rest.region.height} with one row`);
    });
  });
}

/**
 * ISSUE 444'S HEADLINE CASE, MEASURED (#486).
 *
 * An element pick made after an earlier choice, on a phone and on a short
 * landscape screen: the bar's top edge sits within its two-row cap, nothing
 * scrolls inside the bar, and the board region keeps the size it had with the
 * one-row bar at rest (#1514). Before #444 the bar grew up to five rows. Run in both colour schemes, which
 * proves the layout holds in each, not that either looks right.
 */
/** What a pick after a choice shows, each of which must be whole and in view. */
const PICK_PARTS = [
  '.config-title',
  '.selected-value',
  '.selection-input > .selection-prompt',
  '.board-handoff-btn',
];

async function pickAfterAChoice(browser, hostUrl, viewport, colorScheme) {
  const size = `${viewport.width}x${viewport.height} ${colorScheme}`;
  await onFreshPage(browser, hostUrl, { viewport, colorScheme }, (page) => waitForAction(page, 'tend'), async (page, surface) => {
    await check(`${size}: an element pick after an earlier choice sits inside the cap, without scrolling or resizing the board`, async () => {
      const atRest = await barGeometry(surface);
      await surface.locator('[data-bs-action="plant"]').click();
      await surface.locator('.action-config .choice-btn', { hasText: 'Scuttlers' }).click();
      await surface.locator('.board-handoff-btn').waitFor({ timeout: 15_000 });
      const bar = await barGeometry(surface, PICK_PARTS);
      assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}`);
      assert(!bar.scrolls, `the bar scrolls during the pick (${bar.height}px tall): it does not fit the strip`);
      assert(bar.regionHeight === atRest.regionHeight,
        `the board region is ${bar.regionHeight}px tall during the pick and ${atRest.regionHeight}px at rest`);
      assert(bar.outside.length === 0, `not in view inside the bar: ${bar.outside.join(', ')}`);
      assert(bar.clipped.length === 0, `cut off sideways: ${bar.clipped.join(', ')}`);
      await surface.locator('.action-config .cancel-btn').click();
      await surface.locator('.action-config').waitFor({ state: 'detached', timeout: 10_000 });
    });

    await check(`${size}: a long action prompt wraps whole, and the handoff stays reachable`, async () => {
      // Never cut short. It may cost the bar its fit, so the bar may scroll --
      // the last resort -- but it stays inside its cap and every part of the
      // pick can be scrolled into view. Offered to seat 2 (see \`packPick\`).
      await musterAsSeat2(page, surface);
      const handoff = surface.locator('.board-handoff-btn');
      const bar = await barGeometry(surface, PICK_PARTS);
      assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}`);
      assert(bar.clipped.length === 0, `cut off sideways: ${bar.clipped.join(', ')}`);
      await handoff.scrollIntoViewIfNeeded();
      const scrolled = await barGeometry(surface, ['.board-handoff-btn']);
      assert(scrolled.outside.length === 0, 'the board handoff cannot be scrolled into view inside the bar');
    });
  });
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
