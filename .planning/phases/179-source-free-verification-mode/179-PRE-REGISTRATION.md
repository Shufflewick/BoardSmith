# 179-05 Pre-Registration — the bar for the live source-free proof, audited before any measurement

**Committed BEFORE any staging, any dispatch, and any command run against a staged copy anywhere
in this plan or in 179-06.** Per 179-CONTEXT.md decision 12, this file's entire value is git
ordering: everything below was written from direct reads of the live `chunk-provenance.ts`,
`verify-source-free.ts`, `verify-close-record.ts`, `source-resolution.md`, `verify-game.md`, and
the real `~/BoardSmithGames/{seven,one-two-punch}` trees on disk — never from 179-CONTEXT.md's
`<measured_reality>` section on faith. **Zero staging, zero `cp -R`, zero CLI dispatches against a
staged or original project occurred anywhere in the production of this file.** The only commands
run were read-only (`grep`, `ls`, `find`, `git log`, `Read`) against files already on disk.

Same discipline 177.1-06 and 178-10 used before it: this document is deliberately positioned to
be judged wrong. If plan 06's live run contradicts a stated expectation below, that contradiction
IS the result, not an error in this file.

---

## Section 1 — The criteria, verbatim

### ROADMAP.md Phase 179 success criteria (quoted exactly)

1. **SC-1:** "`/bs-verify-game` run against a project whose source rulebook is unavailable
   completes in source-free mode instead of failing."
2. **SC-2:** "The source-free report names exactly which defect classes went unchecked (e.g. no
   fidelity re-transcription, no worked-example replay against fresh source)."
3. **SC-3:** "The verification's recorded scope reads code-conformance-only with the
   unavailable-source reason, per PROV-02."

### 179-CONTEXT.md decision 11's four things (quoted in substance)

- **(a)** the run COMPLETES rather than failing;
- **(b)** the unchecked list names real defect classes;
- **(c)** the provenance block records `code-conformance-only` with the unavailable-source reason;
- **(d)** the checks that DID run produced real findings — "the one that matters most... a mode
  that runs nothing and reports honestly about running nothing is not a verification pass — it is
  a banner."

---

## Section 2 — Satisfiability + vacuity audit: one row per criterion, seven total

Three questions per row: (1) could a CORRECT implementation fail this for reasons outside its
control? (2) could this PASS VACUOUSLY (zero findings/examples/dispatches)? (3) is it measurable
from an artifact this run will actually produce? Where the answer to (1) or (2) is not a clean
"no", the row is REWRITTEN here, before commit — never after a run fails or vacuously passes it.

| # | Criterion (as literally written) | (1) Unsatisfiable as-written? | (2) Vacuously passable? | (3) Measurable from a real artifact? | Verdict / restated bar |
|---|---|---|---|---|---|
| SC-1 | "completes in source-free mode instead of failing" | No — a genuinely correct implementation that enters source-free mode and finishes cannot fail this for reasons outside its control. | **YES, dangerously.** A mode that enters, prints an honest "nothing ran" banner, and exits 0 satisfies this exact sentence with zero work done. This is SC-1's own instance of the class 178's audit caught twice (its rewritten SC-1 and SC-2). | Yes, but only once restated against a concrete artifact (exit codes + session transcript position + Close side effect), not the bare word "completes". | **VACUOUS AS WRITTEN. REWRITTEN** (see the boxed restatement immediately below this table). |
| SC-2 | "names exactly which defect classes went unchecked" | No — `computeSourceFreeReport`'s `uncheckedDefectClasses[]` is a pure function of `VERIFY_PIPELINE_STEPS`, so a correct implementation always produces a fixed, checkable list. | **YES.** A report naming ZERO unchecked classes is textually a valid report satisfying "names ... which defect classes went unchecked" (the empty list is still "named"). This would be true today only if source-free mode were entered on a project with full scope, which cannot happen by construction — but the sentence itself does not rule it out. | Yes — `uncheckedDefectClasses[].defectClass` and `.stepId`, read from `verify-source-free-check --json` or the formatted report, both durable artifacts. | **VACUOUS IN THE ABSTRACT, NOT ON THIS RUN. REWRITTEN** to a concrete count: exactly 5 unchecked entries (Section 5), each naming a real defect class in designer terms, never zero on a genuine source-free entry. |
| SC-3 | "recorded scope reads code-conformance-only with the unavailable-source reason" | No — `computeVerificationScope`'s five-reason precedence is a deterministic disk-state function. | **YES.** A `ScopeReason` value computed LIVE by the CLI and printed to a terminal, never written anywhere durable, is textually "the verification's recorded scope reads code-conformance-only" to a reader who only checks the live output — and is exactly the defect PROV-02's reopening (179-CONTEXT.md measured_reality #2) exists to close. A pipeline that computes the value correctly but never durably writes it would pass this sentence on a live `--json` call alone. | Yes, but ONLY from the on-disk `## Verified Against` fenced block inside a real `CHUNK.md`, read back after the Close — not from any live recomputation. | **VACUOUS AS WRITTEN. REWRITTEN**: SC-3's bar is the ON-DISK `## Verified Against` block, read back via `Read` (or `cat`) from a real `chunks/<slug>/CHUNK.md` on the staged copy, AFTER the run, containing a `Scope: code-conformance-only` line and a `Reason: source-missing` line inside the `<!-- boardsmith:verified-against:begin -->` / `:end` fences — never the CLI's live `verify-source-free-check --json` output, which is a pure function of disk state that has worked since 179-02 and would pass identically against a pipeline that records nothing durable. |
| 11(a) | "the run COMPLETES rather than failing" | No, same reasoning as SC-1. | **YES**, same defect as SC-1 — folded into SC-1's restatement rather than audited twice. | Yes, once restated. | **Folded into SC-1's restated bar below** — not a separate criterion. |
| 11(b) | "the unchecked list names real defect classes" | No. | **YES**, same defect as SC-2 — a list of zero entries names zero real defect classes vacuously (there is nothing false about "the empty list contains only real defect classes"). | Yes, once restated. | **Folded into SC-2's restated bar** — the 5-entry count and per-entry defectClass/wouldHaveBeenCaughtBy pairing (Section 5). |
| 11(c) | "the provenance block records code-conformance-only with the unavailable-source reason" | No. | **YES**, identical defect to SC-3 — a live-computed value that is never durably written still "records" the value in the sense of computing it once, if a reader does not distinguish live output from a disk artifact. | Yes, once restated to the on-disk block. | **Folded into SC-3's restated bar** — same on-disk `## Verified Against` requirement, not a second check. |
| 11(d) | "the checks that DID run produced real findings" | No — a correct implementation could legitimately find zero drift/trace defects on a well-formed reference game's code, which is a property of the TARGET project, not of the pipeline's correctness. This is the one row where a correct implementation genuinely COULD fail the bare criterion for reasons outside its control (a spotless codebase produces no findings), which is why Section 3 sets a per-check minimum-findings bar with an explicit non-loosening rule rather than leaving 11(d) as a bare pass/fail on "some findings somewhere." | **YES, this is the one 179-CONTEXT.md itself names explicitly** ("a mode that runs nothing and reports honestly about running nothing is not a verification pass — it is a banner"). Zero findings from every one of the four checks, reported honestly, is textually compatible with "the checks that DID run" having in fact run — the sentence says nothing about how many findings constitutes "produced". | Yes, once bound to Section 3's concrete per-check minimums. | **VACUOUS AS WRITTEN AND UNSATISFIABLE IN THE GENERAL CASE. REWRITTEN** — see Section 3's per-check minimum-findings bar, which is what SC-1's restated "did not stop at the negative case" clause is bound to, so "completed" can never be true while "found nothing anywhere" is also true. |

**Result: 7 criteria audited (3 ROADMAP SCs + 4 decision-11 sub-criteria). 3 REWRITTEN outright
(SC-1, SC-2, SC-3), 2 FOLDED into their corresponding SC's restatement (11a→SC-1, 11b→SC-2,
11c→SC-3 — three folds, four sub-criteria total since 11d stands alone), 1 REWRITTEN AND BOUND to
a new, non-vacuous Section 3 bar (11d).** No criterion is dropped silently — every disposition is
recorded here before any dispatch.

---

## SC-1's restated operational bar (by name, per plan instruction)

**As literally written, SC-1 — "completes in source-free mode instead of failing" — is satisfied
by a mode that runs NOTHING: enters, prints an honest banner, exits 0. It would pass and deliver
nothing.** This is SC-1's own instance of the vacuity class 178's audit caught twice.

**The restated bar plan 06 must measure instead:**

1. The reduced sequence's four source-free checks (`trace-check`, `drift-check`,
   `verify-derive-check` / CHECK-04, `verify-example-replay` / CHECK-06) each RAN TO THEIR OWN
   COMPLETION, each with a CAPTURED EXIT CODE (expected `0` for all four — advisory checks exit 0
   per the established pattern; non-zero is reserved for tool failure, not findings).
2. The session did NOT stop at `source-resolution.md`'s negative case — it observed the "no
   candidate anywhere" detection, named what was looked for and where (per that file's own
   instruction), and DISPATCHED into `source-free-mode.md` rather than halting.
3. The Close executed, **including its durable write** — `boardsmith verify-close-record --project
   <dir>` (no `--run`, per 179-04's confirmed dispatch) actually ran and its JSON result's
   `recorded[]` array is non-empty.
4. This restated bar is BOUND to Section 3's minimum-findings bar below, not a substitute for it —
   "completed" can never be true in this run's final disposition while "found nothing anywhere" is
   also true. A run that hits all four points above but where every one of the four checks reports
   zero findings does NOT satisfy the restated SC-1 bar; it satisfies only points 1-3, and Section
   3 governs what happens next (reported as a real zero, and the run's overall disposition flagged
   as not meeting decision 11(d), never silently waved through as "SC-1 passed").

---

## SC-2's restated operational bar (by name)

**As literally written, SC-2 — "names exactly which defect classes went unchecked" — is
vacuously satisfied by a report naming zero unchecked classes; that is textually a valid report.**

**The restated bar:** `uncheckedDefectClasses[]` (from `verify-source-free-check --json`, formatted
into the source-free report) contains **exactly 5 entries** — one for each of `VERIFY_PIPELINE_STEPS`'
five `sourceFreeBehavior: 'skipped'` steps (Steps 2-6: staging-run-and-re-transcription,
classification, adjudication-gate-and-impact-map, ruling-re-check, repair-dispatch) — each carrying
a non-empty `defectClass` string in designer terms and a non-empty `wouldHaveBeenCaughtBy` string
naming the step that would have caught it. Zero entries is never a pass; it is either a bug (the
pipeline drifted from 5 skipped steps without this document being re-audited) or evidence
source-free mode was entered incorrectly.

---

## SC-3's restated operational bar (by name) — the ON-DISK block, never live recomputation

**As literally written, SC-3 — "the verification's recorded scope reads code-conformance-only with
the unavailable-source reason" — is satisfiable by a value computed live and printed to a terminal,
never written anywhere durable.** That is exactly the defect PROV-02's reopening (179-CONTEXT.md
measured_reality #2) exists to close, and exactly the gap plan 179-03/179-04 built
`verify-close-record` to fill.

**The restated bar:** after the run, a real `chunks/<slug>/CHUNK.md` on the STAGED copy (never a
live `--json` call, never the CLI's own recomputation of `computeVerificationScope`) is read back
from disk — via `Read`/`cat`, not through any tool that recomputes the value — and its
`## Verified Against` section, between the `<!-- boardsmith:verified-against:begin -->` and
`<!-- boardsmith:verified-against:end -->` fences, contains:

```
Scope: code-conformance-only
Reason: source-missing
```

(exact expected `Reason:` value and why: Section 5 below.) The CLI's live recomputation of the
identical value is not a substitute for this on-disk read — it is a distinct, already-working
code path (pure function of disk state, unchanged since 179-02) that would pass identically
against a pipeline recording nothing durable. This distinction is exactly what the plan-checker
BLOCKED this phase over, per the execution context.

---

## Section 3 — Decision 11(d)'s bar, made non-vacuous and named in advance

**Minimum real findings required from the checks that run, per check, before this run's overall
disposition can claim decision 11(d) is met:**

| Check | Command | Minimum bar |
|---|---|---|
| CHECK-03 (`trace-check`) | `boardsmith trace-check --project <staged-dir> --json` | At least 1 real finding reported in its `--json` output (not merely a successful exit). |
| CHECK-05 (`drift-check`) | `boardsmith drift-check --project <staged-dir> --json` | At least 1 real finding reported in its `--json` output. |
| CHECK-06 (`verify-example-replay`) | The live two-dispatch sequence (`extract-example.md` + `translate-example.md`, per `verify-game.md` Step 8, unchanged) run against the staged copy | **At least 1 REAL LIVE dispatch** (not a simulated or in-process call) whose recorded finding shows `QuoteVerifiedProvenance` DOWNGRADED provenance — because no archived source exists on the staged copy to verify the quote against — **with the verdict itself left unrewritten**, per decision 3 and Phase 178 wave 4's already-built two-bucket reporting ("a question about the quote, not an accusation against the code"). This is the ONE check whose finding requires an actual model dispatch in plan 06; CHECK-03/CHECK-05 findings come from the CLI's own deterministic analysis of the staged copy's code and require no model call. |
| CHECK-04 (`verify-derive-check`) | `boardsmith verify-derive-check --project <staged-dir> --json` | Runs to completion with a captured exit code (0 expected). Per 177/177.1's disposition (CHECK-04 was re-scoped and its determinism gate retired as miscalibrated — `.planning/phases/177-derived-line-re-derivation/` closure notes), **CHECK-04 is NOT bound to a minimum-findings count in this plan** — it is one of the four checks Section 1's restated SC-1 bar requires to run to completion with a captured exit code, but its finding count is not part of decision 11(d)'s per-check bar the way CHECK-03/CHECK-05/CHECK-06 are. Recording this exclusion explicitly here, before the run, so plan 06 does not retrofit a minimum onto a check this milestone already decided not to hold to one.

**What will be reported if a check returns zero findings:** reported PLAINLY as a zero — the exact
count, the check name, and the fact that it is a zero — in 179-06's proof document. Never
represented as "the check passed" (advisory checks exiting 0 is a separate, always-true fact from
"the check found something"), and never treated as a reason to loosen CHECK-03/CHECK-05's
detection criteria, weaken the CHECK-06 dispatch's search, or manufacture a finding. If CHECK-03 or
CHECK-05 returns zero on the staged `seven` copy, that is recorded as a genuine measurement outcome
and decision 11(d) is reported as NOT MET for that check, exactly as written — not silently
absorbed into an overall "SC met" summary.

---

## Section 4 — Staging and baseline protocol, exact commands, whole-tree per D-10

**Which reference game is staged, and why:** `seven` (Claude's discretion, per 179-CONTEXT.md).
Direct read confirms `seven` has 17 chunks, all with an existing `CHUNK.md`, and its
`rulebook/INDEX.md` currently carries `Source: rulebook/source/rules.pdf` and a `Source hash:`
line (confirmed by direct read below, Section 5) — a smaller, better-understood tree than
`one-two-punch` (12 chunks) for the first live run of this proof, and the one whose corpus this
document's author has the most direct familiarity with from adjacent phases.

**Staging removes BOTH `rulebook/source/` AND any root candidate file — the negative case requires
no candidate at `rulebook/source/` AND none at the root.** A copy still carrying `rules.pdf` at
root lands in `source-resolution.md`'s Case 2 (exactly one candidate at root: STOP AND ASK, then
adopt) — NOT the negative case — and would prove the wrong scenario while appearing to pass.

**Exact commands, in order, for plan 06:**

```bash
# 1. Whole-tree baseline of the ORIGINAL, before any staging — never an enumerated path list.
cd ~/BoardSmithGames/seven && git status --short
# Expected: empty output (clean tree). Record verbatim, whatever it is.

# 2. Stage a working copy.
cp -R ~/BoardSmithGames/seven <scratch-dir>/179-06/seven

# 3. Remove BOTH candidate locations from the COPY ONLY.
rm -rf <scratch-dir>/179-06/seven/rulebook/source
rm -f <scratch-dir>/179-06/seven/rules.pdf

# 4. Confirm the negative case's two conditions on the COPY, before dispatching anything against it.
ls <scratch-dir>/179-06/seven/rulebook/source   # expected: No such file or directory
ls <scratch-dir>/179-06/seven/*.pdf 2>/dev/null  # expected: no matches (root has no candidate)

# 5. After all dispatches and test execution against the COPY complete, re-baseline the ORIGINAL.
cd ~/BoardSmithGames/seven && git status --short
# Expected: empty output again — byte-identical to step 1. Any non-empty output is a blocking
# finding (178-PROOF.md §10's exact failure mode: a scoped/enumerated check reported clean while
# tracked files were deleted outside its scope) and 179-06 must STOP and report it, never continue.
```

**Why `git status --short` and not an enumerated sha256 list:** 178-PROOF.md §10 recorded this
exact failure — a proof reported "825/825 files OK" while two tracked files
(`.boardsmith/runtime-bundle.mjs`, `.boardsmith/runtime-entry.ts`) were deleted outside the
enumerated `rulebook/`, `src/`, `tests/` paths the check covered. **"N/N files OK" over an
enumerated set is not an acceptable substitute for a whole-tree check — it can only ever report
change where change was anticipated, never where it was possible, and this proof's job is
specifically to touch a project's `rulebook/` tree in ways that must NOT propagate back to the
original.** `git status --short` (or a full-tree hash, if the original directory is not a clean git
working tree at measurement time) observes the entire tree, including generated build output,
by construction — it cannot have this class of blind spot.

**No command in THIS plan (179-05) touches `~/BoardSmithGames/seven`, `~/BoardSmithGames/`
generally, or any staged copy.** The commands above are the protocol 179-06 must run, transcribed
here for pre-registration; none of them were executed while producing this document. The only
commands actually run while writing this file were read-only greps/reads/ls against files already
present, listed in this document's own header.

---

## Section 5 — Expected outcome, stated before measuring

### Expected `ScopeReason` — direct-read correction to 179-CONTEXT.md's inherited claim

**179-CONTEXT.md's `<measured_reality>` #2 states, as of 2026-07-28: "Both reference games
(`seven`, `one-two-punch`) are real, live examples of [the `pre-provenance-project`] state" — i.e.
`rulebook/INDEX.md` with no `Source hash:` line at all.**

**A direct read of the REAL `seven/rulebook/INDEX.md` on disk today shows this claim is now
STALE.** `git log --oneline -- rulebook/INDEX.md rulebook/source` in `~/BoardSmithGames/seven`
shows a commit `ecc96a8 docs(rulebook): record source provenance (archive rules.pdf + hash)`,
dated after the context's `<measured_reality>` snapshot. The INDEX.md's current content (read
directly, not inherited):

```
Source: rulebook/source/rules.pdf
Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
Transcribed: 2026-07-30
```

Both `Source:` and `Source hash:` lines are present. `rulebook/source/rules.pdf` also exists on
disk (2,194,346 bytes), and a root-level `rules.pdf` exists too (both will be removed from the
STAGED COPY per Section 4 — the originals are untouched).

**Per `computeVerificationScope`'s own documented precedence (`chunk-provenance.ts:30-55`, checked
top to bottom):** `no-rulebook-project` (fails — `rulebook/` exists) → `index-missing` (fails —
`INDEX.md` exists) → `pre-provenance-project` (fails — a `Source hash:` line IS present, this is
the check that would have fired under the STALE claim above) → `source-missing` (**FIRES** — the
`Source hash:` line is present but, on the staged copy with both candidate locations removed, no
file exists at `rulebook/source/rules.pdf` to read).

**Expected `ScopeReason` on the staged copy: `source-missing`, NOT `pre-provenance-project`.**
This corrects both 179-CONTEXT.md's inherited claim and this plan's own Task 1 instruction text
(which repeated the same stale premise) — the same class of correction 178-10's pre-registration
made to its inherited corpus description, found by direct read rather than taken on faith. Plan 06
must judge against `source-missing`, not `pre-provenance-project`; if the live run instead produces
`pre-provenance-project`, that contradicts this document's own direct-read evidence above and is
itself a finding to report, not a reason to quietly accept whichever value appears.

**`one-two-punch` is in the identical corrected state** (`Source hash:` present, commit `b843502
docs(rulebook): record source provenance`) — noted for completeness since `seven` is the game
actually staged (Section 4), not `one-two-punch`.

### Expected `uncheckedDefectClasses` count

**5 entries**, exactly the five `VERIFY_PIPELINE_STEPS` entries with `sourceFreeBehavior:
'skipped'` (`verify-source-free.ts:85-145` — Steps 2 `staging-run-and-re-transcription`, 3
`classification`, 4 `adjudication-gate-and-impact-map`, 5 `ruling-re-check`, 6
`repair-dispatch`), each with the exact `defectClass` string already defined in that file (quoted
in Section 2's SC-2 row above), read directly rather than paraphrased.

### Expected exit code

**0.** `verifySourceFreeCheckCommand` and every one of the four checks it dispatches are advisory;
non-zero exit is reserved for tool failure, not for findings, per the established pattern this
module's own header comment restates.

### Expected checks-run list

**4 checks**, in dispatch order per `source-free-mode.md` (179-04): `trace-check` (CHECK-03),
`drift-check` (CHECK-05), `verify-derive-check` (CHECK-04, Step 7), `verify-example-replay`
(CHECK-06, Step 8) — `SOURCE_FREE_ADDITIONAL_CHECKS` (2 entries) unioned with the two
`VERIFY_PIPELINE_STEPS` entries carrying a `check` field, per `computeSourceFreeReport`'s own
construction (`verify-source-free.ts:235-238`).

### The durable record — which chunk, what it will contain, and the idempotency observation

**Which chunk:** `computeTouchedChunks` derives the evaluated set from `driftCheckCommand`'s own
`chunks[].chunk` (never a directory listing performed by the Close writer itself), sorted. All 17
of `seven`'s chunks currently have a `CHUNK.md` (direct read, Section 4's staged tree is a `cp -R`
of this same set) and NONE currently carries a `## Verified Against` block (confirmed by direct
`grep -l "Verified Against" chunks/*/CHUNK.md` against the real `seven` tree: zero matches). If
`drift-check` classifies all 17 (the expected case, since none has ever been excluded from
drift-check's scope by anything observed in this read), the alphabetically-first touched slug is
**`best-seven-selection`** — named here as the specific chunk 179-06 should read back from disk,
with the explicit hedge that the authoritative set is whatever `driftCheckCommand` actually
classifies at run time, not a guess independent of that check's own result.

**Expected `## Verified Against` body** (between the fences, in `chunks/best-seven-selection/CHUNK.md`,
per `renderVerifiedAgainst`'s label order):

```
Scope: code-conformance-only
Reason: source-missing
Rulebook edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation
Rulebook source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
BoardSmith version: <installed boardsmith --version output>
Skills tree hash: <hashSkillsTree() output at run time>

Cited slices:

<the chunk's own cited-slice table, or "_Not yet recorded._" if it cites none>
```

**Self-correction, left visible rather than smoothed over:** this document's first draft of this
paragraph claimed `Rulebook source hash: none recorded`, reasoning that `computeVerificationScope`'s
`source-missing` branch leaves `sourceHash` `undefined` since the archived file could not be read.
A second, closer read of `chunk-provenance.ts:151-160` before commit shows that reasoning was
WRONG: the `source-missing` branch explicitly returns `sourceHash` (the value parsed from
`INDEX.md`'s own `Source hash:` line) alongside the `source-missing` reason — only the ARCHIVED
FILE is unreadable, not the recorded hash string in `INDEX.md`, and the function returns what it
could read. The corrected expected line is `Rulebook source hash:
5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880` (`seven`'s real, currently
recorded value, quoted above), now reflected in the code block. This is exactly the discipline
178-10's pre-registration modeled: a wrong first-pass reading, caught and corrected before commit
rather than after a run contradicts it.

### Expected idempotency observation

A second `boardsmith verify-close-record --project <staged-copy-dir>` invocation, run immediately
after the first with no code or rulebook change in between, reports every entry in `recorded[]`
with `changed: false`, and the SHA-256 of every touched `CHUNK.md` file is identical before and
after the second invocation — `recordVerifiedAgainst` is a pure function of disk state
(`chunk-provenance.ts`'s own documented contract) and a repeat call against unchanged inputs must
not rewrite anything.

---

## Satisfiability self-check on this document's own committed criteria

- **SC-1 restated bar:** No correct implementation can fail it for reasons outside its control —
  the four checks either run to completion with a captured exit code or they do not, the session
  either dispatches past the negative case or it does not, and the Close either performs its
  durable write or it does not; all three are directly observable facts about this run, not
  judgment calls. Bound to Section 3, whose per-check minimums are similarly fixed in advance.
- **SC-2 restated bar (exactly 5 entries):** No — `VERIFY_PIPELINE_STEPS` is a `Object.freeze`'d
  constant read directly in this document; a correct implementation reading the same constant
  cannot produce a different count without the pipeline itself changing, which would be a
  pipeline-shape finding, not a run-outcome failure.
- **SC-3 restated bar (on-disk `source-missing`):** No — `computeVerificationScope`'s precedence is
  deterministic and was traced by direct read above, not assumed; the one place this document
  itself got a value wrong on first draft (the `Rulebook source hash:` line) was caught by
  re-reading the source a second time before commit, which is exactly the discipline this
  satisfiability check exists to enforce on itself.
- **Section 3's per-check minimum-findings bar:** CHECK-03/CHECK-05's minimums (≥1 finding) are the
  one place a correct implementation COULD legitimately fail for reasons outside its control (a
  spotless target codebase) — explicitly acknowledged in Section 3's own table rather than hidden,
  and CHECK-04 is explicitly EXCLUDED from a minimum-findings bar per its own re-scoped disposition
  (177/177.1), so this document does not import an unsatisfiable bar for it silently.

**No criterion in this document is dropped as a result of this check.** All three restated ROADMAP
SCs, the folded 11(a)/(b)/(c), and 11(d)'s Section-3 bar survive into 179-06's acceptance
criteria; none is rejected outright (unlike 178-10's N-of-M and "human-recognizable" bars, which
had no equivalent here).
