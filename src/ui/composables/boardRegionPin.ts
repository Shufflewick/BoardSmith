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
 *
 * The channel also carries the shell's zoom back down (#1332): the region is
 * outside the zoomed container and the board inside it, so a board fitting
 * itself to the region must divide by the zoom, and ResizeObserver does not
 * report a zoom change.
 */
import { inject, provide, onScopeDispose, readonly, ref, type InjectionKey, type Ref } from 'vue';

interface BoardRegionChannel {
  /** Number of live region-pinned boards below the shell. A count, not a
   *  boolean: a remount mounts the new board before unmounting the old one, and
   *  a boolean would be left false by the outgoing board's teardown. */
  pinnedBoards: Ref<number>;
  /** The zoom the shell applies to the board. */
  zoom: Readonly<Ref<number>>;
}

const BOARD_REGION_PIN: InjectionKey<BoardRegionChannel> = Symbol('boardsmith:board-region-pin');

/** Outside a shell nothing zooms the board. */
const UNZOOMED: Readonly<Ref<number>> = readonly(ref(1));

/**
 * Called by `useAutoZoom()` (i.e. from GameShell's setup) with the zoom it
 * applies. Returns the live count of region-pinned boards beneath it —
 * non-zero means the board being fitted has opted into region-pinned,
 * vertical-scroll-only growth.
 */
export function provideBoardRegionPin(zoom: Readonly<Ref<number>>): Ref<number> {
  const pinnedBoards = ref(0);
  provide(BOARD_REGION_PIN, { pinnedBoards, zoom: readonly(zoom) });
  return pinnedBoards;
}

/**
 * Called by `useBoardSize()`. Declares "this board is pinned to the region"
 * for as long as the calling scope lives, and returns the shell's zoom (1 when
 * there is no shell above, so nothing to tell and nothing zooming the board).
 */
export function registerBoardRegionPin(): Readonly<Ref<number>> {
  const channel = inject(BOARD_REGION_PIN, null);
  if (!channel) return UNZOOMED;
  channel.pinnedBoards.value += 1;
  onScopeDispose(() => { channel.pinnedBoards.value -= 1; });
  return channel.zoom;
}

/**
 * The width `.boardregion` gives a board: its content box with its vertical
 * scrollbar showing, whether or not it shows now (#1343). The pin and the fit
 * both read this, so a scrollbar coming or going changes neither of them. In a
 * browser without `scrollbar-gutter` it would otherwise change both, at
 * different moments, and they flipped each other every frame. The computed
 * width is the exact content box `100cqw` resolves to, where `clientWidth`
 * rounds to a whole pixel.
 */
export function regionWidth(region: HTMLElement): number {
  const overflowY = region.style.overflowY;
  region.style.overflowY = 'scroll';
  const width = parseFloat(getComputedStyle(region).width) || 0;
  region.style.overflowY = overflowY;
  return width;
}

/**
 * How much wider than `regionWidth` the region's `100cqw` resolves (#1353).
 * Where the region reserves no scrollbar gutter (Safari before 18.2, or
 * `scrollbar-gutter: auto`), Chromium and WebKit resolve `100cqw` as if the
 * vertical scrollbar were not there, so a cap at `100cqw` would be a
 * scrollbar too wide. 0 where `100cqw` is the region's width.
 */
export function cqwOverhang(region: HTMLElement): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position: absolute; width: 100cqw; height: 0';
  region.append(probe);
  // Read before regionWidth forces the scrollbar, which would change what 100cqw resolves to.
  const cqw = parseFloat(getComputedStyle(probe).width) || 0;
  probe.remove();
  return Math.max(0, cqw - regionWidth(region));
}
