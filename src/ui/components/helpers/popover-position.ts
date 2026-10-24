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
  /** The room on the popover's side of the trigger: a taller popover scrolls inside this height. */
  maxHeight: number;
}

/**
 * What a popover too tall for the room on either side of its trigger does.
 * - `'scroll-beside'`: goes on the roomier side, capped to that room, and scrolls
 *   inside, so it never covers its trigger. For a popover the pointer moves into (#1454).
 * - `'cover-trigger'`: shows whole, inside the window, even over its trigger, and is
 *   capped only at the window. For a pointer-transparent one nothing can scroll (#1459).
 */
export type TooTall = 'scroll-beside' | 'cover-trigger';

/**
 * Minimum clearance between the popover's bottom edge and the viewport bottom
 * before it flips above the trigger. `--bsg-s4`.
 */
const FLIP_THRESHOLD = 16;

/** Clearance kept between the popover and the viewport's left, right and top edges. `--bsg-s2`. */
const EDGE_MARGIN = 8;

/** Gap between trigger and popover. */
const OFFSET = 4;

/** Caret inset from the popover's corners, so it never overhangs a rounded edge. */
const CARET_INSET = 12;

/**
 * Place a popover below its trigger, flipping above when the bottom edge would
 * crowd the viewport. One that fits neither side is placed as `tooTall` says.
 * Clamps horizontally so it never overflows the right edge. The caret tracks the trigger's centre through that clamping, so it keeps
 * pointing at the control it describes.
 *
 * @param triggerRect - The anchor's `getBoundingClientRect()`.
 * @param height      - The popover's RENDERED height. Measure it (after the
 *                      element mounts) rather than guessing: flip detection on a
 *                      guessed height is what lets a tall popover run off-screen.
 * @param width       - The popover's RENDERED width, for the right-edge clamp. A
 *                      narrower guess than the real one would leave a short popover
 *                      clear of a trigger near the right edge, with no path into it.
 * @param tooTall     - What a popover that fits neither side does; see {@link TooTall}.
 */
export function computePopoverPosition(
  triggerRect: DOMRect,
  height: number,
  width: number,
  tooTall: TooTall,
): PopoverPosition {
  const roomBelow = window.innerHeight - FLIP_THRESHOLD - triggerRect.bottom - OFFSET;
  const roomAbove = triggerRect.top - OFFSET - EDGE_MARGIN;
  const below = height <= roomBelow || (height > roomAbove && roomBelow >= roomAbove);
  let maxHeight = below ? roomBelow : roomAbove;
  let top = below ? triggerRect.bottom + OFFSET : triggerRect.top - OFFSET - Math.min(height, maxHeight);
  if (tooTall === 'cover-trigger' && height > maxHeight) {
    maxHeight = window.innerHeight - FLIP_THRESHOLD - EDGE_MARGIN;
    top = below ? window.innerHeight - FLIP_THRESHOLD - Math.min(height, maxHeight) : EDGE_MARGIN;
  }
  const caretSide = below ? 'top' : 'bottom';

  const left = Math.max(EDGE_MARGIN, Math.min(triggerRect.left, window.innerWidth - width - EDGE_MARGIN));

  const triggerMidX = triggerRect.left + triggerRect.width / 2;
  const caretLeft = Math.min(width - CARET_INSET, Math.max(CARET_INSET, triggerMidX - left));

  return { top, left, caretSide, caretLeft, maxHeight };
}
