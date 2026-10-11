# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-11T15:06:50.450Z
- BoardSmith commit: `24ea4c3c`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 23.24, 13.20, 16.19 at the start; 16.65, 17.39, 17.70 at the end
- Left out: merc, whose vendored copy of BoardSmith does not load against current BoardSmith (Shufflewick/MERC#64)
- Games: checkers at `54eacf5` (2 players, 111 plies played); chess at `2cdf9e3` (2 players, 76 plies played); cribbage at `21b3b56` (2 players, 121 plies played); go-fish at `822f9d8` (4 players, 87 plies played); hex-11 at `ef6bf90` (2 players, 102 plies played); hex-19 at `ef6bf90` (2 players, 360 plies played); seven at `bc558aa` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, how many of them were scored (the rest were thrown away, #669), ms for the move, and steps per second.

| Game | Position | easy steps | easy scored | easy ms | easy steps/s | medium steps | medium scored | medium ms | medium steps/s | hard steps | hard scored | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 100 | 612 | 163 | 134 | 134 | 1519 | 88.2 | 193 | 193 | 2005 | 96.2 |
| checkers | middle (ply 56, seat 1) | 100 | 100 | 519 | 193 | 262 | 262 | 1509 | 174 | 262 | 262 | 2007 | 131 |
| checkers | late (ply 100, seat 1) | 100 | 100 | 139 | 721 | 300 | 300 | 582 | 515 | 500 | 500 | 809 | 618 |
| chess | early (ply 7, seat 2) | 25 | 25 | 1023 | 24.4 | 20 | 20 | 1584 | 12.6 | 26 | 26 | 2017 | 12.9 |
| chess | middle (ply 38, seat 1) | 64 | 64 | 1008 | 63.5 | 72 | 72 | 1511 | 47.7 | 80 | 80 | 2020 | 39.6 |
| chess | late (ply 68, seat 2) | 78 | 78 | 1012 | 77.1 | 92 | 92 | 1519 | 60.6 | 102 | 102 | 2014 | 50.6 |
| cribbage | early (ply 12, seat 2) | 100 | 0 | 51 | 1980 | 300 | 0 | 130 | 2301 | 500 | 0 | 180 | 2776 |
| cribbage | middle (ply 60, seat 1) | 100 | 0 | 36 | 2804 | 300 | 0 | 104 | 2890 | 500 | 0 | 158 | 3168 |
| cribbage | late (ply 111, seat 1) | 100 | 0 | 83 | 1208 | 300 | 0 | 241 | 1245 | 500 | 0 | 371 | 1347 |
| go-fish | early (ply 8, seat 2) | 100 | 100 | 76 | 1318 | 300 | 300 | 231 | 1301 | 500 | 500 | 407 | 1229 |
| go-fish | middle (ply 43, seat 2) | 100 | 100 | 91 | 1099 | 300 | 300 | 277 | 1085 | 500 | 500 | 448 | 1116 |
| go-fish | late (ply 78, seat 2) | 100 | 100 | 79 | 1264 | 300 | 300 | 358 | 839 | 500 | 500 | 562 | 890 |
| hex-11 | early (ply 10, seat 1) | 100 | 100 | 200 | 501 | 300 | 300 | 677 | 443 | 500 | 500 | 1293 | 387 |
| hex-11 | middle (ply 51, seat 2) | 100 | 100 | 224 | 446 | 300 | 300 | 766 | 391 | 500 | 500 | 1454 | 344 |
| hex-11 | late (ply 91, seat 2) | 100 | 100 | 222 | 450 | 300 | 300 | 672 | 446 | 500 | 500 | 1177 | 425 |
| hex-19 | early (ply 36, seat 1) | 100 | 100 | 575 | 174 | 228 | 228 | 1509 | 151 | 265 | 265 | 2009 | 132 |
| hex-19 | middle (ply 180, seat 1) | 100 | 100 | 692 | 144 | 187 | 187 | 1507 | 124 | 213 | 213 | 2006 | 106 |
| hex-19 | late (ply 324, seat 1) | 100 | 100 | 693 | 144 | 164 | 164 | 1510 | 109 | 199 | 199 | 2007 | 99.1 |
| seven | early (ply 78, seat 2) | 100 | 30 | 89 | 1123 | 300 | 20 | 303 | 991 | 500 | 20 | 444 | 1126 |
| seven | middle (ply 394, seat 2) | 100 | 24 | 127 | 789 | 300 | 16 | 337 | 889 | 500 | 16 | 781 | 640 |
| seven | late (ply 709, seat 6) | 100 | 0 | 401 | 249 | 300 | 0 | 596 | 504 | 500 | 0 | 1660 | 301 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | scored | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 300 | 2580 | 116 | 22 | 11 | 30 | 11 | 1 | 0 | 24 | 17 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 300 | 1619 | 185 | 27 | 9 | 24 | 4 | 2 | 0 | 34 | 14 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 300 | 211 | 1425 | 39 | 0 | 1 | 3 | 0 | 0 | 56 | 2 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 300 | 21286 | 14.1 | 2 | 36 | 59 | 1 | 1 | 0 | 1 | 24 | `movePiece piece="black-pawn-e7" destination={"pieceId":"black-pawn-e7","fromNotation":"e7","toNotation":"e6"}` |
| chess | middle (ply 38, seat 1) | 300 | 300 | 5331 | 56.3 | 3 | 37 | 56 | 1 | 2 | 0 | 1 | 25 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 300 | 6768 | 44.3 | 3 | 35 | 58 | 2 | 2 | 0 | 1 | 23 | `movePiece piece="black-pawn-a7" destination={"pieceId":"black-pawn-a7","fromNotation":"a6","toNotation":"a5"}` |
| cribbage | early (ply 12, seat 2) | 300 | 0 | 95 | 3170 | 62 | 6 | 13 | 0 | 0 | 0 | 19 | 7 | `discard cards=["KC","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 0 | 102 | 2942 | 62 | 7 | 14 | 0 | 0 | 0 | 17 | 12 | `playCard card="4H"` |
| cribbage | late (ply 111, seat 1) | 300 | 0 | 235 | 1276 | 32 | 2 | 2 | 50 | 0 | 0 | 14 | 3 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 300 | 262 | 1144 | 26 | 11 | 24 | 7 | 4 | 13 | 14 | 38 | `ask target=3 rank="8"` |
| go-fish | middle (ply 43, seat 2) | 300 | 300 | 249 | 1203 | 27 | 11 | 19 | 10 | 3 | 16 | 13 | 35 | `ask target=4 rank="6"` |
| go-fish | late (ply 78, seat 2) | 300 | 300 | 313 | 957 | 21 | 10 | 16 | 23 | 2 | 15 | 13 | 42 | `ask target=1 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 300 | 709 | 423 | 15 | 5 | 23 | 1 | 27 | 0 | 29 | 27 | `placeStone cell="cell-2-8"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 300 | 757 | 396 | 16 | 4 | 27 | 1 | 25 | 0 | 26 | 35 | `placeStone cell="cell-4-4"` |
| hex-11 | late (ply 91, seat 2) | 300 | 300 | 723 | 415 | 19 | 4 | 34 | 1 | 20 | 0 | 23 | 41 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 300 | 2063 | 145 | 13 | 5 | 21 | 1 | 29 | 0 | 30 | 25 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 300 | 2716 | 110 | 14 | 4 | 27 | 1 | 27 | 0 | 27 | 35 | `placeStone cell="cell-2-6"` |
| hex-19 | late (ply 324, seat 1) | 300 | 300 | 2606 | 115 | 18 | 3 | 34 | 2 | 20 | 0 | 22 | 41 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 20 | 306 | 979 | 68 | 2 | 6 | 6 | 0 | 0 | 18 | 11 | `discard card="red-3-1"` |
| seven | middle (ply 394, seat 2) | 300 | 16 | 510 | 588 | 58 | 2 | 6 | 5 | 0 | 0 | 28 | 11 | `discard card="green-7-1"` |
| seven | late (ply 709, seat 6) | 300 | 0 | 656 | 457 | 62 | 1 | 3 | 1 | 0 | 0 | 32 | 5 | `discard card="red-4-3"` |
