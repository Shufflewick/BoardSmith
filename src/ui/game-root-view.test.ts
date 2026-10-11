/**
 * GAMEROOTVIEW IS TIED TO WHAT `Game.toJSON()` WRITES (#615).
 *
 * A board's `gameView` is typed `GameRootView`, written by hand in ui/types.ts,
 * and the engine writes the root in `Game.toJSON()`. These checks are compiled
 * by `boardsmith typecheck`, so a change on either side that the other does not
 * follow fails the type check:
 *
 * - The engine's root is assignable to `GameRootView`: renaming, dropping or
 *   retyping `phase`, `isFinished` or `settings` (or an element field) breaks it.
 * - The root fields the engine adds over `ElementJSON` are exactly the ones
 *   `GameRootView` adds over `GameViewElement`, plus two named exclusions: the
 *   engine's `RestoreOnlyRootField` (#671), and `AnimationEventsRootField`, with
 *   its reason below. A new root field must be added to `GameRootView` or
 *   to an exclusion that says why a board does not read it. Assignability alone cannot catch an addition, and the reverse
 *   assignment is not the contract: a view is a reader's type (optional
 *   attributes, no visibility markers) that nothing hands back to the engine.
 * - Every path that hands a board its root carries a seat's view,
 *   `SeatViewJSON` (#671), the root less the fields redaction removes, so the shells
 *   and the test harness need no cast to type it.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { ComputedRef } from 'vue';
import type { Game, ElementJSON, PlayerStateView, RestoreOnlyRootField, SeatViewJSON } from '../engine/index.js';
import type { PlayerGameState } from '../session/index.js';
import type { PlayerState } from '../client/types.js';
import type { SeatProjection, WorldSeatView } from '../testing/index.js';
import type { GameRootView, GameViewElement } from './types.js';
import type { useTableSeat } from './composables/useTableSeat.js';

type GameRootJSON = ReturnType<Game['toJSON']>;

/**
 * Ships in a seat's view (its visible events, renumbered for the seat), but a
 * board reads animation events through `useAnimationEvents`, fed from
 * `PlayerState.animationEvents`. Declaring it on `GameRootView` would give a
 * board a second place to read the same events.
 */
type AnimationEventsRootField = 'animationEvents';

/** The root fields a root type adds over a plain element, less the ones a board does not read from the root. */
type BoardRootFields<Root> = Exclude<keyof Root, keyof ElementJSON | RestoreOnlyRootField | AnimationEventsRootField>;

describe('GameRootView and Game.toJSON (#615)', () => {
  it('accepts the root the engine writes', () => {
    expectTypeOf<GameRootJSON>().toMatchTypeOf<GameRootView>();
  });

  it('names every root field the engine writes', () => {
    expectTypeOf<BoardRootFields<GameRootJSON>>().toEqualTypeOf<Exclude<keyof GameRootView, keyof GameViewElement>>();
  });

  it('goes red when the engine renames a root field', () => {
    type Renamed = Omit<GameRootJSON, 'isFinished'> & { finished: boolean };
    // @ts-expect-error -- `isFinished` is gone, so the engine's root is no longer a GameRootView.
    expectTypeOf<Renamed>().toMatchTypeOf<GameRootView>();
  });

  it('goes red when the engine adds a root field GameRootView does not name', () => {
    type Added = GameRootJSON & { round: number };
    // @ts-expect-error -- `round` is a root field GameRootView does not declare.
    expectTypeOf<BoardRootFields<Added>>().toEqualTypeOf<Exclude<keyof GameRootView, keyof GameViewElement>>();
  });

  it('is what every path to a board carries: the seat view toJSONForPlayer writes', () => {
    expectTypeOf<ReturnType<Game['toJSONForPlayer']>>().toEqualTypeOf<SeatViewJSON>();
    expectTypeOf<ReturnType<Game['toJSONForPlayers']>>().toEqualTypeOf<SeatViewJSON[]>();
    expectTypeOf<PlayerStateView['state']>().toEqualTypeOf<SeatViewJSON>();
    expectTypeOf<PlayerGameState['view']>().toEqualTypeOf<SeatViewJSON>();
    expectTypeOf<PlayerState['view']>().toEqualTypeOf<SeatViewJSON>();
    expectTypeOf<SeatProjection['state']>().toEqualTypeOf<SeatViewJSON>();
    expectTypeOf<WorldSeatView['state']>().toEqualTypeOf<SeatViewJSON>();
  });

  it('is the table seat gameView type', () => {
    expectTypeOf<Parameters<typeof useTableSeat>[0]['gameView']>().toEqualTypeOf<
      ComputedRef<GameRootView | null>
    >();
  });
});

describe("a seat's view and the root (#671)", () => {
  it('names the restore-only fields redaction removes', () => {
    // Redacting another root field changes RestoreOnlyRootField, and this list with it.
    expectTypeOf<RestoreOnlyRootField>().toEqualTypeOf<'animationEventSeq' | 'animationSeqBySeat' | 'messagesEvicted'>();
  });

  it('is the root less exactly the restore-only fields', () => {
    expectTypeOf<keyof SeatViewJSON>().toEqualTypeOf<Exclude<keyof GameRootJSON, RestoreOnlyRootField>>();
    expectTypeOf<SeatViewJSON>().toMatchTypeOf<GameRootView>();
  });

  it('has no restore-only field to read', () => {
    expectTypeOf<SeatViewJSON>().not.toHaveProperty('messagesEvicted');
    expectTypeOf<SeatViewJSON>().not.toHaveProperty('animationEventSeq');
    expectTypeOf<SeatViewJSON>().not.toHaveProperty('animationSeqBySeat');
  });

  it('restores: a seat view is a root loadSerializedState accepts', () => {
    expectTypeOf<SeatViewJSON>().toMatchTypeOf<Parameters<Game['loadSerializedState']>[0]>();
  });
});
