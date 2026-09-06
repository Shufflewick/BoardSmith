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

/** Anything the browser will let a Tab press reach. */
const TAB_STOP_SELECTOR = '[tabindex]:not([tabindex="-1"])';

/**
 * Focus the first tab stop inside `container`. Returns whether it found one, so
 * a caller can tell "there was nothing to focus" from "focus moved".
 */
export function focusFirstBoardTarget(container: HTMLElement | null | undefined): boolean {
  const target = container?.querySelector(TAB_STOP_SELECTOR);
  if (!(target instanceof HTMLElement) && !(target instanceof SVGElement)) return false;
  // SVGElement carries focus() in every browser that supports tabindex on SVG,
  // which is every browser BoardSmith targets — hex boards are <g> elements.
  (target as unknown as HTMLElement).focus();
  return true;
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
