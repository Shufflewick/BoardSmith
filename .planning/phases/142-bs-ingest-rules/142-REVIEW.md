---
phase: 142-bs-ingest-rules
reviewed: 2026-07-04T22:05:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/cli/slash-command/bs/ingest-rules.md
  - src/cli/slash-command/bs/ingest/transcription.md
  - src/cli/slash-command/bs/ingest/interview-fallback.md
  - src/cli/slash-command/bs/ingest/scaffold.md
  - src/cli/slash-command/bs/ingest/sketch-derivation.md
  - src/cli/slash-command/bs/ingest.test.ts
findings:
  critical: 6
  warning: 8
  info: 2
  total: 16
status: issues_found
---

# Phase 142: Code Review Report

**Reviewed:** 2026-07-04T22:05:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 142 authored the `/bs-ingest-rules` orchestrator, four step reference files, and a
structural drift test. These are LLM-executed instructions, so review checked internal
consistency, agreement with the canonical contract (`.planning/bs-skills-plan.md` §ingest),
agreement with Phase 141 artifacts (`state-machine.md`, `templates/*.template.md`), and
factual accuracy of every CLI claim against `src/cli/commands/init.ts` and `dev.ts`.

What checks out: the drift test passes (28/28); the exact-line CLI citations are accurate
today (`init.ts:19` error, `dev.ts:788` no-open message, `dev.ts:791` ready line); the
byte-identical sketch-level tail marker (em-dash form) matches `state-machine.md` and
`SKETCH.template.md` exactly; the interview question sequence is a faithful extraction of
old `instructions.md` Phase 2 (lines 121–223); INGEST-01/05/06/07 behaviors are present.

What does not check out: the orchestrator's step sequence contradicts itself (SKETCH.md
written at Step 4, gated at Step 6, clobbered by a skeleton copy at Step 7), the migration
path routes to a mislabeled step, DESIGN.md is created at ingest in direct contradiction of
Phase 141's template header, slice-writing responsibility is contradicted between
`ingest-rules.md` and `transcription.md` in a way that defeats the fan-out's entire
context-economics purpose, the visual identity survey has no data source, and the rulebook
slices are written to disk before the project directory that should contain them exists.

## Critical Issues

### CR-01: SKETCH.md is written before the approval gate, then clobbered by the skeleton copy

**File:** `src/cli/slash-command/bs/ingest-rules.md:80-116` (Steps 4, 5, 6, 7)
**Issue:** The step sequence is self-contradictory about when SKETCH.md is written:
- Step 4 (line 83): "Write the result into `SKETCH.md` using the template skeleton" — writes SKETCH.md.
- Step 5 (line 88-90): fills the `## UI Strategy` section — writes SKETCH.md again.
- Step 6 (line 104-105): "Do not proceed to writing final files until the user has explicitly approved" — forbids exactly what Steps 4-5 just did. The plan's approval gate ("the sketch is **proposed**, not imposed") is violated: on a user rejection at Step 6, sketch state has already been written to disk.
- Step 7 (line 109-111): "Copy the six skeletons from `templates/*.template.md` into the game project (`SKETCH.md`, ...)" — an agent following this literally copies the *blank* skeleton over the filled SKETCH.md produced by Steps 4-5.

**Fix:** Make Steps 4-5 produce an in-conversation *proposal* (explicitly: "do not write SKETCH.md yet"), keep Step 6 as the gate, and make Step 7 the single point where SKETCH.md is copied-and-filled. Remove "Write the result into SKETCH.md" from Step 4 and "recorded into ... section" from Step 5, or rewrite Step 7 to "fill the already-written SKETCH.md" — either way, exactly one step may write the file, and it must be after Step 6.

### CR-02: Migration path routes to "Step 3 (Synthesis)" — Step 3 is Scaffold; Synthesis is Step 2

**File:** `src/cli/slash-command/bs/ingest-rules.md:35`
**Issue:** Step 0 case 3 (old `/design-game` project) says "On acceptance, proceed to Step 3 (Synthesis)". Step 3 is "Scaffold + Verify"; Synthesis is Step 2. An agent must guess which was meant — and *both* readings are wrong for migration: Step 3's scaffold runs `npx boardsmith init <name>`, which hard-fails on an existing directory (`init.ts:19`), and an old `/design-game` project is already scaffolded with code. The migration route as written either mislabels its target or drives the session into a guaranteed `init` failure.
**Fix:** Route migration to Step 2 by its correct number ("proceed to Step 2 (Synthesis)"), and add one sentence stating that migration **skips Step 3 entirely** (the project is already scaffolded) — optionally substituting the compile/serve verification portion of Step 3 without the `init` call, since the old codebase should still be proven compiling before chunk work.

### CR-03: Who writes the slices is contradicted between ingest-rules.md and transcription.md — and transcription.md's version defeats the fan-out's context economics

**File:** `src/cli/slash-command/bs/ingest-rules.md:17-19` vs `src/cli/slash-command/bs/ingest/transcription.md:58-70`
**Issue:** `ingest-rules.md` line 17-18 says INDEX.md is never built "by re-reading a slice file the orchestrator just had **a subagent write**" — subagents write slices. `transcription.md`'s "Orchestrator Writes" section says the opposite: the subagent returns full `sectionText` in its summary and step 1 is "**Write** `sectionText` to `rulebook/NN-topic.md`" — the orchestrator writes. Under transcription.md's version, the complete transcribed rulebook flows through the orchestrator's context, section by section, via subagent returns. This directly contradicts the canonical contract: "it fans out subagents per page range **to write slice files**; the orchestrator synthesizes the sketch from their structured summaries plus the INDEX — **it never holds the whole rulebook**" (bs-skills-plan.md §ingest). The subagent return shape `{ sectionText, citedTerms[], componentMentions[] }` mandates returning full verbatim text, which is precisely the context-exhaustion failure mode this design exists to avoid.
**Fix:** Resolve in the plan's direction: subagents write `rulebook/NN-topic.md` directly and return `{ slicePath, sectionSummary (short), citedTerms[], componentMentions[] }`. Per-section user confirmation is then driven from the short `sectionSummary` (which is what transcription.md line 51 already calls it — "present its **summary** to the user"); a user correction dispatches a narrow follow-up subagent to amend the slice (the mechanism transcription.md line 16 already prescribes for suspect summaries), rather than requiring the unconfirmed full text to sit in orchestrator context awaiting confirmation.

### CR-04: The visual identity survey has no data source — it is un-populatable as specified

**File:** `src/cli/slash-command/bs/ingest-rules.md:65-67` and `src/cli/slash-command/bs/ingest/transcription.md:24-37`
**Issue:** Step 2 item 5 requires a visual identity survey ("dominant palette candidates, typography feel, iconography, notes on board/card art"). But: (a) the orchestrator never reads the rulebook or the slices (Context-Economics Hard Rule); (b) the transcription subagent prompt asks only for `sectionText`, `citedTerms[]`, `componentMentions[]` — no visual-evidence field; (c) the plan says "Downstream steps never touch the original PDF/images." The transcription subagents are the only parties who ever see the rulebook's visuals, and they are not asked to report any. The plan also requires "Setup diagrams and embedded component images are described in the slice text and captured into the visual identity survey" (bs-skills-plan.md §ingest, Input modes) — the subagent prompt contains no instruction to describe diagrams or embedded images at all. Every downstream path to populating the survey is closed; an agent will either leave it empty or violate the context rule to fill it.
**Fix:** Extend the transcription subagent prompt with (d) `visualEvidence[]` — palette/typography/iconography/art observations and descriptions of setup diagrams and depicted components on the assigned pages — and instruct that diagram descriptions also be woven into `sectionText`. Have Step 2 item 5 build the survey exclusively from accumulated `visualEvidence[]`, parallel to how INDEX.md is built from `citedTerms[]`.

### CR-05: Step 7 creates DESIGN.md at ingest — Phase 141's template and the plan both forbid this

**File:** `src/cli/slash-command/bs/ingest-rules.md:109-110`
**Issue:** Step 7 instructs copying "the six skeletons" including `DESIGN.md` into the game project at ingest. `DESIGN.template.md`'s own header states: "It is written at the FIRST UI chunk's `ask` step ... **not at ingest** — there is no visual identity to decide until a UI chunk actually needs one." The plan's artifact table agrees (`DESIGN.md` — written by "first UI chunk's ask"), and `SKETCH.template.md`'s UI Strategy comment exists *because* "DESIGN.md doesn't exist until the first UI chunk's ask step." Creating a blank DESIGN.md at ingest also breaks `/bs-build-chunk`'s first UI chunk's design-ask trigger logic (the file's existence signals the identity decision was made). Secondary: the plan's table also assigns `RULINGS.md` to "any ask/playtest gate" and `DECISIONS.md` to "build/close", not ingest — creating those as empty ledgers at ingest is more defensible but should be a deliberate, documented choice, not a side effect of "copy all six."
**Fix:** Step 7 copies **five** skeletons at most and explicitly excludes DESIGN.md, citing DESIGN.template.md's header ("written at the first UI chunk's ask, not at ingest"). State explicitly whether RULINGS.md/DECISIONS.md are seeded empty at ingest or created lazily at their first write, and align the plan/template wording accordingly.

### CR-06: rulebook/ slices are written before the project directory exists

**File:** `src/cli/slash-command/bs/ingest-rules.md:38-77` (Steps 1-3) and `src/cli/slash-command/bs/ingest/scaffold.md:34-52`
**Issue:** Steps 1-2 write `rulebook/NN-topic.md`, `rulebook/INDEX.md`, and seed `ASSETS.md` — transcription.md mandates writing each slice to disk immediately after per-section confirmation ("never write an unconfirmed slice"). But the game project directory does not exist until Step 3, where scaffold.md requires running `npx boardsmith init <name>` from the **parent** directory, which "unconditionally creates `<cwd>/<name>`" and errors if it exists. Consequences: (a) rulebook/ and ASSETS.md land in the parent directory, outside the project `init` creates, with no instruction anywhere to relocate them into `<name>/`; (b) if the session instead ran Steps 1-2 already inside a directory intended as the project, `init` at Step 3 creates a *nested* `<name>/` that does not contain the slices; (c) Step 0's `ls`-in-cwd state detection assumes SKETCH.md lives in cwd, which only holds if the session is *inside* the project — inconsistent with Step 3's run-from-the-parent framing. The plan's artifact table lists `rulebook/` as part of "the game project's state"; as written it can never end up there.
**Fix:** Reorder: derive names and run the scaffold (current Step 3) **before** transcription/interview, then `cd <name>` and run all artifact-writing steps from inside the project — this also makes Step 0's cwd-based detection coherent (the re-run guard fires when invoked inside an existing project). Alternatively, keep the order but add an explicit "all rulebook/ and ledger writes target `<name>/` once it exists; buffer nothing to the parent" rule — the reorder is the cleaner fix.

## Warnings

### WR-01: Rulebook edition has no recording location and no data source

**File:** `src/cli/slash-command/bs/ingest-rules.md:57-58`
**Issue:** Step 2 item 2: "the rulebook's edition is recorded" — recorded *where*? No template has an edition field (SKETCH.template.md's parse contract enumerates its headings; none fits), and no subagent return field carries the edition, so the orchestrator (which never reads the rulebook) has no source for it either.
**Fix:** Name the home (e.g., a line in SKETCH.md near Player Counts, added to the Phase 141 template's parse contract) and the source (ask the user at Step 1, or have the page-1 transcription subagent return it).

### WR-02: Interview fallback misses plan-named elicitation topics and cannot populate aspect ratios

**File:** `src/cli/slash-command/bs/ingest/interview-fallback.md:22-77`
**Issue:** The plan specifies the interview elicits "components, **setup**, turn structure, **actions**, end conditions." The six questions cover components, turn structure, round end, and game end; there is no setup question and no explicit actions question (Q1's open vision only partially covers the core loop). The transcription path would yield setup/actions slices for chunks to cite; the interview path yields none, so a setup chunk has no citable slice. Additionally, Step 2 synthesis requires component **aspect ratios** for the ASSETS.md inventory ("needed for layout-stable placeholders" per the plan), but Question 2 never asks about card/tile/board proportions — the interview path leaves aspect ratios permanently un-populatable.
**Fix:** Add a setup question and an actions/turn-options question (keeping the one-at-a-time cadence), and extend Question 2's per-component follow-up with a light proportions prompt ("standard poker-size cards? square tiles?") feeding `componentMentions[]` aspect ratios.

### WR-03: Misleading claim that the CLI helpers implement the name-derivation algorithm

**File:** `src/cli/slash-command/bs/ingest/scaffold.md:29-32`
**Issue:** "The CLI's own `toPascalCase`/`toDisplayName` helpers ... already implement this exact algorithm ... the rules above are for narrating the derivation to the designer, not for re-implementing name generation yourself." This is wrong in the direction that matters: `toPascalCase`/`toDisplayName` split only on `[-_]` (project-scaffold.ts:83-99) — they derive Class/Display names *from an already-kebab-cased name*. No CLI code implements the kebab-case rules listed (lowercase, replace spaces/special chars, collapse/trim hyphens). The agent MUST apply those rules itself to produce `<name>`; if it takes "not re-implementing name generation yourself" literally and passes "Robot Arena 3000" to `init`, the CLI will happily create a directory with spaces and `toPascalCase` will produce a broken class name ("Robot arena 3000").
**Fix:** Reword: "You must derive the kebab-case Project Name yourself using the rules above — `boardsmith init` does not sanitize its argument. The CLI's `toPascalCase`/`toDisplayName` then derive the Class and Display names from that kebab-case name; do not re-derive those two."

### WR-04: `aspects/index.md` reference is a dangling relative path from the bs/ tree

**File:** `src/cli/slash-command/bs/ingest/interview-fallback.md:139-141`
**Issue:** The Aspect Detection section cites `aspects/index.md` three times. Every other cross-reference in the bs/ files (`state-machine.md`, `templates/...`) resolves relative to `bs/`, but `aspects/` lives one level up at `src/cli/slash-command/aspects/index.md` — there is no `bs/aspects/`. By the file set's own path convention, this pointer dangles. It is also the only cited path with no existence check in the drift test.
**Fix:** Cite the resolvable path (`../aspects/index.md`, or the installed location once `install-claude-command.ts` defines it) and add it to the drift test's existence checks.

### WR-05: Required Reading pointer cites the old skill's file, which the plan deletes at ship

**File:** `src/cli/slash-command/bs/ingest/scaffold.md:108-112`
**Issue:** "A fresh session ... should still read the base docs list the old skill maintained (`src/cli/slash-command/instructions.md` lines 15-35 ...)". The plan states `/design-game` is removed when the bs- skills ship ("Per the no-backward-compat rule, `/design-game` is removed when the bs- skills ship"). This pointer — including brittle line-number citations into a file scheduled for deletion — will dangle exactly when the skill goes live. The doc list itself (core-concepts, common-pitfalls, etc.) is the durable content; the pointer to its old host is not.
**Fix:** Either move the doc-reading list into a bs/ shared reference file now (the plan already says doc-reading lists are "carried over as shared reference files") and cite that, or cite the docs by their `docs/*.md` names directly without routing through `instructions.md`.

### WR-06: Step 5 says the UI strategy is "recorded into `templates/SKETCH.template.md`" — the template, not the project file

**File:** `src/cli/slash-command/bs/ingest-rules.md:88-90`
**Issue:** "recorded into `templates/SKETCH.template.md`'s `## UI Strategy` section (that section already exists in the template — this step fills it...)". Taken literally, this instructs editing the shipped template file. The decision belongs in the game project's `SKETCH.md` (whose skeleton came from the template).
**Fix:** "recorded into the game project's `SKETCH.md` `## UI Strategy` section (the skeleton for which comes from `templates/SKETCH.template.md`)." Resolve together with CR-01's single-write-point decision.

### WR-07: Drift-test gaps — CLI string claims, aspects path, and reference-file citations unpinned

**File:** `src/cli/slash-command/bs/ingest.test.ts:47-56, 117-129, 183-196`
**Issue:** The test pins ingest-rules.md's pointers but leaves the most rot-prone claims unguarded: (a) scaffold.md's exact-line CLI citations (`init.ts:19`, `dev.ts:788`, `dev.ts:791`) and quoted strings (`Ready! Press Ctrl+C to stop.`, the `Skipping auto-open` message, `Error: Directory "<name>" already exists`) — dev.ts is 800+ lines and actively developed; the line numbers will silently drift and the quoted ready-line is load-bearing (the scaffold step waits for it verbatim); (b) `aspects/index.md` cited by interview-fallback.md has no existence check (see WR-04); (c) the four reference files' own cross-citations (transcription.md → `templates/ASSETS.template.md`, sketch-derivation.md → `templates/SKETCH.template.md`, scaffold.md → `src/cli/lib/project-scaffold.ts`) are unpinned — only orchestrator-level pointers are checked; (d) transcription.md's return shape (`sectionText`, `citedTerms[]`, `componentMentions[]`) that ingest-rules.md and interview-fallback.md both depend on by name is not pinned in any file pair.
**Fix:** Add tests that read the cited source files and assert the quoted strings exist (dropping or de-emphasizing raw line numbers in the prose); add `../aspects/index.md` existence; add a cross-citation check per reference file; pin the return-shape field names across transcription.md / interview-fallback.md / ingest-rules.md.

### WR-08: Variant tagging responsibility contradicted between Step 2 and transcription.md

**File:** `src/cli/slash-command/bs/ingest-rules.md:57-59` vs `src/cli/slash-command/bs/ingest/transcription.md:71-77`
**Issue:** Step 2 says variant rules "are tagged out-of-scope-by-default **in the slices**" as part of orchestrator-only synthesis — but the orchestrator may never read or revisit slices after they are written (its own Hard Rule), so it cannot tag them at Step 2. transcription.md correctly places the in-slice tagging at write time ("tagged ... directly in the slice where it appears"). As written, Step 2 instructs a slice edit the context rule forbids.
**Fix:** Step 2 item 2 should say the in-slice tagging *already happened at write time per `ingest/transcription.md`*, and that Step 2's job is only the SKETCH.md "Variants (deferred)" listing, built from a variant flag the subagent summaries return (add a `variants[]` or per-section variant marker to the return shape so the orchestrator knows what to list without re-reading slices).

## Info

### IN-01: Stale Wave-0 narration in the test header

**File:** `src/cli/slash-command/bs/ingest.test.ts:10-19`
**Issue:** "Most tests below are RED (or ERROR, since the files don't exist yet) until those files land — this is the intended Wave-0-first state." All files now exist and all 28 tests pass; the header describes a state that no longer holds and will confuse future readers about whether red tests are expected.
**Fix:** Reword to past tense ("Authored before the reference files, so these started RED by design") or drop the paragraph.

### IN-02: Weak negative assertions

**File:** `src/cli/slash-command/bs/ingest.test.ts:67, 113`
**Issue:** `not.toMatch(/per[- ]page confirmation/i)` only fails on that exact phrase — a reword to "confirm each page" would pass while violating INGEST-01. Similarly `/Outputs?:?\s*PROJECT\.md/` misses most ways the fallback could regress to PROJECT.md output. These give false confidence rather than protection.
**Fix:** Prefer positive pins of the locked-decision sentence (e.g., `toContain('batched per-section')` / the "not per page and not one bulk gate" phrase) over guessing negative phrasings.

---

_Reviewed: 2026-07-04T22:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
