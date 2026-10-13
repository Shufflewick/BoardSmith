/**
 * The balance simulator speed baseline as Markdown (#556): one row per policy
 * and player count, and one per policy for all three counts in one command,
 * which is the run the acceptance target is measured on.
 */
import { checkout, loads } from '../bench-bot/report.mjs';

/**
 * @param meta `date`, `commit`, `dirty`, `node`, `cpus`, `cpuModel`, `loadBefore`, `loadAfter`, `games` (per player count)
 * @param rows one per run: `policy`, `players` (a count, or "2,4,6"), `games` and `seconds`
 */
export function formatSpeedReport(meta, rows) {
  return [
    '# Balance simulator speed baseline',
    '',
    'Written by `node scripts/bench-sim/run.mjs` (#556). It plays the final game of',
    '[the balance simulator worked example](./balance-simulator.md) with `boardsmith simulate`,',
    `${meta.games} games per player count, on every core (\`--jobs\` left at its default), in production mode,`,
    'as `boardsmith simulate` always plays. Seconds are wall time for the whole command,',
    'bundling the rules and starting the workers included.',
    '',
    `- Date: ${meta.date}`,
    `- BoardSmith commit: ${checkout(meta)}`,
    `- Node: ${meta.node}`,
    `- Machine: ${meta.cpus} x ${meta.cpuModel}`,
    `- Load average (1, 5, 15 min): ${loads(meta.loadBefore)} at the start; ${loads(meta.loadAfter)} at the end`,
    '- Target (#556): 3,000 games at each of 2, 4 and 6 players in under 60 seconds per policy (the "2,4,6" rows)',
    '',
    '| Policy | Players | Games | Seconds | Games/s |',
    '|---|---|---|---|---|',
    ...rows.map((row) =>
      `| ${row.policy} | ${row.players} | ${row.games} | ${row.seconds.toFixed(1)} | ${Math.round(row.games / row.seconds)} |`),
    '',
  ].join('\n');
}
