# Phase 92: Piece & Grid Rendering Fixes - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Make game pieces render meaningful visuals by default, and make grid boards size
from their declared coordinate system — eliminating silent fallbacks.

In scope (success criteria from ROADMAP / REQUIREMENTS PIECE-01..03):
1. A piece with `$images` configured renders as an **image**, not a text-label box.
2. A piece with no image renders as a **labeled, owner-colored token** — distinguishable without text alone.
3. A grid board sizes from its **declared coordinate system**; the hardcoded 8×8 default is removed.
4. A grid board with **missing/undeclared coordinates fails loudly** with an actionable message — no silent fallback.

Out of scope: the full renderer rebuild (Phase 93), hex layout changes, interaction
rewiring (Phase 94). Phase 92 fixes pieces & grid in the *current* renderer — but does
so via extractable helpers Phase 93 will reuse (see D-01).
</domain>

<decisions>
## Implementation Decisions

### Throwaway risk / where the fix lands
- **D-01:** Build the fix as **extractable helpers**, not in-place patches. Piece-visual
  resolution and grid-sizing become standalone composables/functions that the *current*
  `AutoElement.vue` / `AutoGameBoard.vue` call AND that the Phase 93 renderer reuses
  unchanged. Near-zero throwaway. Proposed shapes (names at planner's discretion):
  - `useGameGrid(element) -> { rows, cols }` or throws/returns an error sentinel.
  - `resolvePieceVisual(element) -> { kind: 'image', src } | { kind: 'token', color, label }`.
  - Reuse the existing `$images` extraction logic already in `AutoElement.vue`
    (lines ~320–405) rather than duplicating it — lift it into the shared helper.

### Grid coordinate system — what counts as "declared"
- **D-02:** **Both inference paths remain valid.** A grid is "declared" if EITHER
  `$rowCoord`/`$colCoord` are set OR `gridCoordNames` can be inferred from children.
  Resolution order: explicit `$rowCoord`/`$colCoord` → inferred `gridCoordNames` →
  **loud error**. The 8×8 hardcoded fallback is removed from every path
  (`AutoElement.vue` ~609/619 and `AutoGameBoard.vue`).
- **D-03:** Loud failure surfaces as a **visible in-board error panel** naming the
  element id and the fix (e.g. `Grid "board" can't render — declare $rowCoord/$colCoord
  on the Grid element`), AND a `console.error`. Do NOT throw — the rest of the UI stays
  usable; the designer cannot miss the panel. Error message must be actionable
  (names the element + the exact prop to add). Never leak file paths / line numbers / stack.

### Piece image convention
- **D-04:** Pieces **reuse the existing `$images` convention** — no new `$image`
  singular prop (the `$image`/`$stats`/`$label`/`$render`/`$owner` props were rejected in
  the v3.1 locked decisions). A piece's image comes from `$images.face` (or a bare string
  treated as the single image), resolved by the same extraction helper used for cards. One
  convention across cards and pieces.

### Default token appearance (no image) — Claude's Discretion
- **D-05:** Token shape/style is at the planner's discretion, **defaulting to a colored
  disc + centered label**, consistent with the existing `hex-piece-circle` convention.
  Owner color comes from `player.color` (first-class engine property since v2.5) — read it
  off the element's owning player, do not reintroduce a `$owner`/color `$`-prop. Pieces
  with no owner fall back to a neutral token color (planner picks). "Distinguishable without
  text alone" means color (and optionally shape) must carry identity even if the label is empty.

### Claude's Discretion
- Helper file locations/names, token neutral color, whether shape varies by element type
  (default: disc for all), and exact error-panel markup are all planner's discretion within
  the decisions above.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone design & decisions
- `docs/auto-ui-redesign-research.md` §0 — authoritative redesign research + red-team verdict
  (archetype templates now / solver later; presentation in `ui` overlay; no value-bearing `$`-props).
- `.planning/PROJECT.md` "Current Milestone" + "Key Decisions" + "Out of Scope" — locked v3.1 decisions.
- `.planning/REQUIREMENTS.md` PIECE-01/02/03 — the requirements this phase satisfies.

### Code being modified
- `src/ui/components/auto-ui/AutoElement.vue` — piece template (~1277, currently renders bare
  `{{ displayLabel }}`); `$images` extraction (~320–405); `boardSize` 8×8 fallback (~607–629).
- `src/ui/components/auto-ui/AutoGameBoard.vue` — grid layout + `$images` pass-through (~77–190);
  any 8×8 / default dimension logic.
- Existing hex-piece-circle styling in `AutoElement.vue` — the token-style precedent (D-05).

### Player color source
- `player.color` (engine, first-class since v2.5) — owner color for default tokens (D-05).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `$images` extraction logic in `AutoElement.vue` (~320–405) handles string + sprite-sheet
  formats — lift into the shared `resolvePieceVisual` helper rather than duplicating.
- `hex-piece-circle` + `player-${seat}` class convention (~1228+) is the existing
  owner-colored token precedent for D-05.
- `gridCoordNames` computed + `$rowCoord`/`$colCoord` attribute reads (`AutoElement.vue` ~607+)
  are the existing grid-sizing inputs to lift into `useGameGrid`.

### Established Patterns
- Phase 93 will replace `AutoElement.vue` + `AutoGameBoard.vue` (RENDER-01) — so D-01's
  extractable-helper approach is what keeps Phase 92 work alive.
- `player.color` is engine-guaranteed (no fallback chains) — read directly.

### Integration Points
- Helpers consumed by current renderer now, by the Phase 93 renderer later.
- Error panel renders within the board area of the current `AutoElement`/`AutoGameBoard` tree.
</code_context>

<specifics>
## Specific Ideas

- Error-panel wording must name the element and the exact prop to declare — actionable, no internals.
- Token default = colored disc + centered label (hex-piece-circle parity).
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Ranked-tester dispatch, archetype templates,
and the full renderer rebuild are Phase 93; interaction/presentation are Phase 94.)
</deferred>

---

*Phase: 92-piece-grid-rendering-fixes*
*Context gathered: 2026-06-20*
