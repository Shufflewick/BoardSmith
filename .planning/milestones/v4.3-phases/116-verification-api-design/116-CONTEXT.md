# Phase 116: Verification & API Design - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish ground truth on what already exists vs. what must be built, and lock a single reviewed API-design doc so all later implementation (Phases 117–121) builds the agreed surface — exposing/documenting existing APIs rather than rebuilding them. This phase verifies each scouted friction claim against the real code (confirmed / false / partial, with file:line evidence) and produces the design contract. **No production code changes** — read/verify only, plus the design artifact.

The "scouted friction claims" to verify are the premises behind each requirement (INTRO-01..05, TEST-01..05, DEV-01..04, PIT-01..04) plus the three named "already exists" claims from PROJECT.md: `getPlayerView()`, private checkpoint/rewind APIs, and an existing action-resolved signal.

</domain>

<decisions>
## Implementation Decisions

### Design Doc — Location & Structure
- The locked design doc lives at a single `.planning/v4.3-API-DESIGN.md` (planning approval artifact, not yet user-facing docs — Phase 122 writes the public `docs/`).
- One doc with two parts: (1) a verification verdicts table (claim → confirmed/false/partial → file:line evidence → "already exists vs. needs building" note), and (2) the full API spec — names, signatures, return shapes, serialization format, and ownership across engine/session/runtime/ui.
- API spec depth: full signatures + return shapes + serialization (per DSGN-02 success criterion), not high-level sketches.

### Approval Gate
- **Hard gate.** Autonomous mode pauses after the design doc is produced and presents it for the user's explicit approval before Phase 117 implementation begins. The phase is not "done" until the doc is approved — this is the milestone's keystone control point (criterion 2).

### Speculative Scope (IN vs DEFERRED)
- Defer all Future Requirements (INTRO-F1 checkpoint/rewind API, INTRO-F2 AgentRunner, TEST-F1 hidden-info leak assertion, DEV-F1 seat-switch, DEV-F2 deterministic-AI seed, PIT-F1 boardRef/dependsOn inference) by default.
- Promote a speculative item to IN only if verification proves it is a trivial *expose-not-build* (the capability already substantially exists and just needs surfacing — e.g. checkpoint API if internal `state-history` machinery already exists). Each promotion is flagged explicitly in the doc for user sign-off as part of the approval gate.
- DSGN-03 disposition (IN vs DEFERRED with rationale) is recorded in the design doc itself.

### Claude's Discretion
- Verification methodology (which surfaces to scan, parallel fan-out vs sequential) is at Claude's discretion during planning — but every verdict must carry file:line evidence and an explicit exists-vs-build note.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Per-player visibility filtering already exists: `toJSONForPlayer` (`src/.../game.ts`) — central to INTRO-05 perspective-aware view and TEST-F1 leak detection. Note the v3.1 research flagged a `$images.face` leak in this path; confirm current state.
- Interaction substrate: `useActionController`, `useBoardInteraction`, drag orchestration — relevant to DEV-01/02/03 devtools bridge.
- Testing utilities live in `src/testing/` (TestGame, simulation) — the home for TEST-* ergonomics.
- ESLint plugin at `src/eslint-plugin/` — home for PIT-04 lint rules.

### Established Patterns
- Event-sourced state with `commandHistory` + `actionHistory`; snapshots/replays in `runtime`.
- Action validation and the v2.8 disabled-reason surface — the existing legality path INTRO builds on (do not create a parallel validation path).
- Flow lifecycle signals: `FlowState.complete`, `FlowState.awaitingInput`.

### Integration Points
- Ownership spans engine (action-space, perspective view), session (lifecycle/checkpoints), runtime (serialization/snapshots), testing (ergonomics), ui + cli/dev-host (devtools bridge). The design doc must assign each new surface to exactly one owning module.

</code_context>

<specifics>
## Specific Ideas

- Three named claims to verify with explicit verdicts: `getPlayerView()` (does it exist? where? what shape?), private checkpoint/rewind APIs (is internal `state-history` machinery present and exposable?), and an existing action-resolved signal (does the UI already emit one DEV-03 can reuse?).
- The keystone insight all four scout fronts converged on: there is no single entry point to ask "what can this seat do right now, with what choices?" — INTRO-01 is the primitive everything else (test, browser, AI) builds on. The design doc must center this.
- Reuse-not-rebuild discipline (carried from v4.2): where verification finds an API exists, the doc specifies expose/document, not duplicate.

</specifics>

<deferred>
## Deferred Ideas

- Actual implementation of any surface (Phases 117–121).
- Public documentation of the surface (Phase 122).
- Future Requirements (INTRO-F1/F2, TEST-F1, DEV-F1/F2, PIT-F1) unless promoted during verification per the policy above.

</deferred>
