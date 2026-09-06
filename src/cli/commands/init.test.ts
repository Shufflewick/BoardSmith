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
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateGameTs, generateTestTs, initCommand, type InitOptions } from './init.js';

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
  const parentDir = mkdtempSync(join(tmpdir(), prefix));
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
    if (parentDir) rmSync(parentDir, { recursive: true, force: true });
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
    if (parentDir) rmSync(parentDir, { recursive: true, force: true });
  });

  it('initializes a git repository in the scaffolded project directory', async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'bs-init-git-'));
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
    parentDir = mkdtempSync(join(tmpdir(), 'bs-init-git-noid-'));
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

  it('declares the world in boardsmith.json, which is how a game says it is one', async () => {
    await scaffoldWorld();
    const config = JSON.parse(read('boardsmith.json'));
    expect(config.world).toEqual({ maxPlayers: WORLD_SCAFFOLD_SEATS });
  });

  it('declares the same seat count in the compiled rules as in the manifest', async () => {
    await scaffoldWorld();
    // Two doors, and they must agree: `boardsmith validate` reads the manifest
    // and the runtime reads the rules, so a world whose numbers differ is
    // refused at whichever one the host happens to check.
    const config = JSON.parse(read('boardsmith.json'));
    expect(read('src/rules/world.ts')).toContain(
      `export const WORLD_SEATS = ${config.world.maxPlayers};`,
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
    expect(index).toContain('world: { actions: worldActions, genesis: worldGenesis, view: worldView }');
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
