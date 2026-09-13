#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A FRESHLY LOADED WORLD'S VERBS (#250).
 *
 * The field symptom: a world opens, the board and the seat list and the log all
 * render, and the action panel is empty and stays empty for the life of the
 * page. For a new world whose only verb is the one that lets you in, that is a
 * world nobody can enter -- and the action panel is the accessibility surface, so
 * a keyboard or screen-reader player has no other road to the same verb.
 *
 * ## Why a browser, and why this shape
 *
 * `useWorldHost` used to apply an offer set only if it named the state on screen
 * AT THE INSTANT IT ARRIVED, and drop it otherwise. That makes a world's verbs
 * depend on the order two messages of one push land in, and nothing in the
 * protocol promises an order: the host relays into a frame that may not be
 * listening yet, a page can join mid-stream, and a QUIET WORLD NEVER SENDS A
 * SECOND SET. So one dropped set is a panel that is empty forever, which no
 * layer's own tests can see -- every layer was green while the field was dead
 * (#245 is the same shape, one layer down).
 *
 * Two questions, both through the real dev bridge in a real Chromium:
 *
 *   1. A plain fresh load has the world's verbs in the panel. This is the
 *      reported symptom, asserted where it was reported.
 *   2. The SAME load with the push's two frames delivered OFFERS FIRST still has
 *      them. That is the ordering the old code could not survive, and it is
 *      reordered on the socket rather than mocked, so what is proven is the
 *      whole road: socket -> dev bar -> postMessage -> `useWorldHost` -> panel.
 *
 * It needs Chromium, and BoardSmith depends on no browser, so it is run
 * deliberately rather than by `npx vitest run` -- the same split #227 settled:
 *
 *   node scripts/world-offers-latch-browser.mjs
 *   BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
 *     node scripts/world-offers-latch-browser.mjs
 */
import {
  assert,
  check,
  runBrowserRegression,
  summarise,
  surfaceOf,
  waitUntil,
} from './browser-harness.mjs';

// ── The fixture world ────────────────────────────────────────────────────────

/**
 * A hearth and one verb: light it.
 *
 * The shape the report is about -- a new world whose only verb is the one that
 * lets a seat in -- so an empty panel here is a world with no way into it, and
 * the check can tell "no verbs" from "a verb that is refused".
 */
const RULES = `import { Game, Piece, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Ember extends Piece<Hearth> {}

class Fire extends Space<Hearth> {
  lit = false;
}

export class Hearth extends Game<Hearth, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Fire, Ember]);
  }

  fire(): Fire {
    const found = this.first(Fire, 'fire');
    if (!found) throw new Error('This hearth has no fire in it.');
    return found;
  }
}

const HEARTH = 'hearth';

/** The one verb a new world has, with a selection so the panel draws a form. */
const kindle = worldAction<Hearth>('kindle')
  .prompt('Kindle the fire')
  .needs(() => [HEARTH])
  .chooseFrom('ember', {
    prompt: 'Which ember?',
    choices: ({ game }) => game.all(Ember).map((ember) => ember.name!),
  })
  .execute(({ ember }, ctx) => {
    ctx.game.fire().lit = true;
    ctx.world.emit(
      HEARTH,
      { kindled: ember },
      \`Seat \${ctx.player.seat} kindles the fire with \${ember as string}.\`,
    );
  });

export const gameDefinition: GameDefinition = {
  gameClass: Hearth,
  gameType: 'offers-latch-hearth',
  displayName: 'Offers Latch Hearth',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const hearth = game as Hearth;
      const fire = hearth.create(Fire, 'fire');
      for (const name of ['birch', 'oak']) fire.create(Ember, name);
      return { [HEARTH]: fire as GameElement };
    },
    view: () => [HEARTH],
    actions: [kindle],
  },
};
`;

/** A board that draws nothing: the panel is the surface under test. */
const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'HearthBoard',
  setup() {
    return () => h('div', { class: 'hearth-board' }, 'the hearth');
  },
});
`;

// ── The questions ────────────────────────────────────────────────────────────

/** The verbs the action panel is offering right now. */
async function verbs(page) {
  return await surfaceOf(page)
    .locator('[data-bs-action]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-bs-action')));
}

/**
 * Wait for the panel to be offering something, then say what.
 *
 * Polled rather than read once, because the panel is drawn from the SECOND
 * message of the push and a single read would be a race with it. The reported
 * defect is not a slow panel -- it never fills at all -- so a generous window
 * costs nothing and makes the failure unambiguous.
 */
async function verbsOnScreen(page) {
  return await waitUntil(() => verbs(page), (seen) => seen.length > 0, 25_000);
}

/**
 * A world whose board renders, which is the part that always worked.
 *
 * Asserted before the panel so a failure says WHICH half is missing: the report
 * is precisely "the board is there and the verbs are not", and a check that
 * could not tell them apart would blame the wrong layer.
 */
async function boardOnScreen(page) {
  await surfaceOf(page).locator('.hearth-board').waitFor({ timeout: 30_000 });
}

/** One socket frame's type, or `null` for anything that is not this protocol. */
function typeOf(message) {
  try {
    return JSON.parse(String(message)).type;
  } catch {
    // Not JSON: it has no type, and is relayed untouched like the bar relays it.
    return null;
  }
}

/**
 * Deliver every push's two frames the OTHER WAY ROUND, on the socket.
 *
 * Each `world_state` is held back until the `world_offers` behind it has gone
 * through, which is the ordering `useWorldHost` used to drop a set on. Reordered
 * on the real socket rather than mocked, so what is proven is the whole road:
 * socket -> dev bar -> postMessage -> `useWorldHost` -> panel.
 *
 * EVERY push rather than only the first, because the guarantee is that arrival
 * order cannot decide whether a world has verbs -- and a page that only survived
 * its first push would still be one an offer could go missing from later. A push
 * whose offers never arrive would strand its state here, which is a check that
 * fails loudly rather than one that passes quietly.
 */
async function withOffersFirst(page) {
  await page.routeWebSocket(/__boardsmith\/world/, (ws) => {
    const server = ws.connectToServer();
    /** The state frames whose offers have not gone through yet. */
    const held = [];
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const type = typeOf(message);
      if (type === 'world_state') {
        held.push(message);
        return;
      }
      ws.send(message);
      if (type === 'world_offers') for (const state of held.splice(0)) ws.send(state);
    });
  });
}

/**
 * The two loads, and they are one question asked twice.
 *
 * A scene is how the page's socket behaves; everything else about the run is
 * identical, which is the point -- the ordering is the only variable.
 */
const SCENES = [
  {
    name: 'a freshly loaded world offers its verb in the action panel',
    prepare: null,
    note: 'on a plain fresh load -- a world with no way into it',
  },
  {
    name: 'the verb is there when the offers reach the page before their state',
    prepare: withOffersFirst,
    note: 'after an offers-first delivery',
  },
];

await runBrowserRegression(
  {
    script: 'world-offers-latch-browser.mjs',
    fixture: {
      slug: 'offers-latch-hearth',
      displayName: 'Offers Latch Hearth',
      gameClass: 'Hearth',
      rules: RULES,
      boardFile: 'HearthBoard',
      board: BOARD,
    },
  },
  driveThrough,
);

async function driveThrough({ chromium, hostUrl }) {
  const browser = await chromium.launch();
  try {
    for (const scene of SCENES) {
      const page = await (await browser.newContext()).newPage();
      if (scene.prepare !== null) await scene.prepare(page);
      await page.goto(hostUrl);
      await boardOnScreen(page);
      await check(scene.name, async () => {
        const seen = await verbsOnScreen(page);
        assert(seen.includes('kindle'), `the panel offered ${JSON.stringify(seen)} ${scene.note}`);
      });
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
  return summarise('through the real dev bridge in a real browser');
}
