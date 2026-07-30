# Phase 175: Impact Map & Repair Gating - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning
**Requirements:** VERIFY-04, VERIFY-05, VERIFY-06
**Mode:** Smart discuss (autonomous) — four grey areas presented in batch, all accepted by the user
2026-07-30 with no overrides.

<domain>
## Phase Boundary

A classified slice pair produces the right downstream consequence — human adjudication for genuine
contradictions, visible staleness for affected chunks, and repair effort scoped to what actually
changed.

In scope:
- VERIFY-04 — a `contradictory` classification always stops the pass and presents both readings side
  by side; the resolution is recorded in `RULINGS.md`.
- VERIFY-05 — chunks affected by a changed slice flip to a visible rules-staleness marker in both
  CHUNK.md and SKETCH.md, following `state-machine.md`'s existing write-order and authority rules.
- VERIFY-06 — only chunks whose code actually changed during repair re-open the human playtest gate;
  chunks passing the audit lenses unchanged close without re-playtesting.
- The impact map: which chunks a classified delta actually affects, recorded run-scoped.

Out of scope:
- **The classifier itself** — Phase 174, complete. This phase CONSUMES its verdicts and its retained
  line-level evidence; it never re-classifies and never second-guesses a label.
- **Performing the repair** — Phase 176 owns re-checking stale chunks through the audit lenses
  (CHECK-02) and ruling re-validation (CHECK-01). This phase decides WHICH chunks need repair and
  what re-opens the playtest gate; it does not repair.
- **Derived-line re-derivation** (CHECK-04) — Phase 177.
- **Worked-example replay** (CHECK-06) — Phase 178.
- **Source-free mode assembly** (VERIFY-09) — Phase 179. No mode flag here.
</domain>

<decisions>
## Implementation Decisions

### The sort: mostly MECHANICAL, with exactly one human gate

Per Phase 170's `170-MECHANISMS.md` finding, each requirement is sorted before planning:

| Req | Sort | Why |
|---|---|---|
| VERIFY-04 | Mechanical gate + human judgment | Detecting `contradictory` and formatting both readings is mechanical; the RESOLUTION is the human's. The skill must not decide it. |
| VERIFY-05 | Mechanical | Marker write into two files under fixed authority/write-order rules. One correct output. |
| VERIFY-06 | Mechanical | "Did this chunk's code move" is a diff against a recorded hash — Phase 172's `drift-check` already answers it. |

So this is CLI work plus one genuine stop-and-ask, continuing Phases 171-174's shape.

### Area 1 — The rules-staleness marker (accepted 2026-07-30)

1. **Rules-staleness is a NEW, ORTHOGONAL marker — NOT a new status-enum value.** The chunk's build/
   playtest status (`verified`) remains a true statement of fact: a human really did playtest it. That
   its rules basis has since moved is a SECOND, independent axis. Folding the two together multiplies
   the enum combinatorially (`built`+stale, `verified`+stale, `verified (user-waived)`+stale) and makes
   every consumer parse a product space instead of two orthogonal facts.

   Note the existing marker this must NOT be conflated with: `stale — re-derive before build`
   (em-dash, set by `/bs-insert-chunk`) means "a PENDING chunk's CHUNK.md was invalidated by a sketch
   change." A rules-stale chunk is the opposite situation — already built and playtested, with the
   rulebook underneath it having moved. Reusing that marker would erase the distinction between
   "never built" and "built against rules that changed".

2. **The marker lives in a MACHINE-OWNED FENCED REGION in CHUNK.md**, following Phase 171's
   `## Verified Against` pattern (the same fenced, tool-owned, repair-in-place discipline).

3. **Write order and authority are cited, not restated:** CHUNK.md first, SKETCH.md second, never
   SKETCH.md alone, `Status:` line written LAST, round entries append-only — `state-machine.md`
   ("Write Order"). CHUNK.md wins on contradiction and SKETCH.md is repaired to match, never the
   reverse — `state-machine.md` ("Authority", the TMPL-03 rule).

4. **Only a successful repair close (Phase 176) clears the marker.** A verify pass never clears it,
   and there is no manual clear path. A marker that the tool sets and the tool can silently unset is
   a marker nobody can trust.

5. **The new marker MUST be registered in `state-machine.md`'s Cold-Resume Parse Contract recognized
   set.** This is load-bearing, not bookkeeping: item 3 of that contract makes any unrecognized status
   a PARSE FAILURE that stops the skill and asks. Ship the marker without registering it and every
   `bs-` skill hard-fails its consistency check on any project that has one. Registration and the
   marker must land in the same change.

### Area 2 — The contradictory human gate (accepted 2026-07-30)

6. **Classification of ALL pairs completes first; then a hard adjudication gate fires BEFORE any
   staleness write.** This satisfies VERIFY-04's "always stops the pass" — nothing downstream of the
   gate happens until the human answers — while giving the designer every contradiction at once with
   full context, rather than one interruption per finding mid-pass.

   Rejected: stopping immediately at the first `contradictory` mid-classification — it abandons a
   resumable pass partway, and it asks the human to adjudicate with no view of what else changed.

7. **`RULINGS.md` writes reuse the EXISTING `### Ruling N` shape exactly** (Decision / Citation /
   Rationale fields), append-only, embedding both verbatim readings Phase 174 captured in
   `quotedPass1`/`quotedPass2`. No verify-specific ruling format — a second format would fork the
   corpus that CHECK-01's ruling re-validation (Phase 176) has to read.

8. **A deferred or aborted adjudication records the contradiction as UNADJUDICATED and still marks the
   affected chunks stale.** Never silently clean. The lock releases cleanly and the pass stays
   resumable. This is the same never-report-clean-where-blind principle as Phase 174's `unclassified`
   → stale and 172's `drift-unknown`.

9. **There is NO bypass flag.** VERIFY-04 says a contradictory classification ALWAYS stops and asks;
   the pit-of-success form of "always" is that no representable option skips it — not a documented flag
   that a future unattended run reaches for. An unattended run stops, records, and resumes later.

### Area 3 — Repair gating and the playtest re-open (accepted 2026-07-30)

10. **"Code changed during repair" is answered by reusing Phase 172's `drift-check` (CHECK-05)** —
    Build Manifest files diffed against the chunk's recorded `## Verified Commit Hash`. One authority
    for "did this chunk's code move", not a second content-hash scheme written here that could
    disagree with the first.

11. **A chunk that passes the audit lenses UNCHANGED keeps `verified`, has its rules-stale marker
    cleared, and gets a `## Verified Against` stamp recording a re-verification with NO code change.**
    It is never downgraded — downgrading a chunk whose code never moved would re-open a playtest gate
    for nothing, which is precisely the wasted human effort VERIFY-06 exists to prevent.

12. **A chunk whose code DID change goes to `built`, marker cleared, playtest gate re-opened.** `built`
    is the honest status: the code exists and passes automated test, and no human has confirmed the new
    behavior. Keeping `verified` on changed code would make the enum lie.

13. **A `verified (user-waived)` chunk that goes rules-stale AND whose code changes RE-OPENS the
    gate.** A waiver was the human's decision about one specific state of the code, not a standing
    exemption. The human may waive again — explicitly, as a fresh decision. Auto-re-waiving would
    silently convert a one-time choice into a permanent one.

### Area 4 — Carrying Phase 174's anchor-density finding forward (accepted 2026-07-30)

14. **Adjudication is ONE decision per contradictory FINDING, never per affected chunk.** Phase 174
    measured that a single finding can touch 6+ chunks (`174-PROOF.md` §8), so per-chunk prompting would
    ask the same question six times and train the designer to click through it.

15. **The stale fraction is reported prominently and NEVER capped or suppressed** — e.g. "6 of 16
    chunks rules-stale". Phase 174 closed with anchor density as a known open property: on short,
    heavily cross-referenced rulebooks the stale set is broader than ideal. Truncating that list would
    hide exactly the signal the designer needs. 172's finding applies: report VOLUME is the risk, so
    group and summarise — but never drop.

16. **Repair scoping consumes Phase 174's retained LINE-LEVEL evidence, not just the boolean stale
    flag.** Phase 176 needs to know WHAT to re-check, not merely THAT a chunk is stale. The attributed
    per-chunk deltas (via 174's `quoted-fragment` / `cited-page` attribution ladder) are the input that
    makes repair scoped rather than wholesale.

17. **The impact map lives in the RUN-SCOPED LEDGER**, reusing 173/174's atomic append +
    resume mechanism and its exported helpers. There must remain exactly one atomic write path
    (`173-REVIEW.md` CR-01's defect class); a new standalone artifact would need its own durability and
    resume story, both already solved.

### Decisions added 2026-07-30 after research (closing its two open questions)

18. **The marker is its OWN `##` heading in CHUNK.md**, mirroring `## Verified Against`'s precedent
    exactly, and it participates in the required-heading parse list. Research measured that this is what
    the templates and existing parsers already make natural; a bare adjacent line would be the only
    machine-owned state in the file not carried by a heading.

    Research also measured the registration surface decision 5 warned about, and it is LARGER than the
    parse contract alone: **3 sites enumerate the Status enum** (`state-machine.md`, plus inline comments
    in both `CHUNK.template.md` and `SKETCH.template.md`) and **2 test sites pin them**
    (`templates.test.ts`, `build-chunk.test.ts`). The orthogonal-marker decision (decision 1) is what
    keeps this cheap: because rules-staleness is NOT an enum value, **none of those 5 sites should
    change.** If a plan finds itself editing the Status enum or its pinning tests, decision 1 has been
    violated somewhere upstream — treat that as the signal, not as expected work.

19. **`/bs-check-status` gains a rules-staleness item in THIS phase.** Phase 174 explicitly carried this
    forward with the words "revisit there, not here" (174-CONTEXT deferred section), and deferring it a
    second time would make that note a permanent excuse. It is the natural reporting home for decision
    15's stale-fraction line, and it is the surface a designer actually reads.

### Research findings that constrain the plan (measured, not assumed)

- **`RULINGS.md` is 100% human/skill-authored today — zero code writes it**, confirmed by grep; only
  `trace-check.ts` READS it. Decision 7's append is therefore the FIRST machine write into a
  human-authored corpus. Reuse the existing informal 3-field shape (Decision / Citation / Rationale) and
  do not invent structured supersession syntax: only ~3 of 62 real rulings across both games use a
  supersede verb at all, and one of those is direction-reversed.
- **`## Verified Against` today has NO timestamp and NO "no code change" signal.** Decision 11's
  re-verification stamp needs a genuinely new label in `VERIFIED_AGAINST_LABELS` — and specifically NOT
  a reuse of `SCOPE_REASONS`, which encodes a different concept (why a verification was scope-limited,
  not whether code moved).
- **`verify-game.md`'s Step 3 currently asserts it "flips no staleness marker anywhere and opens no
  repair loop (that is Phase 175's job)".** This phase makes that false and must rewrite it IN PLACE —
  the identical class of fix Phase 174 (174-05) had to make to Phase 173's boundary statements. Phase
  170 proved self-contradicting skill text gets half-followed on a live run.
- **The real `contradictory` proof material was RESCUED at this gate**, not left in scratch: it lived
  only in `${TMPDIR}174-07-proof/` (323MB, uncommitted, clearable at any moment) and is now committed at
  `175-FIXTURES/174-07-contradictory/` — raw dispatch prompts, raw subagent returns with
  `lineFindings[]`, the final status JSON, both run ledgers, and the pass-2 staged slices, with per-file
  sha256s in its `MANIFEST.md`. **VERIFY-04's gate can therefore be proven against a real
  `contradictory` verdict without re-mutating a PDF.** The mutated PDF itself is not archived; its
  sha256 is recorded for traceability and `174-PROOF.md` §5 documents how to regenerate it.

### Claude's Discretion

- The marker's exact string, provided it is unmistakably distinct from `stale — re-derive before build`,
  is registered per decision 5, and is test-pinned.
- Module boundaries and file placement within `src/cli/commands/` and `src/cli/slash-command/bs/`.
- Human-readable report grouping and formatting for the staleness and adjudication surfaces.
- Which existing `bs-` skill step hosts the gate, provided VERIFY-04's "always" holds.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/verify-classify.ts` (Phase 174) — the verdicts, `chunkVerdicts[]`, the attribution
  ladder, and the `warnings` convention this phase consumes. **Do not re-derive staleness here**; 174
  computes it (`deriveStale` is deliberately single-argument so provenance can never leak in).
- `src/cli/commands/verify-run.ts` (Phase 173, exports widened in 174-02) — `atomicWriteFile`,
  `appendLedgerLine`, `locateFences`, `parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`,
  `readLedgerOrThrow`. Reuse for decision 17; never a second write path.
- `src/cli/commands/drift-check.ts` (Phase 172, CHECK-05) — decision 10's authority for code movement.
- `src/cli/commands/chunk-provenance.ts` (Phase 171) — the `## Verified Against` machine-owned fenced
  region pattern (decision 2) and the re-verification stamp decision 11 needs. Note `f73153a3`:
  locate sections BY LINE, not by first substring match.

### Established Patterns
- Commands register in `src/cli/cli.ts`, one file per command in `src/cli/commands/` with a colocated
  `*.test.ts`. `process.exitCode = 1` rather than throwing.
- Enumerated code sets are frozen-array + derived-type + pinning test (`FINDING_KINDS`,
  `PRESENTATION_LEXICON`, and Phase 174's `PROVENANCE_KINDS`/`RULE_DELTA_KINDS`). Never a hand-written
  union.
- Findings exit 0; non-zero is reserved for tool failure (172 decision 6).

### Integration Points
- `src/cli/slash-command/bs/state-machine.md` — "Status Enum", "Authority", "Write Order", and the
  "Cold-Resume Parse Contract" whose recognized set decision 5 must extend. Cite these sections from
  skill text rather than restating them, as every `bs-` skill already does.
- `src/cli/slash-command/bs/verify-game.md` — the router that gains the adjudication gate and the
  staleness-write step. Phase 174 already rewrote its no-classification boundary statements; this phase
  extends the same file and must not leave a stale boundary claim behind it either.
- `src/cli/slash-command/bs/templates/CHUNK.template.md` and `SKETCH.template.md` — the marker's
  home and its derived reflection.
- `/bs-check-status` reports verification drift; the deferred item from Phase 174 (surfacing
  classification verdicts there) was explicitly routed to THIS phase's reporting surface — revisit it
  here rather than deferring again.
- Phase 176 consumes this phase's impact map and line-level deltas. Design the `--json` for that
  consumer.

### Cross-repo proof targets
- `~/BoardSmithGames/seven` — READ-ONLY, pinned at `a03f38d4792af9dfc7c798be69686fc3230f54dd`.
  16 citing chunks, 6 rules-stale under 174's final attribution.
- `~/BoardSmithGames/one-two-punch` — 11 citing chunks, 6 rules-stale, and the game carrying the real
  `contradictory` finding 174-07 produced by mutating its archived source. That finding is the natural
  live exhibit for VERIFY-04's gate.
- `.planning/phases/174-verify-classifier/174-FIXTURES/` — archived real live+staged slices, sha256
  manifest, and 7 lexicon regression pairs.
</code_context>

<specifics>
## Specific Ideas

- **The real `contradictory` finding already exists.** Phase 174-07 mutated `one-two-punch`'s archived
  `rules.pdf` (rasterize + composite a real rendered patch reversing Fight-phase timing precedence) and
  classified it `contradictory` / `stale:true` / `provenance:source-changed`. VERIFY-04's gate can be
  proven against that real verdict rather than a synthetic one — reuse it.
- **Anchor density is a known input property, not a surprise to rediscover.** 6/16 and 6/11 chunks
  rules-stale from one finding each. VERIFY-06's scoping is what makes that tolerable: if most of those
  6 pass the lenses with no code change, they close without re-playtesting and the human cost stays
  near zero. That relationship is worth measuring in this phase's proof — it is the practical payoff of
  174's finding.
- **Proof bar is unchanged from 171-174:** real runs against `cp -R` copies, measured counts never "ran
  clean", originals confirmed byte-identical before and after, and a `175-PROOF.md` following
  `173-PROOF.md`/`174-PROOF.md`'s structure.
- The `verified (user-waived)` + rules-stale + code-changed path (decision 13) may not occur naturally
  in either reference game. If it does not, prove it structurally and SAY it was structural — do not
  claim a live proof that did not happen.

</specifics>

<deferred>
## Deferred / Carried In

Carried in and still open:
- **F-3** (`170-PROOF-RUN-2.md`) — ownership of `boardsmith.json`'s stub `description`/`playtime` after
  `init`. Still not this phase's work.
- `/bs-build-chunk` Step 0's `ingest-check` call has still never been exercised by a live session.
- **No native Task/Agent-tool dispatch anywhere in this milestone** — every "real dispatch" in Phases
  173/174 used a `claude -p` OS subprocess (a genuine process boundary, no inherited history) because no
  internal Task tool was exposed to the executors. Honest equivalent, still unproven under native
  dispatch. Carried, not resolved.
- **SC-2's evidence base is thin** — 10/11 pooled line-level findings across two 2-page rulebooks.
  Adequate for Phase 174's bar; too thin to support strong new claims. Do not compound it.
- **Anchor density** — see decision 15 and the specifics above.

Deferred out of this phase:
- Performing the repair, ruling re-validation, and the audit lenses (CHECK-01, CHECK-02) — Phase 176.
- `Derived`-line re-derivation (CHECK-04) — Phase 177.
- Worked-example replay (CHECK-06) — Phase 178.
- Source-free MODE assembly (VERIFY-09) — Phase 179.

Standing policy from 170 (recorded in STATE.md): **the ingest harness may inform, and must never again
gate whether a manual pass is run.**
</deferred>
