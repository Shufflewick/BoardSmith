# Phase 93: Renderer Rebuild - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace `AutoElement.vue` + `AutoGameBoard.vue` with a new renderer that:
- selects a hierarchy-bearing **archetype template** (grid-board / card / tableau) by introspection,
- lays out grid/hex via **closed-form math** (`useGameGrid`/`useHexGrid`),
- dispatches element rendering via a **ranked-tester registry**,
- **wires `useAnimationEvents`** so deal/flip/reveal choreography plays,
— all while leaving the interaction substrate (`useActionController`, `useBoardInteraction`,
drag-drop, FLIP/flying primitives) and its tests **provably unchanged**.

In scope (RENDER-01..05). Out of scope: board-centric interaction, multi-ref highlight,
suppressible ActionPanel, `protocol.ts` extension, and the per-UI presentation overlay —
all deferred to **Phase 94** (see D-04). The general percentage-relative solver (S2) is
deferred until a real game's topology needs it (v3.1 locked decision).
</domain>

<decisions>
## Implementation Decisions

### Old renderer disposition
- **D-01:** **Delete `AutoElement.vue` + `AutoGameBoard.vue` in Phase 93.** The new renderer is
  wired into `AutoUI.vue` as THE auto-UI renderer immediately — no dual path, single source of
  truth at all times (No Backward Compatibility hard rule). Phase 96's "delete old renderer"
  therefore reduces to removing the split-screen scaffold and verifying no cross-repo stragglers
  reference the old files. Migration of the three gate games to playability is Phase 94; this
  phase must at minimum keep them rendering (interaction still via the existing footer panel).

### Archetype template selection + honest boundary
- **D-02:** **Topology-ranked selection with an honest-fail boundary.** Selection order:
  a Grid/Hex board present → **grid-board** template; else dominant card/hand zones →
  **card** template; else → **tableau** template. Topologies outside the coordinate-addressable
  set (grid / hex / stack / hand) render a **loud "unsupported topology — use a custom UI"
  panel** (RENDER-04 honest boundary) — never a degraded guess or equal-space subdivision.
  Each archetype encodes visual hierarchy (focal board, docked hand, peripheral chrome),
  not democratic equal-space subdivision (the Boardzilla failure mode per §0 C6).

### Ranked-tester registry API (RENDER-02)
- **D-03:** **Module-level singleton registry.** Public API:
  `registerRenderer({ test: (element) => priority, component })` exported from `boardsmith/ui`.
  Built-in element renderers (card / hand / deck / die / grid / hex / piece) register at low
  priority; a consumer registers a higher-priority renderer to upgrade the auto-UI **in place**
  without touching core files. `test` returns `-1` for not-applicable; highest priority wins
  (JSONForms `rankWith` pattern, §3). This is for extending the auto-UI internally — it is NOT
  the custom-UI path (custom UIs are peer components per P1).

### Phase 93 ↔ 94 boundary
- **D-04:** **Phase 93 is pure render + animation.** The EXISTING footer `ActionPanel` and the
  current board interaction keep driving play unchanged — the substrate tests staying green is
  the *proof* the substrate is untouched (RENDER-01 success criterion). ALL board-centric
  interaction, multi-ref highlight metadata, suppressible panel, and `protocol.ts` edits are
  **deferred to Phase 94**. The only substrate touchpoint in 93 is consuming `useAnimationEvents`
  (RENDER-05) — animation is *re-wired*, not inherited (§0 C1).

### Claude's Discretion
- Component decomposition (board host + archetype template components + per-element renderer
  components + registry module + layout composables), file/dir layout under `src/ui/.../auto-ui/`,
  built-in priority bands, and exact template hierarchy CSS are planner's discretion within
  the decisions above. Reuse Phase 92's `resolvePieceVisual` / grid-size helpers (do not
  re-implement). Closed-form layout MUST go through `useGameGrid` / `useHexGrid` (RENDER-04).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative design (read §0 first — it wins over later sections)
- `docs/auto-ui-redesign-research.md` §0 — locked decisions + corrections (templates now / solver
  later; ranked dispatch S4; replace renderer keep substrate S1; C1 = animation re-wire is 93,
  interaction edits are 94; C6 = avoid equal-space subdivision).
- `docs/auto-ui-redesign-research.md` §3 (ranked-tester / JSONForms `rankWith`), §5 S1/S3/S4 (renderer,
  closed-form topology layout, registry), §2b (per-subclass defaults / sane floor).
- `.planning/PROJECT.md` "Key Decisions" + "Out of Scope" — v3.1 locked decisions.
- `.planning/REQUIREMENTS.md` RENDER-01..05.

### Phase 92 dependency (helpers to reuse)
- `.planning/phases/92-piece-grid-rendering-fixes/92-CONTEXT.md` — D-01 extractable helpers
  (`useGameGrid` / `resolvePieceVisual`) that this renderer reuses unchanged.
- The Phase 92 helper module (created during Phase 92 execution) — read the built code, not just CONTEXT.

### Code being replaced / reused
- `src/ui/components/auto-ui/AutoElement.vue`, `AutoGameBoard.vue` — DELETE & replace (D-01).
- `src/ui/components/auto-ui/AutoUI.vue` — wire the new renderer in here.
- `useGameGrid` / `useHexGrid` composables — closed-form layout math (RENDER-04).
- `useActionController`, `useBoardInteraction`, drag-drop, FLIP/flying composables + their tests —
  REUSE UNCHANGED; tests staying green is the substrate-unchanged proof.
- `useAnimationEvents` composable — consume for deal/flip/reveal (RENDER-05).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 92 helpers (`resolvePieceVisual`, grid-size resolver) — reuse, don't duplicate.
- `useGameGrid` / `useHexGrid` — existing closed-form layout math.
- `useAnimationEvents` — existing semantic deal/flip/reveal channel (old auto path never consumed it).
- The interaction substrate is a confirmed asset (§0) — drive it, don't rebuild it.

### Established Patterns
- Ranked-tester dispatch (JSONForms `rankWith`) is the chosen pattern over an `elementType` if/else cascade.
- Per-subclass sane defaults guarantee a never-blank floor (§2b).

### Integration Points
- New renderer mounts inside `AutoUI.vue` / GameShell's `#game-board` slot.
- Registry exported from `boardsmith/ui` subpath export.
- Animation events consumed via `useAnimationEvents`.

### Critical constraints
- DO NOT modify the interaction substrate or its tests (proof requirement). Animation wiring is the only touchpoint.
- DELETE old renderer files in this phase (D-01) — no dormant dual path.
</code_context>

<specifics>
## Specific Ideas

- Archetype templates must bake in focal-board / docked-hand / peripheral-chrome hierarchy — explicitly NOT equal-space subdivision (§0 C6 is the thing to avoid).
- Honest-fail panel for un-addressable topologies (not a degraded render).
- Registry API: `registerRenderer({ test, component })`, `-1` = N/A, highest priority wins.
</specifics>

<deferred>
## Deferred Ideas

- Board-centric interaction, multi-ref highlight, suppressible ActionPanel, `protocol.ts` multi-ref → **Phase 94**.
- Per-UI presentation overlay (C7) → **Phase 94**.
- General percentage-relative layout solver (S2), responsive primitives (S2b), phase/scoring renderers (S7),
  N-UI registry + live switcher (S12c), auto-eject (S10) → later milestone / earn-their-way-in.
- Split-screen scaffold removal + cross-repo migration + old-file straggler check → **Phase 95/96**.
</deferred>

---

*Phase: 93-renderer-rebuild*
*Context gathered: 2026-06-21*
