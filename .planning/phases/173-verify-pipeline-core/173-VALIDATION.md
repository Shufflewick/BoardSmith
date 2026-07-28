---
phase: 173
slug: verify-pipeline-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 173 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `173-RESEARCH.md` § Validation Architecture and `173-PATTERNS.md`.

---

## The honest constraint on this phase

**Most of this phase's deliverable is skill text, and skill text is not behaviourally testable here.**
Every existing `.md` test in this repo (`ingest.test.ts`, `build-chunk.test.ts`, `templates.test.ts`,
`status-tools.test.ts`) asserts only string presence/absence in the raw file — never that a live
session follows the instruction. `ingest.test.ts:352-356` states this limitation in its own comment.

Phase 170's central finding is the same fact from the other direction: twelve instruction-shaped
mechanisms were skipped on live runs while every automated check stayed green. So a green suite is
**necessary and nowhere near sufficient** for this phase.

The split this strategy therefore enforces:

| Layer | Verifiable how |
|---|---|
| `ingest-archive` fix, ledger command, path computation, installer registration | Automated (vitest) — real assertions |
| Skill text says the right thing | Automated (string presence) — weak, but pins the contract against silent deletion |
| Skill text is actually FOLLOWED by a live session | **Live-session proof only** — `173-PROOF.md` |

Any task claiming VERIFY-01/07/08 is satisfied on the strength of `.toContain()` assertions alone
should be rejected in review.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`vitest.config.ts` at repo root; `"test": "vitest run"`) |
| **Quick run command** | `npx vitest run src/cli/commands/ingest-archive.test.ts src/cli/commands/verify-run.test.ts src/cli/commands/install-claude-command.test.ts src/cli/slash-command/bs/` |
| **Full suite command** | `npm test` |
| **Lint** | `npm run lint` — 3 pre-existing errors in `src/engine/` and `src/ui/`; **zero** permitted in `src/cli/` |
| **Estimated runtime** | quick ~10s · full suite ~30s |

Baseline: **3510/3510 green** at Phase 172 close (233 files). Any red at phase start is pre-existing
and must be reported, not absorbed. Note the suite total includes a concurrent unrelated change in
`src/session/stateless-ops.*` from another agent — not this phase's work, and no plan may touch or
stage it.

---

## Sampling Rate

- **After every task commit:** the quick run command above
- **After every plan wave:** `npm test` + `npm run lint`
- **Before `/gsd:verify-work`:** full suite green **AND** `173-PROOF.md` exists with all four
  live-session proofs below
- **Max feedback latency:** ~10s (quick), ~30s (full)

---

## Wave 1 is a hard gate

Decision 1b: `ingest-archive` is broken on already-ingested projects — it reports success while
corrupting `INDEX.md` and silently failing to write `Source hash:`/`Transcribed:`. Reproduced twice
this session (research, then independently by the orchestrator against a `cp -R` copy of `seven`).

**Wave 1 exit condition is not "the command exits 0" — it is that an adopted project actually
computes the adopted scope.** Run adoption against copies of BOTH reference games and assert
`chunk-provenance-status` no longer reports `pre-provenance`. The command already lies about
success; its exit code is not evidence.

No later wave may be verified against real-game data until this passes. Plan 173-01 owns the gate
and is wave 1 alone.

---

## Plan → Wave map

| Wave | Plan | Objective | Autonomous |
|---|---|---|---|
| 1 | 173-01 | Repair `ingest-archive`'s existing-INDEX branch + the real-data gate proof (**GATE**) | yes |
| 2 | 173-02 | `verify-run` CLI: staging tree allocation + append-only RUN.md ledger | yes |
| 2 | 173-03 | Generalize `transcription-subagent.md`'s output directory (no fork) | yes |
| 3 | 173-04 | `/bs-verify-game` entry point + `bs/verify/` sub-steps + skill-text pins | yes |
| 4 | 173-05 | Installer registration + all five `SKILL_NAMES` sites + anti-drift meta-test | yes |
| 5 | 173-06 | Live proofs: SC-1 install, SC-2 non-destructive staging, SC-3 transcript absence | yes |
| 6 | 173-07 | Live proof: SC-4 real kill-and-resume + phase evidence closeout | yes |

Plans 173-02 and 173-03 share a wave and have zero `files_modified` overlap. Per the standing
working-style finding (file-disjoint ≠ git-disjoint), run them serially unless worktree isolation is
used; `.planning/config.json` has `use_worktrees: false`.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 01-T1 pin decision-1b defects (RED) | 173-01 | 1 | Decision 1b | unit (TDD RED) | `npx vitest run src/cli/commands/ingest-archive.test.ts` | ⬜ pending |
| 01-T2 repair existing-INDEX branch | 173-01 | 1 | Decision 1b / VERIFY-01 | unit (TDD GREEN) | `npx vitest run src/cli/commands/ingest-archive.test.ts` | ⬜ pending |
| 01-T3 wave-1 gate proof, both games | 173-01 | 1 | Decision 1b (**GATE**) | **real-data proof** | `bash "${TMPDIR:-/tmp}/173-proof/173-gate.sh"` | ⬜ pending |
| 02-T1 ledger + staging coverage (RED) | 173-02 | 2 | VERIFY-02, VERIFY-08 | unit (TDD RED) | `npx vitest run src/cli/commands/verify-run.test.ts` | ⬜ pending |
| 02-T2 implement `verify-run` + register | 173-02 | 2 | VERIFY-02, VERIFY-08 | unit (TDD GREEN) | `npx vitest run src/cli/commands/verify-run.test.ts` | ⬜ pending |
| 02-T3 staging invisible to every walker | 173-02 | 2 | VERIFY-02 | unit (5 real consumers) | `npx vitest run src/cli/commands/verify-run.test.ts src/cli/commands/chunk-provenance.test.ts` | ⬜ pending |
| 03-T1 parameterize subagent output dir | 173-03 | 2 | VERIFY-07 | diff-bounded edit | `git diff -U0 src/cli/slash-command/bs/ingest/transcription-subagent.md` | ⬜ pending |
| 03-T2 pin generalization + no-fork guard | 173-03 | 2 | VERIFY-07 | string-presence (weak by design) | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` | ⬜ pending |
| 04-T1 `/bs-verify-game` entry point | 173-04 | 3 | VERIFY-01 | structural grep | plan 173-04 task 1 `<automated>` (ENTRYPOINT_OK) | ⬜ pending |
| 04-T2 `bs/verify/` sub-steps | 173-04 | 3 | VERIFY-01/02/07/08 | structural grep | plan 173-04 task 2 `<automated>` (SUBSTEPS_OK) | ⬜ pending |
| 04-T3 skill-text contract pins | 173-04 | 3 | VERIFY-01/02/07/08 | string-presence (weak by design) | `npx vitest run src/cli/slash-command/bs/verify.test.ts` | ⬜ pending |
| 05-T1 installer four-point registration | 173-05 | 4 | VERIFY-01 | unit (real temp-dir install) | `npx vitest run src/cli/commands/install-claude-command.test.ts` | ⬜ pending |
| 05-T2 all five `SKILL_NAMES` sites | 173-05 | 4 | VERIFY-01 | unit | `npx vitest run src/cli/commands/install-claude-command.test.ts` | ⬜ pending |
| 05-T3 meta-test ends the drift class | 173-05 | 4 | VERIFY-01 | unit (self-reading meta-test) | `npx vitest run src/cli/commands/install-claude-command.test.ts` | ⬜ pending |
| 06-T1 real install into a game copy | 173-06 | 5 | VERIFY-01 (SC-1) | **live proof** | `bash "${TMPDIR:-/tmp}/173-proof/173-sc1.sh"` | ⬜ pending |
| 06-T2 live pass + transcript absence | 173-06 | 5 | VERIFY-02, VERIFY-07 (SC-2, SC-3) | **live proof** | `bash "${TMPDIR:-/tmp}/173-proof/173-sc23.sh"` | ⬜ pending |
| 07-T1 real kill-and-resume | 173-07 | 6 | VERIFY-08 (SC-4) | **live proof** | `bash "${TMPDIR:-/tmp}/173-proof/173-sc4.sh"` | ⬜ pending |
| 07-T2 close the evidence trail | 173-07 | 6 | all | suite + docs | `npm test && npm run lint` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Reading this table honestly.** Rows marked "string-presence (weak by design)" and "structural
grep" pin skill-text contracts against silent deletion. They do NOT prove a live session follows the
instruction — `ingest.test.ts:352-356` says exactly this about its own equivalents, and Phase 170
proved the point twelve times over. VERIFY-01, VERIFY-07 and VERIFY-08 are closed by the four
**proof** rows (01-T3, 06-T1, 06-T2, 07-T1) and by nothing else.

---

## Success Criterion → Observable Signal

| Criterion | Observable signal | Sufficient sample | Owned by |
|---|---|---|---|
| **SC-1** — skill installs and runs against an existing project without rebuilding | `bs-verify-game/` present under the installed skills tree after `boardsmith claude`, including its `bs/verify/` subdir; all **five** `SKILL_NAMES` sites in `install-claude-command.test.ts` updated together (3–4 assertions silently keep testing the old 6-skill set otherwise) | unit + a real install into a temp dir + a real install into a game copy | 173-05, 173-06 T1 |
| **SC-2** — non-destructive staging | Live slices byte-identical before/after a full pass; every write lands under `rulebook/.verify/<run-id>/`; no walker picks up the dot-dir | unit (path computation + 5 real consumers) + whole-tree byte manifest diff in the live proof | 173-02 T3, 173-06 T2 |
| **SC-3** — orchestrator never reads a slice (**an ABSENCE**) | **Positive observable:** the orchestrator's captured transcript contains no slice-body-shaped line (`QUOTE`, `Derived (p.`, `Visual (p.`) anywhere across the pass; dispatch prompts carry only unit id + rulebook path + output dir; returns carry only structured-summary fields | live-session proof with a transcript grep — **never** a compliance assertion | 173-06 T2 |
| **SC-4** — resumable | A real interrupted run: kill mid-pass with ≥1 unit recorded and ≥1 unrecorded, re-invoke, then assert (a) recorded units are NOT re-dispatched, (b) unrecorded ones ARE, (c) the end state matches a clean run | live kill-and-resume proof — **not** a unit test of the ledger reader | 173-07 T1 |
| **Decision 1b** — the gate | `chunk-provenance-status` reports adopted (not `pre-provenance`) scope after adoption on copies of both games; `Edition:` preserved; `Source:` wrapped prose intact; `Source hash:`/`Transcribed:` present | unit + real-data proof on both games | 173-01 |

---

## Wave 0 Requirements

- [ ] `src/cli/commands/verify-run.ts` + colocated test — does not exist → plan 173-02
- [ ] `src/cli/slash-command/bs/verify-game.md` + `bs/verify/*.md` — do not exist → plan 173-04
- [ ] `src/cli/slash-command/bs/verify.test.ts` — does not exist → plan 173-04 T3
- [ ] Installer registration for `bs-verify-game` (`SHARED_DIRS`, `SKILL_ENTRY_POINTS`,
      `SHARED_LEAF_PROBES`, post-install summary) — hand-maintained arrays, not auto-discovered →
      plan 173-05
- [ ] `ingest-archive.test.ts` cases for the existing-INDEX branch — the defect currently has no
      failing test → plan 173-01 T1
- [ ] No framework install needed — Vitest configured and green

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Adoption establishes real provenance on a pre-170 project | Decision 1b | Cross-repo; requires copies of real games and an independent scope re-check | `cp -R` both games to scratch, run adoption, assert `chunk-provenance-status` scope changed and `INDEX.md` header is intact field-by-field |
| A live verify pass stages non-destructively | VERIFY-02 / SC-2 | Requires a real skill session, not a unit test | Whole-tree byte manifest of `rulebook/*.md` before and after; must be identical |
| The orchestrator never reads a slice | VERIFY-07 / SC-3 | An absence; only observable in a real session transcript | Grep the captured transcript for slice-body-shaped lines; must find none |
| Kill-and-resume | VERIFY-08 / SC-4 | Requires a real interruption | Per SC-4 above; record verbatim in `173-PROOF.md` |
| Each new skill-text→command invocation actually runs | Phase 170 carry-forward | Instruction-shaped mechanisms get skipped; this is the failure mode the milestone exists to fight | For every new skill-text→command call, show it running in a live session. **Carried-forward debt: `/bs-build-chunk` Step 0's `ingest-check` call has still never been exercised live.** |

**Read-only invariant (non-negotiable):** `~/BoardSmithGames/seven` pinned at
`a03f38d4792af9dfc7c798be69686fc3230f54dd`, porcelain-empty before and after.
`~/BoardSmithGames/one-two-punch` pinned at `7e69471bd8980a854f3e351f2f486e1fb6f712b9`; do NOT
assert porcelain-empty there. All runs against `cp -R` copies. Harness proven in Phases 171 and 172 —
reuse verbatim. Plans that touch these repos (read + copy only): 173-01 T3, 173-06, 173-07.

---

## Validation Sign-Off

- [ ] Wave 1 gate passed: adoption changes computed scope on BOTH reference games
- [ ] All tasks have an automated verify command or a live-proof entry
- [ ] No task claims VERIFY-01/07/08 on `.toContain()` evidence alone
- [ ] All five `SKILL_NAMES` sites updated together
- [ ] `173-PROOF.md` exists with all four live proofs, verbatim output, and a "what is still unproven" section
- [ ] Both reference-game originals confirmed unchanged after every proof run
- [ ] Full suite green; zero lint errors in `src/cli/`
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
