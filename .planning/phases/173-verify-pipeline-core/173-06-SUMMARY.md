---
phase: 173-verify-pipeline-core
plan: 06
subsystem: verify-pipeline-live-proof
tags: [live-session-proof, verify-pipeline, skill-text-bug, subagent-dispatch, non-destructive-staging]

requires:
  - phase: 173-verify-pipeline-core (plan 01)
    provides: "the repaired ingest-archive existing-INDEX branch this pass's Step 1 adoption exercises live"
  - phase: 173-verify-pipeline-core (plan 02)
    provides: "the verify-run-init/-status/-record CLI surface this pass's Step 2 exercises live"
  - phase: 173-verify-pipeline-core (plan 04)
    provides: "bs-verify-game/SKILL.md and bs/verify/*.md — the skill text this pass followed as actual file reads from the installed copy"
  - phase: 173-verify-pipeline-core (plan 05)
    provides: "the installer registration this pass's real npx boardsmith claude --local --force install exercised"
provides:
  - "Live-session evidence for SC-1 (install), SC-2 (non-destructive staging), SC-3 (orchestrator never reads a slice) in 173-PROOF.md sections 2 and 3"
  - "A real, live-session-discovered fix to src/cli/slash-command/bs/verify/source-resolution.md's post-adoption re-check, which previously used the wrong provenance signal and would have false-STOPed on every successful real adoption"
  - "Three documented skill-text ambiguities/gaps (Step 0 lock-identity ordering, staging-dispatch.md's missing inline-transcription exception for short rulebooks, Step 3's unspecified provenance-record format) — not silently resolved, recorded for a later plan or human decision"
affects: [173-07]

tech-stack:
  added: []
  patterns:
    - "Where no internal Task/Agent tool is exposed to the executor, a real 'claude -p' OS-subprocess is the closest faithful substitute for a genuine fresh-context subagent dispatch — a real process boundary with captured stdout as the only return channel, rather than faking dispatch or skipping the proof"
    - "Independent auditor spot-checks of real written content must be captured to a file SEPARATE from the orchestrator's own captured transcript — mixing them contaminates the exact absence-grep the transcript exists to support"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/verify/source-resolution.md
    - src/cli/slash-command/bs/verify.test.ts
    - .planning/phases/173-verify-pipeline-core/173-PROOF.md

key-decisions:
  - "This execution environment does not expose an internal Task/Agent tool to this executor (available tools were Read/Write/Edit/Bash only). Rather than fabricate a subagent dispatch or skip SC-3's proof, a real 'claude -p' subprocess was dispatched with the exact BS-DISPATCH-V2 pointer block, and its captured stdout (the structured return) was what this session held — a genuine, if imperfect, substitute for the native Task tool. Recorded as an explicit constraint in 173-PROOF.md's 'How this pass was actually run' subsection and in 'What is still unproven' item 2, not smoothed into a claim that the Agent tool was used as instructed."
  - "A live-session-discovered bug in source-resolution.md's Case 2 re-check (checking chunk-provenance-status's projectProvenanceState, which never flips from ingest-archive alone) was fixed under deviation Rule 1 rather than left broken, because it is unambiguous, well-understood from wave 1's own already-documented Hedge Refutation, and blocks VERIFY-01 from ever functioning for a real designer without the fix. The fix, its own test update, and 173-PROOF.md were split into two commits for clean history."
  - "REQUIREMENTS.md was NOT touched by this plan — VERIFY-01/02/07 remain unmarked. This plan's evidence is genuine but partial (Git Protocol unproven, only Case 2 of source-resolution.md exercised, no native-Task-tool proof for SC-3, single-unit dispatch only); 173-VALIDATION.md's wave map assigns final evidence-trail closure and requirement marking to plan 173-07 (which also owns SC-4), and this phase has already reverted two premature completion marks. Deferring is the disciplined choice, not an oversight."

requirements-completed: []  # VERIFY-01/02/07 intentionally left unmarked — see key-decisions. 173-07 owns final closure.

duration: ~70min
completed: 2026-07-28
---

# Phase 173 Plan 06: Live proofs — SC-1 install, SC-2 non-destructive staging, SC-3 transcript absence Summary

**Ran a real install of `bs-verify-game` into a disposable copy of `~/BoardSmithGames/seven`, then a genuine live `/bs-verify-game` pass — Step 0 lock through Step 3 close, with a real subprocess-dispatched subagent standing in for the unavailable internal Task tool — and along the way found and fixed a live bug in `source-resolution.md`'s post-adoption re-check that would have false-STOPed every real adoption forever.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 2/2 completed
- **Files modified:** 3 (`source-resolution.md`, `verify.test.ts`, `173-PROOF.md`)

## Accomplishments

- **SC-1 (install).** Preflight confirmed both reference-game originals pinned and clean, exactly
  as the read-only invariant requires. `cp -R` copy of `seven`, then `npx boardsmith claude --local
  --force` from inside the copy — a real CLI install, not a function-level shortcut. Independently
  confirmed (never trusting the installer's own console output): `bs-verify-game/SKILL.md` present
  and byte-identical to the repo source; the installed `bs-shared/verify/` listing matches the repo
  source listing exactly (compared by `ls`, not hardcoded names); all six other skills present, no
  regression. Post-install whole-tree manifest captured as the SC-2 baseline.
- **SC-2 (non-destructive staging).** A real, full live pass — Step 0 through Step 3 — produced
  exactly 11 changed/added paths against the post-install baseline: 7 under `rulebook/.verify/`
  (the staging tree itself), and 4 that are the pipeline's own two already-independently-audited
  single writes (`SKETCH.md`'s session lock, `rulebook/INDEX.md`'s adoption header plus this pass's
  Step-3 provenance-path record, and the new `rulebook/source/rules.pdf` archive). All 4
  pre-existing live `rulebook/*.md` slices confirmed byte-identical, hash-for-hash, before and
  after. `git status --porcelain` cross-check agreed. Staged-slice count agreed two ways (`find` vs.
  `verify-run-status --json`'s `count` field: 6 = 6).
- **SC-3 (orchestrator never reads a slice).** Zero slice-body-shaped lines (`^p.N,` QUOTE prefix,
  `Derived (p.`, `Visual (p.`) anywhere across the full 731-line captured transcript, the raw
  dispatch prompt, or the raw subagent return — each grepped independently, all exit 1 (no match).
  An auditor spot-check of one staged file (kept in a file deliberately separate from the
  transcript) confirmed the staged content genuinely contains `Derived (p.`/`Visual (p.` lines,
  proving the absence in the transcript is real and not an artifact of an empty write. A
  self-caught-and-corrected mistake is recorded in full: an earlier draft of the transcript briefly
  included a human-readable content sample, which would have poisoned its own zero-grep target —
  caught before the grep ran, moved to a separate `173-auditor-spotcheck.txt` file, and the
  correction itself documented rather than silently fixed.
- **A real bug found live, not by inspection.** `source-resolution.md`'s Case 2 re-check told a
  live session to confirm `chunk-provenance-status --json`'s `projectProvenanceState` changed away
  from `"pre-provenance"` after adoption — but it never does, by design (only a separate
  `chunk-check` flips it), a fact wave 1's own `173-PROOF.md` "Hedge Refutation" section already
  documented. Running the real re-check live reproduced the false-STOP exactly as literal skill
  text would trigger it on every successful adoption. Fixed under deviation Rule 1: the re-check
  now reads `rulebook/INDEX.md`'s `Source hash:` line directly (the same disk-state test
  `computeVerificationScope` performs) and explicitly forbids the wrong field, citing the reason.
  `verify.test.ts` updated (37/37 green, was 36/36) with a regression test naming this exact
  finding so it cannot silently regress.
- **Three further skill-text findings recorded, not silently resolved:** Step 0's lock identity
  (`verify:<run-id>`) is documented before the run-id exists (minted in Step 2) — resolved live with
  a documented `verify:pending` placeholder, later refreshed. `staging-dispatch.md` never carries
  forward `ingest/transcription.md`'s inline-transcription exception for short (1-3 page)
  rulebooks — real dispatch was used rather than improvising the missing exception. Step 3's
  "record the staging path in the provenance block" names no format or command — resolved with a
  minimal `Label: value` line matching the file's existing grammar, flagged as unproven against
  whatever a later phase's reader expects.

## Task Commits

1. **Task 1 (harness, install, SC-1 proof)** — folded into the section-2/section-3 evidence; no
   separate commit (this task's files, `173-PROOF.md`, are committed once with task 2's evidence).
2. **Task 2 (live pass, SC-2/SC-3 proof) + the live bug fix:**
   - `02ba28fd` (fix) — `source-resolution.md` re-check rewritten; `verify.test.ts` updated, 37/37 green
   - `39d0d927` (docs) — `173-PROOF.md` sections 2 and 3, full verbatim evidence

## How this live pass was actually run (read before trusting any "dispatched a subagent" claim)

**This execution environment does not expose an internal Task/Agent tool to this executor** — the
available tools were Read, Write, Edit, and Bash only. The plan's objective explicitly calls for
dispatching real transcription subagents "via the Agent tool." Rather than fabricate a dispatch
(forbidden by this repo's own CLAUDE.md: never use dummy data or fallbacks to get something
"working") or silently skip SC-3's proof, a real `claude -p` subprocess was used: a genuine OS-level
process with no inherited conversation history, whose only channel back to this session was its
captured stdout. The exact `BS-DISPATCH-V2` pointer block — byte-identical to what
`staging-dispatch.md` specifies, substituting only the three named fields — was sent as the prompt.
The subprocess read the real contract file, transcribed the real 2-page PDF, wrote six real slice
files to the real staging directory, and returned a structured summary only. This is reported as a
genuine, if imperfect, substitute for the native Task tool — not smoothed into a claim that the
Agent tool was used exactly as the plan specified. See `173-PROOF.md` section 3's "What is still
unproven" item 2.

## Deviations from Plan

### Auto-fixed Issues (Rule 1)

**1. `source-resolution.md`'s post-adoption re-check used the wrong provenance signal.**
- **Found during:** Task 2, Step 1 of the live pass.
- **Issue:** the skill text told a live session to re-run `chunk-provenance-status --json` and
  confirm `projectProvenanceState` left `"pre-provenance"` after `ingest-archive` — but that field
  tracks a different, per-chunk fact and never flips from adoption alone (wave 1's own
  `173-PROOF.md` already documented this distinction). Literal execution reproduced the false-STOP.
- **Fix:** re-check now reads `rulebook/INDEX.md`'s `Source hash:` line directly and explicitly
  forbids the wrong field.
- **Files:** `src/cli/slash-command/bs/verify/source-resolution.md`, `src/cli/slash-command/bs/verify.test.ts`
- **Commit:** `02ba28fd`

### Structural deviations (documented, not silently absorbed)

**1. No internal Task/Agent tool available; a real subprocess was substituted.** See "How this
live pass was actually run" above. Recorded as an unproven gap (`173-PROOF.md` "What is still
unproven" item 2), not claimed as full compliance with the plan's literal instruction.

**2. Step 0's `verify:<run-id>` lock identity taken as a placeholder, then refreshed.** The skill
text names the run-id in the Step-0 lock slug, but the run-id doesn't exist until Step 2. Resolved
with a documented `verify:pending` interim value.

**3. Only Case 2 of `source-resolution.md` was live-exercised.** `seven`'s copy started
pre-provenance with exactly one root candidate — Cases 1/3/4 and the negative case were read and
reasoned about but not run live. `one-two-punch` was preflight/manifest-checked but not put through
a live pass in this plan, per the plan's own guidance that `seven` alone is sufficient and
sensible.

**4. `Step 3`'s Git Protocol was not exercised.** The scratch copy is disposable and never pushed
or merged; committing inside it would add no evidence value. Recorded as unproven.

No other deviations. Every reuse target and command surface named in `173-02-SUMMARY.md` and
`173-04-SUMMARY.md`'s exact JSON shapes and dispatch contracts was used exactly as documented.

## Verification

- `bash "${TMPDIR:-/tmp}/173-proof/173-sc1.sh"` — exits 0, all 5 assertions pass.
- `bash "${TMPDIR:-/tmp}/173-proof/173-sc23.sh"` — exits 0, all 9 assertions pass (SC-2's 5 +
  SC-3's 4).
- `npx vitest run src/cli/slash-command/bs/verify.test.ts` — 37/37 green (was 36/36).
- `npm test` — 3597/3597 green (baseline 3596 + 1 new regression test, zero regressions).
- `npx eslint src/cli/` — zero errors.
- Both reference-game originals reconfirmed: `git rev-parse HEAD` unchanged for both, `git status
  --porcelain` still empty for `seven`, whole-tree sha256 manifest diff empty for both.
- No background process left running (`claude -p` subprocess ran synchronously to completion,
  confirmed via `ps aux` post-run).

## Known Stubs

None. Every write this plan made — the staged slices, the ledger, the INDEX.md provenance line —
is real content produced by a real command or a real (subprocess-dispatched) subagent, not a
placeholder.

## Threat Flags

None beyond the plan's own `<threat_model>` (T-173-51 through T-173-54 and T-173-SC, all
`mitigate`/`accept`, all honored: `cp -R` copies only, pinned-commit and manifest preflight, no
command received an original path, whole-tree manifest diff plus `git status --porcelain`
cross-check, SC-3 proven by grep not by claim, home-directory paths elided from `173-PROOF.md`'s
excerpts via `<copy>` placeholders). No new network endpoints, auth paths, or schema changes were
introduced.

## Self-Check: PASSED

- `[ -f src/cli/slash-command/bs/verify/source-resolution.md ]` — FOUND
- `[ -f src/cli/slash-command/bs/verify.test.ts ]` — FOUND
- `[ -f .planning/phases/173-verify-pipeline-core/173-PROOF.md ]` — FOUND, contains "## 2." and "## 3." sections
- Commit `02ba28fd` — FOUND in `git log`.
- Commit `39d0d927` — FOUND in `git log`.
- Re-ran plan-level verification: `bash 173-sc1.sh` (0), `bash 173-sc23.sh` (0),
  `npx vitest run src/cli/slash-command/bs/verify.test.ts` (37/37), `npm test` (3597/3597),
  `npx eslint src/cli/` (0 errors), both originals re-confirmed unchanged — all green.

---
*Phase: 173-verify-pipeline-core*
*Plan: 06*
*Completed: 2026-07-28*
