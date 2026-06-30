---
phase: 110-demonstration-refinement
plan: "05"
subsystem: ui (cross-repo demo + refinement)
tags: [demo, refinement, human-gate, checkers, teaching, ui-parity]
dependency_graph:
  requires: [110-01, 110-02, 110-03, 110-04, 107, 108, 109]
  provides: [DEMO-01 closed, refinement log for v2 CRIB]
  affects: [111-host-gated-teaching-lockout, future-crib-milestone]
tech_stack:
  added: []
  patterns: [live-browser-refinement-gate, prove-before-fix, cross-repo-commit]
key_files:
  created:
    - .planning/phases/110-demonstration-refinement/110-DEMO-SCRIPT.md
    - .planning/phases/110-demonstration-refinement/110-REFINEMENTS.md
    - src/session/move-summary.ts
  modified:
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/GameShell.vue
    - src/ui/components/ControlsMenu.vue
    - ~/BoardSmithGames/checkers/src/rules/actions.ts
    - ~/BoardSmithGames/checkers/src/ui/components/CheckersBoard.vue
decisions:
  - "DEMO-01 is a refinement checkpoint, not a sign-off — captured friction (R-09..R-16) fed straight back into the substrate before cribbage."
  - "Custom UIs must spread anchorAttrs or ALL teaching overlays silently break (R-09/R-10) — surfaced a pit-of-success gap (lint/dev-warning candidate)."
  - "Action-dock destination buttons must resolve the choice directly (executeChoice), never round-trip through an ambiguous source-notation board select (R-16)."
  - "A global toggle with nothing to reveal reads as broken — hide 'Show action help' when no available action has help (R-14b)."
metrics:
  duration: "live multi-session"
  completed_date: "2026-06-29"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 14
---

# Phase 110 Plan 05: DEMO-01 Live Demonstration & Refinement Summary

**One-liner:** Walked the full checkers teaching suite (tutorial, hint, AI-vs-AI demo, heatmap, action help) end-to-end in the browser across custom UI and AutoUI; the live run surfaced and drove fixes for 16 refinements (R-01..R-16), and the user approved all beats — closing the DEMO-01 human gate.

## Accomplishments

- Produced `110-DEMO-SCRIPT.md` (6-beat checklist) and a clean dev-host launch.
- Ran all six beats live; the user confirmed each:
  - Beat 1 — Checkers tutorial (guided move, mandatory-capture tip, forced multi-jump, completion).
  - Beat 2 — AI move hint (destination highlight + "Thinking…" feedback).
  - Beat 3 — AI-vs-AI narrated demo (readable narration + speed/pause/step/back control bar).
  - Beat 4 — Evaluation heatmap (per-cell shading, best badge, per-turn recompute).
  - Beat 5 — Action help (hover/tap "?" + global toggle, persisted).
  - Beat 6 — Parity: all of the above re-verified in AutoUI.
- Captured 16 refinements in `110-REFINEMENTS.md` (R-01..R-16), each with a proven root cause.

## Refinements fixed during the gate (all committed, tested green)

- **R-01/R-02:** tutorial preset setup hook + exit-tutorial op/control.
- **R-03:** readable, correctly-stacked capture-notice (BoardMessage primitive).
- **R-04/R-06/R-06b/R-07/R-08:** action-controller/dock substrate — multi-jump continuation, stale-choice race, board-anchored empty-state, first-move hang, multi-jump auto-end.
- **R-09/R-10:** custom-board `anchorAttrs` so hint ring + heatmap chips resolve.
- **R-11:** per-turn heatmap recompute/clear.
- **R-13:** optimistic heatmap toggle.
- **R-14:** checkers `.help()` text; **R-14b:** hide inert action-help toggle.
- **R-15:** hint "Thinking…" toast.
- **R-16:** action-dock destination buttons resolve the choice directly (custom UI + AutoUI parity).

## Carried forward (backlog for v2 CRIB / future refinement)

- **R-05:** suppress Undo during guided tutorial steps (needs a new session hook).
- **R-12:** strategy tutorial track (mechanics-only today, by design).
- **Pit-of-success:** lint/dev-warning when a custom board omits `anchorAttrs` (silently breaks all teaching overlays).

## Outcome

User approved all beats → **DEMO-01 gate CLOSED**. Phase 110 complete. The substrate is validated end-to-end and refined; ready for Phase 111 (host-gated teaching lockout) and a future cribbage milestone.
