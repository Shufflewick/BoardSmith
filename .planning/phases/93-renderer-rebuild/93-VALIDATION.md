---
phase: 93
slug: renderer-rebuild
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 93 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest config in repo root / src/ui |
| **Quick run command** | `npm test -- src/ui/components/auto-ui` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~quick: seconds · full: minutes |

---

## Sampling Rate

- **After every task commit:** Run the quick command scoped to the touched module
- **After every plan wave:** Run the full suite
- **Before `/gsd:verify-work`:** Full suite must be green (especially the substrate tests)
- **Max feedback latency:** quick run < 30s

---

## Per-Task Verification Map

> Populated by the planner against each PLAN.md task. Key invariants to validate:

| Invariant | Requirement | Test Type | Automated Command (approx) |
|-----------|-------------|-----------|----------------------------|
| Registry dispatch: highest-priority registered renderer wins; `-1` = N/A | RENDER-02 | unit | `npm test -- renderer-registry` |
| Consumer-registered renderer overrides built-in without touching core | RENDER-02 | unit | `npm test -- renderer-registry` |
| Archetype selector picks grid-board/card/tableau by introspection | RENDER-03 | unit | `npm test -- archetype` |
| Un-addressable topology renders loud honest-fail panel (no degraded guess) | RENDER-04 | unit/browser | `npm test -- archetype` + browser |
| Grid/hex cell positions via useGameGrid/useHexGrid closed-form math | RENDER-04 | unit | `npm test -- (grid/hex layout)` |
| Substrate tests (useActionController, useBoardInteraction, drag-drop, FLIP, flying) remain GREEN | RENDER-01 | regression | `npm test -- (substrate test files)` |
| Animation events (deal/flip/reveal) fire during a session | RENDER-05 | integration/browser | `npm test` + browser smoke |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing vitest infrastructure covers unit/integration needs. No new framework install required.
- The substrate test files (the proof that interaction is unchanged) already exist — they must NOT be modified; running them unchanged is the validation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deal/flip/reveal choreography plays visibly in a live auto-UI session | RENDER-05 | Animation timing/visual is observed, not asserted | Run a gate game (e.g. Go Fish) in `boardsmith dev`, observe deal/flip/reveal animations play |
| Archetype hierarchy reads as focal-board / docked-hand / peripheral-chrome (not equal-space subdivision) | RENDER-03 | Visual hierarchy judgment | Run a grid game and a card game in the browser; confirm hierarchy |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or documented manual verification
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Substrate test files identified and confirmed unmodified
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s for quick run
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
