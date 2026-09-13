#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR AN ORDERED, REPEATABLE LIST (#249, #252).
 *
 * `orderedList` is the one selection shape whose whole point is invisible to a
 * component test: that the SEQUENCE a player builds -- with the same identity in
 * it twice, and an entry pulled back out of the middle of it -- is the sequence
 * the resolver is handed. Every layer of that has its own green test and none of
 * them can see the next: the panel's mounted tests drive a stub controller, the
 * controller's tests drive no socket, and the executor's tests are handed an
 * array nobody assembled by pressing anything.
 *
 * So this drives the whole road, once, for real: Chromium, the real `boardsmith
 * dev` world chrome, the real `world.html` in the real iframe, a real WebSocket
 * to a real world host over a real store, real offers enumerated from real
 * partitions, and the world's OWN STATE read back at the end -- which is the only
 * place the resolver's argument can be observed rather than asserted about.
 *
 * It covers BOTH surfaces, because CLAUDE.md's rule is that they stay in parity:
 * the Action Panel's Add buttons, and a board click routed through
 * `useBoardInteraction` into the same shared controller draft. The second half
 * mixes them deliberately -- board, board, panel-remove, board -- because two
 * views of one draft is the claim, and a run that only ever touches one of them
 * could not tell a shared draft from two private ones.
 *
 * And it checks the two controls are REACHABLE (#167, #250, #252): the panel is
 * the keyboard and screen-reader surface and a custom board owns no commands of
 * its own, so an Add or a remove that cannot be tabbed to, named, or returned to
 * after it unmounts is a control those players do not have.
 *
 * ## Why this is not in `npx vitest run`
 *
 * It needs Chromium, and BoardSmith depends on no browser -- the suite stays
 * hermetic and this is run deliberately. It never skips: with no Playwright
 * reachable it says how to give it one and exits non-zero, because a browser
 * regression that quietly passes when it did not run is the thing it replaces.
 *
 *   node scripts/ordered-list-browser.mjs
 *   BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
 *     node scripts/ordered-list-browser.mjs
 *
 * ## The fixture is written here, not checked in
 *
 * A repair yard: four buildings, one of them condemned so the rules have a
 * reason to refuse a name outright, and a repair order of up to four entries in
 * which a building may legally appear more than once. It is generated into a temp
 * directory per run -- born at genesis, exercised once, removed when its host has
 * stopped -- for the reason `world-pick-bridge-browser.mjs` gives about its own:
 * a checked-in game project inside the library is a second thing to keep
 * compiling.
 */
import {
  assert,
  check,
  runBrowserRegression,
  summarise,
  surfaceOf,
  VIEW_FIELD_READER,
  waitUntil,
} from './browser-harness.mjs';

// ── The fixture world ────────────────────────────────────────────────────────

/**
 * A yard, four buildings and a repair order.
 *
 * The order takes between two and four ENTRIES, which is the difference from a
 * set: two repairs of one building satisfy "at least two". The spire is
 * condemned, so one of the four choices carries the rules' own refusal and a
 * repeat cannot smuggle it in.
 *
 * `repaired` is written by the resolver and by nothing else, joined in the order
 * the argument arrived. It is what the board reads back, and it is the only
 * honest place to observe what the handler was given.
 */
const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Building extends Space<Yard> {
  /** A building the yard will not let anybody work on. */
  condemned = false;
}

class Ledger extends Space<Yard> {
  /** THE RESOLVER'S OWN ARGUMENT, joined in the order it arrived. */
  repaired = '';
  /** How many orders have been worked, so a second submission is visible. */
  orders = 0;
}

export class Yard extends Game<Yard, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Ledger, Building]);
  }

  ledger(): Ledger {
    const found = this.first(Ledger, 'ledger');
    if (!found) throw new Error('This yard has no ledger.');
    return found;
  }

  building(name: string): Building {
    const found = this.first(Building, name);
    if (!found) throw new Error(\`There is no building called "\${name}" in this yard.\`);
    return found;
  }
}

const YARD = 'yard';

/** "university" -> "University", which is what both surfaces label it with. */
const titleCase = (name: string): string => name[0]!.toUpperCase() + name.slice(1);

/**
 * REPAIR, IN ORDER -- the shape #249 added and #252 is about.
 *
 * A building may be named more than once: each entry spends what the one before
 * it left, so a second pass over the same building is a real instruction and not
 * a mistake. The bounds count entries.
 */
const repair = worldAction<Yard>('repair')
  .prompt('Order repairs')
  .needs(() => [YARD])
  .chooseFrom('buildings', {
    prompt: 'Repair, in order',
    choices: ({ game }) => game.all(Building).map((one) => one.name!),
    display: titleCase,
    disabled: (name, { game }) =>
      game.building(name).condemned ? \`The \${titleCase(name)} is condemned.\` : false,
    boardRefs: (name, { game }) => ({
      refs: [{ ref: { id: game.building(name).id }, role: 'target' }],
    }),
    orderedList: { min: 2, max: 4 },
  })
  .execute(({ buildings }, ctx) => {
    const order = buildings as string[];
    const ledger = ctx.game.ledger();
    ledger.repaired = order.join(' > ');
    ledger.orders += 1;
    ctx.world.emit(
      YARD,
      { orders: ledger.orders },
      \`Worked \${order.length} repairs in order: \${ledger.repaired}.\`,
    );
  });

export const gameDefinition: GameDefinition = {
  gameClass: Yard,
  gameType: 'ordered-list-yard',
  displayName: 'Ordered List Yard',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const yard = game as Yard;
      const ledger = yard.create(Ledger, 'ledger');
      for (const name of ['university', 'shipyard', 'foundry', 'spire']) {
        ledger.create(Building, name);
      }
      ledger.first(Building, 'spire')!.condemned = true;
      return { [YARD]: ledger as GameElement };
    },
    view: () => [YARD],
    actions: [repair],
  },
};
`;

/**
 * The custom board: one button per candidate the bridge is offering, and the
 * sequence the world stored.
 *
 * The buttons are drawn from `validElements` and activated through
 * `triggerElementSelect`, which is the real board-click path -- the same one a
 * hex cell or a Lacuna planet takes -- so what this exercises is
 * `useBoardInteraction` into `useBoardActionBridge` into the shared draft, not a
 * shortcut of its own. A board that called `appendListEntry` directly would prove
 * nothing about the surface a game actually builds.
 */
const BOARD = `import { computed, defineComponent, h } from 'vue';
import { useBoardInteraction } from 'boardsmith/ui';

${VIEW_FIELD_READER}

export default defineComponent({
  name: 'YardBoard',
  props: {
    gameView: { type: Object, default: undefined },
  },
  setup(props) {
    const board = useBoardInteraction();
    const stored = computed(() =>
      String(findAttr(props.gameView as Node | undefined, 'repaired') ?? ''),
    );
    return () =>
      h('div', { class: 'yard-board' }, [
        h('pre', { 'data-fixture': 'stored-order' }, stored.value),
        h(
          'div',
          { class: 'yard-buildings' },
          board.validElements.map((candidate) =>
            h(
              'button',
              {
                key: candidate.id,
                'data-fixture': \`board-\${String(candidate.display ?? candidate.id).toLowerCase()}\`,
                onClick: () => board.triggerElementSelect(candidate.ref),
              },
              \`Work the \${candidate.display}\`,
            ),
          ),
        ),
      ]);
  },
});
`;

// ── Reading the surface ──────────────────────────────────────────────────────

/** Wait for the panel to be offering the world's verb to a seated player. */
async function seated(page) {
  await surfaceOf(page).locator('[data-bs-action="repair"]').waitFor({ timeout: 30_000 });
}

/** Start `repair` from the action panel and wait for the Add buttons. */
async function startRepair(page) {
  const surface = surfaceOf(page);
  await surface.locator('[data-bs-action="repair"]').click();
  await surface.locator('.ordered-list-add').first().waitFor({ timeout: 15_000 });
}

/** Press the Add button for one building. */
async function addFromPanel(page, building) {
  await surfaceOf(page).locator('.ordered-list-add', { hasText: building }).click();
}

/**
 * Press an Add button the panel is REFUSING, and mean it.
 *
 * `force` skips Playwright's own actionability wait, which would otherwise sit
 * out the full timeout on an `aria-disabled` control. That wait is not the thing
 * under test: `v-disabled-reason` swallows the click in the capture phase, and
 * what these checks are about is that the gesture lands on the page and still
 * changes nothing.
 */
async function pressRefusedAdd(page, building) {
  await surfaceOf(page)
    .locator('.ordered-list-add', { hasText: building })
    .click({ force: true });
}

/** Click one building ON THE BOARD, through `useBoardInteraction`. */
async function clickOnBoard(page, building) {
  await surfaceOf(page).locator(`[data-fixture="board-${building}"]`).click();
}

/**
 * The numbered list as a player reads it: `['1. University', ...]`.
 *
 * The position and the label are separate spans with no whitespace between them,
 * so this joins them rather than reading the row's own text -- which would come
 * out as `1.University`, and would go on matching if the numbering vanished into
 * the label.
 */
async function entries(page) {
  return surfaceOf(page)
    .locator('.ordered-list-entry')
    .evaluateAll((rows) =>
      rows.map((row) =>
        [
          row.querySelector('.ordered-list-position')?.textContent?.trim() ?? '(unnumbered)',
          row.querySelector('.ordered-list-label')?.textContent?.trim() ?? '(unlabelled)',
        ].join(' '),
      ),
    );
}

/** Wait for the list to hold exactly `expected`, then assert it does. */
async function expectEntries(page, expected) {
  const seen = await waitUntil(
    () => entries(page),
    (read) => JSON.stringify(read) === JSON.stringify(expected),
    10_000,
  );
  assert(
    JSON.stringify(seen) === JSON.stringify(expected),
    `the list read ${JSON.stringify(seen)} rather than ${JSON.stringify(expected)}`,
  );
}

/** What the count line says, e.g. `Added: 2/4`. */
async function countLine(page) {
  return (await surfaceOf(page).locator('.ordered-list-count').textContent())?.trim();
}

/** Wait for the world's stored order to read exactly `expected`. */
async function expectStoredOrder(page, expected) {
  const stored = surfaceOf(page).locator('[data-fixture="stored-order"]');
  const seen = await waitUntil(
    async () => (await stored.textContent())?.trim() ?? '',
    (read) => read === expected,
    20_000,
  );
  assert(seen === expected, `the world stored ${JSON.stringify(seen)} rather than ${JSON.stringify(expected)}`);
}

/** Submit the finished list with the panel's own Done. */
async function submit(page) {
  await surfaceOf(page).locator('.ordered-list-choices .done-button').click();
}

/**
 * The `class` and `aria-label` of whatever holds the keyboard inside the frame.
 *
 * Read through the frame's own `document`, because `document.activeElement` in
 * the outer page is the iframe element itself.
 */
async function focusedInSurface(page) {
  return page.frameLocator('.world-dev__frame').locator(':focus').first().evaluate((el) => ({
    class: el.className,
    label: el.getAttribute('aria-label'),
    text: el.textContent?.trim() ?? '',
  }));
}

// THE WHOLE RUN, IN THE HARNESS'S ORDER (#231). It checks the checkout is
// installed, finds a Chromium or refuses, serves the fixture world, stops the
// host before removing its project, and exits on what `driveThrough` reports --
// so a temp world left behind by a crashed run is litter this cannot leave.
await runBrowserRegression(
  {
    script: 'ordered-list-browser.mjs',
    fixture: {
      slug: 'ordered-list-yard',
      displayName: 'Ordered List Yard',
      gameClass: 'Yard',
      rules: RULES,
      boardFile: 'YardBoard',
      board: BOARD,
    },
  },
  driveThrough,
);

async function driveThrough({ chromium, hostUrl }) {
  const browser = await chromium.launch();

  try {
    // One page for the whole run, so `browser.newPage` rather than a context of
    // its own: the world is persistent and every check below builds on the state
    // the one before it left, which is also why the order they run in is the
    // order they are written in.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // The command as it leaves for the host: the wire is where a sequence would
    // be silently deduplicated or sorted, and it is not a thing the surface can
    // be asked about afterwards.
    const commanded = [];
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/__boardsmith/world')) return;
      ws.on('framesent', ({ payload }) => {
        try {
          const frame = JSON.parse(String(payload));
          if (frame.action === 'repair') commanded.push(frame);
        } catch {
          // not JSON: not a command
        }
      });
    });
    await page.goto(hostUrl);
    await seated(page);
    await startRepair(page);

    const surface = surfaceOf(page);

    // ── 1. The ACTION PANEL's own Add buttons ────────────────────────────────

    await check('the panel draws an Add button per choice, not a row of checkboxes', async () => {
      const adds = surface.locator('.ordered-list-add');
      assert(
        JSON.stringify(await adds.allTextContents()) ===
          JSON.stringify(['University', 'Shipyard', 'Foundry', 'Spire']),
        `the panel offered ${JSON.stringify(await adds.allTextContents())}`,
      );
      assert(
        (await surface.locator('.multi-select-choice').count()) === 0,
        'a checkbox set is still there beside the list, so the wrong control was drawn',
      );
      assert((await countLine(page)) === 'Added: 0/4', `the count read ${await countLine(page)}`);
      assert(
        (await surface.locator('.ordered-list-entry').count()) === 0,
        'an empty list drew entries',
      );
    });

    await check('Done is held until the minimum number of ENTRIES, and says how short', async () => {
      const done = surface.locator('.ordered-list-choices .done-button');
      assert((await done.getAttribute('aria-disabled')) === 'true', 'Done was live with no entries');
      await addFromPanel(page, 'University');
      await expectEntries(page, ['1. University']);
      assert(
        (await done.getAttribute('data-bs-disabled-reason')) ===
          'Add 1 more to continue (at least 2 required).',
        `Done refused with ${JSON.stringify(await done.getAttribute('data-bs-disabled-reason'))}`,
      );
    });

    await check('pressing the SAME Add again repeats the identity, rather than deselecting it', async () => {
      // The whole difference from a set, and the one thing a checkbox cannot
      // express: a second press means "again", not "never mind".
      await addFromPanel(page, 'University');
      await expectEntries(page, ['1. University', '2. University']);
      assert((await countLine(page)) === 'Added: 2/4', `the count read ${await countLine(page)}`);
      assert(
        (await surface.locator('.ordered-list-choices .done-button').getAttribute('aria-disabled'))
          === null,
        'two entries did not satisfy "at least 2" -- the bound is counting identities, not entries',
      );
    });

    await check("a choice the rules refuse cannot be added, and says why", async () => {
      const spire = surface.locator('.ordered-list-add', { hasText: 'Spire' });
      assert((await spire.getAttribute('aria-disabled')) === 'true', 'the condemned spire was offered');
      assert(
        (await spire.getAttribute('data-bs-disabled-reason')) === 'The Spire is condemned.',
        `the refusal read ${JSON.stringify(await spire.getAttribute('data-bs-disabled-reason'))}`,
      );
      await pressRefusedAdd(page, 'Spire');
      await expectEntries(page, ['1. University', '2. University']);
    });

    await check('a full list refuses every Add, including one already in it', async () => {
      await addFromPanel(page, 'Shipyard');
      await addFromPanel(page, 'Foundry');
      await expectEntries(page, ['1. University', '2. University', '3. Shipyard', '4. Foundry']);
      const university = surface.locator('.ordered-list-add', { hasText: 'University' });
      assert(
        (await university.getAttribute('data-bs-disabled-reason')) ===
          'The list is full at 4 entries. Remove one to add another.',
        `a full list refused with ${JSON.stringify(await university.getAttribute('data-bs-disabled-reason'))}`,
      );
      await pressRefusedAdd(page, 'University');
      await expectEntries(page, ['1. University', '2. University', '3. Shipyard', '4. Foundry']);
    });

    await check('removing entry 3 takes THAT entry, not the other copy of its value', async () => {
      // By index, because with repeats a value does not name an entry: removing
      // "University" is an ambiguous instruction and removing the third thing in
      // the list is not.
      await surface.locator('.ordered-list-remove').nth(2).click();
      await expectEntries(page, ['1. University', '2. University', '3. Foundry']);
      assert((await countLine(page)) === 'Added: 3/4', `the count read ${await countLine(page)}`);
    });

    await check('the sequence the resolver is handed is the sequence that was built', async () => {
      // Re-added at the END, so the stored order is neither sorted nor the order
      // the buttons are drawn in: a surface that deduplicated, sorted or kept
      // insertion-by-value would all read differently here.
      await addFromPanel(page, 'Shipyard');
      await expectEntries(page, ['1. University', '2. University', '3. Foundry', '4. Shipyard']);
      await submit(page);
      await expectStoredOrder(page, 'university > university > foundry > shipyard');
    });

    await check('the command crossed the socket carrying that same sequence', () => {
      const last = commanded[commanded.length - 1];
      assert(last !== undefined, 'no command frame reached the world host at all');
      assert(last.action === 'repair', `the command named "${last.action}"`);
      assert(
        JSON.stringify(last.args?.buildings) ===
          JSON.stringify(['university', 'university', 'foundry', 'shipyard']),
        `the wire carried ${JSON.stringify(last.args?.buildings)}`,
      );
    });

    // ── 2. A BOARD CLICK, into the same shared draft ─────────────────────────

    await check('a board click appends through the same draft the panel is drawing', async () => {
      // PARITY, which is a hard rule: the panel and a custom UI are two views of
      // one selection. These clicks go through `useBoardInteraction` --
      // `triggerElementSelect` on the candidate the bridge published -- and what
      // is asserted is that the PANEL's numbered list grew, which it can only do
      // if both surfaces are reading one draft.
      await startRepair(page);
      await clickOnBoard(page, 'university');
      await clickOnBoard(page, 'university');
      await expectEntries(page, ['1. University', '2. University']);
      assert((await countLine(page)) === 'Added: 2/4', `the count read ${await countLine(page)}`);
    });

    await check('a board click on a refused building does nothing, exactly as its Add does', async () => {
      await clickOnBoard(page, 'spire');
      await expectEntries(page, ['1. University', '2. University']);
    });

    await check('the panel can remove an entry a board click put there', async () => {
      // The other direction across the same draft. Two private drafts would
      // leave this list untouched.
      await surface.locator('.ordered-list-remove').nth(0).click();
      await expectEntries(page, ['1. University']);
    });

    await check('a mixed board-and-panel list submits in the order it was built', async () => {
      await clickOnBoard(page, 'foundry');
      await addFromPanel(page, 'University');
      await expectEntries(page, ['1. University', '2. Foundry', '3. University']);
      await submit(page);
      await expectStoredOrder(page, 'university > foundry > university');
      const last = commanded[commanded.length - 1];
      assert(
        JSON.stringify(last.args?.buildings) ===
          JSON.stringify(['university', 'foundry', 'university']),
        `the wire carried ${JSON.stringify(last.args?.buildings)}`,
      );
    });

    // ── 3. Reachable from a keyboard, named for a screen reader (#252) ───────

    await check('every Add and remove control is in the tab order, in reading order', async () => {
      // The panel is the accessibility surface and a board owns no commands of
      // its own (#250), so a control that cannot be tabbed to is a control a
      // keyboard player does not have.
      await startRepair(page);
      await addFromPanel(page, 'University');
      await addFromPanel(page, 'Shipyard');
      await expectEntries(page, ['1. University', '2. Shipyard']);

      // From the first entry's remove button onwards, one Tab at a time. Every
      // control the list is built with has to be on this walk, in the order it is
      // read in -- including the refused Spire, which keeps its place in the tab
      // order precisely so a keyboard player can reach the reason it is refused.
      await surface.locator('.ordered-list-remove').nth(0).focus();
      const seen = [(await focusedInSurface(page)).label];
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        const on = await focusedInSurface(page);
        seen.push(on.label ?? on.text);
      }
      const wanted = [
        'Remove entry 1, University',
        'Remove entry 2, Shipyard',
        'Add University',
        'Add Shipyard',
        'Add Foundry',
        'Add Spire',
        'Done',
      ];
      assert(
        JSON.stringify(seen) === JSON.stringify(wanted),
        `tabbing walked ${JSON.stringify(seen)} rather than ${JSON.stringify(wanted)}`,
      );
    });

    await check('the keyboard alone can add an entry, and the count says so out loud', async () => {
      const count = surface.locator('.ordered-list-count');
      assert(
        (await count.getAttribute('aria-live')) === 'polite',
        'the count is not a live region, so an Add is announced as nothing at all',
      );
      await surface.locator('.ordered-list-add', { hasText: 'Foundry' }).focus();
      await page.keyboard.press('Enter');
      await expectEntries(page, ['1. University', '2. Shipyard', '3. Foundry']);
      assert((await countLine(page)) === 'Added: 3/4', `the count read ${await countLine(page)}`);
    });

    await check('the entries list is named, so a reader is told what it is a list of', async () => {
      assert(
        (await surface.locator('.ordered-list-entries').getAttribute('aria-label')) ===
          'Entries added so far, in order',
        'the numbered list announces itself as an unnamed list of three items',
      );
    });

    await check('removing by keyboard keeps the keyboard in the list (#252)', async () => {
      // The pressed button is the node that unmounts. Without the panel placing
      // focus, it lands on the body and the next removal means tabbing in from
      // the top of the document again -- and #228's stranding repair cannot see
      // this, because the step did not change, only the draft did.
      await surface.locator('.ordered-list-remove').nth(1).focus();
      await page.keyboard.press('Enter');
      await expectEntries(page, ['1. University', '2. Foundry']);
      const on = await focusedInSurface(page);
      assert(
        on.class.includes('ordered-list-remove'),
        `after a removal the keyboard was on ${JSON.stringify(on.class || '(nothing)')}`,
      );
      assert(
        on.label === 'Remove entry 2, Foundry',
        `focus landed on ${JSON.stringify(on.label)} rather than the entry that took its place`,
      );
    });

    await check('emptying the list by keyboard leaves the keyboard on the Add row', async () => {
      await page.keyboard.press('Enter');
      await expectEntries(page, ['1. University']);
      await surface.locator('.ordered-list-remove').nth(0).focus();
      await page.keyboard.press('Enter');
      await expectEntries(page, []);
      const on = await focusedInSurface(page);
      assert(
        on.class.includes('ordered-list-add'),
        `with the list emptied the keyboard was on ${JSON.stringify(on.class || '(nothing)')}`,
      );
    });

    await page.close();
  } finally {
    await browser.close();
  }

  return summarise('through the real dev host in a real browser.');
}
