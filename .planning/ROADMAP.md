# Roadmap — BoardSmith

## Active Milestone

### 🚧 v4.9 BS Skills Re-Verification (In Progress)

**Milestone Goal:** Re-verify a built game against its rules — catching drift introduced by improved
models, improved rulebooks, or improved bs skills.

**Overview:** The 25 requirements derive from direct inspection of two bs-built reference games
(`~/BoardSmithGames/seven`, `~/BoardSmithGames/one-two-punch`) and fall into a natural dependency
chain: the ingest contract and provenance plumbing must exist before anything can be verified against
it; two source-free checks land immediately and de-risk the rest against real reference-game data; the
verify pipeline's skeleton (entry, re-transcription staging, resumability) comes before its
highest-risk piece — the two-dimension classifier (provenance: source-changed/unchanged; rule delta:
cosmetic/sharper/contradictory) — which gets its own dedicated phase to tune and validate against real pass-1-vs-pass-2 output; the impact map and
repair gating consume that classification; ruling re-validation and the audit lenses consume the
impact map; derived-line re-derivation depends on the ingest contract's Derived/Visual split; worked
examples become executable tests in both the build and verify pipelines; and source-free mode is the
capstone, wiring together the source-free checks with provenance's scope-recording so a project with
no archived source degrades honestly instead of failing.

**Phase Numbering:** Continues from v4.8 (ended at Phase 169) — this milestone starts at Phase 170.

## Phases

- [x] **Phase 170: Ingest Contract Upgrade** - Archived source + hash, `Visual`/`Derived` split, standardized `Open Rules Gaps` index, and the milestone's verify-first process discipline
- [x] **Phase 171: Provenance Recording** - `## Verified Against` block at close, code-conformance-only scope recording, `/bs-check-status` drift reporting (completed 2026-07-28)
- [x] **Phase 172: Source-Free Conformance Checks** - Traceability sweep + code drift, proven immediately against the two reference games with zero source dependency (completed 2026-07-28)
- [x] **Phase 173: Verify Pipeline Core** - `/bs-verify-game` skill entry, non-destructive re-transcription staging, subagent-only context economics, crash resumability (completed 2026-07-28)
- [x] **Phase 174: Verify Classifier** - Two-dimension classification (provenance + rule delta), tuned and validated against real pass-1-vs-pass-2 output (completed 2026-07-31, 8 plans. Reopened mid-phase when the goal measured NOT MET; gap-closure plan 174-08 added decision 19's per-citation attribution ladder, roughly halving both games' stale fractions on real data — `one-two-punch` 100%→54.5% (11/11→6/11), `seven` 87.5%→37.5% (14/16→6/16), untuned. **Goal MET under the ROADMAP's literal bar** ("does not flag EVERY chunk as stale"); the stricter "small, explainable subset" bar that 174-08 measured against was added mid-phase by the orchestrator, not in the original spec, and the user ruled the ROADMAP wording governs — see decision 19's RESOLVED note and `174-PROOF.md` §7/§8. Residual stale chunks genuinely cite the changed rule. Carried to 175/176: anchor density in short, heavily cross-referenced rulebooks keeps the staleness set broader than ideal.)
- [x] **Phase 175: Impact Map & Repair Gating** - Contradictory human gate, cross-file staleness flip, scoped re-playtest (code-changed chunks only) (completed 2026-07-30, 8 plans, all 3 requirements CLOSED. VERIFY-04/05 proven live on real reference-game data; VERIFY-06's mechanism is correct but its real-data payoff is honestly NOT demonstrated — 1 of 12 real rules-stale chunks across both games closes without re-playtesting, not because drift-check returned `unknown` as anticipated, but because most stale chunks' code genuinely drifted for reasons unrelated to the rules finding. See `175-PROOF.md` §§4-9.)
- [ ] **Phase 176: Stale-Chunk Repair** - Ruling re-validation against fresh transcription + the three audit lenses re-run per stale chunk
- [ ] **Phase 177: Derived-Line Re-Derivation** - Independent re-derivation of rule-bearing `Derived` lines, disagreements reported
- [ ] **Phase 178: Worked-Example Tests** - Worked examples as executable tests in both `build/test.md` and verify replay
- [ ] **Phase 179: Source-Free Verification Mode** - `/bs-verify-game` degrades honestly when source is unavailable, naming which defect classes went unchecked

## Phase Details

### Phase 170: Ingest Contract Upgrade
**Goal**: Ingest produces the provenance foundation every later phase depends on — an archived, hashed source rulebook, transcription that separates rule-bearing inference from presentation notes, and a standardized gap-tracking section — with the milestone's own verify-first discipline established from the first phase onward.
**Depends on**: Nothing (first phase)
**Requirements**: PROC-01, PROC-02, INGEST-01, INGEST-02, INGEST-03, INGEST-04
**Success Criteria** (what must be TRUE):
  1. A fresh `/bs-ingest-rules` run archives the source rulebook file into the project at a standard path and records its hash.
  2. Transcription output distinguishes `Visual (p.N):` diagram/art/layout lines from `Derived (p.N):` rule-inference lines in the generated slices.
  3. `rulebook/INDEX.md` for a freshly-ingested game carries a standardized `## Open Rules Gaps` section plus edition/source-file/transcription-date header lines a designer can read without opening any slice.
  4. Every skill-text change landed in this phase is demonstrated against a real ingest run (not skill-text review alone) and locked by a regression test — the pattern every subsequent phase follows.
**Plans**: 10 plans (01-02 shipped, 03 ran and FAILED, 04 superseded, 05-10 are the gap-closure replan)

Plans:
- [x] 170-01-PLAN.md — transcription.md: Derived/Visual decision test + `openGaps[]` return field (INGEST-02, INGEST-03)
- [x] 170-02-PLAN.md — ingest-rules.md Step 3: source archive + SHA-256, INDEX header block, always-emitted `## Open Rules Gaps` (INGEST-01, INGEST-03, INGEST-04)
- [x] 170-03-PLAN.md — PROC-01 manual proof run: **FAILED 7 of 9 checks**; root cause recorded in `170-PROOF-RUN.md` — the orchestrator does not execute prose skill text literally (PROC-01)
- [~] 170-04-PLAN.md — SUPERSEDED. Its golden-fixture premise is invalid (the proof run's output is non-conforming). Tasks 1-2 replaced by `templates/INDEX.template.md` + the harness checker fixtures; Task 3 salvaged as 170-09.
- [x] 170-05-PLAN.md — ingest harness: deterministic produced-artifact checker + fixtures from the real failed run (PROC-01, PROC-02)
- [x] 170-06-PLAN.md — ingest harness driver: live headless agent run, operator-invoked, never in CI; failing baseline recorded (PROC-01)
- [x] 170-07-PLAN.md — `templates/INDEX.template.md` + Step 2.5 archive/hash; INDEX produced by template fill (INGEST-01, INGEST-03, INGEST-04, PROC-02)
- [ ] 170-08-PLAN.md — dispatch prompt as template + per-slice line-kind receipt; INGEST-02 on live output (INGEST-02, PROC-02)
- [ ] 170-09-PLAN.md — capture passing-run evidence + PROC-02 adversarial closure across all six requirements (INGEST-01..04, PROC-02)
- [ ] 170-10-PLAN.md — PROC-01 human gate re-run, gated on the harness passing first (PROC-01)

### Phase 171: Provenance Recording
**Goal**: The build pipeline and status reporting both know, honestly, what was verified against what.
**Depends on**: Phase 170
**Requirements**: PROV-01, PROV-02, PROV-03
**Success Criteria** (what must be TRUE):
  1. Closing a chunk writes a `## Verified Against` block to CHUNK.md — slice paths and hashes, rulebook edition, BoardSmith version, skills version, and verification scope.
  2. A verification that could not re-read source records its scope as code-conformance-only with an explicit reason, visibly distinct from a full verification — never silently reading as a full one.
  3. `/bs-check-status` reports, per chunk, which rulebook edition and skills version it was last verified against, and separately flags which chunks are code-conformance-only.
**Plans**: 7 plans

Plans:
- [x] 171-01-PLAN.md — F-1: normalise recognisably-empty `--edition` free text to the `EDITION_UNKNOWN` sentinel, preserving the designer's wording on an unparsed note line (PROV-01)
- [x] 171-02-PLAN.md — the two non-citation provenance inputs: a real `boardsmith --version` and a content hash of the installed bs- skills tree (PROV-01)
- [x] 171-03-PLAN.md — `computeVerificationScope` (five enumerated reason codes, computed never declared) + `resolveCitedSlices` from existing chunk prose (PROV-02, PROV-01)
- [x] 171-04-PLAN.md — `boardsmith chunk-check <slug>`: the fenced machine-owned `## Verified Against` block, repair-then-exit-non-zero (PROV-01, PROV-02)
- [x] 171-05-PLAN.md — `boardsmith chunk-provenance-status --json`: three states incl. `unknown`, drift grouping, and the verified-without-provenance flag (PROV-03, PROV-02)
- [x] 171-06-PLAN.md — wire both close paths + the CHUNK.md scaffold + `/bs-check-status` item 8 to the two commands (PROV-01, PROV-03)
- [x] 171-07-PLAN.md — PROC-01 proof against copies of both reference games; `~/BoardSmithGames/seven` asserted clean before and after (PROV-01, PROV-02, PROV-03)

### Phase 172: Source-Free Conformance Checks
**Goal**: The two checks that need neither the ingest changes nor re-transcription exist and are proven immediately against real games, de-risking everything downstream.
**Depends on**: Nothing new (independent of Phases 170-171)
**Requirements**: CHECK-03, CHECK-05
**Success Criteria** (what must be TRUE):
  1. Running the traceability sweep against seven or one-two-punch reports every Interpretation claim's test coverage, every test's claim linkage, and every ruling's test coverage, with zero rulebook/source access.
  2. Running the code-drift check against a reference game reports every chunk whose Build Manifest files changed since its recorded verified commit hash.
  3. Both checks are demonstrated end-to-end against at least one reference game, surfacing real findings (not a dry no-op run).
**Plans**: 5 plans (4 waves)
Plans:
- [x] 172-01-PLAN.md — Shared CHUNK.md/Build-Manifest parser module + f73153a3 recurrence fix (wave 1)
- [x] 172-02-PLAN.md — CHECK-03 `trace-check`: citation scanner, three-rung resolution ladder, findings, report (wave 2)
- [x] 172-03-PLAN.md — CHECK-05 `drift-check`: commit-hash extraction, git diff plumbing, three drift states (wave 2)
- [x] 172-04-PLAN.md — CLI registration + exit-code contract through the real entry point (wave 3)
- [x] 172-05-PLAN.md — Real-data proof against copies of both reference games, `172-PROOF.md` (wave 4)

### Phase 173: Verify Pipeline Core
**Goal**: A designer can invoke `/bs-verify-game` against an existing bs-built project and get a safely-staged, resumable re-transcription without disturbing the live project.
**Depends on**: Phase 171 (provenance fields the pipeline reads and writes), Phase 172 (the checks the pipeline will eventually route findings through)
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-07, VERIFY-08
**Success Criteria** (what must be TRUE):
  1. `/bs-verify-game` installs as a new skill (installer updated; `bs-verify-game/` present under the installed skills tree) and runs against an existing bs-built project without rebuilding it.
  2. A verify pass re-transcribes the full archived rulebook into a non-destructive staging tree — the project's existing slices are never overwritten before the pass closes.
  3. The orchestrator never reads a full slice directly — re-transcription and classification are both dispatched to subagents, matching the context-economics rule the other `bs-` skills already follow.
  4. Killing a verify pass mid-run and re-invoking it resumes at the first unrecorded step rather than re-running re-transcription from scratch.
**Plans**: 7 plans in 6 waves

Plans:
- [x] 173-01-PLAN.md — Repair `ingest-archive`'s existing-INDEX branch + real-data gate proof on both reference games (**wave 1, hard gate**)
- [x] 173-02-PLAN.md — `verify-run` CLI: staging-tree allocation and the append-only RUN.md resume ledger
- [x] 173-03-PLAN.md — Generalize `transcription-subagent.md`'s output directory (reuse, no fork)
- [x] 173-04-PLAN.md — `/bs-verify-game` entry point + `bs/verify/` sub-steps + skill-text contract pins
- [x] 173-05-PLAN.md — Installer registration for `bs-verify-game` + all five `SKILL_NAMES` sites + anti-drift meta-test
- [x] 173-06-PLAN.md — Live proofs: SC-1 install, SC-2 non-destructive staging, SC-3 transcript absence
- [x] 173-07-PLAN.md — Live proof: SC-4 real kill-and-resume + phase evidence closeout

**Result:** All four success criteria proven live (`173-PROOF.md`, sections 1-4). VERIFY-02 and
VERIFY-08 closed in `REQUIREMENTS.md`; VERIFY-01 and VERIFY-07 deliberately left open pending Phase
174's classifier (the "per-chunk verdict"/"classification in subagents" halves of those two
requirements do not exist until then). Two real findings recorded, not fixed in this phase: range-
level resume re-dispatch is not idempotent (re-covers an already-partially-recorded page range in
full rather than sub-dividing it), and a torn ledger line that also destroys the trailing fence
throws a hard error rather than gracefully demoting the affected unit (the narrower torn-line-only
case behaves exactly as documented).

### Phase 174: Verify Classifier
**Goal**: The highest-risk single item in the milestone — a classifier that distinguishes real drift from independent re-wording — works well enough that a second run of the skill does not flag every chunk as stale.
**Depends on**: Phase 173
**Requirements**: VERIFY-03
**Success Criteria** (what must be TRUE):
  1. Every slice pair is classified on BOTH dimensions independently: provenance (`source-changed` / `source-unchanged`, from the archived source hash) and rule delta (`cosmetic` / `sharper` / `contradictory`, from semantic comparison).
  2. Two independent good-faith transcriptions of the same reference-game page classify overwhelmingly as `cosmetic`, not `sharper`/`contradictory` — the classifier does not over-flag wording drift.
  3. A genuine rules change introduced between pass 1 and pass 2 is correctly classified `sharper` or `contradictory`.
  4. Staleness keys off the rule delta ALONE — `sharper` and `contradictory` mark chunks stale whether or not the source bytes moved, and `cosmetic` never does even when the source changed. `source-changed` is reported to the human as provenance but is never itself a staleness verdict.
  5. The classifier is validated against real pass-1-vs-pass-2 output from at least one reference game, not synthetic examples alone.
**Plans**: 8 plans in 7 waves (08 is the gap-closure plan for the phase GOAL)

Plans:
- [x] 174-01-PLAN.md — produce the real pass-1-vs-pass-2 material (adopt + re-transcribe `cp -R` copies of both reference games), archive it as in-repo fixtures, measure the presentation-marker inventory (wave 1)
- [x] 174-02-PLAN.md — export `verify-run.ts`'s seven ledger helpers + teach its record union the `classification` kind (wave 1)
- [x] 174-03-PLAN.md — mechanical core: enumerated codes, dual-schema presentation filter, m:n page-overlap pairing, staleness map, three-state provenance (wave 2)
- [x] 174-04-PLAN.md — `verify-classify-pairs` / `-record` / `-status` + CLI registration + per-chunk verdict roll-up (wave 3)
- [x] 174-05-PLAN.md — classification subagent contract + `classification-dispatch.md` + `verify-game.md` Step 4 in-place rewrite + rewritten drift pins (wave 4)
- [x] 174-06-PLAN.md — live proof: SC-1/SC-2 with the bar declared before measuring, VERIFY-07 transcript grep, determinism + lexicon regression (wave 5)
- [x] 174-07-PLAN.md — live proof: SC-3 real source mutation through the real pipeline, VERIFY-01 per-chunk verdict, phase closeout (wave 6)
- [x] 174-08-PLAN.md — GAP CLOSURE: decision 19 per-citation attribution (claim-level anchor ladder), both 174-04 guardrails pinned, citation-resolution rate measured on real chunks, phase-goal re-measured on both real games with an explicit MET/NOT-MET verdict (wave 7)

**Result:** All five success criteria proven live on real data (`174-PROOF.md`). SC-1/SC-2:
provenance and rule-delta are independently derived on real pairs; SC-2's pre-declared bar (≥90%
cosmetic, zero contradictory, evaluated per decision 14b over pooled rule-bearing LINE-LEVEL
comparisons) measured **90.9%** (10/11), **PASS**. SC-3: a real archived-source mutation (a genuine
Fight-phase precedence reversal, "lower"→"higher" timing resolves first, edited into
`one-two-punch`'s image/vector rulebook PDF via rasterize+Ghostscript-font-composite, no package
installs) run through the REAL pipeline — real re-transcription dispatch, real classification
dispatch — classified **`contradictory`**, `stale:true`, `provenance:source-changed`, **PASS**. SC-4:
provenance never feeds the staleness map, corroborated on real data by two different runs of the
same pair landing different provenance values with different staleness outcomes purely as a
function of rule delta (no naturally-occurring `source-changed`+`cosmetic` real pair existed in this
run — a genuine data-availability gap stated honestly, backstopped by `deriveStale`'s one-argument
arity). SC-5: validated against BOTH real reference games, not synthetic examples alone. Determinism
(decision 16): identical `(pairId, ruleDelta, stale)` triples across independent dispatches, both
games. VERIFY-01, VERIFY-03, and VERIFY-07 all CLOSED in `REQUIREMENTS.md` with section-and-number
citations.

**Gap-closure plan 174-08 (2026-07-31): decision 19 per-citation attribution implemented and
re-measured — the phase GOAL is STILL NOT MET, reported plainly, not smoothed over.** Plan 174-08
implemented 174-CONTEXT.md decision 19 (a deterministic 3-rung citation-level ladder —
`quoted-fragment` > `cited-page` > `slice-fallback`, modelled on 172 decision 3), with both 174-04
guardrails (no false-clean, blindness-before-ladder ordering) pinned by dedicated tests
(`decision-19-guard-1`/`-2`). The citation-resolution rate was measured on real chunks BEFORE the
narrowing was trusted (`174-PROOF.md` §7): `quoted-fragment` is the dominant real rung on both
games, with a real, disclosed `slice-fallback` share (21.4% seven, 9.1% one-two-punch evaluations).
Re-measuring the phase goal by replaying the exact real dispatch returns through the new code
(`174-PROOF.md` §8): `seven` dropped from 87.5% to **37.5%** (14/16 → 6/16) citing chunks stale;
`one-two-punch` dropped from 100% to **54.5%** (11/11 → 6/11). Both are real, non-tuned, roughly-
halved improvements, and every clean chunk's cleanliness is nameable from real `attributions[]`
output (e.g. `discard`/`scoring-declaration`/etc. on `seven` — "cites N quoted fragment(s) found in
this live slice, but none overlaps the changed line"). **The phase goal's own bar is still NOT MET
on either game** — neither 37.5% nor 54.5% is a small, explainable subset. Diagnosed (not tuned) as
an anchor-density property of these two short, tightly cross-referenced reference rulebooks: several
chunks independently quote the exact same central, changed rule because it is genuinely foundational
to what they build. This is left as an explicit, still-open risk for Phase 175/176 to weigh — full
diagnosis, the stale/total tables, every clean chunk's reason, and every stale chunk's attributing
rung are in `174-PROOF.md` §8.

### Phase 175: Impact Map & Repair Gating
**Goal**: A classified slice pair produces the right downstream consequence — human adjudication for genuine contradictions, visible staleness for affected chunks, and repair effort scoped to what actually changed.
**Depends on**: Phase 174
**Requirements**: VERIFY-04, VERIFY-05, VERIFY-06
**Success Criteria** (what must be TRUE):
  1. A `contradictory` classification always stops the pass and presents both readings side by side to the human; the resolution is recorded in `RULINGS.md`.
  2. Chunks affected by a changed slice flip to a visible rules-staleness marker in both CHUNK.md and SKETCH.md, following the existing write-order and authority rules from `state-machine.md`.
  3. Only chunks whose code actually changed during repair re-open the human playtest gate; chunks that pass the audit lenses unchanged close without re-playtesting.
**Plans**: 8 plans in 6 waves

**Result: all three requirements CLOSED (`REQUIREMENTS.md`), with one honest NOT-DEMONSTRATED
verdict inside a closed requirement, not smoothed into a pass.** VERIFY-04's gate blocks a real
`verify-impact-apply` pass on the real archived `contradictory` verdict (0 files written while
pending, measured by whole-copy sha256 diff) and a genuine human confirmed the gate's
adjudicability at a real checkpoint (`175-PROOF.md` §3d). VERIFY-05's cross-file write landed on
BOTH real reference games, marking exactly the stale sets `174-PROOF.md` §8 predicted (`seven`
6/16, `one-two-punch` 6/11, zero symmetric difference) — and a real live bug (a SKETCH.md
pointer-line fusion when no blank line separated it from the next bullet) was found and fixed under
deviation Rule 1 producing this section's own first real write (`175-PROOF.md` §4). VERIFY-06's
mechanism is proven correct per-chunk, but its measured real-data payoff is **NOT demonstrated**:
across both games' 12 real rules-stale chunks, only 1 (8.3%) closes without re-playtesting — 11 of
12 re-open the gate because their code genuinely drifted for reasons unrelated to the rules finding,
not because `drift-check` returned `unknown` (the anticipated failure mode never materialized;
`unknown-drift` is 0 in both games' dispositions). Decision 13's `verified (user-waived)` +
stale + code-changed path is proven **LIVE** on 8 real chunks (not constructed). Both
`~/BoardSmithGames` originals confirmed byte-identical throughout (`175-PROOF.md` §9). Carried
forward, honestly, not resolved: the `lineFindings[]` multi-delta persistence gap (to Phase 176),
the standing no-native-Task-dispatch caveat, and whether a shorter-lived, less-drifted real game
would show VERIFY-06's payoff more favourably (neither reference game can settle that — see
`175-PROOF.md` §7).

Plans:
- [x] 175-01-PLAN.md — the rules-staleness marker: constants, renderer, strict parser, CHUNK-then-SKETCH writer + its registration in state-machine.md/both templates/pins, incl. the Status-enum orthogonality negative (VERIFY-05, wave 1)
- [x] 175-02-PLAN.md — host-module extensions: `impact`/`adjudication` ledger kinds in the one atomic write path + `Re-verified (no code change):` in `VERIFIED_AGAINST_LABELS` (VERIFY-05, VERIFY-06, wave 1)
- [x] 175-03-PLAN.md — VERIFY-04 core: contradiction collection (one per FINDING), both-readings formatting, `RULINGS.md` `### Ruling N` append reusing `parseRulings`, `UNADJUDICATED` (VERIFY-04, wave 2)
- [x] 175-04-PLAN.md — VERIFY-06 core: `computeRepairGate` (drift-check as sole authority, `unknown` never collapsed, waiver never renewed), impact-map `--json` for Phase 176, the gate-guarded `verify-impact-apply`, CLI registration (VERIFY-05, VERIFY-06, wave 3)
- [x] 175-05-PLAN.md — skill text: `verify/adjudication-gate.md` + `verify-game.md`'s Step 3 boundary statement deleted IN PLACE, new Step 4, Close→Step 5, rewritten drift pins (VERIFY-04, VERIFY-05, VERIFY-06, wave 4)
- [x] 175-06-PLAN.md — `/bs-check-status` item 9: uncapped rules-stale fraction + repair-gate dispositions, closing 174's deferred item (VERIFY-05, VERIFY-06, wave 4)
- [x] 175-07-PLAN.md — live proof: VERIFY-04's gate against the REAL archived `contradictory` verdict, both terminal answers on real files, human adjudicability checkpoint (VERIFY-04, wave 5)
- [x] 175-08-PLAN.md — live proof: VERIFY-05's cross-file write on both games + the VERIFY-06 payoff MEASURED on the real 6/16 and 6/11 stale sets, decision 13's path, closeout (VERIFY-05, VERIFY-06, wave 6)

### Phase 176: Stale-Chunk Repair
**Goal**: Every stale chunk gets re-checked against the composite source of truth (fresh transcription + RULINGS.md) through the same audit lenses the build pipeline already trusts.
**Depends on**: Phase 175
**Requirements**: CHECK-01, CHECK-02
**Success Criteria** (what must be TRUE):
  1. Every `RULINGS.md` entry is re-checked against the fresh transcription and reported as still-needed, resolved-by-source, or contradicted, respecting supersession chains.
  2. The three audit lenses (fidelity, visibility, undo) run against raw slices plus `RULINGS.md` for every stale chunk, feeding the existing bounded repair loop.
  3. Run against seven's Ruling 1 — the designer-statement scoring table with no source card — this produces a defensible still-needed/resolved/contradicted verdict, proving the highest-consequence ruling re-validation target in either reference game.
**Plans**: 6 plans

Plans:
- [ ] 176-01-PLAN.md — CHECK-01 mechanics: `parseRulings` body-text extension, `RULING_VERDICTS` enum, supersession skip/report, scope-limited, atomic verdict recording (CHECK-01, wave 1)
- [ ] 176-02-PLAN.md — CHECK-02 mechanics: stale-chunk → fresh staged slice resolution, verify-episode round bookkeeping (decision 17), POST-repair `computeRepairGate` re-derivation (CHECK-02, wave 1)
- [ ] 176-03-PLAN.md — skill text: `verify/ruling-recheck.md` judgment contract + `verify/repair-dispatch.md` delegating to `build/audit.md`/`build/repair.md` by reference, CLI registration, installer probes (CHECK-01, CHECK-02, wave 2)
- [ ] 176-04-PLAN.md — `verify-game.md` full stale-claim sweep + repair routing, and the no-fork drift guards proven to fail when violated (CHECK-01, CHECK-02, wave 3)
- [ ] 176-05-PLAN.md — live proof: all ~62 rulings re-validated with measured per-verdict counts, SC-3's Ruling 1 verdict AND reasoning (CHECK-01, wave 4)
- [ ] 176-06-PLAN.md — live proof: real lens run on a STATED subset of the 12 stale chunks, paired pre/post-repair gate readings, phase closeout (CHECK-02, wave 5)

### Phase 177: Derived-Line Re-Derivation
**Goal**: Rule-bearing inferences get an independent second opinion, separate from the presentation notes the Phase 170 split now keeps out of the way.
**Depends on**: Phase 170 (`Derived`/`Visual` split), Phase 173 (pipeline to run the check inside)
**Requirements**: CHECK-04
**Success Criteria** (what must be TRUE):
  1. Every rule-bearing `Derived` line in a verified project is re-derived independently of the original transcription pass, using only quote lines present in the current slice.
  2. A disagreement between the original and re-derived value is reported as a finding, citing both derivations.
  3. The check runs with no source rulebook present and correctly ignores `Visual` lines as out of scope.
**Plans**: TBD

### Phase 178: Worked-Example Tests
**Goal**: Worked examples in the rulebook stop being a one-time seed for hand-written tests and become an accumulating, automatically-derived executable test suite in both build and verify.
**Depends on**: Phase 170 (the split determines which lines are examples vs. presentation)
**Requirements**: CHECK-06, TEST-01
**Success Criteria** (what must be TRUE):
  1. `build/test.md` generates an executable test for every worked example in a newly-built chunk's cited slices.
  2. Running worked-example replay against a reference game's cited slices executes each example against the real engine and reports any mismatch as a finding.
  3. Both mechanisms share the same example-to-test derivation logic rather than duplicating it.
**Plans**: TBD

### Phase 179: Source-Free Verification Mode
**Goal**: A project whose source rulebook is unavailable still gets a verification pass — an honest, reduced one, never a failure and never a silent full-scope claim.
**Depends on**: Phase 172 (source-free checks), Phase 177 (the other source-free check), Phase 171 (PROV-02 scope recording)
**Requirements**: VERIFY-09
**Success Criteria** (what must be TRUE):
  1. `/bs-verify-game` run against a project whose source rulebook is unavailable completes in source-free mode instead of failing.
  2. The source-free report names exactly which defect classes went unchecked (e.g. no fidelity re-transcription, no worked-example replay against fresh source).
  3. The verification's recorded scope reads code-conformance-only with the unavailable-source reason, per PROV-02.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 170 → 171 → 172 → 173 → 174 → 175 → 176 → 177 → 178 → 179

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 170. Ingest Contract Upgrade | 5/10 | In Progress|  |
| 171. Provenance Recording | 7/7 | Complete   | 2026-07-28 |
| 172. Source-Free Conformance Checks | 5/5 | Complete   | 2026-07-28 |
| 173. Verify Pipeline Core | 8/8 | Complete   | 2026-07-29 |
| 174. Verify Classifier | 8/8 | Reopened — goal NOT MET (decision 19 applied, §8) | - |
| 175. Impact Map & Repair Gating | 8/8 | Complete   | 2026-07-30 |
| 176. Stale-Chunk Repair | 0/TBD | Not started | - |
| 177. Derived-Line Re-Derivation | 0/TBD | Not started | - |
| 178. Worked-Example Tests | 0/TBD | Not started | - |
| 179. Source-Free Verification Mode | 0/TBD | Not started | - |

## Shipped Milestones

- ✅ **v4.8 Battery Post-Mortem Fixes** — Phases 155–169 (shipped 2026-07-22) — 14/15 phases shipped; Phase 165 (D32 platform `[DRAWDROP]` logging) deferred-to-platform (proven absent from the library + all 5 game repos). Closed the 5-game build-battery post-mortem: D1–D31 library/dev-host/tooling/engine fixes, the two `bs-skills` defect fixes + the full autonomy rewrite (milestone playtest gates, batched questions, run-while-away, ≥50% context floor + sub-agent offload, loud completion, B.9 ledger reconciliation), the seed-to-state feasibility spike (+ thin `--seed` PoC), and the cross-repo de-workaround sweep across all 5 game repos (BSR-12 AI closed, BS-10 reclassified). Post-audit tech-debt pass also resolved the hidden-zone D24 game migration, v4.8-WR01 + v4.8-MCTS-UNDO. Library 3141 tests green; all 5 game repos green. Full detail: [`milestones/v4.8-ROADMAP.md`](milestones/v4.8-ROADMAP.md) · [requirements](milestones/v4.8-REQUIREMENTS.md) · [audit](milestones/v4.8-MILESTONE-AUDIT.md)
- ✅ **v4.7 Playtest Follow-Up Fixes** — Phases 152–154 (shipped 2026-07-06) — 5/5 requirements; closed DEF-A (asset completeness), DEF-C (dev-host reconnect turn-desync), and propagated DEF-B to MERC (738/7 green). Full detail: [`milestones/v4.7-ROADMAP.md`](milestones/v4.7-ROADMAP.md) · [requirements](milestones/v4.7-REQUIREMENTS.md) · [audit](milestones/v4.7-MILESTONE-AUDIT.md)
- ✅ **v4.6 BS Skills (Rulebook-Driven Game Building)** — Phases 140–151 (shipped 2026-07-05; reopened + re-closed same day for the human-playtest follow-up, Phases 150–151) — 36/36 requirements, human gate CLOSED, `v4.6.1` — full detail: [`milestones/v4.6-ROADMAP.md`](milestones/v4.6-ROADMAP.md) · [requirements](milestones/v4.6-REQUIREMENTS.md) · [audit](v4.6-MILESTONE-AUDIT.md)

_Prior milestones (v0.1–v4.5) archived under `.planning/milestones/`._
</content>
