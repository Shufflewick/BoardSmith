# Phase 48: continuation-flow - Research

**Researched:** 2026-01-19
**Domain:** Conversational AI workflow design, state machine patterns, feedback collection
**Confidence:** HIGH

## Summary

This phase implements the "return after playtesting" flow in the `/design-game` skill. The research focused on three areas:

1. **State detection and validation** - How to reliably detect "phase complete" state while ensuring artifacts actually work (code compiles, game starts). The key insight is that state files claim completion but artifacts prove it.

2. **Feedback collection patterns** - Structured extraction from freeform feedback into actionable categories (Works, Needs Fix, Ideas). The flow should be optional but encouraged.

3. **Feature iteration workflow** - How to present options, conduct mini-interviews, and generate code that includes both rules and basic UI for visual playtesting.

**Primary recommendation:** Build continuation flow as a structured conversation with clear phases: show status, gather optional feedback, present ranked options, conduct mini-interview for chosen feature, generate complete (rules + UI) code, verify, and prompt for next playtest.

## Standard Stack

This is a conversational AI skill, not a library implementation. The "stack" is the instructions.md structure and artifact templates.

### Core Components
| Component | Purpose | Why Standard |
|-----------|---------|--------------|
| STATE.md Status field | Primary "phase complete" detection | Explicit state tracking from Phase 47 |
| Artifact validation | Secondary verification (tsc --noEmit + game start) | Prevents false "complete" states |
| HISTORY.md | Phase summary tracking | Preserves context across sessions |
| PROJECT.md Deferred Ideas | "What's next?" option source | Existing capture mechanism from governor pattern |

### Supporting Artifacts
| Artifact | Purpose | When Created |
|----------|---------|--------------|
| HISTORY.md | Cumulative log of completed phases | After each phase verification |
| Updated STATE.md | Track new phase progress | When feature selected |
| Updated PROJECT.md | Move implemented ideas from Deferred | After code generation |

### File Structure (Designer's Game Project)
```
game-project/
├── PROJECT.md              # Game identity, mechanics, Deferred Ideas
├── STATE.md                # Current phase, status, progress
├── HISTORY.md              # Completed phase summaries (NEW in Phase 48)
├── src/
│   └── rules/
│       ├── elements.ts     # Custom element classes
│       ├── game.ts         # Main game class
│       ├── actions.ts      # Player actions
│       ├── flow.ts         # Turn/round structure
│       └── index.ts        # Exports and gameDefinition
└── src/ui/                 # Vue components (added per-feature)
```

## Architecture Patterns

### Pattern 1: State Detection and Validation
**What:** Detect phase-complete state using STATE.md, validate with artifact checks
**When to use:** At start of `/design-game` when PROJECT.md exists

```
/design-game invoked
     │
     ├─► No PROJECT.md? ──► Start Interview (Phase 47)
     │
     ├─► Has PROJECT.md, read STATE.md
     │   │
     │   ├─► Status: "Complete"
     │   │   │
     │   │   ├─► Run: tsc --noEmit (code compiles?)
     │   │   │   │
     │   │   │   ├─► Passes ──► Continuation Flow (this phase)
     │   │   │   └─► Fails ──► Resume Flow (Phase 49) - fix broken state
     │   │   │
     │   │   └─► If tsc passes but game won't start ──► Resume Flow
     │   │
     │   └─► Status: "In Progress" ──► Resume Flow (Phase 49)
```

**Key insight:** STATE.md is the claim, artifacts are the proof. A STATE.md saying "Complete" with broken code is actually "In Progress" (needs Resume Flow).

### Pattern 2: Optional Feedback Collection
**What:** Gather playtest feedback through structured extraction, but allow skipping
**When to use:** After detecting phase-complete state

Conversation flow:
```
Claude: "Phase 1 complete. What stood out from playtesting?"

Designer: "The card drawing felt slow and I wanted to trade cards"

Claude extracts:
- Works: [nothing mentioned]
- Needs Fix: "card drawing felt slow"
- Ideas: "trading cards"

Claude: "Got it! Captured:
- Needs Fix: Card drawing feels slow
- Ideas: Card trading

Anything else, or should we move to what's next?"
```

**Skip path:**
```
Claude: "Phase 1 complete. What stood out from playtesting?"
Designer: "Nothing to report" / "Let's move on"
Claude: "No problem! Let's look at what to build next."
```

### Pattern 3: Ranked Option Presentation
**What:** Present options prioritized by urgency (broken > deferred > new)
**When to use:** After feedback collection

```markdown
## What's Next?

Based on your feedback and deferred ideas, here are your options:

**Recommended (fix first):**
1. Card drawing speed issue (from playtest feedback)

**From your idea backlog:**
2. Variable scoring: Blue gems worth 2, red worth 1
3. Bonus for collecting all colors
4. Card trading between players (from playtest feedback)

I suggest fixing the card drawing issue first since it affects core gameplay.
Which would you like to tackle?
```

**Ranking logic:**
1. Needs Fix items (broken/confusing mechanics) - highest priority
2. Deferred Ideas from PROJECT.md (already captured)
3. New Ideas from feedback (add to backlog if not chosen)

### Pattern 4: Feature Mini-Interview
**What:** Conduct focused interview for chosen feature using ACDR governor
**When to use:** After designer selects a feature

```
Designer picks: "Card trading"

Claude: "Great choice! Let me understand card trading better.

1. Who can trade with whom? (All players? Adjacent? Active player only?)
2. What can be traded? (Any cards? Same type only? Limited quantity?)
3. When can trading happen? (Any time? Start of turn? Special action?)"

[Designer answers, Claude captures core and defers edge cases]

Claude: "Got it. I'll implement:
- Active player can propose a trade with any other player
- Trade any cards, one-for-one
- Trading is a turn action (replaces normal action)

Captured for later:
- Multi-card trades
- Trade rejection mechanics
- Trade history tracking

Sound good?"
```

### Pattern 5: Complete Feature Generation (Rules + UI)
**What:** Generate both game rules and basic UI for visual playtesting
**When to use:** After feature interview is confirmed

Feature generation includes:
1. **Rules changes** - Update elements.ts, game.ts, actions.ts, flow.ts as needed
2. **Basic UI** - Create/update Vue components for the feature
3. **Wire-up** - Connect UI to actions through useBoardInteraction

**UI scope for basic implementation:**
- Functional controls (buttons, selectors)
- Clear visual feedback (highlights, states)
- No animations or polish (deferred)

### Anti-Patterns to Avoid
- **Mandatory feedback** - Makes designers feel interrogated. Keep it optional.
- **Overwhelming option lists** - If Deferred Ideas is huge, show top 5-7 with "see more".
- **Implementing without interview** - Even "obvious" features need specifics gathered.
- **Rules without UI** - Features must be visually playable, not just logically correct.
- **Over-scoping features** - Mini-interview should defer edge cases, implement core only.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State detection | Complex file parsing | Check STATE.md Status field | Simple, explicit |
| Code validation | Custom TypeScript parsing | `tsc --noEmit` | Already integrated |
| UI components | Custom Vue components | BoardSmith UI library | Consistent patterns |
| Action wiring | Custom event handling | useBoardInteraction composable | Standard pattern |

**Key insight:** Phase 48 orchestrates existing patterns from Phase 47 + BoardSmith UI library, not new mechanisms.

## Common Pitfalls

### Pitfall 1: False "Complete" State
**What goes wrong:** STATE.md says "Complete" but code is broken
**Why it happens:** Session interrupted before verification, or manual editing
**How to avoid:** Always validate with `tsc --noEmit` before proceeding
**Warning signs:** Errors when running tsc, game won't start in boardsmith dev

### Pitfall 2: Feature Scope Creep
**What goes wrong:** Mini-interview captures too much, feature becomes huge
**Why it happens:** Designer excited about full vision, Claude doesn't defer
**How to avoid:** ACDR pattern in mini-interview, explicit "captured for later" list
**Warning signs:** More than 3-4 requirements for a single feature

### Pitfall 3: Rules Without UI
**What goes wrong:** Feature works in code but designer can't see/interact with it
**Why it happens:** Easier to write rules than UI, skipping UI feels faster
**How to avoid:** Explicit requirement: every feature needs visual representation
**Warning signs:** Designer says "how do I test this?"

### Pitfall 4: Lost Playtest Context
**What goes wrong:** Designer mentions feedback, it gets forgotten after feature selection
**Why it happens:** Only chosen feature gets implemented, other feedback lost
**How to avoid:** New Ideas from feedback → add to PROJECT.md Deferred Ideas
**Warning signs:** Designer repeats feedback in future sessions

### Pitfall 5: HISTORY.md Bloat
**What goes wrong:** HISTORY.md becomes too long to be useful
**Why it happens:** Every detail included, not summarized
**How to avoid:** Keep phase summaries brief (3-5 bullets), link to STATE.md for details
**Warning signs:** HISTORY.md exceeds 50 lines per phase

## Code Examples

### STATE.md "Complete" State
```markdown
# Gem Collector - Design State

## Current Phase
**Phase:** 1 - Initial Generation
**Status:** Complete

## Progress
- [x] Interview complete
- [x] PROJECT.md created
- [x] Code generated
- [x] Code compiles
- [x] Ready for playtest

## Last Action
Verified compilation, prompted designer to playtest

## Next Steps
Run /design-game to continue after playtesting

## Playtest Notes
[To be filled after designer returns]
```

### STATE.md After Feature Selection
```markdown
# Gem Collector - Design State

## Current Phase
**Phase:** 2 - Card Trading
**Status:** In Progress

## Progress
- [x] Feature selected
- [x] Mini-interview complete
- [ ] Rules implemented
- [ ] UI implemented
- [ ] Code compiles
- [ ] Ready for playtest

## Last Action
Selected "Card Trading" feature, gathered requirements

## Next Steps
Implement trading action and UI

## Playtest Notes
Phase 1 feedback:
- Card drawing felt slow (captured for later)
- Wanted card trading (implementing now)
```

### HISTORY.md Template
```markdown
# Gem Collector - Design History

## Phase 1: Initial Generation
**Completed:** 2026-01-19
**What was built:**
- Basic game structure with gems and players
- Draw and play card actions
- Sequential turn flow
- Placeholder scoring

**Playtest feedback:**
- Card drawing felt slow
- Wanted card trading

**Deferred to backlog:**
- Variable scoring
- Bonus for collecting all colors

---
```

### PROJECT.md Deferred Ideas Update
After implementing a feature, move it from Deferred Ideas (with checkbox checked):

```markdown
## Deferred Ideas
Ideas captured during design that we'll implement in later phases:

- [x] Card trading between players (Phase 2)
- [ ] Variable scoring: Blue gems worth 2, red worth 1
- [ ] Bonus for collecting all colors
- [ ] Multi-card trades (captured Phase 2)
- [ ] Trade rejection mechanics (captured Phase 2)
```

### Feedback Extraction Pattern
```typescript
// Conceptual pattern for instructions.md, not actual code

// Designer says: "The cards felt slow to draw and I wish I could trade"

// Claude extracts into categories:
const feedback = {
  works: [],  // Nothing explicitly praised
  needsFix: [
    "Card drawing feels slow"  // Problem affecting gameplay
  ],
  ideas: [
    "Card trading"  // New feature request
  ]
};

// Response pattern:
// 1. Acknowledge each category
// 2. Confirm understanding
// 3. Ask if there's more
// 4. Proceed to options when done
```

### Instructions.md Continuation Section Structure
```markdown
## Continuation Flow (Phase 48)

When STATE.md shows Status: Complete:

### Step 1: Validate Completion
Run `tsc --noEmit` to verify code actually compiles.
- If fails: Proceed to Resume Flow (broken state)
- If passes: Continue to Step 2

### Step 2: Show Status and Gather Feedback
Display:
> "Phase [N] complete! What stood out from playtesting?"

Listen for:
- **Works** - Things that played well
- **Needs Fix** - Broken or confusing mechanics
- **Ideas** - New features that emerged during play

If designer says "nothing" or "let's move on", proceed to Step 3.

### Step 3: Present Ranked Options
Show options in priority order:
1. Needs Fix items (from feedback)
2. Deferred Ideas (from PROJECT.md)
3. New Ideas (from feedback, not in backlog)

Recommend fixing broken things first, but let designer choose.

### Step 4: Feature Mini-Interview
For the chosen feature:
- Ask 2-4 focused questions about specifics
- Use ACDR pattern for scope creep
- Confirm requirements before proceeding

### Step 5: Generate Feature Code
Implement:
- Rules: elements.ts, game.ts, actions.ts, flow.ts updates
- UI: Vue component for the feature
- Verify with tsc --noEmit

### Step 6: Update State Files
- STATE.md: New phase, progress checkboxes
- PROJECT.md: Check off implemented Deferred Idea
- HISTORY.md: Add phase summary

### Step 7: Playtest Prompt
Show what was built and prompt for playtesting.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trust state files | Validate with artifacts | v2.1 (this phase) | Prevents false "complete" |
| Free-form feedback | Structured extraction (Works/Fix/Ideas) | v2.1 (this phase) | Actionable categories |
| Generate rules only | Generate rules + UI | v2.1 (this phase) | Visual playtesting |
| Flat option list | Ranked by urgency | v2.1 (this phase) | Better prioritization |

**Deprecated/outdated:**
- None (this is new functionality)

## Open Questions

1. **What if all Deferred Ideas are done?**
   - What we know: Designer may complete all captured ideas
   - What's unclear: Should we prompt for new ideas or declare game "done"?
   - Recommendation: Prompt "Your backlog is empty. What would you like to add?" or "Ready to polish and ship?"

2. **How much UI is "basic"?**
   - What we know: Needs to be visual and interactive
   - What's unclear: Line between "basic" and "polished"
   - Recommendation: Functional controls + clear feedback, no animations/transitions

3. **HISTORY.md size management**
   - What we know: Grows with each phase
   - What's unclear: When does it become unwieldy?
   - Recommendation: Keep summaries brief (3-5 bullets per phase), archive old phases if > 20 phases

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/.planning/phases/48-continuation-flow/48-CONTEXT.md` - User decisions from discussion
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/instructions.md` - Phase 47 implementation
- `/Users/jtsmith/BoardSmith/.planning/phases/47-initial-interview-and-generation/47-RESEARCH.md` - Prior research

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/.planning/phases/47-initial-interview-and-generation/47-*-SUMMARY.md` - Implementation patterns from Phase 47

### Tertiary (LOW confidence)
- General conversational AI patterns - Based on Phase 47 governor pattern success

## Metadata

**Confidence breakdown:**
- State detection: HIGH - Based on explicit decisions in CONTEXT.md
- Feedback collection: HIGH - Based on decisions + Phase 47 patterns
- Feature generation: MEDIUM - UI requirements less specified, inferred from "visual playtesting" requirement
- HISTORY.md template: MEDIUM - New artifact, pattern extrapolated from SUMMARY.md format

**Research date:** 2026-01-19
**Valid until:** 2026-02-19 (30 days - stable domain, building on Phase 47 patterns)
