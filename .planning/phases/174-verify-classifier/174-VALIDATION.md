---
phase: 174
slug: verify-classifier
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| VERIFY-03 (pairing) | Live↔staged pairing by page-span overlap; m:n groups normal; one-sided span → `unpaired-slice` | unit | `npx vitest run src/cli/commands/verify-classify.test.ts -t "pairing"` | ✅ | ✅ green |
| VERIFY-03 (provenance) | `source-changed`/`source-unchanged`/`unknown` from hash compare; `unknown` never collapsed | unit | `... -t "provenance"` | ✅ | ✅ green |
| VERIFY-03 (staleness map) | `cosmetic`→false; `sharper`/`contradictory`/`unclassified`→true; **provenance never an input** | unit | `... -t "staleness"` | ✅ | ✅ green |
| VERIFY-03 (presentation filter) | Both `Visual (p.N):` and legacy `Derived (p.N) — diagram description:`/`— art:` excluded; enum test-pinned | unit | `... -t "presentation"` | ✅ | ✅ green |
| VERIFY-03 (ledger record/resume) | Records append via the SAME atomic write; resume skips already-classified pairs | unit | `... -t "ledger"` | ✅ | ✅ green |
| VERIFY-03 (malformed return) | Non-enum/missing label → `unclassified` → stale; never thrown, never `cosmetic` | unit | `... -t "unclassified"` | ✅ | ✅ green |
| VERIFY-03 · SC-2 | ≥90% of real pairs `cosmetic`, zero `contradictory` | integration (real run) | real `cp -R` copy proof, recorded in `174-PROOF.md` §2 | ✅ | ✅ PASS — 90.9% pooled cosmetic, 0 contradictory |
| VERIFY-03 · SC-3 | Genuine injected rules change → `sharper`/`contradictory` | integration (real run) | real archived-source mutation + re-transcription dispatch, `174-PROOF.md` §5 | ✅ | ✅ PASS — `contradictory`, `stale:true` |
| VERIFY-07 (classification half) | Zero slice-body-shaped lines across orchestrator transcript, raw dispatch prompt, raw subagent return | live proof (grep) | mirror `173-PROOF.md` §3 SC-3 method, `174-PROOF.md` §3 | ✅ | ✅ green — clean except the documented `quotedPass1`/`quotedPass2` exception (and one honestly-reported free-prose `evidence` schema-mention edge case) |
| VERIFY-01 (verdict half) | A real run produces a per-chunk verdict without rebuilding | integration (real run) | recorded in `174-PROOF.md` §6 | ✅ | ✅ green — `chunkVerdicts[]` on both real games, no-build confirmed via whole-tree sha256 diff |
| Determinism (decision 16) | Same pair set classified twice → identical verdicts | integration | ad hoc harness, mirroring `173-PROOF.md` §5; `174-PROOF.md` §4 | ✅ | ✅ green — identical `(pairId, ruleDelta, stale)` triples, both games |
| Added: chunk-level staleness | Real per-chunk stale/total measured on both games against the phase goal | integration (real run) | `174-PROOF.md` §6 | ✅ | ⚠️ measured — goal NOT MET on these two real games (100%/87.5% of citing chunks stale); reported as an open risk, not a defect in what this phase built |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/cli/commands/verify-classify.test.ts` — built (174-03/174-04); covers every unit-level row above.
- [x] **Real pass-1-vs-pass-2 fixture data** — produced live (174-01), archived at `174-FIXTURES/`,
      reconstituted and re-verified against `MANIFEST.md` in every later plan (174-06, this plan).
- [x] `src/cli/slash-command/bs/verify/classification-dispatch.md` — built (174-05).
- [x] Classification subagent contract (`classification-subagent.md`) — built (174-05); carries the
      Visual/Derived schema-asymmetry exclusion rule and worked examples; exercised for real in
      `174-06-PROOF.md` §2 and this plan's §5.
- [x] Export the module-private ledger helpers from `verify-run.ts` — done (174-02).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Orchestrator never opens a slice | VERIFY-07 | The property is about a live session's transcript, which no unit test can observe | Run a real classification pass; grep the orchestrator transcript, the raw dispatch prompt, and the raw subagent return for slice-body-shaped lines (quoted rule line, `Derived (p.`, `Visual (p.`). Expect zero. Mirror `173-PROOF.md` §3. |
| SC-2 / SC-3 real-data bars | VERIFY-03 | Requires a real LLM classification pass over real re-transcribed slices; the verdicts are the thing under test | Real run against `cp -R` copies; record measured counts (never "ran clean") in `174-PROOF.md`. Confirm originals byte-identical before/after. |
| Determinism | decision 16 | Requires two real LLM passes | Classify the same pair set twice; diff the verdict sets; record the comparison. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or a declared Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (including the real-fixture dependency)
- [x] No watch-mode flags
- [x] Feedback latency < 10s for unit work
- [x] SC-2 numeric bar recorded in `174-PROOF.md` (90.9%, PASS)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** signed off 2026-07-30 (174-07). All rows real/green except the added chunk-level
staleness measurement, which is real and measured but reports the phase goal NOT MET on both real
reference games — recorded honestly in `174-PROOF.md` §6 as an open risk for Phase 175/176, not
papered over. `npm test`: 3691/3691 green.
