/**
 * WHAT `docs/persistent-worlds.md` IS ALLOWED TO SAY, AND WHAT IT MUST SAY.
 *
 * ## Why this file changed shape (#165)
 *
 * It used to gate a POINTER page. `docs/persistent-worlds.md` said the world
 * contract lived in the hosting platform's repository and sent the reader
 * there, and this test asserted the page contained the strings that made it a
 * good pointer.
 *
 * That is a test that proves a page is STALE, not that it is TRUE, and it
 * proved exactly that: when the world runtime moved into `src/world/` and
 * `boardsmith/world`, two of the page's sentences became false --
 *
 *   "Nothing in this repo reads it", of `gameDefinition.world`, which
 *     `src/world/definition.ts:readWorldDefinition` reads; and
 *   "`GameDefinition.world` is typed here as an open record and no more",
 *     which `src/session/types.ts` types with `WorldDefinition`
 *
 * -- and every assertion here stayed green, because none of them was tied to a
 * fact about the code.
 *
 * So the assertions below are tied to the code wherever a fact exists to tie
 * them to: the refusal table, the budget defaults, the declaration ceiling and
 * the two ownership facts above are all read out of `src/` and checked against
 * the prose. A change that falsifies the guide fails a test rather than
 * silently teaching an author something untrue.
 *
 * ## What stays from the #304 guard
 *
 * The FALSE_CLAIMS sweep over every prose doc. It used to forbid saying that
 * `boardsmith dev` runs a world, because it did not and a doc claiming
 * otherwise sent an author to spend a day on a loop that did not exist. #167
 * built that loop, so the ban is lifted and what replaces it is the opposite
 * ban: a doc still telling an author the CLI cannot run their world. The
 * patterns are matched against every `docs/*.md`, because a sentence is free to
 * move.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { WORLD_REFUSALS, worldBudgets, WORLD_DECLARATION_ROUNDS } from '../src/world/index.js';

const DOCS = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(DOCS, '..');
const read = (name: string) => readFileSync(join(DOCS, name), 'utf-8');
const readSrc = (...parts: string[]) => readFileSync(join(REPO_ROOT, ...parts), 'utf-8');

/** The authoring guide every other doc sends a world author to. */
const GUIDE = 'persistent-worlds.md';
const guide = read(GUIDE);

/**
 * Claims no doc may make. Matched case-insensitively against every prose doc.
 *
 * The first two are #304's, and they survive #167 unchanged: they are about
 * saying imprecisely what a world does, not about denying that one runs. The
 * third USED to forbid "`boardsmith dev` runs a world"; #167 replaced it with
 * its inverse, because the sentence that can now rot is the denial. The rest
 * are #165's: the contract is no longer somebody else's, and the two sentences
 * that went stale unnoticed are named so they cannot be written again by anyone
 * who half-remembers the old page.
 */
const FALSE_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /stands? (a|the|this|your) world up/i,
    why: 'Say what actually happens. `boardsmith dev` opens a durable local store, runs genesis once, and dispatches commands against it -- "stands a world up" is a phrase that could equally describe provisioning infrastructure, which is the one thing #164 promises an author never does.',
  },
  {
    pattern: /(running|runs) resident/i,
    why: 'Residency here means the engine\'s partition model, not a running world. Say which one you mean.',
  },
  {
    // INVERTED BY #167. This slot held the ban on saying `boardsmith dev` runs
    // a world; the CLI does run one now, so what is forbidden is the leftover
    // denial. Two patterns, because the denial was written two ways.
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
 * A WORLD DOES NOT RUN LOCALLY YET, AND THE GUIDE HAS TO SAY SO.
 *
 * The FALSE_CLAIMS sweep stops the page claiming a local run. This stops the
 * opposite failure: a page that is silent about it, which an author reads as a
 * loop that works. #167 must come back and rewrite what these assert.
 */
describe('#167: the guide says what a local world run actually does', () => {
  it('names every one of the eight things the dev host drives', () => {
    // ONE LINE, and asterisks stripped: this page is hard-wrapped and bolds
    // the control names, so a phrase is routinely broken across a newline or
    // interrupted by `**`. A check that missed those would pass on exactly the
    // sentences it exists to hold in place.
    const flat = guide.replace(/[*`]/g, '').replace(/\s+/g, ' ').toLowerCase();
    // The ticket's own list. A guide that named four of them would send an
    // author looking for the loop they were not told about -- which is the
    // failure this file has caught twice already, in the other direction.
    for (const promise of [
      'genesis',
      'partitions(args, seat)',
      'view(seat)',
      'scheduled events',
      'presence',
      'seat switcher',
      'fire due events now',
      'wake from parked',
    ]) {
      expect(
        flat.includes(promise.toLowerCase()),
        `The guide stopped saying that \`boardsmith dev\` drives "${promise}". Every one of ` +
          'the eight is something an author cannot discover by looking at a board.',
      ).toBe(true);
    }
  });

  it('says the local run and the published run are the same library', () => {
    // The whole argument for #164/#165. If a laptop ran its own world runtime,
    // local behaviour would stop predicting published behaviour and the page
    // would have to say so.
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
        'still where a world\'s automated coverage lives.',
    ).toBe(true);
    expect(guide).toContain('tests/world.test.ts');
  });
});

/**
 * THE TRANSITIONAL SURFACE IS MARKED (#169).
 *
 * `WorldCommandHandler` and everything shaped around it is deleted when a
 * world's verbs become Actions. An author who was not told writes against it
 * and is surprised; a guide that documented the Action shape as though it
 * existed would be worse still.
 */
describe('#169: the command surface is marked transitional', () => {
  it('the guide warns about it and names the ticket', () => {
    expect(guide).toContain('#169');
    expect(/transitional/i.test(guide)).toBe(true);
    for (const type of [
      'WorldCommandHandler',
      'WorldCommandContext',
      'WorldCommandArgument',
      'WorldCommandOffer',
    ]) {
      expect(
        guide.includes(type),
        `${type} is deleted by #169 and an author writes against it today. The guide must name ` +
          'it in the transitional table rather than leaving the reader to find out at migration.',
      ).toBe(true);
    }
  });

  it('the source still marks them, so the guide and the code agree', () => {
    const engine = readSrc('src', 'world', 'engine.ts');
    expect(engine).toContain('TRANSITIONAL');
    expect(readSrc('src', 'world', 'definition.ts')).toContain('TRANSITIONAL');
  });

  it('does not document the Action shape as though it exists', () => {
    for (const premature of ['WorldAction', 'worldAction(', 'action registry API']) {
      expect(
        guide.includes(premature),
        `${premature} does not exist at this commit. #169 designs it; documenting it now would ` +
          'send an author to write against nothing.',
      ).toBe(false);
    }
  });

  it('does not restate the deleted round architecture', () => {
    for (const gone of ['resolveAction', 'enrolAction', '--kind resolution']) {
      expect(
        guide.includes(gone),
        `${gone} belongs to the round architecture, which was deleted.`,
      ).toBe(false);
    }
  });
});

/**
 * THE GUIDE IS COMPLETE AGAINST THE CONTRACT IT DOCUMENTS.
 *
 * Every one of these is a member of the authoring surface an author has to
 * write, and a guide missing one leaves that member documented nowhere at all
 * -- which is the state the whole page was in before #165.
 */
describe('#165: the guide covers the authoring contract', () => {
  const required: Array<[string, string]> = [
    ['genesis', 'the partitions a brand-new world starts with'],
    ['partitions(', 'the declaration that decides what a command may reach'],
    ['run(', 'the handler that changes the world'],
    ['view(', 'what one seat is shown'],
    ['presence', 'the arrive and depart hooks, and ctx.presence'],
    ['ctx.now', 'the only clock a handler may read'],
    ['ctx.schedule', 'the eager half of the timer primitive'],
    ['complete()', 'the one ending a game may declare'],
    ['clockOnly', 'the commands no player may send'],
    ['scope', 'what decides who hears an event'],
    ['dirty', 'what a checkpoint writes'],
    ['maxPlayers', 'the seat count, declared twice and bounded by the host'],
    ['WorldBudgets', 'the ceilings, owned here and configured by a host'],
    ['WorldPartitionStore', 'where partitions live, as an interface'],
  ];

  it.each(required)('documents `%s` (%s)', (member) => {
    expect(guide.includes(member), `docs/${GUIDE} must document ${member}.`).toBe(true);
  });

  it('documents the two-phase declaration and its ceiling', () => {
    expect(
      guide.includes(String(WORLD_DECLARATION_ROUNDS)),
      `A declaration is asked at most ${WORLD_DECLARATION_ROUNDS} times before ` +
        '`declaration-unsettled`. An author whose declaration reads an index needs the number.',
    ).toBe(true);
    expect(guide).toContain('declaration-unsettled');
  });
});

/**
 * EVERY REFUSAL A WORLD CAN ISSUE IS EXPLAINED SOMEWHERE AN AUTHOR READS.
 *
 * Read out of the table rather than listed here, so a refusal added to
 * `src/world/refusals.ts` fails this until the guide says what it means. That
 * is the assertion that keeps a reference section from rotting, and it is the
 * shape the old test had no equivalent of.
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
 * these numbers are the ones an author sizes a data model against. A host
 * raising a default without touching the guide fails here.
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
 *
 * In-repo links are always checkable. The `~/BoardSmithGames` citations are in
 * another checkout, so they are verified when it is present and reported as
 * unverified when it is not -- which is honest about what this run proved,
 * rather than silently passing.
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

  it('`boardsmith validate` ends a world project\'s run with it', () => {
    const validate = readSrc('src', 'cli', 'commands', 'validate.ts');
    expect(
      validate,
      'validate\'s success guidance is the other place an author is sent from, so a world ' +
        `project has to leave that run knowing where docs/${GUIDE} is.`,
    ).toContain('WORLD_AUTHORING_DOC');
    expect(readSrc('src', 'cli', 'lib', 'world-project.ts')).toContain(`'docs/${GUIDE}'`);
  });
});
