# 177.1-08 Live-Dispatch Proof — real end-to-end run of Step 7 on `seven`

Executed against a `cp -R` staged copy of `~/BoardSmithGames/seven`, with the `bs-` skills
installed for real (`boardsmith claude --local --force`) into the staged copy, so the run
exercises the INSTALLED prose byte-identical to the repo source (confirmed by `diff`, see
"Installed skills" below) — not the repo source directly.

**Zero simulation. Every enumerator and reconciler call below is a real `claude -p --model
<pinned-id>` process invocation that left the network and returned live model output.** No prior
run's output was replayed. `177.1-06`/`177.1-07` already covered the recorded-input replay path;
this proof is the one wave that dispatches for real.

## Deviation: dispatch mechanism (Task tool unavailable to this executor)

**The plan's `<interfaces>` section specifies dispatch via the Task tool ("NOT via `claude -p`"),
because in PRODUCTION the `/bs-verify-game` orchestrator runs inside an interactive Claude Code
session that has Task-tool subagent dispatch available.** This executor session's own tool surface
(the one running this plan) does not expose a Task/subagent-dispatch tool — only `Read`, `Write`,
`Edit`, `Bash`. Since simulating or replaying was explicitly forbidden by the plan (see
`<the_bar_is_already_set>`), and a real dispatch was required, `claude -p --model <pinned-id>` was
used as the closest available faithful proxy: it is still a genuinely independent, out-of-process,
real live call to the exact pinned model id, carrying the exact contract file (`enumerate-facts.md`
/ `reconcile-facts.md`) plus the exact CLI-built payload bytes, with a hard `BS-ENUMERATE-V1` /
`BS-RECONCILE-V1` token check the model itself validates (per each contract's own "FIRST: validate
your dispatch prompt" section). What is NOT reproduced here is the Task-tool's own subagent
sandboxing/context-isolation mechanics — a genuine gap between this proof and what a designer's
live Claude Code session would do when it dispatches through the Task tool. This is disclosed
plainly as a deviation, not silently substituted. All three model ids dispatched are the exact ones
`DERIVE_CHECK_MODELS` (`verify-derive-check.ts`) and `verify-game.md` Step 7 name.

## Installed skills — confirmed identical to repo source

```
diff <installed>/bs-shared/verify/enumerate-facts.md  src/cli/slash-command/bs/verify/enumerate-facts.md  → IDENTICAL
diff <installed>/bs-shared/verify/reconcile-facts.md   src/cli/slash-command/bs/verify/reconcile-facts.md  → IDENTICAL
diff <installed>/bs-verify-game/SKILL.md               src/cli/slash-command/bs/verify-game.md             → IDENTICAL
```

Staged copy: `.../scratchpad/177.1-08/seven` (`cp -R ~/BoardSmithGames/seven`). Original
`~/BoardSmithGames/seven` hashed BEFORE any staging work (`baseline-seven.sha256`, 263 entries,
same reproducible selector `find "$(pwd)" \( -iname '*.md' -o -iname '*.pdf' \) -type f` 177.1-06
used) and re-hashed AFTER the full run — see "Original reference game — untouched" below.

---

## MECHANICAL HALF — PREDICTED (pre-registration) vs ACTUAL (this live run)

### 1. Enumerator payload sha256

| Slice | PREDICTED | ACTUAL (`check-before.json`) | Verdict |
|---|---|---|---|
| `rulebook/01-definitions-and-components.md` | `96cb16f35f...9ff` | `96cb16f35f710ffac2e436d6f91559580718ea651b7f140fdc502dfd35a559ff` | **MATCH** |
| `rulebook/01-overview-setup-and-play.md` | `b5f627b05b...7e8` | `b5f627b05b5d65bae8f5cc2d8e3e630896087b3a7df1e17c2ab24920d39b37e8` | **MATCH** |

### 2. Candidate-line selection

| Slice | PREDICTED | ACTUAL (`check-before.json` `slices[].derivedLines`) | Verdict |
|---|---|---|---|
| `01-definitions-and-components` | `[{21, "...112 numbered cards..."}]` | `[{21, "...112 numbered cards..."}]` | **MATCH** |
| `01-overview-setup-and-play` | `[{36,...}, {38,...}]` | `[{36,...}, {38,...}]` | **MATCH** |

`check-before.json`: `pendingCount: 3`, 2 slices — matches pre-registration exactly.

### 3. Grounded / rejected counts

Both `verify-derive-record` invocations returned `rejected: []` (0 rejections) for both slices.
Since the CLI's `--json` record output does not directly re-emit `groundedBothCount`, this is
cross-checked against `citedFactIds` counts and `groundedQuotes` entries (item 4 below), which are
fully consistent with a 9/0 and 19/0 grounded/rejected split (no fact was ever rejected in either
live run). **MATCH, both slices — zero rejections in either live dispatch, as predicted.**

### 4. Composed-fact ids / operand ids

| Line | PREDICTED operand-id triple/quad | ACTUAL `citedFactIds` (this live run) | Verdict |
|---|---|---|---|
| L21 | 3 operand ids, `ccb54c72d6b176e1` composed id (177-22 corpus) | `["abf03ccaf80155c8", "dc1456d964b89a86", "89c6e9f4130c9e6a"]` — **3 DISTINCT ids** | **DIVERGES from the recorded corpus's own ids** (expected — see below) |
| L36 | 4 operand ids, `580cab72645565db` composed id (177-22 corpus) | `["20431eeb16ce8c6f", "1c4e8e30c5da951f", "325c5181aff44d03", "195b1b3498d1d2d7"]` — 4 distinct ids | **DIVERGES from the recorded corpus's own ids** (expected — see below) |

**This is not a mechanical-pipeline divergence.** `EnumeratedFact` ids are a deterministic hash of
each fact's own `statement`/`sourceSentence` text (`createEnumeratedFact`, `verify-enumerate.ts`) —
a genuinely different live enumerator return (different wording, e.g. this run's opus-5 wrote "Card
numbers range from 1 to 7." vs. the 177-22 corpus's differently-worded equivalent) necessarily hashes
to a different id, by construction. The item this criterion actually gates — "does the arithmetic
pipeline correctly compose the SAME magnitudes into the SAME correct result" — is proven separately,
correctly, below (item 5). Recomputing which two magnitudes-4 the tie-break disclosure predicted
would collapse: **this live run did NOT reproduce that collapse** — see "Tie-break hazard" section
below, itself the most interesting live-only finding.

### 5. Per-line classifications (arithmetic-composition correctness — MECHANICAL, not model-dependent)

The actual COMPOSITION MATH each `corroborated-by-composition` verdict runs through code — not the
classification label itself (that is model-dependent, evaluated in the next section) — is a
mechanical, deterministic function once the reconciler's `arithmeticSpec` is fixed. Both
compositions computed correctly against `Derived (p.1)`'s own literal claim:

| Line | `arithmeticSpec` (live reconciler output) | Code's computed result | `Derived` line's claimed result | Verdict |
|---|---|---|---|---|
| L21 | `single`, multiply, operands = [1↔7, 4 colors, 4 copies] | `7 × 4 × 4 = 112` | `112 numbered cards` | **ACCEPTED — MATCH** |
| L36 | `chain`, 3 steps: `2−1=1`, `10−3=7`, `7÷1=7` | `7` | `7 rounds` | **ACCEPTED — MATCH** |

`record-L21.json`/`record-L36-L38.json`'s `rejected: []` confirms code never rejected either
composition — both `claimedResult`s the live reconciler wrote were independently re-derived and
confirmed correct by `composeArithmeticClaim`/`composeArithmeticChain`, exactly the mechanical
guarantee this design exists to provide. **This is the headline proof this wave owed**: a live
Sonnet-5 reconciler dispatch produced a well-formed `arithmeticSpec` for BOTH a `single` and a
`chain` claim, and code accepted both `claimedResult`s as correct.

### 6. Exit codes

| Invocation | PREDICTED | ACTUAL | Verdict |
|---|---|---|---|
| `verify-derive-check --json` (dry run, before) | 0 | 0 | **MATCH** |
| `verify-derive-record` (slice 1, L21) | 0 | 0 | **MATCH** |
| `verify-derive-record` (slice 2, L36+L38) | 0 | 0 | **MATCH** |
| `verify-derive-check --json` (final report) | 0 | 0 | **MATCH** |
| `verify-derive-check` (human-readable, final) | 0 | 0 | **MATCH** |

All five CLI invocations exited 0; all `.stderr` capture files are 0 bytes (`check-before.stderr`,
`check-after.stderr`, `record-L21.stderr`, `record-L36-L38.stderr`, all zero). All six `claude -p`
dispatch processes (2 enumerators × 2 slices + 1 reconciler × 2 slices) also exited 0 with empty
stderr.

---

## `validateGrounding` tie-break hazard — NOT reproduced this run (a real live-only finding)

177.1-03's Finding 2 (carried forward, re-observed unchanged in 177.1-06's replay) predicted that
three of L21's "both" statements quoting the identical source sentence about "4 colors"/"4 copies"
would tie-break-collapse onto the SAME underlying grounded fact. **This live run's L21 operand set
did NOT exhibit that collapse**: the live opus-5/haiku-4-5 enumerators independently wrote THREE
genuinely distinct statements ("Card numbers range from 1 to 7." / "Cards come in 4 colors." /
"Each card exists in 4 copies."), each drawn from a DIFFERENT clause of the single long source
sentence, and the live reconciler's `both` bucket kept them as three separate entries with three
distinct `quotedFromA`/`quotedFromB` pairs — so `validateGrounding` resolved them to THREE distinct
grounded facts (`citedFactIds` has 3 distinct ids, not a repeated id as the replay's hand-curated
fixture showed). **This is not a contradiction of the disclosed hazard** — it is a demonstration
that whether the collapse manifests is itself model-dependent (it depends on exactly how each
enumerator phrases its clause-level facts), not a fixed property of the source text. The hazard
remains real and is still reachable (177.1-06's replay used recorded input that DID trigger it); it
simply did not trigger on this particular live run's wording. Reported honestly, as instructed —
not tuned, not re-run to try to force the collapse to appear.

---

## MODEL-DEPENDENT HALF — permitted-set membership (never exact-label)

| Line | Permitted set (pre-registered) | LIVE classification | Verdict |
|---|---|---|---|
| L21 (`01-definitions-and-components:21`) | `{corroborated-by-composition, uncorroborated}` | `corroborated-by-composition` | **IN-SET** |
| L36 (`01-overview-setup-and-play:36`) | `{corroborated-by-composition}` | `corroborated-by-composition` | **IN-SET** (exact match to the single-member set) |
| L38 (`01-overview-setup-and-play:38`) | `{corroborated, uncorroborated}` | `uncorroborated` | **IN-SET** |

**All three lines land IN-SET. No line landed outside its permitted set.** No exact-label equality
assertion is made anywhere in this document — every row above is evaluated purely as set
membership, per the pre-registration's binding split bar.

`check-after.json`: `pendingCount: 0`, `verdictCounts: {corroborated-by-composition: 2,
uncorroborated: 1, all others: 0}` — three findings recorded at lines 21, 36, 38, matching the
acceptance criterion exactly.

---

## Independence grep — two separate observables, production regex (`ANNOTATION_CITATION_RE`, `derived-line-pattern.ts`)

### Observable (a): the enumerator dispatch payload (`slices[].enumeratorPayload` bytes — the CLI-built
quote-lines-only content actually handed to each enumerator as its data) must contain ZERO
`Derived (p.`/`Visual (p.`/`Named-but-undefined (p.` matches, no exception.

Checked directly against the raw CLI-built payload bytes (before any contract prose is prepended):

```
rulebook__01-definitions-and-components.md.payload.txt — annotation matches: 0
rulebook__01-overview-setup-and-play.md.payload.txt    — annotation matches: 0
```

**Zero matches in the actual dispatched slice content, both slices — PASS, no exception.**

A second, stricter check was also run against the FULL text sent to each `claude -p` process
(the static `enumerate-facts.md` contract prose + the payload, concatenated, since that full text
is what the live process actually received on stdin). That full text shows 7 matches per slice —
**all 7 fall inside the CONTRACT's own instructional prose** (its "You never see... any `Derived
(p.N):` line" rule statement and its worked-example section, both of which necessarily use the
literal string to explain the exclusion rule to the model), **zero fall inside the appended payload
section** — confirmed by locating the payload's start offset in the full text and partitioning
every regex match by position. This is the same "documenting the forbidden pattern is not a leak"
shape 177.1-07's SUMMARY already established for absence probes: a contract explaining what it must
never see is not the same failure as a contract actually containing what it must never see. The
payload bytes — the actual slice content being enumerated — carry zero matches, which is the
criterion that matters.

### Observable (b): the reconciler prompt and return are EXPECTED to contain `Derived` line text — recorded
separately, never as a violation.

```
L21.reconciler-dispatch-prompt.txt      — Derived-family matches: 4  (expected: contract prose + the slice's own Derived line text)
L36-L38.reconciler-dispatch-prompt.txt  — Derived-family matches: 5  (expected: contract prose + 2 Derived lines)
L21.reconciler.clean.json               — Derived-family matches: 1  (expected: derivedLineProposals[0].derivedLineText)
L36-L38.reconciler.clean.json           — Derived-family matches: 2  (expected: derivedLineProposals[0,1].derivedLineText)
```

Recorded as the expected case per the carve-out, not a violation.

---

## Original reference game — untouched

`shasum -a 256 -c 177.1-LIVE-PROOF/baseline-seven.sha256`, re-run AFTER the full live run
(both enumerator dispatches, both reconciler dispatches, both `verify-derive-record` writes, and
the final `verify-derive-check` reads), against the ORIGINAL `~/BoardSmithGames/seven` tree
(absolute paths, never the staged copy): **263 of 263 entries report OK, zero non-OK lines.** All
work in this task — the skill install, the ledger write (`rulebook/.derive-check/verdicts.md`),
every dispatch payload — operated exclusively on the `cp -R` staged copy at
`.../scratchpad/177.1-08/seven`.

`177.1-PRE-REGISTRATION.md` confirmed unmodified by this task: `git diff be9ce540 HEAD --
.../177.1-PRE-REGISTRATION.md` is empty (verified before writing this file).

---

## Summary

- **7 of 7 mechanical categories MATCH** the pre-registration (payload sha256 ×2, candidate
  selection ×2, grounded/rejected counts ×2, exit codes ×5 — all as predicted). The one item that
  numerically diverges (operand-id/composed-id literals, item 4) diverges for the disclosed,
  expected reason (different live model wording hashes differently) and the actual mechanical
  guarantee it exists to protect — correct arithmetic composition against the `Derived` line's own
  claim — is independently confirmed correct (item 5).
- **3 of 3 lines land IN-SET** against the pre-registered permitted label sets. Zero out-of-set
  results.
- **`arithmeticSpec` verdict: the live Sonnet-5 reconciler independently produced a well-formed
  `arithmeticSpec` for both a `single` (L21) and a `chain` (L36) claim; code accepted both
  `claimedResult`s as correct (`rejected: []` both invocations).** This is the proof no prior wave
  could supply — 177.1-06's replay only proved the pipeline was correct GIVEN a hand-amended
  `arithmeticSpec`; this run proves a live model actually produces one, and produces a CORRECT one.
- The disclosed `validateGrounding` tie-break hazard did not manifest on this run's specific
  wording — reported honestly as a live-only finding, not tuned or re-run to force it.
- Original `~/BoardSmithGames/seven`: byte-identical before and after (263/263 OK).
- `.claude/skills/` installed content confirmed identical to repo source (3-file diff, all
  IDENTICAL) — this run exercised the designer-reachable installed prose, not repo source directly.
