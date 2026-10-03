#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A DRAFT'S QUOTE (#248).
 *
 * The reporter's bar, in a real browser: a world action that charges five
 * Essentia a week, an optional quantity, a 2 typed into the standard panel's
 * spinbutton -- and no total anywhere on the bar. Every layer had its own tests
 * and all of them were green, because none of them can see whether the price
 * reaches the screen the player is looking at.
 *
 * So this drives the whole road: Chromium, the real dev chrome, the real
 * `world.html` in the real iframe, a real WebSocket to a real `LocalWorldHost`
 * over a real store. What is asserted is what the reporter could not assert --
 * ten Essentia and a resulting expiry VISIBLE BEFORE the purchase, the price
 * moving with the field, the purchase waiting for a confirmation, and the
 * world's own bytes unchanged until that confirmation is pressed.
 *
 * The frames on the socket are asserted beside the pixels, because "the quote
 * request never left the frame" is how #227 found the identical class of defect
 * on the pick road.
 *
 * It then shrinks the window to a phone (#279). A price is only shown if it can
 * be READ, and a quote line that cannot wrap ends past the side of a 390px
 * screen while every assertion about its text still passes -- so the last two
 * checks measure where each line ends against the bar's own content edge, with
 * a whole conditions sentence and one unbroken reference in the quote.
 *
 * ## Why this is not in `npx vitest run`
 *
 * It needs Chromium, and BoardSmith depends on no browser. It never skips: with
 * no Playwright reachable it says how to give it one and exits non-zero.
 *
 *   node scripts/draft-quote-browser.mjs
 *   BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
 *     node scripts/draft-quote-browser.mjs
 */
// One line rather than the pick harness's stacked list, so two scripts importing
// the same six helpers are not a clone group the duplication gate has to hold.
import { assert, check, runBrowserRegression, summarise, surfaceOf, waitUntil } from './browser-harness.mjs';

// ── The fixture world ────────────────────────────────────────────────────────

/**
 * THE TWO LINES #279 WAS REPORTED AGAINST, held here rather than in the rules
 * text so the checks below assert the game's own words and not a copy of them.
 *
 * The first is a whole sentence, which is how a game writes what the price does
 * not buy. The second is ONE unbroken token, the shape an id or a proper name
 * takes when the game has no say in where a browser may break it. A quote line
 * that cannot wrap loses both on a phone, and the player confirms a purchase
 * whose conditions ran off the side of the screen.
 */
const CONDITIONS =
  'Sabotage can still prevent the boost from starting; a blocked guarantee is not charged.';
const LEDGER = 'UNDERWRITINGLEDGERREFERENCE000000000000042';

/**
 * An empire with sixteen genuinely earned Essentia and no boost.
 *
 * The reporter's arithmetic exactly: five Essentia a week, seven days a week,
 * extended from `max(now, saved expiry)`, an omitted quantity meaning one week
 * and zero meaning zero -- so the quote's numbers are the game's and a wrong one
 * is a real disagreement rather than a fixture's opinion.
 */
const RULES = `import { Game, PlayerFacingError, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Empire extends Space<Realm> {
  /** Genuinely earned, and the reason a preview may not be a guess. */
  essentia = 16;
  /** When the boost already paid for runs out, or 0 for none. */
  boostUntil = 0;
}

export class Realm extends Game<Realm, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Empire]);
  }

  empire(): Empire {
    const found = this.first(Empire, 'empire');
    if (!found) throw new Error('This realm has no empire resident.');
    return found;
  }
}

const EMPIRE = 'empire';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PER_WEEK = 5;

/** The operation's rule in ONE place, so the quote and the purchase cannot
 *  disagree: an omitted quantity is one week, and zero is zero. */
const weeksOf = (weeks: number | undefined): number => (weeks === undefined ? 1 : weeks);

const CONDITIONS = '${CONDITIONS}';
const LEDGER = '${LEDGER}';

const expiryAfter = (from: number, saved: number, weeks: number): number =>
  Math.max(from, saved) + weeks * WEEK_MS;
const day = (at: number): string => new Date(at).toISOString().slice(0, 10);

const boost = worldAction<Realm>('boost')
  .prompt('Purchase boost')
  .needs(() => [EMPIRE])
  .chooseFrom('resource', { prompt: 'Resource', choices: ['food', 'storage'] })
  .enterNumber('weeks', {
    prompt: 'Weeks',
    min: 0,
    integer: true,
    optional: 'skip for one week',
  })
  .quote(({ weeks, resource }, { game, world }) => {
    if (resource === undefined) return null;
    const paid = weeksOf(weeks);
    const empire = game.empire();
    return [
      \`\${paid * PER_WEEK} Essentia\`,
      paid === 0
        ? 'adds no time'
        : \`until \${day(expiryAfter(world.now, empire.boostUntil, paid))}\`,
      CONDITIONS,
      \`Recorded against \${LEDGER}\`,
    ];
  })
  .execute(({ weeks, resource }, ctx) => {
    const paid = weeksOf(weeks);
    const empire = (ctx.game as Realm).empire();
    const price = paid * PER_WEEK;
    if (empire.essentia < price) {
      throw new PlayerFacingError(
        \`That costs \${price} Essentia and you have \${empire.essentia}.\`,
      );
    }
    empire.essentia -= price;
    empire.boostUntil = expiryAfter(ctx.world.now, empire.boostUntil, paid);
    ctx.world.emit(
      EMPIRE,
      { resource, weeks: paid },
      \`Paid \${price} Essentia to boost \${resource as string} for \${paid} week(s).\`,
    );
  });

export const gameDefinition: GameDefinition = {
  gameClass: Realm,
  gameType: 'draft-quote-realm',
  displayName: 'Draft Quote Realm',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const realm = game as Realm;
      const empire = realm.create(Empire, 'empire');
      empire.essentia = 16;
      empire.boostUntil = 0;
      return { [EMPIRE]: empire as GameElement };
    },
    view: () => [EMPIRE],
    actions: [boost],
  },
};
`;

/**
 * The custom board: the balance, and the SAME quote the panel is showing.
 *
 * The parity half (CLAUDE.md's hard rule). A custom UI reads
 * `actionController.actionQuote` -- the controller's own shared state -- so if
 * the two surfaces could ever disagree about the price of one draft, this board
 * and the bar beside it would say different numbers on the same screen.
 */
const BOARD = `import { computed, defineComponent, h } from 'vue';

export default defineComponent({
  name: 'RealmBoard',
  props: {
    gameView: { type: Object, default: null },
    actionController: { type: Object, required: true },
  },
  setup(props) {
    const controller = props.actionController as {
      actionQuote: { value: readonly string[] | null };
      start(name: string, options?: Record<string, unknown>): Promise<unknown>;
    };
    // THE VIEW IS A SERIALIZED TREE, so the balance is found rather than read off
    // the root: what the world projects for this seat is the game with the
    // partitions it can see beneath it.
    const essentia = computed(() => {
      const found = (node: any): number | undefined => {
        if (node === null || typeof node !== 'object') return undefined;
        const mine = node.attributes?.essentia;
        if (typeof mine === 'number') return mine as number;
        for (const child of (node.children ?? []) as unknown[]) {
          const deeper = found(child);
          if (deeper !== undefined) return deeper;
        }
        return undefined;
      };
      return found(props.gameView) ?? '?';
    });
    const quote = computed(() => (controller.actionQuote.value ?? []).join(' · '));
    return () =>
      h('div', { class: 'realm-board' }, [
        h('p', { 'data-fixture': 'balance' }, ['Essentia: ', String(essentia.value)]),
        h('p', { 'data-fixture': 'custom-quote' }, quote.value),
        h(
          'button',
          { 'data-fixture': 'start-boost', onClick: () => void controller.start('boost', {}) },
          'Purchase boost',
        ),
      ]);
  },
});
`;

// ── Reading the bar ──────────────────────────────────────────────────────────

/** Wait for the panel to be offering the world's verbs to a seated player. */
async function seated(page) {
  await surfaceOf(page).locator('[data-bs-action="boost"]').waitFor({ timeout: 30_000 });
}

/** What the bar currently says the draft costs. */
async function quoteText(page) {
  const quote = surfaceOf(page).locator('[data-bs-quote]');
  await quote.waitFor({ timeout: 15_000 });
  return (await quote.textContent())?.trim() ?? '';
}

/**
 * Wait for the bar's quote to satisfy `accept`.
 *
 * Polling, for the reason the pick harness polls: the price arrives from the
 * world one round trip after the keystroke, so a single read is a race with it --
 * and the bar deliberately says "Working out the price…" in between rather than
 * showing the last one.
 */
async function expectQuote(page, accept, what) {
  const seen = await waitUntil(() => quoteText(page), accept, 20_000);
  assert(accept(seen), `the bar read "${seen}" rather than ${what}`);
  return seen;
}

/**
 * WHERE EACH QUOTE LINE ACTUALLY ENDS, measured by the browser that laid it out.
 *
 * The bar is a wrapping flex flow with its own padding, so the edge a line has
 * to stay inside is the bar's content edge and not the window's -- and the
 * window is what a screenshot shows you. #279 was reported as pixels running
 * off a 390px screen; this is that in numbers, plus the bar's own horizontal
 * overflow, which is the same defect seen from the container's side.
 */
async function quoteLayout(page) {
  return surfaceOf(page)
    .locator('[data-bs-quote]')
    .evaluate((quote) => {
      const bar = quote.closest('.actionbar');
      const edge = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight);
      return {
        viewport: window.innerWidth,
        edge,
        overflow: bar.scrollWidth - bar.clientWidth,
        lines: Array.from(quote.querySelectorAll('.quote-line')).map((line) => ({
          text: (line.textContent ?? '').trim(),
          right: line.getBoundingClientRect().right,
          height: line.getBoundingClientRect().height,
        })),
      };
    });
}

/**
 * A DRAFT OF TWO WEEKS OF STORAGE, typed and not submitted.
 *
 * The reporter's own state in #248 and the state #279's measurements are taken
 * in, so it is one sentence in both places rather than two copies that could
 * drift into drafting different things.
 */
async function draftTwoWeeksOfStorage(page) {
  const surface = surfaceOf(page);
  await surface.locator('[data-bs-action="boost"]').click();
  await surface.locator('.action-config .choice-btn', { hasText: 'storage' }).click();
  // Answered but NOT submitted: exactly the state the reporter was in.
  await surface.locator('.number-input input').fill('2');
}

/** The empire's balance as the custom board renders it. */
async function balance(page) {
  return (await surfaceOf(page).locator('[data-fixture="balance"]').textContent())?.trim();
}

await runBrowserRegression(
  {
    script: 'draft-quote-browser.mjs',
    fixture: {
      slug: 'draft-quote-realm',
      displayName: 'Draft Quote Realm',
      gameClass: 'Realm',
      rules: RULES,
      boardFile: 'RealmBoard',
      board: BOARD,
    },
  },
  driveThrough,
);

/**
 * EVERY FRAME THIS RUN ASSERTS ABOUT, AS IT CROSSES THE SOCKET.
 *
 * Three kinds, and the third is the one that makes "nothing was spent" an
 * assertion rather than a hope: a `world_command` on this wire IS the purchase, so
 * counting them is how a quote that quietly charged somebody would be caught.
 */
function recordFrames(page) {
  const byType = { quote: [], world_quote_result: [], action: [] };
  const keep = ({ payload }) => {
    let frame;
    try {
      frame = JSON.parse(String(payload));
    } catch {
      return; // not JSON: nothing this run reads
    }
    byType[frame.type]?.push(frame);
  };
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/__boardsmith/world')) return;
    ws.on('framesent', keep);
    ws.on('framereceived', keep);
  });
  return { asked: byType.quote, answered: byType.world_quote_result, commands: byType.action };
}

async function driveThrough({ launch, hostUrl }) {
  const browser = await launch();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { asked, answered, commands } = recordFrames(page);
    await page.goto(hostUrl);
    await seated(page);

    // ── 1. The price of a TYPED, UNSUBMITTED quantity, on the bar ───────────
    await check('the standard panel shows the price of a typed draft before Done', async () => {
      await draftTwoWeeksOfStorage(page);
      await expectQuote(page, (text) => text.includes('10 Essentia'), 'the total for two weeks');
      const shown = await quoteText(page);
      assert(/until \d{4}-\d{2}-\d{2}/.test(shown), `the bar named no resulting expiry: "${shown}"`);
      // And the field still holds what the player typed.
      assert(
        (await surfaceOf(page).locator('.number-input input').inputValue()) === '2',
        'the field lost the value it was quoted for',
      );
    });

    await check('the quote request crossed the socket with the typed draft in it', () => {
      assert(asked.length >= 1, 'no quote request reached the world host at all');
      const typed = asked.find((frame) => frame.args?.weeks === 2);
      assert(typed !== undefined, `no request carried the typed weeks: ${JSON.stringify(asked)}`);
      assert(typed.action === 'boost', `the request named "${typed.action}"`);
      assert(typed.args.resource === 'storage', 'the request dropped the bound resource');
      const reply = answered.find((frame) => frame.requestId === typed.requestId);
      assert(reply !== undefined, "no reply carried the request's own id");
      assert(reply.ok === true, `the world refused: ${reply.message}`);
      assert(reply.quote?.[0] === '10 Essentia', `the reply priced it ${JSON.stringify(reply.quote)}`);
    });

    await check('nothing was spent by being quoted', async () => {
      assert(commands.length === 0, 'a command was sent while the player was still drafting');
      assert(
        (await balance(page)) === 'Essentia: 16',
        `the balance moved while drafting: ${await balance(page)}`,
      );
    });

    // ── 2. The price follows the field ─────────────────────────────────────
    await check('the price follows the field as it changes', async () => {
      await surfaceOf(page).locator('.number-input input').fill('3');
      await expectQuote(page, (text) => text.includes('15 Essentia'), 'the total for three weeks');
      const shown = await quoteText(page);
      assert(!shown.includes('10 Essentia'), `the old price is still on the bar: "${shown}"`);
    });

    // ── 3. The custom UI reads the SAME quote (parity) ──────────────────────
    await check('the custom board shows the same price as the bar', async () => {
      const custom = await surfaceOf(page)
        .locator('[data-fixture="custom-quote"]')
        .textContent();
      assert(
        (custom ?? '').includes('15 Essentia'),
        `the custom UI read "${custom}" while the bar read the price of three weeks`,
      );
    });

    // ── 4. The last field is not the purchase ───────────────────────────────
    await check('submitting the last field offers a confirmation instead of buying', async () => {
      const surface = surfaceOf(page);
      await surface.locator('.number-input button', { hasText: 'Done' }).click();
      await surface.locator('[data-bs-confirm]').waitFor({ timeout: 15_000 });
      assert(commands.length === 0, 'the world was charged by the last field being submitted');
      // The price is STILL on screen at the moment of deciding, which is the
      // whole requirement: shown before the purchase, not after it.
      const shown = await quoteText(page);
      assert(shown.includes('15 Essentia'), `the confirmation showed no price: "${shown}"`);
      assert(
        (await balance(page)) === 'Essentia: 16',
        'the balance moved before the confirmation was pressed',
      );
    });

    await check('confirming sends the order, and the world charges what it quoted', async () => {
      await surfaceOf(page).locator('[data-bs-confirm]').click();
      const paid = await waitUntil(() => balance(page), (read) => read === 'Essentia: 1', 20_000);
      assert(paid === 'Essentia: 1', `the balance read "${paid}" rather than sixteen less fifteen`);
      assert(commands.length === 1, `${commands.length} commands were sent for one purchase`);
      assert(commands[0].args.weeks === 3, `the order carried ${JSON.stringify(commands[0].args)}`);
    });

    // ── 5. The omitted quantity, which is the game's own default ────────────
    await check('skipping the quantity quotes the game\'s default, not a zero', async () => {
      const surface = surfaceOf(page);
      await surface.locator('[data-bs-action="boost"]').click();
      await surface.locator('.action-config .choice-btn', { hasText: 'food' }).click();
      await surface.locator('[data-bs-skip-editor]').click();
      await expectQuote(page, (text) => text.includes('5 Essentia'), 'one week at five');
      await surface.locator('[data-bs-confirm]').click();
      // 1 - 5 is refused by the rules, which is the transaction validating
      // against the world it finds rather than against the preview.
      await surface.locator('text=/That costs 5 Essentia and you have 1/').first().waitFor({
        timeout: 20_000,
      });
      assert(
        (await balance(page)) === 'Essentia: 1',
        'a refused purchase moved the balance anyway',
      );
    });

    // ── 6. The same quote on a wide screen, and then on a phone ────────────
    //
    // #279: the reporter's quote named its price, its cooldown, its chances and
    // the terms of its guarantee, and at 390 x 844 the last two lines ended at
    // x=505 and x=737 on a 390px screen. The confirmation was still pressable,
    // so a player could buy what they had not been able to read. The wide
    // screen is measured FIRST, because the answer to a line that overflows a
    // phone must not be a line that folds on a desktop with room to spare.
    await check('a line that fits still occupies one row on a wide screen', async () => {
      await draftTwoWeeksOfStorage(page);
      await expectQuote(page, (text) => text.includes(LEDGER), 'the whole of its conditions');

      const laid = await quoteLayout(page);
      // The shortest line is one row by construction ("10 Essentia"), so it is
      // the ruler: wrapping must not fold a line the window has room for.
      const row = Math.min(...laid.lines.map((line) => line.height));
      const folded = laid.lines.filter((line) => line.height > row * 1.5);
      assert(
        folded.length === 0,
        `${folded.length} lines wrapped in a ${laid.viewport}px window with room to spare: ` +
          folded.map((line) => `"${line.text}" is ${line.height.toFixed(0)}px tall`).join('; '),
      );
    });

    await check('every quote line stays inside the panel at 390 x 844 (#279)', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await surfaceOf(page).locator('[data-bs-quote]').waitFor({ timeout: 15_000 });

      const laid = await quoteLayout(page);
      assert(
        laid.lines.some((line) => line.text.includes(CONDITIONS)),
        'the conditions sentence never reached the bar, so nothing long was measured',
      );
      assert(
        laid.lines.some((line) => line.text.includes(LEDGER)),
        'the unbroken reference never reached the bar, so nothing unbreakable was measured',
      );
      const ran = laid.lines.filter((line) => line.right > laid.edge + 0.5);
      assert(
        ran.length === 0,
        `${ran.length} of ${laid.lines.length} quote lines run past the panel's content edge ` +
          `(${laid.edge.toFixed(0)}px, in a ${laid.viewport}px viewport): ` +
          ran.map((line) => `"${line.text}" ends at ${line.right.toFixed(0)}px`).join('; '),
      );
      assert(
        laid.overflow <= 1,
        `the bar itself is ${laid.overflow.toFixed(0)}px wider than it can show, ` +
          'so part of the price is off the side of the screen',
      );
    });

    await check('the confirmation is reachable on that screen, after the price', async () => {
      const surface = surfaceOf(page);
      await surface.locator('.number-input button', { hasText: 'Done' }).click();
      const confirm = surface.locator('[data-bs-confirm]');
      await confirm.waitFor({ timeout: 15_000 });
      // A trial click is the browser's own answer to "could the player press
      // this": visible, stable, enabled, and nothing covering the point.
      await confirm.click({ trial: true, timeout: 10_000 });
      const box = await confirm.boundingBox();
      assert(box !== null, 'the confirmation has no box at all on a 390px screen');
      assert(
        box.x >= -0.5 && box.x + box.width <= 390.5,
        `the confirmation spans ${box.x.toFixed(0)}px to ${(box.x + box.width).toFixed(0)}px ` +
          'on a 390px screen',
      );
      assert(
        box.y >= -0.5 && box.y + box.height <= 844.5,
        `the confirmation sits at ${box.y.toFixed(0)}px on an 844px screen`,
      );
    });

    await context.close();
  } finally {
    await browser.close();
  }

  return summarise('through the real dev bridge in a real browser.');
}
