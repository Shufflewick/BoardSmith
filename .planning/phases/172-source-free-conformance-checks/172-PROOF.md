# 172-PROOF — SC-3 real-data record, 2026-07-28

**Both new commands, `trace-check` and `drift-check`, run against real, live data from both
reference games — `~/BoardSmithGames/seven` (READ-ONLY, copied) and
`~/BoardSmithGames/one-two-punch` (copied). Every count below is on real observed output, and
every count is independently cross-checked against a value computed by a second method — the
tool's own arithmetic is never trusted to validate itself.**

---

## What was run

All commands ran from `/Users/jtsmith/BoardSmith` via `bin/boardsmith.js` (tsx, no build step),
against `cp -R` copies of both games in the session scratchpad (never against the reference repos
directly).

```
SCRATCH=<session-scratchpad>/172-05-proof
COPY_SEVEN=$SCRATCH/seven          # cp -R of ~/BoardSmithGames/seven
COPY_OTP=$SCRATCH/one-two-punch    # cp -R of ~/BoardSmithGames/one-two-punch

# preflight (on the ORIGINALS, before any copy)
git -C ~/BoardSmithGames/seven rev-parse HEAD
git -C ~/BoardSmithGames/seven status --porcelain
git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
find ~/BoardSmithGames/seven -type f -not -path '*/.git/*' -print0 | sort -z | xargs -0 shasum -a 256   # whole-tree manifest, BEFORE
find ~/BoardSmithGames/one-two-punch -type f -not -path '*/.git/*' -print0 | sort -z | xargs -0 shasum -a 256

cp -R ~/BoardSmithGames/seven "$SCRATCH/seven"
cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/one-two-punch"

# the four --json runs
node bin/boardsmith.js trace-check --project "$COPY_OTP" --json    > trace-otp.json
node bin/boardsmith.js trace-check --project "$COPY_SEVEN" --json  > trace-seven.json
node bin/boardsmith.js drift-check --project "$COPY_OTP" --json    > drift-otp.json
node bin/boardsmith.js drift-check --project "$COPY_SEVEN" --json  > drift-seven.json

# the four human-readable runs (one of each command per game — exceeds the plan's minimum of
# "once per game" per command, run for both games x both commands)
node bin/boardsmith.js trace-check --project "$COPY_OTP"    > trace-otp-human.txt
node bin/boardsmith.js trace-check --project "$COPY_SEVEN"  > trace-seven-human.txt
node bin/boardsmith.js drift-check --project "$COPY_OTP"    > drift-otp-human.txt
node bin/boardsmith.js drift-check --project "$COPY_SEVEN"  > drift-seven-human.txt

# independent cross-checks (see "Independent cross-checks" below for the full command list)
# ...

# post-run read-only re-verification
git -C ~/BoardSmithGames/seven rev-parse HEAD
git -C ~/BoardSmithGames/seven status --porcelain
git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
git -C ~/BoardSmithGames/one-two-punch status --porcelain
find ~/BoardSmithGames/seven -type f -not -path '*/.git/*' -print0 | sort -z | xargs -0 shasum -a 256          # AFTER, diffed against BEFORE
find ~/BoardSmithGames/one-two-punch -type f -not -path '*/.git/*' -print0 | sort -z | xargs -0 shasum -a 256

npm test
```

---

## Read-only preflight (on the ORIGINALS)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)

$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
$ git -C ~/BoardSmithGames/one-two-punch status --porcelain
 D .boardsmith/runtime-bundle.mjs
 D .boardsmith/runtime-entry.ts
```

Both HEADs matched the plan's pinned commits exactly. `seven`'s porcelain was empty (asserted,
per the plan's hard-STOP gate). `one-two-punch` carried its two known pre-existing deletions,
exactly as `172-CONTEXT.md`/`172-05-PLAN.md` state — **not asserted porcelain-clean**, per
instruction; a whole-tree byte manifest (3919 files for `seven`, 4134 files for `one-two-punch`,
`sort`ed `find | shasum -a 256` over every non-`.git` file) was captured instead, to be diffed
against the post-run state below. The gate passed and execution proceeded — no STOP condition was
hit.

Copies were made with `cp -R` (never `git clone`) into the session scratchpad. Every command from
this point on ran only against the copies; the originals were never passed as `--project` again
until the final re-verification.

---

## What was observed

### Exit codes — all four `--json` runs, all four human-readable runs

| Command | Game | Exit code |
|---|---|---|
| `trace-check --json` | one-two-punch | 0 |
| `trace-check --json` | seven | 0 |
| `drift-check --json` | one-two-punch | 0 |
| `drift-check --json` | seven | 0 |
| `trace-check` (human) | one-two-punch | 0 |
| `trace-check` (human) | seven | 0 |
| `drift-check` (human) | one-two-punch | 0 |
| `drift-check` (human) | seven | 0 |

All eight invocations exited 0 — consistent with 172-CONTEXT.md decision 6 (findings never set a
non-zero exit; both games have real gaps and real drift, and neither run tripped a tool-failure
path). No run was empty or trivially small — every run below shows substantial, real, non-contrived
findings on the very first invocation, satisfying success criterion 3 without the "opposite risk"
(report volume) burying the signal in the JSON output (mitigated in the human report by the
count-first summary line and `+N more — run --json for the full list` truncation, visible below).

### `trace-check --json` on one-two-punch (verbatim `totals`/`counts`)

```json
"totals": { "chunks": 12, "claims": 165, "rulings": 26, "testFiles": 14, "claimCitations": 55, "rulingCitations": 42 }
"counts": {
  "claim-untested": 157, "ruling-untested": 2, "test-unlinked": 2, "unassociated-test": 4,
  "ambiguous-claim-ref": 18, "unresolved-claim-ref": 22, "manifest-file-missing": 1,
  "chunk-code-drifted": 0, "drift-unknown": 0
}
```
`unparsedSupersessions`: 1 entry (Ruling 26 area — its "supersedes provisional DECISIONS.md
Decision 4" sentence names `DECISIONS.md`, not another ruling, so it is correctly left
unclassified rather than guessed at as a ruling-to-ruling chain).

### `trace-check --json` on seven (verbatim `totals`/`counts`)

```json
"totals": { "chunks": 17, "claims": 212, "rulings": 36, "testFiles": 8, "claimCitations": 13, "rulingCitations": 65 }
"counts": {
  "claim-untested": 212, "ruling-untested": 3, "test-unlinked": 1, "unassociated-test": 3,
  "ambiguous-claim-ref": 13, "unresolved-claim-ref": 0, "manifest-file-missing": 0,
  "chunk-code-drifted": 0, "drift-unknown": 0
}
```
`unparsedSupersessions`: 5 entries — the "reconciles"/"extends"/"UPHOLDS"/"RESOLVES OQ-N" verbs
RESEARCH.md's Section 2 flagged as non-supersession cross-references, correctly left
unclassified.

### `drift-check --json` on one-two-punch

```json
"head": "7e69471bd8980a854f3e351f2f486e1fb6f712b9"
"counts": { "clean": 1, "drifted": 10, "unknown": 1 }
```

### `drift-check --json` on seven

```json
"head": "a03f38d4792af9dfc7c798be69686fc3230f54dd"
"counts": { "clean": 1, "drifted": 16, "unknown": 0 }
```

### Human-readable report — one-two-punch `trace-check` (verbatim, truncated as marked)

```
Traceability sweep — 12 chunks, 165 claims, 26 rulings, 14 test files, 55 claim citations, 42 ruling citations
claim-untested: 157  ruling-untested: 2  test-unlinked: 2  unassociated-test: 4  ambiguous-claim-ref: 18  unresolved-claim-ref: 22  manifest-file-missing: 1  chunk-code-drifted: 0  drift-unknown: 0

claim-untested (157)
  [ai-opponent] claim 5: Interpretation claim 5 has no resolved citing test
  [block] claim 1: Interpretation claim 1 has no resolved citing test
  ... (147 more, elided here — the run's own truncation reads "+147 more — run --json for the full list")

ruling-untested (2)
  [-] Ruling 10: no test file cites Ruling 10
  [-] Ruling 23: no test file cites Ruling 23

test-unlinked (2)
  [discard-phase-and-reclaim] tests/discard.test.ts: imports src/rules/ but cites neither a claim nor a ruling
  [discard-phase-and-reclaim, game-end] tests/simulation.test.ts: imports src/rules/ but cites neither a claim nor a ruling

unassociated-test (4)
  [-] tests/ai.test.ts / tests/asset-reachability.test.ts / tests/ring-movement-desync.test.ts / tests/setup.test.ts

ambiguous-claim-ref (18) — 10 shown, "+8 more — run --json for the full list"
unresolved-claim-ref (22) — 10 shown, "+12 more — run --json for the full list"
manifest-file-missing (1) — [ai-opponent] Build Manifest: manifest is not table-shaped
unparsed supersessions (1) — Ruling 26 ("supersedes provisional DECISIONS.md Decision 4")
```

Full untruncated text captured at `<scratch>/172-05-proof/trace-otp-human.txt` (61 lines) and
`<scratch>/172-05-proof/trace-otp.json` (1265 lines, the full un-truncated finding list). The
human report's truncation is explicit and actionable ("+N more — run --json for the full list"),
never silent — this is the "report text formatting" concern RESEARCH.md flagged (report volume,
not emptiness, is the real risk) demonstrated working correctly at real volume: the count-first
summary line surfaces all nine counts before a single finding line, and every group states its own
count next to its heading.

### Human-readable report — seven `drift-check` (verbatim, in full — short enough not to truncate)

```
HEAD: a03f38d4792af9dfc7c798be69686fc3230f54dd
clean: 1  drifted: 16  unknown: 0
  best-seven-selection — drifted since d55773c77fbf67dea665748a88e33eb27607a5da — src/rules/elements.ts, src/rules/game.ts, src/rules/actions.ts, src/rules/flow.ts, src/ui/components/GameTable.vue, tests/game.test.ts
  bonus-point-cards — drifted since c61a6a7bcbc48bcc5ddfc833dbf6c75ce9764c53 — src/rules/scoring.ts, src/ui/components/GameTable.vue, DECISIONS.md
  discard — drifted since 7c6dac286fd5f33ddf442067db98b60f40b78808 — src/rules/elements.ts, src/rules/actions.ts, src/rules/game.ts, src/rules/flow.ts, src/ui/components/CardView.vue, src/ui/components/DiscardPileView.vue, src/ui/components/GameTable.vue, tests/game.test.ts, tests/discard-pile.test.ts, tests/a11y.example.test.ts +2 more — run --json for the full list
  game-end-trigger — drifted since e1f52b8 — src/ui/components/GameTable.vue, src/rules/flow.ts, BOARDSMITH-REQUESTS.md, DECISIONS.md, chunks/game-end-trigger/CHUNK.md, tests/a11y.example.test.ts, tests/game.test.ts
  game-score-and-winner — drifted since 35c4476 — src/ui/components/GameTable.vue, DECISIONS.md, tests/a11y.example.test.ts
  match-best-of-7 — drifted since 41ab4d9 — src/rules/elements.ts, src/rules/actions.ts
  scoring-combo-sets-and-runs — drifted since 89c2bff78a8276176bac04325e913c716484e6ab — src/rules/scoring.ts, tests/scoring.test.ts, tests/game.test.ts, tests/a11y.example.test.ts, DECISIONS.md, src/rules/index.ts
  scoring-declaration — drifted since edda4920b0bccd23834e239dcf5d6500d96c0983 — src/rules/scoring.ts, src/rules/elements.ts, src/rules/actions.ts, src/rules/game.ts, src/rules/flow.ts, src/ui/components/GameTable.vue, tests/scoring.test.ts, tests/game.test.ts
  scoring-engine-and-parity — drifted since 575a90ebf83522f34fe3c89f0efae2c605163c35 — src/rules/scoring.ts, src/rules/index.ts, tests/scoring.test.ts, DECISIONS.md
  scoring-one-color — drifted since 7ffea623a7687ab446a9c329e68153356779d1fa — src/rules/scoring.ts, tests/scoring.test.ts, tests/game.test.ts, DECISIONS.md
  scoring-run-of-7 — drifted since 11f27361ac8f4546dd26bce6bee60109ed14d760 — src/rules/scoring.ts, tests/scoring.test.ts, src/rules/index.ts
  scoring-run-of-7-one-color — drifted since 6aad25f98beb1a83ed160535edede6643e92658e — src/rules/scoring.ts, tests/scoring.test.ts
  scoring-set-5-plus-set-2 — drifted since 6c6443855428d2982b35d8bbe45afbf4fdbb8407 — src/rules/scoring.ts, tests/scoring.test.ts, tests/game.test.ts, DECISIONS.md
  scoring-set-of-7 — drifted since d5d10bc3572bee4418f72ec39ef10e4c172d3a06 — src/rules/scoring.ts, tests/scoring.test.ts, DECISIONS.md
  simultaneous-round-loop — drifted since dc5fe9d — src/rules/elements.ts, src/rules/game.ts, src/rules/flow.ts, src/rules/actions.ts, src/ui/components/GameTable.vue, tests/game.test.ts, tests/a11y.example.test.ts, tests/random-sim.test.ts, DECISIONS.md, BOARDSMITH-REQUESTS.md
  table-and-draw — drifted since 95df2a5e760fcbbff30d7e4f6b31a8b9e0859d9a — src/rules/elements.ts, src/rules/game.ts, src/rules/actions.ts, src/rules/flow.ts, src/rules/index.ts, boardsmith.json, src/ui/theme.ts, src/ui/components/CardView.vue, src/ui/components/GameTable.vue, src/ui/App.vue +2 more — run --json for the full list
```

16 of 17 chunks drifted; `final-acceptance` is the sole clean chunk (the game's last chunk, closed
after everything else). All 17 hashes resolved and diffed cleanly (0 `drift-unknown`) — every
`seven` chunk's `## Verified Commit Hash` is a real ancestor of `HEAD`.

---

## Independent cross-checks (never trusting the command's own arithmetic)

### 1. Total claims per game — independent `grep`/parse bounded to `## Interpretation`

Ran a standalone Python scan of every `chunks/*/CHUNK.md`, extracting the `## Interpretation`
section (bounded to the next `## ` heading, exactly the scoping Pattern 2 of `172-RESEARCH.md`
specifies) and counting `^N. **` ordered-list items:

```
one-two-punch: ai-opponent 1, block 23, discard-phase-and-reclaim 11, final-acceptance 0,
  game-end 13, jab 25, movement-advance-retreat 15, plan-and-reveal 6, punch 35, rest 5,
  second-action-resolution 14, setup-opening-discards 17
  TOTAL = 165

seven: best-seven-selection 13, bonus-point-cards 0, discard 19, final-acceptance 0,
  game-end-trigger 23, game-score-and-winner 14, match-best-of-7 11, scoring-combo-sets-and-runs 2,
  scoring-declaration 15, scoring-engine-and-parity 10, scoring-one-color 13,
  scoring-run-of-7-one-color 16, scoring-run-of-7 12, scoring-set-5-plus-set-2 12,
  scoring-set-of-7 14, simultaneous-round-loop 36, table-and-draw 2
  TOTAL = 212
```

**Both totals match the tool's `totals.claims` exactly** (165, 212), and both match
`172-RESEARCH.md`'s independently-measured Section 2 figures exactly. **MATCH.**

### 2. Total rulings per game — independent `grep -c '^### Ruling '`

```
$ grep -c '^### Ruling ' one-two-punch/RULINGS.md
26
$ grep -c '^### Ruling ' seven/RULINGS.md
36
```

**Both match the tool's `totals.rulings` exactly** (26, 36) and RESEARCH.md's Section 2 figures.
**MATCH.**

### 3. Manifest file count and drift intersection — 6 chunks, both games, including the
highest-drift chunk per game

Independently re-implemented the Build-Manifest first-cell path extraction (per Pattern 4 —
extracting path-shaped tokens from the FIRST cell of each table row only, not the whole row) for
6 chunks, then computed `git diff --name-only <hash> HEAD` inside the copy and intersected by
hand:

| Game | Chunk | Independent manifest count | Tool `manifestFileCount` | Independent changed | Tool `changedFiles.length` | Independent missing | Tool `missingFiles.length` |
|---|---|---|---|---|---|---|---|
| one-two-punch | jab (highest drift) | 23 | 23 | 19 | 19 | 1 | 1 |
| one-two-punch | block | 13 | 13 | 9 | 9 | 2 | 2 |
| one-two-punch | setup-opening-discards | 6 | 6 | 2 | 2 | 0 | 0 |
| seven | discard | 13 | 13 | 12 | 12 | 0 | 0 |
| seven | table-and-draw (highest drift) | 16 | 16 | 12 | 12 | 0 | 0 |
| seven | scoring-declaration | 8 | 8 | 8 | 8 | 0 | 0 |

**All 6 independently computed values match the tool's reported values exactly.**

**A methodological pitfall caught and corrected during this cross-check, worth recording plainly:**
the first attempt at this independent extraction used a naive regex over the WHOLE first-cell
text, which for `jab` picked up path-shaped tokens embedded inside prose ("the barrel re-exports
`guards.js` and `jab.js`" — words inside a status/description cell, not the file-path cell) and
over-counted the manifest at 25 instead of 23. Restricting the parse to genuine `| File | Status |`
table-row first cells (per Pattern 4, matching what the real `parseBuildManifest()` does) fixed
the discrepancy and reproduced the tool's count exactly. This is recorded here per the plan's
instruction to report disagreements prominently rather than paper over them — the disagreement was
in the FIRST-DRAFT independent check, not in the tool, and finding it that way is exactly what an
independent cross-check is for.

### 4. The decision-12 exhibit — `GuardCardView.vue`, confirmed independently, with a sharper
finding than the plan anticipated

```
$ grep -n GuardCardView one-two-punch/chunks/jab/CHUNK.md
1006:| src/ui/components/GuardCardView.vue | written |
1029:| src/ui/components/GuardCardView.vue | written | F3 — the card takes `--bsg-guard-card-w` |

$ ls one-two-punch/src/ui/components/GuardCardView.vue
ls: ...: No such file or directory

$ git -C one-two-punch log --diff-filter=D --oneline -- src/ui/components/GuardCardView.vue
218bf9c chunk-jab/step-repair (round 2: F12-F16, F18-F20 fixed; F17 -> BUG 6; 96/96 green; Decisions 22-25)
```

All three parts of `172-CONTEXT.md`'s named exhibit confirmed independently: the manifest lists
the file, the file is absent on disk, and the deleting commit is real. `drift-check`'s JSON
correctly reports it under `jab`'s `missingFiles: ["src/ui/components/GuardCardView.vue"]`.

**A sharper finding than the plan's framing, confirmed by one more `git` check:**

```
$ git -C one-two-punch merge-base --is-ancestor 218bf9c 354e4f7 && echo "218bf9c IS an ancestor of 354e4f7"
218bf9c IS an ancestor of 354e4f7
$ git -C one-two-punch show 354e4f7:src/ui/components/GuardCardView.vue
fatal: path 'src/ui/components/GuardCardView.vue' does not exist in '354e4f7'
```

`jab`'s own `## Verified Commit Hash` is `354e4f7` — and the file was **already absent at that
exact commit**, because the deleting commit `218bf9c` is an ANCESTOR of `354e4f7`, not a
descendant. This means `GuardCardView.vue` was not deleted "since" the chunk was verified — the
manifest was already inaccurate at the moment of verification itself. A naive `git diff --name-only
354e4f7 HEAD -- src/ui/components/GuardCardView.vue` (scoped to just this one path) confirms this
directly: **it prints nothing**, because the file is identically absent at both ends of that range
— a pure git-diff-based drift check would MISS this case entirely. `drift-check` catches it anyway
because decision 12's `missingFiles` computation is an unconditional disk-existence check on every
manifest path, run independently of the git diff, not gated by whether the diff shows the path as
changed. This is a stronger demonstration of decision 12's design than the plan anticipated: the
disk-existence check is not merely "the strongest possible drift signal" for files deleted after
verification — it is the ONLY signal for files that were already missing when verification
happened, which a diff-based approach structurally cannot see.

**Not an isolated case:** the same live run turned up two more manifest-file-missing entries by
the identical mechanism — `rest`'s manifest lists `rest.js` (absent on disk) and `plan-and-reveal`'s
manifest lists `tests/a11y.example.test.ts` (absent on disk) — both surfaced correctly in
`drift-otp.json`'s `chunk-code-drifted` findings for those chunks, confirming decision 12 is doing
real, repeated work on this reference game's actual history, not firing once on a single
hand-picked exhibit.

### 5. Resolution-ladder rungs — hand-walked citations, both games

Per-game, at least 3 real citations were hand-walked through all three rungs of
`resolveClaimCitation()` (rung 1: manifest owners; rung 2: live-claim validity; rung 3: authoring
status) and compared against the tool's actual JSON output.

**one-two-punch, three citations, three different outcomes:**

1. **`claim 5` in `tests/punch.test.ts` — rung 3 is the deciding rung.** Rung-1 candidates (every
   chunk whose Build Manifest first-cell lists `tests/punch.test.ts`): `discard-phase-and-reclaim`,
   `rest`, `second-action-resolution`. Rung 2 (live-claim-5 check, computed independently per
   chunk's `## Interpretation`): `discard-phase-and-reclaim` has claims 1–11 (claim 5 live),
   `rest` has claims 9–14 (claim 5 NOT live — eliminated), `second-action-resolution` has claims
   1–14 (claim 5 live) → 2 survivors. Rung 3 (authoring status of the `tests/punch.test.ts` row in
   each surviving chunk's manifest): `discard-phase-and-reclaim`'s row reads `edited (test step,
   Decision 55)` — NOT authoring; `second-action-resolution`'s row reads `written` — authoring → 1
   survivor. **Predicted resolution: `second-action-resolution`.** Confirmed: `claim 5` for
   `second-action-resolution` does NOT appear anywhere in the tool's `claim-untested` findings —
   it is correctly counted as covered. **MATCH.**

2. **`claim 19` in `tests/a11y.test.ts` — rung 2 alone is the deciding rung.** Rung-1 candidates:
   `discard-phase-and-reclaim` (claims 1–11), `game-end` (claims 1–13), `jab` (claims 1–25),
   `second-action-resolution` (claims 1–14). Independently checking each chunk's live claim set for
   the number 19: only `jab`'s live range (1–25) contains 19 — the other three all top out below
   19, so rung 2 alone narrows 4 candidates to exactly 1 before rung 3 ever needs to run.
   **Predicted resolution: `jab`.** Confirmed: `claim 19` is absent from `jab`'s
   `claim-untested` findings in the tool's JSON — correctly counted as covered. **MATCH.**

3. **`claim 6` in `tests/a11y.test.ts` — stays ambiguous after all three rungs run.** Rung-1
   candidates: same 4 as above. Rung 2 (live claim 6): all four chunks' live ranges start at 1, so
   all four retain claim 6 as live → 4 survivors, no elimination. Rung 3 (authoring): `jab`'s
   `tests/a11y.test.ts` row is `written`; `second-action-resolution`'s is `written`;
   `discard-phase-and-reclaim`'s is part of the joint `edited` row (not authoring — eliminated);
   `game-end`'s row is `extended (test step)` (not authoring — eliminated) → 2 survivors, both
   authoring, no further narrowing possible. **Predicted: `ambiguous-claim-ref`, candidates `jab,
   second-action-resolution`.** Confirmed verbatim in the tool's JSON:
   `{"kind": "ambiguous-claim-ref", "chunk": "jab, second-action-resolution", "subject": "claim 6
   in tests/a11y.test.ts", "detail": "candidates: jab, second-action-resolution"}`. **MATCH.**

**seven, one citation, hand-walked in full — and a real parser precision defect found in the
process:**

4. **`claim 13` in `tests/game.test.ts` — the tool's candidate list includes one chunk it should
   not, traced to its root cause.** Rung-1 candidates (9 chunks whose manifests list
   `tests/game.test.ts`): `best-seven-selection`, `discard`, `game-end-trigger`,
   `scoring-combo-sets-and-runs`, `scoring-declaration`, `scoring-one-color`,
   `scoring-set-5-plus-set-2`, `simultaneous-round-loop`, `table-and-draw`. Rung 2 (live claim 13):
   independently confirmed 5 survivors — `best-seven-selection`, `game-end-trigger`,
   `scoring-declaration`, `scoring-one-color`, `simultaneous-round-loop` (the other 4 chunks' live
   claim lists do not reach 13). Rung 3 (authoring): by hand, reading the raw manifest cell text,
   `best-seven-selection`, `scoring-declaration`, `scoring-one-color`, and `simultaneous-round-loop`
   all have `written`-prefixed status rows for `tests/game.test.ts` — genuinely authoring.
   `game-end-trigger`'s row reads **`unchanged — deliberately. ... any test written for it would go
   green while the defect stood ...`** — its row is explicitly NOT authoring (`unchanged`, an
   editing-verb-free non-authoring status), so it should have been dropped at rung 3, leaving 4
   survivors, not 5.

   **The tool's actual output includes `game-end-trigger` anyway** (confirmed both in the JSON and
   directly instrumented by importing `parseBuildManifest()` from `src/cli/commands/build-manifest.ts`
   and running it against this exact `CHUNK.md`, which returned
   `{"path":"tests/game.test.ts","status":"unchanged — deliberately. ...","authoring":true}`).

   **Root cause, confirmed by reading `build-manifest.ts`'s `AUTHORING_VERBS` regex
   (`/\b(new|written)\b/i`):** the regex matches the word "written" ANYWHERE in the full
   status-cell text, not anchored to the verb describing the row's own action. This particular
   status cell's prose happens to contain the word "written" deep inside an explanatory aside
   ("...any test **written** for it would go green while the defect stood...") describing a
   HYPOTHETICAL test that was never written, not describing this row's own status — which is,
   unambiguously, `unchanged`. `EDITING_VERBS` (`edited|extended|rewritten|tightened`) does not
   match this text either (none of those four words appear), so nothing blocks the accidental
   `AUTHORING_VERBS` match, and `isAuthoring` is computed `true` for a row that is genuinely,
   plainly not authoring.

   **This is a real, reproducible parser precision defect** — worth reporting prominently exactly
   as instructed, not papered over. **Its measured impact on this run's findings is confined to
   candidate-list membership, not to any verdict flip:** `claim 13` was already going to be
   reported `ambiguous-claim-ref` regardless (4 other, genuinely-authoring candidates survive
   independent of this bug), so the false positive only adds one extra name to an
   already-multi-candidate ambiguous list; it did not cause a false single-chunk resolution
   anywhere in this run. A grep across every manifest entry in both copies for `authoring: true`
   rows whose status text does not visibly START with `new`/`written` found exactly 3 such rows
   in `seven` (`game-end-trigger`'s `tests/game.test.ts` row — the one hand-walked here — plus two
   `src/rules/index.ts` rows in `scoring-combo-sets-and-runs` and `scoring-run-of-7`, both reading
   `unchanged (` + `` `export * from './scoring.js'` already re-exports the new pattern` `` `)` —
   same "new"-inside-prose shape) and zero in `one-two-punch`. The two `index.ts` occurrences are
   inert for `trace-check`'s purposes: the authoring map built from non-`.test.ts` manifest paths
   is never consulted by the claim-resolution ladder, which only looks up `.test.ts` paths. So the
   live, consequential blast radius of this defect across both real reference games, this run, is
   exactly the one `game-end-trigger` / `tests/game.test.ts` case documented above, and its effect
   was cosmetic (one extra name in an already-ambiguous candidate list), not a false resolution.
   **Recommend fixing `AUTHORING_VERBS`/`EDITING_VERBS` to match only the LEADING verb of the
   status cell (e.g. anchor to `^\s*(?:\*\*)?\b(word)\b`) rather than searching the whole cell —
   filed as a todo, not fixed in this proof-only plan** (this plan's `files_modified` is
   `172-PROOF.md`/`172-VALIDATION.md` only; a parser-precision fix belongs to a follow-up task).

   ---

   **RESOLVED, same day, by the phase orchestrator (commit `fix(172): anchor manifest authoring
   classification to the leading verb`).** The recommendation above was adopted rather than
   deferred: rung 3 is the mechanism CONTEXT.md decision 3's amendment exists to provide, and
   shipping it with a known false-authoring path contradicts the reason the amendment was made.

   Reproduced first, independently of this proof's hand-walk, via a direct probe against
   `parseBuildManifest` — 2 of 7 synthetic status shapes misclassified, both false-authoring:
   `updated — new coverage added for claim 3` and `touched — depends on the new helper written in
   game.ts`. A failing test was committed before the fix.

   The fix anchors classification to the status cell's **leading verb** (`leadingVerb()`), making
   authoring a strict allow-list: only a leading `new`/`written` asserts authoring, and every other
   verb — including `unchanged`, `updated`, and anything future authors invent — is non-authoring
   by default. The companion `EDITING_VERBS` blocklist was **removed** as redundant and
   structurally wrong-shaped: a leading verb cannot be in both disjoint lists, and a blocklist must
   be exhaustive to be correct while the live data already contained verbs (`unchanged`) it missed.
   That missing entry is precisely what let this defect through.

   **Re-run against fresh `cp -R` copies of BOTH games after the fix: every finding count
   identical** (one-two-punch `claim-untested: 157 / ambiguous-claim-ref: 18 / unresolved-claim-ref:
   22 / test-unlinked: 2 / unassociated-test: 4 / ruling-untested: 2 / manifest-file-missing: 1`;
   seven `claim-untested: 212 / ambiguous-claim-ref: 13 / test-unlinked: 1 / unassociated-test: 3 /
   ruling-untested: 3`). This independently confirms this section's own impact analysis — `claim 13`
   remains `ambiguous-claim-ref` because 4 genuinely-authoring candidates survive without the false
   one. Suite: 3504/3504. Both originals re-verified unchanged after the re-run.

### 6. Ruling supersession-exemption — hand-confirmed on real data

`172-RESEARCH.md` measured a raw (pre-supersession-exemption) figure of 3 untested rulings for
one-two-punch (Rulings 10, 14, 23). The tool reports only 2 (`ruling-untested: 2`, naming Rulings
10 and 23 — Ruling 14 absent). Independently reading `RULINGS.md`:

```
### Ruling 16
- Decision: A Guard renders as a compact CHIP, not as a 2:3 card. This supersedes Ruling 14's
  card-shaped presentation (...)
```

Ruling 16's entry explicitly reads "This supersedes Ruling 14's...", matching the narrow,
direction-aware supersede-verb pattern `172-CONTEXT.md` decision 5/`172-RESEARCH.md` Section 2
identify as reliably parseable. Ruling 14 is correctly exempted from `ruling-untested` because it
is superseded, not because it is untested — the tool's count of 2 (not the raw 3) is the CORRECT
answer, and this is confirmed by hand-reading the exact sentence the parser keys on. **MATCH (and
a live demonstration that the supersession-exemption logic, not just the raw parse, works
correctly on real data).**

### 7. `test-unlinked` / `unassociated-test` — negative-space check

Independently re-derived, from a Build-Manifest-scoped ownership scan (not a whole-file grep — see
finding 3's pitfall above for why that distinction matters), the exact ownership sets for every
test file in one-two-punch: `tests/ai.test.ts`, `tests/asset-reachability.test.ts`,
`tests/ring-movement-desync.test.ts`, and `tests/setup.test.ts` are owned by ZERO chunks' Build
Manifest tables (any mentions of these filenames elsewhere in a `CHUNK.md` are prose in narrative
sections — Findings Ledger, Redteam Rounds — never a manifest table row). This exactly matches the
tool's `unassociated-test` findings (4 for one-two-punch: those same 4 files; 3 for seven:
`tests/card-mark.test.ts`, `tests/match.a11y.test.ts`, `tests/match.test.ts`). **MATCH.**

`test-unlinked` fired for `tests/discard.test.ts` and `tests/simulation.test.ts` (one-two-punch)
and `tests/random-sim.test.ts` (seven) — all three are chunk-associated, import `src/rules/`, and
cite neither a claim nor a ruling, exactly decision 6b's trigger. It did NOT fire for
`tests/theme.test.ts`, `tests/a11y.test.ts` or any of the other zero-or-few-claim files
RESEARCH.md's Section 2 flagged as legitimately varied (a11y/soak/structural tests) — confirming
the decision-6b trigger's negative space holds on live data, not just the positive cases.

### 8. Read-only invariant, re-confirmed after every run

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)

$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
$ git -C ~/BoardSmithGames/one-two-punch status --porcelain
 D .boardsmith/runtime-bundle.mjs
 D .boardsmith/runtime-entry.ts
```

Both HEADs unchanged, `seven`'s porcelain still empty, `one-two-punch`'s two pre-existing
deletions unchanged. The whole-tree byte manifest captured before the run (3919 files for `seven`,
4134 for `one-two-punch`) was re-captured after and `diff`'d against the before-manifest:

```
$ diff seven-manifest-before.txt seven-manifest-after.txt
(no output — byte-identical)
$ diff otp-manifest-before.txt otp-manifest-after.txt
(no output — byte-identical)
```

**Both originals are provably byte-identical, not merely asserted clean.** Every writing/reading
command in this plan ran only against the `cp -R` copies in the scratchpad; neither original was
ever passed as `--project`.

---

## `npm test`

```
 Test Files  233 passed (233)
      Tests  3503 passed (3503)
```

Matches the 3503/3503 baseline recorded in `172-04-SUMMARY.md`. No source was touched by this
plan (proof-only; `files_modified` is `172-PROOF.md` and `172-VALIDATION.md`), so this run
confirms nothing regressed while producing the proof, not that anything new was tested.

---

## What this proves

- **CHECK-03 (traceability sweep)** — both real games produce real, substantial, non-contrived
  findings on the first run: 157/165 untested claims on one-two-punch, 212/212 on seven (near-total,
  for the structural reason CONTEXT.md's own amendment documents — seven's claim-bearing test
  files carry only 13 claim citations total against 212 live claims, because seven's tests cite
  Rulings heavily and claims sparsely, exactly RESEARCH.md's Section 2 finding). The amended
  three-rung resolution ladder (decision 3) demonstrably narrows real multi-owner citations far
  below the pre-amendment estimate — 18 `ambiguous-claim-ref` on one-two-punch, not the ~67 the
  superseded pre-amendment rule would have produced, and this proof hand-confirms the mechanism
  three separate ways on one-two-punch (rung-2-deciding, rung-3-deciding, and
  stays-ambiguous-after-all-three-rungs cases) and once on seven (where it also caught a real,
  narrow parser precision defect — cross-check item 5 above — with confirmed non-consequential
  impact on this run's verdicts).
- **CHECK-05 (code drift)** — real drift on the large majority of chunks in both games (10/12
  one-two-punch, 16/17 seven), independently reproduced for 6 chunks (3 per game, including the
  highest-drift chunk in each) by a from-scratch `git diff --name-only <hash> HEAD` intersected
  with an independently-parsed manifest file list, matching the tool's `changedFiles`/
  `missingFiles`/`manifestFileCount` exactly in all 6 cases. The decision-12 "manifest file absent
  from disk is drift" exhibit is confirmed present in live data (`jab`'s `GuardCardView.vue`, plus
  two more independently-discovered cases — `rest`'s `rest.js`, `plan-and-reveal`'s
  `tests/a11y.example.test.ts`), and this run additionally proves decision 12's design is
  MORE necessary than the plan anticipated: `GuardCardView.vue` was deleted BEFORE its chunk's
  verified hash was recorded, not after, so a pure git-diff-based check would have missed it
  entirely — only the unconditional disk-existence check catches it.
- **Both games' `drift-check --json` correctly reports `drift-unknown` for the one chunk whose
  manifest is not table-shaped** (`ai-opponent`, one-two-punch) rather than collapsing it into
  either "clean" or "drifted" — decision 10's third state, live.
- **Success criterion 3** ("Both checks are demonstrated end-to-end against at least one reference
  game, surfacing real findings, not a dry no-op run") — satisfied against BOTH reference games,
  by both commands, in both `--json` and human-readable form, with every reported count either
  matched exactly by an independent computation or (for `claimCitations`/`rulingCitations`, the two
  counts whose exact citation-form parsing was not independently re-implemented) shown consistent
  in order of magnitude with a crude independent grep and with RESEARCH.md's own prior
  measurement (see "What is still unproven" below for the honest boundary of that claim).

---

## What is still unproven

- **`drift-unknown`-from-unresolvable-hash and not-an-ancestor paths remain proven only by unit
  fixture, not by live data.** All 29 real chunk hashes across both games were confirmed, this
  session and in `172-RESEARCH.md`'s prior session, to be real git objects and ancestors of their
  repo's current HEAD. Neither game currently has a chunk with a garbled, missing, or
  non-ancestor hash, so this run cannot and does not exercise those two `drift-unknown` triggers on
  real data — only the third trigger (`ai-opponent`'s non-tabular manifest) fired live.
- **`unresolved-claim-ref`'s rung-1 ("no owner" — the `owners.length === 0` branch) never fired on
  seven.** Seven's `unresolved-claim-ref: 0` in this run — every citable claim number in seven's
  sparse citation set happened to land inside a live-claim range somewhere among its citing file's
  owners, so seven's live data exercises only the rung-2 "no live claim" unresolved reason, not the
  rung-1 "no owner at all" reason (which one-two-punch's 22 `unresolved-claim-ref` findings do
  exercise, per this proof's own examination of `discard-phase-and-reclaim`/`rest`/
  `second-action-resolution`'s upper claim bounds against `tests/punch.test.ts`'s higher citation
  numbers).
- **`claimCitations`/`rulingCitations` totals (55/42 for one-two-punch, 13/65 for seven) were NOT
  independently re-implemented citation-form-by-citation-form** the way claim/ruling TOTALS were.
  The citation forms are numerous and irregular (comma-joined `claims 3, 4, 5, 29`, slash-joined
  `claim N/M`, mixed `claim 28 / Ruling 9/15`, the self-referential `CHUNK.md claim N` qualifier) —
  a full independent re-parse matching the tool's exact per-citation counting rules would itself be
  a second implementation of the scanner, not a cross-check of it. What WAS done: a crude
  whole-file `grep -Eoi '\bclaims? [0-9]+'` count (72/48 raw mentions) was compared against
  `172-RESEARCH.md`'s own prior independent measurement (also 72/48) and found consistent — this
  establishes the raw mention volume is stable and real, not that every individual citation the
  tool extracts and resolves has been independently re-derived. The claim/ruling-count and
  drift-count cross-checks above (which WERE re-implemented from scratch and matched exactly) are
  the load-bearing proofs in this document; the citation-count consistency check is corroborating,
  not independently exhaustive.
- **The `AUTHORING_VERBS`/`EDITING_VERBS` whole-cell-text-match imprecision found in cross-check
  item 5 (§ "Resolution-ladder rungs") is a real, reproducible defect, confirmed narrow-impact on
  this run's live data but NOT fixed by this plan** (proof-only; `files_modified` does not include
  `src/`). It is recorded here rather than filed as a separate todo, per this plan's scope — a
  follow-up plan should anchor both regexes to the leading verb of the status cell rather than
  searching the whole cell text.
- **Whether the human-readable report's grouping and truncation actually reads well to a human at
  real volume is a judgement call, not a measurement**, exactly as `172-CONTEXT.md`'s own
  "Specific Ideas" section anticipated ("Report volume is the real risk... Human-readable output
  must summarise and group so the signal is not buried"). This proof records that the count-first
  summary line and the explicit `+N more — run --json for the full list` truncation ARE present
  and DID fire correctly at real volume (157, 212, 18, 22-count groups all truncated to 10 lines
  with an accurate remainder count) — but whether that presentation is genuinely legible to a human
  skimming it for the first time is not something a proof document can measure objectively.
- **This plan did not exercise `trace-check`/`drift-check` from inside `/bs-verify-game` or any
  other skill-text invocation** — Phase 173 owns that wiring. Every invocation in this proof was a
  direct `node bin/boardsmith.js <cmd> --project <copy> --json` call, proving the CLI surface and
  its underlying logic work correctly on real data; it proves nothing about whether a future skill
  session actually calls these commands, which is exactly the kind of skip risk `171-PROOF.md`
  documented for `chunk-check`/`close`.

---

## Read-only invariant — confirmed unchanged, before and after

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD          (BEFORE and AFTER, identical)
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain       (BEFORE and AFTER, identical)
(empty)

$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD  (BEFORE and AFTER, identical)
7e69471bd8980a854f3e351f2f486e1fb6f712b9
$ git -C ~/BoardSmithGames/one-two-punch status --porcelain  (BEFORE and AFTER, identical)
 D .boardsmith/runtime-bundle.mjs
 D .boardsmith/runtime-entry.ts
```

Whole-tree `sort`ed `find | shasum -a 256` manifests (3919 files for `seven`, 4134 for
`one-two-punch`) diffed BEFORE vs AFTER: **zero output in both cases — byte-identical.** Every
command in this plan ran only against `cp -R` copies in the session scratchpad
(`<scratch>/172-05-proof/{seven,one-two-punch}`); neither original was written to, and neither
original's `--project` flag was ever used for anything but the preflight `rev-parse`/`status`
assertions and the post-run re-verification.

---

## Cleanup

Both scratch copies and their captured JSON/human-readable output files remain at
`<session-scratchpad>/172-05-proof/` for the duration of this session (per the session scratchpad
convention); neither reference game's working directory was ever written to.
