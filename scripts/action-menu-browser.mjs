#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR THE ACTION PANEL'S HIERARCHY (#228).
 *
 * `ActionPanel.menu.test.ts` proves the markup, the copy, the props, the
 * branches and the events. This repository's own rule is that a component test
 * can prove nothing else, and this feature is substantially the three things it
 * cannot reach:
 *
 *  1. FOCUS ACROSS A REAL RE-RENDER. The idle button list is keyed on the
 *     available actions, so any availability change re-mounts every button in
 *     it and takes the focused one with it. jsdom will happily report a focus
 *     the browser never gave, and a menu that renders correctly while stranding
 *     the keyboard on `document.body` passes every assertion in the unit file.
 *  2. A REAL ESCAPE, FROM A REAL KEYBOARD, INSIDE THE REAL IFRAME. A dispatched
 *     `keydown` is not a key press: it does not travel the frame boundary, does
 *     not obey `preventDefault`, and cannot show that Tab reaches a group's
 *     button at all.
 *  3. AVAILABILITY CHANGING UNDERNEATH A PLAYER FOR A REASON THAT IS NOT THEIRS.
 *     `setProps` is the panel being told; a world re-pushing one seat's offers
 *     because ANOTHER seat acted is the thing that actually happens, and it
 *     arrives through the fan-out, the socket and the frame.
 *
 * It also holds the constraint the issue calls the most important one, in the
 * only place it can be observed rather than argued: OPENING A MENU IS NOT A
 * GAME COMMAND. Every frame the page sends is recorded, and walking in, down,
 * out and back in must put nothing on the socket at all.
 *
 * Real Chromium, the real dev chrome, the real `world.html` in the real iframe,
 * a real WebSocket to a real `LocalWorldHost` over a real store, and two seats
 * open at once. The precedent and the mechanics are #227's
 * `world-pick-bridge-browser.mjs`; the reasons it is not in `npx vitest run`
 * are that one's reasons.
 *
 *   node scripts/action-menu-browser.mjs
 *   BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
 *     node scripts/action-menu-browser.mjs
 *
 * The fixture world is written to a temp directory per run and removed
 * afterwards, for the reasons #227's script gives.
 */
import { rmSync } from 'node:fs';

import {
  createChecklist,
  loadChromium,
  requireInstalledCheckout,
  startFixtureWorld,
  writeFixtureProject,
} from './lib/browser-harness.mjs';

const SCRIPT = 'scripts/action-menu-browser.mjs';
const { assert, check, summarize } = createChecklist('the real action panel in a real browser');

// ── The fixture world ────────────────────────────────────────────────────────

/**
 * AN EMPIRE WITH TOO MANY VERBS, which is the report.
 *
 * Two ungrouped primaries, a `Dump` group of two, and a `More` group holding
 * one action and a nested `Empire settings` group of two. That is the exact
 * arrangement the issue sketches for Lacuna, at the smallest size that still
 * has every shape in it: a group, a nested group, a group beside ungrouped
 * actions, a leaf with a selection and a leaf without.
 *
 * The verbs are also chosen so availability MOVES for two different reasons:
 *
 *  - Dumping is conditional on having any, and dumping is what spends it. So
 *    taking a leaf empties first that leaf and then its whole group, which is
 *    "the panel returns to a coherent menu state" and "the open group emptied"
 *    on one road.
 *  - The registry is a shared fact any seat may close, and `Empire settings`
 *    is conditional on it being open. So the OTHER seat can pull the level out
 *    from under a player who is standing in it, which nothing on one page can
 *    arrange.
 */
const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameElement, GameOptions } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/session';
import { worldAction } from 'boardsmith/world';

class Empire extends Space<Realm> {
  ore = 4;
  water = 3;
  /** Whether the shared registry is open, which is what gates the settings. */
  registryOpen = true;
  buildings = 0;
  name = 'Kalinor';
}

export class Realm extends Game<Realm, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Empire]);
  }
}

const EMPIRE = 'empire';
const empireOf = (game: Realm): Empire => {
  const found = game.first(Empire, 'empire');
  if (!found) throw new Error('this realm has no empire');
  return found;
};

const construct = worldAction<Realm>('construct')
  .prompt('Construct building')
  .order(10)
  .needs(() => [EMPIRE])
  .execute((_args, ctx) => {
    empireOf(ctx.game).buildings += 1;
    ctx.world.emit(EMPIRE, { built: true }, 'A building went up.');
  });

const closeRegistry = worldAction<Realm>('closeRegistry')
  .prompt('Close the registry')
  .order(20)
  .needs(() => [EMPIRE])
  .condition({ open: ({ game }) => empireOf(game as Realm).registryOpen })
  .execute((_args, ctx) => {
    empireOf(ctx.game).registryOpen = false;
    ctx.world.emit(EMPIRE, { registryOpen: false }, 'The registry closed.');
  });

const dumpOre = worldAction<Realm>('dumpOre')
  .prompt('Dump ore')
  .group('Dump')
  .order(30)
  .needs(() => [EMPIRE])
  .condition({ any: ({ game }) => empireOf(game as Realm).ore > 0 })
  .execute((_args, ctx) => {
    empireOf(ctx.game).ore = 0;
    ctx.world.emit(EMPIRE, { ore: 0 }, 'The ore went over the side.');
  });

const dumpWater = worldAction<Realm>('dumpWater')
  .prompt('Dump water')
  .group('Dump')
  .order(31)
  .needs(() => [EMPIRE])
  .condition({ any: ({ game }) => empireOf(game as Realm).water > 0 })
  .execute((_args, ctx) => {
    empireOf(ctx.game).water = 0;
    ctx.world.emit(EMPIRE, { water: 0 }, 'The water went over the side.');
  });

const skipMission = worldAction<Realm>('skipMission')
  .prompt('Skip mission')
  .group('More')
  .order(80)
  .needs(() => [EMPIRE])
  .execute((_args, ctx) => {
    ctx.world.emit(EMPIRE, { skipped: true }, 'The mission was skipped.');
  });

const renamePlanet = worldAction<Realm>('renamePlanet')
  .prompt('Rename planet')
  .group('More', 'Empire settings')
  .order(90)
  .needs(() => [EMPIRE])
  .condition({ registry: ({ game }) => empireOf(game as Realm).registryOpen })
  .enterText('name', { prompt: 'New name', minLength: 1, maxLength: 24 })
  .execute((args, ctx) => {
    empireOf(ctx.game).name = args.name;
    ctx.world.emit(EMPIRE, { name: args.name }, \`The planet is now \${args.name}.\`);
  });

const describeEmpire = worldAction<Realm>('describeEmpire')
  .prompt('Describe empire')
  .group('More', 'Empire settings')
  .order(91)
  .needs(() => [EMPIRE])
  .condition({ registry: ({ game }) => empireOf(game as Realm).registryOpen })
  .execute((_args, ctx) => {
    ctx.world.emit(EMPIRE, { described: true }, 'The empire was described.');
  });

export const gameDefinition: GameDefinition = {
  gameClass: Realm,
  gameType: 'action-menu-realm',
  displayName: 'Action Menu Realm',
  world: {
    maxPlayers: 2,
    genesis: (game) => {
      const realm = game as Realm;
      const empire = realm.create(Empire, 'empire');
      return { [EMPIRE]: empire as GameElement };
    },
    view: () => [EMPIRE],
    actions: [
      construct,
      closeRegistry,
      dumpOre,
      dumpWater,
      skipMission,
      renamePlanet,
      describeEmpire,
    ],
  },
};
`;

/**
 * The default auto-UI as this world's board.
 *
 * NO CUSTOM BOARD ON PURPOSE. The panel IS the surface under test, and this is
 * what an author's world renders on before they build one -- so the fixture is
 * also the least it can be while still being a real world project.
 */
const UIS = `import { defineGameUIs, defaultUI } from 'boardsmith/ui';
import { AutoUI } from 'boardsmith/ui/auto-ui';

export default defineGameUIs({ 'Auto UI': defaultUI(AutoUI) });
`;

/** The fixture project, written fresh and removed when the run ends. */
const writeFixture = () =>
  writeFixtureProject({
    slug: 'action-menu-realm',
    displayName: 'Action Menu Realm',
    files: { 'src/rules/index.ts': RULES, 'src/ui/uis.ts': UIS },
  });

// ── Reading the panel ───────────────────────────────────────────────────────

/** Value equality for the small arrays these assertions compare. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The world surface inside the dev chrome's iframe, as a locator root. */
const surfaceOf = (page) => page.frameLocator('.world-dev__frame');

/**
 * The same surface as a Frame, for reading what the browser thinks is focused.
 *
 * Reached through the iframe ELEMENT rather than by matching a url: the dev
 * chrome serves the world frame from a path this script has no business
 * knowing, and `contentFrame()` is the question actually being asked -- what is
 * inside the frame the chrome is showing.
 */
async function frameOf(page) {
  const element = await page.$('.world-dev__frame');
  const frame = element === null ? null : await element.contentFrame();
  if (!frame) throw new Error('the dev chrome is not showing a world frame');
  return frame;
}

/** Wait for the panel to be offering the world's verbs to a seated player. */
async function seated(page) {
  await surfaceOf(page).locator('[data-bs-action="construct"]').waitFor({ timeout: 30_000 });
}

/** The action names the panel is currently drawing, in order. */
async function shownActions(page) {
  return (await frameOf(page)).evaluate(() =>
    [...document.querySelectorAll('[data-bs-action]')].map((el) =>
      el.getAttribute('data-bs-action'),
    ),
  );
}

/** The group labels the panel is currently drawing, in order. */
async function shownGroups(page) {
  return (await frameOf(page)).evaluate(() =>
    [...document.querySelectorAll('[data-bs-action-group]')].map((el) =>
      el.getAttribute('data-bs-action-group'),
    ),
  );
}

/** The current-level label, or null at the top level. */
async function levelLabel(page) {
  return (await frameOf(page)).evaluate(
    () => document.querySelector('.action-menu-label')?.textContent?.trim() ?? null,
  );
}

/** What the live region is currently telling a screen reader. */
async function announcement(page) {
  return (await frameOf(page)).evaluate(
    () => document.querySelector('[data-bs-menu-announcement]')?.textContent?.trim() ?? '',
  );
}

/** What the browser says is focused, as the panel's own identity for it. */
async function focused(page) {
  return (await frameOf(page)).evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    const action = active.getAttribute('data-bs-action');
    if (action !== null) return action;
    const group = active.getAttribute('data-bs-action-group');
    if (group !== null) return `group:${group}`;
    if (active.hasAttribute('data-bs-menu-back')) return 'back';
    return active.tagName.toLowerCase();
  });
}

/** Poll until `read` answers `want`, so an assertion is not a race with a push. */
async function until(read, want, what, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let seen = await read();
  while (!same(seen, want) && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 100));
    seen = await read();
  }
  assert(same(seen, want), `${what}: saw ${JSON.stringify(seen)}, wanted ${JSON.stringify(want)}`);
}

/**
 * Walk the keyboard forward until it is standing on `target`.
 *
 * Tab, actually pressed, which is the only way to learn that a group's button
 * is IN the tab order and reachable without a mouse. Bounded, so a button that
 * is unreachable fails rather than hangs.
 */
async function tabTo(page, target, limit = 25) {
  for (let step = 0; step < limit; step += 1) {
    if ((await focused(page)) === target) return;
    await page.keyboard.press('Tab');
  }
  assert(
    (await focused(page)) === target,
    `${limit} tabs never reached ${target}; the keyboard stopped on ${await focused(page)}`,
  );
}

async function main() {
  const chromium = await loadChromium(SCRIPT);
  const fixture = writeFixture();
  // THE FIXTURE IS REMOVED WHATEVER HAPPENS, from here on. A temp world left
  // behind by a crashed build is exactly the litter this must not leave.
  try {
    const hostUrl = await startFixtureWorld({ fixture, displayName: 'Action Menu Realm' });
    const browser = await chromium.launch();
    try {
      // Three sessions, because each is about something the previous one
      // cannot be: one seat walking the menu, two seats moving each other's
      // availability, and one narrow screen.
      await oneSeatWalksTheMenu({ browser, hostUrl });
      await anotherSeatMovesTheLevel({ browser, hostUrl });
      await theMenuOnANarrowScreen({ browser, hostUrl });
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  return summarize();
}

/** ONE SEAT, WALKING THE MENU, and the socket watched the whole way. */
async function oneSeatWalksTheMenu({ browser, hostUrl }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const sent = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/__boardsmith/world')) return;
    ws.on('framesent', ({ payload }) => sent.push(String(payload)));
  });
  await page.goto(hostUrl);
  await seated(page);
  // THE HANDSHAKE IS NOT NAVIGATION. `hello` goes up when the frame
  // connects, before any of this, so the baseline is taken here and every
  // "nothing was sent" assertion below is measured against it.
  const sentBeforeNavigating = sent.length;

  await check("a world's declared hierarchy reaches the shared panel", async () => {
    await until(
      () => shownActions(page),
      ['construct', 'closeRegistry'],
      'the top level drew the wrong actions',
    );
    await until(() => shownGroups(page), ['Dump', 'More'], 'the top level drew the wrong groups');
    assert((await levelLabel(page)) === null, 'the top level drew a current-group label');
  });

  await check('a group occupies one button, and its members appear only on opening', async () => {
    await surfaceOf(page).locator('[data-bs-action-group="Dump"]').click();
    await until(() => shownActions(page), ['dumpOre', 'dumpWater'], 'the Dump level');
    await until(() => shownGroups(page), [], 'the Dump level drew a group it should not');
    assert((await levelLabel(page)) === 'Dump', `the level said "${await levelLabel(page)}"`);
  });

  await check('a nested group opens to its own level, and the label says where', async () => {
    await surfaceOf(page).locator('[data-bs-menu-back]').click();
    await surfaceOf(page).locator('[data-bs-action-group="More"]').click();
    await until(() => shownActions(page), ['skipMission'], 'the More level');
    await until(() => shownGroups(page), ['Empire settings'], 'the More level');
    await surfaceOf(page).locator('[data-bs-action-group="Empire settings"]').click();
    await until(() => shownActions(page), ['renamePlanet', 'describeEmpire'], 'the settings level');
    assert(
      (await levelLabel(page)) === 'More / Empire settings',
      `the nested level said "${await levelLabel(page)}"`,
    );
  });

  // THE CONSTRAINT THE ISSUE CALLS THE MOST IMPORTANT ONE, observed rather
  // than argued. Everything above was navigation: two groups entered, one
  // left, one nested group entered. If any of it were a command, the socket
  // would carry it.
  await check('none of that navigation put a single frame on the socket', () => {
    const during = sent.slice(sentBeforeNavigating);
    assert(
      during.length === 0,
      `navigating the menu sent ${during.length} frame(s): ${during.join(' | ')}`,
    );
  });

  // ── The keyboard, actually pressed ──────────────────────────────────
  await check('Tab reaches a group button and Enter opens its level', async () => {
    await surfaceOf(page).locator('[data-bs-menu-back]').click();
    await surfaceOf(page).locator('[data-bs-menu-back]').click();
    await until(() => shownGroups(page), ['Dump', 'More'], 'back at the top level');
    // Start from a known place inside the frame, then travel by keyboard.
    await surfaceOf(page).locator('[data-bs-action="construct"]').focus();
    await tabTo(page, 'group:Dump');
    await page.keyboard.press('Enter');
    await until(() => shownActions(page), ['dumpOre', 'dumpWater'], 'Enter did not open Dump');
  });

  await check('opening a level moves focus into it, not onto Back', async () => {
    await until(() => focused(page), 'dumpOre', 'focus after opening a level');
  });

  await check('Escape leaves the level and restores focus to the button that opened it', async () => {
    await page.keyboard.press('Escape');
    await until(() => shownGroups(page), ['Dump', 'More'], 'Escape did not leave the level');
    await until(() => focused(page), 'group:Dump', 'focus after Escape');
  });

  await check('the keyboard walk sent nothing either', () => {
    const during = sent.slice(sentBeforeNavigating);
    assert(during.length === 0, `the keyboard walk sent ${during.length} frame(s)`);
  });

  // ── Taking a grouped leaf, and what the panel does afterwards ────────
  await check('a grouped leaf starts the real action and the world takes it', async () => {
    await surfaceOf(page).locator('[data-bs-action-group="Dump"]').click();
    await surfaceOf(page).locator('[data-bs-action="dumpOre"]').click();
    await surfaceOf(page).locator('text=/over the side/').first().waitFor({ timeout: 20_000 });
    assert(
      sent.length > sentBeforeNavigating,
      'taking the action sent nothing, so nothing was submitted',
    );
  });

  await check('the panel comes back to the level the action was taken from', async () => {
    // `dumpOre` spent the ore, so it is gone and `dumpWater` is not. The
    // player is still standing in Dump, which is the coherent answer.
    await until(() => shownActions(page), ['dumpWater'], 'the level after the action');
    assert((await levelLabel(page)) === 'Dump', `the level said "${await levelLabel(page)}"`);
  });

  await check('emptying the open group lands the player on the top level and says so', async () => {
    await surfaceOf(page).locator('[data-bs-action="dumpWater"]').click();
    await until(() => shownGroups(page), ['More'], 'the top level after Dump emptied');
    assert((await levelLabel(page)) === null, 'the panel stayed inside a group that is gone');
    const said = await announcement(page);
    assert(
      said.includes('Dump') && said.includes('no longer available'),
      `the live region said "${said}"`,
    );
  });

  await check('focus is not stranded when the level goes away underneath it', async () => {
    const at = await focused(page);
    assert(at !== null, 'focus fell to the document body when the group emptied');
  });

  await context.close();
}

/**
 * TWO SEATS, one of them standing in a level the other takes away.
 *
 * This is the case no single page can arrange and `setProps` cannot imitate: a
 * world re-pushing one seat's offers because ANOTHER seat acted, arriving
 * through the fan-out, the socket and the frame.
 */
async function anotherSeatMovesTheLevel({ browser, hostUrl }) {
  const watcher = await browser.newContext();
  const other = await browser.newContext();
  const page = await watcher.newPage();
  const second = await other.newPage();
  await page.goto(hostUrl);
  await seated(page);
  await second.goto(hostUrl);
  await seated(second);

  await check('a leaf with a selection walks the ordinary controller', async () => {
    await surfaceOf(page).locator('[data-bs-action-group="More"]').click();
    await surfaceOf(page).locator('[data-bs-action-group="Empire settings"]').click();
    await surfaceOf(page).locator('[data-bs-action="renamePlanet"]').click();
    // The action's own form, drawn by the panel exactly as it is at the top
    // level: grouping stops at the start button.
    await surfaceOf(page).locator('.action-config input[type="text"]').waitFor({ timeout: 15_000 });
  });

  await check('cancelling returns the player to the level they started from', async () => {
    await surfaceOf(page).locator('.action-config .cancel-btn').click();
    await until(
      () => shownActions(page),
      ['renamePlanet', 'describeEmpire'],
      'the level after cancelling',
    );
    assert(
      (await levelLabel(page)) === 'More / Empire settings',
      `the level said "${await levelLabel(page)}"`,
    );
  });

  await check("another seat's action truncates the open level to its surviving parent", async () => {
    await surfaceOf(page).locator('[data-bs-action="renamePlanet"]').focus();
    // Seat two closes the registry, which is what both settings verbs are
    // conditional on. Seat one is standing INSIDE that level and did
    // nothing at all.
    await surfaceOf(second).locator('[data-bs-action="closeRegistry"]').click();
    await until(() => shownActions(page), ['skipMission'], 'the level seat one was moved to');
    assert((await levelLabel(page)) === 'More', `the level said "${await levelLabel(page)}"`);
    const said = await announcement(page);
    assert(
      said.includes('Empire settings') && said.includes('no longer available'),
      `the live region said "${said}"`,
    );
  });

  await check('the keyboard is left somewhere operable, not on the body', async () => {
    await until(() => focused(page), 'skipMission', 'focus after being moved a level up');
  });

  await watcher.close();
  await other.close();
}

/** A NARROW SCREEN, where a flat row of seventeen buttons is nine rows. */
async function theMenuOnANarrowScreen({ browser, hostUrl }) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await context.newPage();
  await page.goto(hostUrl);
  await seated(page);

  await check('the menu is usable at 360px: the group button is hittable', async () => {
    const group = surfaceOf(page).locator('[data-bs-action-group="More"]');
    const box = await group.boundingBox();
    assert(box !== null, 'the group button has no box at all on a narrow screen');
    assert(box.width >= 44 && box.height >= 44, `the group button is ${box.width}x${box.height}`);
    await group.click();
    await until(() => shownActions(page), ['skipMission'], 'the More level on a narrow screen');
  });

  await check('nothing in the open level is off-screen or scrolls the page sideways', async () => {
    const overflow = await (await frameOf(page)).evaluate(() => {
      const root = document.scrollingElement;
      const wide = root.scrollWidth > root.clientWidth + 1;
      const outside = [
        ...document.querySelectorAll('[data-bs-action], [data-bs-action-group], [data-bs-menu-back]'),
      ]
        .map((el) => {
          const box = el.getBoundingClientRect();
          return { text: el.textContent.trim().slice(0, 24), left: box.left, right: box.right };
        })
        .filter((box) => box.left < -1 || box.right > root.clientWidth + 1);
      return { wide, outside, width: root.clientWidth };
    });
    assert(!overflow.wide, 'the panel made the page scroll sideways at 360px');
    assert(
      overflow.outside.length === 0,
      `controls sat outside the ${overflow.width}px viewport: ${JSON.stringify(overflow.outside)}`,
    );
  });

  await check('the current-level label and Back are both on screen at 360px', async () => {
    await surfaceOf(page).locator('.action-menu-label').waitFor({ timeout: 10_000 });
    await surfaceOf(page).locator('[data-bs-menu-back]').waitFor({ timeout: 10_000 });
    assert((await levelLabel(page)) === 'More', `the label read "${await levelLabel(page)}"`);
  });

  await context.close();
}

requireInstalledCheckout(SCRIPT);
process.exit(await main());
