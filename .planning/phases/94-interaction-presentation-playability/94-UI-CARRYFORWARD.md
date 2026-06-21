# Phase 94 — Carry-forward from Phase 93 UI Review

The Phase 93 UI review (19/24, advisory) surfaced findings in the new renderer. Most are addressed
by Phase 94's own plans; these notes ensure they're closed:

1. **PieceRenderer missing `action-selectable` affordance** — pieces showed no "playable" pulse while
   every other element type did. This is **already in scope for Phase 94 plan 94-03** (board-centric
   click/highlight affordances + six interaction states across all 8 renderers). Ensure PieceRenderer
   gets the `action-selectable` state along with the others — do not leave pieces as the exception.

2. **HandRenderer hardcodes "Your Hand" / "X's Hand"** — it discards the game designer's declared
   `element.name` (a spec violation). Phase 94's presentation overlay (94-04) and/or the renderer should
   honor `element.name` (and the overlay `label`) instead of hardcoded strings. Fix as part of 94-03/94-04.

3. **Null `gameView` renders a blank tableau with no loading/empty state** (`AutoRenderer.vue`) — lower
   priority and not strictly an interaction concern, but if 94 touches AutoRenderer, add a minimal
   loading/empty state. Otherwise note it as a known item for Phase 96 polish.

(Carry-forward CF-1/2/3 from Phase 92 were all verified PASS in the Phase 93 renderer.)
