# Aspect Registry

This file lists available aspects and their detection keywords.

## Available Aspects

| Aspect | Template File | Keywords |
|--------|--------------|----------|
| Dice | `dice.md` | dice, roll, d4, d6, d8, d10, d12, d20, rolling |
| PlayingCards | `playing-cards.md` | cards, deck, hand, deal, draw, suit, rank, trump, discard |
| HexGrid | `hex-grid.md` | hex, hexagon, honeycomb, hexes, hexagonal |
| SquareGrid | `square-grid.md` | grid, board, square, chess, checkers, 8x8, tiles |

## Detection Rules

1. **Keyword matching is case-insensitive**
2. **Multiple aspects can be detected** - A game can have Dice + SquareGrid
3. **Inference fallback** - If keywords don't match but mechanics suggest an aspect, infer it
4. **Detection happens after interview** - Use component answers from Question 2

## Inference Examples

| Description | Detected Aspect | Reason |
|-------------|-----------------|--------|
| "players roll three dice" | Dice | Keyword "roll" and "dice" |
| "a random number from 1 to 6" | Dice | Inference: d6-like mechanic |
| "standard 52-card deck" | PlayingCards | Keywords "card" and "deck" |
| "players have a hand of cards" | PlayingCards | Keywords "hand" and "cards" |
| "pieces move on a hex board" | HexGrid | Keyword "hex" |
| "8x8 grid like chess" | SquareGrid | Keywords "grid", "8x8", "chess" |
| "checkerboard pattern" | SquareGrid | Keyword "checkers" pattern |

## Usage

After the interview, scan the component answers for keywords:

```
Components from interview:
- Cards: "52-card deck, 5 cards per hand"  → PlayingCards
- Board: "hex grid, 7 cells per side"       → HexGrid
- Dice: "None"                              → (no dice aspect)
- Tokens: "pawns for each player"           → (no specific aspect)

Detected aspects: PlayingCards, HexGrid
```

Then read the template files for detected aspects and merge their contributions into the generated code.
