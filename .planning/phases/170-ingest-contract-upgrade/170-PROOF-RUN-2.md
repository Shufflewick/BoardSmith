# 170-PROOF-RUN-2 — PROC-01 human gate, 2026-07-28

**Two human-driven runs on one day. Run 1 FAILED and is recorded in full below. Run 2, against the
fixed contract, PASSED — and is the PROC-01 record.**

---

# Run 2 (2026-07-28, after commits `92f88bb9` + `c32bc184`) — PASS

Project: `/tmp/bs-ingest-harness/seven`. Staged with `node scripts/ingest-harness/run.mjs stage`;
reference repo recorded clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd`.

**This gate was NOT preceded by a green harness run.** The operator observed, correctly, that the
harness had certified a broken contract twice (three single-turn 10/10s before a 1/10 human run,
and an 11/11 immediately before Run 1's three failures), and directed that the manual pass run
directly. The in-flight harness run was killed. The harness's verdict is therefore absent from
this record by decision, not by omission — see "On the harness's standing" at the end.

## Result: all of (a)–(i) pass, on the AS-LEFT tree

The checker was run against the state the session left, with **no repair applied first**:

```
PASS  a   archive-exists       2194346 bytes at rulebook/source/rules.pdf
PASS  b   archive-hash         5138858e…fe337880
PASS  c   hash-recorded        recorded == computed
PASS  d   header-block         all four labels present, ordered, non-empty
PASS  e1  gaps-heading         exact "## Open Rules Gaps"
PASS  e0  gaps-machine-owned   fences intact, nothing hand-authored; 7 swept entries
PASS  e2  gaps-reconciliation  section entries=7, slice markers=7
PASS  f   tables-intact        both tables present
PASS  h   visual-lines         Visual=3, Derived=12; 3 inline Visual lines
PASS  i   derived-purity       no Derived line matches the presentation lexicon
PASS  g   reference-repo       clean, HEAD a03f38d4… matches recorded
AS-LEFT OVERALL: PASS
```

`boardsmith ingest-check` then exited **0** — `✓ Ingest synthesis up to date — 7 open rules gaps,
no Derived/Visual misfiling`.

## The thing that actually changed

`git log` in the produced project shows **one commit**: `5e6c320 chore: scaffold project via
boardsmith init`. The pre-commit hook never ran. Yet the gaps section is fully and exactly swept.

So the session performed synthesis itself, unprompted by any commit. Its own narration says so:

> All ten sections confirmed. Let me sweep the named-but-undefined markers into the machine-owned
> gaps section before synthesis.

and, on the four p.2 markers that are actually defined on p.1:

> The sweep is deliberately non-deduplicating, so I've left them alone rather than hand-editing a
> machine-owned section.

That second quote is the fence doing exactly what it was built for. The session had a clear motive
to tidy the section — four of the seven entries are artifacts of the p.2 slice being read in
isolation — recognised that motive, and declined because the section was marked machine-owned. Run
1's session, facing a section marked "for this ingest session to FILL", hand-wrote 2 of 5.

This is the first run in the phase's history where the produced tree was correct with **no**
harness intervention. Run 1 and both prior harness runs required either a manufactured commit or a
post-hoc repair to look green.

Note what this does and does not establish. It shows the fence changed behaviour on this run. It
does not establish that `/bs-build-chunk` Step 0's `ingest-check` instruction survives a live
session — that step never executed here, because the gate stops at end of Step 3. That remains
unproven and is called out in "What is still unproven".

## (e2) reconciliation, stated as two numbers

Slice-side markers: `01-setup.md` 1 + `01-game-end.md` 1 + `02-solo-variant.md` 5 = **7**.
Section-side entries between the fences: **7**. Equal.

```
Named-but-undefined (p.1): best hand of 7 cards (scoring method for a hand)
Named-but-undefined (p.1): "Ways to Score" card
Named-but-undefined (p.2): match
Named-but-undefined (p.2): game
Named-but-undefined (p.2): total score
Named-but-undefined (p.2): final score
Named-but-undefined (p.2): the 7 scoring hands
```

Not `_None._`, so the ground-truth trap in item (e) is satisfied: `seven` does name rules it never
defines, and the run recorded them.

## (h) and (i) — the split, judged by hand

Three `Visual (p.` lines, all in `02-solo-variant.md`. Decision test — *does this line affect
legality, scoring, or sequencing?* Every one must answer **no**:

| Line | Content | Test |
|---|---|---|
| `02:27` | saturated purple panel on white paper, thin light border | no — correct |
| `02:29` | white sans-serif reversed out, narrow left column, bold heading | no — correct |
| `02:31` | "SEVEN" wordmark, bold white italic caps, rotated ~45° | no — correct |

Twelve `Derived (p.` lines. Every one must answer **yes**:

| Line | Test |
|---|---|
| `01-about:6` player count 1–7, no per-count differences | yes |
| `01-setup:10` the mess, 3-card starting hand, one Ways-to-Score card each | yes |
| `01-round:10` round is simultaneous; net +1 card per round | yes |
| `01-game-end:9` bonus cards score even outside the 7-card hand | yes |
| `01-match-end:8` winner is cumulative score, not games won | yes |
| `01-definitions:23` Set/Run illustrations use differing colours; Run art (1,2,3) contradicts its text (5,6,7) | yes — and this is the canonical case the lexicon deliberately must not flag: a rule inferred FROM a diagram, legitimately mentioning the diagram |
| `01-distribution:14` 4 colours × 7 numbers × 4 copies = 112, plus 7 bonus | yes |
| `01-match-length:11` default 7 games; shorter/longer offered as alternatives | yes |
| `02-solo:15` three successive solo goals, each harder than the last | yes |
| `01-credits:9` no edition/printing/version/date stated on the page | **borderline** — provenance, neither rule-bearing nor presentation. Tuning note |
| `02-solo:23` p.2 terms referenced without definition here, may be defined on p.1 | **borderline** — slice-boundary metadata. Tuning note |
| `02-solo:33` no diagrams, component illustrations, tables, cards, dice, boards or tokens on this page | **borderline, presentation-domain** — see finding F-2 |

**Verdict on (i): PASS, with three tuning notes.** The criterion that fails a run is a `Derived`
line that is *a pure diagram or art description*. None is. Run 1's failure — `Card art depicted on
this page uses flat, fully saturated color fields … large white numeral … rounded corners`,
affirmatively describing art under a `Derived` prefix — does not recur, and the lexicon terms added
for it are present and did not misfire on the nine clearly rule-bearing lines.

This is a judgment call and it is recorded as one: `02-solo:33` is presentation-domain content
under a `Derived` prefix, and a stricter reading could fail it. It is called a tuning note rather
than a failure because it is a *negative existence claim* about visuals, not a description of art
presented as a rule — a materially milder thing than the defect the requirement exists to catch,
and useful negative evidence for later asset work.

## Findings from Run 2

**F-1 — `--edition` lets a paraphrase displace the machine-checkable sentinel.** The header reads
`Edition: none stated in rulebook`. The canonical no-edition token is `EDITION_UNKNOWN` = `not
stated in the rulebook`, emitted when `--edition` is omitted. Here the session asked the operator,
was told "No edition stated", and passed that through as free text. It satisfies (d) — non-empty,
and not the interview path's `unpublished — designer statement` — so it is not a gate failure. But
downstream cannot now distinguish "no edition was stated" from "the edition is literally named
*none stated in rulebook*", and v4.9's PROV requirements read this field. Proposed fix: `init` /
`ingest-archive` should normalise recognisably-empty edition strings to `EDITION_UNKNOWN`, or
refuse them and tell the caller to omit the flag.

**F-2 — the relabel lexicon does not catch negative visual claims.** `02-solo:33` asserts the
*absence* of diagrams and components. No lexicon term matches, and extending it is not obviously
right: the natural terms ('diagram', 'illustration', 'depicted') are exactly the referential words
deliberately excluded, because `01-definitions:23` — a correctly-filed rule inference — contains
two of them. Recommend leaving the lexicon alone and revisiting under Phase 177 (CHECK-04
derived-line re-derivation), which re-derives rule-bearing lines independently and would classify
this line on its content rather than its vocabulary.

**F-3 — the session edited `boardsmith.json` outside its step's scope.** It corrected the stub
`description` ("A fun game for 2-4 players") and `playtime` (15–30) to match the rulebook. The
change is correct and was reported, but Run 1's session flagged the same mismatch and correctly
declined to touch it. Two runs, two different scope decisions on the same defect, means the skill
text does not say who owns `boardsmith.json` after `init`. Worth settling; out of scope for (a)–(i).

## What is still unproven

- **`/bs-build-chunk` Step 0 was never exercised.** The `ingest-check` call added there is skill
  text, and `170-MECHANISMS.md` records twelve instruction-shaped mechanisms that were all skipped
  on live runs. Nothing in Run 2 tests it: the gate stops at end of Step 3. It is a backstop for a
  window this run did not enter, and the first `/bs-build-chunk` run on a real project is what will
  settle it. The fence and the pre-commit hook both remain in place independently of it.
- **One run is one sample.** The fence changed this session's behaviour. Whether it does so
  reliably needs more runs, and the honest read of this phase's history is that a single green has
  been misleading before.

## On the harness's standing

Its record: three green single-turn runs preceded a 1/10 human run; an 11/11 preceded Run 1's
three failures; and its `assert` step manufactured the commit that made the second of those look
green. Twice it certified a contract a real run failed.

Run 2 was deliberately not gated on it. The changes in `c32bc184` — (e0) and (e2) asserted on the
as-left tree — are what would have caught both historical misses, but that is an argument on paper
and the harness has not yet corroborated a human gate even once. **Recommendation: the harness may
inform, and must never again gate whether a manual pass is run.** If it agrees with the next manual
gate, that is the first corroboration and it earns some standing back. If it disagrees again, retire
it rather than patch it a third time.

`~/BoardSmithGames/seven` verified clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd` before and
after Run 2.

---

# Run 1 (2026-07-28, before the fix) — FAIL

**Verdict: FAIL.** Three defects, all of which the automated harness passed. The gate did the job it
exists to do — the harness reported 10/10 on the same contract minutes earlier.

Failing items: **(e)**, **(h)**, **(i)**. Passing: (a), (b), (c), (d), (e1), (f), (g).

Gate items **(j)** and **(k)** from `170-10-PLAN.md` were **not run**. They check for
`## Line-kind receipt` blocks and invented visual headings — artifacts of Plans 07/08, whose
mechanisms `170-MECHANISMS.md` records as refuted and removed. Enforcing them would fail a correct
run. The bar applied is `170-03-PLAN.md`'s (a)–(i), which both documents name as live.

The plan's second precondition — `170-PROC-02.md` opening with `CLOSED` — could not be checked:
that file does not exist in the phase directory, nor does `170-HARNESS-PASS-INDEX.md`, also
referenced by the plan's `<context>`. Both are stale references from the pre-solve plan set. The
gate proceeded on the harness precondition alone, which `170-MECHANISMS.md`'s "Where to pick up"
names as the only gate for re-running.

---

## Precondition

`npm run harness:ingest` — exit 0, **10/10 PASS**, **5 turns** (cap 25, `reason=completed`), 375.5s.
Above the ≤2-turn INVALID RUN threshold, so the green is meaningful.

```
a archive-exists PASS | b archive-hash PASS | c hash-recorded PASS | d header-block PASS
e1 gaps-heading PASS  | e2 gaps-reconciliation PASS (entries=3, markers=3)
f tables-intact PASS  | h visual-lines PASS (Visual=2, Derived=2)
i derived-purity PASS | g reference-repo-unmodified PASS (clean @ a03f38d4)
```

## Staging

- `node scripts/ingest-harness/run.mjs stage` — recreated `/tmp/bs-ingest-harness`, installed the
  working tree's skill text project-locally, asserted the operator's global `~/.claude/skills/`
  untouched (newest mtime `2026-07-27T16:24:18.922Z` < process start `2026-07-28T02:39:03.270Z`).
- Reference repo `/Users/jtsmith/BoardSmithGames/seven` recorded clean at
  `a03f38d4792af9dfc7c798be69686fc3230f54dd`.
- Source copied to `/tmp/bs-ingest-harness/source-under-test/rules.pdf`, hash verified.

## The run

Human-driven, no author present to steer it. Invocation:
`/bs-ingest-rules /tmp/bs-ingest-harness/source-under-test/rules.pdf`

Created project: **`/tmp/bs-ingest-harness/seven`**

The session ran past the gate's stopping point — it completed Steps 4–7 and wrote `SKETCH.md` plus
three `CHUNK.md` files after the operator approved the sketch. That does not affect (a)–(i), all of
which are written at Step 3.

Transcription quality was again high: two subagents, one per page, the orchestrator never read the
PDF itself. It preserved the Run text-vs-illustration contradiction verbatim rather than resolving
it, refused to invent the undefined scoring system, and correctly tagged the Solo Variant as an
out-of-scope-by-default variant.

---

## Evidence, item by item

### (a) archive-exists — PASS

```
$ ls -l rulebook/source/
-rw-r--r--@ 1 jtsmith  wheel  2194346 Jul 28 09:43 rules.pdf
```

### (b) archive-hash — PASS

```
$ shasum -a 256 rulebook/source/rules.pdf
5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880  rulebook/source/rules.pdf
```

### (c) hash-recorded — PASS

```
$ grep '^Source hash:' rulebook/INDEX.md
Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
```

**(b) and (c) match exactly.**

### (d) header-block — PASS

```
$ grep -n '^Edition:\|^Source:\|^Source hash:\|^Transcribed:' rulebook/INDEX.md
3:Edition: not stated in the rulebook
4:Source: rulebook/source/rules.pdf
5:Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
6:Transcribed: 2026-07-28
```

All four present, non-empty, ordered. `Edition:` reads `not stated in the rulebook` — **not** the
interview path's `unpublished — designer statement`, which was the (d) defect the first gate
recorded. That defect is fixed.

### (e1) gaps-heading — PASS

```
$ grep -n '^## Open Rules Gaps' rulebook/INDEX.md
15:## Open Rules Gaps
```

Exact spelling, no parenthetical suffix.

### (e) gaps reconciliation — **FAIL**

Section body as the run left it — **2 entries**:

```
Named-but-undefined (p.1): "Ways to Score" card
Named-but-undefined (p.2): the 7 scoring hands
```

Slice-side markers — **5**:

```
$ grep -n 'Named-but-undefined' rulebook/01-*.md rulebook/02-*.md
01-overview-setup-round-and-scoring.md:15:Named-but-undefined (p.1): "Ways to Score" card
02-solo-variant.md:16:Named-but-undefined (p.2): scoring hands (the "7 scoring hands" are referenced but not defined on this page)
02-solo-variant.md:18:Named-but-undefined (p.2): match
02-solo-variant.md:20:Named-but-undefined (p.2): game
02-solo-variant.md:22:Named-but-undefined (p.2): total score
```

**2 ≠ 5.** Section entries < slice markers: the transport silently **dropped 3 gaps**. This is
precisely the failure mode item (e) was written to catch, and precisely the reason the plan
mandates the reconciliation run unconditionally rather than only when the count looks low — 2
entries, both real and correctly worded, looks perfectly healthy on its own.

### (f) tables-intact — PASS

```
$ grep -n '^## Slices\|^## Term' rulebook/INDEX.md
29:## Slices
36:## Term → Slice
```

### (g) reference-repo-unmodified — PASS

```
$ git -C ~/BoardSmithGames/seven status --porcelain     # (empty)
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
```

Matches the staged baseline. The run could not have reached it — no `--add-dir` was granted.

### (h) visual-lines — **FAIL**

```
$ grep -c 'Visual (p\.' rulebook/*.md
01-overview-setup-round-and-scoring.md:0
02-solo-variant.md:0
00-visual-survey.md:0
INDEX.md:0

$ grep -c 'Derived (p\.' rulebook/*.md
01-overview-setup-round-and-scoring.md:8
02-solo-variant.md:4
```

**Zero `Visual (p.` lines anywhere.** The waiver is not available: two of the twelve `Derived`
lines are unambiguous whole-page presentation description (`01:90`, `02:33`), and the run's own
`00-visual-survey.md` records three embedded diagrams, a card-face spec, and the rotated SEVEN
wordmark.

### (i) derived-purity — **FAIL**

By-hand decision test — *does this line affect legality, scoring, or sequencing?* — applied to all
twelve `Derived (p.` lines:

| Line | Verdict |
|---|---|
| `01:7` player count 1–7, no per-count setup differences | yes — PASS |
| `01:17` the "mess"; starting hand is 3 drawn from it | yes — PASS |
| `01:27` round is simultaneous; hand changes +2/−1 | yes — PASS |
| `01:74` black "+1" is the bonus card's art, and 7 exist | borderline — art-identification carrying a rule-bearing count. Tuning note, not a fail |
| `01:90` page layout, golden-yellow ground, sans-serif, four columns | **no — misfiled**, caught by the relabeler |
| `01:92` card art: flat saturated color fields, large white numeral, pip dots, rounded corners; no board/tile/die/token imagery | **no — MISFILED AND NOT CAUGHT.** Pure art description. This is the pre-phase bug INGEST-02 exists to fix, and it IS a FAIL |
| `01:94` no edition/printing/version statement on this page | borderline — provenance, not rule-bearing and not presentation. Tuning note |
| `01:98` "Ways to Score" named but undefined; Game End omits how hands score | yes — PASS |
| `02:12` solo is one player, adds three goals, procedures unchanged | yes — PASS |
| `02:14` a match is multiple games, each producing a final score | yes — PASS |
| `02:29` the seven multiples of 7; "perfect solo match" | yes — PASS |
| `02:33` solid purple panel, white sans-serif, rotated SEVEN wordmark, no diagrams | **no — misfiled**, caught by the relabeler |

One clear FAIL (`01:92`), two tuning notes (`01:74`, `01:94`).

---

## Root cause

### RC-1 — the pre-commit hook never fired, because ingest never commits

(e) and (h) share one cause. Both sections are produced by `boardsmith ingest-gaps`, which
`init` installs as a `pre-commit` hook. The hook is installed and correct:

```
$ ls -l .git/hooks/pre-commit
-rwxr-xr-x@ 1 jtsmith  wheel  1441 Jul 28 09:43 .git/hooks/pre-commit
```

But the run ended with every ingest artifact **uncommitted** — the only commit in the project is
`ed9162b chore: scaffold project via boardsmith init`. The session said so explicitly and gave a
correct reason:

> The ingest artifacts are uncommitted (only the `boardsmith init` scaffold commit exists) — I
> didn't commit since the git protocol scopes commits to chunk steps.

That is the documented protocol, followed correctly. **`/bs-ingest-rules` has no commit in it**, so
the one mechanism that was supposed to make synthesis unskippable does not run during ingest at
all. `## Open Rules Gaps` was filled by the orchestrator by hand instead — which is exactly the
model-authored path the hook was built to replace, and it dropped 3 of 5 gaps.

**Proven, not inferred.** Running the hook's command by hand against the produced tree:

```
$ npx --no-install boardsmith ingest-gaps
✓ Relabelled 2 lines Derived → Visual
  01-overview-setup-round-and-scoring.md:90 matched "sans-serif"
  02-solo-variant.md:33 matched "sans-serif"
✓ Filled ## Open Rules Gaps — 5 entries from 3 slices
```

Both failures clear: reconciliation becomes 5 = 5, and Visual becomes 2. The hook works. It was
never invoked.

> **Note on tree state.** This command mutated `/tmp/bs-ingest-harness/seven` as a *diagnostic*, to
> separate "hook broken" from "hook never ran". The gate verdict above is recorded against the
> pre-hook state the run actually left. This is not a hand-patch used to pass the gate — the gate
> fails.

The blast radius is not cosmetic. `/bs-build-chunk`'s investigate step reads `rulebook/INDEX.md`
before it commits anything, so the first chunk is planned against a gaps list missing 3 of 5
entries and a slice set with no `Derived`/`Visual` separation.

### RC-2 — the relabel lexicon misses art description

`01:92` is pure card-art description and survived the relabel. Both lexicons — the relabeler's
(`src/cli/commands/ingest-archive.ts:199`) and the checker's independent copy
(`scripts/ingest-harness/check.mjs:75`) — are typography- and layout-weighted:
`sans-serif, serif, typograph, full-bleed, palette, wordmark, italic, font, aspect ratio,
iconograph, art style, rotated, bold white`. None matches "flat, fully saturated color fields",
"large white numeral centered on the face", "small white pip-like dots", or "slightly rounded
corners".

Two separate problems: the lexicon has a gap, and it exists **twice**, in two files, free to drift.

---

## Harness-vs-human comparison

| Item | Harness | Human gate | Checker gap? |
|---|---|---|---|
| (a) archive-exists | PASS | PASS | — |
| (b) archive-hash | PASS | PASS | — |
| (c) hash-recorded | PASS | PASS | — |
| (d) header-block | PASS | PASS | — |
| (e1) gaps-heading | PASS | PASS | — |
| (e2) gaps-reconciliation | PASS (3=3) | **FAIL (2≠5)** | **GAP-1, and GAP-2** |
| (f) tables-intact | PASS | PASS | — |
| (g) reference-repo | PASS | PASS | — |
| (h) visual-lines | PASS (V=2, D=2) | **FAIL (V=0)** | **GAP-1** |
| (i) derived-purity | PASS | **FAIL (`01:92`)** | **GAP-3** |
| (j) line-kind receipt | n/a | not run — refuted mechanism | — |
| (k) invented heading | n/a | not run — refuted mechanism | — |

### GAP-1 — `assert` manufactures the commit the real workflow never makes

`run.mjs`'s `assert` step does this before checking anything:

```
[assert] committed produced slices (fires the init-installed pre-commit hook)
```

The harness commits on the session's behalf. No real ingest run does. So the harness measures a
tree state that `/bs-ingest-rules` cannot actually produce, and (e) and (h) pass there and fail
here. **This is the most serious finding in the run** — it is the harness certifying the fix for a
problem the fix does not reach, which is exactly the false confidence the eight downstream v4.9
phases would have been built on.

*Proposed fix:* `assert` must check the artifacts **as the driven session left them**, and treat an
uncommitted tree as the signal it is. Split it: assert pre-commit state first (this is the state a
real run produces and the state `/bs-build-chunk` consumes), then optionally commit and re-assert
to prove the hook itself works. The pre-commit assertion is the one that gates the requirement.

### GAP-2 — the (e) reconciliation is vacuous once the hook has run

Item (e) compares section entries against slice markers to catch a model-authored section dropping
gaps. But `ingest-gaps` **writes the section from the markers**, so after the hook runs the two
sides are equal by construction and the check cannot fail. In the harness it is a tautology. The
one state where it has teeth — a model-authored section, pre-hook — is the state the harness never
inspects.

*Proposed fix:* fold into GAP-1's pre-commit assertion, where the section is still whatever the
orchestrator wrote and the comparison is meaningful again. Post-hook, replace the reconciliation
with an idempotence check (running `ingest-gaps` twice changes nothing).

### GAP-3 — the derived-purity lexicon misses art description, and is duplicated

`01:92` passed check 9 because the lexicon has no term for colour-field/numeral/corner-radius
description.

*Proposed fix:* extend the lexicon with art-description terms (`color field`, `colour field`,
`numeral`, `rounded corner`, `pip`, `card face`, `saturated`, `background fill`), and — more
importantly — **make the checker import the relabeler's lexicon instead of keeping a second copy**,
so a term added for the relabeler cannot silently fail to reach the checker. The duplication is its
own latent defect regardless of this run.

---

## What the run revealed

Beyond the three gate failures:

1. **A documented-vs-actual drift in the scaffold doc, reported by the run itself.** The session
   noted that `bs-shared/build/scaffold.md` documents `npx boardsmith init <name>`, while the CLI
   now hard-requires `--rulebook <path>` or `--without-rulebook`. It recovered correctly — it read
   the error and passed `--rulebook` — and this is the mechanism working exactly as designed: a
   command that *fails* gets acted on where twelve instruction-shaped attempts did not. But the doc
   should say so. The harness run flagged the same drift independently, so it reproduces.

2. **The `_None._` trap did not fire, but nearly did for the wrong reason.** The gate treats
   `_None._` as the signature of a broken transport. Here the transport was equally broken and the
   section was *non-empty*, because a different actor (the orchestrator) filled it. A gaps section
   can be wrong while looking right; only the reconciliation exposes it. The plan's insistence on
   running it unconditionally is vindicated.

3. **The judgment-vs-mechanics finding holds, again.** Transcription — pure judgment — was
   excellent for the third run in a row: faithful slices, a preserved source contradiction, no
   invented scoring, correct variant tagging. Every failure in this gate is mechanical. Nothing
   about this run argues for rewording anything.

4. **`boardsmith.json` retains `init`'s defaults.** `"A fun game for 2-4 players"` and 2 seats,
   against a rulebook stating 1–7 players. The session flagged it and correctly declined to edit
   outside its step's scope. Out of scope for (a)–(i); worth a follow-up.

## Disposition

Per `170-10-PLAN.md`'s failure protocol: no produced artifact is hand-patched and no criterion is
weakened. The loop is — record the failure, add each missed defect to `check.mjs` and its self-test,
fix the underlying code, re-run the harness to green, then re-open this checkpoint.

`~/BoardSmithGames/seven` verified clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd` after the
run. `/tmp/bs-ingest-harness` is **retained** pending the fix, as failure evidence; it is removed
when the gate is re-run.
