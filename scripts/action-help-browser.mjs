#!/usr/bin/env node
/**
 * THE ACTION HELP "?" OPENS BY HOVER, CLICK, TAP AND KEYBOARD, AND A CLICK AFTER A HOVER KEEPS IT OPEN (#1451).
 *
 * The "?" beside an action opened its help on hover and toggled it on click, so
 * with a mouse the click that followed the hover closed it, and on a phone the
 * tap's emulated hover opened it and the tap's click closed it again. Only a
 * real browser sends the events a mouse and a touch screen send, in order.
 *
 * Served from `boardsmith init`'s table sample, with help on both actions and
 * both offered on the first step so the panel shows their buttons. With a
 * mouse at 1440px: hover opens, a click leaves it open, a second click closes
 * it. With touch at 390px: a tap opens, a second tap closes. With the keyboard:
 * Enter opens, Escape closes.
 *
 * The play action's help is taller than the window, so it fits neither above
 * nor below its "?". It must not be clamped down over the "?" (the pointer
 * would leave the "?", close it, land on the "?" again and reopen it, #1454):
 * it sits clear of the "?", scrolls inside, and the mouse can move into it and
 * scroll it without closing it, and the keyboard can scroll it from the "?".
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/action-help-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const HELP = 'Take the top card of the deck into your hand.';
const TALL_HELP = 'Score a card from your hand, adding its points to your total. '.repeat(40).trim();

const ACTIONS = `import { Action, type ActionDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';
import { Card } from './elements.js';

export function createDrawAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('draw')
    .prompt('Draw a card from the deck')
    .help(${JSON.stringify(HELP)})
    .execute((args, ctx) => {
      ctx.game.deck.first(Card)?.putInto(ctx.player.hand);
      return { success: true };
    });
}

export function createPlayAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('play')
    .prompt('Play a card from your hand')
    .help(${JSON.stringify(TALL_HELP)})
    .chooseFrom('card', { prompt: 'Select a card to play', choices: (ctx) => [...ctx.player.hand.all(Card)] })
    .execute(({ card }, ctx) => {
      ctx.player.score += card.points;
      card.remove();
      return { success: true };
    });
}
`;

/** Both actions on one step, so the panel lists their buttons and each "?". */
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

const TRIGGER = 'button[aria-label="Help for Draw a card from the deck"]';
const TIP = '#draw-help-tip';
const TALL_TRIGGER = 'button[aria-label="Help for Play a card from your hand"]';
const TALL_TIP = '#play-help-tip';

/** The game frame, once the draw action's "?" is drawn. */
async function openGame(page, hostUrl) {
  await page.goto(hostUrl);
  await page.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
  const frame = page.frameLocator('.dev-host__frame');
  await frame.locator(TRIGGER).waitFor({ timeout: 60_000 });
  return frame;
}

/** Whether the help shows, read once the trigger and the tip (which fades out) have settled on `expected`. */
async function helpShows(frame, expected) {
  const read = async () => ({
    expanded: await frame.locator(TRIGGER).getAttribute('aria-expanded'),
    visible: await frame.locator(TIP).isVisible(),
  });
  const seen = await waitUntil(read, (now) => now.expanded === String(expected) && now.visible === expected, 2_000);
  return { ...seen, text: seen.visible ? (await frame.locator(TIP).innerText()).trim() : '' };
}

await runBrowserRegression(
  { script: 'action-help-browser.mjs', table: { files: { 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      // One player for the whole run (a second browser would be a second player); touch is on so it can tap too.
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
      const page = await context.newPage();
      const mouse = { frame: await openGame(page, hostUrl) };
      await mouse.frame.locator(TRIGGER).hover();
      const hovered = await helpShows(mouse.frame, true);
      await check('with a mouse, hovering the "?" opens the help', async () => {
        assert(hovered.visible && hovered.text === HELP, `the help did not show on hover: ${JSON.stringify(hovered)}`);
      });
      await mouse.frame.locator(TRIGGER).click();
      const clicked = await helpShows(mouse.frame, true);
      await check('with a mouse, clicking the "?" after hovering it leaves the help open', async () => {
        assert(clicked.visible && clicked.expanded === 'true', `the click closed the help: ${JSON.stringify(clicked)}`);
      });
      await mouse.frame.locator(TRIGGER).click();
      const again = await helpShows(mouse.frame, false);
      await check('with a mouse, a second click on the "?" closes the help', async () => {
        assert(!again.visible && again.expanded === 'false', `the help stayed open: ${JSON.stringify(again)}`);
      });
      await mouse.frame.locator(TRIGGER).focus();
      await mouse.frame.locator(TRIGGER).press('Enter');
      const keyed = await helpShows(mouse.frame, true);
      await check('with the keyboard, Enter on the "?" opens the help', async () => {
        assert(keyed.visible && keyed.text === HELP, `Enter did not open the help: ${JSON.stringify(keyed)}`);
      });
      await mouse.frame.locator(TRIGGER).press('Escape');
      const escaped = await helpShows(mouse.frame, false);
      await check('with the keyboard, Escape closes the help', async () => {
        assert(!escaped.visible, `Escape left the help open: ${JSON.stringify(escaped)}`);
      });

      const tall = mouse.frame.locator(TALL_TRIGGER);
      const tallTip = mouse.frame.locator(TALL_TIP);
      const scroller = mouse.frame.locator(`${TALL_TIP} .ahp-scroll`);
      const tallShows = (expected) => waitUntil(() => tallTip.isVisible(), (now) => now === expected, 2_000);
      const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
      // A plain move, not hover(): hover() retries while the help covers the "?", which is the bug under test.
      const triggerBox = await tall.boundingBox();
      await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
      const tallOpen = await tallShows(true);
      const tipBox = tallOpen ? await tallTip.boundingBox() : null;
      await check('help taller than the window opens clear of its "?", inside the window, and scrolls inside (#1454)', async () => {
        assert(tipBox, 'hovering the "?" did not leave the tall help open');
        const clear = tipBox.y + tipBox.height <= triggerBox.y || tipBox.y >= triggerBox.y + triggerBox.height;
        assert(clear, `the help covers its "?": help ${JSON.stringify(tipBox)}, "?" ${JSON.stringify(triggerBox)}`);
        assert(tipBox.y >= 0 && tipBox.y + tipBox.height <= 900, `the help runs off the window: ${JSON.stringify(tipBox)}`);
        const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
        assert(overflow > 0, 'the help is not scrollable, so the end of the text is out of reach');
      });
      if (tipBox) {
        await page.mouse.move(tipBox.x + tipBox.width / 2, tipBox.y + tipBox.height / 2, { steps: 10 });
        await page.mouse.wheel(0, 200);
        const scrolled = await waitUntil(scrollTop, (top) => top > 0, 2_000);
        const stillOpen = await tallShows(true);
        await check('with a mouse, the tall help stays open while the pointer moves into it and scrolls it (#1454)', async () => {
          assert(stillOpen, 'the help closed when the pointer moved from the "?" into it');
          assert(scrolled > 0, `the wheel did not scroll the help (scrollTop ${scrolled})`);
        });
        await page.mouse.move(2, 2, { steps: 5 });
        const left = await tallShows(false);
        await check('with a mouse, leaving the tall help closes it (#1454)', async () => {
          assert(left === false, 'the help stayed open after the pointer left it');
        });
      }
      await tall.focus();
      await tall.press('Enter');
      await tallShows(true);
      await tall.press('PageDown');
      const keyScrolled = await waitUntil(scrollTop, (top) => top > 0, 2_000);
      await check('with the keyboard, Page Down on the "?" scrolls the tall help (#1454)', async () => {
        assert(keyScrolled > 0, `Page Down did not scroll the help (scrollTop ${keyScrolled})`);
      });
      await tall.press('Escape');

      await page.setViewportSize({ width: 390, height: 844 });
      const touch = { frame: await openGame(page, hostUrl) };
      await touch.frame.locator(TRIGGER).tap();
      const tapped = await helpShows(touch.frame, true);
      await check('on a touch screen, a tap on the "?" shows the help', async () => {
        assert(tapped.visible && tapped.text === HELP, `the tap did not leave the help showing: ${JSON.stringify(tapped)}`);
      });
      await touch.frame.locator(TRIGGER).tap();
      const tappedAgain = await helpShows(touch.frame, false);
      await check('on a touch screen, a second tap on the "?" closes the help', async () => {
        assert(!tappedAgain.visible && tappedAgain.expanded === 'false', `the help stayed open: ${JSON.stringify(tappedAgain)}`);
      });
      await context.close();
    } finally {
      await browser.close();
    }
    return summarise('on the action help "?" in the dev host');
  },
);
