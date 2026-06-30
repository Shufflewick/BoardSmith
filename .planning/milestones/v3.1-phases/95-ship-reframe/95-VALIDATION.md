---
phase: 95
slug: ship-reframe
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 95 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) + bundle-grep assertion for tree-shaking |
| **Config file** | existing vitest config |
| **Quick run command** | `npm test -- src/cli` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~quick: seconds; full: ~minutes |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/cli`
- **After every plan wave:** Run `npm test`
- **Before verify-work:** Full suite green + tree-shaking bundle assertion green
- **Max feedback latency:** ~30s for scaffold-generator tests

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 95-xx | scaffold | 1 | SHIP-03 | generated App.vue has exactly one static UI import; no split-screen markup | unit | scaffold-generator test asserts emitted App.vue | ⬜ pending |
| 95-xx | scaffold | 1 | SHIP-02 | `boardsmith.json "ui"` field drives the single import in generated entry | unit | scaffold-generator test asserts `"ui"` → one import | ⬜ pending |
| 95-xx | treeshake | 2 | SHIP-02 | a fixture game with `"ui": "./ui/GameUI.vue"` produces a bundle with NO AutoUI/AutoRenderer symbols | integration | build fixture + grep dist for AutoRenderer → absent | ⬜ pending |
| 95-xx | reframe | 1 | SHIP-01 | no "debug aid"/"reference aid"/"comparison" framing of auto-UI in the 6 identified doc/CLI locations | source-assertion | grep the 6 files → offending strings absent | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing vitest infrastructure covers scaffold-generator unit tests. Tree-shaking assertion needs a small fixture-build + bundle-grep harness (new) — the planner must scope it as a task, not assume it exists.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `boardsmith dev` on a freshly scaffolded game opens single-UI (no split-screen) and is playable | SHIP-03 | end-to-end dev-host behavior in browser | scaffold a throwaway game, run `boardsmith dev`, confirm single UI renders and plays |

*Tree-shaking and reframe are automatable; only the dev-host browser open is manual.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Tree-shaking bundle assertion is a real automated check, not a code-review claim
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
