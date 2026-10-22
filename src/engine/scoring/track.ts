/**
 * Scoring tracks for dice and roll-and-write games, as plain data.
 *
 * A track is a plain object and the functions below act on it, so a track held
 * on a Player survives every snapshot, undo and bot clone as ordinary data.
 *
 * @example
 * ```typescript
 * class MyPlayer extends Player {
 *   fulminate = monotonicTrack({
 *     id: 'fulminate',
 *     direction: 'increasing',
 *     maxEntries: 10,
 *     pointsPerEntry: [0, 1, 3, 6, 11, 16, 23, 30, 40, 50],
 *     completionBonus: 65,
 *   });
 * }
 *
 * if (canAddToTrack(player.fulminate, 7)) addToTrack(player.fulminate, 7);
 * const points = trackPoints(player.fulminate);
 * ```
 */

/**
 * An entry in a scoring track
 */
export interface TrackEntry {
  /** The recorded value */
  value: number;
  /** Points earned for this entry */
  points: number;
  /** Whether this was a "special" entry (e.g., poison allowing duplicates) */
  isSpecial?: boolean;
}

/**
 * Configuration for a scoring track
 */
export interface TrackConfig {
  /** Unique identifier for this track */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Maximum number of entries allowed */
  maxEntries: number;
  /** Points for each entry position (array index = position) */
  pointsPerEntry?: number[];
  /** Bonus points for completing the track */
  completionBonus?: number;
  /** Whether to allow special entries that bypass normal rules */
  allowSpecialEntries?: boolean;
}

/** `config.maxEntries`, refused unless it is a whole number of 1 or more: a track with no positions is complete while empty. */
function trackSize(config: TrackConfig): number {
  const { maxEntries } = config;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`Track "${config.id}" needs maxEntries of 1 or more (a whole number), but got ${maxEntries}.`);
  }
  return maxEntries;
}

/**
 * Configuration for monotonic tracks
 */
export interface MonotonicTrackConfig extends TrackConfig {
  /** Direction of the sequence */
  direction: 'increasing' | 'decreasing';
  /** Whether equal values are allowed (strict vs non-strict monotonicity) */
  allowEqual?: boolean;
}

/**
 * Configuration for unique tracks
 */
export interface UniqueTrackConfig extends TrackConfig {
  /** Valid value range (inclusive) */
  validRange?: { min: number; max: number };
}

/**
 * Configuration for counter tracks
 */
export interface CounterTrackConfig extends TrackConfig {
  /** Points per count */
  pointsPerCount?: number;
}

interface TrackStateBase {
  id: string;
  name: string;
  maxEntries: number;
  pointsPerEntry: number[];
  completionBonus: number;
  allowSpecialEntries: boolean;
  entries: TrackEntry[];
}

/** A track whose values must keep rising or keep falling. Make one with {@link monotonicTrack}. */
export interface MonotonicTrackState extends TrackStateBase {
  kind: 'monotonic';
  direction: 'increasing' | 'decreasing';
  allowEqual: boolean;
}

/** A track where each value may appear once. Make one with {@link uniqueTrack}. */
export interface UniqueTrackState extends TrackStateBase {
  kind: 'unique';
  validRange?: { min: number; max: number };
}

/** A tally that scores the same points per mark. Make one with {@link counterTrack}. */
export interface CounterTrackState extends TrackStateBase {
  kind: 'counter';
}

/** A scoring track as plain, serializable data. Store it on a Player like any other field. */
export type TrackState = MonotonicTrackState | UniqueTrackState | CounterTrackState;

function trackBase(config: TrackConfig): TrackStateBase {
  return {
    id: config.id,
    name: config.name ?? config.id,
    maxEntries: trackSize(config),
    pointsPerEntry: config.pointsPerEntry ?? new Array(config.maxEntries).fill(0),
    completionBonus: config.completionBonus ?? 0,
    allowSpecialEntries: config.allowSpecialEntries ?? false,
    entries: [],
  };
}

/**
 * A new, empty track whose values must keep rising (`'increasing'`) or keep falling (`'decreasing'`).
 *
 * @example
 * ```typescript
 * fulminate = monotonicTrack({ id: 'fulminate', direction: 'increasing', maxEntries: 10 });
 * ```
 */
export function monotonicTrack(config: MonotonicTrackConfig): MonotonicTrackState {
  return { ...trackBase(config), kind: 'monotonic', direction: config.direction, allowEqual: config.allowEqual ?? false };
}

/** A new, empty track where each value may appear once, optionally only inside `validRange`. */
export function uniqueTrack(config: UniqueTrackConfig): UniqueTrackState {
  const track: UniqueTrackState = { ...trackBase(config), kind: 'unique' };
  if (config.validRange) track.validRange = { ...config.validRange };
  return track;
}

/** A new, empty tally where every mark scores `pointsPerCount`. */
export function counterTrack(config: CounterTrackConfig): CounterTrackState {
  return {
    ...trackBase(config),
    kind: 'counter',
    pointsPerEntry: new Array(config.maxEntries).fill(config.pointsPerCount ?? 0),
  };
}

/**
 * Whether `value` may be added to `track` now. A full track refuses everything.
 * `isSpecial` lets the entry repeat a value, on a track made with `allowSpecialEntries`.
 */
export function canAddToTrack(track: TrackState, value: number, isSpecial: boolean = false): boolean {
  if (track.entries.length >= track.maxEntries) return false;
  const special = isSpecial && track.allowSpecialEntries;
  if (track.kind === 'unique') return uniqueAccepts(track, value, special);
  if (track.kind === 'monotonic') return monotonicAccepts(track, value, special);
  return true;
}

function uniqueAccepts(track: UniqueTrackState, value: number, special: boolean): boolean {
  const range = track.validRange;
  if (range && (value < range.min || value > range.max)) return false;
  return special || !track.entries.some((e) => e.value === value);
}

function monotonicAccepts(track: MonotonicTrackState, value: number, special: boolean): boolean {
  const last = track.entries.at(-1)?.value;
  if (last === undefined) return true;
  if (value === last) return track.allowEqual || special;
  return track.direction === 'increasing' ? value > last : value < last;
}

/**
 * Record `value` on `track` and return the points its position scores.
 * @throws when {@link canAddToTrack} refuses the value
 */
export function addToTrack(track: TrackState, value: number, isSpecial: boolean = false): number {
  if (!canAddToTrack(track, value, isSpecial)) {
    throw new Error(`Cannot add value ${value} to track ${track.id}`);
  }
  const points = track.pointsPerEntry[track.entries.length] ?? 0;
  track.entries.push({ value, points, isSpecial });
  return points;
}

/**
 * Add one mark to a counter and return the points it scores.
 * @throws when the counter is full
 */
export function incrementCounter(track: CounterTrackState): number {
  return addToTrack(track, track.entries.length + 1);
}

/** Whether every position of `track` is filled. */
export function isTrackComplete(track: TrackState): boolean {
  return track.entries.length >= track.maxEntries;
}

/** The points `track` scores: its entries, plus the completion bonus once it is full. */
export function trackPoints(track: TrackState): number {
  const entries = track.entries.reduce((sum, e) => sum + e.points, 0);
  return isTrackComplete(track) ? entries + track.completionBonus : entries;
}
