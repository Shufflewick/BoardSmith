/**
 * A game that installs BoardSmith compiles this source with Vite, which reads
 * no tsconfig for a file under node_modules and so compiles class fields
 * without define semantics. There a field with no initializer does not exist on
 * a new instance, and `create()` refused the engine's own attributes (#1786).
 * This bundles the engine the way that install compiles it and builds a game.
 */
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { tempTree } from '../testing/temp-tree.test-helper.js';

// Links the source the bundle reads, so `vitest run --changed` runs this when one changes; nothing loads.
import.meta.glob(['/src/**/*.ts', '!**/*.test.ts', '!**/*.test-helper.ts']);

const tree = tempTree('bs-class-field-mode-');
const bundle = join(tree, 'engine.mjs');
writeFileSync(bundle, (await build({
  entryPoints: [join(import.meta.dirname, 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'esnext',
  write: false,
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
})).outputFiles[0].text);
// Dynamic import: the bundle under test is a file this test wrote.
const engine = (await import(pathToFileURL(bundle).href)) as typeof import('./index.js');

class InstalledGame extends engine.Game<InstalledGame, InstanceType<typeof engine.Player>> {}

it('builds a game and its elements when compiled without define semantics for class fields, as an installed game compiles it', () => {
  const game = new InstalledGame({ playerCount: 2, playerNames: ['Ada', 'Bo'], seed: 'installed' });
  const die = game.create(engine.Die, 'd6', { sides: 6 });
  const hand = game.create(engine.Space, 'hand', { player: game.players[0] });
  const piece = game.create(engine.Piece, 'pawn', { row: 1, column: 2 });

  expect(game.players.map((player) => player.seat)).toEqual([1, 2]);
  expect([die.sides, hand.player, piece.row, piece.column]).toEqual([6, game.players[0], 1, 2]);
});
