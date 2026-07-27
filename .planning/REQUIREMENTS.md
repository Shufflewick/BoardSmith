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

- [ ] **PROV-01**: `close` records a `## Verified Against` block in CHUNK.md — slice paths and
      hashes, rulebook edition, BoardSmith version, skills version, and verification scope.
- [ ] **PROV-02**: A verification that could not re-read source records its scope as
      code-conformance-only with the reason, so a partial verification never reads as a full one.
- [ ] **PROV-03**: `/bs-check-status` reports verification drift — how many chunks were verified
      against which edition and skills version, and how many are code-conformance-only.

### Verify Pipeline (VERIFY)

- [ ] **VERIFY-01**: A designer can run `/bs-verify-game` on an existing bs-built project and get a
      per-chunk verdict without rebuilding the game.
- [ ] **VERIFY-02**: The skill re-transcribes the full rulebook from archived source into a staging
      tree non-destructively — existing slices are never overwritten before the pass closes.
- [ ] **VERIFY-03**: Each slice pair is classified on two independent dimensions — **provenance**
      (`source-changed` or `source-unchanged`, from the archived source hash) and **rule delta**
      (`cosmetic` / `sharper` / `contradictory`, from semantic comparison of the two
      transcriptions). Staleness keys off the rule delta alone: `sharper` or `contradictory` marks
      chunks stale whether or not the source bytes moved, so independent re-wording does not flag
      every chunk and a genuine edition change is not missed. `source-changed` is recorded
      provenance and is always reported to the human — an edition change is a fact the designer
      must see — but it is not itself a staleness verdict.
- [ ] **VERIFY-04**: A `contradictory` classification always stops and asks the human, with both
      readings quoted side by side; the resolution is recorded in `RULINGS.md`.
- [ ] **VERIFY-05**: Chunks affected by a changed slice flip to a rules-staleness marker visible in
      both CHUNK.md and SKETCH.md, following the existing authority and write-order rules.
- [ ] **VERIFY-06**: Only chunks whose code changed during repair re-open the human playtest gate;
      chunks that pass the audit lenses unchanged close without re-playtesting.
- [ ] **VERIFY-07**: The orchestrator never reads a full slice — re-transcription and classification
      both run in subagents, preserving the context-economics rule.
- [ ] **VERIFY-08**: A verify pass is resumable — a crash mid-pass resumes at the first unrecorded
      step rather than re-running the re-transcription.
- [ ] **VERIFY-09**: The skill runs against a project whose source rulebook is unavailable, in
      source-free mode, reporting which defect class went unchecked.

### Verification Checks (CHECK)

- [ ] **CHECK-01**: Ruling re-validation — every `RULINGS.md` entry is re-checked against the fresh
      transcription and reported as still-needed, resolved-by-source, or contradicted, respecting
      supersession chains.
- [ ] **CHECK-02**: The three audit lenses (fidelity, visibility, undo) run per stale chunk against
      raw slices plus `RULINGS.md`, feeding the existing bounded repair loop.
- [ ] **CHECK-03**: Traceability sweep — every Interpretation claim has a citing test, every test
      traces to a live claim, and every ruling has a test; gaps are reported as findings. Runs with
      no source present.
- [ ] **CHECK-04**: Derived-line re-derivation — every rule-bearing `Derived` line is re-derived
      independently of pass 1 and disagreements reported. Runs with no source present.
- [ ] **CHECK-05**: Code drift — each chunk's Build Manifest files are diffed against its verified
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
| PROC-02 | Phase 170 | Pending |
| INGEST-01 | Phase 170 | Pending |
| INGEST-02 | Phase 170 | Pending |
| INGEST-03 | Phase 170 | Pending |
| INGEST-04 | Phase 170 | Pending |
| PROV-01 | Phase 171 | Pending |
| PROV-02 | Phase 171 | Pending |
| PROV-03 | Phase 171 | Pending |
| CHECK-03 | Phase 172 | Pending |
| CHECK-05 | Phase 172 | Pending |
| VERIFY-01 | Phase 173 | Pending |
| VERIFY-02 | Phase 173 | Pending |
| VERIFY-07 | Phase 173 | Pending |
| VERIFY-08 | Phase 173 | Pending |
| VERIFY-03 | Phase 174 | Pending |
| VERIFY-04 | Phase 175 | Pending |
| VERIFY-05 | Phase 175 | Pending |
| VERIFY-06 | Phase 175 | Pending |
| CHECK-01 | Phase 176 | Pending |
| CHECK-02 | Phase 176 | Pending |
| CHECK-04 | Phase 177 | Pending |
| CHECK-06 | Phase 178 | Pending |
| TEST-01 | Phase 178 | Pending |
| VERIFY-09 | Phase 179 | Pending |
