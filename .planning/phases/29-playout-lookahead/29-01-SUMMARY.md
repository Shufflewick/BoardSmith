# Phase 29-01: Enable Playout Lookahead

## Status: Complete

## Goal
Change `playoutDepth` from 0 to 3-5 in MCTS difficulty presets so the AI can simulate ahead and discover forcing sequences.

## Changes Made

### packages/ai/src/types.ts
- `DEFAULT_CONFIG.playoutDepth`: 0 → 3
- `DIFFICULTY_PRESETS.easy.playoutDepth`: 0 → 2
- `DIFFICULTY_PRESETS.medium.playoutDepth`: 0 → 3
- `DIFFICULTY_PRESETS.hard.playoutDepth`: 0 → 4

### packages/ai/src/mcts-bot.ts
- Removed debug logging (console.log statements)

## Benchmark Results

**Baseline (playoutDepth=0):**
- P1 wins: 40%, P2 wins: 60%
- Avg moves/game: 29.2
- Avg time/game: 2.23s

**With playoutDepth=3 (40 games):**
- P1 wins: 57.5%, P2 wins: 42.5%
- Avg moves/game: 38.3
- Avg time/game: 1.81s

## Analysis

1. **Win distribution normalized** - P1 now shows expected first-player advantage in Hex (57% vs previous 40%)
2. **Games last 30% longer** - More contested, strategic play (38 vs 29 moves)
3. **Response time improved** - Lookahead helps prune search faster (1.81s vs 2.23s)

## Limitation Found

While AI vs AI benchmarks improved, manual testing showed the AI still fails to block obvious straight-line strategies by a human player. This is addressed in Phase 30 (Threat Response Forcing).
