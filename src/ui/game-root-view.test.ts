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
 *   `GameRootView` adds over `GameViewElement`, plus the named bookkeeping
 *   fields a board does not read. A new root field must be added to one or the
 *   other. Assignability alone cannot catch an addition, and the reverse
 *   assignment is not the contract: a view is a reader's type (optional
 *   attributes, no visibility markers) that nothing hands back to the engine.
 * - Every path that hands a board its root carries that type, so the shells
 *   and the test harness need no cast to type it.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { ComputedRef } from 'vue';
import type { Game, ElementJSON, PlayerStateView } from '../engine/index.js';
import type { PlayerGameState } from '../session/index.js';
import type { PlayerState } from '../client/types.js';
import type { WorldSeatView } from '../testing/index.js';
import type { GameRootView, GameViewElement } from './types.js';
import type { useTableSeat } from './composables/useTableSeat.js';

type GameRootJSON = ReturnType<Game['toJSON']>;

/** Root fields the engine writes for itself: animation counters and the log's eviction offset. */
type EngineOnlyRootField = 'animationEvents' | 'animationEventSeq' | 'animationSeqBySeat' | 'messagesEvicted';

/** The root fields a root type adds over a plain element, less the engine's own. */
type BoardRootFields<Root> = Exclude<keyof Root, keyof ElementJSON | EngineOnlyRootField>;

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

  it('is what every path to a board carries', () => {
    expectTypeOf<PlayerStateView['state']>().toEqualTypeOf<GameRootJSON>();
    expectTypeOf<PlayerGameState['view']>().toEqualTypeOf<GameRootJSON>();
    expectTypeOf<PlayerState['view']>().toEqualTypeOf<GameRootJSON>();
    expectTypeOf<WorldSeatView['state']>().toEqualTypeOf<GameRootJSON>();
  });

  it('is the table seat gameView type', () => {
    expectTypeOf<Parameters<typeof useTableSeat>[0]['gameView']>().toEqualTypeOf<
      ComputedRef<GameRootView | null | undefined>
    >();
  });
});
