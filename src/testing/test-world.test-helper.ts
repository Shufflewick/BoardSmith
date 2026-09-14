/**
 * A WORLD WITH A SECRET IN EVERY SEAT'S OWN ROOM.
 *
 * The fixture three suites drive: `test-world.test.ts` (the harness itself),
 * `dom-leak-world.test.ts` (the hidden-information gate aimed at a world board)
 * and `world-host.parity.test.ts` (the dev host and the harness answering the
 * same frame). One vault is one seat's, the commons is everybody's, and the
 * bundle's `world.view` names exactly those two -- so seat 2's projection has
 * no trace of seat 1's vault ANYWHERE in it, which is the case a table game
 * cannot produce: a table's tree is whole and redacted, a world's is pruned.
 *
 * EVERY ATTRIBUTE HERE IS A DISTINCTIVE STRING, and that is deliberate twice
 * over. A leak scan refuses to treat a short NESTED numeric as evidence because
 * it collides with every counter on a page -- but a number that is a whole
 * attribute IS a marker at any length, so a fixture with `coins: 0` in it makes
 * "0" forbidden and any element id containing a zero a false leak. A fixture
 * that has to be read around is not a fixture a detector can be proven with, so
 * the vault counts with a tally of asterisks instead.
 */
import { Game, Player, Space, type GameOptions } from '../engine/index.js';
import { worldAction, type WorldDefinition } from '../world/index.js';

/** One seat's private room. Nobody else's `world.view` names it. */
export class Vault extends Space<VaultWorld> {
  // An element's attributes are read by the ACTIONS and by the rendered board,
  // never by name from another module, so a scan of the repository reports each
  // of them unused. That is the same false positive every element class in this
  // repository produces -- `village.test-helper.ts` carries the same note.
  /** Who holds this room. Not a seat number: see this file's header. */
  // fallow-ignore-next-line unused-class-member
  keeper = '';
  /** The secret. Distinctive enough to be findable in rendered markup. */
  // fallow-ignore-next-line unused-class-member
  codeword = '';
  /** One asterisk per coin stashed. A string for the reason every attribute
   *  here is one. */
  // fallow-ignore-next-line unused-class-member
  tally = '';
}

/** The one room everybody's view names. */
class Commons extends Space<VaultWorld> {
  notice = 'The commons is quiet.';
}

export class VaultWorld extends Game<VaultWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Registered in the class constructor: world mode has no handler re-bind
    // pass on adoption, so anything a grafted element needs must come from its
    // own class.
    this.registerElements([Vault, Commons]);
  }
}

const COMMONS = 'commons';
const vaultPartition = (seat: number): string => `vault:${seat}`;
/** Seat `n`'s secret, by the rule genesis writes it under -- so a test can name
 *  the string it expects never to see without reading it out of the world. */
export const codewordOf = (seat: number): string => `ORCHID-${seat}-KESTREL`;
/** Who holds seat `n`'s vault, by the name genesis writes. */
export const keeperOf = (seat: number): string => `keeper-${seat}-WREN`;

export const SEATS = 3;

/** Put a coin in your own vault. Declares ONLY the acting seat's room, which is
 *  what makes an offer's cost the seat's rather than the world's. */
const stash = worldAction<VaultWorld>('stash')
  .prompt('Stash a coin')
  .needs((ctx) => [vaultPartition(ctx.player.seat)])
  .execute((_args, ctx) => {
    const vault = ctx.world.partition(vaultPartition(ctx.player.seat)) as Vault;
    vault.tally += '*';
    ctx.world.emit(
      vaultPartition(ctx.player.seat),
      { tally: vault.tally },
      `Seat ${ctx.player.seat} stashed a coin.`,
    );
  });

/** Say something in the commons, which every seat can see. */
const post = worldAction<VaultWorld>('post')
  .prompt('Post a notice')
  .needs(() => [COMMONS])
  .execute((_args, ctx) => {
    const commons = ctx.world.partition(COMMONS) as Commons;
    commons.notice = `Seat ${ctx.player.seat} was here.`;
    ctx.world.emit(COMMONS, { notice: commons.notice });
  });

export function vaultWorldBlock(): WorldDefinition {
  return {
    maxPlayers: SEATS,
    actions: [stash, post],
    // THE WHOLE OF WHAT A SEAT MAY SEE. The commons, and its own vault.
    view: (seat: number) => [COMMONS, vaultPartition(seat)],
    genesis: (game: Game) => {
      const roots: Record<string, Commons | Vault> = {
        [COMMONS]: game.create(Commons, 'commons'),
      };
      for (let seat = 1; seat <= SEATS; seat++) {
        roots[vaultPartition(seat)] = game.create(Vault, `vault-${seat}`, {
          keeper: keeperOf(seat),
          codeword: codewordOf(seat),
          tally: '',
        });
      }
      return roots;
    },
  } as WorldDefinition;
}

/** The bundle, in the shape a real one exports. */
export function vaultBundle() {
  return {
    gameClass: VaultWorld,
    gameType: 'vault-world',
    displayName: 'Vault World',
    world: vaultWorldBlock(),
  };
}
