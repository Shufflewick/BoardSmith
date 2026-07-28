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
- [ ] **Phase 173: Verify Pipeline Core** - `/bs-verify-game` skill entry, non-destructive re-transcription staging, subagent-only context economics, crash resumability
- [ ] **Phase 174: Verify Classifier** - Two-dimension classification (provenance + rule delta), tuned and validated against real pass-1-vs-pass-2 output
- [ ] **Phase 175: Impact Map & Repair Gating** - Contradictory human gate, cross-file staleness flip, scoped re-playtest (code-changed chunks only)
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
**Plans**: TBD

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
**Plans**: TBD

### Phase 175: Impact Map & Repair Gating
**Goal**: A classified slice pair produces the right downstream consequence — human adjudication for genuine contradictions, visible staleness for affected chunks, and repair effort scoped to what actually changed.
**Depends on**: Phase 174
**Requirements**: VERIFY-04, VERIFY-05, VERIFY-06
**Success Criteria** (what must be TRUE):
  1. A `contradictory` classification always stops the pass and presents both readings side by side to the human; the resolution is recorded in `RULINGS.md`.
  2. Chunks affected by a changed slice flip to a visible rules-staleness marker in both CHUNK.md and SKETCH.md, following the existing write-order and authority rules from `state-machine.md`.
  3. Only chunks whose code actually changed during repair re-open the human playtest gate; chunks that pass the audit lenses unchanged close without re-playtesting.
**Plans**: TBD

### Phase 176: Stale-Chunk Repair
**Goal**: Every stale chunk gets re-checked against the composite source of truth (fresh transcription + RULINGS.md) through the same audit lenses the build pipeline already trusts.
**Depends on**: Phase 175
**Requirements**: CHECK-01, CHECK-02
**Success Criteria** (what must be TRUE):
  1. Every `RULINGS.md` entry is re-checked against the fresh transcription and reported as still-needed, resolved-by-source, or contradicted, respecting supersession chains.
  2. The three audit lenses (fidelity, visibility, undo) run against raw slices plus `RULINGS.md` for every stale chunk, feeding the existing bounded repair loop.
  3. Run against seven's Ruling 1 — the designer-statement scoring table with no source card — this produces a defensible still-needed/resolved/contradicted verdict, proving the highest-consequence ruling re-validation target in either reference game.
**Plans**: TBD

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
| 173. Verify Pipeline Core | 0/TBD | Not started | - |
| 174. Verify Classifier | 0/TBD | Not started | - |
| 175. Impact Map & Repair Gating | 0/TBD | Not started | - |
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
