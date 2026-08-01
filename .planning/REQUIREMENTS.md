# Requirements — v4.9 BS Skills Re-Verification

Adds re-verification to the `bs-` skill family: the ability to take an already-built game and
re-check it against its rules, catching drift introduced by improved models, improved rulebooks, or
improved bs skills.

The design is grounded in direct inspection of the two bs-built reference games,
`~/BoardSmithGames/seven` and `~/BoardSmithGames/one-two-punch`. Four findings from that inspection
shape these requirements:

1. **`RULINGS.md` is the reliable index of rule gaps** — 26 entries in one-two-punch, 20+ in seven,
   each carrying a `Citation interpreted or overridden:` field. `Named-but-undefined` markers are
   not reliable (seven has 4; one-two-punch has 0 despite 26 rulings), so they cannot be the input
   to a gap check.
2. **Tests already carry claim/ruling annotations** — 140 annotations across 227 tests in
   one-two-punch, 214 across 212 in seven — giving a machine-traceable code↔interpretation chain
   that works with no rulebook present.
3. **The `Derived` prefix is overloaded** — 8 of 12 derived lines in one-two-punch are diagram/art
   descriptions, not rule inferences. Rule-bearing inferences must be separable before they can be
   re-checked.
4. **Rule inference has already caused a real defect** — seven's Ruling 3 carries a
   `⚠ RATIONALE SUPERSEDED BY RULING 9` marker because its arithmetic was false.

**Revert point:** `bs-skills-pre-verify` at `2e92a3ee`, tagged before any work. `~/.claude/skills/`
is not version controlled — a full revert requires re-running `npx boardsmith claude --force` from
the tag.

---

## v4.9 Requirements

### Process (PROC)

- [x] **PROC-01**: Every skill change is proven against a real bs-built game (seven or
      one-two-punch), not only against the skill text — a skill edit that cannot be demonstrated on
      a real project is not done.
      *(Checkbox was inconsistent with the traceability table below, which already read
      "Complete" from Phase 170 — corrected here. Phase 173 reinforces it: every skill-text change
      this phase made — `source-resolution.md`'s Rule-1 fix in 173-06 — was live-exercised against
      a real `cp -R` copy of `seven` or `one-two-punch` before being trusted, and this phase's own
      `verify-run.ts` mechanism was proven with a real interrupted `claude -p` subprocess dispatch,
      not a simulated one. See `173-PROOF.md` sections 3 and 4.)*
- [x] **PROC-02**: Fix → write tests → adversarially verify the fix holds → only then close.

### Ingest Contract (INGEST)

- [x] **INGEST-01**: Ingest archives the source rulebook into the game project at a standard path
      and records its hash, so a later verify pass can re-read the same source it transcribed from.
- [x] **INGEST-02**: Transcription emits `Visual (p.N):` for diagram, art, and layout description,
      distinct from `Derived (p.N):` for rule inference, so rule-bearing inferences are separable
      from presentation notes.
- [x] **INGEST-03**: `rulebook/INDEX.md` carries a standardized `## Open Rules Gaps` section listing
      every rule the source names but never defines, so gap tracking does not depend on a session
      improvising the section.
- [x] **INGEST-04**: A designer can tell from `INDEX.md` alone which edition and which source file
      the slices were transcribed from, and when.

### Provenance (PROV)

- [x] **PROV-01**: `close` records a `## Verified Against` block in CHUNK.md — slice paths and
      hashes, rulebook edition, BoardSmith version, skills version, and verification scope.
- [x] **PROV-02**: A verification that could not re-read source records its scope as
      code-conformance-only with the reason, so a partial verification never reads as a full one.
- [x] **PROV-03**: `/bs-check-status` reports verification drift — how many chunks were verified
      against which edition and skills version, and how many are code-conformance-only.

### Verify Pipeline (VERIFY)

- [x] **VERIFY-01**: A designer can run `/bs-verify-game` on an existing bs-built project and get a
      per-chunk verdict without rebuilding the game.
      *(Both halves now proven live. Install-and-run: `173-PROOF.md` section 2 (SC-1, `seven`) and
      section 4 (`one-two-punch`). Per-chunk verdict: `174-PROOF.md` section 6 — real
      `boardsmith verify-classify-status --json`'s `chunkVerdicts[]` on both real reference games
      (`seven`: 16 citing chunks, 14 `sharper`/stale, 2 `cosmetic`/clean; `one-two-punch`: 11 citing
      chunks, all 11 `contradictory`/stale from this phase's real SC-3 mutation), with no build step
      between adoption and the verdict — confirmed by a whole-tree sha256 diff excluding
      `rulebook/.verify/`, not by the absence of a build command in the transcript. Citations/pairIds
      spot-checked directly against each named chunk's own CHUNK.md prose. **Open caveat carried
      forward, not smoothed over:** the phase-goal-level chunk staleness RATE on these two short
      (2-3 live-slice) reference games is high (87.5%/100% of citing chunks go stale from one real
      finding each) — see `174-PROOF.md` section 6's added measurement and `ROADMAP.md`'s Phase 174
      Result for the full diagnosis. This does not block VERIFY-01's own requirement text (a
      per-chunk verdict without rebuilding), which is proven; it is recorded as an open risk for
      Phase 175/176.)*
- [x] **VERIFY-02**: The skill re-transcribes the full rulebook from archived source into a staging
      tree non-destructively — existing slices are never overwritten before the pass closes.
      *(Proven live twice: `173-PROOF.md` section 3 (SC-2, `seven` — whole-tree manifest diff shows
      every pre-existing live slice byte-identical, all 7 new paths confined to `rulebook/.verify/`)
      and section 4 (this plan, `one-two-punch` — 9 staged slice files across 4 real dispatches, zero
      writes outside `rulebook/.verify/`, confirmed via `find`/`shasum`, never trusted from the
      command's own output).)*
- [x] **VERIFY-03**: Each slice pair is classified on two independent dimensions — **provenance**
      (`source-changed` or `source-unchanged`, from the archived source hash) and **rule delta**
      (`cosmetic` / `sharper` / `contradictory`, from semantic comparison of the two
      transcriptions). Staleness keys off the rule delta alone: `sharper` or `contradictory` marks
      chunks stale whether or not the source bytes moved, so independent re-wording does not flag
      every chunk and a genuine edition change is not missed. `source-changed` is recorded
      provenance and is always reported to the human — an edition change is a fact the designer
      must see — but it is not itself a staleness verdict.
      *(Proven real, on real data, across the two-dimension mechanism and both real classification
      bars: `174-PROOF.md` section 2 (SC-1 dimension independence + SC-2 measured at **90.9%**
      pooled rule-bearing line-level cosmetic, 0 contradictory — PASS against the pre-declared ≥90%
      bar), section 4 (determinism — identical `(pairId, ruleDelta, stale)` triples across two fully
      independent real dispatches, both games; 7/7 lexicon regression pairs), and section 5 (SC-3 —
      a real archived-source mutation, real re-transcription, real classification dispatch classified
      `contradictory`/`stale:true`/`provenance:source-changed`; SC-4's independence corroborated via
      cross-run comparison since no naturally-occurring `source-changed`+`cosmetic` real pair existed
      in this run — stated honestly rather than implied, and pinned structurally by
      `deriveStale`'s one-argument arity). Staleness-map/presentation-filter/pairing/ledger mechanics
      are unit-pinned in `src/cli/commands/verify-classify.test.ts`.)*
- [x] **VERIFY-04**: A `contradictory` classification always stops and asks the human, with both
      readings quoted side by side; the resolution is recorded in `RULINGS.md`.
      *(`175-PROOF.md` §§1–3d — the real archived 174-07 `contradictory` verdict measurably blocks a
      real `verify-impact-apply` pass (whole-copy sha256 diff: 0 files changed while pending), both
      terminal answers proven on real `cp -R` copies (`UNADJUDICATED` writes nothing to `RULINGS.md`;
      `resolved` appends a real, `trace-check`-parseable `### Ruling 27`), no representable bypass
      measured across all four commands' `--help` output, and — genuinely, not self-certified — the
      designer's own APPROVED verdict on the gate's adjudicability, recorded verbatim in §3d.)*
- [x] **VERIFY-05**: Chunks affected by a changed slice flip to a rules-staleness marker visible in
      both CHUNK.md and SKETCH.md, following the existing authority and write-order rules.
      *(Mechanically proven across plans 175-01 (marker + writer + registration), 175-02 (ledger
      kinds), 175-04 (impact map + gate-guarded apply), 175-05 (skill-text wiring), and 175-06
      (`/bs-check-status` item 9) — AND now proven with a REAL cross-file write against both live
      reference games: `175-PROOF.md` §4. `verify-impact-apply` marked the real, measured stale set on
      each game (`seven` 6/16, `one-two-punch` 6/11 — exactly matching `174-PROOF.md` §8's expected
      sets, zero symmetric difference), CHUNK.md-first/SKETCH.md-second write order confirmed,
      `Marker:` confirmed last in all 12 real written fenced bodies with zero CHUNK/SKETCH mismatches,
      the `Status:` line confirmed untouched (0 occurrences of `rules-stale` on any `Status:` line,
      both games), and cold-resume parseability confirmed on both written copies
      (`chunk-provenance-status`/`drift-check --json` parse every chunk, 17/17 and 12/12, zero parse
      failures). **A real live bug in the SKETCH.md insertion path was found producing this section's
      own first real write and fixed under deviation Rule 1** (§4 — the pointer line fused onto the
      next real bullet with no newline between them when no blank line separated them; fixed by never
      slicing past the Status line's own trailing newline; new regression test added;
      3826/3826 green). Both `~/BoardSmithGames` originals confirmed byte-identical throughout
      (`175-PROOF.md` §9).)*
- [x] **VERIFY-06**: Only chunks whose code changed during repair re-open the human playtest gate;
      chunks that pass the audit lenses unchanged close without re-playtesting.
      *(The mechanism — `computeRepairGate`'s four dispositions, the `Re-verified (no code
      change):` stamp, and the waived-reopen path — is unit-proven (175-04) AND now measured on both
      real reference games' real stale sets: `175-PROOF.md` §5. **Honest verdict: the practical payoff
      is NOT demonstrated on this data** — 1 of 12 (8.3%) rules-stale chunks across both games closes
      without re-playtesting (`one-two-punch`'s `final-acceptance`, real `drift-check: clean`); 11 of 12
      (91.7%) re-open the gate, because most stale chunks' code genuinely DID move (real
      `drift-check: drifted`) for reasons unrelated to the specific rules finding — both reference
      games have had substantial ordinary development land since their chunks were last verified. This
      differs from the anticipated `unknown-drift`-dominant failure mode: `dispositionCounts.
      unknown-drift` is 0 in both games' real gate output — the data landed in the `drifted`-dominant
      case instead, a different but equally real reason the payoff is not demonstrated (`175-PROOF.md`
      §5's interpretation subsection). Decision 13's `verified (user-waived)`+stale+code-changed path
      is proven **LIVE** (not constructed) on 8 real chunks across both games (`175-PROOF.md` §6);
      decision 11's `Re-verified (no code change):` stamp is proven on the one real chunk that took the
      clean path.)*
- [x] **VERIFY-07**: The orchestrator never reads a full slice — re-transcription and classification
      both run in subagents, preserving the context-economics rule.
      *(Both halves now proven live. Re-transcription: `173-PROOF.md` section 3 (`seven`) and section
      4 (`one-two-punch`). Classification: `174-PROOF.md` section 3 — grepped across three real
      artifacts per dispatch (dispatch prompts: zero matches, both games; raw subagent returns:
      matches present but accounted for by the documented `quotedPass1`/`quotedPass2` exception —
      `sharper`/`contradictory` verdicts REQUIRE both readings quoted verbatim by design; orchestrator
      transcript: one match, located precisely inside a `--quoted-pass2` recording argument
      forwarding the subagent's own returned field, zero matches anywhere else). **One honest
      exception beyond the stated scope, reported rather than absorbed:** 2 of `one-two-punch`'s raw
      subagent-return matches fall inside the free-prose `evidence` field, describing schema prefixes
      generically rather than quoting rule content — "evidence never contains a slice-body-shaped
      line" is not literally true of this real dispatch, only "evidence never contains a *quoted rule
      line*" is (`174-PROOF.md` section 3, Artifact 2).)*
- [x] **VERIFY-08**: A verify pass is resumable — a crash mid-pass resumes at the first unrecorded
      step rather than re-running the re-transcription.
      *(Proven with a REAL kill-and-resume, not a unit test: `173-PROOF.md` section 4. A harness-
      timeout SIGTERM mid-record-loop and a deliberate `kill -9` on a live subprocess PID were both
      exercised. The core, no-data-loss guarantee this requirement exists to protect holds under both:
      no recorded unit was ever lost, silently re-dispatched, or duplicated (verified via unchanged
      mtime+sha256 on staged files and single ledger lines), and the page range killed BEFORE any
      dispatch (page 2) resumed with zero waste, exactly at the first unrecorded step. **Caveat,
      reported rather than hidden (Finding 1 in section 4):** the page range killed PARTWAY THROUGH
      recording its own already-produced units (page 1) resumed by re-dispatching the WHOLE range
      rather than sub-dividing it, producing additional, non-duplicate but overlapping re-
      transcription content for that range (9 total recorded units vs. 4 for an uninterrupted clean
      run of the same book). The requirement's core promise — resumability without data loss — holds;
      its stronger literal reading — never re-running any re-transcription on resume — does not hold
      for a range interrupted mid-way through its own recording. Marked complete because the
      documented invariant (crash-safety, no lost/duplicated work) is what `173-VALIDATION.md`'s own
      SC-4 truths enumerate and what this requirement is actually protecting; the range-level
      idempotency gap is tracked as an open item, not smoothed into the checkbox.)*
      *(UPDATE 173-08: code review (`173-REVIEW.md` CR-01) subsequently showed the ledger write this
      completion rested on was NOT crash-safe as claimed — `fs.writeFile`'s default flag truncates
      and rewrites the WHOLE file on every append, so a crash could destroy prior, already-recorded
      units, not merely the newest one. 173-08 replaced the write with an atomic temp-file+`fsync`+
      `rename()` (proven via a real `SIGKILL` mid-write, `verify-run.test.ts` CR-B, plus a live
      32-real-kill hammer test, `173-PROOF.md` §5 — zero torn ledgers) and closed the range-level
      idempotency gap the caveat above named (a persisted dispatch-plan manifest + range-complete/
      range-reset markers make resume deterministic — the killed-then-resumed run's `recorded[]` now
      matches a clean run's exactly, where the original proof measured 9-vs-4). VERIFY-08 is
      RE-CONFIRMED complete against the corrected guarantee, not merely left checked on the disproven
      one — see `173-PROOF.md` §5.)*
- [ ] **VERIFY-09**: The skill runs against a project whose source rulebook is unavailable, in
      source-free mode, reporting which defect class went unchecked.

### Verification Checks (CHECK)

- [x] **CHECK-01**: Ruling re-validation — every `RULINGS.md` entry is re-checked against the fresh
      transcription and reported as still-needed, resolved-by-source, or contradicted, respecting
      supersession chains.
- [x] **CHECK-02**: The three audit lenses (fidelity, visibility, undo) run per stale chunk against
      raw slices plus `RULINGS.md`, feeding the existing bounded repair loop. Mechanism (never
      capped in code — `selectStaleChunks` processes every `stale === true` entry) proven live on a
      2-of-12 real dispatch sample (`176-PROOF.md` §4), decision 15's explicit cost-containment
      allowance. 15 real findings recorded, zero fixed (decision 16). The 4th (design-review) lens
      was NOT dispatched in this proof pass (needs a live dev-server/browser harness) — noted, not
      hidden.
- [x] **CHECK-03**: Traceability sweep — every Interpretation claim has a citing test, every test
      traces to a live claim, and every ruling has a test; gaps are reported as findings. Runs with
      no source present.
- [x] **CHECK-04**: Derived-line re-derivation — every rule-bearing `Derived` line is re-derived
      independently of pass 1 and disagreements reported. Runs with no source present. **PARTIAL —
      left OPEN, not closed, on re-measured evidence after a full 6-plan gap-closure sequence
      (177-08..13).** The phase's own goal, measured in its own unit
      (`177-GOAL-MEASUREMENT.md`, citing `177-PROOF-2.md` §§1-3 throughout): **6 of 16 real
      dispatch candidates (37.5%) received an independent second opinion genuinely about that
      line's own fact** — `seven` 2/10 (20%), `one-two-punch` 4/6 (67%). SC-2 and SC-3 remain MET
      on real evidence: the citing-both-derivations mechanism works unconditionally
      (`createDeriveVerdictRecord`, 8/8 real `disagrees` records this run carry both fields), and
      the check is source-free by construction with the same constructed-input-only disposition
      Phase 176 used for its Visual-lines gap (zero real `Visual (p.` lines in either reference
      game). **SC-1 remains NOT MET, and the gap-closure sequence's own targeting fix (`177-11`)
      did not close it when re-measured on live dispatch data (`177-12`/`177-PROOF-2.md`).** The
      blind-independence STRUCTURAL guarantee is now proven decoration-proof (CR-01, closed
      `177-08`) and no longer leaks a resolvable coordinate (CR-07, closed `177-11` —
      `blindDeriveHandle`'s opaque digest replaced the `Slice:`/`Target line:` pointer). But
      re-running the full live corpus after that fix (`177-12`, 28 real `claude -p` dispatches)
      measured `offTargetDisagreements` at 8 of 8 `disagrees` verdicts (100%) — WORSE than the
      pre-fix `177-PROOF.md` ratio (8/9, 89%) — against `177-TARGETING-PREDICTION.md`'s own
      pre-committed failure rule, which fired exactly as written: "THE FIX DID NOT WORK." A new,
      more specific finding explains why: 6 of the 10 failing lines in the re-measured corpus have
      a UNIQUELY-scoped focus passage (`targetingAmbiguous: false`) and still land off-target — a
      correctly and uniquely narrowed focus passage does not reliably steer the blind subagent's
      own derivation to the fact that passage actually supports. `focusQuoteWindow`'s
      payload-construction fix worked exactly as designed at its own layer (zero coordinate leaks;
      its one fully mechanical metric, `targetingAmbiguousCount`, was predicted exactly, 4/16, by a
      zero-dispatch dry-run) — the remaining defect is in the blind subagent's own derivation
      judgment given a correctly-scoped prompt, not in anything `verify-derive-recheck.ts`
      computes. This is a genuinely different, more specific defect than the one 177-11 closed, not
      a re-statement of the same gap. The write surface, ledger integrity, and decoration-tolerance
      gaps this sequence also closed (CR-02 through CR-06, WR-01 through WR-06, WR-08 through
      WR-11 — 17 of 18 `177-REVIEW.md` findings; see `177-GOAL-MEASUREMENT.md`'s findings ledger)
      are real, substantial, correctly-built infrastructure — CHECK-04 can now record a verdict
      end-to-end, cannot be corrupted by model-controlled text, and reports stale/orphaned records
      honestly. None of that infrastructure work resolves the targeting-judgment gap, which is what
      keeps CHECK-04 open. Verdicts exercised on REAL data across both proof runs: all four
      (`agrees`, `disagrees`, `underivable`, `not-rule-bearing`) on both the pre-fix and post-fix
      16-candidate corpora — unlike CHECK-01/CHECK-02, this check's full four-verdict set has now
      been exercised live twice, not only structurally. **What remains open, named as concrete
      work (`177-GOAL-MEASUREMENT.md`'s residual section):** a mechanism that either (a) forces the
      blind subagent to cite which specific sentence(s) within its focus passage it derived from,
      making an off-target derivation visible and reportable at the blind stage itself, or (b)
      resolves the 4 mechanically-ambiguous lines' shared-passage collision without reintroducing a
      leak risk. Neither was attempted in this gap-closure sequence — both are genuinely unresolved
      next-attempt work, not vague future polish. **WR-07 (inverting `quoteLinesOnly`'s deny-list
      to an allow-list) is a separate, deliberately deferred item** (dated 2026-07-30, per
      `177-08-PLAN.md`'s own instruction) — not a blocker to this disposition, recorded honestly as
      open rather than silently dropped.

      **AMENDMENT (2026-07-30, post-phase) — CHECK-04's approach is re-scoped. The requirement text
      above records what was tried and remains accurate as history; the acceptance approach below
      supersedes it.** Two post-hoc experiments (`.planning/phases/177-derived-line-re-derivation/177-EXPERIMENTS/`,
      see its `README.md`) established two things the phase itself never examined:
      (1) **8 of the 16 lines under test are descriptions of images**, not inferences from text —
      structurally unanswerable by a text-only subagent. Confirmed by two independent classification
      passes agreeing 15/16. `seven`'s transcription tags visual observations as plain
      `Derived (p.N):`, so the presentation filter (which only recognizes qualified forms) could not
      exclude them. Same-category lines scored oppositely, PASS and FAIL, under the existing
      mechanism.
      (2) **The existing mechanism is non-deterministic** — Track A's clean-population re-run scored
      3/7 (42.9%), essentially unchanged, and `one-two-punch:82` flipped PASS→FAIL on a fresh
      dispatch of an *identical payload*. The 6/16 figure was therefore never a measurement of a
      fixed quantity, and the whole gap-closure sequence was tuning against a moving metric.
      **The blocking insight is that per-line blind re-derivation asks an unanswerable question:**
      you cannot instruct a subagent to re-derive *a specific* fact without naming the fact, which
      is the one thing that must stay hidden. No amount of payload-construction work removes that.
      **New acceptance approach — dual enumeration with reconciliation.** Two subagents independently
      enumerate every fact a passage supports (each tagged with its source sentence); a third
      reconciles them into found-by-both / found-by-one. Facts found by both are well-supported;
      facts found by one warrant attention. Existing `Derived` lines are then cross-referenced as
      corroborated / uncorroborated / missed-by-transcription. No targeting is required, so the
      failure mode above cannot arise. Measured on real data (Track B, 15 dispatches): zero false
      disagreements on the exact 10 lines that broke the old design, image lines self-sorted 7/8
      with no filter, a real defect flagged at `seven:11`, and two real facts found that the
      transcription omitted entirely — a capability the per-line design structurally lacks.
      **CORRECTION (same day, after re-transcribing from the source PDF): the `seven:11` finding was
      MISDIAGNOSED, and the misdiagnosis is itself the more serious limitation.** The `Derived` line
      was correct — page 2 does end "...in each game during the match in no particular order." The
      defective line was the **quote** above it, which truncated the sentence; the `Derived` line
      existed to compensate. **The design feeds enumerators the transcription's own quote lines and
      treats them as ground truth, so a defect UPSTREAM of both enumerators is invisible to
      agreement** — they faithfully agree on what a broken quote says and the reconciler confidently
      reports a correct inference as contradicted. Worse than the arithmetic weakness: that one
      yields an honest shrug, this one yields a confident false accusation against the one line that
      was right. **Required guard:** no `Derived` line may be reported as a suspect inference until
      its supporting quote lines are checked against the archived source — verifying inferences
      against unverified quotes cannot separate "the inference is wrong" from "the quote is wrong."
      Anchor on the existing provenance machinery (source archive + hashes, `chunk-provenance.ts`).
      **Known open weakness of the new approach:** multi-hop arithmetic syntheses
      (`seven:21`, `seven:36`, `one-two-punch:52`) are systematically under-corroborated — every
      sub-fact is found by both enumerators but neither performs the final arithmetic, so the
      conclusion buckets as uncorroborated regardless of correctness. Fix candidate: instruct the
      reconciler to attempt cross-fact arithmetic, not only literal-meaning matching.
      **Not yet established:** the agreement signal's strength. The spot-check (~20 facts, zero
      errors) ran on a corpus of near-verbatim restatements that never posed a question two runs
      could get wrong the same way. Requires an ambiguous passage and ideally two *different models*
      before the corroboration signal can be trusted.
      **Confidence: low-to-moderate** — 5 passages, 2 games, 7 clean lines. Enough to establish the
      direction, not enough to fix a hit rate.
      **Prerequisite work, independent of CHECK-04:** `seven`'s ingest transcription mislabels
      picture descriptions as `Derived`. That defeats the Phase 170 `Derived`/`Visual` split for
      every downstream consumer, not just this check, and should be fixed regardless of which
      verification design is adopted.
      **Infrastructure retained:** the ledger, the `verify-derive-record` CLI write surface,
      enumeration, and the blind-independence guarantee (CR-01/CR-07) are design-agnostic and carry
      forward unchanged. Only the judgment step is replaced.

      **AMENDMENT 2 (2026-07-31, plan 177-20) — one consolidated measurement of current code
      (`b1a9bc35`), all three reference games, run twice for determinism. STILL OPEN.** Prior
      amendment's design is real and working on most of the corpus, but this run's own
      pre-committed closing criteria (`177-20-MEASUREMENT/PRE-REGISTRATION.md`, `f56add71`) require
      ALL FIVE to hold, and one does not: **determinism failed on 1 of 28 dispatchable lines**
      (`seven` L21, `corroborated-by-composition` → `uncorroborated` between two runs of unchanged
      input), traced to a genuine, newly-discovered code defect — `validateGrounding`'s `findMatch`
      picks the FIRST list entry matching a quote (`Array.find`), silently mis-attributing the wrong
      fact's `numericValue` when multiple facts in one enumerator's list share an identical
      `sourceSentence` (common when one source sentence backs several distinct numbers). Not fixed
      in this run, per honesty discipline (measurement, not remediation). A second, related defect
      was also found and disclosed: `ANNOTATION_VOCABULARY_RE` (the `d1c7199a` independence fix)
      does not tolerate a leading `(` before `Derived:`, so a parenthesized bare-`Derived:` line
      (`doom-machine/CARDS.md` L140) still leaks past both the strip filter and its own backstop —
      latent and unexercised in this run's real dispatches only because that same file is
      independently blocked from dispatch entirely by an unrelated mid-line citation defect (L270).
      **Every other closing criterion PASSED on this run's real evidence:** zero `contradicted` (in
      either run); grounding rejections (3 total across 487 "both" claims, both runs) were all real
      reconciler quoting-rule violations, mechanically caught, zero fabrications passed through;
      independence confirmed by `grep` against all 28 real dispatched payloads (zero annotation
      lines, zero missing tokens), not by assertion; every one of the 33 real `Derived` lines is
      attributable to a named category — 28 dispatched-and-classified (17-18 corroborated, 1-2
      corroborated-by-composition, 7-8 uncorroborated each individually named: cross-slice
      reference x3, "up to N" hedge ambiguity x1, conservative unit-incompatibility arithmetic
      refusal x1, the `findMatch` defect x1 in run 2, 2 genuine dual-enumeration misses; 2
      absence-*), and 5 (`doom-machine/CARDS.md`, entirely) blocked by a real, disclosed,
      uncorrected game-repo transcription defect, not worked around this time (177-18 manually
      stripped the offending line to keep measuring; this run did not, and reports the block itself
      as the finding). Full detail, both runs' raw dispatch data, and the two code-defect writeups:
      `177-CONSOLIDATED-PROOF.md`, `177-20-MEASUREMENT/`. **CHECK-04 remains open** — two specific,
      actionable code fixes are named for whoever closes it next (disambiguate `findMatch`;
      widen `ANNOTATION_VOCABULARY_RE`'s tolerated leading-decoration set to include `(`).

      **AMENDMENT 3 (2026-07-31, plan 177-21) — the definitive consolidated measurement, both
      177-20 defects confirmed FIXED and re-verified live; STILL OPEN on a new, structural finding.**
      Both fixes 177-20 named landed (`564f1a42`): `findMatch` now selects deterministically
      (strongest match rank, ties broken on content-derived id, order-independent) instead of
      `Array.find`'s first-match-wins; `ANNOTATION_VOCABULARY_RE` now consumes all non-alphanumeric
      leading decoration instead of a hand-enumerated character class. This run (`564f1a42`, all
      three reference games, run twice, pre-registered `2aad3d1c` before any dispatch) confirms both
      live: `seven` L21 — the exact line that flipped in 177-20 — is stable
      `corroborated-by-composition` in both runs of this measurement; `CARDS.md` L140's
      parenthesized `(Derived: ...)` form (the latent gap 177-20 could only test in isolation) is
      confirmed absent from the real dispatched payload, by grep, before any dispatch. `CARDS.md`'s
      whole-file block (177-20's line-270 mid-sentence citation) is also gone — **for the first time
      in this measurement chain, all real `Derived` lines across all three reference games were
      attempted, both runs, no blocks.** (Also disclosed: this run's own corpus-extraction harness
      had a bug that mis-flagged `CARDS.md` line 8 — the file's own legend explaining the annotation
      convention, using the literal placeholder `p.N` — as a real `Derived` line; fixed before
      analysis, confirmed absent from every real dispatch. The corrected true count is **32** real
      `Derived` lines, not 33.) **But determinism still failed** — 31/32 lines identical across runs,
      one flip (`doom-machine/CARDS.md` L143, `corroborated` → `uncorroborated`), traced this time
      to real ACROSS-RUN VARIANCE IN WHAT THE ENUMERATORS THEMSELVES ENUMERATED (haiku decomposed
      `CARDS.md`'s dense card-track data differently between run 1 and run 2, so the reconciler had
      no synthesizable pair to cite in run 2) — not a `validateGrounding`/`findMatch`-class code
      defect; both runs' mechanical checks behaved correctly given their legitimately different
      inputs. Per this run's own pre-registered rule (`177-21-MEASUREMENT/PRE-REGISTRATION.md`
      prediction 1: "a flip on ANY of the lines... means the fix did not fully close the defect, or
      a new determinism gap exists... CHECK-04 must NOT close"), this blocks closure exactly as
      pre-named. **Every other criterion PASSED on this run's real evidence:** zero `contradicted`
      (0/32, both runs); grounding rejections (14 run 1, 0 run 2, all on `CARDS.md`, all genuine
      Rule-2 quoting violations — the reconciler quoting a short glyph fragment instead of the
      fact's actual statement/sourceSentence — mechanically caught, spot-checked, zero fabrications
      passed through); independence confirmed by `grep` against all 32 real dispatched payloads
      BEFORE any dispatch (not by post-hoc assertion); every non-corroborated line named to a
      category (cross-slice reference x3, 2 genuine dual-enumeration misses, 1 harness
      arithmetic-spec gap, 1 structurally-unanswerable absence claim, plus the one determinism flip).
      Full detail, both runs' raw dispatch data (90 real `claude -p` calls): `177-FINAL-PROOF.md`,
      `177-21-MEASUREMENT/`. **CHECK-04 remains open.** Unlike the prior two amendments, no specific
      unfixed code defect is named as the blocker this time — what remains open is whether this
      design's determinism criterion, as currently defined (byte-identical classification across two
      full runs of unchanged input), is achievable at all against a large, information-dense slice
      dispatched to two independently-sampled, non-deterministic models, without either an
      enumeration-granularity mechanism this run did not test or a redefinition of the criterion
      itself — neither attempted here, per this run's own scope (measurement, not remediation).

      **AMENDMENT 4 (2026-07-31, plan 177-22) — the density hypothesis tested directly and
      REFUTED at the aggregate level; STILL OPEN, on a worse determinism reading.** Between 177-21
      and this run, `doom-machine`'s `CARDS.md` (435 lines, 125-150 facts/enumerator, the densest
      slice in the corpus) was split into 9 page-anchored slices (doom-machine commit `7e05243`),
      content preservation proven mechanically before this run started. This run (current HEAD,
      unchanged since `564f1a42` — no BoardSmith source touched — pre-registered
      `9e272f58` before any dispatch) repeats 177-21's method exactly on the same 32 real `Derived`
      lines, now spread across 18 slices instead of 15, both runs, 108 real `claude -p` dispatches
      (two explicit different-family model ids, `claude-opus-5`/`claude-haiku-4-5-20251001`, plus a
      `claude-sonnet-5` reconciler). **The specific line 177-21 flipped
      (`CARDS.md` L143, now `01-cards-parts-set-1.md` L66) is stable in both runs of this
      measurement** — the density hypothesis holds for the one case it was built to explain. **But
      determinism overall got WORSE, not better: 4/32 lines (12.5%) flip between runs, versus
      177-21's 1/32 (3.1%) and 177-20's 1/28 (3.6%), and 3 of the 4 new flips occur on ordinary,
      previously-stable slices never touched by the split** (`seven/01-definitions-and-components.md`
      L21 — the `7x4x4=112` arithmetic line, stable through both 177-20 and 177-21 — and
      `seven/01-overview-setup-and-play.md` L38, and `one-two-punch/02-action-cards-and-resolution.md`
      L117). Each flip is individually traced (`177-CLOSURE-PROOF.md`): 3 of 4 are enumerator B
      (haiku) omitting or restating a fact differently across runs on a small, ordinary-sized slice
      (13-50 facts/enumerator, nowhere near the old `CARDS.md`'s 125-150); the 4th (`seven` L21) is
      a newly-observed failure shape — a decomposition-driven grounding-pairing collision that
      `composeArithmeticClaim`'s own internal-consistency check correctly caught and refused rather
      than silently mis-composing. **Conclusion: slice density is not the (sole) cause of this
      design's cross-run instability — it is a general property of independently-sampled,
      non-deterministic enumerator models, present at any corpus size.** Splitting the one known
      dense slice removed that one instability locus without addressing the underlying cause.
      **Every other closing criterion PASSED on this run's real evidence, the second consecutive
      definitive run to do so:** zero `contradicted` (0/32, both runs); grounding rejections (1 run
      1, 8 run 2, all genuine reconciler Rule-2 quoting violations, mechanically caught, zero
      fabrications passed); independence confirmed by grep of the real production regexes against
      all 18 real dispatched payloads (zero matches) — a coarser exploratory grep's 4 hits were all
      the same genuine, transcribed cross-reference sentence the split introduced
      (`"...QUOTE/Derived/Visual legend..."`), disclosed and distinguished from an actual leak;
      every non-corroborated line in both runs traces to a named mechanical category. A disclosed,
      fixed, non-case-tuned measurement-harness bug (not a corpus or code finding): run 1's haiku
      enumerator emitted syntactically invalid JSON (an unescaped quote echoing the source
      document's own quoted text) for one slice; repaired generically in the harness's JSON-parsing
      step before re-running analysis on already-completed dispatch data, disclosed alongside its
      repair count (`177-22-MEASUREMENT/repair-log-run1.json`). Full detail, both runs' raw dispatch
      data (108 real `claude -p` calls): `177-CLOSURE-PROOF.md`, `177-22-MEASUREMENT/`. **CHECK-04
      remains open.** What remains open is now more clearly a design-level question than either
      prior amendment could show: whether byte-identical classification determinism is achievable
      at all against hosted, temperature-bearing enumerator models without either (a) redefining the
      determinism criterion (e.g., stability of the underlying grounded-fact set rather than the
      final classification label) or (b) a seed/temperature control this run's CLI dispatch surface
      does not expose — neither attempted here, per measurement-not-remediation scope.

      **CLOSED 2026-07-31.** The determinism criterion above was RETIRED as miscalibrated, and that
      is the only reason this requirement stayed open. It demanded byte-identical classifications
      across two runs from a design whose premise is TWO INDEPENDENT enumerations — independence
      implies variance, so the gate was unsatisfiable by construction. It was also never tunable:
      `claude -p` exposes 61 flags and none control temperature, seed, or sampling. Four definitive
      runs failed a bar that could not be passed, while the four criteria that actually protect a
      user passed cleanly in every one of them.
      **Closed on this evidence** (`177-15`, `177-20`, `177-21`, `177-22`; ~250 line-classifications
      across THREE reference games — `seven`, `one-two-punch`, `doom-machine` — the third larger,
      uncleaned, and independently classified):
      **zero wrongly-`contradicted` lines**, ever — no confident false accusation, the failure that
      made the retired per-line design worse than useless; **zero fabrications passed grounding** —
      every reconciler claim mechanically traced to text present in BOTH enumerator lists, with
      violations caught and reported rather than dropped; **zero annotation leaks** into any
      dispatched payload, confirmed by grep of every saved prompt, not by code inspection; **every
      non-corroborated line attributable to a named category.**
      **Known limitations, stated plainly rather than buried:** residual confirmation variance
      ~12.5% (4/32, `177-22`) — a line may read `corroborated` on one run and `uncorroborated` on
      another, so a non-corroboration is "worth a human glance", NEVER a verdict; absence claims are
      only partly answerable (`absence-unverifiable` is an honest bucket, not a failure);
      cross-slice references are not corroborable by single-passage enumeration; `covers()` uses an
      explicitly heuristic filename-stem attribution that fails closed; and **three games and ~32
      lines is real generalization evidence, not a general result — the rate is not fixed by this
      sample.** Every new game measured in this milestone surfaced a new defect; a fourth likely
      would too.
      **What this requirement now promises:** a tool that flags rule-bearing inferences worth a
      human's attention and never sends that human after a line that was already correct. It does
      not promise a reproducible score, and must not be used as a build gate.

      **PHASE 177.1 DELIVERY NOTE (2026-07-31) — reachability, not a reopening.** The closure above
      is NOT reopened and its evidence is unchanged; the four definitive measurement runs
      (`177-15`/`177-20`/`177-21`/`177-22`) still stand as this requirement's acceptance evidence.
      **What changed is REACHABILITY: at the time of closure, the dual-enumeration design that
      CHECK-04 was actually closed on had zero product wiring** — `verify-enumerate.ts` had no CLI
      command, no `verify-game.md` dispatch, and no designer-reachable path; the four measurement
      runs ran through a standalone harness (`177-22-MEASUREMENT/driver.mjs`), not the product.
      Phase 177.1 closed that gap:
      - A CLI surface now exists — `boardsmith verify-derive-check` (read/report) and
        `boardsmith verify-derive-record` (the sole write surface) — registered in `src/cli/cli.ts`,
        retargeting the ledger/write-surface/validation plumbing MOVED wholesale from the retired
        design (atomic upsert-append, fence-injection rejection, read-path revalidation, evidence
        requirement all carried forward unchanged).
      - `/bs-verify-game` Step 7 now dispatches `verify/enumerate-facts.md` (`BS-ENUMERATE-V1`) to
        two independent cross-family enumerators and `verify/reconcile-facts.md`
        (`BS-RECONCILE-V1`) to a reconciler, using the exact pinned model ids
        (`DERIVE_CHECK_MODELS`: `claude-opus-5`, `claude-haiku-4-5-20251001`, `claude-sonnet-5`) the
        measurement harness used — the design that was actually measured is now the one a designer's
        session reaches.
      - The retired per-line blind-derivation design — `buildBlindDerivePayload`, `focusQuoteWindow`,
        `blindDeriveHandle`, `factAlignment`, the four-verdict enum, `verify/derive-recheck.md`,
        `verify/derive-compare.md`, and the `verify-derive-recheck` command — is REMOVED, not
        deprecated, per this project's No Backward Compatibility rule. Exactly ONE live
        derived-line-check path remains.
      - The product path was proven against the harness on BOTH recorded input and a live run:
        `177.1-PRE-REGISTRATION.md` committed the split mechanical/model-dependent bar BEFORE any
        comparison ran; `177.1-REPLAY-PROOF/` replayed 177-22 run1's recorded `seven` returns through
        the real product CLI (zero divergences across all seven mechanical categories, `arithmeticSpec`
        supplied by hand per a disclosed input-shape adaptation); `177.1-LIVE-PROOF/PROOF.md`
        dispatched REAL, live model calls (not simulated, not replayed) through the INSTALLED skill
        prose and proved the live Sonnet-5 reconciler independently produces a well-formed
        `arithmeticSpec` — for both a `single` and a `chain` claim — that code accepts as correct; all
        three live classifications (L21, L36, L38) landed IN-SET against the pre-registered permitted
        label sets, zero out-of-set results.
      - **WR-07 (`quoteLinesOnly`'s deny-list → allow-list inversion) RESOLVED 2026-07-31 by Phase
        178 Plan 01, Task 2: Option B chosen — the deny-list is kept, `Example (p.N):` is added to
        it (measured zero-behavior-change on all three reference games, since none carries an
        `Example (p.` line today), and CHECK-06 gets its own separate extraction payload builder
        for the `Example` lines `quoteLinesOnly` now excludes.** Full evidence and the rejected
        Option A (allow-list inversion) are recorded in
        `.planning/phases/178-worked-example-tests/178-WR07-DECISION.md`. (Prior history: this
        phase's `quoteLinesOnly` port carried the deny-list posture forward unchanged in 177.1-02;
        the inversion itself was explicitly out of 177.1's scope and was not silently resolved by
        the reachability work above; WR-07 was routed to Phase 178, dated 2026-07-30.)
      - Findings surfaced while moving the design (recorded, not silently absorbed): behavior that
        only made sense for the retired four-verdict set was found and removed during the ledger move
        (177.1-02); the `arithmeticSpec` gap between the measurement harness's own hand-curated
        fixtures and the product's real dispatch contract was found and closed by wiring
        `arithmeticSpec` into `reconcile-facts.md` and `verify-enumerate.ts` (177.1-03) — this is the
        exact gap this delivery note's live-proof paragraph above closes; `repairUnescapedQuotes` (a
        measurement-harness JSON-repair utility) was found to have no product-side analogue and was
        deliberately NOT ported, since the CLI's own JSON.parse path either accepts or rejects a
        subagent's return outright rather than attempting a repair (177.1-03); a
        `PRESENTATION_EXCLUSION_MARKERS` divergence WAS found and deliberately left in place —
        `verify-classify.ts`'s presentation-schema-variant array is not element-wise derivable from
        the consolidated `ANNOTATION_CITATION_SOURCES` family list (different citation-body pattern,
        qualifier-group tolerance the family sources never carry), so it was left unconsolidated
        with an explanatory comment rather than silently widened or narrowed (177.1-01).
- [x] **CHECK-05**: Code drift — each chunk's Build Manifest files are diffed against its verified
      commit hash, and any chunk whose code moved since the human last approved it is reported.
- [x] **CHECK-06**: Worked-example replay — worked examples in the cited slices are executed against
      the engine and mismatches reported as findings. Wired into `/bs-verify-game` as an advisory,
      exit-0 Step 8 (178-09) dispatching the same shared derivation pipeline (`extract-example.md`/
      `translate-example.md`, `verify-example-replay`/`-translate`/`-record`) TEST-01 uses
      build-side, deliberately asymmetric per decision 11 (never gates the Close).
      **CLOSED 2026-08-01 by 178-11's live cross-game proof** (`.planning/phases/178-worked-example-tests/178-PROOF.md`):
      real `claude -p` dispatches ran against `cp -R` copies of all three reference games (25 live
      slices, matching the pre-registration exactly); `seven`'s designated adversarial fixture
      (the Run example's "5,6,7" vs "1,2,3" contradiction) was caught as `example-inconsistent`
      with BOTH excerpts recorded, on both of two independent runs; a real generated test
      (`doom-machine`'s DICE ROLL SYMBOLOGY block) was emitted through the shipped
      `verify-example-emit` command and PASSED when executed by the project's own `vitest`; a
      second real generated test (`one-two-punch`'s `punch` chunk) FAILED honestly (a real
      construction-API mismatch, not a mechanism defect). **What is honestly NOT proven at n=11**:
      only 2 of 11 pre-registered examples produced a generated test comparable across both
      independent runs; both agreed FAIL/FAIL (decision 15's outcome-only stability definition),
      but this is far too small a sample to claim general reliability. **Findings surfaced about
      the ingest/extraction contract (decision 17), never smoothed over**: a real plumbing bug
      (translated `import` statements had no path to the emitted file at all — fixed, see below)
      was found and fixed mid-proof; a 37.5% malformed-response rate on zero-content-line
      extraction payloads and a recurring off-by-one line-citation defect (3 of 11 examples, one
      run each) were found and named for future contract hardening, not fixed (both are Rule 4
      territory — contract/validation changes outside this plan's scope). **Two Rule 1/Rule 2
      auto-fixes shipped as part of closing this requirement** (both on `main`, both regression-tested):
      `verify-example-emit` now hoists/dedupes/validates translated `import` statements to file
      scope (previously no agrees/disagrees example needing a real project import could ever
      execute once emitted); `buildExampleTranslationPayload` now states the generated file's real
      two-directory depth so a translator's relative import guess resolves.

### Build Pipeline (TEST)

- [x] **TEST-01**: `build/test.md` generates example-derived tests for any worked example in the
      chunk's cited slices, so new games accumulate them systematically rather than by chance.
      **CLOSED 2026-08-01 by 178-11's live cross-game proof** — same evidence base as CHECK-06's
      closure note above (`.planning/phases/178-worked-example-tests/178-PROOF.md`): the identical
      extract→translate→emit→execute path both requirements share (SC-3) was exercised live and
      proven by source inspection (`example-derivation.test.ts`'s `SC-3 — both pipeline sides
      derive from one module` suite, 4 assertions, each naming the concrete edit that would break
      it). Build-side asymmetry (a `disagrees` verdict is build-blocking here, per decision 10 —
      never advisory the way CHECK-06's verify-side replay is) was preserved by design and is not
      re-tested by this proof, which ran the shared derivation path once per example rather than
      simulating a full chunk build.

---

## Future Requirements (deferred)

- Cross-game verification battery — run `/bs-verify-game` across every bs-built game as a single
  regression sweep. Depends on the single-game path being proven first.
- Scheduled/CI re-verification triggered by a BoardSmith version bump.
- Verification of variant/optional rules currently deferred out of scope at ingest.

## Out of Scope

- **Backfilling provenance into existing bs-built games** — no migration phase. Existing games
  verify in whatever mode their artifacts support; both reference games retain `rules.pdf`, so the
  source-based path still runs on them and the verify skill writes their provenance stamp on its
  first run.
- **Re-deriving the sketch or chunk list from a new rulebook** — the chunk list is stable. Rules with
  no citing chunk route through the existing `/bs-insert-chunk`.
- **A diff or report UI** — the impact map presented at the gate is the deliverable.
- **Auto-accepting a `contradictory` reading** — explicitly rejected; it always gates to the human.
- **MERC re-vendor** — MERC is not a `bs-` skills consumer.

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROC-01 | Phase 170 | Complete |
| PROC-02 | Phase 170 | Complete |
| INGEST-01 | Phase 170 | Complete |
| INGEST-02 | Phase 170 | Complete |
| INGEST-03 | Phase 170 | Complete |
| INGEST-04 | Phase 170 | Complete |
| PROV-01 | Phase 171 | Complete |
| PROV-02 | Phase 171 | Complete |
| PROV-03 | Phase 171 | Complete |
| CHECK-03 | Phase 172 | Complete |
| CHECK-05 | Phase 172 | Complete |
| VERIFY-01 | Phase 173 (closed 174-07) | Complete — install+run proven (173-06/173-07); per-chunk verdict proven live on real data (`174-PROOF.md` §6). Chunk-level staleness RATE on both real reference games is an open risk carried to Phase 175/176 (see ROADMAP Phase 174 Result), not a gap in this requirement's own text |
| VERIFY-02 | Phase 173 | Complete (173-06/173-07 proof) |
| VERIFY-07 | Phase 173 (closed 174-07) | Complete — re-transcription absence proven (173-06/173-07); classification-in-subagent absence proven live (`174-PROOF.md` §3), one honest exception beyond the stated scope reported (free-prose `evidence` schema-mentions) |
| VERIFY-08 | Phase 173 | Complete (173-07 proof; re-confirmed 173-08 against a corrected crash-safety guarantee + closed range-level resume determinism — see `173-PROOF.md` §5) |
| VERIFY-03 | Phase 174 | Complete — the CLI surface (174-04), the classification subagent contract (174-05), and every real-data bar (SC-1 through SC-5) proven live (`174-PROOF.md` §2, §4, §5): SC-2 90.9% cosmetic PASS, SC-3 real mutation → `contradictory` PASS, determinism identical, 7/7 lexicon regression |
| VERIFY-04 | Phase 175 | Complete — `175-PROOF.md` §§1–3d |
| VERIFY-05 | Phase 175 | Complete — `175-PROOF.md` §4 (real cross-file write, both games) |
| VERIFY-06 | Phase 175 | Complete — `175-PROOF.md` §5/§6 (payoff measured, honestly NOT demonstrated on this data; decision 13 proven LIVE) |
| CHECK-01 | Phase 176 | Complete — full 62-ruling corpus re-checked and reported live (`176-PROOF.md` §2-§3), SC-3 (`seven` Ruling 1) proven MET. Verdict-provenance note (`176-PROOF.md` §3b): `still-needed` proven on real data (60/60 dispatched); `resolved-by-source`/`contradicted` proven correct-when-called-for only on 2 CONSTRUCTED lexicon cases (2/2 match) — neither reference game's committed fixture contains real content producing those labels. Same disposition basis Phase 174 used for VERIFY-03's own real-data gap. |
| CHECK-02 | Phase 176 | Complete — mechanism proven never-capped in code (`selectStaleChunks`); real dispatch on a stated 2-of-12 subset (`176-PROOF.md` §4), decision-17's episode rule proven in BOTH games on already-at-3-round chunks, paired pre/post-repair gate readings (§5). 4th lens (design-review) NOT dispatched in this proof pass — stated limitation, not hidden. Two live bugs found+fixed enabling this proof (`ImpactMapEntry.pairIds` drop, `appendAuditRoundHeading` mis-placement) — see §4. |
| CHECK-04 | Phase 177 (delivery: Phase 177.1) | **Complete** — closed 2026-07-31 on the reframed criterion, see the CHECK-04 entry's closure note AND its Phase 177.1 delivery note directly below it. Dual enumeration + reconciliation replaced the retired per-line blind re-derivation design. Measured across THREE reference games (`seven`, `one-two-punch`, `doom-machine`), ~250 line-classifications over four definitive runs (`177-15`, `177-20`, `177-21`, `177-22`): **zero wrongly-`contradicted` lines, zero fabrications passed grounding, zero annotation leaks into any dispatched payload, every result explainable** — the four criteria that protect a user, clean in every run. The fifth criterion (byte-identical classifications across two runs) was RETIRED as miscalibrated: the design's premise is two INDEPENDENT enumerations, independence implies variance, and `claude -p` exposes no temperature/seed control (61 flags, none for sampling). Residual confirmation variance ~12.5% (4/32, `177-22`), entirely in the safe direction — a line may read `corroborated` on one run and `uncorroborated` on another, never falsely `contradicted`. Treat a non-corroboration as "worth a human glance", never as a verdict. **Phase 177.1 closed a reachability gap, not this closure**: the measured design now has a CLI surface (`verify-derive-check`/`verify-derive-record`) and `/bs-verify-game` Step 7 dispatches it directly. Proven against the harness on recorded input (`177.1-REPLAY-PROOF/`, zero mechanical divergence) and a real live run (`177.1-LIVE-PROOF/PROOF.md`) — the live Sonnet-5 reconciler produced a well-formed `arithmeticSpec` for both a `single` and a `chain` claim, code accepted both as correct, and all three live classifications landed within their pre-registered permitted sets. WR-07 stays open, routed to Phase 178. |
| CHECK-06 | Phase 178 | **Complete** — closed 2026-08-01 by 178-11's live cross-game proof (`178-PROOF.md`); reachability wired (`/bs-verify-game` Step 8, advisory, exit 0) in 178-09 |
| TEST-01 | Phase 178 | **Complete** — closed 2026-08-01 by 178-11's live cross-game proof (`178-PROOF.md`), SC-3 proven by source inspection |
| VERIFY-09 | Phase 179 | Pending |
