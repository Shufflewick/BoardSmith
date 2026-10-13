# Balance simulator speed baseline

Written by `node scripts/bench-sim/run.mjs` (#556). It plays the final game of
[the balance simulator worked example](./balance-simulator.md) with `boardsmith simulate`,
3000 games per player count, on every core (`--jobs` left at its default), in production mode,
as `boardsmith simulate` always plays. Seconds are wall time for the whole command,
bundling the rules and starting the workers included.

- Date: 2026-10-13T20:48:14.959Z
- BoardSmith commit: `07acb713`
- Node: v22.23.3
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 2.94, 3.53, 8.31 at the start; 7.08, 4.42, 8.54 at the end
- Target (#556): 3,000 games at each of 2, 4 and 6 players in under 60 seconds per policy (the "2,4,6" rows)

| Policy | Players | Games | Seconds | Games/s |
|---|---|---|---|---|
| random | 2 | 3000 | 1.6 | 1878 |
| random | 4 | 3000 | 2.0 | 1489 |
| random | 6 | 3000 | 2.0 | 1477 |
| random | 2,4,6 | 9000 | 2.7 | 3393 |
| greedy | 2 | 3000 | 1.7 | 1779 |
| greedy | 4 | 3000 | 2.0 | 1508 |
| greedy | 6 | 3000 | 2.2 | 1353 |
| greedy | 2,4,6 | 9000 | 3.1 | 2949 |
