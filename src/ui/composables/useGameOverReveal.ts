/**
 * When a table's ending is on screen (#419).
 *
 * The flow completing ends the game; it does not put the result in front of the
 * player. A board that holds its result back on purpose -- until the player has
 * watched a replay of the deciding moment, say -- says so by calling
 * {@link holdGameOverUntil} in its `setup`:
 *
 * ```ts
 * import { holdGameOverUntil } from 'boardsmith/ui';
 *
 * // The ending is on screen once this viewer's final replay has ended.
 * holdGameOverUntil(() => matchResultShown.value);
 * ```
 *
 * The shell's whole ending then waits for it. The game-over card (or the
 * `#game-over` slot) and the assertive "Game over" announcement both follow one
 * answer, {@link GameOverReveal.revealed}: the flow is complete and every hold
 * says its ending is shown. A board that holds nothing is revealed the moment the
 * flow completes. `providesOwnGameOverUi` on GameShell is a separate question --
 * who draws the ending, not when it is shown -- so a board that draws its own
 * ending and holds it back uses both, and the shell still announces the result,
 * at the moment the board shows it.
 *
 * Once the flow is complete the player can release every hold with
 * {@link GameOverReveal.showResult} (GameShell's "Show result" button), so a hold
 * that never releases -- a stuck replay -- cannot hide the result for good.
 *
 * `shown` is read after the board has rendered the frame that completed the
 * flow, so a hold that turns on in reaction to that frame (a watcher that starts
 * the replay) is in place in time. It must be false synchronously by then: a
 * hold that only turns on after an `await` has already let the ending through.
 */
import { computed, inject, onScopeDispose, ref, shallowReactive, watch, type ComputedRef, type InjectionKey } from 'vue';

/** The table's register of boards holding the ending back. */
interface GameOverHolds {
  /** Hold the ending until `shown()` is true; returns the release. */
  hold(shown: () => boolean): () => void;
}

interface GameOverReveal {
  /** What a board below registers its hold with. */
  holds: GameOverHolds;
  /** True when the flow is complete and every hold's ending is shown, or the player showed the result. The one answer the card and the announcement read. */
  revealed: ComputedRef<boolean>;
  /** True when the flow is complete and a hold has kept the ending back since. */
  held: ComputedRef<boolean>;
  /** Reveal this game's result now, whatever the holds say. */
  showResult(): void;
}

export const GAME_OVER_HOLDS_KEY: InjectionKey<GameOverHolds> = Symbol('boardsmith:game-over-holds');

/** Build a table's reveal. `complete` is whether the flow has completed. */
export function createGameOverReveal(complete: () => boolean): GameOverReveal {
  const active = shallowReactive(new Set<() => boolean>());
  const holds: GameOverHolds = {
    hold(shown) {
      // Wrapped, so one function registered twice is two holds, each released on its own.
      const entry = () => shown();
      active.add(entry);
      return () => active.delete(entry);
    },
  };
  const shownByPlayer = ref(false);
  const shownOnce = ref(false);
  // A restart clears both, so the next game's holds hold again.
  watch(complete, (done) => {
    if (!done) shownByPlayer.value = shownOnce.value = false;
  });
  const revealed = computed(() => {
    if (!complete()) return false;
    if (shownByPlayer.value) return true;
    for (const shown of active) if (!shown()) return false;
    return true;
  });
  // After render, like the announcement, so a hold that starts on the completing frame is in place first.
  watch(revealed, (now) => {
    if (now) shownOnce.value = true;
  }, { flush: 'post' });
  // Once shown, a board hiding its result again (a replay) is the board's choice, not a stuck hold.
  const held = computed(() => complete() && !revealed.value && !shownOnce.value);
  return {
    holds,
    revealed,
    held,
    showResult: () => {
      if (complete()) shownByPlayer.value = true;
    },
  };
}

/**
 * Hold the table's ending -- the shell's game-over card and its "Game over"
 * announcement -- until `shown()` returns true. Call it in a board's `setup`;
 * the hold is released when the board unmounts. See the file comment for when
 * `shown` is read.
 */
export function holdGameOverUntil(shown: () => boolean): void {
  const holds = inject(GAME_OVER_HOLDS_KEY, null);
  if (!holds) {
    throw new Error(
      'holdGameOverUntil() was called outside a table board. Call it in the setup of the board ' +
        'GameShell renders (or one renderAsSeat mounts): only a table has a game over to hold back.',
    );
  }
  onScopeDispose(holds.hold(shown));
}
