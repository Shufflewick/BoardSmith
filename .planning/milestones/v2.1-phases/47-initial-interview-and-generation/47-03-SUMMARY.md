---
phase: 47-initial-interview-and-generation
plan: 03
subsystem: cli
tags: [cli, slash-commands, design-game, self-contained]

# Dependency graph
requires:
  - phase: 47-02
    provides: instructions.md with artifact templates and code generation
provides:
  - Self-contained /design-game and /generate-ai slash commands
  - No permission prompts when running commands
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Self-contained slash commands (embed instructions into installed file)

key-files:
  created: []
  modified:
    - src/cli/slash-command/instructions.md
    - src/cli/slash-command/generate-ai-instructions.md
    - src/cli/commands/install-claude-command.ts

key-decisions:
  - "Self-contained commands: Embed full instructions into installed .md files rather than referencing external files"
  - "Quick Reference section: Added condensed code reference (project structure, elements, actions, flow) to instructions.md"
  - "No external file reads: Eliminates permission prompts when running /design-game"

patterns-established:
  - "Embedded slash commands: Install process reads instructions and embeds into output"

# Metrics
duration: 15min
completed: 2026-01-19
---

# Phase 47 Plan 03: Template Update and Verification Summary

**Self-contained slash commands that require no external file permissions**

## Performance

- **Duration:** 15 min (including checkpoint discussion and fixes)
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- design-game.template.md updated (Task 1)
- instructions.md verified complete (Task 2)
- Human verification completed with improvements (Task 3)
- Self-contained slash commands implemented (deviation from plan)
- CLI install path bugs fixed

## Task Commits

1. **Task 1: Update design-game.template.md** - `c540ea7` (feat)
2. **Task 2: Verify instructions.md completeness** - verification only, no changes
3. **Task 3: Human verification** - led to improvements:
   - `be0fb8a` - fix(cli): update paths for post-monorepo structure
   - `c9bf0ec` - feat(47-03): make slash commands self-contained

## Files Created/Modified
- `src/cli/slash-command/instructions.md` - Added Quick Reference section (condensed code patterns)
- `src/cli/slash-command/generate-ai-instructions.md` - Removed BOARDSMITH_ROOT reference
- `src/cli/commands/install-claude-command.ts` - Embed instructions into installed commands

## Decisions Made
- **Self-contained approach:** User testing revealed permission prompts were UX friction. Changed from "template references external file" to "embed full content in installed file"
- **Quick Reference section:** Added condensed project structure, element types, action DSL, and flow primitives directly to instructions.md (removes need to read docs/)

## Deviations from Plan

**1. [Rule 2 - Auto-added] Self-contained commands**
- **Original plan:** Template points to instructions.md, Claude reads at runtime
- **Deviation:** Install command embeds full instructions into installed file
- **Rationale:** User testing showed external file references caused permission prompts
- **Impact:** Better UX, fully portable commands, no BoardSmith repo dependency at runtime

**2. [Rule 2 - Auto-added] Quick Reference section**
- **Original plan:** Reference docs/ files for patterns
- **Deviation:** Added condensed code patterns directly to instructions.md
- **Rationale:** External doc reads caused additional permission prompts
- **Impact:** Single self-contained file with all needed patterns

## Issues Encountered
- **CLI path bugs:** Post-monorepo collapse paths were wrong (packages/cli/src/ → src/cli/)
- **Root calculation:** 4 levels up → 3 levels up for bundled CLI
- **Permission prompts:** External file references triggered Claude Code permission dialogs

All issues resolved during checkpoint verification.

## User Setup Required

Run `npx boardsmith claude install --force` to update to self-contained commands.

## Next Phase Readiness
- Phase 47 complete
- Phase 48 (continuation-flow) can proceed

---
*Phase: 47-initial-interview-and-generation*
*Completed: 2026-01-19*
