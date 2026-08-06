/**
 * Viewport-aware placement for the small popovers anchored to a control:
 * ActionHelpPopover's "?" tip and the disabled-reason tooltip.
 *
 * Extracted so the two cannot drift: a popover that flips above the trigger in
 * one surface and runs off the bottom of the screen in the other is the kind of
 * difference nobody notices until a player on a short window cannot read the
 * text.
 *
 * Positions are `position: fixed` — computed from the trigger's
 * `getBoundingClientRect()` at open time. A stale position after scrolling is
 * accepted (the popovers close on scroll-adjacent interactions anyway).
 */

/** Placement result, in viewport pixels. */
export interface PopoverPosition {
  top: number;
  left: number;
  /** Which edge the caret sits on: 'top' = popover below trigger, caret points up. */
  caretSide: 'top' | 'bottom';
  /** Caret centre, relative to the popover's left edge, after edge-clamping. */
  caretLeft: number;
}

/**
 * Minimum clearance between the popover's bottom edge and the viewport bottom
 * before it flips above the trigger. `--bsg-s4`.
 */
const FLIP_THRESHOLD = 16;

/** Horizontal clearance kept between the popover and the viewport edge. `--bsg-s2`. */
const EDGE_MARGIN = 8;

/** Gap between trigger and popover. */
const OFFSET = 4;

/** Caret inset from the popover's corners, so it never overhangs a rounded edge. */
const CARET_INSET = 12;

/**
 * Place a popover below its trigger, flipping above when the bottom edge would
 * crowd the viewport, and clamping horizontally so it never overflows the right
 * edge. The caret tracks the trigger's centre through that clamping, so it keeps
 * pointing at the control it describes.
 *
 * @param triggerRect - The anchor's `getBoundingClientRect()`.
 * @param height      - The popover's RENDERED height. Measure it (after the
 *                      element mounts) rather than guessing: flip detection on a
 *                      guessed height is what lets a tall popover run off-screen.
 * @param maxWidth    - The popover's max width, used for the right-edge clamp.
 */
export function computePopoverPosition(
  triggerRect: DOMRect,
  height: number,
  maxWidth: number,
): PopoverPosition {
  let top = triggerRect.bottom + OFFSET;
  let left = triggerRect.left;
  let caretSide: 'top' | 'bottom' = 'top';

  if (top + height > window.innerHeight - FLIP_THRESHOLD) {
    top = triggerRect.top - height - OFFSET;
    caretSide = 'bottom';
  }

  if (left + maxWidth > window.innerWidth - EDGE_MARGIN) {
    left = window.innerWidth - maxWidth - EDGE_MARGIN;
  }
  if (left < EDGE_MARGIN) {
    left = EDGE_MARGIN;
  }

  const triggerMidX = triggerRect.left + triggerRect.width / 2;
  const caretLeft = Math.min(maxWidth - CARET_INSET, Math.max(CARET_INSET, triggerMidX - left));

  return { top, left, caretSide, caretLeft };
}
