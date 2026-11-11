/**
 * THE FRAME'S SAFE AREAS, AS THE HOST PAGE MEASURES THEM (#1611).
 *
 * Inside an iframe `env(safe-area-inset-*)` cannot be trusted: Chrome reads 0
 * and Safari reads the parent page's values (w3c/csswg-drafts#4670). So the
 * host measures how far each inset reaches over its frame and posts
 * `{ type: 'safe_area', top, right, bottom, left }`, in CSS pixels, on load and
 * whenever they change (a rotation). The shell pads itself by the
 * `--bsg-safe-*` tokens this writes; until a host sends them they are zero.
 */

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Write a host's `safe_area` message to the `--bsg-safe-*` tokens, or refuse it whole and say why. */
export function applySafeAreaInsets(message: { readonly [side in typeof SIDES[number]]?: unknown }): void {
  const bad = SIDES.filter((side) => {
    const value = message[side];
    return typeof value !== 'number' || !Number.isFinite(value) || value < 0;
  });
  if (bad.length > 0) {
    console.error(
      `[boardsmith] The host's safe_area message was ignored, so the game keeps the safe areas it had: ` +
        `${bad.join(', ')} must each be a number of CSS pixels, 0 or more. ` +
        `Send all four of top, right, bottom, left, e.g. { type: 'safe_area', top: 47, right: 0, bottom: 34, left: 0 }.`,
    );
    return;
  }
  for (const side of SIDES) document.documentElement.style.setProperty(`--bsg-safe-${side}`, `${message[side] as number}px`);
}
