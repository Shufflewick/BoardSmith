# BoardSmith — Living Retrospective

## Milestone: v4.1 — Tutorial Primitives (Checkers)

**Shipped:** 2026-06-30
**Phases:** 8 (104–111) | **Plans:** 35

### What Was Built

A reusable, CI-verifiable tutorial substrate (lifecycle + action gating, annotation
overlay with custom-UI/AutoUI parity, predicate triggers, testing DSL), proven by a
complete checkers tutorial; MCTS-powered AI teaching (hint, narrated AI-vs-AI demo,
evaluation heatmap); per-action help with a global toggle; a live browser
demonstration/refinement gate (DEMO-01); and a host-gated teaching lockout (LOCK-01).

### What Worked

- **DEMO-01 as a real refinement gate.** Walking the features live in the browser
  surfaced 16 concrete defects (R-01..R-16) that the green test suite had missed —
  custom-UI anchor gaps (hint/heatmap invisible), a multi-jump hang, an inert
  action-help toggle, a dead action-dock destination button. Each got a proven root
  cause + regression test. Live demonstration caught what unit tests structurally could not.
- **Parity hard-rule paid off.** Routing overlays through `useBoardInteraction` and
  gating in the shared ControlsMenu meant LOCK-01's lockout and the teaching affordances
  worked in both UI paths with one implementation.
- **Server-authoritative anti-cheat.** Treating server op-rejection (not UI hiding) as
  the real LOCK-01 control, proven by cross-layer tests that bypass the UI, made the
  human "craft a console op" check redundant.

### What Was Inefficient

- Several refinements (R-04 especially) took multiple attempts because the first fix
  addressed a symptom, not the timing-race root cause — reinforced "Prove Before Fix."
- Custom games silently break ALL teaching overlays if they forget to spread
  `anchorAttrs` (R-09/R-10). Captured as a pit-of-success follow-up (lint/dev-warning).

### Patterns Established

- Dedicated session-level config (not gameOptions) for host policy flags.
- Cross-layer trace tests per boundary (config→broadcast→UI, CLI→running host).
- A game with zero `.help()` text now hides the inert global toggle (R-14b).

### Key Lessons

- A live human demo gate is worth its cost on UI-heavy substrate work.
- Additive, well-wired changes keep the dead-code audit clean; the audit's whole-repo
  baseline failures are pre-existing and mostly external-API false positives.

### Cost Observations

- Model mix: planning/verification on opus; executors + checkers on sonnet.
- Phase 111 (lockout) executed fully autonomously (discuss→plan→execute) with a single
  human gate; Wave 1+2 plans each ~5–7 min on the main tree (worktrees disabled).

## Cross-Milestone Trends

_(Seeded at v4.1 — populate as future milestones complete.)_
