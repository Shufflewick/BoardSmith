# 171-PROOF — PROC-01 record, 2026-07-28

**Both new commands, `chunk-provenance-status` and `chunk-check`, run against real, pre-contract
project data from both reference games — `~/BoardSmithGames/seven` (READ-ONLY, copied) and
`~/BoardSmithGames/one-two-punch` (copied). Every assertion below is on real observed output.**

---

## What was run

All commands ran from `/Users/jtsmith/BoardSmith` via `bin/boardsmith.js` (tsx, no build step),
against `cp -R` copies of both games in a scratch directory (never against the reference repos
directly). The scratch copies were deleted at the end of this run (see "Cleanup" below).

```
COPY_SEVEN=<scratch>/171-07-proof/seven          # cp -R of ~/BoardSmithGames/seven
COPY_OTP=<scratch>/171-07-proof/one-two-punch    # cp -R of ~/BoardSmithGames/one-two-punch

node bin/boardsmith.js chunk-provenance-status --project "$COPY_OTP" --json     # pre-run
node bin/boardsmith.js chunk-provenance-status --project "$COPY_SEVEN" --json   # pre-run

for slug in <all 12 one-two-punch chunks>; do
  node bin/boardsmith.js chunk-check "$slug" --project "$COPY_OTP" --json       # first run
done
for slug in <all 12 one-two-punch chunks>; do
  node bin/boardsmith.js chunk-check "$slug" --project "$COPY_OTP" --json       # second run (idempotence)
done

for slug in <all 17 seven chunks>; do
  node bin/boardsmith.js chunk-check "$slug" --project "$COPY_SEVEN" --json     # first run
done
for slug in <all 17 seven chunks>; do
  node bin/boardsmith.js chunk-check "$slug" --project "$COPY_SEVEN" --json     # second run (idempotence)
done

node bin/boardsmith.js chunk-provenance-status --project "$COPY_OTP" --json     # post-run
node bin/boardsmith.js chunk-provenance-status --project "$COPY_SEVEN" --json   # post-run

shasum -a 256 <one slice file>    # independent spot-check against a recorded block hash

git -C ~/BoardSmithGames/seven rev-parse HEAD
git -C ~/BoardSmithGames/seven status --porcelain
git -C ~/BoardSmithGames/one-two-punch status --porcelain
git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD

npm test
```

---

## What was observed

### Read-only invariant, BEFORE

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)

$ git -C ~/BoardSmithGames/one-two-punch status --porcelain
 D .boardsmith/runtime-bundle.mjs
 D .boardsmith/runtime-entry.ts
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```

`seven` matched the expected commit exactly with an empty working tree. `one-two-punch` was
**not** clean at the start — it already carried two pre-existing deleted-file entries unrelated
to this plan (not staged, not caused by any command run here). This is recorded honestly below
rather than glossed over; see "Deviation from the literal acceptance text" at the end.

### Task 1 — pre-run three-state classification (both copies)

`chunk-provenance-status --json` on the one-two-punch copy:

```json
{
  "counts": { "full": 0, "codeConformanceOnly": 0, "unknown": 12 },
  "byEdition": { "not stated in the rulebook": [ /* all 12 slugs */ ] },
  "bySkillsTreeHash": {},
  "byBoardsmithVersion": {},
  "verifiedWithoutProvenance": [ /* all 12 slugs */ ],
  "projectProvenanceState": "pre-provenance"
}
```

on the seven copy:

```json
{
  "counts": { "full": 0, "codeConformanceOnly": 0, "unknown": 17 },
  "byEdition": { "not stated in the rulebook": [ /* all 17 slugs */ ] },
  "bySkillsTreeHash": {},
  "byBoardsmithVersion": {},
  "verifiedWithoutProvenance": [ /* all 17 slugs */ ],
  "projectProvenanceState": "pre-provenance"
}
```

**Every chunk in both games is `unknown`, `full` and `codeConformanceOnly` are both 0, and every
chunk that reports `unknown` is also in `verifiedWithoutProvenance` — exactly the phase's stated
ready-made proof target.** `projectProvenanceState: "pre-provenance"` on both, which is the field
that keeps this from being presented as an alarm (see "What this proves" below).

**Independent cross-check (not trusting the command's own arithmetic):**

```
$ grep -rl '^Status: verified' one-two-punch/chunks/*/CHUNK.md | wc -l
      12
$ grep -rl '^Status: verified' seven/chunks/*/CHUNK.md | wc -l
      17
$ ls -d one-two-punch/chunks/*/ | wc -l
      12
$ ls -d seven/chunks/*/ | wc -l
      17
```

`verifiedWithoutProvenance.length` (12, 17) equals the independently-grepped verified-chunk count
for each game, and equals the total chunk-directory count for each game — every single chunk in
both games claims verification, and every single one is flagged.

### Task 2 — chunk-check on real chunks

**One-two-punch, all 12 chunks, first run.** Every run exited 1 (block created), every recorded
scope was `code-conformance-only` with reason `pre-provenance-project` — no exceptions, no
`source-missing`. 11 of 12 chunks resolved at least one cited slice on real prose (the sole
exception, `ai-opponent`, resolved zero — its `## Interpretation` cites no `rulebook/` slice
directly, confirmed by inspection: it argues from `RULINGS.md`/`DECISIONS.md`/game-code sources
only):

```
ai-opponent                  → cited: []   (0 slices — the one exception)
block                        → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
discard-phase-and-reclaim    → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
final-acceptance             → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
game-end                     → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
jab                          → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
movement-advance-retreat     → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
plan-and-reveal              → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
punch                        → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
rest                         → cited: [rulebook/00-visual-survey.md, rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
second-action-resolution     → cited: [rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
setup-opening-discards       → cited: [rulebook/00-visual-survey.md, rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md]
```

All 12 `unresolved: []` — no unresolvable citation in this game's live prose (all citations use
full slice filenames; see "Ambiguous shorthand" finding below for why).

A full rendered block, for `jab` (verbatim, from a re-run on a fresh copy for this transcription):

```
## Verified Against

<!-- MACHINE-OWNED. Do not write between the fences below, and do not move or delete them.
     ... (comment body, unchanged from 171-04-SUMMARY.md's own transcription) ... -->

<!-- boardsmith:verified-against:begin -->
Scope: code-conformance-only
Reason: pre-provenance-project
Rulebook edition: not stated in the rulebook
Rulebook source hash: none recorded
BoardSmith version: 0.0.1
Skills tree hash: c78dbcde5ea10369decc7fc858cea16d19f974dcb268139829fe2b7164c8e512

Cited slices:

| slice | sha256 |
|---|---|
| rulebook/01-setup-and-round-structure.md | 19dd7e2f0635ce128391bdaa008f606ed77a4e98729789091884a7ddfc6572cd |
| rulebook/02-action-cards-and-resolution.md | dca5e0d99ab8c7c229a8b62d760388fc517b2c4011fe235a4f918cefc2ee8cfd |
<!-- boardsmith:verified-against:end -->
```

Note `Rulebook edition: not stated in the rulebook` — the F-1 normalisation applied to
one-two-punch's raw `Edition: none stated in the rulebook — © 2020 Alright Games (...)` free
text. `Rulebook source hash: none recorded` — never fabricated, honestly reflecting that
one-two-punch's `INDEX.md` has no `Source hash:` line at all (the `pre-provenance-project` case).

**Second run (idempotence), all 12 chunks:** every run reported `"changed": false` and exited 0.
Independent byte-for-byte comparison (`shasum -a 256` before vs after the second pass) —
**identical for all 12 files.**

**Seven, all 17 chunks, first run.** Every run exited 1, every recorded scope was
`code-conformance-only` / `pre-provenance-project`. Cited-slice counts per chunk, verbatim:

```
best-seven-selection          → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]     unresolved: [rulebook/INDEX.md]
bonus-point-cards             → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]     unresolved: []
discard                       → cited: [rulebook/00-visual-survey.md, rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md, rulebook/02-solo-variant.md]  unresolved: [rulebook/INDEX.md]
final-acceptance               → cited: []                                                                                       unresolved: []
game-end-trigger              → cited: [rulebook/00-visual-survey.md, rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md, rulebook/02-solo-variant.md]  unresolved: [rulebook/INDEX.md]
game-score-and-winner         → cited: [rulebook/01-overview-setup-and-play.md, rulebook/02-solo-variant.md]                    unresolved: []
match-best-of-7               → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md, rulebook/02-solo-variant.md]  unresolved: []
scoring-combo-sets-and-runs   → cited: []                                                                                       unresolved: [rulebook/INDEX.md]
scoring-declaration           → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]     unresolved: []
scoring-engine-and-parity     → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]     unresolved: [rulebook/INDEX.md]
scoring-one-color             → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]     unresolved: [rulebook/INDEX.md]
scoring-run-of-7              → cited: [rulebook/01-definitions-and-components.md]                                              unresolved: [rulebook/INDEX.md]
scoring-run-of-7-one-color    → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md, rulebook/02-solo-variant.md]  unresolved: [rulebook/INDEX.md]
scoring-set-5-plus-set-2      → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]     unresolved: [rulebook/INDEX.md]
scoring-set-of-7              → cited: [rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]     unresolved: [rulebook/INDEX.md]
simultaneous-round-loop       → cited: [rulebook/00-visual-survey.md, rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md]  unresolved: [rulebook/INDEX.md]
table-and-draw                → cited: [rulebook/00-visual-survey.md, rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md, rulebook/02-solo-variant.md]  unresolved: [rulebook/INDEX.md]
```

15 of 17 chunks resolve at least one cited slice (`final-acceptance` and
`scoring-combo-sets-and-runs` resolve zero — both argue chiefly from `RULINGS.md`/code, confirmed
by inspection). **`rulebook/INDEX.md` appears verbatim under `unresolved` in 11 of the 17
chunks** — these chunks genuinely cite the index file itself (e.g. "per `rulebook/INDEX.md`'s
'Open Rules Gaps' #1"), which `resolveCitedSlices()` correctly refuses to resolve because
`INDEX.md` is deliberately excluded from the slice-filename set it resolves against (it is the
index, not a slice). This is the visible-failure guarantee from CONTEXT.md decision 8 doing real
work on real prose: a citation the function cannot honestly resolve is recorded, not dropped.

**Second run (idempotence), all 17 chunks:** every run reported `"changed": false`, exit 0.
Independent `shasum -a 256` before/after — **identical for all 17 files.**

**Independent hash spot-check:** the block's recorded hash for `jab`'s cited
`rulebook/02-action-cards-and-resolution.md` was `dca5e0d99ab8c7c229a8b62d760388fc517b2c4011fe235a4f918cefc2ee8cfd`.
Independently:

```
$ shasum -a 256 one-two-punch/rulebook/02-action-cards-and-resolution.md
dca5e0d99ab8c7c229a8b62d760388fc517b2c4011fe235a4f918cefc2ee8cfd  .../02-action-cards-and-resolution.md
```

**Match, exact.**

### Post-run three-state classification (both copies)

```json
// one-two-punch
{ "counts": { "full": 0, "codeConformanceOnly": 12, "unknown": 0 },
  "verifiedWithoutProvenance": [],
  "projectProvenanceState": "complete",
  "byEdition": { "not stated in the rulebook": [ /* all 12 */ ] } }

// seven
{ "counts": { "full": 0, "codeConformanceOnly": 17, "unknown": 0 },
  "verifiedWithoutProvenance": [],
  "projectProvenanceState": "complete",
  "byEdition": { "not stated in the rulebook": [ /* all 17 */ ] } }
```

Every chunk moved from `unknown` to `code-conformance-only`, `unknown` is 0 in both, and the
`verifiedWithoutProvenance` flag cleared to `[]` for both — the flag raised on 29/29 chunks before
any `chunk-check` ran, and cleared on all 29 once it did.

### Edition grouping (F-1 normalisation on live data)

Raw `Edition:` lines differ between the two games:

```
one-two-punch: Edition: none stated in the rulebook — © 2020 Alright Games (transcribed from `rules.pdf`, 2 pages)
seven:         Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation
```

Yet both games' `byEdition` in the post-run status groups every one of their chunks under the
single key `"not stated in the rulebook"` — the normalised `EDITION_UNKNOWN` sentinel, not a
paraphrase of either free-text line. F-1 is demonstrated fixed on live, non-fixture data.

### Ambiguous `rulebook/01` shorthand — NOT exercised in live prose (recorded honestly)

`171-CONTEXT.md`'s interface note states `seven` has two slices beginning `01-`
(`01-definitions-and-components.md`, `01-overview-setup-and-play.md`), making a bare
`rulebook/01` shorthand citation structurally ambiguous there. This plan searched all 17 seven
chunks (and, for contrast, all 12 one-two-punch chunks) for that literal shorthand form:

```
$ grep -rEon 'rulebook/[0-9]{2}([^-a-zA-Z0-9]|$)' seven/chunks/*/CHUNK.md
(no output)

$ grep -rEon 'rulebook/[0-9]{2}([^-a-zA-Z0-9]|$)' one-two-punch/chunks/*/CHUNK.md
block/CHUNK.md: rulebook/02,  (×9 occurrences)
block/CHUNK.md: rulebook/01,  (×3 occurrences)
```

**Finding, stated plainly:** no chunk in `seven`'s real chunk prose actually uses the bare
`rulebook/01` (or `rulebook/02`) shorthand form anywhere — every citation in `seven` uses a full
slice filename. The shorthand form DOES appear live in `one-two-punch` (`block`'s chunk uses
`rulebook/01,` / `rulebook/02,` repeatedly) — but `one-two-punch` has only ONE `01-` slice, so
that shorthand is unambiguous there and resolves cleanly (confirmed: `block`'s recorded
`citedSlices` above includes both `rulebook/01-setup-and-round-structure.md` and
`rulebook/02-action-cards-and-resolution.md`, and its `unresolved` is empty).

So the genuinely-ambiguous case — a bare `rulebook/01` shorthand where `rulebook/` really does
contain two `01-` files — **does not occur in either reference game's live chunk prose today**,
and this run cannot demonstrate it on real data as the plan anticipated. What CAN be said
honestly:

- The resolution logic itself (`resolveCitedSlices()`) is unit-tested against a fixture that
  reproduces exactly this ambiguity — two `01-`-prefixed slice filenames and a bare `rulebook/01`
  citation — per `171-VALIDATION.md`'s Wave 0 requirement ("A fixture reproducing `seven`'s
  genuinely ambiguous two-`01-`-slices case"), and that fixture is confirmed present and green in
  the full `npm test` run below.
- What ran on live data instead, and did demonstrate the "recorded verbatim, not dropped"
  guarantee for real: the 11 `seven` chunks whose prose cites `rulebook/INDEX.md` (a real,
  non-slice target) all show that citation recorded verbatim under `unresolved`, never silently
  dropped and never guessed at — this is the same visible-failure code path
  (`resolveCitedSlices`'s "no candidates" / "not a slice" branch) exercised on genuinely messy
  real prose, just not by the exact ambiguous-`01` scenario this plan expected to find.

This is recorded as a limitation of what this specific run demonstrates, not a defect: the
command behaves correctly on the data that exists; the data that exists simply does not happen to
contain the anticipated ambiguous-shorthand citation.

---

## `npm test`

```
 Test Files  229 passed (229)
      Tests  3407 passed (3407)
```

Baseline (per `171-VALIDATION.md`) was 3407 at phase start; still 3407/3407, all green. No test
was added or modified by this plan (it is a proof-only plan; `files_modified` is `171-PROOF.md`
alone).

---

## What this proves

- **PROV-01** — `chunk-check` writes a real fenced `## Verified Against` block recording: scope,
  reason (when reduced), rulebook edition (normalised), rulebook source hash (`none recorded`
  when absent, never fabricated), BoardSmith version, skills-tree hash, and a table of cited
  slices with real SHA-256 hashes — demonstrated on 29/29 real chunks across two real games, one
  hash independently cross-checked and matching exactly.
- **PROV-02** — scope is computed from disk, never declared: all 29 chunks, on two games that
  genuinely have no `rulebook/source/` and no `Source hash:` line, correctly land on
  `code-conformance-only` / `pre-provenance-project` — never `source-missing`, which would have
  been the wrong reason code (that one means "had provenance, lost it," not "never had it").
  Verified as a live STOP condition per this plan's own Task 2 step 2: it did not fire, because
  the precedence order correctly reached `pre-provenance-project` in all 29 cases.
- **PROV-03** — the three-state classification (`full` / `code-conformance-only` / `unknown`) is
  demonstrated distinct in the `--json` shape on real data: 29/29 `unknown` before, 0/29 `unknown`
  after, `code-conformance-only: 0 → 29`, `full` staying `0` throughout (neither game has
  Phase-170-contract source archives, so `full` was never reachable here — correctly so).
  `verifiedWithoutProvenance` raised on all 29 chunks before any `chunk-check` ran and cleared to
  `[]` on all 29 after. `projectProvenanceState` correctly read `pre-provenance` throughout the
  raised period (never presented as an alarm) and `complete` once every verified chunk had a
  block. Edition drift-grouping normalises two different raw free-text lines to one bucket on live
  data (F-1).

---

## What This Does NOT Prove

- **That a live `/bs-build-chunk` `close` session actually invokes `boardsmith chunk-check`.**
  That wiring is skill text (plan 06), and it carries Phase 170's documented skip risk: twelve
  instruction-shaped mechanisms were each verified present in the installed skill tree and each
  skipped on live runs across fourteen sessions. Nothing in this plan runs a live `/bs-build-chunk`
  session — every invocation above was a direct CLI call (`node bin/boardsmith.js chunk-check
  <slug> --project <copy>`), not a session following the `close` instruction. Plan 06's tests prove
  the instruction to invoke it EXISTS in the installed text; they do not and cannot prove a session
  FOLLOWS it, and neither does this plan.
- **That Phase 170's `/bs-build-chunk` Step 0 `ingest-check` call works on a live session either.**
  It has still never been exercised by a live session, across this phase and the one before it.
- **The two load-bearing guarantees that do NOT depend on a session following a skill-text
  instruction** are the ones this plan actually exercised and is staked on:
  1. **The machine-owned fence.** `chunk-check` refuses to write when the fences around
     `## Verified Against` are gone, rather than silently re-fencing a hand-authored block — this
     makes a hand-faked provenance record structurally detectable, independent of whether `close`
     ever runs the command.
  2. **`chunk-provenance-status`'s `verifiedWithoutProvenance` flag**, severity-tiered by
     `projectProvenanceState`. This is what surfaces a chunk whose `Status:` claims verification
     with no block behind it — regardless of WHY the invocation was skipped. This plan
     demonstrated the flag raising correctly (all 29, pre-provenance, presented as yellow "no
     recorded provenance yet," never red) and clearing correctly (0/29, once every chunk had a
     real block).
- **Follow-up recommended, not performed here:** a live-session gate exercising `/bs-build-chunk`'s
  `close` path end-to-end against a real project is the only thing that will settle whether the
  `close → chunk-check` wiring actually fires on a live run. Per STATE.md's standing policy from
  Phase 170, **the ingest harness must not be used as a substitute for that gate** — this plan does
  not invoke the harness at all, consistent with that policy.

---

## Read-only invariant — AFTER

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)

$ git -C ~/BoardSmithGames/one-two-punch status --porcelain
 D .boardsmith/runtime-bundle.mjs
 D .boardsmith/runtime-entry.ts
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```

`seven`: byte-identical to the BEFORE state, HEAD unchanged, working tree still empty. Every
writing command in this plan ran only against `cp -R` copies in scratch, never against this repo.

`one-two-punch`: BEFORE and AFTER are identical — same two pre-existing deleted-file entries,
same HEAD. This plan did not touch it either; the copy-and-work-in-scratch discipline held for
both games.

### Deviation from the literal acceptance text

`171-07-PLAN.md`'s Task 3 acceptance criteria state `git -C ~/BoardSmithGames/one-two-punch
status --porcelain` prints nothing. It does not — it prints the same two pre-existing `D` entries
both before AND after this plan ran, confirmed identical in both checks above. This is recorded
here rather than silently treated as passing: the plan's stated criterion (empty output) was not
literally met, but the actual invariant that criterion exists to protect — **this plan does not
mutate `one-two-punch`** — is proven by the before/after comparison being byte-identical. The
pre-existing dirty state predates this plan's execution and was not introduced by any command run
here.

---

## Cleanup

Both scratch copies (`<scratch>/171-07-proof/seven`, `<scratch>/171-07-proof/one-two-punch`) were
deleted after this record was written. Neither reference game's working directory was ever
written to.
