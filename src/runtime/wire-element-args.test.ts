import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, loop, eachPlayer, actionStep, type GameOptions } from '../engine/index.js';
import { GameRunner } from './runner.js';

class Token extends Piece<WireGame> {}
class Board extends Space<WireGame> {}

class WireGame extends Game<WireGame, Player> {
  board!: Board;
  lastPicked: unknown[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Board]);
    this.board = this.create(Board, 'board');
    this.board.create(Token, 'token-a');
    this.board.create(Token, 'token-b');

    this.registerAction(
      Action.create<WireGame>('pick')
        .chooseElement('target', { elementClass: Token })
        .execute((args) => { this.lastPicked = [args.target]; }),
    );
    this.registerAction(
      Action.create<WireGame>('pickMany')
        .chooseElements('targets', { elements: () => [...this.board.all(Token)], multiSelect: { min: 1, max: 2 } })
        .execute((args) => { this.lastPicked = args.targets as Token[]; }),
    );
    this.registerAction(
      Action.create<WireGame>('pickPlayer')
        .chooseElement('who', { elementClass: Player })
        .execute((args) => { this.lastPicked = [args.who]; }),
    );
    this.registerAction(
      Action.create<WireGame>('attack')
        .chooseFrom('victim', { choices: (ctx) => this.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }) })
        .execute((args) => { this.lastPicked = [args.victim]; }),
    );

    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({ do: actionStep({ actions: ['pick', 'pickMany', 'pickPlayer', 'attack'] }) }),
      }),
    });
  }
}

function startRunner(): GameRunner<WireGame> {
  const runner = new GameRunner({
    GameClass: WireGame,
    gameType: 'wire-element-args-test',
    gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'wire-test' },
  });
  runner.start();
  return runner;
}

const ref = (element: Token | Player) => ({ id: element.id, className: element.constructor.name });
const overTheWire = (args: Record<string, unknown>) => JSON.parse(JSON.stringify(args)) as Record<string, unknown>;

describe('runner.performAction resolves elements sent over the wire as { id, className } (#681)', () => {
  it('resolves a single element', () => {
    const runner = startRunner();
    const token = runner.game.board.all(Token)[1];

    const outcome = runner.performAction('pick', 1, overTheWire({ target: ref(token) }));

    expect(outcome.error).toBeUndefined();
    expect(runner.game.lastPicked).toEqual([token]);
  });

  it('resolves each element of a multi-element pick', () => {
    const runner = startRunner();
    const tokens = [...runner.game.board.all(Token)];

    const outcome = runner.performAction('pickMany', 1, overTheWire({ targets: tokens.map(ref) }));

    expect(outcome.error).toBeUndefined();
    expect(runner.game.lastPicked).toEqual(tokens);
  });

  it('resolves a player picked as an element', () => {
    const runner = startRunner();
    const bob = runner.game.getPlayer(2)!;

    const outcome = runner.performAction('pickPlayer', 1, overTheWire({ who: ref(bob) }));

    expect(outcome.error).toBeUndefined();
    expect(runner.game.lastPicked).toEqual([bob]);
  });

  it('takes a seat number for a player picked from playerChoices', () => {
    const runner = startRunner();

    const outcome = runner.performAction('attack', 1, overTheWire({ victim: 2 }));

    expect(outcome.error).toBeUndefined();
    expect(runner.game.lastPicked).toEqual([2]);
  });
});
