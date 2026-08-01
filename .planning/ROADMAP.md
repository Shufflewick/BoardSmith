# Roadmap — BoardSmith

## Active Milestone

### 🚧 v4.9 BS Skills Re-Verification (All phases complete — audited, pending archive)

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
- [x] **Phase 176: Stale-Chunk Repair** - Ruling re-validation against fresh transcription + the three audit lenses re-run per stale chunk (completed 2026-07-30)
- [x] **Phase 177: Derived-Line Re-Derivation** - Rule-bearing `Derived` lines get an independent second opinion via dual enumeration + reconciliation; CHECK-04 CLOSED 2026-07-31 after the miscalibrated determinism gate was retired (see Result below)
- [x] **Phase 177.1: Wire CHECK-04's Closed Design Into The Pipeline** - `/bs-verify-game` Step 7 now dispatches the dual-enumeration design CHECK-04 was actually closed on; proven against recorded input AND a real live dispatch (completed 2026-07-31, 8 plans, all 5 success criteria MET, verification 5/5 PASSED — see Result below). **Post-verification code review found 4 CRITICALS that a green suite and a passing goal-backward verification both missed** — one `--slice-path` path traversal, and three ways a wrong arithmetic `claimedResult` could validate against a substituted operand (all three rooted in keying lookups by model-supplied free text rather than stable identity). Fixed as one structural fail-closed change (`d6e14de8`, `22cd9492`, `8d187132`); suite 4125/4125 green. The first CR-03 attempt failed the pinned `analysis-run1.json` reference test and was replaced — that pin exists to stop a fix silently altering CHECK-04's closure evidence, and it worked.
- [x] **Phase 178: Worked-Example Tests** - Worked examples as executable tests in both `build/test.md` and verify replay (completed 2026-08-01, 11 plans, CHECK-06/TEST-01 CLOSED on 178-11's live cross-game proof — see `178-PROOF.md`)
- [x] **Phase 179: Source-Free Verification Mode** - `/bs-verify-game` degrades honestly when source is unavailable, naming which defect classes went unchecked (completed 2026-08-01, 6 plans, VERIFY-09 CLOSED on 179-06's live proof — see `179-PROOF.md`)

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
- [x] 170-08-PLAN.md — dispatch prompt as template + per-slice line-kind receipt; INGEST-02 on live output. **EXECUTED; its mechanism was then REFUTED** — see `170-MECHANISMS.md` (INGEST-02, PROC-02)
- [~] 170-09-PLAN.md — ABSORBED INTO 170-10; its passing-run evidence + PROC-02 adversarial closure were delivered there, not separately (INGEST-01..04, PROC-02)
- [x] 170-10-PLAN.md — PROC-01 human gate re-run + 170-09's absorbed scope. **Real two-run adversarial gate: Run 1 FAILED 3/9 items with a root-caused fix, Run 2 passed 9/9** — see `170-10-SUMMARY.md` (PROC-01, PROC-02)

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

**Result:** CHECK-01 and CHECK-02 both closed live. Ruling re-validation: 62 rulings across both
reference games (`seven` 36, `one-two-punch` 26), 60 dispatched + 2 correctly skipped as
superseded (both directions proven), verdictCounts `{still-needed: 60, resolved-by-source: 0,
contradicted: 0, undetermined: 0}` on real data plus 2/2 constructed lexicon cases exercising the
other two labels (176-05, 176-06 §3b). SC-3 (`seven` Ruling 1) verdict `still-needed` MET with its
bar committed before dispatch. Audit-lens coverage: 2 of 12 real stale chunks audited (~17%,
decision 15's stated-subset allowance), 15 real findings recorded across 6 fresh-context lens
dispatches (0 fixed, per decision 16), decision 17's fresh-episode-budget rule demonstrated in
BOTH reference games on chunks already at 3 build-era rounds (absolute round 4 on first verify
dispatch, never routed to triage). Paired pre/post-repair gate readings: 2 of 2 audited chunks show
NO disposition change (both `reopen-playtest`, pre-existing drift unrelated to this pass),
consistent with `175-PROOF.md` §5's own 1-of-12 baseline — restated, not overturned. Two live bugs
found and fixed while producing this proof: `ImpactMapEntry` dropped its `pairIds` field (made
`verify-repair` throw on every real stale chunk) and `appendAuditRoundHeading` landed a new round
heading after the wrong CHUNK.md section (never caught by synthetic-only test fixtures). `npm
test`: 3893/3893 green throughout this phase's final plan, zero regressions.

Plans:
- [x] 176-01-PLAN.md — CHECK-01 mechanics: `parseRulings` body-text extension, `RULING_VERDICTS` enum, supersession skip/report, scope-limited, atomic verdict recording (CHECK-01, wave 1)
- [x] 176-02-PLAN.md — CHECK-02 mechanics: stale-chunk → fresh staged slice resolution, verify-episode round bookkeeping (decision 17), POST-repair `computeRepairGate` re-derivation (CHECK-02, wave 1)
- [x] 176-03-PLAN.md — skill text: `verify/ruling-recheck.md` judgment contract + `verify/repair-dispatch.md` delegating to `build/audit.md`/`build/repair.md` by reference, CLI registration, installer probes (CHECK-01, CHECK-02, wave 2)
- [x] 176-04-PLAN.md — `verify-game.md` full stale-claim sweep + repair routing, and the no-fork drift guards proven to fail when violated (CHECK-01, CHECK-02, wave 3)
- [x] 176-05-PLAN.md — live proof: all ~62 rulings re-validated with measured per-verdict counts, SC-3's Ruling 1 verdict AND reasoning (CHECK-01, wave 4)
- [x] 176-06-PLAN.md — live proof: real lens run on a STATED subset of the 12 stale chunks, paired pre/post-repair gate readings, phase closeout (CHECK-02, wave 5)

### Phase 177: Derived-Line Re-Derivation
**Goal**: Rule-bearing inferences get an independent second opinion, separate from the presentation notes the Phase 170 split now keeps out of the way.
**Depends on**: Phase 170 (`Derived`/`Visual` split), Phase 173 (pipeline to run the check inside)
**Requirements**: CHECK-04
**Success Criteria** (what must be TRUE):
  1. Every rule-bearing `Derived` line in a verified project is re-derived independently of the original transcription pass, using only quote lines present in the current slice.
  2. A disagreement between the original and re-derived value is reported as a finding, citing both derivations.
  3. The check runs with no source rulebook present and correctly ignores `Visual` lines as out of scope.
**Plans**: 13 planned + 9 follow-on measurement/remediation rounds (177-14..22) — ALL EXECUTED

**Result (FINAL): GOAL MET — CHECK-04 CLOSED 2026-07-31, on a re-scoped design.**
The phase's original per-line blind re-derivation design was **retired**, not tuned: two post-hoc
experiments established that asking a subagent to re-derive *a specific* fact without naming the
fact is structurally unanswerable, and that the 6/16 (37.5%) figure the first 13 plans were tuning
against was never a fixed quantity. It was replaced by **dual enumeration with reconciliation** —
two independent enumerators list every fact a passage supports, a third reconciles them into
found-by-both / found-by-one, and existing `Derived` lines are cross-referenced as corroborated /
uncorroborated / contradicted. No targeting is required, so the failure mode that blocked the
original design cannot arise.
Closed on four definitive measurement runs (`177-15`, `177-20`, `177-21`, `177-22`) across
**THREE reference games** (`seven`, `one-two-punch`, `doom-machine` — the third larger, uncleaned,
and independently classified), **~250 line-classifications**, hundreds of real `claude -p`
dispatches, each run pre-registered before any dispatch:
**zero wrongly-`contradicted` lines** in any run — no confident false accusation, the exact failure
that made the retired design worse than useless; **zero fabrications passed grounding** — every
reconciler claim mechanically traced to text present in BOTH enumerator lists; **zero annotation
leaks** into any dispatched payload, confirmed by grep of every saved prompt, not by code
inspection; **every non-corroborated line attributable to a named category.**
The fifth criterion — byte-identical classifications across two runs — was **RETIRED as
miscalibrated.** It was the *only* thing keeping the requirement open across all four runs, and it
was unsatisfiable by construction: the design's premise is two INDEPENDENT enumerations, and
independence implies variance. It was also never tunable — `claude -p` exposes 61 flags, none
controlling temperature, seed, or sampling. Two real code defects surfaced and were fixed along the
way (`findMatch`'s first-match-wins mis-attribution, `ANNOTATION_VOCABULARY_RE`'s decoration
intolerance — both confirmed fixed live in `177-21`), and the density hypothesis for the residual
variance was tested directly and **refuted** (`177-22`: splitting the densest slice fixed the one
line it was built to explain while overall flips rose to 4/32).
**Known limitations, recorded rather than buried:** residual confirmation variance ~12.5% (4/32),
entirely in the safe direction — a non-corroboration is "worth a human glance", NEVER a verdict;
absence claims only partly answerable; cross-slice references not corroborable by single-passage
enumeration; `covers()` uses an explicitly heuristic, fail-closed filename-stem attribution; and
three games is real generalization evidence, **not a general result** — every new game measured in
this milestone surfaced a new defect, and a fourth likely would too.
**What CHECK-04 now promises:** a tool that flags rule-bearing inferences worth a human's attention
and never sends that human after a line that was already correct. Not a reproducible score, and
**not a build gate.** Full detail: `177-CLOSURE-PROOF.md`, `177-FINAL-PROOF.md`,
`177-CONSOLIDATED-PROOF.md`, `177-EXPERIMENTS/`, `177-{20,21,22}-MEASUREMENT/`, and the CHECK-04
entry in `REQUIREMENTS.md` (which retains the full amendment history).
**Deferred, recorded open:** WR-07 (inverting `quoteLinesOnly`'s deny-list to an allow-list), and
the prerequisite game-repo fix that `seven`'s ingest transcription mislabels picture descriptions
as `Derived` rather than `Visual`.

Plans:
- [x] 177-01-PLAN.md — Widen `PRESENTATION_EXCLUSION_MARKERS` (decision 13), pinned by the 4 real slipping lines + a negative over-exclusion test; keep the cross-file lexicon pin honest; note 174's results stand
- [x] 177-02-PLAN.md — CHECK-04's mechanical core: frozen four-verdict enum, single record choke point, and the quote-lines-only blind payload filter proven leak-free on all 22 real lines
- [x] 177-03-PLAN.md — Project-level ledger through the one atomic write path, the report command, and `verify-derive-recheck`'s CLI registration (no `--run-id`, findings exit 0)
- [x] 177-04-PLAN.md — The two judgment contracts (`BS-DERIVE-V1` blind, `BS-DERIVE-COMPARE-V1` comparison), installer leaf probes, and drift pins
- [x] 177-05-PLAN.md — `verify-game.md`: the CHECK-04 step, the Context-Economics carve-out, renumbered Close, and a full stale-claim sweep recording TRUE findings too
- [x] 177-06-PLAN.md — Commit the 22-line distribution prediction BEFORE dispatching; stage the proof run on `cp -R` copies with sha256 baselines and a named dispatch mechanism
- [x] 177-07-PLAN.md — The live proof: grep a real blind dispatch prompt for zero `Derived (p.`, run the full 22-line corpus, compare against the prediction, disclose limitations. **Goal NOT MET** — SC-1 fails; CHECK-04 left OPEN (PARTIAL) in `REQUIREMENTS.md`.

Gap-closure plans (from `177-VERIFICATION.md` 3/6 must-haves + `177-REVIEW.md` 7 blockers):
- [x] 177-08-PLAN.md — GAP 2 / CR-01: decoration-proof strip + enumerate via one shared `annotationBody`, payload backstop throw, shared citation regex with `ingest-archive.ts` (WR-01), `Visual`-marker symmetry (WR-09), empirically-proven pins
- [x] 177-09-PLAN.md — Ledger integrity before exposure: fence-injection rejection (CR-04), read-path revalidation through the single choke point (CR-02), upsert-append `recordDeriveVerdict` (CR-06), evidence requirement (WR-05), blind pass-through cross-check (WR-04)
- [x] 177-10-PLAN.md — GAP 3 / CR-05: the missing `verify-derive-record` CLI write surface, `originalLine`-aware join (CR-03), orphan + staleness reporting (WR-03), printer and error-path fixes (WR-06/WR-02/WR-10), Step 7 corrected and pinned
- [x] 177-11-PLAN.md — GAP 1: opaque `blindDeriveHandle` replaces the resolvable pointer (CR-07), quote-local focus narrowing so per-candidate payloads differ, mechanical payload-distinctness, and `factAlignment` as the artifact-vs-genuine instrument
- [x] 177-12-PLAN.md — Pre-register the targeting metric (committed before any dispatch), then re-run the live proof: real `claude -p` on `cp -R` copies, every verdict recorded through the real CLI, originals byte-identical → `177-PROOF-2.md`
- [x] 177-13-PLAN.md — Measure the phase GOAL in its own unit and report it honestly (6/16, 37.5%, NOT MET); dispose of CHECK-04 on that evidence alone (stays OPEN); account for all 18 review findings as fixed (17) or deferred (WR-07, 1)

Design change — `177-EXPERIMENTS/` retired per-line blind re-derivation (structurally unanswerable; the metric it was tuned against was non-deterministic) and specified dual enumeration + reconciliation. Follow-on rounds (executed, summaries only):
- [x] 177-14 — Build the replacement mechanics: `verify-enumerate.ts` dual enumeration, arithmetic composition, and the unverified-quote provenance guard
- [x] 177-15 — First live measurement of the replacement on real dispatch (14 lines, two runs)
- [x] 177-16 — Resolve the 4 `quote-unverified` downgrades by checking supporting quotes against the archived source
- [x] 177-17 — Close the two named structural gaps: multi-step arithmetic chains and absence claims
- [x] 177-18 — Third reference game (`doom-machine`, uncleaned, independently classified); defect found
- [x] 177-19 — `QuoteVerifiedProvenance` multi-source scope defect found and fixed (fails closed)
- [x] 177-20 — Consolidated measurement, all three games, two runs; two real code defects found (`findMatch`, `ANNOTATION_VOCABULARY_RE`), disclosed not fixed
- [x] 177-21 — Definitive measurement: both 177-20 defects confirmed fixed live; 31/32 stable, one flip on enumerator variance
- [x] 177-22 — Density hypothesis tested directly and REFUTED (4/32 flips); determinism criterion identified as miscalibrated → retired, CHECK-04 CLOSED

### Phase 177.1: Wire CHECK-04's Closed Design Into The Pipeline
**Goal**: A designer running `/bs-verify-game` actually reaches the derived-line check CHECK-04 was closed on, instead of the design Phase 177 retired.
**Depends on**: Phase 177 (the closed design and its contracts)
**Requirements**: CHECK-04 (delivery gap in an already-closed requirement — the closure evidence stands; the wiring does not)

**Why this phase exists** (found during Phase 178 research, verified directly 2026-07-31):
CHECK-04 closed on the **dual-enumeration + reconciliation** design. That design is 1,438 lines of
tested TypeScript in `src/cli/commands/verify-enumerate.ts` — `buildEnumeratorPayload`,
`createEnumeratedFact`, `validateGrounding`, `composeArithmeticChain`, `QuoteVerifiedProvenance`,
`classifyDerivedLines` — and its two judgment contracts (`verify/enumerate-facts.md`
`BS-ENUMERATE-V1`, `verify/reconcile-facts.md` `BS-RECONCILE-V1`) are written, installed, and
token-pinned. **But it has no CLI command and no ledger.** `grep '.command(' src/cli/cli.ts`
has no entry for it; it is imported nowhere outside its own test. The four definitive
measurements ran through a standalone harness in `.planning/177-22-MEASUREMENT/`
(`driver.mjs`, `dispatch-enum.mjs`, `dispatch-reconcile.mjs`), never through the product.

Meanwhile `verify-game.md` Step 7 still dispatches `verify/derive-recheck.md` +
`verify/derive-compare.md` and formats `boardsmith verify-derive-recheck --json` — the **retired**
per-line blind design, the one measured at 6/16 and refuted as structurally unanswerable.

The closure evidence is sound; this is a delivery gap, not a measurement gap. But CHECK-04's own
closure note promises "a tool that flags rule-bearing inferences worth a human's attention," and
today no designer can reach that tool.

**Success Criteria** (what must be TRUE):
  1. A CLI surface exposes the dual-enumeration check end-to-end, following the read-command /
     single-atomic-write-surface pairing already established (`verify-derive-recheck` +
     `verify-derive-record`), including that pairing's fence-injection rejection, read-path
     revalidation, and upsert-append semantics.
  2. `/bs-verify-game` Step 7 dispatches `enumerate-facts.md` / `reconcile-facts.md` and formats
     the new command's `--json` — **formatted, never computed** by the skill, the discipline every
     other step in that file already holds.
  3. The retired blind-derivation design is REMOVED, not deprecated — `derive-recheck.md`,
     `derive-compare.md`, the `verify-derive-recheck` command, and the blind-payload machinery
     (`buildBlindDerivePayload`, `focusQuoteWindow`, `blindDeriveHandle`, `factAlignment`, the
     four-verdict enum) — per the project's No Backward Compatibility rule. Any part genuinely
     still needed by the new path is moved, not left behind as a second path.
     **AMENDED after discuss (177.1-CONTEXT D-01):** this criterion originally listed
     `verify-derive-record` for removal too. The accepted decision KEEPS it, retargeted onto the
     dual-enumeration verdict set, because it is CHECK-04's single atomic write surface (CR-05)
     and that identity is design-agnostic. CONTEXT governs as the later locked source.
  4. Proven by a real end-to-end `/bs-verify-game`-path run on at least one reference game,
     reproducing a classification the `.planning/` harness already produced for the same input —
     the product path and the measurement harness must agree.
  5. Advisory, exit 0, never gates the Close — CHECK-04's decision 15 is preserved through the
     rewiring, not silently changed by it.

**Plans**: 8 plans
- [x] 177.1-01-PLAN.md — Consolidate the five duplicated annotation-family regexes into one exported definition
- [x] 177.1-02-PLAN.md — Move the ledger, atomic upsert-append, fence rejection, and read-path revalidation onto the eight-member dual-enumeration verdict set
- [x] 177.1-03-PLAN.md — Build reconcileSlice() and retarget verify-derive-record onto it; add a machine-readable arithmeticSpec to reconcile-facts.md
- [x] 177.1-04-PLAN.md — Build verify-derive-check (read/report) and register both commands in cli.ts
- [x] 177.1-05-PLAN.md — Rewrite verify-game.md Step 7, its Context-Economics carve-out, and Reference Files onto the dual-enumeration design
- [x] 177.1-06-PLAN.md — Pre-register the split bar from a zero-dispatch dry run, then replay 177-22 run1 through the product CLI
- [x] 177.1-07-PLAN.md — DELETE the retired blind per-line design, its tests, contracts, installer entries, and pins
- [x] 177.1-08-PLAN.md — Live end-to-end Step 7 run on `seven` under the split bar, plus CHECK-04's closing delivery note

**Result:** All 5 success criteria MET. A CLI surface (`verify-derive-check`/`verify-derive-record`)
exposes the dual-enumeration check end-to-end, retargeted onto it from the retired ledger's
atomic-upsert-append/fence-rejection/read-path-revalidation machinery (SC-1). `/bs-verify-game`
Step 7 dispatches `enumerate-facts.md`/`reconcile-facts.md` and formats the new command's
`--json`, formatted never computed (SC-2). The retired blind-derivation design is fully REMOVED —
`derive-recheck.md`, `derive-compare.md`, `verify-derive-recheck`, and all blind-payload machinery
gone, exactly one live derived-line-check path remains (SC-3). Proven by a REAL end-to-end
`/bs-verify-game`-path run on `seven`: `177.1-06` replayed 177-22 run1's recorded data through the
product CLI (zero mechanical divergence across 7 categories); `177.1-08` dispatched real live
`claude -p` calls to the exact pinned models — all 3 live classifications landed within their
pre-registered permitted sets, and the live Sonnet-5 reconciler independently produced a
well-formed `arithmeticSpec` for both a `single` and a `chain` claim, accepted as correct by code
(SC-4). Advisory, exit 0, never gates Close — proven live, including with a deliberately
constructed `contradicted` record present (SC-5). CHECK-04's closure evidence is unchanged; this
phase closed a reachability gap, recorded in a Phase 177.1 delivery note appended to CHECK-04's
`REQUIREMENTS.md` entry. WR-07 (`quoteLinesOnly` deny-list → allow-list inversion) stays OPEN,
dated 2026-07-30, routed to Phase 178. See `177.1-LIVE-PROOF/PROOF.md` and
`177.1-08-SUMMARY.md`.

### Phase 178: Worked-Example Tests
**Goal**: Worked examples in the rulebook stop being a one-time seed for hand-written tests and become an accumulating, automatically-derived executable test suite in both build and verify.
**Depends on**: Phase 177.1 (the CLI/ledger pairing Phase 178 mirrors must reflect the design actually in the pipeline). **NOTE — the previously recorded dependency was FALSE**: this phase did NOT depend on "Phase 170 (the split determines which lines are examples vs. presentation)". Phase 170's annotation family is exactly `{Derived, Visual, Named-but-undefined}`; nothing in it identifies a worked example. Phase 178 must CREATE the identification mechanism, not consume one. See `178-CONTEXT.md` `<measured_reality>` #1.
**Requirements**: CHECK-06, TEST-01
**Success Criteria** (what must be TRUE):
  1. `build/test.md` generates an executable test for every worked example in a newly-built chunk's cited slices.
  2. Running worked-example replay against a reference game's cited slices executes each example against the real engine and reports any mismatch as a finding.
  3. Both mechanisms share the same example-to-test derivation logic rather than duplicating it.
**Plans**: 11 plans
  - [x] 178-01-PLAN.md — Example-line identification: family widening at a measured scope, WR-07 decision, ingest marker
  - [x] 178-02-PLAN.md — example-derivation.ts: WorkedExample spec, caller-assigned ids, both dispatch payload builders (SC-3)
  - [x] 178-03-PLAN.md — CHECK-06 ledger + verify-example-replay read/report command
  - [x] 178-04-PLAN.md — verify-example-record write surface, provenance gating, CLI registration
  - [x] 178-05-PLAN.md — verify-example-translate: the CLI surface for the translation dispatch payload + one-implementation guard (SC-3)
  - [x] 178-06-PLAN.md — verify-example-emit: one generated test file per chunk, sandbox-scanned
  - [x] 178-07-PLAN.md — extract-example.md / translate-example.md subagent contracts + installer probes
  - [x] 178-08-PLAN.md — build/test.md worked-example step (TEST-01), build-blocking, renumbered sequence
  - [x] 178-09-PLAN.md — verify-game.md Step 8 (CHECK-06), Close renumbered to Step 9
  - [x] 178-10-PLAN.md — Pre-registration: expected extraction + satisfiability audit, committed alone
  - [x] 178-11-PLAN.md — Live proof on all three reference games, generated tests executed, closure notes

**Result**: CHECK-06/TEST-01 CLOSED 2026-08-01 on 178-11's live proof (`178-PROOF.md`). Real
`claude -p` dispatches ran twice, independently, against `cp -R` copies of all three reference
games (25 live slices, n=11 pre-registered worked examples: `seven` 2, `one-two-punch` 6,
`doom-machine` 3 — corrected from the CONTEXT's inherited ~5-6 estimate at pre-registration time,
178-10). `seven`'s designated adversarial fixture was caught as `example-inconsistent` with both
contradicting excerpts, both runs. A real generated test (`doom-machine`) PASSED end-to-end
through the shipped `verify-example-emit` command and the project's own `vitest`; a second
(`one-two-punch`) FAILED honestly on a real construction-API mismatch. Two Rule 1/2 auto-fixes
shipped mid-proof (translated `import` statements had no path into the emitted file at all;
the translation payload never stated the generated file's real directory depth) — both were
genuine plumbing bugs no prior plan's tests caught, found only by executing the emitted output.
SC-3 proven by a 4-assertion source-inspection test, each naming the edit that breaks it. Only 2
of 11 examples were directly comparable across both independent runs (both agreed FAIL/FAIL);
identification-level variance (translation-attempt disagreement, composite-block symbol
selection, and slice-level over/under-identification) was found and reported plainly, never
smoothed over, per decision 17.

### Phase 179: Source-Free Verification Mode
**Goal**: A project whose source rulebook is unavailable still gets a verification pass — an honest, reduced one, never a failure and never a silent full-scope claim.
**Depends on**: Phase 172 (source-free checks), Phase 177 (the other source-free check), Phase 171 (PROV-02 scope recording)
**Requirements**: VERIFY-09, PROV-02 (reopened in practice — its mechanism was unreachable from the verify pipeline it describes)
**Success Criteria** (what must be TRUE):
  1. `/bs-verify-game` run against a project whose source rulebook is unavailable completes in source-free mode instead of failing.
  2. The source-free report names exactly which defect classes went unchecked (e.g. no fidelity re-transcription, no worked-example replay against fresh source).
  3. The verification's recorded scope reads code-conformance-only with the unavailable-source reason, per PROV-02.
**Plans**: 6 plans in 6 waves (linear — worktrees disabled, shared files across every wave)
**Result:** All 3 ROADMAP SCs and decision 11(a)-(d) MET on a live run (`179-PROOF.md`), staged
against a real `cp -R` copy of `seven` with `rulebook/source/` and root `rules.pdf` removed. SC-1's
restated bar (completion + non-vacuity, bound to §3) held: all four checks ran to completion, the
session dispatched past the negative case, and the Close's durable write landed 17/17
`recorded[]` entries. SC-2's 5-entry `uncheckedDefectClasses` count matched exactly. SC-3's
on-disk `## Verified Against` block (never the CLI's live recomputation) read back
`Scope: code-conformance-only` / `Reason: source-missing`, exactly as 179-05 corrected the
pre-registration to expect. Decision 11(d)'s per-check minimums: CHECK-03 232 findings, CHECK-05
16 findings, CHECK-06 3 real recorded findings from a live `claude -p` dispatch of the entire
pending corpus, all with downgraded `quote-unverified` provenance and unrewritten verdicts — MET
on the underlying mechanism, with the honest caveat that no `disagrees` verdict arose naturally so
the report's two named buckets were never populated by this run. `verify-close-record`'s
idempotency and fence-scoping both proven on the real project (not a fixture). Both reference-game
originals proven untouched by whole-tree `git status --short`, before and after. VERIFY-09 closed;
PROV-02 delivered end-to-end through the verify pipeline, not just the build pipeline. Full test
suite unchanged at 4368/249, 0 failing.

Plans:
- [x] 179-01-PLAN.md — the ONE step->defect-class mapping + computeSourceFreeReport, and decision 7's falsifiable coverage test against verify-game.md's real headings (wave 1)
- [x] 179-02-PLAN.md — `verify-source-free-check` read command, CLI registration, exit 0, and the PROV-02 data-flow test through the real provenance renderer (wave 2)
- [x] 179-03-PLAN.md — the durable write: extract `recordVerifiedAgainst` from `chunkCheckCommand`, add `verify-close-record` (idempotent, fence-bounded, scoped to evaluated chunks, exit 0), on-disk tests (wave 3)
- [x] 179-04-PLAN.md — the behavioural change: source-resolution.md's negative case enters `verify/source-free-mode.md`; BOTH Closes dispatch `verify-close-record`; installer probe, no-hardcoded-list pin, Close-dispatch pins (wave 4)
- [x] 179-05-PLAN.md — pre-registration committed ALONE: satisfiability + vacuity audit of all 7 criteria (SC-1 by name), durable-record expectation, whole-tree baseline protocol (wave 5)
- [x] 179-06-PLAN.md — live proof on a staged source-free reference game: real CHECK-06 dispatches with downgraded quote provenance, the Close's durable block read back from disk; 179-PROOF.md, VERIFY-09 disposition, closeout (wave 6)

## Progress

**Execution Order:**
Phases execute in numeric order: 170 → 171 → 172 → 173 → 174 → 175 → 176 → 177 → 178 → 179

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 170. Ingest Contract Upgrade | 9/10 | Complete   | 2026-07-28 |
| 171. Provenance Recording | 7/7 | Complete   | 2026-07-28 |
| 172. Source-Free Conformance Checks | 5/5 | Complete   | 2026-07-28 |
| 173. Verify Pipeline Core | 8/8 | Complete   | 2026-07-29 |
| 174. Verify Classifier | 8/8 | Complete — goal MET under the ROADMAP's literal bar (see Result) | 2026-07-31 |
| 175. Impact Map & Repair Gating | 8/8 | Complete   | 2026-07-30 |
| 176. Stale-Chunk Repair | 6/6 | Complete   | 2026-07-30 |
| 177. Derived-Line Re-Derivation | 22/22 | Complete — CHECK-04 CLOSED 2026-07-31 on the re-scoped design (see Result) | 2026-07-31 |
| 178. Worked-Example Tests | 11/11 | Complete   | 2026-08-01 |
| 179. Source-Free Verification Mode | 6/6 | Complete | 2026-08-01 |

## Shipped Milestones

- ✅ **v4.8 Battery Post-Mortem Fixes** — Phases 155–169 (shipped 2026-07-22) — 14/15 phases shipped; Phase 165 (D32 platform `[DRAWDROP]` logging) deferred-to-platform (proven absent from the library + all 5 game repos). Closed the 5-game build-battery post-mortem: D1–D31 library/dev-host/tooling/engine fixes, the two `bs-skills` defect fixes + the full autonomy rewrite (milestone playtest gates, batched questions, run-while-away, ≥50% context floor + sub-agent offload, loud completion, B.9 ledger reconciliation), the seed-to-state feasibility spike (+ thin `--seed` PoC), and the cross-repo de-workaround sweep across all 5 game repos (BSR-12 AI closed, BS-10 reclassified). Post-audit tech-debt pass also resolved the hidden-zone D24 game migration, v4.8-WR01 + v4.8-MCTS-UNDO. Library 3141 tests green; all 5 game repos green. Full detail: [`milestones/v4.8-ROADMAP.md`](milestones/v4.8-ROADMAP.md) · [requirements](milestones/v4.8-REQUIREMENTS.md) · [audit](milestones/v4.8-MILESTONE-AUDIT.md)
- ✅ **v4.7 Playtest Follow-Up Fixes** — Phases 152–154 (shipped 2026-07-06) — 5/5 requirements; closed DEF-A (asset completeness), DEF-C (dev-host reconnect turn-desync), and propagated DEF-B to MERC (738/7 green). Full detail: [`milestones/v4.7-ROADMAP.md`](milestones/v4.7-ROADMAP.md) · [requirements](milestones/v4.7-REQUIREMENTS.md) · [audit](milestones/v4.7-MILESTONE-AUDIT.md)
- ✅ **v4.6 BS Skills (Rulebook-Driven Game Building)** — Phases 140–151 (shipped 2026-07-05; reopened + re-closed same day for the human-playtest follow-up, Phases 150–151) — 36/36 requirements, human gate CLOSED, `v4.6.1` — full detail: [`milestones/v4.6-ROADMAP.md`](milestones/v4.6-ROADMAP.md) · [requirements](milestones/v4.6-REQUIREMENTS.md) · [audit](v4.6-MILESTONE-AUDIT.md)

_Prior milestones (v0.1–v4.5) archived under `.planning/milestones/`._
</content>
