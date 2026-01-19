# Phase 41: Test Colocation - Context

**Gathered:** 2026-01-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Move all tests from `packages/*/tests/` to be colocated with source files in `src/`. Tests should live as direct siblings to the files they test.

</domain>

<decisions>
## Implementation Decisions

### File placement
- Direct sibling pattern: `foo.ts` → `foo.test.ts` in same folder
- No `__tests__` subdirectories — pit of success means tests are immediately visible next to code
- New tests go in the same folder as the file being tested (obvious, no hunting)

### Naming convention
- Keep existing `.test.ts` suffix (already used throughout codebase)
- No renaming required, just move files

### Multi-file tests
- Place with the primary module being tested
- e.g., `mcts-bot.test.ts` → `src/ai/mcts-bot.test.ts`
- Integration tests go with the main file under test

### Game tests
- Move game tests now (don't wait for Phase 44 extraction)
- Games in `packages/games/*/` will have their tests colocated before extraction
- Phase 44 will extract games+tests together

### Claude's Discretion
- Test runner configuration updates (Vitest pattern matching)
- Exact file mapping when test name doesn't match source file 1:1
- Import path updates within test files

</decisions>

<specifics>
## Specific Ideas

- "Pit of Success" — the easy path is the correct path. Tests visible next to code, obvious where new tests go.
- Direct sibling placement eliminates navigation and folder structure decisions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 41-test-colocation*
*Context gathered: 2026-01-18*
