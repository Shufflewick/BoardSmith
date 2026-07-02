---
phase: 125
slug: headless-simulation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 125 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~95 seconds (full suite, ~1947 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test files>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | SIM-01..02 | determinism | Same seed twice → identical simulate results; harness has no vitest imports post-move | unit + CLI smoke | `npm test` + `npx boardsmith simulate` against a real game repo | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — no new deps (esbuild/commander/chalk/ora already used by sibling CLI commands). CLI smoke test runs against `~/BoardSmithGames/go-fish` via the symlink.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `boardsmith simulate` end-to-end in a real game repo | SIM-02 | CLI loads game rules via esbuild in a real project layout | `cd ~/BoardSmithGames/go-fish && npx boardsmith simulate --games 3 --seed test` twice; identical output + exit 0; no server left running |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
