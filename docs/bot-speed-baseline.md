# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T03:33:46.092Z
- BoardSmith commit: `e4d6a41b`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 5.02, 20.62, 43.46 at the start; 6.75, 24.22, 35.75 at the end
- Skipped: merc, which is not checked out at /Users/jtsmith/Dropbox/MERC/BoardSmith/MERC
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, ms for the move, and steps per second.

| Game | Position | easy steps | easy ms | easy steps/s | medium steps | medium ms | medium steps/s | hard steps | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 37 | 1047 | 35.3 | 47 | 1513 | 31.1 | 56 | 2037 | 27.5 |
| checkers | middle (ply 56, seat 1) | 64 | 1011 | 63.3 | 82 | 1515 | 54.1 | 111 | 2025 | 54.8 |
| checkers | late (ply 100, seat 1) | 100 | 498 | 201 | 300 | 1483 | 202 | 398 | 2014 | 198 |
| chess | early (ply 7, seat 2) | 8 | 1087 | 7.4 | 9 | 1580 | 5.7 | 10 | 2120 | 4.7 |
| chess | middle (ply 38, seat 1) | 10 | 1071 | 9.3 | 10 | 1534 | 6.5 | 12 | 2096 | 5.7 |
| chess | late (ply 68, seat 2) | 16 | 1060 | 15.1 | 19 | 1575 | 12.1 | 20 | 2108 | 9.5 |
| cribbage | early (ply 12, seat 2) | 100 | 35 | 2842 | 300 | 95 | 3151 | 500 | 165 | 3037 |
| cribbage | middle (ply 60, seat 1) | 100 | 38 | 2644 | 300 | 107 | 2801 | 500 | 181 | 2760 |
| cribbage | late (ply 111, seat 1) | 100 | 88 | 1141 | 300 | 249 | 1203 | 500 | 480 | 1042 |
| go-fish | early (ply 8, seat 2) | 100 | 115 | 871 | 300 | 334 | 899 | 500 | 517 | 967 |
| go-fish | middle (ply 43, seat 2) | 100 | 117 | 855 | 300 | 362 | 830 | 500 | 656 | 762 |
| go-fish | late (ply 78, seat 2) | 100 | 82 | 1216 | 300 | 419 | 716 | 500 | 505 | 990 |
| hex-11 | early (ply 10, seat 1) | 100 | 660 | 152 | 200 | 1505 | 133 | 255 | 2012 | 127 |
| hex-11 | middle (ply 51, seat 2) | 100 | 623 | 160 | 175 | 1508 | 116 | 226 | 2007 | 113 |
| hex-11 | late (ply 91, seat 2) | 100 | 857 | 117 | 150 | 1505 | 99.6 | 167 | 2012 | 83 |
| hex-19 | early (ply 36, seat 1) | 67 | 1018 | 65.8 | 83 | 1516 | 54.8 | 90 | 2030 | 44.3 |
| hex-19 | middle (ply 180, seat 1) | 42 | 1028 | 40.8 | 55 | 1533 | 35.9 | 64 | 2011 | 31.8 |
| hex-19 | late (ply 324, seat 1) | 24 | 1025 | 23.4 | 28 | 1538 | 18.2 | 32 | 2034 | 15.7 |
| seven | early (ply 78, seat 2) | 100 | 68 | 1472 | 300 | 201 | 1493 | 500 | 380 | 1316 |
| seven | middle (ply 394, seat 2) | 100 | 57 | 1748 | 300 | 170 | 1767 | 500 | 275 | 1816 |
| seven | late (ply 709, seat 6) | 100 | 47 | 2105 | 300 | 129 | 2318 | 500 | 231 | 2168 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 24544 | 12.2 | 1 | 4 | 6 | 89 | 0 | 0 | 0 | 88 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 8449 | 35.5 | 2 | 8 | 15 | 73 | 1 | 0 | 0 | 88 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 1493 | 201 | 10 | 1 | 3 | 85 | 0 | 0 | 1 | 82 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 81560 | 3.7 | 0 | 21 | 27 | 52 | 1 | 0 | 0 | 80 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 143219 | 2.1 | 0 | 20 | 28 | 51 | 1 | 0 | 0 | 81 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 37583 | 8 | 0 | 28 | 44 | 27 | 1 | 0 | 0 | 80 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 84 | 3566 | 57 | 7 | 17 | 0 | 0 | 0 | 20 | 10 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 106 | 2832 | 52 | 11 | 19 | 0 | 0 | 0 | 18 | 16 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 283 | 1060 | 28 | 3 | 3 | 51 | 0 | 0 | 14 | 4 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 275 | 1090 | 24 | 11 | 28 | 8 | 5 | 11 | 14 | 42 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 341 | 881 | 25 | 10 | 23 | 12 | 4 | 15 | 12 | 40 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 413 | 727 | 18 | 9 | 19 | 27 | 2 | 13 | 12 | 47 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 2597 | 116 | 4 | 3 | 24 | 32 | 18 | 0 | 19 | 60 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 2453 | 122 | 4 | 3 | 36 | 15 | 20 | 0 | 21 | 62 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 3177 | 94.4 | 4 | 2 | 40 | 30 | 11 | 0 | 13 | 71 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 6527 | 46 | 4 | 3 | 26 | 22 | 23 | 0 | 22 | 57 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 9245 | 32.4 | 3 | 3 | 40 | 19 | 18 | 0 | 17 | 67 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 20922 | 14.3 | 2 | 1 | 47 | 38 | 6 | 0 | 6 | 83 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 203 | 1476 | 67 | 2 | 7 | 7 | 0 | 0 | 16 | 14 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 166 | 1810 | 69 | 2 | 6 | 7 | 0 | 0 | 16 | 16 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 130 | 2313 | 75 | 1 | 7 | 3 | 0 | 0 | 14 | 17 | `discard card="red-4-3"` |
