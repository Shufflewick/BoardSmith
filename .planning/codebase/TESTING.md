# Testing Patterns

**Analysis Date:** 2026-01-08

## Test Framework

**Runner:**
- Vitest 2.1.9
- Config: `vitest.config.ts` in project root
- Additional game configs: `packages/games/*/tests/vitest.config.ts`

**Assertion Library:**
- Vitest built-in expect
- Matchers: toBe, toEqual, toThrow, toMatchObject

**Run Commands:**
```bash
pnpm test                              # Run all tests
pnpm test -- --watch                   # Watch mode
pnpm test -- path/to/file.test.ts     # Single file
npm run test:watch                     # Watch mode (per-package)
```

## Test File Organization

**Location:**
- `packages/*/tests/*.test.ts` - Package tests in tests/ directory
- Not co-located with source (separate tests/ folder)

**Naming:**
- `*.test.ts` for all test files
- Descriptive names: `action.test.ts`, `flow.test.ts`, `mcts-bot.test.ts`
- Game tests: `game.test.ts`, `e2e-game.test.ts`, `complete-game.test.ts`

**Structure:**
```
packages/
  engine/
    src/
    tests/
      action.test.ts
      element.test.ts
      flow.test.ts
  games/
    go-fish/
      rules/src/
      ui/src/
      tests/
        game.test.ts
        e2e-game.test.ts
        complete-game.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('ModuleName', () => {
  describe('functionName', () => {
    beforeEach(() => {
      // reset state
    });

    it('should handle valid input', () => {
      // arrange
      const input = createTestInput();

      // act
      const result = functionName(input);

      // assert
      expect(result).toEqual(expectedOutput);
    });

    it('should throw on invalid input', () => {
      expect(() => functionName(null)).toThrow('Invalid input');
    });
  });
});
```

**Patterns:**
- Use beforeEach for per-test setup
- Nested describe blocks for organization
- Explicit arrange/act/assert sections
- Descriptive test names with "should"

## Mocking

**Framework:**
- Vitest built-in mocking (vi)
- No extensive mocking needed (pure game logic)

**Patterns:**
```typescript
import { vi } from 'vitest';

// Mock random for deterministic tests
vi.spyOn(Math, 'random').mockReturnValue(0.5);
```

**What to Mock:**
- Random number generation for reproducibility
- Time/dates if needed

**What NOT to Mock:**
- Game engine internals (test real behavior)
- Pure functions
- Element operations

## Fixtures and Factories

**Test Data:**
```typescript
// Factory pattern from @boardsmith/testing
import { createTestGame } from '@boardsmith/testing';

const testGame = createTestGame(GoFishGame, {
  playerCount: 2,
  playerNames: ['Alice', 'Bob'],
});
```

**Location:**
- Factory functions: `packages/testing/src/test-game.ts`
- Assertions: `packages/testing/src/assertions.ts`
- Debug utilities: `packages/testing/src/debug.ts`

## Coverage

**Requirements:**
- No enforced coverage target
- Coverage tracked for awareness

**Configuration:**
- Vitest built-in coverage
- Run: `pnpm test -- --coverage`

**View Coverage:**
```bash
pnpm test -- --coverage
open coverage/index.html
```

## Test Types

**Unit Tests:**
- Test single function/class in isolation
- Examples: `packages/engine/tests/action.test.ts`
- Fast execution (<100ms per test)

**Integration Tests:**
- Test multiple modules together
- Examples: `packages/games/go-fish/tests/game.test.ts`
- Test full game setup and actions

**E2E Tests:**
- Complete game flows
- Examples: `packages/games/go-fish/tests/e2e-game.test.ts`
- Test from start to finish

**Random Simulation:**
- Stress testing with random play
- Location: `packages/testing/src/random-simulation.ts`
- Used for AI validation and game stability

## Common Patterns

**Async Testing:**
```typescript
it('should handle async operation', async () => {
  const result = await asyncFunction();
  expect(result).toBe('expected');
});
```

**Error Testing:**
```typescript
it('should throw on invalid input', () => {
  expect(() => parse(null)).toThrow('Cannot parse null');
});

// Async error
it('should reject on failure', async () => {
  await expect(asyncCall()).rejects.toThrow('error message');
});
```

**Action Testing:**
```typescript
import { assertActionSucceeds, assertActionFails } from '@boardsmith/testing';

it('should execute action successfully', async () => {
  const result = await assertActionSucceeds(testGame, 0, 'draw');
  expect(result.success).toBe(true);
});
```

**Flow State Assertions:**
```typescript
import { assertFlowState } from '@boardsmith/testing';

assertFlowState(testGame, {
  currentPlayer: 0,
  phase: 'playing',
  actionStep: 'askForRank',
});
```

## Testing Utilities (@boardsmith/testing)

**Test Game Wrapper:**
- `createTestGame(GameClass, options)` - Create wrapped test instance
- `TestGame` class with convenience methods

**Action Simulation:**
- `simulateAction(testGame, player, action, args)` - Execute action
- `simulateActions(testGame, actions[])` - Execute sequence
- `assertActionSucceeds/Fails()` - Verify outcomes

**Assertions:**
- `assertFlowState()` - Check flow state
- `assertPlayerHas()` - Verify element ownership
- `assertElementCount()` - Count elements
- `assertGameFinished()` - Check end condition
- `assertActionAvailable/NotAvailable()` - Action accessibility

**Debug Utilities:**
- `toDebugString(game)` - Human-readable state
- `traceAction()` - Detailed execution trace
- `visualizeFlow()` - Flow state visualization
- `logAvailableActions()` - List available actions
- `diffSnapshots()` - Compare game states

**Scenario Building:**
- `ScenarioBuilder` - Construct test scenarios
- `playSequence()` - Execute action sequences
- `playUntil()` - Play until condition
- `quickGame()` - Rapid game setup

## Game Test Timeout

**Configuration:**
- Root: Default timeout
- Games: `testTimeout: 30000` (30 seconds for complex scenarios)

```typescript
// packages/games/go-fish/tests/vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
  },
});
```

---

*Testing analysis: 2026-01-08*
*Update when test patterns change*
