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
 * KNOWN LIMIT, stated so nobody over-trusts this: `surfaceHash` sees runtime
 * values only. `verbatimModuleSyntax` erases type-only exports, so a change to
 * an exported TYPE (a new optional field on `PlayerStateView`, say) moves
 * neither hash unless it also changes a real payload. Type-level contract
 * changes still need a judgement call and a manual `contract:update`.
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
 * Hash the runtime export names of every platform-reachable entrypoint.
 *
 * Names only, not values: a function body changing is a semantic change, which
 * is `payloadHash`'s job. Conflating the two would make the surface hash move
 * on every internal edit and stop meaning "the API changed".
 */
export async function computeSurfaceHash(): Promise<string> {
  const lines: string[] = [];

  for (const entry of PLATFORM_ENTRYPOINTS) {
    const module = await entry.module();
    const names = Object.keys(module).sort();
    lines.push(`${entry.specifier}: ${names.join(',')}`);
  }

  return sha256(lines.join('\n'));
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
  const { Game, Space, Piece, Player, Deck, Hand, createAllPlayerViews } = engine;

  class FixtureGame extends Game<any, any> {}
  class FixtureCard extends Piece<any> {
    suit!: string;
    rank!: string;
  }

  const game = new FixtureGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'engine-contract-fixture',
  }) as any;

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

  return sha256(canonicalize(createAllPlayerViews(game)));
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
