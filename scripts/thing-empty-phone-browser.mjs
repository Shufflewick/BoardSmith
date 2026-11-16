#!/usr/bin/env node
/**
 * "NOTHING CAN BE DONE WITH X RIGHT NOW" WRAPS WITHIN THE BAR ON A PHONE (#1652).
 *
 * A selected thing with nothing to offer shows that sentence in the Action Panel. It carried the
 * menu label's `white-space: nowrap`, so at 390x844 a thing with a long name ran it past the bar's
 * right edge, cut off. jsdom lays nothing out, so only a real browser can see where it ends.
 *
 * Served from `boardsmith init`'s table sample, with its cards as a subject type: the player
 * studies one, and a studied card can be studied no more, so the selected card has nothing left.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/thing-empty-phone-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, onFreshPage, runBrowserRegression, summarise } from './browser-harness.mjs';

const ELEMENTS = `import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck } from 'boardsmith';

export class Card extends BaseCard {
  suit!: string;
  rank!: string;
  points!: number;
  studied = false;
}

export class Hand extends BaseHand {}

export class Deck extends BaseDeck {}
`;

const ACTIONS = `import { Action, subjectType, type ActionDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';
import { Card } from './elements.js';

const CARDS = subjectType<Card>({ name: 'Cards', onBoard: true, label: (card) => \`The card \${card.name} held in the hand of the first seat\` });

export function createDrawAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('draw')
    .prompt('Draw a card')
    .execute((args, ctx) => { ctx.game.deck.first(Card)?.putInto(ctx.player.hand); });
}

export function createPlayAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('play')
    .prompt('Study')
    .chooseElement('card', {
      elements: (ctx) => [...ctx.player.hand.all(Card)],
      subject: CARDS,
      disabled: (card) => (card.studied ? 'Already studied.' : false),
    })
    .execute(({ card }) => { card.studied = true; });
}
`;

/** The first seat acts again and again, so its panel stays on its own turn. */
const FLOW = `import { actionStep, type FlowDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

export function createGameFlow(): FlowDefinition<TableFixtureGame> {
  return {
    root: actionStep({ name: 'turn', actions: ['draw', 'play'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 40 }),
  };
}
`;

const STATUS = '[data-bs-thing-empty]';

await runBrowserRegression(
  {
    script: 'thing-empty-phone-browser.mjs',
    engines: ['chromium', 'webkit'],
    table: { files: { 'src/rules/elements.ts': ELEMENTS, 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } },
  },
  driveThrough,
);

async function driveThrough({ launch, hostUrl }) {
  const browser = await launch();
  const frameOf = (page) => page.frameLocator('.dev-host__frame');
  const ready = (page) => frameOf(page).locator('[data-bs-action-group="Cards"]').waitFor({ timeout: 60_000 });
  try {
    const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' };
    await onFreshPage(browser, hostUrl, phone, ready, async (page) => {
      const frame = frameOf(page);
      await frame.locator('[data-bs-action-group="Cards"]').click();
      await frame.locator('[data-bs-thing]').first().click();
      await frame.locator('[data-bs-action="play"]').click();
      await frame.locator(STATUS).waitFor({ timeout: 15_000 });
      await check('390x844: the sentence for a thing with nothing to do wraps inside the bar, cut off nowhere', async () => {
        const fit = await frame.locator('[data-testid="bs-actionbar"]').evaluate((bar, selector) => {
          const status = bar.querySelector(selector);
          return { right: status.getBoundingClientRect().right, edge: bar.getBoundingClientRect().right, wider: status.scrollWidth - status.clientWidth };
        }, STATUS);
        assert(fit.right <= fit.edge + 1, `the sentence ends at ${fit.right}px, past the bar's edge at ${fit.edge}px`);
        assert(fit.wider <= 1, `the sentence's text is ${fit.wider}px wider than its box`);
      });
    });
  } finally {
    await browser.close();
  }
  return summarise('for the empty-thing sentence in the Action Panel on a phone');
}
