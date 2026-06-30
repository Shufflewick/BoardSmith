---
phase: 117
slug: action-space-introspection
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-30
---

# Phase 117 — Validation Strategy

> Derived from 117-RESEARCH.md "## Validation Architecture". Phase 117 ships engine/session/runtime API; validation is automated vitest + tsc plus a security-critical hidden-info leak regression and an INTRO-04 bot-parity test.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npx vitest run src/engine/ --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Type check** | `npx tsc --noEmit` |
| **Estimated runtime** | full suite ~12s (1714 tests currently) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/engine/ --reporter=verbose`
- **After every plan wave:** `npx vitest run src/engine/ src/session/ src/ai/ src/runtime/`
- **Before verify:** `npx vitest run` (full suite green) + `npx tsc --noEmit`
- **Max feedback latency:** ~15s

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File (W0 = new) |
|--------|----------|-----------|-------------------|------|
| INTRO-01 | `getActionSpace(seat)` returns legal actions + arg templates; `null` optional / `{__required:true}` required | integration | `npx vitest run src/engine/element/get-action-space.test.ts` | ❌ W0 |
| INTRO-02 | `getActionSchema(name, seat)` returns `ActionMetadata` w/ selections | integration | same file | ❌ W0 |
| INTRO-02 | `ActionMetadata` exported from session barrel | type | `npx tsc --noEmit` | ✅ |
| INTRO-03 | `buildActionArgs` in-process → element objects; wire → `{__elementRef}` | unit | `npx vitest run src/engine/utils/arg-builder.test.ts` | ❌ W0 |
| INTRO-04 | `enumerateLegalMoves` parity with MCTSBot for identical state | parity | `npx vitest run src/engine/utils/enumerate-moves.test.ts` | ❌ W0 |
| INTRO-04 | MCTSBot in-vitest tests still green after extraction | regression | `npx vitest run src/ai/mcts-stats.test.ts src/ai/mcts-restore.test.ts src/ai/mcts-clone-options.test.ts` | ✅ |
| INTRO-05 | Hidden-info element absent from opponent's `getActionSpace` | leak regression | `npx vitest run src/engine/element/image-leak.test.ts` (extend) | ✅ extend |
| INTRO-F1 | `ElementDiff` importable from session barrel | type | `npx tsc --noEmit` | ✅ |

---

## Cross-Layer Boundary Integration Tests (CLAUDE.md requirement)

1. **Engine → Session** — `getActionSpace` through `buildActionMetadata`: real `Game` with registered actions returns correct `ActionSpaceView`. File: `src/engine/element/get-action-space.test.ts`.
2. **Engine → AI** — `enumerateLegalMoves` returns the identical `{action,args}` set as the pre-extraction bot enumeration. File: `src/engine/utils/enumerate-moves.test.ts`.
3. **Session barrel → consumers** — `import { ElementDiff, ActionMetadata } from 'boardsmith/session'` compiles. Validated by `npx tsc --noEmit`.

---

## Security-Critical: INTRO-05 Hidden-Info Leak Regression

Add a case to `src/engine/element/image-leak.test.ts`: create a game with a hidden element (card in opponent's hand). Call `game.getActionSpace(opponentSeat)` from another seat. Assert no hidden-element ID appears in any returned `ASchemaView.selections[].validElements`. Guards against `buildActionMetadata` leaking hidden IDs via `PickMetadata.validElements`. **A leak here is a security regression — this test is mandatory, not optional.**

---

## INTRO-04 Parity Test (Bot Regression)

Use a game with ≥2 available moves (per MEMORY.md, MCTS multi-move requirement). Assert `enumerateLegalMoves(game, seat)` equals the bot's enumeration (sorted set equality). The continued passing of the three in-vitest AI tests is corroborating evidence; the explicit parity test is belt-and-suspenders. **Core must return element objects (no serialization); the bot wraps with `serializeArgs`.**

---

## Wave 0 Requirements (new test files / extensions)

- [ ] `src/engine/element/get-action-space.test.ts` — INTRO-01 + INTRO-02
- [ ] `src/engine/utils/arg-builder.test.ts` — INTRO-03 (in-process + wire)
- [ ] `src/engine/utils/enumerate-moves.test.ts` — INTRO-04 parity + full enumeration
- [ ] Extend `src/engine/element/image-leak.test.ts` — INTRO-05 leak regression for `getActionSpace`

---

## Manual-Only Verifications

None — all Phase 117 behavior is automatable via vitest + tsc.
