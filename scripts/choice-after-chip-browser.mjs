#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A CHOICE PICK UNDER A CHIP AT PHONE WIDTH (#1580).
 *
 * Survival of the Fittest answers a text field, so its chip shows, then offers
 * an optional choice. At 390px the bar held 114px of its 178px: the chip and
 * the title filled it, and the prompt and the skip button sat below its edge
 * with no sign they were there. jsdom lays nothing out, so only a real browser
 * can see which controls are on screen.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/choice-after-chip-browser.mjs`; a missing Chromium says to run
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

const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Camp extends Space<Wilds> {}

export class Wilds extends Game<Wilds, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Camp]);
  }
}

const CAMP = 'camp';

/** A pick that offers two choices, and one whose narrowed choices come back empty (#1539). */
const accuse = (name: string, choices: () => string[]) => worldAction<Wilds>(name)
  .prompt('Accuse a rival of breaking the camp law')
  .needs(() => [CAMP])
  .enterText('charge', { prompt: 'What did they do?', maxLength: 40 })
  .chooseFrom('who', { prompt: 'Who exactly?', choices, optional: true })
  .execute((_args, ctx) => {
    ctx.world.emit(CAMP, { accused: true }, 'A rival was accused.');
  });

export const gameDefinition: GameDefinition = {
  gameClass: Wilds,
  gameType: 'choice-after-chip-wilds',
  displayName: 'Choice After Chip Wilds',
  world: {
    maxPlayers: 2,
    genesis: (game) => ({ [CAMP]: (game as Wilds).create(Camp, 'camp') as GameElement }),
    view: () => [CAMP],
    actions: [accuse('accuse', () => ['Ana', 'Bo']), accuse('accuseNobody', () => [])],
  },
};
`;

const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'WildsBoard',
  setup: () => () => h('div', { class: 'wilds-board' }, 'The camp'),
});
`;

await runBrowserRegression(
  {
    script: 'choice-after-chip-browser.mjs',
    fixture: {
      slug: 'choice-after-chip',
      displayName: 'Choice After Chip',
      gameClass: 'Wilds',
      rules: RULES,
      boardFile: 'WildsBoard',
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
  return summarise('for a choice pick under a chip in the Action Panel');
}

async function onScreen(browser, hostUrl, viewport) {
  const size = `${viewport.width}x${viewport.height}`;
  await onFreshPage(browser, hostUrl, { viewport }, (page) => waitForAction(page, 'accuse'), async (page, surface) => {
    const skip = surface.locator('.skip-btn');
    for (const [action, shown] of [['accuse', ['.choice-buttons .choice-btn:not(.skip-btn)']], ['accuseNobody', []]]) {
      await check(`${size}: ${action}: the chip, the prompt and the skip button are in view without scrolling`, async () => {
        await surface.locator(`[data-bs-action="${action}"]`).click();
        const field = surface.locator('.text-input input');
        await field.fill('Stole the fire from the eastern camp');
        await field.press('Enter');
        await skip.waitFor({ timeout: 15_000 });
        // The choices arrive after the pick does, so wait for them before measuring.
        for (const selector of shown) await surface.locator(selector).first().waitFor({ timeout: 15_000 });
        try {
          const bar = await barGeometry(surface, ['.config-title', '.selected-value', '.selection-prompt', '.skip-btn', ...shown]);
          assert(bar.outside.length === 0, `not in view inside the bar (${bar.height}px tall, top at ${bar.top}): ${bar.outside.join(', ')}`);
          assert(!bar.scrolls, `the bar scrolls (${bar.height}px tall), so part of the pick sits below its edge`);
          assert(bar.top >= 0, `the bar's top is at ${bar.top}, off the top of the screen`);
        } finally {
          await surface.locator('.cancel-btn').click();
          await skip.waitFor({ state: 'detached', timeout: 10_000 });
        }
      });
    }

    await check(`${size}: closing the pick puts the bar back inside the strip`, async () => {
      const bar = await barGeometry(surface);
      assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}`);
    });
  });
}
