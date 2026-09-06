/**
 * THE BACKEND, AND THE CAPABILITY SET IT RESOLVES TO.
 *
 * BoardSmith is one engine with two BACKENDS. A **table** holds its whole
 * element tree resident, snapshots per action, and keeps history; a **world**
 * keeps only named partitions resident and checkpoints what a command dirtied.
 * Same element tree, same action system, same shell -- different storage and
 * checkpoint policy, the way two storage engines sit under one database.
 *
 * What each backend can therefore PROMISE is this module. Before it, the
 * backend choice was the presence or absence of a `world` block and what that
 * implied was written nowhere, so every consumer re-derived it: the platform
 * projected `hasTable`, `asyncPlaySupported` and `supportsCampaigns` with three
 * separate manifest parsers, and each surface read whichever flag it happened
 * to know about. `boardsmith build` now resolves ONE object and stamps it into
 * `dist/manifest.json`, and every reader -- the shell, the CLI, the publishing
 * platform -- reads that object instead of the backend's NAME.
 *
 * ## Derived, not restated
 *
 * A capability an author can declare inconsistently with their own game is a
 * capability that will drift, and every member below is therefore derived from
 * the BACKEND plus the COMPILED game definition. The only two an author still
 * writes are `asyncPlay` and `joinInProgress`, because they are judgments about
 * the game's rules that no code can answer -- and even those are refused on a
 * world, where the backend already answers them.
 *
 * `capabilityContradictions` is the other half of the same rule: where an
 * author must declare something, a declaration that contradicts the code is
 * refused by name rather than silently believed. It is what `boardsmith
 * validate` and `boardsmith build` both call, so the two cannot disagree about
 * what a legal bundle is.
 */

/** The backends one engine runs. A third would be added here and nowhere else. */
export const GAME_BACKENDS = ['table', 'world'] as const;

export type GameBackend = (typeof GAME_BACKENDS)[number];

/** Is `value` one of the declared backend names? */
export function isGameBackend(value: unknown): value is GameBackend {
  return typeof value === 'string' && (GAME_BACKENDS as readonly string[]).includes(value);
}

/**
 * WHAT A PUBLISHED BUNDLE CAN BE ASKED TO DO.
 *
 * Every member is a boolean, and every member is answered for BOTH backends --
 * a capability set with a hole in it sends its reader back to the backend name,
 * which is the thing it exists to replace. Seat COUNTS are not members: a
 * table's range is `playerCount` and a world's ceiling is `world.maxPlayers`,
 * each already carried once by the manifest, and a second copy here would be a
 * number free to drift from the one the runtime enforces.
 */
export interface GameCapabilities {
  /**
   * Can a TABLE of this game be started -- a fixed roster that starts, takes
   * turns, and ends?
   *
   * table: true. world: false -- a resident world has no start, no minimum to
   * reach before it can begin, and no end.
   */
  table: boolean;
  /**
   * Can a persistent WORLD of this game be created?
   *
   * table: false. world: true.
   */
  world: boolean;
  /**
   * May a move be taken back?
   *
   * table: true -- the per-action snapshot is exactly what undo rewinds to.
   * world: false -- a world checkpoints what a command dirtied, so there is no
   * whole-tree snapshot to go back to, and a neighbour has already acted on the
   * consequences.
   */
  undo: boolean;
  /**
   * May somebody watch without holding a seat?
   *
   * table: true -- the session builds a public observer view beside the seated
   * ones. world: false -- a world projects a view per SEAT, from the partitions
   * that seat's `view()` names, and there is no seatless place to stand.
   */
  spectators: boolean;
  /**
   * May a seat be played by a bot?
   *
   * table: true exactly when the compiled `gameDefinition.bot` exists -- derived
   * from the code, never from a flag beside it, because a manifest that claimed
   * a bot the bundle does not ship handed a live seat to nothing.
   * world: false -- a world has no turn to take and no terminal state to search
   * toward, which is what an MCTS bot needs.
   */
  bots: boolean;
  /**
   * May a session run one move at a time, over hours or days, with nobody else
   * connected?
   *
   * table: the author's declared `asyncPlay` -- only their rules can say whether
   * the game survives long gaps between moves.
   * world: always true, implied by the backend. A world runs continuously and
   * nobody is waiting on anybody's turn.
   */
  asyncPlay: boolean;
  /**
   * May a player join a session that is already underway?
   *
   * table: the author's declared `joinInProgress` -- only a game whose rules can
   * seat a latecomer should say yes.
   * world: always true, implied by the backend. A world is already running
   * before anybody opens a browser; joining one is the only way in.
   */
  joinInProgress: boolean;
  /**
   * Does state survive the end of a sitting?
   *
   * table: the compiled `gameDefinition.persistence` -- the game opts into the
   * host's cross-session key/value store, which is what lets a series of
   * sittings carry (a campaign).
   * world: always true, implied by the backend. A world's partitions ARE the
   * state that survives, and it survives because there is no sitting to end.
   *
   * A reader deciding whether to offer a CAMPAIGN wants
   * `table && crossSessionState`: a campaign is a series of sittings, and a
   * world has none. That is one line of composition, and it is why this member
   * is not called `supportsCampaigns`.
   */
  crossSessionState: boolean;
}

/**
 * What a resolved set is derived FROM: the declared backend, the compiled game
 * definition, and the handful of flags an author writes in `boardsmith.json`.
 *
 * Typed loosely on purpose. `boardsmith build` hands this raw JSON and a
 * freshly compiled definition, so every field arrives as whatever was written
 * there; `capabilityContradictions` is what turns a wrong type into a sentence
 * an author can act on, and `resolveCapabilities` never reads truthiness.
 */
export interface CapabilityInputs {
  backend: GameBackend;
  /** The COMPILED `gameDefinition` -- the code, which cannot be wished. */
  definition: {
    minPlayers?: unknown;
    maxPlayers?: unknown;
    bot?: unknown;
    persistence?: unknown;
    world?: { maxPlayers?: unknown } | null;
  };
  /** The capability flags `boardsmith.json` still carries. */
  declared: {
    asyncPlay?: unknown;
    joinInProgress?: unknown;
    /** Round policy. Table-only: a world has no rounds to put a deadline on. */
    roundDeadline?: unknown;
    idleAction?: unknown;
  };
}

/** `true` only for a literal `true`; anything else, including `'yes'`, is false. */
function declaredTrue(value: unknown): boolean {
  return value === true;
}

/**
 * The one resolution. Total over both backends and every input shape, so a
 * caller never has to ask which backend it is holding.
 */
export function resolveCapabilities(inputs: CapabilityInputs): GameCapabilities {
  const { backend, definition, declared } = inputs;
  const isWorld = backend === 'world';

  return {
    table: !isWorld,
    world: isWorld,
    undo: !isWorld,
    spectators: !isWorld,
    bots: !isWorld && definition.bot !== undefined && definition.bot !== null,
    asyncPlay: isWorld || declaredTrue(declared.asyncPlay),
    joinInProgress: isWorld || declaredTrue(declared.joinInProgress),
    crossSessionState: isWorld || declaredTrue(definition.persistence),
  };
}

/**
 * The flags an author writes, checked for TYPE before anything reads them. A
 * declaration that is neither `true` nor `false` is not a third answer; it is a
 * typo, and reading its truthiness would silently pick one.
 */
function malformedDeclarations(declared: CapabilityInputs['declared']): string[] {
  const issues: string[] = [];
  for (const key of ['asyncPlay', 'joinInProgress'] as const) {
    const value = declared[key];
    if (value !== undefined && typeof value !== 'boolean') {
      issues.push(
        `"${key}" must be true or false; got ${JSON.stringify(value)}. It is a statement about ` +
          'your rules, so there is no third answer.',
      );
    }
  }
  return issues;
}

/**
 * A world's SEATS: the block that declares them, the number inside it, and the
 * table roster that must not be there beside it.
 */
function worldSeatContradictions(definition: CapabilityInputs['definition']): string[] {
  const issues: string[] = [];
  const world = definition.world;

  if (world === undefined || world === null) {
    issues.push(
      'boardsmith.json declares "backend": "world", but this game\'s gameDefinition exports no ' +
        '`world` block, so there is nothing to run as a world. Export ' +
        '`world: { maxPlayers, actions, view }` from src/rules/index.ts, or declare ' +
        '"backend": "table".',
    );
  } else if (!Number.isInteger(world.maxPlayers) || (world.maxPlayers as number) < 1) {
    issues.push(
      'This game\'s gameDefinition.world declares no usable `world.maxPlayers`, so its world has ' +
        'no seats for anybody to play. Declare the largest roster the world holds, e.g. ' +
        '`world: { maxPlayers: 40, ... }`. It is the ONE seat count a world has -- the manifest\'s ' +
        'world.maxPlayers is derived from it, so the two can never disagree.',
    );
  }

  if (definition.minPlayers !== undefined || definition.maxPlayers !== undefined) {
    issues.push(
      'This game declares "backend": "world" and a table roster (gameDefinition.minPlayers/' +
        'maxPlayers). A world has no table: it does not start, so there is no minimum to reach, ' +
        'and its seats are `world.maxPlayers`. Delete minPlayers/maxPlayers from your ' +
        'gameDefinition.',
    );
  }

  return issues;
}

/**
 * THE FIELDS A WORLD MUST NOT WRITE, each with the reason it says nothing.
 *
 * A field that says nothing is a field the next reader will believe, which is
 * why every one of these is refused rather than ignored. Three of them the
 * backend already ANSWERS (a world is always asynchronous, always joinable in
 * progress, and its partitions are the state that survives); two are ROUND
 * policy, and a world has no rounds; one is a bot, and a world has no turn to
 * take it.
 */
function worldFieldContradictions(
  definition: CapabilityInputs['definition'],
  declared: CapabilityInputs['declared'],
): string[] {
  const alreadyAnswered =
    'and the world backend already answers it: a world is always asynchronous, always joinable ' +
    'in progress, and its partitions ARE the state that survives, because there is no sitting to ' +
    'end.';

  const refusals: Array<{ present: boolean; message: string }> = [
    ...(['asyncPlay', 'joinInProgress'] as const).map((key) => ({
      present: declared[key] !== undefined,
      message:
        `boardsmith.json declares "${key}" on a game whose backend is "world", ${alreadyAnswered} ` +
        `Delete "${key}".`,
    })),
    ...(['roundDeadline', 'idleAction'] as const).map((key) => ({
      present: declared[key] !== undefined,
      message:
        `boardsmith.json declares "${key}" on a game whose backend is "world". That is a ROUND ` +
        'policy, and a world has no rounds: it runs continuously, so nothing ever comes due for ' +
        `everybody at once. Delete "${key}".`,
    })),
    {
      present: definition.persistence !== undefined,
      message:
        'This game\'s gameDefinition declares `persistence` on a game whose backend is "world", ' +
        `${alreadyAnswered} Delete \`persistence\` from your gameDefinition.`,
    },
    {
      present: definition.bot !== undefined && definition.bot !== null,
      message:
        'This game\'s gameDefinition ships a `bot` on a game whose backend is "world". The world ' +
        'backend has no bots: a bot searches toward a terminal state on its turn, and a world ' +
        'has neither. Delete the `bot` block, or declare "backend": "table".',
    },
  ];

  return refusals.filter((refusal) => refusal.present).map((refusal) => refusal.message);
}

/** Everything a TABLE-backed bundle can get wrong. */
function tableContradictions(definition: CapabilityInputs['definition']): string[] {
  const issues: string[] = [];

  if (definition.world !== undefined && definition.world !== null) {
    issues.push(
      'boardsmith.json declares "backend": "table", but this game\'s gameDefinition exports a ' +
        '`world` block. A bundle runs on one backend; declare "backend": "world" to run the ' +
        'world, or delete the block.',
    );
  }

  if (!Number.isInteger(definition.minPlayers) || !Number.isInteger(definition.maxPlayers)) {
    issues.push(
      'Cannot determine player count: this game declares "backend": "table" and its gameDefinition ' +
        'is missing minPlayers/maxPlayers. Declare both as integers in your gameDefinition ' +
        '(src/rules/index.ts), e.g. minPlayers: 2, maxPlayers: 4.',
    );
  }

  return issues;
}

/**
 * EVERY WAY THIS BUNDLE'S DECLARATION CONTRADICTS ITSELF, as sentences for the
 * author. An empty array means the bundle is consistent.
 *
 * A declaration and the code it describes can disagree in exactly two
 * directions, and both are refused here rather than resolved by a precedence
 * rule: a bundle whose manifest says one backend and whose rules implement the
 * other is a bundle whose author has already made a mistake, and picking a
 * winner would ship it.
 */
export function capabilityContradictions(inputs: CapabilityInputs): string[] {
  const { backend, definition, declared } = inputs;
  return [
    ...malformedDeclarations(declared),
    ...(backend === 'world'
      ? [
          ...worldSeatContradictions(definition),
          ...worldFieldContradictions(definition, declared),
        ]
      : tableContradictions(definition)),
  ];
}
