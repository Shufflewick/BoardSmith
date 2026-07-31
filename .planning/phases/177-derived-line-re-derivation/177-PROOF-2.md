# Phase 177 Plan 12 — Gap-Closure Re-Proof (targeting fix, live corpus)

This document re-runs `177-PROOF.md`'s full live proof against the module AFTER plans 177-08
through 177-11 landed — structural decoration-tolerance, ledger integrity, the missing write
surface, and the opaque-handle/focus-narrowing/`factAlignment` targeting fix — to find out whether
the phase's own self-reported goal failure (`177-PROOF.md` §3: a 56% `disagrees` rate dominated by
targeting-collapse artifacts, not genuine mismatches) actually improved on real dispatch data. It
follows `177-PROOF.md`'s structure section-for-section.

**Headline result, stated up front per this plan's honesty discipline: the targeting fix did NOT
close the artifact problem it was built to close, measured on the real corpus.** Every single
`disagrees` verdict recorded this run — 8 of 8 — carries `factAlignment: different-fact`. The raw
`disagrees` rate barely moved (50%, 8/16, vs. `177-PROOF.md`'s 56%, 9/16), and the SHARE of
`disagrees` that are targeting artifacts rather than genuine content conflicts went from 8-of-9
(89%) to 8-of-8 (100%) — worse, not better, on the share that actually matters. `genuineDisagreements`
is 0 across the entire 16-candidate corpus. This is exactly the failure outcome
`177-TARGETING-PREDICTION.md`'s interpretation rule (b) named in advance and committed to reporting
in these words if it happened. Full data below.

## 1. Setup, fixture provenance, sha256 baselines, real install, dispatch mechanism, enumeration

**Scratch location:** `${TMPDIR:-/tmp}/…/scratchpad/177-12-proof/` — `seven/` and `one-two-punch/`
are fresh `cp -R` copies made for this plan (a new preflight, sha256 baseline, copy, and install,
independent of `177-06`/`177-07`'s now-gone scratch directories).

### Preflight (on the ORIGINALS, before any copy)

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

Both pinned commits match `177-CONTEXT.md`/`177-PROOF.md` exactly. `one-two-punch`'s two deletions
are the same pre-existing, previously-documented Phase 173 exception `177-PROOF.md` §1 named —
unchanged, not new, not this plan's concern.

Whole-tree sha256 manifests captured BEFORE any copy:

```
$ cd ~/BoardSmithGames/seven && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-seven.before
$ wc -l manifest-seven.before
    3919 manifest-seven.before
$ cd ~/BoardSmithGames/one-two-punch && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-otp.before
$ wc -l manifest-otp.before
    4134 manifest-otp.before
```

Both counts (3919 / 4134) are byte-for-byte identical to `173-PROOF.md`'s, `176-PROOF.md`'s, and
`177-PROOF.md`'s own captures.

### Copies — real `cp -R`, all subsequent work runs against copies only

```
$ cp -R ~/BoardSmithGames/seven "$SCRATCH/seven"
$ cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/one-two-punch"
```

Every command below this line runs against `$SCRATCH/seven` and `$SCRATCH/one-two-punch`. The
originals are never written to for the remainder of this plan — re-verified byte-identical in §4.

### Real install (never a symlink assumption)

```
$ cd "$SCRATCH/seven" && npx boardsmith claude --local --force
Linking BoardSmith globally...
✓ BoardSmith linked globally
✓ Installed BoardSmith skills for Claude Code
  Location: .../177-12-proof/seven/.claude/skills
  ...
$ cd "$SCRATCH/one-two-punch" && npx boardsmith claude --local --force
✓ Installed BoardSmith skills for Claude Code
  Location: .../177-12-proof/one-two-punch/.claude/skills
```

Asserted by a direct filesystem check on the installed paths, not console-output trust:

```
$ find "$SCRATCH/seven/.claude/skills" -iname "*derive*"
.../seven/.claude/skills/bs-shared/verify/derive-compare.md
.../seven/.claude/skills/bs-shared/verify/derive-recheck.md
$ find "$SCRATCH/one-two-punch/.claude/skills" -iname "*derive*"
.../one-two-punch/.claude/skills/bs-shared/verify/derive-compare.md
.../one-two-punch/.claude/skills/bs-shared/verify/derive-recheck.md
```

Both installed contract files reflect the 177-11-rewritten text (opaque `Target: {handle}`,
Focus-passage/Context sections, `factAlignment` in the RETURN schema) — confirmed by grep during
dispatch construction (§3) since the driver reads these installed files verbatim, not the repo
source, for the `Read in full:` instruction each dispatch prompt carries.

### Dispatch mechanism — stated honestly, in advance of any result

**This execution session's available tools are Read/Write/Edit/Bash only — no internal Task/Agent
tool is exposed**, matching every prior proof's own session constraint
(`173-PROOF.md` §§2–5, `176-PROOF.md` §1, `177-PROOF.md` §1). Every dispatch in §§2–3 below is a
real `claude -p "<prompt>" --allowedTools Read` OS subprocess, run via Node's `child_process.spawnSync`
from a driver script (`driver/dispatch.ts`, `npx tsx`), each a genuine fresh OS process with no
inherited conversation history. This is **NOT** native Task/Agent-tool dispatch and is not
represented as such anywhere in this document. `173-PROOF.md` §6 remains the only session in this
milestone that ever exercised native dispatch, for one transcription unit only.

The driver imports `readLiveSlices`/`enumerateDerivedLines`/`derivePayloadSet`/`blindDeriveHandle`
directly from `src/cli/commands/verify-derive-recheck.ts` (the shipped module — never a
reimplementation) to build every dispatch prompt. It imports **nothing** from that module for
RECORDING a verdict — every recorded verdict is written by spawning `node dist/cli.js
verify-derive-record ...` as a real child process (the built CLI, the identical binary
`--help`/`--json` were proved against in `177-10`), never by calling `createDeriveVerdictRecord`/
`recordDeriveVerdict` from the driver's own process. `grep -c 'createDeriveVerdictRecord'
177-PROOF-2.md` (this file) returns 0 for the recording path — the only place that string appears in
this document is descriptive prose, never a driver call site.

### Enumeration — real command output, per game

```
$ node dist/cli.js verify-derive-recheck --project "$SCRATCH/seven" --json
{
  "enumeratedCount": 10,
  "presentationExcludedCount": 0,
  "verdictCounts": { "agrees": 0, "disagrees": 0, "underivable": 0, "not-rule-bearing": 0 },
  ...10 findings, all verdict "pending"...
}
$ node dist/cli.js verify-derive-recheck --project "$SCRATCH/one-two-punch" --json
{
  "enumeratedCount": 6,
  "presentationExcludedCount": 6,
  "verdictCounts": { "agrees": 0, "disagrees": 0, "underivable": 0, "not-rule-bearing": 0 },
  ...6 findings, all verdict "pending"...
}
```

`seven` findings: `01-definitions-and-components.md` lines 8, 14, 19, 21, 33;
`01-overview-setup-and-play.md` lines 36, 38, 42; `02-solo-variant.md` lines 11, 17.
`one-two-punch` findings: `01-setup-and-round-structure.md` lines 30, 52;
`02-action-cards-and-resolution.md` lines 49, 82, 89, 95.

### Reconciliation against the 10 / 12 / 22 counts — unchanged from `177-PROOF.md` §1

`seven` enumeratedCount(10) + presentationExcludedCount(0) = **10**. `one-two-punch`
enumeratedCount(6) + presentationExcludedCount(6) = **12**. Grand total **22**, matching
`177-CONTEXT.md`'s Measured Reality and `177-PROOF.md`'s own reconciliation exactly. The 6
mechanically-excluded `one-two-punch` lines (the already-fixed `PRESENTATION_EXCLUSION_MARKERS`
regex, closed before `177-06`) are unaffected by anything plans 177-08..11 changed — leaving the
same **16 real dispatch candidates** (10 `seven` + 6 `one-two-punch`) `177-PROOF.md` measured.

## 2. The grepped blind-independence observable — all 16 real candidates, plus the new own-location grep

**Evidence files (the real, dispatched bytes) saved verbatim at**
`${TMPDIR:-/tmp}/…/scratchpad/177-12-proof/evidence/blind__{game}__{slice}__L{line}.txt`, one per
real candidate, written to disk BEFORE dispatch in every case — the greps below run on those saved
files, not on reconstructions.

### (a) The blind prompt: zero `Derived (p.`/`Visual (p.` matches, across ALL 16 real candidates

```
$ grep -c "Derived (p\." evidence/blind__*.txt | grep -v ":0$"
(no output — every one of 16 files: 0)
$ grep -c "Visual (p\." evidence/blind__*.txt | grep -v ":0$"
(no output — every one of 16 files: 0)
$ ls evidence/blind__*.txt | grep -v response | wc -l
      16
```

Zero leaks across the full real corpus.

### (b) NEW this run: each target's own slice path and own line number, grepped per-file

For each of the 16 real candidates, the corresponding `blind__*.txt` file was grepped for that
candidate's own `slicePath` (e.g. `rulebook/01-definitions-and-components.md`) and its own
`lineNumber` as a standalone token:

```
$ node driver/check-own-coordinate-leak.js   # per-candidate, own path + own line number
slice-path leak check: CLEAN — zero slice paths found in any blind prompt
```

One line-number-token false-positive was investigated and confirmed non-leaking:
`blind__one-two-punch__...L30.txt` contains the digit sequence `30` twice — `Target:
7bea830ac0ac` (the opaque sha256-truncated handle, `830` is a coincidental hex substring
unrelated to the target's own line number) and `"30 MINUTES"` (legitimate quoted rulebook content
— the box's stated play time). Neither occurrence is the target's own line number appearing as a
resolvable coordinate; both are read in context above. Every other candidate's own slice path and
own line number: zero matches.

### (c) The comparison prompt: exactly 1 `Derived (p.` match per file, the carve-out, across all 12 real comparison dispatches

```
$ grep -c "Derived (p\." evidence/compare__*.txt | grep -v response
...(12 files, each returns 1)...
```

All 12 comparison prompts (one per non-terminal blind result — see §3's dispatch-count reconciliation)
carry exactly one match: the `Original Derived line (verbatim):` block `derive-compare.md`'s
contract requires as one of its two inputs, the identical Context-Economics carve-out
`177-PROOF.md` §2 documented for `quotedPass1`/`quotedPass2`.

## 3. The full 22-line corpus run and the measured distribution

**Dispatch count and skip rule, stated before the results:** all 16 real dispatch candidates
received a `BS-DERIVE-V1` blind dispatch. A `BS-DERIVE-COMPARE-V1` comparison dispatch followed for
every line whose blind stage returned an actual derived value — i.e. every line EXCEPT the ones the
blind stage itself resolved as `not-rule-bearing` or `underivable`, per `derive-compare.md`'s own
pass-through rule. **4 of the 16 blind dispatches resolved without a comparison dispatch**
(`seven:33` → `underivable`, `seven:42` → `underivable`, `one-two-punch:89` → `not-rule-bearing`,
`one-two-punch:95` → `underivable`); the other 12 proceeded to a comparison dispatch. **Total real
`claude -p` dispatches: 16 blind + 12 compare = 28.**

### Real `verify-derive-recheck --json` per-verdict counts, zeros explicit

```
$ node dist/cli.js verify-derive-recheck --project <scratch>/seven --json
  verdictCounts: { "agrees": 2, "disagrees": 6, "underivable": 2, "not-rule-bearing": 0 }
  offTargetDisagreements: 6   genuineDisagreements: 0   targetingAmbiguousCount: 4
  staleRecords: []   orphanedRecords: []
  (sum 2+6+2+0=10, matches seven's enumeratedCount)

$ node dist/cli.js verify-derive-recheck --project <scratch>/one-two-punch --json
  verdictCounts: { "agrees": 2, "disagrees": 2, "underivable": 1, "not-rule-bearing": 1 }
  offTargetDisagreements: 2   genuineDisagreements: 0   targetingAmbiguousCount: 0
  staleRecords: []   orphanedRecords: []
  (sum 2+2+1+1=6, matches one-two-punch's enumeratedCount)
```

Both games report **zero `pending`** findings — the CLI write path recorded every one of the 16
real dispatch outcomes, satisfying this task's automated verification.

**Combined, all 16 real dispatch candidates:**

| Verdict | Count | % of 16 |
|---|---|---|
| `agrees` | 4 | 25% |
| `disagrees` | 8 | 50% |
| `underivable` | 3 | 19% |
| `not-rule-bearing` | 1 | 6% |
| **Total** | **16** | **100%** |

**The `disagrees` split by `factAlignment` — the number this whole plan exists to measure:**

| Split | Count | % of `disagrees` (8) |
|---|---|---|
| `offTargetDisagreements` (`different-fact`) | 8 | **100%** |
| `genuineDisagreements` (`same-fact`) | 0 | 0% |

**Every recorded `disagrees` verdict this run carries `factAlignment: different-fact`. Zero genuine
disagreements were found anywhere in the 16-candidate corpus.**

### Per-line results, every verdict with its `rederivedValue`/`factAlignment`

| Location | Verdict | `factAlignment` | Blind `rederivedValue` (truncated) |
|---|---|---|---|
| `seven:01-definitions-and-components.md:8` | `disagrees` | different-fact | "A player's hand is the cards they hold: each player starts... 3... ends... 10..." |
| `seven:01-definitions-and-components.md:14` | `disagrees` | different-fact | "A Run is a group of 3 or more cards in numeric order — e.g. 5, 6, 7." |
| `seven:01-definitions-and-components.md:19` | `agrees` | same-fact | "The deck contains numbers 1-7 in 4 colors with 4 copies of each... 112 numbered cards, plus 7 bonus..." |
| `seven:01-definitions-and-components.md:21` | `agrees` | same-fact | "The deck contains numbered cards in 7 number values (1-7) x 4 colors x 4 copies each = 112..." |
| `seven:01-definitions-and-components.md:33` | `underivable` | (n/a) | `underivable` |
| `seven:01-overview-setup-and-play.md:36` | `disagrees` | different-fact | "Match length is variable: the default/natural full match... best-of-7 series, but players may..." |
| `seven:01-overview-setup-and-play.md:38` | `disagrees` | different-fact | "Match length is a variant: the default/natural match is best of 7 games, but players may..." |
| `seven:01-overview-setup-and-play.md:42` | `underivable` | (n/a) | `underivable` |
| `seven:02-solo-variant.md:11` | `disagrees` | different-fact | "A solo match consists of 7 games: the third-tier solo challenge asks for a final score..." |
| `seven:02-solo-variant.md:17` | `disagrees` | different-fact | "The solo (single-player) variant is played by exactly the same rules as the regular game..." |
| `one-two-punch:01-setup-and-round-structure.md:30` | `agrees` | same-fact | "The game's contents are 2 Boxer Cards, 16 Action Cards, 6 Guard Cards, and 1 Rules Sheet..." |
| `one-two-punch:01-setup-and-round-structure.md:52` | `disagrees` | different-fact | "In the blue player's opening discard, the card blue discards from their own hand and the card..." |
| `one-two-punch:02-action-cards-and-resolution.md:49` | `disagrees` | different-fact | "In the fight phase, after the first pair of action cards has been compared and resolved..." |
| `one-two-punch:02-action-cards-and-resolution.md:82` | `agrees` | same-fact | "Within a round, action cards are resolved strictly by set rather than by timing number..." |
| `one-two-punch:02-action-cards-and-resolution.md:89` | `not-rule-bearing` | (n/a) | `not-rule-bearing` |
| `one-two-punch:02-action-cards-and-resolution.md:95` | `underivable` | (n/a) | `underivable` |

### `targetingAmbiguousCount` — the mechanically-computed residual, 4 of 16 (25%)

Named individually (all in `seven`, none in `one-two-punch`, matching the Task 1 dry-run's own
zero-dispatch prediction exactly — this is the one metric that WAS fully mechanical and correctly
predicted in advance):

- `seven:19` / `seven:21` — share the `p.1, Distribution of Cards:` focus passage. **Benign
  collision**: both measured `agrees`/`same-fact` — the shared passage genuinely supports both
  facts (the diagram description and the arithmetic over the same numbers).
- `seven:36` / `seven:38` — share the `p.1, Match Length:` focus passage. **Genuine residual, and
  it produced real damage**: both measured `disagrees`/`different-fact` — the blind stage derived
  Match-Length content for BOTH targets (round-structure math for 36, which is itself wrong since
  36 is actually about round math, not match length — and simultaneity for 38, also wrong), because
  the citation-header upward walk located the nearest header (`Match Length`) rather than the
  section both lines actually live under (`Round (Simultaneous)`, one section later with no
  intervening heading to sever the walk from the earlier header).

### Predicted vs. measured — per metric, against `177-TARGETING-PREDICTION.md` (commit `f0b6a038`)

```
$ git log --format=%H -1 -- .planning/phases/177-derived-line-re-derivation/177-TARGETING-PREDICTION.md
f0b6a038...
```

`f0b6a038` predates every dispatch in this document — no `claude -p` invocation, evidence file, or
ledger record for this plan exists anywhere in this repository's history before it.

| Metric | Predicted | Measured | Hit/Miss |
|---|---|---|---|
| `targetingAmbiguousCount` | 4/16 | 4/16 | **HIT** (exact — this was the one fully mechanical, zero-dispatch metric) |
| `agrees` | 6 | 4 | MISS |
| `not-rule-bearing` | 5 | 1 | MISS |
| `underivable` | 3 | 3 | HIT (count only — see per-line table for which lines) |
| `disagrees` | 2 | 8 | **MISS — 4x the predicted count** |
| `offTargetDisagreements` | 1 | 8 | **MISS — 8x the predicted count** |
| `genuineDisagreements` | 0 | 0 | HIT |
| Phase-goal unit (genuine-disagreement rate) | 0/16 (0%) | 0/16 (0%) | HIT (but see below — the 0% is not a success signal here) |

**The `genuineDisagreements: 0` prediction landed correctly, but for the wrong reason to call a
win.** The prediction reasoned this would be near-zero because narrowing would let the blind stage
converge correctly, collapsing the OLD artifact-dominated `disagrees` count down to a small residual
that is mostly genuine. What actually happened is that the raw `disagrees` count barely moved (8 vs.
`177-PROOF.md`'s 9) while its composition got WORSE, not better — `genuineDisagreements` is zero not
because targeting collisions were resolved, but because **every** `disagrees` this run, including
ones on lines with a UNIQUE, non-ambiguous focus passage (`targetingAmbiguous: false` — 6 of the 8
`disagrees` verdicts, e.g. `seven:8`, `seven:14`, `seven:11`, `seven:17`, `one-two-punch:52`,
`one-two-punch:49`), still landed `different-fact`. `targetingAmbiguousCount` (the mechanical
residual `derivePayloadSet` computes) and `offTargetDisagreements` (the measured factAlignment
split) are NOT the same population — this run makes that distinction concrete: only 2 of the 8
`different-fact` disagreements (`seven:36`, `seven:38`) are also `targetingAmbiguous`. The other 6
disagree off-target despite having a mechanically UNIQUE focus passage, meaning **the blind
subagent itself is choosing to derive something other than the fact the (correctly, uniquely
narrowed) focus passage supports**, on the majority of these lines — a failure mode
`focusQuoteWindow`'s mechanical narrowing cannot fix by construction, because the payload IS
correctly narrowed; the subagent's own derivation still wanders off-topic within it.

### Interpretation rule applied — rule (b) FIRES, named exactly as committed in advance

`177-TARGETING-PREDICTION.md`'s interpretation rule (b): *"if the measured `offTargetDisagreements`
count remains large (more than half of all `disagrees` verdicts, mirroring `177-PROOF.md`'s own
8-of-9 ratio)... THE FIX DID NOT WORK, and this document commits, in advance, to reporting that in
those exact words."*

**Measured: `offTargetDisagreements` is 8 of 8 `disagrees` verdicts — 100%, exceeding the 8-of-9
(89%) ratio `177-PROOF.md` itself measured before this fix existed. Per the pre-committed rule: THE
FIX DID NOT WORK.**

The raw `disagrees` rate (50%, 8/16) is only marginally lower than `177-PROOF.md`'s raw rate (56%,
9/16) — not the "collapse" both `177-PROOF.md` §3's own hypothesis and this plan's prediction
expected. Interpretation rule (e) — a named, in-advance prediction that `focusQuoteWindow` would
still mistarget at least once (`one-two-punch:49`) — is confirmed: `one-two-punch:49`'s focus
window (`p.2, Fight phase continuation (under Rest):`) is genuinely unrelated to its own target
line's topic (Action Card icon glyphs), exactly as predicted, and it landed `disagrees`/
`different-fact` exactly as predicted. But this single named case is a small fraction of the actual
8 off-target disagreements — 5 of the other 7 (`seven:8`, `seven:14`, `seven:11`, `seven:17`,
`one-two-punch:52`) have focus windows that ARE topically relevant to their own target line (see §
"Why the mechanical fix did not translate into a behavioral fix" below) and still landed off-target,
which the prediction did not anticipate at all.

### Why the mechanical fix did not translate into a behavioral fix — a real finding, not asserted

Reading the actual focus passages `focusQuoteWindow` computed (from the Task 1 dry-run, unchanged
by dispatch) against what the blind subagent actually derived:

- **`seven:8`** (Set-example illustration) — focus correctly includes both the Hand definition AND
  the Set definition/example (`"Set: 2+ cards with matching numbers." "example: 5, 5, 5"`), the
  passage the line is actually about. The blind subagent nonetheless derived a HAND-size reading
  (3→10 cards) from that same passage, ignoring the Set content sitting right next to it.
- **`seven:14`** (Run-example illustration) — focus correctly narrows to the Run definition/example
  only. The blind subagent derived a restated Run DEFINITION (correct topic) but the target line is
  about the illustration's specific card VALUES (1,2,3 vs. the printed 5,6,7 text mismatch) —
  `different-fact` here is arguably a closer call than the others, since the topic is right but the
  specific claim under test (the image/text discrepancy) has no directly-quoted support at all,
  which is closer to `underivable` territory than `disagrees`; this is disclosed rather than
  silently accepted as a clean off-target case.
- **`seven:36`/`38`** — the ONE case this run's `targetingAmbiguous` mechanism correctly flagged in
  advance as unresolved (see above) — the collapse IS explained by mistargeting.
- **`seven:11`/`17`, `one-two-punch:49`/`52`** — focus windows are unique
  (`targetingAmbiguous: false`) but topically imperfect or narrow in ways that still produced an
  off-target derivation; `one-two-punch:49` is the one this plan's own prediction named in advance.

**The honest conclusion: `focusQuoteWindow`'s mechanical narrowing measurably worked exactly as
designed at the payload-construction layer** (§2's greps confirm zero coordinate leaks;
`targetingAmbiguousCount`'s prediction landed exactly on the mechanically-determined number) **— but
narrowing the payload's TOPIC did not reliably narrow the blind subagent's own DERIVATION to that
topic.** A correctly-scoped focus passage is necessary but not sufficient for the blind stage to
actually derive the fact the passage supports rather than some other fact nearby in the same
passage. This is a genuinely different defect than the one 177-11 closed (CR-07's resolvable
pointer, and the old un-narrowed same-dominant-fact-every-time collapse `177-PROOF.md` §3 measured)
— it is a NEW finding this re-proof surfaces, not previously measured because the old un-narrowed
payload's collapse was so total it masked this subtler failure mode underneath it.

### `one-two-punch:89`/`one-two-punch:95` — the two non-`disagrees` terminal outcomes, both stages shown

```
one-two-punch:89 (icon/edition detail)
  Blind stage returned: { rederivedValue: "not-rule-bearing", sourceQuotes: [] }
  No comparison dispatch, per the pass-through rule.

one-two-punch:95 (no Variants section)
  Blind stage returned: { rederivedValue: "underivable", sourceQuotes: [] }
  No comparison dispatch, per the pass-through rule.
```

Both are structurally correct pass-throughs (`verdictCounts` records each verdict directly from the
blind stage's own return, matching `derive-compare.md`'s never-re-adjudicate rule) — the label
(`not-rule-bearing` vs. `underivable`) diverges from `177-TARGETING-PREDICTION.md`'s own guess for
each (`underivable` predicted for 89, `not-rule-bearing`/`agrees` predicted for 95, doubly, per the
disclosed prediction-file duplicate below), which is a genuine miss, not a defect in the pipeline.

### A disclosed defect in `177-TARGETING-PREDICTION.md` itself, found during this reconciliation

Reconstructing the full 16-line predicted-vs-measured table surfaced a real internal inconsistency
in the ALREADY-COMMITTED, IMMUTABLE prediction file — reported here rather than silently smoothed
over or corrected in place (the file is not edited by this plan):

- **`one-two-punch:95` is named in BOTH the `agrees` bucket's reasoning text (as "the harder call")
  AND the `not-rule-bearing` bucket's reasoning text**, with both buckets' stated counts (6 and 5
  respectively) counting it once each — meaning the file predicts two different, contradictory
  verdicts for the same line without resolving the contradiction.
- **`seven:11` (02-solo-variant.md) and `seven:42` (01-overview-setup-and-play.md) are never named
  in ANY per-line reasoning bucket**, despite being 2 of the 16 real dispatch candidates and despite
  their mechanical focus-window data (both empty, matching the pattern of `seven:33`/`17`, which
  WERE correctly predicted `not-rule-bearing`) being available in the Task 1 dry-run BEFORE the
  prediction file was written.
- The bucket-level counts (6 `agrees` + 5 `not-rule-bearing` + 3 `underivable` + 2 `disagrees` = 16)
  summed correctly by coincidence — the double-count of `one-two-punch:95` in two buckets happened
  to offset the complete omission of `seven:11` and `seven:42` from every bucket's named reasoning.

This is a real authoring defect in the prediction, not a measurement artifact. Per-line HIT/MISS for
these three locations is reported as **UNDETERMINED (prediction-file gap/duplicate)** rather than
resolved in whichever direction is convenient:

| Location | Predicted (as literally written) | Measured | Hit/Miss |
|---|---|---|---|
| `seven:02-solo-variant.md:11` | Not individually named in any bucket (gap) | `disagrees`/different-fact | UNDETERMINED (prediction gap) |
| `seven:01-overview-setup-and-play.md:42` | Not individually named in any bucket (gap) | `underivable` | UNDETERMINED (prediction gap) |
| `one-two-punch:02-action-cards-and-resolution.md:95` | Named in both `agrees` AND `not-rule-bearing` (contradiction) | `underivable` | MISS under either named reading |

### Reporting only — no repair performed

Both reference games' `rulebook/*.md` slice content is unchanged by this task (confirmed
byte-identical in §4). No disagreement or underivable finding above was fixed in either game —
findings are recorded to the ledger and reported here, exactly per the plan's scope boundary (the
Phases 172/176 read-only boundary).

## 4. Closure, limitations, and originals re-verification

### Both originals: whole-tree sha256 diff, empty

```
$ cd ~/BoardSmithGames/seven && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-seven.after
$ diff manifest-seven.before manifest-seven.after
(empty diff)
$ cd ~/BoardSmithGames/one-two-punch && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-otp.after
$ diff manifest-otp.before manifest-otp.after
(empty diff)
```

Both originals confirmed byte-identical, whole-tree, before and after all 28 real `claude -p`
dispatches and all 16 real `verify-derive-record` CLI writes this plan ran.

### Both originals: still at their pinned commits

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```

Both match the pinned commits `177-CONTEXT.md` names exactly.

### What is still unproven

- **Zero real `Visual (p.` lines exist in either corpus, so `Visual`-ignoring remains proven only
  on constructed input, not live dispatch data.** Re-confirmed directly this task:
  `grep -c "^Visual (p\." rulebook/*.md` returns 0 for every file in both games — matching
  `177-PROOF.md` §4's own disclosure of the identical limitation, unchanged by anything plans
  177-08..11 touched.
- **The blind dispatch's file-read tools are not sandboxed by this harness.** `--allowedTools Read`
  restricts the TOOLS available but does not prevent the subagent from choosing to read the live
  `rulebook/*.md` files directly if it decided to — CR-07's closure (the opaque handle carrying no
  resolvable coordinate) removes the OBVIOUS path to the withheld line, but independence remains
  prompt-enforced at the tool layer, not sandboxed at the filesystem layer. This is 177-11-PLAN.md's
  own accepted threat T-177-11-05, explicitly disclosed there and restated here rather than quietly
  dropped now that a live run has happened. No evidence in any of the 16 blind evidence files
  suggests a subagent attempted to read a live slice (every derived value is explainable from the
  quote lines actually supplied), but this harness does not and cannot prove the negative.
- **Residual `targetingAmbiguous` candidates**: 4 of 16 (25%), all in `seven`
  (`seven:19`/`seven:21` benign, `seven:36`/`seven:38` genuinely unresolved and measurably harmful —
  see §3). This is the honestly-reported mechanical residual `derivePayloadSet` exists to surface,
  not to hide, and it remains real after this run.
- **WR-07 (inverting `quoteLinesOnly`'s deny-list to an allow-list) remains deliberately deferred**,
  per `177-08-PLAN.md`'s own explicit instruction — not implemented in any of plans 177-08..12, and
  not exercised or newly evidenced by this proof run either way.
- **The NEW, larger finding this proof surfaces and 177-13 inherits**: a correctly and uniquely
  narrowed focus passage (`targetingAmbiguous: false`) does not reliably cause the blind subagent to
  derive the fact that passage actually supports — 6 of this run's 8 `different-fact` disagreements
  occurred on lines with a UNIQUE focus window, meaning the payload-construction-layer fix
  (`focusQuoteWindow`) is necessary but not sufficient, and the remaining gap is in the blind
  subagent's own judgment given a correctly-scoped prompt, not in anything `verify-derive-recheck.ts`
  computes. No code in this plan's file scope (proof/bookkeeping only) attempts to close this — it
  is reported to `177-13`, the same "report to the owner, don't silently absorb" discipline
  `177-PROOF.md` §4 already established for its own headline finding.

### Cross-reference

`177-08-SUMMARY.md` through `177-11-SUMMARY.md` record the four gap-closure fixes this proof
measures the real effect of. `177-SWEEP.md` (177-05) remains the separate prose-level audit of
`verify-game.md`'s skill text, unaffected by anything measured here.

### How to re-run every proof in this document

```bash
# §1 — setup, sha256 baselines, install, enumeration
git -C ~/BoardSmithGames/seven rev-parse HEAD && git -C ~/BoardSmithGames/seven status --porcelain
git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD && git -C ~/BoardSmithGames/one-two-punch status --porcelain
cd ~/BoardSmithGames/seven && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-seven.before
cd ~/BoardSmithGames/one-two-punch && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-otp.before
cp -R ~/BoardSmithGames/seven "$SCRATCH/seven"
cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/one-two-punch"
cd "$SCRATCH/seven" && npx boardsmith claude --local --force
cd "$SCRATCH/one-two-punch" && npx boardsmith claude --local --force
npm run build:cli   # rebuild dist/cli.js from current source before dispatching
node /path/to/BoardSmith/dist/cli.js verify-derive-recheck --project "$SCRATCH/seven" --json
node /path/to/BoardSmith/dist/cli.js verify-derive-recheck --project "$SCRATCH/one-two-punch" --json

# §2/§3 — real dispatch driver (imports readLiveSlices/enumerateDerivedLines/derivePayloadSet/
# blindDeriveHandle directly from verify-derive-recheck.ts to build every payload; dispatches every
# candidate blind via `claude -p ... --allowedTools Read`, then every non-terminal blind result
# through a compare dispatch; records EVERY verdict by spawning the real built CLI —
# `node dist/cli.js verify-derive-record --project ... --slice-path ... --line-number ...
# --original-line ... --verdict ... --reasoning ... --rederived-value ... [--original-reading ...
# --rederived-reading ... --fact-alignment ... --source-quote ...] --json` — never by importing
# createDeriveVerdictRecord/recordDeriveVerdict into the driver's own process)
cd "$SCRATCH" && npx tsx driver/dispatch.ts

# Independence greps
grep -c "Derived (p\." evidence/blind__*.txt | grep -v ":0$"    # expect no output
grep -c "Visual (p\." evidence/blind__*.txt | grep -v ":0$"     # expect no output
grep -c "Derived (p\." evidence/compare__*.txt                  # expect 1 per file

# §4 — re-verify originals byte-identical
cd ~/BoardSmithGames/seven && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-seven.after
diff manifest-seven.before manifest-seven.after
cd ~/BoardSmithGames/one-two-punch && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-otp.after
diff manifest-otp.before manifest-otp.after

# Full suite
npm test
```
