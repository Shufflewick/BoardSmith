#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR A DEPENDENT WORLD PICK (#227).
 *
 * `boardsmith dev`'s world chrome relayed neither half of the re-asked pick
 * ShufflewickPub #378 added: the frame's `world_pick` never reached the socket,
 * and the host's `world_pick_result` never reached the frame. Every layer on
 * either side of that bar had tests, and all of them were green -- the native
 * host answers a `pick`, `useWorldHost` asks one, `useActionController` walks
 * the selections -- because none of them can see the bar between them. A crew
 * whose cap is the chosen ship's cargo hold therefore kept the unbounded
 * metadata the one-shot offer carried and then timed out, and the field symptom
 * was a form reading "Selected: 0" where five was the answer.
 *
 * So the regression that holds it closed has to be a REAL browser over the real
 * bridge: Chromium, the real dev chrome, the real `world.html` in the real
 * iframe, a real WebSocket to a real `LocalWorldHost` over a real store. What
 * is asserted includes the frames on that socket, because "received WebSocket
 * frames contain no pick reply" is how the defect was actually found.
 *
 * ## Why this is not in `npx vitest run`
 *
 * It needs Chromium, and BoardSmith depends on no browser -- the suite stays
 * hermetic and this is run deliberately, the same split ShufflewickPub keeps
 * between `npm test` and its Playwright specs. It never skips: with no
 * Playwright reachable it says how to give it one and exits non-zero, because a
 * browser regression that quietly passes when it did not run is the thing it
 * exists to replace.
 *
 *   node scripts/world-pick-bridge-browser.mjs
 *   BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
 *     node scripts/world-pick-bridge-browser.mjs
 *
 * ## The fixture is written here, not checked in
 *
 * The world it drives is the smallest one with the shape the issue is about -- a
 * crew whose size is a function of an argument bound by an earlier selection --
 * and it is generated into a temp directory per run. A checked-in game project
 * inside the library would be a second thing to keep compiling, and this one is
 * disposable by design: the point is a world nobody has played, born at genesis,
 * exercised once.
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO,
  assert,
  check,
  loadChromium,
  startWorldHost,
  summarise,
  surfaceOf,
  writeWorldFixture,
} from './browser-harness.mjs';

/** How long one pick's own answer is waited for, from `worldProtocol.ts`. */
const WORLD_COMMAND_TIMEOUT_MS = 20_000;

// ── The fixture world ────────────────────────────────────────────────────────

/**
 * A dock, three ships and six operatives.
 *
 * The holds are the arithmetic the issue reports: one operative per 350 units,
 * so the Dory's 1,750 is a crew of five and the Skiff's 700 is a crew of two.
 * SIX operatives exist so that a sixth checkbox is there to be refused once the
 * cap is reached, and the Kestrel is impounded so that the rules themselves have
 * a reason to refuse a pick outright.
 */
const RULES = `import { Game, Piece, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Operative extends Piece<Fleet> {}

class Ship extends Space<Fleet> {
  /** Paid cargo hold, which is what the crew cap is derived from. */
  hold = 0;
  /** A ship the port will not let anybody board. */
  impounded = false;
}

class Dock extends Space<Fleet> {}

export class Fleet extends Game<Fleet, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Dock, Ship, Operative]);
  }

  ship(name: string): Ship {
    const found = this.first(Ship, name);
    if (!found) throw new Error(\`No ship called "\${name}" is in this dock.\`);
    return found;
  }
}

const FLEET = 'fleet';
const HOLD_PER_OPERATIVE = 350;

const crewCap = (ship: Ship): number => Math.floor(ship.hold / HOLD_PER_OPERATIVE);

/**
 * Choose a ship, then a crew whose SIZE is that ship's hold.
 *
 * The cap cannot be known when the offer is enumerated, because nothing is
 * bound then -- which is exactly why the panel re-asks this selection, and
 * exactly what the dev bridge has to relay.
 */
const deploy = worldAction<Fleet>('deploy')
  .prompt('Deploy operatives')
  .needs(() => [FLEET])
  .chooseFrom('ship', {
    prompt: 'Ship',
    choices: ({ game }) => game.all(Ship).map((ship) => ship.name!),
  })
  .chooseFrom('crew', {
    prompt: 'Operatives',
    choices: ({ game }) => game.all(Operative).map((one) => one.name!),
    multiSelect: ({ game, args }) => {
      const chosen = args.ship as string | undefined;
      if (chosen === undefined) return { min: 1 };
      const ship = game.ship(chosen);
      if (ship.impounded) {
        throw new Error(\`The \${chosen} is impounded, so nobody may be loaded onto her.\`);
      }
      return { min: 1, max: crewCap(ship) };
    },
  })
  .execute(({ ship, crew }, ctx) => {
    const aboard = crew as string[];
    ctx.world.emit(
      FLEET,
      { ship, crew: aboard },
      \`Seat \${ctx.player.seat} sent \${aboard.length} operative(s) aboard the \${ship as string}.\`,
    );
  });

export const gameDefinition: GameDefinition = {
  gameClass: Fleet,
  gameType: 'pick-bridge-fleet',
  displayName: 'Pick Bridge Fleet',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const fleet = game as Fleet;
      const dock = fleet.create(Dock, 'dock');
      const dory = dock.create(Ship, 'dory');
      dory.hold = 1750;
      const skiff = dock.create(Ship, 'skiff');
      skiff.hold = 700;
      const kestrel = dock.create(Ship, 'kestrel');
      kestrel.hold = 1050;
      kestrel.impounded = true;
      for (const name of ['ash', 'vale', 'brin', 'corr', 'dane', 'esk']) {
        dock.create(Operative, name);
      }
      return { [FLEET]: dock as GameElement };
    },
    view: () => [FLEET],
    actions: [deploy],
  },
};
`;

/**
 * The custom board: two buttons, each starting `deploy` with the ship already
 * prefilled.
 *
 * THE OTHER ENTRY POINT, and the one the issue names first. A custom UI that
 * prefills an earlier selection walks straight into the dependent one, so the
 * re-ask is the FIRST thing that happens rather than the second -- and it has to
 * reach the same cap the action panel reaches, or the two surfaces disagree
 * about what the game allows.
 */
const BOARD = `import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'FleetBoard',
  props: {
    actionController: { type: Object, required: true },
  },
  setup(props) {
    const deployFrom = (ship: string) => {
      void (props.actionController as {
        start(name: string, options: { prefill: Record<string, unknown> }): Promise<unknown>;
      }).start('deploy', { prefill: { ship } });
    };
    return () =>
      h('div', { class: 'fleet-board' }, [
        h('button', { 'data-fixture': 'prefill-dory', onClick: () => deployFrom('dory') },
          'Deploy from the Dory'),
        h('button', { 'data-fixture': 'prefill-kestrel', onClick: () => deployFrom('kestrel') },
          'Deploy from the Kestrel'),
      ]);
  },
});
`;

/** Wait for the panel to be offering the world's verbs to a seated player. */
async function seated(page) {
  await surfaceOf(page).locator('[data-bs-action="deploy"]').waitFor({ timeout: 30_000 });
}

/** Start `deploy` from the ACTION PANEL and bind `ship` there. */
async function panelDeploy(page, ship) {
  const surface = surfaceOf(page);
  await surface.locator('[data-bs-action="deploy"]').click();
  await surface.locator('.action-config .choice-btn', { hasText: ship }).click();
}

/** What the crew pick currently says it will accept. */
async function crewCount(page) {
  const count = surfaceOf(page).locator('.multi-select-count');
  await count.waitFor({ timeout: 10_000 });
  return (await count.textContent())?.trim();
}

/**
 * Wait for the crew pick to read exactly `expected`.
 *
 * The panel draws the pick from the offer FIRST -- "Selected: 0", the unbounded
 * fallback -- and rewrites it when the re-ask lands, which is the whole
 * behaviour under test. So a single read is a race with the round trip, and
 * polling here is what makes the difference between the two states an
 * assertion rather than a coin toss.
 */
async function expectCrewCount(page, expected) {
  const deadline = Date.now() + 15_000;
  let seen = await crewCount(page);
  while (seen !== expected && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 100));
    seen = await crewCount(page);
  }
  assert(seen === expected, `the crew pick read "${seen}" rather than "${expected}"`);
}

/** Read the count once the surface has had a moment to settle. */
async function settledCrewCount(page) {
  await new Promise((settle) => setTimeout(settle, 1000));
  return crewCount(page);
}

async function main() {
  const chromium = await loadChromium('world-pick-bridge-browser.mjs');
  const fixture = writeWorldFixture({
    slug: 'pick-bridge-fleet',
    displayName: 'Pick Bridge Fleet',
    gameClass: 'Fleet',
    rules: RULES,
    boardFile: 'FleetBoard',
    board: BOARD,
  });
  // THE FIXTURE IS REMOVED WHATEVER HAPPENS, from here on. Its own creation is
  // the only step outside the guard, and a temp world left behind by a crashed
  // build is exactly the litter this script must not leave.
  try {
    return await driveThrough({ chromium, fixture });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

async function driveThrough({ chromium, fixture }) {
  const hostUrl = await startWorldHost({ fixture, displayName: 'Pick Bridge Fleet' });
  const browser = await chromium.launch();

  try {
    // ── 1. The action panel's own walk, and the frames it puts on the wire ──
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const asked = [];
      const answered = [];
      page.on('websocket', (ws) => {
        if (!ws.url().includes('/__boardsmith/world')) return;
        ws.on('framesent', ({ payload }) => {
          const frame = JSON.parse(String(payload));
          if (frame.type === 'pick') asked.push(frame);
        });
        ws.on('framereceived', ({ payload }) => {
          const frame = JSON.parse(String(payload));
          if (frame.type === 'world_pick_result') answered.push(frame);
        });
      });
      await page.goto(hostUrl);
      await seated(page);
      await panelDeploy(page, 'dory');

      await check('the action panel resolves the cap the chosen ship decides', async () => {
        await expectCrewCount(page, 'Selected: 0/5');
      });

      await check('the re-ask crosses the socket with its id, action, selection and bound args', () => {
        assert(asked.length >= 1, 'no pick request reached the world host at all');
        const [first] = asked;
        assert(first.action === 'deploy', `the request named "${first.action}"`);
        assert(first.selection === 'crew', `the request re-asked "${first.selection}"`);
        assert(
          JSON.stringify(first.args) === JSON.stringify({ ship: 'dory' }),
          `the request carried ${JSON.stringify(first.args)} rather than the bound ship`,
        );
        assert(typeof first.requestId === 'string' && first.requestId.length > 0, 'the request carried no id');
      });

      await check('the reply comes back on the same socket, under the same id', () => {
        assert(answered.length >= 1, 'the received frames contain no pick reply');
        const reply = answered.find((frame) => frame.requestId === asked[0].requestId);
        assert(reply !== undefined, "no reply carried the request's own id");
        assert(reply.ok === true, `the world refused: ${reply.message}`);
        assert(
          reply.selection?.multiSelect?.max === 5,
          `the reply capped the crew at ${JSON.stringify(reply.selection?.multiSelect)}`,
        );
      });

      await check('the cap is enforced on screen: a sixth operative is refused', async () => {
        const boxes = surfaceOf(page).locator('.multi-select-choice input[type="checkbox"]');
        assert((await boxes.count()) === 6, `the form offered ${await boxes.count()} operatives, not six`);
        for (let i = 0; i < 5; i++) await boxes.nth(i).click();
        await expectCrewCount(page, 'Selected: 5/5');
        assert(
          (await boxes.nth(5).getAttribute('aria-disabled')) === 'true',
          'the sixth operative was still offered with five already aboard',
        );
      });

      // ── 2. A CHANGED earlier argument gets the other ship's cap ──────────
      await check('changing the ship re-asks, and the cap follows the new one', async () => {
        const surface = surfaceOf(page);
        // Clearing the first selection puts the whole action back, which is the
        // controller's own answer to "I chose the wrong ship" -- so the change
        // is made the way a player makes it, and what matters is that the
        // SECOND bind is re-asked rather than answered from the first one.
        await surface.locator('.selected-values .clear-selection-btn').first().click();
        await panelDeploy(page, 'skiff');
        await expectCrewCount(page, 'Selected: 0/2');
        assert(asked.length >= 2, 'changing the ship asked the world nothing');
        assert(
          asked.some((frame) => frame.args?.ship === 'skiff'),
          'no re-ask carried the newly chosen ship',
        );
      });

      await context.close();
    }

    // ── 3. The custom UI's prefilled walk reaches the same cap ─────────────
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(hostUrl);
      await seated(page);

      await check('a custom UI that prefills the ship lands on the resolved cap', async () => {
        await surfaceOf(page).locator('[data-fixture="prefill-dory"]').click();
        await expectCrewCount(page, 'Selected: 0/5');
      });

      // ── 4. A refusal the RULES issue, on the same road ────────────────────
      await check('a refused pick says why, and presents no cap at all', async () => {
        const surface = surfaceOf(page);
        await surface.locator('.action-config .cancel-btn').click();
        await surface.locator('[data-fixture="prefill-kestrel"]').click();
        // THE WORLD'S OWN SENTENCE, on screen. It used to reach `console.error`
        // and nowhere else, which is how a refusal became a silent fallback to
        // the metadata the offer carried.
        await surface.locator('text=/impounded/').first().waitFor({ timeout: 15_000 });
        const shown = await settledCrewCount(page);
        assert(shown === 'Selected: 0', `a refused pick drew "${shown}" -- a cap the world never gave`);
      });

      await context.close();
    }

    // ── 5. A reply that never arrives is a timeout, not a wrong cap ─────────
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      // The bridge as it was before #227: everything relayed EXCEPT the pick's
      // answer. What the player must then see is the world failing to answer --
      // never the unbounded metadata the one-shot offer carried.
      await page.routeWebSocket(/__boardsmith\/world/, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((message) => server.send(message));
        server.onMessage((message) => {
          try {
            if (JSON.parse(String(message)).type === 'world_pick_result') return;
          } catch {
            // not JSON: relay it untouched, like the bar does
          }
          ws.send(message);
        });
      });
      await page.goto(hostUrl);
      await seated(page);
      await panelDeploy(page, 'dory');

      await check('a dropped reply times out and says so, rather than showing a cap', async () => {
        const surface = surfaceOf(page);
        await surface
          .locator('text=/did not answer what "crew" may be/')
          .first()
          .waitFor({ timeout: WORLD_COMMAND_TIMEOUT_MS + 15_000 });
        // "Selected: 0" AND a sentence saying why: the reporter's symptom was
        // this count with nothing said, which is the state a bridge that drops
        // the reply leaves behind.
        const shown = await settledCrewCount(page);
        assert(shown === 'Selected: 0', `an unanswered pick drew "${shown}" -- a cap nothing resolved`);
      });

      await context.close();
    }
  } finally {
    await browser.close();
  }

  return summarise('through the real dev bridge in a real browser.');
}

if (!existsSync(join(REPO, 'node_modules', 'vue'))) {
  console.error(
    'This checkout has no node_modules/vue, so the fixture world cannot be served.\n' +
      '  Run `npm install` in the repository root first.',
  );
  process.exit(1);
}

process.exit(await main());
