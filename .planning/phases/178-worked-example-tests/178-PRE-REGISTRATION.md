# 178-10 Pre-Registration — expected extraction + satisfiability audit for the SC-3 live proof

**Committed BEFORE any `claude -p` dispatch happens anywhere in this plan or in 178-11.** Per
178-CONTEXT.md decision 13, this file's entire value is git ordering: everything below was written
from direct reads of the live `~/BoardSmithGames/{seven,one-two-punch,doom-machine}` rulebook
trees and from a zero-dispatch, in-process call to the real, unmodified `readLiveSlices` /
`buildExampleExtractionPayload` functions (`src/cli/commands/verify-derive-check.ts`,
`src/cli/commands/example-derivation.ts`) — never from the CONTEXT/plan's inherited corpus
description on faith, per Task 1's explicit instruction. **Zero `claude -p` and zero Task-tool
dispatches occurred anywhere in the production of this file.**

Zero-dispatch script: an ad-hoc `tsx` script importing `readLiveSlices` and
`buildExampleExtractionPayload` directly, run against the three live reference-game trees, no
staging, no ledger present — the same technique 177.1-06's pre-registration used (predicted
`targetingAmbiguousCount` exactly) and 177-11 used before it. No file from this script is
committed; its printed output was read line-by-line to build Section 1 below, and every candidate
example was independently re-confirmed by a direct `cat -n` read of the raw slice file (not taken
from the script's output alone).

---

## Section 1 — Expected extraction, per game, by slice and line

`readLiveSlices` (the function both `verify-example-replay` and `build/test.md`'s worked-example
step actually enumerate from — `rulebook/*.md`, excluding `INDEX.md` and `00-visual-survey.md`,
sorted) returns, confirmed by direct zero-dispatch call against each live project:

- **`seven`: 3 slices** — `01-definitions-and-components.md`, `01-overview-setup-and-play.md`,
  `02-solo-variant.md`.
- **`one-two-punch`: 2 slices** — `01-setup-and-round-structure.md`,
  `02-action-cards-and-resolution.md`.
- **`doom-machine`: 20 slices** — `01-card-anatomy.md`, `01-cards-overview.md`,
  `01-cards-parts-set-1.md`, `01-cards-parts-set-2.md`, `01-cards-trackers.md`,
  `01-destroying-a-machine-part.md`, `01-dice-roll-symbology.md`,
  `01-gameplay-loop-and-phase-i.md`, `01-objective-and-setup.md`, `02-card-effect-icons.md`,
  `02-cards-tracker-player-hp-b-side.md`, `02-hard-mode.md`, `02-machine-phase.md`,
  `02-player-actions.md`, `02-taking-damage-and-winning.md`, `03-cards-parts-set-1.md`,
  `03-cards-parts-set-2.md`, `03-cards-parts-set-3.md`, `03-cards-summary-and-open-issues.md`,
  `OPEN-QUESTIONS.md`. (`OPEN-QUESTIONS.md` counts — `readLiveSlices`'s exclusion list is exactly
  `{INDEX.md, 00-visual-survey.md}`, and `OPEN-QUESTIONS.md` is a plain `.md` file in
  `doom-machine/rulebook/`, so it is a live slice by the same definition CHECK-06 and TEST-01
  actually read.)

**Total: 25 slices across the three games.** This is the correct denominator for "no worked
example expected" rows below — every slice gets exactly one entry in this table if it has zero
examples, or one entry per example if it has one or more.

### CORRECTION TO THE INHERITED CORPUS (found by direct read, not inherited on faith)

178-CONTEXT.md `<measured_reality>` #3 and this plan's own `<corpus>` block state the population as
"~5-6 examples across all three games (~2 each)." **A direct read of every candidate-bearing slice
finds 11 explicitly example-labeled spans, not 5-6** — `one-two-punch` alone has six, not two.
This is exactly the class of correction Task 1 exists to catch (confirm or correct the inherited
inventory by direct read) and is recorded here, before any dispatch, rather than discovered
mid-proof. Per decision 17's spirit (never loosen a check to manufacture a number, but also never
under-report what direct reading actually finds), the corrected count stands as written below and
178-11 must reconcile against THIS table, not the CONTEXT's.

One more correction, smaller: the plan's `<corpus>` block cites the Run example's contradiction as
recorded on "line 13"; a direct read shows it is line 14 (line 13 is a blank line). And the plan
characterizes the `doom-machine`/`02-machine-phase.md` SOUL HARVESTER example as "present only as a
`Diagram description` line" — a direct read shows it also has an explicit `p.2 (panel -8-),
EXAMPLE:` citation header with quoted prose (lines 9-10) IN ADDITION to the diagram description
(line 15). Both corrections are folded into the table below; neither changes the identification
mechanism, only what this pre-registration expects it to find.

### `seven` (3 slices)

| Slice | Line | Verbatim first line | Expected `kind` | Permitted set | Reason |
|---|---|---|---|---|---|
| `01-definitions-and-components.md` | 6 | `"example: 5, 5, 5"` (citation header at L3, "Set" def at L5, Visual at L8) | predicate | `{agrees, disagrees, unexecutable}` | A clean predicate illustration (`isSet([5,5,5])`); a correct translation could legitimately find the chunk doesn't yet model set-checking as an exported predicate, hence `unexecutable` must stay in the set. |
| `01-definitions-and-components.md` | 12 | `"example: 5, 6, 7"` (citation header at L10, "Run" def at L11, Visual at L14) | predicate | `{example-inconsistent}` **ONLY** | **This is the phase's designated adversarial fixture (D-04).** The printed text reads "5, 6, 7"; the slice's own `Visual (p.1):` line at L14 states in-source that the card images show "a red 1, a blue 2, and a red 3" and explicitly names the contradiction ("the printed example text reads 5, 6, 7 while the accompanying card images show 1, 2, 3"). Any verdict other than `example-inconsistent` means extraction failed to notice a contradiction that is printed in the slice itself, in plain prose, not something extraction would have to infer — a single-label expectation is justified here specifically because the slice hands the answer to a correct implementation directly. |
| `01-overview-setup-and-play.md` | — | (no worked example expected) | — | `{no-extraction}` | Direct read of all 40 lines finds setup/round/scoring prose and one `Visual` line describing page layout — no "example"/"for example"/worked-example citation anywhere in this slice. |
| `02-solo-variant.md` | — | (no worked example expected) | — | `{no-extraction}` | Direct read finds solo-scoring guidance and one `Visual` line describing page layout — no example citation. |

### `one-two-punch` (2 slices)

| Slice | Line | Verbatim first line | Expected `kind` | Permitted set | Reason |
|---|---|---|---|---|---|
| `01-setup-and-round-structure.md` | 51-52 | `p.1, Starting a New Game (worked example, italic):` / `"For example, Blue discards their Retreat and tells Red to discard their Punch."` | transition | `{agrees, disagrees, unexecutable}` | **NEW — not in the inherited corpus.** A genuine state→action→state transition example of the opening discard-and-name step; a `disagrees` here is a real code finding, `unexecutable` is legitimate if the chunk doesn't yet model the opening discard/naming step. |
| `01-setup-and-round-structure.md` | 78-79 | `p.1, 2) FIGHT (worked example, italic):` / `"For example, if Red played a Jab and Blue played a Retreat, Red would resolve their Jab first since it has a timing of 1 and Retreat has a timing of 2."` | transition | `{agrees, disagrees, unexecutable}` | **NEW — not in the inherited corpus.** Illustrates the timing-comparison resolution-order rule with concrete card instances. |
| `02-action-cards-and-resolution.md` | 36-37 | `p.2, ADVANCE (worked example, italic):` / `"For example, Blue is in their corner and Red is in the center ring. Blue moves into the center ring, and Red is pushed back into their own corner."` | transition | `{agrees, disagrees, unexecutable}` | **NEW — not in the inherited corpus.** ADVANCE's push-back effect illustrated with a concrete position transition. |
| `02-action-cards-and-resolution.md` | 65-66 | `p.2, PUNCH (worked example, italic):` / `"For example, if Blue is in their corner and Red is in the center and they both Punch, Blue must first exhaust a Guard before both players Punch one another."` | transition | `{agrees, disagrees, unexecutable}` | **NEW — not in the inherited corpus.** Simultaneous-Punch resolution-order illustrated with a concrete matchup. |
| `02-action-cards-and-resolution.md` | 86-89 | `p.2, Punch Examples (italic):` / `"If you are punched and have one ready and two exhausted Guards, you would lose one exhausted Guard."` | transition | `{agrees, disagrees, unexecutable}` | The first of the two examples named in the inherited corpus — genuine Guard-state transition, directly executable in principle. |
| `02-action-cards-and-resolution.md` | 91-94 | `p.2, Punch Examples (italic):` / `"If instead, you have three ready and no exhausted Guards, you would simply exhaust one card, leaving you with one exhausted and two ready."` | transition | `{agrees, disagrees, unexecutable}` | The second of the two examples named in the inherited corpus — genuine Guard-state transition. |

### `doom-machine` (20 slices)

| Slice | Line | Verbatim first line | Expected `kind` | Permitted set | Reason |
|---|---|---|---|---|---|
| `01-destroying-a-machine-part.md` | 13-14 | `Worked example content (p.1, panel -7-, verbatim from card art):` / `"DEAL 1 DMG TO ALL PARTS IN PLAY"` | image-derived | `{unexecutable, example-inconsistent, agrees, disagrees}` | Genuinely open per the inherited corpus and CONTEXT `<measured_reality>` #3 — a card-art-transcribed effect string illustrating "Destroyed Card Effects"; whether it is executable depends on whether the chunk models destroy-effect resolution at all. |
| `01-dice-roll-symbology.md` | 3-21 | `p.1 (panel -13-), DICE ROLL SYMBOLOGY / EXAMPLES:` (six `Symbol shown: ...` / quoted-rule pairs) | predicate | `{unexecutable, example-inconsistent, agrees, disagrees}` | **NEW — not in the inherited corpus.** The slice's own citation header names this block "EXAMPLES" explicitly; each of the six entries is a notation-to-rule illustration (analogous in shape to `seven`'s Set/Run predicate illustrations), transcribed from card-art die-face glyphs — image-derived, same open reasoning as the other `doom-machine` entries. Whether extraction records this as one composite example or six discrete ones is an identification-granularity call left to the subagent (decision 1: identification is judgment); this row states the slice-level expectation only. |
| `02-machine-phase.md` | 9-15 | `p.2 (panel -8-), EXAMPLE:` / `"The HP die for Soul Harvester will cycle one space down the track, triggering its [damage icon] ability, which will deal 5 damage to the player..."` (plus the `Diagram description` at L15 describing the same SOUL HARVESTER card) | image-derived | `{unexecutable, example-inconsistent, agrees, disagrees}` | The SOUL HARVESTER example from the inherited corpus — corrected above to note it carries an explicit `EXAMPLE:` quoted citation, not diagram-description text alone. Genuinely open: whether the chunk models cycle-track movement and damage-icon triggering determines executability. |
| `01-card-anatomy.md` | — | (no worked example expected) | — | `{no-extraction}` | Callout-label legend + one diagram description; no example citation. |
| `01-cards-overview.md` | — | (no worked example expected) | — | `{no-extraction}` | General card-back/cycle-track description; no example citation. |
| `01-cards-parts-set-1.md` | — | (no worked example expected) | — | `{no-extraction}` | Zero extraction-candidate lines (confirmed by the zero-dispatch dry run — every line is either blank, a heading, or a `Derived (p.` reference, none quotable). |
| `01-cards-parts-set-2.md` | — | (no worked example expected) | — | `{no-extraction}` | One extraction-candidate line (an "Open issue: dead-space wraparound" pointer), not an example citation. |
| `01-cards-trackers.md` | — | (no worked example expected) | — | `{no-extraction}` | Zero extraction-candidate lines. |
| `01-gameplay-loop-and-phase-i.md` | — | (no worked example expected) | — | `{no-extraction}` | Phase-loop description, no example citation. |
| `01-objective-and-setup.md` | — | (no worked example expected) | — | `{no-extraction}` | Setup steps + diagram legend + diagram description; no example citation. |
| `02-card-effect-icons.md` | — | (no worked example expected) | — | `{no-extraction}` | Icon-meaning legend, no example citation. |
| `02-cards-tracker-player-hp-b-side.md` | — | (no worked example expected) | — | `{no-extraction}` | Zero extraction-candidate lines. |
| `02-hard-mode.md` | — | (no worked example expected) | — | `{no-extraction}` | Hard-mode rule variations, no example citation. |
| `02-player-actions.md` | — | (no worked example expected) | — | `{no-extraction}` | Player-action rules + one diagram description; no example citation. |
| `02-taking-damage-and-winning.md` | — | (no worked example expected) | — | `{no-extraction}` | Damage/win-condition prose, no example citation. |
| `03-cards-parts-set-1.md` | — | (no worked example expected) | — | `{no-extraction}` | Zero extraction-candidate lines. |
| `03-cards-parts-set-2.md` | — | (no worked example expected) | — | `{no-extraction}` | Zero extraction-candidate lines (references "example" only inside an excluded `Derived (p.` line, per `buildExampleExtractionPayload`'s own construction-site guard). |
| `03-cards-parts-set-3.md` | — | (no worked example expected) | — | `{no-extraction}` | One extraction-candidate line, a correction note about card text, not an example citation. |
| `03-cards-summary-and-open-issues.md` | — | (no worked example expected) | — | `{no-extraction}` | Two extraction-candidate lines, both open-issue notes about undocumented operators, not example citations. |
| `OPEN-QUESTIONS.md` | — | (no worked example expected) | — | `{no-extraction}` | Five extraction-candidate lines, all open-question quotes about ambiguous rules, not example citations. |

### Corpus size, stated plainly (decision 16)

**11 worked examples across 25 slices in 3 games: `seven` 2, `one-two-punch` 6, `doom-machine`
3.** At this n a percentage is meaningless and none is computed anywhere in this document or
sanctioned for 178-11's report — the per-example named-outcome table above (and the per-slice
breakdown `verifyExampleReplayCommand`'s own report already produces) IS the report, per decision
16.

### Decision 17, stated verbatim in substance

A reference game that produces **zero** extractable examples from this table is a **real finding
about the ingest contract** — evidence that worked examples were not transcribed for that game —
and must be reported as such. It is **never** a tuning signal and **never** a reason to loosen
extraction's identification criteria to manufacture a non-zero count. (This table shows all three
reference games have at least one real example, so this rule is not triggered by the corpus
itself — it governs how 178-11 must react if a LIVE dispatch nonetheless returns zero for a game
that this table expects to have examples, which would itself be a finding about the extraction
subagent, not the corpus.)

---

## Section 2 — Satisfiability audit: every criterion checked against "could this ever pass?"

One row per proposed acceptance criterion. Any row whose satisfiability answer is not a clean "no"
is REWRITTEN or REJECTED here, before commit — never after a run fails it. Derived from ROADMAP.md
Phase 178's three success criteria plus 178-CONTEXT.md decisions 14/16/17 and 178-RESEARCH.md
Pitfall 5.

| # | Criterion (as originally proposed) | How measured | Satisfiability audit — could a correct implementation ever fail this for reasons outside its control? | Disposition |
|---|---|---|---|---|
| 1 | (ROADMAP SC-1, literal) "`build/test.md` generates an executable test for every worked example in a newly-built chunk's cited slices." | Run `build/test.md`'s worked-example step against a freshly-built chunk; count generated test files vs. extracted examples. | **YES.** `unexecutable` is a first-class, legitimate verdict (decision 7) for an example the chunk cannot express yet, and `example-inconsistent` examples are NEVER turned into a test by design (decision 4) — `seven`'s Run example (Section 1) must produce zero generated test bytes by construction. A correct implementation satisfying the literal wording on `seven`'s corpus is impossible whenever the Run example is in scope. | **REWRITE** → "every worked example in a newly-built chunk's cited slices produces either an executable test, a recorded `unexecutable` verdict with a named reason, or (for the one designated `example-inconsistent` fixture) a routed Open Rules Gaps finding — never silently dropped without one of these three outcomes." |
| 2 | (ROADMAP SC-2, literal) "Running worked-example replay against a reference game's cited slices executes each example against the real engine and reports any mismatch as a finding." | Run CHECK-06 (`verify-example-replay` + the two dispatches) against each reference game's live slices; inspect the ledger. | **YES**, same defect class as #1 — "executes each example" cannot be literally true for an example translation legitimately marks `unexecutable`, and is a NON-GOAL for `example-inconsistent` examples by design. | **REWRITE** → "executes every worked example that translation can express against the real engine, and reports every `unexecutable` and `example-inconsistent` outcome by name in the same report — never silently drops an example from the count." |
| 3 | (ROADMAP SC-3, literal) "Both mechanisms share the same example-to-test derivation logic rather than duplicating it." | Code inspection: both `build/test.md` item 4 and `verify-game.md` Step 8 cite the identical `extract-example.md`/`translate-example.md` contracts (`BS-EXAMPLE-EXTRACT-V1`/`BS-EXAMPLE-TRANSLATE-V1`) and the identical `example-derivation.ts` payload builders, confirmed already by 178-08/178-09's own regression tests. | **NO.** This is a static, structural property of the shipped code (import graph / cited-file identity), not a property of any model dispatch. A correct implementation either shares the module or it doesn't; there is no model-variance path by which a correct, shared-logic implementation could fail this criterion for reasons outside its control. | **KEEP** as written — no rewrite needed. |
| 4 | "The `seven` Run example is never turned into a test." | Check the ledger / generated-test directory for any test artifact tied to `seven`'s L12 Run example. | **YES, and dangerously so.** As literally worded this criterion PASSES TRIVIALLY if extraction finds nothing at all for that line (e.g. a broken extraction dispatch that silently returns zero examples) — a vacuous pass that would hide a real regression rather than prove the adversarial-fixture path works. | **REWRITE** → "the `seven` Run example is recorded with verdict `example-inconsistent`, WITH BOTH contradicting excerpts (the printed '5, 6, 7' text and the Visual line's '1, 2, 3' card-art description) present in the recorded finding — a missing record is a FAILURE of this criterion, not a pass." |
| 5 | Any "N of M examples must agree/pass" bar computed over a single game's example count (e.g. "2 of 2 `one-two-punch` Punch Examples must corroborate"). | N/A — never instantiated. | **YES, by construction (178-RESEARCH.md Pitfall 5).** At M as low as 2-6 per game, a single legitimate `unexecutable` verdict or a single flaky dispatch makes any nonzero threshold below M fail permanently, or makes an M-of-M threshold fragile in the same shape as the CHECK-04 byte-identical determinism gate that cost four full measurement runs (`177-20` through `177-22`) before being retired as miscalibrated (REQUIREMENTS.md CHECK-04 entry). | **REJECT.** No N-of-M bar over any single game's example count is adopted anywhere in this milestone's acceptance bar. Replaced entirely by the per-example named-outcome table in Section 1 plus raw counts in the final report — the shape 178-CONTEXT decision 16 already mandates. |
| 6 | "Extraction identifies every worked example a human designer would recognize in the slice." | N/A — never instantiated as a measurable bar. | **YES.** "Every worked example a human would recognize" is unbounded and unmeasurable — Section 1's own corrections above (found by direct read, not by the inherited corpus) prove that even a careful human pass over the same text can under-count on a first read. There is no fixed, checkable target this bar could be verified against without first performing the exact judgment call it claims to test. | **REJECT.** Replaced by: extraction is checked against THIS document's pre-registered per-slice table (Section 1), which is itself the best-effort human enumeration, corrected by direct read before dispatch — a fixed, checkable target rather than an open-ended "would a human agree" standard. |

**Result:** 6 criteria audited; 4 REWRITTEN, 1 REJECTED outright (plus its generalized N-of-M form rejected as a class), 1 KEPT unchanged. No criterion above is dropped silently — every disposition and its rewritten wording is recorded here before any dispatch.

---

## Section 3 — Stability definition (decision 15)

**Stability is measured on the generated test's PASS/FAIL OUTCOME across two independent
extraction+translation runs of the SAME example — never on byte-identical spec text, verdict
label, or generated source code.**

This is exactly redefinition option (a) that `177-22`'s closure note named and never got to try
for CHECK-04: "stability of the underlying grounded-fact set rather than the final classification
label." Two independent runs of the same example that phrase the extracted `WorkedExample` spec
differently, or generate differently-worded test code, while both tests AGREE on pass/fail against
the real engine, is a **SUCCESS** — not a flip, not a finding, not evidence of non-determinism
worth reporting.

**The retired CHECK-04 byte-identical determinism gate is explicitly NOT re-imported here
(decision 15).** That gate compared classification LABELS across independent dispatches and was
retired as miscalibrated (REQUIREMENTS.md CHECK-04 closure note) precisely because independent
enumerations imply variance, and `claude -p` exposes no sampling/seed control to eliminate it. This
milestone does not repeat that mistake at the executable-outcome layer either: two runs are not
compared on whether they produced the identical `WorkedExample.statement` string, the identical
translated test source, or even the identical verdict label between `agrees`/`corroborated`-shaped
outcomes — only on whether the generated test, when RUN, passes or fails.

**What WOULD count as a real stability failure:** the same example's generated test — run against
the SAME unchanged game code — passing in one extraction+translation run and failing in the other.
That is a genuine finding (either the translation is flaky in a way that changes observable
behavior, or the example itself is ambiguous enough that two reasonable translations diverge on
what "correct" means) and would be reported as such, never silently averaged away or excused as
"expected variance" the way a label-level flip would be.

---

## Section 4 — Staging discipline (decision 18)

Every live dispatch in 178-11 runs against `cp -R` copies, never the original `~/BoardSmithGames/`
trees, with sha256 baselines taken before and compared after — the discipline that held across
200+ live dispatches in both of Phase 177's proof runs (177.1-06, 177.1-08) and is reused
unmodified here, not reinvented.

**Baseline command (run against each ORIGINAL tree, before any `cp -R`):**

```bash
cd ~/BoardSmithGames/<game> && find "$(pwd)" \( -iname '*.md' -o -iname '*.pdf' \) -type f -print0 \
  | xargs -0 shasum -a 256 | sort > <phase-dir>/178-11-PROOF/baseline-<game>.sha256
```

(This is the exact selector `177.1-06`'s pre-registration reproduced byte-for-byte against
`177-22-MEASUREMENT/baseline-seven.sha256` — `.md`/`.pdf` files only, case-insensitive extension
match, sorted for a stable diff.)

**Staging command (the ONLY thing 178-11's live dispatches ever operate on):**

```bash
cp -R ~/BoardSmithGames/<game> <scratch-dir>/178-11/<game>
```

**Post-run verification (run against the ORIGINAL tree again, after all dispatches complete):**

```bash
cd ~/BoardSmithGames/<game> && shasum -a 256 -c <phase-dir>/178-11-PROOF/baseline-<game>.sha256
```

Every line must report `OK`. Any `FAILED` line means the original reference game was touched by
this proof and is a blocking finding, not a warning — 178-11 must stop and report it before
proceeding, never silently continue.

---

## Satisfiability self-check on THIS document's own committed criteria

One line per row this document actually commits 178-11 to, restated from Section 2's KEEP/REWRITE
outcomes (the REJECTED rows commit to nothing and are not re-audited here):

- **Rewritten SC-1 (executable-or-named-unexecutable-or-inconsistent, per chunk build):** No. Every
  example in Section 1 already has a stated permitted set that includes at least one non-agrees
  outcome (`unexecutable` for every predicate/image-derived row, `example-inconsistent` for the one
  designated fixture), so no example in this corpus can force this criterion into an unsatisfiable
  corner — a correct implementation is free to land on any member of its own row's permitted set.
- **Rewritten SC-2 (executes-what-it-can, reports-the-rest-by-name):** No, same reasoning — the
  criterion is satisfied by ANY combination of outcomes drawn from each example's own permitted
  set, never a single fixed label.
- **SC-3 (shared derivation logic, unchanged):** No — a static code-structure fact, not
  dispatch-dependent; already demonstrated true by 178-08/178-09's own regression tests before this
  plan even started.
- **Rewritten Run-example criterion (`example-inconsistent` WITH both excerpts):** No — the slice
  itself prints both contradicting values in plain prose (Section 1's row for L12), so a correct
  extraction reading that text has no route to failing this for reasons outside its control; the
  only way to fail it is to not read the line correctly, which is precisely the defect this
  criterion exists to catch.
- **Rejected N-of-M bar (never adopted):** N/A — nothing to audit; this criterion is not part of
  178-11's acceptance bar.
- **Rejected "human-recognizable" bar (never adopted):** N/A — replaced by this document's own
  Section 1 table, which is the fixed, checkable target.

**No criterion surviving into 178-11's acceptance bar is dropped as a result of this check** — 3
rewritten criteria (SC-1, SC-2, the Run-example criterion) and 1 unchanged criterion (SC-3) all
survive satisfiable as written; 2 proposed criteria (an N-of-M bar, a "human-recognizable" bar)
were rejected before ever being adopted.
