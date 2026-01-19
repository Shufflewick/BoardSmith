/**
 * Scoring system exports
 *
 * Provides track abstractions for dice/roll-and-write games.
 */

export {
  Track,
  MonotonicTrack,
  UniqueTrack,
  CounterTrack,
} from './track.js';

export type {
  TrackEntry,
  TrackConfig,
  MonotonicTrackConfig,
  UniqueTrackConfig,
  CounterTrackConfig,
  TrackCommandEmitter,
} from './track.js';
