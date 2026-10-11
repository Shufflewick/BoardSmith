# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T15:39:25.148Z
- BoardSmith commit: `583f57cd`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 7.97, 25.40, 24.15 at the start; 8.26, 18.73, 21.63 at the end
- Left out: merc, whose vendored copy of BoardSmith does not load against current BoardSmith (Shufflewick/MERC#64)
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, how many of them were scored (the rest were thrown away, #669), ms for the move, and steps per second.

| Game | Position | easy steps | easy scored | easy ms | easy steps/s | medium steps | medium scored | medium ms | medium steps/s | hard steps | hard scored | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 100 | 258 | 388 | 300 | 300 | 686 | 437 | 500 | 500 | 1254 | 399 |
| checkers | middle (ply 56, seat 1) | 100 | 100 | 162 | 618 | 300 | 300 | 536 | 559 | 500 | 500 | 1164 | 430 |
| checkers | late (ply 100, seat 1) | 100 | 100 | 52 | 1931 | 300 | 300 | 142 | 2109 | 500 | 500 | 250 | 1997 |
| chess | early (ply 7, seat 2) | 51 | 51 | 1005 | 50.7 | 62 | 62 | 1520 | 40.8 | 66 | 66 | 2019 | 32.7 |
| chess | middle (ply 38, seat 1) | 68 | 68 | 1005 | 67.6 | 87 | 87 | 1517 | 57.4 | 87 | 87 | 2032 | 42.8 |
| chess | late (ply 68, seat 2) | 63 | 63 | 1012 | 62.2 | 79 | 79 | 1510 | 52.3 | 85 | 85 | 2021 | 42.1 |
| cribbage | early (ply 12, seat 2) | 100 | 0 | 43 | 2330 | 300 | 0 | 125 | 2402 | 500 | 0 | 182 | 2753 |
| cribbage | middle (ply 60, seat 1) | 100 | 0 | 50 | 2007 | 300 | 0 | 125 | 2405 | 500 | 0 | 194 | 2574 |
| cribbage | late (ply 111, seat 1) | 100 | 0 | 96 | 1041 | 300 | 0 | 288 | 1042 | 500 | 0 | 486 | 1028 |
| go-fish | early (ply 8, seat 2) | 100 | 100 | 128 | 778 | 300 | 300 | 409 | 733 | 500 | 500 | 660 | 758 |
| go-fish | middle (ply 43, seat 2) | 100 | 100 | 99 | 1010 | 300 | 300 | 321 | 934 | 500 | 500 | 621 | 805 |
| go-fish | late (ply 78, seat 2) | 100 | 100 | 121 | 827 | 300 | 300 | 549 | 546 | 500 | 500 | 788 | 634 |
| hex-11 | early (ply 10, seat 1) | 100 | 100 | 483 | 207 | 261 | 261 | 1505 | 173 | 301 | 301 | 2010 | 150 |
| hex-11 | middle (ply 51, seat 2) | 100 | 100 | 520 | 192 | 235 | 235 | 1506 | 156 | 269 | 269 | 2008 | 134 |
| hex-11 | late (ply 91, seat 2) | 100 | 100 | 528 | 189 | 300 | 300 | 1413 | 212 | 341 | 341 | 2008 | 170 |
| hex-19 | early (ply 36, seat 1) | 73 | 73 | 1016 | 71.8 | 91 | 91 | 1512 | 60.2 | 102 | 102 | 2028 | 50.3 |
| hex-19 | middle (ply 180, seat 1) | 63 | 63 | 1019 | 61.8 | 77 | 77 | 1524 | 50.5 | 88 | 88 | 2025 | 43.4 |
| hex-19 | late (ply 324, seat 1) | 67 | 67 | 1009 | 66.4 | 76 | 76 | 1522 | 49.9 | 92 | 92 | 2007 | 45.8 |
| seven | early (ply 78, seat 2) | 100 | 30 | 99 | 1006 | 300 | 20 | 272 | 1101 | 500 | 20 | 368 | 1360 |
| seven | middle (ply 394, seat 2) | 100 | 24 | 66 | 1509 | 300 | 16 | 191 | 1574 | 500 | 16 | 324 | 1542 |
| seven | late (ply 709, seat 6) | 100 | 0 | 55 | 1816 | 300 | 0 | 167 | 1797 | 500 | 0 | 258 | 1941 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | scored | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 300 | 605 | 496 | 21 | 3 | 49 | 8 | 9 | 0 | 10 | 43 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 300 | 517 | 580 | 23 | 3 | 49 | 8 | 9 | 0 | 8 | 44 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 300 | 149 | 2020 | 67 | 1 | 8 | 7 | 2 | 0 | 15 | 12 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 300 | 6943 | 43.2 | 2 | 1 | 90 | 3 | 3 | 0 | 2 | 53 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 300 | 5283 | 56.8 | 3 | 1 | 88 | 3 | 3 | 0 | 2 | 53 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 300 | 5509 | 54.5 | 3 | 1 | 88 | 3 | 3 | 0 | 2 | 51 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 0 | 93 | 3213 | 60 | 6 | 15 | 0 | 0 | 0 | 19 | 8 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 0 | 119 | 2515 | 58 | 7 | 15 | 0 | 0 | 0 | 19 | 10 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 0 | 344 | 873 | 31 | 2 | 4 | 49 | 0 | 0 | 15 | 4 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 300 | 374 | 802 | 26 | 9 | 27 | 8 | 5 | 12 | 14 | 38 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 300 | 315 | 954 | 27 | 9 | 21 | 12 | 4 | 14 | 14 | 35 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 300 | 431 | 696 | 20 | 7 | 18 | 26 | 2 | 14 | 12 | 43 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 300 | 1715 | 175 | 9 | 2 | 32 | 1 | 28 | 0 | 28 | 49 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 300 | 1830 | 164 | 9 | 1 | 36 | 1 | 27 | 0 | 26 | 54 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 300 | 1663 | 180 | 11 | 1 | 41 | 1 | 22 | 0 | 25 | 55 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 300 | 5184 | 57.9 | 7 | 2 | 32 | 1 | 29 | 0 | 28 | 51 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 300 | 6110 | 49.1 | 8 | 1 | 35 | 1 | 28 | 0 | 27 | 54 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 300 | 5581 | 53.8 | 10 | 0 | 42 | 2 | 22 | 0 | 23 | 56 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 20 | 211 | 1425 | 71 | 2 | 5 | 5 | 0 | 0 | 16 | 13 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 16 | 192 | 1563 | 71 | 2 | 5 | 6 | 0 | 0 | 16 | 15 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 0 | 159 | 1882 | 76 | 1 | 6 | 2 | 0 | 0 | 14 | 16 | `discard card="red-4-3"` |
