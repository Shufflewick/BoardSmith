/**
 * SEC-04: nothing `Game.toJSON()` hoists to the top level may ALSO ride in the
 * generic attribute bag.
 *
 * `GameElement.toJSON()` builds `attributes` from every own enumerable property
 * not listed in `unserializableAttributes`. `Game` then hoists `phase`,
 * `messages` and `settings` to the top level — so without a deliberate strip,
 * each shipped TWICE, and only the top-level copy is ever redacted.
 *
 * For `messages` that was a total defeat of `messageTo`: `toJSONForPlayer`
 * rebuilt the top-level array for the addressed seat while `attributes.messages`
 * carried the full log — every private line, tagged with the audience it was
 * withheld from — to every seat and to the spectator.
 *
 * The lesson that shapes this file: the bug shipped green under a suite that
 * asserted on the `messages` FIELD. Both documented read paths
 * (`toJSONForPlayer().messages`, `getFormattedMessages(seat)`) were correct.
 * Only an assertion over the WHOLE serialized payload catches a second copy
 * somewhere else in the object. So these tests stringify the payload and search
 * it, and the structural test below asserts the invariant rather than the
 * instance — it fails for the NEXT field hoisted to the top level, without
 * anyone remembering to come back here.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space } from '../index.js';
import { GAME_ROOT_FIELD_AUDIENCE, GAME_SELF_SERIALIZED_FIELDS } from './game.js';
import { createPlayerView, createSnapshot } from '../utils/snapshot.js';

class LeakGame extends Game<LeakGame, Player> {
  board!: Space<LeakGame>;
  setupBoard(): void {
    this.board = this.create(Space<LeakGame>, 'board');
  }
}

function newGame(playerCount = 3): LeakGame {
  const game = new LeakGame({ playerCount, seed: 'payload-duplication' });
  game.setupBoard();
  return game;
}

describe('SEC-04: no top-level game field is duplicated into `attributes`', () => {
  it('holds for the game root — the structural invariant, not a field list', () => {
    const game = newGame();
    game.message('public line');
    game.messageTo(1, 'private line');
    game.settings.somethingAuthorish = { nested: true };

    const json = game.toJSON() as unknown as Record<string, unknown> & {
      attributes: Record<string, unknown>;
    };

    const duplicated = Object.keys(json).filter(
      (key) => key !== 'attributes' && key in json.attributes,
    );

    // If this fails, a field was hoisted to the top level of `Game.toJSON()`
    // without being added to GAME_SELF_SERIALIZED_FIELDS. It is now shipping twice,
    // and the second copy bypasses every redaction pass. Add it to that
    // constant rather than deleting it here.
    expect(duplicated).toEqual([]);
  });

  it('keeps every self-serialized field out of the attribute bag', () => {
    const game = newGame();
    game.message('public line');

    const json = game.toJSON() as unknown as Record<string, unknown> & {
      attributes: Record<string, unknown>;
    };

    for (const field of GAME_SELF_SERIALIZED_FIELDS) {
      expect(json.attributes[field], `${field} must not be in attributes`).toBeUndefined();
    }

    // `phase`/`settings` are hoisted to the top level; `messages` is not in the
    // tree at all (it is a snapshot sibling). Assert that split explicitly, so
    // moving a field between the two is a decision someone has to make here.
    expect(json.phase).toBeDefined();
    expect(json.settings).toBeDefined();
    expect(json.messages).toBeUndefined();
  });
});

describe('SEC-04: whole-payload leak assertions for messageTo', () => {
  /** A game with one private line per seat plus one public line. */
  function narratedGame(): LeakGame {
    const game = newGame();
    game.messageTo(1, 'SECRET-FOR-SEAT-1');
    game.messageTo(2, 'SECRET-FOR-SEAT-2');
    game.message('PUBLIC-LINE');
    return game;
  }

  it('keeps the element tree free of the log entirely', () => {
    // The tree is copied into every retained checkpoint and shipped to every
    // seat. The log belongs to neither. Stringify-and-search, deliberately: a
    // field-level assertion passed throughout the lifetime of the bug this
    // test exists for.
    const tree = JSON.stringify(narratedGame().toJSON());

    expect(tree).not.toContain('SECRET-FOR-SEAT-1');
    expect(tree).not.toContain('SECRET-FOR-SEAT-2');
    expect(tree).not.toContain('PUBLIC-LINE');
  });

  it('withholds a private line from the WHOLE redacted snapshot of an unaddressed seat', () => {
    // `createSnapshot({forSeat})` is the MCTS search sandbox's clone — a payload
    // built precisely so a bot cannot reason over information its seat lacks.
    const seat2 = JSON.stringify(createSnapshot(narratedGame(), 'LeakGame', [], undefined, {
      forSeat: 2,
    }));

    expect(seat2).not.toContain('SECRET-FOR-SEAT-1');
    expect(seat2).toContain('SECRET-FOR-SEAT-2');
    expect(seat2).toContain('PUBLIC-LINE');
  });

  it('withholds every private line from the WHOLE spectator snapshot', () => {
    const spectator = JSON.stringify(createSnapshot(narratedGame(), 'LeakGame', [], undefined, {
      forSeat: null,
    }));

    expect(spectator).not.toContain('SECRET-FOR-SEAT-1');
    expect(spectator).not.toContain('SECRET-FOR-SEAT-2');
    expect(spectator).toContain('PUBLIC-LINE');
  });

  it('withholds a private line from the WHOLE broadcast player view', () => {
    // The other independent route to a client: buildPlayerState feeds the
    // shell's log from here.
    const view = JSON.stringify(createPlayerView(narratedGame(), 2));

    expect(view).not.toContain('SECRET-FOR-SEAT-1');
    expect(view).toContain('SECRET-FOR-SEAT-2');
    expect(view).toContain('PUBLIC-LINE');
  });

  it('does not leak the AUDIENCE either — an unaddressed seat learns of no withheld line', () => {
    const game = newGame();
    game.messageTo(1, 'SECRET-FOR-SEAT-1');
    game.message('PUBLIC-LINE');

    const log = createSnapshot(game, 'LeakGame', [], undefined, { forSeat: 2 }).messageLog;

    // The leaked copy carried `to: [1]` alongside the text, so a reader learned
    // both the secret AND that it was meant for someone else. Seat 2 should see
    // exactly one line and have no evidence a second one exists.
    expect(log?.map((m) => m.text)).toEqual(['PUBLIC-LINE']);
  });

  it('persists the UNFILTERED log — a saved snapshot must not lose other seats history', () => {
    // The mirror image of the leak: filtering what gets PERSISTED would destroy
    // history on the next restore. Only the `forSeat` clone is filtered.
    const snapshot = createSnapshot(narratedGame(), 'LeakGame');

    expect(snapshot.messageLog?.map((m) => m.text)).toEqual([
      'SECRET-FOR-SEAT-1',
      'SECRET-FOR-SEAT-2',
      'PUBLIC-LINE',
    ]);
  });
});

/**
 * SEC-05: `tutorialProgress` is per-seat state, and the seat is the audience.
 *
 * It is an engine-owned `Map<seat, TutorialProgress>` living on the game ROOT,
 * which every seat can see — so like the message log before SEC-04, the element
 * visibility pass never touched it and every seat received every other seat's
 * entry. Unlike the log it was never duplicated, so neither of that fix's
 * guards covered it: same class of hole, different field.
 *
 * Nothing on the client reads it (the client gets the `PlayerGameState.tutorial`
 * projection instead), so this is a leak with no consumer on the other side.
 */
describe('SEC-05: tutorialProgress is scoped to the receiving seat', () => {
  function taughtGame(): LeakGame {
    const game = newGame();
    game.tutorialProgress.set(1, { stepId: 'STEP-OF-SEAT-1', status: 'running' });
    game.tutorialProgress.set(2, { stepId: 'STEP-OF-SEAT-2', status: 'exited' });
    return game;
  }

  it('gives a seat its own entry and nobody else\'s', () => {
    const seat1 = JSON.stringify(taughtGame().toJSONForPlayer(1));

    expect(seat1).toContain('STEP-OF-SEAT-1');
    expect(seat1).not.toContain('STEP-OF-SEAT-2');
  });

  it('does not tell one seat that another QUIT the tutorial', () => {
    // `status: 'exited'` is the sharpest of the three: it is a fact about a
    // person giving up on the tutorial, and it has no bearing on the rules.
    const seat1 = JSON.stringify(taughtGame().toJSONForPlayer(1));
    expect(seat1).not.toContain('exited');
  });

  it('gives the spectator nobody\'s progress at all', () => {
    const spectator = JSON.stringify(taughtGame().toJSONForPlayer(null));

    expect(spectator).not.toContain('STEP-OF-SEAT-1');
    expect(spectator).not.toContain('STEP-OF-SEAT-2');
  });

  it('keeps the AUTHORITATIVE tree complete — restore must not lose a seat\'s progress', () => {
    // The mirror-image failure: scoping what gets PERSISTED would reset other
    // seats' tutorials on the next restore.
    const full = JSON.stringify(taughtGame().toJSON());

    expect(full).toContain('STEP-OF-SEAT-1');
    expect(full).toContain('STEP-OF-SEAT-2');
  });

  it('leaves the per-seat view restorable and self-consistent', () => {
    // A seat's own entry survives, so the tutorial gate evaluates the same way
    // against a restored clone of this view as against the live game.
    const view = taughtGame().toJSONForPlayer(2);
    const restored = newGame();
    restored.loadSerializedState(JSON.parse(JSON.stringify(view)));

    expect(restored.tutorialProgress.get(2)).toEqual({
      stepId: 'STEP-OF-SEAT-2',
      status: 'exited',
    });
    expect(restored.tutorialProgress.has(1)).toBe(false);
  });
});

/**
 * SEC-06: every engine-owned field on the game ROOT must state its audience.
 *
 * This is the guard the two previous leaks needed and neither had. SEC-04's
 * invariant catches DUPLICATION, and `tutorialProgress` was never duplicated;
 * the SEC-05 assertions are about `tutorialProgress` specifically, and would not
 * have noticed `messages`. Both defects share a cause neither guard names: an
 * engine field landed on an always-visible node without anyone deciding who may
 * see it.
 *
 * So this test asserts the DECISION exists, not any particular field's value. A
 * new field on `Game` — or on `GameElement`/`Space`, which every element
 * inherits — fails the suite until it is classified in
 * `GAME_ROOT_FIELD_AUDIENCE`. That is deliberately a build break rather than a
 * lint warning: the cost of answering "who may see this?" is thirty seconds,
 * and the cost of not answering it has twice been a silent leak.
 */
describe('SEC-06: the game root declares an audience for every engine field', () => {
  /** Own serializable properties of a BARE game — engine fields only, no author state. */
  function engineRootFields(): string[] {
    const game = new Game({ playerCount: 3, seed: 'sec-06' });
    const unserializable = new Set(
      (game.constructor as unknown as { unserializableAttributes: string[] }).unserializableAttributes,
    );
    return Object.keys(game).filter((k) => !unserializable.has(k) && !k.startsWith('_'));
  }

  it('classifies every engine-owned root field', () => {
    const unclassified = engineRootFields().filter((f) => !(f in GAME_ROOT_FIELD_AUDIENCE));

    // A new engine field reached the game root without an audience. Decide who
    // may see it and add it to GAME_ROOT_FIELD_AUDIENCE:
    //   'public'          — no per-seat data in it
    //   'seat-scoped'     — narrow it in toJSONForPlayer, and add an assertion
    //   'self-serialized' — Game emits it outside the attribute bag
    // Do not add it as 'public' to make this pass without checking; the root is
    // visible to every seat and to the spectator, and nothing downstream will
    // catch it for you.
    expect(unclassified).toEqual([]);
  });

  it('does not classify fields that no longer exist', () => {
    // Keeps the map honest: a stale entry is a decision about nothing, and
    // makes the list read as more considered than it is.
    const live = new Set(engineRootFields());
    const stale = Object.keys(GAME_ROOT_FIELD_AUDIENCE).filter((f) => !live.has(f));

    expect(stale).toEqual([]);
  });

  it('keeps every `self-serialized` field out of the attribute bag', () => {
    const game = newGame();
    const attrs = (game.toJSON() as unknown as { attributes: Record<string, unknown> }).attributes;

    for (const [field, audience] of Object.entries(GAME_ROOT_FIELD_AUDIENCE)) {
      if (audience !== 'self-serialized') continue;
      expect(attrs[field], `${field} is 'self-serialized' but rode in attributes`).toBeUndefined();
      expect(
        (GAME_SELF_SERIALIZED_FIELDS as readonly string[]).includes(field),
        `${field} is 'self-serialized' but is not in GAME_SELF_SERIALIZED_FIELDS, ` +
          'so nothing strips it from the attribute bag',
      ).toBe(true);
    }
  });

  it('serves every `public` field identically to every seat', () => {
    // 'public' claims the value holds no per-seat data. This catches the
    // inverse mistake — a field narrowed per seat but still declared public,
    // whose consumers would silently disagree about what the game state is.
    const game = newGame();
    game.tutorialProgress.set(1, { stepId: 'a-step', status: 'running' });

    const attrsFor = (seat: number) =>
      (game.toJSONForPlayer(seat) as unknown as { attributes: Record<string, unknown> }).attributes;
    const [one, two] = [attrsFor(1), attrsFor(2)];

    for (const [field, audience] of Object.entries(GAME_ROOT_FIELD_AUDIENCE)) {
      if (audience !== 'public') continue;
      expect(one[field], `${field} is 'public' but differs between seats`).toEqual(two[field]);
    }
  });

  it('actually narrows every `seat-scoped` field', () => {
    // Generic where it can be: a seat-scoped field must not be byte-identical
    // across two seats whose underlying data differs. Seeding that data is
    // necessarily field-specific, so each field needs a case here.
    const seeds: Record<string, (g: LeakGame) => void> = {
      tutorialProgress: (g) => {
        g.tutorialProgress.set(1, { stepId: 'seat-one-step', status: 'running' });
        g.tutorialProgress.set(2, { stepId: 'seat-two-step', status: 'completed' });
      },
    };

    for (const [field, audience] of Object.entries(GAME_ROOT_FIELD_AUDIENCE)) {
      if (audience !== 'seat-scoped') continue;

      const seed = seeds[field];
      expect(
        seed,
        `${field} is 'seat-scoped' but has no case here proving it narrows. ` +
          'Add one that seeds differing per-seat data — a scoping claim nothing ' +
          'checks is how SEC-04 and SEC-05 both shipped.',
      ).toBeDefined();

      const game = newGame();
      seed!(game);
      const valueFor = (seat: number | null) =>
        JSON.stringify(
          (game.toJSONForPlayer(seat) as unknown as { attributes: Record<string, unknown> })
            .attributes[field],
        );

      expect(valueFor(1), `${field} is identical for seats 1 and 2 — it is not narrowed`).not.toEqual(
        valueFor(2),
      );
      // And the spectator, being nobody, gets nobody's slice.
      expect(valueFor(null)).not.toEqual(valueFor(1));
    }
  });
});
