# Phase 177: Derived-Line Re-Derivation - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning
**Requirements:** CHECK-04
**Mode:** Smart discuss (autonomous) — three grey areas presented in batch, all accepted by the user
2026-07-30 with no overrides.

<domain>
## Phase Boundary

Rule-bearing inferences get an independent second opinion, separate from the presentation notes the
Phase 170 `Derived`/`Visual` split now keeps out of the way.

In scope:
- CHECK-04 — every rule-bearing `Derived` line is re-derived independently of the original
  transcription pass, using only quote lines present in the current slice; disagreements are reported
  as findings citing both derivations; the check runs with no source rulebook present and ignores
  `Visual` lines.

Out of scope:
- **Classification, staleness, impact mapping, repair** — Phases 174–176. This check is independent of
  a verify run's staleness verdicts and does not consume them.
- **Worked-example replay** (CHECK-06) — Phase 178.
- **Source-free MODE assembly** (VERIFY-09) — Phase 179. This check is source-free BY CONSTRUCTION,
  not by a flag; Phase 179 assembles the mode from checks like this one.
- **Fixing any disagreement surfaced on the reference games** — the boundary Phases 172 and 176 held.
  This check reports; it does not repair slice content.
- **Re-transcription** — nothing here regenerates a slice.
</domain>

<decisions>
## Implementation Decisions

### The sort

| Sub-part | Sort | Owner |
|---|---|---|
| Presentation-line exclusion | **Mechanical** | CLI, reusing Phase 174's constant |
| Deciding whether a line is rule-bearing | **Judgment** | Subagent (may return `not-rule-bearing`) |
| The re-derivation itself | **Judgment** | Blind subagent, quote lines only |
| Agreement comparison | **Judgment** | Separate subagent step |
| Enumeration, recording, findings | **Mechanical** | CLI |

### Measured reality (checked directly before deciding, 2026-07-30)

- **22 `Derived` lines total** across both reference games: `seven` 10, `one-two-punch` 12.
- **Zero `Visual (p.` lines** in either game's live slices — both predate the Phase 170 split, exactly
  as Phase 174 measured. Presentation notes appear as `Derived (p.N) — diagram description:` and
  `Derived (p.N) — art:`.
- Real rule-bearing examples: *"The box contains 2 Boxer Cards, 16 Action Cards, 6 Guard Cards, and 1
  Rules Sheet."* and *"Each player has 8 Action Cards (16 total across two colors) and 3 Guard Cards."*
- Real borderline examples that are neither clearly rule-bearing nor marked presentation:
  *"Publisher logo reads 'ALRIGHT GAMES'…"* and *"This section marks no rules as variants, optional
  modules, or advanced/expert rules."*

### Area 1 — What gets re-derived (accepted 2026-07-30)

1. **Presentation exclusion REUSES Phase 174's `PRESENTATION_EXCLUSION_MARKERS` verbatim** — the
   dual-schema set covering both `Visual (p.N):` and the legacy `Derived (p.N) — diagram description:` /
   `— art:` forms. Do not define a 177-local rule: a third definition of "presentation line" in this
   codebase will drift from the other two, and 174 decision 12b already measured this set against the
   real slices.

2. **Exclusion is mechanical; RULE-BEARINGNESS is judgment.** The CLI mechanically drops lines carrying
   a presentation marker. Everything surviving goes to the subagent, which may return
   `not-rule-bearing` as a verdict. A hardcoded keyword rule deciding rule-bearingness would be the
   same defect class as an absence-phrase list (Phase 176 decision 4): it would work on the lines
   someone looked at and silently misjudge the rest. The borderline cases above are exactly why.

3. **Scope is ALL 22 lines project-wide**, not just those in stale chunks. SC-1's text is "every
   rule-bearing `Derived` line in a verified project". This check is independent of staleness.

4. **Source-free BY CONSTRUCTION, not by flag.** The check reads slices only and has no code path that
   opens the archived PDF — the same construction CHECK-03 and CHECK-05 use (172 decision, "source-free
   by construction, not by configuration"). Phase 179 assembles the source-free MODE; this phase adds
   no mode flag.

### Area 2 — The re-derivation mechanism (accepted 2026-07-30)

5. **The deriving subagent sees ONLY the slice's quote lines — never the existing `Derived` line.**
   This is the crux of the whole phase. If it sees the original, it anchors to it and the "independent
   second opinion" is worthless — it becomes an agreement-rubber-stamp that would report near-100%
   agreement regardless of whether the original derivation was sound. Independence must be
   structural: the original line is not in the dispatch payload at all.

6. **Four verdicts: `agrees` | `disagrees` | `underivable` | `not-rule-bearing`.**

   **`underivable` is first-class and load-bearing.** The original transcription had the PDF —
   including component images, tables, and card faces — while re-derivation has only the quote lines
   the slice captured. A derivation that legitimately drew on something the quote lines never recorded
   simply CANNOT be re-derived, and that is neither agreement nor disagreement. Collapsing it into
   `agrees` would report false confirmation; collapsing it into `disagrees` would manufacture false
   findings. Same first-class-blindness principle this milestone has now applied six times
   (`drift-unknown`, `unknown` provenance, `unclassified`, `unknown-drift`, `undetermined`, and here).

7. **Blind-derive FIRST, then a SEPARATE comparison step.** Deriving a value and judging your own
   agreement with the original in one pass invites post-hoc rationalization — the model reconciles
   toward whatever it just saw. Two dispatches per line (~44 total) is affordable and buys genuine
   independence.

8. **Findings quote BOTH derivations verbatim** — SC-2's text explicitly requires "citing both
   derivations". Summarizing the difference loses exactly the material a designer needs to adjudicate.

### Area 3 — Volume, expectation, and proof (accepted 2026-07-30)

9. **Full 22-line corpus, ~44 dispatches.** Unlike Phase 176's lens cost (3 lenses × 12 chunks), this
   is affordable at full coverage, so there is no reason to sample and no coverage caveat to carry.

10. **Predict the distribution and COMMIT the prediction BEFORE measuring.** The discipline that worked
    in 174-06 (SC-2's bar) and 176-05 (SC-3's verdict): git ordering proves the expectation was not
    retrofitted to the result. Predict how many of the 22 lines will be `agrees` / `disagrees` /
    `underivable` / `not-rule-bearing`, then measure.

11. **If most lines come back `underivable`, that is a REAL FINDING about the ingest contract — report
    it, do not tune.** It would mean quote lines do not carry what derivations actually used, which is
    substantive feedback about `/bs-ingest-rules`' transcription output, not a failure of this check.
    Relaxing the independence rule (decision 5) until things derive would destroy the phase's only
    real guarantee to manufacture a pleasant number.

    Note the precedent: Phase 176's full-corpus run returned a uniform 60/60 single verdict, which was
    honestly recorded as proving consistency rather than discrimination. A uniform result here — in
    either direction — deserves the same scepticism and the same honest labelling.

12. **Target is LIVE slices on `cp -R` copies.** This check is source-free and runs against a verified
    project, so live slices are the real subject — not Phase 175's staged fixtures, which exist for
    pass-1-vs-pass-2 comparison.

### Decisions added 2026-07-30 after research

13. **FIX `PRESENTATION_EXCLUSION_MARKERS`' regex gap in this phase.** Decided by the user at the
    post-research gate.

    Research measured, and I confirmed directly, that the constant is STRICTER than the rule its own
    subagent contract states. Its patterns require the colon immediately after `description`/`art`:

    ```
    ^Derived \(p\.\d+\) — diagram description:
    ```

    so any parenthetical qualifier breaks the match. Measured on real data: **4 of `one-two-punch`'s 6
    dash-qualified lines slip the filter** — `— diagram description (Plan phase):`, `(Fight phase):`,
    `(first Punch example):`, `(second Punch example):`. `seven` has zero dash-qualified lines and is
    unaffected.

    Meanwhile `classification-subagent.md` line 88 states the rule correctly, keying on the QUALIFIER's
    presence ("no ` — diagram description` or ` — art` qualifier"). So the same rule has two divergent
    expressions in the codebase, and the mechanical one is wrong. That is exactly the two-definitions
    drift decision 1 exists to prevent — except the drift is inside the pair decision 1 treats as
    canonical.

    **Phase 174's recorded results STAND and do not need re-measuring.** Its `lineFindings[]` came from
    the subagent layer, whose prose rule was already correct; the mechanical constant is a second gate,
    not the source of those findings. Document that in `174-PROOF.md` rather than re-running a closed
    phase's proof.

    Fix by widening the patterns to allow an optional parenthetical before the colon, with test cases
    drawn from the 4 real slipping lines (not invented ones). This is not a fork — it is correcting the
    single shared definition, which is what decision 1 assumed it was reusing.

14. **CHECK-04 is PROJECT-LEVEL with no run concept — no `--run-id` scope.** (Research open question 1.)
    It is source-free by construction and independent of any verify run's staleness verdicts (decisions
    3 and 4), so it has nothing to scope to a run. This matches CHECK-03/CHECK-05's shape exactly —
    `trace-check` and `drift-check` are read-only project-level sweeps with no run identity. Ledger
    records, if any, are project-scoped and reuse the single atomic write path.

15. **CHECK-04 REPORTS; it does not gate `/bs-verify-game`'s Close.** (Research open question 2.)
    Findings exit 0; non-zero is reserved for tool failure (172 decision 6 — "these are advisory sweeps
    a verify pipeline consumes, not gates", and a check that fires on correct work gets waived). It may
    be invoked from the pipeline and its `--json` formatted there, but a disagreement finding does not
    block a close. Phase 179 assembles the source-free mode from checks of exactly this shape.

### Claude's Discretion

- Module boundaries and file placement within `src/cli/commands/` and `src/cli/slash-command/bs/`.
- The finding record's exact shape, provided verdicts are a test-pinned enumerated set and it reuses
  the single atomic ledger write path.
- Human-readable report grouping.
- Dispatch batching, provided decisions 5 and 7 hold (blind derivation; separate comparison).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/verify-classify.ts` (Phase 174) — `PRESENTATION_EXCLUSION_MARKERS` (decision 1's
  constant, measured against real slices), plus the enumerate → dispatch → record split this check
  mirrors.
- `src/cli/commands/verify-ruling-recheck.ts` (Phase 176) — the closest structural analog: a
  four-verdict frozen enum, a judgment subagent, CLI enumeration and recording, and a source-free
  posture. Built two phases ago against the same conventions.
- `src/cli/commands/verify-run.ts` — the exported atomic ledger helpers. Exactly ONE atomic write path
  must remain in the repo (`173-REVIEW.md` CR-01's defect class).
- `src/cli/commands/trace-check.ts` / `drift-check.ts` (Phase 172) — the source-free-by-construction
  posture, enumerated finding kinds, and findings-exit-0 convention.
- `src/cli/slash-command/bs/verify/ruling-recheck.md` (Phase 176) — the judgment-subagent contract
  shape, including how it states the reasoning required rather than supplying a phrase list.

### Established Patterns
- Enumerated code sets: frozen array + derived type + pinning test. Never a hand-written union.
- Findings exit 0; non-zero reserved for tool failure (172 decision 6).
- CLI computes, skill formats `--json` (PROV-03's split, held since Phase 171).
- Skill text cites `state-machine.md` sections rather than restating them.
- Subagent contracts are delegated to BY REFERENCE, never restated or forked (176 decisions 6/8, and
  the drift guard in `verify.test.ts` that enforces it).

### Integration Points
- `src/cli/slash-command/bs/verify-game.md` — now a SEVEN-step router after Phase 176 (Close renumbered
  to Step 7). **Sweep it for stale cross-file claims rather than only fixing named ones** — this
  milestone has hit stale prose in five separate places across four phases, and in every case the
  survivor was a claim nobody had listed. `verify.test.ts` already carries step-contiguity and
  no-hardcoded-count guards from 176-04; keep them true.
- Phase 179 assembles the source-free MODE from this check plus CHECK-03/05 and the others. Design the
  `--json` for that consumer.

### Cross-repo proof targets
- `~/BoardSmithGames/seven` — READ-ONLY, pinned at `a03f38d4792af9dfc7c798be69686fc3230f54dd`.
  10 `Derived` lines, 0 `Visual`.
- `~/BoardSmithGames/one-two-punch` — pinned at `7e69471bd8980a854f3e351f2f486e1fb6f712b9`.
  12 `Derived` lines, 0 `Visual`, several carrying `— diagram description` / `— art` qualifiers.
</code_context>

<specifics>
## Specific Ideas

- **The anchoring risk is the phase's whole point.** A "re-derivation" that has seen the original is
  not a second opinion — it is a confirmation, and it would report high agreement whether or not the
  original derivations were sound. Decision 5 must be structural (the original absent from the payload),
  and worth proving by inspecting the real dispatch prompt, not by asserting it.
- **`underivable` is the honest-outcome valve.** Expect a meaningful share: several real `Derived` lines
  (component counts, card-face details) plausibly came from PDF images the quote lines never captured.
- **Proof bar unchanged from 171–176:** real runs against `cp -R` copies, measured counts never "ran
  clean", originals confirmed byte-identical, and a `177-PROOF.md` following the established structure.
- **Dispatch-mechanism honesty:** every "real dispatch" in Phases 173–176 used a `claude -p` OS
  subprocess rather than native Task-tool dispatch. State which is used, per `173-PROOF.md` §6.

</specifics>

<deferred>
## Deferred / Carried In

Carried in and still open:
- **F-3** (`170-PROOF-RUN-2.md`) — `boardsmith.json` stub field ownership after `init`.
- `/bs-build-chunk` Step 0's `ingest-check` call has never been exercised by a live session.
- **No native Task/Agent-tool dispatch anywhere in this milestone** — `claude -p` subprocess throughout.
- **Anchor density** (Phase 174) and **VERIFY-06's NOT-DEMONSTRATED payoff** (Phase 175, 1 of 12 chunks
  close without re-playtesting) — not this phase's concern, but still open milestone-wide.
- **Phase 176's disclosed limitations:** ruling-verdict discrimination proven only on constructed input
  (real corpus returned 60/60 `still-needed`); lens coverage 2 of 12 with the 4th design-review lens
  never dispatched.

Deferred out of this phase:
- CHECK-06 worked-example replay — Phase 178.
- VERIFY-09 source-free mode assembly — Phase 179.
- Fixing any disagreement this check surfaces on reference-game slice content.

Standing policy from 170 (recorded in STATE.md): **the ingest harness may inform, and must never again
gate whether a manual pass is run.**
</deferred>
