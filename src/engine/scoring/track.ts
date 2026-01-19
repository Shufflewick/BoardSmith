/**
 * Track System - Generic scoring track abstractions for dice/roll-and-write games
 *
 * Tracks are used to record values during gameplay and calculate scores.
 * Common patterns include:
 * - Monotonic tracks (values must increase or decrease)
 * - Unique tracks (no duplicate values allowed)
 * - Completion bonuses when tracks are filled
 *
 * @example
 * ```typescript
 * // Increasing sequence track (like Fulminate in Polyhedral Potions)
 * const track = new MonotonicTrack({
 *   id: 'fulminate',
 *   direction: 'increasing',
 *   maxEntries: 10,
 *   pointsPerEntry: [0, 1, 3, 6, 11, 16, 23, 30, 40, 50],
 *   completionBonus: 65,
 * });
 *
 * // Decreasing sequence track (like Distillation columns)
 * const distillColumn = new MonotonicTrack({
 *   id: 'distill-1',
 *   direction: 'decreasing',
 *   maxEntries: 5,
 *   pointsPerEntry: [0, -10, -5, -2, 0],
 *   completionBonus: 25,
 * });
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

/**
 * Callback for emitting track commands
 */
export type TrackCommandEmitter = (trackId: string, value: number, isSpecial: boolean) => void;

/**
 * Base class for scoring tracks
 */
export abstract class Track {
  readonly id: string;
  readonly name: string;
  readonly maxEntries: number;
  readonly pointsPerEntry: number[];
  readonly completionBonus: number;
  readonly allowSpecialEntries: boolean;

  protected entries: TrackEntry[] = [];

  /** Optional command emitter for integration with game command system */
  private commandEmitter?: TrackCommandEmitter;

  constructor(config: TrackConfig) {
    this.id = config.id;
    this.name = config.name ?? config.id;
    this.maxEntries = config.maxEntries;
    this.pointsPerEntry = config.pointsPerEntry ?? new Array(config.maxEntries).fill(0);
    this.completionBonus = config.completionBonus ?? 0;
    this.allowSpecialEntries = config.allowSpecialEntries ?? false;
  }

  /**
   * Set a command emitter for this track.
   * When set, add() will emit commands instead of directly modifying state.
   */
  setCommandEmitter(emitter: TrackCommandEmitter): void {
    this.commandEmitter = emitter;
  }

  /**
   * Check if a value can be added to this track
   * @param value - The value to add
   * @param isSpecial - Whether this is a special entry (bypasses normal rules)
   */
  abstract canAdd(value: number, isSpecial?: boolean): boolean;

  /**
   * Add a value to the track.
   * If a command emitter is set, this emits a command instead of directly modifying state.
   * @returns The points earned for this entry
   */
  add(value: number, isSpecial: boolean = false): number {
    if (!this.canAdd(value, isSpecial)) {
      throw new Error(`Cannot add value ${value} to track ${this.id}`);
    }

    // If command emitter is set, emit command instead of modifying directly
    if (this.commandEmitter) {
      this.commandEmitter(this.id, value, isSpecial);
      // Return expected points (command executor will do actual add)
      return this.pointsPerEntry[this.entries.length] ?? 0;
    }

    return this.addInternal(value, isSpecial);
  }

  /**
   * Internal add method - directly modifies state (used by command executor)
   * @internal
   */
  addInternal(value: number, isSpecial: boolean = false): number {
    if (!this.canAdd(value, isSpecial)) {
      throw new Error(`Cannot add value ${value} to track ${this.id}`);
    }

    const position = this.entries.length;
    const points = this.pointsPerEntry[position] ?? 0;

    this.entries.push({ value, points, isSpecial });
    return points;
  }

  /**
   * Remove the last entry from the track (used for undo)
   * @internal
   */
  removeLastInternal(): void {
    if (this.entries.length > 0) {
      this.entries.pop();
    }
  }

  /**
   * Get all entries in this track
   */
  getEntries(): readonly TrackEntry[] {
    return this.entries;
  }

  /**
   * Get the last entry in the track
   */
  getLastEntry(): TrackEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * Get the number of entries
   */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Check if the track is complete (all positions filled)
   */
  isComplete(): boolean {
    return this.entries.length >= this.maxEntries;
  }

  /**
   * Check if the track is empty
   */
  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /**
   * Calculate total points from this track (entries + completion bonus)
   */
  calculatePoints(): number {
    let total = 0;
    for (const entry of this.entries) {
      total += entry.points;
    }
    if (this.isComplete()) {
      total += this.completionBonus;
    }
    return total;
  }

  /**
   * Get a breakdown of points
   */
  getPointsBreakdown(): { entries: number; bonus: number; total: number } {
    const entries = this.entries.reduce((sum, e) => sum + e.points, 0);
    const bonus = this.isComplete() ? this.completionBonus : 0;
    return { entries, bonus, total: entries + bonus };
  }

  /**
   * Clear all entries (for reset)
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Serialize for saving/transmission
   */
  toJSON(): { id: string; entries: TrackEntry[] } {
    return {
      id: this.id,
      entries: [...this.entries],
    };
  }

  /**
   * Restore from serialized data
   */
  fromJSON(data: { entries: TrackEntry[] }): void {
    this.entries = [...data.entries];
  }
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
 * A track where values must follow a monotonic sequence (increasing or decreasing)
 *
 * @example
 * ```typescript
 * // Strictly increasing (each value must be greater than previous)
 * const increasing = new MonotonicTrack({
 *   id: 'fulminate',
 *   direction: 'increasing',
 *   maxEntries: 10,
 * });
 *
 * // Decreasing with special entries allowed to equal previous
 * const decreasing = new MonotonicTrack({
 *   id: 'distill',
 *   direction: 'decreasing',
 *   maxEntries: 5,
 *   allowSpecialEntries: true, // Special entries can equal previous value
 * });
 * ```
 */
export class MonotonicTrack extends Track {
  readonly direction: 'increasing' | 'decreasing';
  readonly allowEqual: boolean;

  constructor(config: MonotonicTrackConfig) {
    super(config);
    this.direction = config.direction;
    this.allowEqual = config.allowEqual ?? false;
  }

  canAdd(value: number, isSpecial: boolean = false): boolean {
    // Check if track is full
    if (this.entries.length >= this.maxEntries) {
      return false;
    }

    // First entry is always allowed
    if (this.entries.length === 0) {
      return true;
    }

    const lastValue = this.entries[this.entries.length - 1].value;

    // Special entries can equal previous value if allowSpecialEntries is true
    const allowEqualForThis = this.allowEqual || (isSpecial && this.allowSpecialEntries);

    if (this.direction === 'increasing') {
      return allowEqualForThis ? value >= lastValue : value > lastValue;
    } else {
      return allowEqualForThis ? value <= lastValue : value < lastValue;
    }
  }
}

/**
 * Configuration for unique tracks
 */
export interface UniqueTrackConfig extends TrackConfig {
  /** Valid value range (inclusive) */
  validRange?: { min: number; max: number };
}

/**
 * A track where each value can only appear once
 *
 * @example
 * ```typescript
 * // Track potions 1-32, each can only be crafted once
 * const potions = new UniqueTrack({
 *   id: 'potions',
 *   maxEntries: 32,
 *   validRange: { min: 1, max: 32 },
 * });
 * ```
 */
export class UniqueTrack extends Track {
  readonly validRange?: { min: number; max: number };

  constructor(config: UniqueTrackConfig) {
    super(config);
    this.validRange = config.validRange;
  }

  canAdd(value: number, isSpecial: boolean = false): boolean {
    // Check if track is full
    if (this.entries.length >= this.maxEntries) {
      return false;
    }

    // Check valid range
    if (this.validRange) {
      if (value < this.validRange.min || value > this.validRange.max) {
        return false;
      }
    }

    // Check for duplicates (special entries bypass this)
    if (!isSpecial || !this.allowSpecialEntries) {
      if (this.entries.some(e => e.value === value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a specific value has been recorded
   */
  hasValue(value: number): boolean {
    return this.entries.some(e => e.value === value);
  }

  /**
   * Get all recorded values as a set
   */
  getValues(): Set<number> {
    return new Set(this.entries.map(e => e.value));
  }
}

/**
 * Configuration for counter tracks
 */
export interface CounterTrackConfig extends TrackConfig {
  /** Points per count */
  pointsPerCount?: number;
}

/**
 * A simple counter track (counts occurrences, like poison skulls)
 *
 * @example
 * ```typescript
 * const poisonTrack = new CounterTrack({
 *   id: 'poison',
 *   maxEntries: 6,
 *   pointsPerCount: 2, // 2 points per skull
 *   completionBonus: 10, // Star worth 10 points
 * });
 * ```
 */
export class CounterTrack extends Track {
  readonly pointsPerCount: number;

  constructor(config: CounterTrackConfig) {
    // Override pointsPerEntry based on pointsPerCount
    const pointsPerCount = config.pointsPerCount ?? 0;
    super({
      ...config,
      pointsPerEntry: new Array(config.maxEntries).fill(pointsPerCount),
    });
    this.pointsPerCount = pointsPerCount;
  }

  /**
   * Counter tracks always allow adding (until full)
   */
  canAdd(_value: number, _isSpecial?: boolean): boolean {
    return this.entries.length < this.maxEntries;
  }

  /**
   * Increment the counter (value is ignored, just counts)
   */
  increment(): number {
    return this.add(this.entries.length + 1);
  }

  /**
   * Get the current count
   */
  get count(): number {
    return this.entries.length;
  }
}
