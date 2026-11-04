/**
 * useDrawnBoardElements — which elements the board actually draws (#1589).
 *
 * Every element candidate carries a board ref, whether or not the board draws
 * it, so a ref cannot say "the board shows this". The board's own anchors can:
 * every board that spreads `anchorAttrs` (AutoUI's renderers, `useSelectable`,
 * `useSelectableGrid`, a custom board by hand) stamps the element it draws. This
 * reads them from the board's container whenever its DOM changes and reports
 * them through the shared board interaction, so the Action Panel can tell a
 * candidate the board draws from one it does not.
 */
import { watch, type Ref } from 'vue';
import { ANCHOR_ATTRIBUTES, anchoredRefsIn, type BoardInteraction } from './useBoardInteraction.js';

/** Report what `container` draws to `boardInteraction`, for as long as it is mounted. Call once, in the component that owns the board region. */
export function useDrawnBoardElements(
  boardInteraction: BoardInteraction | null | undefined,
  container: Ref<HTMLElement | null | undefined>,
): void {
  if (!boardInteraction) return;
  watch(container, (el, _previous, onCleanup) => {
    if (!el) return;
    const report = () => boardInteraction.setDrawnElements(anchoredRefsIn(el));
    const observer = new MutationObserver(report);
    observer.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ANCHOR_ATTRIBUTES });
    report();
    onCleanup(() => {
      observer.disconnect();
      boardInteraction.setDrawnElements([]);
    });
  }, { immediate: true, flush: 'post' });
}
