#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A CHOICE LIST IN THE ACTION BAR AT PHONE WIDTH (#1573, #1580, #1587, #1589).
 *
 * An artillery allocation offers eight checkboxes in the Action Panel. At
 * 390px only the first one or two showed and the rest sat below the screen
 * with no sign they were there, while at 1440px every one showed (#1573).
 * Survival of the Fittest answers a text field, so its chip shows, then offers
 * an optional choice: at 390px the chip and the title filled the bar and the
 * prompt and the skip button sat below its edge (#1580), and so did an
 * ordered list's and an empty element pick's (#1587), and an element pick's
 * whose candidates the board does not draw (#1589). jsdom lays nothing
 * out, so only a real browser can see which controls are on screen.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/choice-list-phone-browser.mjs`; a missing Chromium says to run
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

/** An artillery allocation: one checkbox per hit a unit can take, some offered more than once. */
const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Battery extends Space<Barrage> {}
class Rival extends Space<Barrage> {}

export class Barrage extends Game<Barrage, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Battery, Rival]);
  }
}

const FIELD = 'field';

const allocate = worldAction<Barrage>('allocate')
  .prompt('Allocate hits')
  .needs(() => [FIELD])
  .chooseFrom('targets', {
    prompt: 'Choose which units take the artillery hits',
    choices: () => [
      "P1's guards", "P1's guards",
      'Isolde', 'Isolde', 'Isolde',
      'Rowan', 'Rowan', 'Rowan',
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
    choices: () => [...Array(3).fill('Kim'), ...Array(20).fill('Sheriff Guards')],
    multiSelect: { min: 3, max: 3 },
  })
  .execute(({ targets }, ctx) => {
    ctx.world.emit(FIELD, { hits: (targets as string[]).length }, 'The mortar hits were allocated.');
  });

/** A text field whose chip sits above an optional pick (#1539, #1580, #1587). */
const charge = (name: string) => worldAction<Barrage>(name)
  .prompt('Accuse a rival of breaking the camp law')
  .needs(() => [FIELD])
  .enterText('charge', { prompt: 'What did they do?', maxLength: 40 });
const accuse = (name: string, choices: () => string[]) => charge(name)
  .chooseFrom('who', { prompt: 'Who exactly?', choices, optional: true })
  .execute((_args, ctx) => ctx.world.emit(FIELD, { accused: true }, 'A rival was accused.'));
const accuseInOrder = charge('accuseInOrder')
  .chooseFrom('who', { prompt: 'Who exactly, in order?', choices: () => ['Ana', 'Bo'], orderedList: { min: 1, max: 2 }, optional: true })
  .execute((_args, ctx) => ctx.world.emit(FIELD, { accused: true }, 'Rivals were accused.'));
const accuseOnBoard = (name: string, elements: (ctx: { game: Barrage }) => GameElement[]) => charge(name)
  .chooseElement('who', { prompt: 'Who exactly?', elements, optional: true })
  .execute((_args, ctx) => ctx.world.emit(FIELD, { accused: true }, 'A rival was accused.'));

export const gameDefinition: GameDefinition = {
  gameClass: Barrage,
  gameType: 'multiselect-phone-barrage',
  displayName: 'Multiselect Phone Barrage',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const battery = (game as Barrage).create(Battery, 'battery');
      battery.create(Rival, 'ana');
      return { [FIELD]: battery as GameElement };
    },
    view: () => [FIELD],
    actions: [allocate, mortar, accuse('accuse', () => ['Ana', 'Bo']), accuse('accuseNobody', () => []), accuseInOrder, accuseOnBoard('accuseNoElement', () => []), accuseOnBoard('accuseElement', ({ game }) => game.all(Battery)), accuseOnBoard('accuseRival', ({ game }) => game.all(Rival))],
  },
};
`;

/** Draws the battery and not the rival inside it, as a board leaves out a hand (#1589). */
const BOARD = `import { defineComponent, h } from 'vue';
import { anchorAttrs, findElements } from 'boardsmith/ui';

export default defineComponent({
  name: 'BarrageBoard',
  props: { gameView: { type: Object, default: null } },
  setup: (props) => () => h('div', { class: 'barrage-board' }, [
    'The field',
    ...findElements(props.gameView, { className: 'Battery' }).map((battery) =>
      h('div', { class: 'battery', ...anchorAttrs({ id: battery.id }) }, 'Battery')),
  ]),
});
`;

await runBrowserRegression(
  {
    script: 'choice-list-phone-browser.mjs',
    fixture: {
      slug: 'choice-list-phone',
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
  return summarise('for a choice list in the Action Panel');
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
      await assertAllInView(surface, [
        '.config-title',
        '.cancel-btn',
        '.multi-select-count',
        ...Array.from({ length: count }, (_, i) => `.multi-select-choice:nth-of-type(${i + 1})`),
      ]);
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

    const skip = surface.locator('.skip-btn');
    const picks = [
      ['accuse', ['.selection-prompt', '.choice-buttons .choice-btn:not(.skip-btn)']],
      ['accuseNobody', ['.selection-prompt']],
      ['accuseInOrder', ['.selection-prompt', '.ordered-list-add', '.ordered-list-choices .done-button']],
      // An element pick with no candidate falls back to an instruction, and grows (#1587).
      ['accuseNoElement', ['.instruction-text']],
      // Its candidate carries a board ref, but the board does not draw it, so the list grows (#1589).
      ['accuseRival', ['.selection-prompt', '.element-selection .element-btn']],
    ];
    for (const [action, shown] of picks) {
      await check(`${size}: ${action}: a pick under a chip keeps the chip, the prompt and the skip button in view without scrolling`, async () => {
        await surface.locator(`[data-bs-action="${action}"]`).click();
        const field = surface.locator('.text-input input');
        await field.fill('Stole the fire from the eastern camp');
        await field.press('Enter');
        await skip.waitFor({ timeout: 15_000 });
        // The choices arrive after the pick does, so wait for them before measuring.
        for (const selector of shown) await surface.locator(selector).first().waitFor({ timeout: 15_000 });
        try {
          await assertAllInView(surface, ['.config-title', '.selected-value', '.skip-btn', ...shown]);
        } finally {
          await surface.locator('.cancel-btn').click();
          await skip.waitFor({ state: 'detached', timeout: 10_000 });
        }
      });
    }

    // The board draws its candidate, so the bar keeps its cap and scrolls rather than cover it (#1573, #1587, #1589).
    await check(`${size}: an element pick the board draws under a chip keeps the cap, and its skip is reachable`, async () => {
      await surface.locator('.barrage-board .battery').waitFor({ timeout: 15_000 });
      await surface.locator('[data-bs-action="accuseElement"]').click();
      const field = surface.locator('.text-input input');
      await field.fill('Stole the fire from the eastern camp');
      await field.press('Enter');
      await surface.locator('.element-selection .element-btn').first().waitFor({ timeout: 15_000 });
      try {
        const bar = await barGeometry(surface);
        assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}, covering the board`);
        await skip.scrollIntoViewIfNeeded();
        const end = await barGeometry(surface, ['.skip-btn']);
        assert(end.outside.length === 0, `the skip button cannot be scrolled into view inside the bar (${end.height}px tall)`);
      } finally {
        await surface.locator('.cancel-btn').click();
        await skip.waitFor({ state: 'detached', timeout: 10_000 });
      }
    });
  });
}

/** Every one of `selectors` in view inside the bar, the bar not scrolling and its top on screen. */
async function assertAllInView(surface, selectors) {
  const bar = await barGeometry(surface, selectors);
  assert(bar.outside.length === 0, `not in view inside the bar (${bar.height}px tall, top at ${bar.top}): ${bar.outside.join(', ')}`);
  assert(!bar.scrolls, `the bar scrolls (${bar.height}px tall), so part of the pick sits below its edge`);
  assert(bar.top >= 0, `the bar's top is at ${bar.top}, off the top of the screen`);
}
