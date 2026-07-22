---
phase: 168-platform-feature-spike-seed-to-state
verified: 2026-07-22T22:35:00Z
status: passed
score: 3/3 must-haves verified (SC-1 doc-accuracy gap — the false "proven against go-fish" claim — closed by fix(168-gap); doc now names the real in-repo CounterGame fixture + rationale. PoC verified genuinely solid: real negative control, deterministic, fail-loud, composes existing machinery; full suite 3137 green)
overrides_applied: 0
gaps:
  - truth: "SC-1: A design/feasibility spike for seed-to-state exists, scoped and ACCURATE"
    status: partial
    reason: "docs/seed-to-state.md's 'Proven vs deferred' section claims the Phase 168 PoC was proven 'against go-fish (the reference card game)', but the actual PoC (168-02) deliberately used an in-repo CounterGame fixture instead, because go-fish is not importable from this repo's vitest runner — a decision explicitly recorded in 168-02-SUMMARY.md and pre-sanctioned in 168-CONTEXT.md/168-02-PLAN.md. The doc was written in wave 1 (168-01) before the wave-2 PoC executed and was never revisited to reflect the actual implementation target. This is a factual inaccuracy in the one deliverable whose entire purpose is to be an accurate feasibility record — everything else in the doc (mechanism, load-path citations, cost/shape recommendation) is independently verified accurate, but this specific claim is false as written."
    artifacts:
      - path: "docs/seed-to-state.md"
        issue: "Line 217-219 ('Proven vs deferred' section) states the deterministic record→seed→load→assert cycle was proven 'against go-fish (the reference card game)'. It was actually proven against an in-repo CounterGame fixture (src/session/seed-to-state.test.ts)."
    missing:
      - "Update docs/seed-to-state.md's 'Proven vs deferred' section to state the PoC used an in-repo CounterGame fixture (not go-fish), and note why (go-fish is not importable from this repo's vitest runner; the PoC proves the target-agnostic deterministic-load capability, not anything go-fish-specific) — mirroring the accurate rationale already recorded in 168-02-SUMMARY.md."
      - "Optional hardening: the existing docs/seed-to-state.test.ts guard only checks section-presence and src/*.ts citation existence, not semantic claims like which game was used — no test change is required to fix this gap, but note for future doc-drift guards that file-existence checks do not catch factual claim drift."
---

# Phase 168: Platform Feature Spike — Seed-to-State Verification Report

**Phase Goal:** Scope and prove feasibility of "seed a game into a target playtest state" — a scenario/seed the platform can load directly so the pipeline can put a game into the exact state it wants a human to test, bringing the human in not-already-annoyed.
**Verified:** 2026-07-22T22:35:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC-1) | A design/feasibility spike for seed-to-state exists, scoped AND accurate | ⚠️ PARTIAL | `docs/seed-to-state.md` covers mechanism/load path/authoring surface/pipeline API/cost recommendation with independently-verified citations (see below), BUT the "Proven vs deferred" section makes a false claim about what game the PoC targeted (see gap). |
| 2 (SC-2) | A thin PoC loads a game into a declared target state deterministically, with a REAL negative control | ✓ VERIFIED | `src/session/seed-to-state.test.ts` — read in full; FAIL-WITHOUT leg is a genuine negative control (fresh start deck=5/hand=0 vs. seeded deck=3/hand=2 — the test would fail if the seed did nothing); PASS-WITH leg asserts `loadedSnapshot.state` `toEqual`s the recorded element tree byte-for-byte plus meaningful flowState fields (currentPlayer/awaitingInput/availableActions/moveCount/position), and a follow-up test proves the seeded game can execute the next legal `draw` action from that exact state; LOAD-TWICE-IDENTICAL proves `randomState`-pinned determinism across two independent loads. 5/5 tests pass (`npx vitest run src/session/seed-to-state.test.ts`). Not hollow/tautological. |
| 3 (SC-3) | The doc correctly notes C.2 (panel multi-select) is Phase 159, not this phase | ✓ VERIFIED | `docs/seed-to-state.md` lines 10-11 and 234-237 state this explicitly, twice (header and closing section). |

**Score:** 2/3 truths fully verified (SC-1 partial — real but narrow inaccuracy)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docs/seed-to-state.md` | Feasibility spike doc | ✓ VERIFIED (with 1 factual error) | 8 required sections present; all `src/*.ts` line-number citations spot-checked and accurate: `GameStateSnapshot` at `src/engine/utils/snapshot.ts:12` (doc: ~line 12, exact), `GameRunner.fromSnapshot` at `src/runtime/runner.ts:608` (doc: ~line 608, exact), `TestGame.getSnapshot` at `src/testing/test-game.ts:423` (doc: ~line 423, exact). "Proven vs deferred" section's go-fish claim is inaccurate (see gap). |
| `docs/seed-to-state.test.ts` | Section-presence + citation-existence guard | ✓ VERIFIED, WIRED | 21/21 assertions pass (`npx vitest run docs/seed-to-state.test.ts`); confirmed the guard is existence-only (regex-extracted `src/*.ts` paths → `existsSync`), NOT a semantic-claim checker — this is why the go-fish inaccuracy slipped through undetected. |
| `src/session/seed-to-state.test.ts` | Deterministic-load PoC integration test | ✓ VERIFIED, WIRED | 5/5 tests pass; real negative control confirmed (see truth #2). |
| `src/session/stateless-ops.ts` (`handleStart` seed branch) | Composes existing `runnerFromSnapshot`/`stateEnvelope`, not a reimplemented loader | ✓ VERIFIED | Lines 291-328 read directly: `if (seedSnapshot) return { success: true, ...stateEnvelope(runnerFromSnapshot(seedSnapshot, def), gameOptions.playerCount) }` — identical primitives every other op already uses. No new load machinery. |
| `src/cli/commands/dev.ts` (`parseSeedFile`) | Fail-loud, no silent fresh-start fallback | ✓ VERIFIED | Lines 78-95 read directly: throws `DevFlagError` with the exact path on missing file (`existsSync` check), on unreadable file, and on invalid JSON — three distinct, actionable failure messages, zero fallback path. |
| `src/cli/dev-host/multiplayer-host.ts` (`MultiplayerHostOptions.seedSnapshot`) | Threads seed through restarts | ✓ VERIFIED | `seedSnapshot?: GameStateSnapshot` present on options type; `startGame()` forwards it on every `start` op per SUMMARY and grep confirmation. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Seed CLI flag | `handleStart` | `hostOptions.seedSnapshot` (never `gameOptions`) | ✓ WIRED | Confirmed by direct read: `handleStart(def, gameOptions, seedSnapshot?)` receives seed as a separate parameter, never merged into `gameOptions`; comment at stateless-ops.ts:296-302 explicitly documents the WR-04/D-01 rationale (gameOptions persists into `snapshot.gameOptions`, seed must not leak there). `gameOptions.gameOptions` pollution check: seed branch (line 303-308) never touches `gameOptions` at all — it constructs the envelope purely from `runnerFromSnapshot(seedSnapshot, def)`. |
| `handleStart` seed branch | `runnerFromSnapshot`/`fromSnapshot` | direct call | ✓ WIRED | Same code path (`runnerFromSnapshot`) used by every other non-start op in the file (`handleAction`, `handleUndo`, etc.) — not a parallel/duplicated loader. |
| `--seed <file>` CLI flag | `parseSeedFile` → `MultiplayerHost({ seedSnapshot })` | `commands/dev.ts` line ~615 | ✓ WIRED | `parseSeedFile(resolve(process.cwd(), options.seed))` called via `exitOnDevFlagError`, result threaded into `MultiplayerHost` construction and into the seeded-start console banner. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FEAT-01 | 168-01, 168-02 | Spike "seed a game into a target playtest state" — scope + feasibility spike | ✓ SATISFIED (with a documentation-accuracy gap) | Design doc + working, well-tested PoC exist; mechanism/load-path/authoring/pipeline-API sections are accurate; one factual claim (go-fish target) in the doc is wrong. |

No orphaned requirements — REQUIREMENTS.md maps only FEAT-01 to Phase 168, and it appears in plan frontmatter.

### Anti-Patterns Found

None. Scanned all phase-touched files (`docs/seed-to-state.md`, `docs/seed-to-state.test.ts`, `src/session/seed-to-state.test.ts`, `src/session/stateless-ops.ts`, `src/cli/dev-host/multiplayer-host.ts`, `src/cli/commands/dev.ts`, `src/cli/cli.ts`) for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER — zero matches.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| PoC integration test suite | `npx vitest run src/session/seed-to-state.test.ts` | 5/5 tests pass | ✓ PASS |
| Doc guard test suite | `npx vitest run docs/seed-to-state.test.ts` | 21/21 assertions pass | ✓ PASS |
| Full repo suite (phase-gate claim) | `npx vitest run` | 216 test files, 3137 tests passed | ✓ PASS (matches SUMMARY claim exactly) |
| `parseSeedFile` fail-loud on missing file | Direct source read of `src/cli/commands/dev.ts:78-95` | Three distinct `DevFlagError` throws, no fallback | ✓ PASS |

### Human Verification Required

None. All checkable claims were verifiable via direct code read, targeted greps, and running the actual test files/full suite — no visual, real-time, or external-service behavior involved in this phase's deliverables.

### Gaps Summary

The core PoC (SC-2) is genuinely solid: I read `src/session/seed-to-state.test.ts` line by line and confirmed the negative control is real (a fresh CounterGame start produces deck=5/hand=0, while the recorded seed is deck=3/hand=2 — the FAIL-WITHOUT test would fail if the seed wiring did nothing), the positive assertions deep-equal the actual element tree plus meaningful flow fields, a follow-on legal action is exercised from the loaded state, and determinism is proven via a load-twice-identical `randomState` check. The wiring (`handleStart`'s seed branch, `parseSeedFile`'s fail-loud parser, `seedSnapshot` riding `hostOptions` not `gameOptions`) all composes the pre-existing `runnerFromSnapshot`/`fromSnapshot` machinery rather than reimplementing a loader, exactly as claimed. The full suite is green at 216 files / 3137 tests, matching the SUMMARY's claim.

The one real gap is narrow but genuine: `docs/seed-to-state.md`'s "Proven vs deferred" section — the section whose entire job is to accurately state what was and wasn't proven — claims the PoC was proven "against go-fish (the reference card game)." It was not. The actual PoC (168-02) deliberately used an in-repo `CounterGame` fixture instead, a decision made mid-execution and explicitly recorded in `168-02-SUMMARY.md` and pre-sanctioned by `168-CONTEXT.md`/`168-02-PLAN.md` (go-fish isn't importable from this repo's test runner). The doc was authored in wave 1 (168-01), before the wave-2 PoC ran and made this substitution, and was never revisited afterward. The doc's own guard test (`docs/seed-to-state.test.ts`) only checks section presence and `src/*.ts` citation file-existence — it has no mechanism to catch a semantic claim like "which game was this proven against," so this drift shipped silently. This is a one-line documentation fix (state the actual CounterGame target and why), not a structural or engine-level problem, and does not undermine the PoC's validity or the mechanism/load-path findings — but per this phase's own stated bar (an accurate feasibility finding), it is a real, closable gap rather than a nitpick to wave through.

---

_Verified: 2026-07-22T22:35:00Z_
_Verifier: Claude (gsd-verifier)_
