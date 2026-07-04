# Phase 139: Documentation Audit & Corrections - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Documentation teaches the real, shipped API everywhere touched by this milestone — including the three findings that are purely docs-teaching-nonexistent-APIs. Requirements DOCX-01 (F11: core-concepts.md event-sourcing/`element.setAttribute`), DOCX-02 (F14: registerActions() JSDoc), DOCX-03 (F20: getting-started.md CLI accuracy), DOCX-04 (cross-cutting grep-verified sweep). Depends on Phase 138 (shipped surface confirmed).

</domain>

<decisions>
## Implementation Decisions

### Docs Correction Strategy
- **DOCX-01 (F11)**: Rewrite core-concepts.md's affected sections to teach the real current model (direct property mutation + snapshot serialization; no command/event-sourcing model, no `element.setAttribute`) — every claim verified against live code.
- **DOCX-02 (F14)**: Correct `registerActions()` JSDoc to the real API with a working example lifted from an actual game.
- **DOCX-03 (F20)**: Audit what remains of getting-started.md's CLI inaccuracies (Phase 135 already fixed playerCount/$schema/--ai/--worker-port/--host/--lan; verify the rest against the real CLI incl. `--no-open`).
- **DOCX-04**: Grep-verified pass over ALL of docs/ for every API symbol changed in phases 131–138 (removed/renamed symbols, changed contracts — seed list: zone-visibility serialization semantics, visibleAttributes now enforced, state.players filtering, debugEnabled, teachingDisabled persistence, putInto throw, resolveArgs isSerializedElement-only, forEach snapshot+type constraint, registerAction handler-less throw, eachPlayer wrap, actionError simultaneous contract + FlowHaltedError, multiSelect server enforcement, switchOn throw, session.runner facade, start() Promise<ActionResult>, errorTick, fill() multiSelect guard, dragProps when, hook accumulation, board-sizing guidance, playerCount removal, --lan/--no-open/127.0.0.1, validate unknown-key rejection, 50MB limit, MeepleClient throwing contract + MeepleClientError + generatePlayerId, opened/awaitReconnect/connectImmediately/connectionTimeout, canonical protocol types, doAction throws + tryAction + ActionExecutionError, 'test-seed' default + testGame.seed). Mirror v4.4 Phase 130's doc-verifier approach: each doc claim checked against live source; fix or delete stale claims.

### Process
- No PROC-01 findings-verification doc needed for DOCX-04 sweep; DOCX-01/02/03 get quick re-verification traces in the SUMMARY (the audit's file:line claims re-checked before rewriting).
- Docs-only phase: no regression tests; verification = doc-verifier-style claim checking + grep gates. BoardSmith suite must remain green (no source changes expected; JSDoc edits are source files — tsc must stay clean).

### Claude's Discretion
- Section structure of rewritten core-concepts.md portions; example choice (hex/go-fish preferred).
- Whether to run gsd-doc-verifier agents per doc or one sweep agent — pick per context budget.

</decisions>

<code_context>
## Existing Code Insights

- F11: docs/core-concepts.md (event-sourcing command model + element.setAttribute — audit index 10).
- F14: registerActions() JSDoc (audit index 13) — in src/engine (game.ts or related).
- F20: docs/getting-started.md (audit index 19) — largely fixed by Phase 135/its review loop; residual audit.
- v4.4 Phase 130 doc-verifier pass is the house pattern (gsd-doc-verifier agent verifies factual claims against live codebase).
- Phases 131-138 SUMMARYs + REVIEW resolutions list every changed API (the DOCX-04 seed list above).

</code_context>

<specifics>
## Specific Ideas

- Suite baseline: 175 files / 2371 tests green; keep green (JSDoc-only source edits).
- docs/ has ~20+ files; the sweep must cover all of them but only CHANGE where claims are stale.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
