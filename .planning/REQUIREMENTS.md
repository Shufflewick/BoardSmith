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
- [ ] **VERIFY-04**: A `contradictory` classification always stops and asks the human, with both
      readings quoted side by side; the resolution is recorded in `RULINGS.md`.
- [x] **VERIFY-05**: Chunks affected by a changed slice flip to a rules-staleness marker visible in
      both CHUNK.md and SKETCH.md, following the existing authority and write-order rules.
- [x] **VERIFY-06**: Only chunks whose code changed during repair re-open the human playtest gate;
      chunks that pass the audit lenses unchanged close without re-playtesting.
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

- [ ] **CHECK-01**: Ruling re-validation — every `RULINGS.md` entry is re-checked against the fresh
      transcription and reported as still-needed, resolved-by-source, or contradicted, respecting
      supersession chains.
- [ ] **CHECK-02**: The three audit lenses (fidelity, visibility, undo) run per stale chunk against
      raw slices plus `RULINGS.md`, feeding the existing bounded repair loop.
- [x] **CHECK-03**: Traceability sweep — every Interpretation claim has a citing test, every test
      traces to a live claim, and every ruling has a test; gaps are reported as findings. Runs with
      no source present.
- [ ] **CHECK-04**: Derived-line re-derivation — every rule-bearing `Derived` line is re-derived
      independently of pass 1 and disagreements reported. Runs with no source present.
- [x] **CHECK-05**: Code drift — each chunk's Build Manifest files are diffed against its verified
      commit hash, and any chunk whose code moved since the human last approved it is reported.
- [ ] **CHECK-06**: Worked-example replay — worked examples in the cited slices are executed against
      the engine and mismatches reported as findings.

### Build Pipeline (TEST)

- [ ] **TEST-01**: `build/test.md` generates example-derived tests for any worked example in the
      chunk's cited slices, so new games accumulate them systematically rather than by chance.

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
| VERIFY-04 | Phase 175 | Pending |
| VERIFY-05 | Phase 175 | Complete |
| VERIFY-06 | Phase 175 | Complete |
| CHECK-01 | Phase 176 | Pending |
| CHECK-02 | Phase 176 | Pending |
| CHECK-04 | Phase 177 | Pending |
| CHECK-06 | Phase 178 | Pending |
| TEST-01 | Phase 178 | Pending |
| VERIFY-09 | Phase 179 | Pending |
