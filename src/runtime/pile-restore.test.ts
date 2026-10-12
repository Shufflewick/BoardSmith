/**
 * The pile is saved with the state, and every restore restores it (#655).
 *
 * A removed element (`card.remove()`, into `game.pile`) stays part of the game:
 * a reference to it in an element attribute, an action arg in history or a flow
 * variable resolves to that same element after a reload, an undo or an in-place
 * rollback, as it does live. Its saved path is under `pile/`, so it can never be
 * read as the path of an element in the tree. A seat's view carries none of the
 * pile.
 *
 * Before #650 an in-place restore kept the live pile beside a tree that held the
 * removed element again, so one id was in both places; #650 then emptied the
 * pile on every restore, which lost every reference to a removed element.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  loop,
  eachPlayer,
  sequence,
  setVar,
  execute,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import {
  deserializeAction,
  createSnapshot,
  type GameStateSnapshot,
} from '../engine/utils/index.js';
import type { SerializedAction } from '../engine/action/types.js';
import { GameRunner } from './runner.js';

class Card extends Piece<PileGame, Player> {
  /** Element- and player-valued attributes a removed card carries into the pile. */
  next: Card | null = null;
  heldBy: Player | null = null;
}
class Zone extends Space<PileGame, Player> {}

class PileGame extends Game<PileGame, Player> {
  deck!: Zone;
  /** The card discarded last: an attribute that holds a removed element. */
  lastGone: Card | null = null;
  /** What the flow variable `gone` held when the flow next read it. */
  goneSeen: Card | null = null;
  inspected: Card | null = null;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Zone]);
    this.deck = this.create(Zone, 'deck');
    for (const name of ['setup-cut', 'card-b', 'card-c', 'card-d', 'card-e']) this.deck.create(Card, name);
    // Setup that removes a card, as a game trimming its deck for the player
    // count would: the constructed game starts with one card in the pile.
    this.deck.first(Card)!.remove();

    this.registerActions(
      Action.create<PileGame>('discard')
        .prompt('Discard a card')
        .execute((_args, ctx) => {
          const card = ctx.game.deck.first(Card)!;
          card.remove();
          card.next = ctx.game.deck.first(Card)!;
          card.heldBy = ctx.player;
          ctx.game.lastGone = card;
          ctx.game.message('{{card}} is gone', { card });
        }),
      // An action arg that is a removed element.
      Action.create<PileGame>('inspect')
        .prompt('Look at a removed card')
        .chooseElement('card', { elementClass: Card, elements: (ctx) => ctx.game.pile.all(Card) })
        .execute((args, ctx) => {
          ctx.game.inspected = args.card;
        }),
      // Removes a card, then throws: the runner rolls the game back in place.
      Action.create<PileGame>('discardThenFail')
        .prompt('Discard, then fail')
        .execute((_args, ctx) => {
          ctx.game.deck.first(Card)!.remove();
          throw new Error('rules bug after the discard');
        }),
    );

    this.setFlow({
      root: sequence(
        setVar('gone', null),
        loop({
          maxIterations: 20,
          do: eachPlayer({
            do: sequence(
              actionStep({ actions: ['discard', 'inspect', 'discardThenFail'] }),
              // Reads the flow variable after the await, then points it at the
              // card discarded last.
              execute<PileGame>((ctx) => {
                ctx.game.goneSeen = ctx.get<Card | null>('gone') ?? null;
                ctx.set('gone', ctx.game.lastGone);
              }),
            ),
          }),
        }),
      ),
    });
  }
}

const options = { playerCount: 2, playerNames: ['A', 'B'], seed: 'pile', elementIdKey: '0000000000000650' };

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function startedRunner(): GameRunner<PileGame> {
  // Full history: the restore below reaches checkpoint 0 after the turn has passed on.
  const runner = new GameRunner({ GameClass: PileGame, gameType: 'pile', gameOptions: options, checkpoints: { history: 'full' } });
  runner.start();
  return runner;
}

function act(runner: GameRunner<PileGame>, name: string, seat: number, args: Record<string, unknown> = {}): void {
  const result = runner.performAction(name, seat, args);
  expect(result.success, result.error).toBe(true);
  // Captures the checkpoint for this action count, as every host does.
  runner.getSnapshot();
}

/**
 * Seat 1 discards card-b, then seat 2 inspects the card setup cut. After that
 * `lastGone` and the flow variable `gone` hold card-b, and the history's
 * inspect entry holds setup-cut: all three are removed elements.
 */
function playedRunner() {
  const runner = startedRunner();
  const cutId = runner.game.pile.first(Card)!.id;
  act(runner, 'discard', 1);
  const goneId = runner.game.lastGone!.id;
  act(runner, 'inspect', 2, { card: runner.game.pile.atId(cutId) });
  return { runner, cutId, goneId, inspectEntry: runner.actionHistory[1] as SerializedAction };
}

/** Each restore path, from a played runner to the runner the game continues in. */
const restores: [string, (played: ReturnType<typeof playedRunner>) => GameRunner<PileGame>][] = [
  ['a fresh game restored from the snapshot', ({ runner }) => GameRunner.fromSnapshot(roundTrip(runner.getSnapshot()), PileGame)],
  [
    'an undo to a checkpoint',
    ({ runner }) => {
      act(runner, 'discard', 1);
      return GameRunner.fromCheckpoint(roundTrip(runner.getSnapshot()), 2, PileGame)!;
    },
  ],
  [
    'a failed action rolled back in place',
    ({ runner }) => {
      expect(runner.performAction('discardThenFail', 1, {}).success).toBe(false);
      expect(runner.game.deck.all(Card)).toHaveLength(3);
      return runner;
    },
  ],
];

describe.each(restores)('a reference to a removed element after %s (#655)', (_path, restore) => {
  it('in an element attribute is the same element, in the pile', () => {
    const played = playedRunner();
    const { game } = restore(played);

    expect(game.pile.all(Card).map((card) => card.id)).toEqual([played.cutId, played.goneId]);
    expect(game.lastGone).toBe(game.pile.atId(played.goneId));
    expect(game.inspected).toBe(game.pile.atId(played.cutId));
  });

  it('held by a removed element is the restored element or player', () => {
    const played = playedRunner();
    const { game } = restore(played);
    const gone = game.pile.atId(played.goneId) as Card;

    expect(gone.next).toBe(game.deck.first(Card));
    expect(gone.next!.name).toBe('card-c');
    expect(gone.heldBy).toBe(game.getPlayer(1));
  });

  it('in an action arg in history is the same element, in the pile', () => {
    const played = playedRunner();
    const { game } = restore(played);

    expect(deserializeAction(roundTrip(played.inspectEntry), game).args.card).toBe(game.pile.atId(played.cutId));
  });
});

describe.each(restores)('a flow variable holding a removed element after %s (#655, #679)', (_path, restore) => {
  it('is the same element, in the pile', () => {
    const played = playedRunner();
    const restored = restore(played);

    // The next move reads the flow variable `gone`, which holds card-b.
    act(restored, 'discard', 1);
    expect(restored.game.goneSeen).toBe(restored.game.pile.atId(played.goneId));
  });
});

describe('a history whose arg is a removed element (#655)', () => {
  it('replays to the same element', () => {
    const { runner, cutId } = playedRunner();
    const replayed = GameRunner.replay(
      { GameClass: PileGame, gameType: 'pile', gameOptions: options },
      roundTrip(runner.actionHistory),
    );

    expect(replayed.game.inspected).toBe(replayed.game.pile.atId(cutId));
  });
});

describe('the pile in a saved state (#655)', () => {
  it('saves a removed element under a pile path, never as a path into the tree', () => {
    const { runner, goneId } = playedRunner();
    const state = runner.game.toJSON() as { attributes: Record<string, unknown> };

    expect(runner.game.pile.atId(goneId)!.branch()).toBe('pile/1');
    expect(state.attributes.lastGone).toEqual({ __elementRef: 'pile/1' });
    expect(runner.game.atBranch('pile/1')).toBe(runner.game.pile.atId(goneId));
    expect(runner.game.atBranch('pile')).toBe(runner.game.pile);
  });

  it('restores the pile in place without a removed element being in the tree and the pile at once', () => {
    const game = new PileGame(options);
    const state = game.toJSON();
    const card = game.deck.first(Card)!;
    card.remove();

    game.loadSerializedState(state);
    game.deck.first(Card)!.remove();

    expect(game.pile.all(Card).map((piled) => piled.name)).toEqual(['setup-cut', card.name]);
    expect(game.getElementById(card.id)).toBe(game.pile.atId(card.id));
  });

  it('gives the same pile on an in-place restore as on a fresh one', () => {
    const { runner } = playedRunner();
    const snapshot: GameStateSnapshot = roundTrip(runner.getSnapshot());
    act(runner, 'discard', 1);

    const fresh = GameRunner.fromSnapshot(snapshot, PileGame);
    runner.game.loadSerializedState(snapshot.state);

    expect(runner.game.pile.all(Card).map((card) => card.id)).toEqual(fresh.game.pile.all(Card).map((card) => card.id));
  });

  it('carries none of the pile in any seat view', () => {
    const { runner, goneId } = playedRunner();
    for (const seat of [1, 2, null]) {
      const view = runner.game.toJSONForPlayer(seat);
      expect(view).not.toHaveProperty('pile');
      expect(JSON.stringify(view)).not.toContain('card-b');
      expect(JSON.stringify(view)).not.toContain(String(goneId));
    }
  });

  // The position in the pile would tell a seat how many elements were removed
  // before this one, and in what order.
  it('writes no pile position into any seat view or seat message log, and keeps it in the saved state', () => {
    const { runner } = playedRunner();
    const pilePosition = /"__elementRef":"pile\/\d/;
    const views = [
      ...[1, 2, null].map((seat) => runner.game.toJSONForPlayer(seat)),
      ...runner.game.toJSONForPlayers([1, 2, null]),
    ];
    for (const view of views) {
      expect(JSON.stringify(view)).not.toMatch(pilePosition);
      expect(view.attributes.lastGone).toEqual({ __elementRef: 'pile/removed' });
    }
    for (const seat of [1, 2, null]) {
      expect(JSON.stringify(runner.game.serializeMessageLog(seat))).not.toMatch(pilePosition);
    }

    expect(JSON.stringify(runner.game.toJSON())).toMatch(pilePosition);
    expect(JSON.stringify(runner.game.serializeMessageLog())).toMatch(pilePosition);
  });

  it('restores a reference to a removed element in a seat view to nothing, not to an element in the tree', () => {
    const { runner } = playedRunner();
    const view = runner.game.toJSONForPlayer(1);
    const sandbox = new PileGame(options);
    sandbox.loadSerializedState(view as ReturnType<Game['toJSON']>);

    expect(sandbox.lastGone).toBeUndefined();
    expect(sandbox.pile.all(Card)).toHaveLength(0);
  });

  // #497: a bot plays from its seat's snapshot, whose flow state is written
  // for the seat as its view is. A flow variable holding a removed element is
  // withheld there exactly as an attribute is, and restores to nothing rather
  // than failing the restore.
  it('writes a flow variable holding a removed element into a seat snapshot without its id, and restores it to nothing', () => {
    const { runner, goneId } = playedRunner();
    const seatSnapshot = createSnapshot(runner.game, 'pile', [], undefined, { forSeat: 1 });

    expect(seatSnapshot.flowState!.position.variables.gone).toEqual({ __elementRef: 'pile/removed' });
    expect(JSON.stringify(seatSnapshot.flowState)).not.toContain(String(goneId));

    const sandbox = new PileGame(options);
    sandbox.loadSerializedState(seatSnapshot.state as ReturnType<Game['toJSON']>);
    sandbox.restoreFlowState(roundTrip(seatSnapshot.flowState!), seatSnapshot.hiddenIdRemap);

    expect(sandbox.getFlowState()!.position.variables.gone).toBeUndefined();
    // The authoritative flow state still names the element.
    expect(runner.game.getFlowState()!.position.variables.gone).toEqual({ __flowElementId: goneId, className: 'Card' });
  });
});
