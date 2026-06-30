---
gsd_state_version: 1.0
milestone: v4.2
milestone_name: Tutorial Primitives — Go Fish & Docs — Phases 112–115
status: executing
stopped_at: v4.2 roadmap created — Phases 112–115 defined
last_updated: "2026-06-30T15:48:38.265Z"
last_activity: 2026-06-30
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 7
  completed_plans: 5
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-30)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** Phase 113 — go-fish-ai-teaching

## Current Position

Phase: 113 (go-fish-ai-teaching) — EXECUTING
Plan: 2 of 3
Status: Ready to execute
Last activity: 2026-06-30

Progress: [███████░░░] 71%

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
- v4.1 Tutorial Primitives (Checkers) (Phases 104-111) -- shipped 2026-06-30

**In Progress:**

- v4.2 Tutorial Primitives — Go Fish & Docs (Phases 112-115) — started 2026-06-30

## Deferred Items

Items acknowledged and deferred at v4.1 milestone close on 2026-06-30:

| Category | Item | Status | Note |
|----------|------|--------|------|
| verification | 108-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): action help demonstrated live + user-approved |
| verification | 109-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): checkers tutorial demonstrated live + user-approved |
| uat | 108-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| uat | 109-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| todo | dev-host-ai-open-seat-not-auto-playing | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | dev-standalone-shell-height-gap | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | (third pending todo) | open | Pre-existing v4.0 carry-forward (non-blocking) |
| debug | knowledge-base | reference | Debug knowledge-base file, not an active session |

Backlog for a future cribbage (v2 CRIB) milestone: R-05 (suppress Undo during guided tutorial steps), R-12 (strategy tutorial track), pit-of-success lint/dev-warning when a custom board omits `anchorAttrs`. Repo-wide: 3 pre-existing eslint no-shadow errors (game.ts, useAnimationEvents.ts, useFlyingElements.ts) + tsc test-file looseness — future cleanup pass.

## Accumulated Context

### Roadmap Evolution

- v4.2 roadmap defined (2026-06-30): 4 phases (112–115), 14 requirements. Reuse-not-rebuild: all substrate lives in v4.1 `src/`; phases are cross-repo content authoring (go-fish) + BoardSmith docs.
- Phase 112 (go-fish tutorial content + CI) mirrors Phase 109 (checkers tutorial content) from v4.1 — same pattern, different game type (card game vs grid game).
- Phase 113 (go-fish AI teaching) mirrors Phase 107 (checkers AI teaching) — surfaces existing MCTS bot; key difference is `anchorAttrs` must anchor to cards/hand, not board squares.
- Phase 114 (action help + host lockout) folds GFHELP-01 and GFLOCK-01 together as both are light verification/surface tasks that share a dependency on all teaching affordances existing (Phase 113 complete).
- Phase 115 (documentation) is last so both worked examples (checkers + go-fish) are complete and documentable.
- Substrate gap risk: if a real go-fish-driven gap is found in BoardSmith `src/`, flag it, handle it within the phase, and note the change — do not assume one exists.
- Heatmap is intentionally excluded from go-fish AI teaching (board-only feature); documented as such in DOC-03.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

**v4.1 roadmap decisions (2026-06-25):**

- Substrate-first sequencing: engine/session lifecycle+gating (104) → UI overlay (105) → triggers + CI-authoring (106) → teaching layers (107 AI, 108 HELP) → checkers showcase (109) → demo gate (110).
- TUT-01 annotation overlay must route through `useBoardInteraction` for custom-UI/AutoUI parity (hard-rule), verified in both UI paths.
- Action gating (TUT-02) reuses the engine's existing action validation and the v2.8 disabled-reason surface — no parallel validation path.
- AI teaching features reuse checkers' existing MCTS; no new training/weights.
- Checkers tutorial content (CHK-*) lands cross-repo in `~/BoardSmithGames/checkers`; substrate stays in this repo's `src/`.
- DEMO-01 framed as a refinement checkpoint, not a sign-off — captured friction feeds the substrate before cribbage (v2 CRIB).

**Phase 107 UI decisions (2026-06-26):**

- overlay-utils.ts dedup: cssEscape + buildSelector extracted from TutorialOverlay to shared module — zero copy-paste across overlay components.
- isDemoRunning tracked as local ref in GameShell — session getter not broadcast; cleared on flowState.complete.
- Teaching controls wired via platformRequest ops (hint/demo-start/demo-stop/heatmap-toggle) — bridge integration deferred to Phase 109.
- showHintProp computed from lobbyInfo AI slots — cleanest client-side AI detection; platform mode hidden (Phase 110 wires production).
- Parity proven at component level: dual-fixture tests (custom-UI-like div vs AutoUI-grid-like table cell, same data-bs-el-id) in both HintOverlay and HeatmapOverlay test suites.
- [Phase ?]: Phase 108 Plan 03 complete

**Phase 109 Plan 01 decisions (2026-06-28):**

- LR-02 gate: `TutorialGateAllowList.from`/`to` removed without deprecation; replaced with `selections?: Record<string, SelectionMatcher>` map keyed by selection name.
- `selectionMatchesValue` uses ElementRef id > notation > name precedence for element values; all-field equality for choice objects (DestinationChoice etc.).
- Non-object/null values never match a non-empty matcher (returns reason, no crash) — satisfies T-109-01 threat mitigation.

**Phase 110 Plan 03 decisions (2026-06-29):**

- aiSuggest previews MCTS move read-only; demo loop executes same args via action op (MCTS never re-runs for execution — avoids narrate/execute mismatch).
- demoAbort checked before AND after delay (RESEARCH Pitfall 1) — critical for timer-leak-free cancellation (CLAUDE.md hard rule).
- demoStart/demoStop in Op union but NOT in executeOp switch — host lifecycle ops; fallback error if they reach executeOp.
- Demo tests stub aiSuggest to avoid MCTS setImmediate conflicts with vi.useFakeTimers().
- [Phase ?]: Go-fish move hint wiring

### Highest-Risk Items

1. `anchorAttrs` card-anchoring parity (Phase 112/113) — go-fish has no board grid; `anchorAttrs` must anchor to card elements and hand panels instead of board squares. Verify the overlay renders correctly on card targets (not just cells).
2. Substrate gap discovery (any phase) — if a real go-fish-driven gap is found in `src/`, it must be handled within the phase; do not work around it. Flag and fix.
3. Cross-repo symlink dev loop (Phase 112) — go-fish node_modules symlinks to this repo; keep BoardSmith tests green while authoring go-fish content.
4. CI-verifiable go-fish tutorial test (Phase 112) — must fail on a deliberately broken rule, not pass vacuously; prove with a broken rule (same standard as Phase 106 / checkers).

### Pending Todos

Carried from v4.0 (non-blocking): dev-standalone shell height gap; pre-existing dev-host AI-turn issue; orphaned tokens / lint scope / focus-ring naming / platform-mode connection-announce seam. See `.planning/todos/pending/`.

**Carry-forward from Phase 104 code review (Medium/Low — address in the consuming phase, see 104-REVIEW.md):**

- **MR-01 → CLOSED in Phase 105:** `tutorialStep` threaded into `useActionController` via GameShell production wiring; behavioral suppress-auto-fill test guards it.
- **MR-02 → CLOSED in Phase 106:** predicate-form gates fleshed out.
- **LR-02 → CLOSED in Phase 109 Plan 01:** `selections` map on `TutorialGateAllowList` keyed by selection name.
- **MR-03 / LR-01 (minor):** `start()` on empty `steps` is a silent no-op (should fail loud); `skip()` records identically to `advance()` (no distinction). Address opportunistically.

**Phase 104 pre-existing tech debt surfaced (NOT introduced by 104, out of scope):** `tsc --noEmit` reports type-looseness errors in test files this repo does not gate on `tsc` (HandRenderer.a11y, GameHistory, DebugPanel, notation-serialization). Repo gates on vitest + eslint. Candidate for a future cleanup pass.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-06-30T15:48:26.419Z
Stopped at: v4.2 roadmap created — Phases 112–115 defined
Resume file: None
Next action: `/gsd:plan-phase 112`

## Operator Next Steps

- Begin Phase 112 with `/gsd:plan-phase 112`
