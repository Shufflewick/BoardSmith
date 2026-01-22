# Phase 63: Documentation - Research

**Researched:** 2026-01-22
**Domain:** Technical documentation / Animation event system
**Confidence:** HIGH

## Summary

This phase documents the animation event system that was implemented across Phases 59-62. The system enables game UIs to play back animations asynchronously while game state advances immediately (soft continuation pattern). Documentation needs to cover:

1. **Engine-side API** (`Game.emitAnimationEvent()`, `pendingAnimationEvents`, `acknowledgeAnimationEvents()`)
2. **UI-side composable** (`createAnimationEvents`, `useAnimationEvents`, handlers, skip/pause control)
3. **ActionController integration** (`animationsPending`, `showActionPanel` gating)
4. **Integration with useAutoAnimations** (`eventHandlers` option)

The animation event system is a parallel channel that carries UI hints - not commands or state mutations. This distinction is critical for documentation to convey correctly.

**Primary recommendation:** Add a dedicated "Animation Events" section to docs/ui-components.md covering the full flow from engine to UI, with practical examples. Add terminology to docs/nomenclature.md.

## Standard Stack

### Documentation Format
| Format | Location | Purpose | Why Standard |
|--------|----------|---------|--------------|
| Markdown | docs/*.md | Developer documentation | Standard for BoardSmith docs |
| JSDoc | Source files | API reference | Already has comprehensive JSDoc |
| Examples | Inline code blocks | Practical usage | Pattern established in ui-components.md |

### Documentation Sections
| Section | Content | Priority |
|---------|---------|----------|
| Nomenclature entries | 4-5 new terms | DOC-02 (required) |
| UI Components section | Full animation events documentation | DOC-01 (required) |
| Code examples | Engine emit, UI consume patterns | HIGH |

## Architecture Patterns

### Documentation Structure for Animation Events

Based on existing ui-components.md structure, add after "Composables" section:

```markdown
## Animation Events

[Overview paragraph explaining soft continuation pattern]

### Engine-Side: Emitting Events

[game.emitAnimationEvent() usage]

### UI-Side: Consuming Events

[createAnimationEvents, useAnimationEvents, handlers]

### ActionController Integration

[animationsPending, showActionPanel gating]

### Integration with useAutoAnimations

[eventHandlers option]

### Common Patterns

[Examples: combat, card flip, score update]
```

### Recommended Nomenclature Entries

Add to docs/nomenclature.md in appropriate sections:

**In "Actions and Selections" section:**

```markdown
### Animation Event

**Definition:** A UI hint emitted during game execution that flows to UI consumers for asynchronous playback. Animation events do NOT mutate game state - the game continues immediately while UI plays back events (soft continuation pattern).

**In Code:** `AnimationEvent` interface; `game.emitAnimationEvent()` method
**Related Terms:** Soft Continuation, Animation Handler, Animation Acknowledgment
**Usage:**
- "Emit an animation event when combat resolves"
- "The UI plays back animation events while state already advanced"

### Animation Handler

**Definition:** A function registered with the animation events system to play back a specific event type. Handlers receive the event and return a Promise that resolves when the animation completes.

**In Code:** `AnimationHandler` type; registered via `registerHandler()`
**Related Terms:** Animation Event, Animation Acknowledgment
**Usage:**
- "Register a handler for combat animation events"
- "The handler controls animation timing"

### Soft Continuation

**Definition:** Design pattern where game state advances immediately and UI plays back asynchronously. The UI "catches up" to the current state through animation playback, rather than blocking state advancement.

**In Code:** Architecture pattern (not a specific type)
**Related Terms:** Animation Event, ActionPanel gating
**Usage:**
- "BoardSmith uses soft continuation - state doesn't wait for animations"
- "The ActionPanel gates on animation completion to prevent premature decisions"
```

### File Organization

```
docs/
├── ui-components.md        # Add Animation Events section
├── nomenclature.md         # Add new terminology
└── (other docs unchanged)
```

### Anti-Patterns to Avoid in Documentation

- **Anti-pattern: Treating animation events as commands** - Documentation must clearly state these are hints, not commands. UI can skip them entirely.

- **Anti-pattern: Suggesting animations block state** - The soft continuation pattern means state never waits. Documentation should emphasize this.

- **Anti-pattern: Omitting the acknowledgment flow** - The acknowledge → clear from buffer flow is important for understanding how events are cleaned up.

- **Anti-pattern: Missing the ActionPanel gating explanation** - Users need to understand why ActionPanel hides during animations.

## Don't Hand-Roll

Problems that documentation should direct users away from:

| Problem | Don't Do | Document Instead | Why |
|---------|----------|------------------|-----|
| Animation state tracking | Custom refs in components | `useAnimationEvents().isAnimating` | Single source of truth |
| Handler registration | Manual in multiple places | `eventHandlers` option on `useAutoAnimations` | Declarative, auto-cleanup |
| Action gating | Manual `isMyTurn && !animating` checks | `actionController.showActionPanel` | Encapsulates all conditions |
| Event acknowledgment | Direct calls to engine | `createAnimationEvents({ acknowledge })` | Composable handles timing |

**Key insight for documentation:** Users should use the composables, not implement their own animation tracking.

## Common Pitfalls

Documentation should call out these pitfalls:

### Pitfall 1: Forgetting to Acknowledge Events
**What goes wrong:** Events accumulate, replaying on every state update
**What users might do:** Skip the acknowledge callback thinking events auto-clear
**Document this:** Include acknowledge callback in every example, explain its purpose

### Pitfall 2: Mutating Event Data in Handlers
**What goes wrong:** Original event data corrupted for other handlers/logs
**What users might do:** Modify `event.data` directly
**Document this:** Note that event data is a shallow copy, but nested objects share references

### Pitfall 3: Not Handling Handler Errors
**What goes wrong:** One error stops entire animation chain
**What users might do:** Throw errors from handlers expecting cleanup
**Document this:** Note that errors are logged but don't stop processing - design handlers defensively

### Pitfall 4: Blocking UI on Animations
**What goes wrong:** Game feels unresponsive
**What users might do:** Disable all UI during animations
**Document this:** Only gate decision-making (ActionPanel), not viewing/inspection

### Pitfall 5: Not Understanding showActionPanel vs isMyTurn
**What goes wrong:** Custom UIs show actions during animations
**What users might do:** Check only `isMyTurn` for showing action UI
**Document this:** Explain the three conditions in `showActionPanel`

## Code Examples

### Engine-Side: Emitting Animation Events

```typescript
// In action execute() or game logic
execute({ attacker, target }: { attacker: Combatant; target: Combatant }) {
  const damage = attacker.attack - target.defense;
  target.health -= damage;

  // Emit animation event - game state already changed!
  this.emitAnimationEvent('combat', {
    attackerId: attacker.id,
    targetId: target.id,
    damage,
    outcome: target.health <= 0 ? 'kill' : 'hit',
  });

  if (target.health <= 0) {
    target.putInto(this.graveyard);
  }
}

// Grouped events for complex sequences
execute({ attacker, targets }: { attacker: Combatant; targets: Combatant[] }) {
  const groupId = `attack-${this.turnCount}`;

  this.emitAnimationEvent('attack-start', { attackerId: attacker.id }, { group: groupId });

  for (const target of targets) {
    const damage = calculateDamage(attacker, target);
    target.health -= damage;
    this.emitAnimationEvent('damage', { targetId: target.id, damage }, { group: groupId });
  }

  this.emitAnimationEvent('attack-end', { attackerId: attacker.id }, { group: groupId });
}
```

### UI-Side: Creating Animation Events Instance

```typescript
// In GameShell or root component setup
import { createAnimationEvents, provideAnimationEvents } from 'boardsmith/ui';

const animationEvents = createAnimationEvents({
  // Get events from player state (reactive getter)
  events: () => state.value?.animationEvents,

  // Acknowledge events when played back
  acknowledge: (upToId) => {
    session.acknowledgeAnimations(playerSeat, upToId);
  },

  // Optional: delay for events without handlers (useful for debugging)
  defaultDuration: 0, // ms
});

// Provide to component tree
provideAnimationEvents(animationEvents);
```

### UI-Side: Registering Animation Handlers

```typescript
// In game board component
import { useAnimationEvents } from 'boardsmith/ui';

const animations = useAnimationEvents();

// Register handler - returns cleanup function
const unregister = animations?.registerHandler('combat', async (event) => {
  const { attackerId, targetId, damage, outcome } = event.data;

  // Find DOM elements
  const attackerEl = document.querySelector(`[data-combatant-id="${attackerId}"]`);
  const targetEl = document.querySelector(`[data-combatant-id="${targetId}"]`);

  // Play attack animation
  await playAttackAnimation(attackerEl, targetEl);

  // Show damage number
  await showDamageNumber(targetEl, damage);

  if (outcome === 'kill') {
    await playDeathAnimation(targetEl);
  }
});

// Clean up on unmount (optional - composable persists with component)
onUnmounted(() => unregister?.());
```

### With useAutoAnimations

```typescript
import { useAutoAnimations } from 'boardsmith/ui';

const { flyingElements } = useAutoAnimations({
  gameView: () => props.gameView,
  containers: [
    { element: board, ref: boardRef, flipWithin: '[data-piece-id]' },
  ],

  // Register animation event handlers declaratively
  eventHandlers: {
    combat: async (event) => {
      await playCombatAnimation(event.data);
    },
    score: async (event) => {
      await playScoreAnimation(event.data);
    },
  },

  // Required when using eventHandlers
  animationEvents,
});
```

### ActionPanel Gating

```typescript
// actionController automatically gates on animations
const actionController = useActionController({
  // ... other options ...
  animationEvents, // Pass animation events for gating
});

// In template:
// actionController.showActionPanel gates on:
// 1. isMyTurn
// 2. !animationsPending
// 3. !pendingFollowUp
```

### Skip Animations

```typescript
// User wants to skip remaining animations
const animations = useAnimationEvents();

function onSkipClick() {
  animations?.skipAll();
  // Queue clears, events acknowledged, isAnimating becomes false
}
```

## State of the Art

| Component | Status | Documentation Needed |
|-----------|--------|---------------------|
| `game.emitAnimationEvent()` | Implemented (Phase 59) | Document API and examples |
| `game.pendingAnimationEvents` | Implemented (Phase 59) | Document usage pattern |
| `game.acknowledgeAnimationEvents()` | Implemented (Phase 59) | Document cleanup flow |
| `createAnimationEvents()` | Implemented (Phase 61) | Full composable docs |
| `useAnimationEvents()` | Implemented (Phase 61) | Inject/consume pattern |
| `registerHandler()` | Implemented (Phase 61) | Handler registration docs |
| `skipAll()`, `paused` | Implemented (Phase 61) | Control API docs |
| `animationsPending` | Implemented (Phase 62) | Explain gating |
| `showActionPanel` | Implemented (Phase 62) | Explain three conditions |
| `eventHandlers` option | Implemented (Phase 62) | Declarative registration |

**No deprecated patterns** - this is a new feature with no legacy approaches.

## Implementation Strategy

### Task 1: Add Animation Events Section to ui-components.md

Location: After the existing composables section (around line 1100)

Add sections:
1. Overview/concept explanation (soft continuation)
2. Engine-side API
3. UI-side composable API
4. ActionController integration
5. Integration with useAutoAnimations
6. Complete examples
7. Troubleshooting/pitfalls

### Task 2: Add Terminology to nomenclature.md

Add entries for:
1. Animation Event (in "Game Flow" or new "Animation" section)
2. Animation Handler
3. Soft Continuation

Consider adding to existing terms:
- ActionPanel: note animation gating
- Game: note emitAnimationEvent method

### Task 3: Review and Verify

- Ensure code examples are accurate to current implementation
- Ensure terminology is consistent with existing nomenclature
- Verify cross-references between ui-components.md and nomenclature.md

## Open Questions

None - the implementation is complete (Phases 59-62), and documentation scope is well-defined (DOC-01, DOC-02).

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` - Animation event types and methods (lines 133-152, 2295-2371)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useAnimationEvents.ts` - Full UI composable (275 lines)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.ts` - Animation gating (lines 1409-1464)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useAutoAnimations.ts` - eventHandlers integration (lines 177-218)
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/ActionPanel.vue` - ActionPanel gating (lines 88-99, 1372-1380)
- `/Users/jtsmith/BoardSmith/.planning/phases/62-actioncontroller-integration/62-RESEARCH.md` - Phase 62 design context
- `/Users/jtsmith/BoardSmith/.planning/STATE.md` - Prior decisions on animation system

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/src/session/game-session.ts` - acknowledgeAnimations session method (line 626)
- `/Users/jtsmith/BoardSmith/docs/ui-components.md` - Existing documentation structure
- `/Users/jtsmith/BoardSmith/docs/nomenclature.md` - Existing terminology format

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Documentation-only phase, no code changes
- Architecture: HIGH - System fully implemented in prior phases
- Content: HIGH - Source code and JSDoc provide authoritative reference
- Examples: HIGH - Tests and existing code provide verified patterns

**Research date:** 2026-01-22
**Valid until:** Indefinite - documenting existing stable implementation
