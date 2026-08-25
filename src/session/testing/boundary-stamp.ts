/**
 * Test-side helpers for stamping the REQUIRED `boundaryKey` on a submission op.
 *
 * ## What these are, and what they are deliberately not
 *
 * Neither of these can invent a key. Both take the thing whose boundary is
 * being named — a snapshot, or a host — and return THAT thing's key. Hand one a
 * stale snapshot and you get a stale key, which is exactly how a test composes
 * a submission against a round that has since closed.
 *
 * There is deliberately NO helper that reads "whatever the current key is" for
 * a caller that did not say which state it composed against. That helper would
 * be the bypass: every un-updated call site would silently take it, the field
 * would be decorative, and every suite would stay green while the defect
 * `docs/simultaneous-and-interrupt-semantics.md` describes stayed live.
 *
 * These exist because a test that drives `executeOp`/`handleOp` directly IS the
 * client: it composed the op against the state it is holding, in the same tick,
 * so naming that state's boundary is the true answer — not a default.
 */

import { flowBoundaryKey, type BoundaryKeyState } from '../../engine/flow/boundary-key.js';

/**
 * The boundary key a client that had just rendered `rendered` would echo back on
 * its next submission.
 *
 * Takes anything that CARRIES a flow state — a `GameStateSnapshot`, a per-seat
 * player view, a dev-host `game_state` frame's `view`. They are all the same
 * question ("which round was I looking at?") asked of different envelopes, and
 * `flowBoundaryKey` reads the same material out of each.
 */
export function boundaryKeyOf(rendered: unknown): string {
  return flowBoundaryKey((rendered as { flowState?: BoundaryKeyState } | null | undefined)?.flowState);
}

/**
 * The boundary key `host` is currently broadcasting — the same value it puts on
 * every `meta.turnBoundary.key`, which is what a seat echoes back.
 */
export function boundaryKeyOfHost(host: { readonly flowState: unknown }): string {
  return flowBoundaryKey(host.flowState as BoundaryKeyState | null);
}
