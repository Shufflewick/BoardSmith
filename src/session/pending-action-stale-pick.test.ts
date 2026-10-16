/**
 * A multi-step action is refused when another seat's action took one of its
 * earlier picks (#767).
 *
 * In a simultaneous step seat 1 could pick the gem for `draft`, seat 2 could
 * then `grab` the gem, and seat 1's second pick would still complete `draft`,
 * moving the gem out of seat 2's tableau: a move the history records but a
 * replay would refuse. Before it runs, a pending action now re-checks each
 * earlier pick another action took off the offer. The action's own picks
 * (their `onSelect`) do not count: a pick its own `onSelect` took off the offer
 * still completes, even when another seat acts in between, and a pick a held
 * follow-up answered is the engine's and is not checked again.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Piece,
  Action,
  loop,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { executeOp, type GameDefinitionLike, type StateEnvelope } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { historyLabels } from './testing/history-labels.js';
import { succeeded } from './op-result.test-helper.js';

class GemGame extends Game<GemGame, Player> {
  /** The game callbacks that ran, as `callback:seat`. */
  ran: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    const supply = this.create(Space, 'supply');
    this.create(Space, 'held');
    for (const player of this.all(Player)) this.create(Space, `tableau-${player.seat}`);
    supply.create(Piece, 'gem');
    const offered = (ctx: { game: GemGame }) => ctx.game.first(Space, 'supply')!.all(Piece);
    const tableau = (game: GemGame, player: Player) => game.first(Space, `tableau-${player.seat}`)!;
    this.registerActions(
      Action.create<GemGame>('draft')
        .chooseElement<'gem', Piece>('gem', {
          elements: offered,
          onSelect: () => { this.ran.push('onSelect'); },
          onCancel: () => { this.ran.push('onCancel'); },
        })
        .chooseFrom('slot', { choices: ['left', 'right'] })
        .execute(({ gem }, ctx) => {
          gem.putInto(tableau(ctx.game, ctx.player));
          ctx.game.ran.push(`draft:${ctx.player.seat}`);
        }),
      Action.create<GemGame>('grab')
        .chooseElement<'gem', Piece>('gem', { elements: offered })
        .execute(({ gem }, ctx) => {
          gem.putInto(tableau(ctx.game, ctx.player));
          ctx.game.ran.push(`grab:${ctx.player.seat}`);
        }),
      // Its own onSelect takes the gem off the offer, into `held`.
      Action.create<GemGame>('claim')
        .chooseElement<'gem', Piece>('gem', {
          elements: offered,
          onSelect: (gem) => gem.putInto(this.first(Space, 'held')!),
          onCancel: () => this.first(Space, 'held')!.first(Piece)!.putInto(supply),
        })
        .chooseFrom('slot', { choices: ['left', 'right'] })
        .execute(({ gem }, ctx) => {
          gem.putInto(tableau(ctx.game, ctx.player));
          ctx.game.ran.push(`claim:${ctx.player.seat}`);
        }),
      // Holds the gem aside and hands it to `place` as a held follow-up.
      Action.create<GemGame>('pocket')
        .chooseElement<'gem', Piece>('gem', { elements: offered })
        .execute(({ gem }) => {
          gem.putInto(this.first(Space, 'held')!);
          return { success: true, followUp: { action: 'place', args: { gem: gem.id } } };
        }),
      Action.create<GemGame>('place')
        .chooseElement<'gem', Piece>('gem', { elements: offered })
        .chooseFrom('slot', { choices: ['left', 'right'] })
        .execute(({ gem }, ctx) => {
          gem.putInto(tableau(ctx.game, ctx.player));
          ctx.game.ran.push(`place:${ctx.player.seat}`);
        }),
      Action.create<GemGame>('rest').execute((_args, ctx) => {
        ctx.game.ran.push(`rest:${ctx.player.seat}`);
      }),
    );
    this.setFlow({
      root: loop({ maxIterations: 10, do: simultaneousActionStep({ actions: ['draft', 'grab', 'claim', 'pocket', 'rest'] }) }),
    });
  }
}

const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

const gameOptions = { playerCount: 2, seed: 'bs767' };
const gameDef = { gameClass: GemGame, gameType: 'gems', minPlayers: 2, maxPlayers: 2 } satisfies GameDefinitionLike;

function runner(): GameRunner<GemGame> {
  const r = new GameRunner({ GameClass: GemGame, gameType: 'gems', gameOptions });
  r.start();
  return r;
}

const gem = (r: GameRunner<GemGame>) => r.game.first(Piece, 'gem')!;

describe('GameRunner', () => {
  it("refuses a pending action once another seat's action took an earlier pick, and fires onCancel", () => {
    const r = runner();
    r.startPendingAction('draft', 1);
    expect(r.processSelectionStep(1, 'gem', gem(r).id).success).toBe(true);
    expect(r.performAction('grab', 2, { gem: gem(r).id }).success).toBe(true);

    const step = r.processSelectionStep(1, 'slot', 'left');

    expect(step).toMatchObject({ success: false, error: NO_LONGER_AVAILABLE });
    expect(r.game.ran).toEqual(['onSelect', 'grab:2', 'onCancel']);
    expect(gem(r).parent!.name).toBe('tableau-2');
    expect(historyLabels(r.actionHistory)).toEqual(['grab:2']);
  });

  it('completes a pending action whose own onSelect took its pick off the offer', () => {
    const r = runner();
    r.startPendingAction('claim', 1);
    expect(r.processSelectionStep(1, 'gem', gem(r).id).success).toBe(true);
    expect(gem(r).parent!.name).toBe('held');

    expect(r.processSelectionStep(1, 'slot', 'left')).toMatchObject({ success: true, actionComplete: true });
    expect(gem(r).parent!.name).toBe('tableau-1');
  });

  it('completes a pending action whose own onSelect took its pick off the offer, when another seat acted in between', () => {
    const r = runner();
    r.startPendingAction('claim', 1);
    expect(r.processSelectionStep(1, 'gem', gem(r).id).success).toBe(true);
    expect(r.performAction('rest', 2, {}).success).toBe(true);

    expect(r.processSelectionStep(1, 'slot', 'left')).toMatchObject({ success: true, actionComplete: true });
    expect(gem(r).parent!.name).toBe('tableau-1');
  });

  it('does not re-check a pick a held follow-up answered, when another seat acted in between', () => {
    const r = runner();
    expect(r.performAction('pocket', 1, { gem: gem(r).id }).success).toBe(true);
    r.startPendingAction('place', 1);
    expect(r.processSelectionStep(1, 'gem', gem(r).id).success).toBe(true);
    expect(r.performAction('rest', 2, {}).success).toBe(true);

    expect(r.processSelectionStep(1, 'slot', 'left')).toMatchObject({ success: true, actionComplete: true });
    expect(gem(r).parent!.name).toBe('tableau-1');
  });

  it("completes a pending action when another seat's action left its picks on offer", () => {
    const r = runner();
    r.startPendingAction('draft', 1);
    expect(r.processSelectionStep(1, 'gem', gem(r).id).success).toBe(true);
    expect(r.performAction('rest', 2, {}).success).toBe(true);

    expect(r.processSelectionStep(1, 'slot', 'right')).toMatchObject({ success: true, actionComplete: true });
    expect(r.game.ran).toEqual(['onSelect', 'rest:2', 'draft:1']);
    expect(gem(r).parent!.name).toBe('tableau-1');
  });
});

describe('stateless selectionStep op', () => {
  async function start(): Promise<StateEnvelope> {
    return succeeded(await executeOp(gameDef, gameOptions, null, {}, { type: 'start' }));
  }

  /** The gem's id in the game `envelope` holds. */
  function gemId(envelope: StateEnvelope): number {
    const find = (node: unknown): number | undefined => {
      if (typeof node !== 'object' || node === null) return undefined;
      const record = node as Record<string, unknown>;
      if (record.className === 'Piece' && record.name === 'gem') return record.id as number;
      for (const value of Object.values(record)) {
        const id = find(value);
        if (id !== undefined) return id;
      }
      return undefined;
    };
    return find(envelope.snapshot)!;
  }

  function pick(
    after: StateEnvelope,
    pending: { pendingState: Record<string, unknown> | null } | null,
    selectionName: string,
    value: number | string,
  ) {
    return executeOp(gameDef, gameOptions, after.snapshot, pending?.pendingState ?? null, {
      type: 'selectionStep', player: 1, selectionName, value, actionName: 'draft',
      boundaryKey: boundaryKeyOf(after.snapshot),
    });
  }

  it("refuses a pending action once another seat's action took an earlier pick", async () => {
    const started = await start();
    const first = succeeded(await pick(started, null, 'gem', gemId(started)));
    const grabbed = succeeded(await executeOp(gameDef, gameOptions, first.snapshot, null, {
      type: 'action', actionName: 'grab', player: 2, args: { gem: gemId(first) }, boundaryKey: boundaryKeyOf(first.snapshot),
    }));

    const step = await pick(grabbed, first, 'slot', 'left');

    expect(step).toMatchObject({ success: false, error: NO_LONGER_AVAILABLE });
  });
});
