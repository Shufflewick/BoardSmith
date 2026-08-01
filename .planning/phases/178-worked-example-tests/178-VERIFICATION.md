---
phase: 178-worked-example-tests
verified: 2026-07-31T22:10:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 178: Worked-Example Tests Verification Report

**Phase Goal:** Worked examples in the rulebook stop being a one-time seed for hand-written tests
and become an accumulating, automatically-derived executable test suite in BOTH build and verify.
**Verified:** 2026-07-31 (codebase-direct, not summary-trusting)
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (measured against the REWRITTEN Section-2 wording, `178-PRE-REGISTRATION.md` `dc4670fe`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 (rewritten): every worked example in a newly-built chunk's cited slices produces an executable test, a named `unexecutable` verdict, or an `example-inconsistent` Open-Rules-Gaps finding — never silently dropped | ✓ VERIFIED | `build/test.md` step 4 (a)-(i) cites real registered commands end-to-end (`verify-example-replay/-translate/-record/-emit`), routes `unexecutable`/`example-inconsistent` explicitly (h), and exempts zero-example chunks by name (i). `178-11` live proof: 11/11 pre-registered examples landed in a permitted-set outcome, none dropped. |
| 2 | SC-2 (rewritten): worked-example replay executes every translatable example against the real engine and reports `unexecutable`/`example-inconsistent` by name, never silently drops a count | ✓ VERIFIED | `verify-game.md` Step 8 wires the identical 4 commands, project-wide, exit 0. `178-PROOF.md` §1-§2: `seven`'s adversarial fixture recorded `example-inconsistent` with both contradicting excerpts on BOTH independent runs — confirmed directly from raw `run1/run2.extract.seven__01-definitions-and-components.raw.json` and `178-PROOF/ledgers/seven.EXAMPLE-VERDICTS.md`, not narrative alone. |
| 3 | SC-3 (unchanged): both mechanisms share one derivation module, never duplicate it | ✓ VERIFIED | `src/cli/commands/example-derivation.test.ts` `describe('SC-3 ...')`, 4 assertions (a)-(d), all passing. Assertion (d) walks every `.ts` file under `src/` and asserts exactly one `export function`/`export async function` site for each of `buildExampleExtractionPayload`, `buildExampleTranslationPayload`, `collectGameApiSurface` — confirmed by direct grep: exactly one declaration site each, in `example-derivation.ts`. This assertion is genuinely falsifiable (PROOF.md §7 documents it catching its own regex bug on first run against the real `async`-declared `collectGameApiSurface`). |
| 4 | Build-side CLI commands exist and are reachable, not merely designed (the Phase 177.1 failure pattern) | ✓ VERIFIED | `npx boardsmith verify-example-replay/-translate/-record/-emit --help` all resolve with real, non-stub option lists. `cli.ts` registers all four (`.command('verify-example-replay')` etc., lines 484/496/510/533), each importing from `example-derivation.js`/`example-test-emit.js`. `extract-example.md`/`translate-example.md` exist under `src/cli/slash-command/bs/verify/` and are in the installer's `SHARED_FILES` copy list (`install-claude-command.ts` lines 80-81), covered by an installer regression test that checks parity between src and installed shared-verify tree. |
| 5 | Advisory/blocking asymmetry (D-10/D-11) holds and was not flipped in either skill | ✓ VERIFIED | `build/test.md` step 4(g): "A `disagrees` result is BUILD-BLOCKING and routes this chunk back to `build`." `verify-game.md` Step 8: "Findings are reported and this check exits 0 ... this check must NEVER be used as a gate on the Close." Both explicit, both correctly asymmetric per decision 10/11. |
| 6 | The `seven` adversarial fixture (Run example) is caught `example-inconsistent` with BOTH contradicting excerpts, both live runs | ✓ VERIFIED | Ledger + both raw model returns confirm identical result independently: `contradictionA="example: 5, 6, 7"`, `contradictionB` names "1, 2, 3" — RUN1 and RUN2 raw JSON both independently reasoned to `example-inconsistent` with the same two excerpts. |
| 7 | The 178-12 gap-closure fix (content-free slice no longer dispatchable) is real, not aspirational | ✓ VERIFIED | `verify-example-replay.ts` line 551-556: `if (lines.length === 0)` returns `notDispatchable: 'no-extractable-content'`, no `extractionPayload`. `verify-example-replay.test.ts` line 427-442: a meaningful test asserting a zero-content slice is reported `notDispatchable` with `extractionPayload` undefined. `178-PROOF.md` §11 correctly reattributes the original 37.5% figure as our own payload-construction defect, not model unreliability, and names exactly which 4 of 25 slices are affected. |
| 8 | Suite green + reference-game cleanliness | ✓ VERIFIED | `npx vitest run`: 4314 tests / 247 files passed (0 failing) — matches the expected baseline exactly. `git status --short` clean in all three of `~/BoardSmithGames/{seven,one-two-punch,doom-machine}`. §10's whole-tree-baseline gap (originals' tracked `.boardsmith/` build artifacts deleted mid-proof, sha256 baseline too narrow to catch it) was found, disclosed, restored (`git checkout --`), and confirmed clean — a legitimate proof-harness-discipline finding correctly carried forward to Phase 179 rather than silently smoothed over. |

**Score:** 8/8 truths verified

### Pre-Registration Rewrite Assessment (Section 2 of `178-PRE-REGISTRATION.md`, `dc4670fe`)

| Criterion | Disposition | Justified? |
|---|---|---|
| ROADMAP SC-1 (literal) | REWRITE → executable-or-named-unexecutable-or-routed-inconsistent | **Yes.** The literal wording is provably unsatisfiable whenever a legitimate `unexecutable` or the designated `example-inconsistent` fixture is in scope (by design, decision 4/7) — `seven`'s own corpus forces this every time. The rewrite strengthens rather than weakens: it still requires one of three named, accountable outcomes, never a silent drop. |
| ROADMAP SC-2 (literal) | REWRITE → executes-what-it-can, reports-the-rest-by-name | **Yes,** same defect class — literal "executes each example" is impossible for a chunk that legitimately can't model an example yet. |
| ROADMAP SC-3 (literal) | KEEP unchanged | **Yes** — correctly recognized as a static code-structure fact, not dispatch-dependent; no rewrite needed and none applied. |
| "seven Run example never becomes a test" | REWRITE → must be recorded `example-inconsistent` WITH both excerpts | **Yes, and this is the important one.** The original wording passed vacuously on a broken/silent extraction (zero examples found = trivially "never a test"). The rewrite closes exactly that hole and is *stricter*, not weaker — verified above (truth #6) that the strengthened bar was actually met. |
| N-of-M bar over a single game's example count | REJECT | **Yes** — correctly identified as the same fragile shape as the retired CHECK-04 determinism gate (4 measurement runs wasted before retirement); at n=2-6 per game any such bar is either permanently failing or trivially satisfied. |
| "human-recognizable" bar | REJECT | **Yes** — correctly identified as unmeasurable without first performing the judgment call it claims to test; replaced by the pre-registration's own corrected Section 1 table, a fixed checkable target. |

No rewrite weakens a bar that should have held. Every rewrite either (a) removes an impossible literal reading while preserving accountability for every example's outcome, or (b) tightens a vacuous-pass hole. Two rejected criteria were never load-bearing to begin with.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/cli/commands/example-derivation.ts` | Shared payload-builder module (SC-3) | ✓ VERIFIED | 3 exported functions, single declaration sites, imported by both replay and emit command modules. |
| `src/cli/commands/verify-example-replay.ts` | CHECK-06 read/report + 178-12 guard | ✓ VERIFIED | Registers `verify-example-replay`/`-record`/`-translate`; `notDispatchable` guard present and tested. |
| `src/cli/commands/example-test-emit.ts` | TEST-01 write surface (generated test file) | ✓ VERIFIED | Registers `verify-example-emit`; import-hoisting fix (178-11 Rule 1/2) present. |
| `src/cli/slash-command/bs/build/test.md` step 4 | TEST-01 build-blocking wiring | ✓ VERIFIED | Cites real commands, real handshake tokens, build-blocking `disagrees`. |
| `src/cli/slash-command/bs/verify-game.md` Step 8 | CHECK-06 advisory wiring | ✓ VERIFIED | Cites same 4 commands project-wide, exit-0 advisory, never gates Close. |
| `src/cli/slash-command/bs/verify/extract-example.md`, `translate-example.md` | Subagent contracts | ✓ VERIFIED | Present, installer-registered, covered by installer parity test. |
| `src/cli/commands/example-derivation.test.ts` SC-3 suite | Falsifiable structural proof | ✓ VERIFIED | 4/4 assertions passing; assertion (d) confirmed genuinely falsifiable (caught its own regex bug during authoring, per PROOF §7). |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `build/test.md` step 4 | `verify-example-replay`/`-translate`/`-record`/`-emit` | direct CLI command citations, real `--help` surfaces | WIRED |
| `verify-game.md` Step 8 | same 4 commands | direct CLI command citations | WIRED |
| Both skill files | `example-derivation.ts` | via command handler import graph (SC-3 assertion a/b/c) | WIRED |
| `verifyExampleReplayCommand` | `buildExampleExtractionPayload` | `lines.length === 0` guard → `notDispatchable` (178-12) | WIRED |
| Reference-game generated tests | real project API (`src/rules/...`) | `collectGameApiSurface`, exercised live in 178-11 (1 real PASS, 1 real honest FAIL) | WIRED, data flowing (not stubbed) |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| CHECK-06 | 178-03/04/09/11/12 | ✓ SATISFIED | REQUIREMENTS.md entry matches PROOF.md exactly; live cross-game proof + 178-12 correction both reflected. |
| TEST-01 | 178-02/05/06/08/11 | ✓ SATISFIED | REQUIREMENTS.md entry cites the same evidence base + SC-3 source-inspection proof. |

No orphaned requirements found for this phase.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers in any of the phase's key source files (`example-derivation.ts`, `verify-example-replay.ts`, `example-test-emit.ts`, `build/test.md`, `verify-game.md`).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| verify-example-replay CLI reachable | `npx boardsmith verify-example-replay --help` | Real option list (`--project`, `--json`, `--chunk`) | ✓ PASS |
| verify-example-translate CLI reachable | `npx boardsmith verify-example-translate --help` | Real option list | ✓ PASS |
| verify-example-record CLI reachable | `npx boardsmith verify-example-record --help` | Real option list, only write surface | ✓ PASS |
| verify-example-emit CLI reachable | `npx boardsmith verify-example-emit --help` | Real option list | ✓ PASS |
| Full suite green | `npx vitest run` | 4314/4314 passed, 247/247 files | ✓ PASS |
| Reference games untouched | `git status --short` x3 | All clean | ✓ PASS |
| Adversarial fixture caught both runs | direct read of raw JSON returns + ledger | `example-inconsistent` w/ both excerpts, both runs | ✓ PASS |
| Generated test PASS case is real | `doom-machine...RUN1-vitest-output.txt` | 1 passed | ✓ PASS |
| Generated test FAIL case is real (honest negative) | `one-two-punch...RUN1-vitest-output.txt` | 2 failed, real API mismatch stack trace | ✓ PASS |
| 178-12 notDispatchable guard | code read + test read | Guard present, test present and meaningful | ✓ PASS |

### Human Verification Required

None. Every must-have in this phase resolves to a programmatically-checkable code fact, a CLI-runnable behavior, or raw dispatch evidence already committed to the repo (`178-PROOF/returns/`, `178-PROOF/ledgers/`, `178-PROOF/generated/*.txt`). No visual, real-time, or external-service behavior is in scope.

### Gaps Summary

None found. This phase differs from the "Phase 177.1 pattern" (a fully-designed mechanism with no CLI surface, never wired into a skill) in every checked respect: all four commands are registered, reachable, and cited by both skill files; the SC-3 sharing property is enforced by a genuinely falsifiable test; the adversarial fixture's result is verifiable from raw, uncurated model-return JSON rather than only from narrative; and the one real defect this phase produced mid-proof (the 37.5% "reliability" mischaracterization) was root-caused and fixed in-phase (178-12), with the fix itself covered by a real RED-then-GREEN test. The one open item from the proof (§10's whole-tree-baseline scoping gap) is a proof-harness discipline finding, correctly disclosed and explicitly carried to Phase 179 rather than silently smoothed over — it does not block this phase's own goal, which concerns the derivation mechanism, not the proof harness's baselining technique.

---

_Verified: 2026-07-31_
_Verifier: Claude (gsd-verifier)_
