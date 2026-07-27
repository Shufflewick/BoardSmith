---
phase: 170
slug: ingest-contract-upgrade
status: draft
nyquist_compliant: false
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
| TBD | 03 | 3 | INGEST-03 + INGEST-04 (artifact shape) | — | N/A | golden-fixture artifact-shape test | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 03 | 3 | PROC-01 | — | N/A | manual proof run, recorded in SUMMARY | N/A — human-run `/bs-ingest-rules` | N/A | ⬜ pending |

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
| A real `/bs-ingest-rules` run archives `rulebook/source/rules.pdf`, records its true SHA-256, emits the four header lines, and emits `## Open Rules Gaps` | PROC-01, INGEST-01..04 | The skill is instructions to an LLM agent — its runtime behavior is not deterministic and cannot be asserted in CI without making CI non-deterministic | 1. `npx boardsmith claude --local` in a throwaway project dir (non-destructive; leaves the user's global `~/.claude/skills/` alone). 2. Run `/bs-ingest-rules` against `~/BoardSmithGames/seven/rules.pdf`. 3. Confirm `rulebook/source/rules.pdf` exists and `shasum -a 256` matches the `Source hash:` line in `rulebook/INDEX.md`. 4. Confirm the four header lines and `## Open Rules Gaps` are present. 5. Confirm `~/BoardSmithGames/seven` is unmodified (`git status` clean in that repo). |
| Adversarial re-check that the landed fix holds | PROC-02 | Process discipline, not a single assertion | After tests are green, re-read the edited skill text against the requirement wording and confirm no requirement is satisfied by test-shaped text alone |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
