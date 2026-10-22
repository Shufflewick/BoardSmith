# Bot speed baseline

Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".

- Date: 2026-10-20T01:11:07.714Z
- BoardSmith commit: `628228a2a`
- Node: v22.23.3
- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 5.17, 12.16, 11.07 at the start; 4.58, 10.37, 10.48 at the end
- Left out: merc, whose vendored copy of BoardSmith does not load against current BoardSmith: its gameDefinition still declares gameOptions, which BoardSmith now refuses (Shufflewick/MERC#64)
- Conditions: recorded with game options at the defaults boardsmith.json declares (#1081, #1138), while other agents' test runs shared the machine. The load average was 5 to 12 on 18 cores, against 4 to 5 for the previous baseline, so the timed figures (ms, steps/s, and the step counts under a timeout) are likely slowed by load. The slowdowns against the previous baseline in checkers, cribbage, go-fish and seven should not be read as regressions without a re-run on a quiet machine. Chess's threefold speed-up is too large to be load. Step counts, scored counts and chosen moves of the fixed 300-step search do not depend on load.
- Games: checkers at `3bb3552` (2 players, 111 plies played); chess at `9610ba8` (2 players, 76 plies played); cribbage at `8f8a677` (2 players, 121 plies played); go-fish at `410cfcf` (4 players, 87 plies played); hex-11 at `b095f42` (2 players, 102 plies played); hex-19 at `b095f42` (2 players, 360 plies played); seven at `aadc4ca` (7 players, 788 plies played)

## Difficulty presets

Each preset as a game plays it, with its timeout: search steps done, how many of them were scored (the rest were thrown away, #669), ms for the move, and steps per second.

| Game | Position | easy steps | easy scored | easy ms | easy steps/s | medium steps | medium scored | medium ms | medium steps/s | hard steps | hard scored | hard ms | hard steps/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 100 | 100 | 122 | 820 | 300 | 300 | 377 | 795 | 500 | 500 | 700 | 715 |
| checkers | middle (ply 56, seat 1) | 100 | 100 | 77 | 1295 | 300 | 300 | 305 | 983 | 500 | 500 | 546 | 916 |
| checkers | late (ply 100, seat 1) | 100 | 100 | 74 | 1353 | 300 | 300 | 211 | 1425 | 500 | 500 | 403 | 1242 |
| chess | early (ply 7, seat 2) | 100 | 100 | 248 | 404 | 300 | 300 | 817 | 367 | 500 | 500 | 1554 | 322 |
| chess | middle (ply 38, seat 1) | 100 | 100 | 300 | 334 | 300 | 300 | 887 | 338 | 500 | 500 | 1668 | 300 |
| chess | late (ply 68, seat 2) | 100 | 100 | 261 | 384 | 300 | 300 | 874 | 343 | 500 | 500 | 1633 | 306 |
| cribbage | early (ply 12, seat 2) | 100 | 0 | 42 | 2384 | 300 | 0 | 128 | 2342 | 500 | 0 | 176 | 2848 |
| cribbage | middle (ply 60, seat 1) | 100 | 0 | 39 | 2555 | 300 | 0 | 112 | 2668 | 500 | 0 | 166 | 3007 |
| cribbage | late (ply 111, seat 1) | 100 | 0 | 129 | 776 | 300 | 0 | 352 | 853 | 500 | 0 | 577 | 867 |
| go-fish | early (ply 8, seat 2) | 100 | 100 | 100 | 1000 | 300 | 300 | 293 | 1023 | 500 | 500 | 491 | 1018 |
| go-fish | middle (ply 43, seat 2) | 100 | 100 | 106 | 944 | 300 | 300 | 326 | 920 | 500 | 500 | 565 | 884 |
| go-fish | late (ply 78, seat 2) | 100 | 100 | 129 | 773 | 300 | 300 | 380 | 789 | 500 | 500 | 649 | 770 |
| hex-11 | early (ply 10, seat 1) | 100 | 100 | 225 | 444 | 300 | 300 | 793 | 379 | 500 | 500 | 1366 | 366 |
| hex-11 | middle (ply 51, seat 2) | 100 | 100 | 228 | 439 | 300 | 300 | 812 | 369 | 500 | 500 | 1567 | 319 |
| hex-11 | late (ply 91, seat 2) | 100 | 100 | 237 | 421 | 300 | 300 | 786 | 381 | 500 | 500 | 1514 | 330 |
| hex-19 | early (ply 36, seat 1) | 100 | 100 | 596 | 168 | 216 | 216 | 1508 | 143 | 243 | 243 | 2007 | 121 |
| hex-19 | middle (ply 180, seat 1) | 100 | 100 | 678 | 148 | 189 | 189 | 1508 | 125 | 226 | 226 | 2012 | 112 |
| hex-19 | late (ply 324, seat 1) | 100 | 100 | 642 | 156 | 205 | 205 | 1511 | 136 | 233 | 233 | 2013 | 116 |
| seven | early (ply 78, seat 2) | 100 | 100 | 110 | 905 | 300 | 110 | 344 | 871 | 500 | 20 | 542 | 922 |
| seven | middle (ply 394, seat 2) | 100 | 100 | 100 | 1003 | 300 | 72 | 358 | 838 | 500 | 16 | 569 | 879 |
| seven | late (ply 709, seat 6) | 100 | 0 | 84 | 1193 | 300 | 0 | 247 | 1213 | 500 | 0 | 418 | 1196 |

## Fixed 300-step search

A seeded 300-step search with no timeout, so the work is the same on every run. It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent of a second, profiled run's time; "other" is the rest (selection and bookkeeping). "lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.

| Game | Position | steps | scored | ms | steps/s | rebuild % | legal moves % | apply % | re-apply % | scoring % | determinize % | other % | lookup % | chosen move |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| checkers | early (ply 14, seat 2) | 300 | 300 | 403 | 745 | 30 | 12 | 38 | 6 | 5 | 0 | 8 | 27 | `move piece="p2-6-5" destination={"pieceId":"p2-6-5","fromNotation":"f2","toNotation":"g3","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | middle (ply 56, seat 1) | 300 | 300 | 292 | 1026 | 39 | 9 | 29 | 6 | 5 | 0 | 12 | 22 | `move piece="p1-0-1" destination={"pieceId":"p1-0-1","fromNotation":"c7","toNotation":"b6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| checkers | late (ply 100, seat 1) | 300 | 300 | 250 | 1200 | 53 | 8 | 18 | 4 | 4 | 0 | 14 | 15 | `move piece="p1-0-5" destination={"pieceId":"p1-0-5","fromNotation":"g7","toNotation":"f6","isCapture":false,"becomesKing":false,"capturedNotations":[]}` |
| chess | early (ply 7, seat 2) | 300 | 300 | 813 | 369 | 14 | 6 | 65 | 1 | 7 | 0 | 7 | 31 | `movePiece piece="black-pawn-d7" destination={"pieceId":"black-pawn-d7","fromNotation":"d7","toNotation":"d5"}` |
| chess | middle (ply 38, seat 1) | 300 | 300 | 852 | 352 | 15 | 6 | 64 | 3 | 6 | 0 | 6 | 31 | `movePiece piece="white-knight-b1" destination={"pieceId":"white-knight-b1","fromNotation":"a5","toNotation":"b3"}` |
| chess | late (ply 68, seat 2) | 300 | 300 | 884 | 339 | 13 | 5 | 67 | 1 | 7 | 0 | 7 | 31 | `movePiece piece="black-queen-d8" destination={"pieceId":"black-queen-d8","fromNotation":"b7","toNotation":"e4"}` |
| cribbage | early (ply 12, seat 2) | 300 | 0 | 94 | 3193 | 58 | 6 | 15 | 0 | 0 | 0 | 21 | 5 | `discard cards=["3C","QC"]` |
| cribbage | middle (ply 60, seat 1) | 300 | 0 | 96 | 3115 | 68 | 4 | 11 | 0 | 0 | 0 | 18 | 6 | `playCard card="6D"` |
| cribbage | late (ply 111, seat 1) | 300 | 0 | 344 | 871 | 29 | 2 | 2 | 54 | 0 | 0 | 13 | 2 | `discard cards=["9C","10S"]` |
| go-fish | early (ply 8, seat 2) | 300 | 300 | 267 | 1123 | 35 | 8 | 19 | 5 | 3 | 16 | 14 | 25 | `ask target=4 rank="10"` |
| go-fish | middle (ply 43, seat 2) | 300 | 300 | 329 | 911 | 36 | 6 | 14 | 4 | 2 | 23 | 13 | 19 | `ask target=4 rank="7"` |
| go-fish | late (ply 78, seat 2) | 300 | 300 | 396 | 758 | 34 | 5 | 13 | 6 | 1 | 31 | 10 | 19 | `ask target=4 rank="7"` |
| hex-11 | early (ply 10, seat 1) | 300 | 300 | 653 | 459 | 16 | 5 | 20 | 1 | 28 | 0 | 31 | 23 | `placeStone cell="cell-2-9"` |
| hex-11 | middle (ply 51, seat 2) | 300 | 300 | 857 | 350 | 20 | 3 | 24 | 2 | 24 | 0 | 27 | 29 | `placeStone cell="cell-3-6"` |
| hex-11 | late (ply 91, seat 2) | 300 | 300 | 824 | 364 | 22 | 2 | 29 | 0 | 23 | 0 | 24 | 34 | `placeStone cell="cell-4-4"` |
| hex-19 | early (ply 36, seat 1) | 300 | 300 | 2318 | 129 | 15 | 5 | 19 | 3 | 28 | 0 | 30 | 23 | `placeStone cell="cell-3-17"` |
| hex-19 | middle (ply 180, seat 1) | 300 | 300 | 2450 | 122 | 18 | 3 | 24 | 3 | 26 | 0 | 26 | 32 | `placeStone cell="cell-17-1"` |
| hex-19 | late (ply 324, seat 1) | 300 | 300 | 2491 | 120 | 23 | 1 | 31 | 2 | 22 | 0 | 22 | 37 | `placeStone cell="cell-2-8"` |
| seven | early (ply 78, seat 2) | 300 | 110 | 316 | 950 | 78 | 3 | 3 | 3 | 0 | 0 | 13 | 7 | `discard card="bonus-7"` |
| seven | middle (ply 394, seat 2) | 300 | 72 | 308 | 975 | 82 | 3 | 3 | 3 | 0 | 0 | 10 | 7 | `discard card="purple-1-1"` |
| seven | late (ply 709, seat 6) | 300 | 0 | 248 | 1210 | 87 | 1 | 3 | 1 | 0 | 0 | 7 | 7 | `discard card="red-4-3"` |
