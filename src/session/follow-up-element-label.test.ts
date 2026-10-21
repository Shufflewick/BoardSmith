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
  /** The follow-up `jump` returns: the action, plus any display it passes. */
  chain: { action: string; display?: Record<string, string> } = { action: 'move' };

  constructor(options: GameOptions) {
    super(options);
    const board = this.create(Space, 'board');
    board.create(Piece, 'red');
    board.create(Piece, 'blue');
    const pieces = (ctx: { game: JumpGame }) => ctx.game.first(Space, 'board')!.all(Piece);
    const onlyChained = { 'only as a follow-up': () => false };
    this.registerActions(
      Action.create<JumpGame>('jump')
        .chooseElement<'piece', Piece>('piece', { elements: pieces })
        .execute(({ piece }, ctx) => {
          const { action, display } = (ctx.game as JumpGame).chain;
          const args = action === 'shift' ? { pieces: pieces(ctx).map((p) => p.id) } : { piece: piece.id };
          return { success: true, followUp: { action, args, ...(display && { display }) } };
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
function offeredDisplay(chain: JumpGame['chain']): Record<string, string> | undefined {
  const r = new GameRunner({ GameClass: JumpGame, gameType: 'jump', gameOptions: { playerCount: 2, seed: 'follow-up-label' } });
  r.start();
  r.game.chain = chain;
  const red = r.game.first(Piece, 'red')!;
  expect(r.performAction('jump', 1, { piece: red.id }).success).toBe(true);
  return offerFollowUp(r.game, r.getFlowState(), 1)?.display;
}

describe('a follow-up element pick passed by id', () => {
  it("is labelled by the pick's own display", () => {
    expect(offeredDisplay({ action: 'move' })).toEqual({ piece: 'red square' });
  });

  it("is labelled by the element's name when the pick has no display", () => {
    expect(offeredDisplay({ action: 'slide' })).toEqual({ piece: 'red' });
  });

  it('labels every element of a list pick', () => {
    expect(offeredDisplay({ action: 'shift' })).toEqual({ pieces: 'red, blue' });
  });

  it("keeps the display the game passed", () => {
    expect(offeredDisplay({ action: 'move', display: { piece: 'Red checker' } })).toEqual({ piece: 'Red checker' });
  });
});
