# BoardSmith Documentation

This folder contains documentation for the BoardSmith game framework.

## Documents

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started.md) | CLI setup, project creation, and basic development |
| [Core Concepts](./core-concepts.md) | Element tree, visibility, actions vs commands |
| [Actions & Flow](./actions-and-flow.md) | Action builder API and declarative flow system |
| [Dice & Scoring](./dice-and-scoring.md) | Dice elements, 3D rendering, abilities, and scoring tracks |
| [UI Components](./ui-components.md) | Vue components and composables |
| [AI System](./ai-system.md) | MCTS bot and AI integration |
| [Game Examples](./game-examples.md) | Analysis of example games with patterns |
| [LLM Overview](./llm-overview.md) | Quick-reference for LLMs |
| [Nomenclature](./nomenclature.md) | Standard terminology reference |

## For LLMs

If you're an AI assistant reading this codebase:

1. **Start with** [`llm-overview.md`](./llm-overview.md) for a comprehensive summary
2. **Simplest example**: `packages/games/hex/` - minimal but complete game
3. **Complex example**: `packages/games/cribbage/` - multi-phase, simultaneous actions

## Generated LLM Context

The repository includes a `repomix.config.json` that generates `llms.txt` - a single file containing the entire relevant codebase optimized for LLM consumption.

To regenerate:
```bash
npx repomix
```

This produces a ~750KB file with:
- All documentation
- Core engine code
- Example game implementations
- CLI tools
- Excludes tests, type declarations, and node_modules

## Quick Links

- **CLI**: `boardsmith init`, `boardsmith dev`, `boardsmith test`
- **Key packages**: `boardsmith`, `boardsmith/ui`, `boardsmith/ai`
- **Example games**: `packages/games/{hex, go-fish, checkers, cribbage}`
