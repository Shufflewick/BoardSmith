#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A LONG MULTISELECT AT PHONE WIDTH (#1573).
 *
 * MERC's artillery allocation offers eight checkboxes in the Action Panel. At
 * 390px only the first one or two showed and the rest sat below the screen
 * with no sign they were there, while at 1440px every one showed. jsdom lays
 * nothing out, so only a real browser can see which checkboxes are on screen.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/multiselect-phone-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import {
  assert,
  barGeometry,
  check,
  onFreshPage,
  runBrowserRegression,
  summarise,
  waitForAction,
} from './browser-harness.mjs';

/** MERC's artillery allocation: one checkbox per hit a unit can take, some offered more than once. */
const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Battery extends Space<Barrage> {}

export class Barrage extends Game<Barrage, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Battery]);
  }
}

const FIELD = 'field';

const allocate = worldAction<Barrage>('allocate')
  .prompt('Allocate hits')
  .needs(() => [FIELD])
  .chooseFrom('targets', {
    prompt: 'Choose which units take the artillery hits',
    choices: () => [
      "P1's militia", "P1's militia",
      'Adelheid', 'Adelheid', 'Adelheid',
      'Genesis', 'Genesis', 'Genesis',
    ],
    multiSelect: { min: 4, max: 4 },
  })
  .execute(({ targets }, ctx) => {
    ctx.world.emit(FIELD, { hits: (targets as string[]).length }, 'The hits were allocated.');
  });

const mortar = worldAction<Barrage>('mortar')
  .prompt('Allocate mortar hits')
  .needs(() => [FIELD])
  .chooseFrom('targets', {
    prompt: 'Choose which units take the mortar hits',
    choices: () => [...Array(3).fill('Kim'), ...Array(20).fill('Dictator Militia')],
    multiSelect: { min: 3, max: 3 },
  })
  .execute(({ targets }, ctx) => {
    ctx.world.emit(FIELD, { hits: (targets as string[]).length }, 'The mortar hits were allocated.');
  });

export const gameDefinition: GameDefinition = {
  gameClass: Barrage,
  gameType: 'multiselect-phone-barrage',
  displayName: 'Multiselect Phone Barrage',
  world: {
    maxPlayers: 2,
    genesis: (game) => ({ [FIELD]: (game as Barrage).create(Battery, 'battery') as GameElement }),
    view: () => [FIELD],
    actions: [allocate, mortar],
  },
};
`;

const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'BarrageBoard',
  setup: () => () => h('div', { class: 'barrage-board' }, 'The field'),
});
`;

await runBrowserRegression(
  {
    script: 'multiselect-phone-browser.mjs',
    fixture: {
      slug: 'multiselect-phone',
      displayName: 'Multiselect Phone',
      gameClass: 'Barrage',
      rules: RULES,
      boardFile: 'BarrageBoard',
      board: BOARD,
    },
  },
  driveThrough,
);

async function driveThrough({ launch, hostUrl }) {
  const browser = await launch();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 375, height: 667 }]) {
      await onScreen(browser, hostUrl, viewport);
    }
  } finally {
    await browser.close();
  }
  return summarise('for a long multiSelect in the Action Panel');
}

async function onScreen(browser, hostUrl, viewport) {
  const size = `${viewport.width}x${viewport.height}`;
  await onFreshPage(browser, hostUrl, { viewport }, (page) => waitForAction(page, 'allocate'), async (page, surface) => {
    const choices = surface.locator('.multi-select-choice');
    const open = async (action) => {
      await surface.locator(`[data-bs-action="${action}"]`).click();
      await choices.first().waitFor({ timeout: 15_000 });
    };
    const close = async () => {
      await surface.locator('.cancel-btn').click();
      await choices.first().waitFor({ state: 'detached', timeout: 10_000 });
    };

    await check(`${size}: every checkbox, the ticked ones and the count are in view without scrolling`, async () => {
      await open('allocate');
      const count = await choices.count();
      assert(count === 8, `the panel draws ${count} checkboxes, not 8`);
      // Tick three, as the ticket's player had, so the ticked boxes must stay in view too.
      for (const index of [0, 2, 5]) await choices.nth(index).click();
      const bar = await barGeometry(surface, [
        '.config-title',
        '.cancel-btn',
        '.multi-select-count',
        ...Array.from({ length: count }, (_, i) => `.multi-select-choice:nth-of-type(${i + 1})`),
      ]);
      assert(bar.outside.length === 0, `not in view inside the bar (${bar.height}px tall, top at ${bar.top}): ${bar.outside.join(', ')}`);
      assert(!bar.scrolls, `the bar scrolls (${bar.height}px tall), so some choices sit below its edge`);
      assert(bar.top >= 0, `the bar's top is at ${bar.top}, off the top of the screen`);
    });

    await check(`${size}: closing the pick puts the bar back inside the strip`, async () => {
      await close();
      const bar = await barGeometry(surface);
      assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}`);
    });

    // #1574: a value offered more than once ticks the copy clicked, and only the selected copies show ticked.
    await check(`${size}: clicking one copy of a repeated value ticks that copy and no other`, async () => {
      await open('mortar');
      try {
        for (const index of [0, 5]) await choices.nth(index).click();
        const ticked = await surface.locator('.multi-select-choice input').evaluateAll((inputs) =>
          inputs.flatMap((input, i) => (input.checked ? [i] : [])));
        const shown = await surface.locator('.multi-select-choice').evaluateAll((labels) =>
          labels.flatMap((label, i) => (label.classList.contains('selected') ? [i] : [])));
        const count = (await surface.locator('.multi-select-count').textContent())?.trim();
        assert(ticked.join() === '0,5', `the ticked checkboxes are ${ticked.join(', ')}, not 0 and 5`);
        assert(shown.join() === '0,5', `the choices drawn as selected are ${shown.join(', ')}, not 0 and 5`);
        assert(count?.includes('2/3'), `the count reads "${count}", not 2/3`);
      } finally {
        await close();
      }
    });

    // 23 choices are more than the screen bound holds on a phone: the bar grows to it and scrolls the rest.
    await check(`${size}: a pick longer than the screen bound keeps the action and count in view, and its last choice is reachable`, async () => {
      await open('mortar');
      try {
        const bar = await barGeometry(surface, ['.config-title', '.multi-select-count', '.multi-select-choice']);
        assert(bar.top >= 0, `the bar's top is at ${bar.top}, off the top of the screen`);
        assert(bar.top < bar.strip - 1, `the bar stayed inside its strip (top at ${bar.top}), so most choices hide below its edge`);
        assert(bar.outside.length === 0, `not in view inside the bar (${bar.height}px tall, top at ${bar.top}): ${bar.outside.join(', ')}`);
        await choices.last().scrollIntoViewIfNeeded();
        const end = await barGeometry(surface, ['.multi-select-choice:last-of-type']);
        assert(end.outside.length === 0, `the last choice cannot be scrolled into view inside the bar (${end.height}px tall)`);
      } finally {
        await close();
      }
    });
  });
}
