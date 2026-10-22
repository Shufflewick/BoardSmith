# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-22T16:42:50.316Z
- BoardSmith commit: `f41135dc1`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 2.30, 6.87, 13.39 at the start; 2.98, 6.04, 12.48 at the end
- Left out: merc, whose gameDefinition still declares gameOptions, which BoardSmith now refuses (Shufflewick/MERC#73), and whose vendored copy of BoardSmith needs re-vendoring (Shufflewick/MERC#64)
- Conditions: recorded with game options at the defaults boardsmith.json declares (#1081, #1138), on a quiet machine: the run started once the 1- and 5-minute load averages were both under 8 on 18 cores, and they stayed at 2 to 7 throughout. Seven's rows are the first since its determinize sampler (seven#2) and BoardSmith halting a search copy on hidden reads (#1431, #1433), so every Seven step is now scored and determinize takes 12 to 21% of the fixed search (#1436). Checkers does more work per step than in baselines before `628228a2a`, and lists more of it under "legal moves" than "apply", because of three deliberate search fixes (#732, #1129, #1133), not load (#1405). Step counts, scored counts and chosen moves of the fixed 300-step search do not depend on load.
- Games: checkers at `b4cb409` (2 players, 111 plies played); chess at `fe23c2b` (2 players, 76 plies played); cribbage at `894f17e` (2 players, 121 plies played); go-fish at `0a07873` (4 players, 87 plies played); hex-11 at `b8e5791` (2 players, 102 plies played); hex-19 at `b8e5791` (2 players, 360 plies played); seven at `1996eed` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, how many of them were scored (the rest were thrown away, #669), ms for the move, and steps per second.

| Game | Position | easy steps | easy scored | easy ms | easy steps/s | medium steps | medium scored | medium ms | medium steps/s | hard steps | hard scored | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 100 | 102 | 983 | 300 | 300 | 337 | 891 | 500 | 500 | 603 | 829 |
| checkers | middle (ply 56, seat 1) | 100 | 100 | 76 | 1310 | 300 | 300 | 274 | 1094 | 500 | 500 | 459 | 1089 |
| checkers | late (ply 100, seat 1) | 100 | 100 | 63 | 1581 | 300 | 300 | 184 | 1632 | 500 | 500 | 327 | 1530 |
| chess | early (ply 7, seat 2) | 100 | 100 | 219 | 456 | 300 | 300 | 744 | 403 | 500 | 500 | 1417 | 353 |
| chess | middle (ply 38, seat 1) | 100 | 100 | 227 | 441 | 300 | 300 | 789 | 380 | 500 | 500 | 1559 | 321 |
| chess | late (ply 68, seat 2) | 100 | 100 | 228 | 439 | 300 | 300 | 816 | 368 | 500 | 500 | 1699 | 294 |
| cribbage | early (ply 12, seat 2) | 100 | 0 | 32 | 3080 | 300 | 0 | 91 | 3288 | 500 | 0 | 134 | 3737 |
| cribbage | middle (ply 60, seat 1) | 100 | 0 | 34 | 2969 | 300 | 0 | 103 | 2906 | 500 | 0 | 162 | 3094 |
| cribbage | late (ply 111, seat 1) | 100 | 0 | 122 | 823 | 300 | 0 | 353 | 851 | 500 | 0 | 588 | 851 |
| go-fish | early (ply 8, seat 2) | 100 | 100 | 100 | 1004 | 300 | 300 | 301 | 996 | 500 | 500 | 468 | 1069 |
| go-fish | middle (ply 43, seat 2) | 100 | 100 | 102 | 979 | 300 | 300 | 317 | 946 | 500 | 500 | 566 | 884 |
| go-fish | late (ply 78, seat 2) | 100 | 100 | 111 | 903 | 300 | 300 | 363 | 827 | 500 | 500 | 608 | 822 |
| hex-11 | early (ply 10, seat 1) | 100 | 100 | 202 | 494 | 300 | 300 | 656 | 457 | 500 | 500 | 1219 | 410 |
| hex-11 | middle (ply 51, seat 2) | 100 | 100 | 208 | 482 | 300 | 300 | 758 | 396 | 500 | 500 | 1427 | 350 |
| hex-11 | late (ply 91, seat 2) | 100 | 100 | 241 | 414 | 300 | 300 | 823 | 365 | 500 | 500 | 1526 | 328 |
| hex-19 | early (ply 36, seat 1) | 100 | 100 | 627 | 159 | 209 | 209 | 1505 | 139 | 235 | 235 | 2013 | 117 |
| hex-19 | middle (ply 180, seat 1) | 100 | 100 | 681 | 147 | 173 | 173 | 1510 | 115 | 210 | 210 | 2010 | 104 |
| hex-19 | late (ply 324, seat 1) | 100 | 100 | 623 | 160 | 197 | 197 | 1506 | 131 | 225 | 225 | 2005 | 112 |
| seven | early (ply 78, seat 2) | 100 | 100 | 157 | 636 | 300 | 300 | 508 | 591 | 500 | 500 | 1223 | 409 |
| seven | middle (ply 394, seat 2) | 100 | 100 | 139 | 721 | 300 | 300 | 447 | 672 | 500 | 500 | 1128 | 443 |
| seven | late (ply 709, seat 6) | 100 | 100 | 231 | 432 | 300 | 300 | 856 | 351 | 500 | 500 | 1465 | 341 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | scored | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 300 | 321 | 936 | 30 | 13 | 37 | 6 | 5 | 0 | 9 | 28 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 300 | 266 | 1126 | 38 | 9 | 31 | 6 | 6 | 0 | 10 | 25 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 300 | 190 | 1580 | 53 | 8 | 19 | 4 | 4 | 0 | 12 | 17 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 300 | 712 | 421 | 13 | 6 | 66 | 1 | 8 | 0 | 6 | 33 | `movePiece piece="black-pawn-d7" destination={"pieceId":"black-pawn-d7","fromNotation":"d7","toNotation":"d5"}` |
| chess | middle (ply 38, seat 1) | 300 | 300 | 774 | 388 | 13 | 6 | 67 | 3 | 7 | 0 | 5 | 33 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 300 | 825 | 363 | 12 | 5 | 69 | 1 | 7 | 0 | 5 | 33 | `movePiece piece="black-queen-d8" destination={"pieceId":"black-queen-d8","fromNotation":"b7","toNotation":"e4"}` |
| cribbage | early (ply 12, seat 2) | 300 | 0 | 95 | 3164 | 62 | 6 | 15 | 0 | 0 | 0 | 17 | 5 | `discard cards=["3C","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 0 | 95 | 3159 | 67 | 4 | 10 | 0 | 0 | 0 | 20 | 6 | `playCard card="6D"` |
| cribbage | late (ply 111, seat 1) | 300 | 0 | 431 | 696 | 29 | 2 | 2 | 53 | 0 | 0 | 14 | 2 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 300 | 259 | 1160 | 35 | 8 | 20 | 5 | 3 | 16 | 14 | 25 | `ask target=4 rank="10"` |
| go-fish | middle (ply 43, seat 2) | 300 | 300 | 310 | 969 | 36 | 6 | 15 | 4 | 2 | 24 | 12 | 19 | `ask target=4 rank="7"` |
| go-fish | late (ply 78, seat 2) | 300 | 300 | 367 | 817 | 34 | 5 | 13 | 7 | 1 | 32 | 9 | 20 | `ask target=4 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 300 | 638 | 470 | 16 | 5 | 21 | 1 | 28 | 0 | 30 | 24 | `placeStone cell="cell-2-9"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 300 | 824 | 364 | 20 | 3 | 23 | 2 | 24 | 0 | 28 | 30 | `placeStone cell="cell-3-6"` |
| hex-11 | late (ply 91, seat 2) | 300 | 300 | 772 | 389 | 21 | 2 | 29 | 0 | 24 | 0 | 24 | 36 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 300 | 2355 | 127 | 15 | 5 | 19 | 3 | 28 | 0 | 30 | 23 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 300 | 2436 | 123 | 18 | 3 | 24 | 3 | 26 | 0 | 26 | 32 | `placeStone cell="cell-17-1"` |
| hex-19 | late (ply 324, seat 1) | 300 | 300 | 2419 | 124 | 23 | 1 | 31 | 2 | 22 | 0 | 22 | 37 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 300 | 490 | 612 | 53 | 3 | 3 | 1 | 0 | 19 | 21 | 7 | `discard card="red-6-1"` |
| seven | middle (ply 394, seat 2) | 300 | 300 | 447 | 671 | 55 | 3 | 3 | 1 | 0 | 21 | 18 | 7 | `discard card="blue-4-4"` |
| seven | late (ply 709, seat 6) | 300 | 300 | 874 | 343 | 48 | 1 | 4 | 29 | 0 | 12 | 7 | 7 | `discard card="blue-7-4"` |
