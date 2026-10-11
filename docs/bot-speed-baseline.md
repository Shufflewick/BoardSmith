# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T02:34:04.617Z
- BoardSmith commit: `a99404a2`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 4.18, 17.74, 20.91 at the start; 14.73, 20.32, 21.79 at the end
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, ms for the move, and steps per second.

| Game | Position | easy steps | easy ms | easy steps/s | medium steps | medium ms | medium steps/s | hard steps | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 36 | 1042 | 34.6 | 43 | 1534 | 28 | 55 | 2055 | 26.8 |
| checkers | middle (ply 56, seat 1) | 67 | 1020 | 65.7 | 87 | 1531 | 56.8 | 112 | 2034 | 55.1 |
| checkers | late (ply 100, seat 1) | 100 | 467 | 214 | 300 | 1443 | 208 | 384 | 2009 | 191 |
| chess | early (ply 7, seat 2) | 9 | 1045 | 8.6 | 10 | 1580 | 6.3 | 11 | 2069 | 5.3 |
| chess | middle (ply 38, seat 1) | 11 | 1054 | 10.4 | 13 | 1617 | 8 | 15 | 2085 | 7.2 |
| chess | late (ply 68, seat 2) | 16 | 1064 | 15 | 19 | 1549 | 12.3 | 19 | 2020 | 9.4 |
| cribbage | early (ply 12, seat 2) | 100 | 45 | 2212 | 300 | 99 | 3038 | 500 | 186 | 2693 |
| cribbage | middle (ply 60, seat 1) | 100 | 49 | 2060 | 300 | 101 | 2965 | 500 | 176 | 2842 |
| cribbage | late (ply 111, seat 1) | 100 | 87 | 1154 | 300 | 248 | 1212 | 500 | 354 | 1414 |
| go-fish | early (ply 8, seat 2) | 100 | 82 | 1212 | 300 | 254 | 1182 | 500 | 442 | 1131 |
| go-fish | middle (ply 43, seat 2) | 100 | 80 | 1253 | 300 | 318 | 944 | 500 | 461 | 1084 |
| go-fish | late (ply 78, seat 2) | 100 | 88 | 1139 | 300 | 183 | 1639 | 500 | 579 | 864 |
| hex-11 | early (ply 10, seat 1) | 100 | 521 | 192 | 215 | 1507 | 143 | 284 | 2007 | 141 |
| hex-11 | middle (ply 51, seat 2) | 100 | 556 | 180 | 213 | 1510 | 141 | 247 | 2008 | 123 |
| hex-11 | late (ply 91, seat 2) | 100 | 801 | 125 | 166 | 1502 | 111 | 192 | 2009 | 95.6 |
| hex-19 | early (ply 36, seat 1) | 73 | 1020 | 71.6 | 88 | 1509 | 58.3 | 97 | 2028 | 47.8 |
| hex-19 | middle (ply 180, seat 1) | 47 | 1015 | 46.3 | 56 | 1529 | 36.6 | 66 | 2012 | 32.8 |
| hex-19 | late (ply 324, seat 1) | 22 | 1037 | 21.2 | 21 | 1532 | 13.7 | 32 | 2045 | 15.6 |
| seven | early (ply 78, seat 2) | 100 | 298 | 335 | 300 | 493 | 609 | 500 | 837 | 598 |
| seven | middle (ply 394, seat 2) | 100 | 211 | 475 | 300 | 1099 | 273 | 500 | 1773 | 282 |
| seven | late (ply 709, seat 6) | 100 | 97 | 1032 | 300 | 629 | 477 | 500 | 878 | 570 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. The part columns are percent of the move's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 24519 | 12.2 | 1 | 4 | 6 | 89 | 0 | 0 | 0 | 88 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 8486 | 35.4 | 2 | 9 | 15 | 73 | 1 | 0 | 0 | 88 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 1576 | 190 | 10 | 1 | 3 | 85 | 0 | 0 | 1 | 83 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 156337 | 1.9 | 0 | 21 | 27 | 52 | 1 | 0 | 0 | 80 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 64377 | 4.7 | 0 | 20 | 28 | 51 | 1 | 0 | 0 | 82 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 40176 | 7.5 | 0 | 28 | 43 | 27 | 1 | 0 | 0 | 80 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 106 | 2822 | 55 | 8 | 17 | 0 | 0 | 0 | 19 | 10 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 90 | 3318 | 58 | 10 | 17 | 0 | 0 | 0 | 15 | 17 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 209 | 1437 | 31 | 2 | 3 | 53 | 0 | 0 | 11 | 4 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 245 | 1222 | 24 | 11 | 30 | 8 | 5 | 12 | 11 | 45 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 266 | 1127 | 25 | 10 | 24 | 12 | 4 | 15 | 10 | 42 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 372 | 806 | 18 | 10 | 20 | 28 | 2 | 14 | 10 | 50 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 2480 | 121 | 3 | 3 | 24 | 32 | 18 | 0 | 18 | 61 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 2286 | 131 | 4 | 3 | 37 | 16 | 20 | 0 | 20 | 64 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 3067 | 97.8 | 3 | 2 | 41 | 30 | 11 | 0 | 13 | 73 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 6937 | 43.2 | 4 | 3 | 26 | 22 | 23 | 0 | 22 | 57 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 9377 | 32 | 3 | 3 | 39 | 19 | 18 | 0 | 17 | 67 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 20803 | 14.4 | 2 | 1 | 47 | 39 | 6 | 0 | 6 | 84 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 495 | 606 | 55 | 2 | 6 | 8 | 0 | 0 | 28 | 14 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 1155 | 260 | 41 | 3 | 8 | 12 | 0 | 0 | 36 | 9 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 273 | 1098 | 59 | 4 | 9 | 5 | 0 | 0 | 23 | 15 | `discard card="red-4-3"` |
