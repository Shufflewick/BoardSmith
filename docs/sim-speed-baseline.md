# Balance simulator speed baseline

Written by `node scripts/bench-sim/run.mjs` (#556). It plays the final game of
[the balance simulator worked example](./balance-simulator.md) with `boardsmith simulate`,
3000 games per player count, on every core (`--jobs` left at its default), in production mode,
as `boardsmith simulate` always plays. Seconds are wall time for the whole command,
bundling the rules and starting the workers included.

- Date: 2026-10-13T13:00:05.225Z
- BoardSmith commit: `bef1f349`
- Node: v22.23.3
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 2.99, 8.06, 10.37 at the start; 17.11, 11.44, 11.43 at the end
- Target (#556): 3,000 games at each of 2, 4 and 6 players in under 60 seconds per policy (the "2,4,6" rows)

| Policy | Players | Games | Seconds | Games/s |
|---|---|---|---|---|
| random | 2 | 3000 | 2.9 | 1022 |
| random | 4 | 3000 | 6.7 | 445 |
| random | 6 | 3000 | 14.5 | 207 |
| random | 2,4,6 | 9000 | 21.2 | 424 |
| greedy | 2 | 3000 | 2.9 | 1046 |
| greedy | 4 | 3000 | 6.5 | 462 |
| greedy | 6 | 3000 | 14.4 | 208 |
| greedy | 2,4,6 | 9000 | 21.2 | 424 |
