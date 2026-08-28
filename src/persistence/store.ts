/**
 * A cross-session persistence STORE, as a pure in-memory object.
 *
 * ## What it is for
 *
 * `boardsmith dev` had no store, so a game that declares `persistence: true`
 * could not be exercised at all until it was published: no entries arrived at
 * start and nothing was committed at game over. This is the store that closes
 * that, and it is deliberately the SAME shape ShufflewickPub's Convex store
 * presents to a session, so the dev host's read and commit paths are the
 * production ones.
 *
 * ## What it is NOT
 *
 * It is not a reimplementation of `convex/gamePersistence.ts`. The platform's
 * store owns quotas, scoping across campaigns, staging that settles inside the
 * same transaction as the play row, and a sweeper. None of that is emulated
 * and none of it is claimed: those are properties of a DEPLOYMENT, and a local
 * copy of them would be exactly the second implementation this whole directory
 * exists to avoid.
 *
 * What IS emulated is the part a game author can get wrong on their own
 * machine, and only learns about after publishing:
 *
 *   - the SEAL. `player:<token>/<key>` is one player's row. A session is
 *     handed, and may write, sealed rows only for the players it acts for.
 *   - the WIRE CEILING and every shape rule, which are not this file's at all:
 *     `commit()` calls `readPersistCommit` from `persistence.ts`, the one the
 *     platform's Durable Object calls.
 *
 * ## THE SEAL HAS NO BYPASS, AND THAT IS A DECISION (ShufflewickPub #47)
 *
 * It had one until #47. A round-era `resolution` session was SEATLESS -- its
 * single seat was host-held and no human sat in it -- so "may write only what
 * you are seated by" would have refused it every sealed row it existed to
 * rewrite. It was therefore trusted with all of them, on read and on write.
 *
 * When the round architecture was deleted, the obvious move was to hand that
 * privilege to `world`, on the reading that a resident world owns the whole
 * world and so writes everybody's state. It is NOT handed over, for three
 * reasons, and the platform side is written the same way:
 *
 *   1. The bypass was a consequence of SEATLESSNESS, not of authority. A
 *      resident world is never seatless at a write: a player attaches, is
 *      seated, and the world applies THAT player's command and answers with
 *      THAT player's view. There is no moment when the writer does not know
 *      whose row it is touching, so there is nothing for a bypass to rescue.
 *   2. A world's SHARED state does not live here at all. It is the world
 *      object's own partitions, held beside the object that owns them. What
 *      reaches a store is per-player and sealed by construction -- which is
 *      precisely so that deleting an account can reach it.
 *   3. Convex is the authoritative gate for every campaign-scope write, and it
 *      chooses its allowance by SCOPE, never by kind. A bypass here would only
 *      teach a game author that a commit is legal which production refuses --
 *      the exact "it worked locally" this store exists to prevent.
 *
 * ## Time is injected
 *
 * `writtenAt` comes from a `now()` the caller supplies, so a test can order two
 * commits without sleeping and a replay can be deterministic.
 */

import {
  PLAYER_KEY_PREFIX,
  readPersistCommit,
  toStartPayload,
  type PersistCommitEntry,
  type PersistPlayer,
  type PersistStartPayload,
} from './persistence.js';

/** One row as the store holds it: `value` still a JSON string, exactly as the
 *  platform stores it and exactly as `toStartPayload` expects to receive it. */
export interface StoredRow {
  key: string;
  value: string;
  schemaTag?: string;
  gameVersion?: string;
  writtenAt: number;
}

/** The store's whole contents, in the shape it is written to disk in. */
export interface PersistenceStoreState {
  rows: StoredRow[];
}

/** Why a commit was refused, in the game author's terms. `refused` carries the
 *  message the platform would have shown; there is deliberately no "partly
 *  applied" outcome, because the platform's commit is all-or-nothing. */
export type CommitOutcome = { ok: true; written: number } | { ok: false; reason: string };

export interface CommitRequest {
  /** The seats this session acts for, in `PersistPlayer` shape. This is the
   *  WHOLE of the session's sealed-write entitlement -- see the seal note in
   *  this file's header. A session acting for nobody may write nobody's
   *  sealed rows. */
  players: PersistPlayer[];
  /** The final spectator view, for the PUBLIC channel. */
  spectatorView: unknown;
  /** The already-stripped `persistPrivate` value, for the PRIVATE channel. */
  persistPrivate: unknown;
  /** The version stamped onto every row this commit writes. The platform takes
   *  it from the session; `boardsmith dev` has no published version, so the dev
   *  host passes its own marker rather than inventing a plausible one. */
  gameVersion: string;
  now: () => number;
}

/** The tokens a session acts for: every seated player with an account behind
 *  the seat. A seat with `playerId: null` (a bot, a guest) owns no sealed row,
 *  which is why it contributes no token rather than an empty one. */
function actingTokens(players: PersistPlayer[]): Set<string> {
  return new Set(
    players.map((p) => p.playerId).filter((id): id is string => id !== null && id !== ''),
  );
}

/** The token a sealed key belongs to, or `null` when the key is not sealed.
 *  A key of exactly `player:` with no token and no `/` is NOT sealed to
 *  anybody, and is refused as malformed rather than read as public. */
export function sealedKeyOwner(key: string): string | null {
  if (!key.startsWith(PLAYER_KEY_PREFIX)) return null;
  const rest = key.slice(PLAYER_KEY_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return '';
  return rest.slice(0, slash);
}

export class PersistenceStore {
  private rows: StoredRow[];

  constructor(state?: Partial<PersistenceStoreState>) {
    this.rows = [...(state?.rows ?? [])];
  }

  /** The whole store, for writing to disk. A copy: a caller that mutates what
   *  it saved must not be able to mutate what the store is still serving. */
  toState(): PersistenceStoreState {
    return { rows: this.rows.map((r) => ({ ...r })) };
  }

  /**
   * The payload injected into a session's `start` gameOptions, or `null` for
   * "inject nothing" -- which is what a game that opted out gets, and is NOT
   * the same as an empty store.
   *
   * The seal is applied HERE, on the READ, because that is where the platform
   * applies it: a session is handed sealed rows only for the players it acts
   * for, and no session is handed anybody else's.
   */
  readForSession(sessionKey: string, players: PersistPlayer[]): PersistStartPayload | null {
    const tokens = actingTokens(players);
    const visible = this.rows.filter((row) => {
      const owner = sealedKeyOwner(row.key);
      return owner === null || tokens.has(owner);
    });
    const parsed = toStartPayload({ entries: visible }, sessionKey, players);
    return parsed === null ? null : parsed.payload;
  }

  /**
   * Apply a session's commit, or refuse it with the message the platform would
   * have given.
   *
   * The validation is NOT this method's: `readPersistCommit` is the platform's
   * own, imported unchanged. What is added here is the one rule a store
   * enforces rather than a wire does -- the seal.
   */
  commit(request: CommitRequest): CommitOutcome {
    const parsed = readPersistCommit(request.spectatorView, request.persistPrivate);
    if (parsed.kind === 'absent') return { ok: true, written: 0 };
    if (parsed.kind === 'invalid') return { ok: false, reason: parsed.reason };

    const tokens = actingTokens(request.players);
    for (const entry of parsed.entries) {
      const refusal = this.refusalFor(entry, tokens);
      if (refusal) return { ok: false, reason: refusal };
    }

    const at = request.now();
    for (const entry of parsed.entries) this.applyRow(entry, request.gameVersion, at);
    return { ok: true, written: parsed.entries.length };
  }

  /** Why this entry may not be committed by this session, or `null`. */
  private refusalFor(entry: PersistCommitEntry, tokens: Set<string>): string | null {
    const owner = sealedKeyOwner(entry.key);
    if (owner === null) return null;
    if (owner === '') {
      return (
        `the key "${entry.key}" starts with the reserved "${PLAYER_KEY_PREFIX}" prefix but names ` +
        `no player. A sealed row is "${PLAYER_KEY_PREFIX}<playerId>/<key>"`
      );
    }
    if (tokens.has(owner)) return null;
    return (
      `the key "${entry.key}" is sealed to player "${owner}", and this session does not act ` +
      `for them. A session may write a sealed row only for a player it is seated by; seat ` +
      `tokens arrive in the start payload's "players" array`
    );
  }

  private applyRow(entry: PersistCommitEntry, gameVersion: string, at: number): void {
    const index = this.rows.findIndex((r) => r.key === entry.key);
    if (entry.value === null) {
      if (index !== -1) this.rows.splice(index, 1);
      return;
    }
    const row: StoredRow = {
      key: entry.key,
      value: entry.value,
      ...(entry.schemaTag === undefined ? {} : { schemaTag: entry.schemaTag }),
      gameVersion,
      writtenAt: at,
    };
    if (index === -1) this.rows.push(row);
    else this.rows[index] = row;
  }
}
