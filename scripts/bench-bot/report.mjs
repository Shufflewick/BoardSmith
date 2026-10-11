/**
 * The bot benchmark's arithmetic and its report (#630): which plies of a game
 * it searches, what a measurement works out to, and the Markdown baseline.
 */
import { PART_NAMES } from './profile.mjs';

/** Where in the game each searched position sits, as a fraction of its length. */
const POSITION_MARKS = { early: 0.1, middle: 0.5, late: 0.9 };

/** The step count of the fixed search, which runs with no timeout so its work is the same on every run. */
export const FIXED_STEPS = 300;

/** Column headings for the parts of a search, in report order. */
const PART_HEADINGS = {
  rebuild: 'rebuild',
  legalMoves: 'legal moves',
  apply: 'apply',
  reapply: 're-apply',
  scoring: 'scoring',
  determinize: 'determinize',
};

/**
 * The plies to search, given how many moves the seat to move had at each ply
 * of a played game: the first ply at or after each mark where that seat has a
 * choice. A seat with one move is never searched, so its ply measures nothing.
 */
export function pickPositions(optionCounts) {
  return Object.entries(POSITION_MARKS).map(([name, mark]) => {
    const from = Math.floor(optionCounts.length * mark);
    const ply = optionCounts.findIndex((count, at) => at >= from && count >= 2);
    if (ply === -1) {
      throw new Error(
        `The game has no ${name} position to search: from ply ${from} of ${optionCounts.length} ` +
          'no seat to move has more than one move.',
      );
    }
    return { name, ply };
  });
}

/** Steps per second for one measured search. */
export function summarize({ steps, ms }) {
  return { steps, ms, stepsPerSecond: (steps * 1000) / ms };
}

/** The percent of a profiled search's time each part took, the rest as "other", and element lookups across them. */
export function shares({ ms, parts, lookupMs }) {
  const share = (partMs) => (partMs * 100) / ms;
  const charged = PART_NAMES.reduce((sum, part) => sum + parts[part], 0);
  return {
    ...Object.fromEntries(PART_NAMES.map((part) => [part, share(parts[part])])),
    other: share(ms - charged),
    lookup: share(lookupMs),
  };
}

/** A number for a table cell: whole above 100, one decimal place below. */
function cell(value) {
  return String(value >= 100 ? Math.round(value) : Math.round(value * 10) / 10);
}

/** A checkout's commit, and whether it had uncommitted changes. A directory outside git has no commit. */
const checkout = ({ commit, dirty }) =>
  commit === undefined ? 'no git commit' : `\`${commit}\`${dirty ? ' with uncommitted changes' : ''}`;

const loads = (load) => load.map((value) => value.toFixed(2)).join(', ');

/**
 * The baseline as Markdown.
 *
 * @param meta where and how it was measured: `date`, `commit`, `dirty`, `node`,
 *   `devMode`, `loadBefore`, `loadAfter`, `cpus`, `cpuModel`, and `skipped`, a reason
 *   for each catalogue game it left out.
 * @param games one entry per game: `name`, `commit`, `playerCount`, `plies`,
 *   and `positions`, each with `name`, `ply`, `seat`, `presets`, `fixed` and `profile`.
 */
export function formatReport(meta, games) {
  if (meta.devMode) {
    throw new Error(
      'The engine ran in development mode, which makes the bot up to 1.7 times slower than a ' +
        'production worker, so these numbers are not a baseline. Run scripts/bench-bot/run.mjs directly.',
    );
  }
  const rows = (render) => games.flatMap((game) =>
    game.positions.map((position) => `| ${game.name} | ${position.name} (ply ${position.ply}, seat ${position.seat}) | ${render(position)} |`));
  const presetCells = ({ presets }) => ['easy', 'medium', 'hard']
    .map((level) => {
      const row = summarize(presets[level]);
      return [row.steps, Math.round(row.ms), cell(row.stepsPerSecond)].join(' | ');
    })
    .join(' | ');
  const fixedCells = ({ fixed, profile }) => {
    const row = summarize(fixed);
    const split = shares(profile);
    const percents = [...PART_NAMES, 'other', 'lookup'].map((part) => Math.round(split[part]));
    return [row.steps, Math.round(row.ms), cell(row.stepsPerSecond), ...percents, `\`${fixed.move}\``].join(' | ');
  };

  return [
    '# Bot speed baseline',
    '',
    'Written by `node scripts/bench-bot/run.mjs` (#630). See docs/bot-system.md, "Measuring bot speed".',
    '',
    `- Date: ${meta.date}`,
    `- BoardSmith commit: ${checkout(meta)}`,
    `- Node: ${meta.node}`,
    '- Mode: production (`isDevMode()` is false in the bundled engine, as in a worker child)',
    `- Machine: ${meta.cpus} x ${meta.cpuModel}`,
    `- Load average (1, 5, 15 min): ${loads(meta.loadBefore)} at the start; ${loads(meta.loadAfter)} at the end`,
    ...(meta.skipped ?? []).map((reason) => `- Skipped: ${reason}`),
    `- Games: ${games.map((game) => `${game.name} at ${checkout(game)} (${game.playerCount} players, ${game.plies} plies played)`).join('; ')}`,
    '',
    '## Difficulty presets',
    '',
    'Each preset as a game plays it, with its timeout: search steps done, ms for the move, and steps per second.',
    '',
    '| Game | Position | easy steps | easy ms | easy steps/s | medium steps | medium ms | medium steps/s | hard steps | hard ms | hard steps/s |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows(presetCells),
    '',
    `## Fixed ${FIXED_STEPS}-step search`,
    '',
    `A seeded ${FIXED_STEPS}-step search with no timeout, so the work is the same on every run. ` +
      'It runs twice: ms and steps/s are from a run that only counts steps, and the part columns are percent ' +
      'of a second, profiled run\'s time; "other" is the rest (selection and bookkeeping). ' +
      '"lookup" is element tree walks (`ElementCollection._finder`), which run inside the other parts.',
    '',
    `| Game | Position | steps | ms | steps/s | ${PART_NAMES.map((part) => `${PART_HEADINGS[part]} %`).join(' | ')} | other % | lookup % | chosen move |`,
    `|${'---|'.repeat(PART_NAMES.length + 8)}`,
    ...rows(fixedCells),
    '',
  ].join('\n');
}
