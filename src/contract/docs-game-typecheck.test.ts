/**
 * THE GAME CODE THE DOCS TEACH, COMPILED AND RUN AS A GAME (#511).
 *
 * An author's first code is copied from `docs/getting-started.md`. Nothing
 * checked those blocks, so they drifted with every API change: the actions
 * example stopped compiling (`Action.create('play')` without the game type
 * makes `ctx.player` the base `Player`) and the flow example threw the moment
 * its `loop()` was built (no `maxIterations`).
 *
 * A block marked `<!-- typecheck: game <path> -->` is written to `<path>` in a
 * sandbox game holding what a consumer's install holds, one game per doc, and
 * compiled under the tsconfig `boardsmith init` writes. Compiling cannot see
 * what throws at construction, so the getting-started game is also built and
 * played one turn.
 *
 * The aspect templates `/design-game` copies game code from
 * (`src/cli/slash-command/aspects/*.md`) mark theirs the same way (#645): the
 * square-grid one taught a `from` that handed an array where one element goes.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { TestGame } from '../testing/index.js';
import type { Game, GameOptions, Player } from '../engine/index.js';
import { consumerInstall, declaredPeers } from './consumer-install.test-helper.js';
import { gameBlockFiles, gameTsConfig, markedDocBlocks } from './doc-typecheck-blocks.test-helper.js';
import { expectCleanCompile } from './vue-tsc-run.test-helper.js';

const blocks = markedDocBlocks('game');
const root = consumerInstall({ entryPoints: [], alsoInstalled: declaredPeers() });
for (const [path, code] of gameBlockFiles(blocks)) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
}
writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig(['docs/**/*.ts', 'src/cli/slash-command/aspects/**/*.ts']));
// Loaded here, not in the test, so a busy machine's slow import meets no test timeout (#1069).
const { MyGame } = (await import(join(root, 'docs/getting-started/src/rules/game.ts'))) as {
  MyGame: new (options: GameOptions) => Game & { deck: { count(): number } };
};

describe('the game code the docs teach (#511)', () => {
  it('marks the getting-started rules for compiling', () => {
    expect(
      blocks.filter((block) => block.doc === 'docs/getting-started').map((block) => block.path),
    ).toEqual(['src/rules/game.ts', 'src/rules/elements.ts', 'src/rules/actions.ts', 'src/rules/flow.ts']);
  });

  it('marks the game code of every aspect template for compiling (#645)', () => {
    for (const aspect of ['dice', 'hex-grid', 'playing-cards', 'square-grid']) {
      expect(
        blocks.filter((block) => block.doc === `src/cli/slash-command/aspects/${aspect}`).map((block) => block.path),
        aspect,
      ).toEqual(['src/rules/game.ts', 'src/rules/elements.ts', 'src/rules/actions.ts']);
    }
  });

  it('reports zero vue-tsc errors for every block the docs mark as game code', () => {
    expectCleanCompile(
      root,
      'game.tsconfig.json',
      'the game code the docs and aspect templates mark with "<!-- typecheck: game <path> -->" ' +
        '(<doc>/<path> is that block of <doc>.md)',
      'Fix the doc, not this test: a block an author copies must compile in their game as written, with ' +
        'its imports and the game type its builders take.',
    );
  }, 180_000);

  it('plays the getting-started game to the end it declares, before the loop\'s tripwire', () => {
    const game = TestGame.create(MyGame, { playerCount: 2, seed: 'getting-started' });

    // 52 cards, 5 dealt to each of 2 players: 42 draws empty the deck, 21 rounds of the 100 allowed.
    let draws = 0;
    while (!game.isComplete()) {
      const seat = game.getCurrentPlayer()!.seat;
      game.action('draw', seat).execute();
      draws += 1;
      if (game.isComplete()) break;
      const [card] = game.action('play', seat).getChoices('card');
      game.action('play', seat).select('card', card).execute();
    }

    expect(draws).toBe(42);
    expect(game.game.isFinished()).toBe(true);
    expect(game.game.deck.count()).toBe(0);
    const players = game.getPlayers() as Array<Player & { score: number }>;
    const best = Math.max(...players.map((player) => player.score));
    expect(best).toBeGreaterThan(0);
    expect(game.getWinners().map((player) => player.seat)).toEqual(
      players.filter((player) => player.score === best).map((player) => player.seat),
    );
  });
});
