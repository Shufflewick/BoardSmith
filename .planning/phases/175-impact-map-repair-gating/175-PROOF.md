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

**STATUS: REACHED, NOT YET ANSWERED.** This plan's Task 3 is a `checkpoint:human-verify` gate
(`gate="blocking"`, `autonomous: no`). Per this plan's execution protocol, the rendered gate output
above (§2 step 2's verbatim `verify-impact-gate` human report, and §3a's verbatim CHUNK.md fenced
body) is presented to the designer for judgment; the designer's answer is recorded here VERBATIM
once given. **No self-certification is performed by the executing agent for this section** — the
whole point of VERIFY-04's human gate is that a human, not the tool, judges adjudicability.

This section is deliberately left as `REACHED-AND-PENDING` rather than marked passed. See the
completion message for the six verification questions the designer is being asked, taken directly
from this plan's own `<how-to-verify>` text.

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
2. **A genuine human designer's own adjudicability verdict** — §3d is REACHED-AND-PENDING, not
   answered, per this plan's checkpoint protocol.
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
