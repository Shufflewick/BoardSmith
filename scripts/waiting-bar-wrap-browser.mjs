#!/usr/bin/env node
/**
 * THE WAITING BAR WRAPS A LONG WORD INSTEAD OF RUNNING PAST ITSELF ON A PHONE (#1811).
 *
 * A seat that is done but waiting on others sees the newest log line in the
 * action bar's waiting message. One word wider than the bar must wrap inside
 * it, as it does in the log (#1803), rather than run past the bar or make it
 * scroll sideways. Only real layout shows that, so it is measured here.
 *
 * Served from `boardsmith init`'s table sample, whose flow is one turn for
 * seat 1 and then a simultaneous step whose action narrates that word. The
 * page's seat acts while the other seat is still deciding, then its waiting
 * bar is measured at 390px, light and dark.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/waiting-bar-wrap-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

/** One word wider than the waiting bar on a phone. */
const LONG_WORD = 'readTheInterestingTidbitsScreenAloudToEveryoneInTheTavernTonightAndTomorrow';

const ACTIONS = `import { Action, type ActionDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

// The sample's game registers these exports by name; this table gathers, then shouts.
// Each asks a question, because a sole action that asks nothing runs itself.
export function createDrawAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('shout')
    .prompt('Shout')
    .chooseFrom('how', { prompt: 'How?', choices: ['loudly', 'softly'] })
    .execute((_args, ctx) => {
      ctx.player.score = 1;
      ctx.game.message('You ${LONG_WORD}.');
      return { success: true };
    });
}

export function createPlayAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('gather')
    .prompt('Gather')
    .chooseFrom('where', { prompt: 'Where?', choices: ['inside', 'outside'] })
    .execute(() => ({ success: true }));
}
`;

/** Seat 1 gathers first, so a second browser can take seat 2 from the bot before the shouting starts. */
const FLOW = `import { actionStep, sequence, simultaneousActionStep, type FlowDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

export function createGameFlow(): FlowDefinition<TableFixtureGame> {
  return {
    root: sequence(
      actionStep({ name: 'gather', actions: ['gather'], player: (ctx) => ctx.game.getPlayer(1)! }),
      simultaneousActionStep({ name: 'shouts', actions: ['shout'], playerDone: (_ctx, player) => player.score > 0 }),
    ),
  };
}
`;

const SCENES = [
  { width: 390, height: 844, colorScheme: 'light' },
  { width: 390, height: 844, colorScheme: 'dark' },
];

/** The waiting bar's box, its content's width, the long word's unwrapped width and how many lines its text takes. */
function measureBar(frame) {
  return frame.locator('.waiting-message').evaluate((bar, word) => {
    const probe = document.createElement('span');
    probe.style.whiteSpace = 'nowrap';
    probe.style.position = 'absolute';
    probe.textContent = word;
    bar.append(probe);
    const wordWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const range = document.createRange();
    range.selectNodeContents(bar);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    const { left, right } = bar.getBoundingClientRect();
    return {
      text: bar.textContent,
      wordWidth,
      lines,
      content: bar.scrollWidth,
      box: bar.clientWidth,
      right,
      left,
      viewport: document.documentElement.clientWidth,
      pageContent: document.documentElement.scrollWidth,
    };
  }, LONG_WORD);
}

await runBrowserRegression(
  {
    script: 'waiting-bar-wrap-browser.mjs',
    engines: ['chromium', 'webkit'],
    table: { files: { 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      // The first browser is seated by the host, so it must be there before the second arrives.
      const page = await (await browser.newContext({ viewport: { width: SCENES[0].width, height: SCENES[0].height } })).newPage();
      await page.goto(hostUrl);
      await page.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
      const frame = page.frameLocator('.dev-host__frame');
      const choice = (f, text) => f.locator('.selection-input .choice-btn', { hasText: text });
      // A sole action opens itself, so each step shows its question straight away.
      await choice(frame, 'inside').waitFor({ timeout: 60_000 });
      // An open seat plays as bot and would shout at once, so a second browser holds seat 2 and never shouts.
      const other = await (await browser.newContext()).newPage();
      await other.goto(hostUrl);
      await other.getByRole('button', { name: 'Take seat 2' }).click({ timeout: 60_000 });
      await other.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
      await choice(frame, 'inside').click();
      await choice(other.frameLocator('.dev-host__frame'), 'loudly').waitFor({ timeout: 60_000 });
      await choice(frame, 'loudly').click({ timeout: 60_000 });
      await waitUntil(() => frame.locator('.waiting-message').textContent().catch(() => ''), (text) => text.includes(LONG_WORD));
      for (const { width, height, colorScheme } of SCENES) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme });
        await check(`the waiting bar wraps a long word inside itself at ${width}px ${colorScheme}`, async () => {
          const bar = await measureBar(frame);
          assert(bar.text.includes(LONG_WORD), `the waiting bar reads ${JSON.stringify(bar.text)}, not the long word`);
          assert(bar.wordWidth > bar.box, `the long word is ${bar.wordWidth}px wide in a ${bar.box}px bar, so it fits without wrapping; lengthen LONG_WORD`);
          assert(bar.lines > 1, `the waiting bar's text takes ${bar.lines} line, so the long word did not wrap`);
          assert(bar.content <= bar.box, `the waiting bar's content is ${bar.content}px wide in a box ${bar.box}px wide`);
          assert(bar.left >= 0 && bar.right <= bar.viewport, `the waiting bar spans ${bar.left}px to ${bar.right}px in a ${bar.viewport}px viewport`);
          assert(bar.pageContent <= bar.viewport, `the game page scrolls sideways: ${bar.pageContent}px of content in a ${bar.viewport}px viewport`);
        });
      }
    } finally {
      await browser.close();
    }
    return summarise('in the waiting bar in a real browser');
  },
);
