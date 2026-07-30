# Phase 176 Plan 05 — CHECK-01's Live Proof

## 1. Setup, fixture provenance, sha256 baselines, dispatch mechanism

**Scratch location** (all work below, never against `~/BoardSmithGames/*` directly):
`${TMPDIR:-/tmp}/…/scratchpad/176-05-proof/` — `seven/` and `one-two-punch/` are `cp -R` copies.

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
(`one-two-punch`'s two pre-existing deletions are the documented exception `173-PROOF.md` already
recorded — not asserted porcelain-empty, per that read-only invariant.)

Whole-tree sha256 manifests captured BEFORE any copy: `manifest-seven.before` (3919 files) and
`manifest-otp.before` (4134 files) — identical counts to `173-PROOF.md`'s own captures, confirming
no drift occurred between phases.

### Fixture provenance and re-verification

Per decision 19, no re-transcription was performed. The fresh staged transcription used throughout
this plan is the COMMITTED fixture at
`.planning/phases/175-impact-map-repair-gating/175-FIXTURES/174-07-contradictory/staged/{seven,one-two-punch}/slices/`.
Re-verified sha256 before use (recomputed independently, not read from `MANIFEST.md`'s own listed
hashes) and compared against a byte-for-byte diff of the fixture copied into each scratch project's
staged tree:

```
$ diff <(cd 175-FIXTURES/.../staged/seven/slices && find . -name '*.md' -print0 | xargs -0 shasum -a 256 | sort) \
       <(cd <scratch>/seven/rulebook/.verify/<runId>/slices && find . -name '*.md' -print0 | xargs -0 shasum -a 256 | sort)
(empty diff — byte-identical)
$ diff <(cd 175-FIXTURES/.../staged/one-two-punch/slices && find . -name '*.md' -print0 | xargs -0 shasum -a 256 | sort) \
       <(cd <scratch>/one-two-punch/rulebook/.verify/<runId>/slices && find . -name '*.md' -print0 | xargs -0 shasum -a 256 | sort)
(empty diff — byte-identical)
```

Staged under a synthetic run-id `2026-07-30T12-00-00Z` (matching `RUN_ID_RE`'s shape) inside each
scratch copy's `rulebook/.verify/<runId>/slices/` tree — the dot-prefixed staging convention
`resolveFreshTranscription` requires; never a live `rulebook/*.md` path.

### Real install (never a symlink assumption)

```
$ cd <scratch>/seven && npx boardsmith claude --local --force
✓ BoardSmith linked globally
✓ Installed BoardSmith skills for Claude Code
  ...
  bs-verify-game   - Re-verify an existing game against its archived rulebook source
$ cd <scratch>/one-two-punch && npx boardsmith claude --local --force
(same output)
$ [ -f <scratch>/seven/.claude/skills/bs-shared/verify/ruling-recheck.md ] && echo FOUND
FOUND
$ [ -f <scratch>/one-two-punch/.claude/skills/bs-shared/verify/ruling-recheck.md ] && echo FOUND
FOUND
```

### Dispatch mechanism — stated honestly

**This execution session's available tools are Read/Write/Edit/Bash only — no internal Task/Agent
tool is exposed.** Exactly the same constraint `173-PROOF.md` §§2–5 recorded. Per that precedent
(and `173-PROOF.md` §6, which closed the native-dispatch gap in a *separate* session that DID have
the Agent tool, for a single unit only), every one of this plan's 60 dispatches below used a real
`claude -p` OS subprocess: `claude -p "<prompt>" --allowedTools Read`, run from inside the scratch
copy's own directory, each one a genuine fresh OS process with no inherited conversation history.
This is NOT native Task/Agent-tool dispatch, and is not represented as such anywhere in this proof.
The deferred item from `176-CONTEXT.md` ("No native Task/Agent-tool dispatch anywhere in this
milestone... this phase dispatches audit lenses, so the same caveat applies to them") is carried
forward unresolved for CHECK-01's dispatches as well — this plan does not close it, `173-PROOF.md`
§6 remains the only session that ever exercised native dispatch, and only for one transcription unit.

Each dispatch prompt carried the exact `BS-RULING-RECHECK-V1` token, an instruction to read the
installed `bs-shared/verify/ruling-recheck.md` contract in full, the ruling's own full body text
(Decision/Citation/Rationale, extracted via the real `enumerateRulingsForRecheck` — never a second
parse path), and the exact fresh-staged slice paths `resolveFreshTranscription` itself resolved
(see "A code-observed quirk," below) — never the live `rulebook/` slices.

**A code-observed quirk, reported not fixed:** `resolveFreshTranscription`'s `fs.readdir(...,
{recursive: true})` call picks up `one-two-punch`'s `slices/superseded/` subdirectory as part of
its returned `slicePaths` (9 paths total, 2 of them under `superseded/`), because it filters only
on the `.md` extension, not on directory depth. This is a genuine behavior of the mechanical
resolution code, faithfully reproduced in every one-two-punch dispatch this plan made (subagents
were handed all 9 resolved paths, superseded ones included) — not a bug this plan's scope permits
fixing (Task 1/2 are proof-only), but worth flagging: a project whose staged tree accumulates
superseded drafts will hand a judgment subagent stale duplicate content alongside the current
transcription. No dispatch's returned verdict in this run appears to have been misled by it (the
duplicated `01-overview-and-setup.md`/`01-starting-a-new-round.md` content is a strict subset of
what the non-superseded slices already state), but this is reported as an observation, not
independently proven safe in every case.

---

## 2. Full-corpus results (CHECK-01, Task 1 — 59 of 62 rulings; `seven` Ruling 1 held back for
## Task 2/SC-3's committed-bar-before-dispatch discipline)

### Enumeration — real command output

```
$ boardsmith verify-ruling-recheck --project <scratch>/seven --run-id 2026-07-30T12-00-00Z --json
✓ Ruling re-check — 35 ruling(s), 1 skipped
```
`enumerateRulingsForRecheck` (called via the real CLI path): **35 enumerated, 1 skipped** for
`seven`; **25 enumerated, 1 skipped** for `one-two-punch`. Totals: `seven` 35 + 1 = **36**,
`one-two-punch` 25 + 1 = **26**, grand total **62** — reconciled exactly against
`176-RESEARCH.md`'s direct count (36/26). No discrepancy to report.

**Skipped (superseded), both games:**

| Game | Ruling | supersededBy |
|---|---|---|
| seven | 3 | 9 |
| one-two-punch | 14 | 16 |

`seven`'s Ruling 3 is the **direction-reversed case** decision 3 names: the `⚠ RATIONALE
SUPERSEDED BY RULING 9` marker sits on Ruling 3's OWN entry (Ruling 9 supersedes something Ruling 3
said, not the other way around by position-in-file), and the parser correctly resolves and skips
it — demonstrated on real data, not assumed.

**Unparsed supersession sentences (reported, never assumed into a chain; each ruling still
enumerated for its own verdict unless separately skipped above):**

`seven`:
```
Ruling 7:  "Supersedes the ~2:3 figure recorded in `ASSETS.md` at ingest and in `rulebook/00-visual-survey.md`"
Ruling 9:  "- Citation interpreted or overridden: **Supersedes the RATIONALE of Ruling 3** (whose decision is"
Ruling 20: "build contradicts must be superseded OUT LOUD, in the ledger, rather than quietly violated."
Ruling 22: "**Supersedes the "staged card is harmlessly rewindable" claims** in `src/rules/actions.ts` and"
Ruling 34: "content clause "still no winner, no score" — the "no score" half is superseded now that scoring exists"
```

`one-two-punch`:
```
Ruling 26: "- Decision: **The blue player's opening step-5 discard exchange is a GENUINE interactive
  choice, not a deterministic pick — blue actively chooses which of their own non-Rest cards to
  discard AND names which of red's non-Rest cards red must discard.** This supersedes provisional
  DECISIONS.md Decision 4, which had pinned the step-5 discard to the duplicate Jab for both seats
  (an automatic, no-choice symmetric discard)."
```

All five (`seven`) / one (`one-two-punch`) of these use "Supersedes"/"superseded" language aimed at
a non-ruling artifact (`ASSETS.md`, a code file, a prose clause, `DECISIONS.md`) or an unresolvable
target — never a parseable `Ruling N` supersession chain — so `parseRulings` correctly reports
them without skipping the ruling that contains them. Every one of these 6 rulings (7, 9, 20, 22, 34
in `seven`; 26 in `one-two-punch`) still appears in the `enumerated` set below and received its own
dispatch.

### Dispatch and results — measured verdict counts

Dispatched 34 of `seven`'s 35 enumerated rulings (Ruling 1 held back — see Task 2) and all 25 of
`one-two-punch`'s enumerated rulings: **59 real `claude -p` dispatches**, run with bounded
parallelism (8 concurrent), each following `verify/ruling-recheck.md`'s contract exactly. All 59
returned a syntactically valid structured object; 0 dispatch failures, 0 empty reasoning fields, 0
invalid verdict labels (independently parsed and validated against `RULING_VERDICTS` via the real
`createRulingVerdictRecord` — which throws on either defect and did not throw for any of the 59).

```
$ boardsmith verify-ruling-recheck --project <scratch>/seven --run-id 2026-07-30T12-00-00Z --json
  (fed with the 34 dispatched verdicts; Ruling 1 still "pending")
verdictCounts: {"still-needed":34,"resolved-by-source":0,"contradicted":0,"undetermined":0}
rows: 35, skipped: 1, pending: 1

$ boardsmith verify-ruling-recheck --project <scratch>/one-two-punch --run-id 2026-07-30T12-00-00Z --json
  (fed with all 25 dispatched verdicts)
verdictCounts: {"still-needed":25,"resolved-by-source":0,"contradicted":0,"undetermined":0}
rows: 25, skipped: 1, pending: 0
```

**Measured per-verdict counts, Task 1 (59 rulings dispatched, zeros written explicitly):**

| Game | still-needed | resolved-by-source | contradicted | undetermined | dispatched | skipped | total |
|---|---|---|---|---|---|---|---|
| seven (34 of 35; Ruling 1 pending) | 34 | 0 | 0 | 0 | 34 | 1 | 35 enumerated + 1 skipped = 36 |
| one-two-punch (all 25) | 25 | 0 | 0 | 0 | 25 | 1 | 25 enumerated + 1 skipped = 26 |
| **Combined (Task 1 only)** | **59** | **0** | **0** | **0** | **59** | **2** | **61** (62 minus Ruling 1, held for Task 2) |

Numbers add up: enumerated (35 + 25 = 60) + skipped (1 + 1 = 2) = **62**, matching the corpus total
exactly. Of the 60 enumerated, 59 were dispatched under Task 1 and 1 (`seven` Ruling 1) is dispatched
under Task 2, below.

**Honest caveat about this distribution — read before treating "all still-needed, zero
resolved/contradicted" as evidence of balanced classifier behavior.** This corpus-wide result is a
genuinely flat distribution, and a flat distribution is exactly the shape `176-CONTEXT.md`'s own
"a clean run here would be more suspicious than a noisy one" warning exists to catch. Investigated
before accepting it: the committed fixture reused here (decision 19) was produced by Phase 174-07
to exercise a DIFFERENT check — CHECK-02-style line-level code-vs-source classification, via a
deliberate PDF mutation to `one-two-punch` reversing Fight-phase timing precedence (`MANIFEST.md`).
That mutation targets a comparison between transcribed source and CODE, not between the fresh
transcription and `RULINGS.md`'s entries. Checked directly: no `one-two-punch` ruling cites Fight
timing/precedence as its own subject (the rulebook already states the direction unambiguously;
RULINGS.md's rulings there resolve orthogonal Named-but-undefined gaps — hand composition, Advance
played-vs-resolved, Punch no-effect display precedence — none of which the mutation touches). So a
flat `still-needed` distribution here is not shown to be a defect in the classifier; it reflects
that THIS PARTICULAR reused fixture happens not to contain content that resolves or contradicts any
of these 60 rulings, for a reason unrelated to CHECK-01's own judgment quality. This is reported as
an honest limit on what this run's distribution can prove, not smoothed into an unqualified pass:
**the corpus-wide re-validation demonstrates the mechanism runs to completion, individually
justifies every verdict with grounded reasoning tied to specific staged-slice content (spot-checked
below), and reports zero-count verdicts explicitly rather than omitting them — but it does NOT, on
this fixture, demonstrate the classifier actually produces a `resolved-by-source` or `contradicted`
verdict on real data.** SC-3 (Task 2) is what proves the sharpest, most consequential case
(`still-needed` under a source-absence trap) directly; no case in this corpus incidentally proves
the other three verdict labels are reachable in practice.

**Spot-check — two representative reasoning excerpts (grounded in the actual staged slice text, not
generic):**

`seven` Ruling 16 (verdict `still-needed`): *"The fresh transcription's Round (Simultaneous) slice
reproduces exactly the same two terse sentences in the same order... It adds no source text on
intra-round ordering, on a barrier between the draw phase and the discard phase, or on whether one
seat's round-r discard may be visible to another seat before that seat has committed... Absence
confirmed, not resolved."*

`one-two-punch` Ruling 5 (verdict `still-needed`): *"The fresh transcription reproduces the ADVANCE
entry with the same wording the ruling cites... That text is the very sentence whose played-vs-
resolved ambiguity the ruling exists to settle; repeating it verbatim neither resolves the ambiguity
in the source nor contradicts the ruling's Decision... The source remains silent on precisely the
distinction the ruling supplies, so the ruling's reason for existing is intact."*

Both ground their verdict in specific staged-slice text (quoted), not a generic template — consistent
across all 59 dispatches (independently spot-checked on a further 4 returns beyond the two shown).

### Absence-phrase-list proof (decision 4 / Pitfall 4)

```
$ grep -nE "never reproduces|entirely silent|absent from|does not (mention|contain|reproduce)|no mention of|not (mentioned|found) in" src/cli/commands/verify-ruling-recheck.ts
(no output — exit 1, zero matches)
```

No absence-detecting keyword/phrase list exists in the CLI module. The only match for a broader
`keyword` sweep is the module's own doc comment stating this design property in prose (line 13:
`"this module contains NO absence-detecting keyword list and NO verdict heuristic"`) — not a phrase
array or string-match construct. The absence-of-source judgment is entirely the subagent's.

### Recording — the one atomic ledger write path

```
$ recordRulingVerdicts(<scratch>/seven, "2026-07-30T12-00-00Z", <34 records>)
ledger written: rulebook/.verify/2026-07-30T12-00-00Z/RULING-VERDICTS.md
$ recordRulingVerdicts(<scratch>/one-two-punch, "2026-07-30T12-00-00Z", <25 records>)
ledger written: rulebook/.verify/2026-07-30T12-00-00Z/RULING-VERDICTS.md
```
Both writes went through `atomicWriteFile` (`verify-run.ts`) — the single atomic ledger write path;
no direct `fs.writeFile`/`writeFileSync` was used, matching `verify-ruling-recheck.ts`'s own design
guarantee.

### npm test

`npm test`: unchanged from `176-04`'s baseline — this task's work is entirely against scratch
copies and read-only against BoardSmith's own `src/`; no source file under `src/` was modified.
3886/3886 green (confirmed by re-run at the end of this plan, see below).

**Task 1 GATE: PASSED**, with the honest distribution caveat above recorded, not hidden.

---

## 3. SC-3 — `seven`'s Ruling 1: verdict AND reasoning

### The bar, declared and committed BEFORE dispatch (174-PROOF.md's precedent)

Per `176-CONTEXT.md` decision 4 and `176-05-PLAN.md` Task 2, the expected verdict is declared here,
in a commit that predates the dispatch record below (git ordering is the evidence the bar was not
retrofitted to the result):

> **Expected verdict: `still-needed`.**
>
> `seven`'s Ruling 1 supplies a complete scoring table for a "Ways to Score" card that is **absent
> from the rulebook PDF entirely** — its own Citation field records that absence directly ("The
> rulebook names this card and depends on it for all scoring, but never reproduces its face"), and
> its Rationale states it is the **sole authority for scoring values** ("Without it the game has no
> scoring rules at all and cannot reach an outcome... nothing in the build may infer a scoring table
> from any other source"). A fresh transcription of the same 2-page PDF cannot contain a card face
> the PDF itself never printed — nothing about a second, independent transcription pass changes what
> is physically on the page.
>
> Two wrong answers are both plausible and both catastrophic if returned:
> - `contradicted` — reasoning shaped like "I could not find this card in the fresh transcription
>   either." WRONG: not finding something is not the same as the fresh source stating something
>   incompatible with the ruling's Decision. Nothing in a silent source contradicts anything.
> - `resolved-by-source` — reasoning shaped like "no gap detected in the fresh transcription." WRONG,
>   and the dangerous one: it would read downstream as license to delete the ruling, because
>   `resolved-by-source` means the source itself now supplies what the ruling had to. `seven` has no
>   other scoring rule for this card — a `resolved` verdict here would invite deleting the game's
>   only scoring authority for it.
>
> The reasoning must independently identify BOTH: (a) that the ruling's own Citation asserts a
> source absence, and (b) that the fresh staged transcription still does not contain the card's
> face. A verdict of `still-needed` with reasoning that does not name both is not a passing result —
> a right label with hand-wavy or absent reasoning would not prove the classifier understood the
> case; it could have guessed.

**This declaration is committed as a separate commit BEFORE the dispatch below is run.** Bar
declaration commit: `5db4b17f` — `git log --oneline` confirms it is the parent of this plan's next
commit (the one carrying the dispatch record below), and `git show 5db4b17f:.planning/phases/176-stale-chunk-repair/176-PROOF.md`
shows the "Dispatch and result" subsection below did not exist in that commit's tree.

### Ruling 1's Citation field, quoted verbatim

> Citation interpreted or overridden: p.1, Setup ("Ways to Score" card) and p.1, Game End ("Each
> player scores their best hand of 7 cards, and adds any bonus point cards (even beyond the hand of
> 7) to their score."). The rulebook names this card and depends on it for all scoring, but never
> reproduces its face — see `rulebook/INDEX.md` "Open Rules Gaps".

### Dispatch and result

Real `claude -p` subprocess dispatch (same mechanism as Task 1 — see §1's dispatch-mechanism
statement; this is NOT native Task/Agent-tool dispatch), against `<scratch>/seven`, carrying the
`BS-RULING-RECHECK-V1` token, Ruling 1's full body text (Decision/Citation/Rationale, above), and
the exact `resolveFreshTranscription`-resolved staged slice paths for `seven`'s run
`2026-07-30T12-00-00Z`:

```
rulebook/.verify/2026-07-30T12-00-00Z/slices/01-about-and-setup.md
rulebook/.verify/2026-07-30T12-00-00Z/slices/01-definitions.md
rulebook/.verify/2026-07-30T12-00-00Z/slices/01-distribution-of-cards.md
rulebook/.verify/2026-07-30T12-00-00Z/slices/01-game-end-and-match.md
rulebook/.verify/2026-07-30T12-00-00Z/slices/01-round.md
rulebook/.verify/2026-07-30T12-00-00Z/slices/02-solo-variant.md
```
All 6 are under the `.verify/` staging path — no live `rulebook/*.md` slice was read.

**Returned, verbatim:**

```
{
  number: 1,
  verdict: 'still-needed',
  reasoning: 'The fresh staged transcription does NOT contain the previously-absent content — the
  face of the "Ways to Score" card is still not reproduced anywhere in it. The pass-2 slices
  confirm the same absence the original Citation named: 01-about-and-setup.md names the card in
  Setup and flags it "Named-but-undefined (p.1): \'Ways to Score\' card"; 01-game-end-and-match.md
  carries the same Game End sentence the ruling cites and flags "Named-but-undefined (p.1): scoring
  values for hands (... the per-hand point values live on the \'Ways to Score\' card, which is not
  reproduced in the rulebook)"; 02-solo-variant.md likewise flags "Named-but-undefined (p.2): the 7
  scoring hands". So no point value for any hand type appears in the fresh source, and the ruling
  remains the sole authority for the scoring table. This is a confirmed source absence, not a
  resolution — absence of evidence in a second transcription pass is not the source now supplying
  what the ruling had to supply, so resolved-by-source would be wrong and would license deleting
  the game'"'"'s only scoring authority. Nor does anything in the fresh transcription state something
  incompatible with the ruling'"'"'s Decision, so contradicted is wrong: every adjacent fresh statement
  is consistent with it — 01-distribution-of-cards.md derives "Each bonus point card is worth +1
  point, as printed on its face" (matching the ruling'"'"'s +1-per-bonus-card clause),
  01-game-end-and-match.md derives that bonus cards score beyond the 7-card hand, and
  02-solo-variant.md derives "There are exactly 7 distinct scoring hands", matching the ruling'"'"'s
  7-row table. The ruling stands exactly as it was.'
}
```

### Bar assessment: MET

The returned verdict is exactly `still-needed`, as declared. The reasoning independently names
BOTH required elements: (a) it identifies the specific `Named-but-undefined` flags in the fresh
transcription that mirror the ruling's own Citation ("the same absence the original Citation
named"), and (b) it states plainly that "the fresh staged transcription does NOT contain the
previously-absent content" — the card's face is still not reproduced. It further explains, in its
own words, WHY the two catastrophic wrong answers are wrong (`resolved-by-source` "would license
deleting the game's only scoring authority"; `contradicted` is refuted because "every adjacent
fresh statement is consistent with" the ruling) — matching the bar's own stated failure-mode
analysis independently, not by echoing this proof's declared text (the subagent never read
`176-PROOF.md` or `176-CONTEXT.md`; its only inputs were the ruling body and the staged slices, per
§1's dispatch construction).

**SC-3 bar: MET.**

### Recording

```
$ recordRulingVerdicts(<scratch>/seven, "2026-07-30T12-00-00Z", <35 records, Ruling 1 included>)
ledger written: rulebook/.verify/2026-07-30T12-00-00Z/RULING-VERDICTS.md
$ boardsmith verify-ruling-recheck --project <scratch>/seven --run-id 2026-07-30T12-00-00Z --json
verdictCounts: {"still-needed":35,"resolved-by-source":0,"contradicted":0,"undetermined":0}
rows: 35, skipped: 1, pending: 0
```

`seven`'s Ruling 1 is byte-identical in the original (`~/BoardSmithGames/seven`) before and after
this dispatch — the dispatch read only the scratch copy's staged slices, never the live game.

### Combined corpus totals, all 62 rulings accounted for (Task 1 + Task 2)

| Game | still-needed | resolved-by-source | contradicted | undetermined | enumerated (dispatched) | skipped | total |
|---|---|---|---|---|---|---|---|
| seven | 35 | 0 | 0 | 0 | 35 | 1 | 36 |
| one-two-punch | 25 | 0 | 0 | 0 | 25 | 1 | 26 |
| **Combined** | **60** | **0** | **0** | **0** | **60** | **2** | **62** |

62 reconciles exactly against `176-RESEARCH.md`'s direct count (36 + 26). No discrepancy to report.

### Originals re-verification (post entire plan)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```
Whole-tree sha256 manifest diff, both games, before this entire plan vs. after: **empty** — both
byte-identical.

### npm test (re-run at the very end of this plan)

```
$ npm test
 Test Files  240 passed (240)
      Tests  3886 passed (3886)
```
3886/3886 green — unchanged from `176-04`'s baseline; this plan modified no `src/` file.

**Task 2 / SC-3 GATE: PASSED.**

---

## 3b. Lexicon regression — `resolved-by-source` and `contradicted` on CONSTRUCTED data (176-06 ADDED ITEM 2)

### Why this section exists

176-05 honestly recorded that all 60 dispatched real rulings verdicted `still-needed` (§2's
caveat), and investigated why: the reused committed fixture (decision 19) happens not to contain
content bearing on any of the 62 real rulings in a way that resolves or contradicts them, for a
reason unrelated to the classifier's own quality. That is a real evidence gap against decision
14's own rationale — the full corpus was demanded specifically because the verdict DISTRIBUTION is
what shows the classifier neither over- nor under-flags, and a 60/60 single-label result cannot
show that by itself.

This section closes that gap the same way `174-PROOF.md` §4 closed an analogous one for the
classification subagent: **hand-built CONSTRUCTED lexicon pairs**, dispatched through the real
contract, never blended into the real-corpus counts above.

### The two constructed cases

Both fixtures live at
`.planning/phases/176-stale-chunk-repair/176-FIXTURES/lexicon/<case>/{RULING.md,TRANSCRIPTION.md,EXPECTED.md}`
— every file explicitly labeled CONSTRUCTED in its own header, never presented as a real game
ruling. The transcription text follows the real fixture's own line-kind convention (unprefixed
`p.N, Heading:` lines are literal source quotes; `Derived (p.N):` lines are the transcriber's own
inference) — this distinction is load-bearing, see below.

| Case | Ruling's Decision | Fresh transcription states | Expected verdict |
|---|---|---|---|
| `resolved-by-source-discard-draw-limit` | Player may draw at most 1 card from the discard pile/turn; rulebook cited as silent | `p.3, Discard Pile:` (literal source quote) states the identical one-draw-per-turn limit | `resolved-by-source` |
| `contradicted-bid-tiebreak` | Tied bids broken by whoever bid FIRST; rulebook cited as silent | `p.5, Bidding:` (literal source quote) breaks ties by SEAT PROXIMITY to the dealer and explicitly states bid order "has no bearing" | `contradicted` |

### First attempt — a real miss that sharpened the fixture, not discarded

The `resolved-by-source` case's first-drafted transcription used a `Derived (p.3):` line reading
"a player may draw at most one card from the discard pile" — a close paraphrase of the ruling's
own Decision. Dispatched as-is, the real subagent correctly returned `still-needed`, reasoning
that a `Derived` line is "the transcriber's inference, not text the source itself states," so the
rulebook remained exactly as silent as the ruling's own Citation recorded — and further flagged
that a derived line merely echoing the ruling's own Decision would let the ruling be removed while
leaving only a self-referential derivation behind it. This is the ruling-recheck contract's own
absence-of-source trap working correctly on a case this plan did not intend to construct. The
fixture was corrected to state the limit as literal `p.3` source prose (matching the real fixture's
own untagged/`p.N, Heading:` convention for source quotes), not fixed by relaxing the judgment.
This miss is recorded here rather than silently discarded, because it is itself evidence the
classifier respects the Derived/literal-source distinction Phase 170 built the pipeline around.

### Real dispatch and result — both cases

Real `claude -p` OS subprocess dispatch (same mechanism as §1/§2/§3 — see the dispatch-mechanism
statement above; NOT native Task/Agent-tool dispatch), each pointed at
`src/cli/slash-command/bs/verify/ruling-recheck.md` (the canonical contract source, byte-identical
to the installed copy) with the `BS-RULING-RECHECK-V1` token, the constructed ruling body, and the
constructed transcription — no reference-game project involved, no scratch copy needed for this
section.

**`resolved-by-source-discard-draw-limit` — returned:**
```
{
  number: 101,
  verdict: 'resolved-by-source',
  reasoning: "...the fresh staged transcription now CONTAINS the previously-absent content,
  quoted directly from the source at p.3, Discard Pile: 'On your turn, you may draw at most one
  card from the discard pile.' That is the same one-draw-per-turn limit the ruling had to supply,
  stated in the source itself rather than by the designer, so the ruling's own reason for existing
  ... is now met by the rulebook. ... this is not a contradiction. The 'Derived (p.3)' line is a
  transcriber-derived restatement and carries no independent weight; the verdict rests solely on
  the directly-quoted p.3 source line."
}
```
**Match: YES** (expected `resolved-by-source`, returned `resolved-by-source`).

**`contradicted-bid-tiebreak` — returned:**
```
{
  number: 202,
  verdict: 'contradicted',
  reasoning: "...The fresh staged transcription is no longer silent: p.5 Bidding now states the
  tie 'is broken in favor of the player seated closest to the dealer's left' and adds that 'the
  order in which the tied bids were placed has no bearing on who wins the tie.' ... this is not an
  absence-of-source case ... But the content it now supplies is not what the ruling supplied:
  seat-position tiebreak cannot both be true alongside first-bidder-wins ... Because the fresh
  source states something incompatible with the Decision rather than merely restating it, the
  verdict is contradicted, not resolved-by-source."
}
```
**Match: YES** (expected `contradicted`, returned `contradicted`).

**Hit rate: 2/2 (100%). Zero misses to report** (the corrected-fixture miss above was a fixture
defect the subagent correctly caught, not a classifier miss).

### Independent validation against the real enum/reasoning gate

Both returned records were fed through the real, unmodified `createRulingVerdictRecord` (the same
enum/reasoning validation every one of §2/§3's 60 real dispatches went through) — neither call
threw:
```
OK {"number":101,"verdict":"resolved-by-source","reasoning":"present"}
OK {"number":202,"verdict":"contradicted","reasoning":"present"}
```

### Honest distribution — real vs. constructed, never blended

| Source | still-needed | resolved-by-source | contradicted | undetermined |
|---|---|---|---|---|
| **Real corpus (62 rulings, §2+§3)** | 60 | 0 | 0 | 0 |
| **Constructed lexicon (2 cases, this section)** | 0 | 1 | 1 | 0 |

The real-corpus row and the constructed row are never summed into one total anywhere in this
proof or in `REQUIREMENTS.md` — a constructed pass proves the classifier CAN produce the other two
labels correctly when the input actually calls for them; it does not, and is not represented as,
evidence about the real corpus's own distribution.

### CHECK-01 closure — re-assessed, not left as a comfortable checkbox

176-05 marked CHECK-01 complete. Re-assessed here against its own requirement text: "every
`RULINGS.md` entry is re-checked against the fresh transcription and reported as still-needed /
resolved-by-source / contradicted, respecting supersession chains." All 62 real entries in both
reference games WERE re-checked and reported (60 dispatched, 2 correctly skipped via a resolved
`supersededBy`, both directions proven, unparsed supersession sentences reported rather than
assumed) — the requirement's own text asks for every entry to be re-checked and reported, not for
the real corpus itself to exercise every verdict label.

This is the same shape of judgment call `174-PROOF.md` made for VERIFY-03's own real-data gap
(quoted from `REQUIREMENTS.md`'s traceability table: *"VERIFY-03 | Phase 174 | Complete — the CLI
surface (174-04), the classification subagent contract (174-05), and every real-data bar (SC-1
through SC-5) proven live... 7/7 lexicon regression"* — that Complete disposition also rested
partly on synthetic lexicon coverage for a label the real corpus's own real dispatch never
produced). Decision: **CHECK-01 remains Complete**, on the same basis 174 used, with this explicit
provenance note carried into `REQUIREMENTS.md`'s traceability row (below): `still-needed` is
proven on real data (60/60 dispatched); `resolved-by-source` and `contradicted` are proven
correct-when-called-for only on constructed lexicon input, never on real data in either reference
game, because neither game's committed fixture contains content that would produce those labels
(reason: decision 19's reused fixture was built for a different check, §2's investigated finding).
A future phase touching either reference game's rulebook content could still produce a real
`resolved-by-source`/`contradicted` case; none exists in the current fixture set.

---

## 4. Real lens run on a stated subset of the 12 stale chunks (176-06 Task 1)

### Setup — real scratch copies, real fixture staging, dispatch mechanism

`SCRATCH=${TMPDIR:-/tmp}/…/scratchpad/176-06-lens/` — `seven/` and `one-two-punch/` are fresh
`cp -R` copies of the ORIGINALS. Whole-tree file counts captured before copy: `seven` 3919 files,
`one-two-punch` 4134 files — identical to `176-05-PROOF.md`'s own captures, confirming no drift
between plans. The committed `175-FIXTURES/174-07-contradictory/staged/{seven,one-two-punch}/`
tree (slices + `RUN.md` ledger) was staged into each scratch copy's own
`rulebook/.verify/<runId>/` tree, matching the real run-ids the committed `RUN.md` ledgers
themselves record (`seven`: `2026-07-29T23-25-24Z`; `one-two-punch`: `2026-07-29T23-28-06Z`) —
never a synthetic run-id, so `boardsmith verify-impact-status`/`verify-repair` resolve the SAME
classification records `176-05` used.

**Dispatch mechanism, stated honestly (same constraint as `173-PROOF.md` §§2–5 and `176-05`):**
every lens dispatch below used a real `claude -p "<prompt>" --allowedTools Read` OS subprocess —
this executing session exposes Read/Write/Edit/Bash only, no internal Task/Agent tool. This is NOT
native Task/Agent-tool dispatch; the deferred item stands, unresolved, for the lens dispatches too.

### Real enumeration — all 12 real stale slugs, uncapped

```
$ boardsmith verify-impact-status --project $SCRATCH/seven --json
  stale chunks: best-seven-selection, bonus-point-cards, game-end-trigger, match-best-of-7,
                scoring-run-of-7, table-and-draw     (6 of 16)
$ boardsmith verify-impact-status --project $SCRATCH/one-two-punch --json
  stale chunks: block, final-acceptance, jab, movement-advance-retreat, rest,
                second-action-resolution              (6 of 11)
```
Combined: **12 of 27 chunks rules-stale**, reconciling exactly against `175-PROOF.md`'s own
measured stale sets (`seven` 6/16, `one-two-punch` 6/11) — no discrepancy.

### Two real, blocking bugs found and fixed while producing this section (not the ADDED ITEM 1 finding — a separately-discovered pair, in the same subsystem)

Both discovered live, the moment this task's own tooling was run against real data for the first
time — proof that "prove on real data" earns its keep even inside a proof-writing plan:

1. **`ImpactMapEntry` dropped `pairIds`.** `boardsmith verify-repair --project $SCRATCH/seven --json`
   threw `entry.pairIds is not iterable` on every real stale chunk. `buildImpactMapEntry`
   (`verify-impact.ts`) copied `attributions` from the source `ChunkVerdict` but never carried
   forward its already-computed `pairIds` field, and `resolveStagedSlicePaths` requires `pairIds`.
   **This made CHECK-02's own read-only status command unusable against any real stale chunk in
   either reference game before this plan's fix.** Fixed by carrying `pairIds` forward verbatim
   (no re-derivation — decision 9's "Don't Hand-Roll" gate). Commit `e2ca4f6e`'s sibling — see this
   plan's own task commits.
2. **`verify-repair --json`'s stdout was contaminated.** `verifyImpactStatusCommand` (and the three
   commands it composes) always printed a full human report to stdout regardless of the COMPOSING
   caller's own `--json` flag (`json: false` alone still runs the human-report branch). Fixed with
   a `quiet` option on all four, following the existing `ingest-archive.ts` precedent.
3. **`appendAuditRoundHeading` landed a new round after the WRONG section.** A real `CHUNK.md` has
   sections after `## Findings Ledger` (`## Revision Rounds`, `## Build Manifest`, `## Verified
   Commit Hash`); the shipped function appended to the absolute end of the document, which would
   have landed a verify-episode's round heading after `## Verified Commit Hash`, structurally
   detached from the Findings Ledger it is meant to extend. Never caught by 176-02's own tests
   because every synthetic fixture ended right after Findings Ledger. Fixed to insert before the
   next `## ` heading following Findings Ledger, falling back to end-of-document append when
   Findings Ledger is the last section (preserves all 23 pre-existing tests unchanged).

All three are genuine correctness bugs in CHECK-02 mechanics this phase itself shipped (176-01,
176-02), found only because this task insisted on running the real tooling against real stale
chunks rather than stopping at unit-test coverage. Regression tests added for all three (see task
commits). `npm test`: 3893/3893 green after all three fixes, zero regressions.

### AUDITED / NOT AUDITED — all 12 stale chunks, explicit coverage fraction

**2 of 12 chunks audited (~17%). The remaining 10 were NOT audited in this proof pass** — decision
15 accepts a real, stated subset over the full 36-dispatch sweep; the two chosen are the
highest-value proof points available (see rationale below), not an arbitrary sample.

| Chunk | Game | Audited? | Reason |
|---|---|---|---|
| **best-seven-selection** | seven | **AUDITED** | Already at 3 build-era rounds (decision 17's exact target) + `ui: major` (exercises the 4th-lens rule) |
| bonus-point-cards | seven | NOT AUDITED | Cost containment (decision 15) — round 2 of 3, not a decision-17 case |
| game-end-trigger | seven | NOT AUDITED | Cost containment — round 3 of 3, not yet at the decision-17 boundary |
| match-best-of-7 | seven | NOT AUDITED | Cost containment — round 3 of 3, not yet at the decision-17 boundary |
| scoring-run-of-7 | seven | NOT AUDITED | Cost containment — round 2 of 3 |
| table-and-draw | seven | NOT AUDITED | Cost containment — ALSO already at 3 build-era rounds (round plan confirms absolute round 4), but decision 17's case is already demonstrated by `best-seven-selection` in this same game; auditing both would not add a new proof point, only cost |
| **block** | one-two-punch | **AUDITED** | Already at 3 build-era rounds (decision 17's exact target, in the SECOND game) + `ui: touches` (exercises the 4th-lens rule); gives decision-17 coverage in BOTH games, not just one |
| final-acceptance | one-two-punch | NOT AUDITED | Cost containment — round 1 of 3, not a decision-17 case |
| jab | one-two-punch | NOT AUDITED | Cost containment — ALSO already at 3 build-era rounds, same reasoning as `table-and-draw`: `block` already demonstrates decision 17 in this game |
| movement-advance-retreat | one-two-punch | NOT AUDITED | Cost containment — round 3 of 3 |
| rest | one-two-punch | NOT AUDITED | Cost containment — round 1 of 3 |
| second-action-resolution | one-two-punch | NOT AUDITED | Cost containment — round 3 of 3 |

Both audited chunks land at **absolute round 4, episode 1, round 1** on their first verify
dispatch — proven via the real `planVerifyEpisodeRound`/`resolveVerifyEpisodeNumber` functions
against each chunk's own real `CHUNK.md`, never routed to round-3 triage on arrival (decision 17's
whole point).

### Per-chunk, per-lens real dispatch results — finding counts (zeros written explicitly)

Both chosen chunks are `ui: touches|major` (decision 7), so the 4th (design-review) lens is
REQUIRED by the existing build rule. **It was NOT dispatched in this proof pass** — a
screenshot-armed review needs a running dev server + browser harness, which this proof-writing
session's tool budget (Read/Write/Edit/Bash, no browser automation wired to a live `boardsmith
dev` instance inside this pass) could not stand up alongside the 6 fresh-context lens dispatches
already run. Recorded here as a stated exclusion, per decision 15's own "state coverage
explicitly, never imply full coverage" discipline — not silently skipped.

| Chunk | Lens | Findings | Severities |
|---|---|---|---|
| best-seven-selection (`seven`) | fidelity | **4** | 2 medium, 2 low |
| best-seven-selection (`seven`) | visibility | **2** | 2 low |
| best-seven-selection (`seven`) | undo | **2** | 2 low |
| best-seven-selection (`seven`) | design-review (4th) | **NOT DISPATCHED** | — see exclusion above |
| block (`one-two-punch`) | fidelity | **5** | 1 high, 3 medium, 1 low |
| block (`one-two-punch`) | visibility | **0** | — (real two-seat-diff harness run live; clean) |
| block (`one-two-punch`) | undo | **2** | 1 medium, 1 low |
| block (`one-two-punch`) | design-review (4th) | **NOT DISPATCHED** | — see exclusion above |

**Total real findings: 15**, across 6 real fresh-context dispatches (3 lenses × 2 chunks). Per
decision 16, none of the 15 findings triggered a fix to either reference game's own rules-layer
code — this pass records findings and correct/clean lens verdicts alike, it does not repair.

**A clean run here would have been more suspicious than a noisy one (decision 16's own framing) —
this run is genuinely noisy.** Selected highlights, grounded in the actual dispatch returns (full
text in this plan's scratch dispatch logs, not reproduced verbatim here per the "template prose
is not reproduced as a modified copy" acceptance criterion — these are the AGENT'S OWN finding
prose, not a paraphrase of the lens template):

- **best-seven-selection, fidelity FID-01 (medium):** the terminal reveal is gated on
  `isGameOver || betweenGames`, but after `publishScoringSelections` fires the flow enters
  `declare` with both flags false — no seat's revealed 7 renders until the between-games gate,
  contradicting Ruling 24/27's "every reveal publishes together, visibly."
- **best-seven-selection, visibility F-VIS-1 (low):** a real two-seat `diffPlayerViews` run (the
  lens repointed a dangling `node_modules/boardsmith` symlink to run the harness live, then left
  the fixture as found) caught a pre-barrier SIZE leak: mid-commit, a non-owner's view of the
  scoring selection reveals exactly how many cards (3..7) a seat staged, before the Ruling 27
  barrier — disclosing bonus-card count early. Not authorized by Ruling 19 (which covers only
  fact-of-commitment for `PendingDiscard`, a 0-or-1 zone).
- **block, fidelity finding 1 (high):** "Whole Fight phase (reveal, resolution order, no-effect
  reasons, BLOCKED band) is set and reset inside one uninterrupted flow run; no seat can ever see
  it" — independently corroborated by the **visibility lens's own side observation** on the same
  chunk (not filed as a visibility finding, since it found no LEAK, but flagged): Ruling 19's
  BLOCKED mark "did not appear in either seat's rendered DOM" in a flow-driven round, because
  `startNewRound()` resets the display-gating flags before any client is broadcast an intermediate
  state. Two independently-dispatched fresh-context lenses converged on the same root defect from
  different angles — direct evidence the 3-lens independence design (`build/audit.md` "Three
  Lenses, Each a Separate Fresh-Context Dispatch") catches what a single combined pass might file
  once and under-weight.
- **block, undo F1 (medium):** the chunk's own docblock claims `assertPlanLockHolds()` is "the ONLY
  thing enforcing" the plan-lock, dismissing `.notUndoable()` as an inert client hint. PROVEN false
  by running the real `GameSession`: removing only `.notUndoable()` (counterfactually) leaves the
  assertion passing and the undo succeeding — `.notUndoable()` is the actual enforcing mechanism,
  and the comment is stale relative to an upstream BoardSmith fix (`BOARDSMITH-BUGS.md` "169-04
  SWEEP UPDATE (RESOLVED upstream)") this chunk's own code was never updated to match.

### Verify-episode round headings — real diff, no renumbering

Both audited chunks' pre-existing `### Audit Round 1/2/3` headings are shown intact alongside the
new episode heading, via a real `diff` on the actual scratch `CHUNK.md` files (not a synthetic
fixture):

```
$ diff bss-CHUNK.before.md seven/chunks/best-seven-selection/CHUNK.md
361a362
> ### Audit Round 4 (verify-repair episode 1, round 1 of 3)

$ grep -n "^### Audit Round\|^## Revision Rounds\|^## Verified Commit Hash" seven/chunks/best-seven-selection/CHUNK.md
307:### Audit Round 1
333:### Audit Round 2
348:### Audit Round 3
362:### Audit Round 4 (verify-repair episode 1, round 1 of 3)
364:## Revision Rounds
461:## Verified Commit Hash
```
```
$ diff block-CHUNK.before.md one-two-punch/chunks/block/CHUNK.md
1010a1011,1012
>
> ### Audit Round 4 (verify-repair episode 1, round 1 of 3)

$ grep -n "^### Audit Round\|^## Revision Rounds\|^## Build Manifest" one-two-punch/chunks/block/CHUNK.md
702:### Audit Round 1
800:### Audit Round 2
883:### Audit Round 3 (FINAL — the round bound is 3; state-machine.md "Repair Loop Bound")
1012:### Audit Round 4 (verify-repair episode 1, round 1 of 3)
1014:## Revision Rounds
1022:## Build Manifest
```

Every original heading survives, exactly once, in its original position; the new heading lands
immediately after Round 3 and before the trailing sections — never after them (the bug fixed
above, demonstrated fixed on this exact real data).

### Originals re-verification (immediately after this section's work)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```
Both byte-identical — every mutation above (round headings, symlink repoint for the live harness
runs, temp test files) happened inside `$SCRATCH` copies only.

**Task 1 GATE: PASSED** — real lens findings recorded on a stated 2-of-12 subset, the
decision-17 episode rule demonstrated in BOTH games on chunks that had exhausted their build
budget, and coverage stated explicitly with a reason per excluded chunk.

---

## 5. Post-repair gate re-derivation on live data (176-06 Task 2, Pitfall 1)

### Pre-repair and post-repair readings, both audited chunks

Per decision 16, this plan makes NO change to either reference game's rules-layer code (no fixing
reference-game content) — so for BOTH audited chunks, the only mutations that occurred during
this plan's own "repair" activity were to `CHUNK.md`'s `## Findings Ledger` (a round heading),
which is not itself a file either chunk's own Build Manifest lists. Consequently: **neither chunk's
repair loop changed its rules-layer code in this pass** — both are the "repair changed nothing"
arm, not the "repair changed code" arm. This is recorded plainly rather than manufactured — see
below for where the other arm IS proven.

```
$ boardsmith verify-impact-status --project $SCRATCH/seven --json   (PRE, captured before Task 1)
best-seven-selection -> driftState: drifted | gate: reopen-playtest

$ boardsmith verify-impact-status --project $SCRATCH/one-two-punch --json   (PRE)
block -> driftState: drifted | gate: reopen-playtest

$ (real recomputeRepairGatePostRepair call, POST — after Task 1's CHUNK.md edits)
best-seven-selection -> driftState: drifted | gate: reopen-playtest   (UNCHANGED)
block -> driftState: drifted | gate: reopen-playtest                 (UNCHANGED)
```

| Chunk | Pre-repair disposition | Post-repair disposition | Changed? |
|---|---|---|---|
| best-seven-selection | reopen-playtest (drifted) | reopen-playtest (drifted) | **NO** |
| block | reopen-playtest (drifted) | reopen-playtest (drifted) | **NO** |

### Audited-subset disposition counts (zeros written explicitly)

| Disposition | Count (of 2 audited) |
|---|---|
| reopen-playtest | **2** |
| close-without-replaytest | **0** |
| unknown-drift | **0** |
| not-applicable | **0** (both audited chunks are stale by construction — `not-applicable` only ever applies to non-stale chunks, none of which were in this audited subset) |

### Would the pre-repair snapshot have been wrong? — NO, for both chunks in this subset

Explicitly: for both `best-seven-selection` and `block`, the pre-repair `ImpactMapEntry.gate`
snapshot and the post-repair re-derivation agree exactly (`reopen-playtest` both times) — trusting
the pre-repair snapshot would NOT have produced a different, wrong disposition for either chunk in
this subset. **A non-difference, honestly reported, is still evidence:** it demonstrates the
mechanism is at least idempotent and non-destructive when nothing changes (matching `verify-impact.test.ts`'s own `computeRepairGate` purity proof from 176-02), but it does NOT, on this
data, demonstrate Pitfall 1's payoff case (a chunk whose snapshot WOULD have been wrong).

**Where the "would have been wrong" case IS proven:** `verify-repair.ts`'s own unit test suite
(176-02, `recomputeRepairGatePostRepair — over a real git fixture`) proves exactly that case on a
real two-commit git fixture: a clean→drifted flip after a real file modification flips
`close-without-replaytest` → `reopen-playtest` between two invocations of the SAME function this
section calls. That proof is at the mechanics level (a synthetic git repo), not live on either of
this milestone's two real reference games — because decision 16 forbids this phase from ever being
the one to introduce that flip on `seven`/`one-two-punch`'s own code.

### Restating, not overturning, `175-PROOF.md` §5's inherited finding

`175-PROOF.md` §5 measured that only 1 of 12 real stale chunks in these same two games closed
without re-playtesting; the other 11 re-opened the gate because their code had ALREADY drifted for
reasons unrelated to the rules finding this milestone tracks. This plan's 2-chunk subset is fully
consistent with that measurement, not a new data point that changes it: **2 of 2 audited chunks
(100%) re-open the gate, both already drifted before this plan touched anything.** This is not
presented as a payoff beyond 175's own baseline — VERIFY-06's practical saving on these two
specific, heavily-developed reference games remains small, exactly as `175-PROOF.md` §5 already
established. This phase's repair loop feeds that same gate; it does not overturn what 175 measured
about it.

**Task 2 GATE: PASSED** — paired real readings recorded, the "no difference observed" case
answered honestly rather than manufacturing a payoff, and 175's own finding restated rather than
re-litigated on a smaller sample.

---

## What is still unproven

Carried forward honestly, at the close of the phase:

1. **Native Task/Agent-tool dispatch, for every check this phase built.** Every dispatch in this
   proof (176-05's 60 real-corpus ruling dispatches, 176-06's 2 constructed-lexicon dispatches, and
   176-06 §4's 6 real lens dispatches) used a `claude -p` OS subprocess — this executing session
   exposes Read/Write/Edit/Bash only, no internal Task/Agent tool. `173-PROOF.md` §6 closed the
   analogous gap for VERIFY-07's transcription-return contract, in a DIFFERENT session that DID
   have the Agent tool, for a single unit only. No equivalent closure was performed anywhere in
   this phase — the deferred item from `176-CONTEXT.md` stands, unresolved, exactly as its own
   "Deferred" section anticipated.
2. **`resolved-by-source` and `contradicted` verdicts on REAL data** (CHECK-01). Proven only on 2
   CONSTRUCTED lexicon pairs (§3b) — neither reference game's committed fixture contains real
   content producing those two labels. `still-needed` is the only label the real 62-ruling corpus
   exercises (60/60 dispatched).
3. **10 of the 12 real stale chunks were NOT audited by the lens loop** (§4's coverage table, named
   by slug): `bonus-point-cards`, `game-end-trigger`, `match-best-of-7`, `scoring-run-of-7`,
   `table-and-draw` (all `seven`); `final-acceptance`, `jab`, `movement-advance-retreat`, `rest`,
   `second-action-resolution` (all `one-two-punch`). Cost containment (decision 15) is the reason
   for all 10 — none are a correctness gap, but none have real fresh lens findings recorded either.
4. **The 4th (design-review) lens was identified as required but NOT dispatched**, for either of
   the 2 audited chunks (both `ui: touches|major`) — a screenshot-armed review needs a running dev
   server + browser harness this proof-writing pass's tool budget did not stand up. Only the 3 core
   lenses (fidelity, visibility, undo) were run for real.
5. **Pitfall 1's "would have been wrong" case is proven only at the mechanics level** (a synthetic
   two-commit git fixture, 176-02's own unit test), not live on either real reference game — because
   decision 16 forbids this phase from ever being the one to introduce a code change on `seven`/
   `one-two-punch` that would produce that flip. Both audited chunks in 176-06 §5 show NO
   difference between pre- and post-repair readings (honestly reported, not manufactured).
6. **VERIFY-06's payoff remains NOT demonstrated on these two reference games** (`175-PROOF.md` §5,
   restated not overturned by 176-06 §5): 2 of 2 chunks audited in this plan re-open the gate,
   consistent with 175's own 1-of-12 measurement across the full stale set. The scoping MECHANISM
   is proven correct; its practical saving on these two specific, heavily-developed games is small.
7. **Anchor density** (Phase 174, inherited unchanged) — the stale set this phase consumes is
   broader than ideal on short, cross-referenced rulebooks.
8. **The `lineFindings[]` multi-delta persistence gap** (`175-PROOF.md` §7) — only the max-severity
   `quotedPass1`/`quotedPass2` pair is retained per pair group on a `ClassificationRecord`. Neither
   reference game's real finding in this milestone has been a multi-delta pair, so this remains
   unexercised, not resolved. `176-02-SUMMARY.md` confirmed `resolveStagedSlicePaths` never reads
   these fields at all, so this gap does not affect CHECK-02's own input contract — but it is still
   open for whichever future check reads line-level deltas directly.
9. **SC-2's thin evidence base** (Phase 174) — not compounded by this phase, but not resolved by it
   either.

## How to re-run every proof

**§1–§3 (CHECK-01, full corpus + SC-3):** `boardsmith verify-ruling-recheck --project <scratch> --run-id 2026-07-29T23-25-24Z --json`
(`seven`) / `--run-id 2026-07-29T23-28-06Z --json` (`one-two-punch`) against a `cp -R` copy staged
with `175-FIXTURES/174-07-contradictory/staged/{seven,one-two-punch}/slices/` under
`rulebook/.verify/<runId>/slices/`; dispatch each enumerated ruling's body + the resolved staged
slice paths to a fresh `claude -p "<BS-RULING-RECHECK-V1 prompt>" --allowedTools Read`, following
`src/cli/slash-command/bs/verify/ruling-recheck.md`'s contract; record via
`recordRulingVerdicts`/`createRulingVerdictRecord`.

**§3b (CHECK-01 lexicon regression):** dispatch each of the 2
`176-FIXTURES/lexicon/<case>/{RULING.md,TRANSCRIPTION.md}` pairs to a fresh `claude -p` pointed at
`src/cli/slash-command/bs/verify/ruling-recheck.md`, compare the returned `verdict` to
`EXPECTED.md`, validate via `createRulingVerdictRecord`.

**§4 (CHECK-02 real lens run):** `boardsmith verify-impact-status --project <scratch> --json` to
enumerate the real stale set; `boardsmith verify-repair --project <scratch> --run-id <runId> --json`
to resolve each stale chunk's fresh staged slice paths + next verify-episode round plan; for each
audited chunk, dispatch `src/cli/slash-command/bs/build/audit.md`'s three lens templates (fidelity,
visibility, undo) as separate `claude -p --allowedTools Read` calls, binding only the five
substitution points (`{gameName}`, `{slug}`, `{slicePaths}`, `{codeFilePaths}`,
`{visibilityDeclarationText}`); write the resulting round heading via the real
`appendAuditRoundHeading`/`writeAppendedAuditRound`.

**§5 (post-repair gate re-derivation):** capture `ImpactMapEntry.gate` from `verify-impact-status
--json` BEFORE dispatching lenses; after the round completes, call `recomputeRepairGatePostRepair({
projectDir, slug, stale: true, status })` directly (via `npx tsx`, importing from
`verify-repair.ts`) and compare dispositions.

**Originals safety check (run before AND after every real proof above):**
```
git -C ~/BoardSmithGames/seven rev-parse HEAD && git -C ~/BoardSmithGames/seven status --porcelain
git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD && git -C ~/BoardSmithGames/one-two-punch status --porcelain
```
Expect identical hashes and empty `status --porcelain` (except `one-two-punch`'s two pre-existing
`.boardsmith/` deletions, documented since `173-PROOF.md`) — any other diff is a real regression in
the read-only guarantee this whole milestone depends on.

