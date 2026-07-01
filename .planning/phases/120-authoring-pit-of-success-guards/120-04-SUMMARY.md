---
phase: 120-authoring-pit-of-success-guards
plan: 04
subsystem: testing
tags: [eslint, ast-lint, ruletester, typescript-eslint-parser, static-analysis]

# Dependency graph
requires: []
provides:
  - "boardsmith/no-element-identity-comparison ESLint rule (syntactic-only, auto-fixable)"
  - "First RuleTester harness in the repo (plain eslint RuleTester + @typescript-eslint/parser, no new dependency)"
affects: [120-05, future eslint-plugin rule additions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RuleTester harness pattern: `new RuleTester({ languageOptions: { parser: tseslintParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } } })` — reusable for future rule tests without adding @typescript-eslint/rule-tester"
    - "Syntactic-only same-file heuristic for detecting 'GameElement-looking' operands: type annotations + same-file class hierarchy + known collection-returning call names (.all/.first/.firstN/.last/.lastN)"

key-files:
  created:
    - src/eslint-plugin/rules/no-element-identity-comparison.ts
    - src/eslint-plugin/rules/no-element-identity-comparison.test.ts
  modified:
    - src/eslint-plugin/index.ts

key-decisions:
  - "Used the plain eslint package's RuleTester with @typescript-eslint/parser instead of @typescript-eslint/rule-tester, per CLAUDE.md 'no new dependencies without discussing' and RESEARCH.md guidance — no new dependency added"
  - "Auto-fix restricted to simple identifier/member-expression operands only; complex operands are reported without a fix so a human decides the rewrite"
  - "Array#includes() matches are reported without an auto-fix since the correct rewrite (.some(el => el.id === x.id)) changes the surrounding expression shape, not a single operand"

patterns-established:
  - "RuleTester test files live alongside their rule (`*.test.ts` next to `*.ts` in src/eslint-plugin/rules/`), picked up automatically by the existing vitest include glob — no config change needed for new rule tests"

requirements-completed: [PIT-04]

# Metrics
duration: 25min
completed: 2026-06-30
---

# Phase 120 Plan 04: no-element-identity-comparison rule + RuleTester harness Summary

**Syntactic ESLint rule (`boardsmith/no-element-identity-comparison`) that auto-fixes `a === b` to `a.id === b.id` for GameElement-looking operands, backed by the repo's first RuleTester harness (plain `eslint` RuleTester + existing `@typescript-eslint/parser`, zero new dependencies).**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Stood up the repo's first `RuleTester` harness (Wave 0), reusable by plan 120-05 for its own rule tests
- Implemented `no-element-identity-comparison`: flags `===`/`!==` between same-file GameElement-looking operands and `GameElement[].includes(element)`, with documented syntactic-heuristic bounds in the rule's JSDoc
- Auto-fix for simple binary comparisons (`a === b` → `a.id === b.id`); `.includes()` matches and complex operands are reported without a fix
- Registered the rule in `plugin.rules` and `boardsmith/recommended`, mirroring the `no-network`/`no-timers`/`no-nondeterministic` pattern exactly
- Confirmed zero new dependencies: `@typescript-eslint/rule-tester` is not present in package.json

## Task Commits

Each task was committed atomically, following the TDD RED → GREEN cycle:

1. **Task 1: Stand up the RuleTester harness + RED fixtures** - `ed1d09a` (test)
2. **Task 2: Implement the rule + register in index.ts (GREEN)** - `6287cad` (feat)

_Note: Task order in git log is oldest-first; `ed1d09a` (RED) precedes `6287cad` (GREEN)._

## Files Created/Modified
- `src/eslint-plugin/rules/no-element-identity-comparison.ts` - The rule implementation: syntactic same-file heuristic for GameElement-looking operands (type annotations, same-file class-extends chains, and `.all()`/`.first()`/`.firstN()`/`.last()`/`.lastN()` collection-call detection), `BinaryExpression` handler with auto-fix, `CallExpression` handler for `.includes()` (no fix)
- `src/eslint-plugin/rules/no-element-identity-comparison.test.ts` - RuleTester harness + 8 fixtures (4 valid, 4 invalid, 2 of which assert auto-fix `output`)
- `src/eslint-plugin/index.ts` - Import + registration in `plugin.rules` and `plugin.configs.recommended.rules`

## Decisions Made
- **No new dependency:** Used plain `eslint`'s `RuleTester` with the already-present `@typescript-eslint/parser` rather than adding `@typescript-eslint/rule-tester`, per CLAUDE.md's "don't add dependencies without discussing" and the plan's explicit dependency decision (superseding a stale mention of `@typescript-eslint/rule-tester` in 120-VALIDATION.md handoff prose).
- **Detection scope:** The "GameElement-looking" heuristic is same-file-only by design — it walks the file's AST once per Program to resolve (a) class-extends chains rooted at `GameElement`, (b) variable/param type annotations naming a resolved element type, and (c) variables initialized from `.all()`/`.first()`/`.firstN()`/`.last()`/`.lastN()` calls (treated as GameElement[]-looking regardless of type annotation). This is a documented, accepted bound (RESEARCH Pitfall #3): cross-file element identity comparisons with no same-file evidence are not flagged.
- **Fix scope:** Auto-fix only fires for binary comparisons where both operands are "simple" (an `Identifier`, or a non-computed `MemberExpression` chain rooted in one) — this avoids generating incorrect rewrites for complex expressions. `.includes()` calls never get an auto-fix since the correct replacement (`.some(...)`) restructures the whole call, not just an operand.

## Deviations from Plan

None - plan executed exactly as written. The dependency decision documented in the plan's `<interfaces>` block (plain RuleTester, no `@typescript-eslint/rule-tester`) was followed as specified, not as a deviation.

## Issues Encountered
None. TDD RED → GREEN cycle proceeded cleanly: the RED commit failed only because the rule module didn't exist yet (import resolution failure), and the GREEN commit made all 8 fixtures pass on the first implementation attempt.

## Verification Results

```
$ npx vitest run src/eslint-plugin/rules/no-element-identity-comparison.test.ts
 ✓ src/eslint-plugin/rules/no-element-identity-comparison.test.ts (8 tests) 41ms
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ npx vitest run src/eslint-plugin
 ✓ src/eslint-plugin/rules/no-element-identity-comparison.test.ts (8 tests) 42ms
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ npm run lint
  (only the 3 pre-existing @typescript-eslint/no-shadow errors in
   useAnimationEvents.ts / useFlyingElements.ts, unrelated to this plan,
   plus 1 pre-existing unused-eslint-disable warning in game.ts)
✖ 4 problems (3 errors, 1 warning)

$ grep -n "rule-tester" package.json
  (no output — no new dependency added)
```

Registration confirmed via an ad-hoc vitest check (not committed, scratch verification only):
`plugin.rules['no-element-identity-comparison']` is defined and
`plugin.configs.recommended.rules['boardsmith/no-element-identity-comparison'] === 'error'`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The RuleTester harness pattern (`new RuleTester({ languageOptions: { parser: tseslintParser, ... } })`) is established and copyable for plan 120-05, which also edits `src/eslint-plugin/index.ts` — the index.ts edit here was kept minimal and localized (one import line, one `plugin.rules` entry, one `recommended.rules` entry) to avoid merge friction.
- `boardsmith/no-element-identity-comparison` is live under `boardsmith/recommended` and will surface in any consuming game repo (BoardSmithGames, MERC) that lints against the recommended config, once re-vendored/updated there.
- Known limitation carried forward: the heuristic will not catch cross-file GameElement identity comparisons with no same-file type evidence (accepted per RESEARCH Pitfall #3) — real-game exercise of this rule is scoped to a later phase, not this plan.

---
*Phase: 120-authoring-pit-of-success-guards*
*Completed: 2026-06-30*

## Self-Check: PASSED

- FOUND: src/eslint-plugin/rules/no-element-identity-comparison.ts
- FOUND: src/eslint-plugin/rules/no-element-identity-comparison.test.ts
- FOUND: commit ed1d09a (test, RED)
- FOUND: commit 6287cad (feat, GREEN)
