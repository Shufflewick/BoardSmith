---
phase: 177
slug: derived-line-re-derivation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-30
---

# Phase 177 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `177-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.0 (pre-existing) |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` |
| **Full suite command** | `npm test` (3893/3893 green at Phase 176's close) |
| **Estimated runtime** | quick ~5s · full suite ~3–5 min |

---

## Sampling Rate

- **After every task commit:** the relevant unit test file(s)
- **After every plan wave:** `npm test` — any new failure is this phase's own regression
- **Before `/gsd:verify-work`:** Full suite green **AND** `177-PROOF.md` recording the real
  dispatch proofs that cannot be expressed as deterministic assertions
- **Max feedback latency:** ~10 seconds for unit work

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| decision 13 | `PRESENTATION_EXCLUSION_MARKERS` matches a dash-qualifier carrying a parenthetical; pinned by the **4 real slipping lines** (`(Plan phase)`, `(Fight phase)`, `(first Punch example)`, `(second Punch example)`) — not invented cases | unit | `npx vitest run src/cli/commands/verify-classify.test.ts -t "presentation"` | ✅ extend | ⬜ pending |
| decision 13 | The widened constant does not newly exclude any line it should keep — `seven`'s 10 `Derived` lines and one-two-punch's 6 unqualified ones stay rule-bearing | unit (negative) | `... -t "presentation"` | ✅ extend | ⬜ pending |
| CHECK-04 | Verdict enum frozen-array + derived-type + pinning test: `agrees \| disagrees \| underivable \| not-rule-bearing` | unit | `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` | ❌ W0 | ⬜ pending |
| CHECK-04 | `underivable` is reachable and never collapses into `agrees` or `disagrees` | unit | `... -t "underivable"` | ❌ W0 | ⬜ pending |
| CHECK-04 · SC-1 | **The blind-derive payload contains quote lines ONLY — zero `Derived (p.` and zero `Visual (p.` lines** (decision 5's structural independence) | unit + real-prompt grep | `... -t "blind"` and `177-PROOF.md` | ❌ W0 | ⬜ pending |
| CHECK-04 · SC-1 | Live slices are the target (decision 12) — NOT Phase 176's `resolveFreshTranscription`, which resolves staged | unit (source assertion) | `... -t "live"` | ❌ W0 | ⬜ pending |
| CHECK-04 · SC-2 | A disagreement finding cites **both derivations verbatim** | unit | `... -t "both-derivations"` | ❌ W0 | ⬜ pending |
| CHECK-04 · SC-3 | Runs with no source rulebook present; source-free **by construction** — no code path opens the archived PDF | unit (source assertion) | `... -t "source-free"` | ❌ W0 | ⬜ pending |
| CHECK-04 · SC-3 | `Visual` lines ignored as out of scope | unit | `... -t "visual"` | ❌ W0 | ⬜ pending |
| decision 2 | Rule-bearingness is subagent judgment — **no keyword/phrase list in code** | source assertion (grep) | `... -t "no-phrase-list"` | ❌ W0 | ⬜ pending |
| decision 7 | Two distinct dispatch-token contracts; COMPARE reads the derivation from a recorded artifact rather than deriving again | unit | `... -t "two-step"` | ❌ W0 | ⬜ pending |
| decision 14 | Project-level, no `--run-id` scope | unit (source assertion) | `... -t "project-level"` | ❌ W0 | ⬜ pending |
| decision 15 | Findings exit 0; non-zero reserved for tool failure | unit | `... -t "exit"` | ❌ W0 | ⬜ pending |
| Cross-cutting | **Context-Economics carve-out**: `verify-game.md`'s hard rule gains an explicit exception for the DERIVE dispatch prompt (which legitimately carries quote lines), mirroring 174's `quotedPass1`/`quotedPass2` precedent | skill-text pin | `npx vitest run src/cli/slash-command/bs/verify.test.ts` | ✅ extend | ⬜ pending |
| Cross-cutting | 176-04's step-contiguity, no-hardcoded-count, and no-fork drift guards stay true | drift guards | same file | ✅ extend | ⬜ pending |
| CHECK-04 | Real full-corpus run: 22 `Derived` lines, ~44 dispatches, measured distribution | integration (real dispatch) | recorded in `177-PROOF.md` | ❌ proof-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/commands/verify-derive-recheck.ts` + colocated `verify-derive-recheck.test.ts` — new;
      the phase's entire mechanical surface.
- [ ] Two subagent contracts under `src/cli/slash-command/bs/verify/` — a blind DERIVE contract and a
      separate COMPARE contract, with distinct dispatch tokens.
- [ ] `verify-classify.test.ts` — extend for decision 13's widened constant, pinned by the 4 real
      slipping lines AND a negative case proving nothing new is wrongly excluded.
- [ ] `verify.test.ts` — extend with the Context-Economics carve-out pin.
- [ ] `install-claude-command.ts` — leaf probes for both new contracts, proven by a real install.
- [x] **Live slices** — already present; both reference games at their pinned commits, 22 `Derived`
      lines measured directly. No fixture production needed (contrast Phase 174, which had to produce
      its own).
- [ ] Framework install: none — Vitest already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Structural independence of the blind derivation | SC-1 / decision 5 | The property is about what a real dispatch prompt CONTAINS; only inspecting a real prompt proves it | Grep the raw DERIVE prompt from a real run for `Derived (p.` and `Visual (p.` — expect **zero**. Mirror `173-PROOF.md` §3 / `174-PROOF.md` §3's transcript-observable method. **Grep it; do not assert it.** A derivation that saw the original is a confirmation, not a second opinion, and would report high agreement regardless of whether the originals were sound. |
| Full-corpus distribution | CHECK-04 / decision 9 | 22 real lines × 2 dispatches of subagent judgment | Run all 22; record measured counts per verdict. **Commit the predicted distribution BEFORE dispatching** (decision 10) so git ordering shows it was not retrofitted. |
| A mass-`underivable` result | decision 11 | Interpretation, not assertion | If most lines come back `underivable`, report it as a real finding about the ingest contract — quote lines don't carry what derivations used. **Do not relax decision 5's independence to make things derive.** Research warns this share is likely substantial: several `Derived` lines' only support is *another* `Derived` line, making them underivable by construction. |
| Uniform-result scepticism | — | Phase 176's precedent | A uniform distribution in EITHER direction proves consistency, not discrimination (176's corpus returned 60/60 one verdict). Label it honestly if it occurs. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s for unit work
- [ ] `177-PROOF.md` records the predicted-before-measured distribution, the real counts, and the
      grepped independence observable
- [ ] Findings reported, NOT fixed on reference-game slice content
- [ ] Dispatch mechanism stated honestly (`claude -p` subprocess vs native Task-tool)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
