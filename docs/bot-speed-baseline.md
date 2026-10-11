# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T14:06:57.512Z
- BoardSmith commit: `ddf7bfb5`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 14.63, 33.72, 28.23 at the start; 8.82, 22.81, 24.65 at the end
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, ms for the move, and steps per second.

| Game | Position | easy steps | easy ms | easy steps/s | medium steps | medium ms | medium steps/s | hard steps | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 462 | 217 | 222 | 1509 | 147 | 319 | 2004 | 159 |
| checkers | middle (ply 56, seat 1) | 100 | 173 | 579 | 300 | 973 | 308 | 500 | 1728 | 289 |
| checkers | late (ply 100, seat 1) | 100 | 78 | 1281 | 300 | 222 | 1353 | 500 | 944 | 530 |
| chess | early (ply 7, seat 2) | 53 | 1018 | 52 | 60 | 1508 | 39.8 | 70 | 2028 | 34.5 |
| chess | middle (ply 38, seat 1) | 52 | 1018 | 51.1 | 62 | 1509 | 41.1 | 83 | 2011 | 41.3 |
| chess | late (ply 68, seat 2) | 67 | 1006 | 66.6 | 79 | 1519 | 52 | 88 | 2007 | 43.8 |
| cribbage | early (ply 12, seat 2) | 100 | 35 | 2847 | 300 | 99 | 3025 | 500 | 147 | 3399 |
| cribbage | middle (ply 60, seat 1) | 100 | 33 | 3068 | 300 | 100 | 3004 | 500 | 200 | 2497 |
| cribbage | late (ply 111, seat 1) | 100 | 85 | 1179 | 300 | 252 | 1193 | 500 | 401 | 1248 |
| go-fish | early (ply 8, seat 2) | 100 | 98 | 1015 | 300 | 275 | 1090 | 500 | 414 | 1208 |
| go-fish | middle (ply 43, seat 2) | 100 | 85 | 1173 | 300 | 268 | 1119 | 500 | 470 | 1065 |
| go-fish | late (ply 78, seat 2) | 100 | 83 | 1205 | 300 | 216 | 1389 | 500 | 448 | 1116 |
| hex-11 | early (ply 10, seat 1) | 100 | 234 | 427 | 300 | 919 | 326 | 500 | 1704 | 293 |
| hex-11 | middle (ply 51, seat 2) | 100 | 252 | 396 | 300 | 883 | 340 | 500 | 1699 | 294 |
| hex-11 | late (ply 91, seat 2) | 100 | 287 | 348 | 300 | 1162 | 258 | 500 | 1976 | 253 |
| hex-19 | early (ply 36, seat 1) | 100 | 788 | 127 | 157 | 1505 | 104 | 181 | 2011 | 90 |
| hex-19 | middle (ply 180, seat 1) | 99 | 1007 | 98.4 | 137 | 1516 | 90.4 | 171 | 2012 | 85 |
| hex-19 | late (ply 324, seat 1) | 100 | 858 | 117 | 156 | 1512 | 103 | 186 | 2011 | 92.5 |
| seven | early (ply 78, seat 2) | 100 | 75 | 1325 | 300 | 244 | 1229 | 500 | 325 | 1537 |
| seven | middle (ply 394, seat 2) | 100 | 65 | 1534 | 300 | 219 | 1372 | 500 | 382 | 1310 |
| seven | late (ply 709, seat 6) | 100 | 62 | 1619 | 300 | 195 | 1540 | 500 | 374 | 1336 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 2216 | 135 | 3 | 4 | 6 | 83 | 1 | 0 | 3 | 37 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 923 | 325 | 9 | 7 | 14 | 64 | 2 | 0 | 5 | 35 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 273 | 1099 | 28 | 1 | 2 | 58 | 0 | 0 | 10 | 26 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 13009 | 23.1 | 1 | 21 | 30 | 46 | 1 | 0 | 1 | 27 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 10147 | 29.6 | 1 | 19 | 28 | 50 | 1 | 0 | 1 | 27 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 6461 | 46.4 | 2 | 26 | 44 | 26 | 1 | 0 | 1 | 24 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 94 | 3181 | 61 | 7 | 13 | 0 | 0 | 0 | 20 | 7 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 123 | 2441 | 58 | 7 | 14 | 0 | 0 | 0 | 21 | 12 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 255 | 1177 | 29 | 2 | 3 | 51 | 0 | 0 | 15 | 3 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 208 | 1441 | 25 | 11 | 24 | 7 | 4 | 13 | 14 | 38 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 286 | 1047 | 26 | 11 | 18 | 10 | 3 | 16 | 15 | 34 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 342 | 876 | 20 | 10 | 16 | 24 | 2 | 15 | 14 | 41 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 866 | 347 | 9 | 5 | 18 | 24 | 21 | 0 | 24 | 34 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 1022 | 293 | 11 | 4 | 24 | 11 | 24 | 0 | 26 | 38 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 1246 | 241 | 11 | 3 | 26 | 21 | 16 | 0 | 22 | 46 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 3005 | 99.8 | 9 | 5 | 18 | 15 | 25 | 0 | 28 | 28 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 3225 | 93 | 10 | 4 | 24 | 11 | 24 | 0 | 26 | 38 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 3084 | 97.3 | 11 | 3 | 28 | 23 | 17 | 0 | 19 | 48 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 209 | 1435 | 71 | 2 | 5 | 5 | 0 | 0 | 17 | 12 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 198 | 1514 | 65 | 2 | 6 | 6 | 0 | 0 | 21 | 12 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 267 | 1122 | 73 | 2 | 7 | 3 | 0 | 0 | 16 | 13 | `discard card="red-4-3"` |
