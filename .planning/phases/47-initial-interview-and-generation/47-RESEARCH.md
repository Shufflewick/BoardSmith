# Phase 47: Initial Interview and Generation - Research

**Researched:** 2026-01-19
**Domain:** Claude Code slash command design, BoardSmith code generation, iterative game design workflow
**Confidence:** HIGH

## Summary

This phase transforms the `/design-game` slash command from a monolithic code generator into an iterative, state-driven skill for non-programmer game designers. The research covered three domains:

1. **BoardSmith code patterns** - Analyzed Hex and Go Fish implementations to understand the required file structure (elements.ts, game.ts, flow.ts, actions.ts, index.ts) and common patterns for different game types (connection games vs card games).

2. **Existing skill infrastructure** - Reviewed the current design-game.template.md and instructions.md to understand the baseline, plus generate-ai-instructions.md as a model for phased slash command design.

3. **Governor pattern design** - Researched effective techniques for scope management in conversational AI interactions, focused on capture-and-defer patterns.

**Primary recommendation:** Build the skill as a state machine with distinct phases (no-project detection, structured interview, artifact generation) and use explicit deferred-ideas tracking to prevent scope creep while preserving designer creativity.

## Standard Stack

The skill is implemented as a Claude Code slash command, not a library. There are no npm dependencies.

### Core Components
| Component | Purpose | Why Standard |
|-----------|---------|--------------|
| Slash command template | Entry point in ~/.claude/commands/ | Claude Code's slash command system |
| Instructions markdown | Detailed skill instructions | Established pattern from /generate-ai |
| State files (PROJECT.md, STATE.md) | Persist game state across sessions | Enables iterative development |
| BoardSmith CLI | Code generation verification | `tsc --noEmit` validates generated code |

### Supporting Artifacts
| Artifact | Purpose | When Created |
|----------|---------|--------------|
| PROJECT.md | Game identity, core mechanics, deferred ideas | After interview |
| STATE.md | Current phase, progress tracking | After interview |
| Phase PLAN.md | Task breakdown for current phase | Before code generation |
| Generated code files | elements.ts, game.ts, flow.ts, actions.ts, index.ts | During generation |

### File Structure
```
game-project/
├── PROJECT.md              # Game identity and mechanics
├── STATE.md                # Progress tracking
├── src/
│   └── rules/
│       ├── elements.ts     # Custom element classes
│       ├── game.ts         # Main game class
│       ├── actions.ts      # Player actions
│       ├── flow.ts         # Turn/round structure
│       └── index.ts        # Exports and gameDefinition
├── boardsmith.json         # Game configuration
└── package.json            # Dependencies
```

## Architecture Patterns

### Pattern 1: State Detection Flow
**What:** The skill detects current state and routes to appropriate behavior
**When to use:** At the start of every `/design-game` invocation

```
/design-game invoked
     │
     ├─► No .planning/ folder? ──► Start Interview
     │
     ├─► No PROJECT.md? ──► Start Interview
     │
     ├─► Has PROJECT.md, STATE.md shows "phase complete"? ──► Continuation Flow (Phase 48)
     │
     └─► Has PROJECT.md, STATE.md shows "phase in progress"? ──► Resume Flow (Phase 49)
```

### Pattern 2: Structured Interview with Governor
**What:** Gather requirements through focused questions while deferring out-of-scope ideas
**When to use:** When no project exists

Interview flow:
1. **Open question** - "Tell me about your game" (captures vision, theme, excitement)
2. **Component prompts** - Cards? Dice? Board? Tokens? (structured, bounded)
3. **Turn structure** - Sequential/simultaneous/phases
4. **Round completion** - How does a round end?
5. **Game end** - What triggers game over?
6. **Summary and confirmation**

Governor pattern:
```
Designer mentions scoring details, card abilities, strategy tips, etc.
     │
     └─► ACKNOWLEDGE: "Great idea about variable scoring!"
         CAPTURE: Add to PROJECT.md Deferred Ideas section
         DEFER: "Let's capture that for later"
         REDIRECT: "For now, what basic components do you need?"
```

### Pattern 3: Minimal Viable Generation
**What:** Generate only enough code to be playable, not complete
**When to use:** Phase 1 code generation

Phase 1 generates:
- **elements.ts** - Component types from interview (Card, Hand, Deck for card games; Board, Cell, Piece for board games)
- **game.ts** - Basic setup, registerElements, placeholder isFinished()/getWinners()
- **flow.ts** - Simple turn loop from turn structure info
- **actions.ts** - Single placeholder action (e.g., "play" or "move")
- **index.ts** - Game definition export

The goal is compilation + playtest loop, not feature completeness.

### Pattern 4: Playtest-Driven Iteration
**What:** After each phase, prompt designer to playtest and gather feedback
**When to use:** After code generation completes

```markdown
## Ready to Playtest!

Your game compiles and runs. Here's how to test it:

1. Run `boardsmith dev` to start the development server
2. Play a few turns with the current simple actions
3. Come back and run `/design-game` again to tell me:
   - What worked well?
   - What felt missing?
   - What do you want to add next?

Your Deferred Ideas (from our earlier conversation):
- Variable scoring based on card combinations
- Special "wild" cards
- Trading between players
```

### Anti-Patterns to Avoid
- **Scope creep during interview** - Asking for all details upfront leads to overwhelming complexity. Capture ideas but defer implementation.
- **Generating complete code in one pass** - Results in code that doesn't match designer's mental model. Generate minimal, iterate.
- **Free-form interview** - Leads to missing critical structure info. Use structured prompts for component types, turn structure, end conditions.
- **Ignoring deferred ideas** - Designers feel unheard. Always acknowledge and capture to Deferred Ideas.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State detection | Custom file checks | Check for .planning/ and PROJECT.md existence | Simple, robust |
| Code validation | Custom TypeScript parsing | `tsc --noEmit` | Already integrated, catches real errors |
| Project scaffold | Generate all files manually | `boardsmith init <name>` then modify | Creates correct structure |
| Turn flow patterns | Complex custom flows | Use existing flow primitives (loop, eachPlayer, actionStep) | Well-tested, documented |

**Key insight:** The skill orchestrates existing BoardSmith tooling rather than reimplementing it.

## Common Pitfalls

### Pitfall 1: Interview Scope Explosion
**What goes wrong:** Designer mentions 20 different features, skill tries to implement them all
**Why it happens:** No boundary between "gathering info" and "planning implementation"
**How to avoid:** Governor pattern - acknowledge, capture to Deferred Ideas, redirect to core structure
**Warning signs:** Interview taking more than 10 questions, designer describing card effects in detail

### Pitfall 2: Generated Code That Doesn't Match Mental Model
**What goes wrong:** Code compiles but doesn't feel like the designer's game
**Why it happens:** Generating too much at once without validation
**How to avoid:** Phase 1 = absolute minimum (basic turn, single action), iterate from there
**Warning signs:** Designer confused by generated code, asking "why did it add X?"

### Pitfall 3: State File Corruption
**What goes wrong:** Interrupted session leaves STATE.md in inconsistent state
**Why it happens:** State updated before action completes
**How to avoid:** Update STATE.md as last step of each operation, include "last action" for recovery
**Warning signs:** STATE.md shows phase started but no code exists

### Pitfall 4: Component Type Mismatch
**What goes wrong:** Designer says "cards" but means tokens, or "board" but means a deck
**Why it happens:** Board game terminology is ambiguous
**How to avoid:** Show concrete examples during structured prompts ("Cards like playing cards? Or tiles? Or resource tokens?")
**Warning signs:** Designer clarifies terminology multiple times

### Pitfall 5: Turn Structure Ambiguity
**What goes wrong:** Generated flow doesn't match how designer imagines turns
**Why it happens:** "Sequential turns" can mean many things
**How to avoid:** Offer specific patterns: "Player 1 does everything, then Player 2? Or Player 1 does one thing, then Player 2 does one thing, alternating?"
**Warning signs:** Designer describes complex turn phases after generation

## Code Examples

### elements.ts for Card Game (Go Fish pattern)
```typescript
// Source: /Users/jtsmith/BoardSmith/packages/games/go-fish/rules/src/elements.ts
import { Card as BaseCard, Hand as BaseHand, Deck, Space, Player } from '@boardsmith/engine';

// Custom card with game-specific properties
export class Card extends BaseCard<MyGame, MyPlayer> {
  suit!: 'Red' | 'Blue' | 'Green';  // Use EXACT values from interview
  rank!: string;
}

export class Hand extends BaseHand<MyGame, MyPlayer> {}
export class DrawPile extends Deck<MyGame, MyPlayer> {}

export class MyPlayer extends Player {
  score: number = 0;
}

import type { MyGame } from './game.js';
```

### elements.ts for Board Game (Hex pattern)
```typescript
// Source: /Users/jtsmith/BoardSmith/packages/games/hex/rules/src/elements.ts
import { Piece, Grid, GridCell, Player } from '@boardsmith/engine';

export class Piece extends BasePiece<MyGame, MyPlayer> {
  // Game-specific piece properties
}

export class Cell extends GridCell<MyGame, MyPlayer> {
  row!: number;
  col!: number;

  isEmpty(): boolean {
    return this.count(Piece) === 0;
  }
}

export class Board extends Grid<MyGame, MyPlayer> {
  getCell(row: number, col: number): Cell | undefined {
    return this.first(Cell, { row, col });
  }
}

export class MyPlayer extends Player {}
```

### game.ts Minimal Template
```typescript
// Source: Derived from hex/rules/src/game.ts and go-fish/rules/src/game.ts
import { Game, type GameOptions } from '@boardsmith/engine';
import { /* Elements */ } from './elements.js';
import { createPlaceholderAction } from './actions.js';
import { createGameFlow } from './flow.js';

export interface MyGameOptions extends GameOptions {}

export class MyGame extends Game<MyGame, MyPlayer> {
  static PlayerClass = MyPlayer;

  // Game state
  // board!: Board;  // For board games
  // deck!: DrawPile;  // For card games

  constructor(options: MyGameOptions) {
    super(options);

    // Register element classes
    this.registerElements([/* All element classes */]);

    // Create game elements
    // this.board = this.create(Board, 'board');
    // this.deck = this.create(DrawPile, 'deck');

    // Setup (shuffle, deal, etc.)

    // Register actions
    this.registerAction(createPlaceholderAction(this));

    // Set flow
    this.setFlow(createGameFlow(this));
  }

  override isFinished(): boolean {
    // TODO: Implement game end condition
    return false;
  }

  override getWinners(): MyPlayer[] {
    // TODO: Implement winner determination
    return [];
  }
}
```

### flow.ts Simple Turn Loop
```typescript
// Source: Derived from hex/rules/src/flow.ts
import { loop, eachPlayer, actionStep, type FlowDefinition } from '@boardsmith/engine';
import type { MyGame } from './game.js';

export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 1000,
      do: eachPlayer({
        name: 'player-turns',
        do: actionStep({
          name: 'player-action',
          actions: ['placeholder'],  // Replace with real actions
        }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
```

### actions.ts Placeholder Action
```typescript
// Source: Derived from hex/rules/src/actions.ts
import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { MyGame } from './game.js';

export function createPlaceholderAction(game: MyGame): ActionDefinition {
  return Action.create('placeholder')
    .prompt('Take your turn')
    .execute((args, ctx) => {
      game.message(`${ctx.player.name} took their turn`);
      return { success: true };
    });
}
```

### index.ts Game Definition
```typescript
// Source: Derived from hex/rules/src/index.ts
export { MyGame, type MyGameOptions } from './game.js';
export { /* Elements */ } from './elements.js';
export { createPlaceholderAction } from './actions.js';
export { createGameFlow } from './flow.js';

import { MyGame } from './game.js';

export const gameDefinition = {
  gameClass: MyGame,
  gameType: 'my-game',
  displayName: 'My Game',
  minPlayers: 2,
  maxPlayers: 4,
};
```

### PROJECT.md Template
```markdown
# [Game Name]

## Identity
**Theme:** [One sentence theme/setting]
**Core Loop:** [One sentence description of what players do]
**Win Condition:** [How someone wins]

## Core Mechanics

### Components
- **Cards:** [Description, or "None"]
- **Board:** [Description, or "None"]
- **Dice:** [Description, or "None"]
- **Tokens:** [Description, or "None"]

### Turn Structure
[Sequential/Simultaneous, phases if any]

### Round End
[What triggers end of round]

### Game End
[What triggers end of game]

## Deferred Ideas
Ideas captured during design that we'll implement in later phases:

- [ ] [Idea 1]
- [ ] [Idea 2]
- [ ] [Idea 3]
```

### STATE.md Template
```markdown
# [Game Name] - Design State

## Current Phase
**Phase:** 1 - Initial Generation
**Status:** [Not Started | In Progress | Complete]

## Progress
- [x] Interview complete
- [x] PROJECT.md created
- [ ] Code generated
- [ ] Code compiles
- [ ] Ready for playtest

## Last Action
[Description of what was last completed, for recovery]

## Playtest Notes
[Filled in after designer returns from playtesting]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic generation | Iterative phases | v2.1 (this milestone) | Designer feedback earlier, less wasted work |
| Free-form interview | Structured prompts + governor | v2.1 | Consistent info gathering, scope control |
| Generate-and-hope | Compile verification | Existing | Catches errors before playtest |

**Deprecated/outdated:**
- The existing instructions.md uses a 16-question interview that's too comprehensive for first pass
- The existing approach generates complete actions in one pass rather than placeholder-first

## Open Questions

1. **How granular should deferred ideas be?**
   - What we know: Need to capture ideas without implementing
   - What's unclear: Should we categorize (mechanics vs content vs polish)?
   - Recommendation: Keep as flat list initially, categorize if list grows large

2. **Should Phase 1 include any real actions?**
   - What we know: Need something playable for feedback
   - What's unclear: Is a single placeholder enough?
   - Recommendation: Generate one real action based on primary game interaction (e.g., "play a card" for card games)

3. **boardsmith.json handling**
   - What we know: Need to create/update it
   - What's unclear: How much should be auto-detected vs configured
   - Recommendation: Generate minimal boardsmith.json, let designer customize later

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/packages/games/hex/rules/src/` - Complete Hex implementation
- `/Users/jtsmith/BoardSmith/packages/games/go-fish/rules/src/` - Complete Go Fish implementation
- `/Users/jtsmith/BoardSmith/docs/getting-started.md` - Official project structure
- `/Users/jtsmith/BoardSmith/docs/core-concepts.md` - Element system, actions, flow
- `/Users/jtsmith/BoardSmith/docs/actions-and-flow.md` - Flow primitives, action patterns

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/instructions.md` - Existing interview approach
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/generate-ai-instructions.md` - Model for phased skill design

### Tertiary (LOW confidence)
- General Claude Code slash command patterns - Based on generate-ai implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Based on existing implementations
- Architecture: HIGH - Based on existing game examples and slash command patterns
- Pitfalls: MEDIUM - Based on documentation and extrapolation from common LLM interaction issues

**Research date:** 2026-01-19
**Valid until:** 2026-02-19 (30 days - stable domain, existing patterns)
