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
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateGameTs, generateTestTs, initCommand } from './init.js';

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

  it('init.ts has no InitOptions.template field (the InitOptions type itself is gone)', () => {
    const initSrc = readFileSync(join(__dirname, 'init.ts'), 'utf-8');
    expect(initSrc).not.toContain('template');
    expect(initSrc).not.toContain('InitOptions');
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
    await initCommand('git-init-test-game');
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
      await expect(initCommand('git-init-noid-game')).resolves.toBeUndefined();
      const projectPath = join(parentDir, 'git-init-noid-game');
      // Scaffold survives, the repo exists, but no commit was made.
      expect(existsSync(join(projectPath, 'package.json'))).toBe(true);
      expect(existsSync(join(projectPath, '.git'))).toBe(true);
    } finally {
      process.env = prev;
    }
  });
});
