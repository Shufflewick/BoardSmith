# CHECK-04 Consolidated Proof — Phase 177 Plan 20

One measurement, current code (HEAD `b1a9bc35`, including `ac5f64c5`/`d1c7199a`/`4ddee529`/`b5be6f65`,
all four fixes the prior measurement chain made across three different code states), all three
reference games, run twice for determinism. **84 real `claude -p` dispatches** (14 dispatchable
slices x 2 enumerators + 1 reconciler x 2 runs), zero simulated, zero hand-authored substitutes.

Pre-registration: `177-20-MEASUREMENT/PRE-REGISTRATION.md`, committed alone (`f56add71`) before any
dispatch.

## Corpora

| Game | Project dir | Derived lines | Slices w/ Derived lines |
|---|---|---|---|
| `seven` | `~/BoardSmithGames/seven` | 3 | 2 |
| `one-two-punch` | `~/BoardSmithGames/one-two-punch` | 11 | 2 |
| `doom-machine` | `~/BoardSmithGames/doom-machine` | 19 (14 dispatchable + 5 in `CARDS.md`, blocked) | 11 |
| **Total** | | **33** | **15** |

The real project directories were used directly, not a separate fixtures copy — confirmed
byte-for-byte identical in slice content to `177-FIXTURES/seven`/`/one-two-punch` (only `INDEX.md`
metadata and the `source/` provenance directory differ, and provenance was already correctly
recorded there by 177-16/177-19). Using them directly means both the text AND the already-verified
provenance came from one real, current source, with nothing re-transcribed for this run.

**Originals confirmed byte-identical before and after all 84 dispatches** (sha256, all `.pdf`/`.md`
files in each project dir, `177-20-MEASUREMENT/{baseline,after}-{game}.sha256`, three-way diff
empty for all three games).

## Headline number 1 — CARDS.md is entirely blocked, by design, not worked around

Per this run's pre-registration (unlike 177-18), `buildEnumeratorPayload`'s construction-site throw
on `CARDS.md` was **not** manually worked around. The file's original line 270 (`` `+ = / >`).
Derived (p.3), by symmetry... ``) buries a page-cited annotation mid-sentence — `ANY_ANNOTATION_LINE_RE`
catches it anywhere in the assembled payload text, not just at line start, and throws. **All 5 of
`CARDS.md`'s `Derived` lines received zero dispatch attempt this run** — reported as its own
honest category ("measurement blocked by construction-site safety mechanism"), not folded into
`uncorroborated`, not silently patched around.

This is a **known, disclosed, uncorrected transcription defect in the `doom-machine` game repo**
(the mid-line citation form), not a BoardSmith code defect — the throw is the safety mechanism
working exactly as designed (177-15's original intent: a leak must fail loudly, never silently).

## Headline number 2 — a NEW, real, live gap in the `d1c7199a` fix, found while investigating the block above

While confirming the CARDS.md throw's cause, an isolated check (stripping only line 270's residual,
not part of the real measurement) found that **`CARDS.md` line 140 — `(Derived: effectively a
2-space loop...)` — still leaks past BOTH `buildEnumeratorPayload`'s filter AND its
`ANNOTATION_VOCABULARY_RE` backstop**, even on current code, even after `d1c7199a`. The regex
(`/^[\s>\-*]*(?:Derived|Visual|Named-but-undefined)\b/im`) tolerates leading whitespace, `>`, `-`,
`*` — but not `(`. Line 140's leading `(` defeats both the strip filter and the backstop that is
supposed to catch anything the filter misses, because the backstop uses the exact same regex.

```
node -e '
const RE = /^[\s>\-*]*(?:Derived|Visual|Named-but-undefined)\b/im;
console.log(RE.test("(Derived: effectively a 2-space loop)"));   // false
console.log(RE.test("Derived: bare form"));                       // true
'
```

**This did not cause an actual leak in this run's real dispatches** — `CARDS.md` never built a
payload at all, because of the unrelated line-270 throw (headline 1). The two defects happen to
mask each other in this exact corpus: the file that would demonstrate the paren-gap leak is the
same file whose OTHER defect blocks it from ever being dispatched. **This is a latent, currently-
unexercised gap, not a live fabrication in this run's evidence** — but it is real, reproducible,
and means `d1c7199a`'s fix is incomplete for a parenthesized bare-`Derived:` form. Reported per this
run's honesty discipline; not fixed here (measurement, not remediation).

## Headline number 3 — determinism did NOT fully hold, and the cause is a genuinely new defect, not noise

27 of 28 dispatchable lines classified identically between run 1 and run 2. **One flipped:**
`seven/01-definitions-and-components.md` L21 (`7 x 4 x 4 = 112`) —
`corroborated-by-composition` (run 1) → `uncorroborated` (run 2).

Traced to a **real, newly-discovered defect in `validateGrounding`'s `findMatch`**, not to model
variance in the philosophical sense and not to a citation-granularity/harness artifact (177-18's
prior determinism-flip cause). `findMatch` uses `Array.prototype.find` — first match wins — when
searching an enumerator's list for a fact matching a reconciler's `quotedFromA`/`quotedFromB` text.
When multiple facts in ONE enumerator's list share an identical (or `isTolerantMatch`-equivalent)
`sourceSentence` — here, `"There are numbers ranging from 1-7 in 4 colors, with 4 copies of each
card."` legitimately backs three distinct facts (range, colors, copies) — a `quotedFromA` that
equals that shared sentence resolves to the FIRST fact in list order, silently attaching the wrong
fact's `numericValue` to the `GroundedBothFact`. In run 2, this corrupted BOTH the "4 colors" and
"4 copies" operands to carry magnitude 7 (borrowed from the unrelated "range" fact), so
`composeArithmeticClaim` could not find its expected `4`s among the cited facts' matched values.

In run 1, enumerator A's list happened to phrase each fact's `sourceSentence` distinctly enough
that this ambiguity did not arise — a genuine difference in real model output between the two
dispatches, but the INSTABILITY it exposes is a property of the code's matching logic, not
acceptable "expected model variance." **Verified this is not a fluke**: re-derived operand
resolution using the methodologically correct approach (matching `citedBothStatements` text to
`GroundedBothFact.statement`, exactly mirroring `classifyDerivedLines`'s own `citedFactIds`
mechanism) and the same failure reproduced identically — this is not an artifact of the analysis
harness's own lookup method.

**This is the single most important finding of this run.** Per this run's closing criteria,
determinism failing on ANY line — for a reproduced, diagnosed code cause — blocks closure
regardless of every other number.

## Headline number 4 — grounding: 3 total rejections across 242+245=487 "both" claims, zero fabrications passed through

| Run | Grounded | Rejected | Rejected lines |
|---|---|---|---|
| 1 | 240 | 2 | `doom-machine/02-card-effect-icons.md` — "Gear"/"Lock" icon glyph descriptions |
| 2 | 244 | 1 | `doom-machine/01-card-anatomy.md` — card-name callout label |

Every rejection is a genuine reconciler Rule-2 violation (paraphrasing instead of quoting
verbatim — e.g. citing `"Gear is a cogwheel glyph in a blue ring."` when enumerator A actually said
`"The Gear icon is a cogwheel glyph inside a blue ring."`), mechanically caught and reported, never
silently accepted. **Zero fabrications passed grounding in either run.**

## Headline number 5 — zero `contradicted`, on any line, in either run

No line in either run resolved `contradicted`. This closing criterion (a single confident false
accusation blocks closure unconditionally) is met.

## Headline number 6 — independence holds mechanically, confirmed by grep, not assertion

```
grep -l -iE "Derived|Visual \(p\.|Named-but-undefined" payloads/*.payload.txt   # 0 matches, all 14 dispatchable slices
grep -L "BS-ENUMERATE-V1" payloads/*.payload.txt                                # 0 matches — every dispatch carried the token
```

Zero annotation lines reached any of the 28 real enumerator dispatch payloads across both runs.

## Full classification, both runs

| Classification | Run 1 | Run 2 |
|---|---|---|
| `corroborated` | 17 | 17 |
| `corroborated-by-composition` | 2 (seven L21, L36) | 1 (seven L36 only) |
| `uncorroborated` | 7 | 8 |
| `contradicted` | 0 | 0 |
| `quote-unverified` | 0 | 0 |
| `absence-corroborated` | 1 (otp L128) | 1 (otp L128) |
| `absence-unverifiable` | 1 (otp L132) | 1 (otp L132) |
| **Total dispatched-and-classified** | **28** | **28** |
| Blocked (CARDS.md, construction-site throw) | 5 | 5 |
| **Grand total Derived lines** | **33** | **33** |

Per-game breakdown (run 1 / run 2, dispatched lines only):

| Game | corroborated | corroborated-by-composition | uncorroborated | absence-* |
|---|---|---|---|---|
| `seven` (3) | 0 / 0 | 2 / 1 | 1 / 2 | — |
| `one-two-punch` (11) | 8 / 8 | 0 / 0 | 1 / 1 | 2 / 2 |
| `doom-machine`, non-`CARDS.md` (14) | 9 / 9 | 0 / 0 | 5 / 5 | — |
| `CARDS.md` (5) | blocked / blocked | | | |

## The seven `uncorroborated` lines (run 1; 8 in run 2, +seven L21), named by category

| Line | Category |
|---|---|
| `seven` L38 (rounds simultaneous) | Genuine dual-enumeration miss — a real gap, no code defect implicated |
| `otp` L117 (2 Rest cards, implied) | Genuine dual-enumeration miss on an implication, not a stated fact |
| `doom-machine 01-dice-roll-symbology` L25 | Cross-slice reference — corroborating detail lives in a different slice than the one under test; structurally invisible to per-passage dual enumeration (matches 177-18's finding) |
| `doom-machine 01-gameplay-loop-and-phase-i` L15 ("up to 5") | Approximate-flag hedge on a value that is actually a hard cap elsewhere in the rules — the SAME "up to N" ambiguity 177-18 first measured, reproduced here |
| `doom-machine 01-objective-and-setup` L34 (9−3=6) | Conservative arithmetic refusal — `composeArithmeticClaim`'s `unitsCompatible()` correctly refuses "remaining cards" vs "machine part cards" (share only the token "cards"); reproduced identically in both runs, a different specific reason than 177-18's operand-filtering gap but the same broad "arithmetic composition is conservative by design" pattern |
| `doom-machine 02-card-effect-icons` L25 | Cross-slice / compound-synthesis miss |
| `doom-machine 02-player-actions` L23 | Cross-slice reference (Hard Mode card lives in a different slice) |
| (run 2 only) `seven` L21 | **The findMatch defect above — a genuine determinism failure, not a stable miss** |

`otp` L132 is its own explicit bucket (`absence-unverifiable`) — a claim spanning several loosely
related concepts with no safe literal target, exactly as designed, not a defect.

## Answering the goal in its own unit

**Of 33 real, rule-bearing `Derived` lines across three reference games, 28 (85%) received a
genuine, independent dual-enumeration attempt on current code.** Of those 28:

- **18 (run 1) / 17 (run 2)** resolved to a real, code-verified positive signal
  (`corroborated` or `corroborated-by-composition`).
- **2 (run 1) / 2 (run 2)** resolved `absence-*` — one mechanically confirmed, one honestly flagged
  as structurally unanswerable.
- **7 (run 1) / 9 (run 2)** resolved `uncorroborated` — every one individually attributable to a
  named category above, not unexplained noise.
- **0** resolved `contradicted`, in either run.

**5 (15%)** — all of `CARDS.md` — received **no attempt at all**, blocked by a real, disclosed,
uncorrected transcription defect in the game repo (a mid-line-buried citation triggering the
construction-site safety throw by design).

### Named categories, per the run's requirement

**(a) Design limitations** (BoardSmith code, real and reported, not fixed here):
1. `validateGrounding`'s `findMatch` first-match-wins ambiguity on shared `sourceSentence` text —
   the cause of this run's one determinism failure.
2. `ANNOTATION_VOCABULARY_RE`'s missing `(` in its tolerated leading-decoration set — a latent,
   currently-unexercised independence-breaking gap in the `d1c7199a` fix.
3. Cross-slice references — structurally invisible to a design scoped per-passage (3 lines this run).
4. The "up to N" hard-cap-vs-hedge ambiguity in the enumeration contract's `approximate` rule
   (1 line this run, reproducing 177-18).
5. Conservative arithmetic refusal on genuinely-differently-labeled operands whose unit tokens
   share no common substantive word (`doom-machine` L34).

**(b) Corpus/transcription staleness** (game-repo side, not BoardSmith code): `CARDS.md`'s original
line 270 mid-line citation — unresolved since 177-18 first found it, still blocking the whole file.

**(c) Structurally unanswerable** (by design, not a defect): `otp` L132 — an absence claim spanning
several loosely related concepts with no safe literal target.

## CHECK-04 disposition — NOT closed

Per this run's closing criteria, ALL FIVE must hold. Scored against this run's actual evidence:

1. **Determinism — FAILS.** 27/28 identical, 1 genuine flip traced to a real, newly-discovered
   `validateGrounding` defect. The pre-registration predicted determinism risk would concentrate in
   `CARDS.md` (which turned out to be fully blocked, so untestable on that axis) — the actual flip
   appeared somewhere the prior four measurement rounds had called clean, which is itself informative:
   this defect was not caused by the corpus getting harder, but by an ambiguity always latent in
   `validateGrounding`, only exposed when two independently-dispatched enumerators happened to
   phrase a compound sentence's sub-facts closely enough to trigger it.
2. Grounding rejections — PASSES (all real, all caught, zero fabrications passed).
3. Zero `contradicted` — PASSES.
4. Independence — PASSES (confirmed by grep, not assertion).
5. Honest explainability — PASSES (every non-corroborated line named, above).

**Criterion 1 alone is sufficient to block closure**, per this run's own stated rule ("If any
criterion fails, do NOT close CHECK-04"). **CHECK-04 remains open.** Two new, specific,
actionable code defects are reported for whoever picks this up next:

- Fix `findMatch` to disambiguate when a quote matches more than one candidate fact (e.g. prefer
  an exact statement-text match over a shared-sourceSentence match, or require the reconciler to
  quote each fact's own `statement` rather than its possibly-shared `sourceSentence`).
- Extend `ANNOTATION_VOCABULARY_RE`'s tolerated leading-decoration set to include `(`.

Neither is fixed in this run, per honesty discipline (measurement, not post-hoc tuning).

## Confidence

**Low-to-moderate**, unchanged from every prior measurement in this chain — 3 games, 33 lines, 2
runs. This run's distinguishing contribution is not a larger sample; it is that every prior round
measured a DIFFERENT code state, and this is the first single measurement of the code as it
currently stands, on all three games, twice. That is exactly what let the `findMatch` defect surface
at all — it was invisible to every single-run or single-game measurement in this chain.
