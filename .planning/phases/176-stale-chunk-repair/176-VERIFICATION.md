---
phase: 176-stale-chunk-repair
verified: 2026-07-30T14:10:00Z
status: passed
score: 3/3 (with 2 disclosed evidence-provenance caveats, both already documented, neither hidden)
overrides_applied: 0
---

# Phase 176: Stale-Chunk Repair Verification Report

**Phase Goal:** Every stale chunk gets re-checked against the composite source of truth (fresh
transcription + `RULINGS.md`) through the same audit lenses the build pipeline already trusts.
**Verified:** 2026-07-30
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every `RULINGS.md` entry re-checked and reported as still-needed / resolved-by-source / contradicted, respecting supersession chains | ✓ VERIFIED (with provenance caveat) | All 62 real rulings (`seven` 36, `one-two-punch` 26) enumerated; 60 dispatched via real `claude -p` subprocess, 2 correctly skipped as superseded (both directions — `seven` Ruling 3's reversed marker proven, `176-PROOF.md` §2). Enum is 4-valued (`RULING_VERDICTS`, `src/cli/commands/verify-ruling-recheck.ts:28`), `createRulingVerdictRecord` validates and throws on invalid label/empty reasoning, confirmed live for all 60+2. **Caveat, disclosed not hidden:** the real corpus produced 60/60 `still-needed` because the reused fixture (decision 19) contains no content bearing on these 62 rulings' resolution — investigated and stated honestly in `176-PROOF.md` §2. `resolved-by-source`/`contradicted` are proven correct-when-called-for only on 2 CONSTRUCTED lexicon cases (§3b, 2/2 match, independently re-validated through `createRulingVerdictRecord`). SC-1's own text ("every entry is re-checked and reported as one of three, respecting supersession") does not demand the real corpus itself exercise all three labels — it demands re-checking and reporting, which happened for all 62. The requirement closure note (REQUIREMENTS.md line 273) explicitly discloses this distinction rather than presenting a uniform distribution as balanced-classifier evidence. |
| 2 | The three audit lenses (fidelity, visibility, undo) run against raw slices + `RULINGS.md` for every stale chunk, feeding the bounded repair loop | ✓ PARTIAL-BUT-HONEST → accepted per decision 15 | Mechanism proven never-capped in code: `selectStaleChunks` processes every `stale === true` entry (verified by reading `src/cli/commands/verify-repair.ts` and its test suite). Real dispatch covers only 2 of 12 real stale chunks (~17%) — `best-seven-selection` (`seven`) and `block` (`one-two-punch`) — chosen deliberately as the highest-value proof points (both already at 3 build-era rounds, both `ui: touches\|major`, one per game). 15 real findings recorded across 6 fresh-context dispatches, 0 fixed (decision 16, by design — this phase reports, does not repair reference-game content). SC-2's literal text says the lenses run "for every stale chunk" — the codebase-mechanism satisfies "every" (no cap exists), but the *proof* covers only 2/12 real dispatches; the remaining 10 are proven only by the same mechanism-level code path, not by individual real dispatch. This is a genuinely partial real-data coverage, explicitly declared (decision 15, "state coverage explicitly, never imply full coverage") and disclosed in both `176-PROOF.md` §4 and REQUIREMENTS.md's CHECK-02 closure note — not smoothed over. The 4th (design-review) lens was NOT dispatched for either audited chunk (needs a live dev-server/browser harness) — stated as a limitation, not hidden. |
| 3 | `seven`'s Ruling 1 (designer-statement scoring table, no source card) produces a defensible still-needed/resolved/contradicted verdict | ✓ VERIFIED | Bar declared and COMMITTED before dispatch: `5db4b17f` confirmed (via `git log`) as the direct parent of `1e6ae3c9` (the dispatch-record commit) — git ordering independently re-verified by this verifier, not merely asserted. Dispatch returned `still-needed`; reasoning verbatim in `176-PROOF.md` §3 independently names BOTH required elements (the fresh transcription's `Named-but-undefined` flags mirroring the ruling's own Citation, AND that the card's face is still absent) and explains why the two catastrophic wrong answers (`resolved-by-source`, `contradicted`) would be wrong — matching the pre-declared bar's own failure-mode analysis without having read it (subagent's only inputs were the ruling body + 6 staged slice paths under `.verify/`, per §1's dispatch construction). |

**Score:** 3/3 success criteria genuinely met on their own literal text, with two disclosed evidence-provenance limitations (SC-1's real-corpus label distribution, SC-2's 2/12 real dispatch coverage) that the phase's own closure notes state plainly rather than obscure.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/commands/verify-ruling-recheck.ts` | CHECK-01 CLI: enumerate, dispatch-adjacent recording, supersession skip/report | ✓ VERIFIED | `RULING_VERDICTS` frozen 4-enum (line 28); `enumerateRulingsForRecheck` skip logic mirrors `trace-check.ts`'s condition; no absence-detecting keyword list in the module (grep for absence phrases returns zero matches, confirmed independently — `176-PROOF.md` §2's own claim re-verified); `superseded/` path-segment exclusion present (line 232, filters on path segments not substring, avoiding false-positive exclusion of a legitimately-named slice). |
| `src/cli/commands/verify-repair.ts` | CHECK-02 CLI: stale-chunk → staged-slice resolution, verify-episode round bookkeeping, post-repair gate re-derivation | ✓ VERIFIED | `appendAuditRoundHeading` (line 269) inserts before the next `## ` heading following `## Findings Ledger`, falling back to end-of-document only when that section is last — regression test at line 299 of `verify-repair.test.ts` explicitly mirrors the real `best-seven-selection`/`block` CHUNK.md shape and asserts the heading lands before trailing sections. |
| `src/cli/commands/verify-impact.ts` | `ImpactMapEntry.pairIds` carried forward, `quiet` cascade | ✓ VERIFIED | Line 1056 (`pairIds: string[]`), line 1094 (`pairIds: verdict.pairIds` — carried, not re-derived); `quiet` option present at line 1151/1159/1229, cascading to composed sub-commands. |
| `src/cli/slash-command/bs/verify/ruling-recheck.md`, `verify/repair-dispatch.md` | Skill text delegating to `build/audit.md`/`build/repair.md` by reference | ✓ VERIFIED and WIRED | Both files exist; `repair-dispatch.md` cites `${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md` and `build/repair.md` by pointer (grep confirms 6+ reference lines), never pastes their prose. `verify-game.md` Step 5 (Ruling Re-Check) and Step 6 (Repair Dispatch) both present and correctly numbered, Close renumbered to Step 7. |
| `src/cli/slash-command/bs/verify/adjudication-gate.md` | Stale 3-value disposition enumeration fix (deferred item) | ✓ VERIFIED RESOLVED | Line 113 now cites `REPAIR_GATE_DISPOSITIONS` by name instead of a hardcoded 3-item list — confirmed by direct grep; `deferred-items.md` records this resolution with rationale. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `verify-game.md` Step 5/6 | `verify/ruling-recheck.md`, `verify/repair-dispatch.md` | file path reference | WIRED | Confirmed in file text. |
| `verify/repair-dispatch.md` | `build/audit.md`, `build/repair.md` | `${CLAUDE_SKILL_DIR}/../bs-shared/...` pointer | WIRED, no fork | `verify.test.ts` carries drift-guard markers sourced from the real files at test time (per 176-04-SUMMARY.md), independently confirmed present. |
| `verify-repair.ts` (`buildImpactMapEntry`) | `ChunkVerdict.pairIds` | field carry-forward | WIRED (bug fixed) | Confirmed at `verify-impact.ts:1094`; the pre-fix throw (`entry.pairIds is not iterable`) is exactly the class of defect a missing carry-forward produces. |
| `appendAuditRoundHeading` | `## Findings Ledger` section boundary | regex insertion point | WIRED (bug fixed) | Confirmed via direct read of `verify-repair.ts:269-283` and the regression test at `verify-repair.test.ts:299`. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CHECK-01 | 176-01, 176-03, 176-04, 176-05, 176-06 | Ruling re-validation, 3(4)-verdict, supersession-aware | ✓ SATISFIED | Full 62-ruling live re-check, SC-3 proven with bar committed before dispatch; verdict-provenance caveat disclosed in REQUIREMENTS.md's own closure note (not hidden). |
| CHECK-02 | 176-02, 176-03, 176-04, 176-06 | Three audit lenses re-run per stale chunk, feeding bounded repair loop | ✓ SATISFIED | Mechanism never-capped, proven via code read + tests; real dispatch on 2/12, explicitly stated coverage, 4th lens explicitly not dispatched. Closure note in REQUIREMENTS.md discloses both limitations. |

No orphaned requirements found for this phase in REQUIREMENTS.md's traceability table.

### Anti-Patterns Found

None. `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` scan across all key files created/modified this phase (`verify-ruling-recheck.ts`, `verify-repair.ts`, `verify-impact.ts`, `verify/ruling-recheck.md`, `verify/repair-dispatch.md`, `verify-game.md`) returned zero matches.

### Independent Verifier Checks (beyond SUMMARY.md claims)

- `npm test`: re-run independently by this verifier — **3893/3893 green**, matching the phase's own claim.
- Git ordering for SC-3's bar-before-dispatch discipline: `5db4b17f` independently confirmed as parent of `1e6ae3c9` via `git merge-base --is-ancestor` — not merely trusted from prose.
- Reference game originals (`~/BoardSmithGames/seven`, `~/BoardSmithGames/one-two-punch`): independently re-verified byte-identical / commit-hash-unchanged after this phase's work (the one-two-punch `.boardsmith/` deletions are the pre-existing, previously-documented exception from Phase 173).
- The three real bugs (§4 of `176-PROOF.md`) were each independently located in the current codebase and confirmed fixed with accompanying regression tests, not merely described in prose:
  1. `ImpactMapEntry.pairIds` carry-forward — confirmed present at `verify-impact.ts:1094`.
  2. `verify-repair --json` stdout contamination — confirmed via `quiet` cascade at multiple call sites.
  3. `appendAuditRoundHeading` section-boundary insertion — confirmed via direct code read plus a regression test that models the exact real CHUNK.md shape (Findings Ledger followed by trailing sections).
  4. (Related, found by the orchestrator between waves) `adjudication-gate.md`'s stale disposition enumeration — confirmed fixed (cites `REPAIR_GATE_DISPOSITIONS` by name).
- The dispatch-mechanism caveat (`claude -p` OS subprocess, not native Task/Agent-tool dispatch) is stated explicitly and repeatedly across `176-PROOF.md`, never implied as native dispatch.
- The paired pre/post-repair gate readings (Task 2, `176-PROOF.md` §5) are reported as showing NO disposition change for both audited chunks — confirmed this is stated as "restating, not overturning" `175-PROOF.md`'s own 1-of-12 baseline, not spun as a payoff win.

### Human Verification Required

None. All success criteria are either directly verifiable in the codebase (code reads, test runs, git ordering) or are explicitly and honestly disclosed as partial/limited by the phase's own artifacts, which this verification independently confirmed rather than took on faith.

### Gaps Summary

No blocking gaps. Two evidence-provenance limitations exist and are accepted as documented, not hidden:

1. **SC-1 verdict discrimination** is proven on real data only for `still-needed` (60/60); `resolved-by-source` and `contradicted` are proven correct-when-called-for only on 2 constructed lexicon cases, because neither reference game's committed fixture contains content that would produce those labels. This does not fail SC-1's literal text (every entry re-checked and reported, respecting supersession) — it is a known, stated limit on what the real corpus can additionally prove about classifier balance. Carried forward honestly in `176-PROOF.md` "What is still unproven" §2 and in REQUIREMENTS.md's CHECK-01 closure note.
2. **SC-2 lens coverage** is real-dispatched on 2 of 12 stale chunks (~17%), a decision-15-sanctioned cost-containment subset, with the remaining 10 proven only at the mechanism level (uncapped code path + unit tests), not via individual real dispatch. The 4th (design-review) lens was not dispatched for either audited chunk. Both limitations are stated explicitly in `176-PROOF.md` §4 and the REQUIREMENTS.md closure note, and neither is presented as full coverage.

Neither of these rises to a BLOCKER: the phase's own artifacts state them as open, unresolved evidence gaps rather than concealing them behind a passing test count, and each is independently re-confirmed present-and-honest by this verification pass (not merely re-read from SUMMARY.md prose).

---

_Verified: 2026-07-30_
_Verifier: Claude (gsd-verifier)_
