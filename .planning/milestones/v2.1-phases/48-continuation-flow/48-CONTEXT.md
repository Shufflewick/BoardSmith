# Phase 48: continuation-flow - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Handle the designer's return after playtesting — gather feedback, surface options for what to build next, and execute a single feature iteration. The skill detects phase-complete state, collects structured feedback, ranks next steps, and implements the chosen feature with rules + basic UI.

</domain>

<decisions>
## Implementation Decisions

### Return Flow
- Show state first, then ask: "Phase X complete. What stood out from playtesting?"
- Feedback is optional — designer can say "nothing to report" and move on
- Use structured extraction to categorize feedback

### Feedback Categories
- **Works** — things that played well
- **Needs Fix** — broken or confusing mechanics
- **Ideas** — new ideas that emerged during play

### Option Presentation
- Rank by feedback: broken/confusing items first, then deferred ideas, then new ideas
- Recommend fixes first but allow designer to pick anything
- "I suggest fixing X first, but you can pick anything"

### Feature Interview
- Always do a mini-interview for the chosen feature (ACDR governor pattern)
- Gather specifics, defer edge cases to backlog
- Then implement rules + basic UI — complete enough to playtest visually

### Iteration Depth
- Each iteration includes rules AND basic UI
- Designer should be able to playtest visually, not just via text

### State Detection
- Primary: STATE.md status field (explicit 'complete' vs 'in-progress')
- Validation: artifacts must actually work
- "Complete" means: code compiles AND game session can start without errors
- Trust artifacts over state file claims — broken code = not complete

### Incomplete State Handling
- Auto-resume when detecting incomplete state
- "Picking up where we left off..." and continue
- (Full resume logic is Phase 49's domain — Phase 48 just detects "complete" reliably)

### Claude's Discretion
- Exact wording of feedback prompts
- How to display ranked options (list, numbered, etc.)
- What constitutes "basic UI" for different feature types

</decisions>

<specifics>
## Specific Ideas

- Pit of success: the easy path is the correct path
- Code truth > file claims (artifacts validate state)
- ACDR governor continues into feature interviews

</specifics>

<deferred>
## Deferred Ideas

- Full session resume logic — Phase 49 (session-continuity)
- Handling errors during feature implementation — Phase 49
- CLI setup for the skill — Phase 50

</deferred>

---

*Phase: 48-continuation-flow*
*Context gathered: 2026-01-20*
