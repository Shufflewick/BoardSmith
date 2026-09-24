/**
 * Choice-cardinality audit (#172).
 *
 * The Action Panel offers choices through HIERARCHY, never free text: no typed
 * coordinates, no searchable list. That makes cardinality the author's problem,
 * and it has exactly two authored answers:
 *
 *   1. Anchor the step on the board (`boardRef` / `boardRefs`). The board draws
 *      and clicks the candidates; the panel yields to it. This is Hex: fifty
 *      cells are unreadable as a button list and perfectly readable as a board.
 *   2. Narrow the step with an earlier one (`dependsOn`). Build → category →
 *      building turns one flat list of hundreds into three short ones.
 *
 * A step that does NEITHER and still offers a large set has no answer at all —
 * it renders as a wall of buttons a person cannot scan and a screen reader
 * cannot summarise. This module finds those steps from real candidate counts
 * observed during a simulated run, so the author hears about it at build time
 * rather than from a player.
 *
 * Note what is deliberately NOT flagged: a large BOARD-ANCHORED step. That is
 * the correct shape, not the bug.
 */
import type { Game, GameOptions } from '../../engine/index.js';
import { simulateRandomGames } from '../../testing/random-simulation.js';
import { MAX_FLAT_CHOICE_CANDIDATES } from '../../engine/element/action-metadata.js';
import { simulateReplayCommand } from './replay-command.js';

// The threshold is a fact about what one selection can present as a readable
// sentence, so it lives beside the code that builds a pick's candidates and is
// read here — one number, not three that can drift apart. It moved out of the
// panel in #170, when `worldBudgets` became its third reader and
// `boardsmith/world` (which may reach the engine and nothing else) could not
// follow it into `src/ui`.
export { MAX_FLAT_CHOICE_CANDIDATES } from '../../engine/element/action-metadata.js';

/** One selection's candidate count at one moment of a simulated game. */
export interface ChoiceStepObservation {
  /** Name of the action the selection belongs to. */
  action: string;
  /** Name of the selection (the pick step). */
  selection: string;
  /** How many enabled candidates the step offered at this moment. */
  candidateCount: number;
  /** The step declares a board ref, so the board can draw and click its candidates. */
  boardAnchored: boolean;
  /** The step narrows on an earlier selection (`dependsOn`). */
  dependent: boolean;
}

/** A step that offers too much, with nothing shaping it. */
export interface UnboundedChoiceStep {
  action: string;
  selection: string;
  /** The largest candidate count observed for this step during the run. */
  maxCandidates: number;
}

/**
 * The subset of an engine `Selection` this audit reads. Kept structural so the
 * CLI does not have to import the engine's selection union just to count.
 */
interface ObservableSelection {
  name: string;
  type: string;
  /** Element / elements steps: maps a candidate to a board ref. */
  boardRef?: unknown;
  /** Choice steps: maps the choice list to board refs. */
  boardRefs?: unknown;
  /** Names the earlier selection this one narrows on. */
  dependsOn?: unknown;
}

/**
 * Classify one selection's candidate count into an observation. Reads the
 * selection's DEFINITION for the two shaping mechanisms, so the verdict does
 * not depend on which moment of the game was sampled.
 */
export function observeChoiceStep(
  action: string,
  selection: ObservableSelection,
  candidateCount: number,
): ChoiceStepObservation {
  return {
    action,
    selection: selection.name,
    candidateCount,
    boardAnchored: selection.boardRef !== undefined || selection.boardRefs !== undefined,
    dependent: selection.dependsOn !== undefined,
  };
}

/**
 * Reduce a run's observations to the steps that need the author's attention.
 *
 * Observations for the same (action, selection) collapse to the largest count
 * seen; `boardAnchored` and `dependent` latch true, because both are properties
 * of the definition and cannot change between two moments of one run.
 *
 * Findings come back largest-first so the worst offender leads the report.
 */
export function findUnboundedChoiceSteps(
  observations: Iterable<ChoiceStepObservation>,
  threshold: number = MAX_FLAT_CHOICE_CANDIDATES,
): UnboundedChoiceStep[] {
  const worst = new Map<string, ChoiceStepObservation>();

  for (const o of observations) {
    const key = `${o.action}\u0000${o.selection}`;
    const seen = worst.get(key);
    if (!seen) {
      worst.set(key, { ...o });
      continue;
    }
    seen.candidateCount = Math.max(seen.candidateCount, o.candidateCount);
    seen.boardAnchored ||= o.boardAnchored;
    seen.dependent ||= o.dependent;
  }

  return [...worst.values()]
    .filter((o) => !o.boardAnchored && !o.dependent && o.candidateCount > threshold)
    .map((o) => ({ action: o.action, selection: o.selection, maxCandidates: o.candidateCount }))
    .sort(
      (a, b) =>
        b.maxCandidates - a.maxCandidates ||
        a.action.localeCompare(b.action) ||
        a.selection.localeCompare(b.selection),
    );
}

/** The author-facing sentence for one finding: what happened, and the two ways out. */
export function describeUnboundedChoiceStep(step: UnboundedChoiceStep): string {
  return (
    `'${step.action}' step '${step.selection}' offered ${step.maxCandidates} choices at once ` +
    `with nothing shaping them. Anchor it on the board with boardRef so the board draws the ` +
    `candidates, or split it with a dependsOn step that narrows the list first.`
  );
}

/** How the audit drives the game to collect real candidate counts. */
interface ChoiceCardinalityAuditOptions {
  /** Base seed, so a reported finding is reproducible. */
  seed?: string;
  /** How many random games to walk. */
  games?: number;
  /** Player count to simulate. */
  players?: number;
  /** Override the reporting threshold (defaults to {@link MAX_FLAT_CHOICE_CANDIDATES}). */
  threshold?: number;
  /** Per-game wall-clock budget, ms. */
  timeout?: number;
  /** Game-specific options, as `boardsmith simulate --game-option` would supply. */
  gameOptions?: Record<string, unknown>;
}

/**
 * Walk a few random games and report every choice step that presents a large
 * flat list with no board anchor and no dependent narrowing.
 *
 * The counts come from the engine's own move enumeration — the SAME enumeration
 * the panel, the board and the bots read — so a finding is a real thing a player
 * would have seen, not a guess from the source text. That is why this lives here
 * and not in the ESLint plugin: a candidate count does not exist until a game is
 * running, and the plugin has neither a game nor type information.
 */
export async function auditChoiceCardinality<G extends Game>(
  gameClass: new (options: GameOptions) => G,
  options: ChoiceCardinalityAuditOptions = {},
): Promise<UnboundedChoiceStep[]> {
  const observations: ChoiceStepObservation[] = [];

  const results = await simulateRandomGames(gameClass, {
    count: options.games ?? 3,
    playerCounts: [options.players ?? 2],
    seed: options.seed,
    timeout: options.timeout,
    gameOptions: options.gameOptions,
    onSelectionChoices: ({ action, selection, candidateCount }) => {
      observations.push(observeChoiceStep(action, selection as ObservableSelection, candidateCount));
    },
  });

  // A game the simulator could not play offered no choice steps to count, so
  // returning findings from it would call an unchecked game clean (#306).
  const unplayed = results.games.find((game) => game.crashed || game.stuck);
  if (unplayed) {
    const what = unplayed.crashed ? 'crashed' : 'got stuck';
    throw new Error(
      `the random simulator ${what} after ${unplayed.actionCount} move(s) in the game with seed ${unplayed.seed}: ` +
        `${unplayed.error?.replace(/\.$/, '')}. ` +
        `"${simulateReplayCommand(unplayed, options.gameOptions ?? {})}" shows the same failure`,
    );
  }

  return findUnboundedChoiceSteps(observations, options.threshold);
}
