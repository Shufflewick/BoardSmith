---
phase: 113
slug: go-fish-ai-teaching
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-30
---

# Phase 113 — Validation Strategy

> Per-phase validation contract. Cross-repo: changes land in `~/BoardSmithGames/go-fish` (symlinked boardsmith — no re-vendor); no BoardSmith `src/` changes expected.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (go-fish) + vitest (BoardSmith, regression only) |
| **Config file** | go-fish `vitest.config.ts` (auto-picks `tests/**/*.test.ts`) |
| **Quick run command** | `npm test -- hint` (go-fish) |
| **Full suite command** | go-fish `npm test`; BoardSmith `npm test` |
| **Estimated runtime** | go-fish ~10–20s; BoardSmith ~60–90s |

---

## Sampling Rate

- **After every task commit:** go-fish `npm test -- hint` (or `-- demo`).
- **After the wave:** go-fish full suite green; BoardSmith full suite stays green (no src changes expected).
- **Before `/gsd:verify-work`:** both suites green; browser checkpoint (hint ring on rank cards + narrated demo) confirmed.
- **Max feedback latency:** ~90s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 113-01-* | 01 | 1 | GFAI-01 | `hintTargetFromMove({...rank:'7'})` → `{name:'7'}`; missing rank → undefined; ask on non-acting seat throws | unit | `npm test -- hint` (go-fish) | ❌ W0 | ⬜ pending |
| 113-01-* | 01 | 1 | GFAI-01 | `card-group` emits `data-bs-el-name="<rank>"`; hint annotation resolves to it (not a board cell) | unit/integration | `npm test -- hint` (go-fish) | ❌ W0 | ⬜ pending |
| 113-02-* | 02 | 1/2 | GFAI-02 | AI-vs-AI demo narrates each ask before execution; `demoStop` halts with no orphaned state | integration | `npm test -- demo` (go-fish) | ❌ W0 | ⬜ pending |
| 113-03-* | 03 | last | GFAI-01, GFAI-02 | Browser: hint ring on the learner's rank cards; narrated demo announces each move; dev server killed | manual | see Manual-Only | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] go-fish: create `tests/hint-target.test.ts` (mirror `checkers/tests/hint-target.test.ts`).
- [ ] go-fish: a demo/narration integration test (AI-vs-AI loop announces + executes; stop is clean).

*Existing vitest infra covers framework needs — no installs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hint ring anchors to the learner's rank cards | GFAI-01 | DOM rect resolution + visual anchor parity | `cd ~/BoardSmithGames/go-fish && npx boardsmith dev`; drive the learner seat (Follow active seat), click "Get a hint", confirm the ring lands on the suggested rank's cards in hand (not a board cell, not floating). Kill server after. |
| Narrated AI-vs-AI demo | GFAI-02 | Timed narration + visual narration card | In the same dev host, "Watch AI demo"; confirm each ask is announced in the narration card before it executes; "Stop demo" mid-game leaves a clean board. Kill server after. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
