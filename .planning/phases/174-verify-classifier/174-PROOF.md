# Phase 174 Plan 01 — Proof

## 1. Fixture production

This is the phase's Wave 1 job: `174-RESEARCH.md`'s single biggest finding was that **zero**
pass-1-vs-pass-2 material exists anywhere on disk — neither reference game has
`rulebook/.verify/`, `rulebook/source/`, or a `Source hash:` line, and every artifact Phase 173's
proof produced lived in `/tmp` and is gone. This section produces that material for real, against
disposable `cp -R` copies, reusing Phase 173's adoption + re-transcription pipeline unchanged, and
archives it in-repo (`174-FIXTURES/`) so it survives scratch cleanup.

`SCRATCH="${TMPDIR:-/tmp}/174-proof"` for the whole run.

### seven — preflight/adoption

Preflight, on the ORIGINAL, before any copy:

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
```

Matches the pinned read-only invariant exactly.

Whole-tree sha256 manifest captured to `$SCRATCH/seven.before` — 5342 files.

```
$ cp -R ~/BoardSmithGames/seven "$SCRATCH/seven"
```
(APFS clonefile — completed in under 2 seconds; a real, full recursive copy, not a symlink.)

Real skill install:

```
$ cd "$SCRATCH/seven" && npx boardsmith claude --local --force
Linking BoardSmith globally...
✓ BoardSmith linked globally
✓ Installed BoardSmith skills for Claude Code

  Location: <SCRATCH>/seven/.claude/skills
  BoardSmith: /Users/jtsmith/BoardSmith
...
```

Filesystem assertions (never trusting the installer's own console output):

```
$ test -f "$SCRATCH/seven/.claude/skills/bs-verify-game/SKILL.md" && echo FOUND
FOUND
$ test -f "$SCRATCH/seven/.claude/skills/bs-shared/verify/source-resolution.md" && echo FOUND
FOUND
$ test -f "$SCRATCH/seven/.claude/skills/bs-shared/verify/staging-dispatch.md" && echo FOUND
FOUND
```

Source adoption (Case 2 of `verify/source-resolution.md` — exactly one root candidate, no
`--edition`):

```
$ cat rulebook/INDEX.md | head -6   (BEFORE)
# Rulebook Index — Seven

Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation

Source: `rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
transcription subagents' returned `citedTerms[]` lists; the slices themselves are the authority.

$ boardsmith ingest-archive rules.pdf --project . --json
{
  "archivedPath": "rulebook/source/rules.pdf",
  "sourceHash": "5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880",
  "indexPath": "rulebook/INDEX.md",
  "wroteIndex": false
}

$ cat rulebook/INDEX.md | head -8   (AFTER)
# Rulebook Index — Seven

Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation

Source: rulebook/source/rules.pdf
Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
Transcribed: 2026-07-29
`rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
```

Independent cross-checks:

```
$ ls rulebook/source
rules.pdf
$ shasum -a 256 rulebook/source/rules.pdf
5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880  rulebook/source/rules.pdf
$ grep "^Source hash:" rulebook/INDEX.md
Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
```

Exactly one file under `rulebook/source/`, and the `INDEX.md` `Source hash:` value matches a fresh
`shasum -a 256` of the archived file. The hash is identical to Phase 173's own real adoption of
this exact PDF — expected, since `ingest-archive` hashes the file's bytes and this is the same
unmodified `rules.pdf`.

**GATE: PASSED (seven — preflight/adoption)**

### one-two-punch — preflight/adoption

Preflight, on the ORIGINAL, before any copy:

```
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```

(Not asserted porcelain-empty — this repo has known pre-existing unrelated dirty state, matching
`173-06-PLAN.md`'s documented exception.)

Whole-tree sha256 manifest captured to `$SCRATCH/otp.before` — 5400 files.

```
$ cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/one-two-punch"
```

Real skill install (identical shape to `seven`'s, output omitted for brevity — same seven skills
listed, same `Location:`/`BoardSmith:` lines).

Filesystem assertions:

```
$ test -f "$SCRATCH/one-two-punch/.claude/skills/bs-verify-game/SKILL.md" && echo FOUND
FOUND
$ test -f "$SCRATCH/one-two-punch/.claude/skills/bs-shared/verify/source-resolution.md" && echo FOUND
FOUND
$ test -f "$SCRATCH/one-two-punch/.claude/skills/bs-shared/verify/staging-dispatch.md" && echo FOUND
FOUND
```

Source adoption:

```
$ cat rulebook/INDEX.md | head -6   (BEFORE)
# Rulebook Index — 1-2 Punch

Edition: none stated in the rulebook — © 2020 Alright Games (transcribed from `rules.pdf`, 2 pages)

Term → slice cross-reference. Built from the `citedTerms[]` returned by the transcription pass.

$ boardsmith ingest-archive rules.pdf --project . --json
{
  "archivedPath": "rulebook/source/rules.pdf",
  "sourceHash": "e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea",
  "indexPath": "rulebook/INDEX.md",
  "wroteIndex": false
}

$ cat rulebook/INDEX.md | head -6   (AFTER)
# Rulebook Index — 1-2 Punch

Edition: none stated in the rulebook — © 2020 Alright Games (transcribed from `rules.pdf`, 2 pages)
Source: rulebook/source/rules.pdf
Source hash: e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea
Transcribed: 2026-07-29
```

Independent cross-checks:

```
$ ls rulebook/source
rules.pdf
$ shasum -a 256 rulebook/source/rules.pdf
e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea  rulebook/source/rules.pdf
$ grep "^Source hash:" rulebook/INDEX.md
Source hash: e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea
```

Exactly one file under `rulebook/source/`, hash matches. `Edition:` line preserved byte-identical
to BEFORE.

**GATE: PASSED (one-two-punch — preflight/adoption)**

---

### Task 2 — Real pass-2 re-transcription on both copies

Both games' 2-page rulebooks were dispatched as a single page-range (`1-2`), matching Phase 173's
own precedent for `seven`'s 2-page rulebook (`173-PROOF.md` §3, which established the "one Task
subagent per range" default for a short rulebook where the inline-transcription exception is
ambiguous per that file's own documented finding).

**Dispatch mechanism used, reported honestly, not smoothed over:** this executor's available
tools are Read/Write/Edit/Bash — no internal Task/Agent tool is exposed to this session, exactly
the constraint `173-PROOF.md` §3 already documented and resolved the same way. A real `claude -p`
subprocess was used as the closest faithful equivalent: a genuine OS-level process boundary with
no inherited conversation history, whose only channel back to this session is captured stdout.

#### seven — run-init, dispatch, recording

```
$ boardsmith verify-run-init --project . --ranges '["1-2"]' --json
{
  "runId": "2026-07-29T23-25-24Z",
  "stagingDir": "rulebook/.verify/2026-07-29T23-25-24Z/slices",
  "ledgerPath": "rulebook/.verify/2026-07-29T23-25-24Z/RUN.md",
  "created": true,
  "ranges": ["1-2"]
}
$ boardsmith verify-run-status --project . --run-id 2026-07-29T23-25-24Z --json
{"runId":"2026-07-29T23-25-24Z","stagingDir":"...","recorded":[],"count":0,
 "ranges":["1-2"],"rangesRecorded":[],"rangesPending":["1-2"]}
```

Dispatch prompt sent verbatim (the `BS-DISPATCH-V2` pointer block, byte-identical to
`staging-dispatch.md`'s template except the three named substitutions):

```
BS-DISPATCH-V2

Read `.claude/skills/bs-shared/ingest/transcription-subagent.md` in full and follow it exactly.

Your page range: 1-2
Rulebook path:   rulebook/source/rules.pdf
Write slices to: rulebook/.verify/2026-07-29T23-25-24Z/slices
```

```
$ claude -p "<above>" --allowedTools Read,Write,Bash
```

Exit 0. The subagent returned a structured summary only — six `{ slicePath, sectionSummary,
citedTerms[], componentMentions[], visualEvidence[], variants[], openGaps[], nextStep }` records
(`01-about-and-setup.md`, `01-round.md`, `01-game-end-and-match.md`, `01-definitions.md`,
`01-distribution-of-cards.md`, `02-solo-variant.md`), plus a short orchestrator-facing notes
section (no `edition` field — the dispatch did not name this range as owning the opening pages).

Grepped independently for slice-body markers in the raw return — zero matches:

```
$ grep -c '^p\.[0-9]*,' subagent-seven-return.txt        -> 0
$ grep -c '^Derived (p\.' subagent-seven-return.txt       -> 0
$ grep -c '^Visual (p\.' subagent-seven-return.txt        -> 0
```

Six staged files confirmed present on disk (not inferred from the return):

```
rulebook/.verify/2026-07-29T23-25-24Z/slices/01-about-and-setup.md
rulebook/.verify/2026-07-29T23-25-24Z/slices/01-definitions.md
rulebook/.verify/2026-07-29T23-25-24Z/slices/01-distribution-of-cards.md
rulebook/.verify/2026-07-29T23-25-24Z/slices/01-game-end-and-match.md
rulebook/.verify/2026-07-29T23-25-24Z/slices/01-round.md
rulebook/.verify/2026-07-29T23-25-24Z/slices/02-solo-variant.md
```

Recording, from the subagent's returned `slicePath` fields only:

```
$ boardsmith verify-run-record --run-id 2026-07-29T23-25-24Z --unit 01-about-and-setup --slice 01-about-and-setup.md --range 1-2 --project . --json
{"runId":"2026-07-29T23-25-24Z","unitId":"01-about-and-setup","slicePath":"01-about-and-setup.md","sha256":"08845c69...67a6c53","alreadyRecorded":false,"rangeId":"1-2"}
... (5 more, one per unit) ...
$ boardsmith verify-run-record --run-id 2026-07-29T23-25-24Z --complete-range 1-2 --project . --json
{"runId":"2026-07-29T23-25-24Z","rangeId":"1-2","action":"range-complete","alreadyRecorded":false}
$ boardsmith verify-run-status --project . --run-id 2026-07-29T23-25-24Z --json
{"runId":"2026-07-29T23-25-24Z","stagingDir":"rulebook/.verify/2026-07-29T23-25-24Z/slices",
 "recorded":["01-about-and-setup","01-round","01-game-end-and-match","01-definitions",
             "01-distribution-of-cards","02-solo-variant"],
 "count":6,"ranges":["1-2"],"rangesRecorded":["1-2"],"rangesPending":[]}
```

`rangesPending: []` — the run is complete.

**Staged-vs-live count, seven:** 6 staged files vs. 3 live rule slices
(`01-definitions-and-components.md`, `01-overview-setup-and-play.md`, `02-solo-variant.md` — a
4th live file, `00-visual-survey.md`, is not a rule slice). This is the exact m:n asymmetry
`173-PROOF.md` measured for this exact game (6 staged vs. 3 live) — reproduced, not merely
predicted, and it is exactly what plan 174-03's pairing must handle.

#### one-two-punch — run-init, dispatch, recording

```
$ boardsmith verify-run-init --project . --ranges '["1-2"]' --json
{
  "runId": "2026-07-29T23-28-06Z",
  "stagingDir": "rulebook/.verify/2026-07-29T23-28-06Z/slices",
  "ledgerPath": "rulebook/.verify/2026-07-29T23-28-06Z/RUN.md",
  "created": true,
  "ranges": ["1-2"]
}
```

Dispatch prompt (same pointer block, this run's `stagingDir` substituted):

```
BS-DISPATCH-V2

Read `.claude/skills/bs-shared/ingest/transcription-subagent.md` in full and follow it exactly.

Your page range: 1-2
Rulebook path:   rulebook/source/rules.pdf
Write slices to: rulebook/.verify/2026-07-29T23-28-06Z/slices
```

```
$ claude -p "<above>" --allowedTools Read,Write,Bash
```

Exit 0. The subagent returned a structured summary for 6 sections (`01-overview-setup.md`,
`01-round-structure.md`, `02-action-cards.md`, `02-end-of-game.md`,
`02-punch-examples-discard.md`, `02-tips.md`), correctly flagging inline that
`01-round-structure.md`'s third phase continues across the p.1/p.2 seam into
`02-punch-examples-discard.md` — the exact "section rarely spans a page-range seam cleanly"
behavior the contract instructs it to note.

Grepped independently for slice-body markers in the raw return — zero matches:

```
$ grep -c '^p\.[0-9]*,' subagent-otp-return.txt        -> 0
$ grep -c '^Derived (p\.' subagent-otp-return.txt       -> 0
$ grep -c '^Visual (p\.' subagent-otp-return.txt        -> 0
```

Six staged files confirmed present on disk:

```
rulebook/.verify/2026-07-29T23-28-06Z/slices/01-overview-setup.md
rulebook/.verify/2026-07-29T23-28-06Z/slices/01-round-structure.md
rulebook/.verify/2026-07-29T23-28-06Z/slices/02-action-cards.md
rulebook/.verify/2026-07-29T23-28-06Z/slices/02-end-of-game.md
rulebook/.verify/2026-07-29T23-28-06Z/slices/02-punch-examples-discard.md
rulebook/.verify/2026-07-29T23-28-06Z/slices/02-tips.md
```

Recording (all 6 units + `--complete-range`):

```
$ boardsmith verify-run-status --project . --run-id 2026-07-29T23-28-06Z --json
{"runId":"2026-07-29T23-28-06Z","stagingDir":"rulebook/.verify/2026-07-29T23-28-06Z/slices",
 "recorded":["01-overview-setup","01-round-structure","02-action-cards","02-end-of-game",
             "02-punch-examples-discard","02-tips"],
 "count":6,"ranges":["1-2"],"rangesRecorded":["1-2"],"rangesPending":[]}
```

`rangesPending: []` — the run is complete.

**Staged-vs-live count, one-two-punch:** 6 staged files vs. 2 live rule slices
(`01-setup-and-round-structure.md`, `02-action-cards-and-resolution.md` — a 3rd live file,
`00-visual-survey.md`, is not a rule slice). A 3x fan-out, more pronounced than `seven`'s 2x —
further real evidence for the m:n pairing requirement.

### Live slices proven untouched by pass 2 (both games)

Every pre-existing live `rulebook/*.md` file's sha256 checked against the whole-tree manifest
captured BEFORE any pass-2 activity:

| File | seven | one-two-punch |
|---|---|---|
| `00-visual-survey.md` | MATCH | MATCH |
| `01-*` rule slice(s) | MATCH (`01-definitions-and-components.md`, `01-overview-setup-and-play.md`) | MATCH (`01-setup-and-round-structure.md`) |
| `02-*` rule slice(s) | MATCH (`02-solo-variant.md`) | MATCH (`02-action-cards-and-resolution.md`) |

Pass 2 wrote nothing over pass 1, for either game.

### Transcript observable — zero slice-body-shaped lines from the orchestrator's own reads

This section's own transcript (the commands and outputs pasted above) contains no line matching
`^p\.[0-9]*,`, `Derived (p\.`, or `Visual (p\.` that originates from the orchestrator opening a
live or staged slice directly — every such string appearing above is either a command's own JSON
output (unit ids, paths, hashes) or reported by direct grep count, never a slice body pasted in.
The orchestrator did not open `rulebook/*.md` or any `rulebook/.verify/*/slices/*.md` file at any
point in this section; all live-slice/staged-slice content facts above come from `ls`, `shasum`,
`diff`, and `grep -c` (count only) invocations.

**GATE: PASSED (Task 2, both games)**

---

### Task 3 — Fixture archival and presentation-marker inventory

Fixtures copied byte-unmodified from the scratch copies into
`.planning/phases/174-verify-classifier/174-FIXTURES/<game>/{live,staged}/`, plus each run's
`RUN.md` ledger and a per-game `INDEX.md`. `174-FIXTURES/MANIFEST.md` records both source repo
HEAD hashes, both run-ids, the exact reproducible command sequence, and a table of all 23 archived
files' `shasum -a 256` values with their scratch-copy origin paths.

**Independent hash verification** — every one of the 23 archived files' sha256 recomputed fresh
against the table row that names it:

```
23/23 match
```

### Presentation-marker inventory (decision 12b basis)

Counts measured directly against the archived fixtures (`174-FIXTURES/<game>/{live,staged}/`),
via the four greps decision 12b's exclusion set needs:

| Game | Side | `^Visual (p\.` | `^Derived (p\.N) — diagram description` | `^Derived (p\.N) — art` | total `^Derived (p\.` |
|---|---|---|---|---|---|
| `seven` | live | 0 | 0 | 0 | 10 |
| `seven` | staged | 10 | 0 | 0 | 21 |
| `one-two-punch` | live | 0 | 5 | 1 | 12 |
| `one-two-punch` | staged | 19 | 0 | 0 | 40 |

Commands run (per game, per side, against the archived fixture directory):

```
grep -rn '^Visual (p\.' <dir> | wc -l
grep -rEn '^Derived \(p\.[0-9]+\) — diagram description' <dir> | wc -l
grep -rEn '^Derived \(p\.[0-9]+\) — art' <dir> | wc -l
grep -rn '^Derived (p\.' <dir> | wc -l
```

**These numbers match `174-RESEARCH.md`'s own measurement of the real, untouched originals
exactly** — 5 `diagram description` + 1 `art` of 12 total live `Derived` lines in
`one-two-punch`, 0 of 10 in `seven`, zero `Visual (p.` lines on either game's LIVE side. No
contradiction to report; the schema-asymmetry finding this task exists to re-measure against real
pass-2 output holds. The pass-2 (staged) side of both games DOES carry real `Visual (p.N):`
lines (10 in `seven`, 19 in `one-two-punch`) — confirming the two sides of every real pair really
are on different schemas, exactly as `174-RESEARCH.md` predicted and `173-PROOF.md` §3 first
observed live for `seven` alone.

**Other qualifier forms:** a grep for every `^Derived (p.N) — <qualifier>` shape across all
archived files (both games, both sides) found only the two known qualifiers:

```
$ grep -rhoE '^Derived \(p\.[0-9]+\) — [^:(]+' <all fixture dirs> | sed -E 's/^Derived \(p\.[0-9]+\) — //' | sort | uniq -c
   1 art
   5 diagram description
```

No third legacy presentation qualifier exists in the real data. Decision 12b's enumerated
exclusion constant needs to cover exactly these two forms (`diagram description`, `art`) — no
more.

### Originals re-verification (post-run)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(still empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```

Whole-tree sha256 manifest diff, before vs. after, both games:

```
$ diff "$SCRATCH/seven.before" "$SCRATCH/seven.after"
(empty, exit 0)
$ diff "$SCRATCH/otp.before" "$SCRATCH/otp.after"
(empty, exit 0)
```

Both originals byte-identical before and after this plan's entire run.

**GATE: PASSED (Task 3)**

---

## What this plan did NOT prove

1. **True internal Task/Agent-tool dispatch.** As in `173-PROOF.md` §3, this executor's available
   tools do not expose an internal Task tool; a real `claude -p` OS-process subprocess stood in as
   the closest faithful equivalent. The zero-slice-body-line observable proven here is real for
   this dispatch mechanism; a session with native Task-tool access has not been separately
   confirmed to exhibit the same property (plausible given the identical contract file and
   structured-return shape, not directly observed).
2. **Multi-range / multi-dispatch fan-out.** Both games' 2-page rulebooks fit in a single
   page-range dispatch, matching Phase 173's own precedent; parallel-dispatch races and
   large-rulebook range division were not exercised here (nor were they in scope for this plan).
3. **A third or later re-transcription of the same source.** Only one pass-2 run per game was
   produced — sufficient for this plan's fixture-production purpose, but not a repeated-dispatch
   determinism measurement (that is plan 174-0x's later job per decision 16).

---

## 2. SC-1 / SC-2 — a real classification pass

### The bar, declared before measuring

Verbatim, written and committed before any verdict from this pass exists:

> ≥90% of paired, rule-bearing slice pairs classify `cosmetic`, and zero classify `contradictory`.
> Missing the bar is a phase BLOCKER, not a note. The percentage is computed over paired
> rule-bearing pairs only, so presentation-only groups can neither inflate nor deflate it.

**Amendment applied (CONTEXT.md decision 14b, added after this plan was authored — supersedes the
bar's DENOMINATOR, not its threshold or its blocker status):** decision 4's second amendment
(174-03-SUMMARY.md's corrective follow-up) measured that both reference games' real transcribed
content pairs into exactly ONE rule-bearing group each — genuine cross-page prose bridges every
page span into a single connected component, not a fixable pairing-algorithm defect. A "≥90%"
threshold evaluated over 1-2 groups is arithmetic theatre: one group flipping moves the number
50-100 points, and the bar is literally unreachable at 90% except by scoring 100%.

Therefore, per decision 14b: **the ≥90%-cosmetic / zero-`contradictory` bar above is evaluated
against RULE-BEARING LINE-LEVEL comparisons, pooled across both reference games — not pair-group
counts.** Group-level verdicts are still reported below (decision 18: they are what downstream
staleness keys off structurally, even though decision 18 also requires chunk-level staleness to be
computed from line-level quote attribution, never from the group verdict wholesale), but the BAR
itself is the line-level percentage. Per decision 17, presentation lines excluded by decision 12b's
dual-schema filter are in NEITHER numerator nor denominator of either count. If the bar is missed,
decision 17 requires checking the exclusion filter's completeness before concluding the classifier
over-flags.

This block is committed in isolation, before the reconstituted material is even restored, so the
git history on this file itself is the evidence the bar was not retrofitted to the result.
