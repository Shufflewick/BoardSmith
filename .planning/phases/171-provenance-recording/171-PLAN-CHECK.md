## PLAN CHECK FAILED

**Phase:** 171-provenance-recording
**Plans checked:** 7 (171-01 through 171-07)
**Issues:** 2 blocker(s), 3 warning(s), 1 info

### Summary of what was verified clean

- Requirement coverage: PROV-01/02/03 all present across plans' `requirements` frontmatter, every
  CONTEXT.md locked decision (1-10) has a covering task, no deferred-idea scope creep, no
  scope-reduction language (v1/stub/placeholder hits are all legitimate: fixing a hardcoded
  literal, the documented `_Not yet recorded._` sentinel, or an unrelated F-3 todo).
- Dependency graph / waves: 01,02 wave1 (disjoint files) → 03 wave2 → 04 wave3 → 05 wave4 → 06
  wave5 → 07 wave6. Wave math is correct and no same-wave plan touches a shared file.
- Task completeness: every `auto` task has files/action/verify/done; TDD tasks have explicit RED
  discipline requirements.
- Both close paths (item 2 in the audit brief): plan 171-06 inserts the new bookkeeping item into
  `close.md`'s Bookkeeping Sequence and pins, by acceptance criterion, that `playtest.md` does
  **not** duplicate the invocation text (`grep -c "boardsmith chunk-check" playtest.md` == 0) — the
  light path gets provenance recording by citing the sequence by name, not by a second copy. This
  correctly avoids the "trivial chunks silently skip provenance" failure class.
- Five-item count pin (item 3): current `grep -rn "five-item\|five item" src` returns the three
  live hits (`close.md:25`, `playtest.md:166`, `build-chunk.test.ts:745,747`) and plan 171-06's own
  acceptance criteria (`grep -rn "five-item\|five item" src` returns nothing, `six-item` appears
  once in each file) force all of them to be updated together.
- Silent under-recording (item 4): `resolveCitedSlices` (171-03 Task 3) records unresolvable and
  ambiguous citations verbatim in an `unresolved` list and explicitly tests seven's genuinely
  ambiguous `rulebook/01` shorthand as unresolved rather than guessed.
- Three states, not two (item 5): `PROVENANCE_UNKNOWN` (171-05) is asserted distinct from both
  `full` and `code-conformance-only` by dedicated inequality tests; `--json` shape keeps the states
  separate.
- Read-only invariant (item 6): only 171-07 touches `~/BoardSmithGames/seven` /
  `one-two-punch`, and only via `cp -R` copies with before/after `rev-parse` + `status --porcelain`
  assertions and an explicit STOP condition if the pre-state check fails. No other plan writes to
  either reference game.
- Scope computed, never declared (item 7): `computeVerificationScope(projectDir)` (171-03) takes
  exactly one parameter, is arity-tested, and is grep-tested against `assumeFull`/`forceScope`
  patterns — no session or CLI flag can declare `full`.
- Architectural tier compliance (Dimension 7c): every capability in RESEARCH.md's Architectural
  Responsibility Map lands in the plan that targets the tier the map assigns (CLI for
  scope/write/aggregate/citation-resolution/skills-tree-hash; skill text only for invocation and
  formatting) — no mismatch found.

### Blockers (must fix)

**1. [nyquist_compliance / Dimension 8 gate] VALIDATION.md does not exist for phase 171**
- Plan: phase-level (blocks execution of all 7 plans under the Nyquist gate)
- RESEARCH.md contains a substantive `## Validation Architecture` section (test framework, a
  Phase-Requirements → Test Map, sampling rate, and a "Wave 0 Gaps" list), which makes Dimension 8
  applicable per the gate rule, and `config.json` has no `nyquist_validation: false` override.
- `ls .planning/phases/171-provenance-recording/*-VALIDATION.md` returns nothing (compare
  `170-ingest-contract-upgrade/170-VALIDATION.md`, which exists for the prior phase).
- Fix: re-run `/gsd:plan-phase 171 --research` to regenerate `171-VALIDATION.md`, or confirm with
  the orchestrator that this phase is deliberately exempt and record that exemption in config.json.

**2. [task_completeness / dependency_correctness] Plan 171-06 renumbers `close.md`'s Bookkeeping
Sequence but leaves two numbered cross-references in `state-machine.md` pointing at the wrong step**
- Plan: 171-06, Task 2
- `state-machine.md:46` and `state-machine.md:113` both cite `` `build/close.md` "Bookkeeping
  Sequence" item 4 `` to mean the ledger-reconciliation step. Plan 171-06 Task 2 inserts a new
  provenance item immediately after the verified-commit-hash item (today's item 2), which shifts
  ledger reconciliation from item 4 to item 5 and lock release from item 5 to item 6. Task 2's
  action explicitly enumerates "every place that states the sequence's length" (close.md's
  "five-item" line, playtest.md's "five-item", state-machine.md's *duty enumeration*, and
  `build-chunk.test.ts:747`) but does not mention these two ordinal cross-references, and no
  acceptance criterion in the plan would catch them (no test pins the string "item 4", so `npm
  test` stays green while the citation is factually wrong).
- This is exactly the "self-contradicting contract" failure class plan 171-06 itself names as the
  reason to update every count pin — it is just an ordinal reference rather than a count, and it
  was missed.
- Fix: add to 171-06 Task 2's action: "update `state-machine.md:46` and `state-machine.md:113`'s
  `item 4` references to `item 5`," and add a grep-based acceptance criterion, e.g.
  `grep -n "Bookkeeping Sequence\" item 4" src/cli/slash-command/bs/state-machine.md` returns
  nothing after the edit (and, if useful, a positive check that `item 5` now appears at both
  sites).

### Warnings (should fix)

**1. [research_resolution / Dimension 11] RESEARCH.md's `## Open Questions` section is not marked resolved**
- File: `171-RESEARCH.md:428`
- The three questions (Q4 citation-format, the 5th scope case, and whether `check-status` gets a
  second write-capable invocation) are all substantively resolved — by CONTEXT.md decisions 8, 10,
  and the research's own recommendation for Q3 respectively — and the plans correctly implement
  those resolutions. But the heading lacks the `(RESOLVED)` suffix and no question carries an
  inline `RESOLVED` marker, so the document itself doesn't record that closure.
- Fix: add `(RESOLVED)` to the heading and an inline resolution note per question, citing the
  CONTEXT.md decision that closed it. Does not require replanning — a documentation update only.

**2. [verification_derivation] RESEARCH.md names a live-session proof as a phase-gate requirement that the plans do not attempt**
- Plans: 171-06, 171-07
- RESEARCH.md's Validation Architecture section (`171-RESEARCH.md:518-526`) states: "Plan a
  dedicated proof step; do not assume skill-text invocation 'just works' because the contract test
  passes," recommending a live run of `/bs-build-chunk`'s `close` step against a disposable clone
  to confirm the block appears without operator intervention, and calls this a **phase-gate
  requirement** before PROV-01/02/03 can be marked Complete.
- Plan 171-07 proves the CLI commands end-to-end against real reference-game *data* but never
  drives a live multi-turn `close` session; plans 171-06/07 instead document the gap honestly
  ("What this plan CANNOT prove" / "What This Does NOT Prove"), which satisfies this audit's
  explicit "existence-only proof is acceptable ONLY if stated honestly" bar (check item 1) and is
  consistent with CONTEXT.md decision 6's rejection of stronger mechanical enforcement.
- This is not a blocker given the plan's honesty and the locked decision, but it leaves a gap
  RESEARCH.md itself flagged as phase-gating. Recommend: either add the live-session proof as an
  explicit follow-up todo (the way 171-07 already files the F-3 todo), or have the phase-completion
  step (not this plan set) require it before PROV-01/02/03 are marked Complete in REQUIREMENTS.md.

**3. [task_completeness] CHUNK.template.md's own "PARSE CONTRACT (TMPL-02)" required-heading list is not updated**
- Plan: 171-06, Task 1
- `CHUNK.template.md:15-19` embeds a comment enumerating the exact headings a conforming CHUNK.md
  must contain "in order," ending at `## Verified Commit Hash`. Plan 171-06 Task 1 appends `##
  Verified Against` immediately after that heading (and every new chunk will carry it from
  scaffold time), but nothing updates this self-referential contract list, so the template's own
  documented parse contract silently under-describes its own content.
- Not currently harmful (an extra undeclared trailing heading doesn't break the described
  cold-resume STOP condition), but it is the same class of drift `state-machine.md`'s Cold-Resume
  Parse Contract exists to prevent, and it is trivial to fix in the same task.
- Fix: add `"## Verified Against"` to the PARSE CONTRACT list at `CHUNK.template.md:15-19`, and
  extend 171-06 Task 1's `templates.test.ts` assertion to cover it.

### Info

- `171-RESEARCH.md:57` references "Q5" in the Architectural Responsibility Map's rationale column,
  but the Open Questions section only defines items starting at "Q4" (three unlabeled entries) —
  a dangling reference in the research document itself, not in any plan. No action needed from the
  planner; flagging for whoever next edits RESEARCH.md.

### Recommendation

2 blockers require revision before execution:
1. Resolve the missing `171-VALIDATION.md` (regenerate via research, or record an explicit,
   deliberate exemption).
2. Add the two `state-machine.md` ordinal-reference fixes to 171-06 Task 2's action and acceptance
   criteria.

Both are small, targeted fixes — full replanning is not needed. Re-run plan-checker after 171-06
and the phase's validation artifact are updated.

---

## RE-CHECK — 2026-07-28

**Trigger:** revision closing the two blockers above (`171-VALIDATION.md` created; `171-06-PLAN.md`
Task 2 revised).

### Blocker 1 re-check — VALIDATION.md — CLOSED

`171-VALIDATION.md` exists, `nyquist_compliant: true` is set in frontmatter, and it satisfies
Dimension 8:
- Test infrastructure, sampling rate, per-task verification map, Wave 0 requirements, RED-first
  obligations, manual-only verifications, Known Unvalidated, and a signed-off checklist are all
  present.
- Every task row has an `<automated>` command or is explicitly the sole manual exception (plan 07,
  justified with concrete asserted command outputs).
- Sampling continuity holds — no 3 consecutive tasks without an automated verify; wave 6 (07,
  manual) is preceded by wave 5 (06, both rows automated).
- Wave 0 list matches the per-task map's `❌ W0` markers for genuinely new files
  (`chunk-provenance.test.ts`, `chunk-provenance-status.test.ts`, plus the citation-token and
  ambiguous-slice fixtures).
- Tiering is honest: the "What This Phase Can and Cannot Validate" table explicitly states
  contract tests on skill text prove existence only, and the plan text in 171-06 makes the
  identical claim verbatim. No plan's `must_haves.truths` or acceptance criteria claim more than
  that — the 171-06 truths ("Both close paths invoke...", "reports drift by formatting...") are
  textual/structural assertions about the skill files, not live-session behavior claims.
- Known Unvalidated lists exactly the two risks 171-06's own objective section names (close-step
  skip risk from Phase 170; the still-unexercised `ingest-check` Step 0 call) — consistent, not
  overclaiming, not hiding anything.

**Minor inconsistency (not blocking):** the per-task map's row for the new ordinal-citation
drift-guard test marks `build-chunk.test.ts` as `❌ W0`, but that file already exists (it has
`five-item` pins today at lines 745/747) and is not in the Wave 0 Requirements list — only the two
genuinely new test files and the fixtures are. This is a labeling slip in the map, not a missing
test or a broken gate; the drift-guard test is being added to an existing file, which needs no
Wave 0 scaffolding. **WARNING**, cosmetic.

### Blocker 2 re-check — ordinal cross-references — CLOSED

Verified against the live file (pre-execution state, as expected):

```
$ grep -n 'Bookkeeping Sequence.*item 4\|consistency-check item 4' src/cli/slash-command/bs/state-machine.md
46:(SKILLAUTO-08, see `build/close.md` "Bookkeeping Sequence" item 4), and — as the
113:`build/close.md`'s ledger-reconciliation step (Bookkeeping Sequence item 4) re-touches that
142:- **Staleness criterion** (evaluated by consistency-check item 4): a lock is **stale** when its
```

This confirms the plan's factual premise exactly: lines 46 and 113 both cite the OLD ordinal for
ledger reconciliation, and line 142's "consistency-check item 4" is a different, unrelated
sequence (lock staleness, not Bookkeeping Sequence) — matching the plan's explicit instruction not
to touch it.

`171-06-PLAN.md` Task 2 now:
- Names both `state-machine.md:46` and `:113` explicitly and requires both become item 5.
- Explicitly protects `state-machine.md:142` by name, stating it is a different sequence and must
  not be renumbered.
- Adds acceptance criteria that are checkable as written: `grep -n 'Bookkeeping Sequence.*item 4'
  src` returns nothing after the edit (verified the current live grep would in fact hit the two
  target lines pre-edit, so the criterion is meaningful, not vacuous); `grep -c 'Bookkeeping
  Sequence.*item 5' state-machine.md` returns 2 (verified both current lines match the same regex
  shape with `item 4`, so the post-edit `item 5` substitution will produce the same match count);
  `grep -n 'consistency-check item 4' state-machine.md` still returns *a* hit for that string
  (content-level check is sound).
- Adds a new derived-numbering drift-guard test to `build-chunk.test.ts`: parses close.md's actual
  numbered list and validates every `Bookkeeping Sequence ... item N` citation under
  `src/cli/slash-command/bs/` against it, specified with a concrete, checkable acceptance bar
  ("the test fails if an ordinal is renumbered without updating its citations") — this is
  executable, not hand-wavy. The plan's looser language about matching "the duty the citing
  sentence describes" is aspirational elaboration on top of that concrete bar, not a substitute
  for it; an implementer has a clear pass/fail target even if the "duty match" heuristic ends up
  simple (e.g., keyword match on the item's bold title). Not brittle in the false-failure sense —
  it fires only when close.md's actual numbering and a citation diverge, which is exactly the
  class of edit that should fail it.

**One brittle acceptance criterion (not blocking, worth a note to the executor):** the criterion
"`grep -n 'consistency-check item 4' ... still returns line 142`" ties correctness to an absolute
line number. Task 2 also asks to "add the provenance duty to the list [state-machine.md] already
gives" in the *same paragraph* as line 46 (lines 41-48) — if that addition inserts new lines above
line 142, the line number will shift even though the content is untouched and correct. The
content-based check (`grep -n 'consistency-check item 4'` finds a match at all, still says "item
4") is what actually matters and remains sound regardless of line drift; the specific "line 142"
part of this one bullet could produce a false read on a line-number diff even though the edit is
correct. **WARNING**, recommend the executor treat the line-142 assertion as informational only,
not as a fail condition, if the duty-enumeration edit shifts subsequent line numbers.

### New-problem scan

- Task 2's other acceptance criteria (five-item→six-item pins, `chunk-check` presence,
  `playtest.md` non-duplication) are unchanged from what passed before and were not disturbed by
  this revision.
- No new scope creep, no new deferred-idea inclusion, no new dependency/wave change — 171-06 is
  still wave 5, `depends_on: [171-04, 171-05]`, unchanged.
- VALIDATION.md's per-task map does not misstate any wave or requirement for any plan (spot
  checked 01, 05, 06, 07 against their frontmatter) beyond the cosmetic W0 label noted above.

### Verdict

Both blockers are closed with concrete, checkable evidence, not just documentation. Two new
non-blocking warnings identified (VALIDATION.md's cosmetic W0 mislabel on an existing test file;
one line-number-dependent acceptance criterion that should be read as content-based, not
line-based, if earlier edits in the same task shift line numbers). Neither disqualifies execution.

## PLAN CHECK PASSED
