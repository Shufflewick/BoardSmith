# Phase 141: File Templates & State-Machine Authority - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the literal file templates every `bs-` skill fills (SKETCH.md, CHUNK.md, RULINGS.md, DECISIONS.md, DESIGN.md, ASSETS.md) plus the hard state-machine authority rules as a shared reference document, so downstream skill phases (142–147) consume them and cold-resume safety is enforced from day one. No skill instructions themselves are written in this phase; no installer changes (Phase 148). Requirements: TMPL-01, TMPL-02, TMPL-03.

The canonical design contract is `.planning/bs-skills-plan.md` — especially "Durable Artifacts", "State-machine authority rules (hard)", "Hard Rules", and "Human gates" sections. Templates must implement that contract, not reinterpret it.

</domain>

<decisions>
## Implementation Decisions

### Location & Distribution Shape
- Template sources live at `src/cli/slash-command/bs/templates/` — a new `bs/` subtree alongside the existing `aspects/` shared-reference precedent
- Templates ship as standalone shared-reference files consumed by later bs- skills; installer wiring is Phase 148's job
- The state-machine authority rules are written once in `src/cli/slash-command/bs/state-machine.md`; every bs- skill will cite/include it rather than duplicating rules
- `/design-game` removal is NOT this phase — Phase 148 (Distribution) owns installer changes and removal

### Template Content & Format
- Status enum exactly as the plan specifies: `proposed → approved → built → verified`, plus `verified (user-waived)`, plus `stale — re-derive before build` (CHUNK-level stale marker from /bs-insert-chunk)
- Step names exactly: `investigate, redteam, ask, build, test, audit, repair, playtest, revise, close` (light path for trivial chunks: build → test → playtest)
- Format: markdown headings with a `Status:` line, append-only round sections (revise-1, revise-2, …; audit rounds with ledgered finding IDs), HTML comments as fill-in guidance — sessions fill templates, never restructure them
- Per-file contents follow the plan's Durable Artifacts table verbatim:
  - SKETCH.md: ordered chunk list by stable slug, sketch-level detail per chunk (what it builds, citations, `ui:` tag `none|touches|major`, human test script), "Variants (deferred)" list, ideas backlog, sketch version stamp, session lock note
  - CHUNK.md: step checklist with statuses, interpretation (numbered factual claims with citations + visibility declaration), findings ledger with stable IDs, revision rounds, per-file build manifest, verified commit hash, Status line (authoritative)
  - RULINGS.md: designer decisions each with the rulebook citation it interprets/overrides
  - DECISIONS.md: implementation decisions ledger
  - DESIGN.md: direction + rationale, `--bsg-*`/applyTheme() overrides, typography/spacing, component recipes, placeholder policy, do/don't list
  - ASSETS.md: component/asset ledger (needed-by-chunk, requested, received, placeholder-in-use, file path)
- Each template explicitly defines its parse contract (required headings + status-line grammar) so TMPL-02's "fails to parse → stop and ask" has a concrete trigger

### Enforcement & Verification
- TMPL-02/03 enforcement mechanism is `state-machine.md` itself: authority rules (CHUNK.md owns status; SKETCH.md derived; CHUNK wins on contradiction with log+repair), write order CHUNK→SKETCH, cold-resume write discipline (append-only rounds, `Status:` line updated last), stop-and-ask on parse failure, consistency-check-on-entry procedure (every slug has a directory, every directory has a sketch entry, statuses parse, no stale session lock), restyle/cutover rule (verified → built flip), session lock protocol, git protocol (`chunk-<slug>/step-<name>` commits, verified hash recorded at close)
- Drift protection: a vitest unit test in BoardSmith asserting template invariants — files exist, exact enum values, exact step names, required headings present
- Phase verification is structural (grep/test assertions on template content); behavioral criteria (a resumed session actually stops and asks) verified in Phase 149's end-to-end dry-run
- Template file naming: `SKETCH.template.md`, `CHUNK.template.md`, etc. — mirrors the existing `design-game.template.md` convention

### Claude's Discretion
- Exact wording of fill-in guidance comments, section ordering within templates, and the drift-test file location/naming

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` — the v2 adversarially-reviewed design contract; sections "Durable Artifacts", "State-machine authority rules (hard)", "Hard Rules", "Human gates", "Git protocol" contain the exact rules the templates and state-machine.md must encode
- `src/cli/slash-command/design-game.template.md` — existing `.template.md` naming convention
- `src/cli/slash-command/aspects/` — existing shared-reference-files precedent (dice.md, hex-grid.md, playing-cards.md, square-grid.md, index.md)

### Established Patterns
- Skills are self-contained markdown; installer (`src/cli/commands/install-claude-command.ts`) embeds instruction files — templates must work as plain files a skill can quote or reference
- Vitest is the test framework; unit tests live adjacent to source or in module test files

### Integration Points
- Phases 142–147 will reference these templates and state-machine.md from their skill instructions
- Phase 148 wires `install-claude-command.ts` to install the `bs/` shared reference files

</code_context>

<specifics>
## Specific Ideas

- Chunk identity is a stable slug, not an ordinal; SKETCH.md orders by listing slugs (reordering never breaks `chunks/<slug>/` references)
- Every write must leave the file valid for cold resume; a resumed session cannot skip a gate because gates are file states
- Findings ledger IDs are stable across audit rounds; round N+1 auditors report only NEW findings

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
