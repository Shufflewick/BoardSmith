/**
 * EVERY WORLD-ACTION CALLBACK SEES AN ELEMENT SELECTION AS ITS ELEMENT (#418).
 *
 * A world action's args are typed with each selection's resolved value, so a
 * `chooseElement('room', ...)` is a `Vault` in `.quote()`, in a later pick's
 * callbacks and in `execute`. The wire carries the element's id. Before #418
 * only the dispatch path resolved it (`ActionExecutor.resolveArgs`), so a quote
 * and a re-asked pick were handed the bare number while their types promised
 * the element, and `room.name` read `undefined` with no type error anywhere.
 *
 * One test per road a callback is reached by, each asserting what the callback
 * was actually handed rather than what the draft looked like on the wire. The
 * action's own `.disabled()` is not among them: it is evaluated with empty args
 * on every road (`Game#getActionDisabledReason`), so it has no selection to see.
 */
import { describe, it, expect } from 'vitest';
import { Card, Game, Space, type GameOptions } from '../engine/index.js';
import { createTestWorld, type TestWorld } from '../testing/test-world.js';
import {
  Vault,
  vaultBundle,
  vaultWorldBlock,
  VaultWorld,
} from '../testing/test-world.test-helper.js';
import { worldAction, type WorldDefinition } from './index.js';

/** What one callback was handed for `room`: its type, and its name if it has one. */
interface Seen {
  readonly kind: string;
  readonly name: unknown;
}

const seenOf = (room: unknown): Seen => ({
  kind: typeof room,
  name: typeof room === 'object' && room !== null ? (room as { name?: unknown }).name : undefined,
});

/** The vault a seat's `room` pick resolves to. */
const VAULT_ONE: Seen = { kind: 'object', name: 'vault-1' };

/** An action whose first question is `room`: the acting seat's own vault. */
const pickingOwnVault = (name: string) =>
  worldAction<VaultWorld>(name).chooseElement('room', {
    needs: ({ player }) => [`vault:${player.seat}`],
    elements: ({ game, player }) => [game.first(Vault, `vault-${player.seat}`)!],
  });

/**
 * An action whose every callback records what it was handed for `room`, keyed
 * by the callback's kind. `room` is an element pick; `look` is asked after it,
 * so its callbacks run with `room` bound.
 */
function surveyingWorld(seen: Map<string, Seen[]>): WorldDefinition {
  const record = (kind: string, room: unknown): void => {
    const list = seen.get(kind) ?? [];
    list.push(seenOf(room));
    seen.set(kind, list);
  };
  const survey = pickingOwnVault('survey')
    .chooseFrom('look', {
      prompt: ({ args }) => {
        if (args.room !== undefined) record('prompt', args.room);
        return 'How closely?';
      },
      choices: ({ args }) => {
        if (args.room !== undefined) record('choices', args.room);
        return ['glance', 'stare'];
      },
      prepare: ({ args }) => {
        if (args.room !== undefined) record('prepare', args.room);
        return null;
      },
      disabled: (_choice, { args }) => {
        if (args.room !== undefined) record('disabled', args.room);
        return false;
      },
      validate: (_value, args) => {
        record('validate', args.room);
        return true;
      },
      unavailable: (_value, { args }) => {
        record('unavailable', args.room);
        return 'That is not a way to look.';
      },
    })
    .validate(({ room }) => {
      record('action validate', room);
      return true;
    })
    .quote(({ room }) => {
      record('quote', room);
      return room === undefined ? null : [`A look into ${room.name}`];
    })
    .execute(({ room }) => {
      record('execute', room);
    });
  return { ...vaultWorldBlock(), actions: [survey] } as WorldDefinition;
}

/** `kind` ran at least once, and every time it was handed seat 1's vault. */
function expectOnlyVaultOne(seen: Map<string, Seen[]>, kind: string): void {
  const handed = seen.get(kind) ?? [];
  expect(handed, `${kind} never ran`).not.toHaveLength(0);
  for (const room of handed) expect(room, kind).toEqual(VAULT_ONE);
}

async function surveying(seen: Map<string, Seen[]>): Promise<{ world: TestWorld; room: number }> {
  const world = await createTestWorld({
    definition: { ...vaultBundle(), world: surveyingWorld(seen) },
  });
  const pick = await world.resolvePick(1, 'survey', 'room', {});
  const room = pick.validElements?.[0]?.id;
  if (room === undefined) throw new Error('The survey fixture offered seat 1 no room to pick.');
  seen.clear();
  return { world, room };
}

describe('world-action callbacks receive element selections as elements (#418)', () => {
  it('a quote is handed the element, not its id', async () => {
    const seen = new Map<string, Seen[]>();
    const { world, room } = await surveying(seen);

    const lines = await world.quote(1, 'survey', { room });

    expect(seen.get('quote')).toEqual([VAULT_ONE]);
    expect(lines).toEqual(['A look into vault-1']);
    await world.close();
  });

  it("a re-asked pick's prompt, choices, prepare and disabled are handed the element", async () => {
    const seen = new Map<string, Seen[]>();
    const { world, room } = await surveying(seen);

    await world.resolvePick(1, 'survey', 'look', { room });

    for (const kind of ['prompt', 'choices', 'prepare', 'disabled']) {
      expectOnlyVaultOne(seen, kind);
    }
    await world.close();
  });

  it("a submitted command's validate, disabled rules and execute are handed the element", async () => {
    const seen = new Map<string, Seen[]>();
    const { world, room } = await surveying(seen);

    await world.take(1, 'survey', { room, look: 'stare' });

    for (const kind of ['validate', 'action validate', 'disabled', 'prepare', 'execute']) {
      expectOnlyVaultOne(seen, kind);
    }
    await world.close();
  });

  it('a submitted command with a key no pick declares is refused, and execute never runs (#662)', async () => {
    const seen = new Map<string, Seen[]>();
    const { world, room } = await surveying(seen);

    await expect(world.take(1, 'survey', { room, look: 'stare', bribe: 100 })).rejects.toMatchObject({
      code: 'undeclared-arg',
      message: "'survey' was sent 'bribe', which is not one of its picks. It takes: room, look.",
    });
    expect(seen.get('execute')).toBeUndefined();
    await world.close();
  });

  it("a refused pick's unavailable sentence is handed the element", async () => {
    const seen = new Map<string, Seen[]>();
    const { world, room } = await surveying(seen);

    await expect(world.take(1, 'survey', { room, look: 'squint' })).rejects.toThrow(
      'That is not a way to look.',
    );

    expect(seen.get('unavailable')).toEqual([VAULT_ONE]);
    await world.close();
  });

  it('the element a quote is handed is read-only, as everything a read sees is', async () => {
    const scribble = pickingOwnVault('scribble')
      .quote(({ room }) => {
        if (room !== undefined) room.tally += '*';
        return null;
      })
      .execute(() => {});
    const world = await createTestWorld({
      definition: { ...vaultBundle(), world: { ...vaultWorldBlock(), actions: [scribble] } as WorldDefinition },
    });
    const room = (await world.resolvePick(1, 'scribble', 'room', {})).validElements![0]!.id;

    await expect(world.quote(1, 'scribble', { room })).rejects.toMatchObject({ code: 'declaration-write' });
    await world.close();
  });

  it('a draft naming an element this action cannot offer the seat is refused, not handed over as a number', async () => {
    const seen = new Map<string, Seen[]>();
    const { world } = await surveying(seen);
    // Seat 2's own vault: resident in this world, but outside everything seat
    // 1's declaration of `survey` names.
    const theirs = (await world.resolvePick(2, 'survey', 'room', {})).validElements![0]!.id;
    seen.clear();

    for (const room of [theirs, 987654]) {
      await expect(world.quote(1, 'survey', { room })).rejects.toMatchObject({ code: 'stale-draft' });
      await expect(world.resolvePick(1, 'survey', 'look', { room })).rejects.toMatchObject({
        code: 'stale-draft',
      });
    }
    expect(seen.size).toBe(0);
    await world.close();
  });
});

class Pouch extends Space<PouchWorld> {}
class Commons extends Space<PouchWorld> {}

class PouchWorld extends Game<PouchWorld> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Pouch, Commons, Card]);
  }
}

describe('a read whose draft answers an element pick nested below its partition root (#1203)', () => {
  const handed: unknown[] = [];
  const peek = worldAction<PouchWorld>('peek')
    .chooseElement('card', { needs: () => ['commons'], elements: ({ game }) => game.first(Pouch)!.all(Card) })
    .chooseFrom('how', {
      needs: () => ['commons'],
      choices: ({ args }) => {
        if (args.card !== undefined) handed.push((args.card as Card).name);
        return ['gently'];
      },
    })
    .quote(({ card }) => [`peek at ${(card as Card).name}`])
    .execute(() => {});

  async function pouchWorld(): Promise<{ world: TestWorld; card: number }> {
    handed.length = 0;
    const world = await createTestWorld({
      definition: {
        gameClass: PouchWorld,
        world: {
          maxPlayers: 2,
          actions: [peek],
          view: () => ['commons'],
          genesis: (game: Game) => {
            const commons = game.create(Commons, 'commons');
            commons.create(Pouch, 'pouch').create(Card, 'AS');
            return { commons };
          },
        } as WorldDefinition,
      },
    });
    const card = (await world.resolvePick(1, 'peek', 'card', {})).validElements![0]!.id;
    return { world, card };
  }

  it('a re-asked later pick is answered, with the element handed to it', async () => {
    const { world, card } = await pouchWorld();

    const pick = await world.resolvePick(1, 'peek', 'how', { card });

    expect(pick.choices?.map((c) => c.value)).toEqual(['gently']);
    expect(handed).toEqual(['AS']);
    await world.close();
  });

  it('a quote is answered, with the element handed to it', async () => {
    const { world, card } = await pouchWorld();

    expect(await world.quote(1, 'peek', { card, how: 'gently' })).toEqual(['peek at AS']);
    await world.close();
  });
});
