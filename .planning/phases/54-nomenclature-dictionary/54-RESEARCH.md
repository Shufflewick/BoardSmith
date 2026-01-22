# Phase 54: Nomenclature Dictionary - Research

**Researched:** 2026-01-21
**Domain:** Documentation / Terminology Standardization
**Confidence:** HIGH

## Summary

This phase creates the authoritative terminology reference document (`docs/nomenclature.md`) for BoardSmith. The dictionary will define standardized terms across the entire codebase and documentation to ensure consistency before external adoption.

Based on analysis of the BoardSmith codebase, documentation, and the v2.3 roadmap requirements, the terminology falls into clearly defined categories. The codebase already uses consistent naming internally, but lacks a central reference document that defines these terms for users and contributors.

**Primary recommendation:** Create a comprehensive markdown dictionary organized by category (Core, Players, Flow, Elements, Zones, Actions, UI) with clear definitions, relationships, and usage examples.

## Standard Stack

This phase is documentation-only. No external libraries or tools required.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| Markdown | N/A | Documentation format | Standard for docs/*.md files |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| N/A | | | |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Markdown | TSDoc/JSDoc | JSDoc is for API docs, not terminology reference |
| Single file | Multiple files | Single file easier to search and maintain |

## Architecture Patterns

### Recommended Document Structure

```markdown
# BoardSmith Nomenclature

Quick reference table of all terms...

## Core Concepts
- Table, Board, Zone, Session, Rules (Game class)

## Players
- Player, Seat (position), Turn, Active Player

## Game Flow
- Phase, Round, Turn, Action, Flow

## Elements
- Element, Piece, Space, Container

## Zones
- Zone, Area, Region, Visibility

## Actions & Selections
- Action, Pick (selection), Choice, Execute

## UI Components
- GameShell, GameTable (GameBoard), ActionPanel
```

### Pattern 1: Term Entry Format
**What:** Each term has a consistent entry format
**When to use:** Every term in the dictionary
**Example:**
```markdown
### Table

**Definition:** The visual game area where all game components are displayed and interactions occur.

**In Code:** `GameTable.vue` component
**Related Terms:** Board, Zone, GameShell
**Usage:**
- "The table shows all player hands and the central play area"
- "Configure the table layout in GameTable.vue"

**Note:** Replaces "GameBoard" - the board is a component ON the table, not the table itself.
```

### Pattern 2: Category Introduction
**What:** Each category starts with a brief explanation of the domain
**When to use:** At the start of each major section
**Example:**
```markdown
## Elements

Game elements are the building blocks of any BoardSmith game. They form a tree structure with the Game at the root.

| Term | Definition |
|------|------------|
| Element | Base unit in the game tree... |
```

### Anti-Patterns to Avoid
- **Undefined cross-references:** Every "Related Terms" entry must have its own definition
- **Ambiguous terms:** If a term has multiple meanings, explicitly distinguish them
- **Implementation details in definitions:** Keep definitions user-focused, not code-focused

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Term search | Custom search tooling | Standard markdown + Ctrl+F | Markdown is universally searchable |
| Cross-references | Automated link validation | Manual review | Dictionary is small enough for manual checking |
| Version tracking | Complex versioning system | Git history + "Last updated" header | Simple is better for this use case |

**Key insight:** This is a documentation task, not an engineering task. Keep it simple.

## Common Pitfalls

### Pitfall 1: Mixing Implementation and Conceptual Terms
**What goes wrong:** Defining "Player" both as a concept and as the `Player` class
**Why it happens:** Same word used in different contexts
**How to avoid:** Use "In Code" section to link conceptual term to implementation
**Warning signs:** Definitions that reference class methods or properties

### Pitfall 2: Circular Definitions
**What goes wrong:** "A Zone is an area" + "An Area is a zone"
**Why it happens:** Related terms defined in terms of each other
**How to avoid:** Define one term first with an independent definition, then reference it
**Warning signs:** Definitions that only use synonyms

### Pitfall 3: Missing the v2.3 Renames
**What goes wrong:** Dictionary doesn't include the NEW terms (Table, Seat, Pick)
**Why it happens:** Writing based on current codebase, not the planned state
**How to avoid:** Include both current and new terms with migration notes
**Warning signs:** Dictionary only has current terminology

### Pitfall 4: Over-Engineering Categories
**What goes wrong:** Too many categories, hard to find terms
**Why it happens:** Trying to be exhaustive
**How to avoid:** Start with 6-8 major categories, merge small ones
**Warning signs:** Categories with only 1-2 terms

## Code Examples

Not applicable for this documentation phase.

## Term Categories Identified

Based on codebase analysis, the following categories and terms should be included:

### Core Concepts
| Term | Current Usage | Notes |
|------|---------------|-------|
| Table | (new in v2.3) | The visual game area |
| Board | GameBoard.vue | A component ON the table (being renamed to Table) |
| Zone | Conceptual | A logical area with visibility rules |
| Session | GameSession | A single game instance |
| Rules | Game class | The game logic and setup |

### Players
| Term | Current Usage | Notes |
|------|---------------|-------|
| Player | Player class | A participant in the game |
| Seat | position (v2.3 rename) | A player's place at the table (0-indexed) |
| Active Player | currentPlayer | The player whose turn it is |
| Owner | player property | The player who owns an element |

### Game Flow
| Term | Current Usage | Notes |
|------|---------------|-------|
| Phase | phase() builder | A named section of game flow |
| Round | loop pattern | One complete cycle through all players |
| Turn | actionStep | A player's opportunity to act |
| Flow | FlowDefinition | The overall structure of game progression |

### Elements
| Term | Current Usage | Notes |
|------|---------------|-------|
| Element | GameElement | Base unit in the game tree |
| Piece | Piece class | A movable element (cards, tokens) |
| Space | Space class | A container/location for pieces |
| Card | Card class | A piece with rank/suit/faceUp |
| Die | Die class | A piece with rollable value |

### Zones (Spaces)
| Term | Current Usage | Notes |
|------|---------------|-------|
| Deck | Deck class | A Space for stacked, usually hidden cards |
| Hand | Hand class | A player's private Space |
| Grid | Grid class | A Space with row/column organization |
| HexGrid | HexGrid class | A Space with hexagonal cells |
| DicePool | DicePool class | A Space for dice |

### Actions & Selections
| Term | Current Usage | Notes |
|------|---------------|-------|
| Action | ActionDefinition | Something a player can do |
| Pick | selection (v2.3 rename) | A choice required for an action |
| Choice | ChoiceSelection | A pick from enumerated options |
| Execute | execute() | Running the action's effect |
| Condition | condition property | Prerequisites for an action |

### UI Components
| Term | Current Usage | Notes |
|------|---------------|-------|
| GameShell | GameShell.vue | Top-level game wrapper |
| GameTable | GameBoard.vue (v2.3) | Custom game visualization |
| ActionPanel | ActionPanel.vue | Action selection UI |
| AutoUI | AutoUI.vue | Auto-generated game UI |

## Open Questions

None significant. The terminology is well-established in the codebase.

1. **Order of terms within categories?**
   - What we know: Alphabetical or by importance both work
   - What's unclear: Which ordering is better for discoverability
   - Recommendation: Use importance/frequency order, with alphabetical index at top

## Sources

### Primary (HIGH confidence)
- BoardSmith codebase analysis (src/engine/*, docs/*.md)
- v2.3 Requirements (`/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md`)
- v2.3 Roadmap (`/Users/jtsmith/BoardSmith/.planning/ROADMAP.md`)

### Secondary (MEDIUM confidence)
- Existing documentation (docs/core-concepts.md, docs/ui-components.md, docs/actions-and-flow.md)

### Tertiary (LOW confidence)
- N/A

## Metadata

**Confidence breakdown:**
- Term categories: HIGH - directly from codebase analysis
- Term definitions: HIGH - based on JSDoc and usage patterns
- Document structure: HIGH - follows existing docs/*.md patterns

**Research date:** 2026-01-21
**Valid until:** Indefinite (terminology is stable)
