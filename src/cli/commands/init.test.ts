/**
 * Regression guard for the scaffolded placeholder game template.
 *
 * Bug (found by the Phase 95 playability gate): the generated game created each
 * player's Hand inside the Player constructor. The engine pre-creates players
 * during super(), which runs BEFORE the game body calls registerElements([...]).
 * A Hand created at that point is never registered, so getPlayerHand() returns
 * undefined and the constructor's deal loop crashes with
 * "Cannot read properties of undefined (reading '_t')" on the first putInto().
 *
 * The fix mirrors the working reference games (e.g. Cribbage): create hands in
 * the game body, after registerElements(), iterating this.players. These tests
 * pin that pattern so the template can't regress to the crashing shape.
 */
import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateGameTs, generateTestTs, initCommand, type InitOptions } from './init.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { rejectionMessage } from '../../testing/rejection.test-helper.js';
import { createTestGame, simulateRandomGames } from '../../testing/index.js';
import { _clearShownWarnings } from '../../utils/dev.js';

/**
 * Scaffold a real project into a fresh temp directory and chdir into its
 * parent, which is what `initCommand` reads the destination from.
 *
 * Both scaffold suites below drive the actual command rather than a fixture:
 * these tests exist because the scaffold's OUTPUT was wrong, so a fake of it
 * would assert nothing.
 */
async function scaffoldProject(
  prefix: string,
  name: string,
  options: InitOptions,
): Promise<{ parentDir: string; projectPath: string }> {
  const parentDir = tempTree(prefix);
  process.chdir(parentDir);
  await initCommand(name, options);
  return { parentDir, projectPath: join(parentDir, name) };
}

/**
 * A suite whose every test scaffolds a real project. It owns the temp
 * directory, the chdir into it, and the cleanup afterwards.
 *
 * Each suite below carried its own copy of those three, and the copy that
 * matters most is the `process.chdir` BACK: a suite that skips it leaves every
 * test file running after it inside a directory that has been deleted.
 */
function scaffoldSuite(prefix: string, defaultName: string, defaultOptions: InitOptions) {
  const originalCwd = process.cwd();
  const project = { path: '' };
  let parentDir = '';

  afterEach(() => {
    process.chdir(originalCwd);
  });

  /** Scaffold the suite's project (or, given arguments, a different one). */
  async function scaffold(name = defaultName, options = defaultOptions): Promise<string> {
    ({ parentDir, projectPath: project.path } = await scaffoldProject(prefix, name, options));
    return project.path;
  }

  const read = (relative: string): string => readFileSync(join(project.path, relative), 'utf-8');
  const has = (relative: string): boolean => existsSync(join(project.path, relative));

  return { scaffold, read, has };
}
import { WORLD_SCAFFOLD_SEATS } from '../lib/world-scaffold.js';
import { validateAssetPaths } from './validate.js';
import { ASSET_PATH_KEYS } from '../lib/config-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('generateGameTs — scaffolded game template', () => {
  const src = generateGameTs('Demo');

  it('creates player hands in the game body after registerElements (not in the Player constructor)', () => {
    const registerIdx = src.indexOf('this.registerElements([Card, Hand, Deck]);');
    const handCreateIdx = src.indexOf('this.create(Hand, `hand-${player.seat}`)');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(handCreateIdx).toBeGreaterThan(-1);
    // Hand creation must come AFTER registerElements so the Hand class is registered.
    expect(handCreateIdx).toBeGreaterThan(registerIdx);
  });

  it('does NOT create the player hand inside the Player constructor', () => {
    // Isolate the Player class body and assert it does not call game.create(Hand, ...).
    const playerClassIdx = src.indexOf('export class DemoPlayer extends Player');
    expect(playerClassIdx).toBeGreaterThan(-1);
    const playerBody = src.slice(playerClassIdx);
    expect(playerBody).not.toContain('game.create(Hand');
  });

  it('assigns each player.hand so downstream code keeps a typed reference', () => {
    expect(src).toContain('player.hand = hand;');
  });
});

describe('generateTestTs — scaffolded game test template', () => {
  const test = generateTestTs('Demo');

  it('iterates players via game.players (not all(Player), which excludes unregistered players)', () => {
    expect(test).toContain('game.players');
    expect(test).not.toContain('game.all(DemoPlayer)');
  });

  it('asserts the deck count consistent with the constructor dealing 5 cards per player', () => {
    // The game deals in its constructor, so the deck no longer holds all 52
    // cards post-construction. Guard against regressing to the stale toBe(52)
    // deck assertion that fails for every freshly scaffolded game.
    expect(test).toContain('game.deck.all(Card).length).toBe(52 - game.players.length * 5)');
    expect(test).not.toContain('game.deck.all().length).toBe(52)');
  });

  it('does not call setup() — the scaffold game does all setup in its constructor', () => {
    expect(test).not.toContain('game.setup()');
  });
});

// PROC-02 regression (F33/CLIX-05): `-t/--template` was a fully silent no-op --
// it parsed and accepted any string but had zero read sites in initCommand's
// body, so it could never actually select a template. Per No Backward
// Compatibility the flag is removed outright (not deprecated). These tests
// pin the removal at both registration sites so it can't silently reappear.
describe('init command — no -t/--template surface (CLIX-05 / F33)', () => {
  it('does not register -t/--template on the init command in cli.ts', () => {
    const cliSrc = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    const initBlockStart = cliSrc.indexOf(".command('init <name>')");
    expect(initBlockStart).toBeGreaterThan(-1);
    const initBlockEnd = cliSrc.indexOf('.action(initCommand)', initBlockStart);
    expect(initBlockEnd).toBeGreaterThan(initBlockStart);
    const initBlock = cliSrc.slice(initBlockStart, initBlockEnd);
    expect(initBlock).not.toContain('--template');
    expect(initBlock).not.toContain('-t,');
  });

  it('does not remove the unrelated pack command --target flag', () => {
    const cliSrc = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    expect(cliSrc).toContain("-t, --target <path>");
  });

  it('init.ts has no template surface (CLIX-05 / F33)', () => {
    // The original assertion also required that the `InitOptions` type not exist at all. That
    // was a proxy for "no template option", correct while init took no options. It now takes
    // --rulebook/--edition, so the proxy is retired and the real invariant asserted directly:
    // no template surface of any kind. `--rulebook` is unrelated to templating.
    const initSrc = readFileSync(join(__dirname, 'init.ts'), 'utf-8');
    expect(initSrc).not.toContain('template');
    const cliSrc = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    const initBlock = cliSrc.slice(
      cliSrc.indexOf(".command('init <name>')"),
      cliSrc.indexOf(".command('dev')"),
    );
    expect(initBlock).not.toContain('template');
    expect(initBlock).not.toMatch(/-t\b/);
  });
});

/**
 * #305: a rulebook that incorporates a second document by reference needs that document archived
 * with the same provenance guarantees, and `init` is the one command no ingest run skips.
 */
describe('initCommand --additional-source (#305)', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
  });

  it('archives the rulebook and each additional source, recording both in rulebook/INDEX.md', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const sourcesDir = tempTree('bs-init-305-sources-');
    const rules = join(sourcesDir, 'REQUIREMENTS.md');
    const reference = join(sourcesDir, 'REFERENCE.md');
    writeFileSync(rules, '# Requirements\n\nBattles follow the reference.\n');
    writeFileSync(reference, '# Reference\n\nUnit stats.\n');

    const { projectPath } = await scaffoldProject('bs-init-305-', 'windup', {
      rulebook: rules,
      additionalSource: [reference],
    });

    const index = readFileSync(join(projectPath, 'design', 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toMatch(/^Source: rulebook\/source\/REQUIREMENTS\.md$/m);
    expect(index).toMatch(/^\| rulebook\/source\/REFERENCE\.md \| [0-9a-f]{64} \|$/m);
    expect(existsSync(join(projectPath, 'design', 'rulebook', 'source', 'REFERENCE.md'))).toBe(true);
  });
});

// Phase 149 dry-run Finding 1: `build-chunk.md`'s Git Protocol commits at
// every step, but a freshly-scaffolded project had no git repository at all
// (`npx boardsmith init` never ran `git init`), so the very first commit that
// protocol calls for would fail outright. `initCommand` now runs `git init`
// (+ an initial commit, best-effort) as part of scaffolding.
describe('initCommand — git init on scaffold (Phase 149 Finding 1)', () => {
  const originalCwd = process.cwd();
  let parentDir: string;

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('initializes a git repository in the scaffolded project directory', async () => {
    parentDir = tempTree('bs-init-git-');
    process.chdir(parentDir);
    await initCommand('git-init-test-game', { withoutRulebook: true });
    const projectPath = join(parentDir, 'git-init-test-game');
    expect(existsSync(join(projectPath, '.git'))).toBe(true);
  });

  it('is non-fatal to scaffolding when the commit fails (no git identity)', async () => {
    // Genuinely force the commit-failure path (WR-01). The previous version
    // just ran initCommand in a fresh dir — on any machine/CI with a global
    // user.name/user.email, `git commit` SUCCEEDED, so the non-fatal catch was
    // never exercised and the test passed even if the error handling were
    // deleted. Here we neutralize git identity for the spawned git commit:
    // empty config sources plus empty GIT_AUTHOR_*/GIT_COMMITTER_* means git
    // cannot resolve an identity and the commit fails — while `git init` and
    // `git add` still succeed. initCommand must not throw or exit(1).
    parentDir = tempTree('bs-init-git-noid-');
    process.chdir(parentDir);
    const prev = { ...process.env };
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';
    process.env.GIT_AUTHOR_NAME = '';
    process.env.GIT_AUTHOR_EMAIL = '';
    process.env.GIT_COMMITTER_NAME = '';
    process.env.GIT_COMMITTER_EMAIL = '';
    try {
      await expect(initCommand('git-init-noid-game', { withoutRulebook: true })).resolves.toBeUndefined();
      const projectPath = join(parentDir, 'git-init-noid-game');
      // Scaffold survives, the repo exists, but no commit was made.
      expect(existsSync(join(projectPath, 'package.json'))).toBe(true);
      expect(existsSync(join(projectPath, '.git'))).toBe(true);
    } finally {
      process.env = prev;
    }
  });
});


/**
 * Issue 142: end-to-end proof that a freshly scaffolded game carries neither
 * defect — no absolute `file:` dependency path (which bakes the scaffolding
 * developer's home directory into the project and breaks `npm install`
 * everywhere else), and no manifest key naming a file the scaffold never
 * created.
 */
describe('initCommand — a scaffolded project is portable and has no dangling assets (issue 142)', () => {
  const { scaffold, read } = scaffoldSuite('bs-init-scaffold-', 'scaffold-defects-game', {
    withoutRulebook: true,
  });

  it('writes a relative boardsmith dependency path, never an absolute one', async () => {
    const projectPath = await scaffold();
    const link: string = JSON.parse(read('package.json')).dependencies.boardsmith;

    expect(link.startsWith('file:')).toBe(true);
    expect(link.startsWith('file:/')).toBe(false);
    // Resolves back to a real BoardSmith checkout from the project directory.
    expect(existsSync(join(projectPath, link.replace(/^file:/, ''), 'src', 'engine'))).toBe(true);
  });

  it("writes the in-browser smoke test, listing the table's two actions (#453)", async () => {
    await scaffold();
    const spec = read('tests/browser/smoke.spec.ts');
    expect(spec).toContain("import { defineSmokeTest } from 'boardsmith/testing/browser';");
    expect(spec).toContain("actions: ['draw', 'play'],");
    // #458: how to name an action no walk from a fresh game reaches, with the reason it needs.
    expect(spec).toMatch(/also named in `unreachable`, with a sentence saying why/);
    expect(spec).toContain("unreachable: { claimDraw: '");
    // #460: every game is dealt from a seed, and an action only some deals offer is reached by choosing one.
    expect(spec).toMatch(/deals every game from a seed, "smoke" unless `seed` names another/);
    expect(spec).toMatch(/choosing a seed whose deal offers it/);
    expect(spec).toContain("seed: ['smoke', '17'],");
    expect(spec).toMatch(/`unreachable` is for an action no walk from a fresh game reaches whatever the deal/);
    // #470: a field whose value the game checks gets it from `inputs`, a value or a function of the page.
    expect(spec).toMatch(/The walk types "smoke test" in a text field/);
    expect(spec).toContain("inputs: { attackPlayer: { target: async ({ texts }) => (await texts('.nearby li'))[0] } },");
    expect(spec).toMatch(/A value the game refuses still fails the walk/);
  });

  it('declares no manifest asset it did not create', async () => {
    await scaffold();
    const config = JSON.parse(read('boardsmith.json'));
    for (const key of ASSET_PATH_KEYS) {
      expect(config).not.toHaveProperty(key);
    }
  });

  it('passes the Asset Paths gate that now opens boardsmith.json', async () => {
    const result = await validateAssetPaths(await scaffold());
    expect(result.passed).toBe(true);
  });

  it('and that gate fails the moment a dangling asset path is added back', async () => {
    const projectPath = await scaffold();
    const configPath = join(projectPath, 'boardsmith.json');
    const config = JSON.parse(read('boardsmith.json'));
    config.thumbnail = './public/thumbnail.png';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const result = await validateAssetPaths(projectPath);
    expect(result.passed).toBe(false);
    expect((result.details ?? []).join('\n')).toContain('thumbnail');
  });
});


/**
 * BoardSmith #168: `boardsmith init --world` SCAFFOLDS A WORLD.
 *
 * The pitch is one npm install, one `boardsmith init`, and a game you develop
 * on your own laptop. It did not hold for the kind of game the whole
 * persistent-worlds effort is about: there was no world scaffold at all, so the
 * four world games that exist were each hand-built, and each hand-copied the
 * authoring contract into its own source (#164, #165).
 *
 * These assertions are on the three things that made those copies happen and
 * one thing that would make a new author's first hour a lie:
 *
 *   1. the manifest declares the world, since the block IS the declaration;
 *   2. the rules IMPORT the contract from `boardsmith/world` and re-declare
 *      none of it;
 *   3. the test drives the library rather than a hand-rolled fake runner;
 *   4. the project itself says how to run the world, because the terminal
 *      scrolls and the README keeps.
 */
describe('initCommand --world — a persistent world project (#168)', () => {
  const { scaffold: scaffoldWorld, read, has } = scaffoldSuite('bs-init-world-', 'tiny-world', {
    withoutRulebook: true,
    world: true,
  });

  it('declares the world BACKEND in boardsmith.json, which is how a game says it is one', async () => {
    await scaffoldWorld();
    const config = JSON.parse(read('boardsmith.json'));
    expect(config.backend).toBe('world');
    // And no world BLOCK: a world's capacity is the compiled rules' to declare
    // (#171), and the manifest's copy is derived from it at build.
    expect(config.world).toBeUndefined();
    expect(config.playerCount).toBeUndefined();
  });

  it('declares the seat count once, in the compiled rules the runtime enforces', async () => {
    await scaffoldWorld();
    expect(read('src/rules/world.ts')).toContain(
      `export const WORLD_SEATS = ${WORLD_SCAFFOLD_SEATS};`,
    );
  });

  it('writes the four files a world project is', async () => {
    await scaffoldWorld();
    for (const file of [
      'src/rules/world.ts',
      'world.html',
      'tests/world.test.ts',
      'src/ui/components/WorldBoard.vue',
    ]) {
      expect(has(file), `${file} is missing`).toBe(true);
    }
  });

  it("writes the in-browser smoke test, listing the world's one player verb (#453)", async () => {
    await scaffoldWorld();
    const spec = read('tests/browser/smoke.spec.ts');
    expect(spec).toContain("import { defineSmokeTest } from 'boardsmith/testing/browser';");
    expect(spec).toContain("actions: ['tend'],");
    expect(spec).toMatch(/add an action here in[\s/]*the same change that adds it to the rules/);
    // #471: an action that needs another player there is reached by playing seats the world brings together.
    expect(spec).toMatch(/In a world the walk plays one seat/);
    expect(spec).toContain('seats: [1, 4],');
    expect(spec).toMatch(/`otherSeats`/);
  });

  it('writes no table half — a world has no turn order, flow or action table', async () => {
    await scaffoldWorld();
    // The vestigial table halves the existing world games carry are what #174
    // is stripping out. A new world must not be handed one.
    for (const file of [
      'src/rules/actions.ts',
      'src/rules/flow.ts',
      'src/ui/App.vue',
      'index.html',
      'src/main.ts',
      'tests/game.test.ts',
    ]) {
      expect(has(file), `${file} should not be scaffolded`).toBe(false);
    }
  });

  it('DOES write src/ui/uis.ts — a world declares its boards like a table (#170)', async () => {
    await scaffoldWorld();
    const uis = read('src/ui/uis.ts');
    expect(uis).toContain('defineGameUIs');
    expect(uis).toContain('defaultUI(WorldBoard)');
    // AutoUI as a dev-only alternate: the shell's own renderer over the element
    // tree, which a world's view IS. It costs nothing in a production build.
    expect(uis).toContain("devUI(() => import('boardsmith/ui/auto-ui'))");
  });

  it("mounts WorldShell over that registry, not over a hand-rolled prop bag", async () => {
    await scaffoldWorld();
    const main = read('src/world-main.ts');
    expect(main).toContain('WorldShell');
    expect(main).toContain("./ui/uis.js");
  });

  it("scaffolds a BOARD, not a second action panel", async () => {
    await scaffoldWorld();
    const board = read('src/ui/components/WorldBoard.vue');
    // The shell draws the verbs. A board that read the offers and drew its own
    // buttons is the duplication #170 took out of four games.
    expect(board).not.toContain('validElements');
    expect(board).not.toContain("emit('act'");
    expect(board).toContain('gameView');
  });

  it('IMPORTS the contract from boardsmith/world and re-declares none of it', async () => {
    await scaffoldWorld();
    const world = read('src/rules/world.ts');
    expect(world).toContain("from 'boardsmith/world'");
    // A world's verbs are Actions (#169), and `worldAction()` is the door: an
    // action built any other way declares nothing, so the world would have to
    // load everything before it could offer it. The scaffold must start an
    // author on the builder that makes the declaration unavoidable.
    expect(world).toContain("import { worldAction, worldClockAction } from 'boardsmith/world'");
    // The exact defect #165 exists to end: every world game written before it
    // hand-copied these declarations, and the copies drifted from the runtime.
    for (const copied of [
      'interface WorldCommandHandler',
      'interface WorldCommandContext',
      'type WorldCommandArgument',
      'interface WorldEvent',
    ]) {
      expect(world, `${copied} is hand-copied instead of imported`).not.toContain(copied);
    }
  });

  it('registers the world block on gameDefinition, typed by GameDefinition', async () => {
    await scaffoldWorld();
    const index = read('src/rules/index.ts');
    expect(index).toContain('world: { maxPlayers: WORLD_SEATS, actions: worldActions, genesis: worldGenesis, view: worldView }');
    expect(index).toContain('GameDefinition');
  });

  it('scaffolds a test that DRIVES the library, not a hand-rolled runner', async () => {
    await scaffoldWorld();
    const test = read('tests/world.test.ts');
    // `createWorld` is the one function every host calls — the platform's
    // runner and `boardsmith dev` alike. A test that called the
    // command handlers itself would prove only that the author can call their
    // own functions, which is what all four existing world games do.
    expect(test).toContain("from 'boardsmith/world'");
    expect(test).toContain('createWorld(');
    // Built the way a host builds one: with the world's element id key, minted
    // once for the world and passed on every launch (#482).
    expect(test).toContain('mintWorldElementIdKey()');
    expect(test).toContain('elementIdKey: ELEMENT_ID_KEY');
    expect(test).toContain('runner.genesis()');
    expect(test).toContain('runner.declare(');
    expect(test).toContain('runner.apply(');
    expect(test).toContain('runner.serialize(');
    expect(test).toContain('runner.viewsFor(');
    // And it drives the declaration with the library's own loops rather than
    // deciding for itself when a world has finished loading: `walkDeclaration`
    // for an action's ordered walk, `settleDeclaration` for a view's fixpoint.
    expect(test).toContain('walkDeclaration(');
    expect(test).toContain('settleDeclaration(');
    // The shape of a hand-rolled runner: reaching into the world's own action
    // list and calling a handler with a context the test invented.
    expect(test).not.toContain('worldActions[');
  });

  it("serves the world's own surface from world.html, not the table's index.html", async () => {
    await scaffoldWorld();
    expect(read('world.html')).toContain('/src/world-main.ts');
    // The mount is `src/world-main.ts` itself now: `WorldApp.vue` was one more
    // file whose only job was to name the shell and hand it a board, and the
    // registry does that (#170).
    expect(read('src/world-main.ts')).toContain('WorldShell');
    expect(has('src/ui/WorldApp.vue')).toBe(false);
  });

  it('tells the author, in the project itself, how to run the world (#167)', async () => {
    await scaffoldWorld();
    // The terminal scrolls; the README keeps. This block said the opposite
    // until #167 -- "what does not work yet: boardsmith dev" -- and an author
    // who is told the stale half discovers the truth by not trying.
    const readme = read('README.md');
    expect(readme).toContain('boardsmith dev');
    expect(readme).toContain('boardsmith dev --reset');
    expect(readme).toContain('boardsmith test');
    expect(readme.toLowerCase()).not.toContain('does not work yet');
  });

  it('leaves an ordinary game project untouched', async () => {
    await scaffoldWorld('table-game', { withoutRulebook: true });
    expect(JSON.parse(read('boardsmith.json')).world).toBeUndefined();
    expect(has('src/rules/world.ts')).toBe(false);
    expect(has('index.html')).toBe(true);
  });
});

/**
 * #240: `init` treated `<name>` as an identity and as a location at once, and
 * reported the resulting failure by printing the whole Error object.
 *
 * Both halves are driven through `initCommand` itself rather than through the
 * validator, because what the issue reported is what the command DID: it
 * created a directory at a path nobody asked for, or dumped a stack trace with
 * this repository's paths in it.
 */
describe('init command — <name> is a name, and a failure is one clean line (#240)', () => {
  const originalCwd = process.cwd();
  let exitSpy: MockInstance<typeof process.exit>;
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    // `process.exit` would take the test runner with it, so the spy both keeps
    // the suite alive and records that the command reached for it at all.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0}) was called instead of throwing`);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
  });

  it('refuses a path-shaped name and creates nothing', async () => {
    const parentDir = tempTree('bs-init-240-path-');
    process.chdir(parentDir);

    await expect(initCommand('/private/tmp/scratch/mygame', { withoutRulebook: true }))
      .rejects.toThrow(/path, not a name/);

    // The reported behaviour: `join(process.cwd(), name)` appended the absolute
    // path to the invocation directory, so a `private/` tree appeared here.
    expect(existsSync(join(parentDir, 'private'))).toBe(false);
    expect(readdirSync(parentDir)).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('refuses a name that would scaffold TypeScript that cannot parse', async () => {
    const parentDir = tempTree('bs-init-240-invalid-');
    process.chdir(parentDir);

    await expect(initCommand('My Game', { withoutRulebook: true })).rejects.toThrow(/kebab-case/);
    expect(readdirSync(parentDir)).toEqual([]);
  });

  it('reports a failure as a thrown message, never as a printed Error object', async () => {
    // A directory that cannot be written into is the issue's own repro reduced
    // to something a test can cause: `mkdir` fails, and the old `catch` printed
    // the ENOENT/EACCES object -- `at async Command.initCommand (/Users/.../
    // src/cli/commands/init.ts:290:5)` and all -- then exited before `cli.ts`'s
    // top-level handler could render it as one line.
    const parentDir = tempTree('bs-init-240-unwritable-');
    process.chdir(parentDir);
    chmodSync(parentDir, 0o500);

    try {
      const message = await rejectionMessage(initCommand('mygame', { withoutRulebook: true }));

      // Descriptive and actionable, and about the user's project.
      expect(message).toContain('mygame');
      // And nothing about how BoardSmith is built: no stack frames, no source
      // line references, no path inside the CLI's own installation.
      expect(message).not.toMatch(/\n\s+at /);
      expect(message).not.toMatch(/\.ts:\d+/);
      expect(message).not.toContain('node_modules');
      expect(message).not.toContain(originalCwd);

      // The guarantee itself: the failure is thrown for `cli.ts` to render,
      // not printed and exited past it.
      expect(exitSpy).not.toHaveBeenCalled();
      for (const call of errorSpy.mock.calls) {
        expect(call.some((arg) => arg instanceof Error)).toBe(false);
      }
    } finally {
      chmodSync(parentDir, 0o700);
    }
  });

  it('refuses an already-existing directory by throwing, like every other failure', async () => {
    const parentDir = tempTree('bs-init-240-exists-');
    process.chdir(parentDir);
    mkdirSync(join(parentDir, 'mygame'));

    await expect(initCommand('mygame', { withoutRulebook: true })).rejects.toThrow(/already exists/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('refuses --additional-source without --rulebook, before anything is created (#305)', async () => {
    const parentDir = tempTree('bs-init-305-no-primary-');
    process.chdir(parentDir);

    const message = await rejectionMessage(
      initCommand('mygame', { withoutRulebook: true, additionalSource: [join(parentDir, 'ref.md')] }),
    );
    expect(message).toMatch(/--additional-source needs --rulebook/);
    expect(readdirSync(parentDir)).toEqual([]);
  });

  it('refuses a missing rulebook decision by throwing, so the message survives to the terminal', async () => {
    const parentDir = tempTree('bs-init-240-rulebook-');
    process.chdir(parentDir);

    await expect(initCommand('mygame', {})).rejects.toThrow(/--without-rulebook/);
    expect(readdirSync(parentDir)).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

/**
 * `initCommand` owns the directory it creates, so a failure after that point
 * must not leave it behind (#242).
 *
 * The clearest repro is an unreadable `--rulebook`, because the archive is
 * `init`'s LAST step: the whole project is already written when it fails. What
 * was left was a scaffolded project whose `rulebook/INDEX.md` provenance header
 * describes an archive that does not exist -- the state `init.ts`'s own comment
 * calls worse than a failed init -- and it is exactly the shape `init` refuses
 * to overwrite, so the retry the user reaches for failed on a second, different
 * error. Same shape as `packAll` (#239): remove the tree this run had to
 * create, keep a directory that was already the user's.
 */
describe('initCommand — a failed init leaves nothing behind (#242)', () => {
  const originalCwd = process.cwd();
  let written: string[];

  beforeEach(() => {
    // ora writes the spinner to stderr and the scaffold logs to stdout, so both
    // are collected: the assertion is about what the USER saw, in order.
    written = [];
    const capture = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture as never);
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => capture(args.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
  });

  it('removes the project directory it created when a later step fails', async () => {
    const parentDir = tempTree('bs-init-242-cleanup-');
    process.chdir(parentDir);

    await expect(
      initCommand('mygame', { rulebook: join(parentDir, 'nonexistent', 'rules.pdf') }),
    ).rejects.toThrow(/Rulebook not found or unreadable/);

    expect(existsSync(join(parentDir, 'mygame'))).toBe(false);
    expect(readdirSync(parentDir)).toEqual([]);
  });

  it('never claims success before a step that can still fail', async () => {
    const parentDir = tempTree('bs-init-242-ordering-');
    process.chdir(parentDir);

    await expect(
      initCommand('mygame', { rulebook: join(parentDir, 'nonexistent', 'rules.pdf') }),
    ).rejects.toThrow(/Rulebook not found or unreadable/);

    // The reported output said both `Created mygame successfully!` and
    // `Failed to create project`, in that order. A command that says both is
    // worse than one that says neither.
    expect(written.join('')).not.toContain('successfully');
  });

  it('keeps a directory that was already there, because that one is the user\'s', async () => {
    const parentDir = tempTree('bs-init-242-preexisting-');
    process.chdir(parentDir);
    mkdirSync(join(parentDir, 'mygame'));
    writeFileSync(join(parentDir, 'mygame', 'the-users-file.txt'), 'not ours to delete');

    await expect(
      initCommand('mygame', { rulebook: join(parentDir, 'nonexistent', 'rules.pdf') }),
    ).rejects.toThrow(/already exists/);

    expect(existsSync(join(parentDir, 'mygame', 'the-users-file.txt'))).toBe(true);
  });
});

/**
 * `init --into-existing` scaffolds into the git repository it is run from (#304).
 *
 * A game often starts as a repository of design research, with history and a
 * remote, before anyone runs BoardSmith. Without this flag the only route was to
 * run `init` elsewhere and copy the tree in by hand, which silently dropped the
 * ingest `pre-commit` hook `init` installs.
 */
describe('initCommand --into-existing — scaffold into the repository you are in (#304)', () => {
  const originalCwd = process.cwd();
  const GIT = '-c user.name=Test -c user.email=test@example.com';

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
  });

  /** A research repository: one committed notes file, nothing BoardSmith. */
  function researchRepo(prefix: string): string {
    const repo = join(tempTree(prefix), 'research');
    mkdirSync(repo);
    writeFileSync(join(repo, 'notes.md'), '# Design notes\n');
    execSync(`git init -q && git add -A && git ${GIT} commit -q -m research`, { cwd: repo });
    return repo;
  }

  function rulebook(): string {
    const path = join(tempTree('bs-init-304-rulebook-'), 'rules.txt');
    writeFileSync(path, 'Each player draws five cards.\n');
    return path;
  }

  /** Every file under `root`, relative, with its bytes. `.git/` is read too unless skipped. */
  function snapshot(root: string, skipGit = false): Map<string, string> {
    const files = new Map<string, string>();
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = join(entry.parentPath, entry.name);
      const rel = full.slice(root.length + 1);
      if (skipGit && rel.split('/')[0] === '.git') continue;
      files.set(rel, readFileSync(full, 'base64'));
    }
    return files;
  }

  const head = (repo: string): string =>
    execSync('git rev-list --all', { cwd: repo, encoding: 'utf-8' }).trim();

  it('produces the same tree and hook as a fresh init, and leaves history alone', async () => {
    const source = rulebook();

    const parent = tempTree('bs-init-304-fresh-');
    process.chdir(parent);
    await initCommand('sample-game', { rulebook: source, edition: 'First' });
    const fresh = join(parent, 'sample-game');

    const repo = researchRepo('bs-init-304-into-');
    const history = head(repo);
    process.chdir(repo);
    await initCommand('sample-game', { rulebook: source, edition: 'First', intoExisting: true });

    const scaffolded = snapshot(repo, true);
    expect(scaffolded.get('notes.md')).toBe(Buffer.from('# Design notes\n').toString('base64'));
    scaffolded.delete('notes.md');
    expect(scaffolded).toEqual(snapshot(fresh, true));

    const hook = (root: string) => readFileSync(join(root, '.git', 'hooks', 'pre-commit'), 'utf-8');
    expect(hook(repo)).toBe(hook(fresh));
    expect(hook(repo)).toContain('BoardSmith ingest synthesis');

    // No `git init` and no scaffold commit: the research history is exactly as it was, and the
    // scaffold is left for the designer to review and commit.
    expect(head(repo)).toBe(history);
    const untracked = execSync('git status --porcelain', { cwd: repo, encoding: 'utf-8' });
    expect(untracked).toContain('?? package.json');
  });

  it('changes nothing and names every conflicting path when a scaffold file already exists', async () => {
    const repo = researchRepo('bs-init-304-conflict-');
    writeFileSync(join(repo, '.gitignore'), 'secrets/\n');
    writeFileSync(join(repo, 'tsconfig.json'), '{}\n');
    mkdirSync(join(repo, 'design', 'rulebook'), { recursive: true });
    writeFileSync(join(repo, 'design', 'rulebook', 'INDEX.md'), '# mine\n');
    const before = snapshot(repo);
    process.chdir(repo);

    const message = await rejectionMessage(
      initCommand('sample-game', { rulebook: rulebook(), intoExisting: true }),
    );

    expect(message).toContain('.gitignore');
    expect(message).toContain('tsconfig.json');
    expect(message).toContain(join('design', 'rulebook', 'INDEX.md'));
    expect(message).not.toContain('package.json');
    expect(snapshot(repo)).toEqual(before);
  });

  it('treats an additional source already archived in the repository as a conflict, changing nothing (#305)', async () => {
    const repo = researchRepo('bs-init-305-conflict-');
    mkdirSync(join(repo, 'design', 'rulebook', 'source'), { recursive: true });
    writeFileSync(join(repo, 'design', 'rulebook', 'source', 'reference.txt'), 'copied by hand\n');
    const before = snapshot(repo);
    const reference = join(tempTree('bs-init-305-reference-'), 'reference.txt');
    writeFileSync(reference, 'Battles follow this reference.\n');
    process.chdir(repo);

    const message = await rejectionMessage(
      initCommand('sample-game', { rulebook: rulebook(), additionalSource: [reference], intoExisting: true }),
    );

    expect(message).toContain(join('design', 'rulebook', 'source', 'reference.txt'));
    expect(snapshot(repo)).toEqual(before);
  });

  it('refuses a directory that is not the top of a git repository, and creates nothing', async () => {
    const plain = tempTree('bs-init-304-plain-');
    process.chdir(plain);
    await expect(
      initCommand('sample-game', { withoutRulebook: true, intoExisting: true }),
    ).rejects.toThrow(/not the top folder of a git repository/);
    expect(readdirSync(plain)).toEqual([]);

    const repo = researchRepo('bs-init-304-nested-');
    const nested = join(repo, 'game');
    mkdirSync(nested);
    const before = snapshot(repo);
    process.chdir(nested);
    await expect(
      initCommand('sample-game', { withoutRulebook: true, intoExisting: true }),
    ).rejects.toThrow(/not the top folder of a git repository/);
    expect(snapshot(repo)).toEqual(before);
  });

  it('leaves the repository exactly as it was when a later step fails', async () => {
    const repo = researchRepo('bs-init-304-failure-');
    const before = snapshot(repo);
    process.chdir(repo);

    await expect(
      initCommand('sample-game', { rulebook: join(repo, 'missing', 'rules.pdf'), intoExisting: true }),
    ).rejects.toThrow(/Rulebook not found or unreadable/);

    expect(snapshot(repo)).toEqual(before);
    expect(readdirSync(repo).sort()).toEqual(['.git', 'notes.md']);
  });

  it("keeps a pre-commit hook the designer already has, as a fresh init does", async () => {
    const repo = researchRepo('bs-init-304-hook-');
    const own = '#!/bin/sh\necho mine\n';
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), own);
    process.chdir(repo);

    await initCommand('sample-game', { withoutRulebook: true, intoExisting: true });

    expect(readFileSync(join(repo, '.git', 'hooks', 'pre-commit'), 'utf-8')).toBe(own);
    expect(existsSync(join(repo, 'boardsmith.json'))).toBe(true);
  });
});

/**
 * Scaffolds the #309 game and loads its rules once, while the file is
 * collected, where no test timeout applies (#428). The rules module sits at a
 * new path, so importing it transforms it and everything it reaches through
 * `node_modules/boardsmith` for the first time; inside a test that ran into
 * the 5 s timeout on a busy machine (#354, #355, #363, #417).
 *
 * Warnings shown while the module loads are kept, so the tests still see them.
 */
async function loadScaffoldedRules() {
  const originalCwd = process.cwd();
  const shown = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { projectPath } = await scaffoldProject('bs-init-309-', 'warning-free-game', { withoutRulebook: true });
    // `"boardsmith": "file:..."` installs as a symlink to the checkout.
    mkdirSync(join(projectPath, 'node_modules'));
    symlinkSync(join(__dirname, '..', '..', '..'), join(projectPath, 'node_modules', 'boardsmith'), 'dir');
    // Dynamic import: the rules module is the one this scaffold just wrote.
    const rules = await import(join(projectPath, 'src', 'rules', 'index.ts'));
    return { gameClass: rules.gameDefinition.gameClass, loadWarnings: shown.mock.calls.map((call) => String(call[0])) };
  } finally {
    shown.mockRestore();
    process.chdir(originalCwd);
  }
}

const scaffolded309 = await loadScaffoldedRules();

/**
 * BoardSmith #309: A FRESHLY SCAFFOLDED GAME PLAYS WITHOUT A WARNING.
 *
 * The scaffold's turn is two same-seat action steps, draw then play. With no
 * `turnScope` on the second, the engine cannot tell whether the seat is still
 * taking the same turn, so the first draw printed a dev warning and left undo
 * off for the rest of that turn. The scaffold is the template every author
 * copies, so its first run must not tell them their game is wrong.
 *
 * This drives the real scaffolded rules, not the template text: it links the
 * project's `boardsmith` dependency the way `npm install` does and plays the
 * game the command wrote.
 */
describe('initCommand — a scaffolded game plays with no warnings (#309)', () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    // Warnings are shown once per key per process; start from none shown so an
    // earlier test cannot have used up the one this test is looking for.
    _clearShownWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const newGame = () =>
    createTestGame(scaffolded309.gameClass, { playerCount: 2, seed: 'issue-309' });

  const warnings = () => [...scaffolded309.loadWarnings, ...warn.mock.calls.map((call) => String(call[0]))];

  it("plays the first turn, draw then play, without a warning", () => {
    const game = newGame();

    game.doAction(1, 'draw');
    const [card] = game.action('play', 1).getChoices('card');
    game.action('play', 1).select('card', card).execute();

    expect(warnings()).toEqual([]);
  });

  it('plays to the end without a warning', async () => {
    const results = await simulateRandomGames(scaffolded309.gameClass, {
      count: 1,
      playerCounts: [2],
      seed: 'issue-309',
    });

    expect(results.games.map((g) => g.error)).toEqual([undefined]);
    expect(results.completed).toBe(1);
    expect(warnings()).toEqual([]);
  });
});
