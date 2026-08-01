# 179-06 Live Proof — Source-Free Verification Mode, Run For Real

**Judged against `179-PRE-REGISTRATION.md`, commit `272d40d4f13e86fd3ff325041974377e2d1d71f4`** —
the sole commit touching that file, on `main` before this plan's first command ran. Every verdict
below cites a section of that document by number; none of its restated bars were altered after
this run's results were known.

Staged project: `~/BoardSmithGames/seven` (17 chunks), `cp -R`'d to a scratch working copy with
`rulebook/source/` and root `rules.pdf` removed from the COPY ONLY. Raw command outputs, dispatch
prompts, and raw model returns are saved under
`.planning/phases/179-source-free-verification-mode/179-PROOF/`.

---

## SC-1 — restated bar (Pre-Reg "SC-1's restated operational bar")

**Judged against the RESTATED bar, not the literal ROADMAP sentence** — the literal sentence
("completes... instead of failing") is satisfiable by a mode that runs nothing and prints a
banner; that is exactly the vacuity the pre-registration closed by name.

1. **All four checks ran to their own completion with a captured exit code, all `0`.**
   - `verify-source-free-check --json`: exit `0` (`179-PROOF/1-verify-source-free-check.json`).
   - `trace-check --json`: exit `0` (`179-PROOF/2-trace-check.json`).
   - `drift-check --json`: exit `0` (`179-PROOF/3-drift-check.json`).
   - `verify-derive-check --json` (CHECK-04): exit `0` (`179-PROOF/9-verify-derive-check.json`).
   - `verify-example-replay --json` (CHECK-06, the pipeline-level read): exit `0`
     (`179-PROOF/4-verify-example-replay-before.json`).
2. **The session did not stop at `source-resolution.md`'s negative case.** Both negative-case
   conditions were confirmed absent on the copy (`ls <copy>/rulebook/source` → "No such file or
   directory"; `ls <copy>/*.pdf` → no matches) and the session proceeded into
   `source-free-mode.md`'s reduced sequence rather than halting.
3. **The Close executed, including its durable write.** `verify-close-record --project <copy>
   --json` (no `--run`) ran, exit `0`, `recorded[]` has 17 entries, all `changed: true`
   (`179-PROOF/10-verify-close-record-1.json`).
4. **Bound to §3 — not true vacuously.** §3's per-check minimums were met for CHECK-03 (232
   findings) and CHECK-05 (16 findings); CHECK-06 produced 3 real recorded findings (1
   `example-inconsistent`, 2 `unexecutable`), all with downgraded provenance (see decision-11(d)
   section below for the exact match against the bar's wording).

**Verdict: MET.**

---

## SC-2 — restated bar (Pre-Reg "SC-2's restated operational bar")

**Bar: exactly 5 `uncheckedDefectClasses` entries, each with non-empty `defectClass` and
`wouldHaveBeenCaughtBy`.**

`179-PROOF/1-verify-source-free-check.json`'s `uncheckedDefectClasses[]` has exactly 5 entries,
one per Steps 2-6:

1. `staging-run-and-re-transcription` — "rulebook-fidelity drift between the live rules text and
   the source rulebook" / "the staging-dispatch re-transcription pass"
2. `classification` — "wording-change-versus-rules-change discrimination in the live text" / "the
   classification-dispatch pairwise comparison"
3. `adjudication-gate-and-impact-map` — "unadjudicated contradictions and cross-chunk
   rules-staleness" / "the adjudication gate and its impact map"
4. `ruling-re-check` — "a recorded ruling that no longer matches the current source" / "the
   ruling-recheck dispatch against fresh staged text"
5. `repair-dispatch` — "a stale chunk left unrepaired through the build-pipeline audit lenses" /
   "the repair-dispatch audit-and-repair loop"

All 5 have non-empty strings in both fields. Count and content match §5's pre-registered
expectation exactly.

**Verdict: MET.**

---

## SC-3 — restated bar (Pre-Reg "SC-3's restated operational bar") — the ON-DISK block, never live recomputation

**Bar: the ON-DISK `## Verified Against` block, read back via `Read`/`cat` from a real
`chunks/<slug>/CHUNK.md` on the staged copy, AFTER the Close — not `verify-source-free-check`'s
live `--json` recomputation.**

BEFORE the run: `grep -l "Verified Against" <copy>/chunks/*/CHUNK.md` → zero matches (exit 1) —
confirmed absent on all 17 chunks, matching §5's "none currently carries a block" expectation.

AFTER the Close, `chunks/best-seven-selection/CHUNK.md` (the alphabetically-first of
`drift-check`'s own touched set — confirmed to be all 17 chunks, matching §5's hedge) read back
from disk with `cat`, quoted verbatim between the fences:

```
<!-- boardsmith:verified-against:begin -->
Scope: code-conformance-only
Reason: source-missing
Rulebook edition: not stated in the rulebook
Rulebook source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
BoardSmith version: 0.0.1
Skills tree hash: c78dbcde5ea10369decc7fc858cea16d19f974dcb268139829fe2b7164c8e512

Cited slices:

| slice | sha256 |
|---|---|
| rulebook/01-definitions-and-components.md | eb384d9d57e666627f9738931c9c2e34383169d2c6675a3196e52c8a664560cb |
| rulebook/01-overview-setup-and-play.md | 3f64747ad0bc9a3da9a2222be281f1a109c99d79e9077a9ff9212a0e07e46769 |

Unresolved citations:

- rulebook/INDEX.md
<!-- boardsmith:verified-against:end -->
```

`Scope: code-conformance-only` and `Reason: source-missing` — both load-bearing lines match §5's
pre-registered expectation exactly, byte for byte.

**Minor divergence, disclosed plainly (not reconciled):** §5's expected `Rulebook edition:` line
read "not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending
designer confirmation"; the actual on-disk line is the shorter "not stated in the rulebook." This
is a non-load-bearing cosmetic difference in the renderer's edition-string wording, not in
`Scope:`/`Reason:` (the fields SC-3 is actually about), and it does not affect this verdict.

**Verdict: MET.**

---

## Decision 11(a) — folded into SC-1

Folded per the pre-registration; see SC-1's section above. **MET.**

## Decision 11(b) — folded into SC-2

Folded per the pre-registration; see SC-2's section above. **MET.**

## Decision 11(c) — folded into SC-3

Folded per the pre-registration; see SC-3's section above. **MET.**

## Decision 11(d) — the checks that DID run produced real findings (§3's per-check minimums)

| Check | Bar (§3) | Result | Verdict |
|---|---|---|---|
| CHECK-03 (`trace-check`) | ≥1 real finding | 232 findings (`counts`: claim-untested 212, ruling-untested 3, test-unlinked 1, unassociated-test 3, ambiguous-claim-ref 13) — `179-PROOF/2-trace-check.json` | MET |
| CHECK-05 (`drift-check`) | ≥1 real finding | 16 `chunk-code-drifted` findings out of 17 chunks (1 chunk, `final-acceptance`, reported clean) — `179-PROOF/3-drift-check.json` | MET |
| CHECK-06 (`verify-example-replay`) | ≥1 REAL LIVE dispatch, recorded finding with downgraded `QuoteVerifiedProvenance` and unrewritten verdict | See below | MET, with a named caveat |
| CHECK-04 (`verify-derive-check`) | Runs to completion, captured exit code — explicitly NO minimum-findings bar | Exit `0`, `pendingCount: 3`, zero dispatched (see "What was and was not dispatched" below) | MET (completion-only bar) |

### CHECK-06 — the live dispatch, in full

All 3 of `verify-example-replay`'s pending slices on the staged copy were dispatched (the entire
project-wide pending set, not a cherry-picked one):

1. **`rulebook/01-definitions-and-components.md`** — real `claude -p` extraction dispatch
   (`179-PROOF/extraction-raw-return.json`, `179-PROOF/slice1-extraction-payload.txt`) returned 2
   examples: a `predicate` (the "Set: 2+ matching numbers... example: 5, 5, 5" definition) and an
   `example-inconsistent` finding (the Run definition's "5, 6, 7" text vs. its Visual line's "1,
   2, 3" — the exact adversarial contradiction 178-10's pre-registration named for this same
   slice). Real translation dispatch for the predicate
   (`179-PROOF/translation-raw-return.json`) returned `verdictHint: "unexecutable"`, reason
   `no-matching-symbol` — a genuine result: `seven`'s exported surface has no standalone "Set"
   predicate, only whole-hand `ScoringPattern.check` members. Both recorded via
   `verify-example-record` (`179-PROOF/7-record-definitions.json`): the predicate as
   `verdict: "unexecutable"`, the Run example as `verdict: "example-inconsistent"` — **both with
   `provenance: "quote-unverified"`**.
2. **`rulebook/01-overview-setup-and-play.md`** — real extraction dispatch
   (`179-PROOF/extraction-raw-slice-rulebook_01-overview-setup-and-play.md-payload.json`) returned
   `examples: []` — a legitimate zero-examples result (178 decision 17's sibling rule: never a
   reason to stretch a passage into an example). No translation/record dispatch follows for a
   slice with no examples.
3. **`rulebook/02-solo-variant.md`** — real extraction dispatch
   (`179-PROOF/extraction-raw-slice-rulebook_02-solo-variant.md-payload.json`) returned 1
   `predicate` example (the solo-variant "multiples of 7" milestone). Real translation dispatch
   (`179-PROOF/translation-raw-return-solo.json`) returned `unexecutable`, reason
   `unmodeled-component-state` — genuine: the multi-game solo-mode accumulation this example
   depends on is not exposed as a callable predicate. Recorded
   (`179-PROOF/8-record-solo.json`): `verdict: "unexecutable"`, **`provenance:
   "quote-unverified"`**.

**The downgraded-provenance, unrewritten-verdict finding the bar asks for, verbatim from the
recorded ledger entry** (`179-PROOF/7-record-definitions.json`):

```json
{
  "exampleId": "rulebook/01-definitions-and-components.md:12",
  "kind": "example-inconsistent",
  "verdict": "example-inconsistent",
  "reason": "Line 12's quoted example text for the Run definition reads \"example: 5, 6, 7\", but line 14's Visual description of the same example states the accompanying card images show 1, 2, 3 ...",
  "contradictionA": "\"example: 5, 6, 7\"",
  "contradictionB": "Visual (p.1): ... a red 1, a blue 2, and a red 3 ...",
  "provenance": "quote-unverified"
}
```

This finding's verdict (`example-inconsistent`) was decided at extraction time and is passed
straight through to the ledger unchanged by the provenance gate — the downgrade never touches
`verdict`, exactly as `verify-example-record`'s own contract documents (`verifyExampleRecordCommand`
docstring, `verify-example-replay.ts:822-829`: "the downgrade NEVER rewrites `verdict` itself").
`provenance` is `"quote-unverified"` for every one of the 3 records this dispatch wrote, resolved
once per invocation via `QuoteVerifiedProvenance.obtain(<copy>)` — which correctly found no
archived source anywhere on the staged copy.

**Named caveat, stated plainly rather than smoothed over:** the pre-registration's §3 table
describes this bar by reference to "Phase 178 wave 4's already-built two-bucket reporting" —
the report layer's two NAMED buckets (`mismatch, quotes source-verified` /
`mismatch, quotes NOT source-verified`) are strictly for `verdict === "disagrees"` records
(`verifyExampleReplayCommand`, `verify-example-replay.ts:642-666`). This run's entire pending
corpus (all 3 slices, exhaustively dispatched) produced zero `disagrees` verdicts — 1
`example-inconsistent` and 2 `unexecutable`, none of which land in either of the two literal
report buckets; they land in `otherFindings` instead. The underlying degradation mechanism this
bar exists to prove — a per-invocation `provenance` field, resolved once, downgraded to
`quote-unverified` on every record regardless of verdict, with the verdict itself never rewritten
— **is proven**, on real live findings, exactly as it would be for a `disagrees` verdict; what is
NOT proven by this run is that specific finding landing in the report's `disagrees`-only
two-bucket display. No `disagrees` verdict was available to dispatch a second/third round toward
manufacturing one — CLAUDE.md's "never use dummy data, fallbacks, or other hacks" and this
project's "never manufacture a finding" rule both forbid forcing one.

**Verdict: MET**, on the mechanism the bar is actually protecting (downgraded provenance +
unrewritten verdict, live, recorded), with the disagrees-bucket caveat named above rather than
elided.

### CHECK-04 — what was and was not dispatched

`verify-derive-check --project <copy> --json` ran to completion, exit `0`
(`179-PROOF/9-verify-derive-check.json`): `pendingCount: 3` (3 `Derived (p.N):` lines awaiting a
three-dispatch enumerate/reconcile round). **Zero enumerator/reconciler dispatches were made** —
per the plan's own instruction ("A full three-dispatch CHECK-04 round is NOT required by the
pre-registered bar; record exactly what was and was not dispatched rather than implying more")
and per §3's explicit exclusion of CHECK-04 from any minimum-findings bar (177/177.1's disposition
retiring its determinism gate). This is recorded as a completion-only result, not implied as more.

---

## Originals-untouched — whole-tree, BEFORE and AFTER

**BEFORE** (before any staging), `~/BoardSmithGames/seven`:
```
$ git status --short
(empty output)
```

**AFTER** (after all dispatches, both `verify-close-record` runs, and the full test suite):
```
$ git status --short
(empty output)
```

Byte-identical: empty before, empty after. No enumerated path list was used at any point — both
readings are unscoped `git status --short` against the whole working tree, per decision 10 and
178-PROOF.md §10's exact failure mode (an enumerated/scoped check that missed a deletion outside
its scope). `one-two-punch` and every other reference game were never touched by this plan.

**The staged COPY's own `git status --short`**, for comparison (not an originals-untouched claim
— the copy is expected to change):
```
 M chunks/best-seven-selection/CHUNK.md
 M chunks/bonus-point-cards/CHUNK.md
 M chunks/discard/CHUNK.md
 M chunks/final-acceptance/CHUNK.md
 M chunks/game-end-trigger/CHUNK.md
 M chunks/game-score-and-winner/CHUNK.md
 M chunks/match-best-of-7/CHUNK.md
 M chunks/scoring-combo-sets-and-runs/CHUNK.md
 M chunks/scoring-declaration/CHUNK.md
 M chunks/scoring-engine-and-parity/CHUNK.md
 M chunks/scoring-one-color/CHUNK.md
 M chunks/scoring-run-of-7-one-color/CHUNK.md
 M chunks/scoring-run-of-7/CHUNK.md
 M chunks/scoring-set-5-plus-set-2/CHUNK.md
 M chunks/scoring-set-of-7/CHUNK.md
 M chunks/simultaneous-round-loop/CHUNK.md
 M chunks/table-and-draw/CHUNK.md
 D rulebook/source/rules.pdf
 D rules.pdf
?? rulebook/.example-replay/
```

**Cross-checked against `recorded[]`:** the 17 `M chunks/*/CHUNK.md` lines match `recorded[]`'s 17
slugs exactly — no file was touched by the Close that `recorded[]` does not name, and no name in
`recorded[]` is missing from the touched set. No scoping defect. The 2 `D` lines are the staging
step's own deliberate removal (Section 4's `rm -rf .../rulebook/source` and `rm -f .../rules.pdf`),
not part of the Close's write. The untracked `rulebook/.example-replay/` directory is CHECK-06's
own ledger, written by `verify-example-record` — a different write surface from
`verify-close-record`, correctly scoped to only that path, and expected from Task 2's live
dispatches.

---

## Idempotency and fence-scoping — the Close's two safety properties, on the real project

**Idempotency:** a second `verify-close-record --project <copy> --json` run, immediately after the
first with no code or rulebook change in between
(`179-PROOF/11-verify-close-record-2.json`), reports all 17 `recorded[]` entries with
`changed: false`. SHA-256 of every one of the 17 written `CHUNK.md` files, captured before and
after the second run, is identical (`179-PROOF/sha-before-second-close.txt` vs.
`179-PROOF/sha-after-second-close.txt` — `diff` exits 0, zero lines differ). **Verdict: MET.**

**Fence-scoping:** `git diff chunks/best-seven-selection/CHUNK.md` (in the copy) shows the entire
change is a pure append of the `## Verified Against` heading plus the fenced block after the
chunk's pre-existing final line — every byte of designer-authored content above it (playtest
notes, waived-defect ledger, "Verified Commit Hash") is untouched. **Verdict: MET.**

---

## Limits, stated plainly

- **CHECK-04 dispatch depth:** zero enumerator/reconciler dispatches occurred; only the read
  command ran. This run proves CHECK-04 remains reachable and completion-clean on a source-free
  project, nothing about its 3 pending derived lines' actual corroboration status.
- **The durable write was observed on ONE staged project's chunks (`seven`, 17 chunks), not
  across a population.** `one-two-punch` is in the identical `source-missing`-eligible state
  (per 179-05's own direct read) but was never staged or dispatched in this plan.
- **One staged game is not generalization evidence.** Every new game measured across this
  milestone (177's CHECK-04 measurement, 178's cross-game CHECK-06 proof) surfaced at least one
  new defect the prior corpus hadn't. This run found none in the mode's own mechanics (the mode
  ran, reported, and closed exactly as designed), but that is one data point, not a population
  claim.
- **CHECK-06's `disagrees`-bucket caveat** (full detail in the decision-11(d) section above): the
  live dispatch corpus this run exhaustively covered (all 3 pending slices) produced zero
  `disagrees` verdicts, so the specific report-layer bucket named in §3's table
  (`mismatch, quotes NOT source-verified`) was never populated by this run. The underlying
  per-record provenance-downgrade mechanism that bucket depends on is proven directly on the
  `example-inconsistent` and both `unexecutable` records instead.
- **The `Rulebook edition:` line's minor wording divergence from §5's pre-registered exact text**
  (SC-3 section above) — cosmetic, non-load-bearing, not reconciled after the fact.
- **CHECK-03/CHECK-05 finding counts are properties of `seven`'s current, real, imperfect state**
  (212 untested claims, 16/17 chunks drifted since their last verified commit) — they are real
  findings about a real project mid-development, not manufactured for this proof, and this proof
  does not evaluate whether any of them should be fixed.
- **No `--source-free` flag exists anywhere; this run entered the mode purely as a consequence of
  the copy's disk state**, per decision 1 — this proof does not (and structurally cannot) test a
  bypass path, because none exists.

---

## Test suite

`npx vitest run`, before this plan's first command: 4368 tests / 249 files, 0 failing (carried
from 179-05's baseline, itself unchanged from every plan in this phase — a `.planning/`+skill-prose
phase touches no runtime source until this plan's own commit).

`npx vitest run`, after every dispatch, both Close runs, and staging cleanup: **4368 tests / 249
files, 0 failing.** Delta: 0.
