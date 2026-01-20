# Requirements: BoardSmith v2.1 Design-Game Skill Redesign

**Defined:** 2026-01-19
**Core Value:** Guide non-programmer game designers to a working game through iterative, playtest-driven development

## v1 Requirements

### State Detection

- [x] **STATE-01**: Detect "no project" state (no .planning/ or no PROJECT.md)
- [x] **STATE-02**: Detect "phase complete" state (STATE.md shows phase verified)
- [x] **STATE-03**: Detect "mid-phase" state (STATE.md shows phase in progress)
- [x] **STATE-04**: Single `/design-game` command adapts behavior to detected state

### Initial Interview

- [x] **INT-01**: Open question for game identity ("Tell me about your game")
- [x] **INT-02**: Structured prompts for component types (cards, dice, board, tokens)
- [x] **INT-03**: Structured prompts for turn structure (sequential, simultaneous, phases)
- [x] **INT-04**: Structured prompts for round completion (all players done, pass, etc.)
- [x] **INT-05**: Structured prompts for game end condition (deck empty, goal reached, etc.)
- [x] **INT-06**: Summary and confirmation before proceeding

### Governor Pattern

- [x] **GOV-01**: Instructions for detecting scope creep (content details, strategy, scoring)
- [x] **GOV-02**: Acknowledge/capture/defer/redirect pattern in instructions
- [x] **GOV-03**: Deferred Ideas section in PROJECT.md template

### Artifacts

- [x] **ART-01**: Game-specific PROJECT.md template (game identity, core mechanics, deferred ideas)
- [x] **ART-02**: STATE.md template for progress tracking
- [x] **ART-03**: Phase PLAN.md template
- [x] **ART-04**: HISTORY.md template for phase summaries

### Code Generation

- [x] **GEN-01**: Generate elements.ts from component types
- [x] **GEN-02**: Generate game.ts with basic setup
- [x] **GEN-03**: Generate flow.ts from turn/round/end structure
- [x] **GEN-04**: Generate actions.ts with placeholder actions
- [x] **GEN-05**: Verify generated code compiles (tsc --noEmit)

### Continuation Flow

- [x] **CON-01**: Ask about playtest results after phase completion
- [x] **CON-02**: Option to report bugs/issues from playtesting
- [x] **CON-03**: "What's next?" prompt showing deferred ideas
- [x] **CON-04**: Plan single feature as next phase

### Session Continuity

- [x] **RES-01**: Resume mid-phase from STATE.md
- [x] **RES-02**: Show progress and what was left to do
- [x] **RES-03**: Graceful error recovery with clear next steps

### CLI Integration

- [ ] **CLI-01**: `npx boardsmith claude` creates/updates ~/.claude skill file
- [ ] **CLI-02**: Instructions or automation for GSD dependency

## v2 Requirements (Deferred)

### Enhanced Features

- **ENH-01**: AI opponent generation integration
- **ENH-02**: Custom UI layout guidance
- **ENH-03**: Multi-game project support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full GSD integration | Design-game has its own lightweight iterative loop |
| Upfront roadmap | Roadmap emerges through playtesting, not planned ahead |
| Complex state machines | Keep it simple for non-programmers |
| Automatic playtesting | Designers must playtest manually to learn their game |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STATE-01 | Phase 47 | Complete |
| STATE-02 | Phase 48 | Complete |
| STATE-03 | Phase 49 | Complete |
| STATE-04 | Phase 47 | Complete |
| INT-01 | Phase 47 | Complete |
| INT-02 | Phase 47 | Complete |
| INT-03 | Phase 47 | Complete |
| INT-04 | Phase 47 | Complete |
| INT-05 | Phase 47 | Complete |
| INT-06 | Phase 47 | Complete |
| GOV-01 | Phase 47 | Complete |
| GOV-02 | Phase 47 | Complete |
| GOV-03 | Phase 47 | Complete |
| ART-01 | Phase 47 | Complete |
| ART-02 | Phase 47 | Complete |
| ART-03 | Phase 47 | Complete |
| ART-04 | Phase 48 | Complete |
| GEN-01 | Phase 47 | Complete |
| GEN-02 | Phase 47 | Complete |
| GEN-03 | Phase 47 | Complete |
| GEN-04 | Phase 47 | Complete |
| GEN-05 | Phase 47 | Complete |
| CON-01 | Phase 48 | Complete |
| CON-02 | Phase 48 | Complete |
| CON-03 | Phase 48 | Complete |
| CON-04 | Phase 48 | Complete |
| RES-01 | Phase 49 | Complete |
| RES-02 | Phase 49 | Complete |
| RES-03 | Phase 49 | Complete |
| CLI-01 | Phase 50 | Pending |
| CLI-02 | Phase 50 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-19*
*Last updated: 2026-01-19 after initial definition*
