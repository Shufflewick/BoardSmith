# Phase 4: Test File Refactoring Analysis

Analysis of `packages/ui/tests/useActionController.test.ts` to determine optimal test file organization.

## Current File Statistics

- **Total lines:** 2,088
- **Total describe blocks:** 23
- **Total test cases (it blocks):** 66

## Test File Structure

### Shared Fixtures (Lines 1-204)

| Component | Lines | Purpose |
|-----------|-------|---------|
| Imports | 1-22 | Vitest, Vue, useActionController exports |
| `createMockSendAction()` | 25-29 | Mock factory for action sender |
| `createTestMetadata()` | 32-191 | Test action metadata factory (9 actions) |
| Root beforeEach | 199-204 | Set up shared state per test |

**Note:** These fixtures are used by most tests and would need to be extracted to a shared test utilities file.

### Describe Block Inventory

| # | Block Name | Lines | Tests | Category |
|---|------------|-------|-------|----------|
| 1 | `initialization` | 206-222 | 1 | Core API |
| 2 | `execute() method` | 224-376 | 10 | Core API |
| 3 | `step-by-step mode (wizard)` | 378-520 | 8 | Core API |
| 4 | `auto-fill behavior` | 522-600 | 4 | Core API |
| 5 | `auto-execute behavior` | 602-637 | 2 | Core API |
| 6 | `getChoices utility` | 639-684 | 3 | Choices |
| 7 | `getActionMetadata utility` | 686-714 | 2 | Core API |
| 8 | `isExecuting guard` | 716-746 | 1 | Core API |
| 9 | `state cleanup` | 748-827 | 4 | Core API |
| 10 | `injection helpers` | 829-851 | 4 | Core API |
| 11 | `externalArgs (bidirectional sync)` | 853-1001 | 8 | Core API |
| 12 | `start() with initialArgs` | 1003-1057 | 3 | Core API |
| 13 | `selection choices` | 1059-1232 | 4 | Choices |
| 14 | `repeating selections` | 1234-1499 | 6 | Selections |
| 15 | `dependsOn selections` | 1501-1668 | 3 | Selections |
| 16 | `filterBy selections` | 1670-1767 | 2 | Selections |
| 17 | `getCurrentChoices()` | 1769-1801 | 2 | Choices |
| 18 | `multiSelect validation` | 1803-1862 | 3 | Selections |
| 19 | `text and number inputs` | 1864-1959 | 3 | Selections |
| 20 | `element selections` | 1961-2010 | 3 | Selections |
| 21 | `error recovery` | 2012-2052 | 2 | Core API |
| 22 | `fetchChoicesForSelection()` | 2054-2087 | 2 | Choices |

**Total:** 66 tests across 22 describe blocks (plus 1 root describe)

## Category Summary

| Category | Describe Blocks | Tests | Est. Lines |
|----------|-----------------|-------|------------|
| Core API | 12 | 47 | ~950 |
| Selections | 6 | 20 | ~650 |
| Choices | 4 | 11 | ~290 |

## Dependency Analysis

### Test Fixture Dependencies

All tests depend on:
- `createMockSendAction()` - Mock sendAction function
- `createTestMetadata()` - Standard test action metadata
- Root `beforeEach` setup (sendAction, availableActions, actionMetadata, isMyTurn)

### Custom Metadata Tests

Some selection tests create custom metadata within their describe blocks:
- `selection choices` - Creates `choiceMeta`, `twoStepMeta`
- `repeating selections` - Creates `repeatMeta`
- `dependsOn selections` - Creates `dependsMeta`
- `filterBy selections` - Creates `filterMeta`
- `text and number inputs` - Creates `textMeta`, `numberMeta`

These are self-contained and would move cleanly with their describe blocks.

## Proposed File Structure

### Option B: Group by Feature Area (Recommended)

**Rationale:**
- Phase 2 extracted types/helpers, but those aren't directly tested (they're internal utilities)
- Grouping by feature area aligns with how developers think about functionality
- Separates complex selection behavior tests from simpler core API tests
- Reasonable file sizes (600-950 lines each)

**Structure:**

```
packages/ui/tests/
├── useActionController.test.ts          (~950 lines) - Core API
├── useActionController.selections.test.ts (~650 lines) - Selection handling
├── useActionController.choices.test.ts   (~290 lines) - Choice utilities
└── testUtils/
    └── actionControllerTestUtils.ts      (~200 lines) - Shared fixtures
```

#### File 1: `useActionController.test.ts` (Core API)

| Block | Tests |
|-------|-------|
| `initialization` | 1 |
| `execute() method` | 10 |
| `step-by-step mode (wizard)` | 8 |
| `auto-fill behavior` | 4 |
| `auto-execute behavior` | 2 |
| `getActionMetadata utility` | 2 |
| `isExecuting guard` | 1 |
| `state cleanup` | 4 |
| `injection helpers` | 4 |
| `externalArgs (bidirectional sync)` | 8 |
| `start() with initialArgs` | 3 |
| `error recovery` | 2 |

**Total:** 49 tests, ~950 lines

#### File 2: `useActionController.selections.test.ts` (Selection Handling)

| Block | Tests |
|-------|-------|
| `repeating selections` | 6 |
| `dependsOn selections` | 3 |
| `filterBy selections` | 2 |
| `multiSelect validation` | 3 |
| `text and number inputs` | 3 |
| `element selections` | 3 |

**Total:** 20 tests, ~650 lines

#### File 3: `useActionController.choices.test.ts` (Choice Utilities)

| Block | Tests |
|-------|-------|
| `getChoices utility` | 3 |
| `selection choices` | 4 |
| `getCurrentChoices()` | 2 |
| `fetchChoicesForSelection()` | 2 |

**Total:** 11 tests, ~290 lines

#### File 4: `testUtils/actionControllerTestUtils.ts` (Shared Fixtures)

Contains:
- `createMockSendAction()` function
- `createTestMetadata()` function
- Common types if needed

**Estimated:** ~200 lines

### Option C: Minimal Split (Alternative)

Keep core API and choices together, only extract complex selection tests:

```
packages/ui/tests/
├── useActionController.test.ts          (~1,240 lines) - Core + Choices
├── useActionController.selections.test.ts (~650 lines) - Selection handling
└── testUtils/
    └── actionControllerTestUtils.ts      (~200 lines) - Shared fixtures
```

**Trade-offs:**
- Fewer files to maintain
- Core file still somewhat large
- Less clear separation of concerns

## Recommendation

**Proceed with Option B (Group by Feature Area)**

Reasons:
1. **Clear separation:** Core API vs Selection handling vs Choice utilities
2. **Reasonable sizes:** No file over 1,000 lines
3. **Logical grouping:** Developers can find relevant tests easily
4. **Parallel execution:** Three independent test files can run in parallel
5. **Focused editing:** Changes to selection handling don't require loading core tests

## Shared Fixture Plan

Extract to `packages/ui/tests/testUtils/actionControllerTestUtils.ts`:

```typescript
// Exports
export function createMockSendAction(): Mock<...>
export function createTestMetadata(): Record<string, ActionMetadata>
export function createControllerTestSetup(): {
  sendAction: Mock<...>
  availableActions: Ref<string[]>
  actionMetadata: Ref<Record<string, ActionMetadata> | undefined>
  isMyTurn: Ref<boolean>
}
```

Each test file imports from this shared location.

## Implementation Details for Plan 04-02

### Step 1: Create Shared Fixtures File

Create `packages/ui/tests/testUtils/actionControllerTestUtils.ts`:

```typescript
import { vi } from 'vitest';
import { ref, type Ref } from 'vue';
import type { ActionMetadata, ActionResult } from '../../src/composables/useActionController.js';

export function createMockSendAction() {
  return vi.fn().mockImplementation(async (actionName: string, args: Record<string, unknown>): Promise<ActionResult> => {
    return { success: true, data: { actionName, args } };
  });
}

export function createTestMetadata(): Record<string, ActionMetadata> {
  // ... existing implementation from lines 32-191
}

export function createControllerTestSetup() {
  const sendAction = createMockSendAction();
  const availableActions = ref([...]);
  const actionMetadata = ref(createTestMetadata());
  const isMyTurn = ref(true);
  return { sendAction, availableActions, actionMetadata, isMyTurn };
}
```

### Step 2: Split Test Files

#### A. Create `useActionController.choices.test.ts`

Move these describe blocks (in order):
1. `getChoices utility` (lines 639-684)
2. `selection choices` (lines 1059-1232)
3. `getCurrentChoices()` (lines 1769-1801)
4. `fetchChoicesForSelection()` (lines 2054-2087)

#### B. Create `useActionController.selections.test.ts`

Move these describe blocks (in order):
1. `repeating selections` (lines 1234-1499)
2. `dependsOn selections` (lines 1501-1668)
3. `filterBy selections` (lines 1670-1767)
4. `multiSelect validation` (lines 1803-1862)
5. `text and number inputs` (lines 1864-1959)
6. `element selections` (lines 1961-2010)

#### C. Keep in `useActionController.test.ts`

These blocks remain (Core API):
1. `initialization` (lines 206-222)
2. `execute() method` (lines 224-376)
3. `step-by-step mode (wizard)` (lines 378-520)
4. `auto-fill behavior` (lines 522-600)
5. `auto-execute behavior` (lines 602-637)
6. `getActionMetadata utility` (lines 686-714)
7. `isExecuting guard` (lines 716-746)
8. `state cleanup` (lines 748-827)
9. `injection helpers` (lines 829-851)
10. `externalArgs (bidirectional sync)` (lines 853-1001)
11. `start() with initialArgs` (lines 1003-1057)
12. `error recovery` (lines 2012-2052)

### Step 3: Update Imports

Each new test file needs:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, reactive, nextTick } from 'vue';
import {
  useActionController,
  type ActionMetadata,
} from '../../src/composables/useActionController.js';
import { createMockSendAction, createTestMetadata } from './testUtils/actionControllerTestUtils.js';
```

## Final Results (Phase 4 Complete)

### Before vs After Comparison

| Metric | Before | After |
|--------|--------|-------|
| **Files** | 1 | 3 |
| **Total lines** | 2,088 | 2,138 |
| **Tests** | 66 | 79 |
| **Largest file** | 2,088 | 1,178 |

**Note:** Test count increased from 66 to 79 because Phase 2 added 13 new tests during useActionController refactoring.

### Final File Structure

```
packages/ui/tests/
├── useActionController.test.ts          (1,178 lines, 59 tests) - Core API
├── useActionController.selections.test.ts (777 lines, 20 tests) - Selection handling
└── useActionController.helpers.ts        (183 lines) - Shared fixtures
```

### Test Distribution

| File | Tests | Categories |
|------|-------|------------|
| `useActionController.test.ts` | 59 | initialization, execute(), wizard mode, auto-fill, auto-execute, metadata, guards, cleanup, injection, externalArgs, initialArgs, error recovery, selection choices |
| `useActionController.selections.test.ts` | 20 | repeating, dependsOn, filterBy, multiSelect, text/number inputs, element selections |

### Shared Helpers (`useActionController.helpers.ts`)

- `createMockSendAction()` - Mock factory for action sender
- `createTestMetadata()` - Standard test metadata with 9 actions
- `setupTestController()` - Complete test controller setup helper
- `createChoicesTestSetup()` - Setup helper for choice-related tests

### Deviations from Original Plan

1. **Merged choices tests into core file:** Choice utilities (`getChoices`, `getCurrentChoices`, `fetchChoicesForSelection`, `selection choices`) remained in the main test file rather than being split to a separate `choices.test.ts`. This keeps the main file cohesive for core API testing.

2. **No testUtils directory:** Shared helpers placed directly alongside test files as `useActionController.helpers.ts` for simpler imports.

3. **Line count increase:** Total lines grew from 2,088 to 2,138 (+50 lines) due to:
   - Additional imports in split files
   - Module structure overhead
   - Helper function documentation
