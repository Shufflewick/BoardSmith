# 178-06 Task 1 — Measured sandbox-rule viability for generated example tests

**Measured:** 2026-07-31
**Method:** `scanSourceForSandboxViolations(code, relPath)` (the new single-file entry point on
`src/cli/lib/sandbox-scan.ts`) run over every `tests/*.test.ts` file in
`~/BoardSmithGames/one-two-punch`, `~/BoardSmithGames/seven`, and `~/BoardSmithGames/doom-machine`
— the three reference games' real, legitimate, hand-written test suites. Script used for this
measurement is not checked in (a one-off `tsx` invocation); the counts below are the actual
result of running the real function, not a hand-estimate.

## Raw counts, all seven rules

| Rule | Violation count | Verdict |
|---|---|---|
| `boardsmith/no-network` | 0 | survives |
| `boardsmith/no-filesystem` | 37 | **EXCLUDED** — fires on real, legitimate test code |
| `boardsmith/no-timers` | 0 | survives |
| `boardsmith/no-nondeterministic` | 1 | **EXCLUDED** — fires on real, legitimate test code |
| `boardsmith/no-eval` | 0 | survives |
| `boardsmith/no-element-identity-comparison` | 0 | survives |
| `boardsmith/no-element-array-state` | 0 | survives |

## Every non-zero count, by file/line

### `boardsmith/no-filesystem` (37 violations)

Fires on `import { ... } from 'node:fs'` / `import { join } from 'node:path'` lines at the TOP of
test files that read fixtures (a11y test HTML fixtures, theme JSON, etc.) or reconstruct
absolute paths for `mount()`/DOM setup — completely ordinary, legitimate hand-written test
plumbing. Representative sample (full set: 16 files × 1-2 lines each = 37 lines):

- `one-two-punch/tests/a11y.test.ts:621-622, 1309-1310, 1516-1517, 1752-1753` (4 separate
  `describe` blocks each re-importing `fs`/`path`)
- `one-two-punch/tests/block.test.ts:1`, `game.test.ts:1`, `rest.test.ts:1`, `theme.test.ts:2-3`
- `seven/tests/a11y.example.test.ts:7-8`, `match.a11y.test.ts:7-8`
- `doom-machine/tests/a11y.floor.test.ts:3-4`, `broken-shield.a11y.test.ts:3-4`,
  `hard-mode.a11y.test.ts:3-4`, `lock.a11y.test.ts:3-4`, `modifier.a11y.test.ts:3-4`,
  `player-damage.a11y.test.ts:3-4`, `power-sentience.a11y.test.ts:3-4`,
  `reroll.a11y.test.ts:3-4`, `shields.a11y.test.ts:3-4`, `theme.test.ts:21-22`

### `boardsmith/no-nondeterministic` (1 violation)

- `seven/tests/scoring.test.ts:628` — `Math.random()` used inside a property-style test that
  exercises randomized inputs. Legitimate: test code calling `Math.random()` to generate varied
  fixtures is a completely different concern from GAME RULES code calling it (which the rule
  exists to forbid for replay/undo/MCTS determinism) — but the AST-based scanner has no way to
  distinguish "test harness randomness" from "rules randomness" by source location alone once the
  code is not confined to `src/rules`.

### All other rules: zero violations

`boardsmith/no-network`, `boardsmith/no-timers`, `boardsmith/no-eval`,
`boardsmith/no-element-identity-comparison`, `boardsmith/no-element-array-state` fired zero times
across all three games' real test suites.

## Conclusion

Per 178-CONTEXT.md decision 14 ("a gate that a correct implementation could never pass is a
defect in the gate"), `boardsmith/no-filesystem` and `boardsmith/no-nondeterministic` are
EXCLUDED from `GENERATED_TEST_SANDBOX_RULES` — both fire on real, legitimate, hand-written test
code that a correct generated test could equally need (fixture I/O; randomized-property test
harness code). Test files are not executor-sandboxed rules code: they run under `vitest`, not
inside the game's replay/undo/MCTS-critical executor, so filesystem access and `Math.random()`
inside a TEST are not the same hazard the rule exists to guard against inside `src/rules`.

`GENERATED_TEST_SANDBOX_RULES` (defined in `src/cli/commands/example-test-emit.ts`, citing this
file) is the surviving five-rule subset:

- `boardsmith/no-network`
- `boardsmith/no-timers`
- `boardsmith/no-eval`
- `boardsmith/no-element-identity-comparison`
- `boardsmith/no-element-array-state`

These five guard against hazards specific to MODEL-GENERATED code with no legitimate reason to
trigger them in a worked-example test (network calls, timers, eval, and the two element-identity
misuse rules that guard against a category of engine-misuse bug regardless of whether the code
runs in `src/rules` or a test file).
