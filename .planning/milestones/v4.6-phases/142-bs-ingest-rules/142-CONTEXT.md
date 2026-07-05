# Phase 142: `/bs-ingest-rules` - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Author the `/bs-ingest-rules` skill: rulebook transcription (fan-out, citations, per-section confirmation), INDEX cross-reference, component inventory + visual identity survey, variant/edition tagging, interview fallback, project scaffold with compile+serve verification, sketch proposal with approval gate, UI strategy decision, re-run protection, and old-skill migration offer. Requirements INGEST-01..07. Installer wiring and `/design-game` removal are Phase 148. Behavioral end-to-end proof is Phase 149.

Canonical design contract: `.planning/bs-skills-plan.md` §"/bs-ingest-rules" plus Hard Rules, UI section (strategy decision + visual identity survey), and the Phase 141 artifacts (`src/cli/slash-command/bs/state-machine.md`, `bs/templates/*.template.md`) which this skill must consume, not restate.

</domain>

<decisions>
## Implementation Decisions

### Skill File Structure
- Lean orchestrator skill file + step-scoped reference files under `src/cli/slash-command/bs/ingest/` (e.g. transcription, interview-fallback, sketch-derivation, scaffold) that subagent prompts embed — the 3,072-line design-game monolith is the anti-pattern being replaced
- Skill entry file: `src/cli/slash-command/bs/ingest-rules.md`; installer maps command names in Phase 148
- Reuse from old skill by EXTRACTION into `bs/` shared reference files: Phase 2 structured-interview question sequence (instructions.md lines ~121-223) becomes the no-rulebook fallback reference; Phase 1B naming rules (~lines 90-120) become the scaffold-step reference. Do NOT delete or modify instructions.md (Phase 148 owns removal)
- Templates consumed as logical references: the skill instructs sessions to copy `bs/templates/*.template.md` skeletons into the game project and follow `state-machine.md` — never restates template content inline (Phase 141 decision)

### Ingest Pipeline Mechanics
- Transcription confirmed per rulebook section (batched slice-summary review with the user), not per page and not one bulk confirmation
- `rulebook/INDEX.md` is a term → slice-file table built by the orchestrator from subagent-returned term lists — the orchestrator never reads full slices (context economics hard rule)
- Sketch approval gate presents estimated chunk count + rough per-chunk wall time; only the next 2–3 chunks are detailed (lazy tail per state-machine.md); user edits → skill revises → user approves; user ordering wins unless a hard dependency is violated (named concretely with minimal prerequisite proposed)
- Scaffold verification: `npx boardsmith init` + compile check + serve-then-kill check before any rules work; failures stop with an actionable message; any server the skill starts is killed before returning (repo hard rule)

### Verification for This Phase
- Structural drift test asserting contract strings in the skill files (status enums cited correctly, gates present, INGEST-01..07 anchor content, template/state-machine references) — either `bs/ingest.test.ts` or extending `bs/templates.test.ts`; executor's discretion on file placement
- Cross-file consistency assertion: every file path the skill references exists (templates, state-machine.md, ingest/ reference files) — no dangling pointers
- Behavioral proof (an actual ingest run) deferred to Phase 149's dry-run

### Claude's Discretion
- Exact decomposition of ingest/ reference files, section ordering, prompt wording for subagents, INDEX table format details

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` — canonical contract (§ingest, §UI, §Hard Rules, §Reuse, §Distribution)
- `src/cli/slash-command/bs/state-machine.md` + `bs/templates/*.template.md` + `bs/templates.test.ts` (44 tests) — Phase 141 outputs; SKETCH.template.md defines the sketch format the ingest skill fills, including `Status: proposed (sketch-level — no CHUNK.md yet)` tail entries, session lock, version stamp
- `src/cli/slash-command/instructions.md` — old skill; Phase 2 interview (lines ~121-223), Phase 1B naming (~90-120), Phase 1 state detection (~39-89) are the extraction sources
- `src/cli/slash-command/aspects/` — aspect files the skill's doc-reading lists reference

### Established Patterns
- Content-assertion vitest tests reading files via `readFileSync(join(__dirname, ...))` (templates.test.ts / init.test.ts pattern)
- Shared-reference markdown files are standalone full content (aspects/ precedent), never `{{BOARDSMITH_ROOT}}` thin pointers

### Integration Points
- Phase 143-146 (`/bs-build-chunk`) consumes the SKETCH.md/rulebook/ artifacts this skill produces
- Phase 147 (`/bs-check-status`, `/bs-insert-chunk`) reads the same state
- Phase 148 installs `bs/ingest-rules.md` + `bs/ingest/` + shared references

</code_context>

<specifics>
## Specific Ideas

- Ingest is destructive to sketch state on re-run — explicit confirmation required (INGEST-07)
- First chunk is always the core event loop; sketch must contain game-end/scoring and final-acceptance chunks (coverage check: every non-variant slice cited by at least one closed chunk)
- Visual identity survey is evidence-only at ingest; the design decision happens at the first UI chunk's ask (Phase 143+ territory)
- Variant/optional/advanced rules tagged out-of-scope-by-default in slices and listed in SKETCH.md "Variants (deferred)"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
