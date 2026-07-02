/**
 * @module ui/composables/useAnimationTestMode
 *
 * Animation test-mode + trace recorder (ANIM-01).
 *
 * This module is DELIBERATELY Vue-free — not even a type-only Vue import —
 * so it can be statically re-exported from both `boardsmith/ui` and
 * `boardsmith/testing` without pulling Vue into the testing subpath. The five
 * animation composables (`useFLIP`, `useFlyingElements`, `useElementAnimation`,
 * `useActionAnimations`, and friends) consult `isAnimationTestModeEnabled()`
 * and call `recordTrace()` so an agent/test can enable an instant/traced mode
 * and assert "card X flew from A to B" headlessly, without a real DOM or
 * requestAnimationFrame timing.
 *
 * Test mode is an EXPLICIT, opt-in flag — default OFF. It is never toggled by
 * `prefers-reduced-motion` or any environment/build-mode detection: those are
 * a real accessibility preference (reduced animation duration), while this is
 * a completely different concern (deterministic, assertable animation
 * tracing for tests). Merging the two would let a user's OS-level a11y
 * setting silently put a shipped game into a test/tracing mode — conflating
 * an accessibility signal with a test-harness signal. See CONTEXT.md.
 *
 * Traces record element identity + container/anchor names only (see
 * `AnimationTrace`). They must never carry hidden-info payloads (card
 * face/rank/suit values, etc.) — only identity strings and layout geometry in
 * `meta`, mirroring the same "assertable but not secret" discipline as
 * `boardsmith/testing`'s DOM-leak utilities.
 */

/**
 * A single recorded animation event.
 *
 * `from`/`to` are container/anchor IDENTITIES (assertable strings), not DOM
 * rects or hidden values — e.g. a hand/deck/discard-pile name, or an anchor
 * attribute value. Geometry (rects, deltas) and other non-secret diagnostic
 * data belongs in `meta`.
 */
export interface AnimationTrace {
  kind: 'flip' | 'fly' | 'element' | 'action';
  /** data-bs-el-id / element id / caller-supplied identifier, or null if not applicable */
  element: string | null;
  /** Container / anchor identity the element animated FROM (assertable) */
  from: string | undefined;
  /** Container / anchor identity the element animated TO (assertable) */
  to: string | undefined;
  /** Non-secret diagnostic data only — rects, deltaX/deltaY, elementData. NEVER hidden-info values. */
  meta?: Record<string, unknown>;
}

/** Module-level state: explicit flag, default OFF. */
let enabled = false;

/** Module-level state: the recorded trace buffer. */
let trace: AnimationTrace[] = [];

/**
 * Enable animation test mode. While enabled, `recordTrace()` pushes onto the
 * trace buffer; while disabled it is a no-op.
 */
export function enableAnimationTestMode(): void {
  enabled = true;
}

/**
 * Disable animation test mode. Stops further recording but does NOT clear
 * already-recorded entries — call `clearAnimationTrace()` separately for
 * that (mirrors `_clearShownWarnings()`'s explicit-reset pattern).
 */
export function disableAnimationTestMode(): void {
  enabled = false;
}

/** Whether animation test mode is currently enabled. */
export function isAnimationTestModeEnabled(): boolean {
  return enabled;
}

/**
 * Record an animation trace entry. Pit of Success guard: this is a no-op
 * unless test mode is enabled, so a stray call from a composable's normal
 * (non-test) render path never leaks into production behavior or leaks
 * memory by accumulating an unbounded buffer.
 */
export function recordTrace(entry: AnimationTrace): void {
  if (!enabled) return;
  trace.push(entry);
}

/** Get the recorded trace entries in insertion order. */
export function getAnimationTrace(): readonly AnimationTrace[] {
  return trace;
}

/**
 * Clear the recorded trace buffer (test isolation between cases). Mirrors
 * `_clearShownWarnings()` in `src/utils/dev.ts`.
 */
export function clearAnimationTrace(): void {
  trace = [];
}
