---
phase: 146-bs-build-chunk-playtest-revise-close-final-acceptance
reviewed: 2026-07-05T01:02:29Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/cli/slash-command/bs/build/playtest.md
  - src/cli/slash-command/bs/build/revise.md
  - src/cli/slash-command/bs/build/close.md
  - src/cli/slash-command/bs/build/final-acceptance.md
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build-chunk.test.ts
findings:
  critical: 3
  warning: 4
  info: 2
  total: 9
status: issues_found
---

# Phase 146: Code Review Report

**Reviewed:** 2026-07-05T01:02:29Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 146 authored the final step group (`playtest`/`revise`/`close`) and `final-acceptance.md`,
and retired the forward-reference markers in `build-chunk.md`, completing the 10-step engine. The
drift-protection test suite passes and the surface-level requirements are met: the 7-point design-QA
pass is complete, dev-host CLI claims (`--players`, `--ai`, `--no-open`, the `Ready! Press Ctrl+C to
stop.` ready-string) all verify against `src/cli/commands/dev.ts`/`cli.ts`, `useAnnouncer()` and the
`BREAKPOINTS` (640/1024/1440) citations resolve, `playtest.md` correctly asserts the user owns the
server and that no build-stamp UI exists (freshness = hard reload), and `final-acceptance.md`'s
automated portion correctly starts and kills its own server.

However, walking the full lifecycle end-to-end surfaces **three orchestrator-coherence blockers** that
the string-matching test suite cannot catch, all around the `final-acceptance` chunk and the
light-path/close bookkeeping seam, plus contradictions with `state-machine.md` and the templates the
new files fill. These are exactly the class of defect the phase brief asked to verify ("whether the
now-complete orchestrator is internally coherent end-to-end"). The router is NOT yet coherent for the
final-acceptance chunk or the light-path close.

## Critical Issues

### CR-01: `build-chunk.md` has no routing rule to dispatch `final-acceptance.md` — the router can never reach it on resume

**File:** `src/cli/slash-command/bs/build-chunk.md:70-100, 214-245, 309-311`
**Issue:** `final-acceptance.md` is only ever named in `build-chunk.md`'s **Reference Files** list
(line 309). None of the router's actual routing logic — Step 2 "Resume Routing", Step 3 "Ceremony
Routing", the Full-ceremony dispatch table (lines 116-130), or "Step Group 4 Dispatch" (lines
214-245) — contains any rule for detecting that the resume target is the sketch's mandated
final-acceptance chunk and dispatching `build/final-acceptance.md` instead of the ordinary
`playtest`. Step 2 routes strictly to "the first incomplete step on its Step Checklist," and the
CHUNK.template.md checklist has no `final-acceptance` step. The only place that says "dispatch
`build/final-acceptance.md` instead" is `close.md:99-100`, which fires when the *previous* chunk
closes and proposes the next one — it does not help a **cold session that resumes directly into the
final-acceptance chunk**. Such a session will route to a normal checklist step and run the
final-acceptance chunk as an ordinary chunk, never dispatching `final-acceptance.md`. The
drift-protection test only asserts the string `build/final-acceptance.md` appears somewhere in
`build-chunk.md` (test lines 730-735), which the Reference-Files mention satisfies — so the suite is
green while the router is incoherent.
**Fix:** Add an explicit routing rule to `build-chunk.md` Step 2 / Step Group 4: when the resume
target chunk is the sketch's `## Mandated Chunks` final-acceptance chunk, dispatch
`build/final-acceptance.md` in place of (or ahead of) the normal group-4 `playtest` dispatch,
regardless of which step the checklist points at. State how the final-acceptance chunk's Step
Checklist is shaped (it is neither the plain `full` nor `light` list the template ships), since
resume routing keys on that checklist.

### CR-02: `build-chunk.md` says final-acceptance runs "in place of" `{playtest, revise, close}`; `final-acceptance.md` says it runs "on top of" — direct contradiction

**File:** `src/cli/slash-command/bs/build-chunk.md:309-311` vs. `src/cli/slash-command/bs/build/final-acceptance.md:5-10, 132-138`
**Issue:** `build-chunk.md:310` states `final-acceptance.md` is "run **in place of** a normal chunk's
`{playtest, revise, close}` group." `final-acceptance.md:6` states the "`{playtest, revise, close}`
step group ... **still applies** to it once its own content below is done," and `final-acceptance.md:135`
states "this chunk still runs the standard `{playtest, revise, close}` semantics **on top of** this
content." These are mutually exclusive: the router tells the reader the design-QA pass *replaces* the
group; the reference file tells the reader the group *still runs after* the design-QA content. An
orchestrator following `build-chunk.md` would skip the human playtest/close of the finished game
entirely; one following `final-acceptance.md` would run the coverage/design-QA content and then also
do the full playtest→revise→close. The final-acceptance chunk is the sketch's definition of "done,"
so getting its lifecycle wrong is a data/behavior blocker.
**Fix:** Pick one model and make both files agree. `final-acceptance.md`'s "on top of" model is the
coherent one (the human must still playtest the finished game and `close` must still record the
verified hash and tail delta). Rewrite `build-chunk.md:310` to: "run *as the content of* a normal
chunk's `{playtest, revise, close}` group — its coverage check and 7-point design-QA pass supply that
chunk's playtest script; the standard playtest/revise/close semantics still run on top."

### CR-03: `build-chunk.md` and `playtest.md` misattribute "detail the next 2-3 sketch-tail entries" to `close.md`'s `## Bookkeeping Sequence`, which does not contain it — and this contradicts `state-machine.md`

**File:** `src/cli/slash-command/bs/build-chunk.md:149-152` and `src/cli/slash-command/bs/build/playtest.md:117-124`
**Issue:** Both files tell a light-path chunk to perform "close's bookkeeping," and both explicitly
list "detailing the next 2-3 sketch-level tail entries" as part of it, citing
`close.md`'s `## Bookkeeping Sequence` **by name** as the source
(`build-chunk.md:149-150`; `playtest.md:121-122` — "see `build/close.md`'s `## Bookkeeping Sequence`
by name for the verified-hash capture, Status write order, decision rollup, and next-2-3 sketch-tail
detailing"). But `close.md`'s `## Bookkeeping Sequence` (lines 18-46) is a **self-contained** 3-step
sequence — (1) status already landed, (2) record verified hash, (3) roll up decisions — and contains
**no** tail-detailing. `close.md:20` even declares it "A self-contained numbered sequence" to scope
exactly what the light path reuses. Tail re-derivation lives in a *separate* section, `close.md`'s
`## Sketch-Tail Delta Gate` (lines 48-83), which is a **user-gated** operation not part of the
Bookkeeping Sequence. Worse, the authoritative `state-machine.md:42-44` light-path description lists
only the same 3 items (verified hash, Status update, decision rollup) and deliberately omits tail
detailing. So `build-chunk.md`/`playtest.md` both (a) point the executor at a named section that does
not contain the promised content, and (b) contradict the state-machine authority by adding a fourth
light-path duty. A light-path session following the citation finds no tail-detailing instructions and
either skips it or improvises.
**Fix:** Remove "and detailing the next 2-3 sketch-level tail entries" from `build-chunk.md:149-150`
and the "next-2-3 sketch-tail detailing" clause from `playtest.md:122`, so the light-path close
bookkeeping matches `state-machine.md:42-44` and `close.md`'s actual `## Bookkeeping Sequence` (three
items). If light-path chunks *are* intended to re-derive the tail, instead add that duty explicitly
to `close.md`'s `## Bookkeeping Sequence` and to `state-machine.md`'s light-path transitions — do not
leave the router claiming a section contains something it does not. (`build-chunk.md:152`'s "Step 2's
lazy tail-entry detailing covers any entry this bookkeeping misses" only partially mitigates and does
not excuse the false citation.)

## Warnings

### WR-01: `build-chunk.md:309` says "6-point check" but `final-acceptance.md` is a **7-point** design-QA pass

**File:** `src/cli/slash-command/bs/build-chunk.md:309`
**Issue:** The Reference-Files entry describes `final-acceptance.md` as "the sketch's mandated-chunk
design-QA pass (**6-point check** + fresh-context automatable-checks dispatch)." The file itself is
titled "**7-Point** Design-QA Pass" (`final-acceptance.md:1, 23`) and enumerates seven checks
(screen-reader, 200% zoom, touch targets, colorblind, both themes, drag-drop keyboard alternates,
mobile). The plan's UI design-QA chunk (`bs-skills-plan.md:135`) also lists all seven. The "6-point"
count is a stale/incorrect number.
**Fix:** Change "6-point check" to "7-point check" in `build-chunk.md:309`.

### WR-02: `revise.md`'s 4-category triage contradicts `CHUNK.template.md`'s Revision-Rounds comment (3 categories; category (c) recorded as "refuted")

**File:** `src/cli/slash-command/bs/build/revise.md:9-39` vs. `src/cli/slash-command/bs/templates/CHUNK.template.md:113-117`
**Issue:** `revise.md` defines the four triage categories from the plan (`bs-skills-plan.md:94`):
(a) this-chunk defect, (b) future scope, (c) **not-built-yet → expectation reset, no write is made**
(`revise.md:26-29`: "no write is made — there is nothing to record"), (d) rules change → RULINGS.md.
But `CHUNK.template.md:116-117` — the section `revise.md` fills — describes a **three**-category
triage: "category (a) fix now (recorded here), category (b) future scope (goes to SKETCH.md's Ideas
Backlog instead), category (c) not a real issue (**recorded here as refuted**)." The template's
category (c) says to *write a refuted entry*; `revise.md`'s category (c) says to write *nothing*, and
the template has no (d) rules-change category at all. An executor filling the template while following
`revise.md` gets conflicting instructions about whether category-(c) feedback produces a Revision-
Rounds entry. `revise.md` matches the plan and is the correct one; the template comment is stale.
**Fix:** Update `CHUNK.template.md`'s `## Revision Rounds` comment (lines 113-117) to describe the
four categories `revise.md`/the plan define — (a) recorded here, (b) → Ideas Backlog, (c) not-built-yet
= expectation reset, no write, (d) rules change → RULINGS.md — so the template and `revise.md` agree.

### WR-03: "one revise round" session-group cap contradicts the unbounded `revise-2, revise-3, …` loop both files describe

**File:** `src/cli/slash-command/bs/build-chunk.md:214, 232-237` and `src/cli/slash-command/bs/build/revise.md:73-74`
**Issue:** The session-handoff seam and the Step Group 4 header both name the group
`{playtest, **one revise round**, close}` (`build-chunk.md:214`; `state-machine.md:140,143` "at most
one revise round"). But the revise prose describes an in-session loop of arbitrarily many rounds:
`revise.md:73-74` "appending `revise-2`, `revise-3`, and so on as needed, until every (a)-item across
all rounds has a recorded disposition," and `build-chunk.md:236-237` "Revise loops back to `playtest`
... until every this-chunk-defect item has a recorded disposition." Within a single session,
"one revise round" and "loop revise-2/revise-3 until done" cannot both hold. This ambiguity affects
where the structural session budget forces a handoff.
**Fix:** Reconcile the two. Either (a) state that additional revise rounds beyond the first cross a
session seam (hand off after `revise-1`, resume for `revise-2`), or (b) if multiple rounds are allowed
in one session, change the group label everywhere to `{playtest, revise (loop), close}` and drop the
"one revise round" cap from `state-machine.md:140,143` and `build-chunk.md:214`. Do not leave the cap
and the unbounded loop both asserted.

### WR-04: `close.md`'s light-path reuse contract is undermined by CR-03's over-claim, leaving the light path's tail handling genuinely undefined

**File:** `src/cli/slash-command/bs/build/close.md:18-46, 48-91`
**Issue:** `close.md` deliberately splits its work so the light path reuses only the 3-step
`## Bookkeeping Sequence` and *not* the user-gated `## Sketch-Tail Delta Gate` / `## Propose the Next
Chunk` sections. That is a defensible design — but combined with CR-03 (the router insisting the
light path *does* detail the tail) it produces a genuine gap: on the light path there is no gate that
re-derives or proposes the next chunks, yet `build-chunk.md:151` promises the user tail entries get
detailed. A light-path chunk can therefore close leaving the sketch tail undetailed with no proposal
of the next chunk to the user, contrary to the "every session ends by printing what to run next"
principle (`bs-skills-plan.md:52`).
**Fix:** Decide explicitly whether a light-path chunk proposes the next chunk / details the tail. If
yes, factor a minimal "propose next chunk" step into the light-path close and cite it accurately; if
no, remove the tail-detailing claim (per CR-03) and state that light-path chunks defer tail
re-derivation to the next full chunk's `close` or to Step 2's lazy detailing.

## Info

### IN-01: `playtest.md`/`revise.md`/`close.md` cite "`build-chunk.md` Step 8/9/10", but `build-chunk.md` has no such numbered headings

**File:** `src/cli/slash-command/bs/build/playtest.md:3`, `src/cli/slash-command/bs/build/revise.md:3`, `src/cli/slash-command/bs/build/close.md:3`
**Issue:** Each reference file opens "Referenced by `build-chunk.md` Step 8/9/10." `build-chunk.md`'s
actual headings are `Step 0`–`Step 3` then `Step Group 1`, `Step Groups 2-3`, `Step Group 4` — there
is no heading literally named "Step 8/9/10." The intent (pipeline-step ordinal) is recoverable and
mirrors the established `build.md`/`test.md`/`audit.md`/`repair.md` convention (`build-chunk.md:209`),
so this is not a functional break — but a reader cross-referencing by heading finds no target.
**Fix:** Consider "Referenced by `build-chunk.md` Step Group 4 (`playtest`, pipeline step 8)" for
unambiguous back-references, or add pipeline-step ordinals to `build-chunk.md`'s group headings.

### IN-02: `final-acceptance.md` splits the 7 checks 5+2 by "Claude's Discretion" — the canonical/agent numbering is easy to desync

**File:** `src/cli/slash-command/bs/build/final-acceptance.md:24-61, 63-120`
**Issue:** Checks are enumerated 1-7 in canonical order, then re-partitioned as "agent-dispatched
(checks 2, 3, 5, 6, 7)" and "human-narrated (checks 1, 4)," and the Dispatch Template re-numbers the
same five checks 1-5. The mapping is currently correct (dispatch 1-5 = canonical 2,3,5,6,7), but three
different numberings for the same seven items is fragile: a future edit that inserts or reorders a
canonical check will silently desync the "(checks 2,3,5,6,7)" list and the dispatch template's 1-5,
with nothing pinning the correspondence. The drift test (test lines 634-673) checks phrases, not the
partition arithmetic.
**Fix:** Reference the checks by name rather than re-numbering in the partition and dispatch template
(e.g. "agent-dispatched: 200% zoom, compact touch targets, both themes, drag-drop keyboard, mobile"),
so a reorder cannot silently break the mapping.

---

## Narrative Findings (AI reviewer)

All nine findings above are narrative findings from direct end-to-end review of the completed
orchestrator. No structural-findings substrate was supplied with this review. The lifecycle walks
performed:

- **Full-ceremony chunk (fresh → 10 steps → close → next):** coherent through group 3; group 4
  (`playtest → revise → close`) is internally coherent for an ordinary chunk **except** WR-03's
  "one revise round" vs. unbounded-loop ambiguity.
- **Light path (`build, test, playtest`):** playtest-as-terminal correctly performs close bookkeeping,
  but CR-03/WR-04 leave its sketch-tail handling contradictory (router promises tail detailing the
  cited `close.md` section does not provide, and which `state-machine.md` omits).
- **Final-acceptance chunk:** two blockers — the router has no rule to dispatch `final-acceptance.md`
  on resume (CR-01), and the router vs. the reference file disagree on whether `{playtest, revise,
  close}` runs "in place of" or "on top of" the design-QA content (CR-02), plus the "6-point" count
  error (WR-01).

Verified as CORRECT (no defect): dev-host CLI flags `--players`/`--ai`/`--no-open` and the
`Ready! Press Ctrl+C to stop.` ready-string (`dev.ts:780-791`, `cli.ts:36-40`); the no-build-stamp-UI
/ hard-reload freshness handling in `playtest.md`; the user-owns-the-server boundary in `playtest.md`
vs. final-acceptance's own serve/kill; all 7 design-QA checks present; `useAnnouncer()`,
`BREAKPOINTS` (640/1024/1440), and the `build/test.md` item-1 and `design-review.md` section
citations all resolve on disk.

---

_Reviewed: 2026-07-05T01:02:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
