---
phase: 141-file-templates-state-machine-authority
reviewed: 2026-07-04T19:02:29Z
depth: standard
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
  critical: 2
  warning: 7
  info: 3
  total: 12
status: issues_found
---

# Phase 141: Code Review Report

**Reviewed:** 2026-07-04T19:02:29Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 141 ships the six bs- skill file templates, the state-machine authority doc, and a drift-protection test suite (27 tests, all passing). The overall structure is strong: authority rules, write order, and parse contracts are stated once in state-machine.md and cited from templates, and the drift test pins the most fragile strings (step-name list, stale-marker em-dash).

Because these files are consumed by LLM sessions, "bugs" here are contract defects. Two Critical findings: CHUNK.template.md's own parse contract omits a heading the template itself ships (a self-contradiction inside the TMPL-02 contract), and the mandatory entry-point consistency check is guaranteed to false-positive (or force guessing) on lazily-detailed sketch tail chunks because no document says who creates `chunks/<slug>/` directories. Warnings cover dangling relative references in instantiated files, undefined light-path status transitions, a cutover-scope contradiction with the canonical plan, the `close` step belonging to no session handoff group, an undefined "stale lock" criterion, ambiguous Status-line grammar, and drift-test gaps that would let key contract strings mutate without failing CI.

## Critical Issues

### CR-01: CHUNK.template.md parse contract omits "## Newly Discovered Citations" — the template contradicts its own TMPL-02 contract

**File:** `src/cli/slash-command/bs/templates/CHUNK.template.md:9-15` (contract) vs `:70-73` (heading)
**Issue:** The PARSE CONTRACT comment enumerates the required headings "in order": Status line, `## ui:`, `## Ceremony`, `## Step Checklist`, `## Interpretation`, `## Visibility Declaration`, `## Findings Ledger`, `## Revision Rounds`, `## Build Manifest`, `## Playtest Test Script`, `## Verified Checklist`, `## Verified Commit Hash`. But the skeleton itself ships a thirteenth section, `## Newly Discovered Citations` (line 70), between Visibility Declaration and Findings Ledger — and the plan requires it (bs-skills-plan.md §build-chunk step 1: "newly discovered citations appended to CHUNK.md"). Two failure modes for a literal-minded resuming session: (a) a CHUNK.md missing that section validates cleanly, silently losing the append-only citation record the investigate step depends on; (b) a session treating the contract list as exhaustive ("must contain, in order") flags every correctly-created file as malformed and stops-and-asks on every resume. Either way the TMPL-02 contract and the canonical skeleton disagree, which is exactly the drift this phase exists to prevent.
**Fix:** Add `"## Newly Discovered Citations"` to the parse-contract list between `"## Visibility Declaration"` and `"## Findings Ledger"`. Then add a drift test that extracts each template's PARSE CONTRACT heading list and asserts those headings appear in that file, in that order (see WR-07).

### CR-02: Consistency check item 1 is guaranteed to fail for sketch tail chunks — no document says who creates `chunks/<slug>/` directories

**File:** `src/cli/slash-command/bs/state-machine.md:66` and `src/cli/slash-command/bs/templates/SKETCH.template.md:56-62`
**Issue:** State-machine.md mandates, on every bs- entry: "Every sketch slug (listed in SKETCH.md) has a corresponding `chunks/<slug>/` directory." But the design contract (bs-skills-plan.md, ingest approval gate) says "Only the next 2–3 chunks are detailed; the tail stays sketch-level," and SKETCH.template.md's tail-entry format (`- Status: proposed` with no "derived from chunks/<slug>/CHUNK.md" pointer, lines 59-62) strongly implies tail chunks have no CHUNK.md yet. No template or rule says ingest must create stub directories for tail slugs. Consequence: on the very first `/bs-build-chunk` after ingest, the mandatory consistency check finds every tail slug "missing" its directory and must either nag the user on every session entry (destroying the check's signal) or silently rationalize the discrepancy — which is precisely the guessing TMPL-02 prohibits. This is a contract contradiction that fires on 100% of real projects.
**Fix:** Pick one and state it in both files: either (a) ingest creates a stub `chunks/<slug>/CHUNK.md` (Status: proposed) for every slug including tail entries, and the SKETCH tail-entry format uses the same derived-pointer line as detailed entries; or (b) amend consistency-check item 1 to "Every sketch slug with a detailed entry has a corresponding directory; tail (sketch-level-only) entries are exempt," and make the tail-entry format machine-distinguishable (e.g. `- Status: proposed (sketch-level — no CHUNK.md yet)`).

## Warnings

### WR-01: Relative references (`../state-machine.md`, `DESIGN.template.md`, `ASSETS.template.md`) dangle after instantiation

**File:** all six templates — e.g. `SKETCH.template.md:5,12,18,37`, `CHUNK.template.md:6,14,79,143`, `ASSETS.template.md:13,22,29`, `DESIGN.template.md:8,22,69`, `RULINGS.template.md:7,15,26`, `DECISIONS.template.md:22`
**Issue:** Templates instruct "See ../state-machine.md" — a path valid only inside `src/cli/slash-command/bs/templates/` in this repo. Once a template is instantiated as `SKETCH.md` in a game project, `../state-machine.md` points outside the project to a file that doesn't exist there (state-machine.md is installed with the skills, not copied into game projects per the plan's Distribution section). A resuming session told to "see ../state-machine.md 'Session Lock'" will fail to read it or, worse, read an unrelated file. Same class: `ASSETS.template.md:13` references "DESIGN.template.md" and `DESIGN.template.md:69` references "ASSETS.template.md" — after instantiation those files are `DESIGN.md`/`ASSETS.md`; the `.template.md` names never exist in a game project.
**Fix:** Reference by logical name resolved by the skills ("see the bs- skills' state-machine.md reference, section 'Session Lock'" — with each skill's instructions stating where that file is installed), or have ingest copy state-machine.md into the game project. Change cross-template references to the instantiated names (`DESIGN.md` "Placeholder Policy", `ASSETS.md`).

### WR-02: Light-path status transitions undefined; light-path checklist requires restructuring the template

**File:** `src/cli/slash-command/bs/state-machine.md:29-35` and `src/cli/slash-command/bs/templates/CHUNK.template.md:31-52`
**Issue:** Two gaps. (1) The status enum defines `approved` as "the user authorized the design at the `ask` step," but the light path (`build, test, playtest`) has no `ask` step — so `approved` is unreachable for light chunks and nothing says whether they jump `proposed → built` or need some other authorization record. A resuming session cannot determine the legal transition. (2) CHUNK.template.md ships the full 10-item checklist unconditionally with the light checklist in a comment (lines 48-52); a light chunk's session must delete the full checklist and un-comment the light one — but the plan's hard rule (bs-skills-plan.md line 46) is "Sessions fill templates, never restructure them." Leaving both means a cold-resume router (which "routes to the first incomplete step") sees seven forever-unchecked full-ceremony boxes on a light chunk.
**Fix:** In state-machine.md, define the light-path transition explicitly (e.g. "light chunks move `proposed → built` when the user accepts the proposal; the proposal acceptance is the ask-equivalent gate"). In CHUNK.template.md, make the checklist ceremony-conditional by contract: state that when `Ceremony: light` the checklist section contains exactly the three light-path items, and that writing the checklist to match the declared ceremony at proposal time is filling, not restructuring.

### WR-03: Cutover scope contradicts the canonical plan — "all previously verified chunks" vs "chunks whose test script depended on the old presentation"

**File:** `src/cli/slash-command/bs/state-machine.md:79` vs `.planning/bs-skills-plan.md:115`
**Issue:** The plan says the AutoUI→Custom-UI cutover "explicitly flips **all** previously verified chunks from `verified` back to `built`." State-machine.md narrows this: the cutover "re-opens every chunk whose verified test script depended on the old presentation." Under state-machine.md's reading, a `ui: none` chunk stays `verified` through a full UI cutover; under the plan's, it re-opens. SKETCH.template.md (lines 36-38) repeats the narrowed form. This decides which chunks the human must re-playtest — a session following state-machine.md could leave a chunk `verified` whose test script no longer executes against the new UI.
**Fix:** Resolve deliberately and align all three documents. If the narrowing is intentional (it is arguably better), update the plan; otherwise change state-machine.md line 79 and SKETCH.template.md lines 36-38 to "flips all previously verified chunks back to `built`."

### WR-04: `close` belongs to no session handoff step group

**File:** `src/cli/slash-command/bs/state-machine.md:107-113`
**Issue:** The four structural step groups — {investigate, redteam, ask}, {build, test}, {audit, repair}, {playtest, one revise round} — cover 9 of the 10 full-ceremony steps. `close` is unassigned. Since "a single session runs at most one step group, then hands off," a session finishing the playtest/revise group cannot legally run `close`, and no group grants it — so close either never runs, or sessions improvise (defeating the "structural, not self-assessed" premise). (The plan shares this wording, but state-machine.md is the shipping authority doc and should resolve it.)
**Fix:** Assign `close` explicitly — e.g. group 4 becomes `{playtest, one revise round, close}`, or add a fifth group `{close}`.

### WR-05: "Stale session lock" has no staleness criterion

**File:** `src/cli/slash-command/bs/state-machine.md:69,81-84` and `src/cli/slash-command/bs/templates/SKETCH.template.md:10-12`
**Issue:** Consistency-check item 4 requires detecting "no stale session lock (see Session Lock below)," but the Session Lock section defines only the lock's content (chunk + timestamp) and the warn-don't-clobber behavior — never what makes a lock *stale* (age threshold? lock held by a crashed session? any lock at entry?). Every bs- entry point must evaluate this predicate; with no definition, each session invents its own, and the check either warns on every legitimate resume (the resuming session sees its own predecessor's lock) or never warns at all.
**Fix:** Define staleness in the Session Lock section — e.g. "a lock is stale when its timestamp is older than N hours, or when the resuming session is continuing the same chunk the lock names (in which case it refreshes the lock); any other lock is treated as a live concurrent session and triggers the warning."

### WR-06: Status-line grammar is ambiguous across state files — Cold-Resume contract implies every state file has one; SKETCH.md has two competing forms

**File:** `src/cli/slash-command/bs/state-machine.md:56,68` and `src/cli/slash-command/bs/templates/SKETCH.template.md:53,62`
**Issue:** Three related ambiguities. (1) "A state file's authoritative status lives on one line matching `Status: <enum-value>`" reads as universal, but only CHUNK.md has an authoritative Status line — RULINGS/DECISIONS/DESIGN/ASSETS have none, and a literal validator would fail them. (2) SKETCH.template.md uses two different derived-status grammars: detailed entries use `- Status (derived from chunks/<slug>/CHUNK.md):` (line 53) while tail entries use bare `- Status: proposed` (line 62); nothing says a tail entry's line is rewritten to the long form when detailed, and a parser scanning SKETCH.md for `Status:` matches both forms plus multiple lines. (3) Consistency-check item 3 says "All statuses parse against the Status Enum above," but `stale — re-derive before build` is presented as a separate "CHUNK-level stale marker" rather than an enum member — a literal reading fails every legitimately stale chunk, forcing a stop-and-ask on valid state.
**Fix:** (1) Scope the sentence: "Each file that carries a status (CHUNK.md; SKETCH.md's derived per-chunk pointers) ..." (2) Use one grammar for both SKETCH entry forms. (3) Fold the stale marker into the recognized-values list for consistency-check purposes: "statuses parse against the Status Enum above, or the CHUNK-level stale marker."

### WR-07: Drift-test gaps let core contract strings mutate without failing CI

**File:** `src/cli/slash-command/bs/templates.test.ts:74-100,189-195`
**Issue:** Several assertions are too weak to catch the drift they exist to catch:
- The status enum is never pinned as one exact line. Lines 93-99 assert bare-word containment (`toContain('proposed')`, `toContain('built')`...) — every one of those words appears in surrounding prose, so the enum line in CHUNK.template.md:4 could be reordered, re-separated, or partially deleted and the tests still pass. There is also no cross-file assertion that CHUNK.template.md's enum line and state-machine.md's enum line are the same string (the test suite does exactly this for step names at lines 126-130, so the pattern exists — it was just not applied to the enum).
- ASSETS: the parse contract says "exactly these five columns, in this order," but lines 189-195 assert five unordered substrings, several of which (`requested`, `received`, `file path`) also appear in the template's prose. The literal header row `| needed-by-chunk | requested | received | placeholder-in-use | file path |` is never pinned.
- No test verifies any template's PARSE CONTRACT heading list against the headings the file actually contains — the exact defect class of CR-01 is invisible to this suite (all 27 tests pass today with CR-01 present).
- SKETCH.md's machine anchors `Sketch Version:` and `Session Lock:` (which `/bs-insert-chunk` and the lock check depend on) are untested, as is the stale marker's presence in SKETCH.template.md:53.
**Fix:** Pin the exact enum line once as a const and assert it appears verbatim in both state-machine.md and CHUNK.template.md; pin the exact ASSETS header row; add a test that parses each PARSE CONTRACT comment's quoted heading list and asserts those headings appear in-order in that file; add `toContain('Sketch Version:')` / `toContain('Session Lock:')` / stale-marker assertions for SKETCH.template.md.

## Info

### IN-01: ASSETS.template.md misquotes Write Order as "state files are append-only" while its own workflow mutates rows

**File:** `src/cli/slash-command/bs/templates/ASSETS.template.md:27-29`
**Issue:** The comment says "state files are append-only per ../state-machine.md 'Write Order'," but Write Order only makes *round entries* append-only — and the ASSETS ledger's own design requires editing existing rows (flipping `requested`/`received`/`placeholder-in-use` cells when an asset arrives). As written, a literal session could refuse to update a row's `received` cell.
**Fix:** Reword: "Rows are never deleted or reordered; cell values (requested/received/placeholder-in-use/file path) are updated in place as the asset's state changes."

### IN-02: RULINGS parse contract shorthand "Decision / Citation / Rationale" doesn't match the actual field name

**File:** `src/cli/slash-command/bs/templates/RULINGS.template.md:24` vs `:32-34`
**Issue:** The parse contract says entries carry "Decision / Citation / Rationale," but the entry spec's field is literally `Citation interpreted or overridden`. A validator checking for a line starting `- Citation:` fails every correct entry.
**Fix:** Use the full field name in the parse-contract comment: "Decision / Citation interpreted or overridden / Rationale."

### IN-03: Restyle/Cutover rule is silent on `verified (user-waived)` chunks

**File:** `src/cli/slash-command/bs/state-machine.md:77-79`
**Issue:** The rule flips "previously verified" chunks back to `built`. Whether that includes `verified (user-waived)` chunks is unstated — arguably they should also flip (their waived scripts are equally invalidated), but a literal reading of "verified" excludes them.
**Fix:** Add: "This applies to both `verified` and `verified (user-waived)` chunks."

---

_Reviewed: 2026-07-04T19:02:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
