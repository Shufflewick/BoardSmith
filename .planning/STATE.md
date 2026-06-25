---
gsd_state_version: 1.0
milestone: v4.1
milestone_name: Tutorial Primitives (Checkers)
status: executing
stopped_at: roadmap complete, 15/15 requirements mapped
last_updated: "2026-06-25T22:04:54.663Z"
last_activity: 2026-06-25
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 9
  completed_plans: 7
  percent: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-25)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** Phase 105 — Annotation Overlay (UI Parity)

## Current Position

Phase: 105 (Annotation Overlay (UI Parity)) — EXECUTING
Plan: 4 of 5
Status: Ready to execute
Last activity: 2026-06-25

## Milestones

**Completed:**

- v0.1 Large File Refactoring (Phases 1-4) -- shipped 2026-01-08
- v0.2 Concerns Cleanup (Phases 5-8) -- shipped 2026-01-09
- v0.3 Flow Engine Docs (Phase 9) -- shipped 2026-01-09
- v0.4 Public API Docs (Phase 10) -- shipped 2026-01-09
- v0.5 ESLint No-Shadow (Phase 11) -- shipped 2026-01-09
- v0.6 Players in Element Tree (Phases 12-13) -- shipped 2026-01-09
- v0.7 Condition Tracing Refactor (Phases 14-16) -- shipped 2026-01-10
- v0.8 HMR Reliability (Phases 17-19) -- shipped 2026-01-11
- v0.9 Parallel AI Training (Phases 20-23) -- shipped 2026-01-13
- v1.0 AI System Overhaul (Phases 24-28.1) -- shipped 2026-01-15
- v1.1 MCTS Strategy Improvements (Phases 29-36) -- shipped 2026-01-16
- v1.2 Local Tarballs (Phases 37-38) -- shipped 2026-01-18
- v2.0 Collapse the Monorepo (Phases 39-46) -- shipped 2026-01-19
- v2.1 Design-Game Skill Redesign (Phases 47-50) -- shipped 2026-01-19
- v2.2 Game Design Aspects (Phases 51-53) -- shipped 2026-01-21
- v2.3 Nomenclature Standardization (Phases 54-58) -- shipped 2026-01-22
- v2.4 Animation Event System (Phases 59-63) -- shipped 2026-01-22
- v2.5 Player Colors Refactor (Phases 64-68) -- shipped 2026-01-25
- v2.6 Code Consolidation (post-mortem driven) -- shipped 2026-01-29
- v2.7 Dead Code & Code Smell Cleanup (Phases 69-74) -- shipped 2026-02-02
- v2.8 Disabled Selections (Phases 75-79) -- shipped 2026-02-06
- v2.9 Theatre View (Phases 80-84) -- shipped 2026-02-07
- v3.0 Animation Timeline (Phases 85-90) -- shipped 2026-02-08
- v3.1 Dynamic Auto-UI (Phases 91-96) -- shipped 2026-06-22
- v4.0 UI Redesign (Slate) (Phases 97-103) -- shipped 2026-06-23

**In Progress:**

- v4.1 Tutorial Primitives (Checkers) (Phases 104-110) -- started 2026-06-25; roadmap created 2026-06-25

## Accumulated Context

### Roadmap Evolution

- v4.1 roadmap derives 7 substrate-first phases (104–110) from 15 v1 requirements. The TUT substrate (104–106) is foundational and must land before the checkers showcase (CHK, Phase 109) and the AI hint (AI-01, Phase 107).
- Phase 104 (lifecycle + action gating) is the engine/session base; Phase 105 (annotation overlay) is the UI base; Phase 106 (predicate triggers + CI-verifiable authoring) completes authoring.
- The annotation overlay (TUT-01, Phase 105) has a HARD parity constraint — it MUST route through `useBoardInteraction` so it works identically in custom UI and AutoUI (project hard-rule).
- CI-verifiable authoring via the `testing` DSL (TUT-04, Phase 106) lands before/alongside CHK so the checkers tutorial is authored as a verifiable artifact, not retrofitted.
- AI-01/02/03 (Phase 107) reuse checkers' EXISTING MCTS bot (`~/BoardSmithGames/checkers/src/rules/ai.ts`) — no new training; the work is surfacing existing evaluations to the UI.
- CHK-* (Phase 109) authored cross-repo in `~/BoardSmithGames/checkers` (symlinked to this repo's node_modules) while the substrate lands in this repo's `src/`.
- DEMO-01 (Phase 110) is the FINAL phase — the user's explicit "demonstrate to me so we can refine" gate, browser-verified end-to-end, before the future cribbage (CRIB) milestone.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

**v4.1 roadmap decisions (2026-06-25):**

- Substrate-first sequencing: engine/session lifecycle+gating (104) → UI overlay (105) → triggers + CI-authoring (106) → teaching layers (107 AI, 108 HELP) → checkers showcase (109) → demo gate (110).
- TUT-01 annotation overlay must route through `useBoardInteraction` for custom-UI/AutoUI parity (hard-rule), verified in both UI paths.
- Action gating (TUT-02) reuses the engine's existing action validation and the v2.8 disabled-reason surface — no parallel validation path.
- AI teaching features reuse checkers' existing MCTS; no new training/weights.
- Checkers tutorial content (CHK-*) lands cross-repo in `~/BoardSmithGames/checkers`; substrate stays in this repo's `src/`.
- DEMO-01 framed as a refinement checkpoint, not a sign-off — captured friction feeds the substrate before cribbage (v2 CRIB).

### Highest-Risk Items

1. `useBoardInteraction` parity for the annotation overlay (Phase 105) — a primitive that works in only one UI path violates the hard-rule; verify both paths.
2. Tutorial progress serialization round-trip (Phase 104) — must be checkpoint/replay safe like prior engine state.
3. CI-verifiable authoring (Phase 106) — the test must actually fail on a broken rule, not pass vacuously; prove with a deliberately broken rule.
4. Cross-repo authoring (Phase 109) — substrate in `src/` vs content in `~/BoardSmithGames/checkers`; keep the symlinked dev loop green.

### Pending Todos

Carried from v4.0 (non-blocking): dev-standalone shell height gap; pre-existing dev-host AI-turn issue; orphaned tokens / lint scope / focus-ring naming / platform-mode connection-announce seam. See `.planning/todos/pending/`.

**Carry-forward from Phase 104 code review (Medium/Low — address in the consuming phase, see 104-REVIEW.md):**

- **MR-01 → Phase 105:** `suppressAutoFill`/active-tutorial-step is accepted by `useActionController` but no PRODUCTION code yet passes the projected `PlayerGameState.tutorial` into it — inert end-to-end (works only in tests that inject it). Phase 105 (UI consumes the tutorial) must wire the projection → the real ActionPanel/board controller.
- **MR-02 → Phase 106:** predicate-form gates are currently all-or-nothing/permissive; flesh out when predicate triggers land.
- **LR-02 → Phase 109:** gate `from`/`to` are lumped into one set, blind to selection name — checkers "piece c3 → square d4" needs per-selection-name gating.
- **MR-03 / LR-01 (minor):** `start()` on empty `steps` is a silent no-op (should fail loud); `skip()` records identically to `advance()` (no distinction). Address opportunistically.

**Phase 104 pre-existing tech debt surfaced (NOT introduced by 104, out of scope):** `tsc --noEmit` reports type-looseness errors in test files this repo does not gate on `tsc` (HandRenderer.a11y, GameHistory, DebugPanel, notation-serialization). Repo gates on vitest + eslint. Candidate for a future cleanup pass.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-06-25T22:04:54.656Z
Stopped at: roadmap complete, 15/15 requirements mapped
Resume file: None
Next action: `/gsd:plan-phase 104`

## Operator Next Steps

- Plan the first phase with `/gsd:plan-phase 104`
