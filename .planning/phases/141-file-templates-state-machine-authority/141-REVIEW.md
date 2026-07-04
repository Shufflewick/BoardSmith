---
phase: 141-file-templates-state-machine-authority
reviewed: 2026-07-04T19:20:00Z
depth: standard
iteration: 2
files_reviewed: 8
files_reviewed_list:
  - src/cli/slash-command/bs/state-machine.md
  - src/cli/slash-command/bs/templates/SKETCH.template.md
  - src/cli/slash-command/bs/templates/CHUNK.template.md
  - src/cli/slash-command/bs/templates/RULINGS.template.md
  - src/cli/slash-command/bs/templates/DECISIONS.template.md
  - src/cli/slash-command/bs/templates/DESIGN.template.md
  - src/cli/slash-command/bs/templates/ASSETS.template.md
  - src/cli/slash-command/bs/templates.test.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 141: Code Review Report — Iteration 2

**Reviewed:** 2026-07-04T19:20:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Re-review after fix commits db70239e..8ff281c5. All nine iteration-1 findings in fix scope are verified resolved:

- **CR-01 fixed** — CHUNK.template.md's parse contract now lists `## Newly Discovered Citations` (line 16), and the new heading-list drift tests (`EXPECTED_HEADINGS`, templates.test.ts:283-336) pin both the shipped headings and the contract enumeration in order, making the CR-01 defect class structurally impossible to reintroduce silently.
- **CR-02 fixed** — consistency-check item 1 (state-machine.md:76-81) exempts tail entries via the machine-distinguishable marker `Status: proposed (sketch-level — no CHUNK.md yet)`; SKETCH.template.md's tail-entry form (line 79) uses exactly that marker and documents the rewrite-to-derived-form-on-detailing lifecycle (lines 68-74).
- **WR-01 fixed** — all six templates now reference state-machine.md logically ("installed alongside the bs- skills themselves; the skill instructions state its installed location") and cross-reference instantiated names (`DESIGN.md`, `ASSETS.md`), with the copy-would-drift decision recorded.
- **WR-02 fixed** — light-path transitions defined (state-machine.md:37-41: `proposed → built` directly, proposal acceptance as the ask-equivalent gate; `approved` unreachable); CHUNK.template.md's CEREMONY-CONDITIONAL comment (lines 43-52) makes the light checklist filling, not restructuring.
- **WR-03 fixed** — cutover now "explicitly flips **all** previously verified chunks back to `built`" (state-machine.md:97), matching the plan (bs-skills-plan.md:115); SKETCH.template.md:41-44 repeats the aligned form.
- **WR-04 fixed** — `close` assigned to handoff group 4 with rationale (state-machine.md:137-143). See WR-02 below: the plan was not updated to match.
- **WR-05 fixed** — 24-hour staleness criterion with same-chunk resume exemption (state-machine.md:103-109). See IN-05 for a residual precedence ambiguity.
- **WR-06 fixed** — parse contract scopes status carriage to CHUNK.md + SKETCH.md only (state-machine.md:62-66); the two SKETCH grammar forms are machine-distinguishable via the `(derived from ...)` qualifier; consistency-check item 3 enumerates all three recognized value classes including the stale and sketch-level markers.
- **WR-07 fixed** — enum lines derived from a single `STATUS_ENUM_VALUES` source of truth and pinned verbatim in both state-machine.md and both templates; ASSETS header row pinned as one exact string; `Sketch Version:` / `Session Lock:` / stale-marker / sketch-level-marker anchors asserted; parse-contract heading lists verified against actual H2s. Suite grew 27 → 41 tests, all passing (verified by running it).

The specific new-issue vectors flagged for this iteration were checked: the new sketch-level status form does not collide with the pinned enum lines (it is asserted as its own exact string, test line 144, and the enum-line pins are unaffected), and the two SKETCH grammar forms are correctly reconciled with consistency-check items 1 and 3. However, the fixes surfaced three new issues: the light path has no `close`, so nothing prescribes recording a light chunk's verified commit hash (WR-01); the plan document now contradicts the fixed authority doc in two places (WR-02); and the new grammar strings are pinned only on the template side, not in state-machine.md (WR-03). Three iteration-1 Info items were outside fix scope and remain open (IN-01..03).

## Warnings

### WR-01: Light-path chunks never run `close` — no prescribed mechanism records their verified commit hash or performs the close-owned writes

**File:** `src/cli/slash-command/bs/state-machine.md:29-41` (light path) vs `:111-116` (Git Protocol) and `:137-143` (handoff group 4)
**Issue:** The WR-02 fix defines light-path status transitions, ending "it then moves `built → verified` ... at `playtest` exactly as a full-ceremony chunk does." Two problems. (1) In the full ceremony, the verified transition and its bookkeeping belong to `close`, not `playtest` (plan step 10: "close — mark verified in CHUNK.md then SKETCH.md, tag/record the verified commit hash, roll up decisions"; state-machine.md:116 and :141-142 agree) — so "exactly as a full-ceremony chunk does" points at the wrong step. (2) More materially: the Git Protocol ties verified-commit-hash recording exclusively to `close` ("`close` records the verified commit hash in CHUNK.md — this is the bisect anchor..."), and the light path (`build, test, playtest`) contains no `close`. A literal session finishing a light chunk's playtest has no rule telling it to record the hash, fill `## Verified Commit Hash` in CHUNK.md, update the SKETCH.md derived pointer, or roll up decisions — leaving light chunks permanently without bisect anchors and potentially with a CHUNK/SKETCH status divergence that the next entry's consistency check flags as a contradiction.
**Fix:** In the "Step Names (exact, light path)" section, add one sentence: "For light chunks, the `playtest` step also performs `close`'s bookkeeping: it records the verified commit hash in CHUNK.md, updates the Status line (CHUNK.md first, SKETCH.md second per Write Order), and rolls up decisions." Alternatively define the light path as `build, test, playtest, close` — but that changes the pinned step-name string the drift test and plan both carry, so the first option is cheaper.

### WR-02: Fixes resolved contradictions in state-machine.md but left `.planning/bs-skills-plan.md` contradicting it in two places

**File:** `.planning/bs-skills-plan.md:47,147` vs `src/cli/slash-command/bs/state-machine.md:76-81,137-143`
**Issue:** The plan is the canonical design doc that phases 142+ (the skill instructions themselves) will be authored from. Two of its statements now contradict the fixed authority doc:
1. Plan line 47: "every sketch slug has a directory" — the unqualified pre-CR-02 form. State-machine.md now exempts sketch-level tail entries. A skill author following the plan reintroduces the guaranteed-false-positive consistency check CR-02 fixed.
2. Plan line 147: session step groups "{investigate + redteam + ask}, {build + test}, {audit + repair}, {playtest + one revise round}" — `close` unassigned, the exact WR-04 defect, now resolved only on the state-machine.md side (group 4 = `{playtest, one revise round, close}`).
State-machine.md line 3 says skills "cite this file rather than restating its rules," which mitigates — but only if later phases author from state-machine.md rather than the plan; the plan's Hard Rules section is written as requirements skill authors transcribe.
**Fix:** Update plan line 47 to "every sketch slug with a detailed entry has a directory (sketch-level tail entries exempt)" and plan line 147's group 4 to "{playtest + one revise round + close}". One-line edits each; keeps the plan usable as authoring source for phases 142+.

### WR-03: New grammar strings pinned only on the template side — state-machine.md's copies can drift silently

**File:** `src/cli/slash-command/bs/templates.test.ts:136-145` vs `src/cli/slash-command/bs/state-machine.md:66,77,85`
**Issue:** The CR-02/WR-06 fixes introduced two grammar strings that now appear in *both* SKETCH.template.md and state-machine.md and must stay byte-identical for the exemption/parse logic to work: the sketch-level marker `Status: proposed (sketch-level — no CHUNK.md yet)` (state-machine.md lines 66 and 85; SKETCH.template.md line 79) and the derived-pointer qualifier grammar `Status (derived from chunks/<slug>/CHUNK.md):` (state-machine.md lines 65 and 77; SKETCH.template.md lines 57/65). The drift test pins both strings in SKETCH.template.md only (lines 143-144 pin the sketch-level marker; nothing pins the derived-form grammar anywhere). If a future edit rewords state-machine.md's copy (e.g. em-dash → hyphen in the sketch-level marker, or "derived from" → "from"), a session validating a real SKETCH.md against state-machine.md's consistency check no longer matches files written from the template — the exact silent-drift class this suite exists to catch (same class as iteration-1 WR-07, which the suite header explicitly claims to prevent). Also unpinned: CHUNK.template.md's `## Ceremony` valid values `full | light`, which the ceremony-conditional checklist logic depends on.
**Fix:** Hoist both strings to consts (like `STALE_MARKER`) and assert each appears in *both* state-machine.md and SKETCH.template.md; add a `full | light` assertion for CHUNK.template.md. ~6 lines of test.

## Info

### IN-01: (carried from iteration 1, outside fix scope) ASSETS.template.md misquotes Write Order as "state files are append-only" while its own workflow mutates rows

**File:** `src/cli/slash-command/bs/templates/ASSETS.template.md:32-34`
**Issue:** Unchanged from iteration 1: the comment cites "state files are append-only per state-machine.md 'Write Order'," but Write Order makes only *round entries* append-only, and the ledger's design requires flipping `requested`/`received`/`placeholder-in-use` cells in place. A literal session could refuse to update a row when an asset arrives.
**Fix:** Reword: "Rows are never deleted or reordered; cell values are updated in place as the asset's state changes."

### IN-02: (carried from iteration 1, outside fix scope) RULINGS parse-contract shorthand "Citation" doesn't match the actual field name

**File:** `src/cli/slash-command/bs/templates/RULINGS.template.md:30` vs `:37-39`
**Issue:** Unchanged: contract says entries carry "Decision / Citation / Rationale" but the field is `Citation interpreted or overridden`. A validator checking for `- Citation:` fails every correct entry.
**Fix:** Use the full field name in the parse-contract comment.

### IN-03: (carried from iteration 1, outside fix scope) Restyle/Cutover rule silent on `verified (user-waived)` chunks

**File:** `src/cli/slash-command/bs/state-machine.md:97`
**Issue:** Unchanged: "flips all previously verified chunks back to `built`" — whether `verified (user-waived)` chunks also flip is unstated; a literal reading of "verified" excludes them, though their waived scripts are equally invalidated.
**Fix:** Add: "This applies to both `verified` and `verified (user-waived)` chunks."

### IN-04: Parse-contract lead sentence's grammar pattern doesn't literally match two of the three forms its own bullets define

**File:** `src/cli/slash-command/bs/state-machine.md:62`
**Issue:** New wording from the WR-06 fix: "Where a status is carried, it lives on one line matching `Status: <enum-value>` (case-sensitive)". The bullets that follow then define the actual forms — and two of the three don't match that pattern: the SKETCH derived form inserts a qualifier before the colon (`Status (derived from ...): <enum-value>`), and the tail form's value, `proposed (sketch-level — no CHUNK.md yet)`, is not an enum value. The bullets are correct and machine-distinguishable, so a reader who reaches them gets it right; but a literal validator implementing the lead sentence's pattern rejects every valid SKETCH.md. Low risk since the bullets immediately qualify, but this section exists precisely for literal-minded validation.
**Fix:** Reword the lead: "Where a status is carried, it lives on one line whose exact grammar its template documents — one of the three forms below."

### IN-05: 24h staleness rule and same-chunk resume exemption overlap on the most common crash-recovery case

**File:** `src/cli/slash-command/bs/state-machine.md:103-109`
**Issue:** New wording from the WR-05 fix defines three lock categories: (a) >24h old → stale, report, user confirms clearing; (b) same chunk as the entering session → not stale, silently refresh and continue; (c) "any other lock (less than 24 hours old, naming different work)" → live-session warning. A lock that is *both* >24h old *and* names the chunk being resumed — i.e., "session crashed yesterday mid-chunk, user resumes today," arguably the most common recovery scenario — matches (a) and (b) with contradictory behaviors (confirm-to-clear vs silent refresh). Category (c)'s parenthetical implies (b) covers any age, but that's inference, not statement. Both paths converge on continuing safely, so this is precedence ambiguity, not a hazard.
**Fix:** Add one clause to (b): "A lock naming the same chunk the entering session is resuming is not stale *regardless of age*..."

### IN-06: state-machine.md cites "the plan" — a document not shipped with the skills

**File:** `src/cli/slash-command/bs/state-machine.md:97`
**Issue:** "...no prior verification survives, per the plan's UI-strategy rule." The plan (`.planning/bs-skills-plan.md`) exists only in this repo; a session reading the installed state-machine.md in a game project cannot resolve "the plan." It's a rationale citation rather than an actionable reference (WR-01's fixed class was actionable "See ../..." pointers), so impact is low — but the rule should stand on its own authority.
**Fix:** Drop the citation: end the sentence at "the entire presentation changed, so no prior verification survives."

---

_Reviewed: 2026-07-04T19:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (iteration 2, fix verification + new-issue sweep)_
