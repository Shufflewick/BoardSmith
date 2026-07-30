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
