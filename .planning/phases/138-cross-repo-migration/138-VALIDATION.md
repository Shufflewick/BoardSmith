---
phase: 138
slug: cross-repo-migration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 138 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest per repo (`npx vitest run` — NEVER bare `npm test`, several games default to watch mode and hang) |
| **Quick run command** | `cd <game> && npx vitest run 2>&1 \| tail -3` |
| **BoardSmith suite** | `npm run test` (baseline 175 files / 2368 tests) |
| **MERC suite** | per its repo convention (738-test baseline to re-establish fresh after re-vendor) |
| **Browser smoke** | Headless Playwright scripts in scratchpad (chromium_headless_shell-1208 executablePath); kill dev server after each |

---

## Sampling Rate

- **After each game migration:** that game's `npx vitest run` green
- **After any BoardSmith source fix:** BoardSmith full suite green
- **After MERC re-vendor:** MERC suite vs 738 baseline
- **Phase gate:** all 8 game suites green + MERC green + BoardSmith green + 3 Playwright smokes passed + no process on :5173

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 138-01-T1 | 138-01 | 1 | GAMES-01 | — | 8× boardsmith.json cleaned (no playerCount/dead $schema); `boardsmith validate` passes per game | CLI | `cd <game> && npx boardsmith validate` | ✅ | ⬜ pending |
| 138-01-T2/T3 | 138-01 | 1 | GAMES-01 | — | checkers (1) + go-fish (12) doAction .success sites migrated; every suite green | unit | per-game `npx vitest run` | ✅ | ⬜ pending |
| 138-02-T1/T2 | 138-02 | 2 | GAMES-01 | — | Playwright smokes: hex (drag), go-fish (toast/restore), cribbage (multiSelect) | browser | scratchpad scripts | ❌ W0 scripts | ⬜ pending |
| 138-03-T1..T3 | 138-03 | 1 | GAMES-02 | — | MERC WIP commit → re-vendor → suite green (gaps fixed in BoardSmith src red-first) | suite | MERC test command | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Playwright smoke scripts (reuse verify-134 scratchpad patterns: executablePath, seat-taking, iframe controller access)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| demo-action-panel has no test suite | GAMES-01 | Pre-existing gap | Record in SUMMARY as known gap (suite requirement satisfied vacuously); do not fabricate a suite in a migration phase |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity maintained
- [x] No watch-mode flags (npx vitest run only)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
