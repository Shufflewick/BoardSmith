# 177-05: Full Stale-Claim Sweep of `verify-game.md`

Performed after Task 1 (CHECK-04's Step 7, Close renumbered to Step 8) and Task 2 (the
Context-Economics carve-out) landed, against the file's full post-edit state, top to bottom. Every
claim `verify-game.md` makes that this phase's own changes could falsify is listed below, quoted
verbatim with its line number in the file as read at sweep time, and given one of four
dispositions: `STILL TRUE (re-verified)`, `REVISED`, `CARVE-OUT ADDED`, or `UNRESOLVED`.

Recording claims found still TRUE is deliberate — a record listing only the broken ones is
indistinguishable from not having swept at all (176-04's precedent, `176-VERIFICATION.md`'s
uniform-verdict framing).

## The six claims named in advance (177-PATTERNS.md § `verify-game.md`, 177-RESEARCH.md § `verify-game.md`)

| # | Claim (verbatim, pre-sweep line) | Disposition | Reason |
|---|---|---|---|
| 1 | Lines 10-13 (intro): "dispatches to `verify/source-resolution.md`, `verify/staging-dispatch.md`, `verify/classification-dispatch.md`, `verify/ruling-recheck.md`, and `verify/repair-dispatch.md` for their heavyweight prose" | **REVISED** | Stale by omission the moment CHECK-04 added two new delegate files. Now reads "...`verify/repair-dispatch.md`, `verify/derive-recheck.md`, and `verify/derive-compare.md`..." — both new files named in the same list, in the same style as the five that came before them. |
| 2 | Lines 26-28: "Comparison happens in Step 3, below; no staged slice ever takes a live one's place, at that step or any other. There is no flag or path anywhere in this skill that writes staged output into a live location." | **STILL TRUE (re-verified)** | CHECK-04 reads only live slices (decision 12: "Target is LIVE slices"), never staged output, and introduces no promotion path. Byte-identical, zero edit. |
| 3 | Line 135 (pre-renumber; now unchanged content): "cite `verify-impact.ts`'s `REPAIR_GATE_DISPOSITIONS`... rather than restating its members here" | **STILL TRUE (re-verified)** | Re-checked the sentence still cites the array by name with no inline enumeration reappearing. CHECK-04 does not touch the repair-gate disposition set at all. Byte-identical. |
| 4 | Lines 146-149 (pre-insertion; now Step 8's opening): "When `verify-run-status` reports every unit recorded and `verify-classify-status` reports every pair classified, the pass closes" | **STILL TRUE (re-verified) — explicitly NOT extended** | This is the decision the research doc flagged as open (RESEARCH.md's "Flag this decision explicitly for the planner"). Decision 15 (`177-CONTEXT.md`) resolves it: "CHECK-04 REPORTS; it does not gate `/bs-verify-game`'s Close." Close's condition therefore stays exactly the two pre-existing gates — adding a third (CHECK-04-complete) condition would turn an advisory sweep into a gate, which decision 15 explicitly forbids. Confirmed no edit was made to this sentence (`git diff` shows only the heading number changed, from `## Step 7: Close` to `## Step 8: Close`, not the condition sentence itself). |
| 5 | Lines 163-189 (pre-insertion) Reference Files list | **REVISED** | Two new bullets added for `verify/derive-recheck.md` and `verify/derive-compare.md`, in the existing one-line bullet style (role summary, not a restatement of the contract body) — mirrors the precedent `verify.test.ts`'s pre-existing "lists both new routes in Reference Files" test (176-04) already established for `ruling-recheck.md`/`repair-dispatch.md`. |
| 6 | Lines 37-46 `## Context-Economics Hard Rule`: "The orchestrator never opens a slice... this skill's own transcript should never contain a quoted-rule line, a `Derived (p.` line, or a `Visual (p.` line" | **CARVE-OUT ADDED — original sentence preserved byte-identical** | The observable is TRUE of the orchestrator's own transcript unchanged; it is FALSE of CHECK-04's dispatch prompts by design (that is their payload). Rather than weaken or delete the true sentence, an explicit carve-out paragraph was added directly below it, distinguishing the orchestrator's transcript (still zero quote/Derived/Visual lines) from the subagent dispatch prompts/returns (where `BS-DERIVE-V1`'s prompt legitimately carries quote lines and `BS-DERIVE-COMPARE-V1`'s prompt/return legitimately carries a `Derived (p.` line), citing `174-PROOF.md` §3's `quotedPass1`/`quotedPass2` precedent by name. Confirmed via `git diff` that lines 40-47 (the original sentence) are byte-identical before and after — only new lines were appended after it. |

## Claims found beyond the six named in advance (first-principles pass)

| # | Claim (verbatim, line) | Disposition | Reason |
|---|---|---|---|
| 7 | Line 93 (pre-sweep: "A clean close (Step 7, below) releases the line to exactly `none`.") | **REVISED** | The exact same defect class 176-04 found once already in this identical sentence (that time Step 5 → Step 7; this time Step 7 → Step 8) — a step-number cross-reference goes stale the instant a step is inserted before the target. Updated to "(Step 8, below)". This is the clearest proof the sweep discipline is load-bearing: the same sentence has now drifted twice across two separate phases that both touched this file. |
| 8 | Line 138 (Step 4's closing sentence): "This step still only decides WHICH chunks need repair; Step 6, below, dispatches `verify/repair-dispatch.md` to actually perform it." | **STILL TRUE (re-verified)** | Step 6 (Repair Dispatch) is unaffected by CHECK-04's insertion — CHECK-04 was placed AFTER Step 6, not between Step 4 and Step 6. No renumbering touches this cross-reference. |
| 9 | Line 22 (intro): "Repair (Step 6, below) MAY change an EXISTING stale chunk's already-built code" | **STILL TRUE (re-verified)** | Same reasoning as #8 — Step 6's number is unaffected by this phase's insertion, which lands after it. |
| 10 | Lines 236-246 (Reference Files footer, "Installed location" paragraph): "The installer (`src/cli/commands/install-claude-command.ts`) MUST preserve this layout — `verify/`, `ingest/`, and `state-machine.md` under the `bs-shared/` root beside every `bs-*` skill directory..." | **STILL TRUE (re-verified)** | Both new contract files (`derive-recheck.md`, `derive-compare.md`) land under the EXISTING `verify/` subdirectory (confirmed by 177-04's installer leaf-probe test: `.claude/skills/bs-shared/verify/derive-recheck.md`), not a new top-level directory. The paragraph's structural claim about the `bs-shared/` layout needs no revision — it already generalizes to any file added under `verify/`. |
| 11 | Line 186 (new, Step 8's heading itself): `## Step 8: Close (VERIFY-02)` | **REVISED (by construction)** | Not a pre-existing claim but the renumbering target — recorded here for completeness since it is the direct consequence of claim #7/#5's insertion. Verified contiguous 0-indexed numbering (Step 0 through Step 8, no gap, no duplicate) via `verify.test.ts`'s existing "step headings are contiguous and 0-indexed" test, which passed unmodified. |
| 12 | The step-count claim is not stated in `verify-game.md`'s own prose (no "this skill has N steps" sentence exists in the file) | **STILL TRUE (re-verified) — never was a prose claim** | Confirmed by grep: no occurrence of a spelled-out or digit step count anywhere in `verify-game.md`'s body (see grep output below). The ONLY place a step count is pinned is `verify.test.ts`'s own structural test (updated in Task 1, from 8 to 9, with the reason documented in that test's own comment — a deliberate structural pin, not a stale free-floating prose claim). |

## Real grep for spelled-out and digit step/reference-file counts (pasted output, run at sweep time)

```
$ grep -n -Ei "\b(four|five|six|seven|eight|nine|ten)[- ]step" src/cli/slash-command/bs/verify-game.md
(no matches)

$ grep -n -E "[0-9]+[- ]step" src/cli/slash-command/bs/verify-game.md
(no matches)

$ grep -n -Ei "\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+reference\s+files?" src/cli/slash-command/bs/verify-game.md
(no matches)
```

All three greps returned zero matches. The existing `verify.test.ts` guard
("does not reintroduce a hardcoded step count or reference-file count") only checks the words
`five` through `nine` (176-04's original regex) — this sweep's grep additionally covers `four` and
`ten`, plus digit forms (`8-step`, `9 reference files`, etc.), neither of which the existing test's
regex would catch. Both are clean.

## Claims checked and NOT resolved

None. Every claim identified — whether named in advance or found by this sweep's first-principles
pass — was checked to a definite disposition. No `UNRESOLVED` entries.

## Summary

- 6 claims named in advance by `177-PATTERNS.md`/`177-RESEARCH.md`: all 6 accounted for (2 STILL
  TRUE, 3 REVISED, 1 CARVE-OUT ADDED).
- 6 additional claims found by the first-principles pass: all 6 accounted for (4 STILL TRUE, 2
  REVISED).
- Total: 12 claims swept, 6 `STILL TRUE (re-verified)`, 5 `REVISED`, 1 `CARVE-OUT ADDED`, 0
  `UNRESOLVED`.
- Close's condition (`verify-run-status` + `verify-classify-status` both complete) is confirmed
  **unchanged** — CHECK-04 is report-only per decision 15, and no third condition was added. This
  is the sweep's single most important negative result: the temptation to make Step 7's completion
  a Close precondition was present and explicitly declined, matching the milestone's established
  "advisory sweeps report, they do not gate" discipline (172 decision 6, restated by decision 15).
- `npx vitest run src/cli/slash-command/bs/verify.test.ts` passes (90/90), including the
  pre-existing step-contiguity guard and the no-hardcoded-count guard, both re-verified against the
  post-sweep file.
