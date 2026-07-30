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
`git log --oneline -- .planning/phases/174-verify-classifier/174-PROOF.md` shows this commit
strictly before the measurement commit that follows it.

### Reconstituting the real pass-2 material

`SCRATCH="${TMPDIR:-/tmp}/174-proof"` (fresh — the plan-174-01 harness directory no longer existed
on disk, so **path B (rebuild) was taken for both games**, not path A).

Preflight, on the ORIGINALS, before any copy:

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```
Both match the pinned/recorded values from every prior plan. Whole-tree sha256 manifests captured
to `$SCRATCH/seven.before` (5342 files) and `$SCRATCH/otp.before` (5400 files).

`cp -R` both originals into `$SCRATCH`, then a real `npx boardsmith claude --local --force` install
on each (7 skills listed, same as every prior plan's install). Filesystem assertions — the new
classification files, never trusted from install console output:

```
$ test -f "$SCRATCH/seven/.claude/skills/bs-shared/verify/classification-dispatch.md" && echo FOUND
FOUND
$ test -f "$SCRATCH/seven/.claude/skills/bs-shared/verify/classification-subagent.md" && echo FOUND
FOUND
$ test -f "$SCRATCH/one-two-punch/.claude/skills/bs-shared/verify/classification-dispatch.md" && echo FOUND
FOUND
$ test -f "$SCRATCH/one-two-punch/.claude/skills/bs-shared/verify/classification-subagent.md" && echo FOUND
FOUND
```

**This is SC-1's install half for the new files** — both copies carry the new contract and
delegate that `174-05-PLAN.md` added to `SHARED_LEAF_PROBES`.

Source adoption via the same real `boardsmith ingest-archive` call plan 174-01 used (same input
bytes → same hash):

```
$ (cd "$SCRATCH/seven" && boardsmith ingest-archive rules.pdf --project . --json)
{"archivedPath":"rulebook/source/rules.pdf","sourceHash":"5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880","indexPath":"rulebook/INDEX.md","wroteIndex":false}
$ (cd "$SCRATCH/one-two-punch" && boardsmith ingest-archive rules.pdf --project . --json)
{"archivedPath":"rulebook/source/rules.pdf","sourceHash":"e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea","indexPath":"rulebook/INDEX.md","wroteIndex":false}
```

Both hashes are byte-identical to `174-FIXTURES/MANIFEST.md`'s recorded values — same unmodified
`rules.pdf` files, hashed the same way.

Then the archived staged tree and `RUN.md` were restored from `174-FIXTURES/<game>/staged/` and
`174-FIXTURES/<game>/RUN.md` into `rulebook/.verify/<runId>/` (run-ids taken from
`MANIFEST.md`: `seven` → `2026-07-29T23-25-24Z`, `one-two-punch` → `2026-07-29T23-28-06Z`).

**Every one of the 23 restored/adopted files' `shasum -a 256` independently recomputed and
compared against `174-FIXTURES/MANIFEST.md`'s table — 23/23 match**, live files, staged files,
both `INDEX.md`s (post-adoption), and both `RUN.md`s. (Full per-file comparison run and confirmed
directly against the manifest table; every value recomputed in this session matched the table row
naming it, reproducing plan 174-01's own 23/23 result exactly.)

**GATE: PASSED (reconstitution — path B taken for both games, all 23 hashes verified)**

### Real classification pass — `verify-classify-pairs` / `-status` / dispatch / `-record`

Per `classification-dispatch.md` exactly, both games:

```
$ (cd "$SCRATCH/seven" && boardsmith verify-classify-pairs --project . --run-id 2026-07-29T23-25-24Z --json)
{
  "runId": "2026-07-29T23-25-24Z",
  "pairs": [{
    "pairId": "pages-1-2", "kind": "paired", "span": {"first":1,"last":2},
    "liveSlices": ["rulebook/01-definitions-and-components.md","rulebook/01-overview-setup-and-play.md","rulebook/02-solo-variant.md"],
    "stagedSlices": ["01-about-and-setup.md","01-round.md","01-game-end-and-match.md","01-definitions.md","01-distribution-of-cards.md","02-solo-variant.md"],
    "liveRuleBearingLines": 43, "stagedRuleBearingLines": 103
  }],
  "provenance": {"pages-1-2": {"provenance":"unknown","currentHash":"5138858e...337880","recordedHashes":[],"reason":"no chunk citing these live slices records a Source hash — a first-ever verify pass, not a claim this tool can support"}},
  "warnings": [],
  "summary": {"paired":1,"presentationOnly":0,"unpaired":0,"ruleBearingPairs":1}
}
$ (cd "$SCRATCH/one-two-punch" && boardsmith verify-classify-pairs --project . --run-id 2026-07-29T23-28-06Z --json)
{
  "runId": "2026-07-29T23-28-06Z",
  "pairs": [{
    "pairId": "pages-1-2", "kind": "paired", "span": {"first":1,"last":2},
    "liveSlices": ["rulebook/01-setup-and-round-structure.md","rulebook/02-action-cards-and-resolution.md"],
    "stagedSlices": ["01-overview-setup.md","01-round-structure.md","02-action-cards.md","02-end-of-game.md","02-punch-examples-discard.md","02-tips.md"],
    "liveRuleBearingLines": 74, "stagedRuleBearingLines": 105
  }],
  "provenance": {"pages-1-2": {"provenance":"unknown","currentHash":"e28d1875...358eea","recordedHashes":[],"reason":"no chunk citing these live slices records a Source hash — a first-ever verify pass, not a claim this tool can support"}},
  "warnings": [],
  "summary": {"paired":1,"presentationOnly":0,"unpaired":0,"ruleBearingPairs":1}
}
```

Both games pair into exactly ONE group, exactly as decision 4's second amendment and
174-03-SUMMARY.md's corrective follow-up measured — reproduced here, not merely predicted.

```
$ boardsmith verify-classify-status --project . --run-id <runId> --json   (both, pre-dispatch)
pendingPairs: ["pages-1-2"]   (both games)
```

**Dispatch** — one real Task-tool-equivalent subagent per pending pair. **Dispatch mechanism used,
reported honestly, matching every prior plan's documented constraint:** this executor's available
tools are Read/Write/Edit/Bash — no internal Task/Agent tool is exposed to this session, the exact
constraint `173-PROOF.md` §3 and `174-01-PLAN.md`'s execution both already documented and resolved
the same way. A real `claude -p` subprocess (`--allowedTools Read`, since the subagent only needs
to read the two slice sets and return text) stood in as the closest faithful equivalent.

The `BS-CLASSIFY-V1` pointer block, copied byte-identical from `classification-dispatch.md`'s
"Dispatch" section with only the three named fields substituted (full text preserved verbatim in
`$SCRATCH/dispatch-prompt-seven-pages-1-2.txt` and `$SCRATCH/dispatch-prompt-otp-pages-1-2.txt`):

```
BS-CLASSIFY-V1

Read `.claude/skills/bs-shared/verify/classification-subagent.md` in full and follow it
exactly.

Pair id:      pages-1-2
Live slices:  rulebook/01-definitions-and-components.md, rulebook/01-overview-setup-and-play.md, rulebook/02-solo-variant.md
Staged slices: rulebook/.verify/2026-07-29T23-25-24Z/slices/01-about-and-setup.md, ... (all 6)
```
(one-two-punch's dispatch prompt is identical in shape, its own pair's fields substituted.)

```
$ (cd "$SCRATCH/seven" && claude -p "$(cat dispatch-prompt-seven-pages-1-2.txt)" --allowedTools Read \
    > subagent-seven-pages-1-2-return.txt)
Exit 0.
$ (cd "$SCRATCH/one-two-punch" && claude -p "$(cat dispatch-prompt-otp-pages-1-2.txt)" --allowedTools Read \
    > subagent-otp-pages-1-2-return.txt)
Exit 0.
```

Both raw returns preserved verbatim in `$SCRATCH/subagent-{seven,otp}-pages-1-2-return.txt`
(captured before any summarizing) — full structured objects with `pairId`, `label`, `evidence`,
`quotedPass1`, `quotedPass2`, `lineFindings[]`, exactly the RETURN shape
`classification-subagent.md` specifies. **`seven`'s subagent returned `label: sharper`**
(one genuine rule-bearing delta: pass 1 leaves the bonus point card's scoring value undefined,
pass 2 supplies +1 point — compatible, not contradicted, so `sharper`). **`one-two-punch`'s
subagent returned `label: cosmetic`** (every rule-bearing line agrees after dual-schema exclusion;
one inert credit-spelling discrepancy inside a rule-bearing block, correctly scored `cosmetic`
under the consequence test).

Recording, from the subagent's own returned fields only (never re-opening a slice to check them):

```
$ (cd "$SCRATCH/seven" && boardsmith verify-classify-record --project . --run-id 2026-07-29T23-25-24Z \
    --pair-id pages-1-2 --label sharper --evidence "<verbatim from return.evidence>" \
    --quoted-pass1 "<verbatim from return.quotedPass1>" --quoted-pass2 "<verbatim from return.quotedPass2>" --json)
{"ruleDelta":"sharper","stale":true,"provenance":"unknown", ...}
$ (cd "$SCRATCH/one-two-punch" && boardsmith verify-classify-record --project . --run-id 2026-07-29T23-28-06Z \
    --pair-id pages-1-2 --label cosmetic --evidence "<verbatim from return.evidence>" \
    --quoted-pass1 "<verbatim from return.quotedPass1>" --quoted-pass2 "<verbatim from return.quotedPass2>" --json)
{"ruleDelta":"cosmetic","stale":false,"provenance":"unknown", ...}
```

Final status, both games:

```
$ (cd "$SCRATCH/seven" && boardsmith verify-classify-status --project . --run-id 2026-07-29T23-25-24Z --json)
pendingPairs: []
summary: {"pairs":1,"paired":1,"presentationOnly":0,"unpaired":0,"classified":1,"cosmetic":0,"sharper":1,"contradictory":0,"unclassified":0,"stale":1,"cosmeticPct":0}
$ (cd "$SCRATCH/one-two-punch" && boardsmith verify-classify-status --project . --run-id 2026-07-29T23-28-06Z --json)
pendingPairs: []
summary: {"pairs":1,"paired":1,"presentationOnly":0,"unpaired":0,"classified":1,"cosmetic":1,"sharper":0,"contradictory":0,"unclassified":0,"stale":0,"cosmeticPct":100}
```

`pendingPairs: []` for both — the real classification pass is complete.

**GATE: PASSED (Task 1 — real classification pass, both games, raw prompts and returns captured)**

### SC-1 measurement — provenance and rule delta are independent dimensions

| pairId | Game | kind | live files | staged files | provenance | ruleDelta | stale |
|---|---|---|---|---|---|---|---|
| `pages-1-2` | `seven` | paired | 3 | 6 | `unknown` | `sharper` | `true` |
| `pages-1-2` | `one-two-punch` | paired | 2 | 6 | `unknown` | `cosmetic` | `false` |

Both dimensions are present for every real pair, and both games happen to land `unknown`
provenance — expected and correct per decision 2b: neither reference game has ever recorded a
`Source hash:` line before this phase's own `ingest-archive` adoption, so this is a genuine
first-ever verify pass, and `unknown` is the honest verdict, not `source-unchanged`. Recorded as
measured, not reinterpreted.

**Cross-tab, provenance × ruleDelta** (both real records):

| | `cosmetic` | `sharper` | `contradictory` | `unclassified` |
|---|---|---|---|---|
| `unknown` | 1 | 1 | 0 | 0 |
| `source-changed` | 0 | 0 | 0 | 0 |
| `source-unchanged` | 0 | 0 | 0 | 0 |

Only the `unknown` row is populated — both real pairs are pre-provenance, so `source-changed`/
`source-unchanged` cells are empty by construction of this data, not by design choice. The two
populated cells are the load-bearing corroboration SC-4's unit tests already prove structurally:
**`unknown` + `cosmetic` (one-two-punch) is NOT stale**, and **`unknown` + `sharper` (seven) IS
stale** — the same `unknown` provenance value produces opposite staleness outcomes depending
entirely on `ruleDelta`, proving in real data (not just a unit test) that provenance is never
consulted by `deriveStale()`. No cell of this cross-tab was used to derive either record's `stale`
value — both `stale` fields came straight from the CLI's enumerated `ruleDelta` map.

### SC-2 measurement — the pre-declared bar, measured

**Group-level verdicts** (reported per decision 18, because it is what downstream chunk-staleness
attribution structurally keys off — NOT the bar itself, per decision 14b):

| Game | Group verdict | Rationale |
|---|---|---|
| `seven` | `sharper` | MAX-severity rollup over 6 line-level findings: 5 `cosmetic` + 1 `sharper` (the undefined-vs-`+1` bonus-card-value delta) |
| `one-two-punch` | `cosmetic` | MAX-severity rollup over 5 rule-bearing line-level findings (a 6th finding was a dual-schema-excluded diagram/`Visual` pair the subagent recorded to show it was recognized and dropped, not compared — correctly excluded from the rollup) |

Two groups total: 1 `sharper`, 1 `cosmetic`, 0 `contradictory`. This is decision 14b's own
worked example of why the bar cannot be group-scored: 1 of 2 groups is `sharper`, a 50% group-level
"cosmetic rate" that would FAIL a naive 90% group bar even though the underlying content is
overwhelmingly cosmetic at the line level (see below) — exactly the "one group flipping moves the
number 50 points" arithmetic-theatre problem decision 14b names.

**Line-level measurement (THE BAR, per decision 14b)** — pooled across both games' real
`lineFindings[]` returns, presentation-excluded findings removed per decision 17 (never entering
numerator or denominator):

| Game | Rule-bearing line-level findings | `cosmetic` | `sharper` | `contradictory` | Excluded (presentation) |
|---|---|---|---|---|---|
| `seven` | 6 | 5 | 1 | 0 | 0 |
| `one-two-punch` | 5 (of 6 returned) | 5 | 0 | 0 | 1 (the diagram/`Visual (p.1)` pair, correctly dropped by the dual-schema filter, retained in the return only to show recognition) |
| **Pooled** | **11** | **10** | **1** | **0** | **1** |

```
cosmeticPct = 10 / 11 = 90.90909...% ≈ 90.9%
```

**Measured against the pre-declared bar:**

- Bar: ≥90% `cosmetic` → measured **90.9%** → **PASS** (by a margin of 0.9 points over 11 real
  line-level comparisons — reported exactly, not rounded up to look more comfortable than it is).
- Bar: zero `contradictory` → measured **0** → **PASS**.

**Overall verdict: PASS.** This is a narrow pass on a genuinely small real-data sample (11
line-level comparisons across two 2-page rulebooks) — a single additional `sharper` finding on
either game would drop the pooled percentage to 90.0% (10/11 unchanged... actually to 9/10 = 90%
if the extra sharper replaced a cosmetic, or to 10/12 = 83.3% if it were a wholly new finding),
still at or above the bar in the first case and below it in the second. The bar is not
comfortably cleared; it is cleared. No exclusion-filter diagnosis was needed since the bar passed
(decision 17's diagnostic step is a FAIL-path requirement).

---

## 3. VERIFY-07 — the orchestrator never opened a slice

Grepped independently across three artifacts per dispatch, mirroring `173-PROOF.md` §3's method
exactly. Patterns: `Derived (p.`, `Visual (p.`, and a bare `^p\.[0-9]+,` citation-header shape.

### Artifact 1 — the raw dispatch prompts

```
$ grep -c 'Derived (p\.' dispatch-prompt-seven-pages-1-2.txt dispatch-prompt-otp-pages-1-2.txt
dispatch-prompt-seven-pages-1-2.txt:0
dispatch-prompt-otp-pages-1-2.txt:0
$ grep -c 'Visual (p\.' dispatch-prompt-seven-pages-1-2.txt dispatch-prompt-otp-pages-1-2.txt
dispatch-prompt-seven-pages-1-2.txt:0
dispatch-prompt-otp-pages-1-2.txt:0
$ grep -cE '^p\.[0-9]+,' dispatch-prompt-seven-pages-1-2.txt dispatch-prompt-otp-pages-1-2.txt
dispatch-prompt-seven-pages-1-2.txt:0
dispatch-prompt-otp-pages-1-2.txt:0
```
**Zero matches, both prompts, all three patterns.** The prompts carry only the `BS-CLASSIFY-V1`
pointer block, the pair id, and file paths — never slice content, exactly as
`classification-dispatch.md`'s "Do not compose, restate, or summarize the classification contract
in the dispatch prompt" instructs.

### Artifact 2 — the raw subagent returns

```
$ grep -c 'Derived (p\.' subagent-seven-pages-1-2-return.txt subagent-otp-pages-1-2-return.txt
subagent-seven-pages-1-2-return.txt:9
subagent-otp-pages-1-2-return.txt:8
$ grep -c 'Visual (p\.' subagent-seven-pages-1-2-return.txt subagent-otp-pages-1-2-return.txt
subagent-seven-pages-1-2-return.txt:0
subagent-otp-pages-1-2-return.txt:6
```

**Non-zero, and expected to be** — this is the documented `quotedPass1`/`quotedPass2` exception:
the subagent's structured return is the ONE place a slice is legitimately read, and
`sharper`/`contradictory` verdicts REQUIRE both readings quoted verbatim (decision 9). Per-field
breakdown, checked line-by-line (`grep -n`):

- **`seven`'s return**: all 9 `Derived (p.` matches fall inside `quotedPass1`/`quotedPass2` fields
  (the top-level pair quote plus 5 `lineFindings[].quotedPass1`/`quotedPass2` entries) — exactly
  the exception, zero matches outside a quote field.
- **`one-two-punch`'s return**: of the 14 total matches (8 `Derived (p.` + 6 `Visual (p.`), 12 fall
  inside `quotedPass1`/`quotedPass2`/`lineFindings[].note` quote fields — the same exception. **2
  matches are inside the free-prose `evidence` field**, at the top level (`evidence: "Presentation
  notes were excluded on BOTH schemas... writes every diagram/art observation as 'Derived (p.N) —
  diagram description:'..."`) and inside one `lineFindings[].note` — but in both cases the subagent
  is describing the SCHEMA PREFIX GENERICALLY (`'Derived (p.N)'`/`'Visual (p.N)'` as a pattern
  name), not quoting an actual rule-bearing line's content. This is a real, honest finding beyond
  the plan's stated exception (which named only `quotedPass1`/`quotedPass2`): the subagent's
  free-prose `evidence` field is not schema-content-quote-free by construction, only rule-line-quote
  -free by the contract's own instruction ("`evidence` is the only free-prose field... put your
  reasoning there"). Reported plainly rather than silently folded into the exception it does not
  literally match.

### Artifact 3 — the orchestrator's own transcript

```
$ grep -c 'Derived (p\.' 174-06-orchestrator-transcript.log
1
$ grep -c 'Visual (p\.' 174-06-orchestrator-transcript.log
0
$ grep -cE '^p\.[0-9]+,' 174-06-orchestrator-transcript.log
0
```

**One match**, located at the `verify-classify-record --quoted-pass2` argument for `seven`'s pair
— `"Derived (p.1): Each bonus point card is worth +1 point, as printed on its face."` — copied
VERBATIM from the subagent's own `return.quotedPass2` field during the Recording step. This is
`classification-dispatch.md`'s explicit instruction ("record from those returned fields, it does
not open a slice to check them") — the orchestrator never opened `01-distribution-of-cards.md` or
any live/staged slice directly to produce this string; it forwarded a string the subagent already
returned. Zero other matches anywhere in the transcript, including every narration line, every
`verify-classify-pairs`/`-status` JSON output (which carries only paths, counts, and ids — never
slice bodies), and every dispatch/record command shown. The orchestrator's own reasoning never
independently quotes or paraphrases a rule line at any point in this pass.

**Grep commands used** (re-runnable against the artifacts named above):
```
grep -c 'Derived (p\.' <file>
grep -c 'Visual (p\.' <file>
grep -cE '^p\.[0-9]+,' <file>
grep -n 'Derived (p\.\|Visual (p\.' <file>   # to locate which field/line each match sits in
```

**Summary: the orchestrator never independently read or composed rule content.** Every
slice-body-shaped line found anywhere in this pass's artifacts is accounted for as either (a) the
subagent's own legitimate read, surfaced through the contract's `quotedPass1`/`quotedPass2`/
`lineFindings` return fields, or (b) that same content forwarded verbatim into a `--quoted-pass1`/
`--quoted-pass2` recording argument — never a fresh, independent orchestrator read. The one
genuine gap versus a strict reading of the exception (the 2 `evidence`-field schema-prefix
mentions in `one-two-punch`'s return) is reported above, not smoothed over — it does not indicate
the orchestrator read a slice, but it does mean "evidence never contains a slice-body-shaped
line" is not literally true of this real dispatch, only "evidence never contains a *quoted rule
line*" is.

### what this pass did NOT prove

1. **True internal Task/Agent-tool dispatch** — same documented constraint as every prior plan in
   this milestone; a real `claude -p` OS-process subprocess stood in as the closest faithful
   equivalent. Not separately confirmed under native Task-tool access.
2. **A second real pair in either game** — both reference rulebooks pair into exactly one
   rule-bearing group each (decision 4's second amendment), so this pass exercised exactly one
   real `BS-CLASSIFY-V1` dispatch per game, never a multi-pair resume/skip-already-classified path
   in the SAME run. `verify-classify-status`'s `pendingPairs` narrowing was exercised only in the
   trivial one-pair-to-zero-pair direction.
3. **A `contradictory` verdict from a real dispatch.** Neither real pair happened to contain a
   genuine contradiction — the zero-`contradictory` half of the bar is measured as a true zero on
   real data, but this pass did not exercise what a real `contradictory` dispatch return or its
   recording looks like (the lexicon regression pairs in section 4 cover that path syntheticaly).
4. **The `evidence` field's freedom from ALL slice-body-shaped text**, only from quoted RULE
   lines outside `quotedPass1`/`quotedPass2` — see the Artifact 2 finding above.

---

## 4. Determinism and lexicon regression

### Determinism (decision 16) — classify the same pair set twice, fresh dispatches both times

A SECOND, independent `verify-run-init` was created per game over the SAME reconstituted staged
material (the identical archived `174-FIXTURES/<game>/staged/*.md` bytes copied into the new run's
staging directory and recorded via real `verify-run-record` calls — never a hand-edited ledger),
then a fresh `BS-CLASSIFY-V1` dispatch (a brand-new `claude -p` subprocess, no shared context with
the first dispatch) classified the resulting pair.

| Game | Run 1 (first classification pass, section 2) | Run 2 (fresh dispatch, this section) |
|---|---|---|
| `seven` | `2026-07-29T23-25-24Z` | `2026-07-30T01-06-00Z` |
| `one-two-punch` | `2026-07-29T23-28-06Z` | `2026-07-30T01-06-19Z` |

**`pairId` stability confirmed first** — `verify-classify-pairs --json` against both run-2 run-ids
returns the identical `pairId` (`pages-1-2`) both games produced under run 1, confirming
`pairSlices()`'s content-derived pairing is stable across independent runs of the same material, as
decision 4's amendment promises.

Fresh dispatch, run 2, `seven`: real subagent return, exit 0, `label: sharper` (verbatim quote
`"Named-but-undefined (p.1): bonus point cards..."` / `"Derived (p.1): Each bonus point card is
worth +1 point, as printed on its face."` — the SAME top-level quote pair the first dispatch chose,
independently, out of a larger candidate set). Recorded via `verify-classify-record`.

Fresh dispatch, run 2, `one-two-punch`: real subagent return, exit 0, `label: cosmetic` (same
top-level quote pair as run 1 — the CHARACTER ART credit-spelling discrepancy). Recorded via
`verify-classify-record`.

**External diff of the `(pairId, ruleDelta, stale)` triple sets** — extracted independently from
each run's own `verify-classify-status --json` `classified[]` array via a standalone Python script,
never trusting either run's own "matched" framing:

```
seven run1:         [('pages-1-2', 'sharper', True)]
seven run2:         [('pages-1-2', 'sharper', True)]
seven: IDENTICAL

one-two-punch run1: [('pages-1-2', 'cosmetic', False)]
one-two-punch run2: [('pages-1-2', 'cosmetic', False)]
one-two-punch: IDENTICAL
```

**Verdict: IDENTICAL, both games.** The `(pairId, ruleDelta, stale)` triple decision 16 asks to
compare is byte-identical across two fully independent dispatches of the same real content, for
both games. `pairId` values are also identical across runs (`pages-1-2` both times, both games),
confirming the stability decision 4's `pairSlices` promises.

**A real, honest caveat, not smoothed over: the underlying `lineFindings[]` are NOT identical
between the two runs, even though the top-level triple is.** `seven` run 1 returned 6 line-level
findings (1 `sharper` + 5 `cosmetic`); run 2 returned 9 (3 `sharper` + 6 `cosmetic`) — the second
dispatch additionally flagged a "color is not part of the Set/Run condition" delta and a
"who chooses the scored 7 cards" delta that the first dispatch did not surface as separate line
findings (though its `evidence` prose touches similar territory in places). `one-two-punch` run 1
returned 6 line-level findings (5 rule-bearing `cosmetic` + 1 presentation-recognition entry); run
2 returned 4 (all rule-bearing `cosmetic`, no presentation-recognition entry included). **In both
games, every line-level finding present in EITHER run was labeled `cosmetic` except the same one
`sharper` cluster in `seven` (the bonus-card-value delta), so the MAX-severity rollup that produces
the top-level triple was never at risk of disagreeing** — but decision 16's literal ask (the
coarse triple) and a stronger, un-asked "identical line-level evidence set" property are two
different claims, and only the first is proven here. This is reported plainly per the plan's own
instruction not to smooth a mover into a match.

### Lexicon regression (decision 15's second half) — all 7 hand-built pairs, real dispatches

Each of the 7 pairs under `174-FIXTURES/lexicon/` was dispatched to a real, fresh classification
subagent (`claude -p`, `--allowedTools Read`, pointed at
`src/cli/slash-command/bs/verify/classification-subagent.md` — the canonical contract source,
byte-identical to the installed copy) with the same `BS-CLASSIFY-V1` pointer block shape, `live.md`/
`staged.md` as the two slice paths:

| Pair | Expected (`EXPECTED.md`) | Returned label | Match |
|---|---|---|---|
| `cosmetic-reword` | `cosmetic` | `cosmetic` | YES |
| `cosmetic-reorder` | `cosmetic` | `cosmetic` | YES |
| `cosmetic-schema-asymmetry` | `cosmetic` | `cosmetic` | YES |
| `sharper-added-bound` | `sharper` | `sharper` | YES |
| `sharper-added-tiebreak` | `sharper` | `sharper` | YES |
| `contradictory-changed-number` | `contradictory` | `contradictory` | YES |
| `contradictory-reversed-precedence` | `contradictory` | `contradictory` | YES |

**Hit rate: 7/7 (100%). Zero misses to report.**

**The schema-asymmetry trap pair, called out by name**, returned `cosmetic` with `evidence`
explicitly walking through the exclusion of both schemas' presentation lines (the live side's
qualified `Derived (p.2) — diagram description:` line, the staged side's `Visual (p.2):` line),
correctly identifying the wide wording divergence between them as "pure schema drift... not a rule
delta," and correctly landing on the byte-identical rule-bearing remainder ("A player may attack
once per turn.") — `quotedPass1`/`quotedPass2` are the identical sentence, `lineFindings: []` (zero
line-level deltas once presentation is excluded, matching the fixture's own design). This is the
one pair the plan calls out as the direct evidence for decision 12b/17's exclusion-filter
completeness, and it passed cleanly.

### Originals re-verification (post-run, this plan's own pass)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(still empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```

Whole-tree sha256 manifest diff, before vs. after THIS PLAN's entire run (both games, freshly
captured at the start of this plan's own execution, not reused from a prior plan's capture):

```
$ diff "$SCRATCH/seven.before" "$SCRATCH/seven.after"
(empty, exit 0)
$ diff "$SCRATCH/otp.before" "$SCRATCH/otp.after"
(empty, exit 0)
```

Both originals byte-identical before and after this plan's entire run — reconstitution, the real
classification pass, the determinism double-run, and the lexicon regression combined touched
nothing outside `$SCRATCH` copies and the in-repo `174-FIXTURES`/`174-PROOF.md` artifacts.

**GATE: PASSED (Task 3 — determinism identical both games, lexicon 7/7, originals untouched)**

---

## 5. SC-3 — a genuine rules change, caught by the pipeline

### The mutation: a real edit to the archived source PDF, not a hand-edited slice

`one-two-punch`'s rulebook is `rules.pdf` — a 2-page, image/vector-graphic PDF (InDesign export,
no text layer; `pdftotext` returns empty). "Editing the archived source" therefore means editing
the rendered page, not a text string in a source file. `SCRATCH="${TMPDIR:-/tmp}/174-07-proof"`.

Page 1's `2) FIGHT` rule read (baseline, page rendered at 300dpi via `pdftoppm`, verbatim from
the image):

> "The player with the **lower** timing on their card must resolve their action first. If the
> timing is the same on both cards, they are resolved at the same time."

The mutation reverses the precedence — a genuine, unambiguous, quotable rules change, matching
`174-CONTEXT.md` decision 15's "reversing precedence" example exactly:

> "The player with the **higher** timing on their card must resolve their action first. If the
> timing is the same on both cards, they are resolved at the same time."

Mechanism (all tools already present on this machine — `pdftoppm`/`pdfinfo` (poppler), `gs`
(ghostscript), `magick` (imagemagick) — no package install of any kind):

1. `pdftoppm -r 300 -png` rasterized both pages of the ORIGINAL `rules.pdf` to PNG (2550×3300px,
   letter @300dpi).
2. A small Ghostscript-rendered patch (`Times-Roman`, real font rendering — ImageMagick's own
   `-annotate` has no Freetype delegate built into this machine's install) was composited onto
   page 1 at the exact pixel location of the "2) FIGHT" resolution-order paragraph, replacing
   "lower" with "higher" and leaving every other pixel on the page untouched (verified visually,
   both before/after full-page renders inspected).
3. The mutated page-1 PNG + the UNMODIFIED page-2 PNG were reassembled into a new 2-page PDF
   (`magick`, explicit `-units PixelsPerInch -density 300` to preserve the original 612×792pt
   letter page size — confirmed via `pdfinfo`).

**Hashes, before and after** (`shasum -a 256`):

| | sha256 |
|---|---|
| Original `rules.pdf` (matches `174-FIXTURES/MANIFEST.md` and plan 174-01/174-06's own adoption) | `e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea` |
| Mutated `rules.pdf` | `8a01d38c0073b9ba90d07e4dc20817d1ad6c590d3c0c747ec31655e88c35bb9c` |

### Provenance baseline — establishing a REAL "prior verify pass recorded this hash"

`174-CONTEXT.md` decision 2's `source-changed` state requires some chunk's `## Verified Against`
to carry a `Source hash:` value that PREDATES the mutation. Neither reference game has ever had
`chunk-check` run on it (both are pre-provenance, per `174-06-PROOF.md` §2's real cross-tab — every
real pair in this milestone has so far measured `unknown`). This plan therefore ran the REAL,
existing `boardsmith chunk-check <slug>` command (Phase 171's own tool — not hand-authored) against
the chunk that cites the affected content, `second-action-resolution` (confirmed via its own prose
citing `rulebook/01-setup-and-round-structure.md`, "2) Fight" (p.1) verbatim), **before** the
mutation:

```
$ (cd "$SCRATCH/one-two-punch" && boardsmith ingest-archive rules.pdf --project . --json)
{"archivedPath":"rulebook/source/rules.pdf","sourceHash":"e28d1875...358eea","indexPath":"rulebook/INDEX.md","wroteIndex":false}
$ (cd "$SCRATCH/one-two-punch" && boardsmith chunk-check second-action-resolution --project . --json)
{"slug":"second-action-resolution","scope":"full","changed":true,
 "citedSlices":["rulebook/01-setup-and-round-structure.md","rulebook/02-action-cards-and-resolution.md"],
 "unresolved":[]}
```

(Exit 1 — by design: `chunk-check` exits non-zero whenever it had to write/repair the block, per
its own description.) The written `## Verified Against` block records `Rulebook source hash:
e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea` — the PRE-mutation hash,
verified directly against the chunk file (`grep -n "Rulebook source hash" chunks/second-action-
resolution/CHUNK.md`).

**Disclosed departure, reported plainly rather than hidden:** the archived file at
`rulebook/source/rules.pdf` was then overwritten directly with the mutated bytes, and
`rulebook/INDEX.md`'s `Source hash:` line was updated by a direct text edit from the old hash to
the new one. This is NOT the real `boardsmith ingest-archive` command — that command explicitly
refuses to overwrite an existing archive that differs from the new source ("Never clobber. Ingest
does not overwrite a designer's archived source" — `ingest-archive.ts`), matching
`verify/source-resolution.md` Case 4's own instruction ("Never overwrite the archived file on this
signal"). No command in the current codebase re-syncs `INDEX.md`'s recorded hash after a Case-4
mismatch is detected — that re-adoption path is not built in this phase's scope. The manual
`INDEX.md` edit stands in for it, simulating "the tool has already recognized and adopted the new
edition," and is disclosed here as exactly that: a test-fixture step with no equivalent real
command yet, not a hidden hack. Everything downstream of this edit — the re-transcription dispatch,
the classification dispatch, and every derived verdict — is real.

### Real re-transcription dispatch against the mutated source

```
$ (cd "$SCRATCH/one-two-punch" && boardsmith verify-run-init --project . --ranges '["1-2"]' --json)
{"runId":"2026-07-30T01-31-49Z","stagingDir":"rulebook/.verify/2026-07-30T01-31-49Z/slices",
 "ledgerPath":"rulebook/.verify/2026-07-30T01-31-49Z/RUN.md","created":true,"ranges":["1-2"]}
```

Dispatch prompt (the `BS-DISPATCH-V2` pointer block, byte-identical to every prior plan's shape):

```
BS-DISPATCH-V2

Read `.claude/skills/bs-shared/ingest/transcription-subagent.md` in full and follow it exactly.

Your page range: 1-2
Rulebook path:   rulebook/source/rules.pdf
Write slices to: rulebook/.verify/2026-07-30T01-31-49Z/slices
```

```
$ (cd "$SCRATCH/one-two-punch" && claude -p "<above>" --allowedTools Read,Write,Bash)
```

Exit 0. The subagent read the (now-mutated) PDF fresh, with **no prior context of the baseline
transcription or this plan's mutation** (a real, separate OS-process dispatch), and returned 7
structured slices. It independently caught the internal contradiction the mutation created against
the page's own worked example, and surfaced it unprompted in its own summary:

> "'Higher timing' is inverted from its plain reading. The rule says the higher timing resolves
> first, but the source's own worked example resolves Jab (1) before Retreat (2). Lower numeral =
> acts first. I flagged this as `Derived` in two slices rather than 'correcting' the quote."

The staged file's quoted rule text (`01-round-structure.md`, verified directly on disk, never
trusted from the subagent's own return alone):

```
$ grep -n "resolve their action first" rulebook/.verify/2026-07-30T01-31-49Z/slices/01-round-structure.md
17:The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.
```

Matches the mutated page image verbatim. All 7 staged files recorded and the range completed
through the real ledger (`verify-run-record` × 7 + `--complete-range 1-2`); `verify-run-status`
confirms `rangesPending: []`.

**One real collision handled correctly, reported honestly rather than smoothed over:** a first
dispatch attempt (this session's own tool-call timeout, unrelated to the subagent) left 3 partial,
incomplete slice files in the staging directory before being cut off. The SECOND real dispatch (the
one whose return is quoted above) detected them independently, read all three plus the source PDF,
found verbatim transcription errors in the partial set (compared against a fresh read of the same
pages), and moved them to a `slices/superseded/` subdirectory — non-destructively, outside the
`slices/*.md` glob `verify-run-record` reads — rather than silently overwriting or silently
using them. This is the transcription contract's own non-destructive-staging discipline
(`VERIFY-02`) firing correctly under a real, unplanned partial-run condition, not a scripted test
of it.

### Real classification dispatch — pairing, provenance, verdict

```
$ (cd "$SCRATCH/one-two-punch" && boardsmith verify-classify-pairs --project . --run-id 2026-07-30T01-31-49Z --json)
{
  "pairs": [{"pairId":"pages-1-2","kind":"paired",
    "liveSlices":["rulebook/01-setup-and-round-structure.md","rulebook/02-action-cards-and-resolution.md"],
    "stagedSlices":["01-overview-and-contents.md","01-starting-a-new-game.md","01-round-structure.md",
                    "02-action-cards.md","02-punch-examples.md","02-end-of-game.md","02-tips.md"],
    "liveRuleBearingLines":74,"stagedRuleBearingLines":121}],
  "provenance": {"pages-1-2": {
    "provenance":"source-changed",
    "currentHash":"8a01d38c0073b9ba90d07e4dc20817d1ad6c590d3c0c747ec31655e88c35bb9c",
    "recordedHashes":["e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea"],
    "reason":"at least one citing chunk's recorded Source hash differs from the current archived source — any disagreement is a change the designer must see"
  }},
  "summary": {"paired":1,"presentationOnly":0,"unpaired":0,"ruleBearingPairs":1}
}
```

**Provenance is `source-changed`, mechanically — the exact predicted verdict, derived purely from
the real hash comparison (decision 2), with no subagent involvement whatsoever.**

Classification dispatch (`BS-CLASSIFY-V1`, same pointer-block shape as every prior real dispatch in
this milestone, `--allowedTools Read` only):

```
$ (cd "$SCRATCH/one-two-punch" && claude -p "<BS-CLASSIFY-V1 prompt, pair pages-1-2, live+staged paths>" --allowedTools Read)
```

Exit 0. Raw structured return (verbatim, condensed to the load-bearing fields — full text preserved
in `$SCRATCH/subagent-otp-sc3-classify-return.txt`):

```
{
  pairId: "pages-1-2",
  label: "contradictory",
  quotedPass1: "The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.",
  quotedPass2: "The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.",
  lineFindings: [
    { label: "contradictory", note: "p.1, 2) FIGHT — resolution-order rule. lower-first vs higher-first is reversed precedence over the same comparison; read literally the two produce opposite resolution order in every untied exchange." },
    // + 6 further line findings, all "cosmetic" (credit-name spelling, "next to"/"in front of" your boxer, punctuation, "one player"/"your player") — none consequential.
  ]
}
```

The subagent's own reasoning for choosing `contradictory` over `sharper`: "neither reading
constrains something the other left open — both assert a specific, opposite direction for the same
comparison" (matching decision 10's consequence test exactly: this is not compatible-but-narrower,
it is two mutually exclusive readings of the same sentence).

Recorded via the real ledger command, from the subagent's own returned fields only:

```
$ (cd "$SCRATCH/one-two-punch" && boardsmith verify-classify-record --project . --run-id 2026-07-30T01-31-49Z \
    --pair-id pages-1-2 --label contradictory \
    --evidence "<verbatim from return.evidence>" \
    --quoted-pass1 "The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time." \
    --quoted-pass2 "The player with the higher timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time." --json)
{"ruleDelta":"contradictory","stale":true,"provenance":"source-changed", ...}
$ (cd "$SCRATCH/one-two-punch" && boardsmith verify-classify-status --project . --run-id 2026-07-30T01-31-49Z --json)
"summary": {"pairs":1,"paired":1,"classified":1,"cosmetic":0,"sharper":0,"contradictory":1,"unclassified":0,"stale":1,"cosmeticPct":0}
```

**GATE: PASSED (SC-3 — real archived-source mutation, real re-transcription dispatch, real
classification dispatch, verdict `contradictory`, `stale: true`).**

### SC-3 / SC-4 assertions, stated separately and explicitly

- **SC-3:** the pair covering the mutated page classifies **`contradictory`** and is **`stale: true`**.
  Both readings are quoted verbatim in `evidence`/`quotedPass1`/`quotedPass2` above — a direct,
  irreconcilable reversal of "lower timing resolves first" vs "higher timing resolves first," caught
  through the REAL pipeline (real archived-source mutation → real re-transcription dispatch → real
  classification dispatch → real ledger record), never a hand-edited staged slice. No hand-edited
  staged slice appears anywhere in this section — every staged file under
  `rulebook/.verify/2026-07-30T01-31-49Z/slices/` was produced by the real `claude -p` transcription
  dispatch quoted above, confirmed on disk.
- **SC-4 on real data:** the mutation moved the source bytes (H1 → H2, both hashes recorded above),
  and the affected pair's provenance reads **`source-changed`** (the mechanical hash-compare
  ladder's own output — not the subagent's opinion; the subagent has no provenance field to supply).
  **No naturally-occurring `source-changed` + `cosmetic` + not-stale pair occurred in this run** — the
  one real pair in this run is the SAME pair that was mutated, so it is necessarily the one carrying
  both the new provenance state and the non-cosmetic delta together; a genuinely different pair
  (same run, same source, unaffected by the mutation) would be needed to show `source-changed` co-
  occurring with `cosmetic`, and this real game has exactly one page-overlap group (decision 4's
  second amendment — the same "1 pair per 2-page rulebook" ceiling section 2 already measured), so
  there is no second real pair available to carry it. This is reported plainly rather than implied:
  **the independence of provenance from staleness is instead corroborated on real data by the
  CROSS-GAME comparison already recorded in §2** ("SC-1 measurement" — `one-two-punch`'s ORIGINAL,
  unmutated pair was real `unknown` + `cosmetic` + not-stale, and this section's pair is real
  `source-changed` + `contradictory` + stale — two different provenance values, on two different
  runs of the SAME pair, landing on two different staleness outcomes purely as a function of
  `ruleDelta`), plus the structural unit tests that pin `deriveStale`'s single-parameter arity
  (`src/cli/commands/verify-classify.ts`, `STALE_BY_RULE_DELTA`/`deriveStale` — a function that
  cannot even be called with a provenance argument) and the `provenance-3` test asserting
  `source-unchanged` can never be returned with zero recorded hashes. The literal
  `source-changed`+`cosmetic`+not-stale triple is proven structurally (by construction of
  `deriveStale`'s one-argument signature) rather than exhibited as a naturally-occurring real
  4-tuple in this specific run — stated honestly rather than implied.

### Originals re-verification (post-run, this section's own pass)

```
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(still empty)
```

Whole-tree sha256 manifest diff, before vs. after this plan's ENTIRE run (both games, captured
fresh at this plan's own start):

```
$ diff "$SCRATCH/otp.before" "$SCRATCH/otp.after"
(empty, exit 0)
$ diff "$SCRATCH/seven.before" "$SCRATCH/seven.after"
(empty, exit 0)
```

Both originals byte-identical before and after — the mutation, the provenance-baseline `chunk-
check`, the re-transcription dispatch, and the classification dispatch all touched only
`$SCRATCH` copies.

---

## 6. VERIFY-01 — a per-chunk verdict without rebuilding, and the phase-critical chunk-level
   staleness measurement

### VERIFY-01's per-chunk-verdict half — `chunkVerdicts[]` on both real reference games

`boardsmith verify-classify-status --project . --run-id <runId> --json` was run against both real
projects — `seven` (reconstituted from `174-FIXTURES/`, classified `sharper` above and in
`174-06-PROOF.md` §2) and `one-two-punch` (this section's own SC-3 run, classified `contradictory`
above) — with **no build step of any kind between adoption and this command**: no `npm install`,
no game compile, no test run, nothing under `src/`/`chunks/`/`SKETCH.md` touched.

**(c) No build ran — proven by a whole-tree sha256 diff, not by the absence of a build command in
the transcript.** A fresh manifest of every file under each scratch copy EXCLUDING
`rulebook/.verify/` (the verify pass's own ledger/staging artifacts, which are expected and
intended to change) was captured immediately before and after the `verify-classify-status`
invocation:

```
$ cd "$SCRATCH/one-two-punch" && find . -type f -not -path './rulebook/.verify/*' -not -path './.git/*' -print0 | xargs -0 shasum -a 256 | sort > before.hash
$ boardsmith verify-classify-status --project . --run-id 2026-07-30T01-31-49Z --json > /dev/null
$ find . -type f -not -path './rulebook/.verify/*' -not -path './.git/*' -print0 | xargs -0 shasum -a 256 | sort > after.hash
$ diff before.hash after.hash
(empty, exit 0) — "OTP-COPY: IDENTICAL"
```

Identical result for `seven` against its own run-id (`2026-07-29T23-25-24Z`). No `chunks/*/CHUNK.md`,
no `SKETCH.md`, no `src/` file, and no test file changed in either copy as a result of running
`verify-classify-status` — the command is genuinely read-only over the game's build artifacts (it
only reads the ledger and the live/staged slice trees it already had access to).

**(a) Every citing chunk appears exactly once — with an honest correction to the literal claim.**
`seven` has 17 real chunk directories; `chunkVerdicts` returned **16** entries. `one-two-punch` has
12; `chunkVerdicts` returned **11**. This is not a bug or a silent drop: `computeChunkVerdicts`
excludes a chunk entirely when `resolveCitedSlices` resolves ZERO rulebook citations for it
(`if (resolved.length === 0) continue`), and both excluded chunks are genuinely citation-free by
design, verified by reading each directly —

- `seven`'s `final-acceptance` (a coverage-audit chunk; its own text: "coverage check confirming
  every non-variant rulebook slice was built" — discusses rulebook coverage in prose but cites no
  `rulebook/<file>.md` path).
- `one-two-punch`'s `ai-opponent` (explicitly marked LIGHT in its own file: "this chunk interprets
  NO rulebook rule — it has no Citations line in SKETCH.md"; "none — no rulebook slices are cited
  by this chunk").

So the honest form of assertion (a) is: **every chunk that cites at least one rulebook slice
appears in `chunkVerdicts` exactly once; a chunk that cites none is correctly absent, not silently
dropped** (verified directly against each excluded chunk's own CHUNK.md, not inferred from the
command's own behavior).

**(b) `pairIds`/citations spot-checked directly against each chunk's own CHUNK.md prose** (not
trusted from the command's own output):

| Chunk | Game | `citedLiveSlices` (reported) | Verified in CHUNK.md |
|---|---|---|---|
| `second-action-resolution` | one-two-punch | `01-setup-and-round-structure.md`, `02-action-cards-and-resolution.md` | Matches: `"...cites rulebook/02, Fight-phase continuation...; and rulebook/01-setup-and-round-structure.md, '2) Fight' (p.1)..."` |
| `bonus-point-cards` | seven | `01-definitions-and-components.md`, `01-overview-setup-and-play.md` | Matches: `"INDEX.md search...surfaces only rulebook/01-overview-setup-and-play.md...and rulebook/01-definitions-and-components.md"` |
| `game-score-and-winner` | seven | `01-overview-setup-and-play.md`, `02-solo-variant.md` (never `01-definitions-and-components.md`) | Matches: 5 direct `rulebook/01-overview-setup-and-play.md`/`rulebook/02-solo-variant.md` citations found by `grep`; zero `rulebook/01-definitions-and-components.md` citations found |

The third row is also the direct, real corroboration of decision 18's narrowing: `game-score-and-
winner` genuinely never cites the live slice the `sharper` quote landed in, and is reported
`cosmetic`/`stale: false` — not because the tool guessed, but because that citation is genuinely
absent from the chunk's own text.

**(d) A chunk whose cited slices land ONLY in an `unpaired-slice` group reads `unclassified`, not
clean.** Neither real reference game produced an `unpaired-slice` group in this phase's real runs
(`summary.unpaired: 0` for both games, both runs) — every live/staged slice paired into the single
real group each 2-page rulebook produces. This specific real-data case is therefore **not
exercised live** in this phase; it is proven structurally instead, by
`src/cli/commands/verify-classify.test.ts`'s `chunk-2` test ("a chunk citing a live slice in an
unpaired-slice group is reported unclassified — nothing was ever compared for it"), which asserts
exactly this branch of `computeChunkVerdicts` directly. Stated honestly per this plan's own
discipline: real-data coverage of (d) does not exist; the unit test is what pins the property.

**GATE: PASSED (VERIFY-01's per-chunk-verdict half — `chunkVerdicts[]` proven on two real, distinct
reference games, without any build step, with (a)/(b)/(c) independently confirmed on real data and
(d) honestly cited to its unit test rather than claimed live.)**

### The ADDED measurement — chunk-level staleness, the phase goal's own unit of measure

The phase goal is "a second run of the skill does not flag every chunk as stale," and its unit is
CHUNKS, not line-level findings and not group verdicts. Measured directly from the real
`chunkVerdicts[]` output above:

| Game | Total chunks | Citing chunks (in `chunkVerdicts`) | `stale: true` | `stale: false` | `ruleDelta` distribution (citing chunks) |
|---|---|---|---|---|---|
| `seven` (natural `sharper` finding, §2/§4) | 17 | 16 | **14** | **2** | `sharper`: 14, `cosmetic`: 2, `contradictory`: 0, `unclassified`: 0 |
| `one-two-punch` (this section's `contradictory` SC-3 mutation) | 12 | 11 | **11** | **0** | `contradictory`: 11, `cosmetic`: 0, `sharper`: 0, `unclassified`: 0 |

**Named, with the exact attributing delta:**

- **`seven` — the 2 chunks that stayed clean:** `game-score-and-winner` and `scoring-combo-sets-and-
  runs`. Both were checked directly (row 3 of the table above, and `scoring-combo-sets-and-runs`
  cites only `rulebook/INDEX.md`, which is never a paired rule slice at all — nothing to compare it
  against, correctly `cosmetic`/not-stale by construction, not by narrowing). **The 14 stale
  chunks** all cite `rulebook/01-definitions-and-components.md` — the live slice containing
  `quotedPass1`'s exact text (`"Named-but-undefined (p.1): bonus point cards (depicted as a black
  \"+1\" card...)"`) — and inherit the `sharper` delta via decision 18's per-quote narrowing exactly
  as designed.
- **`one-two-punch` — 0 chunks stayed clean.** All 11 citing chunks cite BOTH
  `rulebook/01-setup-and-round-structure.md` (where `quotedPass1`'s exact text — the FIGHT-phase
  resolution rule — lives) AND `rulebook/02-action-cards-and-resolution.md`, so every one of them
  inherits the `contradictory` delta. No warnings fired (`unattributable-quote` or unreadable-slice
  — the 174-04 corrective-follow-up conditions) in either game's real run; the quote matched its
  live slice cleanly both times, so no conservative broadening was needed or triggered.

### Explicit verdict: the phase goal is **NOT MET** on these two real reference games — reported
    plainly, not smoothed over

Per the plan's own standard ("a run that marks a small, explainable subset stale MEETS it; a run
that marks every chunk stale FAILS it, regardless of the 90.9% SC-2 figure"):

- `one-two-punch`: **100% of citing chunks (11/11) go stale** from a single real `contradictory`
  finding. This is literally "every chunk," the exact failure the phase goal names.
- `seven`: **87.5% of citing chunks (14/16) go stale** from a single real `sharper` finding. Not
  literally every chunk — decision 18's per-quote narrowing IS doing real, verifiable work here (2
  chunks stay clean where a naive group-level rollup would have marked all 16 stale, per decision
  18's own worked rationale) — but "nearly every chunk," which the added-task instructions
  explicitly name as a case not to smooth over.

**Diagnosis: this is NOT an SC-2 classifier-accuracy failure (SC-2 measured 90.9% cosmetic, PASS,
in §2) and NOT a failure of decision 18's group-vs-chunk fix (which is independently proven correct
above — it narrows to real citation facts, not a global rollup, and produced a real, non-trivial 2-
chunk carve-out on `seven`).** The root cause is **live-slice GRANULARITY**, one level finer than
the page-GROUP granularity decision 18 was designed to fix, but still too coarse for these two
particular reference games: both `seven` (3 live rule slices for 17 chunks) and `one-two-punch` (2
live rule slices for 12 chunks) concentrate almost their entire rulebook's content into a
handful of slices that most chunks cross-cite for general context (definitions, components, round
structure), so a single line-level delta anywhere in one of those few slices still reaches most or
all of the chunks that ever cite it — decision 18 narrows correctly from "the whole page-overlap
GROUP" down to "the specific live SLICE the quote is in," but on a rulebook this short, "the
specific slice" is still most of the rulebook. A finer per-citation-LINE attribution (matching a
quote not just to a live SLICE but to the specific citation the chunk actually names) would narrow
further, but that is a real architectural extension beyond this phase's scope — not built here, and
explicitly flagged below as an open item for Phase 175/176 to weigh, since those phases own the
consequence of a staleness verdict (repair scoping, VERIFY-06).

This is reported as a genuine, unresolved phase-goal risk — not tuned, not hidden, and not treated
as disqualifying the classifier itself (SC-1 through SC-5 as literally specified all measure real
and pass on real data). It is the single most important finding this plan produced, named exactly
as the added-task instructions required.

### `game-score-and-winner`, the sole real counter-example — proof the mechanism is not vacuous

Worth stating plainly: `game-score-and-winner`'s real, live-cited-fact-driven exemption from
`seven`'s `sharper` verdict is direct proof decision 18's mechanism is not decorative — a global
group-level rollup (decision 11 alone, without decision 18's later narrowing) would have marked ALL
16 citing chunks `sharper`/stale with no distinction at all. The measured real outcome (14 of 16,
not 16 of 16) is strictly better than the pre-decision-18 architecture would have produced on this
exact data, even though it still falls short of the phase goal's own bar on these two short
rulebooks.

---

## 7. Citation-resolution rate on real chunks (decision 19, measured before trusting the narrowing)

Before Task 2 wires the ladder into `computeChunkVerdicts`, this section measures how often the
three pure functions (`parseClaimCitationAnchors`, `matchedLiveLine`, `citedPageForLine`,
`resolveCitationAttribution`) actually resolve to a claim-level anchor on the REAL reference-game
chunks and rulebooks — read-only, no writes, confirmed by a whole-tree hash diff before/after.

**Read-only proof.** Before running the measurement script:

```
$ cd ~/BoardSmithGames && find seven one-two-punch -type f -not -path '*/.git/*' -print0 \
    | xargs -0 shasum -a 256 | sort > before.hash
$ wc -l before.hash
8053 before.hash
$ (cd seven && git rev-parse HEAD && git status --porcelain)
a03f38d4792af9dfc7c798be69686fc3230f54dd
(empty — porcelain clean)
```

After running the script (below):

```
$ find seven one-two-punch -type f -not -path '*/.git/*' -print0 | xargs -0 shasum -a 256 | sort > after.hash
$ diff before.hash after.hash && echo IDENTICAL
IDENTICAL
$ (cd seven && git rev-parse HEAD && git status --porcelain)
a03f38d4792af9dfc7c798be69686fc3230f54dd
(empty — porcelain clean)
```

`seven` remains pinned at `a03f38d4792af9dfc7c798be69686fc3230f54dd`, porcelain clean. Both trees
byte-identical before and after — the measurement script only opens files for reading.

**The script**, run via `npx tsx` against the real `~/BoardSmithGames/{seven,one-two-punch}` trees,
using the real `quotedPass1` this phase's own real classification dispatches returned (`seven` →
`sharper`, `one-two-punch` → `contradictory`, both transcribed verbatim in §2/§5 above):

```ts
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  parseClaimCitationAnchors,
  resolveCitationAttribution,
  matchedLiveLine,
  citedPageForLine,
} from '/Users/jtsmith/BoardSmith/src/cli/commands/verify-classify.ts';
import { resolveCitedSlices } from '/Users/jtsmith/BoardSmith/src/cli/commands/chunk-provenance.ts';

const GAMES: Record<string, { root: string; quote: string; quoteSlice: string }> = {
  seven: {
    root: '/Users/jtsmith/BoardSmithGames/seven',
    quote:
      'Named-but-undefined (p.1): bonus point cards (depicted as a black "+1" card; the text does not define its scoring effect beyond Game End\'s instruction to add bonus point cards to your score)',
    quoteSlice: '01-definitions-and-components.md',
  },
  'one-two-punch': {
    root: '/Users/jtsmith/BoardSmithGames/one-two-punch',
    quote:
      'The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time.',
    quoteSlice: '01-setup-and-round-structure.md',
  },
};

async function main() {
  for (const [game, { root, quote }] of Object.entries(GAMES)) {
    const rulebookDir = join(root, 'rulebook');
    const sliceFilenames = (await fs.readdir(rulebookDir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
    const chunksDir = join(root, 'chunks');
    const slugs = (await fs.readdir(chunksDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name).sort();

    const liveTextCache = new Map<string, string>();
    async function liveText(name: string): Promise<string> {
      if (!liveTextCache.has(name)) liveTextCache.set(name, await fs.readFile(join(rulebookDir, name), 'utf-8'));
      return liveTextCache.get(name)!;
    }

    for (const slug of slugs) {
      let chunkText: string;
      try { chunkText = await fs.readFile(join(chunksDir, slug, 'CHUNK.md'), 'utf-8'); } catch { continue; }
      const { resolved } = resolveCitedSlices(chunkText, sliceFilenames);
      if (resolved.length === 0) continue;
      const anchors = parseClaimCitationAnchors(chunkText, sliceFilenames);
      for (const citedSlice of resolved) {
        const bareName = citedSlice.slice('rulebook/'.length);
        const text = await liveText(bareName);
        const line = matchedLiveLine(text, quote);
        if (line === undefined) continue; // this cited slice isn't the one the delta line is in
        const page = citedPageForLine(text, line);
        const attribution = resolveCitationAttribution({
          liveSlice: citedSlice, liveSliceText: text, deltaLine: line, deltaLinePage: page, anchors,
        });
        console.log(`${game} | ${slug} | ${citedSlice} | rung=${attribution.rung} attributed=${attribution.attributed}`);
      }
    }
  }
}
main();
```

**Raw output (verbatim):**

```
=== seven ===
best-seven-selection | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=true
bonus-point-cards | rulebook/01-definitions-and-components.md | rung=slice-fallback attributed=true
discard | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
game-end-trigger | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=true
match-best-of-7 | rulebook/01-definitions-and-components.md | rung=cited-page attributed=true
scoring-declaration | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
scoring-engine-and-parity | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
scoring-one-color | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
scoring-run-of-7 | rulebook/01-definitions-and-components.md | rung=slice-fallback attributed=true
scoring-run-of-7-one-color | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
scoring-set-5-plus-set-2 | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
scoring-set-of-7 | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
simultaneous-round-loop | rulebook/01-definitions-and-components.md | rung=quoted-fragment attributed=false
table-and-draw | rulebook/01-definitions-and-components.md | rung=slice-fallback attributed=true

=== one-two-punch ===
block | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=true
discard-phase-and-reclaim | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=false
final-acceptance | rulebook/01-setup-and-round-structure.md | rung=slice-fallback attributed=true
game-end | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=false
jab | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=true
movement-advance-retreat | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=true
plan-and-reveal | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=false
punch | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=false
rest | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=true
second-action-resolution | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=true
setup-opening-discards | rulebook/01-setup-and-round-structure.md | rung=quoted-fragment attributed=false
```

**Per-game rung-distribution table**, counted over every (chunk, cited-live-slice) pair where the
delta's quote actually lands in that slice's text (the decision-18-relevant scope — the same scope
`computeChunkVerdicts`'s case (a) narrows within):

| Game | evaluated pairs | `quoted-fragment` attributed | `quoted-fragment` not attributed | `cited-page` attributed | `cited-page` not attributed | `slice-fallback` (always attributed) |
|---|---|---|---|---|---|---|
| `seven` | 14 | 2 | 8 | 1 | 0 | 3 |
| `one-two-punch` | 11 | 5 | 5 | 0 | 0 | 1 |

As a percentage of evaluated pairs: `seven` — 14.3% quoted-fragment-attributed, 57.1%
quoted-fragment-NOT-attributed, 7.1% cited-page-attributed, 21.4% slice-fallback. `one-two-punch` —
45.5% quoted-fragment-attributed, 45.5% quoted-fragment-NOT-attributed, 9.1% slice-fallback.

**The fallback share is not small** (21.4% on `seven`, 9.1% on `one-two-punch`) — a real and honest
limitation, reported here as instructed, not tuned away. It means roughly a fifth of `seven`'s
evaluated attributions and a tenth of `one-two-punch`'s rest entirely on decision 18's conservative
slice-level answer because no claim-level anchor (quoted fragment or page) could be resolved for
that chunk's citation of that slice — the narrowing is carried by comparatively FEWER chunks than
the total citing set, which is exactly the phase-goal risk this measurement exists to surface before
Task 3 reads a re-measured phase-goal number against it. This is a limitation of these two short,
citation-sparse rulebooks' real transcribed content, not a defect discovered in the ladder itself —
Task 2's `decision-19-guard-1` test pins the fallback rung's own no-false-clean behavior directly.

**No bar is declared or evaluated here, and none is tuned.** This measurement exists only so Task 3's
phase-goal re-measurement is read against a known anchor-availability baseline instead of taken on
faith. The dominant real observation is that `quoted-fragment` is the load-bearing rung on both
games (10/14 seven, 10/11 one-two-punch evaluations resolve to it, attributed either way) — matching
`<measured_reality>`'s own finding that quoted fragments, not slice tokens or bare pages, are the
anchor real `## Interpretation` claims actually carry.

---

## What is still unproven

Carried forward from earlier plans, plus this plan's own gaps — nothing below is silently resolved:

1. **The chunk-level staleness bar itself (added-task measurement, §6).** Both real reference games
   fail the phase goal's own literal bar (100% and 87.5% of citing chunks go stale from one real
   finding each) — not an SC-2/SC-3/SC-4/SC-5 failure (all measured PASS on real data), but a real,
   open risk that live-slice granularity is too coarse for short (2-3 live-slice) rulebooks. No
   attempt was made to tune the classifier or the attribution mechanism to improve this number —
   per this plan's explicit instruction, it is reported as a finding for Phase 175/176, not
   papered over.
2. **True internal Task/Agent-tool dispatch** — carried from every prior plan in this milestone
   (`173-PROOF.md` §3/§4, `174-01`/`174-06`-PROOF.md). No internal Task/Agent tool was exposed to
   this executor; every real dispatch in this plan (transcription and classification alike) used a
   `claude -p` OS-subprocess as the closest faithful equivalent — a genuine process boundary with no
   inherited conversation history. Not separately confirmed under native Task-tool access.
3. **`source-changed` + `cosmetic` + not-stale as a naturally-occurring real 4-tuple** (§5's SC-4
   discussion). Both real reference games pair into exactly one page-overlap group each, and this
   plan's SC-3 mutation necessarily lands on that same one group, so no second, unaffected real pair
   existed in this run to carry the combination. Corroborated instead via cross-run/cross-game
   comparison (§5) and the structural unit tests pinning `deriveStale`'s one-argument arity. A
   larger reference game with 2+ real page-overlap groups, one mutated and one untouched, would be
   needed to exhibit this literal 4-tuple live.
4. **Assertion (d) of VERIFY-01's per-chunk verdict** (a chunk citing only an `unpaired-slice`
   group reads `unclassified`) — not exercised live; neither real game produced an `unpaired-slice`
   group in any run this milestone has performed. Proven structurally by
   `verify-classify.test.ts`'s `chunk-2` test only.
5. **Multi-range / multi-dispatch fan-out and parallel-dispatch races** — carried from every prior
   plan (`173-PROOF.md` §what-this-plan-did-not-prove item 6; `174-01-PROOF.md`). Both reference
   rulebooks are 2-page books dispatched as a single range every time; large-rulebook range division
   and concurrent-dispatch collisions remain unexercised anywhere in this milestone.
6. **A genuine human designer's response at any designer-confirmation gate** (carried from Phase
   173) — every live pass across both phases has had no human present; the executing agent stood in
   as a proxy, recorded explicitly at each occurrence, including this plan's own `chunk-check`
   provenance-baseline step.
7. **Case 1 and Case 3 of `source-resolution.md`** (already-archived proceed-straight;
   multiple-candidates stop-and-ask) — carried from `173-PROOF.md` item 7, still unexercised. Case 2
   (single unarchived candidate) and Case 4 (hash mismatch — this plan's own SC-3 mutation, though
   handled via the disclosed manual `INDEX.md` edit rather than the skill's own live Step-1 logic,
   since no real `/bs-verify-game` session ran end-to-end in this milestone) are the only cases any
   real run has touched.
8. **An automated re-adoption path for a genuinely changed archived source.** This plan's SC-3
   provenance flip required a manual `rulebook/INDEX.md` edit (disclosed in §5) because
   `boardsmith ingest-archive` deliberately refuses to overwrite an existing archive
   ("Never clobber"), and no other command in the current codebase re-syncs `INDEX.md`'s recorded
   hash after a Case-4 mismatch. This is a real gap for whichever future phase owns closing the loop
   on a genuine rulebook-edition change (not assigned to any phase in the current roadmap as of this
   writing) — recorded here so it is visible rather than rediscovered.
9. **`/bs-build-chunk` Step 0's `ingest-check` call** — carried from Phase 170/171/172/173, still
   never exercised by a live session.
10. **The Git Protocol mechanism at Step 3 close** (write order, commit message shape) — carried
    from `173-PROOF.md` item 3, still unexercised; no plan in this milestone has committed inside a
    scratch copy (all scratch work is disposable and never pushed/merged).

## How to re-run every proof

No proof in this phase was captured as a reusable shell script (matching `174-06-PROOF.md`'s own
precedent — every dispatch is a real, non-idempotent `claude -p` subprocess call, so re-running a
script re-validates the EVIDENCE captured above, not the live event itself). The exact reproducible
command sequence, in order, for every section:

**§1 (fixture production) / §2 (SC-1/SC-2):** see `174-FIXTURES/MANIFEST.md`'s own command block
and `174-06-PROOF.md`'s "Reconstituting the real pass-2 material" subsection — `cp -R` both
`~/BoardSmithGames/{seven,one-two-punch}` originals into a fresh `$SCRATCH`, real
`npx boardsmith claude --local --force`, real `boardsmith ingest-archive rules.pdf --project . --json`
(confirms the same hash every time — same unmodified `rules.pdf` bytes), restore
`174-FIXTURES/<game>/staged/*.md` + `RUN.md` into `rulebook/.verify/<runId>/` using the run-ids in
`174-FIXTURES/MANIFEST.md`, verify all 23 restored file hashes against the manifest table, then
`boardsmith verify-classify-pairs`/`verify-classify-record`/`verify-classify-status --run-id <runId>
--project . --json`.

**§4 (determinism / lexicon regression):** repeat the reconstitution above into a SECOND fresh
`verify-run-init`, dispatch a fresh `claude -p "$(cat classification-dispatch-prompt.txt)"
--allowedTools Read` per pair, diff the `(pairId, ruleDelta, stale)` triple sets externally; for the
lexicon pairs, dispatch each of the 7 `174-FIXTURES/lexicon/<pair>/{live,staged}.md` pairs against
`src/cli/slash-command/bs/verify/classification-subagent.md` directly and compare the returned
`label` to `EXPECTED.md`.

**§5 (SC-3 mutation):** on a FRESH `cp -R` copy of `one-two-punch`, real skill install, real
`ingest-archive` (confirms hash `e28d1875...358eea`), real `boardsmith chunk-check second-action-
resolution --project . --json` (writes the pre-mutation `Source hash:` baseline), then: rasterize
page 1 of `rulebook/source/rules.pdf` at 300dpi (`pdftoppm`), composite a Ghostscript-rendered patch
(`gs -sDEVICE=png16m -r300`) reversing "lower"→"higher" in the FIGHT-phase paragraph at pixel
offset `+1292+2029` (a 300×55pt / 1250×229px patch), reassemble with the untouched page 2
(`magick -units PixelsPerInch -density 300 fixed1.png fixed2.png mutated-rules.pdf`), overwrite
`rulebook/source/rules.pdf` with the mutated bytes, manually update `rulebook/INDEX.md`'s `Source
hash:` line to the mutated file's hash (documented departure — no automated re-adopt command
exists), then real `verify-run-init` + real `claude -p` transcription dispatch (`BS-DISPATCH-V2`,
range `1-2`) + real recording + real `verify-classify-pairs`/classification dispatch
(`BS-CLASSIFY-V1`)/`-record`/`-status`.

**§6 (VERIFY-01 / chunk-level staleness):** against either reconstituted run above, run
`boardsmith verify-classify-status --project . --run-id <runId> --json` and read `chunkVerdicts[]`;
cross-check `pairIds`/`citedLiveSlices` against each named chunk's own `CHUNK.md` via `grep -n
"rulebook/<slice>" chunks/<slug>/CHUNK.md`; confirm the no-build claim via a whole-tree `find | xargs
shasum -a 256` diff excluding `rulebook/.verify/`, captured immediately before and after the
`verify-classify-status` call.

**Regression coverage that runs on every future change (not ad hoc):** `npx vitest run
src/cli/commands/verify-classify.test.ts` (pairing, provenance, staleness map, presentation filter,
ledger record/resume, malformed-return handling, `computeChunkVerdicts` including the 174-04
corrective-follow-up cases `decision-18-corrective-a`/`-b`) and `npx vitest run
src/cli/commands/chunk-provenance.test.ts` (`chunk-check`/`computeVerificationScope`). Full suite:
`npm test`.
