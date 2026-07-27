# Phase 170 Plan Check — Ingest Contract Upgrade (final re-verification)

## PLAN CHECK PASSED

**Plans checked:** 4 (170-01, 170-02, 170-03 revised, 170-04 revised)
**Issues:** 0 blocker(s), 2 warning(s) — non-blocking, recorded for the record

All three rounds of blockers are now closed. The unconditional-reconciliation fix is applied
consistently everywhere it needed to land, and I could not construct a state in which a broken or
partially-broken `openGaps[]` transport yields a passing checkpoint. The residual risks I did find
both point in the *safe* direction (false FAIL, not false PASS) and are recoverable by the human
operator at the blocking checkpoint itself — they do not threaten the phase goal, so they are
recorded as warnings rather than blockers.

---

### 1. Is the reconciliation now unconditional everywhere, with no surviving threshold language?

Yes, confirmed in all five places:
1. `170-03-PLAN.md` `must_haves.truths` (line 17) — "a `## Open Rules Gaps` section whose entry
   count equals the `Named-but-undefined` marker count in the produced slices — proving `openGaps[]`
   transports every gap, not merely some."
2. Task 2 item (e) body — "run the reconciliation — always, for any entry count, never only when
   the count looks low," with an explicit line warning against reintroducing a threshold gate "as an
   optimisation."
3. Task 2 `acceptance_criteria` — "(e) reconciliation is run UNCONDITIONALLY, for whatever the entry
   count turns out to be — never gated on the count looking low."
4. Plan-level `<verification>` — "reconciled unconditionally against the slices' `Named-but-undefined`
   marker total — the two numbers are equal and both are recorded."
5. Plan-level `<success_criteria>` — "entry count matches the slices' `Named-but-undefined` marker
   count exactly."

No conditional/threshold language survives in any of the five. Task 3's evidence-record instructions
and Plan 04 Task 3's INGEST-03 circularity check were also updated to require both numbers quoted and
stated equal, with an explicit statement that both `_None._` and any mismatch would have failed the
checkpoint. Consistent throughout.

### 2. Is there any remaining state where a broken/partial transport passes?

I tried to construct one and could not. Considered and ruled out:
- **Coincidental count cancellation** (transport drops one gap, orchestrator duplicates a different
  one, net count unchanged): theoretically possible but requires two independent, compounding bugs
  at once with no corroborating evidence anywhere else in the run; not a realistic silent-pass path
  given the design, and no plan text creates an incentive for it.
- **Multi-marker-per-line undercount** (a slice line carries two `Named-but-undefined` markers,
  `grep -c` counts it as one line): this pushes the mismatch in the section-exceeds-slice direction,
  which the plan already treats as a FAIL ("orchestrator inventing entries") — it produces a false
  FAIL, not a false PASS.
- **Cross-slice duplicate topic** (the same undefined rule named in two different page-range slices,
  each subagent marks it independently): same direction — if the orchestrator sensibly deduplicates
  the designer-facing section, section count would be *lower* than the raw slice-side grep sum,
  which the plan flags as "transport is silently DROPPING gaps" — again a false FAIL, not a silent
  pass on a real drop.

No state was found where a genuinely broken transport (real gaps present in slices, never reaching
the section) produces matching numbers. The equality check appears to genuinely close the hole
identified in the prior round.

### 3. Does the slice-side `grep -c` count the same thing the section-side count does?

Not always — this is the plan's one soft spot, and it cuts toward false FAIL, not false PASS (see
warnings below). Two scenarios can make the two numbers disagree even when the transport is working
correctly:
- Multiple markers on one physical slice line (grep -c undercounts vs. the true marker count).
- The same named-but-undefined rule marked independently in two different page-range slices — if
  the orchestrator (reasonably, though not explicitly instructed either way) merges the two into one
  designer-facing entry, section count will legitimately be lower than the raw grep sum.

Neither scenario is confirmed to occur on `seven`'s actual 2-page rulebook — RESEARCH.md's captured
pre-phase gap list (4 distinct topics: "Ways to Score" card contents, "The 7 scoring hands," Bonus
point card value, Run example discrepancy) shows no obvious cross-slice duplication in the existing
shape, and a small 2-page PDF likely fans out to few, non-overlapping subagents. So this is a
plausible-but-unconfirmed edge case, not a demonstrated defect in this specific run's expected data.

### 4. Anything the edit broke or newly introduced?

Only the item flagged in (3) above — a latent ambiguity about whether the assembled `## Open Rules
Gaps` section is expected to deduplicate a rule named-but-undefined in more than one slice. This
ambiguity existed before this round's edit too (Plan 02's Task 1(d) instruction, "assembled
exclusively from the accumulated `openGaps[]` lists," was never explicit about deduplication either
way); tightening item (e) to require *exact* equality is what turns that pre-existing ambiguity into
a potential checkpoint friction point, where none existed before it was an exact-match rule. Nothing
else in the diffed sections (Plan 03 Task 2/3, Plan 04 Task 3) introduces a new problem — the edits
are otherwise clean, scoped, and internally consistent.

---

### Warnings (non-blocking, recommended before or shortly after execution)

**1. [verification_derivation] Reconciliation equality has no stated handling for a legitimate cross-slice duplicate**

- Plan: 170-02 (Task 1d's assembly instruction) / 170-03 (Task 2 item (e))
- Description: If `seven`'s fresh re-transcription happens to mark the same undefined rule in two
  different slices, and the orchestrator merges them into one designer-facing entry (a sensible
  choice, never explicitly forbidden or required by the skill text), the reconciliation's "any
  mismatch is a FAIL, no exceptions" wording would tell the operator to treat a working transport as
  broken. This is a false-FAIL risk, not a false-PASS risk, so it does not compromise the phase's
  correctness guarantee — but it could waste an execution cycle or, per the coordinator's own framing,
  tempt a future editor to "fix" the friction by loosening the check in the wrong way.
- Fix (optional, low-cost): Add one sentence to Plan 02 Task 1(d) making the concatenation behavior
  explicit either way — e.g. "list every `openGaps[]` entry returned, one per subagent report, even
  if the same rule name recurs across slices; do not deduplicate" — which keeps the raw-count
  equality check meaningful with no exceptions needed. This can be folded in during Plan 02's own
  execution/PROC-02 pass rather than requiring another plan-check cycle.

**2. [verification_derivation] Multi-marker-per-line is unhandled but currently improbable**

- Plan: 170-03, Task 2 item (e)
- Description: `grep -c` counts matching *lines*, not marker occurrences; if a subagent ever wrote
  two `Named-but-undefined (p.N):` markers on one physical line (contrary to the established
  one-marker-per-line convention every existing prefix in `transcription.md` follows), the slice-side
  count would undercount relative to the section's true entry count, again producing a false FAIL
  rather than a false PASS.
- Fix: No action required — the existing one-marker-per-line convention (matching `variants[]`'s
  established pattern) makes this vanishingly unlikely, and it fails safe. Recorded for completeness
  only.

---

### Recommendation

No blockers remain. Both warnings are optional hardening, fail in the safe direction (block
approval rather than let a broken transport through), and do not need to be resolved before
execution. Routing to execution.
