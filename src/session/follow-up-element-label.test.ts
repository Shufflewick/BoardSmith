/**
 * A follow-up that pre-fills an element pick by id, with no `display`, reaches
 * the player labelled as the pick's own choices would label that element, never
 * as the raw id (#1378: Checkers' multi-jump showed "1873686213").
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Piece,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { offerFollowUp } from './utils.js';

class JumpGame extends Game<JumpGame, Player> {
  /** The follow-up `jump` returns: the action, the pieces a list pick is pre-filled with, and any display it passes. */
  chain: { action: string; listed?: string[]; display?: Record<string, string | undefined> } = { action: 'move' };

  constructor(options: GameOptions) {
    super(options);
    const board = this.create(Space, 'board');
    board.create(Piece, 'red');
    board.create(Piece, 'blue');
    board.create(Piece, 'twin');
    board.create(Piece, 'twin');
    const pieces = (ctx: { game: JumpGame }) => ctx.game.first(Space, 'board')!.all(Piece);
    const onlyChained = { 'only as a follow-up': () => false };
    this.registerActions(
      Action.create<JumpGame>('jump')
        .chooseElement<'piece', Piece>('piece', { elements: pieces })
        .execute(({ piece }, ctx) => {
          const { action, listed, display } = (ctx.game as JumpGame).chain;
          const args = listed ? { pieces: pieces(ctx).filter((p) => listed.some((name) => name === p.name)).map((p) => p.id) } : { piece: piece.id };
          // A display built from values that may be missing reaches the engine as such once types are erased.
          return { success: true, followUp: { action, args, ...(display && { display: display as Record<string, string> }) } };
        }),
      Action.create<JumpGame>('move')
        .condition(onlyChained)
        .chooseElement<'piece', Piece>('piece', { elements: pieces, display: (piece) => `${piece.name} square` })
        .chooseFrom('to', { choices: ['left', 'right'] })
        .execute(() => ({ success: true })),
      Action.create<JumpGame>('slide')
        .condition(onlyChained)
        .chooseElement<'piece', Piece>('piece', { elements: pieces })
        .chooseFrom('to', { choices: ['left', 'right'] })
        .execute(() => ({ success: true })),
      Action.create<JumpGame>('shift')
        .condition(onlyChained)
        .chooseElements<'pieces', Piece>('pieces', { elements: pieces })
        .chooseFrom('to', { choices: ['left', 'right'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ maxIterations: 2, do: eachPlayer({ do: actionStep({ actions: ['jump'] }) }) }) });
  }
}

/** The display the jumping seat's follow-up offer carries after `jump` chains as `chain` says. */
function offeredDisplay(chain: JumpGame['chain'], jumper = 'red'): Record<string, string> | undefined {
  const r = new GameRunner({ GameClass: JumpGame, gameType: 'jump', gameOptions: { playerCount: 2, seed: 'follow-up-label' } });
  r.start();
  r.game.chain = chain;
  const piece = r.game.first(Piece, jumper)!;
  expect(r.performAction('jump', 1, { piece: piece.id }).success).toBe(true);
  return offerFollowUp(r.game, r.getFlowState(), 1)?.display;
}

describe('a follow-up element pick passed by id', () => {
  it("is labelled by the pick's own display", () => {
    expect(offeredDisplay({ action: 'move' })).toEqual({ piece: 'red square' });
  });

  it("is labelled by the element's name when the pick has no display", () => {
    expect(offeredDisplay({ action: 'slide' })).toEqual({ piece: 'red' });
  });

  it("is numbered among the pick's other candidates as its choice would be", () => {
    expect(offeredDisplay({ action: 'slide' }, 'twin')).toEqual({ piece: 'twin #1' });
  });

  it('labels every element of a list pick', () => {
    expect(offeredDisplay({ action: 'shift', listed: ['red', 'blue'] })).toEqual({ pieces: 'red, blue' });
  });

  it('gives an empty list pick no label', () => {
    expect(offeredDisplay({ action: 'shift', listed: [] })).toBeUndefined();
  });

  it('keeps the display the game passed', () => {
    expect(offeredDisplay({ action: 'move', display: { piece: 'Red checker' } })).toEqual({ piece: 'Red checker' });
  });

  it('labels an element whose passed display is undefined', () => {
    expect(offeredDisplay({ action: 'move', display: { piece: undefined } })).toEqual({ piece: 'red square' });
  });
});
