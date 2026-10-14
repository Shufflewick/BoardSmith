/**
 * A table-game project for the `boardsmith simulate` variant and worker tests (#556): the
 * {@link ScoreGame} fixture with its metrics, the `target` (designer-only, #687), `limit` and
 * `breakInProduction` game options declared in its boardsmith.json (#701), its amounts read from `src/rules/data/amounts.csv` (1, 2 and 3) through `?raw`, a
 * `biggest` greedy policy and a `steady` class policy. `data/one.csv` and `data/three.csv` are
 * replacements for the amounts file, and `src/rules/data/unused.csv` is a data file the rules
 * never import.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const here = dirname(fileURLToPath(import.meta.url));

export function scoreProject(): string {
  const dir = tempTree('boardsmith-simulate-score-');
  const files: Record<string, string> = {
    'boardsmith.json': JSON.stringify({
      name: 'score',
      backend: 'table',
      gameOptions: [
        { id: 'target', type: 'number', label: 'Target', default: 6, designerOnly: true },
        { id: 'limit', type: 'number', label: 'Limit', default: 1000 },
        { id: 'breakInProduction', type: 'boolean', label: 'Break in production', default: false },
      ],
    }),
    'src/rules/index.ts': [
      `import { ScoreGame, scoreMetrics } from ${JSON.stringify(resolve(here, 'simulate.fixture.ts'))};`,
      `import amountsCsv from './data/amounts.csv?raw';`,
      `const amounts = amountsCsv.trim().split('\\n').slice(1).map(Number);`,
      `class CsvScoreGame extends ScoreGame { constructor(options) { super({ ...options, amounts }); } }`,
      `export const gameDefinition = { gameClass: CsvScoreGame, gameType: 'score', displayName: 'Score',`,
      `  minPlayers: 2, maxPlayers: 3, metrics: scoreMetrics };`,
    ].join('\n'),
    'src/rules/data/amounts.csv': 'amount\n1\n2\n3\n',
    'src/rules/data/unused.csv': 'amount\n2\n',
    'data/one.csv': 'amount\n1\n',
    'data/three.csv': 'amount\n3\n',
    'src/sim/index.ts': [
      `import { greedy } from ${JSON.stringify(resolve(here, '../../sim/index.ts'))};`,
      `import { random } from ${JSON.stringify(resolve(here, '../../sim/index.ts'))};`,
      // A class policy, which only works when it is called as a method of itself.
      `class Steady { name = 'steady'; inner = random(); choose(turn) { return this.inner.choose(turn); } }`,
      `export const policies = { biggest: greedy((_game, move) => Number(move.args.amount)), steady: new Steady() };`,
    ].join('\n'),
  };
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}
