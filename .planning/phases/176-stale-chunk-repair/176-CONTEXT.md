# Phase 176: Stale-Chunk Repair - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning
**Requirements:** CHECK-01, CHECK-02
**Mode:** Smart discuss (autonomous) — four grey areas presented in batch, all accepted by the user
2026-07-30 with no overrides.

<domain>
## Phase Boundary

Every stale chunk gets re-checked against the composite source of truth (fresh transcription +
`RULINGS.md`) through the same audit lenses the build pipeline already trusts.

In scope:
- CHECK-01 — ruling re-validation: every `RULINGS.md` entry re-checked against the fresh
  transcription and reported as still-needed / resolved-by-source / contradicted, respecting
  supersession chains.
- CHECK-02 — the three audit lenses (fidelity, visibility, undo) run per stale chunk against raw
  slices plus `RULINGS.md`, feeding the existing bounded repair loop.
- SC-3's specific target: `seven`'s Ruling 1 — the designer-supplied scoring table for a card absent
  from the rulebook PDF — produces a defensible verdict.

Out of scope:
- **Deciding WHICH chunks are stale** — Phase 175 produced the impact map and its per-chunk
  line-level deltas. This phase consumes that set; it does not re-derive staleness or re-classify.
- **The contradictory human gate** (VERIFY-04) and the staleness markers (VERIFY-05) — Phase 175.
- **Derived-line re-derivation** (CHECK-04) — Phase 177.
- **Worked-example replay** (CHECK-06) — Phase 178.
- **Source-free MODE assembly** (VERIFY-09) — Phase 179. This phase reports scope-limited when the
  fresh transcription is missing; it does not invent a mode flag.
- **Fixing the findings surfaced on the reference games** — the same boundary Phase 172 held. This
  phase reports; it does not repair reference-game content.
</domain>

<decisions>
## Implementation Decisions

### The sort

| Req | Sort | Why |
|---|---|---|
| CHECK-01 | **Judgment** (verdict) + mechanical (enumeration, recording) | Deciding whether a fresh transcription resolves or contradicts a ruling is semantic comparison — the same shape as Phase 174's classifier. Enumerating `RULINGS.md` entries and recording verdicts is mechanical. |
| CHECK-02 | **Reuse** — neither new judgment nor new mechanism | The three lenses already exist as fresh-context dispatch templates in `build/audit.md`, and the bounded repair loop already exists in `build/repair.md`. This phase routes stale chunks into them. |

### Area 1 — Ruling re-validation verdicts (accepted 2026-07-30)

1. **The verdict set is FOUR, not three: `still-needed` | `resolved-by-source` | `contradicted` |
   `undetermined`.** The roadmap names three; `undetermined` is added for the case where the
   comparison genuinely cannot be made. This is the same first-class-blindness principle the milestone
   has now applied five times (172's `drift-unknown`, PROV-03's `unknown` scope, 174's `unclassified`,
   174's `unknown` provenance, 175's `unknown-drift`). Forcing a fourth case into one of the three
   would report a verdict where the tool is blind.

2. **Judgment lives in a subagent; the CLI enumerates and records.** Same split as Phase 174's
   classifier: the subagent reads the ruling and the fresh transcription and returns ONE enumerated
   verdict plus evidence; every consequence is computed in code. The orchestrator never reads a slice.

3. **Supersession: parse only EXPLICIT supersede verbs, handle both directions, and REPORT what
   cannot be parsed.** Phase 172 measured this corpus directly: only ~3 of 62 rulings across both
   games state supersession in parseable form, and one of those is direction-reversed
   (`SUPERSEDED BY RULING 9` sits on Ruling 3's own entry). The other cross-reference verbs found in
   the data — "reconciles", "extends", "UPHOLDS", "resolves OQ-N" — are NOT supersession and must not
   be read as such; treating them as chains would manufacture false verdicts. A superseded ruling is
   not demanded to be still-needed. Where a chain cannot be parsed, report it rather than assume it.

4. **A ruling whose citation records a SOURCE ABSENCE re-validates as `still-needed` unless the fresh
   transcription now CONTAINS the missing content. Absence of evidence is not `resolved`.**

   This is the rule SC-3 exists to test, and `seven`'s Ruling 1 is the case: it supplies a complete
   scoring table for a "Ways to Score" card that is **absent from the rulebook PDF entirely** — its
   own Citation field says so ("The rulebook names this card and depends on it for all scoring, but
   never reproduces its face"), and its Rationale says it is "the sole authority for scoring values".
   A fresh transcription of the same PDF will still not contain that card.

   Two wrong answers are both available and both plausible-looking: `contradicted` (the checker cannot
   find it in source) and `resolved-by-source` (no gap detected). Either would be catastrophic — this
   ruling is the only scoring authority `seven` has, and `resolved` would invite deleting it. The
   correct verdict is `still-needed`, and the reasoning must be recorded, not just the label.

### Area 2 — Audit lens re-run (accepted 2026-07-30)

5. **Only the rules-stale set from Phase 175's impact map is re-audited** — not every chunk. Scoping
   is what Phase 175 bought; ignoring it here would discard it.

6. **The three lens dispatch templates are REUSED VERBATIM**, parameterized by slice paths — never
   forked into verify-specific variants. This is the same discipline Phase 173 held for the
   transcription subagent contract ("it is never forked here"). A forked lens is a lens that can drift
   from the build pipeline's behavior, and the phase goal is explicitly "the same audit lenses the
   build pipeline already trusts."

7. **The 4th (design-review) lens follows the EXISTING build rule exactly** — it runs for
   `ui: touches|major` chunks, as `build/audit.md` already specifies. No new policy is invented here in
   either direction.

8. **The bounded repair loop is inherited UNCHANGED**: maximum 3 audit rounds per chunk, findings
   append-only across rounds, and round-3 user triage for anything unresolved (`build/repair.md`). A
   verify pass does not get its own looser bound — a second bound would be a second policy that can
   disagree with the first.

### Area 3 — The composite source of truth (accepted 2026-07-30)

9. **The lenses read the FRESH STAGED transcription**, not the live pass-1 slices. The staged
   transcription is what this verify pass produced and what staleness was computed against; auditing
   against pass-1 slices would re-check the code against the very text the pass just called into
   question.

10. **If the fresh transcription is unavailable, report SCOPE-LIMITED following PROV-02's pattern —
    never silently fall back to live slices.** A silent fallback would produce a full-looking audit
    from partial inputs, which is exactly what PROV-02 exists to prevent. The source-free MODE is Phase
    179's to assemble; this phase only reports honestly when its input is missing.

11. **`## Interpretation` remains absolutely forbidden to the lenses.** This is `build/audit.md`'s own
    no-framing rule and the reason audit can catch upstream interpretation errors at all: if
    `investigate`/`redteam` baked an error into `## Interpretation`, a lens that reads it inherits the
    same error and can never catch it. Rules-staleness makes this MORE important, not less — a stale
    chunk's `## Interpretation` was written against rules that have since moved.

12. **Repair MAY change code, and that explicitly feeds Phase 175's VERIFY-06 gate**: a chunk whose
    code changes during repair re-opens the human playtest gate; a chunk that passes the lenses
    unchanged closes without re-playtesting. State this linkage in the skill text rather than leaving
    it implicit — it is the seam between the two phases.

### Area 4 — Proof (accepted 2026-07-30)

13. **SC-3 is proven live against `seven`'s Ruling 1**, with the verdict AND its reasoning recorded —
    not just the label. See decision 4 for why this specific ruling is the highest-consequence target.

14. **All ~62 rulings across both reference games are re-validated**, with full measured counts per
    verdict. Not a sample: the verdict distribution across a real corpus is the evidence that the
    classifier is neither over- nor under-flagging, and a subset cannot show that.

15. **The lens re-run is proven on a REAL MEASURED SUBSET of the 12 stale chunks, with coverage stated
    explicitly.** Three lenses × 12 chunks = 36 fresh-context dispatches is genuinely expensive. Run a
    real subset, and say exactly which chunks were audited and which were not — never imply full
    coverage. An unstated sample reads as a complete run.

16. **Record actual finding counts; do NOT fix reference-game content.** Same boundary Phase 172 held
    ("the checks report; nothing in this phase fixes reference-game content"). Expect real findings —
    172 surfaced substantial genuine gaps on these same games.

### Claude's Discretion

- Module boundaries and file placement within `src/cli/commands/` and `src/cli/slash-command/bs/`.
- The ruling-verdict record's exact shape, provided its verdicts are a test-pinned enumerated set and
  it reuses the single atomic ledger write path.
- Human-readable report grouping. Note 172's finding that report VOLUME is the real risk here: ~62
  rulings plus lens findings across 12 chunks is a lot of output.
- Which stale chunks form the proof subset, provided decision 15's coverage statement is explicit.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/slash-command/bs/build/audit.md` — the three lens dispatch templates, the "Three Lenses,
  Each a Separate Fresh-Context Dispatch" rule, and the no-`## Interpretation` framing rule. **Reuse
  verbatim (decision 6).** It already reads `RULINGS.md` alongside raw slices and already cites
  `state-machine.md` "Rulings Outrank Rulebook" for the composite-source-of-truth rule this phase's
  goal names.
- `src/cli/slash-command/bs/build/repair.md` — the bounded loop: max 3 audit rounds, FIX-or-defer per
  finding, append-only round entries, round-3 user triage, and the `{audit, repair}` session-step
  group that loops without a handoff. **Inherited unchanged (decision 8).**
- `src/cli/commands/build-manifest.ts` — `parseRulings`, the EXISTING exported ruling parser. Phase
  175-03 already reused it for `nextRulingNumber` under a grep gate forbidding a second
  `Ruling (\d+)` regex. Reuse it again; do not add a third parse path.
- `src/cli/commands/verify-impact.ts` (Phase 175) — the impact map and `chunkVerdicts[]`/line-level
  deltas that identify WHICH chunks are stale and WHAT changed in each. Decision 5's input.
- `src/cli/commands/verify-run.ts` — the exported atomic ledger helpers. Exactly ONE atomic write path
  must remain in the repo (`173-REVIEW.md` CR-01's defect class).
- `src/cli/commands/trace-check.ts` (Phase 172) — already READS `RULINGS.md` and knows the ruling
  shape; its supersession findings (decision 3) were measured there.

### Established Patterns
- Enumerated code sets are frozen-array + derived-type + pinning test.
- Findings exit 0; non-zero reserved for tool failure (172 decision 6).
- Skill text cites `state-machine.md` sections rather than restating them.
- CLI computes, skill formats `--json` (PROV-03's split, held since Phase 171).

### Integration Points
- `src/cli/slash-command/bs/verify-game.md` — now a six-step router after Phase 175. This phase adds
  the repair routing. **Check for boundary statements this phase makes false** — Phase 173's, 174's,
  and 175's all had to be rewritten in place, and the same class of stale prose has bitten this
  milestone three times.
- Phase 175's `verify-impact-*` commands supply the stale set; design this phase's input around their
  `--json`, not around a re-derivation.

### Cross-repo proof targets
- `~/BoardSmithGames/seven` — READ-ONLY, pinned at `a03f38d4792af9dfc7c798be69686fc3230f54dd`.
  Carries **Ruling 1**, SC-3's target, plus the `⚠ RATIONALE SUPERSEDED BY RULING 9` marker on Ruling
  3 that is direction-reversed (decision 3).
- `~/BoardSmithGames/one-two-punch` — pinned at `7e69471bd8980a854f3e351f2f486e1fb6f712b9`, 26 rulings.
- Phase 175's stale sets: `seven` 6/16, `one-two-punch` 6/11 — 12 stale chunks total, decision 15's
  population.
</code_context>

<specifics>
## Specific Ideas

- **Ruling 1 is the phase's sharpest test and its most dangerous failure mode.** It is the sole scoring
  authority for `seven`; a `resolved-by-source` verdict would invite deleting the only rules the game
  has for reaching an outcome. Get this one right and record the reasoning.
- **`seven`'s Ruling 3 carries `⚠ RATIONALE SUPERSEDED BY RULING 9` on its own entry** — the
  direction-reversed supersession 172 measured. It is a natural second proof case for decision 3's
  both-directions handling.
- **Report volume is the real risk** (172's finding, repeated): ~62 ruling verdicts plus lens findings
  across up to 12 chunks. Group and summarise; never truncate.
- **Expect real findings.** 172 surfaced substantial genuine gaps on these same games. A clean run here
  would be more suspicious than a noisy one — and per decision 16, nothing in this phase fixes them.
- **Proof bar unchanged from 171–175:** real runs against `cp -R` copies, measured counts never "ran
  clean", originals confirmed byte-identical, and a `176-PROOF.md` following the established structure.

</specifics>

<deferred>
## Deferred / Carried In

Carried in and still open:
- **F-3** (`170-PROOF-RUN-2.md`) — `boardsmith.json` stub field ownership after `init`.
- `/bs-build-chunk` Step 0's `ingest-check` call has still never been exercised by a live session.
- **No native Task/Agent-tool dispatch anywhere in this milestone** — every "real dispatch" in Phases
  173–175 used a `claude -p` OS subprocess (a genuine process boundary, no inherited history). Honest
  equivalent, still unproven under native dispatch. **This phase dispatches audit lenses, so the same
  caveat applies to them.**
- **Anchor density** (Phase 174) — the stale set is broader than ideal on short, cross-referenced
  rulebooks. This phase inherits that set.
- **VERIFY-06's payoff is NOT DEMONSTRATED** (Phase 175, `175-PROOF.md` §5): only 1 of 12 real stale
  chunks closes without re-playtesting; 11 of 12 re-open because their code genuinely drifted for
  reasons unrelated to the rules finding (`unknown-drift` measured 0, not the anticipated cause). The
  scoping MECHANISM is proven correct; its practical saving on these two games is small. This phase's
  repair loop feeds that same gate — expect most repaired chunks to re-open it.
- **SC-2's thin evidence base** (Phase 174) — 10/11 pooled line-level findings across two 2-page
  rulebooks. Do not compound it.

Deferred out of this phase:
- CHECK-04 derived-line re-derivation — Phase 177.
- CHECK-06 worked-example replay — Phase 178.
- VERIFY-09 source-free mode assembly — Phase 179.
- Fixing any finding this phase surfaces on the reference games.

Standing policy from 170 (recorded in STATE.md): **the ingest harness may inform, and must never again
gate whether a manual pass is run.**
</deferred>
