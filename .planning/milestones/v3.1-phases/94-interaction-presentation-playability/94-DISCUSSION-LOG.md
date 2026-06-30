# Phase 94: Interaction, Presentation & Playability Gate - Discussion Log

> **Audit trail only.** Not consumed by downstream agents — decisions are in CONTEXT.md.

**Date:** 2026-06-21
**Phase:** 94-interaction-presentation-playability
**Areas discussed:** Multi-ref shape, Panel suppression, Overlay API, Mixed anchors

---

## Multi-ref protocol shape (INTERACT-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Generalize to refs array | Replace singular sourceRef/targetRef/ref with `refs: {ref, role}[]`; singular = 1-element case. | ✓ |
| Add boardRefs alongside singular | Keep singular, add plural boardRefs for multi case. | |

**User's choice:** Generalize to refs array
**Notes:** No Backward Compatibility; one way to express anchors. Multi-jump populates multiple refs.

---

## ActionPanel suppression (INTERACT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-absent + explicit escape | Panel auto-absent when all choices anchored; board UI can force-suppress via prop/slot. | ✓ |
| Explicit prop/slot only | Always mounts unless opted out. | |

**User's choice:** Auto-absent + explicit escape
**Notes:** GameShell stops mounting panel unconditionally (~1280-1295).

---

## Presentation overlay API (PRESENT-01/02/03)

| Option | Description | Selected |
|--------|-------------|----------|
| Prop-passed object map | Sibling-file object keyed by class/name/attribute → {image,label,stats,render}, passed as :presentation prop; resolved after visibility filtering. | ✓ |
| Global registry | registerPresentation(map), symmetric with renderer registry but global (weak per-UI fit). | |

**User's choice:** Prop-passed object map
**Notes:** Per-UI (P1); engine carries no value-bearing $-props; overlay resolved after visibility filter (leak-closed).

---

## Mixed-anchor presentation (INTERACT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid | Anchored choices on board; panel shows only the non-anchored remainder. | ✓ |
| All-or-nothing | All anchored → board only; any un-anchored → full panel. | |

**User's choice:** Hybrid
**Notes:** Panel never duplicates on-board affordances.

## Claude's Discretion

- Prop/slot names, ElementRef/refs field naming, overlay key precedence, per-game overlay contents.
- Playability-gate = human-driven browser verification (full game start-to-finish).

## Deferred Ideas

- Ship/reframe → Phase 95; cross-repo migration → Phase 96; general solver / responsive / engine model additions → later.
