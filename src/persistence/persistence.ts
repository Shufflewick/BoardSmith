/**
 * THE PERSISTENCE VALIDATION CORE: pure functions, and the ONE implementation
 * of them.
 *
 * ## Why this is in the engine
 *
 * ShufflewickPub's issue #41. Two things have to agree about what a durable
 * commit is: the platform's game Durable Object (`games/src/game-session.ts`),
 * and `boardsmith dev`'s `MultiplayerHost`, which is the Node-side stand-in for
 * that Durable Object. Before this module they could not: `boardsmith dev` had
 * no persistence store at all, so a resolver could not be run even once until
 * the game was published, and the obvious fix -- an emulator with its own
 * validators -- is a second implementation of a validator, which is a second
 * thing to drift. `PERSIST_MAX_COMMIT_BYTES` had already drifted once, from
 * 1MiB to 2MiB in a docblock but not in the literal, while every arithmetic
 * test agreed the platform's real capacity was fine.
 *
 * The dependency direction settles where it goes. ShufflewickPub VENDORS
 * BoardSmith; nothing in BoardSmith may import from the platform. So the only
 * place BOTH sides can reach is here, and `games/src/persistence.ts` is now a
 * re-export of this file rather than a copy of it. The emulator IS the
 * production validator, which is the whole point.
 *
 * Nothing here is engine-specific and nothing here touches a game. It holds no
 * credentials, imports no transport, and issues no request: it is the CONTRACT
 * between a game bundle and whatever is hosting it, on both sides of the wire.
 *
 * ## The channel, and why it needs no new capability
 *
 * The bundle gains nothing. It performs no I/O, imports nothing new, and holds
 * no host handle. It receives data at start and returns data at end -- both
 * things it already does:
 *
 *   READ  (session start): the store is injected into the `start` op's
 *          gameOptions, under the `persist` key, alongside `seed`,
 *          `playerOptions` and the rest. The bundle already receives
 *          gameOptions; this is one more field in it.
 *
 *   WRITE (game over): the host reads a reserved GAME-ROOT ATTRIBUTE named
 *          `persist` out of the final spectator view -- the same
 *          `lastSpectatorView` the Durable Object already caches. A BoardSmith
 *          game's own Game-class attributes are serialized into
 *          `spectatorView.state.view.attributes` by the engine's existing
 *          `toJSONForPlayer` path, so a game participates by setting one
 *          attribute and nothing else. There is no new executor field, no new
 *          op, and no engine change.
 *
 * **The `persist` channel is PUBLIC, and that is by construction.** The
 * spectator view is the position-0, no-hidden-information view, broadcast to
 * spectators and sent to reconnecting clients. Anything a game puts in
 * `persist` is therefore visible to everyone watching, and that is correct for
 * the things it exists for (leaderboards, death logs, records). It must never
 * be used for secrets.
 *
 * ## The PRIVATE channel
 *
 * Campaigns must store sealed scenarios and unrevealed content, and a
 * fog-of-war world must emit per-player secrets; neither can use a channel
 * that publishes what it writes. So there is a SECOND reserved game-root
 * attribute, `persistPrivate`, which never appears on any outgoing view. It is
 * lifted off the spectator view and off every player view before a result
 * leaves the executor, and re-emitted as a top-level `persistPrivate` field --
 * see `private-channel.ts` for the strip, and for why the PRODUCTION strip
 * lives in the executor's runner rather than here.
 *
 * What the private channel is NOT: it is not a READ scope of any kind. Private
 * means "does not leave the session over a broadcast path", which is what makes
 * sealed content and fog of war possible. Which rows a session can see is
 * decided by the host, not by this file.
 *
 * ## Whole document vs keyed entries -- decided: KEYED ENTRIES
 *
 * A whole-document store was rejected for two reasons. First, growth: a game
 * would have to re-send its ENTIRE history at every game over, so the cost of
 * a write scales with the store rather than with what the session contributed.
 * Second, and fatally, concurrency: two tables of the same game finishing
 * minutes apart each read the document at THEIR start and write it back at
 * their end, so the later write silently erases the earlier one's result --
 * a leaderboard that loses entries at random under exactly the load that
 * proves the game is popular. Keyed entries make each session's contribution
 * additive and independent; the only clobber possible is per-key, and it is
 * one the game asked for by naming that key.
 */

/** Reserved gameOptions key carrying the store INTO a session, and reserved
 *  Game-root attribute carrying a commit OUT of one. Deliberately the same
 *  word in both directions: it is one channel. */
// @platform-limit PERSIST_KEY
export const PERSIST_KEY = "persist";

/**
 * The PRIVATE half of the same channel (#3): the reserved Game-root attribute
 * a game sets to commit something it does NOT want broadcast, and -- the same
 * word again -- the field the executor re-emits it under once it has stripped
 * it from every outgoing view.
 *
 * Declared here AND in `executor/src/persist-private.ts` because `games/` and
 * `executor/` are separate deployable units that cannot import from each
 * other, the same constraint `PERSIST_MAX_COMMIT_BYTES` records below. The
 * agreement is proved from both ends: `executor/test/persist-private.test.ts`
 * asserts a real bundle's value arrives under this name, and this unit's
 * `games/test/persistence.test.ts` reads it under the same one.
 */
// @platform-limit PERSIST_PRIVATE_KEY
export const PERSIST_PRIVATE_KEY = "persistPrivate";

/**
 * The key prefix that makes a campaign-store entry SEALED to one player
 * (epic #24): `player:<userId>/<key>`. Convex owns the rule's substance --
 * which sessions such a row reaches, and which commits may write one
 * (`convex/persistenceQuotas.ts:PLAYER_KEY_PREFIX` is the authoritative
 * declaration). This copy exists for the single clause only this worker can
 * enforce: a sealed key arriving on the PUBLIC `persist` attribute is a
 * contradiction -- the spectator view broadcasts what it carries -- and the
 * channel an entry rode is unknowable once the two are merged for the wire.
 *
 * Declared in both units because `games/` and `convex/` cannot import from
 * each other; `scripts/platform-limits.test.mjs` holds the two spellings
 * equal mechanically.
 */
// @platform-limit PLAYER_KEY_PREFIX
export const PLAYER_KEY_PREFIX = "player:";

/**
 * Wire ceiling on one serialized commit, measured in the Durable Object
 * BEFORE the request leaves the worker -- the same discipline
 * `END_STATE_BYTE_CAP` applies to `plays.endState`, and for the same reason:
 * an oversized payload should never be put on the wire at all.
 *
 * This is the ONLY persistence quota duplicated outside Convex. The real
 * quotas -- per entry, per game, per commit, and the key rules -- live solely
 * in `convex/persistenceQuotas.ts` and are enforced authoritatively by
 * `convex/gamePersistence.ts:stageCommit`. `games/` and `convex/` are
 * separate deployable units and cannot import from each other, so every
 * duplicated number is a number that can drift; this one earns its keep by
 * bounding the request itself, which Convex cannot do from the far end.
 *
 RE-DERIVED 2026-08-16. 64KB was sized against the game-over commit it was
 * written for, and it silently governed WORLD RESOLUTIONS too -- whose durable
 * delta is one record per player, because the campaign store is a world's only
 * home between rounds. At the measured ~1.2KB compact record, 64KB carried
 * about fifty players' worth of a world that advertised five hundred, and the
 * refusal is deterministic, so the round never succeeded.
 *
 * 2MiB is `convex/persistenceQuotas.ts:PERSIST_MAX_TOTAL_BYTES_PER_CAMPAIGN`:
 * one commit may legally rewrite the whole store, because a world that changed
 * every settlement this round genuinely did. Anything past the store's own
 * total is malformed or runaway rather than merely large.
 *
 * RE-DERIVED AGAIN 2026-08-16, and this is the correction that mattered. The
 * docblock asserted the identity with Convex's campaign total while the
 * literal stayed at 1MiB after that total moved to 2MiB -- and this cap is
 * the FIRST gate a resolution's commit passes, so it decided the platform's
 * real capacity while every arithmetic test agreed 500 players fit.
 *
 * It measures `JSON.stringify(entries)`, and each entry's `value` is ALREADY a
 * JSON string, so every quote inside a persisted record is escaped a second
 * time on the way out: the calibrated 1,227-byte row rides the wire at ~1,477.
 * No calibration constant models that factor, which is why flat row arithmetic
 * could not see it. A legal whole-store rewrite --
 * `WORLD_RESOLUTION_MAX_ENTRIES_PER_COMMIT` (1,064) rows of the repo's own
 * pinned record -- measures 1,607,659 bytes here, 53% over the old 1MiB.
 *
 * `scripts/world-capacity.test.mjs` now builds that commit from
 * `scripts/world-fixtures.mjs` and measures it THE WAY `readPersistCommit`
 * does, so a future drift fails at the commit that introduces it.
 *
 * Still far under Convex's 16MiB per-mutation argument ceiling, which is the
 * wall behind this one.
 */
export const PERSIST_MAX_COMMIT_BYTES = 2 * 1024 * 1024;

/**
 * One entry as it goes to Convex: `value` already serialized, or `null` to
 * delete the key.
 *
 * `schemaTag` is the GAME's own metadata. The platform stores it, hands it
 * back verbatim on the way in, and COMPARES IT TO NOTHING -- see
 * `PersistedEntry` below and this file's `## Schema drift` section.
 *
 * A `null` value is a deletion of a persisted key -- in every scope and for
 * every session kind. There is no commit shape that refuses one: the round
 * era's order packages, the one case that did, went with the round
 * architecture (ShufflewickPub #47).
 */
export interface PersistCommitEntry {
  key: string;
  value: string | null;
  schemaTag?: string;
}

/**
 * One entry as the bundle receives it: `value` parsed back into plain JSON.
 *
 * ## Schema drift is the GAME's read-time concern -- `schemaTag` is a
 * ## DOCUMENTED NON-GATE
 *
 * The platform round-trips `schemaTag` byte-for-byte and never compares it to
 * anything: there is no migration hook, no compatibility check and no version
 * gate on it, anywhere. That is deliberate. The platform has no authoritative
 * notion of a game's "current" schema tag without parsing game semantics out
 * of a manifest -- exactly what value opacity forbids -- and it could not
 * migrate an opaque string if it wanted to. A platform-side equality gate
 * would refuse every pre-bump entry on the first tag change and present to
 * this bundle as an EMPTY STORE, which is precisely the wipe-vs-miss
 * confusion `toStartPayload`'s null contract exists to prevent.
 *
 * A game therefore migrates at read time, with two facts: the `schemaTag` it
 * wrote itself, and `gameVersion` -- the version of the game that wrote the
 * entry, stamped by the platform from the session and never by the game. Both
 * are per-entry, so old and new records legitimately coexist during a
 * game-authored migration.
 *
 * What bounds drift over a months-long campaign is the campaign's VERSION PIN
 * (`campaigns.gameVersion`), which every session of the campaign runs against
 * and which only a deliberate publisher re-pin moves -- not a tag the platform
 * checks.
 */
export interface PersistedEntry {
  key: string;
  value: unknown;
  schemaTag?: string;
  gameVersion?: string;
  writtenAt: number;
}

/**
 * What `gameOptions.persist` carries into a session.
 *
 * `sessionKey` is the session's own id, and it is here for one specific
 * reason: without it a game has no collision-free way to name an APPEND. Every
 * write is a keyed upsert, so two sessions that both want to add a row have to
 * agree on distinct keys without being able to talk to each other. The session
 * id is the one value that is unique per play and known to the platform, so
 * handing it over turns "append a row" into a correct operation
 * (`key: \`death:${sessionKey}\``) instead of a race. It is not a secret: the
 * player already has it in their URL.
 *
 * There is deliberately nothing here beyond the store, the session's own id
 * and its seats. A resident world's SHARED state is the world object's own
 * partitions and never rides this payload; what a session is handed is the
 * store it may see, which is the shared rows plus its own players' sealed
 * ones.
 */
export interface PersistStartPayload {
  entries: PersistedEntry[];
  sessionKey: string;
  players: PersistPlayer[];
}

/**
 * ONE SEAT, AND THE TOKEN ITS SEALED ROWS ARE NAMED AFTER.
 *
 * WHY THIS IS HERE AT ALL. A sealed row is `player:<userId>/<key>`, readable
 * only by a session that player is seated at. Without this array a mission
 * could not spell one: the store is the only other thing it is handed, so the
 * only way to name a sealed key would be to already hold a sealed key. A
 * campaign's FIRST mission holds none, so the capability
 * `docs/CAMPAIGNS.md` leads with was unreachable in the mode it was written
 * for. Issue #40's campaign example is what surfaced that -- prose could not.
 *
 * `playerId` is the same opaque token every other per-player handle carries:
 * one vocabulary across every mode, so a bundle that learns a token in one
 * place may use it in another.
 *
 * IT IS NULL FOR A SEAT WITH NO ACCOUNT BEHIND IT -- a bot, or a guest. Null
 * rather than an absent entry, so a game indexing seats gets an honest "this
 * seat cannot own a sealed row" instead of the next player's token. A guest is
 * null deliberately and not as an oversight: their rows would be sealed to an
 * identity that ceases to exist, so nobody could ever read or delete them.
 */
export interface PersistPlayer {
  seat: number;
  playerId: string | null;
}

/**
 * The outcome of looking for a commit in the final spectator view.
 *
 * `absent` and `invalid` are separate on purpose. A game that opts into
 * persistence but ends a particular play with nothing to record is normal and
 * must be silent. A game that emits a MALFORMED `persist` attribute has a bug
 * its publisher needs told about, and quietly treating it as "nothing to
 * write" is how a hall of fame stays empty for a month while everyone assumes
 * it works.
 */
export type PersistCommitResult =
  | { kind: "absent" }
  | { kind: "ok"; entries: PersistCommitEntry[] }
  | { kind: "invalid"; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Dig the reserved attribute out of the engine's spectator view. Every step
 * is a shape check rather than an assertion: `lastSpectatorView` is whatever
 * the executor last returned, and a game that has not started, has errored, or
 * simply has no such attribute must land on `absent`, not throw.
 */
function readPersistAttribute(spectatorView: unknown): unknown {
  if (!isPlainObject(spectatorView)) return undefined;
  const state = spectatorView.state;
  if (!isPlainObject(state)) return undefined;
  const view = state.view;
  if (!isPlainObject(view)) return undefined;
  const attributes = view.attributes;
  if (!isPlainObject(attributes)) return undefined;
  return attributes[PERSIST_KEY];
}

/**
 * Read and serialize the commit a finished game is asking the platform to
 * store, across BOTH channels.
 *
 * Deliberately ONE function taking BOTH sources rather than two callable
 * halves: a caller that read the public channel and forgot the private one
 * would drop a campaign's sealed state silently, and a caller that sent them
 * as two commits would give up the transactional all-or-nothing that
 * the stage/settle pair provides. There is one store and one commit; two
 * ways in.
 *
 * `privateCommit` is the executor's top-level `persistPrivate` field, already
 * lifted off every view by `executor/src/persist-private.ts` -- so it arrives
 * as the ATTRIBUTE VALUE, not as a view to dig through, and this file never
 * has to know how the executor found it.
 *
 * Serialization happens HERE, not in the game and not in Convex. `value` is
 * stored as a JSON STRING for the identical reason `plays.endState` is one:
 * Convex reserves `$`-prefixed field names inside documents and every
 * BoardSmith element carries a `$type` discriminator, so a structurally-sent
 * value fails argument validation for exactly the games most likely to put a
 * game element in a record. Doing it here means the bundle deals in plain
 * JSON in both directions and never learns that the constraint exists.
 */
export function readPersistCommit(
  spectatorView: unknown,
  privateCommit: unknown,
): PersistCommitResult {
  const publicSide = parseCommit(readPersistAttribute(spectatorView), PERSIST_KEY);
  if (publicSide.kind === "invalid") return publicSide;
  const privateSide = parseCommit(privateCommit, PERSIST_PRIVATE_KEY);
  if (privateSide.kind === "invalid") return privateSide;

  const publicEntries = publicSide.kind === "ok" ? publicSide.entries : [];
  const privateEntries = privateSide.kind === "ok" ? privateSide.entries : [];
  if (publicEntries.length === 0 && privateEntries.length === 0) return { kind: "absent" };

  const collision = crossChannelCollision(publicEntries, privateEntries);
  if (collision) {
    return {
      kind: "invalid",
      reason:
        `the key "${collision}" is written by BOTH the public "${PERSIST_KEY}" attribute and ` +
        `the private "${PERSIST_PRIVATE_KEY}" one, so which value survives would depend on ` +
        `commit order. Nothing was written. Give the two records distinct keys, or write the ` +
        `key on one channel only`,
    };
  }

  const entries = [...publicEntries, ...privateEntries];
  const bytes = new TextEncoder().encode(JSON.stringify(entries)).length;
  if (bytes > PERSIST_MAX_COMMIT_BYTES) {
    return {
      kind: "invalid",
      reason:
        `the serialized commit is ${bytes} bytes across both the "${PERSIST_KEY}" and ` +
        `"${PERSIST_PRIVATE_KEY}" channels, over this worker's ` +
        `${PERSIST_MAX_COMMIT_BYTES}-byte wire ceiling, so it was not sent. Write fewer or ` +
        `smaller records at game over`,
    };
  }
  return { kind: "ok", entries };
}

/**
 * Validate and serialize one channel's raw attribute value. Shape errors name
 * the attribute they came from (`attributeName`), because "the game's persist
 * attribute is malformed" is not actionable when a game writes on both.
 *
 * The byte ceiling is NOT applied here: it bounds the REQUEST, and the request
 * carries both channels.
 */
function parseCommit(raw: unknown, attributeName: string): PersistCommitResult {
  if (raw === undefined || raw === null) return { kind: "absent" };
  if (!isPlainObject(raw)) {
    return {
      kind: "invalid",
      reason: `the game's "${attributeName}" attribute must be an object of the form { entries: [...] }`,
    };
  }
  if (!Array.isArray(raw.entries)) {
    return {
      kind: "invalid",
      reason: `the game's "${attributeName}.entries" must be an array of { key, value } records`,
    };
  }
  if (raw.entries.length === 0) return { kind: "absent" };

  const entries: PersistCommitEntry[] = [];
  for (let i = 0; i < raw.entries.length; i++) {
    const converted = toCommitEntry(raw.entries[i], i, attributeName);
    if (typeof converted === "string") return { kind: "invalid", reason: converted };
    const sealed = sealedKeyOnPublicChannel(converted.key, i, attributeName);
    if (sealed) return { kind: "invalid", reason: sealed };
    entries.push(converted);
  }
  return { kind: "ok", entries };
}

/**
 * Why this entry may not be written on the channel it arrived on, or `null`.
 *
 * A SEALED key on the PUBLIC channel is always an authoring mistake: the
 * `persist` attribute rides the spectator view to everyone watching, while the
 * `player:` prefix declares the row one player's secret. Only this side of the
 * wire can refuse it -- Convex receives the channels merged (see
 * `PLAYER_KEY_PREFIX`).
 */
function sealedKeyOnPublicChannel(
  key: string,
  index: number,
  attributeName: string,
): string | null {
  if (attributeName !== PERSIST_KEY) return null;
  if (!key.startsWith(PLAYER_KEY_PREFIX)) return null;
  return (
    `${attributeName}.entries[${index}] writes the per-player key "${key}" on the ` +
    `public "${PERSIST_KEY}" attribute, which is broadcast to every spectator. Sealed ` +
    `"${PLAYER_KEY_PREFIX}" rows must be written on the private "${PERSIST_PRIVATE_KEY}" ` +
    `attribute instead`
  );
}

/**
 * The first key claimed by both channels, or `null`.
 *
 * Checked HERE rather than left to Convex's duplicate-key rejection because
 * the message matters: Convex would say "a single commit names the key twice",
 * which sends a publisher looking for one bug in one attribute. Duplicates
 * WITHIN one channel are still Convex's to reject -- this is the failure the
 * platform introduced by adding a second channel, so it is the platform's to
 * explain.
 */
function crossChannelCollision(
  publicEntries: PersistCommitEntry[],
  privateEntries: PersistCommitEntry[],
): string | null {
  if (privateEntries.length === 0) return null;
  const publicKeys = new Set(publicEntries.map((entry) => entry.key));
  for (const entry of privateEntries) {
    if (publicKeys.has(entry.key)) return entry.key;
  }
  return null;
}

/** The reason `raw` is not a well-shaped entry, or `null` if it is one. */
function commitEntryShapeError(raw: unknown, at: string): string | null {
  if (!isPlainObject(raw)) return `${at} must be an object with a "key" and a "value"`;
  if (typeof raw.key !== "string") return `${at}.key must be a string`;
  if (raw.schemaTag !== undefined && typeof raw.schemaTag !== "string") {
    return `${at}.schemaTag must be a string when present`;
  }
  if (raw.value === undefined) {
    return `${at}.value is missing. Use null to delete the key, or supply a JSON value to store`;
  }
  return null;
}

function buildCommitEntry(
  key: string,
  value: string | null,
  schemaTag: unknown,
): PersistCommitEntry {
  return { key, value, ...(schemaTag ? { schemaTag: schemaTag as string } : {}) };
}

/** One entry, or a message saying why it is not one. */
function toCommitEntry(
  raw: unknown,
  index: number,
  attributeName: string,
): PersistCommitEntry | string {
  const at = `${attributeName}.entries[${index}]`;
  const shapeError = commitEntryShapeError(raw, at);
  if (shapeError) return shapeError;

  const entry = raw as { key: string; value: unknown; schemaTag?: unknown };
  // A literal `null` value is the DELETE instruction, and it is deliberately
  // distinct from the string "null" that `JSON.stringify(null)` produces --
  // otherwise a game could not store a legitimately-null record at all.
  if (entry.value === null) return buildCommitEntry(entry.key, null, entry.schemaTag);

  const serialized = serialize(entry.value);
  if (serialized === null) {
    return `${at}.value is not JSON-serializable (a cycle, a function, or a BigInt)`;
  }
  return buildCommitEntry(entry.key, serialized, entry.schemaTag);
}

/** `JSON.stringify`, or `null` if the value cannot be serialized at all.
 *  `undefined` is impossible here -- the caller has already rejected it. */
function serialize(value: unknown): string | null {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : text;
  } catch {
    return null;
  }
}

/**
 * Turn `gamePersistence:readForSession`'s answer into the payload injected
 * into gameOptions, parsing each stored value back into plain JSON.
 *
 * `null` in, `null` out: Convex answering `null` means "no such session",
 * which is NOT the same as a game with an empty store, and collapsing the two
 * would make a transient miss look to the bundle exactly like its hall of fame
 * having been wiped. The caller decides what to do with an absent answer; this
 * function refuses to decide for it. An entry whose stored value will not
 * parse is dropped individually, with the caller told which one -- one corrupt
 * row must not cost a game its entire history.
 *
 * `players` is the CALLER'S, not Convex's, and that is deliberate: the seat
 * roster is the Durable Object's own authoritative state, and re-deriving it
 * from a stored answer would make the tokens a game seals rows to depend on a
 * read that is allowed to fail.
 */
export function toStartPayload(
  value: unknown,
  sessionKey: string,
  players: PersistPlayer[],
): { payload: PersistStartPayload; dropped: string[] } | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value) || !Array.isArray(value.entries)) return null;

  const entries: PersistedEntry[] = [];
  const dropped: string[] = [];
  for (const row of value.entries) {
    const entry = toPersistedEntry(row);
    if (entry) {
      entries.push(entry);
      continue;
    }
    if (isPlainObject(row) && typeof row.key === "string") dropped.push(row.key);
  }

  return { payload: { entries, sessionKey, players }, dropped };
}

/** The two OPTIONAL shape fields a stored entry carries, in
 *  the one form the projection needs. Written once rather than spelled out
 *  at each field site. */
function shapeTags(row: Record<string, unknown>): {
  schemaTag?: string;
  gameVersion?: string;
} {
  return {
    ...(typeof row.schemaTag === "string" ? { schemaTag: row.schemaTag } : {}),
    ...(typeof row.gameVersion === "string" ? { gameVersion: row.gameVersion } : {}),
  };
}

/** `JSON.parse` as a result rather than a throw, so a caller's shape checks
 *  and its parse failure read as one flat sequence of guards. A stored value
 *  that will not parse is a corrupt row, never a reason to throw. */
function parseStored(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function toPersistedEntry(row: unknown): PersistedEntry | null {
  if (!isPlainObject(row)) return null;
  if (typeof row.key !== "string" || typeof row.value !== "string") return null;
  if (typeof row.writtenAt !== "number") return null;
  const parsed = parseStored(row.value);
  if (parsed.ok === false) return null;
  return {
    key: row.key,
    value: parsed.value,
    ...shapeTags(row),
    writtenAt: row.writtenAt,
  };
}
