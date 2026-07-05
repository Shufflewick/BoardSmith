# Phase 146: `/bs-build-chunk` — Playtest, Revise, Close & Final Acceptance - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Author `/bs-build-chunk`'s final step group and complete the skill: playtest (BUILD-09 — the human gate), revise (BUILD-10 — item-by-item triage + disposition report), close (BUILD-11 — verified hash + sketch-tail delta), the git/handoff/lock protocol surfaced in the orchestrator (BUILD-13), and the final-acceptance design-QA pass (UIQ-05). After this phase `build-chunk.md` has ZERO forward-reference markers — the full 10-step engine is live. Behavioral proof is Phase 149.

Canonical contract: `.planning/bs-skills-plan.md` §build-chunk steps 8–10 + §Human gates + §Git protocol + §UI design-QA chunk. The `{playtest + one revise round + close}` session step group and the lock protocol are defined in `bs/state-machine.md`.

</domain>

<decisions>
## Implementation Decisions

### File Structure
- New reference files: `src/cli/slash-command/bs/build/playtest.md`, `bs/build/revise.md`, `bs/build/close.md`, `bs/build/final-acceptance.md`
- Replace ALL remaining "authored in Phase 146" forward-reference markers in build-chunk.md (7 occurrences: playtest/revise/close dispatch rows + Reference Files list + the close-duty note at line ~152) and register the four new files; after this phase build-chunk.md is fully live with no pending markers
- Git protocol (`chunk-<slug>/step-<name>` commits, commit-before-build, verified-hash-at-close), handoff-at-seams, and the session lock protocol are surfaced in the orchestrator's own sections CITING state-machine.md (BUILD-13) — never restated
- final-acceptance.md is a distinct reference file (the final-acceptance chunk is a special sketch chunk, not a per-chunk step) — playtest/revise/close apply to it too, but its design-QA pass is its own content

### Playtest / Revise / Close Semantics
- Playtest (the human gate): the skill gives the user ONE command to run themselves (`npx boardsmith dev`) + a URL — the USER owns the server across the multi-session gap; any server the skill itself started (design-review) was already killed in Phase 145. Script is numbered, click-by-click, states seat count and per-seat steps, teaches dev-host affordances ONCE (seat selector, second-tab-as-player-2, AI-fill, Follow-active-seat), includes a build stamp to confirm before testing (stale-tab/Vite-cache protection), a one-line regression check, the standing taste line ("anything look off, cramped, or unreadable?"), and for hidden-info chunks a second-seat leak check. "Verified" is an explicit item-by-item checklist ("you saw all N of these happen"), confirmed one at a time, not a vibe. `verified (user-waived)` state exists for honest skipping; check-status surfaces accumulated waived chunks and proposes a batch playtest
- Revise: feedback triaged item-by-item into 4 categories — (a) this-chunk defect → revise round; (b) future scope → SKETCH.md ideas backlog or /bs-insert-chunk; (c) not-built-yet (matches the script's "not yet" list) → expectation reset; (d) rules change → RULINGS.md. Chunk closes when (a)-items are done regardless of (b)-items. Rounds appended (revise-1, revise-2, …). On re-entry after a revise round, user gets a feedback disposition report — each item they reported, what changed, and a TARGETED re-test script — never a blind full re-test
- Close: mark verified in CHUNK.md then SKETCH.md, tag/record the verified commit hash (bisect anchor + diff base for "what changed since the human last said yes"), roll up decisions, re-derive the sketch tail against the rulebook and present the DELTA for approval ("chunk 9 split into 9a/9b because…", never a silent rewrite), propose the next chunk with its ui: tag. Light-path close bookkeeping (already partly in build-chunk.md from Phase 143 fixes) is reconciled — close.md is the full version playtest's light-path bookkeeping pointed forward to
- Write order (CHUNK.md before SKETCH.md) and per-step persistence apply throughout (cite state-machine.md)

### Final Acceptance & Verification
- final-acceptance.md: the final-acceptance chunk runs the full design-QA pass — screen-reader playthrough (VoiceOver), 200% zoom, compact-breakpoint touch targets, colorblind pass on game-added colors, both Slate themes, drag-drop keyboard alternates end-to-end, mobile layout via iframe-shrink. This is part of what "done" means for the SKETCH (coverage check: every non-variant slice cited by a closed chunk), not just per chunk. The screen-reader step USES the useAnnouncer() floor shipped in Phase 140
- The user runs any server for their own testing; the skill never leaves a server running (repo hard rule) — final-acceptance's automated portions (if any) kill their own server
- Extend `build-chunk.test.ts` with BUILD-09/10/11/13 + UIQ-05 describe blocks; REFERENCED_PATHS gains the 4 new files; assert ZERO forward-reference markers remain in build-chunk.md (the skill is complete)
- Behavioral proof (actual playtest/revise/close/final-acceptance run) deferred to Phase 149

### Claude's Discretion
- playtest script template details, disposition-report format, close delta-presentation format, final-acceptance.md checklist ordering, subagent usage (playtest is human-driven; final-acceptance may dispatch a design-QA agent like 145's design-review)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` §build-chunk steps 8-10 + §Human gates + §Git protocol + §UI design-QA chunk — the spec
- `bs/build-chunk.md` (post-145) — the 7 forward-reference markers to replace, {playtest+revise+close} session group, light-path close-bookkeeping note (Phase 143 fix), Reference Files list, git/lock sections
- `bs/build/{investigate,redteam,ask,build,test,design-ask,audit,repair,design-review}.md` — all 9 prior reference files; design-review.md is the closest analog for final-acceptance's design-QA agent (breakpoints, themes, server discipline); ask.md is the human-gate/presentation analog for playtest
- `bs/build/design-ask.md` + Phase 145 design-review.md — dev-host affordances, breakpoints (375/800/1440 representative widths, iframe contentDocument theme injection), server-kill discipline
- `bs/templates/CHUNK.template.md` — Revision Rounds section, Status grammar (verified / verified (user-waived)), verified-commit-hash field; `bs/templates/SKETCH.template.md` — sketch tail, ideas backlog, session lock note, version stamp
- `bs/state-machine.md` — git protocol, session lock (24h staleness), handoff seams, write order, gate-as-file-state
- `useAnnouncer()` from Phase 140 (boardsmith/ui) — the screen-reader announce floor final-acceptance's SR playthrough exercises
- `bs/build-chunk.test.ts` (74 tests) — drift-test pattern

### Established Patterns
- Lean orchestrator / fat reference files; citation-not-restatement; human-gate presentation (ask.md); per-step persistence to CHUNK.md; write order CHUNK→SKETCH; server-kill / user-owns-server distinction; byte-identical drift pins; forward-reference-marker discipline (now being fully retired)

### Integration Points
- Phase 147 (check-status / insert-chunk) reads the CHUNK/SKETCH state close writes, surfaces waived chunks + ideas backlog; insert-chunk consumes the sketch-tail-delta / version-bump close performs
- Phase 148 installs the 4 new reference files; Phase 149 dry-runs the whole now-complete engine
- final-acceptance's SR step depends on Phase 140's useAnnouncer()

</code_context>

<specifics>
## Specific Ideas

- The human always tests the MOST polished artifact — adversarial machine review (145) happens BEFORE the human gate, never after; the human's time is the scarcest resource
- verified (user-waived) is recorded honestly, not hidden; check-status batches waived chunks
- "Done" is defined for the sketch (final-acceptance + coverage check), not just per chunk
- Close's sketch-tail re-derivation is presented as a delta at the gate, never a silent rewrite

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
