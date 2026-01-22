# Phase 58: Documentation Audit - Research

**Researched:** 2026-01-22
**Domain:** Documentation / Terminology Consistency
**Confidence:** HIGH

## Summary

This phase completes the v2.3 Nomenclature Standardization milestone by auditing all documentation files for terminology consistency. The prior phases (54-57) have already established the foundation:

- Phase 54 created `docs/nomenclature.md` as the authoritative terminology reference (34 terms)
- Phase 55 renamed `GameBoard.vue` to `GameTable.vue` in all games and templates
- Phase 56 renamed `Player.position` to `Player.seat` throughout the API
- Phase 57 renamed `Selection*` to `Pick*` in the UI layer

**What remains:** Some documentation files still contain outdated terminology. The audit needs to:
1. Find remaining instances of deprecated terms (selection, position, GameBoard)
2. Ensure standardized terms are used consistently (Table, Board, Zone, Session, etc.)
3. Add nomenclature.md reference links to relevant docs
4. Create/update migration guide with v2.3 terminology changes

**Primary recommendation:** Create a systematic audit plan that processes each docs/*.md file, searching for deprecated terms and ensuring consistency with nomenclature.md definitions.

## Standard Stack

This phase is documentation-only. No external libraries or tools required.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Markdown | N/A | Documentation format | Standard for docs/*.md files |
| grep/search | N/A | Find term usage | Audit tool |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| N/A | | | |

## Architecture Patterns

### Recommended Audit Approach

The documentation audit should follow a systematic pattern:

1. **Term Inventory** - List all deprecated vs standardized terms from nomenclature.md
2. **File-by-File Audit** - Check each docs/*.md file for consistency
3. **Cross-Reference Links** - Add nomenclature.md links where helpful
4. **Migration Guide** - Document v2.3 terminology changes

### Pattern 1: Terminology Substitution

**What:** Replace deprecated terms with standardized equivalents
**When to use:** Any prose or code examples using old terminology
**Mapping:**
```
| Deprecated | Standardized | Context Notes |
|------------|--------------|---------------|
| selection | pick | User-facing communication only |
| GameBoard | GameTable | Component name |
| game-board slot | game-board slot | KEEP - slot name unchanged |
| position | seat | Player property (API renamed) |
| playerPosition | playerSeat | Prop names (API renamed) |
```

**Important exceptions:**
- Code that still uses `selection` internally (backward-compatible APIs)
- `#game-board` slot name in GameShell (not renamed)
- `currentSelection` deprecated alias (keep docs about it)

### Pattern 2: Nomenclature Reference Links

**What:** Add link to nomenclature.md where helpful
**When to use:** Documents that introduce terminology, concepts overview, getting started
**Example:**
```markdown
## Related Documentation

- [Nomenclature](./nomenclature.md) - Standard terminology reference
```

### Pattern 3: Migration Guide Section

**What:** Document v2.3 API/terminology changes for upgraders
**Where:** docs/migration-guide.md or equivalent
**Content:**
```markdown
## v2.3 Changes

### Terminology Updates

| Old | New | Notes |
|-----|-----|-------|
| `Player.position` | `Player.seat` | API renamed |
| `GameBoard.vue` | `GameTable.vue` | Component renamed |
| `selection` | `pick` | User communication term |
| `currentSelection` | `currentPick` | Primary API; alias available |

### Migration Steps

1. Update component imports: `GameBoard.vue` → `GameTable.vue`
2. Update player access: `player.position` → `player.seat`
3. Update selection refs: `currentSelection` → `currentPick`
```

### Anti-Patterns to Avoid

- **Over-correcting:** Don't change `selection` in code examples where the API still uses that name
- **Breaking slot names:** The `#game-board` slot name was NOT renamed
- **Removing deprecation notes:** Keep documentation about deprecated aliases for migration support

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Term search | Custom tooling | grep/ripgrep + manual review | Docs are small enough |
| Auto-replace | sed scripts | Manual editing | Context matters for each replacement |
| Link validation | Custom checker | Manual verification | 28 files is manageable |

**Key insight:** This is a manual review task. The documents are small and the terminology changes are nuanced - automated replacement would miss context.

## Common Pitfalls

### Pitfall 1: Changing Code Examples Incorrectly

**What goes wrong:** Updating `selection` in code that still uses the Selection API internally
**Why it happens:** The API has both old and new names (deprecated alias pattern)
**How to avoid:** Check if the code example references a real API - if so, match the API name
**Warning signs:** Code examples that wouldn't compile after change

### Pitfall 2: Missing the Slot Name Exception

**What goes wrong:** Trying to rename `#game-board` slot to `#game-table`
**Why it happens:** Assuming all "board" references should change
**How to avoid:** The slot name was deliberately kept - only the component name changed
**Warning signs:** References to slot names in GameShell usage

### Pitfall 3: Removing Helpful Deprecation Information

**What goes wrong:** Removing all mentions of `currentSelection`
**Why it happens:** Thinking deprecated = should be hidden
**How to avoid:** Keep deprecation notes - they help users migrate
**Warning signs:** No migration path documented for old code

### Pitfall 4: Inconsistent Replacement Within Same Document

**What goes wrong:** Using "pick" in one paragraph and "selection" in the next
**Why it happens:** Partial search-and-replace
**How to avoid:** Review entire document after changes for consistency
**Warning signs:** Same document using both terms

## Documentation Files to Audit

Based on file listing and grep analysis:

### High Priority (many occurrences of deprecated terms)

| File | Selection Count | Position Count | Notes |
|------|-----------------|----------------|-------|
| `ui-components.md` | 31 | 6 | Largest file, most selection refs |
| `custom-ui-guide.md` | 23 | 1 | Already updated in phase 57-04 |
| `common-pitfalls.md` | 14 | 1 | Already updated in phase 57-04 |
| `actions-and-flow.md` | 11 | 2 | Core concepts doc |

### Medium Priority (some occurrences)

| File | Selection Count | Position Count | Notes |
|------|-----------------|----------------|-------|
| `element-enrichment.md` | 7 | 0 | Already updated in phase 57-04 |
| `nomenclature.md` | 4 | 2 | Should be correct (defines terms) |
| `core-concepts.md` | 0 | 5 | Position refs likely need review |
| `ai-system.md` | 1 | 5 | Position refs in AI context |
| `game-examples.md` | 0 | 3 | Code examples |
| `common-patterns.md` | 0 | 3 | Pattern examples |

### Low Priority (few or no occurrences)

| File | Notes |
|------|-------|
| `README.md` | Table of contents only |
| `getting-started.md` | Already uses correct terms |
| `architecture.md` | Package diagrams |
| `component-showcase.md` | Already uses correct terms |
| `conditions.md` | Small file |
| `dice-and-scoring.md` | No term conflicts |
| `llm-overview.md` | Summary doc |
| `api/*.md` | API reference files |

### Files Already Updated in Phase 57-04

Per the phase 57 plan, these files were updated with pick terminology:
- `custom-ui-guide.md`
- `common-pitfalls.md`
- `ui-components.md`

These need verification, not full re-audit.

## Term Mapping Reference

From `docs/nomenclature.md`, the key v2.3 terminology:

### Core Terms (from Phase 54)
| Term | Definition | v2.3 Change |
|------|------------|-------------|
| Table | The visual game area | Replaces "GameBoard" |
| Seat | Player's place at table (1-indexed) | Replaces "position" |
| Pick | A choice required for an action | Replaces "selection" (user-facing) |
| GameTable | Custom game visualization component | Replaces "GameBoard" component |

### Terms That Did NOT Change
| Term | Notes |
|------|-------|
| Session | GameSession class name kept |
| Board | Board is ON the table, not renamed |
| Zone | Conceptual term |
| selection (code) | Internal API - deprecated alias exists |
| #game-board slot | Slot name NOT renamed |

## Migration Guide Requirements

A migration guide section for v2.3 should include:

### Required Content

1. **API Changes**
   - `Player.position` → `Player.seat`
   - `playerPosition` prop → `playerSeat` prop
   - `currentSelection` → `currentPick` (deprecated alias available)
   - `SelectionMetadata` → `PickMetadata`

2. **Component Renames**
   - `GameBoard.vue` → `GameTable.vue`

3. **Terminology Changes**
   - "selection" → "pick" in user communication
   - "GameBoard" → "GameTable" for component name
   - "position" → "seat" for player property

4. **Backward Compatibility Notes**
   - `currentSelection` deprecated alias available
   - `#game-board` slot name unchanged

## Open Questions

None significant. The terminology changes are well-defined from phases 54-57.

1. **Migration guide location?**
   - What we know: PROJECT.md mentions `docs/migration-guide.md`
   - What's unclear: File doesn't exist yet
   - Recommendation: Create if needed, or add v2.3 section to existing docs

## Sources

### Primary (HIGH confidence)
- BoardSmith nomenclature.md (authoritative dictionary)
- Phase 54-57 research and plan documents
- v2.3 REQUIREMENTS.md and ROADMAP.md

### Secondary (MEDIUM confidence)
- Documentation file analysis via grep
- Phase 57-04 summary (what was already updated)

### Tertiary (LOW confidence)
- N/A

## Metadata

**Confidence breakdown:**
- Term mapping: HIGH - directly from nomenclature.md
- Files to audit: HIGH - from file listing and grep
- Migration guide content: HIGH - from phase summaries
- Exceptions/caveats: HIGH - from phase research docs

**Research date:** 2026-01-22
**Valid until:** End of v2.3 milestone

## Audit Checklist for Planner

For each docs/*.md file:

- [ ] Check for `selection` that should be `pick` (user-facing only)
- [ ] Check for `position` that should be `seat` (player property)
- [ ] Check for `GameBoard` that should be `GameTable` (component name)
- [ ] Verify code examples still compile with terminology
- [ ] Add nomenclature.md link if introducing concepts
- [ ] Check internal consistency within document

For migration guide:

- [ ] Document API renames with before/after
- [ ] Document component renames
- [ ] Document terminology changes
- [ ] Include backward compatibility notes
- [ ] Provide migration steps
