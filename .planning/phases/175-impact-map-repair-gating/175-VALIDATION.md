---
phase: 175
slug: impact-map-repair-gating
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-30
---

# Phase 175 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `175-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (already configured) |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npx vitest run src/cli/commands/verify-impact.test.ts` |
| **Full suite command** | `npm test` (3706/3706 green at Phase 174's close) |
| **Estimated runtime** | quick ~5s · full suite ~3–5 min |

---

## Sampling Rate

- **After every task commit:** `npx vitest run` on the file(s) touched
- **After every plan wave:** `npm test` — any new failure is this phase's own regression
- **Before `/gsd:verify-work`:** Full suite green **AND** a real `cp -R`-copy proof run against both
  reference games recorded in `175-PROOF.md`, matching Phases 171–174 exactly
- **Max feedback latency:** ~10 seconds for unit-level work

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| VERIFY-04 | A `contradictory` verdict halts the pass BEFORE any staleness write; both readings formatted side by side; resolution recorded in `RULINGS.md` | unit + skill-text pin | `npx vitest run src/cli/commands/verify-impact.test.ts -t "contradictory"` | ❌ W0 | ⬜ pending |
| VERIFY-04 | A deferred/aborted adjudication records `UNADJUDICATED` and still marks affected chunks stale — never silently clean | unit | `... -t "unadjudicated"` | ❌ W0 | ⬜ pending |
| VERIFY-04 | No bypass is representable — no flag/env/arg skips the gate | source assertion + skill-text pin | `... -t "no-bypass"` | ❌ W0 | ⬜ pending |
| VERIFY-05 | Chunks with `ChunkVerdict.stale === true` get the marker written CHUNK.md first, SKETCH.md second, `Status:` line last | unit (fixture CHUNK/SKETCH pairs) | `... -t "marker"` | ❌ W0 | ⬜ pending |
| VERIFY-05 | The new marker is registered in the Cold-Resume Parse Contract's recognized set; a project carrying one still passes every `bs-` consistency check | unit + skill-text pin | `... -t "parse-contract"` | ❌ W0 | ⬜ pending |
| VERIFY-05 | **The Status enum and its 5 enumerating/pinning sites are UNCHANGED** (decision 1's orthogonality guard — if these move, orthogonality was violated) | negative source assertion | `npx vitest run src/cli/slash-command/bs/templates.test.ts` | ✅ extend | ⬜ pending |
| VERIFY-06 | Code changed (per `drift-check`) → status `built`, marker cleared, playtest gate re-opened | unit | `... -t "repair-gate"` | ❌ W0 | ⬜ pending |
| VERIFY-06 | Code unchanged → keeps `verified`, marker cleared, `## Verified Against` re-verification stamp with the new no-code-change label | unit | `... -t "no-code-change"` | ❌ W0 | ⬜ pending |
| VERIFY-06 | `verified (user-waived)` + stale + code changed → gate RE-OPENS (no auto-re-waive) | unit | `... -t "waived-reopen"` | ❌ W0 | ⬜ pending |
| decision 16 | Repair scoping receives per-chunk line-level deltas, not just the stale boolean | unit | `... -t "line-level-handoff"` | ❌ W0 | ⬜ pending |
| decision 19 | `/bs-check-status` reports the rules-stale count and fraction, uncapped | unit | `npx vitest run src/cli/slash-command/bs/status-tools.test.ts` | ✅ extend | ⬜ pending |
| Cross-cutting | No self-contradicting boundary statement left in `verify-game.md` (Step 3's "flips no staleness marker" becomes false) | skill-text pin, old text asserted ABSENT | `npx vitest run src/cli/slash-command/bs/verify.test.ts` | ✅ extend | ⬜ pending |
| Cross-cutting | Real proof against `cp -R` copies of both reference games, originals byte-identical before/after | manual/scripted proof run | recorded in `175-PROOF.md` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] **Rescue the real `contradictory` proof material from OS scratch** — DONE at the research gate,
      ahead of planning, because `${TMPDIR}174-07-proof/` (323MB, uncommitted) was clearable at any
      moment. Now committed at `175-FIXTURES/174-07-contradictory/` with per-file sha256s: raw dispatch
      prompts, raw subagent returns including `lineFindings[]`, final status JSON, both run ledgers, and
      the pass-2 staged slices. **VERIFY-04's gate can be proven against a real `contradictory` verdict
      without re-mutating a PDF.**
- [ ] `src/cli/commands/verify-impact.ts` + colocated `verify-impact.test.ts` — do not exist; this
      phase's entire mechanical surface.
- [ ] A new label in `VERIFIED_AGAINST_LABELS` for decision 11's re-verification-with-no-code-change
      stamp. Must NOT reuse `SCOPE_REASONS` — different concept (why scope was limited vs. whether code
      moved).
- [ ] Registration of the new marker in `state-machine.md`'s Cold-Resume Parse Contract recognized set,
      landing in the SAME change as the marker itself.
- [ ] No new test-framework install — Vitest is already configured and used identically by every
      sibling command this phase extends.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| The human adjudication gate actually stops a live pass | VERIFY-04 | The property is about a live session halting and asking; no unit test can observe a skill-text gate firing | Run a real verify pass against a `cp -R` copy carrying the archived `contradictory` verdict; confirm the pass stops before any staleness write, both readings are shown side by side, and the resolution lands in `RULINGS.md` append-only. |
| Real staleness write across two files | VERIFY-05 | Requires a real project tree with real CHUNK.md/SKETCH.md pairs | Real run against `cp -R` copies; confirm write order, authority, and that a cold resume still parses. Confirm originals byte-identical. |
| Repair-gate scoping payoff | VERIFY-06 | The practical value is a human-effort measurement, not a code assertion | On the real stale sets (6/16 `seven`, 6/11 `one-two-punch`), measure how many chunks pass the lenses with NO code change and therefore close without re-playtesting. This is the measured payoff of Phase 174's anchor-density finding. |
| `verified (user-waived)` + stale + code-changed | VERIFY-06 | May not occur naturally in either reference game | If it does not occur live, prove it structurally and SAY it was structural — do not claim a live proof that did not happen. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s for unit work
- [ ] Status enum and its 5 enumerating/pinning sites confirmed unchanged
- [ ] `175-PROOF.md` records the real-run proof with measured counts
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
