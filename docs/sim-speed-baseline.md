# Balance simulator speed baseline

Written by `node scripts/bench-sim/run.mjs` (#556). It plays the final game of
[the balance simulator worked example](./balance-simulator.md) with `boardsmith simulate`,
3000 games per player count, on every core (`--jobs` left at its default), in production mode,
as `boardsmith simulate` always plays. Seconds are wall time for the whole command,
bundling the rules and starting the workers included.

- Date: 2026-10-13T13:11:27.676Z
- BoardSmith commit: `e3f8dc97`
- Node: v22.23.3
- Machine: 18 x Apple M5 Max
- Load average (1, 5, 15 min): 2.83, 6.72, 9.03 at the start; 18.27, 11.22, 10.55 at the end
- Target (#556): 3,000 games at each of 2, 4 and 6 players in under 60 seconds per policy (the "2,4,6" rows)

| Policy | Players | Games | Seconds | Games/s |
|---|---|---|---|---|
| random | 2 | 3000 | 2.8 | 1079 |
| random | 4 | 3000 | 7.0 | 427 |
| random | 6 | 3000 | 14.5 | 208 |
| random | 2,4,6 | 9000 | 22.6 | 399 |
| greedy | 2 | 3000 | 3.1 | 962 |
| greedy | 4 | 3000 | 7.2 | 417 |
| greedy | 6 | 3000 | 15.0 | 200 |
| greedy | 2,4,6 | 9000 | 22.0 | 409 |
