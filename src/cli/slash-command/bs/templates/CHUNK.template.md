# Chunk: <!-- slug, e.g. movement (stable slug, not an ordinal — reorders in SKETCH.md never rename this) -->

<!-- "state-machine.md" in this file refers to the bs- skills' shared reference file, installed
     alongside the bs- skills themselves (the skill instructions state its installed location).
     Decision: it is NOT copied into the game project — a copy would drift from the shipped
     authority; the skills resolve the reference. -->

Status: proposed
<!-- Valid values (exact, case-sensitive): proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->
<!-- This line is authoritative for this chunk's status. SKETCH.md's entry for this chunk is DERIVED
     and must match — see state-machine.md ("Authority" + "Write Order" sections). On contradiction,
     THIS file wins; SKETCH.md gets repaired to match, never the other way around. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this Status line, "## ui:",
     "## Ceremony", "## Step Checklist", "## Interpretation", "## Visibility Declaration",
     "## Newly Discovered Citations", "## Redteam Rounds", "## Constraints Review", "## Findings Ledger",
     "## Revision Rounds",
     "## Spec Manifest", "## Build Manifest", "## Playtest Test Script",
     "## Verified Checklist", "## Sign-off", "## Verified Commit Hash", "## Verified Against",
     "## Rules Staleness". If any required
     heading is missing, or the Status line doesn't match a recognized enum value above, a
     resuming session STOPS and asks the user — it never guesses the intended state. See
     state-machine.md "Cold-Resume Parse Contract". -->

## ui:
<!-- Restated from this chunk's SKETCH.md entry (redundant-but-safe): none | touches | major.
     A CHUNK-only session (no SKETCH.md re-read) still knows whether the a11y floor + design-
     review audit apply. Keep this in sync if SKETCH.md's tag ever changes for this chunk. -->
none

## Ceremony
<!-- Declared at proposal time. Full ceremony runs all 11 steps below. Light path is for chunks
     tagged trivial at proposal (e.g. "swap in the real card images") and only runs
     build, test, playtest — skipping investigate/redteam/ask/spec/audit/repair/revise/close's
     adversarial machinery. A chunk may only be tagged light if it introduces NO NEW GAME BEHAVIOR,
     because the light path has no spec step and a rules claim must get a failing test before code
     (state-machine.md "Step Names (exact, light path — trivial chunks)"). The user is told which path is in effect when the chunk is proposed.
     The `final-acceptance` value is reserved for the sketch's ONE mandated final-acceptance chunk
     (templates/SKETCH.template.md's "## Mandated Chunks") — it is neither full nor light: its Step
     Checklist is the fixed 4-item group [final-acceptance, playtest, revise, close], build-chunk.md's
     "Final-acceptance chunk target" rule (Step 2) owns its routing, and it is exempt from Step 3's
     full/light ceremony routing. -->
full
<!-- Valid values: full | light | final-acceptance -->

## Step Checklist
<!-- Full-ceremony step names (exact, in order) — do not paraphrase, do not reorder:
     investigate, redteam, ask, spec, build, test, audit, repair, playtest, revise, close
     Light-path step names (exact, in order): build, test, playtest
     Check off a step only when it is fully complete; do not check ahead.

     CEREMONY-CONDITIONAL: this section contains exactly ONE checklist matching the declared
     Ceremony above. When Ceremony: full, it is the 11-item list below. When Ceremony: light,
     replace it with exactly these three items (in order):
     - [ ] build
     - [ ] test
     - [ ] playtest
     When Ceremony: final-acceptance (the sketch's ONE mandated final-acceptance chunk only —
     templates/SKETCH.template.md "## Mandated Chunks"), replace it with exactly these four items
     (in order):
     - [ ] final-acceptance
     - [ ] playtest
     - [ ] revise
     - [ ] close
     This third variant is filled by build-chunk.md's "Final-acceptance chunk target" rule
     (Step 2) when that chunk is first detailed — the leading `final-acceptance` content step
     dispatches build/final-acceptance.md (coverage check + 7-point design-QA pass), then
     playtest/revise/close run on top of it. It is NOT an ordinary chunk's full/light checklist,
     and it is exempt from build-chunk.md Step 3's full/light ceremony routing.
     Writing the checklist to match the declared ceremony at proposal time is FILLING the
     template, not restructuring it (see state-machine.md "Step Names" sections for the
     light-path status transitions: light chunks move proposed → built directly — `approved`
     is unreachable for them). -->

- [ ] investigate
- [ ] redteam
- [ ] ask
- [ ] spec
- [ ] build
- [ ] test
- [ ] audit
- [ ] repair
- [ ] playtest
- [ ] revise
- [ ] close

## Interpretation
<!-- Numbered list of factual claims this chunk's design rests on, each with a citation into
     the rulebook (via INDEX.md) or RULINGS.md. Every agent that reads a rulebook slice
     (investigate, redteam, audit) also reads RULINGS.md — the rulebook plus RULINGS.md together
     form the composite source of truth. Append new claims as investigate discovers them; never
     renumber existing claims.

     A claim is a line that starts with its number, `1. `, at the start of the line; bold is
     optional, and every such line is checked. Every claim carries the exact source passage it
     rests on and where it is. A `Source:` path
     that names a design record (rulebook/..., RULINGS.md) or climbs out of design/ (../src/...)
     is read from design/, any other path from the project root; cite a Markdown source (a slice, RULINGS.md) by heading or line
     range, and code by file and line (code this chunk replaced as it was in one of the chunk's
     commits, with @<commit> before the line location). Something no source passage backs is not a claim but an
     open question for the designer, listing every place that was searched:

       Q1. **The question.** Why the sources do not settle it.
          Searched: <file> §"<heading>"

     `boardsmith claim-quote-check <slug>` refuses a claim with no quote, a quote not found at its
     Source, and an open question with no Searched line (build/investigate.md). No real path
     appears in this comment because chunk-check reads every slice path written anywhere in this
     file as a citation. -->

1. **<!-- claim text -->**
   > <!-- the exact source text, copied character for character -->
   Source: <!-- <file> §"<heading>", or <file>:<line>-<line> for code -->

## Visibility Declaration
<!-- What is hidden from whom, keyed to the claims above (e.g. "claim 3: opponent's hand is
     hidden from all other seats until reveal"). Empty/none is a valid declaration for chunks
     with no hidden information — state that explicitly rather than leaving this section blank. -->

<!-- none -->

## Newly Discovered Citations
<!-- Appended during investigate when INDEX.md search surfaces rulebook sections not already
     cited above. Append-only — do not delete an entry once recorded, even if a later round
     supersedes it (supersession is itself a new entry). -->

## Redteam Rounds
<!-- Written by the ORCHESTRATOR at the end of each redteam round, BEFORE the ask step starts —
     this is what makes the round's outcome cold-resumable (a crash or handoff between redteam
     and ask must not lose the verdicts). Append-only: each round is a new "### Redteam Round N"
     entry; never edit or renumber a prior round. Vote-privacy (build/redteam.md) governs what
     is SHOWN to the user — never a raw tally or agent transcript — not what is recorded here:
     this section is internal state, and per-claim verdicts + objections are recorded in full.
     Distinct from the Findings Ledger below, which is populated by audit, not redteam. -->

<!-- ### Redteam Round 1
- claim 1 — verdicts: stands / stands — outcome: stands
- claim 7 — verdicts: refuted / refuted — objections: <objection text> — outcome: refuted twice, escalated to user
- coverage: <missing interactions found, or "none">
- disposition: <cleared | re-investigate dispatched | escalation open at ask>
-->

## Constraints Review
<!-- Written by audit from the constraints lens (build/audit.md): one line per hard constraint
     in design/CONSTRAINTS.md, "- C<n>: held. <citation>", or "not applicable" or "violated".
     `boardsmith constraint-check <slug>` and `boardsmith chunk-signoff` refuse a missing
     verdict, a verdict with no citation, and any "violated". -->

## Findings Ledger
<!-- Populated by audit. Each finding gets a stable ID (e.g. F1, F2, ...) that never changes or
     gets reused. Round N+1 auditors read this ledger and report ONLY NEW findings — they do not
     re-litigate findings already recorded here. Max 3 audit rounds total (see
     state-machine.md "Repair Loop Bound"); after round 3, remaining findings are triaged with
     the user: real blocker, defer to a later chunk, or auditor was wrong (refuted). -->

<!-- ### Audit Round 1
- F1: <!-- finding --> — disposition: <!-- fixed | deferred | refuted -->
-->

## Revision Rounds
<!-- Append-only. Never edit or delete a prior round's entry — a new round is always a new
     "### Revise N" section, even if it supersedes an earlier one. Fed by the revise step's
     four-category triage (see build/revise.md): category (a) this-chunk defect = fix now
     (recorded here), category (b) future scope (goes to SKETCH.md's Ideas Backlog instead),
     category (c) not-built-yet = expectation reset (no write is made — nothing to record, the
     chunk already correctly excluded it), category (d) rules change (goes to RULINGS.md). -->

<!--
### Revise 1
- date:
- triaged feedback items:
- disposition:
-->

## Spec Manifest
<!-- Per-file spec manifest for spec-step crash/resume, and the durable RED evidence the TDD
     guarantee rests on (build/spec.md "Persistence"). One row per test file this chunk introduces,
     except a guard under tests/guards/, which is never a row (build/test.md "The A11y Floor").
     That holds at any step: a new test file that runs the game's code, written by spec, build (a
     regression test) or repair (a measurement test), is a row, or test-step-check reports it. Never
     rows: every file under tests/browser/, which only Playwright runs (tests/browser/smoke.spec.ts
     among them), the generated tests/examples/<slug>.examples.test.ts, a
     measurement harness under design/chunks/<slug>/evidence/, a guard under tests/guards/, and an
     earlier chunk's test file this chunk edits in place (moving one makes a new file, which is a row). A row with no claims
     says so in Claims Covered, e.g. `none (regression)`. An exempt chunk that pins an earlier
     chunk's behaviour writes its test as such a row, `| <file> | none (regression) | n/a |`: the
     one row excused from an observed red, since the behaviour already exists, so its RED Observed
     is `n/a` only. It is still mutation-tested, on the game code its test runs (code under src/
     its tests ran, measured with coverage, leaving out modules it mocks), at most 100 mutants per row.
     Claims Covered lists the ## Interpretation claim numbers that file pins. RED Observed flips
     from `pending` to `yes` only after that file's tests have ACTUALLY been run and seen failing —
     never ahead of the run, never in a batch at the end.

     A chunk that introduces no new game behavior writes a single exemption row naming the reason
     (build/spec.md "Exemptions") rather than silently leaving the table empty, written exactly
     `| exempt | <reason> | n/a |`. `boardsmith test-step-check <slug>` (build/test.md item 2(c))
     reads this table and fails the test step on a row whose claims have no citing test. -->

| Test File | Claims Covered | RED Observed |
|-----------|----------------|--------------|
<!-- | src/...test.ts | 1, 3, 4 | pending / yes | -->

## Build Manifest
<!-- Per-file build manifest for build-step crash/resume — file-by-file, not step-by-step, so a
     session that crashes mid-build knows exactly which files were already written vs. still
     pending, without re-deriving that from git status alone. -->

| File | Status |
|------|--------|
<!-- | src/... | written / pending | -->

## Playtest Test Script
<!-- Numbered, click-by-click. Must specify: seat count + per-seat steps; dev-host affordances
     (seat switcher, Follow-active-seat, etc.) taught once at the top rather than repeated per
     step; a build stamp (so the human knows which commit they're testing); a one-line
     regression check ("does anything that worked before still work?"); a standing "does
     anything look off?" taste-check line; and — for chunks with hidden information — an
     explicit second-seat leak check (switch to the other seat, confirm nothing hidden leaked
     into view/DOM). Outcome-based, not gesture-based: describe what should be observed, not
     just what to click. -->

Build stamp: <!-- commit hash or "not yet built" -->

1. <!-- seat 1 step --> — expect: <!-- observable outcome -->
2. ...

Regression check: <!-- one line -->
Taste check: does anything look off?
Second-seat leak check (if hidden info): <!-- steps, or "n/a — no hidden info in this chunk" -->

## Verified Checklist
<!-- Explicit item-by-item checklist confirmed by the human at playtest/close. Every item must
     be individually confirmed by the designer (or the chunk waived by the designer instead; see
     "## Sign-off" below) before Status can move to `verified`. Status moves only through
     `boardsmith chunk-signoff`, which refuses a sign-off that leaves any item unobserved. -->

- [ ] <!-- item 1 -->
- [ ] <!-- item 2 -->

<!-- If the designer explicitly chooses to skip playtesting, that is a waiver they grant with
     `boardsmith chunk-waiver`, naming this chunk; the sign-off below cites it and derives
     Status: verified (user-waived). -->

## Sign-off
<!-- MACHINE-OWNED. Written by `boardsmith chunk-signoff <slug>` and `boardsmith chunk-reopen
     <slug>` and by nothing else. It records who signed this chunk off, when, and on what basis:
     the designer's observed checklist items, a designer waiver that names this chunk, or (only
     for a chunk with no designer playtest) the automated test and sim pass. It also records a
     hash of each source file the Build Manifest names, so the sign-off covers only the code that
     was signed. The Status line above is DERIVED from this block, never typed: `boardsmith
     chunk-check` refuses a verified Status that this block does not back, after `boardsmith
     chunk-reopen` has voided it, and once one of those files changes in a way nothing accounts
     for. A later chunk's edit to a shared file is accounted for by that chunk: by its later
     sign-off, or while it is being built. -->

<!-- boardsmith:signoff:begin -->
_Not yet signed off._
<!-- boardsmith:signoff:end -->

## Verified Commit Hash
<!-- Recorded at close. This is the bisect anchor for any later regression and the diff base
     for "what changed since the human last said yes." Commit BEFORE build starts too, so
     work-in-progress is always distinguishable from the last verified baseline
     (state-machine.md "Git Protocol"). -->

<!-- <commit-hash> -->

## Verified Against
<!-- MACHINE-OWNED. Written by `boardsmith chunk-check <slug>` and by nothing else — never
     hand-author anything between the fences below; the next `chunk-check` run overwrites it
     regardless of what a session puts there. It is fenced rather than merely documented because
     on 2026-07-28 a session filled a machine-owned section (`## Open Rules Gaps`) by hand and the
     result looked entirely healthy while being wrong — prose asking a session not to do this did
     not stop it; a fence makes hand-authoring detectable, and `chunk-check` makes it fatal. -->

<!-- boardsmith:verified-against:begin -->
_Not yet recorded._
<!-- boardsmith:verified-against:end -->

## Rules Staleness
<!-- MACHINE-OWNED. Written by `boardsmith verify-impact-apply <slug>` and by nothing else —
     never hand-author anything between the fences below; the next `verify-impact-apply` run
     overwrites it regardless of what a session puts there. It is fenced for the same reason
     "## Verified Against" above is: on 2026-07-28 a session filled a machine-owned section
     (`## Open Rules Gaps`) by hand and the result looked entirely healthy while being wrong —
     prose asking a session not to do this did not stop it; a fence makes hand-authoring
     detectable, and `verify-impact-apply` makes it fatal.

     Valid marker values (exact, case-sensitive): clear |
     rules-stale — rulebook moved since this chunk was verified

     This marker is ORTHOGONAL to the Status line above (state-machine.md "Rules Staleness
     Marker") — a `verified` chunk stays `verified` even while this marker is set; the two are
     independent axes and neither is ever folded into the other. -->

<!-- boardsmith:rules-staleness:begin -->
_Not rules-stale._
<!-- boardsmith:rules-staleness:end -->
