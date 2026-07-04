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
     "## Newly Discovered Citations", "## Findings Ledger", "## Revision Rounds",
     "## Build Manifest", "## Playtest Test Script",
     "## Verified Checklist", "## Verified Commit Hash". If any required heading is missing, or
     the Status line doesn't match a recognized enum value above, a resuming session STOPS and
     asks the user — it never guesses the intended state. See state-machine.md
     "Cold-Resume Parse Contract". -->

## ui:
<!-- Restated from this chunk's SKETCH.md entry (redundant-but-safe): none | touches | major.
     A CHUNK-only session (no SKETCH.md re-read) still knows whether the a11y floor + design-
     review audit apply. Keep this in sync if SKETCH.md's tag ever changes for this chunk. -->
none

## Ceremony
<!-- Declared at proposal time. Full ceremony runs all 10 steps below. Light path is for chunks
     tagged trivial at proposal (e.g. "swap in the real card images") and only runs
     build, test, playtest — skipping investigate/redteam/ask/audit/repair/revise/close's
     adversarial machinery. The user is told which path is in effect when the chunk is proposed. -->
full
<!-- Valid values: full | light -->

## Step Checklist
<!-- Full-ceremony step names (exact, in order) — do not paraphrase, do not reorder:
     investigate, redteam, ask, build, test, audit, repair, playtest, revise, close
     Light-path step names (exact, in order): build, test, playtest
     Check off a step only when it is fully complete; do not check ahead. -->

- [ ] investigate
- [ ] redteam
- [ ] ask
- [ ] build
- [ ] test
- [ ] audit
- [ ] repair
- [ ] playtest
- [ ] revise
- [ ] close

<!-- Light path (used instead of the full checklist above when Ceremony: light):
- [ ] build
- [ ] test
- [ ] playtest
-->

## Interpretation
<!-- Numbered list of factual claims this chunk's design rests on, each with a citation into
     the rulebook (via INDEX.md) or RULINGS.md. Every agent that reads a rulebook slice
     (investigate, redteam, audit) also reads RULINGS.md — the rulebook plus RULINGS.md together
     form the composite source of truth. Append new claims as investigate discovers them; never
     renumber existing claims. -->

1. <!-- claim text --> — cites <!-- rulebook section / RULINGS.md entry -->

## Visibility Declaration
<!-- What is hidden from whom, keyed to the claims above (e.g. "claim 3: opponent's hand is
     hidden from all other seats until reveal"). Empty/none is a valid declaration for chunks
     with no hidden information — state that explicitly rather than leaving this section blank. -->

<!-- none -->

## Newly Discovered Citations
<!-- Appended during investigate when INDEX.md search surfaces rulebook sections not already
     cited above. Append-only — do not delete an entry once recorded, even if a later round
     supersedes it (supersession is itself a new entry). -->

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
     "### Revise N" section, even if it supersedes an earlier one. Fed by the playtest step's
     triage: category (a) fix now (recorded here), category (b) future scope (goes to SKETCH.md's
     Ideas Backlog instead), category (c) not a real issue (recorded here as refuted). -->

<!--
### Revise 1
- date:
- triaged feedback items:
- disposition:
-->

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
     be individually checked (or the chunk recorded as `verified (user-waived)` instead — see
     Status line above) before Status can move to `verified`. Silently marking `verified` without
     walking this checklist is prohibited. -->

- [ ] <!-- item 1 -->
- [ ] <!-- item 2 -->

<!-- If the human explicitly chooses to skip playtesting, record that honestly: set
     Status: verified (user-waived) instead of silently marking verified. -->

## Verified Commit Hash
<!-- Recorded at close. This is the bisect anchor for any later regression and the diff base
     for "what changed since the human last said yes." Commit BEFORE build starts too, so
     work-in-progress is always distinguishable from the last verified baseline
     (state-machine.md "Git Protocol"). -->

<!-- <commit-hash> -->
