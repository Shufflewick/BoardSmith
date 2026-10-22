/**
 * Scoring system exports
 *
 * Plain-data scoring tracks for dice and roll-and-write games.
 */

export {
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
