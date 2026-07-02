---
phase: 129
slug: migration-games-merc
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-02
---

# Phase 129 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest per repo (each game's own suite; MERC's own suite) |
| **Config file** | per-repo |
| **Quick run command** | `cd <repo> && npm test` |
| **Full suite command** | BoardSmith `npm test` + all 8 game suites + MERC suite |
| **Estimated runtime** | ~10 min total across repos |

---

## Sampling Rate

- **After each repo's migration:** that repo's suite + tsc
- **After any BoardSmith src/ fix:** BoardSmith full `npm test`
- **Before phase close:** all repos green + grep sweep zero hits
- **Max feedback latency:** 300 seconds (cross-repo)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | MIG-03/04 | hidden-info (DOM-leak test is a security test) | go-fish DOM-leak test fails on injected leak (positive control) | per-repo suites + grep sweep | see per-repo commands | mixed | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Baseline (pre-migration, from RESEARCH): checkers 38 ✅, cribbage 20 ✅, go-fish 78 ✅, hex 19 ✅, polyhedral-potions 24 ✅, demo-animation 8 ✅, demo-complex-ui 4 ✅, demo-action-panel (no suite), MERC 738/7 ✅ (v4.3 vendored). tsc red in 5/8 games (pre-existing debt, in scope).

---

## Wave 0 Requirements

- go-fish: add `jsdom` + `@vue/test-utils` devDeps (approved in CONTEXT amendment), versions matching BoardSmith's package.json
- No other new deps anywhere

---

## Manual-Only Verifications

None — no visual behavior changed; per-repo suites + grep sweep are the gates.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency documented
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
