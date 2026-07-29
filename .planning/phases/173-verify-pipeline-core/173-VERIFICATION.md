---
phase: 173-verify-pipeline-core
verified: 2026-07-29T00:00:00Z
status: passed
score: 4/4 must-haves verified (with one disclosed evidentiary caveat on SC-3)
overrides_applied: 0
human_verification:
  - test: "Invoke /bs-verify-game as a real slash-command skill inside an actual Claude Code session with native Task-tool access (not a claude -p subprocess), against a disposable copy of a bs-built project (e.g. seven or one-two-punch), and confirm the session's own transcript never contains a slice-body-shaped line (QUOTE / Derived (p. / Visual (p.)."
    expected: "Zero slice-body-shaped lines in the orchestrator's transcript, dispatch prompt, or subagent return — matching the subprocess-based proof already on file in 173-PROOF.md §3/§4."
    why_human: "Every live proof in this phase (173-06, 173-07, 173-08 §5) used a claude -p OS subprocess as a stand-in for the Task/Agent tool because no internal Task tool was exposed to the executing session. This is disclosed explicitly and repeatedly by the phase's own proof document as the single largest evidentiary gap behind SC-3 (VERIFY-07). The structural contract (transcription-subagent.md's 'RETURN a structured summary only' rule) is dispatch-mechanism-agnostic and was verified unchanged, so this is judged NOT to materially weaken the evidence — but VERIFY-07 is a context-economics safety property with real cost implications if wrong, and closing the loop under the actual production dispatch mechanism is the kind of check that needs a human (or an agent with real Task-tool access) to run, not a grep of existing artifacts."
---

# Phase 173: Verify Pipeline Core Verification Report

**Phase Goal:** A designer can invoke `/bs-verify-game` against an existing bs-built project and get
a safely-staged, resumable re-transcription without disturbing the live project.
**Verified:** 2026-07-29
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/bs-verify-game` installs as a skill and runs against an existing project without rebuilding it (SC-1) | VERIFIED | `173-PROOF.md` §2: real `npx boardsmith claude --local --force` install into a `cp -R` copy of `seven`; `bs-verify-game/SKILL.md` byte-identical to repo source; `bs-shared/verify/{source-resolution.md,staging-dispatch.md}` present under the installed tree; other six skills unregressed. Confirmed live against actual code — `src/cli/commands/install-claude-command.ts:37` registers `{ source: 'bs/verify-game.md', skillName: 'bs-verify-game' }` in `SKILL_ENTRY_POINTS`, the single array all four installer touchpoints derive from (closes IN-02's stale-count class). |
| 2 | A verify pass re-transcribes into a non-destructive staging tree — existing slices never overwritten before close (SC-2) | VERIFIED | `173-PROOF.md` §3: whole-tree sha256 manifest diff before/after a full live pass against `seven` shows all 4 pre-existing live `rulebook/*.md` slices byte-identical; all new/staged paths confined to `rulebook/.verify/<run-id>/`. Code-level structural guard confirmed in `verify-run.ts` (`RUN_ID_RE` + resolve-and-prefix belt-and-suspenders in `stagingSlicesDir`, an independent resolve-and-prefix check in `verifyRunRecordCommand`) — reviewed and traced in `173-REVIEW.md`, no `--apply`/cutover path exists anywhere in the skill text or CLI. |
| 3 | The orchestrator never reads a full slice — re-transcription is dispatched to subagents (SC-3) | VERIFIED, with a disclosed evidentiary caveat | `173-PROOF.md` §3/§4: zero `QUOTE`/`Derived (p.`/`Visual (p.` hits across a 731-line live-pass transcript and a separate 328-line kill/resume transcript, cross-checked against raw dispatch-prompt and subagent-return capture files in isolation. **Caveat, judged not materially weakening but genuinely open:** every live dispatch in this phase used a `claude -p` OS subprocess, not Claude Code's native Task/Agent tool, because no internal Task tool was exposed to the executing session. See Human Verification below. |
| 4 | Killing a verify pass mid-run and re-invoking it resumes at the first unrecorded step, not from scratch (SC-4) | VERIFIED | Two-stage proof. 173-07 ran a REAL harness-timeout SIGTERM and a REAL `kill -9` on a live PID against `one-two-punch`, and found CR-01 (ledger write was `fs.writeFile` full-truncate-rewrite, not append — a crash could destroy the WHOLE ledger, not just the final line) plus Finding 1 (range-level resume re-dispatch was non-deterministic, 9-vs-4 units). Both are Critical/load-bearing and were NOT silently absorbed — reported honestly, then fixed by 173-08 (`atomicWriteFile`: temp file + `fsync` + `rename()`, verified present in `verify-run.ts:213-227`; a persisted dispatch-range manifest with `--complete-range`/`--reset-range`, verified present in `verify-run.ts` and `cli.ts:243-252`) and re-proven live in `173-PROOF.md` §5 against real `kill -9`s (including a 32-real-kill crash-hammer test bracketing the write window, 32/32 no torn ledger / no fence loss) — the killed-then-resumed run's final `recorded[]` set is now IDENTICAL to a clean run's (3-and-3, was 9-and-4). |

**Score:** 4/4 truths verified. SC-3 carries a disclosed, judged-non-fatal but genuinely open evidentiary gap (see Human Verification).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/slash-command/bs/verify-game.md` | Skill entry point, VERIFY-01 | VERIFIED | 127 lines, real orchestration prose (Step 0-3, context-economics hard rule, reference-file map). No placeholder/TODO markers. |
| `src/cli/slash-command/bs/verify/source-resolution.md` | Decision-1 adoption flow | VERIFIED | 86 lines. Installed copy confirmed byte-present under `bs-shared/verify/` in the live SC-1 proof. |
| `src/cli/slash-command/bs/verify/staging-dispatch.md` | Run init, ledger-driven resume, fan-out dispatch | VERIFIED | 164 lines. Same install confirmation. |
| `src/cli/commands/verify-run.ts` | Staging allocator + append-only ledger CLI | VERIFIED | Atomic write (`atomicWriteFile`, temp+fsync+rename), range manifest, `--complete-range`/`--reset-range`/`--ranges` flags all present and match `173-PROOF.md` §5's transcript verbatim. |
| `src/cli/commands/verify-run.test.ts` | Ledger/staging coverage incl. CR-01 regression | VERIFIED | 36/36 passing; `CR-A`/`CR-B` (crash-safety) and `M1`-series (range-manifest determinism) describe blocks present and green. |
| `src/cli/commands/ingest-archive.ts` (existing-INDEX branch repair) | Decision 1b's wave-1 gate fix | VERIFIED | `afterTitleInsertionPoint()` present (closes WR-01); `restOfLine` dead code removed (closes IN-01); insert-if-absent + wrap-safe `Source:` replace confirmed by direct file read. |
| `src/cli/commands/install-claude-command.ts` | Four-point `bs-verify-game` registration | VERIFIED | Single `SKILL_ENTRY_POINTS` array is the sole source for `ownedPaths`, `copySkillTree`, the post-install summary line, and `uninstallClaudeCommand` — stale "5 skills" comments (IN-02) all replaced with `${SKILL_ENTRY_POINTS.length}`-derived text; `grep -n "the 5\|5 SKILL\|5 skill"` returns nothing. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `/bs-verify-game` Step 2 | `verify-run-init`/`verify-run-status`/`verify-run-record` CLI | shelled command invocations named explicitly in skill text | WIRED | Confirmed by direct file read of `staging-dispatch.md` and by the live proof's transcript actually invoking these exact commands. |
| `verify-game.md` | `ingest/transcription-subagent.md` (reused unchanged) | `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md`, parameterized by output directory | WIRED | `173-REVIEW.md` traced the generalization as surgical — both load-bearing sentences ("RETURN a structured summary only…", never-writes/never-re-reads) survive verbatim; a structural no-fork test guards this. |
| `install-claude-command.ts` | `bs-verify-game/` + `bs-shared/verify/` on disk | `copySkillTree` / `SHARED_DIRS` (includes `'verify'`) | WIRED | `SHARED_DIRS = ['build', 'ingest', 'templates', 'aspects', 'verify']` confirmed at `install-claude-command.ts:59`; live install proof confirms the files land. |
| `verify-run.ts` ledger write | `atomicWriteFile` | direct function reference | WIRED | Every write site (`verifyRunInitCommand`, `verifyRunRecordCommand` both call sites) goes through `atomicWriteFile`, never raw `fs.writeFile` — confirmed by grep, matches `173-REVIEW.md`'s CR-01 resolution note. |

### Data-Flow Trace (Level 4)

Not applicable in the conventional sense (no UI/dynamic-render component in this phase's scope). The
equivalent check performed here is the byte-manifest / ledger-content trace already covered under
SC-2/SC-4 above: staged files were independently confirmed to hold real transcription content
(`Derived (p.`/`Visual (p.` lines), not stubs, via a separate auditor spot-check file
(`173-auditor-spotcheck.txt`) deliberately kept apart from the SC-3 transcript so it never
contaminates that criterion's zero-grep target.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| VERIFY-01 | Designer runs `/bs-verify-game` and gets a per-chunk verdict without rebuilding | Correctly left OPEN (partial) | Install-and-run half proven live (`173-PROOF.md` §2). "Per-chunk verdict" requires classification, explicitly out of scope for this phase per `173-CONTEXT.md` ("this phase classifies NOTHING... Phase 174 owns the classifier"). REQUIREMENTS.md's own split matches the phase's declared boundary — this is an honest, correct split, not a third premature-completion mark. |
| VERIFY-02 | Full rulebook re-transcribed into staging non-destructively | SATISFIED | `173-PROOF.md` §3 (live, `seven`) + §4/§5 (live, `one-two-punch`); code-level structural guards traced in `173-REVIEW.md`. |
| VERIFY-07 | Orchestrator never reads a full slice; re-transcription + classification both in subagents | Correctly left OPEN (partial) | Re-transcription half proven live twice, with the disclosed subprocess-vs-Task-tool caveat (see Human Verification). Classification half is explicitly Phase 174's — correctly deferred. |
| VERIFY-08 | Verify pass is resumable; crash resumes at first unrecorded step | SATISFIED | Originally closed by 173-07 on a guarantee CR-01 disproved; re-justified against corrected code and re-proven live in `173-PROOF.md` §5, including a 32-real-kill crash hammer test. This is a genuine re-proof against new evidence, not a rubber stamp — confirmed by direct code read (`atomicWriteFile` in `verify-run.ts`) and a green `verify-run.test.ts` (36/36, including the `CR-01`/`173-08 Task 2` describe blocks). |

**Orphaned requirements check:** `PROC-01` ("every skill change is proven against a real bs-built
game") is satisfied throughout — every phase claim in `173-PROOF.md` is backed by a live run against
`cp -R` copies of `seven` and/or `one-two-punch`, never against a fixture alone. No requirement
mapped to Phase 173 in `.planning/REQUIREMENTS.md` is missing a corresponding plan/proof.

### Anti-Patterns Found

None. Scanned all phase-modified CLI/skill-text files
(`ingest-archive.ts`, `verify-run.ts`, `install-claude-command.ts`, `verify-game.md`,
`verify/source-resolution.md`, `verify/staging-dispatch.md`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER`
and "not yet implemented"/"coming soon" phrasing — zero matches.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full suite green | `npm test` | 3611/3611 passed, 235 files | PASS |
| Zero lint errors in `src/cli/` | `npx eslint src/cli/` | Clean (0 output; 0 errors) | PASS |
| `verify-run.test.ts` isolated | `npx vitest run src/cli/commands/verify-run.test.ts` | 36/36 passed, incl. `CR-A`/`CR-B`/`M1`-series | PASS |
| Atomic-write mechanism present in shipped code | `grep atomicWriteFile src/cli/commands/verify-run.ts` | present at every ledger write site (init + both record paths) | PASS |
| Reference-game originals untouched by this verification pass | `git -C ~/BoardSmithGames/seven status --porcelain`, same for one-two-punch | Not re-run this pass (instructed not to touch `~/BoardSmithGames/`); relied on phase's own repeated, independently-confirmed manifest diffs (empty every time, 173-01/06/07/08) | Not independently re-run per instructions — accepted on the strength of 4 independent capture points across the phase |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention applies to this phase; the phase's own equivalent (the
`${TMPDIR:-/tmp}/173-proof/*.sh` reusable scripts named in `173-PROOF.md`'s "How to re-run every
proof" section) were not re-executed here because they assert against ephemeral scratch-dir capture
files from the original live runs, which no longer exist in this session's environment (a fresh
verifier process, per the task's own scratchpad isolation). This verifier instead re-derived
equivalent evidence directly: re-ran the full vitest suite, re-ran lint, and read the actual shipped
source for every mechanism the scripts were said to exercise (atomic write, range manifest, insert-
if-absent INDEX repair, installer four-point registration) — all matched the proof's narrative
exactly, with no discrepancy found.

### Human Verification Required

### 1. `/bs-verify-game` dispatch under a real Task-tool session

**Test:** Invoke `/bs-verify-game` as an actual slash-command skill inside a real Claude Code
session with native Task/Agent tool access (not a `claude -p` subprocess), against a disposable
copy of a bs-built project.

**Expected:** The session's own transcript, dispatch prompt, and subagent return contain zero
slice-body-shaped lines (`QUOTE`, `Derived (p.`, `Visual (p.`) — matching the subprocess-based
proof already on file.

**Why human:** Every live dispatch proof in this phase (`173-06`, `173-07`, `173-08` §5) used an
OS-level `claude -p` subprocess as the closest available equivalent to a genuine Task-tool
subagent, disclosed explicitly and repeatedly as the phase's own largest open item, because no
internal Task tool was exposed to the executing session at the time. The structural contract
(`transcription-subagent.md`'s "RETURN a structured summary only" rule, verified unchanged) is
dispatch-mechanism-agnostic, so this is judged unlikely to be a real defect — but VERIFY-07 is a
context-economics correctness property with real operating cost if wrong, and closing this loop
requires an actual Task-tool-capable session, which this verifier does not have.

### Gaps Summary

No BLOCKER-level gap was found. All four roadmap success criteria have direct, independently
re-checked evidence in `173-PROOF.md`, and every code-level claim in that document and in
`173-REVIEW.md` was independently re-verified against the actual shipped source in this pass (not
merely re-read from the SUMMARY narrative) — file existence, atomic-write implementation, range-
manifest CLI flags, installer registration, debt-marker scan, full test suite, and lint all match
the claims exactly. `173-08`'s re-proof genuinely re-establishes VERIFY-08's guarantee against the
corrected code, not merely against the disproven claim 173-07 originally relied on (confirmed via a
direct code read of `atomicWriteFile` and the green `CR-01`/`M1`-series test blocks). VERIFY-01 and
VERIFY-07 are correctly left open in `REQUIREMENTS.md` — this reflects the phase's own declared
boundary (classification is Phase 174's), not a third premature-completion mark on a requirement
this phase never claimed to close in full.

The single open item is SC-3/VERIFY-07's dispatch-mechanism caveat: every live proof in this phase
used a subprocess stand-in for the Task tool, disclosed honestly by the phase's own authors and
independently confirmed present (not smoothed over) by this verifier. Routed to human verification
rather than either a blanket pass or a manufactured gap, because it is a real, load-bearing,
already-disclosed limitation on a correctness property this milestone exists to protect, not a
defect this verifier can resolve by reading more code.

Two lower-severity, explicitly disclosed carry-forward limitations are worth surfacing but are not
blocking: the Git Protocol mechanism at Step 3 close has never been exercised (all proof copies were
disposable scratch harnesses, never committed to), and only Case 2 of `source-resolution.md`'s four
cases (single unarchived candidate) has been live-exercised — Cases 1/3/4 remain unproven. Neither
is required by this phase's roadmap success criteria as stated, and both are recorded plainly in
`173-PROOF.md`'s own "What is still unproven" section rather than hidden.

---

_Verified: 2026-07-29_
_Verifier: Claude (gsd-verifier)_

---

## Caveat closed — status changed `human_needed` → `passed` (2026-07-28)

The single item routed to human verification — that every live dispatch proof used a `claude -p`
subprocess rather than the native Task/Agent tool — was closed by the orchestrator session, which
had the Agent tool available.

A real transcription unit was dispatched through the native Agent tool against the installed
subagent contract. With a positive control confirming the written slice DID contain a body marker
(`Derived (p.1)`), the orchestrator's received return contained **zero** slice-body markers and
**zero** verbatim rule text. Full method, verbatim output, and the stated scope limit are recorded
in `173-PROOF.md` §6.

VERIFY-07's return contract therefore holds under the dispatch mechanism production actually uses.
No human verification item remains outstanding for this phase.
