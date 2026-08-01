---
phase: 178-worked-example-tests
plan: 02
subsystem: testing
tags: [worked-example, sc-3, check-06, test-01, caller-assigned-identity, wr-07]

requires:
  - phase: 178-worked-example-tests plan 01
    provides: "EXAMPLE_LINE_RE/VISUAL_LINE_RE exported from verify-derive-check.ts, annotationLineStartRe from derived-line-pattern.ts, WR-07 resolved as Option B"
provides:
  - "example-derivation.ts — the ONE shared module both TEST-01 (build) and CHECK-06 (verify) call: WorkedExampleSpec + createWorkedExampleSpec (validation choke point), workedExampleId + collectWorkedExampleSpecs (caller-assigned identity, fail-closed collision), buildExampleExtractionPayload (CHECK-06's own allow-list, includes Visual/Example lines), collectGameApiSurface + buildExampleTranslationPayload (kind-branched translation dispatch backed by a mechanically-scanned real project API surface)"
affects: [178-03-through-178-11, check-06-worked-example-replay, test-01-build-side-generation]

tech-stack:
  added: []
  patterns:
    - "Caller-assigned identity from slicePath+lineNumber only, never model-returned text — fail-closed collision via collectWorkedExampleSpecs (direct inheritance of 177.1 CR-01/CR-02)"
    - "Positive allow-list construction (buildExampleExtractionPayload) as the deliberate structural INVERSE of a deny-list (quoteLinesOnly) — WR-07 Option B in practice"
    - "One-level-only re-export-chain API surface scanning (collectGameApiSurface) with an explicitly documented, measured limitation rather than a silently incomplete listing"

key-files:
  created:
    - src/cli/commands/example-derivation.ts
    - src/cli/commands/example-derivation.test.ts

key-decisions:
  - "The extraction payload's construction-site backstop scans for a Derived (p.N): reference ANYWHERE within a retained line's text (unanchored), not only at that line's own start. A line-start-only backstop is structurally unreachable here: every allow-list predicate requires a DIFFERENT literal line-start prefix than 'Derived (p.', so a line-start Derived match can never coexist with any inclusion rule admitting the line. The unanchored form instead catches a Derived reference embedded mid-line (inside a quoted sentence, a citation header, or a Visual/Worked-example-content/Diagram-description line's own free text) — a genuinely reachable, testable failure mode, and a strictly stronger guarantee than the line-start-only version."
  - "collectGameApiSurface resolves a named re-export's kind ('function'/'const'/'class') by re-scanning its target module for a matching declaration; if none is found it defaults to 'const' — the least-presumptuous default, documented in the function's own header comment rather than silently guessed."

requirements-completed: []

duration: ~35min
completed: 2026-07-31
---

# Phase 178 Plan 02: example-derivation.ts — Shared Spec, Ids, and Both Dispatch Payloads Summary

**Built the one shared module (SC-3) both build-side (TEST-01) and verify-side (CHECK-06) worked-example machinery must call: a validated `WorkedExampleSpec` keyed by caller-assigned identity with fail-closed collision, and both dispatch payload builders — extraction (CHECK-06's own Visual-inclusive allow-list) and translation (kind-branched, backed by a mechanically-scanned real project API surface).**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 completed
- **Files created:** 2 (`example-derivation.ts`, `example-derivation.test.ts`)

## Accomplishments

- **Task 1 — `WorkedExampleSpec`, caller-assigned identity, fail-closed collision.** `WORKED_EXAMPLE_KINDS` (`transition`/`predicate`), `createWorkedExampleSpec` as the single validation choke point (kind check, non-empty free-prose fields, fence-marker rejection reusing `DERIVE_CHECK_LEDGER_BEGIN`/`DERIVE_CHECK_LEDGER_END` from `verify-derive-check.ts` verbatim, `sourceText` verbatim-substring check with the offending text quoted in the error, and the transition-requires-action/predicate-forbids-action combination guard). `workedExampleId` composes identity from `slicePath` + `lineNumber` ONLY — it never reads a model-returned field. `collectWorkedExampleSpecs` builds the id-keyed map and THROWS naming both colliding `sourceText` previews rather than overwriting — the direct inheritance of Phase 177.1's CR-01/CR-02 fix (the exact hazard class: lookups keyed by model-supplied free text).
- **Task 2 — `buildExampleExtractionPayload`.** A POSITIVE allow-list — deliberately the structural inverse of `quoteLinesOnly` (WR-07 Option B, resolved by 178-01) — retaining quoted prose, `p.N, <label>:` citation headers, `Example (p.N):` lines, `Visual (p.N):` lines, and the two doom-machine header forms (`Worked example content (`, `Diagram description (`). Proven against REAL verbatim text from all three reference games: `seven`'s Run-example contradiction (`"the accompanying card images show 1, 2, 3"`, recorded only in a `Visual (p.1):` line) survives into the payload; `one-two-punch`'s two Punch Examples (both citation headers, both quoted sentences, both Visual diagram lines) survive; `doom-machine`'s two example forms (`Worked example content (` and the SOUL HARVESTER `Diagram description (`) survive. Every `Derived (p.N):` line is structurally excluded by the allow-list's line-start predicates (mutually exclusive by construction with every retained line's required start), and a construction-site backstop additionally scans retained text for an EMBEDDED `Derived (p.N):` reference and throws, naming the line number — see Deviations for why this had to be unanchored to be reachable at all.
- **Task 3 — `buildExampleTranslationPayload` + `collectGameApiSurface`.** `collectGameApiSurface(projectDir)` scans `src/rules/index.ts` mechanically — direct declarations plus a ONE-LEVEL follow of both `export * from './x.js'` and named `export { a, b } from './x.js'` re-exports — and never reads under `testDir`. Verified live against the real `~/BoardSmithGames/seven/src/rules/scoring.ts` (`legalScoringPatterns`, `numberCardsOf`, and the three pattern constants `RUN_OF_SEVEN_PATTERN`/`COMBO_SETS_AND_RUNS_PATTERN`/`SET_5_PLUS_SET_2_PATTERN` all resolve, all taking `SevenCard[]`) and against `~/BoardSmithGames/one-two-punch/src/rules/index.ts` (see Deviations for the punch.ts finding this surfaced). `buildExampleTranslationPayload` is kind-branched (`predicate` names direct-function-call as a legitimate target; `transition` names action-execution), never touches `testDir` (structurally — every string in the payload traces to `spec` or `api.exportedSymbols`, and `collectGameApiSurface` never opens a path under `testDir`), and dispatches even against an empty surface — `unexecutable` is the model's verdict, never a payload-builder shortcut.
- Full suite green throughout: 4153/244 baseline → 4180/245 (27 new tests, 0 subtracted, 0 failing).

## Task Commits

1. All three tasks — `70322d0f` (feat, TDD — RED/GREEN landed together per the plan's own detailed behavior/action spec; two extraction-backstop test failures were caught and fixed before the single commit, documented below)

## Files Created

- `src/cli/commands/example-derivation.ts` — `WORKED_EXAMPLE_KINDS`, `WorkedExampleSpec`, `workedExampleId`, `createWorkedExampleSpec`, `collectWorkedExampleSpecs`, `buildExampleExtractionPayload` (+ `ExampleExtractionPayload`/`ExampleExtractionLine`, `EXAMPLE_EXTRACTION_TOKEN`), `collectGameApiSurface` (+ `GameApiSurface`/`GameApiSymbol`), `buildExampleTranslationPayload` (+ `EXAMPLE_TRANSLATION_TOKEN`)
- `src/cli/commands/example-derivation.test.ts` — 27 tests: spec construction/validation (8), collision fail-closed (2), extraction payload composition against real reference-game fixtures (6), translation payload + API surface (10), module-header-comment acceptance check (1)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — bug found and fixed during Task 2's own TDD RED/GREEN cycle] The construction-site backstop as originally written (line-start-anchored) was structurally unreachable**
- **Found during:** Task 2, writing the "Derived line makes the function throw" test the plan's acceptance criteria require.
- **Issue:** The first implementation checked `DERIVED_LINE_RE.test(annotationBody(line.text))` against each RETAINED line — i.e. a line-start-anchored check. But every allow-list inclusion predicate requires a line to START with a DIFFERENT literal (`"`, `p.N`, `Example (p.`, `Visual (p.`, `Worked example content (`, `Diagram description (`) than `Derived (p.` — so a retained line's body can never simultaneously satisfy an inclusion rule AND start with `Derived (p.`. The backstop, as first written, could never fire on any input; the required acceptance test failed (`expected [Function] to throw an error`).
- **Fix:** Rebuilt the backstop as `DERIVED_REFERENCE_ANYWHERE_RE` — `DERIVED_LINE_RE`'s source with its `^` anchor stripped, scanning each retained line's text for an EMBEDDED `Derived (p.N):` reference anywhere within it (inside a quoted sentence, a citation header, or a Visual/Worked-example-content/Diagram-description line's own free text), not only at the line's own start. This is a genuinely reachable, testable, and STRICTLY STRONGER guarantee than the line-start-only version it replaced — it catches a class of leak (an embedded annotation reference inside otherwise-legitimate retained content) the original design could never have caught even in principle.
- **Files modified:** `src/cli/commands/example-derivation.ts` (the backstop implementation + its header comment explaining why it must be unanchored), `src/cli/commands/example-derivation.test.ts` (the backstop test, updated to embed the Derived reference inside a quoted sentence rather than as a bare would-be-excluded line)
- **Verification:** `npx vitest run src/cli/commands/example-derivation.test.ts` — the backstop test now throws as required, naming the line number.
- **Committed in:** `70322d0f` (folded into the single Task 2 commit; no separate RED/fix commit split since the defect was caught and corrected within the same TDD cycle before anything landed)

**2. [Rule 1 — test-fixture correctness, found during Task 2's own composition test] The `one-two-punch` fixture initially omitted the second Punch Example's Visual line**
- **Found during:** Task 2, the "one-two-punch carries both citation headers, both quoted sentences, and both Visual lines" test.
- **Issue:** The fixture was first copied as lines 84-92 of the real file, which stops immediately after the second quoted sentence — the second `Visual (p.2):` diagram line (line 94) was one line further down and got left out, so the composition test measured only 1 Visual line instead of the expected 2.
- **Fix:** Extended the verbatim copy to lines 84-94 (confirmed via `grep -n` against the real file), which is the actual full extent of the `## Punch Examples` section.
- **Files modified:** `src/cli/commands/example-derivation.test.ts`
- **Verification:** `npx vitest run src/cli/commands/example-derivation.test.ts` — visual-line count assertion now passes (2).
- **Committed in:** `70322d0f`

### Findings (not defects — documented, not fixed)

**3. `one-two-punch/src/rules/punch.ts` exports `exhaustCorneredPuncher`/`resolvePunch`, but `index.ts` never re-exports them (directly or transitively through `game.ts`, which only imports them internally) — `collectGameApiSurface`'s documented one-level limitation is not hypothetical; it is live in the actual corpus.**
- **Found during:** Task 3, verifying `collectGameApiSurface` against the real `one-two-punch` project (the read_first hint named `guards.js`, `punch.js`, `resolution.js` as the re-export surface to expect).
- **What's actually true:** `punch.ts` exists and exports two functions. `index.ts`'s re-export chain is `action-cards.js, elements.js, resolution.js, positions.js, movement.js, guards.js, jab.js, block.js, rest.js, actions.js` plus a named re-export of `{ OneTwoPunchGame, OneTwoPunchPlayer }` from `game.js` — `punch.js` is not among them. `game.ts` imports `exhaustCorneredPuncher`/`resolvePunch` from `punch.js` for its own internal use but does not re-export them.
- **Consequence:** `collectGameApiSurface('~/BoardSmithGames/one-two-punch')` correctly and predictably does NOT include `resolvePunch`/`exhaustCorneredPuncher` in its `exportedSymbols` — this is the documented "does not resolve `export *` transitively beyond one level" limitation actually manifesting on real generated-game code, not an edge case invented for the doc comment. Recorded as a test assertion (`example-derivation.test.ts`, "one-level-only re-export limit") so the limitation stays pinned rather than silently drifting if `index.ts`'s re-export chain ever changes.
- **No code change required** — this is exactly the documented, deliberate scope boundary Task 3's `<action>` specified ("it does not resolve `export *` transitively beyond one level"), now confirmed against a real file rather than assumed.

---

**Total deviations:** 2 auto-fixed (both caught and corrected within Task 2's own TDD cycle, before any commit), 1 documented finding (no fix needed — confirms a deliberate, documented design limitation against real corpus data).
**Impact on plan:** None on scope. Both fixes strengthened the implementation beyond what the first draft would have delivered (a genuinely-reachable backstop instead of a vacuous one; a fixture that actually proves both Visual lines survive).

## Issues Encountered

None beyond the deviations above.

## Requirements Note

This plan's frontmatter lists `requirements: [CHECK-06, TEST-01]` for traceability to the phase's
overall requirement set, but **neither requirement is complete after this plan** — the same
posture 178-01's summary recorded. This plan builds the shared derivation module every later
plan in the phase (178-03 through 178-11) must route through; it does not itself wire CHECK-06
into `verify-game.md` or TEST-01 into `build/test.md`. `.planning/REQUIREMENTS.md`'s CHECK-06/
TEST-01 checkboxes remain unchecked, to be marked complete by the plan(s) that deliver the actual
pipeline wiring.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 178-03 (and every later plan in this phase) can now:
- Import `WorkedExampleSpec`, `createWorkedExampleSpec`, `workedExampleId`, `collectWorkedExampleSpecs` from `example-derivation.ts` for spec construction and identity — never re-implement any of these (SC-3's single-export-site requirement, checked by plan 178-11).
- Call `buildExampleExtractionPayload({ path, text })` for CHECK-06's own extraction dispatch — proven to carry `Visual (p.N):` and `Example (p.N):` content the way `quoteLinesOnly` deliberately does not.
- Call `collectGameApiSurface(projectDir)` and `buildExampleTranslationPayload(spec, api)` for the second dispatch — the API surface is real, mechanical, and documented about what it cannot see (one-level re-export limit, confirmed live on `one-two-punch`).
- Exported symbol list for 178-03+ to import: `WORKED_EXAMPLE_KINDS`, `WorkedExampleKind`, `WorkedExampleSpec`, `workedExampleId`, `createWorkedExampleSpec`, `collectWorkedExampleSpecs`, `EXAMPLE_EXTRACTION_TOKEN`, `ExampleExtractionLine`, `ExampleExtractionPayload`, `buildExampleExtractionPayload`, `EXAMPLE_TRANSLATION_TOKEN`, `GameApiSymbol`, `GameApiSurface`, `collectGameApiSurface`, `buildExampleTranslationPayload`.
- No blockers. Full suite green (4180/245).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`src/cli/commands/example-derivation.ts` and `src/cli/commands/example-derivation.test.ts` confirmed
present on disk; commit `70322d0f` confirmed present in `git log`.
