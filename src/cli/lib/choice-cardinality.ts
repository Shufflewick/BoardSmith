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
import type { ActionDefinition, Game, GameOptions } from '../../engine/index.js';
import { simulateRandomGames } from '../../testing/random-simulation.js';
import { createTestWorld, type TestWorld, type TestWorldOptions } from '../../testing/test-world.js';
import { MAX_FLAT_CHOICE_CANDIDATES } from '../../engine/element/action-metadata.js';
import { WorldRefusal, type WorldActionOffer } from '../../world/index.js';
import { SeededRandom } from '../../utils/random.js';
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

/** Which backend a finding came from, which decides the way out the author is told. */
export type ChoiceCardinalityBackend = 'table' | 'world';

/**
 * The author-facing sentence for one finding: what happened, and the two ways
 * out. A world is not told to use `dependsOn`, because a world action that
 * declares one is refused at construction (#323).
 */
export function describeUnboundedChoiceStep(
  step: UnboundedChoiceStep,
  backend: ChoiceCardinalityBackend,
): string {
  const narrow =
    backend === 'table'
      ? `split it with a dependsOn step that narrows the list first.`
      : `ask an earlier question whose answer narrows this list. A world has no dependent steps; ` +
        `the panel re-asks a later question with the earlier answers bound.`;
  return (
    `'${step.action}' step '${step.selection}' offered ${step.maxCandidates} choices at once ` +
    `with nothing shaping them. Anchor it on the board with boardRef so the board draws the ` +
    `candidates, or ${narrow}`
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

/** How the world audit drives the world to collect real candidate counts. */
interface WorldChoiceCardinalityAuditOptions {
  /** The world's seed and the driver's, so a reported finding is reproducible. */
  seed?: string;
  /** How many seats to drive, from seat 1. Three, or every seat of a smaller world. */
  seats?: number;
  /** How many rounds. In each, every driven seat takes one random offer, then what is due fires. */
  rounds?: number;
  /** Override the reporting threshold (defaults to {@link MAX_FLAT_CHOICE_CANDIDATES}). */
  threshold?: number;
}

/** One pick of one offer, as the seat answering it sees it. */
type OfferedPick = WorldActionOffer['selections'][number];

/** A drafted command a seat could send. */
interface DraftedMove {
  name: string;
  args: Record<string, unknown>;
}

/** What one drive of a world collects, across every seat and round. */
interface WorldDrive {
  readonly world: TestWorld;
  readonly actions: readonly ActionDefinition[];
  readonly rng: SeededRandom;
  readonly observations: ChoiceStepObservation[];
  /** Why an enabled offer could not be answered, once per distinct reason. */
  readonly undraftable: Set<string>;
  /** How many enabled offers were answered, which is how much was checked. */
  drafted: number;
}

/**
 * Drive a world the way a host does and report every choice step that presents
 * a large flat list with no board anchor (#323).
 *
 * A world has no flow for the random simulator to play, so this runs it through
 * `TestWorld`, which is the host core with an in-memory store and a clock moved
 * by hand. The driven seats arrive, as a host announces a player attaching.
 * Then, each round, every driven seat's offers are enumerated, each enabled
 * offer is drafted question by question (a later question re-asked with the
 * earlier answers bound, as the panel re-asks it), one drafted offer is taken,
 * and whatever the clock has due is fired. The counts are the candidates those
 * offers and re-asked picks actually carried.
 *
 * It never reports an undriven world as clean: a world in which no seat was
 * offered anything it could take is refused, and so is a move the world itself
 * refused (a `WorldRefusal`, such as a partition the action never declared).
 * An action that says no to a random answer is the rules working, and is not.
 */
export async function auditWorldChoiceCardinality(
  definition: TestWorldOptions['definition'],
  options: WorldChoiceCardinalityAuditOptions = {},
): Promise<UnboundedChoiceStep[]> {
  const block = definition.world;
  if (block === undefined) {
    throw new Error('your gameDefinition declares no world block, so there is no world to drive');
  }
  const seed = options.seed ?? 'choice-cardinality';
  const rounds = options.rounds ?? 10;
  const seats = drivenSeats(options.seats ?? 3, block.maxPlayers);

  const world = await createTestWorld({ definition, seed, watching: seats });
  const drive: WorldDrive = {
    world,
    actions: block.actions,
    rng: new SeededRandom(seed),
    observations: [],
    undraftable: new Set(),
    drafted: 0,
  };
  try {
    for (const seat of seats) await world.arrive(seat);
    for (let round = 0; round < rounds; round++) {
      for (const seat of seats) await driveSeat(drive, seat);
      await world.fireDue();
    }
  } finally {
    await world.close();
  }

  if (drive.drafted === 0) throw nothingDrafted(drive, rounds, seats);
  return findUnboundedChoiceSteps(drive.observations, options.threshold);
}

/** Seats 1 to `wanted`, or every seat of a world with fewer. */
function drivenSeats(wanted: number, maxPlayers: number): number[] {
  return Array.from({ length: Math.min(wanted, maxPlayers) }, (_, i) => i + 1);
}

/** The refusal for a drive that answered no offer at all, so counted nothing. */
function nothingDrafted(drive: WorldDrive, rounds: number, seats: readonly number[]): Error {
  const why = drive.undraftable.size === 0 ? '' : `: ${[...drive.undraftable].join('; ')}`;
  return new Error(
    `no seat was offered an action it could take in ${rounds} round(s) of driving seats ` +
      `${seats.join(', ')}, so there were no choices to count${why}`,
  );
}

/** Draft every enabled offer this seat holds, then take one of them. */
async function driveSeat(drive: WorldDrive, seat: number): Promise<void> {
  const moves: DraftedMove[] = [];
  for (const offer of await offersOf(drive.world, seat)) {
    if (offer.disabled !== undefined) continue;
    const move = await draftMove(drive, seat, offer);
    if (typeof move === 'string') drive.undraftable.add(move);
    else moves.push(move);
  }
  drive.drafted += moves.length;
  if (moves.length > 0) await takeMove(drive.world, seat, drive.rng.pick(moves));
}

/** A seat's offers, or the world's refusal to enumerate them, named for the seat it was about. */
async function offersOf(world: TestWorld, seat: number): Promise<readonly WorldActionOffer[]> {
  try {
    return await world.offersFor(seat);
  } catch (error) {
    throw new Error(
      `driving the world, seat ${seat}'s offers could not be enumerated: ` +
        `${(error as Error).message.replace(/\.$/, '')}`,
    );
  }
}

/**
 * Answer one offer's questions at random, in order, recording each list's size.
 * The first question is answered from the offer itself; every later one is
 * re-asked with the answers so far, because that narrowed list is the one a
 * player sees and the one the command is validated against.
 *
 * Answers the drafted move, or why this offer could not be answered.
 */
async function draftMove(drive: WorldDrive, seat: number, offer: WorldActionOffer): Promise<DraftedMove | string> {
  const world: TestWorld = drive.world;
  const action = actionNamed(drive.actions, offer.name);
  const args: Record<string, unknown> = {};
  for (const [index, listed] of offer.selections.entries()) {
    const pick = index === 0 ? listed : await world.resolvePick(seat, offer.name, listed.name, args);
    const drawn = drawPick(drive, action, pick);
    if (drawn.ok) args[pick.name] = drawn.answer;
    else if (pick.optional === undefined || pick.optional === false) return drawn.whyNot;
  }
  return { name: offer.name, args };
}

/** The world's own definition of an offered action, which carries boardRef/boardRefs. */
function actionNamed(actions: readonly ActionDefinition[], name: string): ActionDefinition {
  const action = actions.find((candidate) => candidate.name === name);
  if (action === undefined) {
    throw new Error(`the world offered '${name}', which is not in its gameDefinition.world.actions`);
  }
  return action;
}

/** A random answer to one pick, or why there is none. A list pick's size is recorded. */
function drawPick(
  drive: WorldDrive,
  action: ActionDefinition,
  pick: OfferedPick,
): { ok: true; answer: unknown } | { ok: false; whyNot: string } {
  const question = `'${action.name}' asks for`;
  if (pick.type === 'text') {
    return { ok: false, whyNot: `${question} text input '${pick.name}', which a random driver cannot type` };
  }
  if (pick.type === 'number') {
    const value = drawNumber(pick, drive.rng);
    return value === undefined
      ? { ok: false, whyNot: `${question} number '${pick.name}' without a bounded range to draw from` }
      : { ok: true, answer: value };
  }

  const candidates = enabledCandidates(pick);
  const selection = action.selections.find((candidate) => candidate.name === pick.name);
  if (selection === undefined) {
    throw new Error(`the world offered '${action.name}' question '${pick.name}', which its action does not declare`);
  }
  drive.observations.push(observeChoiceStep(action.name, selection, candidates.length));

  const answer = drawAnswer(pick, candidates, drive.rng);
  return answer === undefined
    ? { ok: false, whyNot: `${question} '${pick.name}', which had too few choices to answer` }
    : { ok: true, answer };
}

/** The values a choice pick, or the element ids an element pick, offers enabled. */
function enabledCandidates(pick: OfferedPick): unknown[] {
  if (pick.type === 'choice') {
    return (pick.choices ?? []).filter((choice) => choice.disabled === undefined).map((choice) => choice.value);
  }
  return (pick.validElements ?? []).filter((element) => element.disabled === undefined).map((element) => element.id);
}

/** A number inside the pick's bounds, or undefined when it has no closed range. */
function drawNumber(pick: OfferedPick, rng: SeededRandom): number | undefined {
  if (pick.min === undefined || pick.max === undefined) return undefined;
  const lo = pick.integer ? Math.ceil(pick.min) : pick.min;
  const hi = pick.integer ? Math.floor(pick.max) : pick.max;
  if (hi < lo) return undefined;
  return pick.integer ? lo + rng.nextInt(hi - lo + 1) : lo + rng.next() * (hi - lo);
}

/**
 * A random answer the pick's own bounds allow: a sequence for an ordered list
 * (repeats allowed), a set for a multi-select, one candidate otherwise.
 * Undefined when there are too few candidates to answer it.
 */
function drawAnswer(pick: OfferedPick, candidates: unknown[], rng: SeededRandom): unknown {
  if (pick.orderedList !== undefined) return drawSequence(pick.orderedList, candidates, rng);
  const set = pick.multiSelect ?? (pick.type === 'elements' ? { min: 1 } : undefined);
  if (set !== undefined) return drawSet(set, candidates, rng);
  return candidates.length === 0 ? undefined : rng.pick(candidates);
}

/** An ordered list: entries drawn with replacement, as many as its bounds allow. */
function drawSequence(bounds: { min: number; max?: number }, candidates: unknown[], rng: SeededRandom): unknown[] | undefined {
  if (candidates.length === 0) return bounds.min <= 0 ? [] : undefined;
  const max = bounds.max ?? Math.max(bounds.min, candidates.length);
  return Array.from({ length: bounds.min + rng.nextInt(max - bounds.min + 1) }, () => rng.pick(candidates));
}

/** A multi-select: distinct candidates, as many as its bounds and the candidates allow. */
function drawSet(bounds: { min: number; max?: number }, candidates: unknown[], rng: SeededRandom): unknown[] | undefined {
  if (candidates.length < bounds.min) return undefined;
  const max = Math.min(bounds.max ?? candidates.length, candidates.length);
  return rng.shuffle(candidates).slice(0, bounds.min + rng.nextInt(max - bounds.min + 1));
}

/**
 * Send one drafted command. The rules saying no to a random answer leaves the
 * world as it was and is part of driving it; the WORLD refusing it is a fault
 * in the bundle, and is reported with the move that found it.
 */
async function takeMove(world: TestWorld, seat: number, move: DraftedMove): Promise<void> {
  try {
    await world.take(seat, move.name, move.args);
  } catch (error) {
    if (!(error instanceof WorldRefusal)) return;
    throw new Error(
      `driving the world, seat ${seat}'s '${move.name}' with ${JSON.stringify(move.args)} ` +
        `was refused by the world (${error.code}): ${error.message.replace(/\.$/, '')}`,
    );
  }
}
