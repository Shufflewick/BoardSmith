---
phase: 95-ship-reframe
verified: 2026-06-22T13:36:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 95: Ship & Reframe — Verification Report

**Phase Goal:** The auto-UI is a legitimate, shippable production peer; a production build emits only the chosen UI; new game scaffolds open in a single UI without a split-screen comparison.
**Verified:** 2026-06-22T13:36:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Docs, CLI output, and scaffold READMEs frame the auto-UI as a valid production choice — no "debug/reference aid" language | VERIFIED | grep across all six target files returns no banned phrases; production-peer language confirmed present in each |
| 2 | Removing the scaffold's static `import { AutoUI }` results in the auto-UI bundle being dropped by ordinary tree-shaking (no registry or `rollupOptions.input` needed) | VERIFIED | `treeshake-bundle.test.ts` runs a real Vite/Rollup build and confirms `AutoRenderer` is absent from the custom-UI bundle and present in the auto-UI bundle; both tests pass |
| 3 | A freshly scaffolded game opens in its chosen UI; no split-screen "Custom vs Auto-Generated" comparison panel | VERIFIED | `generateAppVue` branches on `config.ui ?? 'auto'`; auto path emits only `AutoUI`, no `GameTable`, no `board-comparison`; scaffold tests pin this; 95-04-SUMMARY documents browser confirmation |
| 4 | A developer who chooses auto-UI encounters no framework-level friction — `boardsmith dev` and `boardsmith build` just work | VERIFIED | Scaffold crash fix in `init.ts` (hands after `registerElements`) unblocked the gate; `boardsmith.json "ui": "auto"` drives a single static import through build and dev; browser playthrough confirmed in 95-04 |

**Score:** 4/4 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/lib/project-scaffold.ts` | `generateAppVue` branches on `config.ui`; `generateUiIndexTs` has no `GameTable` re-export; `generateBoardsmithJson` emits `"ui": "auto"` | VERIFIED | All three conditions confirmed by code inspection |
| `src/cli/lib/project-scaffold.test.ts` | 9 tests covering auto/custom `generateAppVue`, `boardsmith.json`, `generateUiIndexTs`, `generateGameTableVue` | VERIFIED | Exists; 9 tests; all pass in `npm test -- --run src/cli` (51/51) |
| `src/cli/lib/treeshake-bundle.test.ts` | Real Vite/Rollup build proof: custom-UI bundle lacks `AutoRenderer`; auto-UI bundle has it | VERIFIED | Exists; 2 tests; both pass (1416ms + 1073ms) |
| `src/cli/commands/init.ts` | `generateGameTs` exported; hands created after `registerElements` in game body | VERIFIED | `export function generateGameTs` at line 82; template creates hands via `for (const player of this.players)` after `registerElements` call |
| `src/cli/commands/init.test.ts` | 3 regression tests pinning the hands-after-registerElements pattern | VERIFIED | Exists (41 lines); 3 tests; all pass |
| `src/cli/commands/validate.ts` | Optional `"ui"` field accepted as `"auto"` or `"./"` prefixed; rejects other values | VERIFIED | Lines 111-114 confirm the validation logic is present and correct |
| `docs/ui-components.md` | Production-peer framing; no "reference implementation" / "prototyping" language | VERIFIED | Line 139: "A production-ready UI for any game"; line 159: "Ships as your production UI for simple games" |
| `docs/component-showcase.md` | No "Debugging game state" / "Reference implementation" bullets; production-peer heading | VERIFIED | Line 103: "Production-ready automatic game UI"; line 116: "Shipping simple games as a complete, production-ready UI" |
| `docs/nomenclature.md` | Definition updated to production-peer language | VERIFIED | Line 416: "A valid production choice for simple games, and a solid starting point before building a custom UI" |
| `docs/llm-overview.md` | "can ship as the production UI for simple games" appended | VERIFIED | Line 13 contains the appended clause |
| `src/cli/slash-command/instructions.md` | No "DO NOT SKIP", no `board-comparison`, no "Auto-Generated UI" mandate, no split-screen success criterion | VERIFIED | grep for all banned phrases returns empty (exit 1 = no matches) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `config.ui ?? 'auto'` | Single `import { GameShell, AutoUI }` in App.vue | `generateAppVue` branch in `project-scaffold.ts` | WIRED | Code at lines 268-311 confirmed; test `generateAppVue (ui: auto) > imports only AutoUI` pins it |
| `config.ui` = relative path | Single custom component import, no AutoUI | `generateAppVue` else-branch | WIRED | Lines 313-346; test `generateAppVue (ui: custom path) > imports the custom component` pins it |
| Tree-shaking proof | `AutoRenderer` absent from custom-UI bundle | Real `viteBuild()` + bundle grep in `treeshake-bundle.test.ts` | WIRED | Both tests pass with real Vite/Rollup build in 2.5s |
| `generateGameTs` | Hands created after `registerElements` | `for (const player of this.players)` in game constructor body | WIRED | `init.test.ts` asserts `handCreateIdx > registerIdx` |
| `rollupOptions` in `build.ts` | External-only (no `.input` manipulation) | `external: ['boardsmith', /^boardsmith\//]` only | WIRED | Confirmed — no `input` key, satisfying SHIP-02 constraint |

---

## Data-Flow Trace (Level 4)

Not applicable for this phase. The phase delivers code generators (pure string functions), a test proof, and documentation edits — no dynamic data rendering components. The tree-shaking test validates real build output rather than a rendered UI.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `generateUiIndexTs` has no `GameTable` re-export | test: `generateUiIndexTs > does not re-export GameTable` | PASS (51/51) | PASS |
| `generateBoardsmithJson` emits `"ui": "auto"` | test: `generateBoardsmithJson > contains the "ui" field` | PASS (51/51) | PASS |
| Tree-shaking: custom-UI bundle lacks `AutoRenderer` | real Vite build + grep | `AutoRenderer` absent from custom-UI dist | PASS |
| Tree-shaking: auto-UI bundle contains `AutoRenderer` | real Vite build + grep | `AutoRenderer` present in auto-UI dist | PASS |
| Hands-after-registerElements regression | `init.test.ts` 3 tests | `handCreateIdx > registerIdx` confirmed | PASS |
| CLI full suite | `npm test -- --run src/cli` | 51/51 passed in 2.85s | PASS |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| SHIP-01 | Auto-UI is a selectable, shippable production UI, not merely a dev/debug panel | SATISFIED | Production-peer language confirmed in all six target locations; banned phrases absent |
| SHIP-02 | Production build emits a single UI via ordinary tree-shaking (no registry/`rollupOptions.input`) | SATISFIED | `treeshake-bundle.test.ts` proves it with a real Vite/Rollup build; `rollupOptions` in `build.ts` has no `input` |
| SHIP-03 | Scaffold generates a game that opens in its chosen UI with no split-screen comparison | SATISFIED | `generateAppVue` emits single-UI; scaffold crash fixed (hands after `registerElements`); browser playthrough confirmed in 95-04 |

---

## Anti-Patterns Found

None. Scanned all modified files:
- No `TBD`, `FIXME`, or `XXX` markers in phase-modified files.
- No stub implementations masking absent behavior (the `generateGameTableVue` stub is intentionally minimal — it IS the "start here" on-ramp feature, not a missing implementation).
- No runtime UI registry — single static import path confirmed.
- No `rollupOptions.input` manipulation — build externals only.

---

## Scope Fence Verification

The following Phase 96 work is confirmed absent from this phase:
- No cross-repo migration of `~/BoardSmithGames/` games.
- No deletion of old renderer (`AutoElement.vue`, `AutoGameBoard.vue`) — those deletions are Phase 96's MIGRATE-03.
- No `npm run audit` clean-up run.
- No N-UI live switcher or `?ui=` query-param dev toggle built (deferred per CONTEXT.md D-04 and §0 C5c).

---

## Human Verification Required

No items requiring human verification remain. The 95-04 plan executed and documented browser playthrough:

- `boardsmith init smoke-95` scaffolded correctly.
- App.vue had a single `AutoUI` import with no split-screen markup (static file inspection confirmed).
- Lobby displayed; seat taken; auto-UI rendered deck, hands, score panels.
- Multiple turn cycles driven via "Follow active seat": `draw` auto-executed, `play` presented choices, deck depleted 41→40→39.
- `boardsmith dev` stopped; throwaway game deleted.

---

## Advisory Follow-Ups (Non-Blocking)

These are pre-existing observations in the demo game surfaced during 95-04 browser verification. They are not Phase 95 gaps.

1. **Game History panel shows "No activity yet" during play.** Expected for actions that mutate plain properties/elements without contributing to `commandHistory`. Documented in MEMORY.md. Not a scaffold structure issue.
2. **Score stat displays `0` after `play` actions** despite `player.score += 1`. A projection gap in the placeholder demo game's score-to-player-view mapping, not a scaffold or UI structure issue. Worth a follow-up against the scaffold's demo rules (possibly Phase 96 or a dedicated fix).

Neither observation prevents SHIP-01/02/03 from being satisfied.

---

## Gaps Summary

No gaps. All four success criteria verified against codebase evidence:

1. Banned language confirmed absent from all six target files; production-peer language confirmed present — test suite and grep verification both pass.
2. Real Vite/Rollup build proof confirms `AutoRenderer` absent from custom-UI bundle and present in auto-UI bundle — `treeshake-bundle.test.ts` passes deterministically.
3. `generateAppVue` emits a strictly single-UI template; no split-screen markup; scaffold crash fixed and regression-guarded; browser playthrough documented.
4. No framework-level friction: `boardsmith.json "ui"` drives a single static import; `boardsmith dev` and `boardsmith build` work without `rollupOptions.input` manipulation or a runtime registry.

**Phase 95 goal is achieved.**

---

_Verified: 2026-06-22T13:36:00Z_
_Verifier: Claude (gsd-verifier)_
