/**
 * `boardsmith/world/host` -- HOW A WORLD IS DRIVEN, with no transport in it.
 *
 * Deliberately NOT re-exported from `boardsmith/world`'s barrel. That barrel
 * promises a runtime with no clock and no storage engine reachable from it, and
 * this half is the other side of exactly those two seams: it takes a
 * {@link WorldHostClock} and a {@link WorldStore} and runs the loop every host
 * runs over them. Importing it is a decision a host makes on purpose.
 *
 * Two hosts drive it today -- `boardsmith dev`'s `LocalWorldHost` over SQLite,
 * and `boardsmith/testing`'s `TestWorld` over a Map -- which is the whole point:
 * a test that scans a world's board must be scanning the projection a host
 * SENDS, not a second implementation of it that can drift (#262).
 */
export * from './clock.js';
export * from './store.js';
export * from './resident-world.js';
