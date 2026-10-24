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
 * it. On a fresh touch page at 390px with no mouse: a tap opens, a second tap
 * closes. With the keyboard: Enter opens, Escape closes.
 *
 * The play action's help is taller than the window, so it fits neither above
 * nor below its "?". It must not be clamped down over the "?" (the pointer
 * would leave the "?", close it, land on the "?" again and reopen it, #1454):
 * it sits clear of the "?", scrolls inside, and the mouse can move into it and
 * scroll it without closing it, and the keyboard can scroll it from the "?".
 *
 * A disabled card's reason is a pointer-transparent tooltip nothing can scroll,
 * so one taller than the room on either side of the card shows whole, inside
 * the window, over the card, at 390x500 (#1459). The reason is sized to fall
 * between the room above the card and the window's height.
 *
 * Once an action is open its button, and the "?" pinned to the button's
 * corner, are gone (a step's only action opens on its own, as Go Fish's ask
 * does). Its "?" then sits in the row after its prompt and before its cancel,
 * over neither, and shows its help (#1455).
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/action-help-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */
import { assert, check, onFreshPage, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const HELP = 'Take the top card of the deck into your hand.';
const TALL_HELP = 'Score a card from your hand, adding its points to your total. '.repeat(40).trim();
const TALL_REASON = `${'This card is bound to the moor and cannot leave your hand while the wind howls. '.repeat(7)}Wait for the calm, then try another card.`;

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
    .chooseFrom('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => [...ctx.player.hand.all(Card)],
      disabled: (card, ctx) => (card === ctx.player.hand.first(Card) ? ${JSON.stringify(TALL_REASON)} : false),
    })
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
const TALL_TRIGGER = 'button[aria-label="Help for Play a card from your hand"]';

/** The help this "?" opens, by its aria-controls: another "?" for the same action may still be fading its own out (#1460). */
const tipOf = async (frame, trigger) => frame.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);

const gameFrame = (page) => page.frameLocator('.dev-host__frame');
const triggerDrawn = (page) => gameFrame(page).locator(TRIGGER).waitFor({ timeout: 60_000 });

/** Whether the help shows, read once the trigger and the tip (which fades out) have settled on `expected`. */
async function helpShows(frame, expected) {
  const tip = await tipOf(frame, frame.locator(TRIGGER));
  const read = async () => ({
    expanded: await frame.locator(TRIGGER).getAttribute('aria-expanded'),
    visible: await tip.isVisible(),
  });
  const seen = await waitUntil(read, (now) => now.expanded === String(expected) && now.visible === expected, 2_000);
  return { ...seen, text: seen.visible ? (await tip.innerText()).trim() : '' };
}

/** Opens the play action and checks its "?" beside the prompt, then cancels it (#1455). */
async function checkOpenActionHelp(frame, width) {
  await frame.locator('.action-btn[data-bs-action="play"]').click();
  const trigger = frame.locator(`.config-header ${TALL_TRIGGER}`);
  await trigger.waitFor({ timeout: 10_000 });
  const [title, help, cancel] = await Promise.all(
    [frame.locator('.config-title'), trigger, frame.locator('.cancel-btn')].map((el) => el.boundingBox()),
  );
  await check(`at ${width}px, an open action's "?" sits between its prompt and its cancel (#1455)`, async () => {
    assert(help.x >= title.x + title.width, `the "?" covers the prompt: "?" ${JSON.stringify(help)}, prompt ${JSON.stringify(title)}`);
    assert(help.x + help.width <= cancel.x, `the "?" is not before the cancel: "?" ${JSON.stringify(help)}, cancel ${JSON.stringify(cancel)}`);
    const middle = help.y + help.height / 2;
    assert(middle > title.y && middle < title.y + title.height, `the "?" is off the prompt's line: "?" ${JSON.stringify(help)}, prompt ${JSON.stringify(title)}`);
  });
  await trigger.click();
  const tip = await tipOf(frame, trigger);
  const shown = await waitUntil(() => tip.isVisible(), (now) => now, 2_000);
  await check(`at ${width}px, clicking an open action's "?" shows its help (#1455)`, async () => {
    assert(shown, 'the help did not show');
  });
  await trigger.press('Escape');
  await frame.locator('.cancel-btn').click();
}

/** A disabled card's reason, taller than the room on either side of the card, shows whole inside the window (#1459). */
async function checkTallDisabledReason(page) {
  const frame = gameFrame(page);
  await frame.locator('.action-btn[data-bs-action="play"]').click();
  const card = frame.locator('[data-bs-disabled-reason]').first();
  await card.waitFor({ timeout: 10_000 });
  const cardBox = await card.boundingBox();
  // A plain move, not hover(): hover() retries while the reason covers the card, which it may now do.
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  const tip = frame.locator('#bs-disabled-reason-tip');
  const shown = await waitUntil(() => tip.isVisible(), (now) => now, 2_000);
  const frameBox = await page.locator('.dev-host__frame').boundingBox();
  const tipBox = shown ? await tip.boundingBox() : null;
  const text = tip.locator('.bs-disabled-tip__text');
  await check('a disabled reason taller than the room on either side of its control shows whole, inside the window (#1459)', async () => {
    assert(tipBox, 'hovering the disabled card did not show its reason');
    const roomAbove = cardBox.y - frameBox.y;
    const roomBelow = frameBox.y + frameBox.height - (cardBox.y + cardBox.height);
    const hidden = await text.evaluate((el) => el.scrollHeight - el.clientHeight);
    assert(hidden <= 0, `${hidden}px of the reason is cut off, and nothing can scroll it`);
    assert(tipBox.height > Math.max(roomAbove, roomBelow), `the reason fits beside the card, so this checks nothing: reason ${JSON.stringify(tipBox)}, card ${JSON.stringify(cardBox)}`);
    assert(tipBox.y >= frameBox.y && tipBox.y + tipBox.height <= frameBox.y + frameBox.height, `the reason runs off the window: reason ${JSON.stringify(tipBox)}, window ${JSON.stringify(frameBox)}`);
    assert((await text.innerText()).trim() === TALL_REASON, 'the reason shown is not the whole reason');
    assert((await tip.locator('.bs-disabled-tip__caret').count()) === 0, 'a caret shows on a reason over its card, pointing at nothing');
  });
  await check("a screen reader gets the whole reason from the control's aria-describedby (#1459)", async () => {
    const described = await card.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent);
    assert(described === TALL_REASON, `aria-describedby holds ${JSON.stringify(described)}`);
  });
}

await runBrowserRegression(
  { script: 'action-help-browser.mjs', table: { files: { 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } } },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      let player;
      await onFreshPage(browser, hostUrl, { viewport: { width: 1440, height: 900 } }, triggerDrawn, async (page) => {
        // The touch page reclaims this seat with the same client id; a new one would be a second, unseated player.
        player = await page.context().storageState();
        const frame = gameFrame(page);
        await frame.locator(TRIGGER).hover();
        const hovered = await helpShows(frame, true);
        await check('with a mouse, hovering the "?" opens the help', async () => {
          assert(hovered.visible && hovered.text === HELP, `the help did not show on hover: ${JSON.stringify(hovered)}`);
        });
        await frame.locator(TRIGGER).click();
        const clicked = await helpShows(frame, true);
        await check('with a mouse, clicking the "?" after hovering it leaves the help open', async () => {
          assert(clicked.visible && clicked.expanded === 'true', `the click closed the help: ${JSON.stringify(clicked)}`);
        });
        await frame.locator(TRIGGER).click();
        const again = await helpShows(frame, false);
        await check('with a mouse, a second click on the "?" closes the help', async () => {
          assert(!again.visible && again.expanded === 'false', `the help stayed open: ${JSON.stringify(again)}`);
        });
        await frame.locator(TRIGGER).focus();
        await frame.locator(TRIGGER).press('Enter');
        const keyed = await helpShows(frame, true);
        await check('with the keyboard, Enter on the "?" opens the help', async () => {
          assert(keyed.visible && keyed.text === HELP, `Enter did not open the help: ${JSON.stringify(keyed)}`);
        });
        await frame.locator(TRIGGER).press('Escape');
        const escaped = await helpShows(frame, false);
        await check('with the keyboard, Escape closes the help', async () => {
          assert(!escaped.visible, `Escape left the help open: ${JSON.stringify(escaped)}`);
        });

        const tall = frame.locator(TALL_TRIGGER);
        const tallTip = await tipOf(frame, tall);
        const scroller = tallTip.locator('.ahp-scroll');
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
        await checkOpenActionHelp(frame, 1440);
      });
      // A fresh touch page with no mouse, so a pointer resting over the "?" cannot open the help the taps check.
      await onFreshPage(browser, hostUrl, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: player }, triggerDrawn, async (page) => {
        const frame = gameFrame(page);
        await frame.locator(TRIGGER).tap();
        const tapped = await helpShows(frame, true);
        await check('on a touch screen, a tap on the "?" shows the help', async () => {
          assert(tapped.visible && tapped.text === HELP, `the tap did not leave the help showing: ${JSON.stringify(tapped)}`);
        });
        await frame.locator(TRIGGER).tap();
        const tappedAgain = await helpShows(frame, false);
        await check('on a touch screen, a second tap on the "?" closes the help', async () => {
          assert(!tappedAgain.visible && tappedAgain.expanded === 'false', `the help stayed open: ${JSON.stringify(tappedAgain)}`);
        });
        await checkOpenActionHelp(frame, 390);
      });
      await onFreshPage(browser, hostUrl, { viewport: { width: 390, height: 500 }, storageState: player }, triggerDrawn, checkTallDisabledReason);
    } finally {
      await browser.close();
    }
    return summarise('on the action help "?" in the dev host');
  },
);
