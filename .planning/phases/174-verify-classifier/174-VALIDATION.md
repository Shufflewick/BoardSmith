---
phase: 174
slug: verify-classifier
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-29
---

# Phase 174 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `174-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | repo-root `vitest.config.ts` (existing, unchanged by this phase) |
| **Quick run command** | `npx vitest run src/cli/commands/verify-classify.test.ts` |
| **Full suite command** | `npm test` (3611/3611 green at Phase 173 close) |
| **Estimated runtime** | quick ~5s · full suite ~3–5 min |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/cli/commands/verify-classify.test.ts`
- **After every plan wave:** `npm test`
- **Before `/gsd:verify-work`:** Full suite green **AND** the SC-2 numeric bar (≥90% `cosmetic`,
  zero `contradictory`) recorded in `174-PROOF.md`. Per CONTEXT.md decision 14 this bar is a
  **BLOCKER**, not an optional nicety.
- **Max feedback latency:** ~10 seconds for unit-level work

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| VERIFY-03 (pairing) | Live↔staged pairing by page-span overlap; m:n groups normal; one-sided span → `unpaired-slice` | unit | `npx vitest run src/cli/commands/verify-classify.test.ts -t "pairing"` | ❌ W0 | ⬜ pending |
| VERIFY-03 (provenance) | `source-changed`/`source-unchanged`/`unknown` from hash compare; `unknown` never collapsed | unit | `... -t "provenance"` | ❌ W0 | ⬜ pending |
| VERIFY-03 (staleness map) | `cosmetic`→false; `sharper`/`contradictory`/`unclassified`→true; **provenance never an input** | unit | `... -t "staleness"` | ❌ W0 | ⬜ pending |
| VERIFY-03 (presentation filter) | Both `Visual (p.N):` and legacy `Derived (p.N) — diagram description:`/`— art:` excluded; enum test-pinned | unit | `... -t "presentation"` | ❌ W0 | ⬜ pending |
| VERIFY-03 (ledger record/resume) | Records append via the SAME atomic write; resume skips already-classified pairs | unit | `... -t "ledger"` | ❌ W0 | ⬜ pending |
| VERIFY-03 (malformed return) | Non-enum/missing label → `unclassified` → stale; never thrown, never `cosmetic` | unit | `... -t "unclassified"` | ❌ W0 | ⬜ pending |
| VERIFY-03 · SC-2 | ≥90% of real pairs `cosmetic`, zero `contradictory` | integration (real run) | real `cp -R` copy proof, recorded in `174-PROOF.md` | ❌ W0/W1 | ⬜ pending |
| VERIFY-03 · SC-3 | Genuine injected rules change → `sharper`/`contradictory` | integration (real run) | real archived-source mutation + re-transcription dispatch | ❌ W0/W1 | ⬜ pending |
| VERIFY-07 (classification half) | Zero slice-body-shaped lines across orchestrator transcript, raw dispatch prompt, raw subagent return | live proof (grep) | mirror `173-PROOF.md` §3 SC-3 method | ❌ W0 | ⬜ pending |
| VERIFY-01 (verdict half) | A real run produces a per-chunk verdict without rebuilding | integration (real run) | recorded in `174-PROOF.md` | ❌ W0 | ⬜ pending |
| Determinism (decision 16) | Same pair set classified twice → identical verdicts | integration | ad hoc harness, mirroring `173-PROOF.md` §5 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/commands/verify-classify.test.ts` — does not exist; covers every unit-level row above.
- [ ] **Real pass-1-vs-pass-2 fixture data — does not exist anywhere on disk.** A first wave must
      produce it via a real adoption + re-transcription run against `cp -R` copies (anchor: `seven`;
      second target: `one-two-punch`) before any SC-2/SC-3/SC-5 proof can run. This is the phase's
      hardest Wave 0 dependency, not a test-file gap.
- [ ] `src/cli/slash-command/bs/verify/classification-dispatch.md` — new delegate, does not exist.
- [ ] Classification subagent contract — new; must carry the Visual/Derived schema-asymmetry
      exclusion rule as an explicit worked example, since no existing contract covers this ground.
- [ ] Export the module-private ledger helpers from `verify-run.ts` (`atomicWriteFile`,
      `appendLedgerLine`, `locateFences`, `parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`,
      `readLedgerOrThrow`) — reuse means exporting, never copying.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Orchestrator never opens a slice | VERIFY-07 | The property is about a live session's transcript, which no unit test can observe | Run a real classification pass; grep the orchestrator transcript, the raw dispatch prompt, and the raw subagent return for slice-body-shaped lines (quoted rule line, `Derived (p.`, `Visual (p.`). Expect zero. Mirror `173-PROOF.md` §3. |
| SC-2 / SC-3 real-data bars | VERIFY-03 | Requires a real LLM classification pass over real re-transcribed slices; the verdicts are the thing under test | Real run against `cp -R` copies; record measured counts (never "ran clean") in `174-PROOF.md`. Confirm originals byte-identical before/after. |
| Determinism | decision 16 | Requires two real LLM passes | Classify the same pair set twice; diff the verdict sets; record the comparison. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (including the real-fixture dependency)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s for unit work
- [ ] SC-2 numeric bar recorded in `174-PROOF.md`
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
