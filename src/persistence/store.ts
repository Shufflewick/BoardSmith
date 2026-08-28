/**
 * A cross-session persistence STORE, as a pure in-memory object.
 *
 * ## What it is for
 *
 * `boardsmith dev` had no store, so a game that declares `persistence: true`
 * could not be exercised at all until it was published: no entries arrived at
 * start, nothing was committed at game over, and a WORLD RESOLVER -- which
 * exists only to read a store, advance it and write it back -- could not be
 * run even once. This is the store that closes that, and it is deliberately
 * the SAME shape ShufflewickPub's Convex store presents to a session, so the
 * dev host's read and commit paths are the production ones.
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
 *   - the KIND. An `orderEntry` session's commit is a round's ORDERS, not
 *     store rows, and an order may not be a deletion.
 *   - the WIRE CEILING and every shape rule, which are not this file's at all:
 *     `commit()` calls `readPersistCommit` from `persistence.ts`, the one the
 *     platform's Durable Object calls.
 *
 * ## Time is injected
 *
 * `writtenAt`/`submittedAt` come from a `now()` the caller supplies, so a test
 * can order two commits without sleeping and a replay can be deterministic.
 */

import {
  PLAYER_KEY_PREFIX,
  readPersistCommit,
  toStartPayload,
  type PersistCommitEntry,
  type PersistPlayer,
  type PersistStartPayload,
  type ResolutionInputs,
  type WorldRosterEntry,
} from './persistence.js';
import type { SessionKind } from './session-kind.js';

/** One row as the store holds it: `value` still a JSON string, exactly as the
 *  platform stores it and exactly as `toStartPayload` expects to receive it. */
export interface StoredRow {
  key: string;
  value: string;
  schemaTag?: string;
  gameVersion?: string;
  writtenAt: number;
}

/** One order row as the store holds it, awaiting a resolution. */
export interface StoredOrder extends StoredRow {
  playerToken: string;
  submittedAt: number;
}

/** The store's whole contents, in the shape it is written to disk in. */
export interface PersistenceStoreState {
  rows: StoredRow[];
  orders: StoredOrder[];
  roster: WorldRosterEntry[];
}

/** Why a commit was refused, in the game author's terms. `refused` carries the
 *  message the platform would have shown; there is deliberately no "partly
 *  applied" outcome, because the platform's commit is all-or-nothing. */
export type CommitOutcome = { ok: true; written: number } | { ok: false; reason: string };

export interface CommitRequest {
  kind: SessionKind;
  /** The seats this session acts for, in `PersistPlayer` shape. A `resolution`
   *  session passes an empty array and is trusted with every sealed row -- it
   *  is the one session that acts for the whole world. */
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
  private orders: StoredOrder[];
  private roster: WorldRosterEntry[];

  constructor(state?: Partial<PersistenceStoreState>) {
    this.rows = [...(state?.rows ?? [])];
    this.orders = [...(state?.orders ?? [])];
    this.roster = [...(state?.roster ?? [])];
  }

  /** The whole store, for writing to disk. A copy: a caller that mutates what
   *  it saved must not be able to mutate what the store is still serving. */
  toState(): PersistenceStoreState {
    return {
      rows: this.rows.map((r) => ({ ...r })),
      orders: this.orders.map((o) => ({ ...o })),
      roster: this.roster.map((p) => ({ ...p })),
    };
  }

  /** Enrol a player in the world, so a resolver is handed a roster to emit
   *  views for. Idempotent by `playerId` -- re-running `boardsmith dev` with
   *  the same seats must not double the world's population. */
  enrol(player: WorldRosterEntry): void {
    const existing = this.roster.findIndex((p) => p.playerId === player.playerId);
    if (existing === -1) this.roster.push({ ...player });
    else this.roster[existing] = { ...player };
  }

  /**
   * The payload injected into a session's `start` gameOptions, or `null` for
   * "inject nothing" -- which is what a game that opted out gets, and is NOT
   * the same as an empty store.
   *
   * The seal is applied HERE, on the READ, because that is where the platform
   * applies it: a session is handed sealed rows only for the players it acts
   * for. A resolution session acts for the world and is handed all of them.
   */
  readForSession(
    kind: SessionKind,
    sessionKey: string,
    players: PersistPlayer[],
  ): PersistStartPayload | null {
    const tokens = actingTokens(players);
    const visible = this.rows.filter((row) => {
      const owner = sealedKeyOwner(row.key);
      if (owner === null) return true;
      if (kind === 'resolution') return true;
      return tokens.has(owner);
    });
    const parsed = toStartPayload({ entries: visible }, sessionKey, players);
    return parsed === null ? null : parsed.payload;
  }

  /**
   * ONE ROUND'S INPUTS, as a resolution session receives them.
   *
   * Orders are already one package per player: `submitOrders` replaces a
   * player's package wholesale rather than merging into it, which is the rule
   * the platform's paged drain has to reconstruct after the fact and this
   * store can simply hold.
   */
  resolutionInputs(): ResolutionInputs {
    return {
      orders: this.orders.map((o) => ({
        playerToken: o.playerToken,
        key: o.key,
        value: JSON.parse(o.value) as unknown,
        ...(o.schemaTag === undefined ? {} : { schemaTag: o.schemaTag }),
        ...(o.gameVersion === undefined ? {} : { gameVersion: o.gameVersion }),
        submittedAt: o.submittedAt,
      })),
      roster: this.roster.map((p) => ({ ...p })),
    };
  }

  /** Drop every order the round just consumed. The platform does this in the
   *  transaction that commits the round; a resolver that could re-read last
   *  round's orders would resolve the same round forever. */
  clearOrders(): void {
    this.orders = [];
  }

  /**
   * Apply a session's commit, or refuse it with the message the platform would
   * have given.
   *
   * The validation is NOT this method's: `readPersistCommit` is the platform's
   * own, imported unchanged. What is added here is the two rules a store
   * enforces rather than a wire does -- the seal, and what an order may be.
   */
  commit(request: CommitRequest): CommitOutcome {
    const parsed = readPersistCommit(request.spectatorView, request.persistPrivate);
    if (parsed.kind === 'absent') return { ok: true, written: 0 };
    if (parsed.kind === 'invalid') return { ok: false, reason: parsed.reason };

    const tokens = actingTokens(request.players);
    for (const entry of parsed.entries) {
      const refusal = this.refusalFor(entry, request.kind, tokens);
      if (refusal) return { ok: false, reason: refusal };
    }

    const at = request.now();
    if (request.kind === 'orderEntry') {
      this.replaceOrders(parsed.entries, tokens, request.gameVersion, at);
      return { ok: true, written: parsed.entries.length };
    }
    for (const entry of parsed.entries) this.applyRow(entry, request.gameVersion, at);
    return { ok: true, written: parsed.entries.length };
  }

  /** Why this entry may not be committed by this session, or `null`. */
  private refusalFor(
    entry: PersistCommitEntry,
    kind: SessionKind,
    tokens: Set<string>,
  ): string | null {
    if (kind === 'orderEntry' && entry.value === null) {
      return (
        `the order "${entry.key}" is a deletion (a null value), and an order package has ` +
        `nothing to delete: each commit replaces this player's whole package for the round. ` +
        `Write the package you want the resolver to see`
      );
    }
    const owner = sealedKeyOwner(entry.key);
    if (owner === null) return null;
    if (owner === '') {
      return (
        `the key "${entry.key}" starts with the reserved "${PLAYER_KEY_PREFIX}" prefix but names ` +
        `no player. A sealed row is "${PLAYER_KEY_PREFIX}<playerId>/<key>"`
      );
    }
    if (kind === 'resolution' || tokens.has(owner)) return null;
    return (
      `the key "${entry.key}" is sealed to player "${owner}", and this session does not act ` +
      `for them. A session may write a sealed row only for a player it is seated by; seat ` +
      `tokens arrive in the start payload's "players" array`
    );
  }

  /** An `orderEntry` commit replaces the acting player's whole package. */
  private replaceOrders(
    entries: PersistCommitEntry[],
    tokens: Set<string>,
    gameVersion: string,
    at: number,
  ): void {
    const [author] = [...tokens];
    if (author === undefined) return;
    this.orders = this.orders.filter((o) => o.playerToken !== author);
    for (const entry of entries) {
      if (entry.value === null) continue;
      this.orders.push({
        playerToken: author,
        key: entry.key,
        value: entry.value,
        ...(entry.schemaTag === undefined ? {} : { schemaTag: entry.schemaTag }),
        gameVersion,
        writtenAt: at,
        submittedAt: at,
      });
    }
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
