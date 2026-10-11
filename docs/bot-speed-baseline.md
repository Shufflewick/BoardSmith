# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T16:09:22.660Z
- BoardSmith commit: `3ac444bf`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 3.59, 4.91, 10.27 at the start; 5.17, 5.15, 9.86 at the end
- Left out: merc, whose vendored copy of BoardSmith does not load against current BoardSmith (Shufflewick/MERC#64)
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, how many of them were scored (the rest were thrown away, #669), ms for the move, and steps per second.

| Game | Position | easy steps | easy scored | easy ms | easy steps/s | medium steps | medium scored | medium ms | medium steps/s | hard steps | hard scored | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 100 | 118 | 847 | 300 | 300 | 344 | 871 | 500 | 500 | 595 | 840 |
| checkers | middle (ply 56, seat 1) | 100 | 100 | 84 | 1187 | 300 | 300 | 251 | 1193 | 500 | 500 | 453 | 1103 |
| checkers | late (ply 100, seat 1) | 100 | 100 | 39 | 2581 | 300 | 300 | 110 | 2739 | 500 | 500 | 180 | 2773 |
| chess | early (ply 7, seat 2) | 100 | 100 | 889 | 113 | 151 | 151 | 1512 | 99.9 | 164 | 164 | 2007 | 81.7 |
| chess | middle (ply 38, seat 1) | 100 | 100 | 654 | 153 | 195 | 195 | 1512 | 129 | 210 | 210 | 2008 | 105 |
| chess | late (ply 68, seat 2) | 100 | 100 | 651 | 154 | 189 | 189 | 1507 | 125 | 226 | 226 | 2010 | 112 |
| cribbage | early (ply 12, seat 2) | 100 | 0 | 33 | 3056 | 300 | 0 | 91 | 3302 | 500 | 0 | 151 | 3316 |
| cribbage | middle (ply 60, seat 1) | 100 | 0 | 30 | 3364 | 300 | 0 | 90 | 3320 | 500 | 0 | 147 | 3394 |
| cribbage | late (ply 111, seat 1) | 100 | 0 | 87 | 1153 | 300 | 0 | 234 | 1279 | 500 | 0 | 417 | 1200 |
| go-fish | early (ply 8, seat 2) | 100 | 100 | 78 | 1287 | 300 | 300 | 223 | 1343 | 500 | 500 | 405 | 1234 |
| go-fish | middle (ply 43, seat 2) | 100 | 100 | 72 | 1380 | 300 | 300 | 259 | 1160 | 500 | 500 | 443 | 1128 |
| go-fish | late (ply 78, seat 2) | 100 | 100 | 83 | 1200 | 300 | 300 | 352 | 852 | 500 | 500 | 418 | 1197 |
| hex-11 | early (ply 10, seat 1) | 100 | 100 | 202 | 496 | 300 | 300 | 726 | 413 | 500 | 500 | 1328 | 377 |
| hex-11 | middle (ply 51, seat 2) | 100 | 100 | 235 | 425 | 300 | 300 | 791 | 379 | 500 | 500 | 1515 | 330 |
| hex-11 | late (ply 91, seat 2) | 100 | 100 | 253 | 396 | 300 | 300 | 653 | 460 | 500 | 500 | 1254 | 399 |
| hex-19 | early (ply 36, seat 1) | 100 | 100 | 587 | 170 | 227 | 227 | 1510 | 150 | 261 | 261 | 2011 | 130 |
| hex-19 | middle (ply 180, seat 1) | 100 | 100 | 686 | 146 | 186 | 186 | 1509 | 123 | 219 | 219 | 2013 | 109 |
| hex-19 | late (ply 324, seat 1) | 100 | 100 | 678 | 148 | 196 | 196 | 1507 | 130 | 248 | 248 | 2010 | 123 |
| seven | early (ply 78, seat 2) | 100 | 30 | 74 | 1349 | 300 | 20 | 191 | 1568 | 500 | 20 | 307 | 1627 |
| seven | middle (ply 394, seat 2) | 100 | 24 | 59 | 1699 | 300 | 16 | 188 | 1600 | 500 | 16 | 280 | 1785 |
| seven | late (ply 709, seat 6) | 100 | 0 | 48 | 2088 | 300 | 0 | 140 | 2149 | 500 | 0 | 230 | 2174 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | scored | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 300 | 286 | 1047 | 34 | 3 | 37 | 6 | 5 | 0 | 16 | 20 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 300 | 258 | 1164 | 37 | 2 | 36 | 6 | 5 | 0 | 13 | 21 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 300 | 105 | 2858 | 75 | 0 | 4 | 3 | 1 | 0 | 16 | 4 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 300 | 2972 | 101 | 4 | 1 | 87 | 3 | 3 | 0 | 2 | 26 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 300 | 2357 | 127 | 5 | 1 | 84 | 2 | 4 | 0 | 3 | 27 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 300 | 2260 | 133 | 5 | 1 | 85 | 3 | 4 | 0 | 2 | 25 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 0 | 81 | 3714 | 62 | 5 | 12 | 0 | 0 | 0 | 20 | 6 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 0 | 89 | 3354 | 65 | 5 | 12 | 0 | 0 | 0 | 18 | 8 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 0 | 234 | 1281 | 32 | 2 | 2 | 50 | 0 | 0 | 14 | 2 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 300 | 212 | 1418 | 27 | 9 | 24 | 7 | 4 | 14 | 14 | 36 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 300 | 242 | 1240 | 28 | 9 | 18 | 11 | 4 | 17 | 14 | 32 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 300 | 322 | 932 | 21 | 8 | 15 | 23 | 2 | 16 | 15 | 38 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 300 | 704 | 426 | 16 | 3 | 23 | 1 | 28 | 0 | 29 | 25 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 300 | 792 | 379 | 17 | 2 | 26 | 1 | 27 | 0 | 27 | 33 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 300 | 722 | 415 | 20 | 1 | 32 | 1 | 22 | 0 | 24 | 38 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 300 | 2054 | 146 | 14 | 3 | 21 | 1 | 31 | 0 | 30 | 24 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 300 | 2384 | 126 | 15 | 2 | 26 | 1 | 28 | 0 | 28 | 33 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 300 | 2277 | 132 | 20 | 1 | 33 | 2 | 22 | 0 | 23 | 40 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 20 | 183 | 1636 | 73 | 2 | 4 | 5 | 0 | 0 | 16 | 11 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 16 | 170 | 1760 | 72 | 1 | 5 | 5 | 0 | 0 | 17 | 12 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 0 | 138 | 2167 | 77 | 1 | 5 | 2 | 0 | 0 | 15 | 13 | `discard card="red-4-3"` |
