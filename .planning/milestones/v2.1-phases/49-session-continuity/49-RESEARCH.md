# Phase 49: session-continuity - Research

**Researched:** 2026-01-19
**Domain:** Session state detection, interrupted workflow recovery, graceful error handling
**Confidence:** HIGH

## Summary

Phase 49 implements session continuity for the `/design-game` skill - detecting when a designer returns mid-phase and resuming execution from where it left off. This completes the state detection requirements (STATE-03) and implements resume/recovery (RES-01 through RES-03).

The key insight from Phase 48 research carries forward: **STATE.md is the claim, artifacts are the proof**. Mid-phase detection combines:
1. STATUS field check (not "Complete")
2. Progress checkpoint analysis (which checkboxes are checked)
3. Artifact validation (do files exist and compile)

The "Resume Flow" is essentially a state machine that determines where the designer stopped and picks up from the next uncompleted checkpoint. Error recovery follows the existing "silent repair protocol" - fix issues automatically without interrogating the designer.

**Primary recommendation:** Implement resume as a checkpoint-based state machine that reads Progress checkboxes to determine entry point, validates artifacts at each checkpoint, and proceeds to the next pending step. Display "Picking up where we left off..." with progress context.

## Standard Stack

This phase is conversational AI instructions, not library code. The "stack" is the STATE.md checkpoint system established in Phases 47-48.

### Core Components
| Component | Purpose | Why Standard |
|-----------|---------|--------------|
| STATE.md Status field | Primary state detection | "In Progress" vs "Complete" from Phase 47 |
| Progress checkboxes | Checkpoint tracking | Lists exactly what's done/pending |
| Last Action field | Context for resumption | Tells designer what was happening |
| Artifact validation | Truth verification | tsc --noEmit + file existence |

### State Detection Matrix
| Status | Progress | Next Action |
|--------|----------|-------------|
| Complete | All [x] | Phase 8-14 Continuation Flow |
| Complete | Not all [x] | Invalid - fix then continue |
| In Progress | Some [x] | Resume from first [ ] |
| In Progress | No [x] | Start from beginning of phase |

### Supporting Patterns
| Pattern | Purpose | Established In |
|---------|---------|----------------|
| Silent repair protocol | Fix broken code without asking | Phase 48 |
| ACDR governor | Scope control during interviews | Phase 47 |
| tsc --noEmit validation | Verify code compiles | Phase 47 |

## Architecture Patterns

### Pattern 1: Checkpoint-Based Resume
**What:** Determine resume point by analyzing Progress checkboxes
**When to use:** When STATE.md Status shows "In Progress"

The Progress section defines explicit checkpoints:

**Phase 1 (Initial Generation) Checkpoints:**
```markdown
## Progress
- [ ] Interview complete         → Resume at Phase 2 (Structured Interview)
- [ ] PROJECT.md created         → Resume at Phase 4 (Create Artifacts)
- [ ] Code generated             → Resume at Phase 5 (Generate Initial Code)
- [ ] Code compiles              → Resume at Phase 6 (Verify Compilation)
- [ ] Ready for playtest         → Resume at Phase 7 (Playtest Prompt)
```

**Phase N (Feature Iteration) Checkpoints:**
```markdown
## Progress
- [ ] Feature selected           → Resume at Phase 10 (Present Options)
- [ ] Mini-interview complete    → Resume at Phase 11 (Mini-Interview)
- [ ] Rules implemented          → Resume at Phase 12 (Generate Code)
- [ ] UI implemented             → Resume at Phase 12 (Generate Code)
- [ ] Code compiles              → Resume at Phase 12 verification step
- [ ] Ready for playtest         → Resume at Phase 14 (Playtest Prompt)
```

**Resume Logic:**
```
Read STATE.md
├─► Status = "Complete" → Continuation Flow (Phases 8-14)
└─► Status = "In Progress"
    ├─► Find first unchecked [ ] in Progress
    ├─► Validate all prior checked [x] artifacts exist
    │   ├─► All valid → Resume at checkpoint
    │   └─► Some invalid → Backtrack to first invalid checkpoint
    └─► Execute from determined checkpoint
```

### Pattern 2: Context Display on Resume
**What:** Show designer what was in progress and what remains
**When to use:** At start of resume flow

Display format:
```markdown
## Picking Up Where We Left Off

**Phase:** 2 - Card Trading
**Last Action:** Completed mini-interview for trading feature

**Done:**
- [x] Feature selected: Card Trading
- [x] Mini-interview complete

**Remaining:**
- [ ] Rules implementation
- [ ] UI implementation
- [ ] Verification

Continuing with rules implementation...
```

**Key principles:**
- Show phase context (name, not just number)
- Show Last Action for continuity
- Show done/remaining split for orientation
- Clear "Continuing with X..." to set expectations

### Pattern 3: Artifact Validation at Checkpoints
**What:** Verify claimed progress matches reality before proceeding
**When to use:** When resuming at any checkpoint

Validation per checkpoint:

| Checkpoint | Validation |
|------------|------------|
| Interview complete | PROJECT.md exists with Core Mechanics populated |
| PROJECT.md created | PROJECT.md and STATE.md exist |
| Code generated | src/rules/*.ts files exist |
| Code compiles | `npx tsc --noEmit` passes |
| Rules implemented | Action function exists in actions.ts |
| UI implemented | Vue component exists in src/ui/ |
| Ready for playtest | Code compiles + all above valid |

**Validation failure handling:**
```
Checkpoint "Code compiles" checked but tsc fails
    ├─► Display: "Let me fix that first..."
    ├─► Run silent repair protocol (from Phase 48)
    └─► Resume from current checkpoint (not backtrack)
```

### Pattern 4: Error Recovery Hierarchy
**What:** Handle errors at different severity levels
**When to use:** When validation fails or unexpected state detected

Error severity levels:

| Level | Example | Response |
|-------|---------|----------|
| Recoverable | tsc fails, missing import | Silent repair, continue |
| Corrupt State | Progress claims X but artifact missing | Backtrack to valid checkpoint |
| Unrecoverable | STATE.md malformed/unparseable | Display error, offer fresh start |

**Recovery patterns:**

**Level 1 - Recoverable:**
```
"Let me fix that first..."
[Silent repair]
[Continue from checkpoint]
```

**Level 2 - Corrupt State:**
```
"I noticed some files are missing. Let me catch up..."
[Uncheck invalid checkboxes]
[Resume from earliest valid checkpoint]
```

**Level 3 - Unrecoverable:**
```
"I couldn't parse your design state. Here are your options:
1. Show me your PROJECT.md and I'll help you recover
2. Start fresh with a new `/design-game` interview"
```

### Anti-Patterns to Avoid
- **Interrogating the designer:** Don't ask "where were you?" - figure it out from STATE.md
- **Starting over:** Don't force restart when recovery is possible
- **Silent backtracking:** If backing up to earlier checkpoint, explain why
- **Skipping validation:** Always validate artifacts before proceeding, even for "checked" items

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State parsing | Custom STATE.md parser | Read markdown sections | STATE.md is human-readable |
| Code validation | Custom TypeScript analysis | `npx tsc --noEmit` | Already integrated |
| File existence | Complex file system checks | Simple Read operation | Claude can read files directly |
| Error fixing | Custom repair logic | Silent repair protocol | Established in Phase 48 |

**Key insight:** Phase 49 is routing logic on top of existing flows (Phases 2-14), not new functionality. The work is detecting WHERE to enter, not WHAT to do once there.

## Common Pitfalls

### Pitfall 1: Overly Chatty Resume
**What goes wrong:** Asking designer lots of questions about state
**Why it happens:** Trying to be helpful, confirm understanding
**How to avoid:** Trust STATE.md + artifacts, just show context and proceed
**Warning signs:** More than 2 exchanges before resuming work

### Pitfall 2: False Backtracking
**What goes wrong:** Backing up further than necessary on validation failure
**Why it happens:** Overly conservative - "something is wrong, start over"
**How to avoid:** Validate each checkpoint independently, only backtrack to first failure
**Warning signs:** Designer has to re-do work they already completed

### Pitfall 3: Infinite Repair Loop
**What goes wrong:** Repair fails, retry repair, fails again, stuck
**Why it happens:** Root cause isn't what repair protocol addresses
**How to avoid:** Limit repair attempts (2-3), then escalate to error display
**Warning signs:** Same tsc error appearing repeatedly

### Pitfall 4: Lost Context
**What goes wrong:** Resume continues but forgets mini-interview decisions
**Why it happens:** STATE.md doesn't capture interview answers
**How to avoid:** Answers should be in PROJECT.md or generated code, not just STATE.md
**Warning signs:** Designer asked same questions they already answered

### Pitfall 5: Mid-Interview Interrupt
**What goes wrong:** Designer interrupted during Q&A, can't resume interview
**Why it happens:** Interviews are multi-turn, hard to checkpoint mid-conversation
**How to avoid:** Keep interviews short (2-4 questions), checkpoint after each answer in STATE.md Last Action
**Warning signs:** "Interview complete" is all-or-nothing

## Code Examples

### STATE.md Mid-Phase Example (Phase 1)
```markdown
# Gem Collector - Design State

## Current Phase
**Phase:** 1 - Initial Generation
**Status:** In Progress

## Progress
- [x] Interview complete
- [x] PROJECT.md created
- [x] Code generated
- [ ] Code compiles          ← First unchecked = resume point
- [ ] Ready for playtest

## Last Action
Generated initial code, encountered compilation error

## Next Steps
Fix compilation errors and verify
```

### STATE.md Mid-Phase Example (Phase N)
```markdown
# Gem Collector - Design State

## Current Phase
**Phase:** 2 - Card Trading
**Status:** In Progress

## Progress
- [x] Feature selected
- [x] Mini-interview complete
- [ ] Rules implemented       ← First unchecked = resume point
- [ ] UI implemented
- [ ] Code compiles
- [ ] Ready for playtest

## Last Action
Completed mini-interview for card trading feature

## Next Steps
Implement trading action and UI
```

### Resume Flow Decision Tree
```
/design-game invoked
     │
     ├─► No PROJECT.md? ──► Start Interview (Phase 2)
     │
     ├─► Has PROJECT.md, read STATE.md
     │   │
     │   ├─► Status: "Complete"
     │   │   └─► Validation passes? ──► Continuation Flow (Phase 8)
     │   │       └─► Fails? ──► Actually "In Progress", repair and continue
     │   │
     │   └─► Status: "In Progress"
     │       │
     │       ├─► Display: "Picking up where we left off..."
     │       ├─► Show progress context
     │       │
     │       ├─► Find first unchecked [ ] in Progress
     │       │   └─► Validate prior [x] items
     │       │       ├─► All valid ──► Resume at checkpoint
     │       │       └─► Invalid ──► Repair or backtrack
     │       │
     │       └─► Resume execution
```

### Instructions.md Resume Section Structure
```markdown
## Phase 15: Resume Flow

When STATE.md shows Status: "In Progress", the designer is returning mid-session.

### Step 1: Display Context

Show what was in progress:

> "Picking up where we left off...
>
> **Phase:** [N] - [Feature Name]
> **Last Action:** [From STATE.md]
>
> **Progress:**
> [Show checked items]
>
> **Remaining:**
> [Show unchecked items]"

### Step 2: Determine Resume Point

Find the first unchecked [ ] in Progress:
- Interview complete → Resume at Phase 2
- PROJECT.md created → Resume at Phase 4
- Code generated → Resume at Phase 5
- Code compiles → Resume at Phase 6
- Ready for playtest → Resume at Phase 7

For iteration phases (Phase 2+):
- Feature selected → Resume at Phase 10
- Mini-interview complete → Resume at Phase 11
- Rules/UI implemented → Resume at Phase 12
- Code compiles → Resume at Phase 12 verification
- Ready for playtest → Resume at Phase 14

### Step 3: Validate Prior Checkpoints

Before resuming, verify all checked [x] items are actually done:
- FILES: Do expected files exist?
- COMPILE: Does `npx tsc --noEmit` pass?

If validation fails:
1. Display: "Let me fix that first..."
2. Use silent repair protocol
3. Re-validate
4. If still failing after 2 attempts: backtrack to earlier checkpoint

### Step 4: Resume Execution

Proceed with the determined phase, as if the designer had just completed the prior step.
```

### Error Recovery Display Examples

**Recoverable Error:**
```markdown
Picking up where we left off...

**Phase:** 1 - Initial Generation
**Last Action:** Generated initial code

Let me fix a compilation issue first...

[Silent repair]

Code now compiles. Continuing...
```

**Corrupt State Error:**
```markdown
Picking up where we left off...

**Phase:** 2 - Card Trading

I noticed some files are missing. Let me catch up...

The trading action code wasn't saved. I'll regenerate it based on your previous answers:
- Active player can propose trade with any player
- One-for-one card swap
- Trading replaces normal turn action

[Regenerate code]

Done! Continuing with verification...
```

**Unrecoverable Error:**
```markdown
I couldn't understand your design state file. Here are your options:

1. **Let me try to recover:** Share your PROJECT.md content and I'll reconstruct
2. **Start fresh:** We can begin a new `/design-game` interview

Which would you prefer?
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No mid-phase handling | Checkpoint-based resume | Phase 49 (this phase) | Interrupted sessions recoverable |
| Ask designer where they were | Detect from STATE.md | Phase 49 (this phase) | No designer interrogation |
| Binary complete/incomplete | Progress checkbox granularity | Phase 47 | Fine-grained resume points |

**Reference from AI workflow research:**
- [Amazon Bedrock AgentCore Memory](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/) introduces "conversation bookmarks" for marking important decision points - similar to our checkpoint system
- [StateFlow research](https://openreview.net/forum?id=3nTbuygoop) conceptualizes task-solving as state machines with explicit transitions - aligns with our Progress checkbox approach
- [LangGraph checkpointing patterns](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025) emphasizes persistent state with swap/preserve strategies for interrupted tasks

**Deprecated/outdated:**
- None (this is new functionality)

## Open Questions

1. **Mid-interview interruption handling**
   - What we know: Interviews are 2-4 questions, interruption could happen between questions
   - What's unclear: How to checkpoint partial interview state
   - Recommendation: Use Last Action to track "Asked about components, awaiting response" - but accept that some re-asking may be needed. Keep interviews short to minimize impact.

2. **Multiple failures during repair**
   - What we know: Silent repair could fail repeatedly
   - What's unclear: When to give up and ask designer for help
   - Recommendation: Limit to 2-3 repair attempts, then display error with options. Don't loop forever.

3. **Dependency/version changes between sessions**
   - What we know: Designer might update BoardSmith between sessions
   - What's unclear: How to handle API changes that break previously-working code
   - Recommendation: This is edge case - treat as recoverable error, attempt repair. If can't fix, display error explaining the situation.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/instructions.md` - Current Phase 1-14 implementation
- `/Users/jtsmith/BoardSmith/.planning/phases/48-continuation-flow/48-RESEARCH.md` - Phase 48 research establishing validation and repair patterns
- `/Users/jtsmith/BoardSmith/.planning/phases/48-continuation-flow/48-CONTEXT.md` - User decisions on state detection

### Secondary (MEDIUM confidence)
- [Amazon Bedrock AgentCore Memory](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/) - Multi-session task patterns
- [StateFlow research](https://openreview.net/forum?id=3nTbuygoop) - State machine paradigm for LLM tasks
- [LangGraph Checkpointing](https://sparkco.ai/blog/mastering-langgraph-checkpointing-best-practices-for-2025) - Durable state patterns

### Tertiary (LOW confidence)
- General session recovery patterns from web search - applied to specific context

## Metadata

**Confidence breakdown:**
- State detection (STATE-03): HIGH - Direct extension of existing STATE.md patterns
- Resume flow (RES-01): HIGH - Checkpoint system is well-defined
- Progress display (RES-02): HIGH - Clear format established
- Error recovery (RES-03): MEDIUM - Some edge cases in repair protocol limits

**Research date:** 2026-01-19
**Valid until:** 2026-02-19 (30 days - stable domain, building on Phase 47-48 patterns)
