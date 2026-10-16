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
  monotonicTrack,
  uniqueTrack,
  counterTrack,
  canAddToTrack,
  addToTrack,
  incrementCounter,
  isTrackComplete,
  trackPoints,
} from './track.js';

export type {
  TrackEntry,
  TrackConfig,
  MonotonicTrackConfig,
  UniqueTrackConfig,
  CounterTrackConfig,
  TrackState,
  MonotonicTrackState,
  UniqueTrackState,
  CounterTrackState,
} from './track.js';
