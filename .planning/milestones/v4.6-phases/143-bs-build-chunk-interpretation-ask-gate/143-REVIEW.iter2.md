---
phase: 143-bs-build-chunk-interpretation-ask-gate
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build/investigate.md
  - src/cli/slash-command/bs/build/redteam.md
  - src/cli/slash-command/bs/build/ask.md
  - src/cli/slash-command/bs/build-chunk.test.ts
findings:
  critical: 2
  warning: 7
  info: 5
  total: 14
status: issues_found
---

# Phase 143: Code Review Report

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 143 authored the `/bs-build-chunk` orchestrator, its three group-1 reference files (investigate/redteam/ask), and the drift test. The files are largely faithful to `state-machine.md` (status enum, light-path transitions, session-lock outcomes, escalation bounds are all quoted or cited correctly), and the redteam dispatch templates correctly exclude investigator framing.

However, walking the group-1 flow end-to-end surfaces two blocking defects: (1) the claims list has **no sanctioned channel** from investigate to redteam/ask — investigate's return shape deliberately withholds the full text while the orchestrator is simultaneously forbidden from reading `CHUNK.md`'s `## Interpretation`, yet redteam's dispatch templates and ask's presentation both require the full numbered list; (2) **no group-1 step persists its completion state** — nothing instructs checking off Step Checklist items or writing redteam verdicts durably, so the "first incomplete step" resume routing has no state to route on, violating the plan's "every step writes its results to CHUNK.md before the next step starts" hard rule.

## Critical Issues

### CR-01: The claims list has no sanctioned channel from investigate to redteam/ask — group 1 is unexecutable as written

**File:** `src/cli/slash-command/bs/build/investigate.md:85-95, 110-116, 124` / `src/cli/slash-command/bs/build/redteam.md:27-31, 53, 67` / `src/cli/slash-command/bs/build/ask.md:12-14, 23-25` / `src/cli/slash-command/bs/build-chunk.md:121-123`
**Issue:** Three mutually contradictory statements make the within-session flow impossible:

1. `redteam.md` requires the orchestrator to construct 3 dispatch prompts each containing `{numberedClaimsList}` — "the numbered claims list text" (lines 27-31, 53, 67). `ask.md` requires presenting "every claim from CHUNK.md's `## Interpretation` restated in the register a designer would use" (line 23-25) — the ask step has no subagent, so the orchestrator itself needs the full text.
2. `investigate.md` deliberately withholds that text from the orchestrator: `claimsList` is "a short pointer/count summary, e.g. '7 claims written, see ## Interpretation'" (line 85-87), and "What flows back to the orchestrator is the short structured return above — never the full claims text" (lines 91-93).
3. All three files (investigate.md lines 110-116, redteam.md lines 14-17, build-chunk.md lines 121-123) forbid the orchestrator from reading `CHUNK.md`'s `## Interpretation` after the subagent writes it.

Since investigate/redteam/ask run in a **single session** (group 1, `state-machine.md` "Session Handoff Seams"), the orchestrator has no legal way to obtain the claims list it must hand to redteam and present at ask. Additionally, `investigate.md:124` ("`redteam.md` and `ask.md` read directly from CHUNK.md") contradicts `redteam.md`'s own mechanism (prompt contains only slice paths + claims list text) — the two files disagree on the transport.

This also over-tightens the plan and the phase's own decisions: `.planning/bs-skills-plan.md` §Subagent discipline scopes the orchestrator ban to "rulebook slices, BoardSmith docs, and generated code" and explicitly makes "read state files" the orchestrator's job (CHUNK.md is a state file per the Durable Artifacts table); `143-CONTEXT.md` pins "3 fresh subagents receive raw slice paths + the numbered claims list" — presuming the orchestrator holds that list.

**Fix:** Pick one channel and align all three files. Either (a) define investigate's `claimsList` return field as the full numbered claims text (it is a distilled list, not a slice — passing it back is exactly what the plan's "subagents return conclusions" rule intends), or (b) explicitly carve out CHUNK.md's `## Interpretation`/`## Visibility Declaration` as orchestrator-readable state (per the plan's "read state files" job description), keeping the ban scoped to slices/docs/code. Then delete or correct `investigate.md:124`'s "read directly from CHUNK.md" claim so it matches `redteam.md`'s prompt-embedding mechanism.

### CR-02: No group-1 step persists completion state — resume routing has nothing to route on, and redteam verdicts are lost on crash

**File:** `src/cli/slash-command/bs/build-chunk.md:53-54, 144-146, 208-210` / `src/cli/slash-command/bs/build/redteam.md:97-99` / `src/cli/slash-command/bs/templates/CHUNK.template.md:37-63, 86-91`
**Issue:** Step 2 routes to "the **first incomplete step** on its Step Checklist," and the template says "Check off a step only when it is fully complete" — but **no authored file ever instructs anyone to check off a step**. The investigate subagent writes only its three sections; redteam writes nothing durable (Vote-Privacy holds verdicts "internal signal the orchestrator holds"); ask writes rulings/assets/`Status: approved` but is never told to tick its checkbox. Consequences:

- A cold resume mid-group-1 (crash after investigate, or after redteam) finds all checkboxes unchecked and re-runs investigate from scratch — appending a duplicate claims list to the append-only `## Interpretation`.
- All redteam verdicts/objections vanish on any handoff or crash between redteam and ask. This directly violates the plan's Context-management hard rule: "Every step writes its results to CHUNK.md **before** the next step starts; every write leaves state cold-resumable."
- `build-chunk.md:145` tells the session to confirm "the **redteam ledger**" is "saved in the game folder" — a dangling reference: no file defines or writes a redteam ledger. The only ledger in `CHUNK.template.md` is the Findings Ledger, which the template says is "Populated by audit." (`build-chunk.md:208-210` compounds this by attributing the "findings ledger" to what "investigate/redteam/ask fill.")

**Fix:** Add explicit persistence instructions: after each step completes, the orchestrator checks off that step's Step Checklist item in CHUNK.md (this is a state-file write, permitted); redteam's aggregated outcome (per-claim verdicts + objections, round number) is written to a defined CHUNK.md location before the ask step starts — either add a redteam section to `CHUNK.template.md`'s parse contract or drop the "redteam ledger" claim from `build-chunk.md:145` and record outcomes as superseding claims / escalation notes only, stating that explicitly.

## Warnings

### WR-01: "Awaiting-playtest" misdefined — matches a chunk that hasn't run audit/repair yet

**File:** `src/cli/slash-command/bs/build-chunk.md:56-59`
**Issue:** The awaiting-playtest state is defined as "(`Status: built`, `playtest` unchecked)". On the full ceremony, `Status: built` is set when `test` completes (`state-machine.md`: "built — the code exists and has passed automated test"), so a chunk that hasn't yet run `audit`/`repair` also matches this definition. As written, the router would "re-pose the pending question verbatim" — a playtest question that doesn't exist yet (the test script's build stamp is written at build; the pending-question posing happens at playtest) — and skip the audit/repair group entirely.
**Fix:** Define awaiting-playtest structurally: "first incomplete step on the Step Checklist is `playtest`" (i.e., everything through `repair` — or through `test` on the light path — is checked). That also removes the redundant status-based shorthand that contradicts the first-incomplete-step rule stated two lines earlier.

### WR-02: "First non-verified chunk" resume rule is ambiguous for `verified (user-waived)`

**File:** `src/cli/slash-command/bs/build-chunk.md:53`
**Issue:** A waived chunk's status is `verified (user-waived)` — a distinct enum value from `verified`. Read literally, "first non-verified chunk" resumes the waived chunk forever, and the router would re-enter a chunk the user explicitly closed. The plan treats waived chunks as done for advancement (check-status "surfaces accumulated waived chunks and proposes a batch playtest" — a separate flow). The plan uses the same loose phrase, but this router is the file an LLM actually executes, so the ambiguity is load-bearing here.
**Fix:** "find the first chunk whose status is neither `verified` nor `verified (user-waived)`" (and note the `stale — re-derive before build` stop already handled in the Status Enum section).

### WR-03: Session-lock resolution runs before the resume target is known — outcomes 1 and 2 are undecidable at Step 0

**File:** `src/cli/slash-command/bs/build-chunk.md:23-38`
**Issue:** Step 0 ("On entry, before any other work") requires classifying the lock as "names the same chunk this session is about to resume" vs "names different work than this session is about to touch" — but which chunk this session will resume isn't determined until Step 2 reads SKETCH.md and finds the first non-verified chunk. As ordered, an LLM at Step 0 cannot distinguish outcome 1 from outcome 2 without doing Step 2's work first, and the instructions forbid other work first.
**Fix:** State explicitly that Step 0's lock comparison uses the resume target derived from SKETCH.md's ordered list (a read the consistency check already performs), or reorder: identify the resume target, then resolve the lock against it, before any step dispatch.

### WR-04: Round-2 redteam vs append-only supersession is unhandled — superseded claims manufacture spurious refuted-twice escalations

**File:** `src/cli/slash-command/bs/build/redteam.md:82-93` / `src/cli/slash-command/bs/build/investigate.md:97-108`
**Issue:** After a refuted-once re-investigate, the claims list contains both the original wrong claim (e.g. claim 7, "original text and number untouched in place") and its superseding claim 12. The escalation rule contemplates a second redteam round ("a refuter and the coverage adversary flag the same claim/gap **on the re-investigate round**"), but `redteam.md` never says which list the round-2 agents receive or how they treat superseded claims. Fresh-context refuters given the full list will correctly re-refute claim 7 (it is still wrong, by design), and two refuters doing so triggers "refuted twice → escalate to the user" for a claim that claim 12 already fixed — a spurious escalation on every re-investigate round.
**Fix:** In redteam.md, specify the round-2 dispatch: either exclude claims that carry a recorded supersession (dispatch only live claims), or instruct round-2 agents that a claim marked "supersedes claim N" replaces claim N for review purposes and claim N gets no verdict.

### WR-05: Step 1 conversational-intent routing targets behavior that doesn't exist, with no interim instruction

**File:** `src/cli/slash-command/bs/build-chunk.md:44-49`
**Issue:** Status questions route "internally to the status behavior that will ship as `/bs-check-status` (Phase 147)" and the session is forbidden to "answer from a partial read." Unlike the Step-3 forward references (which sit behind multi-session seams and explicit "authored in Phase 14X" markers plus a drift-test note that they are stubs), Step 1 is reachable in the very first session of the very first chunk. Until Phase 147 lands, a session hitting this path has an instruction to hand off to logic that is not written anywhere — undefined behavior on a live path.
**Fix:** Either mark these routes as forward references with an explicit interim behavior ("until Phase 147 lands, answer from SKETCH.md + the current CHUNK.md status line directly" — both are state files the orchestrator may read), or inline the minimal status/insert routing here and let Phase 147 extract it.

### WR-06: Drift test's prohibited-vocabulary assertions are vacuous — they pass on ordinary prose substrings

**File:** `src/cli/slash-command/bs/build-chunk.test.ts:221-228`
**Issue:** `expect(ask).toContain('action')` matches "inter**action**" and "adapt**ation**s"; `'state'` matches "re**state**d"; `'flow'` matches "flows". Delete the entire Prohibited Vocabulary section from ask.md and this test still passes — the drift protection it claims to provide (BUILD-04's zero-implementation-vocabulary requirement) is not actually pinned.
**Fix:** Assert the backticked list-entry forms ask.md actually uses:
```ts
expect(ask).toContain('- `action`');
expect(ask).toContain('- `flow`');
expect(ask).toContain('- `state`');
expect(ask).toContain('- `element`');
```

### WR-07: Drift test does not pin redteam's no-framing independence rule or the gate's write-last ordering

**File:** `src/cli/slash-command/bs/build-chunk.test.ts:180-210, 236-240`
**Issue:** Two core Phase-143 properties have no assertion: (1) BUILD-03's independence rule — "the dispatch prompt contains ONLY the raw slice path(s) and the numbered claims list text... never the investigator's... rationale" and the confidence-adjective prohibition — is the property the plan calls out as what "defeats independent review," yet nothing pins it (a reword removing "no framing" passes the suite); (2) the BUILD-04 test is named 'gates write: "Status: approved" written last' but asserts only that the strings `Status: approved` and `/explicit(ly)? approv/` appear somewhere — the "written last, never speculatively" ordering rule is unpinned.
**Fix:** Add e.g. `expect(redteam).toMatch(/never the investigator'?s/i)` and `expect(redteam).toMatch(/framing/)`; add `expect(ask).toMatch(/last, after every other write/)` (or pin the numbered 1/2/3 write-order list).

## Info

### IN-01: Stale, mutually inconsistent step-number cross-references in all three reference files

**File:** `src/cli/slash-command/bs/build/investigate.md:3` / `src/cli/slash-command/bs/build/redteam.md:3` / `src/cli/slash-command/bs/build/ask.md:3`
**Issue:** investigate.md says "Referenced by `build-chunk.md` Step 2"; redteam.md and ask.md both say "Step 3". In build-chunk.md, Step 2 is Resume Routing, Step 3 is Ceremony Routing, and the actual dispatch lives in the unnumbered "Step Group 1 Dispatch" section. The numbers are wrong against the router and inconsistent among themselves (redteam and ask can't both be Step 3).
**Fix:** Reference the section by name: "Referenced by `build-chunk.md` 'Step Group 1 Dispatch'".

### IN-02: Refuter dispatch prompt cites `state-machine.md`, which the fresh-context subagent cannot resolve

**File:** `src/cli/slash-command/bs/build/redteam.md:45-47`
**Issue:** The prompt text handed to refuters includes "(see state-machine.md 'Rulings Outrank Rulebook')". Per CHUNK.template.md's header decision, state-machine.md is NOT copied into the game project — a fresh subagent working in the project directory gets a dangling reference. Harmless (the rule is restated inline in the same sentence), but the citation should not ship inside the subagent prompt.
**Fix:** Drop the parenthetical from the prompt template; keep the inline restatement.

### IN-03: `docs/*.md` paths in the investigate dispatch carry no resolution note

**File:** `src/cli/slash-command/bs/build/investigate.md:30-38, 67-69`
**Issue:** The fresh-context subagent is told to read `docs/core-concepts.md` etc., but in a generated game project those live under the installed library (e.g. `node_modules/boardsmith/docs/`), not at `docs/` in the project. The Installed-location paragraph in build-chunk.md covers only bs/-tree-relative paths. This convention is inherited from the old skill, but Phase 143's fan-out makes it newly load-bearing: the subagent has "no inherited knowledge of where this chunk's sources live" (investigate.md's own words) yet gets unresolvable doc paths.
**Fix:** Add one line stating how `docs/*.md` resolves for a game project (the same way `{citedSlicePaths}` are resolved before dispatch — pass resolved absolute/relative paths in `{resolvedDocList}` and say so).

### IN-04: Timing of the refuted-twice RULINGS.md write is unspecified relative to the ask gate

**File:** `src/cli/slash-command/bs/build/redteam.md:108-113` / `src/cli/slash-command/bs/build/ask.md:79-84`
**Issue:** redteam.md's "Recording the Ruling" writes the user's escalation answer to RULINGS.md with no gating language, while ask.md gates rulings from escalations "still open when this step starts" behind explicit approval. The boundary (answered-during-redteam → write immediately; still-open-at-ask → gated) is implied but never stated in redteam.md, and build-chunk.md's gate paragraph ("any RULINGS.md entries ... written only after that same explicit approval") reads as covering all group-1 ruling writes.
**Fix:** One sentence in redteam.md: a ruling the user gives during the redteam escalation is written to RULINGS.md immediately (it is user-authorized on its own), independent of the later ask approval — or, if the intent is to defer all writes to the gate, say that instead and align build-chunk.md:139-141.

### IN-05: Dead test asserts constants against themselves

**File:** `src/cli/slash-command/bs/build-chunk.test.ts:274-279`
**Issue:** The 'reuses SKETCH_LEVEL_MARKER / UI_TAG_REGEX conventions' test reads no file — it asserts `SKETCH_LEVEL_MARKER` contains a substring of itself and that `UI_TAG_REGEX` matches a literal. It can never fail against the reviewed files and pads the suite's apparent coverage.
**Fix:** Delete the `it()` (keep the constants with their comment), or convert it into a real cross-file assertion against state-machine.md / CHUNK.template.md.

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
