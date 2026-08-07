/**
 * boardRegionPin — the channel by which a region-pinned board tells the shell
 * what kind of board it is.
 *
 * `useBoardSize()` and `useAutoZoom()` model the same board and used to
 * disagree about it. `useBoardSize()` pins a content-flow board to the board
 * region's width so that wrapping works and growth is vertical-scroll only;
 * `useAutoZoom()` fitted EVERY board on both axes, so the moment such a board
 * grew taller than the region it was also scaled down — shrinking type below
 * its declared size, which is the exact failure the pin exists to avoid.
 *
 * The pin is the statement of intent, so the pin is what carries it. A game
 * that has already called `useBoardSize()` has said which model it is in; it
 * must not also have to remember a second flag on a composable it never calls
 * (`useAutoZoom` lives in GameShell, not in the game). Forgetting that flag
 * would be silent, and silence is how this bug survived.
 *
 * Wiring is entirely inside the two composables: `useAutoZoom()` provides the
 * pin count from GameShell's setup, `useBoardSize()` registers into it from
 * the board's. Outside a GameShell (unit harnesses, non-shell hosts) the
 * inject misses and registration is a no-op.
 */
import { inject, provide, onScopeDispose, ref, type InjectionKey, type Ref } from 'vue';

/** Number of live region-pinned boards below the shell. A count, not a
 *  boolean: a remount mounts the new board before unmounting the old one, and
 *  a boolean would be left false by the outgoing board's teardown. */
const BOARD_REGION_PIN: InjectionKey<Ref<number>> = Symbol('boardsmith:board-region-pin');

/**
 * Called by `useAutoZoom()` (i.e. from GameShell's setup). Returns the live
 * count of region-pinned boards beneath it — non-zero means the board being
 * fitted has opted into region-pinned, vertical-scroll-only growth.
 */
export function provideBoardRegionPin(): Ref<number> {
  const pinnedBoards = ref(0);
  provide(BOARD_REGION_PIN, pinnedBoards);
  return pinnedBoards;
}

/**
 * Called by `useBoardSize()`. Declares "this board is pinned to the region"
 * for as long as the calling scope lives. No-op when there is no shell above
 * (nothing to tell).
 */
export function registerBoardRegionPin(): void {
  const pinnedBoards = inject(BOARD_REGION_PIN, null);
  if (!pinnedBoards) return;
  pinnedBoards.value += 1;
  onScopeDispose(() => { pinnedBoards.value -= 1; });
}
