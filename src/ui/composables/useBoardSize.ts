/**
 * useBoardSize — pin a content-flow board to the visible board-region width.
 *
 * GameShell sizes the board to its own intrinsic (max-content) width via
 * `.game-shell__zoom-container { width: max-content }` and lets the region
 * scroll. That is the right model for boards with a fixed natural size (a
 * checkers grid, a hex map): useAutoZoom measures "how big does this board
 * want to be" and zoom-fits it once at startup. But it means a board whose
 * width comes from its CONTENT — card hands, wrapping rows — is never handed
 * a width to wrap against: `width: 100%` resolves against a max-content
 * ancestor, `flex-wrap`/`@container` never trigger, and the board just grows
 * horizontally as content is added.
 *
 * This composable is for that second kind of board. It measures `.boardregion`
 * (the ancestor GameShell sizes to the visible viewport) and pins the board's
 * root to the region's available width, so wrapping works and growth is
 * vertical-scroll only:
 *
 * ```vue
 * <script setup>
 * const boardRef = ref<HTMLElement | null>(null);
 * const { boardStyle } = useBoardSize(boardRef);
 * </script>
 * <template>
 *   <div ref="boardRef" class="my-board" :style="boardStyle">…</div>
 * </template>
 * ```
 *
 * Do NOT use it for fixed-intrinsic boards — pinning those to the region
 * accomplishes nothing, and the max-content + auto-zoom model already fits
 * them. See the "Board Sizing" section of docs/custom-ui-guide.md.
 *
 * Auto-zoom interaction: calling this composable also TELLS the shell which
 * model the board is in, so useAutoZoom fits a pinned board on WIDTH ONLY
 * (see composables/boardRegionPin.ts). A board taller than the region scrolls,
 * as documented — it is never scaled down to avoid that scrollbar, which would
 * shrink every glyph on it below its declared size. The width term still
 * applies, so genuine horizontal overflow is still fitted; since the board is
 * pinned to the region's width, that term is 1 in the normal case and the
 * board renders at 100%. There is nothing for the game to wire up: the pin is
 * the statement of intent, and the pin carries it.
 *
 * The pin is deliberately measured WITHOUT dividing out the applied zoom:
 * compensating would feed the pinned width back into useAutoZoom's
 * natural-size measurement mid-settle and the two would chase each other.
 */
import { ref, computed, watch, onBeforeUnmount, type Ref } from 'vue';
import { registerBoardRegionPin } from './boardRegionPin.js';

export function useBoardSize(boardEl: Ref<HTMLElement | null>) {
  // Declare the model to the shell for this scope's lifetime. Done at call
  // time, not on first measurement: calling useBoardSize IS the declaration,
  // and the fit must not depend on which composable measured first.
  registerBoardRegionPin();

  /** Region width available to the board (region client box minus horizontal
   *  padding), in CSS pixels. 0 until the first successful measurement. */
  const availWidth = ref(0);

  /** Bind to the board root. Empty until measured, so the board keeps its
   *  natural size for the first paint rather than flashing at width 0. */
  const boardStyle = computed(() =>
    availWidth.value ? { width: `${availWidth.value}px` } : {},
  );

  function findRegion(): HTMLElement | null {
    return (boardEl.value?.closest('.boardregion') as HTMLElement | null)
      ?? boardEl.value?.parentElement
      ?? null;
  }

  function measure() {
    const host = findRegion();
    if (!host) return;
    const cs = getComputedStyle(host);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    availWidth.value = Math.max(0, host.clientWidth - padX);
  }

  let regionObserver: ResizeObserver | null = null;

  function teardown() {
    regionObserver?.disconnect();
    regionObserver = null;
    window.removeEventListener('resize', measure);
  }

  // The board root can mount late (v-if on the game screen) or remount on a
  // new game, so wire up per-element rather than once in onMounted.
  watch(boardEl, (el) => {
    teardown();
    if (!el) return;
    measure();
    // Re-measure once after layout settles (fonts / iframe sizing can shift
    // the region between mount and first paint).
    requestAnimationFrame(measure);

    const region = el.closest('.boardregion') as HTMLElement | null;
    if (region && typeof ResizeObserver !== 'undefined') {
      regionObserver = new ResizeObserver(measure);
      regionObserver.observe(region);
    }
    // Real viewport changes (window resize, device rotation) reflow the
    // region; re-pin so wrapping tracks the new width.
    window.addEventListener('resize', measure);
  }, { immediate: true, flush: 'post' });

  onBeforeUnmount(teardown);

  return { availWidth, boardStyle, measure };
}
