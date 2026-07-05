# Phase 143: `/bs-build-chunk` — Interpretation & Ask Gate - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Author the `/bs-build-chunk` skill's entry/routing layer and the first step group: state-aware resume (BUILD-01), investigate (BUILD-02), redteam (BUILD-03), the ask gate (BUILD-04), and the light-path ceremony rule (BUILD-12). Steps 4–10 (build/test/audit/repair/playtest/revise/close) are Phases 144–146. Installer wiring is Phase 148; behavioral proof is Phase 149.

Canonical contract: `.planning/bs-skills-plan.md` §"/bs-build-chunk" (steps 1–3, scaled ceremony, conversational intents) + §Hard Rules + `src/cli/slash-command/bs/state-machine.md` (statuses, step names, session groups, lock protocol, consistency check).

</domain>

<decisions>
## Implementation Decisions

### Skill Growth Across Phases 143–146
- Author the FULL `bs/build-chunk.md` orchestrator in this phase: complete 10-step routing table (state-machine.md already defines all step names/statuses), entry consistency check, conversational-intent routing, session step-group seams and handoff messages, light-path routing
- Steps 4–10 reference files are listed in the orchestrator with an explicit "authored in Phase 144/145/146" marker; the drift test's file-existence check covers only files due by the current phase
- File layout: `src/cli/slash-command/bs/build-chunk.md` + `src/cli/slash-command/bs/build/{investigate,redteam,ask}.md`; the light path lives in the orchestrator (it's routing, not a step)
- New `src/cli/slash-command/bs/build-chunk.test.ts` following the ingest.test.ts pattern

### Step Semantics
- Resume routing: orchestrator reads SKETCH.md → first non-verified chunk → that CHUNK.md → routes to first incomplete step; awaiting-playtest states re-pose the pending question verbatim as the first move; conversational intents ("what's left?", "do the Chance cards next") route internally to status/insert behavior instead of misbuilding
- Redteam independence: 3 fresh subagents receive raw slice paths + the numbered claims list ONLY — no investigator rationale or framing; 2 refuters prompted "default to refuted if uncertain" + 1 coverage adversary searching the whole rulebook via INDEX for interacting rules the claims omit; max ONE re-investigate round; refuted-twice = ambiguity → escalate to user as a plain-language question with options → ruling recorded in RULINGS.md; vote outcomes never shown raw to the user
- Ask gate fixed 4-part format: (a) rules interpretation in plain game-designer language with citations; (b) ambiguities as concrete questions with options; (c) "what you will NOT see yet" deferred list; (d) zero implementation vocabulary — no engine concepts, no code. House rules/adaptations chosen here go to RULINGS.md. Assets requested here; "I don't have art yet" never blocks (placeholder policy per DESIGN/ASSETS templates); debt recorded in ASSETS.md
- Light path: trivial-tagged chunks run build → test → playtest with the user explicitly told which ceremony is in effect; `approved` is unreachable on the light path (proposed → built, per the Phase 141 state-machine.md fix); playtest performs close's bookkeeping for light chunks (Phase 141 fix)
- Investigate reads: chunk's cited slices + INDEX-discovered slices (search INDEX.md for the chunk's key terms) + RULINGS.md + DECISIONS.md + relevant BoardSmith docs + DESIGN.md for `ui: touches|major` chunks; output is a numbered factual-claims list with citations + explicit visibility declaration ("what is hidden from whom"), newly discovered citations appended to CHUNK.md

### Verification
- Structural drift test: BUILD-01..04 + BUILD-12 describe blocks, orchestrator↔state-machine.md byte-identical step-name/enum pins, subagent return-shape field-name pins, referenced-file existence limited to current-phase files (pending files asserted to carry the "authored in Phase 14X" marker)
- Behavioral proof deferred to Phase 149's dry-run

### Claude's Discretion
- Exact section ordering, subagent prompt wording, return-shape field names, handoff message copy

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` §build-chunk — the spec for steps 1–3, ceremony scaling, intents, progress narration ("one-line plain-language progress, never agent transcripts")
- `src/cli/slash-command/bs/state-machine.md` — statuses, 10 step names, session step groups {investigate+redteam+ask}, lock protocol (24h staleness), consistency-check-on-entry, light-path transitions, write order
- `src/cli/slash-command/bs/templates/CHUNK.template.md` — the file investigate/redteam/ask fill (claims list, visibility declaration, findings ledger, Status grammar)
- `src/cli/slash-command/bs/ingest-rules.md` + `bs/ingest/*.md` — the established orchestrator/reference-file idiom, subagent prompt-template style, "Installed location" paragraph, context-economics phrasing
- `src/cli/slash-command/bs/ingest.test.ts` (41 tests) + `bs/templates.test.ts` (44) — drift-test pattern including live-CLI-source pins and return-shape field pins

### Established Patterns
- Citation-not-restatement: skills cite state-machine.md/templates, never copy their text
- Orchestrator never reads big files — subagents read slices/docs and return conclusions
- Byte-identical marker testing across files for shared grammar strings

### Integration Points
- Phases 144–146 add `bs/build/{build,test,audit,repair,playtest,revise,close}.md` and extend the routing the orchestrator defines now
- Phase 147's check-status/insert-chunk read the same CHUNK/SKETCH state this skill writes
- Phase 148 installs `bs/build-chunk.md` + `bs/build/`

</code_context>

<specifics>
## Specific Ideas

- Every session ends by printing what to run next time (non-programmer-readable handoff)
- During machine steps the orchestrator emits one-line plain-language progress ("double-checking my reading of the trading rules")
- There is deliberately NO separate verify command — verification is a step state inside the chunk
- Git protocol: commit at every step completion `chunk-<slug>/step-<name>`; commit before build starts (144's territory but the orchestrator's git-protocol section cites state-machine.md now)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
