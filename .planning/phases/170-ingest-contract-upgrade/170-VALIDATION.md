---
phase: 170
slug: ingest-contract-upgrade
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-27
---

# Phase 170 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing, repo-wide) |
| **Config file** | repo root `vitest.config.ts` (existing, unchanged) |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2s quick / full suite per repo norm |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/slash-command/bs/ingest.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green **plus** the PROC-01 manual proof run
  (real `/bs-ingest-rules` against `~/BoardSmithGames/seven/rules.pdf` into a throwaway dir)
  recorded in the phase SUMMARY
- **Max feedback latency:** ~5 seconds (quick run)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; this map is keyed by requirement and updated during
> execution as tasks land.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | INGEST-02 | — | N/A | skill-text contract | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` | ✅ | ⬜ pending |
| TBD | 01 | 1 | INGEST-03 (`openGaps[]` return field) | — | N/A | skill-text contract + return-shape pin | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` | ✅ | ⬜ pending |
| TBD | 02 | 2 | INGEST-01 (archive + SHA-256) | — | N/A | skill-text contract | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` | ✅ | ⬜ pending |
| TBD | 02 | 2 | INGEST-03 (`## Open Rules Gaps` assembly) | — | N/A | skill-text contract | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` | ✅ | ⬜ pending |
| TBD | 02 | 2 | INGEST-04 (INDEX header block) | — | N/A | skill-text contract | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` | ✅ | ⬜ pending |
| 03-02 | 03 | 3 | PROC-01 + INGEST-01/03/04 (INDEX artifacts) | T-170-07, T-170-09 | reference game unmodified; hash independently recomputed | manual proof run, recorded in SUMMARY | N/A — human-run `/bs-ingest-rules` | N/A | ⬜ pending |
| 03-02 | 03 | 3 | INGEST-02 on live output (checklist h/i) | — | N/A | manual proof run — slice grep + by-hand decision test | N/A — human-run `/bs-ingest-rules` | N/A | ⬜ pending |
| 04-02 | 04 | 4 | INGEST-03 + INGEST-04 (artifact shape) | T-170-12 | fixture never hand-edited to green a test | golden-fixture artifact-shape test | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "artifact shape"` | ❌ W0 → Plan 04 Task 1 | ⬜ pending |
| 04-03 | 04 | 4 | PROC-02 (all six requirements) | T-170-11 | per-requirement RED-then-GREEN probe + circularity check | process record + full suite | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Golden `INDEX.md` fixture file — derived from this phase's own real `seven` re-ingest run
      output rather than hand-authored, so the fixture proves the contract the skill text actually
      produces (per RESEARCH Pitfall 3)
- [ ] New artifact-shape test asserting the fixture's header block (`Edition:` / `Source:` /
      `Source hash:` / `Transcribed:`) and its `## Open Rules Gaps` section shape
- [ ] Extend the existing `RETURN_SHAPE_FIELDS` pinning array (`ingest.test.ts:195-202`) with
      `openGaps[]` — extend the existing array, do not create a parallel one

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real `/bs-ingest-rules` run archives `rulebook/source/rules.pdf`, records its true SHA-256, emits the four header lines, emits a POPULATED `## Open Rules Gaps`, and produces slices carrying both `Derived (p.N):` and `Visual (p.N):` lines | PROC-01, INGEST-01..04 | The skill is instructions to an LLM agent — its runtime behavior is not deterministic and cannot be asserted in CI without making CI non-deterministic | See `170-03-PLAN.md` Task 2 checklist (a)-(i), which is the authoritative version of this procedure. In outline: install the edited skills `--local` into a throwaway dir (global `~/.claude/skills/` untouched); run `/bs-ingest-rules` against `~/BoardSmithGames/seven/rules.pdf`; verify the archived file + hash match; verify the four header lines; verify the gaps section lists real entries (`_None._` is a FAIL on this input — `seven` is known to carry 4 markers, so `_None._` means the `openGaps[]` transport broke); grep the produced slices for both line prefixes and hand-check them against the decision test; confirm `~/BoardSmithGames/seven` is unmodified. |
| Adversarial re-check that the landed fix holds | PROC-02 | Process discipline, not a single assertion | After tests are green, re-read the edited skill text against the requirement wording and confirm no requirement is satisfied by test-shaped text alone |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the sole exception is `170-03` Task 2, a blocking human-verify checkpoint whose criteria are concrete pasted-output assertions)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (fixture → Plan 04 Task 1; artifact-shape test → Plan 04 Task 2; `RETURN_SHAPE_FIELDS` + `openGaps[]` → Plan 01 Task 2, extending the existing array)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-27 (post plan-check revision — blockers 1 and 2 closed in `170-03-PLAN.md` Task 2)
