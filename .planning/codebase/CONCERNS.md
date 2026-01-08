# Codebase Concerns

**Analysis Date:** 2026-01-08

## Tech Debt

**Large, complex files:**
- Issue: Several files exceed 2000 lines, making them hard to navigate and maintain
- Files:
  - `packages/session/src/game-session.ts` - 2,585 lines
  - `packages/ui/tests/useActionController.test.ts` - 2,088 lines
  - `packages/engine/src/action/action.ts` - 1,845 lines
  - `packages/ui/src/composables/useActionController.ts` - 1,807 lines
- Why: Organic growth as features added
- Impact: Harder to understand, navigate, and modify
- Fix approach: Split into smaller, focused modules by responsibility

**Type assertions bypassing safety:**
- Issue: Multiple `as any` type assertions in UI code
- Files:
  - `packages/ui/src/composables/useActionController.ts` - Lines 276, 277, 534
  - `packages/ui/src/composables/useZoomPreview.ts` - Lines 94-100, 134-140
  - `packages/ai-trainer/src/introspector.ts` - Dynamic property access
- Why: Dynamic typing needed for Vue/Vite environment access, DOM cleanup
- Impact: Bypasses TypeScript safety, potential runtime errors
- Fix approach: Create proper typed interfaces, use WeakMap for DOM cleanup

## Known Bugs

**No critical bugs detected** - The codebase appears stable with good test coverage.

## Security Considerations

**Silent error suppression:**
- Risk: Errors swallowed without logging make debugging difficult
- Files:
  - `packages/session/src/game-session.ts:1140` - Ignores `boardRefs()` errors silently
  - `packages/worker/src/index.ts:752` - Ignores WebSocket attachment errors
  - `packages/cli/src/commands/dev.ts:219` - Ignores cache cleanup failures
- Current mitigation: None
- Recommendations: Add error logging before suppression, use try/catch with console.error

**JSON parsing without error handling:**
- Risk: Corrupted database state could crash server
- File: `packages/server/src/stores/sqlite-storage.ts:39`
- Code: `return row ? JSON.parse(row.state_json) : null;`
- Current mitigation: None
- Recommendations: Wrap in try/catch, return null or throw descriptive error

## Performance Bottlenecks

**No significant performance issues detected.** The architecture is designed for turn-based games with low request rates.

## Fragile Areas

**Action controller state machine:**
- File: `packages/ui/src/composables/useActionController.ts`
- Why fragile: 1,807 lines with complex state transitions, setTimeout-based followUp handling
- Common failures: Race conditions with pendingFollowUp (documented at lines 378-379, 1056)
- Safe modification: Test thoroughly, understand state machine before changes
- Test coverage: Extensive (2,088-line test file)

**Flow engine execution:**
- File: `packages/engine/src/flow/engine.ts` (968 lines)
- Why fragile: Complex state machine for turn/phase sequencing
- Common failures: Incorrect flow node evaluation
- Safe modification: Run all flow tests, test with multiple game types
- Test coverage: Good (`packages/engine/tests/flow.test.ts` - 1,569 lines)

## Scaling Limits

**SQLite storage:**
- Current capacity: Single-user local development
- Limit: SQLite single-writer lock limits concurrent writes
- Symptoms at limit: Write contention with multiple games
- Scaling path: Use Cloudflare Durable Objects (production design)

**In-memory game store:**
- Current capacity: Development only
- Limit: Memory exhaustion with many concurrent games
- Symptoms at limit: Process OOM
- Scaling path: Use SQLite with `--persist` flag, or production Cloudflare deployment

## Dependencies at Risk

**No critical dependency risks detected.** All major dependencies are actively maintained.

## Missing Critical Features

**No missing critical features for core functionality.** The framework is feature-complete for its purpose.

## Test Coverage Gaps

**Unimplemented TODO items:**
- What's not tested: `boardRefs()` validation in assertions
- File: `packages/testing/src/assertions.ts:248`
- Code: `// TODO: Add withChoices validation when action tracing is available`
- Risk: Cannot verify complex selection choices in tests
- Priority: Low (workaround: manual verification)
- Difficulty: Requires action tracing feature first

**AI code generator fallback:**
- What's not tested: Auto-generated AI checker functions
- File: `packages/ai-trainer/src/code-generator.ts:336`
- Code: `// TODO: Implement this checker based on game-specific logic`
- Risk: Generated AI code may have incomplete evaluation functions
- Priority: Medium (affects AI training quality)
- Difficulty: Requires game-specific heuristics analysis

## Documentation Gaps

**Complex systems lacking inline documentation:**
- `packages/engine/src/flow/engine.ts` (968 lines) - Flow execution state machine
- `packages/ai/src/mcts-bot.ts` (786 lines) - MCTS algorithm implementation
- `packages/session/src/game-session.ts` (2,585 lines) - Session management

**Recommendation:** Add section comments explaining major subsystems within these files.

---

*Concerns audit: 2026-01-08*
*Update as issues are fixed or new ones discovered*
