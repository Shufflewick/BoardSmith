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
    defineFlow, actionStep, simultaneousActionStep, sequence,
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
      this.setFlow(
        defineFlow({
          root: sequence(
            simultaneousActionStep({
              actions: ['bid'],
              playerDone: (_ctx: unknown, p: any) => p.hasBid,
            }),
            actionStep({ actions: ['draw'] }),
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

  return sha256(canonicalize(views));
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
