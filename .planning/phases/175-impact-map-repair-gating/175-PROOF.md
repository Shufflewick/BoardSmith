# Phase 175 Plan 07 — Proof

Live VERIFY-04 gate proof against the archived real `contradictory` verdict
(`175-FIXTURES/174-07-contradictory/`), on real `cp -R` copies of `~/BoardSmithGames/one-two-punch`,
following `173-PROOF.md`/`174-PROOF.md`'s structure and voice. Measured counts throughout — every
claim below names the command that produced it, never a smoothed-over summary phrase.

`SCRATCH="${TMPDIR:-/tmp}/175-07"` (this session's scratchpad, session-isolated) for the whole run.

---

## 1. Real material provenance

### Fixture MANIFEST re-verification

```
$ cd .planning/phases/175-impact-map-repair-gating/175-FIXTURES/174-07-contradictory
$ shasum -a 256 -c MANIFEST.md
... (24 rows, one per line in the manifest's fenced sha256 block)
$ shasum -a 256 -c MANIFEST.md 2>/dev/null | grep -c ": OK"
24
$ shasum -a 256 -c MANIFEST.md 2>/dev/null | grep -vc ": OK"
0
```

**24/24 verified** — every file the MANIFEST names, re-hashed fresh against the recorded value, with
zero mismatches. (`MANIFEST.md`'s own doc text calls this "23/23" in prose, but its fenced sha256
block actually lists 24 rows — the extra row is `staged/one-two-punch/slices/superseded/` having two
entries where the earlier prose count only anticipated the six live-pass units; recorded as the
actual measured row count, not silently reconciled to the doc's stated number.)

### The mutated PDF itself is NOT archived

Per `MANIFEST.md`'s own "Traceability" section: `one-two-punch`'s mutated `rules.pdf` sha256 is
recorded as

```
8a01d38c0073b9ba90d07e4dc20817d1ad6c590d3c0c747ec31655e88c35bb9c
```

The 4.5MB PDF itself is not archived in this repo. This proof does **not** re-run the mutation
(rasterize/composite/reassemble) — `174-PROOF.md` §5 documents the regeneration recipe if the
artifact is ever needed again. Everything below consumes the already-recorded `ClassificationRecord`
and its retained `lineFindings[]`/subagent-return evidence, never a fresh mutation.

### The real recorded `contradictory` `ClassificationRecord`, quoted verbatim

From `175-FIXTURES/174-07-contradictory/staged/one-two-punch/RUN.md` (line 28, the ledger's own
committed text):

```json
{"kind":"classification","pairId":"pages-1-2","units":["01-overview-and-contents","01-starting-a-new-game","01-round-structure","02-action-cards","02-punch-examples","02-end-of-game","02-tips"],"liveSlices":["rulebook/01-setup-and-round-structure.md","rulebook/02-action-cards-and-resolution.md"],"stagedSlices":["01-overview-and-contents.md","01-starting-a-new-game.md","01-round-structure.md","02-action-cards.md","02-punch-examples.md","02-end-of-game.md","02-tips.md"],"provenance":"source-changed","ruleDelta":"contradictory","stale":true,"evidence":"Rule-bearing lines compared line by line after excluding presentation notes on both schemas. The single non-cosmetic delta is the FIGHT-phase resolution-order rule: pass 1 quotes 'lower timing ... resolve their action first', pass 2 quotes 'higher timing ... must resolve their action first'. As rule statements these cannot both be true of the same printed sentence and invert resolution order in every non-tied exchange. Remaining deltas (credit-name spelling, 'next to' vs 'in front of', punctuation, 'one player' vs 'your player') are cosmetic per the consequence test. | Pass 1 quote: \"The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.\" | Pass 2 quote: \"The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.\"","recordedAt":"2026-07-30T01:41:59.573Z","quotedPass1":"The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.","quotedPass2":"The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time."}
```

`"ruleDelta":"contradictory"` confirmed. Both readings, verbatim:

- **Pass 1 ("lower timing"):** "The player with the **lower** timing on their card must resolve
  their action first. If the timing is the same on both cards, they are resolved at the same time."
- **Pass 2 ("higher timing"):** "The player with the **higher** timing on their card must resolve
  their action first. If the timing is the same on both cards, they are resolved at the same time."

### `lineFindings[]` composition from the raw subagent return

The one raw subagent return this fixture archives with a real `lineFindings[]` array is
`evidence/subagent-otp-sc3-classify-return.txt` (per-file sha256 in the MANIFEST, re-verified above).
Composition (measured directly from the archived return, not inferred from the ledger's own
`evidence` prose):

```
$ grep -c '"label":"cosmetic"' evidence/subagent-otp-sc3-classify-return.txt
4
$ grep -c '"label":"contradictory"' evidence/subagent-otp-sc3-classify-return.txt
1
$ grep -c '"label":"sharper"' evidence/subagent-otp-sc3-classify-return.txt
0
```

**5 line-level findings total: 4 `cosmetic` + 1 `contradictory`, 0 `sharper`.** The MAX-severity
rollup this pair's single `contradictory` line-level finding onto the whole pair-group verdict is
exactly decision 18's documented rollup rule.

### Research's measured limitation, flagged forward (not implied covered)

Only the max-severity `quotedPass1`/`quotedPass2` pair is persisted onto the `ClassificationRecord`
(one pair of quotes for the whole `pages-1-2` group, not one pair per `lineFindings[]` entry). This
group happens to have exactly one non-cosmetic line, so nothing is lost here — but a real
multi-`contradictory`-line pair would have its non-max lines' verbatim readings absent from the
record entirely. **This is a real, un-closed limitation carried forward to Phase 176** (repair
scoping consumes the retained line-level evidence per decision 16, but this proof does not
demonstrate a multi-delta pair because neither real reference game produced one) — flagged here, not
silently treated as covered by this proof.

**GATE: PASSED (§1 — 24/24 fixture hashes verified, real `ClassificationRecord` quoted verbatim,
`lineFindings[]` composition measured, the one known evidence-retention limitation flagged forward
rather than implied closed).**

---

## 2. VERIFY-04: the gate stops a real pass

### Scratch copy + seed

```
$ cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/otp-175"
```

Run-id used: `2026-07-30T01-31-49Z` (the fixture's own recorded run-id — reusing it, not minting a
new one, so the seeded `RUN.md` is byte-identical to the archived fixture).

```
$ mkdir -p "$SCRATCH/otp-175/rulebook/.verify/2026-07-30T01-31-49Z/slices"
$ cp 175-FIXTURES/174-07-contradictory/staged/one-two-punch/RUN.md \
     "$SCRATCH/otp-175/rulebook/.verify/2026-07-30T01-31-49Z/RUN.md"
$ cp -R 175-FIXTURES/174-07-contradictory/staged/one-two-punch/slices/. \
        "$SCRATCH/otp-175/rulebook/.verify/2026-07-30T01-31-49Z/slices/"
$ shasum -a 256 "$SCRATCH/otp-175/rulebook/.verify/2026-07-30T01-31-49Z/RUN.md"
0c103aea4cca7a4a26720409018995736e1a22d8e31c0f900b72f3cb38db1928
```

Matches `MANIFEST.md`'s recorded hash for `staged/one-two-punch/RUN.md` exactly — the seeded ledger
is byte-identical to the committed fixture.

### A real live-discovered bug, fixed under deviation Rule 1, before proceeding

Running `boardsmith verify-impact-gate --project . --run-id <id> --json` for the first time produced
**two concatenated top-level JSON objects on stdout**, not one — breaking a real caller's
`JSON.parse(stdout)`. Root cause: all four `verify-impact-*` command functions in
`src/cli/commands/verify-impact.ts` compose `verifyClassifyStatusCommand({ ..., json: true })`
internally to get `chunkVerdicts`/the resolved `runId` — but `verifyClassifyStatusCommand`'s own
`json: true` path unconditionally `console.log(JSON.stringify(...))`s **its own** result as a side
effect, before the outer command prints its own result. This fired on *every* invocation, including
the human-readable (non-`--json`) path, where it printed a stray, unrelated JSON blob ahead of the
intended human report.

This is exactly the class of live-discovered defect `173-PROOF.md`/`174-PROOF.md` exist to catch
(the `173-06` `source-resolution.md` bug, the identical shape). **Fixed under deviation Rule 1**
(auto-fix bugs — directly encountered while performing this task's own action, on the exact command
surface this plan proves): all four internal composition call sites in `verify-impact.ts` changed
from `json: true` to `json: false`, matching the already-established, already-decided convention
this same file uses for `driftCheckCommand`/`chunkProvenanceStatusCommand` (175-04's own documented
decision: "accepting their side-effect human-readable print... this command's own report is what a
human actually reads"). After the fix: `npm test` 3825/3825 green (unchanged count — no test
depended on the old behavior), `npx tsc --noEmit` clean (only the pre-existing,
unrelated `docs/seed-to-state.test.ts` rootDir warning). Commit: see this plan's task commit list.

The remaining human-readable print side effect (the composed `verifyClassifyStatusCommand`'s own
3-line summary, printed ahead of the outer command's JSON) is now the SAME accepted, documented
pattern already used elsewhere in this file — not a new defect, not suppressed.

### 1. `verify-impact-gate --json` — the machine report

```
$ cd "$SCRATCH/otp-175"
$ boardsmith verify-impact-gate --project . --run-id 2026-07-30T01-31-49Z --json
```

Full `contradictions[0]` object (captured verbatim):

```json
{
  "pairId": "pages-1-2",
  "liveSlices": [
    "rulebook/01-setup-and-round-structure.md",
    "rulebook/02-action-cards-and-resolution.md"
  ],
  "stagedSlices": [
    "01-overview-and-contents.md", "01-starting-a-new-game.md", "01-round-structure.md",
    "02-action-cards.md", "02-punch-examples.md", "02-end-of-game.md", "02-tips.md"
  ],
  "provenance": "source-changed",
  "quotedPass1": "The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.",
  "quotedPass2": "The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.",
  "evidence": "Rule-bearing lines compared line by line after excluding presentation notes on both schemas. ... (full evidence string, matching §1's quoted ClassificationRecord verbatim)",
  "affectedSlugs": ["block", "final-acceptance", "jab", "movement-advance-retreat", "rest", "second-action-resolution"],
  "adjudication": "pending"
}
```

`summary.contradictory: 1` / `summary.pending: 1` (exact measured counts — recorded, not rounded).

### 2. `verify-impact-gate` (human report) — verbatim both-readings block

```
✓ Verify-classify status — run 2026-07-30T01-31-49Z
  classified: 1/1 paired group(s) — 0 cosmetic, 0 sharper, 1 contradictory, 0 unclassified (cosmeticPct: 0%)
  stale chunks: block, final-acceptance, jab, movement-advance-retreat, rest, second-action-resolution
⚠ 1 of 1 contradictory finding(s) pending adjudication — run 2026-07-30T01-31-49Z

Pair pages-1-2 (provenance: source-changed)

Reading as built (pass 1):
  "The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time."

Reading in the fresh transcription (pass 2):
  "The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time."

Affected chunks (6):
  - block
  - final-acceptance
  - jab
  - movement-advance-retreat
  - rest
  - second-action-resolution
```

Both readings under distinct labels, every affected chunk slug listed uncapped (6 of 6, no "and N
more").

### 3. `verify-impact-apply --json` — measurably blocked, zero bytes written

Whole-copy sha256 manifest immediately BEFORE the apply call:

```
$ find "$SCRATCH/otp-175" -type f ! -path "*/node_modules/*" | sort | xargs shasum -a 256 \
    > "$SCRATCH/otp-175-before-apply.manifest"
$ wc -l "$SCRATCH/otp-175-before-apply.manifest"
    1436
```

```
$ boardsmith verify-impact-apply --project . --run-id 2026-07-30T01-31-49Z --json
{
  "runId": "2026-07-30T01-31-49Z",
  "blocked": true,
  "pendingPairs": ["pages-1-2"],
  "marked": [],
  "skippedTailEntries": [],
  "warnings": ["[unresolved-citation] Chunk \"final-acceptance\" cites live slice \"rulebook/01-setup-and-round-structure.md\" in pair \"pages-1-2\", but no claim-level citation anchor (quoted fragment or page) could be resolved — broadened to decision 18's slice-level attribution rather than reported clean."]
}
```

Whole-copy sha256 manifest immediately AFTER:

```
$ find "$SCRATCH/otp-175" -type f ! -path "*/node_modules/*" | sort | xargs shasum -a 256 \
    > "$SCRATCH/otp-175-after-apply.manifest"
$ diff "$SCRATCH/otp-175-before-apply.manifest" "$SCRATCH/otp-175-after-apply.manifest"
(empty, exit 0)
```

**0 files changed** — measured, not claimed. `blocked: true`, `pendingPairs: ["pages-1-2"]`, `marked:
[]`. The gate stops the pass BEFORE any staleness write, proven by whole-tree byte comparison, not
by reading `verifyImpactApplyCommand`'s source.

### 4. Marker-write greps in the (still-unwritten) copy

```
$ grep -rln "boardsmith:rules-staleness:begin" "$SCRATCH/otp-175/chunks" | wc -l
0
$ grep -rc "rules-stale — rulebook moved" "$SCRATCH/otp-175/chunks" | awk -F: '{s+=$2} END{print s+0}'
0
$ ls "$SCRATCH/otp-175/chunks" | wc -l
12
```

**Measured: 0 of 12 chunks carry ANY `## Rules Staleness` fence at all** (not just 0 carrying the
stale marker value) — `one-two-punch`'s real chunks were all built before Phase 175's template
change (175-01) added the section to `CHUNK.template.md`, so none of them was ever scaffolded with
the section pre-populated. This is the honest measured starting state for this real game, not the
"scaffolded-empty" baseline the plan's action text anticipated for a project built after the
template change — recorded as the actual number, not reconciled to the anticipated one.
`writeRulesStalenessMarker` inserts the section fresh when absent (confirmed in §3a below), so this
absence does not block anything; it is simply the real, pre-Phase-175 starting state.

### Both `~/BoardSmithGames` originals — pre-run sha256 manifests (for §"Originals re-verification"
### below and plan 175-08's final check)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```

Whole-tree sha256 manifests captured to `$SCRATCH/seven.before.manifest` (5342 files) and
`$SCRATCH/otp.before.manifest` (5400 files) — identical file counts to every prior plan's own
preflight capture (`173-PROOF.md`, `174-PROOF.md`).

**GATE: PASSED (§2 — a real `contradictory` verdict measurably stops a real
`verify-impact-apply` pass before any write; a real live-discovered JSON-output bug found and fixed
under Rule 1 along the way).**

---

## 3. VERIFY-04: both terminal answers on real files

### §3a — Deferral (`UNADJUDICATED`)

A second, fresh `cp -R` copy, seeded identically to §2:

```
$ cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/otp-175-3a"
(same RUN.md/slices seed as §2, same run-id)
```

`RULINGS.md` sha256 before:

```
$ shasum -a 256 "$SCRATCH/otp-175-3a/RULINGS.md"
f7779ad9501a620138e4f55765869069b01f916bbadd1b23db54f47dd634fb4f
```

```
$ boardsmith verify-impact-adjudicate --project . --run-id 2026-07-30T01-31-49Z \
    --pair-id pages-1-2 --outcome UNADJUDICATED --json
{
  "pairId": "pages-1-2",
  "outcome": "UNADJUDICATED"
}
```

`RULINGS.md` sha256 after:

```
$ shasum -a 256 "$SCRATCH/otp-175-3a/RULINGS.md"
f7779ad9501a620138e4f55765869069b01f916bbadd1b23db54f47dd634fb4f
```

**Identical (`diff` of the two hash files: empty, exit 0)** — a deferral writes no `RULINGS.md`
entry, measured by whole-file hash equality, not by inspection.

Appended `AdjudicationRecord` ledger line, verbatim (from the copy's own `RUN.md`):

```json
{"kind":"adjudication","pairId":"pages-1-2","outcome":"UNADJUDICATED","quotedPass1":"The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.","quotedPass2":"The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.","recordedAt":"2026-07-30T15:01:18.134Z"}
```

`verify-impact-apply` now proceeds (not blocked):

```
$ boardsmith verify-impact-apply --project . --run-id 2026-07-30T01-31-49Z --json
{
  "runId": "2026-07-30T01-31-49Z",
  "blocked": false,
  "pendingPairs": [],
  "marked": [
    {"slug": "block", "chunkWritten": true, "sketchWritten": true},
    {"slug": "final-acceptance", "chunkWritten": true, "sketchWritten": true},
    {"slug": "jab", "chunkWritten": true, "sketchWritten": true},
    {"slug": "movement-advance-retreat", "chunkWritten": true, "sketchWritten": true},
    {"slug": "rest", "chunkWritten": true, "sketchWritten": true},
    {"slug": "second-action-resolution", "chunkWritten": true, "sketchWritten": true}
  ],
  "skippedTailEntries": [],
  "warnings": ["[unresolved-citation] ... (same warning as §2)"]
}
```

**Exact count of chunks marked: 6** — matching `formatBothReadings`'s own 6 `affectedSlugs` from
§2 exactly.

Verbatim `## Rules Staleness` fenced body from ONE affected CHUNK.md (`chunks/block/CHUNK.md`):

```
## Rules Staleness

<!-- MACHINE-OWNED. Do not write between the fences below, and do not move or delete them.

     `boardsmith verify-impact-apply` computes this block: which run flagged this chunk stale,
     the classified rule delta, the specific rulebook slices attributed to this chunk (Phase
     174's quoted-fragment/cited-page attribution ladder), the prior/changed readings verbatim,
     the adjudication outcome, and the Marker itself. Anything you write here is overwritten on
     the next run.

     This marker is ORTHOGONAL to the Status: line above (175-CONTEXT.md decision 1) — a
     `verified` chunk stays `verified`; a human really did playtest it. That its rules basis
     has since moved is a second, independent axis, tracked here and nowhere else. It is fenced
     for the same reason `## Verified Against` is (see that section's own comment): a
     hand-authored machine-owned block is indistinguishable from a correct one by reading it, so
     it is made structurally impossible instead. -->

<!-- boardsmith:rules-staleness:begin -->
Run: 2026-07-30T01-31-49Z
Rule delta: contradictory

Attributed slices:

| slice |
|---|
| rulebook/01-setup-and-round-structure.md |

Prior reading: The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.

Changed reading: The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.

Adjudication: UNADJUDICATED

Marker: rules-stale — rulebook moved since this chunk was verified
<!-- boardsmith:rules-staleness:end -->
```

`Adjudication: UNADJUDICATED` reads as an honest unresolved state (see §3d for the designer's own
read of this).

Re-run of `verify-impact-gate --json` — the pair is STILL pending:

```
$ boardsmith verify-impact-gate --project . --run-id 2026-07-30T01-31-49Z --json
"pending": ["pages-1-2"]
"summary": {"contradictory": 1, "pending": 1, "resolved": 0, "unadjudicated": 1}
"contradictions[0].adjudication": "UNADJUDICATED"
```

A deferral is not a resolution — decision 8, confirmed live.

**GATE: PASSED (§3a).**

### §3b — Resolution (`### Ruling N`)

A third, fresh `cp -R` copy, seeded identically to §2/§3a:

```
$ cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/otp-175-3b"
```

Real pre-append corpus count:

```
$ grep -c '^### Ruling ' "$SCRATCH/otp-175-3b/RULINGS.md"
26
$ wc -c "$SCRATCH/otp-175-3b/RULINGS.md"
45220
```

```
$ boardsmith verify-impact-adjudicate --project . --run-id 2026-07-30T01-31-49Z \
    --pair-id pages-1-2 --outcome resolved \
    --decision "The higher-timing card resolves first — pass 2's reading governs. The as-built pass-1 slice text was itself a transcription slip against the printed rulebook; the fresh re-transcription (pass 2) matches the physical rulebook page and is the correct rule." \
    --citation "rulebook/source/rules.pdf, p.1, Fight-phase timing paragraph" \
    --rationale "A genuine printed-rule contradiction between the as-built game and the archived source must be resolved toward the archived source, since the source is the designer's own authored text and the as-built behavior was never re-verified against it until this pass." \
    --json
{
  "pairId": "pages-1-2",
  "outcome": "resolved",
  "rulingNumber": 27
}
```

**Assigned ruling number: 27 = 26 (pre-append count) + 1**, exactly as predicted before running the
command.

Appended entry, verbatim (`sed -n '/### Ruling 27/,$p' RULINGS.md`):

```
### Ruling 27
- Decision: The higher-timing card resolves first — pass 2's reading governs. The as-built pass-1 slice text was itself a transcription slip against the printed rulebook; the fresh re-transcription (pass 2) matches the physical rulebook page and is the correct rule.
- Citation interpreted or overridden: rulebook/source/rules.pdf, p.1, Fight-phase timing paragraph — Reading as built (pass 1): "The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time." | Reading in the fresh transcription (pass 2): "The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time."
- Rationale: A genuine printed-rule contradiction between the as-built game and the archived source must be resolved toward the archived source, since the source is the designer's own authored text and the as-built behavior was never re-verified against it until this pass.
```

Append-only proof — byte lengths (`wc -c`, real bytes, not Python `str` character counts, which
undercount by exactly the number of multi-byte UTF-8 characters — e.g. em-dashes — in the file):

```
old (~/BoardSmithGames/one-two-punch/RULINGS.md): 45220 bytes
new (this copy's RULINGS.md, post-append):         46274 bytes
new.startswith(old), computed byte-for-byte:        True
```

```
$ grep -ci 'supersede' <(sed -n '/### Ruling 27/,$p' RULINGS.md)
0
```

`boardsmith trace-check --project . --json` on the appended corpus:

```json
{
  "totals": {"chunks": 12, "claims": 165, "rulings": 27, "testFiles": 14, "claimCitations": 55, "rulingCitations": 42},
  "counts": {"claim-untested": 157, "ruling-untested": 3, "test-unlinked": 2, "unassociated-test": 4,
             "ambiguous-claim-ref": 18, "unresolved-claim-ref": 22, "manifest-file-missing": 1,
             "chunk-code-drifted": 0, "drift-unknown": 0}
}
```

**`totals.rulings: 27`** — `trace-check`'s existing `RULINGS.md` reader (`parseRulings`,
`build-manifest.ts`) parses the appended corpus correctly, total ruling count matching exactly.

**Expected, reported (not hidden):**

```json
{"kind": "ruling-untested", "chunk": "", "subject": "Ruling 27", "detail": "no test file cites Ruling 27"}
```

An untested-ruling finding for the brand-new Ruling 27 — exactly the expected outcome (a fresh
ruling has no test yet), reported plainly rather than suppressed. Two other pre-existing
`ruling-untested` findings (Ruling 10, Ruling 23) are unrelated to this plan's change — they existed
in the real corpus already, unaffected by this append.

**GATE: PASSED (§3b).**

### §3c — No representable bypass

Verbatim `--help` output, all four commands, run through the real CLI entry point:

```
$ boardsmith verify-impact-gate --help
Usage: boardsmith verify-impact-gate [options]

Report every contradictory verdict awaiting human adjudication, with both
readings quoted side by side (read-only, machine-readable)

Options:
  --project <dir>  Project directory (defaults to cwd)
  --run-id <id>    Report on a specific run instead of the most recent
  --json           Emit JSON instead of human-readable output
  -h, --help       display help for command

$ boardsmith verify-impact-adjudicate --help
Usage: boardsmith verify-impact-adjudicate [options]

Record the human's resolution of one contradictory finding: append a RULINGS.md
entry, or record it UNADJUDICATED

Options:
  --project <dir>                     Project directory (defaults to cwd)
  --run-id <id>                       Report on a specific run instead of the
                                      most recent
  --pair-id <id>                      The contradictory pair id to adjudicate
                                      (see the pending-adjudication report)
  --outcome <resolved|UNADJUDICATED>  The recorded adjudication outcome
  --decision <text>                   The human's decision, required for
                                      --outcome resolved
  --citation <text>                   Citation interpreted or overridden,
                                      required for --outcome resolved
  --rationale <text>                  Rationale, required for --outcome
                                      resolved
  --json                              Emit JSON instead of human-readable
                                      output
  -h, --help                          display help for command

$ boardsmith verify-impact-apply --help
Usage: boardsmith verify-impact-apply [options]

Write the rules-staleness marker into every affected chunk's CHUNK.md then
SKETCH.md, and record the run's impact map (refuses while any contradiction is
un-adjudicated)

Options:
  --project <dir>  Project directory (defaults to cwd)
  --run-id <id>    Report on a specific run instead of the most recent
  --json           Emit JSON instead of human-readable output
  -h, --help       display help for command

$ boardsmith verify-impact-status --help
Usage: boardsmith verify-impact-status [options]

Report the run's impact map: which chunks are rules-stale, each one's
line-level attributions, and whether repair re-opens its playtest gate
(read-only, machine-readable)

Options:
  --project <dir>  Project directory (defaults to cwd)
  --run-id <id>    Report on a specific run instead of the most recent
  --json           Emit JSON instead of human-readable output
  -h, --help       display help for command
```

**Measured absence of `--force`/`--yes`/`--skip`/`--skip-gate`/`--clear`/`--bypass` across all four
`--help` outputs: 0 occurrences.** Every option listed above is `--project`/`--run-id`/`--json` (all
four), plus `--pair-id`/`--outcome`/`--decision`/`--citation`/`--rationale` (adjudicate only) — no
sixth, unlisted option exists.

`process.env` grep, non-comment lines (comments describing the module's own no-bypass discipline are
excluded, matching the module's own established test convention):

```
$ grep -v '^\s*\*\|^\s*//' src/cli/commands/verify-impact.ts | grep -ciE "process\.env"
0
```

(A bare `grep -rciE "process\.env" src/cli/commands/verify-impact.ts` without stripping comments
returns **3** — all three are inside doc comments *describing* the absence of a `process.env` read,
not an actual read. Recorded honestly: the plan's literal acceptance text asked for a raw grep of
0, and the raw, uncommented grep is 3; the meaningful measurement — actual code, comments stripped —
is 0, matching the module's own `175-03-SUMMARY.md`-documented convention ("grep-asserted on
non-comment lines"). Both numbers are reported rather than picking the more convenient one silently.)

**This is a structural absence** — following `build/ask.md`'s own model (no representable option
skips the gate) — not a documented-but-present flag a caller could reach for.

**GATE: PASSED (§3c).**

### §3d — Human adjudicability check

**STATUS: HUMAN-ANSWERED, APPROVED — recorded 2026-07-30.** This plan's Task 3 is a
`checkpoint:human-verify` gate (`gate="blocking"`, `autonomous: no`). The rendered gate output above
(§2 step 2's verbatim `verify-impact-gate` human report, §3a's verbatim `Adjudication: UNADJUDICATED`
CHUNK.md fenced body, and §3b's verbatim appended `### Ruling 27`) was presented to the designer for
judgment at the checkpoint. **This verdict is the human's own words, relayed verbatim through the
orchestrating session — it is not a self-assessment by the executing agent, and it is not restated
as though the tool concluded it.**

**Designer's verdict: APPROVED — adjudicable as-is.** No caveats, no missing fields named.

Verbatim answers to the six questions this plan's `<how-to-verify>` posed:

1. "Yes — the changed rule, its prior reading, its fresh reading, and the affected chunks are all
   determinable from the gate output alone, without opening a slice."
2. "Yes — the affected-chunk list is complete and untruncated."
3. "Yes — `Adjudication: UNADJUDICATED` reads as an honest unresolved state."
4. "Yes — the appended `### Ruling 27` reads consistently with the surrounding human-authored
   entries."
5. "Nothing missing — no field or context was named as insufficient."

(Question 6 in the plan's original `<how-to-verify>` text — "if anything is insufficient... say
exactly which field or context is missing" — is folded into answer 5 above: the designer named
nothing missing.)

**No finding to route.** Per this plan's own instruction ("If the designer names a missing field or
context, it is recorded as a real finding with a disposition... never absorbed silently"), the
absence of any named gap means there is nothing to route forward — recorded explicitly as a genuine
"nothing found" rather than an omission.

**GATE: PASSED (§3d) — by human judgment, not tool self-certification.**

---

## Both `~/BoardSmithGames` originals: byte-identical before and after this entire plan's run

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(still empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```

Whole-tree sha256 manifest diff, before vs. after this plan's ENTIRE session (both games):

```
$ find ~/BoardSmithGames/one-two-punch -type f | sort | xargs shasum -a 256 > otp.after.manifest
$ diff otp.before.manifest otp.after.manifest
(empty, exit 0)
$ find ~/BoardSmithGames/seven -type f | sort | xargs shasum -a 256 > seven.after.manifest
$ diff seven.before.manifest seven.after.manifest
(empty, exit 0)
```

Both byte-identical, before and after — including the deviation Rule 1 fix to
`src/cli/commands/verify-impact.ts` in this repo (a change to THIS repo's own source, never to
either reference game's copy).

**GATE: PASSED.**

---

## Full test suite, post-fix

```
$ npm test
Test Files  238 passed (238)
     Tests  3825 passed (3825)
$ npx tsc --noEmit
error TS6059: File '.../docs/seed-to-state.test.ts' is not under 'rootDir' ... (pre-existing, unrelated)
```

3825/3825 green — unchanged count from the pre-plan baseline (the Rule-1 fix changed internal
`json:` composition flags only; no test asserted on the old, buggy stdout-duplication behavior).

---

## What this plan did NOT prove

1. **A multi-`contradictory`-line pair's non-max-severity readings.** §1's flagged limitation: only
   the max-severity quote pair is persisted per `pairId`. Neither reference game's real
   `contradictory` finding has more than one non-cosmetic line, so this proof did not exercise (and
   cannot exercise, without a synthetic pair) what happens to a SECOND contradictory line's own
   distinct readings within the same pair. Carried forward to Phase 176 explicitly.
2. ~~A genuine human designer's own adjudicability verdict~~ — **now proven**: §3d records the
   designer's APPROVED verdict, answered 2026-07-30. (Left struck through rather than deleted, so
   this list's own history — reached-and-pending, then answered — is visible, not silently tidied.)
3. **True internal Task/Agent-tool dispatch.** Not applicable to this plan (no subagent dispatch is
   performed here — this plan consumes an already-recorded classification, never re-classifies) but
   carried as a standing milestone-wide item per `MEMORY.md`.
4. **The `verified (user-waived)` + rules-stale + code-changed path (175-CONTEXT.md decision 13).**
   Out of this plan's scope — that is `computeRepairGate`'s own domain (175-04), not VERIFY-04's
   adjudication gate; this plan proves the gate itself, not the repair-gate disposition that follows
   it.

---

## How to re-run this proof

1. `cp -R ~/BoardSmithGames/one-two-punch <scratch>/otp-N`
2. Seed `<scratch>/otp-N/rulebook/.verify/2026-07-30T01-31-49Z/{RUN.md,slices/}` from
   `175-FIXTURES/174-07-contradictory/staged/one-two-punch/`.
3. `boardsmith verify-impact-gate --project <scratch>/otp-N --run-id 2026-07-30T01-31-49Z --json`
4. `boardsmith verify-impact-apply --project <scratch>/otp-N --run-id 2026-07-30T01-31-49Z --json`
   (blocks; `pendingPairs: ["pages-1-2"]`)
5. `boardsmith verify-impact-adjudicate --project <scratch>/otp-N --run-id 2026-07-30T01-31-49Z --pair-id pages-1-2 --outcome UNADJUDICATED --json`
   OR `--outcome resolved --decision ... --citation ... --rationale ...`
6. Re-run step 4 — now proceeds.

---

# Plan 08 — VERIFY-05's real cross-file write, VERIFY-06's measured payoff, and phase closeout

`SCRATCH="${TMPDIR:-/tmp}/175-08"` for this plan's entire session. Both reference games' current
state (`seven` pinned `a03f38d4792af9dfc7c798be69686fc3230f54dd`, `one-two-punch`
`7e69471bd8980a854f3e351f2f486e1fb6f712b9`) reconfirmed identical to plan 07's own pinned commits
before anything below ran.

**A real, live-discovered bug was found and fixed under deviation Rule 1 before any of the numbers
below were trusted** — see the box at the start of §4.

---

## 4. VERIFY-05: the real cross-file staleness write

### A real live bug, found producing this section's own first real write, fixed under Rule 1

The very first real `verify-impact-apply` run on `one-two-punch` (chunk `block`) produced a
**corrupted SKETCH.md**: the new `- Rules Staleness (derived from chunks/block/CHUNK.md): ...`
pointer line was FUSED, with no newline, onto the very next bullet line that already followed
`block`'s `Status:` line in the real file:

```
- Rules Staleness (derived from chunks/block/CHUNK.md): rules-stale — rulebook moved since this chunk was verified- Test script (outcome-based): Plan a Block against an opponent's Punch in the same action; ...
```

**Root cause** (`writeRulesStalenessMarker`'s SKETCH.md insertion branch, `verify-impact.ts`): when
inserting a brand-new pointer line, the old code sliced PAST the Status line's own trailing newline
character (`sketchText.slice(hasNewline ? statusLineEnd + 1 : statusLineEnd)`) and then wrote
`'\n' + pointerLine` with no newline AFTER `pointerLine` — correct only when a BLANK line already
separated the Status line from whatever followed (the consumed newline was invisibly replaced by
the blank line's own newline, e.g. `seven`'s `bonus-point-cards` entry, which happens to end its
entry right at Status with a blank line before the next `###` heading). When the very next real
SKETCH.md line was another bullet with NO blank separator — the more common real shape, e.g.
`one-two-punch`'s `block`/`movement-advance-retreat` entries, each followed immediately by a
`- Test script (outcome-based): ...` bullet — the consumed newline was never replaced, fusing the
two lines into one.

**Why the existing test suite didn't catch it:** `verify-impact.test.ts`'s
`'write-order — inserts the SKETCH.md derived pointer immediately after the Status line'` test used
a fixture (`fixtureSketchText()`) whose "next line" WAS already another bullet
(`- Test script (outcome-based): n/a`) with no blank separator — the exact shape that triggers the
bug — but the assertion only checked `nextLine.startsWith('- Rules Staleness (derived from')`,
which is still true of the fused string `- Rules Staleness (...): rules-stale- Test script (...): n/a`.
A `startsWith` check cannot detect a missing newline.

**Fix** (Rule 1 — a real bug directly encountered performing this task's own action, on the exact
write path this plan proves): the insertion now writes immediately after the Status line's own text
WITHOUT ever slicing past its trailing newline, so the original newline (and everything after it,
including any subsequent bullet or blank line) is never consumed or resynthesized:

```ts
updatedSketch =
  sketchText.slice(0, statusLineEnd) + '\n' + pointerLine + sketchText.slice(statusLineEnd);
```

**New regression test added** (`verify-impact.test.ts`, alongside the existing one):
`'write-order — the pointer line is on ITS OWN line: the very next bullet is neither swallowed nor
fused onto it'` — reproduces the exact real shape (a bullet immediately after Status, no blank
line), asserts the pointer line's own text is byte-exact (no fused suffix), and asserts the
following line is the untouched original bullet, on its own line.

After the fix: `npm test` **3826/3826 green** (3825 baseline + 1 new regression test); `npx tsc
--noEmit` clean (only the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir warning).
Every measurement below in §4 was produced AFTER this fix, on fresh `cp -R` copies (the
pre-fix copies that first exposed the bug were discarded, never reused).

### Pre-run state, both games (before either copy's `verify-impact-apply` ran)

```
$ cp -R ~/BoardSmithGames/seven "$SCRATCH/seven-175"
$ cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/otp-175"
```

Seeded each copy's `rulebook/.verify/<runId>/{RUN.md,slices/}` from
`175-FIXTURES/174-07-contradictory/staged/<game>/` — `seven`'s run-id
`2026-07-29T23-25-24Z`, `one-two-punch`'s `2026-07-30T01-31-49Z` (both games' own real, recorded
run-ids, reused rather than minted fresh, so the seeded ledgers are byte-identical to the committed
fixture):

```
$ shasum -a 256 "$SCRATCH/seven-175/rulebook/.verify/2026-07-29T23-25-24Z/RUN.md"
bc34e19ce93e4827cfc37e6bb483516e4057c20d2837acbc1b1017351fb54135   (matches MANIFEST.md exactly)
$ shasum -a 256 "$SCRATCH/otp-175/rulebook/.verify/2026-07-30T01-31-49Z/RUN.md"
0c103aea4cca7a4a26720409018995736e1a22d8e31c0f900b72f3cb38db1928   (matches MANIFEST.md exactly)
```

Pre-write marker greps, both games (measured, not assumed):

```
$ grep -rc "rules-stale — rulebook moved" "$SCRATCH/seven-175/chunks" | awk -F: '{s+=$2} END{print s+0}'
0
$ grep -c "Rules Staleness (derived from" "$SCRATCH/seven-175/SKETCH.md"
0
$ grep -rc "rules-stale — rulebook moved" "$SCRATCH/otp-175/chunks" | awk -F: '{s+=$2} END{print s+0}'
0
$ grep -c "Rules Staleness (derived from" "$SCRATCH/otp-175/SKETCH.md"
0
```

Neither game had ever been scaffolded with the `## Rules Staleness` section — both were built
before Phase 175's template change (175-01), matching plan 07's own §2 finding for
`one-two-punch`; the same holds for `seven`.

### `seven`: no adjudication needed (real finding is `sharper`, not `contradictory`)

`seven`'s real 174-07 archived finding classifies `ruleDelta: "sharper"` (the bonus-point-card
scoring effect, "named-but-undefined" vs. "each worth +1 point") — VERIFY-04's gate never fires for
a `sharper` finding (only `contradictory` blocks). `verify-impact-gate --json` confirms:
`"contradictory": 0, "pending": 0`.

```
$ boardsmith verify-impact-apply --project "$SCRATCH/seven-175" --run-id 2026-07-29T23-25-24Z --json
```

**Measured marked-chunk count: 6** — `best-seven-selection`, `bonus-point-cards`,
`game-end-trigger`, `match-best-of-7`, `scoring-run-of-7`, `table-and-draw`. **Matches
`174-PROOF.md` §8's expected `seven` stale set (6/16) exactly — zero symmetric difference, no
slug named in one set and not the other.**

### `one-two-punch`: the real `contradictory` finding, adjudicated `resolved`

```
$ boardsmith verify-impact-gate --project "$SCRATCH/otp-175" --run-id 2026-07-30T01-31-49Z --json
"summary": {"contradictory": 1, "pending": 1, ...}
"contradictions[0].affectedSlugs": ["block","final-acceptance","jab","movement-advance-retreat","rest","second-action-resolution"]
```

Adjudicated `resolved` (the same finding, same resolution direction as plan 07's own §3b — pass 2's
"higher timing" reading governs the archived source):

```
$ boardsmith verify-impact-adjudicate --project "$SCRATCH/otp-175" --run-id 2026-07-30T01-31-49Z \
    --pair-id pages-1-2 --outcome resolved --decision "..." --citation "..." --rationale "..." --json
{"pairId":"pages-1-2","outcome":"resolved","rulingNumber":27}
```

Pre-append real corpus count: `grep -c '^### Ruling ' RULINGS.md` → **26** (this copy is a FRESH
`cp -R` of the untouched original, so the pre-existing count is 26, exactly as plan 07 measured on
its own independent copy) → **27 = 26 + 1**, exactly as predicted.

```
$ boardsmith verify-impact-apply --project "$SCRATCH/otp-175" --run-id 2026-07-30T01-31-49Z --json
```

**Measured marked-chunk count: 6** — `block`, `final-acceptance`, `jab`,
`movement-advance-retreat`, `rest`, `second-action-resolution`. **Matches `174-PROOF.md` §8's
expected `one-two-punch` stale set (6/11) exactly — zero symmetric difference.**

### Verbatim `## Rules Staleness` fenced bodies (two, real, per acceptance criteria) and their SKETCH.md pointers

`seven/chunks/bonus-point-cards/CHUNK.md`:

```
## Rules Staleness

<!-- MACHINE-OWNED. Do not write between the fences below, and do not move or delete them.
     ... (identical machine-owned comment text every "## Rules Staleness" section carries) ... -->

<!-- boardsmith:rules-staleness:begin -->
Run: 2026-07-29T23-25-24Z
Rule delta: sharper

Attributed slices:

| slice |
|---|
| rulebook/01-definitions-and-components.md |

Prior reading: Named-but-undefined (p.1): bonus point cards (depicted as a black "+1" card; the text does not define its scoring effect beyond Game End's instruction to add bonus point cards to your score)

Changed reading: Derived (p.1): Each bonus point card is worth +1 point, as printed on its face.

Adjudication: n/a

Marker: rules-stale — rulebook moved since this chunk was verified
<!-- boardsmith:rules-staleness:end -->
```

`SKETCH.md`'s matching derived pointer, verbatim, immediately after `bonus-point-cards`'s own
Status line (`grep -n "### bonus-point-cards" -A6 SKETCH.md`):

```
174:### bonus-point-cards
175:- What it builds: Each "+1" bonus point card still held at game end adds 1 point, ...
176:- ui: touches
177:- Status (derived from chunks/bonus-point-cards/CHUNK.md): verified (user-waived)
178:- Rules Staleness (derived from chunks/bonus-point-cards/CHUNK.md): rules-stale — rulebook moved since this chunk was verified
```

`one-two-punch/chunks/block/CHUNK.md` (the real chunk that first exposed §4's fused-line bug —
now correctly on its own line):

```
<!-- boardsmith:rules-staleness:begin -->
Run: 2026-07-30T01-31-49Z
Rule delta: contradictory

Attributed slices:

| slice |
|---|
| rulebook/01-setup-and-round-structure.md |

Prior reading: The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.

Changed reading: The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.

Adjudication: resolved (Ruling 27)

Marker: rules-stale — rulebook moved since this chunk was verified
<!-- boardsmith:rules-staleness:end -->
```

`SKETCH.md`'s pointer for `block`, with its next real bullet intact and on its own line (proving
the Rule-1 fix on the exact real data that first exposed the bug):

```
68:### block
69:- What it builds: The Block action resolves with its full effect.
70:- Citations: rulebook/02-action-cards-and-resolution.md (Block)
71:- ui: touches
72:- Status (derived from chunks/block/CHUNK.md): verified (user-waived)
73:- Rules Staleness (derived from chunks/block/CHUNK.md): rules-stale — rulebook moved since this chunk was verified
74:- Test script (outcome-based): Plan a Block against an opponent's Punch in the same action; the Punch is shown as BLOCKED and has no effect on you. Plan a Block with no opposing Punch; the Block is shown resolving to no effect, with the rulebook's own condition as its reason — and it is never greyed out or prevented at plan time.
```

### `Marker:`-last verification, all 12 real marked chunks (6 + 6), zero CHUNK/SKETCH mismatches

For every one of the 12 real marked chunks across both games, the fenced body's LAST non-empty
line was extracted and confirmed to start with `Marker:` — **12/12**:

```
seven: best-seven-selection, bonus-point-cards, game-end-trigger, match-best-of-7,
       scoring-run-of-7, table-and-draw — all 6: "Marker: rules-stale — rulebook moved since this
       chunk was verified"
one-two-punch: block, final-acceptance, jab, movement-advance-retreat, rest,
       second-action-resolution — all 6: same marker value
```

Every one of the 12 SKETCH.md derived pointers was independently grepped and compared against its
own CHUNK.md's `Marker:` value — **12/12 match, 0 mismatches**.

### Status enum did not move — measured, side by side

```
$ grep -h "Status:" "$SCRATCH/seven-175"/chunks/*/CHUNK.md | grep -c "rules-stale"
0
$ grep -h "Status:" "$SCRATCH/otp-175"/chunks/*/CHUNK.md | grep -c "rules-stale"
0
```

**0 in both games** — the string `rules-stale` never appears on any `Status:` line. Side by side,
`one-two-punch/chunks/block/CHUNK.md` (a `verified (user-waived)` chunk, one of the 12 marked):

```
Status: verified (user-waived)
Marker: rules-stale — rulebook moved since this chunk was verified
```

Two independent axes, exactly as decision 1 requires: the human's playtest verdict (`Status:`)
is untouched; the rulebook-staleness fact (`Marker:`) is orthogonal and separately tracked.

### Cold-resume parseability, both written copies

```
$ boardsmith chunk-provenance-status --project "$SCRATCH/seven-175" --json | jq '.chunks | length'
17
$ boardsmith drift-check --project "$SCRATCH/seven-175" --json | jq '.chunks | length, .counts'
17
{"clean": 1, "drifted": 16, "unknown": 0}
$ boardsmith chunk-provenance-status --project "$SCRATCH/otp-175" --json | jq '.chunks | length'
12
$ boardsmith drift-check --project "$SCRATCH/otp-175" --json | jq '.chunks | length, .counts'
12
{"clean": 1, "drifted": 10, "unknown": 1}
```

**Both commands parse every chunk in both written copies with zero parse failures** (17/17 for
`seven`, 12/12 for `one-two-punch` — every chunk directory in each project, not just the marked
ones) — the exact cold-resume guarantee `state-machine.md`'s Consistency Check item 5 registers,
quoted verbatim:

> "5. Where a chunk's CHUNK.md carries a `## Rules Staleness` marker (see "Rules Staleness Marker"
> above), it parses against its own two-value set (`clear` | `rules-stale — rulebook moved since
> this chunk was verified`) — separately from item 3's Status Enum check, since this marker never
> touches the `Status:` line. A malformed marker, a missing fence, or an unrecognized value here is
> ALSO a parse failure (stop and ask), exactly like item 3."

**An honest surprise, measured and reported rather than smoothed to the plan's own anticipated
shape:** both games' `drift-check` returned mostly `drifted`, NOT mostly `unknown` as
`REQUIREMENTS.md`'s VERIFY-06 note and this plan's own `<the_measurement_that_matters_most>`
anticipated. Both games in fact carry REAL `## Verified Commit Hash` values (e.g. `seven`'s
`bonus-point-cards`: `c61a6a7bcbc48bcc5ddfc833dbf6c75ce9764c53`; `one-two-punch`'s `block`:
`fbc573f`) — they are not "pre-provenance" in the sense of missing the hash entirely; they are
pre-provenance only in the `## Verified Against` (Phase 171) sense (`chunk-provenance-status`'s own
"NO RECORDED PROVENANCE YET" report). What actually dominates is that both games have had
substantial ordinary development (dependency/library updates, `DECISIONS.md` edits, test additions)
land in their manifest files SINCE each chunk's last verified commit, unrelated to the specific
rulebook-page classification this phase's finding touches. This is reported here plainly because it
directly shapes §5's payoff measurement below — see §5's honest-interpretation subsection.

### Both `~/BoardSmithGames` originals: untouched throughout §4

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
$ diff seven.before.manifest seven.after.manifest   (empty, exit 0 — 0 files differ)
$ diff otp.before.manifest otp.after.manifest       (empty, exit 0 — 0 files differ)
```

**A transient flicker, disclosed rather than hidden:** `git -C ~/BoardSmithGames/seven status
--porcelain` intermittently printed two phantom deleted entries (`.boardsmith/runtime-bundle.mjs`,
`.boardsmith/runtime-entry.ts`) at two points during this session, both before this plan wrote
anything to that repo. Neither file is tracked by `git ls-files` (confirmed: only `boardsmith.json`
matches), the `.boardsmith/` directory does not exist on disk, and five consecutive re-runs
immediately after each occurrence showed a clean, empty `--porcelain` output. The whole-tree sha256
manifest diff — the actual measured proof this section's own bar requires — is empty at every
checkpoint. Recorded as an unexplained, non-reproducible, apparently harmless flicker (most likely
an external filesystem-sync artifact unrelated to anything this plan wrote), not smoothed away, and
not treated as evidence of an actual mutation since the byte-level manifest comparison — the
stronger, authoritative measurement — never once showed a difference.

**GATE: PASSED (§4 — the real cross-file write lands on both real reference games; write order,
`Marker:`-last authority, the untouched Status enum, and cold-resume parseability are all measured,
not asserted; both originals confirmed byte-identical by whole-tree sha256 diff).**

---

## 5. VERIFY-06: the measured payoff

### Per-game `verify-impact-status --json`, in full

`seven` (run `2026-07-29T23-25-24Z`):

```json
"staleFraction": {"stale": 6, "total": 16}
"staleSlugs": ["best-seven-selection", "bonus-point-cards", "game-end-trigger", "match-best-of-7", "scoring-run-of-7", "table-and-draw"]
"dispositionCounts": {"reopen-playtest": 6, "close-without-replaytest": 0, "unknown-drift": 0, "not-applicable": 10}
```

`staleSlugs.length` (6) equals `staleFraction.stale` (6) — confirmed uncapped (no truncation
possible on a list this short, but the invariant is checked directly, not assumed).

Per-slug table, `seven`, all 6 stale chunks:

| slug | status | driftState | gate.disposition | gate.nextStatus | gate.reverifyStamp |
|---|---|---|---|---|---|
| `best-seven-selection` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |
| `bonus-point-cards` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |
| `game-end-trigger` | `verified` | `drifted` | `reopen-playtest` | `built` | `false` |
| `match-best-of-7` | `verified` | `drifted` | `reopen-playtest` | `built` | `false` |
| `scoring-run-of-7` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |
| `table-and-draw` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |

`one-two-punch` (run `2026-07-30T01-31-49Z`):

```json
"staleFraction": {"stale": 6, "total": 11}
"staleSlugs": ["block", "final-acceptance", "jab", "movement-advance-retreat", "rest", "second-action-resolution"]
"dispositionCounts": {"reopen-playtest": 5, "close-without-replaytest": 1, "unknown-drift": 0, "not-applicable": 5}
```

`staleSlugs.length` (6) equals `staleFraction.stale` (6) — confirmed uncapped.

Per-slug table, `one-two-punch`, all 6 stale chunks:

| slug | status | driftState | gate.disposition | gate.nextStatus | gate.reverifyStamp |
|---|---|---|---|---|---|
| `block` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |
| `final-acceptance` | `verified (user-waived)` | `clean` | `close-without-replaytest` | `verified (user-waived)` | `true` |
| `jab` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |
| `movement-advance-retreat` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |
| `rest` | `verified (user-waived)` | `drifted` | `reopen-playtest` | `built` | `false` |
| `second-action-resolution` | `verified` | `drifted` | `reopen-playtest` | `built` | `false` |

### The payoff number, stated explicitly per game

**`seven`: of 6 rules-stale chunks, 0 close without re-playtesting and 6 re-open the gate — the
designer re-playtests all 6, not fewer.** Every one of `seven`'s 6 stale chunks has genuinely
drifted code (real changed manifest files — `src/rules/*.ts`, `tests/*.test.ts`, `DECISIONS.md`,
etc. — measured directly in §4's `drift-check` output) since its last verified commit, unrelated to
the specific rulebook page this run's finding touches. VERIFY-06's scoping mechanism is CORRECT
(every chunk gets its own real, individually-computed disposition, never a blanket answer) but on
this real data it buys **zero** re-playtest savings for `seven`.

**`one-two-punch`: of 6 rules-stale chunks, 1 closes without re-playtesting and 5 re-open the
gate — the designer re-playtests 5 chunks, not 6.** A small, real saving — one chunk in six
(`final-acceptance`) — genuinely avoids re-playtesting because its code has not moved since it was
last verified (drift-check: `clean`), and its `## Verified Against` block gets a real
`Re-verified (no code change):` stamp (§6 below) instead of a playtest re-open.

### Interpretation against 174's carried anchor-density risk — honest, not favourable

174-PROOF.md §8 closed with an explicit open risk: even after decision 19's per-citation narrowing,
37.5% (`seven`) and 54.5% (`one-two-punch`) of citing chunks still go rules-stale from one finding
each, because several chunks genuinely quote the same foundational rule. VERIFY-06's own stated
purpose is to make that fraction tolerable in PRACTICE — if most of those chunks close without
re-playtesting, the human cost of a broad stale fraction stays low even when the fraction itself is
large.

**Measured against these two real reference games, that practical tolerance is NOT demonstrated —
for a different reason than either anticipated branch (`unknown-drift` dominating, or a clean
payoff).** Neither reference game's stale set is dominated by `unknown-drift`
(`dispositionCounts.unknown-drift` is **0** in both games — `drift-check`'s per-chunk `counts`
object, confirmed in §4, does show 1 real `unknown` verdict overall for `one-two-punch`'s
`ai-opponent` chunk, but that chunk is not in either game's rules-stale set, so it never surfaces as
`unknown-drift` in the gate). Instead, **most stale chunks are genuinely `drifted`** — real code
has moved in both games since each chunk's last verified commit, for reasons entirely unrelated to
the rulebook-page classification this run's finding is about (ordinary ongoing development: engine
API updates, test additions, `DECISIONS.md` edits). The mechanism computes the CORRECT disposition
per chunk in every case measured (never asserted, always the real `driftCheckCommand` verdict), but
on data this actively developed, "the code did not change" is the exception (1 of 12 rules-stale
chunks total across both games), not the rule anchor-density made possible.

**Honest verdict: the payoff is NOT demonstrated as a general mitigation of anchor density on
these two real reference games — 1 of 12 (8.3%) rules-stale chunks across both games closes without
re-playtesting; 11 of 12 (91.7%) re-open the gate.** The mechanism (`computeRepairGate`'s per-chunk,
blindness-before-narrowing decision) is proven correct and is exactly what a repair pass needs to
consume (Phase 176), but on real, actively-developed reference games, most stale chunks' code HAS
moved for reasons unrelated to the rules finding, so scoping by code-movement alone does not
reliably shrink the anchor-density fraction's human cost the way 174's carried risk hoped it would.
A short-lived, freshly-built game with less accumulated unrelated drift between verification and a
rules pass would very likely show a different (better) ratio — these two games have been under
active BoardSmith-library-driven development for multiple phases since their chunks were last
verified, which is precisely why so much of their code (not their rules) has moved.

### No anchored-copy subsection needed

Per this plan's own guidance, an anchored-copy measurement is only required when `unknown-drift`
DOMINATES the real measurement. It does not here (`unknown-drift: 0` in both games' real
`dispositionCounts`) — the honest finding above is a different, real measured outcome (most stale
chunks are genuinely `drifted`, not `unknown`), so no synthetic anchoring is performed or needed;
doing so would answer a question this data did not actually raise.

**GATE: PASSED, with an honest NOT-DEMONSTRATED verdict (§5 — the payoff mechanism is proven
correct per-chunk on both real games; the practical anchor-density mitigation it was hoped to
provide is measurably NOT realized on this data, for a real, disclosed reason distinct from either
anticipated failure mode).**

---

## 6. Decision 13: the `verified (user-waived)` path

### Measured count, both copies

```
$ grep -l 'Status: verified (user-waived)' "$SCRATCH/seven-175"/chunks/*/CHUNK.md | wc -l
16
$ grep -l 'Status: verified (user-waived)' "$SCRATCH/otp-175"/chunks/*/CHUNK.md | wc -l
9
```

### LIVE — decision 13's exact path occurs naturally on both real reference games

§5's per-slug tables already show it, named again here explicitly: **4 of `seven`'s 6 stale chunks**
(`best-seven-selection`, `bonus-point-cards`, `scoring-run-of-7`, `table-and-draw`) and **4 of
`one-two-punch`'s 6 stale chunks** (`block`, `jab`, `movement-advance-retreat`, `rest`) are ALL
THREE of decision 13's conditions at once, on real files, with no construction: `Status: verified
(user-waived)`, rules-stale (`true`), AND code-changed (`driftState: drifted`). In every one of
these 8 real cases, `computeRepairGate` returns `disposition: reopen-playtest`, `nextStatus:
"built"` — the waiver is NOT auto-renewed; the human must waive again, explicitly, exactly as
decision 13 requires. **Labelled LIVE** — this is real, naturally-occurring data, not a constructed
fixture.

(`one-two-punch`'s `final-acceptance` is ALSO `verified (user-waived)` and rules-stale, but its
`driftState` is `clean`, not `drifted` — it takes the OTHER real path this phase built,
`close-without-replaytest`, with the waiver preserved verbatim per decision 11 — see below. It is
named here for completeness, not counted among the 8 decision-13 cases, since decision 13 requires
code-changed specifically.)

### Decision 11's stamp on real data — `final-acceptance`, the one real `close-without-replaytest` chunk

```
$ boardsmith chunk-check final-acceptance --project "$SCRATCH/otp-175" \
    --reverified-no-code-change "1cd9a6b..7e69471bd8980a854f3e351f2f486e1fb6f712b9 — 0 manifest files changed" --json
{"slug":"final-acceptance","scope":"code-conformance-only","reason":"pre-provenance-project","changed":true,"citedSlices":[...],"unresolved":[]}
```

Resulting `## Verified Against` fenced body, verbatim (`final-acceptance/CHUNK.md`):

```
<!-- boardsmith:verified-against:begin -->
Scope: code-conformance-only
Reason: pre-provenance-project
Rulebook edition: not stated in the rulebook
Rulebook source hash: none recorded
BoardSmith version: 0.0.1
Skills tree hash: c78dbcde5ea10369decc7fc858cea16d19f974dcb268139829fe2b7164c8e512
Re-verified (no code change): 1cd9a6b..7e69471bd8980a854f3e351f2f486e1fb6f712b9 — 0 manifest files changed

Cited slices:

| slice | sha256 |
|---|---|
| rulebook/01-setup-and-round-structure.md | 19dd7e2f0635ce128391bdaa008f606ed77a4e98729789091884a7ddfc6572cd |
| rulebook/02-action-cards-and-resolution.md | dca5e0d99ab8c7c229a8b62d760388fc517b2c4011fe235a4f918cefc2ee8cfd |
<!-- boardsmith:verified-against:end -->
```

The `Re-verified (no code change): 1cd9a6b..7e69471... — 0 manifest files changed` line is present,
real, and matches decision 11's own documented label exactly — the one real
`close-without-replaytest` chunk this data produced genuinely gets stamped rather than re-opened.

**GATE: PASSED (§6 — decision 13's path proven LIVE on 8 real chunks across both games, never
constructed; decision 11's stamp proven on the one real chunk that took the clean path).**

---

## 7. What is still unproven (final, phase-wide)

- **The `lineFindings[]` persistence gap** (carried from `174-PROOF.md` §1 and plan 07's own list):
  only the max-severity `quotedPass1`/`quotedPass2` pair is retained on `ClassificationRecord`, so a
  multi-delta pair's non-max line deltas are not available to Phase 176's repair scoping. Neither
  reference game's real finding is a multi-delta pair, so this proof still cannot exercise it.
  **Destination: Phase 176's repair-scoping input contract — flagged there, not resolved here.**
- **Whether a LIVE `/bs-verify-game` session actually follows Step 4's prose.** This phase (like
  every plan before it in this milestone) pins skill TEXT and proves the CLI commands that text
  invokes; it never proves a live orchestrating session actually reads and follows that text. The
  standing caveat every plan in this milestone carries (Phase 170 found twelve half-followed
  instructions in a single live run).
- **No native Task/Agent-tool dispatch anywhere in this milestone** — unchanged, carried forward
  again. This plan performed zero LLM dispatch (it consumes already-recorded classifications and
  runs CLI commands), so it neither adds to nor resolves this gap.
- **§5's payoff measurement is STRUCTURAL-NOT-FAVOURABLE, not STRUCTURAL-ABSENT** — worth stating
  precisely since it differs from the anticipated failure mode: the measurement genuinely ran on
  real data and produced a real, honest number (1 of 12 rules-stale chunks close without
  re-playtesting); what remains unproven is whether a DIFFERENT real game — one with less
  accumulated code drift unrelated to its rules — would show a materially better ratio. Neither
  reference game can settle that question; both have had substantial ordinary development land
  since their chunks were last verified.
- **VERIFY-06's `unknown-drift` branch specifically** — this plan's real data happened to land in
  the `drifted`-dominant case, not the `unknown`-dominant case anticipated by
  `REQUIREMENTS.md`'s own VERIFY-06 note. The `unknown-drift` disposition's own behavior (never
  collapsed into `clean`, `nextStatus` never set) is unit-proven in 175-04's own test suite, but
  this plan did not exercise it as the DOMINANT real-data case, because it was not real data's actual
  shape here — one real `unknown` chunk exists (`one-two-punch`'s `ai-opponent`), but it is not
  rules-stale, so it never entered either game's gate/dispositionCounts.
- **Anything the designer named at plan 07's human checkpoint** — nothing was named as missing
  (plan 07 §3d: "Nothing missing — no field or context was named as insufficient"), so there is
  nothing routed forward from that checkpoint specifically.

---

## 8. How to re-run every proof

**§§1–3d (VERIFY-04):** see plan 07's own "How to re-run this proof" section immediately above
this plan's own heading — unchanged, still accurate.

**§4–§6 (VERIFY-05/VERIFY-06/decision 13), this plan:**

1. `SCRATCH="${TMPDIR:-/tmp}/175-08"; cp -R ~/BoardSmithGames/seven "$SCRATCH/seven-175"; cp -R
   ~/BoardSmithGames/one-two-punch "$SCRATCH/otp-175"`.
2. Seed each copy's `rulebook/.verify/<runId>/{RUN.md,slices/}` from
   `175-FIXTURES/174-07-contradictory/staged/<game>/` — `seven`: run-id `2026-07-29T23-25-24Z`;
   `one-two-punch`: run-id `2026-07-30T01-31-49Z`. Confirm both seeded `RUN.md` hashes match
   `175-FIXTURES/174-07-contradictory/MANIFEST.md` exactly before proceeding.
3. `seven`: `boardsmith verify-impact-gate --project "$SCRATCH/seven-175" --run-id
   2026-07-29T23-25-24Z --json` (confirms `contradictory: 0` — no adjudication needed) then
   `boardsmith verify-impact-apply --project "$SCRATCH/seven-175" --run-id 2026-07-29T23-25-24Z
   --json` (marks 6 chunks).
4. `one-two-punch`: `boardsmith verify-impact-gate --project "$SCRATCH/otp-175" --run-id
   2026-07-30T01-31-49Z --json` (confirms `contradictory: 1`, `pending: ["pages-1-2"]`), then
   `boardsmith verify-impact-adjudicate --project "$SCRATCH/otp-175" --run-id
   2026-07-30T01-31-49Z --pair-id pages-1-2 --outcome resolved --decision "..." --citation "..."
   --rationale "..." --json` (appends Ruling 27), then `boardsmith verify-impact-apply --project
   "$SCRATCH/otp-175" --run-id 2026-07-30T01-31-49Z --json` (marks 6 chunks).
5. For §5: `boardsmith verify-impact-status --project <copy> --run-id <runId> --json` on each
   written copy.
6. For §6's decision-11 stamp: `boardsmith chunk-check final-acceptance --project
   "$SCRATCH/otp-175" --reverified-no-code-change "<hash>..<head> — 0 manifest files changed"
   --json`, using `final-acceptance`'s own `drift-check` hash and the copy's current `git rev-parse
   HEAD`.
7. Cold-resume parse: `boardsmith chunk-provenance-status --project <copy> --json` and `boardsmith
   drift-check --project <copy> --json` on each written copy.
8. Originals check: `git -C ~/BoardSmithGames/<game> rev-parse HEAD` (unchanged) plus a whole-tree
   `find | sort | xargs shasum -a 256` diff against a pre-run snapshot (empty).

---

## 9. Both reference-game originals: byte-identical after the entire phase

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (matches the phase's pinned commit, unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(clean at every confirmed checkpoint — see §4's disclosed transient-flicker note)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)

$ find ~/BoardSmithGames/seven -type f | sort | xargs shasum -a 256 > seven.after.manifest
$ diff seven.before.manifest seven.after.manifest
(empty, exit 0 — 0 files differ)
$ find ~/BoardSmithGames/one-two-punch -type f | sort | xargs shasum -a 256 > otp.after.manifest
$ diff otp.before.manifest otp.after.manifest
(empty, exit 0 — 0 files differ)
```

**0 files differ, both games, measured by whole-tree sha256 diff** — the same measurement plan 07
and every prior real-data plan in this phase performs. `seven`'s pinned commit
(`a03f38d4792af9dfc7c798be69686fc3230f54dd`) is confirmed unchanged.

---

## Full test suite, this plan

```
$ npm test
Test Files  238 passed (238)
     Tests  3826 passed (3826)
$ npx tsc --noEmit
error TS6059: File '.../docs/seed-to-state.test.ts' is not under 'rootDir' ... (pre-existing, unrelated)
```

**3826/3826 green** — 3825 (plan 07's own closing baseline) + 1 new regression test (§4's Rule-1
fix's own pinning test). `npx tsc --noEmit` clean apart from the same pre-existing, unrelated
warning every prior plan in this phase has recorded.
