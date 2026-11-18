/**
 * useBoardFocusHandoff — #172, the last mile of the panel→board handoff.
 *
 * When a choice is too large for the Action Panel to list, the panel offers one
 * control that hands the choice to the board. That makes the board the ONLY path
 * into the choice, so focus has to make the same journey — otherwise the player
 * who pressed the button is standing on a control that has just been replaced,
 * with focus on <body> and no way back in without a pointer.
 *
 * AutoUI's grid and hex boards move focus onto their first CANDIDATE cell
 * themselves (see useSelectableGrid's focusFirstCandidate), which is the better
 * answer because they know which cells the choice accepts. This composable is the
 * floor beneath that: if nothing inside the board took focus, put it on the
 * board's first tab stop. It is what makes the handoff safe for a CUSTOM board
 * that has not wired anything up — every board that uses `useSelectable`,
 * `useSelectableGrid`, or its own roving tabindex has a tab stop for this to find.
 *
 * A custom board that wants the cursor to land on a real candidate should watch
 * `boardInteraction.boardFocusRequest` and focus that candidate itself; doing so
 * pre-empts this fallback, because the fallback only acts when focus is still
 * outside the board.
 */
import { watch, nextTick, type Ref } from 'vue';
import type { BoardInteraction } from './useBoardInteraction.js';
import { getFocusable } from './useFocusTrap.js';

/**
 * Focus the first tab stop inside `container`. Returns whether focus landed, so
 * a caller can tell "there was nothing to focus" from "focus moved".
 */
export function focusFirstBoardTarget(container: HTMLElement | null | undefined): boolean {
  if (!container) return false;
  // A negative tabindex parks a match out of the Tab order, such as a roving grid's other cells.
  for (const target of getFocusable(container).filter((el) => el.tabIndex >= 0)) {
    target.focus();
    if (document.activeElement === target) return true;
  }
  return false;
}

/**
 * Wire the board container to `requestBoardFocus()`. Call once, in the component
 * that owns the board region.
 */
export function useBoardFocusHandoff(
  boardInteraction: BoardInteraction | null | undefined,
  container: Ref<HTMLElement | null | undefined>,
): void {
  if (!boardInteraction) return;

  watch(
    () => boardInteraction.boardFocusRequest,
    async (tick) => {
      if (!tick) return;
      // Two ticks: the board renderers do their own candidate-aware focus on the
      // first one. This runs after, and only if they did not.
      await nextTick();
      await nextTick();
      const el = container.value;
      if (!el) return;
      if (el.contains(document.activeElement)) return;
      focusFirstBoardTarget(el);
    },
  );
}
