/**
 * boardRegionPin — what `useBoardSize()` needs from the shell and the region.
 *
 * The shell's zoom comes down to the board (#1332): the region is outside the
 * magnified container and the board inside it, so a board fitting itself to
 * the region must divide by the zoom, and ResizeObserver does not report a
 * zoom change. `useBoardZoom()` provides it from GameShell's setup; outside a
 * shell (unit harnesses, non-shell hosts) the inject misses and the zoom is 1.
 */
import { hasInjectionContext, inject, provide, readonly, ref, type InjectionKey, type Ref } from 'vue';

const BOARD_ZOOM: InjectionKey<Readonly<Ref<number>>> = Symbol('boardsmith:board-zoom');

/** Outside a shell nothing zooms the board. */
const UNZOOMED: Readonly<Ref<number>> = readonly(ref(1));

/** Called by `useBoardZoom()` with the zoom the shell applies to the board. */
export function provideBoardZoom(zoom: Readonly<Ref<number>>): void {
  provide(BOARD_ZOOM, readonly(zoom));
}

/** Called by `useBoardSize()` and `useFlyingElements()`: the shell's zoom, or 1 when there is no shell above. */
export function injectBoardZoom(): Readonly<Ref<number>> {
  // Outside a component (a composable called from a plain script) Vue's inject returns undefined, not the default.
  return hasInjectionContext() ? inject(BOARD_ZOOM, UNZOOMED) : UNZOOMED;
}

/**
 * The scale the shell's magnifier applies to `el`, read from the element itself
 * (#1619, #1664): the `--zoom-level` PlayShell's zoom container applies, 1 for
 * an element outside it, such as the player strip or anything outside a shell.
 */
export function boardZoomAt(el: Element): number {
  const zoomContainer = el.closest('.game-shell__zoom-container');
  return zoomContainer ? parseFloat(getComputedStyle(zoomContainer).getPropertyValue('--zoom-level')) : 1;
}

/**
 * The width `.boardregion` gives a board: its content box with its vertical
 * scrollbar showing, whether or not it shows now (#1343), so a scrollbar coming
 * or going never changes the pin. The computed
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
