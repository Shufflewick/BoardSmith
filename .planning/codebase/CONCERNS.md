# Codebase Concerns

**Analysis Date:** 2026-01-08
**Last Updated:** 2026-01-09

> ✅ **v0.2 Concerns Cleanup milestone completed.** All actionable concerns have been addressed or documented.

## Tech Debt

### ✅ RESOLVED: Large, complex files
- Issue: Several files exceeded 2000 lines, making them hard to navigate and maintain
- Files split in v0.1 Large File Refactoring milestone:
  - `packages/session/src/game-session.ts` — Split into 5 focused modules
  - `packages/ui/tests/useActionController.test.ts` — Split into 4 test modules
  - `packages/engine/src/action/action.ts` — Split into 3 action modules
  - `packages/ui/src/composables/useActionController.ts` — Split into 3 controller modules
- **Resolution:** v0.1 milestone (Phases 1-4) — Shipped 2026-01-08

### ✅ RESOLVED: Type assertions bypassing safety
- Issue: Multiple `as any` type assertions in UI code
- Resolutions:
  - `packages/ui/src/composables/useActionController.ts` — Fixed with type guards (Phase 05-01)
  - `packages/ui/src/composables/useZoomPreview.ts` — Fixed with WeakMaps for DOM cleanup (Phase 05-02)
  - `packages/ai-trainer/src/introspector.ts` — Documented as intentional; runtime introspection of game objects requires dynamic property access (Phase 05-03)
- **Resolution:** v0.2 Phase 5 (type-safety) — 2026-01-08

## Known Bugs

**No critical bugs detected** — The codebase appears stable with good test coverage.

## Security Considerations

### ✅ RESOLVED: Silent error suppression
- Risk: Errors swallowed without logging make debugging difficult
- Resolutions:
  - `packages/session/src/selection-handler.ts` (boardRefs) — Added console.error logging (Phase 06-01)
  - `packages/worker/src/index.ts` — Documented as best-effort WebSocket cleanup (Phase 06-03)
  - `packages/cli/src/commands/dev.ts` — Documented as best-effort cache cleanup (Phase 06-03)
- **Resolution:** v0.2 Phase 6 (error-handling) — 2026-01-09

### ✅ RESOLVED: JSON parsing without error handling
- Risk: Corrupted database state could crash server
- File: `packages/server/src/stores/sqlite-storage.ts`
- **Resolution:** Added try/catch, returns null on parse failure (Phase 06-02)

## Performance Bottlenecks

**No significant performance issues detected.** The architecture is designed for turn-based games with low request rates.

## Fragile Areas

**Action controller state machine:**
- File: `packages/ui/src/composables/useActionController.ts` (now split into focused modules)
- Why fragile: Complex state transitions, setTimeout-based followUp handling
- Common failures: Race conditions with pendingFollowUp (documented in code)
- Safe modification: Test thoroughly, understand state machine before changes
- Test coverage: Extensive (test file also split into focused test modules)

**Flow engine execution:**
- File: `packages/engine/src/flow/engine.ts` (968 lines)
- Why fragile: Complex state machine for turn/phase sequencing
- Common failures: Incorrect flow node evaluation
- Safe modification: Run all flow tests, test with multiple game types
- Test coverage: Good (`packages/engine/tests/flow.test.ts` — 1,569 lines)

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

### ✅ RESOLVED: assertions.ts incomplete API
- What: `boardRefs()` validation TODO with unused parameter
- File: `packages/testing/src/assertions.ts:248`
- **Resolution:** Removed unused `withChoices` parameter from `expect.toHaveAction()` signature; the option was never implemented and caused API confusion (Phase 07-02)

### ✅ RESOLVED: AI code generator fallback
- What: Auto-generated AI checker functions using basic fallback
- File: `packages/ai-trainer/src/code-generator.ts`
- **Resolution:** Added console.warn when fallback checker generation is used, making it visible that game-specific logic needs implementation (Phase 07-03)

## Documentation Gaps

### ✅ RESOLVED: mcts-bot.ts inline documentation
- File: `packages/ai/src/mcts-bot.ts` (786 lines)
- **Resolution:** Added section dividers and JSDoc comments for major subsystems (Phase 07-01)

### ✅ RESOLVED: game-session.ts documentation
- File: Previously `packages/session/src/game-session.ts` (2,585 lines)
- **Resolution:** File split into 5 focused modules with clear responsibilities (v0.1 milestone)

### ⏸️ DEFERRED: flow/engine.ts documentation
- File: `packages/engine/src/flow/engine.ts` (968 lines)
- Status: Not addressed in v0.2 milestone
- Rationale: Good existing test coverage (1,569-line test file); documentation would improve readability but is not critical
- Future work: Add section comments explaining flow execution state machine when modifying this file

---

*Concerns audit: 2026-01-08*
*v0.2 milestone completed: 2026-01-09*
*Update as issues are fixed or new ones discovered*
