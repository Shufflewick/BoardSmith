# Phase 145: `/bs-build-chunk` — Audit & Repair with Design Review - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Author `/bs-build-chunk`'s third step group: the audit step (BUILD-07 — fresh adversarial agents, 3 lenses, stable-ID ledger), the repair loop (BUILD-08 — max 3 rounds, only-new-findings, refute-with-citation, user triage), and the screenshot-armed design-review agent for UI chunks (UIQ-04). Playtest/revise/close is Phase 146. Behavioral proof is Phase 149.

Canonical contract: `.planning/bs-skills-plan.md` §build-chunk steps 6–7 + §UI design-review agent + §Hard Rules (auditor independence, repair-loop bound). The `{audit + repair}` session step group is defined in `bs/state-machine.md`. CHUNK.template.md already ships a `## Findings Ledger` section (stable-ID, round-aware) — audit fills it, never restructures it.

</domain>

<decisions>
## Implementation Decisions

### File Structure & Ledger
- New reference files: `src/cli/slash-command/bs/build/audit.md`, `bs/build/repair.md`, `bs/build/design-review.md`
- Replace the "authored in Phase 145" forward-reference markers in `build-chunk.md` for the audit/repair rows; register the three new files in build-chunk.md's Reference Files list
- Findings ledger is CHUNK.template.md's existing `## Findings Ledger` section (stable IDs, round-aware, only-new-findings on round N+1, max-3 cross-referenced to state-machine.md "Repair Loop Bound") — audit writes entries there, cites the template, never invents a new structure
- Screenshots stored in the game project's `chunks/<slug>/shots/` (per the plan) — design-review.md documents the path and the prior-chunk diff source

### Audit/Repair Semantics
- Audit: fresh-context adversarial subagents read raw slices + RULINGS.md + the code — NEVER the interpretation (interpretation errors must stay visible); rulings outrank the rulebook (auditors read RULINGS.md so they don't "fix" a house rule back to the printed rule). Three lenses: (1) rulebook fidelity, (2) visibility/leak diff — compare two seats' broadcast/player-view state for leaked hidden attributes (use BoardSmith's getPlayerView / visibility introspection from v4.3/v4.4 — researcher confirms exact API), (3) undo sanity. UI chunks add the design lens (design-review.md). Findings → CHUNK.md Findings Ledger with stable IDs.
- Repair: fix findings OR refute with citations recorded in the ledger (rulings/rulebook citation) instead of changing code; loop test → audit; round N+1 auditors see the ledger and report ONLY NEW findings; MAX 3 audit rounds (state-machine.md bound); after round 3 remaining findings triaged with the user (real blocker / defer to later chunk / auditor wrong) as plain-language options, never raw
- Auditor independence (Hard Rule): fresh agents, no inherited conversation, no build/investigate framing, reading raw sources themselves; parallel same-model agents are correlated → advisory signal, human is tiebreaker
- Session discipline: {audit + repair} is one session group; hand off at the seam; each round's results persist to CHUNK.md before the next starts (cold-resume: a crashed repair round resumes from the ledger)

### Design-Review Agent & Screenshots (UIQ-04)
- One adversarial agent for `ui: touches|major` chunks: starts the dev server, screenshots the chunk state at the 3 Slate breakpoints × 2 themes (dev-host iframe-shrink for the compact breakpoint), reviews against DESIGN.md + frontend-design craft criteria, diffs against the previous chunk's stored screenshots in `chunks/<slug>/shots/` to catch cohesion drift, feeds findings into the SAME repair loop (design findings land in the Findings Ledger), and KILLS the dev server before returning (repo hard rule — never leave a server running)
- Screenshot mechanism: the Claude-in-Chrome browser tooling (mcp__claude-in-chrome__*) the skill already documents; design-review.md instructs the agent to use it, navigate to the dev-host seat, resize/iframe-shrink for breakpoints, toggle theme, capture. Researcher confirms the exact dev-host URL/affordances and theme-toggle mechanism to cite
- Real controls / no-idle-wait caveats: dev host is a live SPA (never reaches network idle) — design-review.md must instruct waiting on domcontentloaded/selector, not idle (per CLAUDE.md browser-testing rule)

### Verification
- Extend `build-chunk.test.ts` with BUILD-07, BUILD-08, UIQ-04 describe blocks + REFERENCED_PATHS (audit.md/repair.md/design-review.md now exist; 146 forward-ref markers remain)
- Pin: 3 lenses named, never-reads-interpretation rule, max-3-round + only-new-findings, refute-with-citation, screenshot path chunks/<slug>/shots/, server-kill instruction, 3×2 breakpoint/theme grid
- Behavioral proof (actual audit/repair/design-review run) deferred to Phase 149

### Claude's Discretion
- audit.md lens sub-structure, exact subagent return-shape field names, design-review.md's step ordering, diff-presentation format

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` §build-chunk steps 6-7 + §UI design-review agent — the spec
- `bs/build-chunk.md` (post-144) — {audit+repair} session group, forward-reference markers to replace, Reference Files list
- `bs/build/{investigate,redteam,ask,build,test,design-ask}.md` — established reference-file idiom, fresh-agent dispatch (redteam.md is the closest adversarial-independence analog), server-kill discipline (test.md/scaffold.md)
- `bs/templates/CHUNK.template.md` — `## Findings Ledger` (stable-ID, round-aware) + `## Redteam Rounds` precedent for per-round persistence
- `bs/templates/DESIGN.template.md` — the design-review agent's source-of-truth (token discipline, do/don't list)
- BoardSmith introspection: getPlayerView / visibility APIs (v4.3 INTRO, v4.4 VIS — hidden-info visibility assertions + DOM-leak test utility) for the two-seat leak diff; dev-host affordances (Follow-active-seat, iframe-shrink, UI switcher) from v4.x; Claude-in-Chrome MCP tooling
- `bs/build-chunk.test.ts` (58 tests) — drift-test pattern

### Established Patterns
- Lean orchestrator / fat reference files; citation-not-restatement; fresh adversarial agents with no framing; per-round persistence to CHUNK.md; server-kill before return; byte-identical drift pins; forward-reference-marker discipline for not-yet-authored steps

### Integration Points
- Phase 146 (playtest/revise/close) reads the same CHUNK.md state; design-review shots feed 146's polish gate
- Phase 148 installs the new reference files
- The two-seat leak diff reuses v4.4's DOM-leak / visibility test utilities

</code_context>

<specifics>
## Specific Ideas

- Without the design-review agent, no lifecycle agent can fail a chunk for bad UI — "invoke a frontend-design pass" would be one-shot generation with no verification (the anti-pattern this plan exists to avoid)
- Design findings go into the normal repair loop (same ledger, same bound), not a separate track
- Vote/finding outcomes never shown raw to the user — plain-language triage options

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
