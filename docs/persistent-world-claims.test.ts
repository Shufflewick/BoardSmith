/**
 * WHAT `docs/persistent-worlds.md` IS ALLOWED TO SAY, AND WHAT IT MUST SAY.
 *
 * ## Why this file exists at all (#165)
 *
 * It used to gate a POINTER page: the guide said the world contract lived in the
 * hosting platform's repository, and this test asserted the page contained the
 * strings that made it a good pointer. That is a test that proves a page is
 * STALE, not that it is TRUE, and it proved exactly that -- two of the page's
 * sentences became false when the world runtime moved into `src/world/`, and
 * every assertion here stayed green, because none of them was tied to a fact
 * about the code.
 *
 * So every claim below is tied to something: the refusal table, the budget
 * defaults, the module's own exports, and -- since #169 -- A RUNNING WORLD. The
 * fixture at the top of this file is a real village built with `worldAction()`
 * and driven through `BoardSmithWorldEngine` over serialized bytes, so the
 * behaviour the guide teaches is behaviour this file has watched happen. A
 * hand-built fixture asserting a shape production stopped sending is the exact
 * failure `docs/TEST-FIXTURES.md` is about, and it is the failure this file was
 * written to stop making.
 *
 * ## Why it changed shape (#169)
 *
 * A world's verbs are Actions now. The guide used to teach a flat command table
 * and to CARRY A TABLE OF TYPES THAT WERE ABOUT TO CHANGE, and this file used to
 * assert that table was present. Both are gone. What replaces them here is the
 * opposite assertion: the deleted vocabulary is exported by nothing, and no code
 * sample in the guide names it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  BoardSmithWorldEngine,
  WORLD_REFUSALS,
  worldAction,
  worldBudgets,
  worldClockAction,
} from '../src/world/index.js';
import * as worldModule from '../src/world/index.js';
import type { ActionDefinition } from '../src/engine/index.js';
import {
  COMMONS,
  Commons,
  Holding,
  OFFER,
  SETTLERS,
  STAMP,
  STANDING_MAX,
  VillageFixture,
  applyThroughWalk as apply,
  holdingId,
  holdingPartition,
  neighboursOf,
  newVillageEngine,
} from '../src/world/village.test-helper.js';

const DOCS = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(DOCS, '..');
const read = (name: string) => readFileSync(join(DOCS, name), 'utf-8');
const readSrc = (...parts: string[]) => readFileSync(join(REPO_ROOT, ...parts), 'utf-8');

/** The authoring guide every other doc sends a world author to. */
const GUIDE = 'persistent-worlds.md';
const guide = read(GUIDE);

/** The guide with its wrapping and its emphasis removed, so a claim broken
 *  across a newline or interrupted by `**` is still the same claim. */
const flatGuide = guide.replace(/[*`]/g, '').replace(/\s+/g, ' ');

/** Every fenced `ts` sample in the guide. What an author copies. */
const codeSamples = [...guide.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!);

// ---------------------------------------------------------------------------
// THE FIXTURE THE GUIDE IS CHECKED AGAINST.
//
// The village itself -- its ring, its elements, its genesis, the store that
// counts reads and the two loops a host drives -- is `src/world/
// village.test-helper.ts`, shared with `action.test.ts`. A second hand-built
// village is how a guide's suite and an engine's suite come to disagree about
// what a world does.
//
// THE VERBS BELOW ARE THIS FILE'S OWN, deliberately. They are the guide's own
// worked examples TRANSCRIBED, so a sample that stops compiling stops this
// suite; importing them from the shared helper would turn that transcription
// into a pointer at something nobody reads.
// ---------------------------------------------------------------------------

/**
 * The guide's own worked example, transcribed.
 *
 * Deliberately the SAME action the "An action: declare, then execute" section
 * prints: round one from the seat alone, a selection with its own round and a
 * precomputed `elements:` list, a `.disabled()` reason on the action and one on
 * the candidate. If the guide's sample stops compiling, this stops compiling.
 */
const tend: ActionDefinition = worldAction<VillageFixture>('tend')
  .prompt("Spend a log putting timber back on a neighbour's land")
  .needs(({ player }) => [holdingPartition(player.seat)])
  .disabled(({ game, player }) =>
    game.holdingOf(player.seat).woodpile < 1 ? 'You have no log to spend' : false,
  )
  .chooseElement('neighbour', {
    needs: ({ player }) => neighboursOf(player.seat).map(holdingPartition),
    elements: ({ game, player }) => neighboursOf(player.seat).map((s) => game.holdingOf(s)),
    disabled: (holding) => (holding.standing >= STANDING_MAX ? 'Already at full growth' : false),
  })
  .execute(({ neighbour }, ctx) => {
    ctx.game.holdingOf(ctx.player.seat).woodpile -= 1;
    neighbour.standing += 2;
    ctx.world.emit(holdingPartition(neighbour.seat), { tended: 2 });
  });

/** The eager half of the timer primitive, and the shape of a schedule request
 *  the guide's Scheduling section describes: a seatless action, scalar args. */
const kindle: ActionDefinition = worldAction<VillageFixture>('kindle')
  .prompt('Bank your woodpile on a slow burn')
  .needs(({ player }) => [holdingPartition(player.seat)])
  .execute((_args, ctx) => {
    const holding = ctx.game.holdingOf(ctx.player.seat);
    ctx.world.schedule({
      delayMs: 1000,
      key: `burn:${holding.seat}`,
      action: 'settleBurn',
      args: { holding: holdingPartition(holding.seat) },
    });
    ctx.world.emit(holdingPartition(holding.seat), { banked: holding.woodpile });
  });

/** The guide's "Taking a timer back": the obligation's other half, which
 *  forgets the deadline when the seat answers first. */
const douse: ActionDefinition = worldAction<VillageFixture>('douse')
  .prompt('Call the burn off before it reaches the fire')
  .needs(({ player }) => [holdingPartition(player.seat)])
  .execute((_args, ctx) => {
    ctx.world.cancel(`burn:${ctx.player.seat}`);
  });

/** The clock's own, from the guide's `worldClockAction()` section. */
const settleBurn: ActionDefinition = worldClockAction<VillageFixture>('settleBurn')
  .prompt('The clock: a slow burn reaching the fire')
  .needs(({ args }) => [COMMONS, String(args.holding)])
  .execute((args, ctx) => {
    const holding = ctx.world.partition(String(args.holding)) as Holding;
    const commons = ctx.world.partition(COMMONS) as Commons;
    commons.embers += holding.woodpile;
    holding.woodpile = 0;
    ctx.world.emit(COMMONS, { embers: commons.embers });
  });







/** This suite's verbs over the shared village. */
function newEngine(
  actions: readonly ActionDefinition[] = [kindle, tend, settleBurn],
  budgets = worldBudgets(),
) {
  return newVillageEngine(actions, budgets);
}

// ---------------------------------------------------------------------------

/**
 * Claims no doc may make. Matched case-insensitively against every prose doc.
 *
 * The first two are #304's: they are about saying imprecisely what a world does.
 * The third USED to forbid "`boardsmith dev` runs a world"; #167 replaced it
 * with its inverse, because the sentence that can now rot is the denial. The
 * rest are #165's: the contract is no longer somebody else's, and the two
 * sentences that went stale unnoticed are named so they cannot be written again
 * by anyone who half-remembers the old page.
 */
const FALSE_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /stands? (a|the|this|your) world up/i,
    why: 'Say what actually happens. `boardsmith dev` opens a durable local store, runs genesis once, and dispatches actions against it -- "stands a world up" is a phrase that could equally describe provisioning infrastructure, which is the one thing #164 promises an author never does.',
  },
  {
    pattern: /(running|runs) resident/i,
    why: 'Residency here means the engine\'s partition model, not a running world. Say which one you mean.',
  },
  {
    pattern: /`?boardsmith dev`? (plays|serves) (a|the|this|your) world project's table half/i,
    why: 'It does not, as of #167: `devCommand` branches to `startWorldDevServer` for any project whose manifest declares a `world` block, and a world project need not have a table half at all.',
  },
  {
    pattern: /(no host in this repos(itory)? runs a world|dispatches no world command|runs no genesis|projects no world view|fires no scheduled event)/i,
    why: '`src/cli/dev-host/world-host.ts` does all five, through `boardsmith/world` (#167). This sentence was true until that landed.',
  },
  {
    pattern: /nothing in this repo reads it/i,
    why: '`src/world/definition.ts:readWorldDefinition` reads `gameDefinition.world`, `createWorld` builds a runner over it, and `BoardSmithWorldEngine` calls every member. This sentence was true before #165 and is the first of the two the old pointer page kept saying afterwards.',
  },
  {
    pattern: /world[^.]{0,60}\b(typed|declared)\b[^.]{0,60}open record/i,
    why: '`GameDefinition.world` is typed by `WorldDefinition` from `boardsmith/world` (`src/session/types.ts`). This is the second sentence the old pointer page kept saying after it stopped being true.',
  },
  {
    pattern: /(belongs to|lives in|is owned by|is written in) (the platform|the hosting platform|ShufflewickPub)/i,
    why: 'The authoring contract is in this repository, under src/world/, exported as `boardsmith/world`. What belongs to a host is its LIFECYCLE POLICY -- sockets, hibernation, eviction timing, the park ladder, rate limits, the presence ledger -- and the guide has a table that says so.',
  },
  {
    pattern: /nothing in this repo(sitory)? is allowed to restate/i,
    why: 'That sentence deferred the whole authoring contract to another repository. It is here now, and this page is the one that states it.',
  },
  {
    // #169. The command surface is not "transitional" any more, it is deleted,
    // and a page still promising a migration would send an author to wait for
    // one that has happened.
    pattern: /command surface is transitional|the transitional part/i,
    why: '#169 has landed: a world action IS an `ActionDefinition`, and `WorldCommandHandler` and its neighbours are deleted rather than pending. A page that still calls the surface transitional tells an author to write against something that is gone.',
  },
];

/**
 * Every prose doc, plus the root README, which is the page a stranger arriving
 * from GitHub or npm reads first and which now carries the product pitch
 * (#168). A false world claim is no less false for living one directory up.
 */
const proseDocs = [
  '../README.md',
  ...readdirSync(DOCS)
    .filter((name) => name.endsWith('.md'))
    .sort(),
];

describe('no BoardSmith doc makes a claim about worlds that the code contradicts', () => {
  it('reads the docs directory it thinks it is reading', () => {
    expect(proseDocs.length).toBeGreaterThan(10);
    expect(proseDocs).toContain('core-concepts.md');
    expect(proseDocs).toContain('../README.md');
    expect(proseDocs).toContain(GUIDE);
  });

  it.each(proseDocs)('%s makes none of the claims', (doc) => {
    // ONE LINE, so a claim broken across a wrap is still the same claim. Every
    // doc here is hard-wrapped, and a pattern that stopped at a newline would
    // pass on exactly the sentences it was written to catch.
    const text = read(doc).replace(/\s+/g, ' ');
    for (const { pattern, why } of FALSE_CLAIMS) {
      expect(pattern.test(text), `docs/${doc}: ${why}`).toBe(false);
    }
  });
});

/**
 * The two ownership facts, read out of `src/`.
 *
 * These are the assertions the old test did not have, and their absence is the
 * whole reason the page went stale in place. If either stops being true, the
 * guide is wrong and this fails at the source rather than at the prose.
 */
describe('#165: the world contract is in THIS repository', () => {
  it('`GameDefinition.world` is typed by boardsmith/world', () => {
    const types = readSrc('src', 'session', 'types.ts');
    expect(
      /import type \{[^}]*WorldDefinition[^}]*\} from ['"]\.\.\/world\/definition\.js['"]/.test(types),
      'src/session/types.ts must import WorldDefinition from the world module. One declaration ' +
        'both a bundle and a host import is the whole point of `boardsmith/world`; an open ' +
        'record here is what let three world games hand-copy the contract and drift.',
    ).toBe(true);
    expect(types).toContain('world?: WorldDefinition;');
  });

  it('this repository reads the world block rather than pointing at whoever does', () => {
    const definition = readSrc('src', 'world', 'definition.ts');
    expect(definition).toContain('export function readWorldDefinition');
    expect(definition).toContain('definition.world');
    expect(definition).toContain('export function createWorld');
  });

  it('the guide says the contract is here, and names the module', () => {
    expect(guide).toContain('boardsmith/world');
    expect(guide).toContain('src/world/');
    expect(guide).toContain('WorldDefinition');
  });
});

/**
 * A LOCAL RUN EXISTS, AND THE GUIDE HAS TO SAY WHAT IT DRIVES.
 *
 * The FALSE_CLAIMS sweep stops the page denying it. This stops the opposite
 * failure: a page that is silent about a control, which an author then never
 * finds -- none of these is discoverable by looking at a board.
 */
describe('#167: the guide says what a local world run actually does', () => {
  it.each([
    'genesis',
    "each action's declaration",
    'view(seat)',
    'scheduled events',
    'presence',
    'seat switcher',
    'fire due events now',
    'wake from parked',
  ])('names that `boardsmith dev` drives %s', (promise) => {
    expect(
      flatGuide.toLowerCase().includes(promise.toLowerCase()),
      `The guide stopped saying that \`boardsmith dev\` drives "${promise}".`,
    ).toBe(true);
  });

  it('says the local run and the published run are the same library', () => {
    // The whole argument for #164/#165. If a laptop ran its own world runtime,
    // local behaviour would stop predicting published behaviour.
    expect(guide).toContain('same library the hosting platform runs');
  });

  it('names the one thing that deletes a local world, because nothing else does', () => {
    expect(guide).toContain('boardsmith dev --reset');
  });

  it('still names a way to run the world contract with no host at all', () => {
    expect(
      guide.includes('createWorld'),
      'A browser loop does not replace the test loop. `createWorld` drives genesis, ' +
        'declaration, dispatch, views and checkpoints from an ordinary test file, and that is ' +
        "still where a world's automated coverage lives.",
    ).toBe(true);
    expect(guide).toContain('tests/world.test.ts');
  });
});

/**
 * #169: THE DELETED VOCABULARY IS DELETED, AND NO SAMPLE STILL USES IT.
 *
 * The old version of this file asserted the guide CARRIED a table of these
 * names, because they were about to change. They have changed. What matters now
 * is that nothing an author can copy still names one -- a code sample is the
 * part of a page that gets pasted, so it is the part that must not rot.
 */
describe('#169: the flat command table is gone from the library and from the samples', () => {
  const deleted = [
    'WorldCommandHandler',
    'WorldCommandContext',
    'WorldCommandArgument',
    'WorldCommandOffer',
    'WorldCommandTable',
    'WorldCommandChoice',
  ];

  const worldSources = readdirSync(join(REPO_ROOT, 'src', 'world'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readSrc('src', 'world', name))
    .join('\n');

  it.each(deleted)('`%s` is declared by nothing in src/world/', (type) => {
    expect(
      new RegExp(`export (interface|type|class) ${type}\\b`).test(worldSources),
      `${type} was deleted by #169. A world's verbs are Actions; a bundle that hand-copied this ` +
        'type deletes its copy rather than adapting it.',
    ).toBe(false);
  });

  it.each(deleted)('no code sample in the guide uses `%s`', (type) => {
    for (const sample of codeSamples) {
      expect(sample.includes(type), `A \`ts\` sample in docs/${GUIDE} still writes ${type}.`).toBe(
        false,
      );
    }
  });

  it('`invalid-command-args` is gone from the refusal table and from the guide', () => {
    expect(Object.keys(WORLD_REFUSALS)).not.toContain('invalid-command-args');
    expect(
      guide.includes('invalid-command-args'),
      'It was replaced by `invalid-world-action`. A refusal code in prose that no code can issue ' +
        'is a failure an author will look for and never see.',
    ).toBe(false);
  });

  it('every name a sample imports from boardsmith/world is really exported', () => {
    const imported = codeSamples
      .flatMap((sample) => [...sample.matchAll(/import \{([^}]*)\} from 'boardsmith\/world'/g)])
      .flatMap((match) => match[1]!.split(','))
      .map((name) => name.trim().replace(/^type /, ''))
      .filter((name) => name.length > 0);
    expect(imported.length).toBeGreaterThan(0);
    for (const name of imported) {
      expect(
        Object.prototype.hasOwnProperty.call(worldModule, name),
        `docs/${GUIDE} tells an author to import \`${name}\` from boardsmith/world, and the ` +
          'module does not export it. A sample that does not run is worse than no sample.',
      ).toBe(true);
    }
  });
});

/**
 * THE AUTHORING SURFACE THE GUIDE TEACHES, DRIVEN.
 *
 * Every `it` here does the thing the guide describes and then checks the guide
 * describes it. Two halves on purpose: the first catches the library changing
 * under the page, the second catches the page dropping a member entirely, which
 * is the state the whole document was in before #165.
 */
describe('#169: a world action is an Action, and the guide teaches the real one', () => {
  it('`worldAction()` produces an ActionDefinition carrying the world block', () => {
    expect(tend.name).toBe('tend');
    expect(tend.world).toBeDefined();
    expect(tend.world!.seatless).toBeUndefined();
    expect(guide).toContain('worldAction(');
    expect(flatGuide).toContain('a world action is an ActionDefinition');
  });

  it('the declaration walk is in source order, each round naming the step it precedes', () => {
    // `.needs()` before any selection is round one; a selection's own `needs:`
    // comes before that selection. The guide prints this as a three-row table,
    // and it is the one thing an author has to hold in their head to write a
    // world action at all.
    const needs = tend.world!.needs;
    expect(needs.map((round) => round.before)).toEqual([0, 0]);
    expect(needs.every((round) => typeof round.declare === 'function')).toBe(true);
    expect(flatGuide).toContain('round one');
    expect(flatGuide).toContain('the execute round');
  });

  it('chains: two `.needs()` in one position are two rounds, the second reading the first', async () => {
    // The MUD `look` shape the guide prints. Round one names the commons with
    // nothing resident; round two reads it and names a holding from what it
    // found, which is a declaration whose subject is itself state.
    const look = worldAction<VillageFixture>('look')
      .needs(() => [COMMONS])
      .needs(({ game }) => [holdingPartition(game.first(Commons, 'commons')!.embers + 1)])
      .execute(() => {});
    const { engine } = newEngine([look]);
    const command = { name: 'look', args: {} };

    expect(engine.commandPartitions('p1', command)).toEqual([COMMONS]);
    await engine.hydrate([COMMONS]);
    // Only reachable because the first round's partition is now in the tree.
    expect(engine.commandPartitions('p1', command)).toEqual([holdingPartition(1)]);
    expect(flatGuide).toContain('.needs() may be chained');
    // AND THE GUIDE'S SAMPLE IS A SHIPPED VERB, NOT A SKETCH (#352). The
    // fixture above proves the engine does it; only a citation proves an
    // author can go and read one that is built, published and tested. The
    // guide printed a toy `roomOf(game, player)` for long enough that both
    // example worlds shipped the branching round it says the chain deletes.
    expect(flatGuide).toContain('~/BoardSmithGames/example-mud/src/rules/world.ts');
    expect(flatGuide).toContain('~/BoardSmithGames/sotf/src/rules/world.ts');
  });

  it('answers one round at a time, each answerable against the last', async () => {
    const { engine } = newEngine();
    const command = { name: 'tend', args: { neighbour: 0 } };

    // Round one is a pure function of the seat, answered with nothing resident.
    expect(engine.commandPartitions('p2', command)).toEqual([holdingPartition(2)]);

    await engine.hydrate([holdingPartition(2)]);
    // The selection's own round, answered with round one in front of it.
    expect(engine.commandPartitions('p2', command).sort()).toEqual([
      holdingPartition(1),
      holdingPartition(3),
    ]);

    await engine.hydrate([holdingPartition(1), holdingPartition(3)]);
    // And it ends. There is no ceiling to trip: the walk's length is the
    // action's own selection count.
    expect(engine.commandPartitions('p2', command)).toEqual([]);
  });

  it('refuses a declaration that tries to write, and the guide says to write in execute', async () => {
    const writer = worldAction<VillageFixture>('writer')
      .needs(({ game, player }) => {
        game.holdingOf(player.seat).woodpile = 99;
        return [];
      })
      .execute(() => {});
    const { engine } = newEngine([writer]);
    await engine.hydrate([holdingPartition(1)]);
    expect(() => engine.commandPartitions('p1', { name: 'writer', args: {} })).toThrow(
      /A declaration tried to write/,
    );
    expect(guide).toContain('declaration-write');
    expect(flatGuide).toContain('Do the write in execute');
  });

  it('gives execute the world facilities the guide lists, and refuses an undeclared partition', async () => {
    const reacher = worldAction<VillageFixture>('reacher')
      .needs(({ player }) => [holdingPartition(player.seat)])
      .execute((_args, ctx) => {
        // Everything the guide's `ctx.world` block names is really here.
        expect(ctx.world.now).toBe(STAMP.now);
        expect(ctx.world.timing).toBeNull();
        expect(ctx.world.presence).toBeInstanceOf(Set);
        expect(ctx.world.partition(holdingPartition(ctx.player.seat))).toBeDefined();
        // And the commons, which this action never declared, is not.
        ctx.world.partition(COMMONS);
      });
    const { engine } = newEngine([reacher]);
    await expect(apply(engine, 'p1', { name: 'reacher', args: {} })).rejects.toThrow(
      /did not declare/,
    );
    for (const member of [
      'ctx.world.now',
      'ctx.world.timing',
      'ctx.world.presence',
      'ctx.world.partition(name)',
      'ctx.world.emit(scope, payload)',
      'ctx.world.complete()',
    ]) {
      expect(guide.includes(member), `The guide must document ${member}.`).toBe(true);
    }
    expect(guide).toContain('undeclared-partition');
  });

  it('emits its narration rather than returning it, routed to the seats that can see it', async () => {
    const { engine, game } = newEngine();
    const result = await apply(engine, 'p2', {
      name: 'tend',
      args: { neighbour: await holdingId(engine, game, 3) },
    });
    expect(result.events).toEqual([
      { scope: holdingPartition(3), payload: { tended: 2 }, seats: [3] },
    ]);
    expect(flatGuide).toContain('Events are emitted, not returned');
  });

  it('a seatless action is filtered from the offer AND refused on submit', async () => {
    const { engine } = newEngine();
    expect(settleBurn.world!.seatless).toBe(true);
    expect(settleBurn.selections).toHaveLength(0);

    const offers = await engine.offersFor('p1', OFFER);
    expect(offers.map((offer) => offer.name)).toEqual(['kindle', 'tend']);
    await expect(
      apply(engine, 'p1', { name: 'settleBurn', args: { holding: holdingPartition(1) } }),
    ).rejects.toThrow(/clock at work/);

    expect(guide).toContain('worldClockAction(');
    expect(guide).toContain('clock-only-command');
    expect(flatGuide).toContain("left out of every seat's offer, and refused on submit");
  });

  it('greys an action and a candidate WITH a reason rather than throwing from inside', async () => {
    const { engine, game } = newEngine();
    // Seat 2 spends its one log, so `tend`'s own rule closes the door on it.
    await apply(engine, 'p2', {
      name: 'tend',
      args: { neighbour: await holdingId(engine, game, 3) },
    });
    const forSeatTwo = await engine.offersFor('p2', OFFER);
    expect(forSeatTwo.find((offer) => offer.name === 'tend')?.disabled).toBe(
      'You have no log to spend',
    );

    // And seat 3 sees a neighbour it may not tend, greyed with the reason.
    await apply(engine, 'p1', {
      name: 'tend',
      args: { neighbour: await holdingId(engine, game, 2) },
    });
    const pick = (await engine.offersFor('p3', OFFER)).find((offer) => offer.name === 'tend')!
      .selections[0]!;
    const byId = new Map(pick.validElements!.map((element) => [element.id, element.disabled]));
    expect(byId.get(game.holdingOf(2).id)).toBe('Already at full growth');
    expect(byId.get(game.holdingOf(4).id)).toBeUndefined();

    expect(flatGuide).toContain('grey it out with a reason, do not throw');
  });
});

/**
 * THE FOUR RULES THAT KEEP ENUMERATION O(view).
 *
 * The guide has a section per rule with the reason attached, because the reason
 * is the part an author can generalise from. Each one is driven here, so the
 * section cannot outlive the guard it describes.
 */
describe('#169: what stops an author writing an O(world) enumeration', () => {
  it('(a) refuses the unbounded element form at construction', () => {
    const searching = worldAction<VillageFixture>('searching')
      .needs(() => [])
      .chooseElement('anything', {} as never)
      .execute(() => {});
    expect(() => newEngine([searching])).toThrow(/names no candidates/);
    expect(flatGuide).toContain('The unbounded element form is refused');
  });

  it('(b) refuses a candidate outside what the step declared', async () => {
    const straying = worldAction<VillageFixture>('straying')
      .needs(({ player }) => [holdingPartition(player.seat)])
      .chooseElement('elsewhere', {
        elements: ({ game }) => [game.holdingOf(1), game.holdingOf(2), game.holdingOf(3)],
      })
      .execute(() => {});
    const { engine } = newEngine([straying]);
    // Everything is resident, so only the DECLARATION stands between the action
    // and the whole village. That is the case the guard is for: residency is an
    // accident of what else has run.
    await engine.hydrate([holdingPartition(1), holdingPartition(2), holdingPartition(3)]);
    await expect(engine.offersFor('p1', OFFER)).rejects.toThrow(/did not declare/);
    expect(flatGuide).toContain('Every candidate must lie inside a partition that step declared');
  });

  it('(c) refuses a selection past this host\'s candidate budget', async () => {
    const { engine } = newEngine(
      [tend],
      // See the note in src/world/action.test.ts: the #170 R2 floor is stepped
      // over by hand so this proves the ENGINE's enforcement of the budget.
      { ...worldBudgets(), maxCandidatesPerSelection: 1 },
    );
    await expect(engine.offersFor('p1', OFFER)).rejects.toThrow(/allows 1 per selection/);
    expect(guide).toContain('maxCandidatesPerSelection');
    expect(
      /Nothing enforces this yet/i.test(guide),
      'It is enforced now, at enumeration. A guide saying otherwise invites the one shape the ' +
        'declaration itself cannot bound: a 500-seat roster in one honest partition.',
    ).toBe(false);
  });

  it('(d) refuses a dependent selection, naming one action per shape as the fix', () => {
    // `worldAction`'s own surface has no `dependsOn` to pass, which is the
    // signpost; this reaches past it to prove the ENFORCEMENT is at
    // registration and not merely in the builder's type.
    const dependent = worldAction<VillageFixture>('dependent')
      .needs(() => [])
      .chooseElement('first', { elements: ({ game }) => [game.holdingOf(1)] })
      .chooseElement('second', { elements: ({ game }) => [game.holdingOf(2)] })
      .execute(() => {});
    (dependent.selections[1] as { dependsOn?: string }).dependsOn = 'first';
    expect(() => newEngine([dependent])).toThrow(/one action per shape/);
    expect(flatGuide).toContain('one action per shape');
  });

  it('all three construction-time refusals are the one code the guide names', () => {
    expect(Object.keys(WORLD_REFUSALS)).toContain('invalid-world-action');
    expect(guide).toContain('invalid-world-action');
  });

  it('says honestly that a condition or disabled predicate is not covered', () => {
    expect(
      /condition[^.]{0,80}disabled[^.]{0,200}(no guard|nothing stops)/is.test(
        guide.replace(/\s+/g, ' '),
      ),
      'The four rules bound the CANDIDATES and say nothing about what a predicate does before ' +
        'returning false. There is no guard for that, only the rule written down, and a guide ' +
        'that implied otherwise would be selling a guarantee the library does not make.',
    ).toBe(true);
  });
});

/**
 * THE OFFER, AND WHAT IT COSTS TO HYDRATE.
 *
 * The hydration claim is the one an author sizes a world against, and it is the
 * one that is a property of how the games are written rather than a guarantee
 * the library makes -- so the guide has to say both halves and this has to
 * prove the first.
 */
describe('#169: offersFor answers the seat, in the table\'s own shape', () => {
  it('resolves each selection\'s candidates with the offer', async () => {
    const { engine } = newEngine();
    const offer = (await engine.offersFor('p3', OFFER)).find((one) => one.name === 'tend')!;

    // ActionMetadata: a name, a prompt, and selections.
    expect(offer.prompt).toContain('neighbour');
    expect(offer.selections).toHaveLength(1);
    const pick = offer.selections[0]!;
    expect(pick.type).toBe('element');
    // TWO, and not SETTLERS. The ring is what makes a neighbour a real thing,
    // and enumerating it is what the flat table could not do at all.
    expect(pick.validElements).toHaveLength(2);

    expect(guide).toContain('offersFor(player, { now, presence })');
    expect(guide).toContain('ActionMetadata');
    expect(flatGuide).toContain('candidates arrive with the offer');
  });

  it('reads no storage for a seat that has just looked at its own view', async () => {
    const { engine, store } = newEngine([kindle]);
    // A look first, exactly as a watching client does: the guide's own
    // `view: (seat) => [COMMONS, holdingPartition(seat)]`.
    await engine.hydrate([COMMONS, holdingPartition(4)]);
    store.reads.length = 0;

    await engine.offersFor('p4', OFFER);
    expect(
      store.reads,
      "`kindle`'s round one names the seat's own holding, which the view already named, so an " +
        'offer over a seat that has just looked costs no read at all.',
    ).toEqual([]);
    expect(flatGuide).toContain("union of the actions' round-one declarations");
  });

  it('charges an action whose round one the view omits, once per offer', async () => {
    const { engine, store } = newEngine();
    await engine.hydrate([COMMONS, holdingPartition(4)]);
    store.reads.length = 0;

    await engine.offersFor('p4', OFFER);
    // `tend`'s SELECTION round names the two neighbours, which the view does
    // not. That is the honest extra cost of enumerating, and it is two rather
    // than a number that grows with the village.
    expect(store.reads.sort()).toEqual([holdingPartition(3), holdingPartition(5)]);
    expect(flatGuide).toContain('honest extra cost');
  });
});

/**
 * SCHEDULING, WHICH IS THE ONE PLACE A ROW OUTLIVES THE TREE THAT WROTE IT.
 */
describe('#169: a schedule names a seatless action and carries scalars', () => {
  it('rides home on the result under `action`', async () => {
    const { engine } = newEngine();
    const result = await apply(engine, 'p1', { name: 'kindle', args: {} });
    expect(result.schedules).toEqual([
      {
        delayMs: 1000,
        key: 'burn:1',
        action: 'settleBurn',
        args: { holding: holdingPartition(1) },
      },
    ]);
    // A PARTITION NAME AND NOT AN ELEMENT, which is the whole rule: every value
    // in a schedule row is a JSON scalar.
    for (const value of Object.values(result.schedules[0]!.args ?? {})) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
    expect(guide).toContain('ctx.world.schedule({ delayMs, action, args?, key?, everyMs? })');
    expect(flatGuide).toContain('JSON scalars');
    expect(flatGuide).toContain('partition name');
  });

  it('#177: a cancel rides home the same way, keyed the way the arm was', async () => {
    // The guide says a timer can be taken back and that a key is the only
    // handle a cancel has. Driven rather than asserted about, because the two
    // cap refusals promised this remedy for months while the request type had
    // no cancel on it at all.
    const { engine } = newEngine([kindle, douse, settleBurn]);
    await apply(engine, 'p1', { name: 'kindle', args: {} });
    const result = await apply(engine, 'p1', { name: 'douse', args: {} });

    expect(result.schedules).toEqual([{ cancel: 'burn:1' }]);
    expect(flatGuide).toContain('ctx.world.cancel("raid")');
    expect(flatGuide).toContain('An unkeyed event cannot be cancelled at all');
  });

  it('the clock runs the seatless action it named, with no player at all', async () => {
    const { engine, game } = newEngine();
    await apply(engine, 'p1', { name: 'kindle', args: {} });
    const banked = game.holdingOf(1).woodpile;

    const event = { name: 'settleBurn', args: { holding: holdingPartition(1) } };
    for (;;) {
      const needs = engine.commandPartitions(null, event);
      if (needs.length === 0) break;
      await engine.hydrate(needs);
    }
    const result = await engine.onEvent(
      event,
      { due: STAMP.now + 1000, missedCount: 0 },
      { allowance: STAMP.allowance, presence: [] },
    );
    expect(game.holdingOf(1).woodpile).toBe(0);
    expect(result.events).toEqual([
      { scope: COMMONS, payload: { embers: banked }, seats: [1, 2, 3, 4, 5, 6] },
    ]);
  });
});

/**
 * A WORLD ACTION OUTSIDE A WORLD.
 *
 * The refusal an author meets when they register a world action on a table, and
 * the guide has to name it because the alternative failure is a TypeError from
 * inside library code.
 */
describe('#169: not-in-a-world', () => {
  it('says so rather than reporting a TypeError from inside the library', () => {
    const table = new VillageFixture({ playerCount: 2, seed: 'table' });
    table.registerAction(tend);
    expect(() => table.performAction('tend', table.players[0]!, { neighbour: 1 })).toThrow(
      /only exists while a persistent world is running it/,
    );
    expect(Object.keys(WORLD_REFUSALS)).toContain('not-in-a-world');
    expect(guide).toContain('not-in-a-world');
  });
});

/**
 * THE GUIDE IS COMPLETE AGAINST THE CONTRACT IT DOCUMENTS.
 *
 * Every one of these is a member of the authoring surface an author has to
 * write, and a guide missing one leaves that member documented nowhere at all.
 */
describe('#165: the guide covers the authoring contract', () => {
  const required: Array<[string, string]> = [
    ['genesis', 'the partitions a brand-new world starts with'],
    ['worldAction(', 'the builder every seated verb is written with'],
    ['worldClockAction(', 'the builder the clock\'s own verbs are written with'],
    ['.needs(', 'the declaration that decides what a step may reach'],
    ['elements:', 'the precomputed candidate list an element selection must supply'],
    ['chooseFrom', 'a choice between values the game names'],
    ['enterNumber', 'a bounded number, drawn as a stepper'],
    ['enterText', 'free text'],
    ['execute', 'what changes the world'],
    ['view(', 'what one seat is shown'],
    ['offersFor(', 'what a seat can do here, enumerated'],
    ['presence', 'the arrive and depart hooks, and ctx.world.presence'],
    ['ctx.world.now', 'the only clock an action may read'],
    ['ctx.world.schedule', 'the eager half of the timer primitive'],
    ['ctx.world.cancel', 'taking a keyed timer back, which an obligation rests on'],
    ['complete()', 'the one ending a game may declare'],
    ['seatless', 'the actions no player may send'],
    ['scope', 'what decides who hears an event'],
    ['dirty', 'what a checkpoint writes'],
    ['maxPlayers', 'the seat count, declared twice and bounded by the host'],
    ['WorldBudgets', 'the ceilings, owned here and configured by a host'],
    ['WorldPartitionStore', 'where partitions live, as an interface'],
  ];

  it.each(required)('documents `%s` (%s)', (member) => {
    expect(guide.includes(member), `docs/${GUIDE} must document ${member}.`).toBe(true);
  });

  it('scopes `declaration-unsettled` to a view, because that is all it is now', () => {
    // The fixpoint and its ceiling survive for `world.view`, which genuinely has
    // to be asked again. An action's walk has neither, and a guide that still
    // warned an author about a ceiling on the write path would send them
    // splitting a perfectly ordinary five-selection verb.
    expect(worldModule).not.toHaveProperty('WORLD_DECLARATION_ROUNDS');
    expect(guide).toContain('declaration-unsettled');
    expect(
      /declaration-unsettled[^|]*\|[^|]*view only/i.test(guide) ||
        /A view only[^.]*since an action's walk has no ceiling/i.test(guide.replace(/\s+/g, ' ')),
      '`declaration-unsettled` is a VIEW refusal since #169. The guide has to say which half it ' +
        'belongs to, or an author reads it as a limit on their actions.',
    ).toBe(true);
  });
});

/**
 * EVERY REFUSAL A WORLD CAN ISSUE IS EXPLAINED SOMEWHERE AN AUTHOR READS.
 *
 * Read out of the table rather than listed here, so a refusal added to
 * `src/world/refusals.ts` fails this until the guide says what it means.
 */
describe('#165: the guide explains every refusal', () => {
  const codes = Object.keys(WORLD_REFUSALS).sort();

  it('has refusals to check', () => {
    expect(codes.length).toBeGreaterThan(20);
  });

  it.each(codes)('names `%s`', (code) => {
    expect(
      guide.includes(code),
      `docs/${GUIDE} does not mention the \`${code}\` refusal. Every way a world can refuse is ` +
        'something an author can hit, and a code with no prose is a failure nobody can act on. ' +
        `Its owner is "${WORLD_REFUSALS[code as keyof typeof WORLD_REFUSALS].owner}".`,
    ).toBe(true);
  });

  it('names all four owners, because the owner is what decides the consequence', () => {
    for (const owner of ['caller', 'game', 'platform', 'infrastructure']) {
      expect(guide).toContain(owner);
    }
  });
});

/**
 * THE BUDGET TABLE MATCHES `worldBudgets()`.
 *
 * A number in prose beside a number in code is the classic silent drift, and
 * these numbers are the ones an author sizes a data model against.
 */
describe('#165: the guide states the real budget defaults', () => {
  const defaults = worldBudgets();

  it.each(Object.entries(defaults))('states `%s` as %d', (field, value) => {
    expect(guide).toContain(`\`${field}\``);
    expect(
      guide.includes(String(value)),
      `docs/${GUIDE} must state the default for ${field} (${value}). An author sizes a partition ` +
        'and a timer against these, and a stale number is a world that cannot be created.',
    ).toBe(true);
  });

  it('teaches the partition-budget rule at the seat cap, not at the expected roster', () => {
    expect(guide).toContain('partition-too-large');
    expect(
      /measure at `?maxPlayers`?, not at the roster/i.test(guide),
      'This is the highest-value paragraph in the document for a new world author: an ' +
        'over-budget partition is not a world that degrades later, it is a world that cannot be ' +
        'created. It has to say to measure at the cap.',
    ).toBe(true);
  });
});

/**
 * EVERY CITATION POINTS AT SOMETHING THAT EXISTS (ShufflewickPub #351).
 *
 * That issue is two reviewers independently trying to copy a worked example
 * from a doc's most useful paragraph and finding the files were not there. The
 * remedy is not to be careful; it is to check.
 */
describe('ShufflewickPub #351: the guide cites nothing that does not exist', () => {
  const relativeLinks = [...guide.matchAll(/\]\((\.\/[^)#]+)/g)].map((match) => match[1]!);

  it('links to at least one sibling doc', () => {
    expect(relativeLinks.length).toBeGreaterThan(0);
  });

  it.each(relativeLinks)('%s exists', (link) => {
    expect(existsSync(join(DOCS, link)), `docs/${GUIDE} links to ${link}, which is not there.`).toBe(
      true,
    );
  });

  const gamePaths = [...guide.matchAll(/~\/BoardSmithGames\/[A-Za-z0-9._/-]+/g)].map(
    (match) => match[0],
  );
  const gamesRoot = join(homedir(), 'BoardSmithGames');

  it('cites the example projects', () => {
    expect(gamePaths.length).toBeGreaterThan(0);
  });

  it.each(gamePaths)('%s exists, when that checkout is present', (cited) => {
    if (!existsSync(gamesRoot)) {
      // Nothing to check against. Recorded rather than asserted, because a
      // pass here would claim a verification this run did not perform.
      console.warn(`~/BoardSmithGames is not present; ${cited} was not verified.`);
      return;
    }
    expect(
      existsSync(join(homedir(), cited.slice('~/'.length))),
      `docs/${GUIDE} cites ${cited}, which is not in the BoardSmithGames checkout. This is ` +
        'exactly ShufflewickPub #351: a worked example named in prose and missing on disk.',
    ).toBe(true);
  });

  it('does not send a reader to another repository for the contract', () => {
    for (const moved of ['docs/PERSISTENT-WORLDS.md', 'docs/WORLD-SCHEDULE.md']) {
      expect(
        guide.includes(moved),
        `${moved} is the hosting platform's page and is no longer where the authoring contract ` +
          'lives. This guide is. Redirecting to it is how the two came to disagree.',
      ).toBe(false);
    }
  });
});

/** The pages an author is actually sent from still carry the pointer. */
describe('the guide is reachable from where an author starts', () => {
  it('getting-started.md points a world author at it', () => {
    expect(
      read('getting-started.md'),
      `getting-started.md is where an author starts. The pointer to docs/${GUIDE} has to start here.`,
    ).toContain(GUIDE);
  });

  it('core-concepts.md sends the world-mode section on to it', () => {
    expect(read('core-concepts.md')).toContain(GUIDE);
  });

  it("`boardsmith validate` ends a world project's run with it", () => {
    const validate = readSrc('src', 'cli', 'commands', 'validate.ts');
    expect(
      validate,
      "validate's success guidance is the other place an author is sent from, so a world " +
        `project has to leave that run knowing where docs/${GUIDE} is.`,
    ).toContain('WORLD_AUTHORING_DOC');
    expect(readSrc('src', 'cli', 'lib', 'world-project.ts')).toContain(`'docs/${GUIDE}'`);
  });
});
