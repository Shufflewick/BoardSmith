#!/usr/bin/env node
/**
 * THE BROWSER REGRESSION FOR PLAYING BY TOUCH ON A PHONE (#1604).
 *
 * Every other regression drives a mouse. This one emulates a phone, touch and
 * all (`hasTouch`, `isMobile`), at 390x844 and 844x390, in Chromium and in
 * WebKit, which is where iOS behaves differently, against the auto-UI's shell,
 * action panel, hand and square-grid board:
 *
 *   1. The shell, the action bar, the hand and the board all show, and the page
 *      does not scroll sideways.
 *   2. Tapping my pawn, then an empty square, moves it: the tap path works.
 *   3. Tapping a card leaves no hover style on it. A tapped element keeps
 *      `:hover` until the next tap elsewhere, in both browsers, so every hover
 *      style applies only under `(hover: hover)` (#1606). The squares show their
 *      coordinates, which a mouse player sees on hover.
 *   4. Dragging my pawn onto a square by touch marks the drop targets, and the
 *      square under the finger, while it is dragged, and moves it there. Drag is
 *      pointer-event drag (#1605); native HTML5 drag never starts from touch.
 *   5. At 1440x900 the same drag by mouse still works.
 *   6. No touch or wheel listener on the window, document or body can block
 *      scrolling, a long press on a card zooms it, and a long press on a card
 *      cancels its context menu and iOS callout while one on a square does not (#1607).
 *   7. Two fingers pinch the board to 200% about the point between them, one
 *      finger on an empty square pans it, and one on my pawn drags it instead,
 *      and a tap on my pawn still chooses it (#1609). Chromium only, since a
 *      pinch needs two real touches.
 *
 * Chromium's drag is real touch, sent through CDP. WebKit has no way to move a
 * touch, so its drag is `PointerEvent`s dispatched in the page, with no live
 * pointer behind them: `setPointerCapture` captures nothing for them.
 * docs/browser-testing.md says what emulation cannot prove at all.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/touch-phone-browser.mjs`.
 */
import { assert, check, onEachPhone, onFreshPage, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

const ELEMENTS = `import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck, Grid, GridCell, Piece, Space } from 'boardsmith';

export type Suit = 'H' | 'D' | 'C' | 'S';

export class Card extends BaseCard {
  suit!: Suit;
  rank!: string;
  points!: number;
}

export class Hand extends BaseHand {}

export class Deck extends BaseDeck {}

export class PlayArea extends Space {}

export class Board extends Grid {
  $rowCoord = 'row';
  $colCoord = 'col';
}

export class Square extends GridCell {
  declare row: number;
  col!: number;
}

export class Pawn extends Piece {}
`;

/** A 4x4 board with two pawns per seat, so choosing one is a real pick, and a hand of five cards each that no action asks for. */
const GAME = `import { Game, Player, type GameOptions } from 'boardsmith';
import { Board, Card, Deck, Hand, Pawn, Square } from './elements.js';
import { createGameFlow } from './flow.js';
import { createMoveAction } from './actions.js';

export class TableFixturePlayer extends Player<TableFixtureGame, TableFixturePlayer> {
  hand!: Hand;
  score = 0;
}

export class TableFixtureGame extends Game<TableFixtureGame, TableFixturePlayer> {
  static PlayerClass = TableFixturePlayer;

  board!: Board;
  deck!: Deck;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand, Deck, Board, Square, Pawn]);
    this.board = this.create(Board, 'board');
    this.board.contentsVisible();
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) this.board.create(Square, \`square-\${col}-\${row}\`, { row, col });
    }
    this.deck = this.create(Deck, 'deck');
    for (const suit of ['H', 'D', 'C', 'S'] as const) {
      for (const rank of ['A', '2', '3', '4', '5']) this.deck.create(Card, \`\${rank}\${suit}\`, { suit, rank, points: 1 });
    }
    for (const player of this.players) {
      const hand = this.create(Hand, \`hand-\${player.seat}\`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      player.hand = hand;
      for (let i = 0; i < 5; i++) this.deck.first(Card)?.putInto(hand);
      for (const col of [0, 1]) this.board.first(Square, { row: player.seat - 1, col })!.create(Pawn, \`pawn-\${player.seat}-\${col}\`, { player });
    }
    this.registerAction(createMoveAction());
    this.setFlow(createGameFlow());
  }
}
`;

const ACTIONS = `import { Action, type ActionDefinition } from 'boardsmith';
import { Pawn, Square } from './elements.js';
import type { TableFixtureGame } from './game.js';

export function createMoveAction(): ActionDefinition {
  return Action.create<TableFixtureGame>('move')
    .prompt('Move your pawn')
    .chooseElement('pawn', {
      prompt: 'Select your pawn',
      elementClass: Pawn,
      from: (ctx) => ctx.game.board,
      filter: (pawn, ctx) => pawn.player?.seat === ctx.player.seat,
    })
    .chooseElement('square', {
      prompt: 'Select an empty square',
      elementClass: Square,
      from: (ctx) => ctx.game.board,
      filter: (square) => square.count(Pawn) === 0,
    })
    .execute(({ pawn, square }) => {
      pawn.putInto(square);
      return { success: true };
    });
}
`;

/** Seat 1 moves for ever, so every page of the run is offered the move. */
const FLOW = `import { loop, actionStep, type FlowDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

export function createGameFlow(): FlowDefinition<TableFixtureGame> {
  return { root: loop({ name: 'moves', unbounded: true, do: actionStep({ name: 'move-step', actions: ['move'] }) }) };
}
`;

const gameFrame = (page) => page.frameLocator('.dev-host__frame');
const MY_PAWN = '.piece[data-bs-candidate]';
/** This page's own hand: the first page of a run is seat 1, and later pages reclaim it. */
const MY_HAND = '[data-bs-el-name="hand-1"]';
const myPawnReady = (page) => gameFrame(page).locator(MY_PAWN).first().waitFor({ timeout: 60_000 });

/** The name of a pawn of mine the move will take, and an empty square as far from it as the board allows. */
function aMove(frame) {
  return frame.locator('.board-grid').evaluate((grid) => {
    const cells = [...grid.querySelectorAll('.grid-cell')];
    return {
      pawn: grid.querySelector('.piece[data-bs-candidate]').dataset.bsElName,
      to: cells.findLastIndex((cell) => !cell.querySelector('.piece')),
    };
  });
}

const cellAt = (frame, index) => frame.locator('.grid-cell').nth(index);
const pawnNamed = (frame, pawn) => frame.locator(`.piece[data-bs-el-name="${pawn}"]`);

/** The index of the square the pawn stands on. */
const squareOf = (frame, pawn) =>
  frame.locator('.board-grid').evaluate((grid, pawn) => [...grid.querySelectorAll('.grid-cell')].findIndex((cell) => cell.querySelector(`[data-bs-el-name="${pawn}"]`)), pawn);

/**
 * Press the pawn, move the finger onto the square at `to` in steps, then lift it.
 * `whileOver` runs with the finger still down over the square.
 */
async function touchDrag(page, engine, frame, { pawn: name, to }, whileOver) {
  const pawn = pawnNamed(frame, name);
  const start = await pawn.boundingBox();
  const end = await cellAt(frame, to).boundingBox();
  const at = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const path = Array.from({ length: 6 }, (_, step) => ({
    x: at(start).x + ((at(end).x - at(start).x) * (step + 1)) / 6,
    y: at(start).y + ((at(end).y - at(start).y) * (step + 1)) / 6,
  }));
  if (engine === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(start)] });
    for (const point of path) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    try {
      await whileOver();
    } finally {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    }
    return;
  }
  // The page's own coordinates: the points above are the outer page's.
  const frameBox = await page.locator('.dev-host__frame').boundingBox();
  const inFrame = ({ x, y }) => ({ x: x - frameBox.x, y: y - frameBox.y });
  const send = (type, point) =>
    pawn.evaluate((el, { type, point }) => {
      const target = type === 'pointerdown' ? el : (el.ownerDocument.elementFromPoint(point.x, point.y) ?? el.ownerDocument.body);
      const init = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: point.x, clientY: point.y };
      target.dispatchEvent(new PointerEvent(type, { ...init, buttons: type === 'pointerup' ? 0 : 1 }));
    }, { type, point: inFrame(point) });
  await send('pointerdown', at(start));
  for (const point of path) await send('pointermove', point);
  try {
    await whileOver();
  } finally {
    await send('pointerup', path.at(-1));
  }
}

/** Press the pawn with the mouse, move onto the square at `to` in steps, then let go. */
async function mouseDrag(page, frame, { pawn, to }, whileOver) {
  // hover() waits for the pawn to stop moving, as the board settles its fit after the page loads.
  await pawnNamed(frame, pawn).hover();
  const box = await cellAt(frame, to).boundingBox();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  try {
    await whileOver();
  } finally {
    await page.mouse.up();
  }
}

/** Drag a pawn of mine onto an empty square with `drag`, asserting the drop feedback while it is held there and the move after. */
async function dragsAndDrops(frame, drag) {
  const move = await aMove(frame);
  await drag(move, async () => {
    const marked = await waitUntil(
      () => cellAt(frame, move.to).evaluate((cell) => ({ targets: cell.parentElement.querySelectorAll('.grid-cell.is-drop-target').length, under: cell.classList.contains('is-drop-hover') })),
      (now) => now.targets > 0 && now.under,
      5_000,
    );
    assert(marked.targets > 0, 'the drag never started: no square was marked as a drop target with the pointer over one');
    assert(marked.under, 'the square under the pointer is not marked as the one the pawn will drop on');
  });
  const now = await waitUntil(() => squareOf(frame, move.pawn), (at) => at === move.to, 5_000);
  assert(now === move.to, `the drop left my pawn on square ${now}, not square ${move.to}`);
}


/** Records, in every frame, each touch and wheel listener the page adds to the window, document or body, with its target and passive flag. */
function recordPageListeners() {
  const added = (window.__pageListeners = []);
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const target = this === window ? 'window' : this === document ? 'document' : this === document.body ? 'body' : null;
    // Playwright's own InjectedScript adds a touchstart listener to the window; it is not the page's.
    if (target && /^(touchstart|touchmove|wheel|mousewheel)$/.test(type) && !/InjectedScript/.test(new Error().stack)) {
      added.push({ target, type, passive: options && typeof options === 'object' ? options.passive : undefined });
    }
    return add.call(this, type, listener, options);
  };
}

/** Put a finger on each of `from`, move each in steps to its `to`, run `whileHeld`, then lift them all. Chromium only: real touch through CDP. */
async function touchGesture(page, from, to, whileHeld = async () => {}) {
  const points = (step) => from.map((start, id) => ({ id, x: start.x + ((to[id].x - start.x) * step) / 8, y: start.y + ((to[id].y - start.y) * step) / 8 }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
  try {
    for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) });
    await whileHeld();
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
}

/** The board's scale, how far the board region is scrolled each way, and the board element under the outer page's point `at`. */
const boardView = (page, frame, at) =>
  frame.locator('.boardregion').evaluate((region, at) => {
    const board = region.querySelector('.game-shell__zoom-container');
    const frameBox = window.frameElement.getBoundingClientRect();
    const under = at && region.ownerDocument.elementFromPoint(at.x - frameBox.x, at.y - frameBox.y)?.closest('[data-bs-el-name]');
    return { scale: board.getBoundingClientRect().width / board.offsetWidth, left: region.scrollLeft, top: region.scrollTop, under: under?.dataset.bsElName };
  }, at);

/** The centre, in the outer page, of the first square with no piece on it. */
const anEmptySquare = (frame) =>
  frame.locator('.board-grid .grid-cell:not(:has(.piece))').first().evaluate((cell) => {
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const box = cell.getBoundingClientRect();
    const frameBox = window.frameElement.getBoundingClientRect();
    return { x: frameBox.x + box.x + box.width / 2, y: frameBox.y + box.y + box.height / 2 };
  });

/** Two fingers pinch, one pans on an empty square, one on my pawn drags it, and a tap on my pawn chooses it (#1609). */
async function pinchesAndPans(page, frame) {
  await check('390x844: two fingers spread on the board magnify it to 200%, keeping the square between them under them', async () => {
    const centre = await anEmptySquare(frame);
    const before = await boardView(page, frame, centre);
    await touchGesture(page, [{ x: centre.x - 10, y: centre.y }, { x: centre.x + 10, y: centre.y }], [{ x: centre.x - 60, y: centre.y }, { x: centre.x + 60, y: centre.y }]);
    const after = await waitUntil(() => boardView(page, frame, centre), (now) => now.scale > 1.99);
    assert(Math.abs(after.scale - 2) < 0.01, `the pinch left the board at ${after.scale}x, not the 2x it is capped at`);
    assert(after.under === before.under, `the pinch moved ${before.under} out from between the fingers; ${after.under} is there now`);
  });

  await check('390x844: one finger on an empty square pans the magnified board', async () => {
    await frame.locator('.boardregion').evaluate((region) => region.scrollTo(0, 0));
    const start = await anEmptySquare(frame);
    const before = await boardView(page, frame);
    await touchGesture(page, [start], [{ x: start.x - 60, y: start.y - 60 }]);
    const after = await waitUntil(() => boardView(page, frame), (now) => now.left !== before.left && now.top !== before.top);
    assert(Math.abs(after.left - before.left - 60) < 2 && Math.abs(after.top - before.top - 60) < 2, `panning 60px up and left scrolled the board from ${JSON.stringify(before)} to ${JSON.stringify(after)}`);
    assert(after.scale === before.scale, `panning changed the board's scale from ${before.scale} to ${after.scale}`);
  });

  await check('390x844: a tap on my pawn on the magnified board still chooses it', async () => {
    const { pawn } = await aMove(frame);
    await pawnNamed(frame, pawn).tap();
    const prompt = () => frame.locator('body').evaluate((body) => body.querySelector('.selection-prompt')?.textContent.trim() ?? body.querySelector('[data-testid="bs-actionbar"]')?.textContent.trim());
    const now = await waitUntil(prompt, (text) => text === 'Select an empty square');
    assert(now === 'Select an empty square', `tapping my pawn left the action bar at "${now}"`);
    await frame.locator('.cancel-btn').tap();
    await waitUntil(prompt, (text) => text === 'Select your pawn');
  });

  await check('390x844: one finger on my pawn drags it rather than panning the board', async () => {
    const { pawn } = await aMove(frame);
    const box = await pawnNamed(frame, pawn).boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const before = await boardView(page, frame);
    await touchGesture(page, [start], [{ x: start.x + 60, y: start.y + 60 }], async () => {
      const dragging = await waitUntil(() => frame.locator('.grid-cell.is-drop-target').count(), (targets) => targets > 0, 5_000);
      assert(dragging > 0, 'the drag never started: no square was marked as a drop target');
      const held = await boardView(page, frame);
      assert(held.left === before.left && held.top === before.top, `dragging my pawn panned the board from ${JSON.stringify(before)} to ${JSON.stringify(held)}`);
    });
  });
}

/** Hold a finger on `locator` until `until` is true, then lift it. Chromium only: WebKit has no way to hold a touch. */
async function longPress(page, locator, until) {
  // Clear of the floating action bar, which covers the bottom of the board region.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
  const box = await locator.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  try {
    return await waitUntil(until, (seen) => seen, 5_000);
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
}

await runBrowserRegression(
  {
    script: 'touch-phone-browser.mjs',
    engines: ['chromium', 'webkit'],
    table: { files: { 'src/rules/elements.ts': ELEMENTS, 'src/rules/game.ts': GAME, 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } },
  },
  async ({ launch, engine, hostUrl }) => {
    const browser = await launch();
    try {
      const player = await onEachPhone(browser, hostUrl, myPawnReady, async (page, size) => {
        const frame = gameFrame(page);

        await check(`${size}: the shell, the action bar, the hand and the board all show, the hand once the board region scrolls to it, and the page does not scroll sideways`, async () => {
          const measure = () => frame.locator('body').evaluate((body, hand) => {
            const doc = body.ownerDocument;
            // The board is never shrunk to fit, so on a short screen the hand is below it (#1608).
            doc.querySelector(`${hand} .hand-cards`)?.scrollIntoView({ block: 'nearest' });
            const shown = (selector) => {
              const box = doc.querySelector(selector)?.getBoundingClientRect();
              return !!box && box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0;
            };
            return {
              shell: shown('.game-shell'),
              bar: shown('[data-testid="bs-actionbar"]'),
              hand: shown(`${hand} .hand-cards`),
              cards: doc.querySelectorAll(`${hand} .hand-card`).length,
              board: shown('.board-grid'),
              squares: doc.querySelectorAll('.grid-cell').length,
              sideways: doc.scrollingElement.scrollWidth - innerWidth,
            };
          }, MY_HAND);
          const seen = await waitUntil(measure, (now) => now.shell && now.bar && now.hand && now.cards === 5 && now.board && now.squares === 16 && now.sideways <= 0);
          assert(seen.shell && seen.bar, `the shell or the action bar is not on screen: ${JSON.stringify(seen)}`);
          assert(seen.hand && seen.cards === 5, `my hand is not on screen with its five cards: ${JSON.stringify(seen)}`);
          assert(seen.board && seen.squares === 16, `the board is not on screen with its 16 squares: ${JSON.stringify(seen)}`);
          assert(seen.sideways <= 0, `the page scrolls ${seen.sideways}px sideways`);
        });

        await check(`${size}: a tapped card shows no hover style`, async () => {
          const card = frame.locator(`${MY_HAND} .hand-card`).last();
          // Without transitions the hover style shows the moment the tap lands, so one read after it is the answer.
          await frame.locator('head').evaluate((head) => head.appendChild(head.ownerDocument.createElement('style')).append('* { transition: none !important; }'));
          const look = () => card.evaluate((el) => ({ transform: getComputedStyle(el).transform, zIndex: getComputedStyle(el).zIndex, hover: el.matches(':hover') }));
          const before = await look();
          await card.tap();
          const after = await look();
          assert(
            after.transform === before.transform && after.zIndex === before.zIndex,
            `the tapped card still shows its hover style after the tap: transform ${before.transform} became ${after.transform} and z-index ${before.zIndex} became ${after.zIndex}, with :hover ${after.hover}`,
          );
        });

        await check(`${size}: the squares show their coordinates without a hover`, async () => {
          const labels = await frame.locator('.cell-notation').evaluateAll((all) => ({ all: all.length, hidden: all.filter((label) => getComputedStyle(label).opacity !== '1').length }));
          assert(labels.all === 16, `the board shows ${labels.all} square coordinates, not one on each of its 16 squares`);
          assert(labels.hidden === 0, `${labels.hidden} square coordinates are hidden until hovered, which a finger cannot do`);
        });

        await check(`${size}: dragging my pawn onto a square by touch marks the drop targets and the square under my finger, and moves it there`, async () => {
          await dragsAndDrops(frame, (move, whileOver) => touchDrag(page, engine, frame, move, whileOver));
        });

        await check(`${size}: a first tap on a pawn's button in the action bar highlights the pawn, and a second tap chooses it`, async () => {
          const { pawn } = await aMove(frame);
          const button = frame.locator('.element-btn', { hasText: pawn });
          const state = () => frame.locator('body').evaluate((body, pawn) => ({
            highlighted: !!body.querySelector(`.piece[data-bs-el-name="${pawn}"].is-board-highlighted`),
            prompt: body.querySelector('.selection-prompt')?.textContent.trim(),
          }), pawn);
          await button.tap();
          const previewed = await waitUntil(state, (now) => now.highlighted);
          assert(previewed.highlighted && previewed.prompt === 'Select your pawn', `the first tap did not just highlight ${pawn}: ${JSON.stringify(previewed)}`);
          await button.tap();
          const chosen = await waitUntil(state, (now) => now.prompt === 'Select an empty square');
          assert(chosen.prompt === 'Select an empty square', `the second tap did not choose ${pawn}: ${JSON.stringify(chosen)}`);
          await frame.locator('.cancel-btn').tap();
          await waitUntil(state, (now) => now.prompt === 'Select your pawn');
        });

        await check(`${size}: tapping my pawn, then an empty square, moves it`, async () => {
          const { pawn, to } = await aMove(frame);
          await pawnNamed(frame, pawn).tap();
          await cellAt(frame, to).tap();
          const now = await waitUntil(() => squareOf(frame, pawn), (at) => at === to, 10_000);
          assert(now === to, `my pawn is on square ${now}, not the tapped square ${to}`);
        });

        if (engine === 'chromium' && size === '390x844') await pinchesAndPans(page, frame);
      });
      await onFreshPage(browser, hostUrl, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', storageState: player }, myPawnReady, async (page) => {
        // The listeners are added as the game loads, so record them from a reload that keeps this seat.
        await page.addInitScript(recordPageListeners);
        await page.reload();
        await myPawnReady(page);
        const frame = gameFrame(page);

        await check('390x844: no touch or wheel listener on the window, document or body can block scrolling', async () => {
          const added = await frame.locator('body').evaluate((body) => body.ownerDocument.defaultView.__pageListeners);
          assert(added.some((l) => l.target === 'body' && l.type === 'touchstart'), `the zoom's touchstart listener on the body was not recorded, so the check saw nothing: ${JSON.stringify(added)}`);
          const blocking = added.filter((l) => l.passive === false);
          assert(blocking.length === 0, `these page-level listeners make every touch wait for the main thread before scrolling: ${JSON.stringify(blocking)}`);
        });

        await check('390x844: a long press on a card cancels its context menu and the iOS callout, and one on a square does not', async () => {
          const card = frame.locator(`${MY_HAND} .hand-card`).first();
          const square = frame.locator('.grid-cell').first();
          // A finger held down, then the context menu Android opens for a long press, then the finger lifted.
          const look = (locator) => locator.evaluate((el) => {
            const touch = (type) => {
              const event = new Event(type, { bubbles: true, cancelable: true });
              Object.defineProperty(event, 'touches', { value: type === 'touchstart' ? [{ clientX: 1, clientY: 1 }] : [] });
              el.dispatchEvent(event);
            };
            touch('touchstart');
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            el.dispatchEvent(event);
            touch('touchend');
            const style = getComputedStyle(el);
            return { cancelled: event.defaultPrevented, callout: CSS.supports('-webkit-touch-callout', 'none') ? style.getPropertyValue('-webkit-touch-callout') : 'unsupported', select: style.userSelect || style.webkitUserSelect };
          });
          const onCard = await look(card);
          const onSquare = await look(square);
          assert(onCard.cancelled, 'a long press on a card would open the context menu: its contextmenu event was not cancelled');
          assert(onCard.select === 'none', `a long press on a card would select its text: user-select is ${onCard.select}`);
          // Only iOS WebKit knows -webkit-touch-callout; desktop WebKit and Chromium drop it, so the real-phone check covers it.
          assert(onCard.callout === 'none' || onCard.callout === 'unsupported', `a long press on a card would show the iOS callout: -webkit-touch-callout is ${onCard.callout}`);
          assert(!onSquare.cancelled, 'a square cancelled its context menu; only zoomable cards should');
        });

        if (engine === 'chromium') {
          await check('390x844: a long press on a card zooms it', async () => {
            const card = frame.locator(`${MY_HAND} .hand-card`).first();
            const zoomed = await longPress(page, card, () => frame.locator('.zoom-preview-overlay').isVisible());
            assert(zoomed, 'holding a finger on a card did not show its zoom');
          });
        }
      });
      await onFreshPage(browser, hostUrl, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', storageState: player }, myPawnReady, async (page) => {
        const frame = gameFrame(page);
        await check('1440x900: the squares keep their 64px (#1608)', async () => {
          const sides = await frame.locator('.grid-cell').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
          assert(sides.length === 16 && sides.every((side) => Math.abs(side - 64) < 0.5), `the squares are ${JSON.stringify(sides)}px wide, not 64px`);
        });
        await check('1440x900: dragging my pawn onto a square by mouse marks the drop targets and the square under the pointer, and moves it there', async () => {
          await dragsAndDrops(frame, (move, whileOver) => mouseDrag(page, frame, move, whileOver));
        });
      });
    } finally {
      await browser.close();
    }
    return summarise('for playing by touch on a phone');
  },
);
