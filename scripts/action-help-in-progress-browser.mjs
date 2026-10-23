#!/usr/bin/env node
/**
 * THE ACTION IN PROGRESS SHOWS ITS HELP "?" BESIDE ITS PROMPT (#1455).
 *
 * A step whose only action has a pick starts that action at once, so its
 * button, and the "?" pinned to the button's corner, are never drawn (Go
 * Fish's ask). The panel draws the "?" beside the open action's prompt
 * instead. Only a real browser lays it out: the "?" must sit in the row after
 * the prompt and before the cancel, not over the prompt's text, at desktop
 * and phone widths, and a click on it must show the help.
 *
 * Served from `boardsmith init`'s table sample, with one action on the step.
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/action-help-in-progress-browser.mjs`; a missing Chromium says
 * to run `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const HELP = 'Score a card from your hand, adding its points to your total.';

const ACTIONS = `import { Action, type ActionDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';
import { Card } from './elements.js';

export function createDrawAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('draw')
    .prompt('Draw a card from the deck')
    .execute((args, ctx) => {
      ctx.game.deck.first(Card)?.putInto(ctx.player.hand);
      return { success: true };
    });
}

export function createPlayAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('play')
    .prompt('Play a card from your hand')
    .help(${JSON.stringify(HELP)})
    .chooseFrom('card', { prompt: 'Select a card to play', choices: (ctx) => [...ctx.player.hand.all(Card)] })
    .execute(({ card }, ctx) => {
      ctx.player.score += card.points;
      card.remove();
      return { success: true };
    });
}
`;

/** Only the play action on the step, so the panel starts it on its own. */
const FLOW = `import { loop, eachPlayer, actionStep, type FlowDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

export function createGameFlow(): FlowDefinition<TableFixtureGame> {
  return {
    root: loop({
      name: 'game-loop',
      maxIterations: 100,
      do: eachPlayer({ name: 'player-turns', do: actionStep({ name: 'turn', actions: ['play'] }) }),
    }),
  };
}
`;

const TRIGGER = '.config-header button[aria-label="Help for Play a card from your hand"]';
const TIP = '#play-help-tip';

/** The game frame, once the open action's "?" is drawn. */
async function openGame(page, hostUrl) {
  await page.goto(hostUrl);
  await page.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
  const frame = page.frameLocator('.dev-host__frame');
  await frame.locator(TRIGGER).waitFor({ timeout: 60_000 });
  return frame;
}

/** The "?" sits after the prompt and before the cancel, on their line, overlapping neither. */
async function checkPlacement(frame, width) {
  const [title, help, cancel] = await Promise.all(
    ['.config-title', TRIGGER, '.cancel-btn'].map((selector) => frame.locator(selector).boundingBox()),
  );
  await check(`at ${width}px, the "?" sits between the open action's prompt and its cancel`, async () => {
    assert(help.x >= title.x + title.width, `the "?" covers the prompt: "?" ${JSON.stringify(help)}, prompt ${JSON.stringify(title)}`);
    assert(help.x + help.width <= cancel.x, `the "?" is not before the cancel: "?" ${JSON.stringify(help)}, cancel ${JSON.stringify(cancel)}`);
    const middle = help.y + help.height / 2;
    assert(middle > title.y && middle < title.y + title.height, `the "?" is off the prompt's line: "?" ${JSON.stringify(help)}, prompt ${JSON.stringify(title)}`);
  });
}

await runBrowserRegression(
  { script: 'action-help-in-progress-browser.mjs', table: { files: { 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      // One player for the whole run (a second browser would be a second player).
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const frame = await openGame(page, hostUrl);
        await checkPlacement(frame, width);
        await frame.locator(TRIGGER).click();
        const shown = await waitUntil(() => frame.locator(TIP).isVisible(), (now) => now, 2_000);
        await check(`at ${width}px, clicking the "?" shows the open action's help`, async () => {
          assert(shown, 'the help did not show');
          const text = (await frame.locator(TIP).innerText()).trim();
          assert(text === HELP, `the help shows ${JSON.stringify(text)}`);
        });
      }
      await context.close();
    } finally {
      await browser.close();
    }
    return summarise('on the open action\'s help "?" in the dev host');
  },
);
