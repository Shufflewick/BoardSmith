#!/usr/bin/env node
/**
 * ON A PHONE, EVERY CELL, PIECE AND CARD IS AT LEAST A TAP WIDE (#1608).
 *
 * The auto-UI sizes its cells, pieces and cards from the board region's width,
 * down to a floor of `--bsg-tap-min` (44px), and the region scrolls when a
 * board cannot fit at that floor. Nothing shrinks the board to fit it.
 *
 * The fixture is a grid-board game with all of the built-in renderers: a 20x20
 * square grid, which cannot fit a phone at 44px a square, with pawns on it, a
 * hex board, a deck and a play area of pawns above it and a hand below it. At
 * 390x844 and 844x390, in Chromium and WebKit, every one of them is at least
 * 44px on its shorter side and the board region, not the page, scrolls. At 200%
 * the player's magnifier doubles them, and a tap still lands on the square
 * under the finger. At 1440x900 the squares shrink to fit the region's width
 * instead. The table sample (card archetype)
 * has its own check in `tap-floor-cards-browser.mjs`.
 *
 * Runs under `boardsmith test --browser`, or by hand with
 * `node scripts/tap-floor-phone-browser.mjs`.
 */
import { assert, check, onEachPhone, onFreshPage, runBrowserRegression, summarise, tapSizes, waitUntil } from './browser-harness.mjs';

const ELEMENTS = `import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck, Grid, GridCell, HexGrid, HexCell, Piece, Space } from 'boardsmith';

export class Card extends BaseCard {
  rank!: string;
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

export class HexBoard extends HexGrid {
  override $hexOrientation: 'flat' | 'pointy' = 'pointy';
  override $qCoord = 'q';
  override $rCoord = 'r';
}

export class Hex extends HexCell {
  q!: number;
  r!: number;
}

export class Pawn extends Piece {}
`;

const GAME = `import { Game, Player, type GameOptions } from 'boardsmith';
import { Board, Card, Deck, Hand, Hex, HexBoard, Pawn, PlayArea, Square } from './elements.js';
import { createGameFlow } from './flow.js';
import { createMoveAction } from './actions.js';

export class TableFixturePlayer extends Player<TableFixtureGame, TableFixturePlayer> {
  hand!: Hand;
  score = 0;
}

export class TableFixtureGame extends Game<TableFixtureGame, TableFixturePlayer> {
  static PlayerClass = TableFixturePlayer;

  board!: Board;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand, Deck, Board, Square, HexBoard, Hex, Pawn, PlayArea]);
    this.board = this.create(Board, 'board');
    this.board.contentsVisible();
    for (let row = 0; row < 20; row++) {
      for (let col = 0; col < 20; col++) this.board.create(Square, \`square-\${col}-\${row}\`, { row, col });
    }
    const hexes = this.create(HexBoard, 'hexes');
    hexes.contentsVisible();
    for (let r = 0; r < 5; r++) {
      for (let q = 0; q < 5; q++) hexes.create(Hex, \`hex-\${q}-\${r}\`, { q, r });
    }
    const deck = this.create(Deck, 'deck');
    for (let i = 0; i < 20; i++) deck.create(Card, \`card-\${i}\`, { rank: String(i) });
    const area = this.create(PlayArea, 'area');
    area.contentsVisible();
    for (let i = 0; i < 3; i++) area.create(Pawn, \`spare-\${i}\`);
    for (const player of this.players) {
      const hand = this.create(Hand, \`hand-\${player.seat}\`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      player.hand = hand;
      for (let i = 0; i < 5; i++) deck.first(Card)?.putInto(hand);
      this.board.first(Square, { row: player.seat - 1, col: 0 })!.create(Pawn, \`pawn-\${player.seat}\`, { player });
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
    .chooseElement('pawn', { elementClass: Pawn, from: (ctx) => ctx.game.board, filter: (pawn, ctx) => pawn.player?.seat === ctx.player.seat })
    .chooseElement('square', { elementClass: Square, from: (ctx) => ctx.game.board, filter: (square) => square.count(Pawn) === 0 })
    .execute(({ pawn, square }) => {
      pawn.putInto(square);
      return { success: true };
    });
}
`;

const FLOW = `import { loop, actionStep, type FlowDefinition } from 'boardsmith';
import type { TableFixtureGame } from './game.js';

export function createGameFlow(): FlowDefinition<TableFixtureGame> {
  return { root: loop({ name: 'moves', unbounded: true, do: actionStep({ name: 'move-step', actions: ['move'] }) }) };
}
`;

const gameFrame = (page) => page.frameLocator('.dev-host__frame');
const boardReady = (page) => gameFrame(page).locator('.grid-cell').nth(399).waitFor({ timeout: 60_000 });

/** What the tap floor is checked on: each renderer's own tap target. */
/** The 44px tap floor, less a hundredth for the floating point in a hex's corners. */
const FLOOR = 44 - 0.01;

const TARGETS = {
  squares: { selector: '.grid-cell', count: 400 },
  pieces: { selector: '.piece', count: 7 },
  hexes: { selector: '.hex-polygon', count: 25 },
  deck: { selector: '.deck-stack', count: 1 },
  area: { selector: '.space-container', count: 1 },
  cards: { selector: '[data-bs-el-name="hand-1"] .card-face', count: 5 },
};

await runBrowserRegression(
  {
    script: 'tap-floor-phone-browser.mjs',
    engines: ['chromium', 'webkit'],
    table: { files: { 'src/rules/elements.ts': ELEMENTS, 'src/rules/game.ts': GAME, 'src/rules/actions.ts': ACTIONS, 'src/rules/flow.ts': FLOW } },
  },
  async ({ launch, hostUrl }) => {
    const browser = await launch();
    try {
      const player = await onEachPhone(browser, hostUrl, boardReady, async (page, size) => {
        const frame = gameFrame(page);
        const seen = await waitUntil(() => tapSizes(frame, TARGETS), (now) => Object.values(now.targets).every((t) => t.smallest >= FLOOR));
        for (const [name, { selector, count }] of Object.entries(TARGETS)) {
          await check(`${size}: every one of the ${count} ${name} is at least 44px on its shorter side`, () => {
            const target = seen.targets[name];
            assert(target.count === count, `found ${target.count} of ${selector}, not ${count}`);
            assert(target.smallest >= FLOOR, `the smallest of ${selector} is ${target.smallest}px on its shorter side, under the 44px tap floor`);
          });
        }
        await check(`${size}: the board region scrolls sideways for the 20x20 grid, and the page does not`, () => {
          assert(seen.region.sideways > 0, `the board region does not scroll sideways (${JSON.stringify(seen.region)}), so the grid was shrunk to fit it`);
          assert(seen.page.sideways <= 0, `the page scrolls ${seen.page.sideways}px sideways`);
        });
        if (size !== '390x844') return;
        await check(`${size}: at 200% the squares are twice the size, and a tap on one far down the board moves my pawn there`, async () => {
          const before = seen.targets.squares.smallest;
          await frame.getByRole('button', { name: 'Game controls' }).tap();
          await frame.getByRole('slider', { name: 'Zoom' }).fill('2');
          await frame.getByRole('slider', { name: 'Zoom' }).press('Escape');
          const zoomed = await waitUntil(() => tapSizes(frame, { squares: TARGETS.squares }), (now) => now.targets.squares.smallest > before * 1.9);
          assert(Math.abs(zoomed.targets.squares.smallest - before * 2) < 0.5, `at 200% the squares are ${zoomed.targets.squares.smallest}px, not twice their ${before}px`);
          const target = frame.locator('[data-bs-el-name="square-17-17"]');
          await target.tap();
          const moved = await waitUntil(() => target.locator('.piece').count(), (pieces) => pieces === 1, 10_000);
          assert(moved === 1, 'tapping the square at 200% did not move my pawn onto it');
        });
      });
      await onFreshPage(browser, hostUrl, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', storageState: player }, boardReady, async (page) => {
        const seen = await waitUntil(() => tapSizes(gameFrame(page), { squares: TARGETS.squares }), (now) => now.targets.squares.count === 400);
        await check('1440x900: the 20x20 grid shrinks its squares to fit the board region, which does not scroll sideways', () => {
          const { smallest, largest } = seen.targets.squares;
          assert(largest - smallest < 0.5 && smallest >= FLOOR && smallest < 64, `the squares are ${smallest}px to ${largest}px, not one size between 44px and 64px`);
          assert(seen.region.sideways <= 0, `the board region scrolls ${seen.region.sideways}px sideways`);
        });
      });
    } finally {
      await browser.close();
    }
    return summarise('for tap-sized boards on a phone');
  },
);
