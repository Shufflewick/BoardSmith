---
phase: 172
slug: source-free-conformance-checks
status: draft
nyquist_compliant: false
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
| **Quick run command** | `npx vitest run src/cli/commands/trace-check.test.ts src/cli/commands/drift-check.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~5s · full suite ~3–4 min |

Baseline: 3407/3407 green as of `171-07-SUMMARY.md`. No `src/` touched since, so that is the
expected pre-172 baseline. Any red at phase start is pre-existing and must be reported, not absorbed.

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/cli/commands/trace-check.test.ts src/cli/commands/drift-check.test.ts`
- **After every plan wave:** `npm test`
- **Before `/gsd:verify-work`:** Full suite green **AND** the real-data proof artifact `172-PROOF.md`
  exists demonstrating non-no-op output against copies of both reference games.
- **Max feedback latency:** ~5 seconds (quick), ~4 minutes (full)

---

## Per-Task Verification Map

> Populated by the planner. Every task must land in this table with a real automated command,
> except the proof task, which is a real-invocation integration proof rather than a unit test.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| _pending planner_ | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement → Observable Signal

The signals that actually prove each success criterion — what the phase gate samples.

| Req | Observable signal | Sufficient sample |
|-----|-------------------|-------------------|
| CHECK-03 | Claim extraction is scoped to `## Interpretation` and survives `### Corrections…` continuation subsections; non-contiguous numbering (4/17 `seven` chunks start at 7/11/20/28) does not become phantom `claim-untested` findings | unit fixtures reproducing both real shapes |
| CHECK-03 | The three-rung resolution ladder (manifest owners → claim-number validity → authoring chunk) narrows a real multi-owner citation to one chunk, and reports `ambiguous-claim-ref` only when >1 survives all three | unit, with a fixture where each rung is the deciding one |
| CHECK-03 | `test-unlinked` fires for a chunk-associated test importing `src/rules/` that cites nothing, and does NOT fire for a11y/soak/theme/asset-reachability files | unit, one positive + one of each negative shape |
| CHECK-03 | Ruling coverage parses `### Ruling N`, handles both supersession directions, and does not read "reconciles"/"extends"/"UPHOLDS"/"resolves OQ-N" as supersession | unit, all five verb shapes from real data |
| CHECK-05 | Verified-commit-hash extraction handles all 5 real formats (bare/backtick × short/full, plus the prose-prefixed case where the hash is not on the first line) | unit, all 5 shapes |
| CHECK-05 | `git diff --name-only <hash> HEAD` executes with explicit `cwd` = the GAME repo, never BoardSmith's | unit against a real temp git repo, not a fixture dir |
| CHECK-05 | A manifest file absent from disk reports as drift | unit + confirmed live on `jab`'s `GuardCardView.vue` |
| CHECK-05 | A chunk with no recorded hash reports `drift-unknown`, never collapsed into drifted or clean | unit |
| Both | Findings exit 0; only tool failure (not a bs- project, not a git repo, missing INDEX) exits non-zero | unit on exit codes |
| SC-3 | Real, non-no-op findings against copies of both reference games, cross-checked against independently computed counts | `172-PROOF.md` |

---

## Wave 0 Requirements

- [ ] `src/cli/commands/trace-check.ts` + colocated `trace-check.test.ts` — do not exist
- [ ] `src/cli/commands/drift-check.ts` + colocated `drift-check.test.ts` — do not exist
- [ ] Shared Build Manifest parser module — "one parser, one authority" for both commands; does not exist
- [ ] `cli.ts` registration for `trace-check` / `drift-check` — does not exist
- [ ] No framework install needed — Vitest is configured and green

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-data proof against both reference games | CHECK-03, CHECK-05, SC-3 | Requires cross-repo copies of `~/BoardSmithGames/{seven,one-two-punch}` and independent cross-checking of every reported count; not expressible as a repo-local unit test | Follow `172-RESEARCH.md` § Proof Harness verbatim (itself reused from `171-07-PLAN.md`): assert originals' HEADs first, `cp -R` to scratch, run only against copies, cross-check every count independently, confirm originals unchanged after. Record in `172-PROOF.md`. |

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
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
