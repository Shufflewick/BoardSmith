---
gsd_state_version: 1.0
milestone: v4.9
milestone_name: BS Skills Re-Verification
status: executing
stopped_at: "Completed 177-13-PLAN.md — the sixth and final gap-closure plan (177-08..13), closing Phase 177 with an honest disposition. Measured the phase goal ('rule-bearing inferences get an independent second opinion') in its own unit rather than inferring it from the success criteria: 177-GOAL-MEASUREMENT.md computes, per rule-bearing Derived line across the 16 real dispatch candidates, whether it received a genuine independent second opinion about that line's own fact (a four-condition unit: enumeration, independence, targeting, recording), citing 177-PROOF-2.md throughout. Result: 6/16 (37.5%) — seven 2/10 (20%), one-two-punch 4/6 (67%). GOAL NOT MET. 10 of 16 fail on the targeting condition: 4 mechanically ambiguous (shared focus passage between seven:19/21 and seven:36/38), 6 off-target despite a uniquely-scoped focus window (seven:8/14/11/17, one-two-punch:52/49) — the new finding 177-12 surfaced, that a correctly and uniquely narrowed focus passage does not reliably steer the blind subagent's own derivation to the fact that passage supports. Applied 177-TARGETING-PREDICTION.md's own pre-committed failure rule (already fired in 177-12); introduced no new threshold. CHECK-04's REQUIREMENTS.md entry rewritten against 177-PROOF-2.md and 177-GOAL-MEASUREMENT.md: stays OPEN/PARTIAL — SC-2/SC-3 MET, SC-1 NOT MET, goal NOT MET, residual named as concrete next-attempt work (require the blind subagent to cite which sentence(s) it derived from, or resolve the 4 mechanically-ambiguous shared-passage collisions). ROADMAP.md Phase 177's Result block rewritten with the final re-measured numbers including the regression (offTargetDisagreements 100% vs. the original run's 89%); the phase checkbox stays unchecked (goal unmet) though all 13 plans (7 original + 6 gap-closure) are now marked complete in the plan list. Findings ledger accounts for all 18 177-REVIEW.md findings: 17 fixed (CR-01..07, WR-01..06, WR-08..11), WR-07 (quoteLinesOnly deny-list-to-allow-list inversion) deliberately deferred, dated 2026-07-30, reason recorded. Both prediction files (177-PREDICTION.md, 177-TARGETING-PREDICTION.md) reconfirmed with empty git diff — no retrofitting anywhere in this 6-plan sequence. Full npm test 4033/4033 green (no source code touched — proof-only/documentation plan). This closes Phase 177 execution; CHECK-04 remains open for a future phase to resume with the residual named above. See .planning/phases/177-derived-line-re-derivation/177-13-SUMMARY.md and 177-GOAL-MEASUREMENT.md."
last_updated: "2026-07-31T05:00:00Z"
last_activity: 2026-07-30 -- Phase 177 gap-closure plan 13 executed (final plan of the phase; goal measured in its own unit at 6/16 = 37.5%, NOT MET; CHECK-04 left OPEN/PARTIAL on evidence; all 18 review findings accounted for, 17 fixed / 1 deliberately deferred)
progress:
  total_phases: 10
  completed_phases: 7
  total_plans: 60
  completed_plans: 60
  percent: 70
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-02)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** Phase 177 — Derived-Line Re-Derivation (CHECK-04) — EXECUTED, goal NOT MET; CHECK-04 left OPEN. Milestone's next executable phase is 178 (Worked-Example Tests, TBD plans) or completing Phase 170 (5/10).

## Current Position

Phase: 177 (Derived-Line Re-Derivation) — ALL 13 PLANS COMPLETE (7 original + 6 gap-closure). Phase
goal measured NOT MET in its own unit (6/16, 37.5%); CHECK-04 stays OPEN/PARTIAL in
`REQUIREMENTS.md`; the ROADMAP checkbox stays unchecked. Phase execution is finished — what
remains for CHECK-04 is future-phase work, not a plan within 177.

`177-13-PLAN.md` (2026-07-30) is the sixth and final gap-closure plan (177-08..13). Task 1 computed
the phase goal ("rule-bearing inferences get an independent second opinion") in its own unit —
`177-GOAL-MEASUREMENT.md`, per rule-bearing `Derived` line across the 16 real dispatch candidates,
applying the plan's own four-condition test (enumeration, independence, targeting, recording), every
number cited from `177-PROOF-2.md`, never recomputed by hand. **Result: 6/16 (37.5%) received a
genuine independent second opinion about that line's own fact** — `seven` 2/10 (20%),
`one-two-punch` 4/6 (67%). 10 of 16 fail on the targeting condition: 4 mechanically ambiguous
(`seven:19`/`21`, `seven:36`/`38` — shared, indistinguishable focus passages) and 6 off-target
despite a UNIQUELY-scoped focus window (`seven:8`/`14`/`11`/`17`, `one-two-punch:52`/`49` — the new
finding `177-12` surfaced: a correctly and uniquely narrowed passage does not reliably steer the
blind subagent's own derivation to the fact that passage supports). This applies
`177-TARGETING-PREDICTION.md`'s own pre-committed failure rule, which already fired in `177-12` —
no new threshold was introduced, and both `git diff` on `177-PREDICTION.md` and
`177-TARGETING-PREDICTION.md` remain empty, reconfirmed at the end of this final plan. States
SC-1/SC-2/SC-3 status separately from the goal status (2/3 criteria MET, goal NOT MET — unlike Phase
174's divergence pattern, here SC-1's own prior failure already signalled the same outcome the
goal's own unit now confirms and quantifies) and names the residual as concrete next-attempt work:
either force the blind subagent to cite the specific sentence(s) it derived from (making an
off-target derivation visible at the blind stage itself), or resolve the 4 mechanically-ambiguous
shared-passage collisions without reintroducing a leak risk. Task 2 rewrote CHECK-04's
`REQUIREMENTS.md` entry against `177-PROOF-2.md`/`177-GOAL-MEASUREMENT.md` (stays `[ ]` OPEN/PARTIAL,
citing the 37.5% figure and both proof runs), rewrote ROADMAP.md Phase 177's `**Result:**` block
with the final re-measured numbers (including the regression — `offTargetDisagreements` 100% this
run vs. 89% pre-fix), marked all 13 plans `[x]` in the phase's plan list while leaving the
top-level phase checkbox unchecked (goal unmet, following Phase 174's own precedent for an honest
per-phase disposition independent of plan-completion), and added a complete findings ledger to
`177-GOAL-MEASUREMENT.md` accounting for all 18 `177-REVIEW.md` findings — 17 fixed (CR-01 through
CR-07, WR-01 through WR-06, WR-08 through WR-11, each naming the closing plan and its empirical
negative-pin proof) and WR-07 (the `quoteLinesOnly` deny-list-to-allow-list inversion) deliberately
deferred, dated 2026-07-30 per `177-08-PLAN.md`'s own instruction, with the reason recorded (the
construction-site backstop from CR-01's fix mitigates the same leak risk an allow-list inversion
would also address; the inversion itself is real, unattempted future work). No source code was
modified by this plan — full `npm test`: 4033/4033 green, identical to the pre-plan baseline.
**Phase 177 execution is complete.** CHECK-04 remains open for a future phase to resume, carrying
forward the specific negative finding this 6-plan gap-closure sequence surfaces: blind re-derivation
of a specific inference from a shared or adjacent-topic passage is harder than the original design
assumed, and the next attempt should not re-try payload-construction fixes without first
establishing whether the failure is in subagent reading comprehension or a remaining
payload-construction defect. See
`.planning/phases/177-derived-line-re-derivation/177-13-SUMMARY.md` and
`.planning/phases/177-derived-line-re-derivation/177-GOAL-MEASUREMENT.md`.

---

`177-12-PLAN.md` (2026-07-30) is the fifth of six gap-closure plans (177-08..13): pre-registration
and the live re-proof. Task 1 committed `177-TARGETING-PREDICTION.md` (`f0b6a038`) ALONE, before
any dispatch — `git show --stat` for that commit lists only the one file — naming a concrete
FAILURE outcome (interpretation rule b: `offTargetDisagreements` remaining more than half of
`disagrees`, mirroring `177-PROOF.md`'s own 8-of-9 ratio, means the fix did not work) as
concretely as the success outcome, and predicting `targetingAmbiguousCount` exactly (4/16) via a
zero-dispatch mechanical dry-run of `derivePayloadSet` against both reference games' real live
slices. Task 2 ran 28 real `claude -p` dispatches (16 blind + 12 compare, `claude -p
"<prompt>" --allowedTools Read` OS subprocesses, never native Task/Agent dispatch) against fresh
`cp -R` copies, with every one of the 16 verdicts recorded by spawning the real, registered
`node dist/cli.js verify-derive-record ...` — never by importing `createDeriveVerdictRecord`/
`recordDeriveVerdict` into the driver's own process (closing exactly the CR-05 gap the prior
run's library-import approach left open). `verify-derive-recheck --json` for both scratch copies
reports zero `pending`. Independence greps (all 16 blind prompts, plus the new per-candidate own
slice-path/own-line-number check) found zero real coordinate leaks. **Task 3 closed the proof with
the measured result reported exactly as the pre-registered interpretation rule committed to
reporting it: THE TARGETING FIX DID NOT WORK.** `offTargetDisagreements` is 8 of 8 `disagrees`
verdicts this run (100%) — worse than `177-PROOF.md`'s own pre-fix ratio (8 of 9, 89%) —
`genuineDisagreements` is 0/16, and the raw `disagrees` rate barely moved (50%, 8/16, vs. 56%,
9/16). `177-PROOF-2.md` names the new finding this run surfaces: a correctly and UNIQUELY narrowed
focus passage (`targetingAmbiguous: false`) does not reliably steer the blind subagent's own
derivation to the fact that passage supports — 6 of the 8 off-target disagreements occurred on
lines with a unique (non-ambiguous) focus window, so `focusQuoteWindow`'s payload-construction fix
is necessary but not sufficient; the remaining defect is in subagent judgment, not payload
construction. A real authoring defect discovered in the already-committed, immutable
`177-TARGETING-PREDICTION.md` (one-two-punch:95 named in two contradictory buckets;
`seven:11`/`seven:42` never individually predicted) is disclosed explicitly rather than corrected
in place or silently resolved. Both `~/BoardSmithGames` originals confirmed byte-identical
(whole-tree sha256, empty diff) before and after all 28 dispatches and 16 CLI writes; both still
at their pinned commits. No source code was modified by this plan — `npm test`: 4033/4033 green,
identical to the pre-plan baseline. No stray processes left running. **CHECK-04 stays OPEN/PARTIAL
in `REQUIREMENTS.md`** — this is 5 of 6 gap-closure plans; `177-13` (re-measure the phase goal,
dispose of CHECK-04, inheriting this plan's measured negative result and its new finding about
subagent judgment vs. payload construction) remains. See
`.planning/phases/177-derived-line-re-derivation/177-12-SUMMARY.md`.

---

`177-11-PLAN.md` (2026-07-30) is the fourth of six gap-closure plans (177-08..13), closing CR-07
from `177-REVIEW.md` and the phase's own self-reported goal failure from `177-PROOF.md` §3 — the
headline finding that `buildBlindDerivePayload`'s `Target line` identifier carried no information
the blind subagent could use to tell WHICH fact was under test in a multi-candidate slice, so the
measured 56% `disagrees` rate was dominated by targeting-collapse artifacts, not genuine
mismatches. `blindDeriveHandle(entry)` replaces the resolvable `Slice:`/`Target line:` pointer with
an opaque sha256-truncated digest — the ONLY target identifier a blind prompt now carries, closing
CR-07's leak vector (a subagent with file-read tools had a literal path and line number to follow
back to the withheld line). `focusQuoteWindow(sliceText, lineNumber)` narrows the payload to the
target's own citation passage, walking upward to the nearest `p.N, <label>:` header and treating
markdown HEADINGS as passage boundaries too, in addition to citation headers — the plan-checker's
required fix, proven against the real fixture
`174-FIXTURES/seven/live/01-definitions-and-components.md:33` (a `Derived` line severed from its
nearest citation header by an intervening `## Visual notes (p.1)` heading now gets an honest empty/
degraded focus window instead of silently attaching to the unrelated preceding "Play Testers"
passage). `derivePayloadSet` computes, mechanically, which candidates in a slice share an identical
non-empty focus passage (`targetingAmbiguous`/`sharedFocusWith`) — the irreducible residual that
cannot be resolved without leaking the withheld inference, reported per-finding rather than hidden.
`factAlignment` (`'same-fact'` | `'different-fact'`) is a required FIELD on `agrees`/`disagrees`
records — never a fifth `DERIVE_VERDICTS` member (decision 6 held, still exactly four).
`VerifyDeriveRecheckResult` gains `offTargetDisagreements`/`genuineDisagreements`/
`targetingAmbiguousCount`, additive to the unchanged four-key `verdictCounts` shape. Both subagent
contracts (`derive-recheck.md`, `derive-compare.md`) updated to the new payload shape and required
return by reference, plus a new drift guard one level deeper than 177-10's command-existence guard
(every field `derive-compare.md`'s RETURN object declares must have a matching `--option` on
`verify-derive-record`). **Three negative pins empirically proven to fail when reverted**: removing
the upward-walk markdown-heading check failed the fixture-keyed regression test with the real
observed wrong-passage output (`Play Testers` content instead of `[]`); reintroducing the
`Slice:`/`Target line:` pointer failed 2 tests asserting its absence; deleting the `factAlignment`
validation block failed 3 throw-expectation tests; all three reverts confirmed `git diff --stat`
clean before restoring. `npx vitest run src/cli/commands/verify-derive-recheck.test.ts`: 100/100
green (up from 77). `npx vitest run src/cli/slash-command/bs/verify.test.ts`: 100/100 green (up
from 93). **Full `npm test`** (mandatory, not a subdirectory subset): 4033/4033 green across 241
files (baseline 4003 + 30 net new, zero regressions). `npx tsc --noEmit` clean except the
pre-existing unrelated `docs/seed-to-state.test.ts` rootDir error. Task 1 and Task 2 were committed
together in a single commit (both touch the exact same 2-3 files and were interleaved by design —
`derivePayloadSet` calls `focusQuoteWindow` directly); Task 3 (the disjoint skill-text files) was
committed separately. **CHECK-04 stays OPEN/PARTIAL in `REQUIREMENTS.md`** — this is 4 of 6
gap-closure plans; `177-12` (re-run the live proof against a pre-registered prediction, measuring
whether this plan's fix actually reduces the targeting-collapse artifact rate) and `177-13`
(re-measure the phase goal, dispose of CHECK-04) remain. See
`.planning/phases/177-derived-line-re-derivation/177-11-SUMMARY.md`.

---

`177-10-PLAN.md` (2026-07-30) is the third of six gap-closure plans (177-08..13), closing GAP 3's
headline blocker from `177-REVIEW.md`: CR-05 (CHECK-04 had no way to record a verdict end-to-end —
`cli.ts` registered only the read-only report) and CR-03 (verdicts joined by line number only, so
an edited line could silently inherit a stale verdict), plus WR-02, WR-03, WR-06, WR-08, and
WR-10. Task 1: `verifyDeriveRecheckCommand`'s join now requires `record.originalLine ===
entry.text` at the same `slicePath:lineNumber` location — a mismatch reports `pending` and is
named in a new `staleRecords` array, never inherits a verdict for text that changed (CR-03).
`orphanedRecords` surfaces every ledger record matching no current candidate location (WR-03).
Extracted `formatReading()` so a `disagrees` finding's missing reading never interpolates the
literal `undefined` (WR-06) — discovered while testing that 177-09's CR-02 fix had already made
the WR-06 scenario unreachable end-to-end, proved directly rather than assumed. Deleted the
redundant `fs.access` pre-check; `readLiveSlices` is now the sole "no rulebook/" throw site,
distinguishing `ENOENT` from a real unreadable-directory condition via a real EACCES fixture
(WR-02/WR-10). Task 2: added `verifyDeriveRecordCommand` / `boardsmith verify-derive-record` —
CHECK-04's ONLY write surface, registered in `cli.ts` immediately after `verify-derive-recheck`
with no `--run-id` (decision 14) and no `--force`/`--skip`/`--overwrite`/env-var bypass of any
kind, delegating all verdict validation to `createDeriveVerdictRecord` and persisting through
177-09's upsert-append `recordDeriveVerdict`. Proved end-to-end with a REAL BUILT CLI (`node
dist/cli.js`, not the test harness): two successive `verify-derive-record` calls for different
lines both survived and were reported by `verify-derive-recheck --json`. Task 3: `verify-game.md`
Step 7's recording sentence now names `boardsmith verify-derive-record` (one call per line, atomic
upsert-append), replacing the `recordDeriveVerdicts` prose that named no callable CLI entry point.
`derive-recheck.md`'s "Your inputs" now attributes the stripping to `buildBlindDerivePayload`,
never the orchestrator, and adds `Named-but-undefined` to the never-given list (WR-08). Added a
drift guard to `verify.test.ts` reading `cli.ts`'s real registered commands and cross-checking
every `verify-*` command named in `verify-game.md`/`bs/verify/*.md` against that live set — the
guard that makes CR-05's own failure mode (skill text naming a non-existent entry point) hard to
reintroduce silently. Swept both modified files for other stale claims beyond the two named in
advance; none found. **Both negative pins were empirically proven to fail when reverted**, using a
scratch-directory backup rather than `git stash`: reverting the CR-03 join predicate to
location-only failed the new pinned test with the real observed `expected 'agrees' to be
'pending'` output; deleting the `verify-derive-record` registration from `cli.ts` failed the drift
guard with the real observed `Array [ "verify-game.md: verify-derive-record" ]` output; both
reverts confirmed `git diff --stat` clean before restoring. `npx vitest run
src/cli/commands/verify-derive-recheck.test.ts`: 77/77 green (up from 64). `npx vitest run
src/cli/slash-command/bs/verify.test.ts`: 93/93 green. **Full `npm test`** (mandatory, not a
subdirectory subset): 4003/4003 green across 241 files (baseline 3987 + 16 net new, zero
regressions). `npx tsc --noEmit` clean except the pre-existing unrelated
`docs/seed-to-state.test.ts` rootDir error. A real built-CLI `--help` invocation confirmed no
`--run-id` and no bypass flag on `verify-derive-record`. One documented acceptance-criteria grep
deviation (not a code defect): the literal `createDeriveVerdictRecord|recordDeriveVerdict outside
verify-derive-recheck.{ts,test.ts}` grep returns zero because `cli.ts` registers the
`verifyDeriveRecordCommand` wrapper (matching every sibling write command's convention), not the
lower-level functions by name — the underlying CR-05 condition is genuinely closed, proved by the
real end-to-end CLI invocation instead. **CHECK-04 stays OPEN/PARTIAL in `REQUIREMENTS.md`** —
this is 3 of 6 gap-closure plans; `177-11` (CR-07, the blind-derivation payload still hands the
subagent a resolvable `slicePath:lineNumber` pointer) through `177-13` (re-measure the phase goal,
dispose of CHECK-04) remain. See
`.planning/phases/177-derived-line-re-derivation/177-10-SUMMARY.md`.

---

`177-09-PLAN.md` (2026-07-30) is the second of six gap-closure plans (177-08..13), closing GAP 3's
ledger-integrity findings from `177-REVIEW.md` — deliberately sequenced BEFORE `177-10` exposes a
write command on the ledger, so the write surface is never built on a destructive or unvalidated
API. Closed CR-04 (ledger fence injection): `recordDeriveVerdicts` wrote `JSON.stringify(record)`
between literal HTML-comment fences, and `JSON.stringify` does not escape `<`, so a subagent-
authored `reasoning` string (fully model-controlled free prose) containing the ledger's own END
fence would corrupt the ledger permanently — `createDeriveVerdictRecord` now throws on any
`reasoning`/`originalReading`/`rederivedReading` carrying either fence marker, naming the offending
field. Closed CR-02 (`readDeriveVerdicts` bypassing the single validation choke point): it
previously did `JSON.parse(l) as DeriveVerdictRecord` with zero validation, so a hand-edited or
out-of-enum ledger record reached the report unvalidated and corrupted `verdictCounts` with a
`NaN`/`null` key — every parsed line now re-enters `createDeriveVerdictRecord`, so a malformed-JSON
line throws one actionable message naming the ledger's relative path and 1-based record index
(never a raw `SyntaxError`), and an out-of-enum verdict throws through the choke point instead of
reaching `--json` (zero `as DeriveVerdictRecord` casts remain, grep-gated). Closed CR-06
(`recordDeriveVerdicts` replacing the whole ledger on every call, while `verify-game.md` Step 7
prescribes per-line recording — the documented pattern silently destroyed every prior verdict):
renamed to `replaceDeriveVerdicts` (kept exported as the explicit, documented full-rewrite path)
and added `recordDeriveVerdict(projectDir, record)` (singular) — reads the existing ledger, upserts
by `slicePath:lineNumber` (existing order preserved, updated record appended last), writes the
merged set through `replaceDeriveVerdicts` — still exactly one durable write path in the module
(zero `writeFile(` call sites outside `atomicWriteFile`, grep-gated). Also closed WR-05 (an
`agrees`/`disagrees` verdict could be recorded citing zero source quotes — `sourceQuotes` now
required non-empty for those two verdicts, `underivable` may still cite none) and WR-04 (the blind
stage's `underivable`/`not-rule-bearing` pass-through was prompt-only with no code cross-check —
`rederivedValue`, the blind stage's own return, is now a required input persisted on
`DeriveVerdictRecord`, and a compare verdict contradicting it throws naming both labels).
**All three negative pins were empirically proven to fail when reverted**, using a scratch-directory
backup rather than `git stash` (forbidden inside this working tree per the destructive-git
prohibition): deleting the CR-04 fence-rejection block failed 3 tests; reverting `readDeriveVerdicts`
to the pre-fix cast failed 4 tests and independently reproduced the reviewer's exact
`verdictCounts: { "TOTALLY-BOGUS": NaN, ... }` output from `177-REVIEW.md`; making
`recordDeriveVerdict` call `replaceDeriveVerdicts([record])` directly (the pre-fix destructive
shape) failed the two-different-locations test with `expected length 2 but got 1`; all three
reverts confirmed `git diff --stat` clean before restoring. All three tasks were authored in a
single pass then reconstructed into 3 task-scoped commits from git blob content, each intermediate
state independently `tsc --noEmit`-clean and `vitest run`-green (55/55 after Task 1, 61/61 after
Task 2, 64/64 after Task 3) before being committed. `npx vitest run
src/cli/commands/verify-derive-recheck.test.ts`: 64/64 green (up from 44, +20 net new tests).
**Full `npm test`** (mandatory per the orchestrator's explicit instruction, not a subdirectory
subset — 177-08's own subdirectory-only run had shipped a real regression the orchestrator later
caught and fixed in `9ebc38bb`): 3987/3987 green across 241 files (baseline 3967, zero
regressions). `npx tsc --noEmit` clean except the pre-existing unrelated
`docs/seed-to-state.test.ts` rootDir error. **CHECK-04 stays OPEN/PARTIAL in `REQUIREMENTS.md`** —
this is 2 of 6 gap-closure plans; `177-10` (the missing `verify-derive-record` CLI write surface
per CR-05, `originalLine`-aware join per CR-03, orphan/staleness reporting per WR-03,
printer/error-path fixes) through `177-13` (re-measure the phase goal, dispose of CHECK-04) remain.
See `.planning/phases/177-derived-line-re-derivation/177-09-SUMMARY.md`.

---

`177-08-PLAN.md` (2026-07-30) is the first of six gap-closure plans (177-08..13) responding to
`177-VERIFICATION.md` (3/6 must-haves) and `177-REVIEW.md` (7 critical + 11 warning findings, both
produced against the closed-partial 177-07 state). Closed GAP 2/CR-01: the code reviewer proved by
direct execution that `DERIVED_LINE_RE`/`VISUAL_LINE_RE`/`NAMED_BUT_UNDEFINED_LINE_RE` were
`^`-anchored on trimmed text only, so a blockquote (`> Derived (p.1): ...`) or list (`-`, `1.`)
decorated line both leaked into the blind payload AND silently dropped from enumeration — proven
against the real committed corpus (`174-FIXTURES/seven/live/01-overview-setup-and-play.md:30`
already carries exactly this decoration shape on a `Variant` line). Added `annotationBody()` as the
single decoration-normalization site both `quoteLinesOnly` and `enumerateDerivedLines` route
through, so the two functions can never diverge on what counts as decoration — mirroring
`createDeriveVerdictRecord`'s single-choke-point shape. Per the verifier's bar ("structural, not
merely wider"), also added a construction-site backstop: `buildBlindDerivePayload` now throws on
any assembled payload still matching an annotation family, independent of which prefix regex
missed it — proven by a pinned test constructing exactly the case the prefix regexes cannot
anticipate (a directly-quoted sentence whose own prose mentions "Derived (p." mid-sentence).
Widened all three regexes to accept any citation body (`\(p\.[^)]*\)`, WR-01) and extracted the
shared `DERIVED_LINE_RE` into a new dependency-free leaf module (`derived-line-pattern.ts`) so
`ingest-archive.ts`'s relabeller consumes the same definition rather than a second literal — a
direct import from `verify-derive-recheck.ts` would have closed a real circular import
(`ingest-archive` → `verify-derive-recheck` → `verify-classify` → `chunk-provenance` →
`ingest-archive`), observed live as `TypeError: Cannot read properties of undefined (reading
'source')` before the leaf-module fix. **Both new negative pins were empirically proven to fail
when reverted** (the pattern 175-05/176-04 established): reintroducing the pre-fix `^`-anchored
`annotationBody` failed 6 tests with real recorded output; separately deleting the backstop failed
the pinned backstop-throw test with `expected [Function] to throw an error`; both reverts confirmed
`git diff --stat` clean before proceeding. Also replaced the four tautological
`readFileSync`-and-grep "module source guarantees" tests (WR-11) with behavioral assertions run
against real temp-project decoy trees (including a populated `rulebook/.verify/<run-id>/slices/`
tree the module must never read). Also closed WR-09: the optional parenthetical-qualifier group in
`PRESENTATION_EXCLUSION_MARKERS` is now applied symmetrically to the `Visual` marker (previously
only on the two `Derived` markers) and widened from `[^)]+` to `[^:]*` (nesting-tolerant), pinned
together with the 4 real decision-13 `one-two-punch` lines so neither fix regresses the other.
`npm test` (`src/cli/commands/`): 635/635 green; `npx tsc --noEmit` clean except the pre-existing
unrelated `docs/seed-to-state.test.ts` rootDir error. WR-07 (inverting `quoteLinesOnly`'s deny-list
to an allow-list) is deliberately deferred, per plan instructions — NOT implemented here. **CHECK-04
stays OPEN/PARTIAL in `REQUIREMENTS.md`** — this is 1 of 6 gap-closure plans; `177-09` (ledger
integrity, CR-02/CR-04/CR-06/WR-04/WR-05) through `177-13` (re-measure the phase goal, dispose of
CHECK-04) remain. See `.planning/phases/177-derived-line-re-derivation/177-08-SUMMARY.md`.

---

`177-06-PLAN.md` (2026-07-30) committed `177-PREDICTION.md` — a per-line, pre-dispatch verdict
prediction for all 22 real `Derived` lines (10 `seven`, 12 `one-two-punch`), each quoted verbatim
with slice path/line number and a one-sentence reason grounded in that slice's actual quoted
content — in its own commit (`913bfe7d`), before any dispatch, CLI enumeration, or proof-staging
work. Three interpretation rules are fixed in advance: (a) a large `underivable` share is a real
finding about the ingest contract, never tuned away; (b) a uniform result in either direction
proves consistency, not discrimination (176's 60/60 precedent); (c) zero `not-rule-bearing`
verdicts would be suspicious given known art/layout-only lines. Predicted totals: 9 `agrees`, 9
`not-rule-bearing`, 3 `underivable` (~14%), 1 `disagrees` — landing deliberately under the plan's
own 20% "looks unsampled" warning threshold, defended explicitly rather than hedged upward. The
prediction explicitly diverges from `177-RESEARCH.md`'s own underivability hedge on two lines after
closer per-line reading: `seven`'s "112 cards" deck-math line is predicted `agrees` (the quoted
Distribution-of-Cards sentence directly gives 1-7/4 colors/4 copies/7 bonus, not dependent on the
diagram line research assumed was its sole support), and `one-two-punch`'s "two Rest cards" line is
predicted `agrees` (the quoted Tip's word "both" is itself sufficient). Task 2 then staged
`177-PROOF.md` §1 (commit `d8b88198`) with real commands against `cp -R` copies only: preflight
confirmed both pinned commits unchanged (`one-two-punch`'s pre-existing `.boardsmith/` deletions
named as the documented Phase 173 exception), whole-tree sha256 baselines captured before any copy
(3919/4134 files, matching `173-PROOF.md`/`176-PROOF.md`'s own counts exactly) and re-verified
byte-identical after the entire task; real `npx boardsmith claude --local --force` install into
each copy, asserted by a direct filesystem check (not console-output trust) confirming both
`derive-recheck.md` and `derive-compare.md` land under `bs-shared/verify/`; the dispatch mechanism
stated in advance (`claude -p` OS subprocess — this session exposes no native Task/Agent tool, per
`173-PROOF.md` §6's precedent, every real dispatch in Phases 173-176 used a subprocess); real
`boardsmith verify-derive-recheck --project <copy> --json` enumeration output pasted for both
games. **Surfaced and reconciled a real finding rather than silently absorbing it**:
`177-RESEARCH.md`'s regex-gap measurement (the basis for decision 13) was made BEFORE that gap was
actually fixed — the fix had already landed via this phase's own `177-02`/`177-04` commits
(`06a4fe44`/`8a8f86ad`) — so the real enumeration now mechanically excludes 6 of `one-two-punch`'s
12 `Derived` lines before dispatch, not the 2 the pre-fix research measurement implied. This means
16 of the 22 lines (10 `seven` + 6 `one-two-punch`), not 20, are real dispatch candidates once
re-derivation runs — recorded explicitly in `177-PROOF.md`'s Reconciliation subsection. The
already-committed `177-PREDICTION.md` was deliberately NOT edited to reflect this (that would defeat
the whole prediction-before-measurement discipline); its committed 22-line total and `underivable`
share are unaffected since none of the 4 newly-excluded lines were predicted `underivable`. No
dispatch, prompt, or verdict distribution appears anywhere in either committed file — every returned
finding in the real enumeration carries `"verdict": "pending"`. `npm test`: 3954/3954 green, zero
regressions. **CHECK-04 stays OPEN in `REQUIREMENTS.md`** — this plan is 6 of 7; the live `claude
-p` dispatch proof measuring the real distribution against this committed prediction (177-07)
remains. See `.planning/phases/177-derived-line-re-derivation/177-06-SUMMARY.md`.

---

`177-05-PLAN.md` (2026-07-30) wired CHECK-04 into `/bs-verify-game` as Step 7 (Derived-Line
Re-Check), renumbering Close from Step 7 to Step 8 with a full numeric renumber (every
cross-reference updated in lockstep: Step 0's "clean close (Step N, below)" pointer, the intro's
dispatch-target list, Reference Files). Step 7 states in Step 5's compressed "In short:" style:
the check is independent of staleness/repair and does not consume Step 4's staleness verdicts;
every `Derived` line surviving `isPresentationLine` exclusion is enumerated PROJECT-WIDE, never
scoped to stale chunks; each survivor is dispatched BLIND carrying `BS-DERIVE-V1` and that slice's
quote lines only, the payload built by `buildBlindDerivePayload` (`verify-derive-recheck.ts`),
never composed by the orchestrator; a SEPARATE dispatch carries `BS-DERIVE-COMPARE-V1`, the
original line, and the blind reading, returning one of the four `DERIVE_VERDICTS`; both are
recorded through `recordDeriveVerdicts`'s one atomic write, then reported by formatting
`boardsmith verify-derive-recheck --json`'s output — formatted, never computed, the same
discipline Close already holds; findings citing both derivations verbatim exit 0 and never gate
Close (decision 15). Added an explicit, pinned Context-Economics carve-out directly below the
original hard-rule sentence — preserved byte-identical, confirmed via `git diff` — distinguishing
the orchestrator's own transcript (still zero quote-rule/`Derived (p.`/`Visual (p.` lines,
unchanged) from CHECK-04's subagent dispatch prompts/returns (where `BS-DERIVE-V1`'s blind prompt
legitimately carries quote lines and `BS-DERIVE-COMPARE-V1`'s prompt/return legitimately carries a
`Derived (p.` line, decision 8), citing `174-PROOF.md` §3's `quotedPass1`/`quotedPass2` precedent
by name and naming the two SEPARATELY-checked observables explicitly (blind prompt: ZERO
`Derived (p.`/`Visual (p.`, no exception, stronger than the base rule; comparison prompt/return:
EXPECTED to carry a `Derived (p.` line). Full-file swept `verify-game.md` end to end and wrote
`177-SWEEP.md`: 12 claims (6 named in advance by `177-PATTERNS.md`/`177-RESEARCH.md`, 6 found by a
first-principles pass), disposed 6 `STILL TRUE (re-verified)`, 5 `REVISED`, 1 `CARVE-OUT ADDED`, 0
`UNRESOLVED`. The most consequential finding: Step 0's "clean close (Step N, below)"
cross-reference had drifted a SECOND time — the identical defect class 176-04 already found once
in this exact sentence (Step 5→7), now recurring a second time (Step 7→8) across a second phase
that inserted a step before Close — strong empirical evidence the full-file sweep discipline is
load-bearing, not a one-off caution. Also confirms Close's condition
(`verify-run-status`+`verify-classify-status` both complete) is deliberately UNCHANGED — CHECK-04
is report-only per decision 15, and adding its completion as a third gate was explicitly declined
and recorded as the sweep's most consequential negative result. Pastes a real grep for spelled-out
(`four` through `ten`) and digit step/reference-file counts across `verify-game.md` — all empty,
extending coverage beyond the existing `verify.test.ts` guard's `five`-through-`nine` regex.
`verify.test.ts`: moved the "naming Close" pin to Step 8, bumped the pre-existing structural
step-count test from 8 to 9 steps and `CHECK-0[1-2]` to `CHECK-0[1-4]` (a deliberate structural pin
per its own comment, not a stale free-floating count), added a CHECK-04 routing describe block
(step heading, both handshake tokens, the `verify-derive-recheck` report command name, the
project-wide/never-gates-Close prose, Reference Files bullets) and a Context-Economics carve-out
describe block (verbatim original sentence, both separately-named observables, the
`quotedPass1`/`quotedPass2`/`174-PROOF.md` citation). One deviation worth flagging: the plan's own
`<action>` text attributed the blind-dispatch payload to "the `boardsmith verify-derive-recheck`"
CLI command; cross-checked against 177-03's real CLI surface (that command is a READ-ONLY REPORT,
`verifyDeriveRecheckCommand`, never a payload builder) and against `derive-recheck.md`'s own
accurate self-description, and corrected the attribution to `buildBlindDerivePayload`
(`verify-derive-recheck.ts`) before it ever landed in the file — avoiding introducing a fresh stale
claim in the very plan whose Task 3 exists to sweep for exactly that defect class. `npm test`:
3954/3954 green (baseline 3951 + 3 net new assertions across both tasks, zero regressions).
**CHECK-04 stays OPEN in `REQUIREMENTS.md`** — this plan is 5 of 7; the 22-line distribution
prediction committed before measuring (177-06) and the live `claude -p` dispatch proof against
both reference games (177-07) remain. See
`.planning/phases/177-derived-line-re-derivation/177-05-SUMMARY.md`.

---

`177-04-PLAN.md` (2026-07-30) wrote CHECK-04's two judgment-subagent contracts:
`src/cli/slash-command/bs/verify/derive-recheck.md` (`BS-DERIVE-V1`, blind derivation) and
`src/cli/slash-command/bs/verify/derive-compare.md` (`BS-DERIVE-COMPARE-V1`, comparison) — two
genuinely separate files with distinct handshake tokens and non-overlapping inputs, so the
"independent second opinion" 177-CONTEXT.md decision 5/7 requires is structural rather than an
instruction a composed prompt could silently drop. `derive-recheck.md` states, in one place, that
the subagent is NEVER given the `Derived` line it is re-deriving, any other `Derived` line, or any
`Visual` line — enforced structurally by `buildBlindDerivePayload` (177-02), which is incapable of
emitting the target line's own text, not merely instructed to withhold it. Teaches `not-rule-
bearing`/`underivable` via two real worked examples quoted byte-identical from
`174-FIXTURES/seven/live/` (an unqualified page-layout line; a deck-math line whose only support is
itself a stripped `Derived` diagram-description line), with no keyword/trigger-phrase list for
either — the same defect class `verify/ruling-recheck.md`'s absence-of-source trap already forbids.
RETURNs `{ rederivedValue, sourceQuotes }` with explicitly no verdict field: deciding agreement is
`derive-compare.md`'s separate job. `derive-compare.md` states all four `DERIVE_VERDICTS` verdicts
matching the code enum exactly, states the never-collapse rule for `underivable`/`not-rule-bearing`
explicitly, and requires `originalReading`/`rederivedReading` byte-for-byte verbatim for a
`disagrees` verdict (mirroring `classification-subagent.md`'s `quotedPass1`/`quotedPass2`
discipline), plus the Context-Economics carve-out sentence citing `174-PROOF.md` §3's precedent.
`SHARED_LEAF_PROBES` gained both files; a real installer run into a temp dir confirms both land
under `.claude/skills/bs-shared/verify/`, and deleting one proves a non-force reinstall detects the
partial tree and repopulates exactly the missing leaf. `verify.test.ts` gained a dedicated describe
block pinning both files' tokens (distinct, asserted directly — `derive-compare.md` contains zero
occurrences of `BS-DERIVE-V1`), the never-given list, a RETURN-object-shape pin scoped to the
fenced code block only (so `derive-recheck.md`'s own "NO verdict field" explanatory prose doesn't
self-invalidate the guard), a cross-file `DERIVE_VERDICTS` lexicon pin read from
`verify-derive-recheck.ts` at test time, fixture-verbatim worked-example pins, the never-collapse
rule, and both scope-limit sentences. `npm test`: 3946/3946 green (baseline 3931 + 15 new tests,
zero regressions); `npx tsc --noEmit` clean except the pre-existing permitted
`docs/seed-to-state.test.ts` rootDir error. **CHECK-04 stays OPEN in `REQUIREMENTS.md`** — this
plan is 4 of 7; `verify-game.md`'s skill-text wiring that actually dispatches these two contracts
and calls `recordDeriveVerdicts` (177-05), the 22-line distribution prediction committed before
measuring (177-06), and the live `claude -p` dispatch proof against both reference games (177-07)
remain. See `.planning/phases/177-derived-line-re-derivation/177-04-SUMMARY.md`.

---

`177-03-PLAN.md` (2026-07-30) gave CHECK-04 its CLI surface in the existing
`src/cli/commands/verify-derive-recheck.ts`: `recordDeriveVerdicts(projectDir, records)` /
`readDeriveVerdicts(projectDir)` write and round-trip a PROJECT-LEVEL ledger at
`rulebook/.derive-recheck/DERIVE-VERDICTS.md` — no `.verify/<runId>/` segment, no `runId`
parameter anywhere in either signature (177-CONTEXT.md decision 14), matching CHECK-03/CHECK-05's
(`trace-check.ts`/`drift-check.ts`) read-only, run-less shape exactly — through `atomicWriteFile`
only (a source-guard test proves zero direct `fs.writeFile`/`writeFileSync` calls anywhere in the
module). A before/after whole-project byte-hash test (the T-171-19 class, mirroring
`chunk-provenance.ts:706-714`) proves recording touches only `rulebook/.derive-recheck/`: a real
live slice and a decoy file at an archive-shaped path (`rulebook/source/rules.pdf`) both confirmed
byte-identical before and after. `verifyDeriveRecheckCommand({ project, json })` enumerates every
live-tree `Derived` line, joins each surviving candidate to whatever the ledger already holds, and
reports one `DeriveRecheckFinding` per candidate — `pending` when unrecorded, never a manufactured
default; `verdictCounts` always includes all four `DERIVE_VERDICTS` with zeros written explicitly;
a `disagrees` finding always carries both `originalReading`/`rederivedReading` verbatim (decision
8, guaranteed transitively by 177-02's `createDeriveVerdictRecord` validation); never sets
`process.exitCode` anywhere (findings exit 0, decision 15, pinned by a source-inspection test);
`--json` emits exactly one `console.log` call whose payload parses as JSON, confirmed by a purity
test. `boardsmith verify-derive-recheck` registered in `cli.ts` alongside `verify-ruling-recheck`/
`verify-repair`, with exactly `--project <dir>` and `--json` — confirmed via a real `--help`
invocation showing no `--run-id` and no bypass option. Both tasks committed atomically
(`3c43bb36` ledger, `b4318f46` report command + CLI registration), reconstructed as two
task-scoped commits from a single authored pass (Task 2's report command reads through Task 1's
`readDeriveVerdicts`). `npm test`: 3931/3931 green (baseline 3918 + 13 new tests, zero
regressions); `npx tsc --noEmit` clean except the pre-existing permitted
`docs/seed-to-state.test.ts` rootDir error. **CHECK-04 stays OPEN in `REQUIREMENTS.md`** — this
plan is 3 of 7; the two judgment-subagent contracts (177-04), `verify-game.md` skill-text wiring
(177-05), and the live `claude -p` dispatch proof (177-06/07) remain. See
`.planning/phases/177-derived-line-re-derivation/177-03-SUMMARY.md`.

`177-02-PLAN.md` (2026-07-30) built CHECK-04's mechanical core in a new
`src/cli/commands/verify-derive-recheck.ts`: `DERIVE_VERDICTS` — the frozen four-verdict enum
`agrees`/`disagrees`/`underivable`/`not-rule-bearing` (177-CONTEXT.md decision 6, `underivable`
and `not-rule-bearing` both first-class, never collapsed) — with `createDeriveVerdictRecord` as
the ONE choke point: throws on out-of-enum verdict, empty reasoning, and (decision 8's stricter
bar over Phase 176's plain-reasoning rule) a `disagrees` verdict missing either `originalReading`
or `rederivedReading` verbatim. `quoteLinesOnly` — the phase's one genuinely new engineering piece
with no prior structural analog — selects only directly-quoted rulebook content and citation
headers, excluding `Derived`/`Visual` lines entirely per the plan plus `Named-but-undefined`
lines (a Rule 2 deviation: 177-RESEARCH.md's own answer to Question 1 names it as ingest-time
inference that must also be kept out of a "quote lines only" payload). `buildBlindDerivePayload`
is the single `BS-DERIVE-V1` dispatch-prompt construction site — a corpus-wide COUNTING test (not
a truthiness check) proves zero `Derived (p.` and zero `Visual (p.` occurrences across all 22 real
`Derived` lines in both reference games' committed `174-FIXTURES/*/live` corpus (10 `seven` + 12
`one-two-punch`, matching Context's measured reality exactly). `enumerateDerivedLines` mirrors
`verify-ruling-recheck.ts`'s enumerate-and-report-never-silently-drop posture, splitting every
live-tree `Derived` line into `isPresentationLine`-excluded and surviving-candidate buckets, both
reported. `readLiveSlices` reads the live `rulebook/*.md` tree directly (excluding `INDEX.md`/
`00-visual-survey.md`), never the staged `.verify/<runId>/` tree (177-RESEARCH.md Pitfall 3) —
pinned by a comment-stripped source assertion (no `.verify` literal in code) and an import-line
check that `resolveFreshTranscription` is never imported. Both tasks committed atomically
(`944f133b` enum/choke-point, `1e3e749d` payload filter/enumeration), reconstructed as two
task-scoped commits from a single authored pass so per-task atomicity held even though Task 2's
filter references Task 1's `isPresentationLine` import. `npm test`: 3918/3918 green (baseline
3896 + 22 new tests, zero regressions); `npx tsc --noEmit` clean except the pre-existing permitted
`docs/seed-to-state.test.ts` rootDir error. **CHECK-04 stays OPEN in `REQUIREMENTS.md`** — this
plan is mechanics only (2 of 7); CLI registration/ledger (177-03), the two judgment contracts
(177-04), skill-text wiring (177-05), and the live `claude -p` dispatch proof (177-06/07) remain.
See `.planning/phases/177-derived-line-re-derivation/177-02-SUMMARY.md`.

`177-01-PLAN.md` (2026-07-30) fixed decision 13: `PRESENTATION_EXCLUSION_MARKERS` was stricter than
its own subagent contract stated, letting 4 real `one-two-punch` lines carrying a parenthetical
qualifier slip through unclassified. Widened the shared constant (not a 177-local fork), pinned by
the 4 real lines plus a negative over-exclusion guard, kept the cross-file lexicon pin honest, and
noted in `174-PROOF.md` (additive-only) why Phase 174's recorded results stand unaffected. See
`.planning/phases/177-derived-line-re-derivation/177-01-SUMMARY.md`.

Phase 176 (Stale-Chunk Repair) — COMPLETE, 6/6 plans executed. CHECK-01 and CHECK-02 both closed
in `REQUIREMENTS.md` with `176-PROOF.md` section-and-number citations.

`176-04-PLAN.md` (2026-07-30) swept `verify-game.md` for stale cross-file claims beyond the two
named in advance, added CHECK-01/CHECK-02's routing, and pinned the result with drift guards.
Full inventory (recorded in `176-04-SUMMARY.md`): fixed the two named boundary statements (line
15's "never edits a chunk's design" → narrowed to "does not scaffold a new chunk the BUILD
pipeline's way", since repair MAY change an existing chunk's code per decision 12; the "Performing
the repair itself is Phase 176's job" forward reference → repointed at the concrete new Step 6);
found a SECOND stale dimension inside the disposition-enumeration claim (it named only 3 of
`REPAIR_GATE_DISPOSITIONS`'s 4 values, `not-applicable` omitted — confirmed real, not a deliberate
exclusion, via `printImpactHumanReport`'s actual iteration over all four) and fixed it by citing
the source array instead of restating a list; found a THIRD stale claim never named in advance
(Step 0's "clean close (Step 5)" cross-reference, stale the instant Close renumbered to Step 7)
purely from reading the whole file. Verified lines 20-21's "no flag or path ... writes staged
output into a live location" sentence remains byte-identical. Added Step 5 (Ruling Re-Check,
CHECK-01, dispatching `verify/ruling-recheck.md`) and Step 6 (Repair Dispatch, CHECK-02,
dispatching `verify/repair-dispatch.md`); renumbered Close to Step 7; added both files to
Reference Files. Extended `verify.test.ts` with a no-fork guard reading its lens/repair-bound
marker phrases live from `build/audit.md`/`build/repair.md` (companion presence assertions against
those same files), a positive delegation-path pin, absence pins for both retired sentences, routing
pins for the new steps, a step-numbering contiguity check, and guards against any hardcoded
step/reference-file/disposition count reappearing; updated three PRE-EXISTING pinned tests
(six-step count → eight, "Step 5 naming Close" → Step 7, the rebuild-claim phrase) to match.
**Both negative-pin classes were empirically proven to fail**: a lens marker phrase was temporarily
pasted into `repair-dispatch.md` (observed the no-fork assertion fail with the real diff logged,
then reverted from backup); "It never edits a chunk's design" was temporarily reinserted into
`verify-game.md` (observed both the narrowed-claim pin and the absence pin fail, then reverted from
backup) — `git diff --stat` confirmed zero remaining change on both files after revert.
`verify/adjudication-gate.md`'s identical sibling defect (a three-of-four disposition enumeration
and a now-self-referential "Phase 176's job" label) was found but is OUTSIDE this plan's
`files_modified` scope — logged to
`.planning/phases/176-stale-chunk-repair/deferred-items.md` with a concrete fix recommendation,
not touched here. `npm test`: 3886/3886 green (baseline 3876 + 10 new assertions), zero
regressions. CHECK-01/CHECK-02 still NOT marked complete in `REQUIREMENTS.md` — their live-proof
closure is 176-05/06's job. See `.planning/phases/176-stale-chunk-repair/176-04-SUMMARY.md`.

`176-03-PLAN.md` (2026-07-30) wrote CHECK-01's and CHECK-02's skill text and made both reachable
from the real CLI surface. `verify/ruling-recheck.md`: a versioned-handshake
(`BS-RULING-RECHECK-V1`) judgment contract mirroring `classification-subagent.md`'s shape —
staged-only input (never live `rulebook/` slices), four verdicts
(`still-needed`/`resolved-by-source`/`contradicted`/`undetermined`) with mandatory reasoning, and
the absence-of-source trap worked through `seven`'s real Ruling 1 (a designer-supplied scoring
table for a card absent from the rulebook PDF, the game's sole scoring authority for it), naming
both plausible wrong answers and why each is catastrophic — no absence-phrase list, exactly as
176-01's code contains no heuristic. `verify/repair-dispatch.md`: delegates `build/audit.md`'s
three lens templates and `build/repair.md`'s bounded loop entirely BY REFERENCE
(`${CLAUDE_SKILL_DIR}/../bs-shared/build/{audit,repair}.md`), naming all five substitution tokens
and binding `{slicePaths}` to fresh staged paths (decision 9); states `## Interpretation` stays
forbidden to every lens and is MORE important on a rules-stale chunk (decision 11); states the
per-verify-episode round budget naming the four chunks already at 3 build-era rounds
(`best-seven-selection`/`table-and-draw`/`block`/`jab`, decision 17); states the post-repair gate
re-derivation / VERIFY-06 seam explicitly (decision 12). Grep-confirmed clean of the two lens
marker phrases 176-04's drift guard will pin and of a verbatim copy of `build/repair.md`'s
round-bound sentence as its own policy statement. Added `verifyRepairStatusCommand` to
`verify-repair.ts` (a Rule-2 deviation, documented in `176-03-SUMMARY.md` — 176-02 left no
orchestrating command to register) mirroring `verify-impact-status`'s read-only shape. Both
commands registered in `cli.ts` with `--project`/`--run-id`/`--json`, no bypass option;
`SHARED_LEAF_PROBES` gained both new files, a real scratch-dir install proves both ship under
`bs-shared/verify/`. `npm test`: 3876/3876 green (baseline 3875 + 1 new test); `npx tsc --noEmit`:
only the pre-existing permitted `docs/seed-to-state.test.ts` rootDir error. CHECK-01/CHECK-02
still NOT marked complete in `REQUIREMENTS.md` — `ROADMAP.md`'s plan breakdown assigns their
live-proof/routing closure to 176-04/05/06. See
`.planning/phases/176-stale-chunk-repair/176-03-SUMMARY.md`.

`176-02-PLAN.md` (2026-07-30) built CHECK-02's mechanical core in a new
`src/cli/commands/verify-repair.ts`: `selectStaleChunks` filters `ImpactMapEntry[]` to
`stale === true` only (decision 5); `resolveStagedSlicePaths` maps a stale chunk's `pairIds` to
the run's own `RUN.md` `ClassificationRecord.stagedSlices` — proven against the real committed
175 fixture (`174-07-contradictory/staged/{seven,one-two-punch}/`) where `seven`'s single `pairId`
genuinely resolves 3 live rule slices to exactly its 6 staged filenames (asserted against a live
`readdir`, not a hardcoded list); an unresolved `pairId` yields a scope-limited result naming it,
never a live `rulebook/` fallback (decision 9). `parseAuditRounds`/`planVerifyEpisodeRound`/
`resolveVerifyEpisodeNumber` give each verify pass its own fresh 3-round budget (decision 17),
proven against all three real `### Audit Round 3 (...)` heading precedents
(`table-and-draw`/`block`/`jab`): a 3-build-round chunk's first verify dispatch lands at absolute
round 4 / episode 1, round 1 — never routed to triage on arrival — and the 4th episode-round
request returns `triage` with no heading. `appendAuditRoundHeading`/`writeAppendedAuditRound` are
proven append-only (prefix byte-equality) and write exclusively through `atomicWriteFile`.
`recomputeRepairGatePostRepair` re-derives `computeRepairGate` from POST-repair drift state via
`drift-check.ts` — the sole code-movement authority — with a source-regex proof that its
parameter type carries neither `driftState` nor `gate` (Pitfall 1: the pre-repair snapshot is
structurally unpassable), proven with a real two-commit git fixture's clean→drifted flip
(`close-without-replaytest` → `reopen-playtest`). `npm test`: 3875/3875 green (baseline 3851 + 24
new tests, zero regressions); `npx tsc --noEmit`: only the pre-existing permitted
`docs/seed-to-state.test.ts` rootDir error. **CHECK-02 intentionally left OPEN in
`REQUIREMENTS.md`** — `ROADMAP.md`'s own plan breakdown assigns CHECK-02 to four plans (176-02
mechanics, 176-03 skill text, 176-04 routing/drift-guard proof, 176-06 live proof); this plan is
176-02 only. See `.planning/phases/176-stale-chunk-repair/176-02-SUMMARY.md`.

`176-01-PLAN.md` (2026-07-30) built CHECK-01's mechanical half (176-CONTEXT.md decision 2 — CLI
enumerates and records, a subagent judges). `parseRulings` (`build-manifest.ts`) was widened
ADDITIVELY with a `body: string` field per `ParsedRuling`, populated from the `body` local the
function already computes internally for its supersession scan — zero new regex, zero second
scan pass, and a grep-gate test proves exactly one `### Ruling (\d+)` heading regex declaration
exists under `src/cli/` (comments stripped before counting, so this very doc comment and
`verify-impact.ts`'s prose mention don't false-positive). New module
`src/cli/commands/verify-ruling-recheck.ts`: `RULING_VERDICTS` — the frozen four-value enum
`still-needed`/`resolved-by-source`/`contradicted`/`undetermined` (decision 1's first-class
`undetermined`, never collapsed) — with a pinning test; `enumerateRulingsForRecheck` skips a
superseded ruling in BOTH directions (proven against `seven`'s real
`⚠ RATIONALE SUPERSEDED BY RULING 9` marker sitting on Ruling 3's OWN entry) and reports — never
assumes — an unparseable supersede sentence, which still enumerates for re-check (decision 3);
`resolveFreshTranscription` reports `scopeLimited: true` (never throws, never falls back to a live
`rulebook/` slice) for a missing staged run, a malformed `--run-id`, or an empty staged-slices
directory — every path it can return is rooted at `stagingSlicesDir`'s dot-prefixed
`rulebook/.verify/` tree, structurally unable to collide with a bare live slice path (decisions 9,
10); `createRulingVerdictRecord` validates a subagent's returned verdict against the enum and
requires non-empty `reasoning` (decision 4 — the reasoning is the artifact, not just the label);
`verifyRulingRecheckCommand` reports one uncapped row per ruling plus a computed `verdictCounts`
map, proven read-only against `RULINGS.md` via a whole-directory sha256-equality test, and throws
a single actionable `--project`-naming line (no stack/`.ts:`/`src/` leak) when `RULINGS.md` is
missing; `recordRulingVerdicts` persists through `atomicWriteFile` only — a source-guard test
proves no hand-rolled `fs.writeFile`/`writeFileSync` exists in the module. A dedicated source
assertion proves the module contains NO absence-detection keyword list anywhere (176-RESEARCH.md
Pitfall 4) — recognizing `seven`'s Ruling 1 (a source-absence citation) as `still-needed` stays
entirely a subagent judgment call. `npm test`: 3851/3851 green (baseline 3826 + 25 new tests,
zero regressions); `npx tsc --noEmit`: only the pre-existing permitted `docs/seed-to-state.test.ts`
rootDir error. **CHECK-01 intentionally left OPEN in `REQUIREMENTS.md`** — `ROADMAP.md`'s own plan
breakdown assigns CHECK-01 to three plans (176-01 mechanics, 176-03 skill text, 176-04 live
proof/routing); marking it complete now would misrepresent a mechanics-only plan as a finished
requirement. See `.planning/phases/176-stale-chunk-repair/176-01-SUMMARY.md`.

---

Phase 175 (Impact Map & Repair Gating) is COMPLETE, all 8 plans executed, all 3 requirements
(VERIFY-04, VERIFY-05, VERIFY-06) CLOSED in `REQUIREMENTS.md` with `175-PROOF.md` section-and-number
citations.

`175-06-PLAN.md` (2026-07-30) added `/bs-check-status` item 9 — "Rules staleness and the repair
gate" — formatting `boardsmith verify-impact-status --json` (format-never-compute, mirroring item
8's `chunk-provenance-status` pattern): reports `staleFraction` as `"N of M chunks rules-stale"`,
lists every `staleSlugs` entry uncapped (decision 15), groups by `gate.disposition` consuming
`dispositionCounts`, and surfaces `contradictionsPending` naming `/bs-verify-game`'s adjudication
gate as where they are answered. Closes decision 19 — Phase 174's "revisit there, not here"
carry-forward. Full-file swept the eight-item count family (4 occurrences, 3 spellings including
the hyphenated-singular `eight-item` trap at line 104) to nine items, verified with a combined
`grep -ciE "eight[ -]items?"` returning 0. Pinned item 9 in `status-tools.test.ts` against the real
exported `RULES_STALE_MARKER`/`REPAIR_GATE_DISPOSITIONS` constants rather than re-typed strings,
added `## Rules Staleness Marker` to the cited-heading guard, and empirically proved the renamed
count pin regresses (reverting to "eight items" fails with the expected assertion message, then
reverted). `npm test`: 3825/3825 green (baseline 3817 + 8 new tests). VERIFY-05/VERIFY-06's
reporting surface is now complete; Phase 176 owns performing the actual repair. See
`.planning/phases/175-impact-map-repair-gating/175-06-SUMMARY.md`.

---

`175-05-PLAN.md` (2026-07-30) closed the skill-text half of VERIFY-04/05/06: created
`src/cli/slash-command/bs/verify/adjudication-gate.md`, modelling `build/ask.md`'s
"Gate-Before-Write" no-bypass discipline — present every pending contradiction at once (one
question per FINDING, never per affected chunk, decision 14), both readings verbatim, every
affected chunk slug uncapped (decision 15); no durable write until an explicit answer; two
terminal answers only (`resolved` appends a `RULINGS.md` entry, `UNADJUDICATED` never silently
cleans, decision 8); cites `state-machine.md`'s Write Order/Authority/Redteam Escalation/Rules
Staleness Marker sections rather than restating them. Deleted `verify-game.md` Step 3's now-false
final sentence ("flips no staleness marker anywhere and opens no repair loop (that is Phase 175's
job)") IN PLACE — the identical fix-class 174-05 applied to this same file for Phase 173's boundary
statements — and inserted `## Step 4: Adjudication Gate and Impact Map (VERIFY-04, VERIFY-05,
VERIFY-06)` dispatching to the new file, renumbering the existing Close step to Step 5 and updating
its one cross-reference. Also fixed all three collateral stale claims the plan named: the
step-count pin (5→6), the per-heading requirement-ID regex, and Step 0's "restate its four items" —
fixed by DROPPING the count (not incrementing to five) with a new pin rejecting ANY hardcoded count
re-appearing. Added the new file to `install-claude-command.ts`'s `SHARED_LEAF_PROBES` and verified
with a real local install into a scratch directory that it physically ships. Rewrote
`verify.test.ts`'s drift pins accordingly, and — per the plan's explicit requirement — PROVED the
negative pin actually fails: temporarily reintroduced the deleted sentence, ran the suite, observed
the `not.toContain('Phase 175')` assertion fail, then reverted. `npm test`: 3817/3817 green
(baseline 3811 + 6 new tests). VERIFY-04/05/06 are now mechanically complete AND wired into the
skill text a live session actually follows — Phase 176 owns performing the actual repair. See
`.planning/phases/175-impact-map-repair-gating/175-05-SUMMARY.md`.

---

`175-04-PLAN.md` (2026-07-30) built `computeRepairGate`: pure, total, checking `driftState ===
'unknown'` FIRST — before even the `stale` flag — so a caller can never be told "nothing to gate"
or "gate closes/reopens" about code movement `drift-check` couldn't resolve (never collapsed into
`clean`). Maps `clean` → keep `Status:` verbatim (including a `verified (user-waived)` waiver) +
re-verification stamp; `drifted` → `built` + playtest gate re-opens, NOT preserving a prior waiver
(decision 13 — a waiver is a one-time decision, never a standing exemption). `verifyImpactStatusCommand`
composes `verifyClassifyStatusCommand`/`driftCheckCommand`/`chunkProvenanceStatusCommand`/
`parseRulesStaleness`/`collectContradictions` into one `ImpactMapEntry` per chunk — never
re-deriving any of their facts — with an uncapped `staleFraction`/`staleSlugs` (decision 15) and
`attributions` carried verbatim from `ChunkVerdict` (decision 16, Phase 176's `--json` input
contract). `verifyImpactApplyCommand` is blocked ENTIRELY (zero writes, byte-identical project)
while any contradiction's adjudication is `'pending'`; a recorded `UNADJUDICATED` does NOT block
and still marks the chunk stale; each chunk's marker write lands before its `ImpactRecord` is
appended, so a crash never leaves a chunk falsely recorded, and a stale chunk with no
`chunks/<slug>/` directory is skipped, never written. All four `verify-impact-*` CLI commands are
now registered (matching the `verify-classify-*` shape, no bypass option anywhere) plus
`chunk-check --reverified-no-code-change`. 23 new tests, including an exhaustive
`computeRepairGate` table and a real git-repo + verify-run/verify-classify project fixture.
`npm test`: 3811/3811 green (baseline 3788). VERIFY-05/VERIFY-06 are now mechanically complete;
Phase 176 owns performing the actual repair and the `Status:`/marker flip `computeRepairGate`
describes. See `.planning/phases/175-impact-map-repair-gating/175-04-SUMMARY.md`.

---

`175-03-PLAN.md` (2026-07-30) built VERIFY-04's mechanical core: `collectContradictions` returns
one `Contradiction` per contradictory FINDING, never per affected chunk (decision 14 — a single
finding can touch 6+ chunks), joining each to its recorded `AdjudicationRecord` by `pairId` and
deriving `affectedSlugs` from `ChunkVerdict.pairIds` membership; a missing verbatim reading renders
as an explicit `(no verbatim reading recorded)` string, never dropped or synthesized.
`formatBothReadings` lists every affected chunk UNCAPPED (decision 15). `verifyImpactGateCommand`
is a read-only report composing `verifyClassifyStatusCommand` + the shared ledger-read authority —
never sets `process.exitCode`, proven read-only by a whole-project sha256-map equality test. On the
write side: `nextRulingNumber`/`renderRuling`/`appendRuling` are the FIRST machine write ever made
into `RULINGS.md`, numbering derived exclusively from the existing `parseRulings`
(`build-manifest.ts`) — no second `### Ruling (\d+)` regex exists anywhere (grep-asserted) — and
proven append-only via a byte-for-byte `startsWith` assertion against a real 26-entry corpus; no
supersession syntax is invented (decision 7). `verifyImpactAdjudicateCommand` requires non-empty
`decision`/`citation`/`rationale` for `outcome: 'resolved'` (a resolution is the human's words,
never the tool's) and writes NO RULINGS.md entry for `outcome: 'UNADJUDICATED'`, leaving the pair
pending for a later run (decision 8) — `RULINGS.md` is written before the ledger record so a crash
between them never orphans a resolution with no ruling behind it, and a second `resolved` call for
an already-resolved pair reuses the same ruling number (idempotent per pair). No bypass exists
anywhere in the module: no `force`/`skip`/`yes`/`assumeResolved`/`autoAdjudicate` option, no
`process.env` read (grep-asserted, decision 9). 19 new tests (7 Task 1, 12 Task 2) read the REAL
174-07 contradictory `ClassificationRecord` from the committed fixture `RUN.md` rather than a
synthetic one. `npm test`: 3788/3788 green (baseline 3769); `trace-check.test.ts` (35/35)
re-confirmed its existing `RULINGS.md` reader still parses the appended corpus. Neither command is
wired into `cli.ts`'s `program.command(...)` surface yet — that registration is later-plan scope.
VERIFY-04 is now mechanically implemented; the skill-text adjudication-gate wiring
(`verify/adjudication-gate.md`, `verify-game.md`'s Step 3 rewrite) is plan 175-05. See
`.planning/phases/175-impact-map-repair-gating/175-03-SUMMARY.md`.

---

`175-01-PLAN.md` (2026-07-30) built VERIFY-05's rules-staleness marker as a NEW, ORTHOGONAL,
machine-owned fenced field in CHUNK.md — never a new Status enum value (175-CONTEXT.md decision
1) — and registered it in the SAME change (decision 5): `verify-impact.ts` gained
`RULES_STALENESS_*` constants/renderer/strict-parser (mirroring `chunk-provenance.ts`'s
`## Verified Against` precedent, its own distinct fence pair) and `writeRulesStalenessMarker`
(CHUNK-first/SKETCH-second, `Marker:` last, CHUNK.md authority on contradiction, fence-refusal
throws without touching the file, and — via a type that structurally omits `marker` from its
input — no code path can write the `clear` value; only Phase 176's repair close will get that
verb). `state-machine.md` gained a "Rules Staleness Marker" section and a NEW Consistency Check
item 5 (item 3's Status-enum wording left byte-identical); both templates scaffold the marker.
`templates.test.ts` gained VERIFY-05 registration pins plus a dedicated decision-1 orthogonality
guard proving the Status enum's five enumerating/pinning sites did not move. 45 new tests (33 in
`verify-impact.test.ts`, 12 in `templates.test.ts`), `npm test`: 3751/3751 green (baseline 3706).
`npx tsc --noEmit` clean (the one remaining error, `docs/seed-to-state.test.ts`'s rootDir
mismatch, is pre-existing and confirmed present on `main` before this plan via `git stash`).
VERIFY-05 stays OPEN in `REQUIREMENTS.md` — this is plan 1 of 8 in Phase 175; the marker's
CLI-level `verify-impact-apply` wiring, the impact map, and the `verify-game.md` skill-text
integration are later plans (04/05) in this phase. See
`.planning/phases/175-impact-map-repair-gating/175-01-SUMMARY.md`.

---

Phase: 174 (verify-classifier) — **REOPENED, gap-closure plan 174-08 executed (8/8 plans) — phase
GOAL still NOT MET, reported honestly**
Next: Phase 175 (Impact Map & Repair Gating) — VERIFY-04/05/06, per `ROADMAP.md`. Phase 174 is not
marked `[x]` in `ROADMAP.md` (its own literal goal is unmet), but VERIFY-01/03/07 remain closed in
`REQUIREMENTS.md` (their own text is about verdict-production mechanics, proven) and are not
re-litigated by this gap-closure plan.

`174-08-PLAN.md` (2026-07-31) implemented `174-CONTEXT.md` decision 19 — attribution narrows from
"the live SLICE a chunk cites" (decision 18) to "the specific CITATION a chunk names" (its own
`## Interpretation` claim's quoted fragment or page reference), via a deterministic 3-rung ladder
(`quoted-fragment` > `cited-page` > `slice-fallback`, modelled on 172 decision 3). Both 174-04
guardrails (no false-clean; pair-level blindness checks outrank the ladder) are preserved and pinned
by dedicated tests (`decision-19-guard-1`/`-2`); all seven pre-existing chunk/decision-18 tests pass
UNMODIFIED. `ChunkVerdict` gained `attributions[]` so every clean chunk's cleanliness is nameable
from `--json` output. The citation-resolution rate was measured on real chunks BEFORE the narrowing
was trusted (`174-PROOF.md` §7): `quoted-fragment` is the dominant real rung on both games, with a
disclosed `slice-fallback` share (21.4% seven, 9.1% one-two-punch evaluations) — a real limitation,
not tuned away.

**Phase-goal re-measurement (`174-PROOF.md` §8), replaying the exact real dispatch returns (no new
LLM judgment) through the new code:** `seven` dropped from 87.5% to **37.5%** (14/16 → 6/16) citing
chunks stale; `one-two-punch` dropped from 100% to **54.5%** (11/11 → 6/11). Both real,
non-tuned, roughly-halved improvements — but **the phase goal's own bar is still NOT MET on either
game**: neither fraction is a small, explainable subset. Diagnosis (not a defect in the ladder): an
anchor-density property of these two short, tightly cross-referenced rulebooks — several chunks
independently quote the exact same central, changed rule because it is genuinely foundational to
what they build. No threshold was tuned in response. Both `~/BoardSmithGames` originals confirmed
byte-identical before/after this plan's whole session; determinism re-confirmed (two
`verify-classify-status --json` calls per game, byte-identical). `npm test`: 3706/3706 green (3691
baseline + 15 new `decision-19-*` tests). See
`.planning/phases/174-verify-classifier/174-08-SUMMARY.md`.

---

`174-07-PLAN.md` (superseded by 174-08 above for the phase-goal number; SC-3/VERIFY-01 findings below
remain accurate) closed the phase's prior wave. **SC-3** proven via a real archived-source mutation through the
REAL pipeline (not a hand-edited slice): `one-two-punch`'s image/vector `rules.pdf` (no text layer)
was mutated by rasterizing page 1 (`pdftoppm`), compositing a real Ghostscript-rendered patch that
reverses the Fight-phase timing precedence ("lower"→"higher" timing resolves first), and
reassembling with the untouched page 2 (`magick`) — no package installs, only tools already on the
machine. A real provenance baseline was established via the REAL `boardsmith chunk-check` command
before mutating, so the affected pair's provenance mechanically resolved to `source-changed`. Real
`verify-run-init` + real `claude -p` re-transcription dispatch against the mutated source + real
`BS-CLASSIFY-V1` classification dispatch landed **`contradictory`, `stale:true`,
`provenance:source-changed`** — both readings quoted verbatim. SC-4's independence corroborated via
cross-run comparison (no naturally-occurring `source-changed`+`cosmetic` pair existed in this
1-group-per-game run) plus `deriveStale`'s one-argument arity.

**VERIFY-01's per-chunk verdict** proven live on both real reference games (`chunkVerdicts[]` via
`verify-classify-status`), no-build confirmed by a whole-tree sha256 diff excluding
`rulebook/.verify/`.

**Added and ran the phase's missing chunk-level staleness measurement — the phase goal's own unit —
and it does NOT MEET the goal, reported honestly rather than smoothed over:** `one-two-punch` marks
11/11 (100%) of citing chunks stale from this plan's one real `contradictory` finding; `seven` marks
14/16 (87.5%) stale from its one real `sharper` finding (174-06). Diagnosis: live-slice granularity
is too coarse for these two short (2-3 live-slice) reference games — decision 18's per-quote
narrowing IS working correctly (it carved out a real 2-chunk exemption on `seven` a naive
group-level rollup would not have), but most chunks in a short rulebook cross-cite the same few
slices, so a delta anywhere in one still reaches most/all of them. This is NOT an SC-1..SC-5 failure
(all measured PASS) — it is an open risk carried forward explicitly for Phase 175/176 to weigh
(they own repair scoping / VERIFY-06), not fixed or tuned away here.

`VERIFY-01`, `VERIFY-03`, `VERIFY-07` all closed `[x]` in `REQUIREMENTS.md` with section-and-number
citations. `174-VALIDATION.md` signed off (`nyquist_compliant: true`, `status: complete`).
`ROADMAP.md` Phase 174 marked complete (7/7) with a `**Result:**` paragraph naming every measured
number and the chunk-staleness finding. `174-PROOF.md` gained `## What is still unproven` (10 items)
and `## How to re-run every proof`. Both `~/BoardSmithGames` originals confirmed byte-identical
before/after. `npm test`: 3691/3691 green. See
`.planning/phases/174-verify-classifier/174-07-SUMMARY.md`.

`174-06-PLAN.md` ran the phase's live proof. The SC-2 bar was declared in its own commit
(`fc030f17`) before any verdict existed, then a real classification pass was run against both
reference games' reconstituted pass-1-vs-pass-2 material (all 23 restored bytes re-verified
against `174-FIXTURES/MANIFEST.md`): a real `BS-CLASSIFY-V1` dispatch per game returned `seven` →
`sharper` (bonus-point-card scoring value: undefined in pass 1, `+1` in pass 2) and
`one-two-punch` → `cosmetic`. Measured against decision 14b's amended line-level bar: **90.9%
cosmetic (10/11 pooled rule-bearing line-level findings), 0 contradictory — PASS.** VERIFY-07's
transcript observable was grepped across dispatch prompts (zero matches), raw subagent returns
(matches accounted for via the `quotedPass1`/`quotedPass2` exception, with one honest exception
found in a free-prose `evidence` field), and the orchestrator's own transcript (1 match, inside a
recording-step `--quoted-pass2` argument forwarding the subagent's own field). A determinism
double-run (fresh independent dispatches, both games) produced identical
`(pairId, ruleDelta, stale)` triples both times. All 7 hand-built lexicon regression pairs matched
`EXPECTED.md` (7/7), including the schema-asymmetry trap. Both `~/BoardSmithGames` originals
confirmed byte-identical before/after. VERIFY-01/VERIFY-03/VERIFY-07 remain open in
`REQUIREMENTS.md` — 174-07 owns SC-3 and the official closeout. See
`.planning/phases/174-verify-classifier/174-06-SUMMARY.md`.

`174-05-PLAN.md` wrote the judgment half as skill text:
`src/cli/slash-command/bs/verify/classification-subagent.md` (the `BS-CLASSIFY-V1` handshake, the
dual-schema presentation exclusion rule with a real byte-identical worked example quoted from
`one-two-punch`'s live fixture, the consequence-vs-wording decision procedure with two worked
examples per label, line-level MAX-severity rollup, and the enumerated RETURN shape) and
`verify/classification-dispatch.md` (`verify-game.md` Step 3's delegate — pair enumeration via
`verify-classify-pairs`, ledger-only resume via `verify-classify-status`, per-pair
`BS-CLASSIFY-V1` dispatch, verdict recording via `verify-classify-record`, close). Rewrote
`verify-game.md`'s Phase 173 "there is no classification / the pass ends here" boundary
statements IN PLACE (deleted, not appended around) and added `## Step 3: Classification`,
renumbering Close to Step 4 for contiguous 0-1-2-3-4 step numbering. Added
`classification-subagent.md` to the installer's `SHARED_LEAF_PROBES`. Wrote 7 hand-built lexicon
regression pairs under `174-FIXTURES/lexicon/` (2 cosmetic + a dedicated schema-asymmetry trap
case, 2 sharper, 2 contradictory), each with an `EXPECTED.md`. Rewrote `verify.test.ts`'s Decision
16 boundary pins to match the post-174 state: classification vocabulary now required where it
belongs, an SC-4 gate forbidding staleness-derivation prose across every verify file, and a
cross-file `PRESENTATION_EXCLUSION_MARKERS` lexicon pin against `verify-classify.ts`. Two
verbatim substring collisions with existing drift guards found and fixed along the way (documented
in 174-05-SUMMARY.md). `npm test`: 3691/3691 (baseline 3678). VERIFY-01/VERIFY-03/VERIFY-07 remain
open — this plan proves the skill text EXISTS, not that a live session follows it; that live proof
is 174-06/174-07's job. See `.planning/phases/174-verify-classifier/174-05-SUMMARY.md`.

`174-04-PLAN.md` shipped the three run-scoped commands that make classification recordable and
resumable — `verify-classify-pairs`/`-record`/`-status` — registered in the real `cli.ts` beside
`verify-run-status`. `verifyClassifyPairsCommand` reads the ledger's recorded staged units (never a
directory scan) and the live `rulebook/*.md` tree (excluding `INDEX.md` and the presentation-by-
design `00-visual-survey.md`, matching `ingest-archive.ts`'s existing exclusion), pairs them via
`pairSlices()`, and resolves provenance per group as a sibling map. `verifyClassifyRecordCommand`
appends exactly one classification line through the same atomic ledger path 173-08 hardened; `stale`
and `provenance` are derived, never CLI options; an out-of-enum/missing `--label` normalizes to
`unclassified` with a warning (decision 8); `sharper`/`contradictory` require both
`--quoted-pass1`/`--quoted-pass2` non-empty (decision 9), demoting to `unclassified` otherwise.

**Applied CONTEXT.md decision 18** (added after this plan was authored, superseding its own
original Task 3 text): chunk staleness is derived from a classification record's `quotedPass1`
matched against the specific live slice(s) a chunk cites, never from the pair/group verdict
wholesale — because real reference games measurably pair into exactly ONE group each
(174-03-SUMMARY.md's corrective follow-up), so a group-verdict-keyed chunk roll-up would mark
every chunk stale from one `sharper` line anywhere in the rulebook, precisely the failure this
phase exists to prevent. `ClassificationRecord` (174-02) was widened with optional
`quotedPass1`/`quotedPass2` fields to make this retention load-bearing. A dedicated regression test
proves two chunks citing the SAME pair group land on DIFFERENT verdicts when the delta's quote
intersects only one chunk's cited content. 30 new tests, `npm test` 3676/3676 green (baseline 3648),
typecheck clean. VERIFY-01/VERIFY-03/VERIFY-07 remain open — plans 174-05/06/07 build the
skill-text/subagent-dispatch integration that makes these commands reachable from
`/bs-verify-game`. See `.planning/phases/174-verify-classifier/174-04-SUMMARY.md`.

`174-03-PLAN.md` built the mechanical classifier core as pure functions in
`src/cli/commands/verify-classify.ts`, colocated with `verify-classify.test.ts`. Three frozen
enumerated constants (`PROVENANCE_KINDS`, `RULE_DELTA_KINDS`, `PRESENTATION_EXCLUSION_MARKERS`),
each test-pinned. `isPresentationLine()`/`ruleBearingLines()` exclude BOTH the post-170
`Visual (p.N):` form and the legacy `Derived (p.N) — diagram description:`/`— art:` forms
(decision 12b) — verified exactly against the real `one-two-punch` live slices in
`174-FIXTURES/`, where `ruleBearingLines()`'s output length matches (total content lines − citation
headers − legacy-qualified lines) precisely for both real rule slices. `deriveStale()` is a
single-parameter function (SC-4 pinned: `deriveStale.length === 1`, `PROVENANCE_KINDS` absent from
its source region). `livePageSpan()` derives a live slice's page span from its own `p.N,` citation
lines only — never `INDEX.md`, verified on `one-two-punch` (no Slices table at all). `pairSlices()`
unions live/staged spans via union-find over page overlap into m:n groups — proven against the real
`seven` fixture (3 live rule slices + 6 staged units, all under the archived ledger's single
`rangeId: "1-2"`) producing exactly one `paired` group holding all 9 files, the real 6-vs-3
asymmetry both `174-01-SUMMARY.md` and `174-RESEARCH.md` measured, handled as normal rather than a
finding; a one-sided group is `unpaired-slice` naming the missing side, an all-zero-rule-bearing
group is `presentation-only` — nothing silently dropped; `pairId` proven stable across shuffled
input order. `resolveProvenance()` composes `chunk-provenance.ts`'s exported
`computeVerificationScope`/`resolveCitedSlices`/`parseVerifiedAgainst` into the three-state ladder
(decision 2b) — no archive or no recorded hash → `unknown` (the actual current state of both
reference games), any recorded hash differing from current → `source-changed`, all matching →
`source-unchanged`; structurally incapable of feeding `deriveStale` (two parameters, no label
input). 23/23 new tests pass, `npm test` 3647/3647 green (baseline 3624 + 23), typecheck clean. See
`.planning/phases/174-verify-classifier/174-03-SUMMARY.md`.

`174-02-PLAN.md` widened `verify-run.ts`'s ledger surface: exported the seven module-private
atomic-write/parse helpers (`atomicWriteFile`, `appendLedgerLine`, `locateFences`,
`parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`, `readLedgerOrThrow`) plus the
`ParsedLine` union unchanged in behavior, so `verify-classify.ts` (plans 174-03/174-04) can
genuinely reuse the one hardened atomic ledger write path (173-08/CR-01) instead of a second copy.
Taught `parseLedgerBody`/`resolveLedgerState` a fourth record kind, `classification`, with a
PLURAL schema (`units[]`/`liveSlices[]`/`stagedSlices[]`) matching `SlicePair.stagedUnits[]`
field-for-field per CONTEXT.md decision 6 (amended) — no collapsing step, so no recorded unit of
an m:n pair group is discarded. Kind isolation (a classification line never contaminates
`recorded[]`; `range-reset` stays unit-scoped) falls out of the existing filter logic. 43/43
ledger tests pass, `npm test` 3624/3624 green, typecheck clean. See
`.planning/phases/174-verify-classifier/174-02-SUMMARY.md`.

`174-01-PLAN.md` closed the phase's Wave-1 gate: neither reference game had any real
pass-1-vs-pass-2 material on disk (`174-RESEARCH.md`'s biggest finding), so this plan produced it
for real, reusing Phase 173's adoption + re-transcription pipeline unchanged against fresh `cp -R`
copies of both `seven` and `one-two-punch`. Real skill install, real `ingest-archive` adoption
(Case 2, no `--edition`), real `verify-run-init`/`-record`/`-status`, and a real `claude -p`
subprocess dispatch of the transcription-subagent contract (no internal Task tool exposed to this
executor — same documented constraint and resolution as `173-PROOF.md` §3). `seven` produced 6
staged files vs. 3 live rule slices (reproducing 173's own 6-vs-3 measurement of this exact game
exactly); `one-two-punch` produced 6 staged vs. 2 live (a 3x fan-out). Every live slice confirmed
byte-identical before/after pass 2; zero slice-body-shaped lines in either subagent's raw return.
Archived both games' real live+staged material into `174-FIXTURES/` with a 23-row sha256 manifest
(independently re-verified 23/23 match) so it survives scratch cleanup. Measured the real
presentation-marker inventory — `one-two-punch` live: 5 `— diagram description` + 1 `— art` of 12
total `Derived` lines, 0 `Visual (p.` lines; `seven` live: 0/10, 0 `Visual (p.` — matching
`174-RESEARCH.md`'s prior measurement of the untouched originals exactly, no contradiction. A
sweep for a third legacy presentation qualifier found none (only `art` and `diagram description`
exist), closing the open measurement question behind CONTEXT.md decision 12b's enumerated
exclusion constant. Both `~/BoardSmithGames` originals confirmed byte-identical (whole-tree
sha256 diff empty) before and after. `VERIFY-03` intentionally left OPEN in `REQUIREMENTS.md` —
this plan produced fixtures only; no classifier code exists yet (plans 174-02 onward). See
`.planning/phases/174-verify-classifier/174-01-SUMMARY.md`.

Phase 173 (verify-pipeline-core) is COMPLETE (8/8 plans).

`173-08-PLAN.md` was a follow-up closing two defects the phase's own evidence chain surfaced AFTER
173-07 marked the phase complete: CR-01 (Critical — the ledger write was a full truncate+rewrite,
not crash-safe as the module's own doc comment claimed) and `173-PROOF.md` §4 Finding 1
(range-level resume re-dispatch was not idempotent — 9 recorded units vs. 4 for a clean run). Both
fixed before Phase 174 builds on the guarantee: atomic temp-file+`fsync`+`rename()` ledger writes,
and a persisted page-range dispatch-plan manifest + range-complete/range-reset markers making
resume deterministic. Re-proven live against a real `cp -R` copy of `one-two-punch` with real
process kills — the killed-then-resumed run's final recorded-unit set now matches a clean run's
exactly. Also closed WR-01 and the three Info items from `173-REVIEW.md`. VERIFY-08 re-confirmed
complete against the corrected guarantee (`173-PROOF.md` §5). `npm test`: 3611/3611. See
`.planning/phases/173-verify-pipeline-core/173-08-SUMMARY.md`.

`173-07-PLAN.md` closed the phase: a REAL kill-and-resume proof for SC-4/VERIFY-08 against a fresh
`cp -R` copy of `one-two-punch`, split into two single-page dispatches so a kill could land between
independent subagent calls. Two genuine interruption mechanisms — a harness-timeout SIGTERM landing
mid-record-loop, and a deliberate `kill -9` on a confirmed live PID — both left the core no-data-loss
guarantee intact (byte-identical mtime+sha256 on already-recorded staged files, single ledger lines,
zero waste on the range killed before any dispatch). Two real findings reported rather than smoothed
over: range-level resume re-dispatch is NOT idempotent (an already-partially-recorded page range gets
re-covered in full rather than sub-divided — 9 recorded units vs. 4 for a clean uninterrupted run of
the same book), and a torn ledger line that ALSO destroys its trailing fence throws a hard error
instead of gracefully demoting the affected unit (the narrower torn-line-only case behaves exactly as
designed). Also deliberately exercised the torn-ledger-line crash-safety case with both sub-cases.
Closed the phase's evidence trail: `173-PROOF.md` now carries all four live proofs plus a final
phase-wide "What is still unproven" (9 items) and a "How to re-run every proof" block;
`173-VALIDATION.md` fully signed off (`nyquist_compliant: true`); `REQUIREMENTS.md` — VERIFY-02 and
VERIFY-08 marked complete with citations, VERIFY-01 and VERIFY-07 DELIBERATELY LEFT OPEN (their
"per-chunk verdict"/"classification in subagents" halves depend on Phase 174's not-yet-built
classifier — marking them now would have been a third premature completion mark this phase caught).
`npm test`: 3597/3597 (unchanged, docs-only plan). See
`.planning/phases/173-verify-pipeline-core/173-07-SUMMARY.md`.

`173-01-PLAN.md` closed the phase's wave-1 hard gate: `ingestArchiveCommand`'s existing-INDEX
branch was reporting false success on already-ingested projects while silently failing to write
`Source hash:`/`Transcribed:`, orphaning a wrapped `Source:` paragraph, and clobbering a real
`Edition:` value. Repaired all four root causes (insert-if-absent headers, wrap-safe `Source:`
handling, `Edition:` preservation, and deciding the existence branch OUTSIDE any write-performing
try/catch so a mid-repair error can never fall through to a scaffold overwrite). Proved the fix
against `cp -R` copies of BOTH reference games — `seven` (wrapped-prose `Source:`) and
`one-two-punch` (no `Source:` line at all) — with `computeVerificationScope()` flipping
`pre-provenance-project` → `full` for both, `Edition:` preserved byte-identical, and both originals
confirmed byte-identical before/after. Documented (in `173-PROOF.md`) a refuted plan hedge:
`chunk-provenance-status`'s project-level `pre-provenance` state does not flip from this fix alone
— that field tracks whether any chunk has ever had `chunk-check` run on it, unrelated to
`INDEX.md`'s header; `computeVerificationScope()` is the actual authoritative payoff check. Full
suite 3525/3525, lint zero errors in `src/cli/`. See
`.planning/phases/173-verify-pipeline-core/173-01-SUMMARY.md`.

Phase 172 (source-free-conformance-checks) is complete — 5/5 plans, ready for verification.

`172-04-PLAN.md` registered both CHECK-03/CHECK-05 commands on the CLI surface next to
`chunk-provenance-status`: `boardsmith trace-check [--project <dir>] [--json]` and
`boardsmith drift-check [--project <dir>] [--json]`, no mode/repair flag, matching the existing
registration shape exactly. Pinned 172-CONTEXT.md decision 6 — findings exit 0, tool failure exits
non-zero — with `src/cli/cli-conformance-commands.test.ts`, the first test in this repo to spawn
`node bin/boardsmith.js` as a REAL child process rather than call a command function in-process
(the only way to exercise `cli.ts`'s `parseAsync()`/top-level-catch exit-code path for real). 4
spawns: `trace-check` against a fixture with an untested claim (exit 0, JSON, `claim-untested`
finding present), `trace-check` against a non-bs-project (exit 1, single clean line naming the dir
and `--project`, no stack frame/`.ts:` ref/repo `src/` path), `drift-check` against a real
two-commit git fixture with a changed manifest file (exit 0, JSON, `chunk-code-drifted` finding
present), `drift-check` against a non-git directory (exit 1, same message discipline). All fixture
projects confirmed byte-identical before/after. Zero changes needed to 172-02's/172-03's
already-implemented command logic — this plan was pure CLI wiring + proof. `npm test`: 3503/3503.
The CLI surface plan 172-05's real-game proof harness invokes now exists and works. See
`.planning/phases/172-source-free-conformance-checks/172-04-SUMMARY.md`.

`171-07-PLAN.md` is the phase's PROC-01 record: `chunk-check` and `chunk-provenance-status` proven
end-to-end against COPIES of both real reference games (`~/BoardSmithGames/seven`, read-only,
confirmed clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd` before AND after; `one-two-punch`,
confirmed byte-identical before/after despite pre-existing unrelated dirty state). All 29
pre-existing chunks (12 + 17) classified `unknown` before any run, `full: 0`/`codeConformanceOnly: 0`
both games, and every single one flagged `verifiedWithoutProvenance` — the phase's stated
ready-made proof target, demonstrated exactly as predicted. Every `chunk-check` run on every real
chunk in both games landed on `Scope: code-conformance-only` / `Reason: pre-provenance-project` —
the `source-missing` STOP condition never fired, confirming the precedence order is correct on
live data. 11/12 one-two-punch and 15/17 seven chunks resolved at least one real cited slice on
real prose; one recorded hash independently cross-checked with `shasum -a 256` and matched
exactly. Both games' re-runs were idempotent (exit 0, `changed: false`, byte-identical files).
Post-run status showed `unknown: 0`, `verifiedWithoutProvenance: []`, `projectProvenanceState:
"complete"` for both. F-1 edition normalisation confirmed on live data: one-two-punch's and
seven's different raw `Edition:` free text both collapsed into the single
`"not stated in the rulebook"` byEdition bucket. **Recorded honestly, not glossed over:** the
plan anticipated seven's live prose would exercise the genuinely-ambiguous bare `rulebook/01`
shorthand (seven has two `01-`-prefixed slices) — it does not; every citation in seven's real
chunks uses full filenames, and the shorthand only appears live in one-two-punch, where it is
unambiguous (only one `01-` slice there). The resolver's ambiguity-handling logic remains proven
by its Wave-0 unit fixture, not by this run. `npm test` — 3407/3407, matching the phase baseline
exactly (no source touched; this is a proof-only plan). Filed F-3 (`boardsmith.json`'s stub
`description`/`playtime` ownership after `init`) as a todo. See
`.planning/phases/171-provenance-recording/171-PROOF.md` and
`.planning/phases/171-provenance-recording/171-07-SUMMARY.md`.

`171-06-PLAN.md` wired the two commands from plans 04/05 into the actual pipeline: CHUNK.template.md
now scaffolds the machine-owned `## Verified Against` fence (byte-identical to the writer's
exported constants) into every new chunk; `close.md`'s Bookkeeping Sequence gained item 3, "Record
what this chunk was verified against," which runs `boardsmith chunk-check <slug>` right after the
verified-commit-hash item, renumbering the sequence to six items — `playtest.md`'s light path still
cites the sequence BY NAME rather than duplicating the chunk-check text, so the two close paths
cannot drift apart. Fixed the plan-check blocker along the way: inserting the new item shifted
ledger-reconciliation from item 4 to item 5, and `state-machine.md`'s two ordinal citations were
updated to match (its unrelated "consistency-check item 4" citation, a different sequence entirely,
was left untouched — verified by content match, not line number, since this task's own edits shift
lines above it). Added a derived-numbering drift guard to `build-chunk.test.ts` that parses
close.md's real Bookkeeping Sequence at test time and validates every "item N" citation against it,
so a future renumber fails the suite automatically. RED-first observation caught a real design bug
in the guard's own overlap heuristic TWICE before it worked (a fixed-width text window was sweeping
in vocabulary from neighboring duties in the same enumerating sentence, producing false passes on
genuinely stale citations) — both fixes documented inline. `/bs-check-status` gained item 8,
"Verification provenance and drift," formatting `boardsmith chunk-provenance-status --json` and
explicitly consuming its `projectProvenanceState` field rather than re-deriving severity, so a
pre-provenance project (both reference games, 100% of chunks flagged) reports as informational, not
an alarm. Every test added proves the instruction EXISTS, never that a live session follows it — the
load-bearing guarantees remain the machine-owned fence and plan 05's `verifiedWithoutProvenance`
flag, exactly as `171-VALIDATION.md`'s tiering states. Found and logged (not fixed, out of scope) 6
pre-existing `chunk-provenance.test.ts` `chunk-check` failures bisected to `171-04`, unrelated to
this plan's file scope. Full suite: 3400/3406 passed (6 known pre-existing failures net of this
plan's own 12 new passing tests). See `.planning/phases/171-provenance-recording/171-06-SUMMARY.md`.

`171-05-PLAN.md` landed PROV-03's deliverable: `boardsmith chunk-provenance-status --json`, a
read-only aggregation over every chunk's `## Verified Against` block. THE THREE STATES, NEVER TWO:
`full`, `code-conformance-only`, and `unknown` — a chunk verified before this phase existed carries
no block at all, and reporting that as `code-conformance-only` would assert a scope determination
that was never made. `parseVerifiedAgainst()` distinguishes "never run" (no heading,
`blockMalformed: false`) from "structurally damaged" (heading present, a fence or required label
missing, `blockMalformed: true`) — both are `state: unknown`, but a partial parse is never returned
as valid (T-171-17). `verifiedWithoutProvenance` — the load-bearing enforcement half from CONTEXT.md
decision 6 — flags any chunk whose `Status:` starts with `verified` (covering both `verified` and
`verified (user-waived)`) but whose state is `unknown`; `built` chunks are correctly excluded since
they never claimed verification. Composition documented explicitly: `unknown` and
`verifiedWithoutProvenance` are NOT mutually exclusive by design — a pre-existing project's verified
chunks are correctly BOTH `unknown` AND flagged, which is exactly plan 07's stated proof target (all
29 chunks across both reference games), not a false alarm. Grouping (`byEdition`/`bySkillsTreeHash`/
`byBoardsmithVersion`) re-applies `normalizeEdition()` at READ time so pre-F-1/hand-edited free text
still collapses to one bucket even though `chunk-check` already normalizes on write (RESEARCH.md
Pitfall 3). Read-only, pinned by a before/after whole-project byte-hash test — no `writeFile` call is
reachable from `chunkProvenanceStatusCommand`. RED-first: 14 new tests failed identically with
`chunkProvenanceStatusCommand is not a function` before Task 2. Full suite: 3390 passed (was 3376).
`~/BoardSmithGames/seven` confirmed unmodified. See
`.planning/phases/171-provenance-recording/171-05-SUMMARY.md`.

`171-04-PLAN.md` landed PROV-01's deliverable: `boardsmith chunk-check <slug>` writes/repairs a
fenced, machine-owned `## Verified Against` block into `chunks/<slug>/CHUNK.md` — scope, edition,
rulebook source hash (the edition anchor), BoardSmith version, skills-tree hash, a cited-slice
SHA-256 table, and any unresolved citations recorded verbatim. `ingestCheckCommand` was the
precedent copied line-for-line: writes strictly between `VERIFIED_AGAINST_BEGIN`/`END` (a DISTINCT
fence pair from `GAPS_BEGIN`/`END` per CONTEXT.md decision 3), throws an actionable error naming
both markers when a fence is missing (never silently re-fences), and sets `process.exitCode = 1`
(never throws) on the repair-then-fail terminal path so an immediate re-run passes. RED-first: 11
new tests failed with `chunkCheckCommand is not a function` before Task 2. GREEN found a real bug
(Rule 1): citation scanning must skip any existing Verified Against section, or the block's own
explanatory prose about the rulebook index gets treated as a self-referential unresolved citation
and a second unchanged run never settles to `process.exitCode === undefined`. Verifying Task 3's own
"no stack trace" acceptance criterion surfaced a second, repo-wide bug (Rule 1/2): `program.parse()`
doesn't await async action handlers, so ANY thrown Error in ANY command (verified this pre-existed
for `ingest-archive` too) surfaced a raw unhandled-rejection stack trace with internal paths — fixed
once, at the root, via `program.parseAsync()` wrapped in a top-level `try`/`catch` in `cli.ts`. Full
suite: 3376 passed (was 3365). `~/BoardSmithGames/seven` confirmed unmodified (demo used a
scratchpad temp fixture, deleted after). See
`.planning/phases/171-provenance-recording/171-04-SUMMARY.md`.

`171-03-PLAN.md` built the two pure functions at the heart of PROV-02 and PROV-01, no CLI wiring
yet: `computeVerificationScope(projectDir)` is a single-parameter, disk-only computation with a
top-to-bottom early-return precedence over five enumerated reason codes (`no-rulebook-project` →
`index-missing` → `pre-provenance-project` → `source-missing` → `source-hash-mismatch` → `full`).
`full` requires BOTH the archived file's existence AND its SHA-256 matching `INDEX.md`'s
`Source hash:` — pinned by two dedicated invariant tests (deleted file, rewritten hash) — and no
caller-supplied override exists anywhere (CONTEXT.md decision 1; the API-shape test greps the
source for `assumeFull`/`forceScope`/a scope parameter and asserts arity 1).
`resolveCitedSlices(chunkText, sliceFilenames)` recovers a chunk's cited rulebook slices from its
existing prose, resolving both full-filename and `rulebook/02 p.4` shorthand citations against the
`rulebook/` DIRECTORY LISTING (not `INDEX.md`'s `## Slices` table — one-two-punch's real INDEX.md
has no such heading). Every fixture citation string is copied verbatim from real one-two-punch
`CHUNK.md` prose; the ambiguous-shorthand fixture reproduces `seven`'s genuine two-`01-`-slice
collision (`01-definitions-and-components.md` / `01-overview-setup-and-play.md`) and pins that it
resolves to NOTHING, recorded verbatim, never guessed — the PROV-01 analogue of Phase 170's
gap-dropping defect. Full suite: 3365 passed (was 3344). Both reference games' real `rulebook/`
state (no `Source:`/`Source hash:` lines at all) computes `pre-provenance-project`, matching this
plan's own prediction. See `.planning/phases/171-provenance-recording/171-03-SUMMARY.md`.

`171-02-PLAN.md` built the two remaining provenance INPUTS PROV-01 needs beyond citation/scope:
`readBoardsmithVersion()` fixes `boardsmith --version`'s hardcoded `.version('0.0.1')` lie
(`src/cli/cli.ts:27`) by walking up to the repo's own `package.json` and returning its real
`version` field (throws, never falls back, when none is found). `hashSkillsTree()` adds the
content hash CONTEXT.md decision 7 requires alongside it: Phase 170 ran fourteen `--local` installs
that shared one unmoving package version while the skill text changed almost every run, so version
alone would have stamped them all identical. `hashSkillsTree()` reduces the installer-owned `bs-`
skills tree (5 `bs-<name>/` dirs + `bs-shared/`) to one SHA-256 digest over path+content, sorted by
path, and returns the honest `SKILLS_TREE_ABSENT` (`'not installed'`) sentinel rather than a
placeholder hash when no tree is found. `package.json`'s version field itself was read but never
bumped (decision 9 — versioning policy stays out of scope). Full suite: 3344 passed (was 3332).
PROV-01 is STILL NOT complete — this plan closed the version+hash inputs only; the `## Verified
Against` block itself (plans 03-06) is still pending. See
`.planning/phases/171-provenance-recording/171-02-SUMMARY.md`.

`171-01-PLAN.md` fixed F-1 (`--edition` free text displacing the `EDITION_UNKNOWN` sentinel):
`normalizeEdition()` + `EDITION_EMPTY_LEXICON` now collapse recognisably-empty edition strings to
the sentinel at both `INDEX.md` write sites, preserving the designer's original wording on a
separate un-parsed `Edition note:` line (`HEADER_LABELS` untouched — byte-identical). Both
reference games' live `Edition:` strings verified to normalise correctly as named test fixtures.
`~/BoardSmithGames/seven` confirmed unmodified (read-only inspection only) before and after. Full
suite: 3332 passed (was 3323). See `.planning/phases/171-provenance-recording/171-01-SUMMARY.md`.

Phase: 170 (Ingest Contract Upgrade) — **COMPLETE**.

The `170-10` PROC-01 human gate ran twice on 2026-07-28. Run 1 FAILED (e/h/i); Run 2, against the
repaired contract, PASSED all of (a)-(i) **on the as-left tree with no repair applied**. Record:
`.planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN-2.md`; disposition in `170-10-SUMMARY.md`.
Read `170-MECHANISMS.md` for the phase's fourteen-attempt history and which artifacts are superseded.

PROC-01/02 and INGEST-01..04 are now **Complete** in REQUIREMENTS.md.

**The Run 1 root cause, which matters for 171-179:** `boardsmith init` installs a pre-commit hook
that runs ingest synthesis, and the bs- build protocol commits at every chunk step -- but
`/bs-ingest-rules` has no commit in it at all. So the hook had never fired at the end of a real
ingest. The orchestrator hand-wrote `## Open Rules Gaps` instead: 2 entries against 5 slice markers,
undetectable by reading. Fixes (`92f88bb9`, `c32bc184`): the section is now fenced machine-owned, and
`boardsmith ingest-check` repairs-then-exits-non-zero from `/bs-build-chunk` Step 0.

**Standing finding, unchanged and now twice-confirmed:** skill text conveys JUDGMENT reliably and
MECHANICS not at all. Sort every remaining requirement into those two buckets before planning;
mechanical ones need code (a command, a flag that errors, a hook, a fence), not better wording.
Run 2's fence worked precisely because it removed the choice -- the session had a real motive to
tidy the gaps section and declined *because it was marked machine-owned*.

**The harness must no longer gate a manual pass.** It certified a broken contract twice (three
single-turn 10/10s before a 1/10 human run; 11/11 immediately before Run 1's three failures), and
its `assert` step was manufacturing the commit that made one of those greens possible. It may
inform. If it corroborates the next manual gate that is the first time ever; if it disagrees again,
retire it rather than patch it a third time. Governance rule still stands: **a green at <=2 turns is
an INVALID RUN.**

New surface: `boardsmith init --rulebook/--without-rulebook/--edition`, `boardsmith ingest-archive`,
`boardsmith ingest-gaps`, `boardsmith ingest-relabel`, `boardsmith ingest-check`,
`src/cli/lib/ingest-hook.ts`, `scripts/ingest-harness/`. Also implemented: the optional
`/bs-ingest-rules <path>` argument (`.planning/todos/pending/bs-ingest-rules-optional-path-arg.md`
-- can be closed).

**Three findings carried into 171+:** F-1 `--edition` lets a free-text paraphrase displace the
machine-checkable `EDITION_UNKNOWN` sentinel, and PROV reads that field (fix in 171). F-2 the relabel
lexicon misses *negative* visual claims (defer to Phase 177 / CHECK-04). F-3 two runs made opposite
scope calls on `boardsmith.json`'s stub description/playtime -- ownership after `init` is unstated.

Last activity: 2026-07-28

## Milestones

**Completed:**

- v0.1 Large File Refactoring (Phases 1-4) -- shipped 2026-01-08
- v0.2 Concerns Cleanup (Phases 5-8) -- shipped 2026-01-09
- v0.3 Flow Engine Docs (Phase 9) -- shipped 2026-01-09
- v0.4 Public API Docs (Phase 10) -- shipped 2026-01-09
- v0.5 ESLint No-Shadow (Phase 11) -- shipped 2026-01-09
- v0.6 Players in Element Tree (Phases 12-13) -- shipped 2026-01-09
- v0.7 Condition Tracing Refactor (Phases 14-16) -- shipped 2026-01-10
- v0.8 HMR Reliability (Phases 17-19) -- shipped 2026-01-11
- v0.9 Parallel AI Training (Phases 20-23) -- shipped 2026-01-13
- v1.0 AI System Overhaul (Phases 24-28.1) -- shipped 2026-01-15
- v1.1 MCTS Strategy Improvements (Phases 29-36) -- shipped 2026-01-16
- v1.2 Local Tarballs (Phases 37-38) -- shipped 2026-01-18
- v2.0 Collapse the Monorepo (Phases 39-46) -- shipped 2026-01-19
- v2.1 Design-Game Skill Redesign (Phases 47-50) -- shipped 2026-01-19
- v2.2 Game Design Aspects (Phases 51-53) -- shipped 2026-01-21
- v2.3 Nomenclature Standardization (Phases 54-58) -- shipped 2026-01-22
- v2.4 Animation Event System (Phases 59-63) -- shipped 2026-01-22
- v2.5 Player Colors Refactor (Phases 64-68) -- shipped 2026-01-25
- v2.6 Code Consolidation (post-mortem driven) -- shipped 2026-01-29
- v2.7 Dead Code & Code Smell Cleanup (Phases 69-74) -- shipped 2026-02-02
- v2.8 Disabled Selections (Phases 75-79) -- shipped 2026-02-06
- v2.9 Theatre View (Phases 80-84) -- shipped 2026-02-07
- v3.0 Animation Timeline (Phases 85-90) -- shipped 2026-02-08
- v3.1 Dynamic Auto-UI (Phases 91-96) -- shipped 2026-06-22
- v4.0 UI Redesign (Slate) (Phases 97-103) -- shipped 2026-06-23
- v4.1 Tutorial Primitives (Checkers) (Phases 104-111) -- shipped 2026-06-30
- v4.2 Tutorial Primitives — Go Fish & Docs (Phases 112-115) -- shipped 2026-06-30
- v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools (Phases 116-122) -- shipped 2026-07-01
- v4.4 Agent-Ergonomics Gaps (Audit Fixes) (Phases 123-130) -- shipped 2026-07-02
- v4.5 Pit of Success Hardening (Audit #3 Fixes) (Phases 131-139) -- shipped 2026-07-03

**Completed:**

- v4.6 BS Skills (Rulebook-Driven Game Building) (Phases 140-151) -- shipped 2026-07-05 (playtest follow-up re-closed same day, `v4.6.1`)
- v4.7 Playtest Follow-Up Fixes (Phases 152-154) -- shipped 2026-07-06
- v4.8 Battery Post-Mortem Fixes (Phases 155-169) -- shipped 2026-07-22 (14/15 phases; Phase 165/D32 deferred-to-platform). Closed the 5-game build-battery post-mortem (D1–D31 + skills defects + autonomy rewrite + seed-to-state spike + cross-repo de-workaround sweep). Library 3141 green; all 5 game repos green. Tech-debt pass resolved hidden-zone D24 game migration + v4.8-WR01 + v4.8-MCTS-UNDO.

## Deferred Items

Items acknowledged and deferred at **v4.8** milestone close on 2026-07-22:

| Category | Item | Status | Note |
|----------|------|--------|------|
| phase | Phase 165 / PLATLOG-01 (D32) | deferred-to-platform | `[DRAWDROP]` logging proven absent from this library repo AND all 5 game repos (grep=0); lives only in the deployed platform (web front-end + Convex `pieces:*`). "Filed, not patched" per the lab finding. Re-scope to the platform repo. |
| review-warning | v4.8-SIM-LASTACTOR-UNDO | deferred | Last-actor of a simultaneous step loses its per-seat undo window one tick early; bleeds into the whole-step-undo semantics the user explicitly DECLINED. UX edge, no data loss. Revisit only if playtest surfaces it. |
| game-rewrite | doom-machine D9 native-multiSelect | deferred | The single-select-enumeration workaround works; rewriting to native panel multiSelect is a risky game-logic change. Deferred by design (conservative sweep). |
| game-wip | lanternfall AI (untracked) | not-owned | `src/rules/ai.ts` + `ai-smoke.test.ts` are uncommitted pre-existing WIP on lanternfall master; type-checks + smoke passes, but committing/finishing them is not this run's to own. |
| todo | dev-host-ai-open-seat-not-auto-playing | open | Pre-existing carry-forward (non-blocking) |
| todo | dev-host-debug-toggle-panel-not-opening | open | Pre-existing carry-forward (non-blocking) |
| todo | dev-standalone-shell-height-gap | open | Pre-existing carry-forward (non-blocking) |
| todo | v4-slate-token-and-a11y-polish | open | Pre-existing carry-forward (non-blocking) |
| debug | knowledge-base | reference | Debug knowledge-base file, not an active session |

Resolved this session's post-audit tech-debt pass (NOT deferred): game-side hidden-zone D24/SPACE-03 migration (doom 405/405, BoardSmithGames2/seven 374/374), seven BSR-7 stale test (205/205), library v4.8-WR01 + v4.8-MCTS-UNDO (suite 3141). All 6 repos fully green.

---

Items acknowledged and deferred at v4.1 milestone close on 2026-06-30:

| Category | Item | Status | Note |
|----------|------|--------|------|
| verification | 108-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): action help demonstrated live + user-approved |
| verification | 109-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): checkers tutorial demonstrated live + user-approved |
| uat | 108-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| uat | 109-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| todo | dev-host-ai-open-seat-not-auto-playing | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | dev-standalone-shell-height-gap | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | (third pending todo) | open | Pre-existing v4.0 carry-forward (non-blocking) |
| debug | knowledge-base | reference | Debug knowledge-base file, not an active session |

Backlog for a future cribbage (v2 CRIB) milestone: R-05 (suppress Undo during guided tutorial steps), R-12 (strategy tutorial track), pit-of-success lint/dev-warning when a custom board omits `anchorAttrs`. Repo-wide: 2 pre-existing eslint no-shadow errors (useFlyingElements.ts) + tsc test-file looseness — future cleanup pass.

Carried forward from v4.0 (still deferred, separate repo): ShufflewickPub host skin (HOST-01..04).

**Still deferred at v4.7 close (2026-07-06):** the same pre-existing open artifacts remain non-blocking backlog — `knowledge-base` (stale debug/reference file), and todos `dev-host-ai-open-seat-not-auto-playing`, `dev-host-debug-toggle-panel-not-opening`, `dev-standalone-shell-height-gap`, `v4-slate-token-and-a11y-polish`. None were in v4.7 scope (the milestone deferred the AI insta-acknowledge race and broader dev-host work by design). Note: the dev-host-ai-open-seat and standalone-shell-height todos are the same v4.0 carry-forwards listed above.

**New backlog opened during v4.8 (2026-07-20):**

- **v4.8-WR01 (Phase 159 code-review Warning) — RESOLVED 2026-07-22:** Root cause was NOT missing metadata plumbing — it was a dead-data bug. `PickHandler.getPickChoices()` (the per-step "advance to next pick" endpoint) already resolves a function-valued `multiSelect` against the REAL accumulated `currentArgs` and returns it; `useActionController.fetchChoicesForPick()` already fetches it on every selection-step advance and stores it in `pickSnapshot.multiSelect`. But the three client-side "what's the effective multiSelect bound" computeds (`useActionController`'s internal `resolveMultiSelectConfig` used by `fill()`/`toggleMultiSelect()`, `ActionPanel.vue`'s `currentMultiSelect`, and `useBoardActionBridge.ts`'s `currentMultiSelect`) never read that snapshot — each independently fell through to the STATIC `selection.multiSelect` field baked once at `buildActionMetadata()` time with `knownArgs: {}`. No panel dynamic-refresh rework was needed: the correct value was already being fetched and stored, just never consulted. Fix: extracted one shared `resolveMultiSelectConfig(selection, currentArgs, pickSnapshot)` helper (`src/ui/composables/actionControllerHelpers.ts`) that prefers `pickSnapshot.multiSelect` (server-resolved, real args) over the static field, and pointed all three call sites at it — single source of truth, matching the engine-side `resolveMultiSelect` (AI-01/D9) guarantee. `multiSelectByDependentValue` (the explicitly-declared dependent case, already correct) is unaffected — it's still resolved first, client-side. RED-first regression test in `src/ui/composables/useActionController.picks.test.ts` ("function-valued multiSelect reading a prior sibling selection (v4.8-WR01)") reproduces the bug (pre-fix: the stale bound `max:1` even auto-confirmed the multiSelect draft after a single toggle, discarding the other two) and passes post-fix. Suite: 3141/3141 green (was 3140 baseline + 1 new test).
- **v4.8-MCTS-UNDO (surfaced by Phase 159-03, out of scope there) — RESOLVED 2026-07-22:** Root cause (proven via two RED-first unit tests in `src/ai/mcts-undo-bookkeeping.test.ts`): `undoCommands` only reverts commands recorded in `game.commandHistory`; it never restores the flow engine's own private `awaitingPlayers[].completed` bookkeeping (mutated in place by `resumeSimultaneousAction`, never a `GameCommand`) or the plain-property mutations `game.finish()`/`continueFlow`'s terminal path make (`phase`, `settings.winners`). So after a simulated branch that finishes a game or completes a simultaneous decider, that bookkeeping stuck and the next EXPAND of a root sibling was wrongly rejected as a no-op (decider "already completed" / game "already finished"). Fix: each `MCTSNode` now also captures `phase`/`winners` at creation (`src/ai/types.ts`); `backpropagateWithUndo` (`src/ai/mcts-bot.ts`) resyncs `searchGame`'s flow engine + phase/winners to the ROOT node's captured state once per backpropagation via the existing `restoreFlowState` machinery (new `restoreNodeBookkeeping` helper) — cheaper than a full per-node snapshot restore since SELECT always re-derives intermediate states by replaying real moves from a correctly-restored root. Investigation also found (and left as a separate, pre-existing, out-of-scope limitation, already documented in `mcts-restore.test.ts`) that ordinary element mutations (`Piece.putInto`, `.create()`) are never recorded in `commandHistory` at all — `undoCommands`'s element-tree revert is effectively unreachable for typical games; only the plain-property/flow-bookkeeping leak in THIS ticket's scope was fixed. 159's `HiddenInfoGame`/`objectives` fixture comment updated (not removed — it also serves the unrelated hidden-info exploitability test); the 159-07 simultaneous-leak fixture comment updated to note the undo-bug it used to also dodge is now fixed. Suite: 3140/3140 green (was 3138 baseline + 2 new tests).
- **v4.8-SIM-LASTACTOR-UNDO (Phase 160 code-review Warning, deferred):** the seat whose action COMPLETES a simultaneous step loses its per-seat undo window one tick sooner than earlier co-deciders — on `allDone` the engine clears `awaitingPlayers` to `[]`, so `computeUndoEligibility` immediately falls back to the sequential branch for that last actor. This is entangled with the whole-step-undo semantics the user explicitly DECLINED (per-seat was chosen); "undo after the step already completed" bleeds into that declined territory. Asymmetric UX edge, not a correctness bug; no data loss. Revisit only if playtest surfaces it.

## Accumulated Context

### Roadmap Evolution

- v4.9 roadmap defined (2026-07-27): 10 phases (170-179), 25 requirements (PROC, INGEST, PROV, VERIFY, CHECK, TEST) derived from direct inspection of the two bs-built reference games (`~/BoardSmithGames/seven`, `~/BoardSmithGames/one-two-punch`). Continues phase numbering from v4.8 (ended at 169).
  - Phase 170 (Ingest Contract Upgrade) bundles PROC-01/PROC-02 with INGEST-01..04 — the milestone's verify-first process discipline is established alongside the archived-source/Visual-Derived-split/Open-Rules-Gaps prerequisites everything downstream reads, rather than given its own phase (PROC items are a recurring discipline, not standalone deliverable).
  - Phase 172 (CHECK-03 traceability sweep + CHECK-05 code drift) is deliberately sequenced right after Provenance (171) and before the verify pipeline itself — both checks need neither the ingest changes nor re-transcription, so they land early and are proven immediately against seven/one-two-punch, de-risking the rest of the milestone per the roadmapper's phasing guidance.
  - Phase 174 (VERIFY-03, the 4-way cosmetic/sharper/contradictory/source-changed classifier) is its own single-requirement phase — the highest-risk item in the milestone (two good-faith transcriptions of the same page differ in wording almost everywhere; an over-flagging classifier makes the skill unusable on its second run) gets room to be tuned and validated against real pass-1-vs-pass-2 output rather than being buried inside a larger phase.
  - Phase 177 (CHECK-04 derived-line re-derivation) is split out from the Phase 172 source-free-checks phase because it depends on Phase 170's Derived/Visual split (needs separable rule-bearing lines), unlike CHECK-03/CHECK-05 which depend on neither ingest nor re-transcription.
  - Phase 178 groups CHECK-06 (worked-example replay in verify) with TEST-01 (build/test.md worked-example test generation) since both derive executable tests from the same worked-example source and should share derivation logic rather than duplicate it.
  - Phase 179 (VERIFY-09 source-free mode) is the capstone, depending on Phase 172's checks, Phase 177's check, and Phase 171's PROV-02 scope-recording — it wires the source-free checks together with honest scope reporting.
  - Coverage: 25/25 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

- v4.8 roadmap defined (2026-07-20): 15 phases (155–169), 40 requirements (PROC, UNDO, AUTOEXEC, ENDGAME, ZOOM, AI, SIM, DEVHOST, TOOL, SPACE, LIBX, PLATLOG, SKILLDEF, SKILLAUTO, FEAT, SWEEP) derived from the 5-game build-battery post-mortem (`~/BoardSmithLab/findings/BATTERY-POST-MORTEM.md`). Continues phase numbering from v4.7 (ended at 154). Covers all 32 deduped library/platform defects (Part A, D1–D32), both filed skills defects + the autonomy rewrite (Part B), the three platform features (C.1→168, C.2→159, C.3→164+166), and the post-fix game de-workaround sweep (Part E #6→169). Part G (lab methodology) deliberately excluded — belongs to the lab, not this repo.
  - Phases ordered by the Part A priority ranking: multi-game defects first (155 D1/D2, 156 D7, 157 D10/D11, 158 D12), then AI-blocking (159 D9/D8), then simultaneous-step + single-game/minor (160–165), then skills (166–167), feature spike (168), and the de-workaround sweep last (169, spans the game repos not the library). D1+D2 co-located in Phase 155 because the post-mortem notes one fix largely closes both (shared root cause). C.2 folded into Phase 159 (it overlaps D9's panel/enumeration work); C.3 split library-half (164 LIBX-01) + skills-half (166 SKILLDEF-03).
  - Every fix phase bakes in PROC-01 (fix → write tests → adversarially verify → close); PROC-02 preserves Part D disciplines through the autonomy rewrite. Coverage: 40/40 requirements mapped, D1–D32 all covered, no orphans (see REQUIREMENTS.md Traceability).

- v4.7 roadmap defined (2026-07-06): 3 phases (152-154), 5 requirements (ASSET, DEVHOST, VENDOR) derived directly from v4.6's human-playtest follow-ups (DEF-A asset gap, DEF-C dev-host reconnect desync, DEF-B propagation to MERC). Continues phase numbering from v4.6 (ended at Phase 151).
- Phase 152 (ASSET-01/02) and Phase 153 (DEVHOST-01/02) are independent of each other — both fix distinct gaps surfaced by the same playtest — but are numbered in the milestone's suggested order.
- Phase 154 (VENDOR-01) depends on both 152 and 153 so the MERC re-vendor carries every v4.7 fix, not just the already-landed DEF-B fix.
- Coverage: 5/5 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

- v4.6 roadmap defined (2026-07-04): 10 phases (140-149), 34 requirements (LIB, TMPL, INGEST, BUILD, UIQ, STAT, DIST, VAL) derived from `.planning/bs-skills-plan.md`. Continues phase numbering from v4.5 (ended at 139).
- Phase 140 (LIB: `useAnnouncer()`) and Phase 141 (TMPL: the six file templates) are both independent prerequisites — everything downstream consumes one or both, but they don't depend on each other, so they're sequenced first per the plan's own "Build Order" section.
- Phase 142 (`/bs-ingest-rules`) is the largest new-thinking surface (chunking, INDEX, visual survey, sketch heuristic, interview fallback, scaffold) and must exist before any chunk work can start.
- `/bs-build-chunk` (BUILD-01..13) is split across four phases (143-146) along the plan's own mandated session-handoff seams — {investigate+redteam+ask}, {build+test}, {audit+repair}, {playtest+revise+close} — rather than treated as one monolithic phase, keeping each phase independently reviewable at fine granularity. UI/a11y requirements (UIQ-01..05) are folded into the build-chunk phase whose step they gate (ask→UIQ-01, build/test→UIQ-02/03, audit→UIQ-04, final-acceptance→UIQ-05) rather than given a separate UI phase, since they're enforcement mechanisms bolted onto build-chunk's own steps, not standalone deliverables.
- Phase 147 (STAT: `/bs-check-status`, `/bs-insert-chunk`) depends on both ingest (142) and the full build-chunk engine (146) since it reads/edits the same sketch/chunk state those write.
- Phase 148 (DIST: installer + `/bs-generate-ai` rename) comes after all five skills exist, since the installer bundles all of them.
- Phase 149 (VAL: end-to-end dry-run) is last, proving the whole pipeline against a reference game (Hex or Go Fish) before the skills are pointed at a real designer.
- Coverage: 34/34 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

- v4.5 roadmap defined (2026-07-02): 9 phases (131-139), 42 requirements (PROC, SEC, ENG, RST, SESS, UIX, CLIX, SDK, TST, DOCX, GAMES) derived from 38 confirmed audit findings (`boardsmith-audit-report-3.html`, F1-F38). Continues phase numbering from v4.4 (ended at 130).
- Phase 131 (SEC+RST serialization/restore fidelity) is sequenced first: SEC-01/F1/F7 (the critical finding — zone visibility lost on every snapshot restore) and its cluster (SEC-02..04, RST-01/02) all share one root cause — constructor-applied config (`_zoneVisibility`, event handlers, `teachingDisabled`) that `loadSerializedState`/`GameSession.restore` silently discard. Fixed together at the serialization layer, not spot-patched. PROC-01/PROC-02 (verify-first discipline + regression-test-per-fix) are tracked here for traceability but apply fractally to every phase.
- Phase 132 (ENG element/builder safety) and Phase 133 (ENG flow/action validation) split the 8 ENG findings by subsystem — element-tree/builder mutation (putInto, resolveArgs, forEach, build()) vs. flow control/validation (eachPlayer, simultaneousActionStep, multiSelect, switchOn). Findings are mutually independent per audit guidance; split keeps each phase reviewable.
- Phase 134 (UI & Session Interaction Guardrails) groups SESS-01 with all 5 UIX findings — both are "silent wrong-path-that-looks-right" footguns in developer-facing composables/session accessors, distinct from the CLI/SDK footguns in Phases 135/136.
- Phase 135 (CLIX) and Phase 136 (SDK) are separate phases despite both being "config/protocol correctness" work — CLI-surface findings (dev.ts/validate.ts/init.ts) vs. client-SDK findings (game-connection.ts/client.ts/types.ts) touch disjoint subsystems with no shared root cause.
- Phase 137 (TST) is a small, self-contained phase — TestGame.doAction/seed defaults, matching the library's existing determinism doctrine established in v4.4 Phase 123.
- Phase 138 (GAMES cross-repo migration) is sequenced after all API-changing phases (131-137) are stable, mirroring v4.3 Phase 121 and v4.4 Phase 129.
- Phase 139 (DOCX audit) is last: fixes the 3 pure-docs findings (F11/F14/F20) and grep-verifies every doc touched by phases 131-138 (DOCX-04), mirroring v4.4 Phase 130's doc-verifier pass.
- Coverage: 42/42 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Recent decisions affecting current work:

- [v4.5 roadmap]: SEC+RST cluster fixed together at the serialization layer (Phase 131) rather than spot-patched per finding — shared root cause (constructor-applied config discarded by loadSerializedState/restore).
- [v4.5 roadmap]: ENG findings split across two phases by subsystem (element/builder vs. flow/action) rather than one large engine phase — keeps fine-granularity phases independently reviewable.
- [v4.5 roadmap]: GAMES migration sequenced after ALL API-changing phases (131-137), not just some — every prior phase can introduce breaking changes per the No Backward Compatibility rule.
- [Phase 131]: PROC-01 verification gate: all 7 findings (F1,F2,F7,F8,F10,F15,F16) confirmed LEGITIMATE — Independent file:line re-trace before any fix; stateless-ops.ts explicitly confirmed to need no fix for F15
- [Phase 131-02]: Zone-visibility restore tests must use a plain Space (not Deck/Hand): those classes reapply their own constructor default on restore, masking the F1/F7 bug for the common case
- [Phase 131]: debugEnabled is GameSession-consumer-only (not persisted/CLI-wired, Pitfall 2); added GameSession.displayName/teachingDisabled getters (Rule 2) to make the RST-02 persistence fix observable/testable — Session-scoped host-policy fields mirror the aiConfig round-trip pattern; debug gating opt-in stays scoped to trusted GameSession consumers, matching 131-RESEARCH.md Pitfall 2
- [Phase 131-04]: visibleAttributes filtering lives inside filterElement's existing fallthrough (single chokepoint, no parallel filter); state.players derived from truthView via findElementJSONById instead of raw player.toJSON()
- [Phase 131]: Event handler identity key = class name + branch() (tree index path); stable because fromJSON rebuilds children in the same order they were serialized.
- [Phase 132-01]: PROC-01 gate: all four findings (F3/ENG-01, F12/ENG-05, F13/ENG-06, F28/ENG-08) independently re-verified LEGITIMATE against current source before any fix
- [Phase 132-02]: Self-move error message includes the word 'descendant' (trivially its own descendant) so self and true-descendant cases share one actionable-error shape and one test regex
- [Phase 132-02]: ENG-01 containment guard kept fully separate from WR-03 (not merged) -- preserves WR-03's distinct dev-only detached-destination diagnostic purpose
- [Phase 132-03]: resolveArgs second pass narrowed to isSerializedElement only, no bare-number coercion outside declared selections; first pass untouched
- [Phase 132-03]: collect fixtures updated to resolve followUp ids explicitly via game.getElementById, matching the newly documented followUp-arg resolution pattern
- [Phase 132-04]: GameElement forEach snapshot items tagged with { elementId } wrapper (not bare number) to avoid the ENG-05/resolveArgs ambiguity between element ids and JSON-primitive numbers in the same collection
- [Phase 132]: handlerless flag set true in Action constructor, cleared inside .execute(fn); registerAction() throw kept separate from startFlow validators (new registration-time gate per Pitfall 4)
- [Phase 133-01]: PROC-01 gate satisfied — all four findings (F4/ENG-02, F5/ENG-03, F6/ENG-04, F27/ENG-07) independently re-verified LEGITIMATE against current post-Phase-132 source with current file:line evidence before any fix; verification document delivered across two atomic commits matching the plan's two-task structure
- [Phase 133-02]: Wrap is unconditional, no wrap:false opt-out — truncation was never a sane board-game semantic
- [Phase 133-02]: No startIndex === 0 special case added; slice(0)+slice(0,0) degenerates naturally to the full list
- [Phase ?]: Phase 133-04: choice-branch multiSelect enforcement ported from elements branch with deliberate non-array-rejection divergence per locked ENG-04 decision
- [Phase 133-03]: resumeSimultaneousAction's allDone-gated awaitingInput/awaitingPlayers clearing kept fully separate from the actionError set/clear mirror -- structurally different completion semantics from resume()'s single-player completion
- [Phase 133-05]: Used generalized switchOn error message baseline (no name prefix required) with optional config.name prefix, matching the loop maxIterations precedent without requiring callers to set name
- [Phase ?]: [Phase 134-01]: PROC-01 gate satisfied -- all six findings (F17/UIX-01, F18/UIX-02, F19/UIX-03, F29/SESS-01, F30/UIX-04, F31/UIX-05) independently re-verified LEGITIMATE against current post-Phase-133 source with fresh file:line evidence; F19's structural-CSS-fix alternative independently re-confirmed REJECTED; F29's #runner assignment sites re-confirmed at 5 (341, 379, 484, 1462, 1482)
- [Phase 134-02]: start() success path returns bare {success:true} with JSDoc explicitly noting it reflects only synchronous pre-checks, not the eventual server result (RESEARCH.md Pitfall 1)
- [Phase 134-02]: fill()'s UIX-02 multiSelect guard placed after choice-object unwrap and before repeat/onSelect routing, reusing resolveMultiSelectConfig verbatim (no re-derivation)
- [Phase 134-02]: beforeAutoExecuteHooks uses a plain array + identity-based unregister closure (Ref<Hook[]>), matching 134-PATTERNS.md Pattern 2 rather than a new registry abstraction
- [Phase 134-03]: GameShell lastError watch keeps a defensive UIX-01 fallback branch even though useActionController already coalesces lastError to a non-empty string on every failure; unreachable in practice but documents the contract and is test-covered
- [Phase 134-03]: drag()'s combined helper calls a new internal dragPropsInner() directly rather than the now when-gated public dragProps(), avoiding a DragResult.props type break
- [Phase 134-04]: buildRunnerFacade delegates via closures over the captured runner parameter (not this.#runner) at each of the 5 rebuild sites, keeping the facade referentially in sync with the freshly assigned runner
- [Phase 134-04]: ts-expect-error test line assigns session.runner.performAction to a local (does not invoke it) since an actual call throws at runtime, already proven by the adjacent runtime-undefined assertion
- [Phase 134-05]: Browser verification for 134-05's checkpoint performed headlessly via Playwright against go-fish dev host, confirming the Plan 03 ActionPanel-to-GameShell toast chokepoint produces exactly one toast live (no duplicate)
- [Phase 135]: F21/CLIX-03: the CODE (200MB constant) is wrong, not the comment (50MB) - independently re-confirmed against ~/ShufflewickPubGames/src/upload.ts:4
- [Phase 135]: F32/CLIX-04: corrected a 135-RESEARCH.md misreading - CONTEXT.md's locked decision is default 127.0.0.1, not 0.0.0.0-stays-default; fix is a real default-value change, not docs-only
- [Phase 135]: F9/CLIX-01: build.ts's manifest spread is a second silent-forwarding site for playerCount, folded into the same Plan 02 derive-not-duplicate fix
- [Phase 135]: F34/CLIX-06: --ai validation fix requires relocating the check block to after effectivePlayerCount is computed (dev.ts:393), not an in-place operand swap at dev.ts:302
- [Phase 135]: InitOptions interface removed entirely rather than emptied -- template was its only field
- [Phase 135]: dev --host help text corrected to describe the Plan 06 target of a 127.0.0.1 default even though dev.ts runtime binding is unchanged until Plan 06 lands
- [Phase 135]: [Phase 135-03]: Removed the dead $schema line from docs/getting-started.md's boardsmith.json example in addition to playerCount, keeping the doc in sync with generateBoardsmithJson's actual output
- [Phase ?]: deriveManifest sets playerCount AFTER the ...config spread so gameDefinition always wins over stale config (T-135-07)
- [Phase ?]: protocolVersion typed number (matching BUNDLE_PROTOCOL_VERSION), not string as sketched in the plan interface note
- [Phase 135-05]: Allowed-key set enumerated from ALL real read sites (validate.ts+build.ts+dev.ts+publish.ts), not just validate.ts/build.ts as read_first suggested -- gameOptions/playerOptions/colorPalette/paths/gameId/version are legitimately consumed by dev.ts/publish.ts and would false-positive as unknown once Plan 06 wires the same schema into dev.ts
- [Phase 135-05]: minPlayers/maxPlayers excluded from the allowed-key set (not just playerCount) -- CLIX-01 makes gameDefinition the sole source of truth for player count, and Plan 06 collapses dev.ts's fallback chain to a single gameDefinition read
- [Phase 135]: [Phase 135-06]: Combined RED+GREEN commits for Tasks 1-3 (interleaved single-function edits, not independently compilable per-task)
- [Phase 135]: [Phase 135-06]: resolveEffectivePlayerCount keeps the effectivePlayerCount name even though it now errors instead of clamping -- preserves existing devConfig/mpHost call sites
- [Phase 136]: [Phase 136-01]: All six findings (F23,F24,F25,F26,F35,F38) independently re-verified LEGITIMATE against current post-Phase-135 HEAD; zero REJECTED
- [Phase 136]: [Phase 136-01]: F25 errorCode scope boundary locked - client error type carries errorCode as optional; lobby-manager.ts changes out of phase scope (zero errorCode fields today)
- [Phase 136]: [Phase 136-01]: F26 scope boundary locked - barrel re-export chain (client/index.ts re-exports from client/types.ts) requires matching re-export lines on deletion; outgoing WS union narrows to exactly action|ping|getState
- [Phase ?]: [Phase 136-02]: protocol.ts gained 7 new HTTP-shape interfaces (LobbyResponse, SetReadyRequest, AddSlotRequest, RemoveSlotRequest, SetSlotAIRequest, UpdateGameOptionsRequest, UpdatePlayerOptionsRequest) since client/types.ts owned these shapes with no protocol.ts twin
- [Phase ?]: [Phase 136-02]: WebSocketIncomingMessage discriminated union kept client-local (not re-exported from protocol.ts) since protocol.ts's WebSocketMessage union is scoped to client-to-server traffic only
- [Phase ?]: [Phase 136-02]: Rule 3 auto-fix threaded real defaults (config.playerId ?? generatePlayerId(), connectImmediately ?? true, connectionTimeout ?? 10000) into client.ts/game-connection.ts Required<> literals to keep tsc green; simultaneously closed F38/SDK-06 and corrected Node 16+ to Node 19+ error text
- [Phase 136-03]: action()'s not-connected/timeout/open-failure paths all reject; only a genuine server-reported action failure resolves {success:false}
- [Phase 136-03]: connectImmediately gates connect() unconditionally on every call, per the plan's locked acceptance criteria
- [Phase 136-03]: reconnect() simplified to delegate to connect() since connect() now clears #userDisconnected itself (Pitfall 1)
- [Phase 136]: [Phase 136-04]: MeepleClientError extends Error with optional errorCode?: ErrorCode, exported from client barrel; parseResponse<T>() is the single throw-vs-return chokepoint for all 21 non-health HTTP methods
- [Phase 136]: [Phase 136-04]: Rule 1 fix - wsImplementation was silently dropped by connect(), now threaded alongside connectImmediately/connectionTimeout
- [Phase 136-05]: isSettingUp cleared via connection.opened.then()/.catch() internal to setupConnection() (no UseGameReturn API change); connectImmediately:autoConnect threaded into client.connect(), open-then-disconnect fallback deleted
- [Phase 136-05]: GameShell.vue joinGame() auto-join fallback UX (show lobby anyway on join failure) preserved via a nested try/catch around client.joinLobby() rather than letting it bubble to the outer catch
- [Phase 137]: PROC-01 gate: F36/F37 both independently re-verified LEGITIMATE against post-Phase-136 source with zero drift; all six doAction call sites confirmed at original line numbers, locking the classification table for Plans 02-03
- [Phase 137-02]: doAction now throws ActionExecutionError by default; tryAction is the never-throw escape hatch used by the four category-(b) harness call sites
- [Phase 137-03]: Fixed literal 'test-seed' default (matching playUntilComplete-default house style); seed threaded via TestGame's private constructor and surfaced in doAction/assertActionAvailable/GameStuckError failure messages
- [Phase 138]: no-hidden-info-leak.test.ts playSeveralAsks reclassified to loop-control (tryAction), overriding plan's literal Task 2(a) instruction to match driveAFewTurns's identical break-on-failure loop shape
- [Phase 138]: MERC pre-existing dirty tree committed as-is in a standalone WIP commit before re-vendor, per locked CONTEXT decision
- [Phase 138]: True MERC baseline (738 passed/7 skipped/28 files) established fresh via live suite run, not trusted blind from CONTEXT
- [Phase 138]: Zero BoardSmith src fixes required for MERC re-vendor; ENG-05 dual-shape followUp resolvers empirically confirmed already-tolerant
- [Phase ?]: [Phase 138-02]: go-fish/cribbage Playwright smokes intentionally left failing (non-zero exit) rather than faked -- they caught a real CLI dev-host seat-identity bug in the solo-human+AI-seat path, documented as a blocker rather than papered over
- [Phase ?]: [Phase 139-01]: visibleAttributes documented as real (Phase 131 SEC-02 shipped enforcement after the audit finding was written) -- corrected the plan's stale 'dead field' premise rather than following it literally
- [Phase ?]: [Phase 139-01]: Fixed all phantom action()/.do()/.chooseOnBoard() JSDoc occurrences found by full-file grep in game.ts/player.ts, not just the plan's four named line refs
- [Phase 139-02]: Fixed phantom action()/defineActions() text baked into src/engine/flow/engine.ts's own runtime warning (not just docs) and the matching stale engine.test.ts F20 assertion that encoded the phantom text as "the real API"
- [Phase 139-02]: Fixed pervasive 0-indexed player/seat examples in docs/api/session.md and docs/api/runtime.md -- seats are 1-indexed throughout the engine/session (getPlayer, performAction, getState, createPlayerView)
- [Phase 139-02]: Treated the Task 2 playerCount grep-gate false positives (real GameOptions.playerCount usages) as a blunt-instrument limitation rather than deleting legitimate API docs -- verified directly that zero boardsmith.json JSON examples reference playerCount/$schema, satisfying the actual DOCX-04 requirement
- [Phase 140]: useAnnouncer/provideAnnouncer/createAnnouncer mirrors the createAnimationEvents/useAnimationEvents provide-inject shape — Writes through GameShell's existing politeMessage/assertiveMessage refs and postMessage relay with no new DOM nodes; useAnnouncer() never returns undefined (no-op + devWarn once outside a GameShell tree)
- [Phase 141]: state-machine.md is standalone full content (not a thin pointer) per CONTEXT.md's locked decision -- every bs- skill cites it rather than duplicating rules
- [Phase 141]: templates.test.ts describe blocks named by requirement ID (TMPL-03, TMPL-02) so -t selectors work; no markdown parser added, plain string assertions suffice
- [Phase 141-02]: CHUNK.template.md restates the ui: tag (redundant-but-safe) so a CHUNK-only session knows whether the a11y floor applies without re-reading SKETCH.md
- [Phase 141-02]: SKETCH.template.md records the UI Strategy decision (custom-from-chunk-1 vs autoui-with-cutover) at ingest time, since DESIGN.md doesn't exist until the first UI chunk's ask
- [Phase 141-02]: Drift test asserts CHUNK.template.md and state-machine.md contain the byte-identical step-name string; both new templates carry a literal state-machine.md pointer
- [Phase 141-03]: templates.test.ts describe blocks named by requirement ID (TMPL-01, TMPL-02) extended for RULINGS/DECISIONS/DESIGN/ASSETS; ledgers use numbered append-only sections (Ruling N / Decision N) rather than flat tables, matching CHUNK.template.md's Revision Rounds pattern
- [Phase ?]: [Phase 142-01]: read() calls moved inside individual it() bodies (not describe-level) in ingest.test.ts -- required since ingest-rules.md and bs/ingest/*.md files are authored progressively across Plans 01/02/03
- [Phase ?]: [Phase 142-01]: ingest-rules.md kept to 131 lines by delegating every step's heavyweight prose to not-yet-authored ingest/*.md reference files, matching state-machine.md's citation-not-restatement convention
- [Phase 142-02]: transcription.md and interview-fallback.md produce identical rulebook/ + INDEX.md output shape; interview citation format is 'designer statement, ingest session, Q{n}' — INGEST-03 requires the interview fallback to produce the same rulebook/ files as the transcription path, not PROJECT.md prose
- [Phase 142]: 142-03: scaffold.md corrects init-creates-new-subdir framing (no in-place mode); sketch-derivation.md uses the byte-identical sketch-level tail marker + hard 2-3-chunk detail cap, greening the cross-file consistency gate
- [Phase 143]: 143-01: Return-shape field names fixed for build-chunk skill — INVESTIGATE_RETURN_FIELDS=[claimsList,visibilityDeclaration,newlyDiscoveredCitations]; REDTEAM_REFUTER_FIELDS=[claimNumber,verdict,objection]; REDTEAM_COVERAGE_FIELDS=[missingInteractions,ruleDescription,citation]
- [Phase ?]: Light path is routing over build.md/test.md/playtest.md, not a fourth ceremony (no build/light.md file)
- [Phase ?]: Session lock's three outcomes (same-chunk resume, different-live-lock warn, stale-confirm-clear) implemented as three literal branches
- [Phase 143]: [Phase 143-03]: Re-investigate round behavior resolved as append-with-supersession — a refuted-once round appends a new claim noting supersession rather than editing/renumbering the original claim
- [Phase 143-04]: Prohibit confidence adjectives in redteam dispatch prompts to prevent investigator framing from correlating the 3 independent agents; refuters default to REFUTED on uncertainty
- [Phase 143-05]: ask.md uses lowercase 'what you will NOT see yet' to byte-match the BUILD-04 drift test; forbidden vocabulary scoped to action/flow/state/element per 143-RESEARCH.md Pitfall 2
- [Phase ?]: 144-01: followed 144-PATTERNS.md verbatim for drift-pin scaffold constant edits
- [Phase 144]: axe-core and @vue/test-utils added ONLY inside generatePackageJson()'s returned template-string literal — never installed into BoardSmith's own repo
- [Phase 144-03]: fresh-context read exception documented explicitly in build.md as the one build-chunk step allowed to read raw rulebook slices directly
- [Phase 144-03]: test.md frames boardsmith lint's seven AST-based sandbox rules as the sole hard gate, distinct from the same command's regex-heuristic warnings
- [Phase 144-04]: design-ask.md cites build/ask.md's and DESIGN.template.md's prose by name rather than restating it (citation-not-restatement convention)
- [Phase 144-04]: build-chunk.md dispatch-table rewritten so build/build.md and build/test.md are live while audit/repair/playtest/revise/close remain forward references; zero 'authored in Phase 144' occurrences remain
- [Phase 145]: audit.md's own no-framing rule forbids reading CHUNK.md's ## Interpretation, stronger than redteam's rule — even the settled conclusion (not just upstream rationale) must stay out of the dispatch prompt
- [Phase 145]: repair.md's fix-or-refute-with-citation branch modeled on build/build.md's Extends Never Restructures shape — no exact prior analog existed for a refute-in-place-of-fix path
- [Phase 145-02]: design-review.md registered only in build-chunk.md's Reference Files list (dispatched by audit, not a top-level dispatch-table step)
- [Phase 146]: 146-01: assertCitedNearby scans all occurrences of a section-name anchor + both directions for the cite phrase, avoiding false negatives on already-correct citations
- [Phase ?]: playtest.md forward-cites close.md's Bookkeeping Sequence for light-path duty ahead of close.md's own authoring in Plan 03
- [Phase ?]: Build-stamp freshness taught as a hard-reload instruction since DevHost.vue has no on-screen version/commit indicator
- [Phase ?]: close.md's own bookkeeping duty starts AFTER the Status write since playtest.md already writes Status: verified/verified (user-waived) before close begins
- [Phase ?]: final-acceptance.md splits the 7-point design-QA pass: checks 2/3/5/6/7 go to a single fresh-context agent dispatch reusing design-review.md's serve-capture-kill lifecycle; checks 1 (SR/VoiceOver) and 4 (colorblind) stay human-narrated
- [Phase 146-04]: Step Groups 2-3 dispatch prose lives in build/build.md, test.md, audit.md, repair.md themselves; only Group 4 needed a live dispatch section authored in build-chunk.md — Groups 2-3 never had inline dispatch prose to retire (already citation-only, unlike Group 1)
- [Phase ?]: [Phase 147-01]: check-status.md reuses build-chunk.md's Step 2 current-chunk/current-step derivation rule verbatim in spirit rather than re-deriving it
- [Phase ?]: [Phase 147-01]: Waived-chunk batch-playtest proposal gated at 2+ waived chunks (0-1 just reports the count)
- [Phase ?]: [Phase 147-02]: op (b)'s citation-overlap diff performed inline by insert-chunk.md, no subagent dispatch -- flags only, never triggers a revise round itself
- [Phase ?]: [Phase 147-02]: Mandated-Chunks invariant guard folded into op (a) rather than a standalone fifth check
- [Phase ?]: [Phase 147-02]: build-chunk.md line 76's parenthetical check-status pointer left unchanged -- correct live pointer, not one of the two Step-1 stopgap bullets targeted for retirement
- [Phase 148]: 148-01: kept the pinned cite-state-machine.md citation phrase bare (unanchored) in build-chunk.md/check-status.md/insert-chunk.md since anchoring it broke BUILD-13 assertCitedNearby's 250-char window
- [Phase 148]: 148-02: Scoped design-game residual grep to installer source (install-claude-command.ts) + cli.ts, matching Plan 01's identical scoping decision for legitimate migration-prose files in bs/ingest-rules.md and bs/ingest/*.md
- [Phase 148]: 148-02: Added InstallOptions.skipLink to gate the npm-link global side-effect; verified via a temporary smoke test that install-to-temp-dir performs zero execSync calls when skipLink is true
- [Phase 148-03]: Used beforeAll/afterAll temp-dir install (single real installClaudeCommand call) rather than per-test try/finally; skip-list extended for line-wrapped refs, glob placeholders, and build/light.md's documented-nonexistent reference
- [Phase 149-01]: Applied a scratch-project-local tsconfig.json workaround (vite/client types) to unblock the ingest dry-run after discovering a real scaffold-template defect (fresh npx boardsmith init fails tsc --noEmit) — logged for Plan 03, not fixed in BoardSmith source
- [Phase 149]: 149-02: chose pond-empty as chunk-1's depth-cut isFinished() terminal condition (book-forming out of scope makes all-hands-empty unreachable) — Found via simulateRandomGames timedOut on every game; fixed and re-verified 0 crashed/stuck/timedOut/exceededMaxActions
- [Phase 149]: D1/D2 pipeline defects fixed at source in CLI scaffold/init code (not skill markdown); F2/F3 documented as headless-dry-run friction, not defects
- [Phase 150]: boardsmith.json displayName corrected to designer's original 'Go Fish' rather than the lossy kebab-case round-trip, per scaffold.md's Display Name correction rule
- [Phase 150]: Chunk-1 CHUNK.md pre-documents the pond-empty terminal-condition depth-cut (claim 6) ahead of Plan 02's build leg, mirroring the fix the 149 dry-run had to make reactively
- [Phase 150]: 150-01 task commits landed inside go-fish-dryrun's own git repo (created by boardsmith init), not the BoardSmith repo, since sub_repos is unconfigured and the plan's deliverables live entirely outside BoardSmith
- [Phase 150-02]: Redteam Round 1 coverage adversary flagged empty-pond-during-a-miss gap; re-investigate appended claim 7 (append-only), mirroring the exact interaction the 149 dry-run's coverage-adversary pass caught
- [Phase 150-02]: Books defined-but-unwired in chunk-1; isFinished()=pond-empty depth-cut, getWinners() always []; turn-loop does NOT gate on isFinished() (only outer game-loop does) so an earned extra turn is never denied mid-chain
- [Phase 150-02]: Custom UI built directly per SKETCH.md's custom-from-chunk-1 strategy, wired to the real actionController/useBoardInteraction instances GameShell provides (never a mock)
- [Phase 150-03]: F2 fix: GameTable.vue compares the target pick's wire-flattened choice value directly (c.value === seat), not a nested (choice.value as any)?.value -- pick-handler.ts flattens playerChoices()-sourced {value,display} raw choices rather than re-wrapping them; the nested comparison made the ask action's opponent-hand selection completely non-functional in production, found via a real headless-session keyboard-completion a11y test
- [Phase 150-03]: F1 fix: DESIGN.md authored retroactively (Direction: Adopt) after discovering Plan 02's ask step skipped the design-ask visual-identity sub-gate despite this chunk being tagged ui: major
- [Phase ?]: Phase 150: Task 1/3 verification-only, no commits produced; only Task 2's UAT doc edit required a commit
- [Phase ?]: AssetImage.vue single kind-discriminant component, fallback always rendered underneath
- [Phase 152-02]: PieceRenderer's two unguarded image branches (overlay presentationEntry.image override and engine pieceVisual image) merged into one effectivePieceImage computed + one load-guard rather than duplicating the guard twice
- [Phase 152-02]: PieceRenderer fallback label/color derived defensively so a sane token-style fallback exists even when pieceVisual isn't literally token kind
- [Phase ?]: 152-03: Fixtures authored as real on-disk files under __fixtures__/asset-scan/ per plan's files_modified naming them as deliverables
- [Phase ?]: 152-03: AssetImage.vue exclusion matches by basename only (not directory path), per plan's explicit NOTE
- [Phase 152]: Asset-reachability gate failure routes to build (not repair per plan text) — matches test.md's pre-existing Failures-Loop-Back-to-build convention
- [Phase 153]: 153-01: Fix scoped exactly to dev.ts's WS close handler (socket-identity guard) — no changes to MultiplayerHost/SnapshotSessionHost/handleServerRequest, per RESEARCH.md's proven root cause and explicit anti-patterns
- [Phase 155-01]: Shared `assertUndoAllowed`/`UndoRefusedError` guard in `session/utils.ts`, wired into all four undo/rewind entry points (`handleUndo`, `handleDebugRewind`, `undoToTurnStart`, `rewindToAction`) — single source of truth for the `.notUndoable()` fence and the `finished`-phase fence
- [Phase 155-04]: `animationSeqFloor` option on `Game.loadSerializedState`, supplied only by `GameRunner.fromCheckpoint` (derived from the ENCLOSING live snapshot, not the historical checkpoint) — keeps undo/rewind checkpoint restore monotonic without any of the four undo/rewind call sites needing to change; restored buffered events re-stamped above the floor. Adversarial testing surfaced and fixed a related latent bug: `Game.toJSON()` only serialized `animationEventSeq` when the current buffer was non-empty, so the seq silently reset to 0 on any snapshot round-trip through an empty-buffer op (not just undo) — now serialized whenever nonzero, independent of buffer state.
- [Phase 164-01]: unbounded: true opt-in threaded on LoopConfig; global whole-flow tripwire retained unchanged — Lets a genuinely unbounded game express its loop without lying via an arbitrary maxIterations cap, while the engine's DEFAULT_MAX_ITERATIONS run() tripwire (independent of any single loop's counter) still catches a truly stuck loop
- [Phase 164-02]: contrastInk implemented as a pure hex/#rgb/rgb()/rgba() parser (no Canvas/DOM) per the plan's locked LIBX-03 constraint, superseding RESEARCH.md's Canvas-normalization recommendation
- [Phase 164]: Plan 164-03 (LIBX-01): platformActionPanelEscapeHatch renamed+locked; suppressFromDock rides the actionMetadata channel exactly like manual
- [Phase 164-04]: displayedState computed re-wraps the shallower timeTravelState PlayerGameState into the GameState shape at one declaration site (mirrors gameView), unifying board+sidebar-extra :state on a single source of truth
- [Phase 164-04]: isViewingHistory guarded independently in all four useBoardActionBridge mutators (not composed with isMyTurn) since setSelectionValue/toggleMultiSelectValue never re-check isMyTurn mid-action
- [Phase ?]: Session lock grammar extended to "<slug> @ <session-id> — locked at <ISO timestamp>"; Bookkeeping Sequence grew 3->4 items with terminal lock release (SKILLDEF-01)
- [Phase 166]: SKILLDEF-02/03: build.md gained a game/library boundary section (board-only, read-only node_modules/boardsmith, file-not-patch, never-suppress built-in UI) and a never-without-client rule for platformActionPanelEscapeHatch
- [Phase 167]: SKILLAUTO-01: Milestone: field (none|core-loop|scoring|final-acceptance) set at sketch-derivation time, never inferred at runtime
- [Phase 167]: SKILLAUTO-01: non-milestone/UI-less chunks write Status: verified off automated test/sim pass rather than skipping verification
- [Phase ?]: Ask triple-gate (undetermined AND load-bearing AND no reasonable default, else proceed and record) codified in build/ask.md
- [Phase ?]: Cross-chunk continuation reframed as run-while-away + auto-advance; printed resume command is a crash fallback only, never the default end-of-close signal
- [Phase 167]: ≥50% context wind-down floor added beneath the unchanged 60% ceiling; sub-agent offload of research/audits/large reads/repairs codified as the lever; game-completion gets a loud banner + summary card, chunks get a lighter completion line
- [Phase ?]: [Phase 167-04]: SKILLAUTO-08 ledger-reconciliation step inserted before the terminal lock release; reconciles filings/library-gap, asset-debt, and waived-chunk ledgers and re-touches a filing/ruling when a fix lands
- [Phase ?]: [Phase 167-04]: fail-loud sim-exercised assertion implemented via action-level execute() counter instrumentation, not a fabricated SimulationResults coverage field
- [Phase 167]: [Phase 167-05]: state-machine.md's Autonomy Scope: How, Never What (PROC-02) section placed as its own top-level section before Session Handoff Seams
- [Phase 167]: [Phase 167-05]: PROC-02 Part D survives regression net — all six disciplines verified intact after Plans 01-04, zero restoration needed
- [Phase 168-01]: Seed file convention: seeds/<scenario>.json holding a raw GameStateSnapshot; ship raw snapshot format, defer scenario DSL until proven too low-level
- [Phase 168]: Seed rides on hostOptions.seedSnapshot, never gameOptions — mirrors the teachingDisabled WR-04/D-01 pattern so a seed never persists into a game's own snapshot.gameOptions.
- [Phase 169]: D32 recorded ABSENT by design (platform-side); crosswalk built per-filing from all 5 repos' own ledgers, gating all downstream removals
- [Phase ?]: lanternfall BUG 6/D29: comment-refresh only, valve kept
- [Phase ?]: lanternfall BUG 7/D26: removal attempted+reverted (suite went red), guard kept-and-noted
- [Phase ?]: lanternfall BSR-12: AI read/run only, left untracked, not committed by sweep
- [Phase 169]: seven sweep (169-03): removed redundant setVisibilityInternal(hidden) call from Mess.concealFromEverySeat() now that D24/SPACE-03 suppresses childCount at the zone-visibility level alone; converted 5 self-cancelling it.fails tripwires to plain it() (BSR-5 x4/D1, BSR-3 x1) after discovering baseline suite was actually red (196/205), not green
- [Phase 169-04]: one-two-punch's assertPlanLockHolds() (BUG 3/D1) kept, not removed: empirically proven load-bearing beyond BUG 3 via a red-test removal probe
- [Phase 169-04]: one-two-punch BUG 8/BSR-12 CLOSED: MCTS AI re-verified sound against AI-02 redacted-view + pre-reveal simultaneous baseline
- [Phase 169]: doom-machine 169-05: D9/BS-5 rewrite deferred (comment-only); D12/D23 kept-and-noted (load-bearing beyond workaround); BS-10 reclassified as game-side fix already handled (commit 6949fde)
- [Phase 169]: BOARDSMITH-BUG-02 required no logic removal, only pinned-defect test flip + docblock refresh
- [Phase 169]: BSR-12 CLOSED — all four AI-bearing repos show a recorded PASS status; doom-machine correctly excluded as N/A
- [Phase 170]: Exactly two worked examples for the Derived/Visual split per CONTEXT.md's locked cap; publisher-logo edge case mentioned in prose only
- [Phase 170]: openGaps[] added as a new seventh return field mirroring variants[], not folded into citedTerms[]
- [Phase ?]: [Phase 170-02]: Archive+hash landed as Step 3 item 1, not a new top-level step
- [Phase ?]: [Phase 170-02]: ## Open Rules Gaps heading pinned bare (no parenthetical), standardizing over seven's pre-phase hand-authored variant
- [Phase ?]: [Phase 170-02]: Interview path's Source:/Source hash: use explicit not-applicable sentinel rather than omission
- [Phase 170]: gaps-reconciliation treats a wholly-absent Open Rules Gaps heading as a 0-entry body rather than an unrunnable check
- [Phase 170]: conforming fixture rules.pdf is a 113-byte synthetic stand-in, not a copy of the real 2.1MB seven/rules.pdf
- [Phase 170]: No --add-dir passed to the driven claude session; source rulebook copied into throwaway tree at stage time so the reference game repo is structurally unreachable, not merely git-status-detected
- [Phase 170]: 170-PROOF-RUN.md header arithmetic corrected from 7-of-9 to 8-of-9 to match its own checklist table before using it as this baseline's comparison target
- [Phase ?]: Live harness stayed 1/10 across two attempts for INDEX.md template-copy mechanism; deferred deeper architectural fix to next plan
- [Phase 171]: 171-01: normalizeEdition collapses recognisably-empty --edition free text to EDITION_UNKNOWN, preserving designer wording on a separate un-parsed Edition note: line — F-1 fix per CONTEXT.md decision 5 -- PROV-01/PROV-03 read this field, so it must be machine-checkable before anything reads it
- [Phase 171]: readBoardsmithVersion() walks up to package.json (not fixed hop), throws rather than falling back; hashSkillsTree() hashes installer-owned bs- paths by relPath+content sorted, returns SKILLS_TREE_ABSENT when no root found
- [Phase 171]: 171-03: computeVerificationScope's five reason codes checked as a single top-to-bottom early-return chain (order is contract, not incidental); resolveCitedSlices resolves shorthand against the rulebook/ directory listing (not INDEX.md's ## Slices table, absent in one-two-punch); ambiguous/unresolvable citations recorded verbatim, never guessed or dropped — pinned against seven's genuine two-01--slice collision
- [Phase 171]: 171-04: chunk-check writes strictly between VERIFIED_AGAINST_BEGIN/END (distinct fence pair from GAPS_BEGIN/END); citation scan is scoped to content BEFORE any existing Verified Against section so the block can never re-poison its own next computation; program.parse() -> parseAsync()+try/catch in cli.ts fixes a repo-wide stack-trace leak affecting every CLI command, not just chunk-check
- [Phase ?]: unknown and verifiedWithoutProvenance compose by design (171-05)
- [Phase 171-06]: check-status.md item 8 consumes chunk-provenance-status's projectProvenanceState field rather than re-deriving severity, so a pre-provenance project (both reference games, 100% flagged) reports as informational not alarming
- [Phase ?]: 171-07: real chunk-check output disproves the plan's anticipated ambiguous rulebook/01 shorthand in seven's live prose; recorded honestly rather than assumed, per the phase honesty requirement
- [Phase 172]: parseBuildManifest distinguishes tabular:true-empty from tabular:false-prose via a table-structure scan, not row-count alone
- [Phase 172]: parseVerifiedAgainst fixed to use findHeadingIndex instead of chunkText.indexOf, closing the latent f73153a3 recurrence
- [Phase ?]: Three-rung claim-resolution ladder (owners -> live-claim validity -> authoring chunk) implemented as sequential array filters; rung 3 falls back to rung-2 survivors when authoring narrowing would empty the set, never dropping to nothing
- [Phase 172]: drift-check.ts: hand-written execFileAsync instead of promisify(execFile) — Node's util.promisify.custom symbol is dropped when execFile is wrapped for test mocking, silently changing the resolved shape from {stdout,stderr} to a positional array
- [Phase ?]: [Phase 172-04]: trace-check/drift-check registered on the CLI surface with --project/--json only, no mode flag; pinned findings-exit-0/tool-failure-exits-non-zero via a real child-process spawn of node bin/boardsmith.js (first such test in this repo)
- [Phase 172]: Phase 172 closed: trace-check/drift-check proven end-to-end against both reference games via cp -R copies; independent cross-check found and documented a real narrow-impact parser precision defect in AUTHORING_VERBS (filed for follow-up, not fixed in this proof-only plan)
- [Phase 173]: Wave-1 gate closed: ingest-archive existing-INDEX branch repaired and proven against both reference games — Unblocks decision 1 (adopt-on-first-verify) and every later plan needing real-game data; two plan hedges refuted empirically and documented in 173-PROOF.md rather than silently absorbed
- [Phase ?]: Decision 15 honored: reused transcription-subagent.md as a shared, parameterized contract instead of forking a verify-specific copy for VERIFY-07
- [Phase 173]: verify-shaped lock identity is verify:<run-id>, reusing SKETCH.md's existing Session Lock slug position rather than a second lock mechanism
- [Phase 173]: Removed literal --apply/cutover mentions from verify-game.md prose so the decision-8 absence guard in verify.test.ts is a real structural check
- [Phase ?]: Replaced all five hardcoded SKILL_NAMES test literals with a single exported source of truth (SKILL_NAMES), closing the drift hazard structurally
- [Phase ?]: SHARED_LEAF_PROBES verify/ leaf probe uses source-resolution.md per plan fallback instruction
- [Phase 173]: 173-06: source-resolution.md's post-adoption re-check used the wrong provenance field (chunk-provenance-status's projectProvenanceState, which never flips from ingest-archive alone) — found live, fixed to check rulebook/INDEX.md's Source hash: directly
- [Phase 173]: VERIFY-01 and VERIFY-07 left open — per-chunk-verdict/classification-in-subagents halves depend on Phase 174's classifier, which does not exist yet; marking complete now would be a third premature completion mark this phase caught
- [Phase 173]: VERIFY-08 marked complete despite a real finding (range-level resume re-dispatch is not idempotent) because the requirement's core no-data-loss guarantee holds under two real interruption mechanisms; the idempotency gap is tracked as an open item in 173-PROOF.md, not hidden
- [Phase 173]: Closed CR-01 (crash-unsafe ledger write) and PROOF.md Finding 1 (non-idempotent range resume) via plan 173-08, before Phase 174 build — 173-07 marked VERIFY-08 complete on a crash-safety guarantee code review then showed was false; fixing both defects together (same subsystem, same commits) before Phase 174's classifier builds on the corrected guarantee was cheaper than a third premature-completion correction.
- [Phase 174]: ClassificationRecord slot fields are plural (units[]/liveSlices[]/stagedSlices[]) mirroring SlicePair.stagedUnits[] with no collapsing step
- [Phase 174]: ruleBearingLines() excludes bare "p.N, <label>:" citation headers in addition to blank/heading/presentation lines — derived from measuring that real one-two-punch live slices' total content-line count equals exactly (citation headers + quoted lines + Derived lines)
- [Phase 174]: pairing-3's test proves the real seven fixture's actual outcome (one paired group, 3 live + 6 staged, since the archived ledger tags every staged unit with the same rangeId "1-2") rather than 174-03-PLAN.md's illustrative "1 live, 3 staged" example, which does not occur under a rangeId-keyed join over the real ledger data
- [Phase 174-04]: Applied CONTEXT.md decision 18 (added after the plan was authored) in place of the plan's original Task 3 text — chunk staleness is derived from a classification record's quotedPass1 matched against the specific live slice(s) a chunk cites, never from the pair/group verdict wholesale, because real reference games pair into exactly one group each and a group-verdict-keyed roll-up would mark every chunk stale from one sharper line anywhere in the rulebook
- [Phase 174-04]: ClassificationRecord widened with optional quotedPass1/quotedPass2 fields (beyond 174-02's original schema) so decision 18's line-level attribution has a quote to match against, retained on the persisted ledger record itself
- [Phase 174-04]: VERIFY-01/VERIFY-03/VERIFY-07 NOT marked complete despite appearing in this plan's frontmatter requirements — plans 174-05/06/07 build the skill-text/subagent-dispatch integration that makes these CLI commands reachable from /bs-verify-game; marking now would repeat the premature-completion pattern Phase 173 already caught twice

### Pending Todos

None yet for v4.5.

### Blockers/Concerns

- 138-02: CLI dev-host (npx boardsmith dev) has a reproducible client/server seat-identity mismatch in the solo-human+AI-seat path (5/5 go-fish repro, 1/1 cribbage repro) -- blocks natural in-turn action testing for go-fish/cribbage smokes; root cause not fully isolated (see 138-02-SUMMARY.md)

## Session Continuity

Last session: 2026-07-30T02:05:00.000Z
Stopped at: Completed 174-07-PLAN.md — phase closeout, Phase 174 COMPLETE (7/7). Next: Phase 175 (Impact Map & Repair Gating).
Resume file: 
None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone

## Deferred Items

Items acknowledged and deferred at v4.6 milestone close on 2026-07-05:

| Category | Item | Status |
|----------|------|--------|
| verification | 149 browser playtest (149-HUMAN-UAT.md) | human_needed — deferred by design (VAL-01's inherent human gate; user chose to ship with it outstanding) |
| uat | 149-HUMAN-UAT.md (Go Fish chunk-1 browser playtest) | pending — surfaces in /gsd:audit-uat |
| debug | knowledge-base | pre-existing, unrelated to v4.6 |
| todo | dev-host-ai-open-seat-not-auto-playing | pre-existing dev-host tech debt, unrelated to v4.6 |
| todo | dev-host-debug-toggle-panel-not-opening | pre-existing dev-host tech debt, unrelated to v4.6 |
| todo | dev-standalone-shell-height-gap | pre-existing dev-host tech debt, unrelated to v4.6 |
| todo | v4-slate-token-and-a11y-polish | pre-existing polish todo, unrelated to v4.6 |

## Current Position (v4.6 reopened — for the fresh context)

Milestone v4.6 shipped + tagged, then reopened to close VAL-01's deferred human playtest.

- **Phase 150 (Regenerate the pipeline-built Go Fish)** — READY TO PLAN. The Phase-149 dry-run's generated Go Fish lived only in a `/tmp` scratch dir that was deleted at cleanup, so there is no pipeline-built game to playtest. Phase 150 re-runs the ingest + chunk-1 build legs of the bs- pipeline against Go Fish into a STABLE location (recommend `~/BoardSmithGames/go-fish-dryrun/`, NOT `/tmp`), leaving it compiling+serving and NOT deleting it. Hand-built `~/BoardSmithGames/go-fish/` stays READ-ONLY.
- **Phase 151 (Human playtest)** — after 150, the user walks `149-HUMAN-UAT.md` in the browser (verification `human_needed`).

Reference for the fresh context: the Phase-149 artifacts (dry-run report, HUMAN-UAT script, the two SUMMARYs describing exactly how the machine-step dry-run was run, incl. the `${CLAUDE_SKILL_DIR}/../bs-shared/X` → `src/cli/slash-command/bs/X` path translation and the scaled-fan-out approach) are archived at `.planning/milestones/v4.6-phases/149-end-to-end-dry-run-validation/`.

**Next command (fresh context):** `/gsd-autonomous` (picks up Phase 150) — or `/gsd:plan-phase 150` then `/gsd:execute-phase 150`.
