---
phase: 173-verify-pipeline-core
plan: 07
subsystem: verify-pipeline-live-proof
tags: [live-session-proof, verify-pipeline, kill-and-resume, resume-ledger, crash-safety, phase-closeout]

requires:
  - phase: 173-verify-pipeline-core (plan 02)
    provides: "the verify-run-init/-record/-status CLI surface this plan's kill-and-resume harness drove directly"
  - phase: 173-verify-pipeline-core (plan 06)
    provides: "the live-proof harness pattern (real cp -R copies, real claude -p subprocess dispatch, whole-tree manifest diffing, transcript absence-grep) this plan reused for a second game"
provides:
  - "Live-session evidence for SC-4 (real kill-and-resume) in 173-PROOF.md section 4 — two genuinely
    real interruption mechanisms (a harness-timeout SIGTERM mid-record-loop, and a deliberate kill -9
    on a live subprocess PID)"
  - "Two real, load-bearing findings not fixed in this phase: range-level resume re-dispatch is not
    idempotent (re-covers an already-partially-recorded page range in full rather than sub-dividing
    it, producing 9 recorded units for a 2-page book vs. 4 for an uninterrupted clean run of the same
    book); a torn ledger line that also destroys the trailing END fence throws a hard error instead
    of gracefully demoting the affected unit, unlike the narrower torn-line-only case which behaves
    exactly as the design's own comment promises"
  - "173-PROOF.md's final phase-wide 'What is still unproven' and 'How to re-run every proof' sections"
  - "173-VALIDATION.md fully signed off: Per-Task Verification Map complete, Validation Sign-Off
    checklist ticked with evidence citations, nyquist_compliant: true"
  - "REQUIREMENTS.md: VERIFY-02 and VERIFY-08 marked complete with citations; VERIFY-01 and VERIFY-07
    deliberately left open (their 'per-chunk verdict'/'classification in subagents' halves depend on
    Phase 174's classifier, which does not exist yet); PROC-01 checkbox/table inconsistency corrected"
affects: []

tech-stack:
  added: []
  patterns:
    - "A page-range dispatch split into single-page chunks, run as a real background OS process,
      killed by an actual `kill -9` on its confirmed PID (via `ps`) rather than a simulated stop —
      the harness's own command-timeout SIGTERM landing mid-record-loop on an earlier call turned out
      to be an equally genuine, unplanned second interruption mechanism, and was kept and reported
      rather than discarded as noise"
    - "A clean, uninterrupted single-dispatch run of the same book on a second copy, used as an
      end-state comparison baseline rather than assuming the interrupted run's completion count is
      automatically 'the same as a clean run would reach' — this is what surfaced Finding 1"
    - "Two deliberately-constructed sub-cases for a single crash-safety claim (torn ledger line, END
      fence intact vs. torn ledger line, END fence ALSO gone) rather than testing only the case the
      design document explicitly describes — proving the boundary of a documented guarantee, not just
      its interior"

key-files:
  created: []
  modified:
    - .planning/phases/173-verify-pipeline-core/173-PROOF.md
    - .planning/phases/173-verify-pipeline-core/173-VALIDATION.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/STATE.md

key-decisions:
  - "one-two-punch (not seven) was the SC-4 target, split into two single-page dispatches (1-1, then
    2-2) specifically so a kill could land BETWEEN two independent subagent calls, producing an
    actually-observed 'at least one recorded, at least one unrecorded' intermediate state rather than
    a constructed one — per the plan's own fallback guidance if seven's unit count were too low, and
    because a second independent game exercises the pipeline against a second real dataset."
  - "Both a harness-caused SIGTERM (unplanned, but genuinely real) and a deliberate kill -9 on a
    confirmed live PID were kept as two separate, honestly-reported interruption events rather than
    discarding the SIGTERM as 'not a real test.' The plan's own language ('kill -9 the driving
    process... or... a real session abort') does not require a SPECIFIC termination signal, only a
    genuine one; both qualify, and using both gave two different intermediate states to test resume
    against (mid-record-loop for range 1, before-any-dispatch for range 2)."
  - "VERIFY-01 and VERIFY-07 were left OPEN in REQUIREMENTS.md rather than marked complete, even
    though this phase's own scoped Phase Boundary (173-CONTEXT.md) narrows them to exactly what this
    phase proved. The REQUIREMENTS.md prose is the authoritative, un-scoped text ('get a per-chunk
    verdict', 'classification... run in subagents'), and neither half exists until Phase 174's
    classifier. Marking these complete now would have been the third premature completion mark this
    phase has had to catch (after two earlier reverted marks named in the plan's own context) — left
    open with a full citation trail instead."
  - "VERIFY-08 WAS marked complete despite Finding 1 (range-level resume is not idempotent), because
    the requirement's core, protected property — no recorded unit is ever lost, silently
    re-dispatched, or duplicated on resume — is exactly what 173-VALIDATION.md's own SC-4 'truths'
    enumerate, and it holds under both real interruption mechanisms tested. The stronger literal
    reading of the requirement text ('rather than re-running the re-transcription', read as 'never any
    redundant re-transcription anywhere') does not fully hold for a range interrupted mid-way through
    its own recording — this is documented as an explicit caveat inline in REQUIREMENTS.md rather than
    hidden by the checkbox."
  - "PROC-01's checkbox (unchecked) was inconsistent with its own traceability table entry ('Complete',
    Phase 170) — corrected under deviation Rule 1 (auto-fix a found bug) since it is unambiguous, and
    the plan's own context explicitly asked this phase's proof chain to be assessed against it."

requirements-completed: [VERIFY-02, VERIFY-08]

duration: ~95min
completed: 2026-07-28
---

# Phase 173 Plan 07: Live proof — SC-4 real kill-and-resume + phase evidence closeout Summary

**Killed a real verify-pass dispatch twice (a harness-timeout SIGTERM mid-record-loop, then a deliberate `kill -9` on a live subprocess PID) against a fresh `cp -R` copy of `one-two-punch`, proved the ledger's core no-data-loss guarantee holds under both, and reported two genuine findings the automated suite could never have surfaced: range-level resume re-dispatch is not idempotent, and a torn ledger line that also destroys its trailing fence throws instead of degrading gracefully.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 2/2 completed
- **Files modified:** 5 (`173-PROOF.md`, `173-VALIDATION.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`)

## Accomplishments

- **SC-4 proven with two real interruption mechanisms, not one simulated stop.** Dispatch of
  `one-two-punch`'s 2-page rulebook was split into two single-page ranges specifically so a kill
  could land between independent subagent calls. The first interruption was a genuine, unplanned
  SIGTERM from the test harness's own command timeout, landing mid-record-loop after one of two
  written units was recorded and before the second; kept and reported as a real event rather than
  discarded. The second was a deliberate `kill -9` on a confirmed live PID (verified via `ps`
  before and after), landing before any output existed for that range at all.
- **Core crash-safety guarantee independently verified.** The originally-recorded unit's staged
  file is byte-identical (mtime AND sha256) across the entire kill-and-resume sequence; its ledger
  line appears exactly once; the unit that was staged-but-unrecorded at kill time was recorded on
  resume from the PRE-EXISTING write (unchanged mtime/hash), not regenerated; the range killed
  before any dispatch resumed with zero waste, exactly at the first unrecorded step.
- **Finding 1 (real, load-bearing): range-level resume is not idempotent.** Re-dispatching a
  page range that was only partially recorded at kill time produces additional, non-deterministically
  re-fragmented content covering the SAME already-covered ground, because the ledger has no
  mechanism for expressing "half of this range is already covered." Result: 9 recorded units for a
  2-page book on the interrupted-and-resumed run, vs. 4 units for an uninterrupted clean single-pass
  dispatch of the identical book (run on a second copy for direct comparison). No already-recorded
  unit was lost or duplicated — the safety guarantee holds — but the resumed run's end state
  measurably does NOT match a clean run's end state, and is reported as such rather than reframed as
  a pass.
- **Finding 2 (real, load-bearing): the torn-ledger crash-safety guarantee's literal wording does
  not cover a fence-destroying crash.** Two sub-cases were deliberately constructed against isolated
  fixture copies: Case A (final line torn, END fence intact) demotes the affected unit to NOT
  recorded exactly as the design's own comment promises, exit 0. Case B (final line torn AND the
  END fence also missing — plausible given `verify-run-record`'s rewrite-based append
  implementation) instead throws a hard, actionable error and blocks all resume progress on that
  run-id until manual repair — safe, but not the graceful degradation the stated guarantee implies
  for "the final line."
- **Evidence trail closed.** `173-PROOF.md` now carries all four live proofs (wave-1 gate, SC-1,
  SC-2/SC-3, SC-4) plus a final phase-wide "What is still unproven" (9 items, including both new
  findings and every carry-forward from plan 173-06) and a "How to re-run every proof" block naming
  all four reusable scripts. `173-VALIDATION.md`'s Per-Task Verification Map is fully marked
  (18/18 green) and its Validation Sign-Off checklist is ticked with evidence citations, not blanket
  approval — `nyquist_compliant: true` set.
- **Requirements closed honestly, not completely.** VERIFY-02 and VERIFY-08 marked complete with
  citations. VERIFY-01 and VERIFY-07 deliberately left OPEN — their un-scoped REQUIREMENTS.md text
  ("get a per-chunk verdict", "classification... run in subagents") depends on Phase 174's
  classifier, which this phase explicitly excludes (`173-CONTEXT.md`'s Phase Boundary). Marking
  either complete now would have been the third premature completion mark this phase has had to
  catch. A pre-existing PROC-01 checkbox/table inconsistency was also corrected (Rule 1).

## Task Commits

1. **Task 1 (SC-4 kill-and-resume proof):** `cd5bf276` (docs) — `173-PROOF.md` section 4, full
   verbatim evidence, two findings.
2. **Task 2 (close the evidence trail):** this commit — `173-PROOF.md`'s final sections,
   `173-VALIDATION.md` sign-off, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`.

## How this live pass was actually run

Following plan 173-06's own documented constraint: this execution environment does not expose an
internal Task/Agent tool to this executor (available tools: Read/Write/Edit/Bash only). Every
dispatch in this plan — four total against `otp-kill`, one against `otp-clean` — used a real
`claude -p` OS-subprocess as the closest faithful substitute for a genuine fresh-context Task-tool
subagent, sent the exact `BS-DISPATCH-V2` pointer block byte-identical to what `staging-dispatch.md`
specifies, and treated its captured stdout as the only return channel. This is the same,
consistently-applied constraint plan 173-06 named; not smoothed into a claim that the Agent tool was
used as the plan's objective literally describes. See "What is still unproven" item 4 in
`173-PROOF.md`.

## Deviations from Plan

### Auto-fixed Issues (Rule 1)

**1. PROC-01's checkbox was inconsistent with its own traceability table.**
- **Found during:** Task 2, assessing PROC-01 per the plan's context instructions.
- **Issue:** `REQUIREMENTS.md` line 34 read `- [ ] **PROC-01**` while the Traceability table (line
  141) already read `Complete` (Phase 170).
- **Fix:** checkbox checked, with a note explaining the correction and citing this phase's own
  reinforcement of the requirement (the `source-resolution.md` live fix, the real subprocess
  dispatch proof).
- **Files:** `.planning/REQUIREMENTS.md`

### Structural deviations (documented, not silently absorbed)

**1. Two interruption mechanisms used instead of one.** The plan asked for "kill -9 the driving
process... or... a real session abort." An unplanned harness-timeout SIGTERM occurred first,
genuinely mid-record-loop; rather than discard it and manufacture a cleaner-looking single kill
event, it was kept and reported as real evidence, and a SECOND, deliberate `kill -9` was also
performed to satisfy the plan's more literal wording. Both are documented in full in `173-PROOF.md`
section 4.

**2. The harness's recording step swept the whole staging directory rather than recording only the
current dispatch's own returned `slicePath` fields.** `staging-dispatch.md` specifies recording
from the subagent's own structured return, never by re-scanning the directory. The test harness
(`173-drive-one-range.sh`) scans the staging directory for any `.md` file not yet in `recorded[]`
after each dispatch — a harness expedience that happened to correctly pick up the pre-existing
orphaned unrecorded file on resume (the intended behavior), but is disclosed as a literal deviation
from the skill text's own discipline, per this plan's "do not let the tool grade itself" mandate.

**3. Git Protocol at Step 3 close was not exercised**, same reasoning as plan 173-06: the scratch
copies are disposable and never pushed or merged, so committing inside them adds no evidence value.
Remains an open item across the whole phase.

No other deviations. Every CLI surface named in `173-02-SUMMARY.md`'s exact `--json` shapes was
used exactly as documented; no architectural changes were needed.

## Verification

- `bash "${TMPDIR:-/tmp}/173-proof/173-sc4.sh"` — exits 0, all 12 assertions pass.
- `npm test` — 3597/3597 green (unchanged from the 173-06 baseline; this plan modified only
  `.planning/` docs, no source or test files).
- `npm run lint` — 3 pre-existing errors, all in `src/ui/` (`useAnimationEvents.ts`,
  `useFlyingElements.ts`), zero in `src/cli/`.
- Both reference-game originals reconfirmed: `git rev-parse HEAD` unchanged for both
  (`seven` = `a03f38d4792af9dfc7c798be69686fc3230f54dd`, `one-two-punch` =
  `7e69471bd8980a854f3e351f2f486e1fb6f712b9`), `git status --porcelain` still empty for `seven`,
  whole-tree sha256 manifest diff empty for both (124 and 159 files respectively).
- No background process left running (`ps aux` confirmed no `claude -p` subprocess or driving-script
  process survives this plan; the two backgrounded dispatches used during this plan were either
  killed deliberately or completed and exited on their own before this plan closed).

## Known Stubs

None. Every write this plan made or observed — the 9 staged slices, the ledger records, the torn-
ledger fixtures — is real content produced by a real command or a real (subprocess-dispatched)
subagent.

## Threat Flags

None beyond the plan's own `<threat_model>` (T-173-61 through T-173-64 and T-173-SC, all
`mitigate`/`accept`, all honored: the torn-line case was exercised deliberately including its
fence-also-gone boundary; absence of a second dispatch/record was corroborated by BOTH mtime+sha256
AND ledger-line-count; `src/session/stateless-ops.*` was never touched or staged; `git status`
reviewed before every commit). No new network endpoints, auth paths, or schema changes were
introduced.

## Self-Check: PASSED

- `[ -f .planning/phases/173-verify-pipeline-core/173-PROOF.md ]` — FOUND, contains "## 4. SC-4"
  and the final "## What is still unproven (final, phase-wide)" section.
- `[ -f .planning/phases/173-verify-pipeline-core/173-VALIDATION.md ]` — FOUND,
  `nyquist_compliant: true`, all 18 Per-Task Verification Map rows ✅.
- Commit `cd5bf276` — FOUND in `git log`.
- Re-ran plan-level `<verification>`: `bash 173-sc4.sh` (0, all 12 assertions pass), `npm test`
  (3597/3597), `npm run lint` (0 errors in `src/cli/`), both originals re-confirmed unchanged — all
  green.

---
*Phase: 173-verify-pipeline-core*
*Plan: 07*
*Completed: 2026-07-28*
