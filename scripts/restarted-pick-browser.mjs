#!/usr/bin/env node
/**
 * A PAGE RELOADED PART WAY THROUGH A PICK-BY-PICK ACTION CAN STILL FINISH IT (#1556).
 *
 * The server keeps a seat's open action across a reload, at the pick it is
 * waiting for. The reloaded page knows nothing of it and starts the action at
 * its first pick, which the server refused, so the player could never finish.
 * The server now starts the action again from that pick. Only the real dev
 * host shows the whole road: a seat's page, a reload, and the same seat's
 * open action on the host.
 *
 * Served from `boardsmith init`'s table sample, with `play` taking two picks,
 * the first with an `onSelect` so the page sends it to the server on its own.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/restarted-pick-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, onFreshPage, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

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
    .chooseFrom('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => [...ctx.player.hand.all(Card)],
      onSelect: () => {},
    })
    .chooseFrom('times', { prompt: 'How many times?', choices: ['once', 'twice'] })
    .execute(({ card, times }, ctx) => {
      ctx.player.score += card.points * (times === 'twice' ? 2 : 1);
      card.remove();
      ctx.game.message('Played a card ' + times);
      return { success: true };
    });
}
`;

const FLOW = `import { loop, eachPlayer, actionStep, type FlowDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

export function createGameFlow(): FlowDefinition<TableFixtureGame> {
  return {
    root: loop({
      name: 'game-loop',
      maxIterations: 100,
      do: eachPlayer({ name: 'player-turns', do: actionStep({ name: 'turn', actions: ['draw', 'play'] }) }),
    }),
  };
}
`;

const gameFrame = (page) => page.frameLocator('.dev-host__frame');
const playOffered = (page) => gameFrame(page).locator('.action-btn[data-bs-action="play"]').waitFor({ timeout: 60_000 });
const prompt = (frame) => frame.locator('.selection-prompt').first().innerText().catch(() => '');

/** Open `play` and answer its first pick with the first card. */
async function pickACard(page) {
  const frame = gameFrame(page);
  await frame.locator('.action-btn[data-bs-action="play"]').click();
  await frame.locator('.selection-input .choice-btn').first().click();
  return waitUntil(() => prompt(frame), (text) => text.includes('How many times?'), 10_000);
}

await runBrowserRegression(
  { script: 'restarted-pick-browser.mjs', table: { files: { 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      await onFreshPage(browser, hostUrl, { viewport: { width: 1440, height: 900 } }, playOffered, async (page) => {
        const first = await pickACard(page);
        await check('the first card pick reaches the second pick', async () => {
          assert(first.includes('How many times?'), `the panel shows ${JSON.stringify(first)}`);
        });

        await page.reload();
        await playOffered(page);
        const again = await pickACard(page);
        await check('after a reload, picking a card again reaches the second pick instead of a refusal (#1556)', async () => {
          assert(again.includes('How many times?'), `the panel shows ${JSON.stringify(again)}`);
        });
        if (!again.includes('How many times?')) return;

        const frame = gameFrame(page);
        await frame.locator('.selection-input .choice-btn', { hasText: 'twice' }).click();
        const lines = frame.locator('[data-testid="bs-log-line"]', { hasText: 'Played a card twice' });
        const logged = await waitUntil(() => lines.count(), (n) => n > 0, 10_000);
        await check('the restarted action completes', async () => {
          assert(logged === 1, `the log holds ${logged} "Played a card twice" lines`);
        });
      });
    } finally {
      await browser.close();
    }
    return summarise('on a pick-by-pick action restarted after a reload');
  },
);
