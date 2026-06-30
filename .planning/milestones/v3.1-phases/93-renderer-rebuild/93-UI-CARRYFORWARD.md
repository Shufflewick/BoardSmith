# Phase 93 — Carry-forward from Phase 92 UI Review

The Phase 92 UI review (20/24, advisory) surfaced 3 findings, all in `AutoElement.vue` —
the file Phase 93 **deletes and replaces** (decision D-01). Do NOT fix them in the old file
(throwaway). Instead, the **new renderer must not reproduce them**. Treat these as acceptance
requirements for the Phase 93 renderer + its UI-SPEC:

1. **Piece hover affordance.** Non-hex board pieces must have a hover feedback rule
   (`.piece:hover { transform: scale(1.05) }` or equivalent), matching the `transition: transform`
   already wired. The old code wired the transition but omitted the hover rule. The new renderer
   must include it for standard pieces (hex/dice already had it).

2. **Single box-shadow on token pieces.** The old code stacked a `.piece` wrapper shadow AND a
   `.piece-token` shadow, roughly doubling intensity for tokens. The new renderer's token visual
   must carry exactly one shadow (no double-stacking from a wrapper).

3. **Grid-error-panel copy parity (D-03).** The error-panel text and the `console.error` string
   MUST be identical. The helper's string is the source of truth and survives into Phase 93:
   `auto-ui-helpers.ts:169` → `Grid "<id>" can't render — declare $rowCoord/$colCoord on the Grid element`.
   The new renderer's panel must render this exact wording (capitalization, `/` not `and`,
   `the` not `this`). The old panel (AutoElement.vue:1105) diverged — do not copy it.

These are also expected to be re-checked by Phase 93's own UI review.
