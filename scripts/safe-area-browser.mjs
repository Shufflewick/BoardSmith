#!/usr/bin/env node
/**
 * THE SHELL KEEPS OUT OF THE SAFE AREAS THE HOST SENDS, AND SIZES ITS CONTROLS FOR A FINGER (#1611).
 *
 * Inside an iframe `env(safe-area-inset-*)` cannot be trusted (Chrome reads 0,
 * Safari the parent's values), so the host page sends the frame's four insets
 * in a `safe_area` message and the shell pads itself by them. No emulated
 * viewport has a notch, so this script gives the dev host's page the insets an
 * iPhone reports, by padding the probe it reads them from, and holds the shell
 * to what the dev host sends: the part of each inset over the frame. On a phone
 * held either way no control sits inside an inset, with the action bar up and
 * put down, the controls menu open and the phone strip expanded, and on a
 * coarse pointer every shell control takes a 44px tap (WCAG 2.5.5, Apple's 44pt).
 * The sample's actions carry help, and its play action a second pick, so the
 * action's "?" and a made pick's clear button are among those controls (#1636).
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/safe-area-browser.mjs`.
 */
import { assert, check, runBrowserRegression, settle, step, summarise, waitUntil } from './browser-harness.mjs';

/** Help on both actions, so each draws its "?", and a second pick, so a made pick shows its clear button (#1636). */
const ACTIONS = `import { Action, type ActionDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';
import { Card } from './elements.js';

export function createDrawAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('draw')
    .prompt('Draw a card from the deck')
    .help('Take the top card of the deck into your hand.')
    .execute((args, ctx) => {
      ctx.game.deck.first(Card)?.putInto(ctx.player.hand);
      return { success: true };
    });
}

export function createPlayAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('play')
    .prompt('Play a card from your hand')
    .help('Score a card from your hand.')
    .chooseFrom('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => [...ctx.player.hand.all(Card)],
    })
    .chooseFrom('side', {
      prompt: 'Select a side to play it on',
      choices: () => ['left', 'right'],
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

/** The game frame on `page`, once its Action Panel offers the draw and its "?". */
async function openTable(page, hostUrl) {
  await page.goto(hostUrl);
  await page.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
  const frame = page.frameLocator('.dev-host__frame');
  await frame.locator('button[aria-label="Help for Draw a card from the deck"]').waitFor({ timeout: 60_000 });
  return frame;
}

/** What a notched iPhone reports to the page in each orientation. */
const PHONES = [
  { viewport: { width: 390, height: 844 }, page: { top: 47, right: 0, bottom: 34, left: 0 } },
  { viewport: { width: 844, height: 390 }, page: { top: 0, right: 47, bottom: 21, left: 47 } },
];

const SIDES = ['top', 'right', 'bottom', 'left'];

const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

/**
 * What a finger finds, as lines naming each control.
 *
 * `inInsets`: each control a tap inside an inset would reach, found by tapping
 * every 4px of the four insets, so a control drawn under the bar or scrolled out
 * of its region does not count and a hit area a pseudo-element draws does.
 *
 * `small`: each shell control (not the board's own pieces) a tap can reach where
 * a 44px cross centred on it, moved inside the insets, is not its own at every
 * end: inside its box, or a tap there lands on it.
 */
function taps(frame, insets) {
  return frame.locator('body').evaluate((body, { insets, controls }) => {
    const doc = body.ownerDocument;
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    const name = (el) => (el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : 'nothing');
    const half = 21.5;
    const within = (value, low, high) => Math.min(Math.max(value, low + half + 0.5), high - half - 0.5);
    const centre = (box) => [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
    const inInset = (x, y) => y < insets.top || y > height - insets.bottom || x < insets.left || x > width - insets.right;

    const inInsets = new Map();
    for (let y = 0.5; y < height; y += 4) {
      for (let x = 0.5; x < width; x += 4) {
        const control = inInset(x, y) ? doc.elementFromPoint(x, y)?.closest(controls) : null;
        if (control && !inInsets.has(control)) inInsets.set(control, `${name(control)} at ${Math.round(x)},${Math.round(y)}`);
      }
    }

    // A point inside its own box counts even under a neighbour: that is an overlap, not a size.
    const missed = (el, box) => {
      const [cx, cy] = centre(box);
      const x = within(cx, insets.left, width - insets.right);
      const y = within(cy, insets.top, height - insets.bottom);
      return [[x, y], [x - half, y], [x + half, y], [x, y - half], [x, y + half]]
        .filter(([px, py]) => px < box.left || px > box.right || py < box.top || py > box.bottom)
        .map(([px, py]) => doc.elementFromPoint(px, py))
        .filter((hit) => !el.contains(hit));
    };
    const board = doc.querySelector('.game-shell__zoom-container');
    const small = [...doc.querySelectorAll(controls)]
      .filter((el) => el.checkVisibility() && !board.contains(el))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      // Reachable: what a tap on its centre lands on, so one off screen or under the phone strip's scrim is left out.
      .filter(({ el, box }) => el.contains(doc.elementFromPoint(...centre(box))))
      .map(({ el, box }) => ({ el, box, misses: missed(el, box) }))
      .filter(({ misses }) => misses.length > 0)
      .map(({ el, box, misses }) => `${name(el)} (${Math.round(box.width)}x${Math.round(box.height)}, a tap beside it lands on ${misses.map(name).join(', ')})`);
    return { inInsets: [...inInsets.values()], small };
  }, { insets, controls: CONTROLS });
}

/** The two checks every state of the shell is held to. */
async function checkTaps(frame, insets, state, size) {
  const found = await step(`measuring the taps with ${state} at ${size}`, async () => {
    await settle(frame);
    return taps(frame, insets);
  });
  await check(`no control sits inside an inset with ${state} at ${size}`, () => {
    assert(found.inInsets.length === 0, `inside ${JSON.stringify(insets)}: ${found.inInsets.join('; ')}`);
  });
  await check(`every shell control takes a 44px tap with ${state} at ${size}`, () => {
    assert(found.small.length === 0, `smaller than 44px: ${found.small.join('; ')}`);
  });
}

/** How far each of the page's insets reaches over the game frame: what the dev host must send. */
function overFrame(page, insets) {
  return page.locator('.dev-host__frame').evaluate((frame, insets) => {
    const box = frame.getBoundingClientRect();
    const gaps = { top: box.top, right: innerWidth - box.right, bottom: innerHeight - box.bottom, left: box.left };
    return Object.fromEntries(Object.entries(insets).map(([side, inset]) => [side, Math.max(0, inset - gaps[side])]));
  }, insets);
}

/** The four `--bsg-safe-*` the shell resolved, in px. */
function shellInsets(frame) {
  return frame.locator('body').evaluate((body, sides) => {
    const root = getComputedStyle(body.ownerDocument.documentElement);
    return Object.fromEntries(sides.map((side) => [side, parseFloat(root.getPropertyValue(`--bsg-safe-${side}`))]));
  }, SIDES);
}

/** Open a state with `open`, hold the shell to both checks in it and to `also`, if any, and leave it with `close`. */
async function inState(frame, insets, size, state, { open, also, close }) {
  await step(`opening ${state} at ${size}`, open);
  await checkTaps(frame, insets, state, size);
  await also?.();
  await step(`closing ${state} at ${size}`, close);
}

await runBrowserRegression({ script: 'safe-area-browser.mjs', engines: ['chromium', 'webkit'], table: { files: { 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } } }, async ({ launch, hostUrl }) => {
  const browser = await launch();
  let player;
  try {
    for (const { viewport, page: notch } of PHONES) {
      const size = `${viewport.width}x${viewport.height}`;
      // One seat throughout: a later page reclaims the first page's client id, as `onEachPhone` does.
      // Held the other way up first, so turning it is what brings the insets.
      const turned = { width: viewport.height, height: viewport.width };
      const context = await step(`opening a phone the other way up from ${size}`, () => browser.newContext({ viewport: turned, hasTouch: true, isMobile: true, reducedMotion: 'reduce', storageState: player }));
      try {
        const { page, frame } = await step(`opening the table held the other way up from ${size}`, async () => {
          const page = await context.newPage();
          const frame = await openTable(page, hostUrl);
          player ??= await context.storageState();
          return { page, frame };
        });

        // The page's own insets, where the dev host reads them, then the phone turned to them.
        const insets = await step(`turning the phone to ${size}`, async () => {
          await page.addStyleTag({ content: `.bsg-safe-area-probe { padding: ${notch.top}px ${notch.right}px ${notch.bottom}px ${notch.left}px !important; }` });
          await page.setViewportSize(viewport);
          return overFrame(page, notch);
        });
        await check(`the dev host sends the frame its safe areas, and the shell takes them, at ${size}: ${JSON.stringify(insets)}`, async () => {
          assert(SIDES.some((side) => insets[side] > 0), `the page's insets ${JSON.stringify(notch)} reach nowhere over the frame, so nothing is tested`);
          const read = await waitUntil(() => shellInsets(frame), (read) => SIDES.every((side) => read[side] === insets[side]));
          assert(SIDES.every((side) => read[side] === insets[side]), `the shell resolved ${JSON.stringify(read)}, not ${JSON.stringify(insets)}`);
        });
        await check(`what keeps clear of the action bar is told its height with the bottom inset at ${size}`, async () => {
          // The clearance follows the bar through a ResizeObserver and a render, a frame or more after the bar resizes (#1670).
          const { bar, clearance } = await waitUntil(
            () => frame.locator('[data-testid="bs-actionbar"]').evaluate((el) => ({
              bar: el.getBoundingClientRect().height,
              clearance: parseFloat(el.ownerDocument.querySelector('.board-viewport').style.getPropertyValue('--bsg-bar-clearance')),
            })),
            ({ bar, clearance }) => Math.abs(bar - clearance) < 0.5,
          );
          assert(Math.abs(bar - clearance) < 0.5, `--bsg-bar-clearance is ${clearance}px, but the bar is ${bar}px tall`);
        });

        await checkTaps(frame, insets, 'the action bar up', size);
        await inState(frame, insets, size, 'the controls menu open', {
          open: async () => {
            // A host page without the dev host's `* { box-sizing: border-box }`, so the menu's own CSS must size it (#1710).
            await frame.locator('head').evaluate((head) => head.append(Object.assign(head.ownerDocument.createElement('style'), { textContent: '.menu { box-sizing: content-box; }' })));
            await frame.locator('[data-testid="bs-actionbar"] .menubtn').click();
            await frame.locator('.menu').waitFor();
          },
          // A menu taller than the screen hides its far items where no tap or scroll reaches them (#1710).
          also: () => check(`the controls menu fits inside the safe areas at ${size}`, async () => {
            const { box, width, height } = await frame.locator('.menu').evaluate((el) => ({
              box: el.getBoundingClientRect().toJSON(),
              width: el.ownerDocument.documentElement.clientWidth,
              height: el.ownerDocument.documentElement.clientHeight,
            }));
            const inside = box.top >= insets.top && box.left >= insets.left && box.bottom <= height - insets.bottom && box.right <= width - insets.right;
            assert(inside, `the menu spans ${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)} in a ${width}x${height} frame with insets ${JSON.stringify(insets)}`);
          }),
          close: async () => {
            await page.keyboard.press('Escape');
            await frame.locator('.menu').waitFor({ state: 'detached' });
          },
        });
        await inState(frame, insets, size, 'a pick made in an open action', {
          open: async () => {
            await frame.locator('.action-btn[data-bs-action="play"]').click();
            await frame.locator('[data-testid="bs-actionbar"] .choice-btn').first().click();
            await frame.locator('.clear-selection-btn').waitFor();
          },
          close: async () => {
            await frame.locator('.cancel-btn').click();
            await frame.locator('.action-config').waitFor({ state: 'detached' });
          },
        });
        // The phone strip is the compact tier's alone.
        if (viewport.width < 640) {
          await inState(frame, insets, size, 'the phone strip expanded', {
            open: async () => {
              await frame.locator('.mobile-strip__toggle').click();
              await frame.locator('.sidebar.mobile-expanded .side-scroll').waitFor();
            },
            close: async () => {
              await frame.locator('.mobile-strip__toggle').click();
              await frame.locator('.sidebar.mobile-expanded').waitFor({ state: 'detached' });
            },
          });
        }
        await inState(frame, insets, size, 'the action bar put down', {
          open: async () => {
            await frame.locator('.bar-edge').click();
            await frame.locator('.actionbar.collapsed').waitFor();
          },
          close: async () => {
            await frame.locator('.bar-edge').click();
            await frame.locator('.actionbar.collapsed').waitFor({ state: 'detached' });
          },
        });
      } finally {
        await step(`closing the phone at ${size}`, () => context.close());
      }
    }
  } finally {
    await step('closing the browser', () => browser.close());
  }
  return summarise('for the safe areas and touch target sizes');
});
