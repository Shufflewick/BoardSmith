---
phase: 177-derived-line-re-derivation
verified: 2026-07-30T18:30:00Z
status: gaps_found
score: 2/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Every rule-bearing Derived line is re-derived independently, using only quote lines present in the current slice, and the report correctly names WHICH candidate fact is under test (SC-1)."
    status: failed
    reason: "The phase's own live-dispatch proof (177-07, 29 real claude -p dispatches) empirically shows the 'independent of original transcription' half is MET (structural, proven by grep — zero leaks on the real 16-candidate corpus), but the 'per-line judgment' half is NOT MET: buildBlindDerivePayload's `Target line: {slicePath}:{lineNumber}` identifier carries no locatable meaning inside the quote-only payload, so every multi-candidate slice in the real corpus collapses to re-deriving the same dominant fact regardless of nominal target. This is not a hedge or a documentation gap — it is a structural defect in the shipped module, proven on real data and left unfixed (fix is explicitly out of scope for the proof-only plan 177-07)."
    artifacts:
      - path: "src/cli/commands/verify-derive-recheck.ts"
        issue: "buildBlindDerivePayload (lines 349-362) emits `Target line: ${entry.slicePath}:${entry.lineNumber}` — a raw line number from the ORIGINAL file with no meaning inside the quote-only payload (quoteLinesOnly strips every Derived/Visual line and does not renumber or mark position). Confirmed by direct read; matches 177-PROOF.md §3/§4 and CR-07."
    missing:
      - "A redesign of the dispatch payload's target-identification mechanism so the blind subagent can locate which candidate fact is under test without being handed a resolvable pointer to the withheld line (per CR-07's fix direction: an opaque handle mapped back by the orchestrator, quote-local narrowing, or a redacted-but-positioned marker)."
  - truth: "The blind-payload strip filter (quoteLinesOnly) and the candidate enumerator (enumerateDerivedLines) never let a Derived/Visual line reach the blind subagent or get silently dropped from the candidate set, regardless of markdown decoration."
    status: failed
    reason: "DERIVED_LINE_RE/VISUAL_LINE_RE/NAMED_BUT_UNDEFINED_LINE_RE are ^-anchored against the trimmed line (verify-derive-recheck.ts:227-237), so a blockquote- or list-decorated Derived/Visual line (`> Derived (p.1): ...`, `- Derived (p.1): ...`) is neither stripped from the blind payload (leak) nor enumerated as a candidate (silent drop). This is not hypothetical — the live corpus already contains blockquote-decorated annotation lines of the same family (174-FIXTURES/seven/live/01-overview-setup-and-play.md:30, `> Variant (p.1): ...`). CR-01 in 177-REVIEW.md proved this by direct execution against a temp project. Code review postdates and is consistent with the current module state (verified by direct read on 2026-07-30, module unchanged since review)."
    artifacts:
      - path: "src/cli/commands/verify-derive-recheck.ts"
        issue: "Lines 227-237, 256-268, 301-326: strip and enumerate regexes are ^-anchored on trimmed text with no tolerance for leading markdown decoration."
    missing:
      - "A shared decoration-stripping helper (annotationBody) used by both quoteLinesOnly and enumerateDerivedLines, plus a payload-level backstop that throws if the assembled blind payload matches /Derived \\(p\\.|Visual \\(p\\.|Named-but-undefined \\(p\\./, per CR-01's fix."
  - truth: "A recorded verdict can actually be written end-to-end (CHECK-04 has a functioning write surface, not just a read-only report)."
    status: failed
    reason: "cli.ts registers exactly one CHECK-04 command (`verify-derive-recheck`, the read-only report — confirmed at cli.ts:421, no second command registered). recordDeriveVerdicts/createDeriveVerdictRecord have zero non-test callers anywhere in the repo (grep confirms only prose references in verify-game.md:180 and derive-compare.md:110). verify-game.md Step 7 instructs the orchestrator to record through recordDeriveVerdicts, but no callable CLI surface exists for it — every sibling check (verify-classify-record, verify-ruling-recheck's recording path) ships a write command; this one does not. This is CR-05, confirmed unfixed by direct code read."
    artifacts:
      - path: "src/cli/cli.ts"
        issue: "Only `.command('verify-derive-recheck')` registered (line 421); no verify-derive-record or equivalent write command exists."
    missing:
      - "A registered CLI write command (e.g. verify-derive-record) routing through createDeriveVerdictRecord, matching the pattern every sibling check uses."
deferred: []
human_verification: []
---

# Phase 177: Derived-Line Re-Derivation Verification Report

**Phase Goal:** "Rule-bearing inferences get an independent second opinion, separate from the presentation notes the Phase 170 split now keeps out of the way."
**Verified:** 2026-07-30T18:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Adjudicating the tension between 177-07's proof and 177-REVIEW.md's CR-01

**Verdict: (a) — 177-07's zero-leak proof is real but narrower than claimed. It is incidental to the tested corpus, not a structural guarantee, and CR-01 is not refuted by it.**

Evidence:

- 177-07's §2 proof grepped all 16 real dispatched blind prompts for `Derived (p.`/`Visual (p.` and found zero matches. This grep is real (not asserted) and its result is accurate **for the corpus that was actually dispatched**.
- Both reference games' live `Derived`/`Visual` lines are, as a matter of fact, all bare/line-initial (`Derived (p.N): ...`, no blockquote or list decoration) — confirmed by 177-06-PROOF.md §1's enumeration output and by CR-01's own note that "today's two fixture games happen to carry no decorated `Derived` line."
- Direct read of the current module (`src/cli/commands/verify-derive-recheck.ts:227-237`, unchanged since the 2026-07-30T18:20 review — the review commit and the module's last commit both predate this verification) confirms `DERIVED_LINE_RE`/`VISUAL_LINE_RE`/`NAMED_BUT_UNDEFINED_LINE_RE` are `^`-anchored against `line.trim()`, with no decoration-tolerant helper anywhere in the file.
- The live corpus already contains blockquote-decorated annotation lines of the *same family* elsewhere in the project's own fixtures (`174-FIXTURES/seven/live/01-overview-setup-and-play.md:30`, `> Variant (p.1): ...`), proving the decoration shape is not hypothetical — it is a real transcription pattern this ingest pipeline produces, just not (yet, in these two games) on a `Derived`/`Visual` line specifically.
- Therefore: the zero-leak result is true, but it is a fact about the two reference games' current content, not a proven property of `buildBlindDerivePayload`. The guarantee 177-CONTEXT.md decision 5 demands ("Independence must be structural: the original line is not in the dispatch payload at all") is NOT structural as shipped — it is defeated by ordinary markdown decoration the moment such a line exists. 177-07 did not claim otherwise in its own text about CR-01 (it doesn't mention CR-01 at all, since the review ran after 177-07 committed), but the phase's overall closure narrative — "the blind-independence structural guarantee ... is proven" (177-07-SUMMARY.md key-decisions) — overstates what was actually proven if read without the review's qualification.

This is reported here as an independent finding (CR-01, reproduced above as a gap) rather than folded silently into SC-1's already-acknowledged NOT MET status, because it is a distinct failure mode from the target-identification gap 177-07 found: CR-01 is about payload construction correctness (a leak/drop bug), not about targeting ambiguity within an otherwise-correct payload.

## Goal Achievement

The phase goal promises rule-bearing inferences get an "independent second opinion." Three things must be true for that to hold: (1) the payload construction is genuinely independent (never leaks the original, never silently drops a candidate), (2) the "opinion" is actually about the right fact (per-line targeting), and (3) an opinion can actually be recorded end-to-end. All three are currently broken in the shipped code, per direct evidence below — consistent with the phase's own honest self-report (CHECK-04 left OPEN/PARTIAL, ROADMAP Phase 177 checkbox unchecked, "Goal NOT MET" noted against plan 177-07).

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Presentation-note exclusion is mechanical and correctly widened to tolerate parenthetical qualifiers (decision 13's fix). | ✓ VERIFIED | `PRESENTATION_EXCLUSION_MARKERS` in `verify-classify.ts:93-97` widened; pinned by tests against the 4 real slipping lines named in 177-CONTEXT.md decision 13; `npm test` green. (WR-09 notes a residual asymmetry between the `Derived` and `Visual` marker forms — a warning-level gap, not a blocker, since no real `Visual` line exists in either corpus to exercise it.) |
| 2 | Findings that report a disagreement cite both derivations verbatim (SC-2). | ✓ VERIFIED | `createDeriveVerdictRecord` throws on a `disagrees` record missing `originalReading`/`rederivedReading` (verify-derive-recheck.ts:107-120); 177-PROOF.md §3/§4 shows 9/9 real `disagrees` records this run carry both fields, no throw occurred. |
| 3 | The check runs with no source rulebook present and correctly ignores `Visual` lines (SC-3). | ✓ VERIFIED (source-freeness structural, `Visual`-ignoring proven only on constructed input) | `readLiveSlices` reads only `rulebook/*.md`; no function joins `projectDir` with `rulebook/source` (direct code read). `Visual`-ignoring proven correct-when-called-for on unit tests only — zero real `Visual (p.` lines exist in either reference game (177-PROOF.md §4, matching Phase 174/176's own disclosed limitation for the same gap). |
| 4 | The blind-derivation payload is structurally incapable of leaking, or silently dropping, a `Derived`/`Visual` line regardless of markdown decoration. | ✗ FAILED | `DERIVED_LINE_RE`/`VISUAL_LINE_RE`/`NAMED_BUT_UNDEFINED_LINE_RE` are `^`-anchored on trimmed text (verify-derive-recheck.ts:227-237); blockquote/list-decorated lines leak into the payload AND are dropped from enumeration. Proven by direct execution in 177-REVIEW.md CR-01; module unchanged since. The corpus this proof ran against happens not to trigger it — see tension adjudication above. |
| 5 | Every rule-bearing `Derived` line is re-derived independently AND the report correctly identifies which candidate fact the re-derivation actually targeted (SC-1, full text). | ✗ FAILED | Structural "never sees the original" half MET (real grep, zero leaks on tested corpus). Per-line targeting half NOT MET — real dispatch data: every multi-candidate slice collapses to the same dominant re-derived fact regardless of nominal target (177-PROOF.md §3/§4, CR-07). This is the phase's own headline finding, self-reported. |
| 6 | A verdict can be recorded end-to-end through a callable surface (not just constructed in a test). | ✗ FAILED | `cli.ts` registers only the read-only `verify-derive-recheck` report command (line 421). `recordDeriveVerdicts`/`createDeriveVerdictRecord` have zero non-test callers repo-wide. CR-05, confirmed unfixed by direct code read. |

**Score:** 3/6 truths verified (2 fully verified must-haves scored above use the 5-item frontmatter grouping — see gaps section for the 3 failing items grouped as 3 must-haves).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/commands/verify-derive-recheck.ts` | CHECK-04's mechanical core: enum, ledger, payload builder, enumerator, report command | ⚠️ EXISTS, SUBSTANTIVE, BUT STRUCTURALLY DEFECTIVE | File exists, is wired into the CLI and tests pass (35/35), but CR-01/CR-02/CR-03/CR-04/CR-05/CR-06/CR-07 are all confirmed live in the shipped code (four proven by direct execution in the review; two — CR-05, CR-01 — independently re-confirmed by this verification's own direct code read). |
| `src/cli/slash-command/bs/verify/derive-recheck.md` | Blind-derivation subagent contract | ✓ VERIFIED (installed, exists) | Present, installed in both reference games per 177-06-PROOF.md §1; WR-08 notes the contract text misdescribes who strips the payload (info-level doc drift, not a blocker). |
| `src/cli/slash-command/bs/verify/derive-compare.md` | Comparison subagent contract | ✓ VERIFIED (installed, exists) | Present, installed, exercised in 13 real dispatches per 177-PROOF.md §3. |
| CLI write command for recording a verdict | A `verify-derive-record`-shaped command | ✗ MISSING | No such command registered anywhere in `cli.ts`. This is CR-05 and it is the single clearest "task complete, goal not achieved" gap in this phase: the report command works, but nothing can ever populate it outside a test harness. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `verify-game.md` Step 7 | `recordDeriveVerdicts` | prose instruction ("recorded through recordDeriveVerdicts's one atomic ledger write") | ✗ NOT_WIRED | The skill text names a function with no CLI-callable surface. An orchestrator following the documented instruction has no command to invoke. (CR-05) |
| `enumerateDerivedLines` candidates | `buildBlindDerivePayload` | direct function call, CLI-driven enumeration → dispatch | ⚠️ PARTIAL | Wired mechanically, but the payload's `Target line` field does not carry usable targeting information downstream to the dispatched subagent (CR-07 / SC-1 gap). |
| `readDeriveVerdicts` (ledger read) | report findings | direct call, no revalidation | ⚠️ PARTIAL (unwired validation) | Read path bypasses `createDeriveVerdictRecord`'s validation choke point (CR-02) — not this phase's headline gap but confirms the "single choke point" claim in the module's own header comment is inaccurate. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CHECK-04 | 177-01 through 177-07 (all plans declare `requirements: [CHECK-04]`) | Derived-line re-derivation — independent second opinion, findings cite both derivations, source-free, ignores Visual lines | ✗ BLOCKED (phase's own self-report agrees) | `.planning/REQUIREMENTS.md:215-235` correctly marks CHECK-04 `[ ]` PARTIAL/OPEN, citing `177-PROOF.md` §§2-4 with an accurate SC-1 NOT MET / SC-2 MET / SC-3 MET breakdown. No orphaned requirements — CHECK-04 is the only ID this phase claims, and it's the only one REQUIREMENTS.md maps to Phase 177. |

No orphaned requirements found for this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/cli/commands/verify-derive-recheck.ts` | 227-237 | `^`-anchored strip/enumerate regexes, no decoration tolerance | 🛑 Blocker | CR-01 — leak + silent-drop, proven live |
| `src/cli/commands/verify-derive-recheck.ts` | 414-436 | Unvalidated `JSON.parse` on ledger read | ⚠️ Warning | CR-02 — bypasses stated single validation choke point |
| `src/cli/commands/verify-derive-recheck.ts` | 505-535 | Join by `slicePath:lineNumber` only, `originalLine` never compared | ⚠️ Warning | CR-03 — stale-record false-confirmation risk (not exercised in the real corpus, since no line was edited mid-run, but present in shipped code) |
| `src/cli/commands/verify-derive-recheck.ts` | 368-406 | `reasoning` free-prose not screened for the ledger's own fence markers | ⚠️ Warning | CR-04 — ledger corruption is model-input-reachable |
| `src/cli/cli.ts` | 416-430 | Only the read-only report command registered | 🛑 Blocker | CR-05 — no write surface, CHECK-04 cannot complete end-to-end from a real caller |
| `src/cli/commands/verify-derive-recheck.ts` | 391-406 | `recordDeriveVerdicts` replaces the whole ledger | ⚠️ Warning | CR-06 — the documented per-line call pattern is destructive |
| `src/cli/commands/verify-derive-recheck.ts` | 354-361 | Payload emits resolvable `Slice:`/`Target line:` pointing at the withheld line | ⚠️ Warning | CR-07 — independence is one tool call away from collapsing (compounds the SC-1 targeting gap) |

No unreferenced `TBD`/`FIXME`/`XXX` markers found in the phase's modified files.

### Human Verification Required

None. Every gap here is independently confirmed by direct code read and/or the phase's own live-dispatch proof — no visual, real-time, or external-service behavior is in question.

### Gaps Summary

The phase's own plan 177-07 already reported the goal NOT MET, and that self-report is correct and consistent with the codebase: `buildBlindDerivePayload`'s targeting mechanism cannot tell a multi-candidate blind subagent which fact is under test, so most `disagrees` verdicts in the real 16-candidate corpus are targeting-collapse artifacts, not genuine content disagreements. This verification confirms that finding and adds two more, both proven by direct code read and consistent with `177-REVIEW.md`'s empirically-executed findings:

1. **CR-05 (no write surface):** even setting the targeting gap aside, CHECK-04 cannot be operated end-to-end today. The only registered CLI command is the read-only report; nothing can populate a verdict outside a test file. `verify-game.md`'s own Step 7 instructions describe a call pattern (`recordDeriveVerdicts`) that has no callable CLI entry point.
2. **CR-01 (leak/drop on decorated lines):** the blind-independence guarantee 177-CONTEXT.md decision 5 requires to be "structural, not by instruction" is in fact defeated by ordinary blockquote/list markdown decoration — proven by direct execution against a temp project, and the decoration shape is not hypothetical (it already exists in this project's own fixture corpus, just not yet on a `Derived`/`Visual` line). 177-07's zero-leak proof is real but incidental to the two reference games' current content, not a structural property of the shipped module.

Both of these were surfaced by the code review that ran *after* 177-07 committed its proof and phase closeout; this verification independently re-confirmed both by direct code read (module unchanged since the review) rather than trusting the review's own SUMMARY-adjacent claims. Combined with 177-07's own targeting-gap finding, three of five must-haves fail. The phase produced substantial real, working infrastructure (enumeration, the report command, the two subagent contracts, mechanical presentation exclusion) and ran a genuinely honest 29-dispatch live proof — but the phase goal ("rule-bearing inferences get an independent second opinion") is not achieved: the second opinion, when it exists, frequently targets the wrong fact, cannot currently be recorded through any callable surface, and the independence guarantee itself is not yet decoration-proof.

This matches the phase's own ROADMAP/REQUIREMENTS.md disposition (checkbox unchecked, CHECK-04 left OPEN/PARTIAL) — this verification does not contradict the phase's self-report, it corroborates it and adds two further blockers (CR-01, CR-05) the phase's own proof did not have visibility into at the time it closed, since the code review ran afterward.

---

_Verified: 2026-07-30T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
