# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T14:26:36.919Z
- BoardSmith commit: `b9c8ef7a`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 27.96, 33.60, 29.18 at the start; 11.98, 21.14, 24.67 at the end
- Left out: merc, whose vendored copy of BoardSmith does not load against current BoardSmith (Shufflewick/MERC#64)
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, how many of them were scored (the rest were thrown away, #669), ms for the move, and steps per second.

| Game | Position | easy steps | easy scored | easy ms | easy steps/s | medium steps | medium scored | medium ms | medium steps/s | hard steps | hard scored | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 100 | 389 | 257 | 300 | 300 | 1044 | 287 | 492 | 492 | 2004 | 246 |
| checkers | middle (ply 56, seat 1) | 100 | 100 | 234 | 428 | 300 | 300 | 678 | 443 | 500 | 500 | 1464 | 342 |
| checkers | late (ply 100, seat 1) | 100 | 100 | 66 | 1505 | 300 | 300 | 143 | 2103 | 500 | 500 | 354 | 1413 |
| chess | early (ply 7, seat 2) | 24 | 24 | 1042 | 23 | 27 | 27 | 1558 | 17.3 | 29 | 29 | 2035 | 14.2 |
| chess | middle (ply 38, seat 1) | 32 | 32 | 1032 | 31 | 38 | 38 | 1507 | 25.2 | 44 | 44 | 2044 | 21.5 |
| chess | late (ply 68, seat 2) | 38 | 38 | 1022 | 37.2 | 45 | 45 | 1522 | 29.6 | 49 | 49 | 2045 | 24 |
| cribbage | early (ply 12, seat 2) | 100 | 0 | 37 | 2698 | 300 | 0 | 100 | 3004 | 500 | 0 | 169 | 2960 |
| cribbage | middle (ply 60, seat 1) | 100 | 0 | 45 | 2222 | 300 | 0 | 103 | 2909 | 500 | 0 | 184 | 2720 |
| cribbage | late (ply 111, seat 1) | 100 | 0 | 93 | 1079 | 300 | 0 | 242 | 1238 | 500 | 0 | 437 | 1144 |
| go-fish | early (ply 8, seat 2) | 100 | 100 | 100 | 1003 | 300 | 300 | 339 | 886 | 500 | 500 | 546 | 915 |
| go-fish | middle (ply 43, seat 2) | 100 | 100 | 100 | 1003 | 300 | 300 | 333 | 901 | 500 | 500 | 629 | 795 |
| go-fish | late (ply 78, seat 2) | 100 | 100 | 157 | 638 | 300 | 300 | 634 | 473 | 500 | 500 | 711 | 703 |
| hex-11 | early (ply 10, seat 1) | 100 | 100 | 515 | 194 | 251 | 251 | 1503 | 167 | 283 | 283 | 2008 | 141 |
| hex-11 | middle (ply 51, seat 2) | 100 | 100 | 541 | 185 | 224 | 224 | 1503 | 149 | 240 | 240 | 2009 | 119 |
| hex-11 | late (ply 91, seat 2) | 100 | 100 | 467 | 214 | 288 | 288 | 1505 | 191 | 331 | 331 | 2005 | 165 |
| hex-19 | early (ply 36, seat 1) | 66 | 66 | 1017 | 64.9 | 83 | 83 | 1521 | 54.6 | 95 | 95 | 2018 | 47.1 |
| hex-19 | middle (ply 180, seat 1) | 62 | 62 | 1013 | 61.2 | 70 | 70 | 1519 | 46.1 | 79 | 79 | 2028 | 39 |
| hex-19 | late (ply 324, seat 1) | 66 | 66 | 1020 | 64.7 | 77 | 77 | 1516 | 50.8 | 91 | 91 | 2007 | 45.3 |
| seven | early (ply 78, seat 2) | 100 | 30 | 80 | 1254 | 300 | 20 | 212 | 1412 | 500 | 20 | 395 | 1267 |
| seven | middle (ply 394, seat 2) | 100 | 24 | 255 | 393 | 300 | 16 | 672 | 446 | 500 | 16 | 943 | 530 |
| seven | late (ply 709, seat 6) | 100 | 0 | 160 | 624 | 300 | 0 | 439 | 683 | 500 | 0 | 922 | 542 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | scored | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 300 | 901 | 333 | 14 | 25 | 44 | 5 | 6 | 0 | 6 | 50 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 300 | 767 | 391 | 15 | 24 | 44 | 5 | 6 | 0 | 5 | 52 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 300 | 164 | 1831 | 63 | 4 | 9 | 7 | 1 | 0 | 17 | 14 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 300 | 15697 | 19.1 | 1 | 38 | 58 | 1 | 1 | 0 | 1 | 51 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 300 | 11888 | 25.2 | 1 | 37 | 58 | 1 | 2 | 0 | 1 | 52 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 300 | 9943 | 30.2 | 2 | 34 | 60 | 2 | 2 | 0 | 1 | 50 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 0 | 92 | 3271 | 60 | 7 | 15 | 0 | 0 | 0 | 18 | 9 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 0 | 105 | 2859 | 58 | 9 | 17 | 0 | 0 | 0 | 16 | 16 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 0 | 266 | 1127 | 31 | 2 | 3 | 50 | 0 | 0 | 14 | 4 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 300 | 299 | 1005 | 24 | 11 | 27 | 8 | 4 | 10 | 15 | 40 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 300 | 401 | 748 | 25 | 11 | 20 | 13 | 4 | 13 | 14 | 35 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 300 | 503 | 597 | 20 | 10 | 18 | 26 | 2 | 13 | 11 | 45 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 300 | 1757 | 171 | 8 | 5 | 34 | 1 | 26 | 0 | 26 | 51 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 300 | 2072 | 145 | 8 | 4 | 36 | 1 | 25 | 0 | 25 | 54 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 300 | 1788 | 168 | 10 | 4 | 40 | 1 | 20 | 0 | 24 | 56 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 300 | 5186 | 57.8 | 7 | 5 | 33 | 1 | 28 | 0 | 27 | 52 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 300 | 6431 | 46.6 | 7 | 4 | 35 | 1 | 27 | 0 | 26 | 55 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 300 | 6051 | 49.6 | 9 | 4 | 42 | 2 | 21 | 0 | 22 | 57 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 20 | 662 | 453 | 42 | 2 | 8 | 5 | 0 | 0 | 42 | 9 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 16 | 459 | 653 | 52 | 2 | 4 | 5 | 0 | 0 | 37 | 10 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 0 | 505 | 594 | 59 | 2 | 7 | 3 | 0 | 0 | 30 | 10 | `discard card="red-4-3"` |
