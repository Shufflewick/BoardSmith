# Phase 92: Piece & Grid Rendering Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 92-piece-grid-rendering-fixes
**Areas discussed:** Throwaway risk, Grid coords, Fail mode, Token style

---

## Throwaway risk (vs Phase 93 rebuild)

| Option | Description | Selected |
|--------|-------------|----------|
| Extractable helpers | Build piece-visual + grid-sizing as standalone composables the current renderer AND Phase 93 reuse. Near-zero throwaway. | ✓ |
| Patch in place | Fix directly inside AutoElement.vue/AutoGameBoard.vue; logic thrown away in Phase 93. | |

**User's choice:** Extractable helpers
**Notes:** Helpers (`useGameGrid`, `resolvePieceVisual`) survive the Phase 93 renderer replacement.

---

## Grid coords — what counts as "declared"

| Option | Description | Selected |
|--------|-------------|----------|
| Both paths valid | Declared if EITHER $rowCoord/$colCoord set OR gridCoordNames inferable; fail only when neither yields dimensions. | ✓ |
| Explicit only | Require explicit $rowCoord/$colCoord; remove the inferred path too. | |

**User's choice:** Both paths valid
**Notes:** Preserves games relying on inference; 8×8 hardcoded fallback removed from all paths.

---

## Fail mode (missing coordinates)

| Option | Description | Selected |
|--------|-------------|----------|
| Visible error panel | In-board panel naming element + fix, plus console.error; UI stays usable. | ✓ |
| Thrown error | Throw during render — hard fail, takes the board down. | |

**User's choice:** Visible error panel
**Notes:** Message must name the element and the exact prop to add; no internals leaked.

---

## Token style (piece with no image)

| Option | Description | Selected |
|--------|-------------|----------|
| Colored disc + label | Circular owner-colored token, label centered; matches hex-piece-circle. | |
| Owner color, shape by type | Color from owner; shape varies by element type. | |
| You decide | Planner picks, defaulting to colored disc + label. | ✓ |

**User's choice:** You decide
**Notes:** Default to colored disc + centered label; owner color from `player.color`.

## Claude's Discretion

- Token style (defaulting to colored disc + label).
- Helper names/locations, neutral token color, shape-by-type, error-panel markup.
- Piece image convention: locked to existing `$images` (no new `$image` prop) — decided
  without re-asking, consistent with v3.1 locked decisions.

## Deferred Ideas

None — discussion stayed within phase scope.
