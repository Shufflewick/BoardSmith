---
gsd_state_version: 1.0
milestone: v4.3
milestone_name: Agent-Ready Engine — Introspection, Test Ergonomics & Devtools
status: executing
stopped_at: roadmap complete
last_updated: "2026-07-01T00:18:18.581Z"
last_activity: 2026-07-01
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 15
  completed_plans: 12
  percent: 43
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-30)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** Phase 119 — dev-host-devtools-bridge

## Current Position

Phase: 119 (dev-host-devtools-bridge) — EXECUTING
Plan: 2 of 4
Status: Ready to execute
Last activity: 2026-07-01

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
- v4.2 Tutorial Primitives — Go Fish & Docs (Phases 112-115) -- shipped 2026-06-30

**In Progress:**

- v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools (Phases 116-122) — planning; roadmap created 2026-06-30.

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

- v4.3 roadmap defined (2026-06-30): 7 phases (116–122), 27 requirements (DSGN, INTRO, TEST, DEV, PIT, MIG, DOC). Three logical stages honored: (1) verify scout findings + lock API design [116]; (2) implement then migrate [117–121]; (3) docs [122].
- Phase 116 (DSGN) is a hard gate for everything: it decides what already exists vs. what must be built (scout claims like `getPlayerView()`, private checkpoint APIs, an existing action-resolved signal are UNVERIFIED) and which speculative items are IN vs. DEFERRED. No implementation begins until its design doc is approved.
- INTRO (117) is the keystone primitive — "what can this seat do right now, with what choices?" — and is sequenced BEFORE TEST (118) and DEV (119), which both build on it. Splitting them keeps each independently shippable/reviewable.
- PIT (120) authoring guards are largely independent of INTRO; depends only on 116 (PIT-04 lint targets the footguns DSGN-01 confirms).
- MIG (121) is its own phase after the surface is built and stabilized — spans cross-repo work: symlinked `~/BoardSmithGames/` games (live HMR) + the MERC vendored copy which must be re-vendored.
- DOC (122) is last so docs describe the shipped, migrated surface.
- Reuse-not-rebuild discipline carries from v4.2: where DSGN finds an API already exists, expose/document rather than duplicate.

**v4.2 roadmap notes (2026-06-30):**

- v4.2 roadmap defined (2026-06-30): 4 phases (112–115), 14 requirements. Reuse-not-rebuild: all substrate lives in v4.1 `src/`; phases are cross-repo content authoring (go-fish) + BoardSmith docs.
- Phase 112 (go-fish tutorial content + CI) mirrors Phase 109 (checkers tutorial content) from v4.1 — same pattern, different game type (card game vs grid game).
- Phase 113 (go-fish AI teaching) mirrors Phase 107 (checkers AI teaching) — surfaces existing MCTS bot; key difference is `anchorAttrs` must anchor to cards/hand, not board squares.
- Phase 114 (action help + host lockout) folds GFHELP-01 and GFLOCK-01 together as both are light verification/surface tasks that share a dependency on all teaching affordances existing (Phase 113 complete).
- Phase 115 (documentation) is last so both worked examples (checkers + go-fish) are complete and documentable.
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
- [Phase ?]: DEV-01: align AutoUI to emit data-bs-el-id (anchorAttrs single source of truth); keep data-element-id as FLIP alias
- [Phase ?]: PIT-01: loop() missing maxIterations is a construction-time throw; devWarn path removed
- [Phase ?]: INTRO-F1 promoted to IN-scope (trivial expose-not-build); flagged for user sign-off at approval gate
- [Phase ?]: ElementDiff reached through game-session.js barrel re-export; ActionMetadata added to types.js block; UndoResult not duplicated

### Highest-Risk Items (v4.3)

1. **DSGN accuracy (Phase 116)** — several scout claims about what "already exists" are unverified; getting verdicts wrong means either rebuilding existing APIs or planning to build something that's missing. Verdicts must carry file:line evidence.
2. **INTRO serialization + perspective correctness (Phase 117)** — the action-space structure must be serializable end-to-end and the perspective-aware view must exclude hidden info correctly (INTRO-05); a leak here is a security regression.
3. **Cross-repo migration breadth (Phase 121)** — all `~/BoardSmithGames/` games (symlinked, live HMR) plus the MERC vendored canary (must re-vendor) — keep every suite green; gaps surfaced during migration must be fixed in `src/`, not worked around.
4. **Dev-host parity (Phase 119)** — `data-element-id` and the devtools global must work identically in custom UI and AutoUI (hard rule); browser-prove both before completion.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-07-01T00:18:18.571Z
Stopped at: roadmap complete
Resume file: None
Next action: `/gsd:plan-phase 116`

## Operator Next Steps

- Begin Phase 116 (Verification & API Design) with `/gsd:plan-phase 116`. This phase gates all later phases — no implementation until its API-design doc is approved.
