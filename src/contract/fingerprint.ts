/**
 * Engine-contract fingerprinting.
 *
 * The platform (ShufflewickPub) does not bundle BoardSmith with each game.
 * A published `rules.js` externalizes `boardsmith`, and the executor supplies
 * the engine at runtime from its own vendored copy. So a game's behaviour is
 * decided by the ENGINE THE PLATFORM VENDORED, not the one the game was built
 * against. That makes "has the engine changed in a way the platform must care
 * about?" a question someone has to answer on every BoardSmith change — and
 * answering it from memory is exactly how the `Deck` visibility default
 * silently stopped reporting draw-pile counts for months.
 *
 * This module answers it mechanically instead, with two fingerprints:
 *
 * - `surfaceHash` — the runtime export names of every entrypoint the platform
 *   can reach. Catches added, removed, or renamed API.
 * - `payloadHash` — a canonical per-player view rendered from a fixed fixture
 *   game. Catches SEMANTIC changes that leave the API identical but alter what
 *   the platform ships to clients (the `Deck` case: same exports, different
 *   payload).
 *
 * Neither is a guess about intent, and neither can be forgotten:
 * `engine-contract.test.ts` recomputes both on every test run and fails when
 * they drift from the committed contract.
 *
 * KNOWN LIMITS, stated so nobody over-trusts this:
 *
 * - `surfaceHash` sees runtime values only. `verbatimModuleSyntax` erases
 *   type-only exports, so a change to an exported TYPE (a new optional field on
 *   `PlayerStateView`, say) moves neither hash unless it also changes a real
 *   payload.
 * - The package `exports` map is not covered. Remapping `./session` in
 *   package.json is platform-visible and moves neither hash, because this
 *   module imports the entrypoint files directly.
 * - `payloadHash` covers what the fixture exercises. It is broad (board
 *   serialization, visibility, flow state, available actions, both sequential
 *   and simultaneous turns) but it is not the whole engine. Engine behaviour
 *   the fixture never reaches is not fingerprinted.
 *
 * When you make a platform-visible change none of the fingerprints can see,
 * extend the fixture so it can, then record the revision.
 */

import { createHash } from 'node:crypto';

/**
 * The entrypoints the platform can reach, and why each one counts.
 *
 * Anything NOT in this list is invisible to the contract by design — the UI
 * package, the CLI, and the trainer ship inside a game's own bundle or run on
 * a developer's machine, so they cannot cause platform/game engine skew.
 */
export const PLATFORM_ENTRYPOINTS = [
  // Supplied to game rules at runtime by the executor's `sandboxedRequire`.
  { specifier: 'boardsmith', module: () => import('../engine/index.js') },
  { specifier: 'boardsmith/session', module: () => import('../session/index.js') },
  // Imported directly by the games worker to host a session.
  {
    specifier: 'boardsmith/session-host',
    module: () => import('../session/snapshot-session-host.js'),
  },
] as const;

/**
 * Deterministically serialize a value with object keys sorted.
 *
 * Key ORDER is not part of the contract — a payload that gained no keys and
 * lost none has not changed for any consumer. Sorting keeps innocuous
 * reordering from raising a false alarm, which matters because a fingerprint
 * that cries wolf gets bumped without being read.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortDeep(source[key]);
  }
  return sorted;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Describe one export for the surface hash.
 *
 * Top-level names alone are not the API games call. Rules call METHODS —
 * `deck.shuffle()`, `game.followUp()`, the whole element and action surface —
 * so renaming or removing a method while leaving the class exported would keep
 * a name-only hash still, let the change ship unrecorded, and let the upload
 * gate compare two equal revisions on a bundle that calls a method the vendored
 * engine no longer has. That is the exact failure the gate exists to prevent,
 * so prototype members are part of the surface.
 *
 * This is deliberately conservative: it includes members that are private by
 * convention, so an internal method rename also forces a revision bump. False
 * positives cost one `contract --update`; false negatives cost a production
 * bug nobody can trace.
 */
function describeExport(name: string, value: unknown): string {
  if (typeof value !== 'function' || value.prototype === undefined) return name;

  const members = Object.getOwnPropertyNames(value.prototype)
    .filter((member) => member !== 'constructor')
    .sort();

  return members.length > 0 ? `${name}{${members.join(',')}}` : name;
}

/**
 * Hash the runtime export surface of every platform-reachable entrypoint:
 * export names plus, for classes and functions, their prototype members.
 *
 * Shapes only, never implementations — a changed function body is a semantic
 * change, which is `payloadHash`'s job. Conflating the two would make this hash
 * move on every internal edit and stop meaning "the API changed".
 */
export async function computeSurfaceHash(): Promise<string> {
  const lines: string[] = [];

  for (const entry of PLATFORM_ENTRYPOINTS) {
    const module = (await entry.module()) as Record<string, unknown>;
    const described = Object.keys(module)
      .sort()
      .map((name) => describeExport(name, module[name]));
    lines.push(`${entry.specifier}: ${described.join(',')}`);
  }

  return sha256(lines.join('\n'));
}

/**
 * Fail loudly if the fixture stopped exercising the flow layer.
 *
 * This exists because the first version of this fixture silently did not. It
 * built a board, never started a flow, and produced views whose `flowState` was
 * `undefined` — so `payloadHash` covered visibility serialization only, while
 * claiming to cover the engine. Worse, the hash still MOVED whenever the board
 * changed, so it looked alive. An adversarial review caught it; a green test
 * suite did not.
 *
 * A fingerprint that silently narrows is more dangerous than no fingerprint,
 * because it converts "unverified" into "verified". So the fixture asserts what
 * it is supposed to be covering rather than trusting that it still does.
 */
function assertCoversFlowLayer(views: unknown[]): void {
  const missing: string[] = [];

  if (views.length === 0) missing.push('no player views at all');

  const states = views.map(
    (view) => (view as Record<string, unknown>).flowState as Record<string, unknown> | undefined,
  );

  if (states.some((state) => state === undefined)) missing.push('flowState');

  // The fixture opens on a SIMULTANEOUS step, where every seat is on the clock
  // at once. `createPlayerView` has to resolve that from the engine's
  // `awaitingPlayers` rather than `currentPlayer`, and when it failed to, this
  // platform shipped a game whose action bar was blank. So the fixture is only
  // doing its job if BOTH seats come back active with real actions offered.
  const active = states.filter(
    (state) => state?.isMyTurn === true && (state.availableActions as string[] | undefined)?.length,
  );
  if (active.length !== views.length) {
    missing.push(
      `simultaneous-turn resolution (${active.length}/${views.length} seats got isMyTurn + availableActions)`,
    );
  }

  if (missing.length === 0) return;

  throw new Error(
    `The engine-contract fixture is no longer exercising the flow layer (missing: ${missing.join(', ')}).\n`
    + 'payloadHash would still change and still look healthy while covering board '
    + 'serialization only — silently narrowing what the contract actually verifies.\n'
    + 'Fix the fixture in src/contract/fingerprint.ts rather than removing this check.',
  );
}

/**
 * Fail loudly if the fingerprinted flow position stopped carrying element
 * bindings.
 *
 * `payloadHash` covers what the fixture exercises, and a per-player view does
 * NOT include `position` at all (`createPlayerView` publishes only
 * `awaitingInput`/`isMyTurn`/`availableActions`), so before this the whole
 * serialize/relink layer BSMITH-04 is about was invisible to the contract: a
 * re-vendor that reverted `frameData` to a raw spread would move neither hash.
 *
 * Hashing the position closes that only while the position actually HOLDS a
 * live element on both sides. If a future flow edit stops producing one, the
 * hash keeps changing for other reasons and keeps looking healthy while
 * covering nothing — the same silent narrowing `assertCoversFlowLayer` exists
 * to prevent. So the fixture asserts what it claims to cover.
 *
 * Two failure shapes, both reported as themselves rather than as a hash move:
 * a position that no longer CLONES (a live element leaked through), and a
 * position that no longer CARRIES a marker (the fixture stopped covering the
 * path). Note that neither is fixable with `boardsmith contract --update` —
 * `--update` recomputes through this same function, so a regression cannot be
 * blessed away by recording it.
 *
 * What this catches: `getPosition` dropping the general serializer for
 * `variables` or for `frameData`. What it does NOT catch: a change confined to
 * a frame-data field this fixture never writes, or to `relinkFlowVariables`'s
 * resolution rules — both hashes see the SERIALIZED form only, because nothing
 * here restores. The restore half is covered by
 * `src/engine/flow/flow-state-clone.test.ts`, and 68-10 adds a
 * platform-side check against the VENDORED engine.
 */
function assertCoversElementBindings(position: unknown): void {
  assertPositionIsCloneable(position);
  assertPositionCarriesMarkers(position);
}

/**
 * The property itself: a serialized flow position crosses postMessage and the
 * executor RPC, so a live element left in one throws `DataCloneError` and kills
 * the broadcast for every seat.
 *
 * Checked here, and not left to the hash, because `canonicalize` walks the
 * value: a live element's parent back-references send `sortDeep` into infinite
 * recursion, and "RangeError: Maximum call stack size exceeded" names nothing a
 * reader could act on. This is the same regression, reported as itself.
 */
function assertPositionIsCloneable(position: unknown): void {
  try {
    structuredClone(position);
  } catch (cause) {
    throw new Error(
      "The engine-contract fixture's flow position is no longer structured-cloneable.\n"
      + 'A live GameElement/Player is reaching the serialized position, which in production '
      + 'throws DataCloneError out of the broadcast (BSMITH-04). `getPosition` must run BOTH '
      + '`variables` and every frame\'s `data` through `serializeFlowVariables`.\n'
      + 'See src/engine/flow/engine.ts getPosition, and '
      + 'src/engine/flow/flow-state-clone.test.ts for the general test.',
      { cause },
    );
  }
}

function assertPositionCarriesMarkers(position: unknown): void {
  const { variables, frameData } = (position ?? {}) as {
    variables?: Record<string, unknown>;
    frameData?: Record<string, Record<string, unknown>>;
  };

  const missing: string[] = [];
  if (!hasElementMarker(variables)) missing.push('position.variables');
  if (!hasElementMarker(frameData)) missing.push('position.frameData');
  if (missing.length === 0) return;

  throw new Error(
    `The engine-contract fixture is no longer binding a live element into ${missing.join(' or ')}.\n`
    + 'payloadHash would still change and still look healthy while no longer covering the '
    + 'flow-state serialize path (BSMITH-04) at all.\n'
    + 'Fix the fixture in src/contract/fingerprint.ts rather than removing this check.',
  );
}

/** True when `value` contains a serialized element marker anywhere inside. */
function hasElementMarker(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.__flowElementId === 'number') return true;
  return Object.values(record).some(hasElementMarker);
}

/**
 * Render the fixture game's per-player views and hash them.
 *
 * The fixture is defined here rather than borrowed from an example game on
 * purpose: an example game changes when its designer changes it, which would
 * move this hash for reasons that have nothing to do with the engine.
 *
 * It deliberately covers the visibility modes the platform actually depends on
 * — a default `Deck` (the §3b regression's exact shape), an owner-visible
 * hand, an explicitly count-only pile, and a fully hidden pile — so a change to
 * any default lands in the hash instead of in a bug report.
 */
export async function computePayloadHash(): Promise<string> {
  const engine = await import('../engine/index.js');
  const { GameRunner } = await import('../runtime/index.js');
  const {
    Game, Space, Piece, Player, Deck, Hand, Action,
    defineFlow, actionStep, simultaneousActionStep, sequence, eachPlayer,
  } = engine as any;

  class FixturePlayer extends Player<any, any> {
    hasBid = false;
  }

  class FixtureCard extends Piece<any> {
    suit!: string;
    rank!: string;
  }

  class FixtureGame extends Game<any, any> {
    static PlayerClass = FixturePlayer;

    constructor(options: any) {
      super(options);

      this.registerAction(
        Action.create('bid').execute((_args: unknown, ctx: any) => {
          ctx.player.hasBid = true;
          return { success: true };
        }),
      );
      this.registerAction(
        Action.create('draw').execute(() => ({ success: true })),
      );

      // BOTH turn shapes, because they serialize differently and the platform
      // reads both. A simultaneous step populates `flowState.awaitingPlayers`
      // and leaves `currentPlayer` undefined; a sequential step does the
      // reverse. The awaitingPlayers path is the one that produced the
      // blank-action-bar bug on this platform — a game's opening simultaneous
      // step reported zero available actions — so leaving it out of the
      // fingerprint would omit the single most expensive skew we have had.
      // The second step is an `eachPlayer` whose body carries a `player:`
      // override, because that combination is the only one that puts a live
      // `GameElement` into BOTH halves of a serialized flow position:
      //   - `eachPlayer` binds the current Player into `position.variables`;
      //   - the `player:` override makes the engine save the PREVIOUS current
      //     player into that action step's `frame.data`, which lands in
      //     `position.frameData`.
      // Both are serialized by `serializeFlowVariables` (BSMITH-04). If either
      // side regresses to a raw spread, the marker disappears from the
      // fingerprinted position and `payloadHash` moves — which is the whole
      // point of fingerprinting the position at all. The override deliberately
      // names a seat OTHER than eachPlayer's first, so the saved previous
      // player is a genuinely different element from the acting one.
      this.setFlow(
        defineFlow({
          root: sequence(
            simultaneousActionStep({
              actions: ['bid'],
              playerDone: (_ctx: unknown, p: any) => p.hasBid,
            }),
            eachPlayer({
              do: actionStep({
                actions: ['draw'],
                player: (ctx: any) => ctx.game.getPlayer(2),
              }),
            }),
          ),
        }),
      );
    }
  }

  // Booted through GameRunner rather than by constructing the Game directly,
  // because GameRunner.start() is what actually initialises the flow — and
  // because `runner.getAllPlayerViews()` is the exact call the ShufflewickPub
  // executor makes. Fingerprinting the executor's own code path is the point:
  // a view shape that only this fixture ever produces would prove nothing.
  const runner = new GameRunner({
    GameClass: FixtureGame,
    gameType: 'engine-contract-fixture',
    gameOptions: {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'engine-contract-fixture',
    },
  }) as any;

  const game = runner.game as any;

  // A default Deck — no visibility call at all. This is the fixture's most
  // important element: it is the one whose payload changed when the `Deck`
  // default moved from `hidden` to `count-only`, and the reason a payload hash
  // exists at all.
  const drawPile = game.create(Deck, 'draw-pile');
  for (let i = 0; i < 8; i += 1) {
    drawPile.create(FixtureCard, `draw-${i}`, { suit: 'H', rank: String(i + 1) });
  }

  // An explicitly count-only pile and an explicitly hidden pile, so a change to
  // either visibility mode's serialization is caught even if the Deck default
  // is left alone.
  const discard = game.create(Space, 'discard');
  discard.contentsCountOnly();
  discard.create(FixtureCard, 'discard-0', { suit: 'S', rank: 'K' });

  const secretPile = game.create(Space, 'secret-pile');
  secretPile.contentsHidden();
  secretPile.create(FixtureCard, 'secret-0', { suit: 'D', rank: 'A' });

  // Owner-visible hands: the asymmetry between "my hand" and "their hand" is
  // the hidden-information guarantee the platform relies on most.
  for (const player of game.all(Player)) {
    const hand = game.create(Hand, `hand-${player.seat}`);
    hand.player = player;
    hand.contentsVisibleToOwner();
    for (let i = 0; i < 3; i += 1) {
      hand.create(FixtureCard, `hand-${player.seat}-${i}`, { suit: 'C', rank: String(i + 1) });
    }
  }

  // Start the flow so the views carry real flow state. Without this every view
  // reports `flowState: undefined` and the hash covers only board
  // serialization — which is exactly how the flow layer stayed invisible in the
  // first version of this fixture. `assertCoversFlowLayer` below makes that
  // mistake impossible to repeat silently.
  runner.start();

  const views = runner.getAllPlayerViews();
  assertCoversFlowLayer(views);

  // Views are captured at the SIMULTANEOUS step, where both seats are on the
  // clock — that is the coverage assertCoversFlowLayer pins, and advancing
  // first would quietly drop it. The flow POSITION is captured one step later,
  // because that is where the element bindings exist.
  for (const player of game.all(Player)) {
    const bid = runner.performAction('bid', player.seat, {});
    if (!bid.success) {
      throw new Error(
        `The engine-contract fixture could not advance past its simultaneous step `
        + `(seat ${player.seat}: ${bid.error ?? 'unknown error'}). The flow position below `
        + 'would then be fingerprinted at the wrong place. Fix the fixture.',
      );
    }
  }

  const flowPosition = game.getFlowState()?.position;
  assertCoversElementBindings(flowPosition);

  // Both halves are hashed together: the per-player payload the platform ships,
  // and the serialized flow position the platform STORES and restores. The
  // second is not reachable from the first (createPlayerView omits `position`),
  // so a flow-serialization regression was previously invisible here.
  return sha256(canonicalize({ views, flowPosition }));
}

export interface ComputedFingerprints {
  surfaceHash: string;
  payloadHash: string;
}

export async function computeFingerprints(): Promise<ComputedFingerprints> {
  return {
    surfaceHash: await computeSurfaceHash(),
    payloadHash: await computePayloadHash(),
  };
}
