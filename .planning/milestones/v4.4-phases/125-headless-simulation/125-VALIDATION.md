---
phase: 125
slug: headless-simulation
status: draft
nyquist_compliant: true
wave_0_complete: true
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
| 125-01-T1 | 01 | 1 | SIM-01 | T-125-01 | No stale internal path re-exposes the harness (grep headless-harness == 0); clean break, no shim | regression | `grep -rl headless-harness src/` empty + `npx vitest run src/runtime/runner.test.ts src/session/testing/{eachplayer-clone,parity-contract,undo-authoritative}.test.ts` | ✅ | ⬜ pending |
| 125-01-T2 | 01 | 1 | SIM-01 | T-125-02 | structuredClone op/broadcast boundary preserved; seeded run deterministic; no testing/ harness import | unit | `npx vitest run src/session/headless-session.test.ts` | ✅ new | ⬜ pending |
| 125-02-T1 | 02 | 1 | SIM-02 | T-125-03 | Single shared rules loader (loadGameDefinition, rules-only); dynamic-import trust model documented | type-check | `npx tsc --noEmit` clean for game-runtime.ts/dev.ts + live `boardsmith dev` smoke on :5198 (HTTP 200 + Ready log, then killed) | ✅ new | ⬜ pending |
| 125-02-T2 | 02 | 1 | SIM-02 | T-125-04 | gameClass (not definition) passed; process.exitCode=1 on failure; --json stable shape | type-check + wiring | `npx tsc --noEmit` clean + `grep simulateCommand src/cli/cli.ts` | ✅ new | ⬜ pending |
| 125-02-T3 | 02 | 1 | SIM-02 | T-125-04, T-125-05 | Same seed twice → byte-identical --json; exit 0 all-complete; no server left running | unit + real-game smoke | `npx vitest run src/cli/commands/simulate.test.ts` + two `boardsmith simulate --games 3 --seed smoke --json` in ~/BoardSmithGames/go-fish diff-clean, exit 0 | ✅ new | ⬜ pending |

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
