#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A MULTILINE TEXT SELECTION (#229).
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
 * ## Why this is not in `npx vitest run`
 *
 * It needs Chromium, and BoardSmith depends on no browser -- the suite stays
 * hermetic and this is run deliberately. It never skips: with no Playwright
 * reachable it says how to give it one and exits non-zero, because a browser
 * regression that quietly passes when it did not run is the thing it replaces.
 *
 *   node scripts/multiline-text-browser.mjs
 *   BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
 *     node scripts/multiline-text-browser.mjs
 */

import {
  assert,
  check,
  runBrowserRegression,
  summarise,
  surfaceOf,
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
  .prompt('Set your creed')
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

/** The single-line field, unchanged, so a regression to it is visible here. */
const setNickname = worldAction<Colony>('setNickname')
  .prompt('Pick a nickname')
  .needs(() => [COLONY])
  .enterText('nickname', { prompt: 'Colony nickname', maxLength: 20 })
  .execute(({ nickname }, ctx) => {
    ctx.game.board().nickname = nickname;
    ctx.world.emit(COLONY, { renamed: true }, 'The colony was renamed.');
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
    actions: [setDescription, setCreed, setNickname],
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

type Node = { attributes?: Record<string, unknown>; children?: Node[] };

/** The first node in the projected view that carries the field, or null. */
const findAttr = (node: Node | undefined, key: string): unknown => {
  if (!node) return undefined;
  const own = node.attributes?.[key];
  if (own !== undefined) return own;
  for (const child of node.children ?? []) {
    const found = findAttr(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

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
      ]);
  },
});
`;

/** Wait for the panel to be offering the world's verbs to a seated player. */
async function seated(page) {
  await surfaceOf(page)
    .locator('[data-bs-action="setDescription"]')
    .waitFor({ timeout: 30_000 });
}

async function startAction(page, name) {
  const surface = surfaceOf(page);
  await surface.locator(`[data-bs-action="${name}"]`).click();
  await surface.locator('.text-input').waitFor({ timeout: 15_000 });
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

async function driveThrough({ chromium, hostUrl }) {
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(hostUrl);
    await seated(page);
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

    await check('collapsing the bar mid-draft, then re-opening it', async () => {
      // NEW SINCE THIS WAS FIRST MEASURED (#230). A collapsed bar renders one
      // row -- token and summary -- and the whole panel branch is `v-else-if`,
      // so the editor is UNMOUNTED rather than hidden, and `--bsg-panel-max`
      // is overridden to a single row's height while it is down.
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
      assert(
        (await surface.locator('[data-testid="bs-actionbar-summary"]').count()) === 1,
        'a collapsed bar drew no summary row',
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
      // The collapsed bar is still a `v-if` branch and the panel still the
      // `v-else-if`, so the editor is still UNMOUNTED -- what changed is that
      // the value is no longer inside it. It lives in `useActionController`
      // beside `multiSelectDraft`, which outlives the panel, so the round trip
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
  } finally {
    await browser.close();
  }

  return summarise('through the real dev host in a real browser.');
}

