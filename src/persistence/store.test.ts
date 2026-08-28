import { describe, it, expect } from 'vitest';
import { PersistenceStore } from './store.js';
import type { PersistPlayer } from './persistence.js';

/**
 * ShufflewickPub #47 -- THE SEAL HAS NO BYPASS LEFT.
 *
 * The round era had one: a `resolution` session was SEATLESS -- its single seat
 * was host-held -- so `allow only what you are seated by` would have refused it
 * every sealed row it existed to rewrite. It was therefore trusted with all of
 * them, on read and on write.
 *
 * A resident world is the opposite shape. A player attaches, is seated, and the
 * world applies THAT player's command and answers with THAT player's view, so
 * there is never a moment when the writer does not know whose row it is
 * touching. The bypass is deleted rather than inherited, and the platform side
 * agrees: `convex/gamePersistence.ts` gates every campaign-scope commit with
 * `validatePlayerKeys({ allow: "seated" })`, chosen by SCOPE and never by kind,
 * so a bypass here would only mean the dev host accepting a commit production
 * refuses.
 *
 * These cases are the store's own. The wire rules they sit behind belong to
 * `readPersistCommit` and are proved against production in the platform's
 * `scripts/persistence-conformance.test.mjs`.
 */

const SEATED: PersistPlayer[] = [{ seat: 1, playerId: 'p1' }];

/** A commit carrying `entries` on the PRIVATE channel -- where a sealed key is
 *  allowed to ride at all (the public one broadcasts what it carries). */
function commitOf(store: PersistenceStore, entries: unknown[], players = SEATED) {
  return store.commit({
    players,
    spectatorView: null,
    persistPrivate: { entries },
    gameVersion: 'dev',
    now: () => 1,
  });
}

describe('#47 -- a session may seal only for a player it acts for', () => {
  it('accepts a sealed row for a player this session is seated by', () => {
    const store = new PersistenceStore();
    expect(commitOf(store, [{ key: 'player:p1/sheet', value: { hp: 1 } }])).toEqual({
      ok: true,
      written: 1,
    });
  });

  it('refuses a sealed row for a player this session is NOT seated by', () => {
    const store = new PersistenceStore();
    const outcome = commitOf(store, [{ key: 'player:p2/sheet', value: { hp: 1 } }]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('player:p2/sheet');
    expect(outcome.reason).toContain('does not act');
  });

  it('refuses it for a SEATLESS session too -- there is no whole-world writer', () => {
    // The exact case the round era exempted. A session acting for nobody now
    // writes nobody's sealed rows.
    const store = new PersistenceStore();
    const outcome = commitOf(store, [{ key: 'player:p1/sheet', value: { hp: 1 } }], []);
    expect(outcome.ok).toBe(false);
  });

  it('still refuses a prefix that names no player', () => {
    const store = new PersistenceStore();
    const outcome = commitOf(store, [{ key: 'player:/sheet', value: 1 }]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('names no player');
  });

  it('hands a session the shared rows plus only its own sealed ones', () => {
    const store = new PersistenceStore();
    commitOf(store, [
      { key: 'shared', value: 1 },
      { key: 'player:p1/sheet', value: 2 },
    ]);
    const payload = store.readForSession('session-1', SEATED);
    expect(payload?.entries.map((e) => e.key).sort()).toEqual(['player:p1/sheet', 'shared']);

    const other = store.readForSession('session-1', [{ seat: 1, playerId: 'p2' }]);
    expect(other?.entries.map((e) => e.key)).toEqual(['shared']);
  });
});
