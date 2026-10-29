#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR THE PANEL'S TYPED EDITORS (#229, #237).
 *
 * Both of them, in one script and by the same assertions. It began as the
 * multiline text check and grew the number editor when #237 found that editor
 * still carrying two defects this file had already proved fixed on the other
 * one -- a hint bound to nothing and a submit that refused in silence. Checking
 * them apart is how they diverged; checking them together is what makes the
 * next divergence loud.
 *
 * The complaint in the ticket is a MEASUREMENT: a 1,000 character empire
 * description drawn in a 120px single-line input cannot be written or reviewed.
 * A component test cannot see that. jsdom applies no stylesheet and lays nothing
 * out, so a textarea that renders correctly and comes out one line tall, or
 * shrink-wrapped to the width of its own caret, passes every assertion in
 * `ActionPanel.multiline-text.test.ts` while being exactly as unusable as the
 * input it replaced. That is the failure this script exists to catch, and the
 * only way to catch it is a real browser doing real layout.
 *
 * It also holds the two behaviours that are only true of a real keyboard: that
 * pressing Enter in the box inserts a newline instead of submitting the action,
 * and that the line breaks the player typed survive the whole way into the
 * world's own state.
 *
 * Built on `scripts/browser-harness.mjs`, the plumbing every browser regression
 * in this repo shares: real Chromium, the real `boardsmith dev` world chrome,
 * the real `world.html` in the real iframe, a real WebSocket to a real host.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/multiline-text-browser.mjs`; a missing Chromium says to run
 * `boardsmith install-browser`.
 */

import {
  assert,
  barGeometry,
  check,
  onFreshPage,
  runBrowserRegression,
  summarise,
  surfaceOf,
  VIEW_FIELD_READER,
  waitForAction,
  waitUntil,
} from './browser-harness.mjs';

const USABLE_BOX = { minWidth: 300, minHeight: 80 };

const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Noticeboard extends Space<Colony> {
  /** The long field the ticket is about. */
  description = '';
  /** The short one beside it, which must NOT change. */
  nickname = '';
  /** A long field with a floor, so a refusal has a rule to break. */
  creed = '';
  /** The NUMBER editor's field, so both typed editors are reachable here (#237). */
  recycled = 0;
}

export class Colony extends Game<Colony, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Noticeboard]);
  }

  board(): Noticeboard {
    const found = this.first(Noticeboard, 'noticeboard');
    if (!found) throw new Error('This colony has no noticeboard.');
    return found;
  }
}

const COLONY = 'colony';

/** Lacuna's own declaration, which is the one the ticket quotes. */
const setDescription = worldAction<Colony>('setDescription')
  .prompt('Describe your empire')
  .needs(() => [COLONY])
  .enterText('description', {
    prompt: 'Empire description',
    maxLength: 1000,
    multiline: true,
  })
  .execute(({ description }, ctx) => {
    ctx.game.board().description = description;
    ctx.world.emit(COLONY, { described: true }, 'The description was rewritten.');
  });

/** A field with a FLOOR, so the refusal and the floor hint are both reachable. */
const setCreed = worldAction<Colony>('setCreed')
  .prompt('Creed')
  .needs(() => [COLONY])
  .enterText('creed', {
    prompt: 'Your creed',
    minLength: 20,
    maxLength: 200,
    multiline: true,
  })
  .execute(({ creed }, ctx) => {
    ctx.game.board().creed = creed;
    ctx.world.emit(COLONY, { creed: true }, 'The creed was set.');
  });

/**
 * The single-line field, so a regression to it is visible here. Its refusal
 * wraps over several lines on a phone, so the bar must grow to show it (#1481).
 */
const setNickname = worldAction<Colony>('setNickname')
  .prompt('Nickname')
  .needs(() => [COLONY])
  .enterText('nickname', {
    prompt: 'Colony nickname',
    maxLength: 20,
    pattern: {
      regex: /^[A-Z][a-z ]*$/,
      message: 'A nickname is one capital letter and then lowercase letters and spaces, so that the old machines can carve it into the colony gate.',
    },
  })
  .execute(({ nickname }, ctx) => {
    ctx.game.board().nickname = nickname;
    ctx.world.emit(COLONY, { renamed: true }, 'The colony was renamed.');
  });

/**
 * THE NUMBER EDITOR, with both bounds and an integer rule (#237).
 *
 * The other typed editor the panel draws. It is here because its hint and its
 * refusal were the text editor's fixed defects still standing, and a check that
 * runs beside the text one is what makes the next divergence loud.
 */
// One-word action prompts, so the five actions and the controls menu (#1443) fit the two-row strip at 375px.
const recycle = worldAction<Colony>('recycle')
  .prompt('Recycle')
  .needs(() => [COLONY])
  .enterNumber('waste', { prompt: 'Waste to recycle', min: 3, max: 9, integer: true })
  .execute(({ waste }, ctx) => {
    ctx.game.board().recycled = waste;
    ctx.world.emit(COLONY, { recycled: true }, 'The waste was recycled.');
  });

/**
 * Typed fields after earlier choices, under prompts that wrap on a phone: the
 * chips, the wrapped label, the hint and field + Done (and Skip) are more than
 * any fixed number of rows past the strip (#1481).
 */
const nameShip = worldAction<Colony>('nameShip')
  .prompt('Name')
  .needs(() => [COLONY])
  .chooseFrom('hull', { prompt: 'Which hull?', choices: ['Scout', 'Freighter'] })
  .enterText('shipName', {
    prompt: 'Name the ship that carries the colonists out to the new world',
    maxLength: 24,
  })
  .enterNumber('crew', {
    prompt: 'How many colonists sleep aboard for the long crossing',
    min: 1,
    max: 600,
    integer: true,
    optional: 'Leave the berths empty',
  })
  .execute(({ shipName }, ctx) => {
    ctx.world.emit(COLONY, { named: shipName }, 'The ship was named.');
  });

export const gameDefinition: GameDefinition = {
  gameClass: Colony,
  gameType: 'multiline-colony',
  displayName: 'Multiline Colony',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const colony = game as Colony;
      const board = colony.create(Noticeboard, 'noticeboard');
      return { [COLONY]: board as GameElement };
    },
    view: () => [COLONY],
    actions: [setDescription, setCreed, setNickname, recycle, nameShip],
  },
};
`;

/**
 * The custom board: it does nothing but READ BACK what the world stored.
 *
 * The point of the last check is that the newlines a player typed are still
 * there after the round trip, and the only honest place to read that is the
 * state the world kept -- not the field the player typed into.
 */
const BOARD = `import { computed, defineComponent, h } from 'vue';

${VIEW_FIELD_READER}

export default defineComponent({
  name: 'ColonyBoard',
  props: {
    gameView: { type: Object, default: undefined },
  },
  setup(props) {
    const read = (key: string) =>
      String(findAttr(props.gameView as Node | undefined, key) ?? '');
    const description = computed(() => read('description'));
    const nickname = computed(() => read('nickname'));
    return () =>
      h('div', { class: 'colony-board' }, [
        h('pre', { 'data-fixture': 'stored-description' }, description.value),
        h('span', { 'data-fixture': 'stored-nickname' }, nickname.value),
        h('span', { 'data-fixture': 'stored-recycled' }, read('recycled')),
      ]);
  },
});
`;

async function startAction(page, name, editor = '.text-input') {
  const surface = surfaceOf(page);
  await surface.locator(`[data-bs-action="${name}"]`).click();
  await surface.locator(editor).waitFor({ timeout: 15_000 });
}

// THE WHOLE RUN, IN THE HARNESS'S ORDER (#231). It checks the checkout is
// installed, finds a Chromium or refuses, serves the fixture world, stops the
// host before removing its project, and exits on what `driveThrough` reports --
// so a temp world left behind by a crashed run is litter this cannot leave.
await runBrowserRegression(
  {
    script: 'multiline-text-browser.mjs',
    fixture: {
      slug: 'multiline-colony',
      displayName: 'Multiline Colony',
      gameClass: 'Colony',
      rules: RULES,
      boardFile: 'ColonyBoard',
      board: BOARD,
    },
  },
  driveThrough,
);

async function driveThrough({ launch, hostUrl }) {
  const browser = await launch();

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(hostUrl);
    await waitForAction(page, 'setDescription');
    await startAction(page, 'setDescription');

    const surface = surfaceOf(page);
    const area = surface.locator('.text-input textarea');

    await check('the panel draws a textarea for a multiline text pick', async () => {
      await area.waitFor({ timeout: 15_000 });
      assert((await area.count()) === 1, `found ${await area.count()} boxes`);
      assert(
        (await surface.locator('.text-input input[type="text"]').count()) === 0,
        'a single-line input is still there beside the box',
      );
    });

    await check('the box is big enough to write and read a description in', async () => {
      // THE MEASUREMENT THE TICKET IS ABOUT, taken in a browser that has done
      // real layout. Everything else about this feature is provable in jsdom;
      // this is not, and this is the part that was broken.
      const box = await area.boundingBox();
      assert(box !== null, 'the box has no layout box at all');
      assert(
        box.width >= USABLE_BOX.minWidth,
        `the box laid out ${Math.round(box.width)}px wide, under the ${USABLE_BOX.minWidth}px `
          + 'a description needs -- a shrink-wrapped textarea is the reported field again',
      );
      assert(
        box.height >= USABLE_BOX.minHeight,
        `the box laid out ${Math.round(box.height)}px tall, under the ${USABLE_BOX.minHeight}px `
          + 'six rows come to -- a one-line textarea is the reported field again',
      );
    });

    await check('the player can drag it taller', async () => {
      const resize = await area.evaluate((el) => getComputedStyle(el).resize);
      assert(resize === 'vertical', `the box computed \`resize: ${resize}\``);
    });

    await check('the box does not push the action bar off the screen', async () => {
      // The bar is absolutely positioned over the bottom of the board and caps
      // its own height. A box that overflowed it would put the submit button
      // somewhere the player cannot reach.
      const bar = await surface.locator('[data-testid="bs-actionbar"]').boundingBox();
      const submit = await surface.locator('.text-input .done-button').boundingBox();
      assert(bar !== null && submit !== null, 'the bar or its submit button has no layout box');
      assert(
        submit.y + submit.height <= bar.y + bar.height + 1,
        'the submit button laid out below the bottom of the action bar',
      );
    });

    await check('the count states the maximum, and no hint repeats it', async () => {
      // The reported bug was `(?-1000 chars)`. A box answers it with the count
      // instead, which carries the ceiling AND where the player stands in it.
      const count = surface.locator('.text-input .char-count');
      const read = (await count.textContent())?.trim();
      assert(read === '0 of 1000 characters', `the count read ${JSON.stringify(read)}`);
      assert(
        (await surface.locator('.text-input .input-hint').count()) === 0,
        'a hint is repeating the maximum the count already states',
      );
    });

    await check('the count stays on screen inside a bar that scrolls past its cap', async () => {
      // THE DEFECT A SCREENSHOT FOUND AND NO COMPONENT TEST COULD. The bar caps
      // its own height; with the count below the submit button the whole editor
      // came to one row more than the cap and the count -- the line the player
      // needs while typing -- was the part scrolled out of sight.
      const bar = await surface.locator('[data-testid="bs-actionbar"]').boundingBox();
      const count = await surface.locator('.text-input .char-count').boundingBox();
      assert(bar !== null && count !== null, 'the bar or the count has no layout box');
      assert(
        count.y + count.height <= bar.y + bar.height + 1,
        'the character count laid out below the bottom of the action bar',
      );
    });

    await check('the count is bound to the field and follows what is typed', async () => {
      await area.click();
      await page.keyboard.type('Ancient and long-lived.');
      const count = surface.locator('.text-input .char-count');
      const read = (await count.textContent())?.trim();
      assert(read === '23 of 1000 characters', `the count read ${JSON.stringify(read)}`);
      const describedBy = (await area.getAttribute('aria-describedby'))?.split(/\s+/) ?? [];
      const countId = await count.getAttribute('id');
      assert(describedBy.includes(countId), 'the count is not among the field descriptions');
    });

    await check('Enter inserts a newline instead of submitting the action', async () => {
      // The one behaviour a keyboard decides. If Enter submitted, the action
      // would be gone from the bar by now and the box with it.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Founded in the second age.');
      const written = await area.inputValue();
      assert(
        written === 'Ancient and long-lived.\n\nFounded in the second age.',
        `the box holds ${JSON.stringify(written)}`,
      );
      assert(await area.isVisible(), 'Enter submitted the action and took the box away');
    });

    await check('the submit button sends it, line breaks and all', async () => {
      await surface.locator('.text-input .done-button').click();
      const stored = surface.locator('[data-fixture="stored-description"]');
      await stored.waitFor({ timeout: 20_000 });
      const read = await waitUntil(
        async () => (await stored.textContent()) ?? '',
        (seen) => seen.includes('second age'),
      );
      assert(
        read === 'Ancient and long-lived.\n\nFounded in the second age.',
        `the world stored ${JSON.stringify(read)}`,
      );
    });

    await check('a value the rules refuse says why, on screen, tied to the field', async () => {
      // The submit handler used to RETURN on a short value: the button moved,
      // nothing happened, and there was nothing to read. This is the sentence
      // the server would answer with, shown before anything is sent.
      await startAction(page, 'setCreed');
      const creed = surface.locator('.text-input textarea');
      const hint = (await surface.locator('.text-input .input-hint').textContent())?.trim();
      assert(hint === '(at least 20 characters)', `the floor hint read ${JSON.stringify(hint)}`);
      await creed.click();
      await page.keyboard.type('Too short.');
      await surface.locator('.text-input .done-button').click();
      const error = surface.locator('.text-input .selection-error');
      await error.waitFor({ timeout: 10_000 });
      const said = (await error.textContent())?.trim();
      assert(
        said === 'creed must be at least 20 characters',
        `the panel said ${JSON.stringify(said)}`,
      );
      assert((await error.getAttribute('role')) === 'alert', 'the message is not an alert');
      assert(
        (await creed.getAttribute('aria-invalid')) === 'true',
        'the field is not marked invalid while the message stands',
      );
      const describedBy = (await creed.getAttribute('aria-describedby'))?.split(/\s+/) ?? [];
      assert(
        describedBy.includes(await error.getAttribute('id')),
        'the message is not among the field descriptions',
      );
      assert(await creed.isVisible(), 'the refusal took the editor away');
      // And it goes as soon as they start fixing it. Clicking back into the
      // field first because the submit button took the focus.
      await creed.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' It goes on rather longer than that.');
      assert(
        (await surface.locator('.text-input .selection-error').count()) === 0,
        'the message survived the player changing the field',
      );
      await surface.locator('.action-config .cancel-btn').click();
    });

    await check('the NUMBER editor states its rule and reports a refusal too (#237)', async () => {
      // THE PARITY CHECK. Everything above this line is the text editor, and
      // for two tickets the number editor beside it had neither of the two
      // things #229 gave that one: a hint the field actually points at, and a
      // submit that says why it refused instead of moving and doing nothing.
      // It runs here rather than in its own script because the point is that
      // the two editors are checked in one place, by the same assertions.
      await startAction(page, 'recycle', '.number-input');
      const field = surface.locator('.number-input input[type="number"]');
      const hintEl = surface.locator('.number-input .input-hint');
      const hint = (await hintEl.textContent())?.trim();
      assert(hint === '(3 to 9, whole numbers)', `the range hint read ${JSON.stringify(hint)}`);
      const described = (await field.getAttribute('aria-describedby'))?.split(/\s+/) ?? [];
      assert(
        described.includes(await hintEl.getAttribute('id')),
        'the range hint is not among the field descriptions, so a screen reader never reads it',
      );

      await field.fill('1');
      await surface.locator('.number-input .done-button').click();
      const error = surface.locator('.number-input .selection-error');
      await error.waitFor({ timeout: 10_000 });
      const said = (await error.textContent())?.trim();
      assert(said === 'waste must be at least 3', `the panel said ${JSON.stringify(said)}`);
      assert((await error.getAttribute('role')) === 'alert', 'the message is not an alert');
      assert(
        (await field.getAttribute('aria-invalid')) === 'true',
        'the field is not marked invalid while the message stands',
      );
      assert(
        ((await field.getAttribute('aria-describedby'))?.split(/\s+/) ?? [])
          .includes(await error.getAttribute('id')),
        'the message is not among the field descriptions',
      );
      assert(await field.isVisible(), 'the refusal took the editor away');
      assert(
        (await field.inputValue()) === '1',
        'the refused number was thrown away, so there is nothing left to correct',
      );

      // And it goes as soon as the player starts fixing it, then the corrected
      // value goes all the way into the world's own state.
      await field.fill('5');
      assert(
        (await surface.locator('.number-input .selection-error').count()) === 0,
        'the message survived the player changing the field',
      );
      await surface.locator('.number-input .done-button').click();
      const stored = surface.locator('[data-fixture="stored-recycled"]');
      const read = await waitUntil(
        async () => (await stored.textContent()) ?? '',
        (seen) => seen === '5',
      );
      assert(read === '5', `the world stored ${JSON.stringify(read)} as the recycled waste`);
    });

    await check('collapsing the bar mid-draft, then re-opening it', async () => {
      // NEW SINCE THIS WAS FIRST MEASURED (#230). A collapsed bar is a thin
      // line (#1439) and the panel branch is not rendered, so the editor is
      // UNMOUNTED rather than hidden.
      //
      // What is asserted is what a player can still do: the action survives
      // the round trip and the box comes back, at a usable size, inside the
      // bar's restored cap -- and with the prose still in it, which is #235's
      // fix and the assertion at the bottom of this check.
      await startAction(page, 'setDescription');
      const box = surface.locator('.text-input textarea');
      await box.click();
      const typed = 'A draft nobody meant to throw away.';
      await page.keyboard.type(typed);

      const toggle = surface.locator('[data-testid="bs-actionbar-toggle"]');
      await toggle.click();
      await waitUntil(
        () => surface.locator('.text-input textarea').count(),
        (count) => count === 0,
        5_000,
      );

      await toggle.click();
      const restored = surface.locator('.text-input textarea');
      await restored.waitFor({ timeout: 10_000 });
      const laid = await restored.boundingBox();
      assert(laid !== null, 'the restored box has no layout box');
      assert(
        laid.width >= USABLE_BOX.minWidth && laid.height >= USABLE_BOX.minHeight,
        `the restored box laid out ${Math.round(laid.width)}x${Math.round(laid.height)}`,
      );
      const bar = await surface.locator('[data-testid="bs-actionbar"]').boundingBox();
      const done = await surface.locator('.text-input .done-button').boundingBox();
      assert(
        done.y + done.height <= bar.y + bar.height + 1,
        'after restoring, the submit button laid out below the bottom of the bar',
      );
      // THE DRAFT SURVIVES, and this is the inversion #235 was filed to make.
      // The panel is still not rendered while the bar is down, so the editor
      // is still UNMOUNTED -- what changed is that the value is no longer
      // inside it. It lives in `useActionController` beside `multiSelectDraft`, which outlives the panel, so the round trip
      // has nothing to throw away.
      assert(
        (await restored.inputValue()) === typed,
        `the draft came back as ${JSON.stringify(await restored.inputValue())} `
          + `rather than ${JSON.stringify(typed)}`,
      );
      await surface.locator('.action-config .cancel-btn').click();
    });

    await check('a short field is still one line, and still works', async () => {
      // The flag is opt-in, and the regression to check for is the box arriving
      // everywhere. This one shares every line of the editor except the control.
      await startAction(page, 'setNickname');
      assert(
        (await surface.locator('.text-input textarea').count()) === 0,
        'a field that never asked for a box got one',
      );
      const input = surface.locator('.text-input input[type="text"]');
      const hint = (await surface.locator('.text-input .input-hint').textContent())?.trim();
      assert(hint === '(up to 20 characters)', `the short field's hint read ${JSON.stringify(hint)}`);
      await input.click();
      await page.keyboard.type('Hollow');
      // Enter still submits a single-line field, which is what a single-line
      // field is for.
      await page.keyboard.press('Enter');
      const stored = surface.locator('[data-fixture="stored-nickname"]');
      const read = await waitUntil(
        async () => (await stored.textContent()) ?? '',
        (seen) => seen === 'Hollow',
      );
      assert(read === 'Hollow', `the world stored ${JSON.stringify(read)} as the nickname`);
    });

    await context.close();

    for (const viewport of screens()) await onASmallerScreen(browser, hostUrl, viewport);
  } finally {
    await browser.close();
  }

  return summarise('through the real dev host in a real browser.');
}

/**
 * THE PANEL AND THE BOX ON EVERY KIND OF SCREEN (issue 444).
 *
 * The bar floats over the board and is capped at two rows (`--bsg-panel-max`,
 * "the strip"); the one exception is a typed editor, which may grow the bar
 * while it is open. The checks above run at one desktop size. These hold the cap and the
 * exception where they are tightest: a phone, where the bar's width is the
 * scarce axis, and a short landscape screen, which caps the bar at one row and has
 * little height to grow into.
 */
function screens() {
  // A function, not a constant: the run starts at a top-level await above this
  // line, before a `const` here would be initialised.
  return [
    // fieldRows: rows a one-line or number editor may grow the bar past the strip (#1058).
    { width: 375, height: 812, fieldRows: 1 },
    { width: 390, height: 844, fieldRows: 1 },
    { width: 844, height: 390 },
    { width: 1280, height: 900 },
    { width: 1440, height: 900 },
  ];
}

/** One control row of the bar plus the gap after it: what a one-line or number field may grow the bar by (#1058, #1300). */
function fieldRow(surface) {
  return surface.locator('[data-testid="bs-actionbar"]').evaluate((el) => {
    const style = getComputedStyle(el);
    return parseFloat(style.getPropertyValue('--bsg-panel-row')) + parseFloat(style.getPropertyValue('--bsg-panel-gap'));
  });
}

/** Run `body` with `editor` open, and close it however `body` ends, so a failed check leaves the next one at rest. */
async function withEditorOpen(page, action, editor, body) {
  const surface = surfaceOf(page);
  await startAction(page, action, editor);
  try {
    return await body();
  } finally {
    await surface.locator('.cancel-btn').click();
    await surface.locator(editor).waitFor({ state: 'detached', timeout: 10_000 });
  }
}

async function onASmallerScreen(browser, hostUrl, viewport) {
  const size = `${viewport.width}x${viewport.height}`;
  await onFreshPage(browser, hostUrl, { viewport }, (page) => waitForAction(page, 'setDescription'), async (page, surface) => {
    await check(`${size}: at rest the bar sits inside its strip, without scrolling`, async () => {
      const bar = await barGeometry(surface);
      assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}`);
      assert(!bar.scrolls, `the bar scrolls at rest (${bar.height}px tall): its actions do not fit the strip`);
    });

    // A one-line or number editor stacks label, hint and field + Done: three
    // rows, one more than the strip holds on a phone, so it grows the bar too (#1058).
    for (const [action, editor] of [['setNickname', '.text-input'], ['recycle', '.number-input']]) {
      await check(`${size}: an open ${editor} shows the action, its label, field and submit without scrolling`, async () => {
        const bar = await withEditorOpen(page, action, editor, async () => {
          await surface.locator(`${editor} input`).focus();
          return barGeometry(surface, [
            '.config-title',
            `${editor} .selection-prompt`,
            `${editor} .input-hint`,
            `${editor} input`,
            `${editor} .done-button`,
          ]);
        });
        const row = await fieldRow(surface);
        assert(!bar.scrolls, `the bar scrolls (${bar.height}px tall): the editor is cut off`);
        const allowed = bar.strip - (viewport.fieldRows ?? 0) * row - 1;
        assert(bar.top >= allowed, `the bar's top is at ${bar.top}, above ${allowed} (the strip at ${bar.strip} less ${viewport.fieldRows ?? 0} row(s))`);
        assert(bar.outside.length === 0, `not in view inside the bar: ${bar.outside.join(', ')}`);
      });
    }

    await check(`${size}: open fields after earlier choices show the chips, wrapped label, hint, field and submit without scrolling`, async () => {
      await surface.locator('[data-bs-action="nameShip"]').click();
      await surface.locator('.action-config .choice-btn', { hasText: 'Freighter' }).click();
      await surface.locator('.text-input').waitFor({ timeout: 15_000 });
      try {
        const bar = await barGeometry(surface, [
          '.selected-value',
          '.text-input .selection-prompt',
          '.text-input .input-hint',
          '.text-input input',
          '.text-input .done-button',
        ]);
        assert(!bar.scrolls, `the bar scrolls (${bar.height}px tall): the editor is cut off`);
        assert(bar.outside.length === 0, `not in view inside the bar: ${bar.outside.join(', ')}`);
        await surface.locator('.text-input input').fill('Long Haul Endeavour');
        await surface.locator('.text-input .done-button').click();
        await surface.locator('.number-input').waitFor({ timeout: 15_000 });
        const next = await barGeometry(surface, [
          '.selected-values',
          '.number-input .selection-prompt',
          '.number-input .input-hint',
          '.number-input input',
          '.number-input .done-button',
          '.number-input .skip-btn',
        ]);
        assert(!next.scrolls, `number: the bar scrolls (${next.height}px tall)`);
        assert(next.outside.length === 0, `number: not in view inside the bar: ${next.outside.join(', ')}`);
      } finally {
        await surface.locator('.cancel-btn').click();
        await surface.locator('.text-input, .number-input').first().waitFor({ state: 'detached', timeout: 10_000 });
      }
    });

    await check(`${size}: the open box keeps the action, its label, count and submit in view`, async () => {
      // The box may grow the bar past the strip; the bar floats over the board,
      // so the board stays exactly where it was fitted.
      const board = surface.locator('.colony-board');
      const before = await board.boundingBox();
      await startAction(page, 'setDescription');
      const during = await board.boundingBox();
      assert(before !== null && during !== null, 'the board has no layout box');
      assert(
        during.x === before.x && during.y === before.y
          && during.width === before.width && during.height === before.height,
        `the board moved when the box opened: ${JSON.stringify(before)} became ${JSON.stringify(during)}`,
      );
      const bar = await barGeometry(surface, [
        '.config-title',
        '.text-input .selection-prompt',
        '.text-input textarea',
        '.text-input .char-count',
        '.text-input .done-button',
      ]);
      assert(bar.top >= 0, `the bar's top is at ${bar.top}, off the top of the screen`);
      assert(bar.outside.length === 0, `not in view inside the bar: ${bar.outside.join(', ')}`);
      const area = await surface.locator('.text-input textarea').boundingBox();
      assert(area !== null && area.height >= 40, `the box is ${Math.round(area?.height ?? 0)}px tall: not two lines`);
    });

    await check(`${size}: closing the box puts the bar back inside the strip`, async () => {
      await surface.locator('.cancel-btn').click();
      await surface.locator('.text-input').waitFor({ state: 'detached', timeout: 10_000 });
      const bar = await barGeometry(surface);
      assert(bar.top >= bar.strip - 1, `the bar's top is at ${bar.top}, above the strip at ${bar.strip}`);
    });

    // A refusal the player cannot see is the silent Done of #229 again: the
    // bar caps its height, and the message used to land below that cap (#1159).
    for (const [action, editor, value] of [
      ['setCreed', '.text-input', 'Too short.'],
      ['recycle', '.number-input', '1'],
      ['setNickname', '.text-input', 'NO'],
    ]) {
      await check(`${size}: a refusal in ${editor} is in view inside the bar when it appears`, async () => {
        // Bringing the message into view must scroll only the bar, never the page or the board.
        const scrolled = async () => [
          await page.evaluate(() => document.scrollingElement.scrollTop),
          ...(await surface.locator('html').evaluate(() =>
            [document.scrollingElement.scrollTop, document.querySelector('.boardregion')?.scrollTop ?? 0])),
        ];
        const { bar, before, after } = await withEditorOpen(page, action, editor, async () => {
          await surface.locator(`${editor} textarea, ${editor} input`).first().fill(value);
          const before = await scrolled();
          await surface.locator(`${editor} .done-button`).click();
          await surface.locator(`${editor} .selection-error`).waitFor({ timeout: 10_000 });
          return { bar: await barGeometry(surface, [`${editor} .selection-error`]), before, after: await scrolled() };
        });
        assert(bar.outside.length === 0, `not in view inside the bar: ${bar.outside.join(', ')}`);
        assert(after.join() === before.join(), `page, frame and board scroll moved from ${before} to ${after}`);
      });
    }
  });
}

