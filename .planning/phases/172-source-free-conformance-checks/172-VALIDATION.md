---
phase: 172
slug: source-free-conformance-checks
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-28
---

# Phase 172 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `172-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`vitest.config.ts` at repo root; `"test": "vitest run"`) |
| **Config file** | `vitest.config.ts` — `include: ['src/**/*.test.ts', ...]` |
| **Quick run command** | `npx vitest run src/cli/commands/build-manifest.test.ts src/cli/commands/trace-check.test.ts src/cli/commands/drift-check.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~5s · full suite ~3–4 min |

Baseline: 3407/3407 green as of `171-07-SUMMARY.md`. No `src/` touched since, so that is the
expected pre-172 baseline. Any red at phase start is pre-existing and must be reported, not absorbed.

---

## Sampling Rate

- **After every task commit:** the quick run command above (add
  `src/cli/commands/chunk-provenance.test.ts` for plan 172-01 task 3, and
  `src/cli/cli-conformance-commands.test.ts` for plan 172-04)
- **After every plan wave:** `npm test`
- **Before `/gsd:verify-work`:** Full suite green **AND** the real-data proof artifact `172-PROOF.md`
  exists demonstrating non-no-op output against copies of both reference games.
- **Max feedback latency:** ~5 seconds (quick), ~4 minutes (full)

---

## Per-Task Verification Map

> Populated by the planner. Every task lands in this table with a real automated command, except
> the proof tasks, which are real-invocation integration proofs rather than unit tests.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| T1 — line-anchored locator, FINDING_KINDS, manifest/claim/hash parsers | 172-01 | 1 | CHECK-03, CHECK-05 | unit | `npx vitest run src/cli/commands/build-manifest.test.ts` | ❌ created by this task | ⬜ pending |
| T2 — RULINGS.md parser, narrow direction-aware supersession | 172-01 | 1 | CHECK-03 | unit | `npx vitest run src/cli/commands/build-manifest.test.ts -t "ruling"` | ❌ created by T1 | ⬜ pending |
| T3 — fix `parseVerifiedAgainst` f73153a3 recurrence | 172-01 | 1 | CHECK-03 (parser hygiene) | unit (regression) | `npx vitest run src/cli/commands/chunk-provenance.test.ts` | ✅ exists | ⬜ pending |
| T4 — citation scanner + three-rung resolution ladder | 172-02 | 2 | CHECK-03 | unit | `npx vitest run src/cli/commands/trace-check.test.ts -t "resolve"` | ❌ created by this task | ⬜ pending |
| T5 — `traceCheckCommand` sweep, findings, read-only invariant | 172-02 | 2 | CHECK-03 | unit + read-only byte-hash | `npx vitest run src/cli/commands/trace-check.test.ts` | ❌ created by T4 | ⬜ pending |
| T6 — `--json` contract + grouped count-first human report | 172-02 | 2 | CHECK-03 | unit (stdout spy) | `npx vitest run src/cli/commands/trace-check.test.ts -t "report"` | ❌ created by T4 | ⬜ pending |
| T7 — git plumbing, `cwd` discipline, hash validation | 172-03 | 2 | CHECK-05 | unit against a REAL temp git repo | `npx vitest run src/cli/commands/drift-check.test.ts -t "git"` | ❌ created by this task | ⬜ pending |
| T8 — `driftCheckCommand` three states, findings, read-only invariant | 172-03 | 2 | CHECK-05 | unit + read-only byte-hash | `npx vitest run src/cli/commands/drift-check.test.ts` | ❌ created by T7 | ⬜ pending |
| T9 — register `trace-check` / `drift-check` in `cli.ts` | 172-04 | 3 | CHECK-03, CHECK-05 | smoke (CLI surface) | `node bin/boardsmith.js trace-check --help && node bin/boardsmith.js drift-check --help` | ✅ `cli.ts` exists | ⬜ pending |
| T10 — exit-code contract through the real entry point | 172-04 | 3 | CHECK-03, CHECK-05 | integration (spawned process) | `npx vitest run src/cli/cli-conformance-commands.test.ts` | ❌ created by this task | ⬜ pending |
| T11 — read-only preflight, copies, real runs | 172-05 | 4 | CHECK-03, CHECK-05, SC-3 | integration proof | preflight gate: `git -C ~/BoardSmithGames/seven rev-parse HEAD` pinned + porcelain empty; `one-two-punch` HEAD pinned | ✅ both repos exist | ⬜ pending |
| T12 — independent cross-check + `172-PROOF.md` | 172-05 | 4 | CHECK-03, CHECK-05, SC-3 | integration proof | `npm test` (plus per-count independent `grep`/`git diff` cross-checks recorded in the proof) | ❌ proof created by this task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement → Observable Signal

The signals that actually prove each success criterion — what the phase gate samples.

| Req | Observable signal | Sufficient sample |
|-----|-------------------|-------------------|
| CHECK-03 | Claim extraction is scoped to `## Interpretation` and survives `### Corrections…` continuation subsections; non-contiguous numbering (4/17 `seven` chunks start at 7/11/20/28) does not become phantom `claim-untested` findings | unit fixtures reproducing both real shapes (T1) |
| CHECK-03 | The three-rung resolution ladder (manifest owners → claim-number validity → authoring chunk) narrows a real multi-owner citation to one chunk, and reports `ambiguous-claim-ref` only when >1 survives all three | unit, with a fixture where each rung is the deciding one (T4) |
| CHECK-03 | `test-unlinked` fires for a chunk-associated test importing `src/rules/` that cites nothing, and does NOT fire for a11y/soak/theme/asset-reachability files | unit, one positive + one of each negative shape (T5) |
| CHECK-03 | Ruling coverage parses `### Ruling N`, handles both supersession directions, and does not read "reconciles"/"extends"/"UPHOLDS"/"resolves OQ-N" as supersession | unit, all five verb shapes from real data (T2) |
| CHECK-05 | Verified-commit-hash extraction handles all 5 real formats (bare/backtick × short/full, plus the prose-prefixed case where the hash is not on the first line) | unit, all 5 shapes (T1) |
| CHECK-05 | `git diff --name-only <hash> HEAD` executes with explicit `cwd` = the GAME repo, never BoardSmith's | unit against a real temp git repo, not a fixture dir (T7) |
| CHECK-05 | A manifest file absent from disk reports as drift | unit (T8) + confirmed live on `jab`'s `GuardCardView.vue` (T12) |
| CHECK-05 | A chunk with no recorded hash reports `drift-unknown`, never collapsed into drifted or clean | unit (T8) |
| Both | Findings exit 0; only tool failure (not a bs- project, not a git repo, missing INDEX) exits non-zero | spawned-process exit-code test (T10) |
| SC-3 | Real, non-no-op findings against copies of both reference games, cross-checked against independently computed counts | `172-PROOF.md` (T11, T12) |

---

## Wave 0 Requirements

- [ ] `src/cli/commands/build-manifest.ts` + colocated test — shared "one parser, one authority"
      module; created by plan 172-01 (wave 1), which is this phase's Wave 0
- [ ] `src/cli/commands/trace-check.ts` + colocated `trace-check.test.ts` — plan 172-02
- [ ] `src/cli/commands/drift-check.ts` + colocated `drift-check.test.ts` — plan 172-03
- [ ] `src/cli/cli-conformance-commands.test.ts` + `cli.ts` registration — plan 172-04
- [ ] No framework install needed — Vitest is configured and green

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-data proof against both reference games | CHECK-03, CHECK-05, SC-3 | Requires cross-repo copies of `~/BoardSmithGames/{seven,one-two-punch}` and independent cross-checking of every reported count; not expressible as a repo-local unit test | Follow `172-RESEARCH.md` § Proof Harness verbatim (itself reused from `171-07-PLAN.md`): assert originals' HEADs first, `cp -R` to scratch, run only against copies, cross-check every count independently, confirm originals unchanged after. Record in `172-PROOF.md`. Executed by plan 172-05. |

**Read-only invariant (non-negotiable):** `seven` must be at `a03f38d4792af9dfc7c798be69686fc3230f54dd`
with empty porcelain before and after. `one-two-punch` must be at `7e69471bd8980a854f3e351f2f486e1fb6f712b9`;
do NOT assert porcelain-empty there — it carries 2 pre-existing unrelated deletions — assert
byte-identical instead.

---

## Validation Sign-Off

- [ ] All tasks have an automated verify command or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `172-PROOF.md` exists with real invocations, verbatim output, independently cross-checked counts, and a "what is still unproven" section
- [ ] Both reference-game originals confirmed unchanged after the proof run

**Approval:** planner-populated 2026-07-28; statuses filled by plan 172-05 task 2.
