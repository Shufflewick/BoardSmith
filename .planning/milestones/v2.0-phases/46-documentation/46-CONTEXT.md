# Phase 46: Documentation - Context

**Gathered:** 2026-01-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Update all documentation to reflect the collapsed monorepo structure. This includes updating existing docs with new import paths, documenting the subpath exports, and writing a migration guide for the MERC team. No new documentation topics — just updating what exists for the new structure.

</domain>

<decisions>
## Implementation Decisions

### Migration guide audience
- MERC team only (not generic for any BoardSmith user)
- Step-by-step commands (copy-paste ready, specific file paths and exact replacements)
- No inline verification sections — they'll know if it works
- Lives in `docs/migration-guide.md` (versioned with project)

### API reference format
- One page per subpath export in `docs/api/*.md`
- Each page contains: "when to use this" intro + usage examples + export list with JSDoc links
- 11 subpath pages: ui, session, testing, eslint-plugin, ai, ai-trainer, client, server, runtime, worker, plus root

### Claude's Discretion
- How to structure the import mapping in migration guide (table vs pattern description vs common ones)
- Exact organization within each API page
- Which existing docs need updates vs which can stay as-is
- Documentation thoroughness (minimal import fixes vs rewrites)
- Whether code examples need to compile/run or just look correct

</decisions>

<specifics>
## Specific Ideas

- Pit of success mindset: make the documentation guide users toward correct usage naturally
- Migration guide is practical/actionable, not explanatory

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 46-documentation*
*Context gathered: 2026-01-19*
