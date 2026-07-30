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

**This declaration is committed as a separate commit BEFORE the dispatch below is run.** See the
commit hash cited at the end of this section (recorded after the fact, since a commit cannot cite
its own hash from within itself) — the file history shows this section existed, staged and
committed, prior to the "Dispatch and result" subsection being appended.

