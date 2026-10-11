# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T12:35:34.191Z
- BoardSmith commit: `f8af16b2`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 4.20, 12.58, 15.10 at the start; 5.53, 9.38, 13.23 at the end
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, ms for the move, and steps per second.

| Game | Position | easy steps | easy ms | easy steps/s | medium steps | medium ms | medium steps/s | hard steps | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 400 | 250 | 300 | 865 | 347 | 475 | 1974 | 241 |
| checkers | middle (ply 56, seat 1) | 100 | 227 | 441 | 300 | 725 | 414 | 500 | 1320 | 379 |
| checkers | late (ply 100, seat 1) | 100 | 51 | 1944 | 300 | 120 | 2509 | 500 | 784 | 638 |
| chess | early (ply 7, seat 2) | 25 | 1028 | 24.3 | 28 | 1550 | 18.1 | 32 | 2031 | 15.8 |
| chess | middle (ply 38, seat 1) | 35 | 1033 | 33.9 | 40 | 1514 | 26.4 | 46 | 2042 | 22.5 |
| chess | late (ply 68, seat 2) | 34 | 1026 | 33.1 | 43 | 1539 | 27.9 | 49 | 2051 | 23.9 |
| cribbage | early (ply 12, seat 2) | 100 | 32 | 3133 | 300 | 80 | 3754 | 500 | 133 | 3770 |
| cribbage | middle (ply 60, seat 1) | 100 | 31 | 3254 | 300 | 91 | 3306 | 500 | 146 | 3433 |
| cribbage | late (ply 111, seat 1) | 100 | 76 | 1313 | 300 | 217 | 1381 | 500 | 355 | 1408 |
| go-fish | early (ply 8, seat 2) | 100 | 86 | 1157 | 300 | 258 | 1165 | 500 | 482 | 1038 |
| go-fish | middle (ply 43, seat 2) | 100 | 92 | 1083 | 300 | 316 | 949 | 500 | 540 | 926 |
| go-fish | late (ply 78, seat 2) | 100 | 122 | 822 | 300 | 435 | 689 | 500 | 403 | 1241 |
| hex-11 | early (ply 10, seat 1) | 100 | 476 | 210 | 269 | 1505 | 179 | 311 | 2005 | 155 |
| hex-11 | middle (ply 51, seat 2) | 100 | 502 | 199 | 241 | 1504 | 160 | 271 | 2007 | 135 |
| hex-11 | late (ply 91, seat 2) | 100 | 517 | 193 | 300 | 1434 | 209 | 359 | 2006 | 179 |
| hex-19 | early (ply 36, seat 1) | 74 | 1016 | 72.9 | 86 | 1525 | 56.4 | 102 | 2013 | 50.7 |
| hex-19 | middle (ply 180, seat 1) | 66 | 1017 | 64.9 | 83 | 1512 | 54.9 | 93 | 2022 | 46 |
| hex-19 | late (ply 324, seat 1) | 70 | 1019 | 68.7 | 82 | 1516 | 54.1 | 101 | 2007 | 50.3 |
| seven | early (ply 78, seat 2) | 100 | 70 | 1425 | 300 | 194 | 1548 | 500 | 320 | 1563 |
| seven | middle (ply 394, seat 2) | 100 | 57 | 1768 | 300 | 165 | 1816 | 500 | 282 | 1772 |
| seven | late (ply 709, seat 6) | 100 | 48 | 2069 | 300 | 139 | 2152 | 500 | 242 | 2070 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 850 | 353 | 13 | 26 | 44 | 5 | 6 | 0 | 6 | 52 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 691 | 434 | 14 | 24 | 46 | 6 | 6 | 0 | 4 | 55 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 132 | 2281 | 65 | 4 | 11 | 6 | 1 | 0 | 13 | 16 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 14934 | 20.1 | 1 | 38 | 58 | 1 | 1 | 0 | 1 | 53 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 11342 | 26.5 | 1 | 37 | 58 | 1 | 2 | 0 | 1 | 52 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 9863 | 30.4 | 1 | 34 | 61 | 2 | 2 | 0 | 1 | 51 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 73 | 4104 | 63 | 6 | 15 | 0 | 0 | 0 | 15 | 11 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 90 | 3326 | 60 | 9 | 17 | 0 | 0 | 0 | 15 | 17 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 206 | 1456 | 32 | 2 | 2 | 51 | 0 | 0 | 12 | 4 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 250 | 1198 | 24 | 10 | 29 | 8 | 5 | 12 | 13 | 43 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 299 | 1004 | 26 | 10 | 22 | 12 | 4 | 14 | 12 | 38 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 408 | 735 | 19 | 9 | 19 | 26 | 2 | 13 | 11 | 47 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 1628 | 184 | 8 | 4 | 34 | 1 | 27 | 0 | 26 | 54 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 1926 | 156 | 8 | 4 | 36 | 1 | 26 | 0 | 25 | 56 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 1621 | 185 | 9 | 4 | 41 | 1 | 21 | 0 | 23 | 58 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 4906 | 61.2 | 7 | 4 | 33 | 1 | 28 | 0 | 27 | 53 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 5499 | 54.6 | 7 | 4 | 36 | 1 | 27 | 0 | 25 | 56 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 5225 | 57.4 | 9 | 4 | 42 | 2 | 21 | 0 | 22 | 58 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 183 | 1643 | 73 | 2 | 5 | 5 | 0 | 0 | 14 | 14 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 164 | 1824 | 71 | 1 | 5 | 5 | 0 | 0 | 17 | 15 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 138 | 2173 | 79 | 1 | 6 | 2 | 0 | 0 | 12 | 17 | `discard card="red-4-3"` |
