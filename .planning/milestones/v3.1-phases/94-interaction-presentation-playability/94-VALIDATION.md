---
phase: 94
slug: interaction-presentation-playability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 94 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Cross-layer boundaries this phase touches: protocol → client → UI (multi-ref),
> engine visibility-filtering → presentation-overlay resolution (security), and
> three browser playability gates (human-verified).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --run <file>` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~60–120 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the targeted test file for the touched module (`npm test -- --run <file>`)
- **After every plan wave:** Run `npm test -- --run` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green AND the three browser playability gates passed
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

> Filled per task during planning/execution. Each cross-layer boundary below MUST
> have at least one automated integration test (Nyquist Dimension 8).

| Boundary / Behavior | Requirement | Test Type | Automated Command | Status |
|---------------------|-------------|-----------|-------------------|--------|
| `refs[]` round-trips through `protocol.ts` serialize/deserialize (multi-element) | INTERACT-03 | unit/integration | `npm test -- --run protocol` | ⬜ pending |
| `buildActionMetadata` emits `refs[]` with correct roles for a multi-jump | INTERACT-03 | unit | `npm test -- --run` | ⬜ pending |
| `useBoardInteraction` ref-matching highlights all `refs[]` entries | INTERACT-01/03 | unit/component | `npm test -- --run` | ⬜ pending |
| ActionPanel auto-absent when all active choices are anchored | INTERACT-02 | component | `npm test -- --run` | ⬜ pending |
| `:suppress-action-panel` prop / `#action-panel` slot suppresses the panel | INTERACT-02 | component | `npm test -- --run` | ⬜ pending |
| Mixed-anchor action → panel shows only non-anchored remainder | INTERACT-01 | component | `npm test -- --run` | ⬜ pending |
| Presentation overlay resolves AFTER `toJSONForPlayer` visibility filtering | PRESENT-02 | integration | `npm test -- --run` | ⬜ pending |
| Overlay data for a hidden element is absent from an unauthorized player's payload | PRESENT-02 | integration (security) | `npm test -- --run` | ⬜ pending |
| Overlay key resolution (instance > name > class) maps to `{image,label,stats,render}` | PRESENT-01/03 | unit | `npm test -- --run` | ⬜ pending |
| Engine carries NO value-bearing `$`-presentation props | PRESENT-01 | unit/source-assert | `npm test -- --run` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Existing vitest infrastructure covers protocol/engine/UI unit + component tests.
- [ ] Add a protocol round-trip test fixture for multi-element `refs[]` if none exists.
- [ ] Add an overlay-after-visibility security integration fixture if none exists.

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hex played start-to-finish using only auto-UI | Success Criterion 6 | Browser end-to-end playability; visual + interactive | `boardsmith dev` Hex → place stones → claim territory → win detection, no custom UI |
| Go Fish played start-to-finish using only auto-UI | Success Criterion 7 | Browser end-to-end playability; hidden-hand + multi-choice | `boardsmith dev` Go Fish → deal → ask → draw → collect sets → end game, no custom UI |
| Checkers played start-to-finish using only auto-UI | Success Criterion 8 | Browser end-to-end; multi-jump highlights all cells, king promotion | `boardsmith dev` Checkers → move → single capture → multi-jump → king promotion → win, no custom UI |

---

## Validation Sign-Off

- [ ] Every cross-layer boundary has at least one automated integration test
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] Three browser playability gates human-verified
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
