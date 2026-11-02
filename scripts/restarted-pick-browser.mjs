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
 * the first with an `onSelect` so the page sends it to the server on its own,
 * and `stack` taking a plain pick then a repeating one, which a reloaded page
 * starts afresh at the repeat the server is part way through.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/restarted-pick-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, onFreshPage, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const ACTIONS = `import { Action, type ActionDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';
import { Card } from './elements.js';

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

// The sample's game registers this export by name; this table stacks instead of drawing.
export function createDrawAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('stack')
    .prompt('Stack marks')
    .chooseFrom('pace', { prompt: 'Which pace?', choices: ['slow', 'fast'] })
    .chooseFrom('marks', { prompt: 'Add a mark', choices: ['ring', 'star', 'done'], repeat: { until: (_ctx, mark) => mark === 'done' } })
    .execute(({ pace, marks }, ctx) => {
      ctx.game.message('Stacked ' + pace + ' ' + marks.join(' '));
      return { success: true };
    });
}
`;

const FLOW = `import { loop, actionStep, type FlowDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

export function createGameFlow(): FlowDefinition<TableFixtureGame> {
  return {
    root: loop({
      name: 'game-loop',
      maxIterations: 100,
      // Every turn is the page's seat's, so it can stack after it played.
      do: actionStep({ name: 'turn', actions: ['stack', 'play'], player: (ctx) => ctx.game.getPlayer(1)! }),
    }),
  };
}
`;

const gameFrame = (page) => page.frameLocator('.dev-host__frame');
const playOffered = (page) => gameFrame(page).locator('.action-btn[data-bs-action="play"]').waitFor({ timeout: 60_000 });
const prompt = (frame) => frame.locator('.selection-prompt').first().innerText().catch(() => '');

/** Open `stack`, answer its plain pick, then give its repeating pick `marks` one by one. */
async function stackMarks(page, marks) {
  const frame = gameFrame(page);
  await frame.locator('.action-btn[data-bs-action="stack"]').click();
  await frame.locator('.selection-input .choice-btn', { hasText: 'slow' }).click();
  for (const mark of marks) {
    await waitUntil(() => prompt(frame), (text) => text.includes('Add a mark'), 10_000);
    await frame.locator('.selection-input .choice-btn', { hasText: mark }).click();
  }
}

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

        await playOffered(page);
        await stackMarks(page, ['ring']);
        // The server has taken `ring` once its chip shows without the step's loading mark.
        await frame.locator('.accumulated-chip', { hasText: 'ring' }).waitFor({ timeout: 10_000 });
        await waitUntil(() => frame.locator('.accumulated-selections .loading-indicator').count(), (n) => n === 0, 10_000);
        await page.reload();
        await playOffered(page);
        await stackMarks(page, ['star', 'done']);

        const stacked = frame.locator('[data-testid="bs-log-line"]', { hasText: 'Stacked' });
        const texts = await waitUntil(() => stacked.allInnerTexts(), (found) => found.length > 0, 10_000);
        await check('after a reload part way through a repeating pick, the action keeps only the marks the new page gave (#1556 F1)', async () => {
          assert(texts.length === 1 && texts[0].includes('Stacked slow star done'), `the log holds ${JSON.stringify(texts)}`);
        });
      });
    } finally {
      await browser.close();
    }
    return summarise('on a pick-by-pick action restarted after a reload');
  },
);
