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
 *      `:hover` until the next tap elsewhere, in both browsers, so the hand's
 *      hover lift sticks until #1606 gates hover styles on `(hover: hover)`.
 *   4. Dragging my pawn onto a square by touch marks the drop targets, and the
 *      square under the finger, while it is dragged, and moves it there. Drag is
 *      pointer-event drag (#1605); native HTML5 drag never starts from touch.
 *   5. At 1440x900 the same drag by mouse still works.
 *
 * Chromium's drag is real touch, sent through CDP. WebKit has no way to move a
 * touch, so its drag is `PointerEvent`s dispatched in the page, with no live
 * pointer behind them: `setPointerCapture` captures nothing for them.
 * docs/browser-testing.md says what emulation cannot prove at all.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/touch-phone-browser.mjs`.
 */
import { assert, check, knownFailure, onFreshPage, runBrowserRegression, summarise, waitUntil } from './browser-harness.mjs';

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

const HOVER_STUCK = 'still shows its hover style after the tap';

await runBrowserRegression(
  {
    script: 'touch-phone-browser.mjs',
    engines: ['chromium', 'webkit'],
    table: { files: { 'src/rules/elements.ts': ELEMENTS, 'src/rules/game.ts': GAME, 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } },
  },
  async ({ launch, engine, hostUrl }) => {
    const browser = await launch();
    try {
      let player;
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        const size = `${viewport.width}x${viewport.height}`;
        const phone = { viewport, hasTouch: true, isMobile: true, reducedMotion: 'reduce', storageState: player };
        await onFreshPage(browser, hostUrl, phone, myPawnReady, async (page) => {
          // Later pages reclaim this seat with the same client id; a new one would be a second, unseated player.
          player ??= await page.context().storageState();
          const frame = gameFrame(page);

          await check(`${size}: the shell, the action bar, the hand and the board all show, and the page does not scroll sideways`, async () => {
            const measure = () => frame.locator('body').evaluate((body, hand) => {
              const doc = body.ownerDocument;
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

          await knownFailure(`${size}: a tapped card shows no hover style`, { issue: '#1606', because: HOVER_STUCK }, async () => {
            const card = frame.locator(`${MY_HAND} .hand-card`).last();
            // Without transitions the hover style shows the moment the tap lands, so one read after it is the answer.
            await frame.locator('head').evaluate((head) => head.appendChild(head.ownerDocument.createElement('style')).append('* { transition: none !important; }'));
            const look = () => card.evaluate((el) => ({ transform: getComputedStyle(el).transform, zIndex: getComputedStyle(el).zIndex, hover: el.matches(':hover') }));
            const before = await look();
            await card.tap();
            const after = await look();
            assert(
              after.transform === before.transform && after.zIndex === before.zIndex,
              `the tapped card ${HOVER_STUCK}: transform ${before.transform} became ${after.transform} and z-index ${before.zIndex} became ${after.zIndex}, with :hover ${after.hover}`,
            );
          });

          await check(`${size}: dragging my pawn onto a square by touch marks the drop targets and the square under my finger, and moves it there`, async () => {
            await dragsAndDrops(frame, (move, whileOver) => touchDrag(page, engine, frame, move, whileOver));
          });

          await check(`${size}: tapping my pawn, then an empty square, moves it`, async () => {
            const { pawn, to } = await aMove(frame);
            await pawnNamed(frame, pawn).tap();
            await cellAt(frame, to).tap();
            const now = await waitUntil(() => squareOf(frame, pawn), (at) => at === to, 10_000);
            assert(now === to, `my pawn is on square ${now}, not the tapped square ${to}`);
          });
        });
      }
      await onFreshPage(browser, hostUrl, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', storageState: player }, myPawnReady, async (page) => {
        const frame = gameFrame(page);
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
