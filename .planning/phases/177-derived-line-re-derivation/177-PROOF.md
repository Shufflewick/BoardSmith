# Phase 177 Plan 06 — Proof

## 1. Setup, fixture provenance, sha256 baselines, real install, dispatch mechanism, enumeration

**Scratch location** (all work below, never against `~/BoardSmithGames/*` directly):
`${TMPDIR:-/tmp}/…/scratchpad/177-06-proof/` — `seven/` and `one-two-punch/` are `cp -R` copies.

**No dispatch is performed in this task.** Per plan 177-06's Task 2 instruction ("Do not dispatch
anything in this task. §1 is setup and enumeration only."), this section covers preflight, copies,
real skill install, the real (non-dispatch) enumeration command, and a statement of the dispatch
mechanism that will be used when real re-derivation dispatches happen — it does not itself run any
`claude -p` subprocess or Task/Agent dispatch.

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

Both hashes match the pinned commits in `177-CONTEXT.md` and `177-RESEARCH.md` exactly.
`one-two-punch`'s two deletions are the **pre-existing, previously-documented Phase 173 exception**
(`173-PROOF.md`, carried forward unchanged in `176-PROOF.md` §1 and `176-VERIFICATION.md`'s
Independent Verifier Checks section) — not new, not this phase's concern, and `one-two-punch` is
deliberately NOT asserted porcelain-empty for this reason, per that same read-only invariant's
documented exception.

Whole-tree sha256 manifests captured BEFORE any copy:

```
$ cd ~/BoardSmithGames/seven && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-seven.before
$ wc -l manifest-seven.before
3919 manifest-seven.before
$ cd ~/BoardSmithGames/one-two-punch && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-otp.before
$ wc -l manifest-otp.before
4134 manifest-otp.before
```

Both file counts (3919 / 4134) are byte-for-byte identical to `173-PROOF.md`'s and `176-PROOF.md`'s
own captures — confirming no drift occurred between phases.

### Copies — real `cp -R`, all subsequent work runs against copies only

```
$ cp -R ~/BoardSmithGames/seven      "$SCRATCH/seven"
$ cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/one-two-punch"
```

Every command below this line runs against `$SCRATCH/seven` and `$SCRATCH/one-two-punch`. The
originals at `~/BoardSmithGames/*` are never written to for the remainder of this task — re-verified
byte-identical at the end of this section.

### Real install (never a symlink assumption)

```
$ cd "$SCRATCH/seven" && npx boardsmith claude --local --force
Linking BoardSmith globally...
✓ BoardSmith linked globally
✓ Installed BoardSmith skills for Claude Code
  Location: .../177-06-proof/seven/.claude/skills
  ...
  bs-verify-game   - Re-verify an existing game against its archived rulebook source
Note: Installed locally to this project.

$ cd "$SCRATCH/one-two-punch" && npx boardsmith claude --local --force
Linking BoardSmith globally...
✓ BoardSmith linked globally
✓ Installed BoardSmith skills for Claude Code
  Location: .../177-06-proof/one-two-punch/.claude/skills
  ...
  bs-verify-game   - Re-verify an existing game against its archived rulebook source
Note: Installed locally to this project.
```

Asserted by a **direct filesystem check on the installed paths**, not by trusting the installer's
console output:

```
$ find "$SCRATCH/seven/.claude/skills" -iname "*derive*"
.../seven/.claude/skills/bs-shared/verify/derive-compare.md
.../seven/.claude/skills/bs-shared/verify/derive-recheck.md
$ find "$SCRATCH/one-two-punch/.claude/skills" -iname "*derive*"
.../one-two-punch/.claude/skills/bs-shared/verify/derive-compare.md
.../one-two-punch/.claude/skills/bs-shared/verify/derive-recheck.md

$ for g in seven one-two-punch; do
    for f in derive-recheck.md derive-compare.md; do
      [ -f "$SCRATCH/$g/.claude/skills/bs-shared/verify/$f" ] && echo "FOUND: $g/$f" || echo "MISSING: $g/$f"
    done
  done
FOUND: seven/derive-recheck.md
FOUND: seven/derive-compare.md
FOUND: one-two-punch/derive-recheck.md
FOUND: one-two-punch/derive-compare.md
```

Both new contract files (`BS-DERIVE-V1`'s `derive-recheck.md` and `BS-DERIVE-COMPARE-V1`'s
`derive-compare.md`, both committed in `177-04`) exist at the installed path in both copies.

### Dispatch mechanism — stated honestly, in advance

**This execution session's available tools are Read/Write/Edit/Bash only — no internal Task/Agent
tool is exposed**, exactly the constraint `173-PROOF.md` §§2–5 and `176-PROOF.md` §1 recorded for
their own sessions. Per that precedent, and per `173-PROOF.md` §6 (which closed the native-dispatch
gap in a *separate* session that DID have the Agent tool, for a single VERIFY-07 transcription unit
only, and did not re-prove full multi-unit fan-out under native dispatch), any real re-derivation or
comparison dispatch performed for this phase will use a real `claude -p` OS subprocess — `claude -p
"<prompt>" --allowedTools Read`, run from inside the scratch copy's own directory, each one a genuine
fresh OS process with no inherited conversation history. This is **not** native Task/Agent-tool
dispatch, and is not represented as such anywhere in this proof. `173-PROOF.md` §6 remains the only
session in this milestone that ever exercised native dispatch, and only for one transcription unit —
this phase's dispatches (deferred to a later plan; none run in this task) inherit the same unresolved
`176-CONTEXT.md` caveat.

### Enumeration — real command output, per game

```
$ boardsmith verify-derive-recheck --project "$SCRATCH/seven" --json
{
  "project": ".../177-06-proof/seven",
  "enumeratedCount": 10,
  "presentationExcludedCount": 0,
  "verdictCounts": { "agrees": 0, "disagrees": 0, "underivable": 0, "not-rule-bearing": 0 },
  "findings": [ ...10 entries, verdict "pending", reasoning "" for lines 8,14,19,21,33
    (01-definitions-and-components.md), 36,38,42 (01-overview-setup-and-play.md), 11,17
    (02-solo-variant.md) ]
}

$ boardsmith verify-derive-recheck --project "$SCRATCH/one-two-punch" --json
{
  "project": ".../177-06-proof/one-two-punch",
  "enumeratedCount": 6,
  "presentationExcludedCount": 6,
  "verdictCounts": { "agrees": 0, "disagrees": 0, "underivable": 0, "not-rule-bearing": 0 },
  "findings": [ ...6 entries, verdict "pending", reasoning "" for lines 30, 52
    (01-setup-and-round-structure.md), 49, 82, 89, 95 (02-action-cards-and-resolution.md) ]
}
```

No verdict, dispatch prompt, or distribution appears anywhere in this section — every returned
`verdict` field is the literal string `"pending"` with empty `reasoning`, confirming the CLI's own
enumeration step performs no judgment at all.

### Reconciliation against the 10 / 12 / 22 counts — real numbers, not adjusted silently

**Totals match exactly:** `seven` enumeratedCount(10) + presentationExcludedCount(0) = **10**;
`one-two-punch` enumeratedCount(6) + presentationExcludedCount(6) = **12**. Grand total **22**,
matching `177-CONTEXT.md`'s Measured Reality and `177-06-PREDICTION.md`'s 22-line enumeration exactly.

**The presentation-excluded SPLIT does not match what `177-RESEARCH.md` measured, and this is
reported honestly rather than silently absorbed.** `177-RESEARCH.md` (researched before this phase's
own Wave 1/2 code changes landed) measured `PRESENTATION_EXCLUSION_MARKERS`' regex as REQUIRING the
colon immediately after `description`/`art` with no parenthetical qualifier tolerated — meaning at
research time, only `one-two-punch`'s 2 UNQUALIFIED lines (the bare `— diagram description:` setup
diagram at line 56, and the bare `— art:` illustration at line 91) would have matched, leaving the 4
QUALIFIED lines (`(Plan phase)`, `(Fight phase)`, `(first Punch example)`, `(second Punch example)`)
to reach a subagent as raw candidates.

**That gap has already been closed.** A direct read of the current `PRESENTATION_EXCLUSION_MARKERS`
(`src/cli/commands/verify-classify.ts:93-97`) shows the diagram-description and art patterns now
carry an optional non-capturing parenthetical group —
`^Derived \(p\.\d+\) — diagram description(?: \([^)]+\))?:` and
`^Derived \(p\.\d+\) — art(?: \([^)]+\))?:` — committed in `06a4fe44`/`8a8f86ad` (this phase's own
Wave 1/2, per `177-CONTEXT.md` decision 13, "FIX `PRESENTATION_EXCLUSION_MARKERS`' regex gap in this
phase"). The real enumeration above reflects the ALREADY-FIXED constant: all 6 of `one-two-punch`'s
dash-qualified `Derived` lines (56, 68, 79 in `01-setup-and-round-structure.md`; 56, 61, 91 in
`02-action-cards-and-resolution.md`) are now mechanically excluded, not just the 2 unqualified ones.
`seven` is unaffected either way — it has zero dash-qualified lines (all 10 are bare
`Derived (p.N):`), so its `presentationExcludedCount` of 0 matches both the old and the fixed
constant identically.

**Consequence for `177-06-PREDICTION.md`, stated here rather than edited into that already-committed
file:** that prediction's per-line reasoning for lines 56/68/79 (`01-setup-and-round-structure.md`)
and 56/61/91 (`02-action-cards-and-resolution.md`) was written against the state
`177-RESEARCH.md` described (the unfixed regex), predicting `agrees` for the two qualified diagram
lines that "reach the subagent past the marker gap" (lines 68, 79, 56-punch-example, 61-punch-example).
The real, already-fixed mechanical filter now excludes all six of those lines before any dispatch — so
in the real pipeline none of them will ever receive an `agrees`/`disagrees`/`underivable` verdict from
a subagent at all; they fall into the same "mechanically excluded, no judgment performed" bucket as
the two lines (56, 91) the prediction already correctly identified as excluded. This does not change
the prediction's 22-line TOTAL (still 22, still matching this section's real enumeration), and it does
not retroactively edit the committed prediction file — it is recorded here, honestly, as a real
finding this proof surfaced: 6 of `one-two-punch`'s 12 lines are mechanically excluded before dispatch
(not 2), leaving only **16 of the 22 lines** (10 `seven` + 6 `one-two-punch`) as real dispatch
candidates once re-derivation runs. The prediction's per-line `agrees` calls for the 4 newly-excluded
lines are moot, not wrong in a way that changes the aggregate distribution's `underivable` share this
phase most cares about (per Pitfall 2) — none of those 4 lines were predicted `underivable`.

### Both originals: byte-identical after this task

```
$ cd ~/BoardSmithGames/seven && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-seven.after
$ diff manifest-seven.before manifest-seven.after
(empty diff)
$ cd ~/BoardSmithGames/one-two-punch && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-otp.after
$ diff manifest-otp.before manifest-otp.after
(empty diff)
```

Both originals confirmed byte-identical, whole-tree, before and after every command this task ran.

## What is still unproven (as of this task)

- No re-derivation or comparison dispatch has been run — Task 2's scope is setup and enumeration
  only, per the plan. The real `claude -p` dispatches producing actual `agrees`/`disagrees`/
  `underivable`/`not-rule-bearing` verdicts (comparable against `177-PREDICTION.md`'s committed
  per-line predictions) are deferred to a later plan.
- The blind-derivation dispatch prompt's zero-`Derived (p.`-matches independence proof
  (`177-RESEARCH.md` Question 3) is not exercised here — no dispatch prompt was constructed in this
  task.
- The 16-real-candidate figure this section derived (10 `seven` + 6 `one-two-punch`) is a mechanical
  fact about the current `isPresentationLine` filter; it is not itself a claim about how many of
  those 16 will return each verdict once dispatches run.

## 2. The grepped blind-independence observable

**Scratch location for this task's live dispatches:** a fresh `${TMPDIR:-/tmp}/…/scratchpad/177-07-proof/`
— new `cp -R` copies of both originals were made for this task (the prior task's scratch directory
no longer existed; a new preflight, sha256 baseline, `cp -R`, and real `npx boardsmith claude --local
--force` install were re-run identically to `177-06`'s §1 method before any dispatch). Preflight
confirmed both pinned commits unchanged (`seven` `a03f38d4792af9dfc7c798be69686fc3230f54dd`,
`one-two-punch` `7e69471bd8980a854f3e351f2f486e1fb6f712b9`), and both whole-tree sha256 manifests
(3919 / 4134 files) matched `173-PROOF.md`/`176-PROOF.md`/`177-06-PROOF.md`'s own counts exactly
before the first `cp -R`.

**Dispatch mechanism, stated honestly (unchanged from `177-06-PROOF.md` §1):** this execution
session exposes Read/Write/Edit/Bash only — no native Task/Agent tool. Every dispatch below is a
real `claude -p "<prompt>" --allowedTools Read` OS subprocess, run from inside the scratch copy's own
project directory, each a genuine fresh OS process with no inherited conversation history. This is
NOT native Task/Agent-tool dispatch and is not represented as such anywhere in this proof —
`173-PROOF.md` §6 remains the only session in this milestone that ever exercised native dispatch, for
one transcription unit only.

**The dispatched prompt, per line, carries THREE things** (mirroring the exact shape `176-PROOF.md`
§1 recorded for `BS-RULING-RECHECK-V1`): an instruction to read the installed contract file in full
(`.claude/skills/bs-shared/verify/derive-recheck.md` for the blind stage,
`.claude/skills/bs-shared/verify/derive-compare.md` for the comparison stage — both real installed
paths, not the repo source, verified present by the `find`/existence check in §1), then the exact
payload string `buildBlindDerivePayload` constructed (blind stage) or the original line +
blind-derivation reading (comparison stage). The dispatch driver script imports
`buildBlindDerivePayload`/`readLiveSlices`/`enumerateDerivedLines`/`createDeriveVerdictRecord`/
`recordDeriveVerdicts` directly from `src/cli/commands/verify-derive-recheck.ts` — never a
reimplementation — so the payload construction under test is the shipped code, not a stand-in.

### The chosen line — the most distinctive real `Derived` line in the corpus

**`seven`, `rulebook/01-definitions-and-components.md:21`:** `Derived (p.1): The full deck is
therefore 7 numbers x 4 colors x 4 copies = 112 numbered cards, plus 7 "+1" bonus point cards.` This
is the single most distinctive line in either corpus — its own text contains an exact arithmetic
statement (`"112 numbered cards"`, `"therefore 7 numbers x 4 colors x 4 copies"`) that would be
unmistakable if it leaked into a supposedly-blind payload, and it is `177-RESEARCH.md`'s own named
Derived-depends-on-Derived worked example, so proving its independence closes that concern directly
for the phase's most-discussed line.

**Evidence file (the real, dispatched bytes) saved verbatim at:**
`${TMPDIR:-/tmp}/…/scratchpad/177-07-proof/evidence/blind__seven__rulebook_01-definitions-and-components.md__L21.txt`

```
Read in full: <scratch>/seven/.claude/skills/bs-shared/verify/derive-recheck.md

Then apply that contract exactly to the following dispatch payload (verbatim, do not add
anything to it before applying the contract):

BS-DERIVE-V1
Slice: rulebook/01-definitions-and-components.md
Target line: rulebook/01-definitions-and-components.md:21
Quoted rulebook content for this slice — your ONLY source material. No Derived or Visual
line from this slice, or any other slice, is included below or anywhere in this prompt:
p.1, Definitions:
"Hand: The cards each player holds. Each starts with 3 and ends the game with 10."
"Set: 2+ cards with matching numbers."
"example: 5, 5, 5"
p.1, Definitions:
"Run: 3+ cards in numeric order."
"example: 5, 6, 7"
p.1, Distribution of Cards:
"There are numbers ranging from 1-7 in 4 colors, with 4 copies of each card. In addition, there are 7 bonus point cards."
p.1, Designer:
"JT Smith"
p.1, Play Testers:
"Patrick Galagan, Brian Hoffman, Bev Smith, Jamie Vrbsky, Ryan McCombs, Adelheid Zimmerman, Chris Vanslambrouck, Scott Starkey, Frank Dillon, Troy Pichelman, Karen Klutzke, Carl Klutzke, Jack Rose Tree, Randy Ekl, Maxine Ekl, Andrew Stiles, Ray Wehrs, Chris Leder, Sarah Bownds, Marylin Vanderhoof"
```

Note the exact `Derived (p.1): The full deck is therefore...` line under test **does not appear
anywhere above** — the only "112"/"7 numbers"/"4 colors" content present is the raw quoted
`p.1, Distribution of Cards:` sentence, which is legitimate directly-quoted source material, not the
target line's own text.

### (a) The blind prompt: two separate zero-expectation greps

**Expectation, stated before running:** the blind-derivation prompt must contain ZERO `Derived (p.`
matches and ZERO `Visual (p.` matches — no exception applies here, unlike the comparison prompt.

```
$ grep -c "Derived (p\." <blind-prompt-file>
0
$ grep -c "Visual (p\." <blind-prompt-file>
0
```

Both zero, exactly as expected.

### (b) The comparison prompt: one non-zero-expectation grep, accounted for by the carve-out

**Expectation, stated before running:** the comparison prompt (`BS-DERIVE-COMPARE-V1`) legitimately
carries the original `Derived (p.` line — `verify-game.md`'s Context-Economics Hard Rule names this
exception explicitly (`src/cli/slash-command/bs/verify-game.md` lines 49-57), and `derive-compare.md`
itself states it (`"this prompt legitimately carries the original Derived (p. line"`) — the identical
exception `174-PROOF.md` §3 documented for `quotedPass1`/`quotedPass2`: the subagent's dispatch input
and structured return are the one legitimate place quoted/derived slice content lives; the
orchestrator's own transcript still never opens a slice.

```
$ grep -c "Derived (p\." <compare-prompt-file>
1
```

Non-zero, exactly as expected, and accounted for: the single match is the `Original Derived line
(verbatim):` block the comparison contract requires as one of its two inputs.

### The two prompt kinds are checked SEPARATELY, and why

The two checks above have opposite expectations by design (decision 5 vs. the Context-Economics
carve-out), so running one blanket grep across both prompt kinds would either falsely flag the
comparison prompt's legitimate quote as a leak, or falsely validate the blind prompt against a
threshold that tolerates the comparison prompt's expected match. `177-RESEARCH.md` Question 3 names
this exact split as the reason the observable cannot be a single check.

### Distinctive-substring grep on the blind prompt (not just the `Derived (p.` prefix)

**Expectation, stated before running:** a leak could in principle arrive without the `Derived (p.`
prefix — e.g. if the target line's own prose were copied into the payload by some other path. Grep
for the target line's own distinctive substrings directly:

```
$ grep -c "112 numbered cards" <blind-prompt-file>
0
$ grep -c "therefore 7 numbers x 4 colors x 4 copies" <blind-prompt-file>
0
```

Both zero. The only "7 x 4 x 4"-shaped content present in the payload is the raw `Distribution of
Cards` quote (`"There are numbers ranging from 1-7 in 4 colors, with 4 copies of each card..."`),
which is legitimate source material the target line's own re-derivation is SUPPOSED to draw on — not
the target line's own text.

### Whole-corpus check (not just the one distinctive line)

Beyond the single chosen line above, every one of the 16 real dispatched blind prompts was grepped
identically:

```
$ grep -c "Derived (p\." evidence/blind__*.txt | grep -v ":0$"
(no output — every one of 16 files: 0)
$ grep -c "Visual (p\." evidence/blind__*.txt | grep -v ":0$"
(no output — every one of 16 files: 0)
$ ls evidence/blind__*.txt | wc -l
16
```

Zero leaks across the full real corpus, not just the one chosen worked example.

## 3. The full 22-line corpus run and the measured distribution

**Dispatch count and skip rule, stated before the results:** all 16 real dispatch candidates (10
`seven` + 6 `one-two-punch`, per §1's reconciliation) received a `BS-DERIVE-V1` blind dispatch. A
`BS-DERIVE-COMPARE-V1` comparison dispatch followed for every line whose blind stage returned an
actual derived value — i.e. every line EXCEPT the ones the blind stage itself resolved as
`not-rule-bearing` or `underivable`, per `derive-compare.md`'s own pass-through rule. **3 of the 16
blind dispatches resolved without a comparison dispatch** (`one-two-punch:49` → `underivable`,
`one-two-punch:82` → `not-rule-bearing`, `one-two-punch:89` → `not-rule-bearing`); the other 13
proceeded to a comparison dispatch. Total real `claude -p` dispatches: **16 blind + 13 compare = 29**
(not ~44 — the prediction's `~44` estimate assumed 22 blind + 22 compare before the 6-line
mechanical-exclusion correction §1 already reconciled).

Full corpus, no sampling — every one of the 22 real `Derived` lines is accounted for below, either as
a mechanically-excluded exclusion (§1) or a dispatched candidate.

### Arithmetic — reconciled against the 22-line total

```
seven:          enumeratedCount 10 + presentationExcludedCount 0  = 10
one-two-punch:  enumeratedCount  6 + presentationExcludedCount 6  = 12
                                                          TOTAL   = 22
```

### Real `verify-derive-recheck --json` per-verdict counts, zeros explicit

```
$ boardsmith verify-derive-recheck --project <scratch>/seven --json
  verdictCounts: { "agrees": 3, "disagrees": 7, "underivable": 0, "not-rule-bearing": 0 }
  (sum 10, matches seven's enumeratedCount)

$ boardsmith verify-derive-recheck --project <scratch>/one-two-punch --json
  verdictCounts: { "agrees": 1, "disagrees": 2, "underivable": 1, "not-rule-bearing": 2 }
  (sum 6, matches one-two-punch's enumeratedCount)
```

**Combined, real-dispatch-only (16 candidates):**

| Verdict | Count | % of 16 |
|---|---|---|
| `agrees` | 4 | 25% |
| `disagrees` | 9 | 56% |
| `underivable` | 1 | 6% |
| `not-rule-bearing` | 2 | 13% |
| **Total** | **16** | **100%** |

4 + 9 + 1 + 2 = 16. Matches the 16-candidate dispatch total exactly.

**Combined across all 22 lines** (folding in the 6 mechanically-excluded `one-two-punch` lines, which
never receive a subagent verdict at all and are counted here as `not-rule-bearing` — the closest
available bucket, per `177-PREDICTION.md`'s own labelling convention, though the real pipeline assigns
them literally no verdict):

| Verdict | Count | % of 22 |
|---|---|---|
| `agrees` | 4 | 18% |
| `disagrees` | 9 | 41% |
| `underivable` | 1 | 5% |
| `not-rule-bearing` (2 dispatched + 6 mechanical) | 8 | 36% |
| **Total** | **22** | **100%** |

4 + 9 + 1 + 8 = 22.

### Prediction commit predates this section

```
$ git log --oneline -1 -- .planning/phases/177-derived-line-re-derivation/177-PREDICTION.md
913bfe7d docs(177-06): commit pre-dispatch distribution prediction for CHECK-04
```

`913bfe7d` is 3 commits behind this section's own work (`bffc72e5` §2, and this commit), and no
dispatch, `claude -p` invocation, or verdict record for CHECK-04 exists anywhere in this repository's
history before it. The prediction genuinely predates the measurement.

### Predicted vs. measured — per verdict

| Verdict | Predicted (22-line file, all buckets) | Predicted (16 real-candidate subset) | Measured (16 real candidates) |
|---|---|---|---|
| `agrees` | 9 | 5 | 4 |
| `not-rule-bearing` | 9 | 7 | 2 |
| `underivable` | 3 | 3 | 1 |
| `disagrees` | 1 | 1 | 9 |

The 16-real-candidate predicted subset is computed by removing the prediction's 4 now-mechanically-
excluded lines (`one-two-punch:68`, `:79`, `:56` first-Punch, `:61` second-Punch — all predicted
`agrees` in `177-PREDICTION.md`, all moot per §1's reconciliation) from the 22-line total: 9 − 4 = 5
`agrees` remain in the 16-candidate subset; the other three buckets are unaffected since none of the
4 removed lines were predicted `not-rule-bearing`/`underivable`/`disagrees`.

**`disagrees` is 9x the predicted count (1 → 9). This is the single largest miss in this proof and is
the real finding this section exists to surface — not smoothed into a percentage.**

### Predicted vs. measured — per line, every miss named

| Line | Predicted | Measured | Hit/Miss |
|---|---|---|---|
| `seven:8` | `not-rule-bearing` | `disagrees` | **MISS** |
| `seven:14` | `not-rule-bearing` | `disagrees` | **MISS** |
| `seven:19` | `agrees` | `agrees` | Hit |
| `seven:21` | `agrees` | `agrees` | Hit |
| `seven:33` | `not-rule-bearing` | `disagrees` | **MISS** |
| `seven:36` | `agrees` | `agrees` | Hit |
| `seven:38` | `underivable` | `disagrees` | **MISS** |
| `seven:42` | `not-rule-bearing` | `disagrees` | **MISS** |
| `seven:11` (02-solo-variant) | `disagrees` | `disagrees` | Hit (see caveat below) |
| `seven:17` | `not-rule-bearing` | `disagrees` | **MISS** |
| `one-two-punch:30` | `agrees` | `agrees` | Hit |
| `one-two-punch:52` | `underivable` | `disagrees` | **MISS** |
| `one-two-punch:49` | `not-rule-bearing` | `underivable` | **MISS** |
| `one-two-punch:82` | `agrees` | `not-rule-bearing` | **MISS** |
| `one-two-punch:89` | `underivable` | `not-rule-bearing` | **MISS** |
| `one-two-punch:95` | `not-rule-bearing` | `disagrees` | **MISS** |

**5 hits, 11 misses, out of 16.** The prediction's own defended divergences from `177-RESEARCH.md`'s
hedge (`seven:21` predicted `agrees` against research's `underivable` worked example; `one-two-punch:82`
predicted `agrees` against research's non-quote-line-context concern) — `seven:21` landed correctly;
`one-two-punch:82` did not (measured `not-rule-bearing`, not `agrees` — see below for why).

### Interpretation rules — applied honestly; NONE of the three pre-committed rules fires as anticipated

**(a) A large `underivable` share as a real ingest-contract finding: DOES NOT FIRE.** Measured
`underivable` is 1/16 (6%), well under any threshold that would trigger this rule — the opposite of
what research most worried about.

**(b) A uniform distribution proving consistency, not discrimination: DOES NOT FIRE.** The measured
distribution is not uniform — it is dominated by `disagrees` (56%) but includes all four verdicts,
unlike Phase 176's real 60/60 single-verdict corpus.

**(c) Zero `not-rule-bearing` as suspicious: DOES NOT FIRE.** 2 of 16 dispatched candidates (plus 6
mechanically-excluded) returned `not-rule-bearing` — non-zero, so this rule's concern is not
triggered.

**None of the three rules committed in advance explains what actually happened. A fourth,
un-anticipated cause does, and it is reported here as a genuine finding rather than forced into one
of the three pre-committed buckets:**

**A REAL, STRUCTURAL FINDING: `buildBlindDerivePayload`'s "Target line" identifier carries no
information the blind subagent can actually use to distinguish WHICH fact is under test when a slice
contains more than one candidate `Derived` line — and the measured 56% `disagrees` rate is dominated
by this targeting collapse, not by genuine mismatches between the original derivation and an
independently re-derived reading of the SAME fact.**

The evidence: `seven`'s `01-definitions-and-components.md` slice has 5 candidate lines (8, 14, 19,
21, 33), each dispatched with an IDENTICAL quote-line payload — differing only in the line stated at
`Target line: rulebook/01-definitions-and-components.md:{8,14,19,21,33}`, a raw line number from the
ORIGINAL file that has no meaning inside the quote-only payload (which strips every `Derived`/
`Visual` line and does not renumber or otherwise mark position). All 5 dispatches returned
functionally the SAME rederived value — the "7 x 4 x 4 = 112 numbered cards, + 7 bonus, 119 total"
deck-composition arithmetic — regardless of which line was nominally the target:

```
seven:8   rederivedValue: "A player's hand grows by a net 7 cards... starts at 3, ends at 10." (an
          OUTLIER on this specific dispatch, but see seven:14/33 below — this is the same collapse
          pattern landing on a different single dominant fact in the same slice, hand-size math
          instead of deck math, still unrelated to line 8's actual content about card-art imagery)
seven:14  rederivedValue: "The full deck is 7 numbers x 4 colors x 4 copies = 112 numbered cards,
          plus 7 bonus point cards, for 119 cards total."
seven:19  rederivedValue: "The numbered deck is 7 numbers x 4 colors x 4 copies = 112 numbered
          cards; adding the 7 bonus point cards gives 119 cards in total."
seven:21  rederivedValue: "The deck totals 7 numbers x 4 colors x 4 copies = 112 numbered cards,
          plus 7 bonus point cards, for 119 cards in all."
seven:33  rederivedValue: "The deck is 7 numbers × 4 colors × 4 copies = 112 numbered cards, plus
          7 bonus point cards, for 119 cards total."
```

Lines 19 and 21 are ACTUALLY about deck composition, so the collapsed derivation happens to coincide
with them — both correctly landed `agrees`. Lines 8, 14, and 33 are about card-image illustrations
and card-art styling — NOT deck composition — so the same collapsed derivation lands `disagrees`
against them, not because the original derivation was wrong, but because the blind stage never
attempted to derive what lines 8/14/33 actually assert. The same pattern repeats in
`01-overview-setup-and-play.md` (lines 36/38/42 all converge on "7 rounds" round-structure or
match-structure arithmetic; only 36 is actually about that), `02-solo-variant.md` (lines 11/17 both
converge on the solo variant's three-escalating-goals structure; neither line's own specific claim —
sentence attribution for 11, page layout for 17 — is what got re-derived), and
`02-action-cards-and-resolution.md` (line 95 converges on the Guard-card knockout rule, unrelated to
its own claim about the Variants section).

**`one-two-punch:52` is the one exception worth naming separately — a genuine, on-topic content
disagreement, not a targeting-collapse artifact.** Its slice has only 2 candidate lines (30, 52), both
legitimately about Action Card counts, and the compare dispatch caught a real, specific numeric
conflict:

```
Original (verbatim):   Derived (p.1): Each player has 8 Action Cards (16 total across two colors)
                        and 3 Guard Cards.
Rederived (verbatim):  Each player starts the first round holding 6 action cards. The 16 Action
                        Cards split evenly by color, so each player takes 8; each player then
                        places one of their Rest cards face up as their own discard pile, leaving
                        7 in hand; the blue player then discards one non-Rest card of their choice
                        and the red player discards one non-Rest card named by blue, leaving each
                        player with 6 action cards in hand.
Reasoning: The two readings state incompatible facts about how many Action Cards each player has.
The original line asserts a flat 8 per player. The blind re-derivation's stated value is 6 per
player at the start of round 1, after Setup's discard steps are applied.
```

This is a genuine finding, citing both derivations verbatim (SC-2's requirement) — the original line
states the box-split total (8) without noting that Setup immediately discards 2 of those 8 before
round 1 begins (per the quoted Setup steps), while the blind re-derivation, working only from the
same quote lines, tracked the discard-adjusted round-1 hand size (6). Both readings are individually
supportable from the quoted material; they answer slightly different questions (post-Setup total vs.
round-1 starting hand), which is exactly the kind of substantive disagreement CHECK-04 exists to
surface for designer adjudication — this one is NOT a payload-targeting artifact.

### `one-two-punch:49` — the one `underivable` finding, both stages shown

```
Original (verbatim): Derived (p.2): Each Action Card entry is headed by a small red icon (lightning
bolt for Jab, chevron/arrow shapes for Retreat and Advance, an "X" for Block, a hand/glove mark for
Punch, a dot for Rest).
Blind stage returned: { rederivedValue: "underivable", sourceQuotes: [] }
```

No comparison dispatch followed, per the pass-through rule — `verify-derive-recheck --json` records
verdict `underivable` directly from the blind stage's own return, reasoning: `"Blind derivation stage
itself returned 'underivable'; passed through unchanged per derive-compare.md's never-re-adjudicate
rule — comparison dispatch skipped."` No quoted text on this page describes icon shapes at all — a
genuine, structurally correct `underivable`, matching the prediction's own reasoning for this line
almost exactly (prediction: `not-rule-bearing`; measured: `underivable` — a miss in label, but both
readings agree the icon claim has zero quoted support; the difference is whether "icon glyph shape"
counts as a game rule at all (predicted judgment) vs. an unsupportable-but-potentially-rule-bearing
claim (measured judgment) — a genuine, reasonable disagreement between two honest judgment calls, not
an error in either).

### Reporting only — no repair performed

Both reference games' `rulebook/*.md` slice content is unchanged by this task (confirmed byte-identical
in §4 below). No disagreement or underivable finding above was fixed in either game — findings are
recorded to the ledger and reported here, exactly per the plan's scope boundary.

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

Both originals confirmed byte-identical, whole-tree, before and after every real command this entire
plan (§§1-4) ran, including all 29 real `claude -p` dispatches — every dispatch and every ledger write
touched only the `cp -R` scratch copies, never `~/BoardSmithGames/*` directly.

### CHECK-04's three success criteria — assessed against the evidence actually produced

**SC-1 — "Every rule-bearing `Derived` line in a verified project is re-derived independently of the
original transcription pass, using only quote lines present in the current slice."**

**NOT MET**, in the sense that matters for the requirement's own purpose, though a narrower structural
claim within it IS proven. Two separate things are bundled in SC-1's text, and they diverge:

- **"Independently of the original transcription pass" — MET, and proven structurally (§2).** The
  blind-derivation payload never contains the target line's own text, verified by real grep on all 16
  dispatched prompts (zero `Derived (p.`/`Visual (p.` matches, plus a distinctive-substring grep) — a
  re-derivation genuinely cannot have anchored on the original, because the original was never sent.
- **"Re-derived... using only quote lines present in the current slice" as a genuine PER-LINE
  judgment — NOT MET, and disproven by real dispatch data (§3).** `buildBlindDerivePayload`'s
  `Target line: {slicePath}:{lineNumber}` identifies the target ONLY by a raw line number from the
  ORIGINAL file, which carries no locatable meaning inside the quote-only payload the subagent
  actually receives (that payload strips every `Derived`/`Visual` line and does not renumber or mark
  position). Measured on real data: when a slice has more than one candidate line — true for every
  multi-candidate slice in this corpus (`01-definitions-and-components.md`'s 5, `01-overview-setup-
  and-play.md`'s 3, `02-solo-variant.md`'s 2, `02-action-cards-and-resolution.md`'s 4, `01-setup-and-
  round-structure.md`'s 2) — the blind stage repeatedly re-derives the SAME single dominant fact
  regardless of which line is nominally the target, rather than a fact specific to that line. This is
  not a defect in the reference games' content; it is a defect in the target-identification mechanism
  the dispatch payload uses. It means most of this run's `disagrees` verdicts are not "the original
  and the independent re-derivation disagree about fact X" but "the blind subagent derived a DIFFERENT
  fact than line X asserts," which is not the finding SC-1 promises a designer.

**SC-2 — "A disagreement between the original and re-derived value is reported as a finding, citing
both derivations."**

**MET, mechanically.** Every `disagrees` record in the ledger carries `originalReading` and
`rederivedReading` verbatim — enforced by `createDeriveVerdictRecord`, which throws on a `disagrees`
record missing either field (no such throw occurred across all 9 real `disagrees` verdicts recorded
this run). §3 shows one genuine on-topic disagreement (`one-two-punch:52`) and the one `underivable`
finding (`one-two-punch:49`) with both readings quoted verbatim, satisfying the plan's "at least one
finding shows BOTH derivations verbatim" requirement. This criterion is about the REPORTING mechanism,
which works correctly and unconditionally — it does not require that every reported disagreement be
substantively meaningful, which is SC-1's concern, not SC-2's.

**SC-3 — "The check runs with no source rulebook present and correctly ignores `Visual` lines as out
of scope."**

**MET, with the same disclosed limitation Phase 176 named for its own analogous criterion.**
Source-freeness is structural: `readLiveSlices` reads only `rulebook/*.md`, and no function in
`verify-derive-recheck.ts` ever joins `projectDir` with `rulebook/source` — confirmed by direct code
read (module comment, §1's earlier reading), not re-derived from a live run in this proof. Both
reference games' live slices carry **zero `Visual (p.` lines** (re-confirmed directly this task:
`grep -c "^Visual (p\." rulebook/*.md` returns 0 for every file in both games), matching Phase 174's
own measurement. **This means SC-3's `Visual`-ignoring half is proven by unit test against
constructed input, not by live dispatch data** — the same disposition basis `176-VERIFICATION.md`
used for its own real-corpus gap ("proven correct-when-called-for only on constructed cases; neither
reference game's committed content produces those labels").

### What is still unproven

- **The target-identification gap named above is the single largest open item this proof surfaces.**
  It has not been fixed here — this plan's file scope is proof/bookkeeping only
  (`177-PROOF.md`/`REQUIREMENTS.md`/`ROADMAP.md`/`177-VALIDATION.md`/`STATE.md`), and
  `buildBlindDerivePayload`/the dispatch-prompt construction live in `verify-derive-recheck.ts`,
  out of this plan's file list. It is reported here, to the ledger, and (via Task 4 below) to
  `REQUIREMENTS.md`'s CHECK-04 row — the same "report to the owner, not just record here" question
  the plan's own read-first list asked. A fix would need the dispatch to give the blind subagent some
  way to distinguish which of several candidate facts in a shared slice is under test — for example
  including a redacted-but-positioned marker at the target line's location, or narrowing the
  quote-line payload to only the quotes immediately local to the target — without reintroducing the
  target line's own text. That redesign is out of scope for this proof-only plan.
- **Dispatch mechanism, stated per `173-PROOF.md` §6's precedent:** all 29 real dispatches this task
  ran used a `claude -p "<prompt>" --allowedTools Read` OS subprocess — this execution session exposes
  no native Task/Agent tool. This is NOT native Task/Agent-tool dispatch. `173-PROOF.md` §6 remains the
  only session in this milestone that ever exercised native dispatch, and only for one transcription
  unit — unresolved, carried forward unchanged.
- **The `underivable` finding (`one-two-punch:49`) was not reported anywhere beyond this proof and the
  project's own ledger** — it is a single line (not a substantial share, per interpretation rule (a)'s
  own "large share" threshold, which did not fire), so it does not rise to the "report to the ingest
  contract's owner" bar decision 11 sets. It is recorded in `rulebook/.derive-recheck/DERIVE-VERDICTS.md`
  in the scratch copy only (never written to either original, per the read-only invariant); a live
  project running this check for real would accumulate it in its own project-level ledger.
- **SC-3's `Visual`-ignoring half remains proven only on constructed/absent-case input**, as stated
  above — no real `Visual (p.` line exists in either reference game to dispatch against.
- **The 22-line/16-candidate reconciliation from §1 (already-fixed regex, 16 not 20 real candidates)
  is now doubly confirmed** — both by the mechanical enumeration in §1 and by this section's real
  dispatch count (16 blind dispatches, matching `enumeratedCount` exactly in both games' `--json`
  output).

### Cross-reference: `177-SWEEP.md`

`177-SWEEP.md` records this phase's router stale-claim sweep (`verify-game.md`'s Step 7 wiring,
Context-Economics carve-out, and cross-file claim audit, from `177-05`) — a separate, prose-level
audit from this proof's live-dispatch measurement. Both records are needed to close CHECK-04
honestly: `177-SWEEP.md` confirms the skill TEXT is wired correctly and makes no stale claims; this
proof (`177-PROOF.md` §§1-4) confirms the underlying MECHANISM's real behavior, including the
target-identification gap the skill text does not (and could not) surface on its own.

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
npx boardsmith verify-derive-recheck --project "$SCRATCH/seven" --json
npx boardsmith verify-derive-recheck --project "$SCRATCH/one-two-punch" --json

# §2/§3 — real dispatch driver (imports buildBlindDerivePayload/enumerateDerivedLines/
# createDeriveVerdictRecord/recordDeriveVerdicts directly from verify-derive-recheck.ts; dispatches
# every candidate blind, then every non-terminal blind result through a compare dispatch, recording
# through the one atomic ledger write path)
cd "$SCRATCH" && npx tsx driver.ts

# §4 — re-verify originals byte-identical
cd ~/BoardSmithGames/seven && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-seven.after
diff manifest-seven.before manifest-seven.after
cd ~/BoardSmithGames/one-two-punch && find . -type f -not -path './.git/*' -print0 | sort -z | xargs -0 shasum -a 256 > manifest-otp.after
diff manifest-otp.before manifest-otp.after

# Full suite
npm test
```
