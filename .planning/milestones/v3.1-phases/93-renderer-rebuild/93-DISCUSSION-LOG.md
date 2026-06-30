# Phase 93: Renderer Rebuild - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 93-renderer-rebuild
**Areas discussed:** Old renderer disposition, Archetype selection, Registry API, 93↔94 split

---

## Old renderer disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Delete in Phase 93 | New renderer wired in immediately; old files deleted in 93. Single source of truth. | ✓ |
| Keep dormant until Phase 96 | Build alongside; delete old files during final cleanup. | |

**User's choice:** Delete in Phase 93
**Notes:** No Backward Compatibility hard rule; Phase 96's "delete old renderer" → scaffold removal + straggler check.

---

## Archetype selection + honest boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Topology-ranked + honest fail | Grid/Hex→grid-board; card/hand→card; else→tableau; un-addressable→loud panel. | ✓ |
| Explicit $layout/$zone first | Honor explicit root declaration, fall back to topology heuristic. | |
| You decide | Default to topology-ranked. | |

**User's choice:** Topology-ranked + honest fail
**Notes:** Archetypes encode visual hierarchy, not equal-space subdivision (§0 C6).

---

## Ranked-tester registry API

| Option | Description | Selected |
|--------|-------------|----------|
| Module-level singleton | `registerRenderer({ test, component })` from `boardsmith/ui`; -1 = N/A, highest wins. | ✓ |
| Provided via GameShell | Per-app registry via provide/inject, scoped to one GameShell. | |

**User's choice:** Module-level singleton
**Notes:** Mirrors JSONForms rankWith; for extending auto-UI in place, not the custom-UI path.

---

## Phase 93 ↔ 94 boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Pure render + animation | 93 = render + useAnimationEvents only; existing footer panel drives play; substrate tests green = proof. All interaction rewiring → 94. | ✓ |
| Render + board-anchored selection | 93 also moves basic on-board click selection now. | |

**User's choice:** Pure render + animation
**Notes:** Cleanest provable boundary; animation is the only substrate touchpoint in 93 (§0 C1).

## Claude's Discretion

- Component decomposition, file/dir layout, built-in priority bands, archetype CSS.

## Deferred Ideas

- Board-centric interaction / multi-ref / suppressible panel / presentation overlay → Phase 94.
- General solver (S2), responsive primitives, phase/scoring renderers, N-UI switcher, auto-eject → later.
