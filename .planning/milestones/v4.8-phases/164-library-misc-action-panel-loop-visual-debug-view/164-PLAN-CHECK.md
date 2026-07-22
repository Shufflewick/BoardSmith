# Phase 164 Plan Check — Verdict: PASS

**Phase:** 164 — Library Misc — Action-Panel, Loop, Visual, Debug-View
**Plans checked:** 164-01, 164-02, 164-03, 164-04
**Checked:** 2026-07-21

## Summary

All 4 plans will achieve the phase goal. Every success criterion and requirement ID has
concrete, wired, testable coverage; the three orchestrator resolutions are honored verbatim;
the wave/dependency structure correctly serializes the two plans that both touch
`GameShell.vue`; no scope reduction, no context contradictions, no dependency hazards.
2 non-blocking warnings noted below.

## Coverage Matrix

| Success Criterion (ROADMAP) | Requirement | Plan | Task(s) | Status |
|---|---|---|---|---|
| 1. Per-action dock suppression + fenced escape hatch (D28+C.3) | LIBX-01 | 164-03 | 1,2,3 | COVERED |
| 2. `loop()` unbounded valve + observable maxIterations exit (D29) | LIBX-02 | 164-01 | 1,2,3 | COVERED |
| 3. PlayerToken glyph ink not hardcoded white (D30) | LIBX-03 | 164-02 | 1,2 | COVERED |
| 4. Time-travel debug view no longer commits clicks live (D31) | LIBX-04 | 164-04 | 1,2 | COVERED |
| 5. Fail-on-pre-fix / pass-after test per fix (PROC-01) | PROC-01 | all 4 | RED task in each plan | COVERED |

Requirement IDs LIBX-01, LIBX-02, LIBX-03, LIBX-04, PROC-01 all appear in plan frontmatter
`requirements:` fields (164-03, 164-01, 164-02, 164-04, all four respectively) — matches
REQUIREMENTS.md's `LIBX-01..04 | D28..D31 | 164` and `PROC-01 | all fix phases` mapping. No
gap.

## Orchestrator Resolutions — Verified Honored

1. **New `suppressFromDock` field + rename to `platformActionPanelEscapeHatch`, all-suppressed→turn-prompt fallback** — 164-03 Task 1 adds `suppressFromDock` mirroring `.manual()` exactly (type→builder→metadata→session type, 4 files); Task 3 renames the prop at all cited line anchors (140/177/2425/2436), adds `allDockActionsSuppressed` computed, and wires both the escape-hatch AND all-suppressed paths to the same turn-prompt fallback. Verified via `grep -c "suppressActionPanel" == 0` and `grep -c "platformActionPanelEscapeHatch" >= 3` acceptance criteria — fully delivered, not reduced.
2. **Pure hex/rgb WCAG luminance helper, NO Canvas** — 164-02 Task 1 explicitly builds a DOM-free parser (`#rgb`/`#rrggbb`/`rgb()`/`rgba()`) and the acceptance criteria include `grep -c "getContext|createElement|canvas" == 0` as a hard gate. Matches CLAUDE.md's "don't add dependencies without discussing" (no canvas polyfill needed).
3. **`displayedState` at all THREE `:state` sites (2152/2322/2342) + `isViewingHistory` guard on all FOUR bridge mutators + exit-restores-live** — 164-04 Task 1 explicitly targets all three sites (not just the two CONTEXT literally named) with an acceptance criterion `grep -c ':state="state"' == 1` (only DebugPanel remains live) and `grep -c ':state="displayedState"' == 3`; Task 2 guards all four bridge functions (startAction/executeAction/setSelectionValue/toggleMultiSelectValue) with an independent `isViewingHistory.value` check (not derived from `isMyTurn`, per RESEARCH's explicit anti-pattern warning) and includes an exit-restores-live regression assertion.

No scope-reduction language ("v1", "static for now", "future enhancement", "not wired to", etc.) found anywhere in the four plans — grep scan returned only legitimate uses of the word "hardcoded" describing the pre-fix bug being removed, not a reduced fix.

## Dependency / Wave Safety

- 164-01, 164-02, 164-03: `depends_on: []`, wave 1 — mutually file-disjoint (flow engine, PlayerToken/color-contrast util, action-metadata+ActionPanel+GameShell prop-rename+bridge doc-comment respectively). Safe to parallelize.
- 164-04: `depends_on: [164-03]`, wave 2 — both 03 and 04 touch `GameShell.vue` and `useBoardActionBridge.ts`. Correctly serialized: 03 touches GameShell lines ~140/177/2425/2436/2439-2447 (untouched by 04) and the bridge's line-15 doc comment only; 04 touches GameShell ~473 (new computed) + 2152/2322/2342/790-797 and the bridge's functional guards at 173/189/204/226/33. Line ranges don't overlap, but the dependency edge is still correct because 04's task 3 read_first explicitly notes "GameShell already history-guards ActionPanel props at :2439-2447 — do not disturb; LIBX-04 (plan 04) owns history," confirming the planner reasoned about the shared-file hazard rather than accidentally avoiding it. No race.

## Task Completeness

All 10 tasks across the 4 plans have concrete `<files>`/`<action>`/`<automated><verify></automated>`/`<done>` — every `<action>` cites exact file:line anchors from RESEARCH.md, every `<verify>` is a runnable `npx vitest run <file>` (or grep) command, every `<acceptance_criteria>` is objectively checkable (grep counts, specific behaviors), not subjective language. `tdd="true"` RED→GREEN task pairing is used consistently for PROC-01.

## Scope

| Plan | Tasks | Files | Assessment |
|---|---|---|---|
| 164-01 | 3 | 7 | within budget |
| 164-02 | 2 | 4 | within budget |
| 164-03 | 3 | 10 | at warning threshold (target 5-8, warning 10) |
| 164-04 | 2 | 3 | within budget |

## Nyquist / Validation Architecture

164-VALIDATION.md exists, `nyquist_compliant: true`, `wave_0_complete: true`. Every task's
`<automated>` is a concrete, fast (`vitest run <specific file>`) command — no full E2E suite,
no `--watchAll`/watch-mode flags, no unbounded feedback latency. No task relies on an
undelivered Wave-0 test file (`MISSING` markers); RED tests are created and confirmed failing
within the same task before the GREEN task implements the fix, satisfying automated-verify
presence without a separate Wave 0 plan.

## Architectural Tier Compliance

RESEARCH.md's Architectural Responsibility Map assigns: LIBX-01 to Engine (metadata channel)
+ Client (render filter) — 164-03 touches exactly `src/engine/action/*`, `src/engine/element/*`,
`src/session/types.ts` (engine/session tier) and `src/ui/components/auto-ui/ActionPanel.vue` +
`GameShell.vue` (client tier), matching. LIBX-02 to Engine only — 164-01 touches only
`src/engine/flow/*`, matching. LIBX-03 to Client (pure util + component) — 164-02 touches only
`src/ui/*`, matching. LIBX-04 to Client (GameShell + bridge) — 164-04 touches only
`src/ui/components/GameShell.vue` + `src/ui/composables/useBoardActionBridge.ts`, matching. No
tier mismatches.

## Context Compliance

All four locked decisions (LIBX-01..04) are honored in full per the Orchestrator Resolutions
section above. Deferred ideas (SKILLDEF-03 skills-enforcement, visible time-travel hint) are
absent from all four plans — correctly excluded as out of scope. Claude's Discretion (exact
identifier names) was resolved by the orchestrator to `platformActionPanelEscapeHatch` and
`suppressFromDock`, consistently used across 164-03's plan body.

## CLAUDE.md Compliance

No new dependencies added (canvas explicitly avoided per orchestrator resolution 2, matching
"Don't add dependencies without discussing"). No plan leaves a dev server or background
process running. Error-message requirements ("actionable, no internal paths") are explicitly
built into 164-02's `contrastInk` unsupported-format throw and 164-01's improved loop-safety
message.

## Warnings (non-blocking)

1. **[scope_sanity] 164-03 is at the warning threshold (3 tasks / 10 files modified).** Task 1
   touches 4 engine/session files for one metadata-channel mirror, Task 2 touches ActionPanel
   (2 files), Task 3 touches GameShell + bridge doc-comment (2 files) plus their two test
   files — the file count is inflated mostly by new test files (4 of the 10), and the
   underlying code change per task is narrow and well-precedented (mirrors `.manual()`
   exactly). Recommend no action; if quality issues surface during execution, Task 3 could be
   split from Tasks 1-2, but the precedent-following nature of this work makes a split
   unnecessary now.
2. **[research_resolution] RESEARCH.md's `## Open Questions` section (line 739) is not suffixed `(RESOLVED)` and individual questions lack inline `RESOLVED` markers**, per the formal Dimension 11 check. Substantively, however, all three open questions ARE resolved: Q1 (rename identifier) is locked to `platformActionPanelEscapeHatch` in 164-03's `<interfaces>` block ("Orchestrator resolution 1"); Q2 (canvas-vs-pure-parser) is locked to the pure-parser path in 164-02's `<interfaces>` block ("Orchestrator resolution 2"); Q3 (sidebar-extra scope) is locked to "fix it" in 164-04's `<interfaces>` block ("Orchestrator resolution 3"). This is a documentation-hygiene gap in RESEARCH.md only — the plans that will actually execute carry the resolved decisions unambiguously. Recommend annotating RESEARCH.md's Open Questions section with `(RESOLVED)` for future-phase consistency, but this does not block execution of 164-01..04.

## Recommendation

PASS. Proceed to `/gsd:execute-phase 164`.
