# Phase 70: Type Consolidation - Research

**Researched:** 2026-02-01
**Domain:** TypeScript type definition consolidation
**Confidence:** HIGH

## Summary

This phase consolidates duplicated lobby types (`LobbyState`, `SlotStatus`, `LobbySlot`, `LobbyInfo`) to a single canonical source in `types/protocol.ts`. Currently, these types are defined identically in three locations with minor documentation differences. The `types/protocol.ts` file is already positioned as the canonical source with no imports (making it safe from circular dependencies).

The consolidation strategy follows Phase 69's pattern: update `session/types.ts` and `client/types.ts` to re-export from the canonical source, then update any consumers that import directly from those files.

**Primary recommendation:** Replace duplicate definitions in `session/types.ts` and `client/types.ts` with re-exports from `types/protocol.ts`. The canonical definitions already exist and are complete.

## Standard Stack

No new libraries required. This is pure TypeScript type reorganization.

### Files Involved
| File | Current State | Target State |
|------|---------------|--------------|
| `src/types/protocol.ts` | Canonical definitions (lines 17-85) | Keep as-is |
| `src/types/index.ts` | Re-exports protocol.ts | Keep as-is |
| `src/session/types.ts` | Duplicate definitions (lines 432-494) | Replace with re-exports |
| `src/client/types.ts` | Duplicate definitions (lines 297-345) | Replace with re-exports |
| `src/ui/components/WaitingRoom.vue` | Local type definitions | Import from canonical source |

## Architecture Patterns

### Current Type Duplication Analysis

**Three locations define these types:**

1. **`src/types/protocol.ts`** (Lines 17-85) - CANONICAL
   - `LobbyState` (line 23)
   - `SlotStatus` (line 31)
   - `LobbySlot` (lines 36-53)
   - `LobbyInfo` (lines 58-85)
   - Has detailed JSDoc with usage notes
   - No imports (zero circular dependency risk)

2. **`src/session/types.ts`** (Lines 432-494) - DUPLICATE
   - Identical type shapes
   - Less detailed JSDoc
   - Imports from engine and ai packages

3. **`src/client/types.ts`** (Lines 297-345) - DUPLICATE
   - Identical type shapes except:
     - `LobbySlot.seat` comment says "1-based" vs "1-indexed"
     - `LobbyInfo` is missing `gameOptionsDefinitions`, `colorSelectionEnabled`, `colors` properties
   - No imports (standalone file)

4. **`src/ui/components/WaitingRoom.vue`** (Lines 14-67) - INLINE DUPLICATE
   - Defines types inline in `<script setup>` block
   - Complete definitions matching protocol.ts

### Differences Between Definitions

**`LobbyInfo` in client/types.ts is INCOMPLETE:**
```typescript
// Missing from client/types.ts LobbyInfo:
gameOptionsDefinitions?: Record<string, GameOptionDefinition>;
colorSelectionEnabled?: boolean;
colors?: string[];
```

This is a bug - the client needs these properties for full lobby functionality. The canonical `types/protocol.ts` has the complete definition.

### Recommended Project Structure (After)

```
src/
├── types/
│   ├── protocol.ts     # CANONICAL: LobbyState, SlotStatus, LobbySlot, LobbyInfo
│   └── index.ts        # Re-exports protocol.ts
├── session/
│   └── types.ts        # Re-exports lobby types from '../types/protocol.js'
├── client/
│   └── types.ts        # Re-exports lobby types from '../types/protocol.js'
└── ui/
    └── components/
        └── WaitingRoom.vue  # Imports from 'boardsmith/types' or '../types'
```

### Pattern: Re-export from Canonical Source

```typescript
// session/types.ts - Add at top of lobby types section
export type {
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
} from '../types/protocol.js';
```

### Anti-Patterns to Avoid
- **Importing canonical types then re-defining locally:** Creates drift risk
- **Proxy re-export files for single types:** Adds indirection without value (per Phase 69 findings)
- **Inline type definitions in Vue SFCs:** Causes duplication, maintenance burden

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Type consistency | Multiple definitions | Single canonical source | Drift prevention |
| Cross-package types | Per-package definitions | Shared types module | DRY principle |

**Key insight:** The canonical source (`types/protocol.ts`) already exists and is correct. The work is deletion and re-export, not creation.

## Common Pitfalls

### Pitfall 1: Circular Dependencies
**What goes wrong:** Re-exporting from protocol.ts creates import cycles
**Why it happens:** Protocol types reference other types that depend on session/client
**How to avoid:** Verify `types/protocol.ts` has NO imports before proceeding
**Warning signs:** TypeScript errors about circular references
**Current state:** SAFE - `types/protocol.ts` has zero import statements

### Pitfall 2: Breaking Public API Exports
**What goes wrong:** Consumers who import from `@boardsmith/session` stop getting types
**Why it happens:** Re-exports changed but index.ts exports not updated
**How to avoid:** Keep session/index.ts and client/index.ts export lists unchanged
**Warning signs:** TypeScript errors in downstream consumers

### Pitfall 3: Vue SFC Import Path Issues
**What goes wrong:** WaitingRoom.vue can't resolve `boardsmith/types` import
**Why it happens:** Package subpath exports may not be configured for all paths
**How to avoid:** Use relative import `../../types/protocol.js` instead
**Warning signs:** Module resolution errors in Vue build

### Pitfall 4: Missing Properties in Client Types
**What goes wrong:** Client code breaks because LobbyInfo is missing properties
**Why it happens:** `client/types.ts` has incomplete LobbyInfo definition
**How to avoid:** This consolidation FIXES this by using complete canonical definition
**Warning signs:** Current state already has this issue - consolidation resolves it

### Pitfall 5: Forgetting to Remove Duplicate Definitions
**What goes wrong:** Both re-export AND local definition exist, causing TypeScript errors
**Why it happens:** Incomplete refactoring
**How to avoid:** Remove local definitions when adding re-exports
**Warning signs:** "Duplicate identifier" TypeScript errors

## Code Examples

### Verified: Current types/protocol.ts (Canonical)
```typescript
// Source: src/types/protocol.ts (lines 17-31)
/**
 * Lobby lifecycle state.
 * - 'waiting': Game is in lobby, waiting for players to join
 * - 'playing': Game has started
 * - 'finished': Game is complete
 */
export type LobbyState = 'waiting' | 'playing' | 'finished';

/**
 * Status of a player slot in the lobby.
 * - 'open': Slot is available for a human player
 * - 'ai': Slot is taken by an AI player
 * - 'claimed': Slot is taken by a human player
 */
export type SlotStatus = 'open' | 'ai' | 'claimed';
```

### Verified: Session types.ts Re-export Pattern
```typescript
// Add to src/session/types.ts after existing imports, before local types
// Re-export lobby types from canonical source
export type {
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
} from '../types/protocol.js';
```

### Verified: Client types.ts Re-export Pattern
```typescript
// Add to src/client/types.ts at end of Lobby Types section
// Re-export lobby types from canonical source
export type {
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
} from '../types/protocol.js';
```

### Verified: WaitingRoom.vue Import Pattern
```typescript
// Replace inline type definitions with import
import type {
  LobbySlot,
  LobbyInfo,
  GameOptionDefinition,
} from '../../types/protocol.js';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Duplicate definitions in each package | Canonical source with re-exports | Phase 70 (now) | Single source of truth |
| client/types.ts incomplete LobbyInfo | Complete definition from canonical | Phase 70 (now) | Client has full lobby info |

## Open Questions

No open questions. The consolidation path is clear:

1. **types/protocol.ts** - Already canonical, no changes needed
2. **session/types.ts** - Remove duplicate definitions, add re-exports
3. **client/types.ts** - Remove duplicate definitions, add re-exports
4. **WaitingRoom.vue** - Import from canonical source instead of inline definitions
5. **Verify** - All tests pass, TypeScript compilation succeeds

## Sources

### Primary (HIGH confidence)
- `src/types/protocol.ts` - Direct file read, confirmed canonical definitions
- `src/types/index.ts` - Direct file read, confirmed re-exports protocol
- `src/session/types.ts` - Direct file read, confirmed duplicate definitions
- `src/client/types.ts` - Direct file read, confirmed duplicate definitions with missing properties
- `src/ui/components/WaitingRoom.vue` - Direct file read, confirmed inline definitions

### Verification (HIGH confidence)
- `grep` analysis of all imports across codebase
- `npm test` - 504 tests passing confirms current state
- Import graph analysis - types/protocol.ts has zero imports

## Import Analysis

### Files That Import These Types

**From session/types.ts:**
- `src/session/lobby-manager.ts` (LobbySlot, LobbyInfo, LobbyState, SlotStatus)
- `src/session/lobby-manager.test.ts` (LobbySlot)
- `src/session/game-session.ts` (LobbySlot, LobbyInfo, LobbyState)
- `src/session/index.ts` (re-exports all four types)

**From client/types.ts:**
- `src/client/index.ts` (re-exports all four types)
- `src/client/game-connection.ts` (LobbyInfo)
- `src/client/vue.ts` (LobbyInfo)

**From external/inline:**
- `src/ui/components/WaitingRoom.vue` (inline definitions)
- `src/ui/components/GameShell.vue` (imports LobbyInfo from client/index.js)

### Re-export Chain After Consolidation

```
types/protocol.ts (CANONICAL)
    │
    ├─► types/index.ts (re-exports)
    │       │
    │       └─► External imports via 'boardsmith/types'
    │
    ├─► session/types.ts (re-exports)
    │       │
    │       └─► session/index.ts (re-exports)
    │               │
    │               └─► External imports via 'boardsmith/session'
    │
    └─► client/types.ts (re-exports)
            │
            └─► client/index.ts (re-exports)
                    │
                    └─► External imports via 'boardsmith/client'
```

## Metadata

**Confidence breakdown:**
- Canonical source location: HIGH - types/protocol.ts already documented as canonical
- Duplicate identification: HIGH - Direct file comparison shows identical structures
- Import chain: HIGH - Grep analysis verified all import sources
- Circular dependency risk: HIGH (no risk) - types/protocol.ts has zero imports

**Research date:** 2026-02-01
**Valid until:** N/A (type consolidation is stable work)
