/**
 * #1121: `boardsmith dev` shows the author what a crashing action threw.
 *
 * The CLI runs with NODE_ENV unset, as a designer's shell has it (vitest sets it to `test`, so it
 * is unset here for the file). The dev rules worker marks itself `development`, so the page gets
 * the thrown text after the player's sentence; the same rules run with this process's environment,
 * as a production executor does, still answer the sentence alone.
 */
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';

import { NOTHING_CHANGED, rulesErrorSentence } from '../../engine/action/rules-error.js';
import { buildRuntimeBundle, cliSourceFile, toPosix } from '../commands/game-runtime.js';
import { rulesProject } from './rules-project.test-helper.js';
import { openTable, tableProject } from './table-host.test-helper.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const vitestNodeEnv = process.env.NODE_ENV;
delete process.env.NODE_ENV;
afterAll(() => {
  process.env.NODE_ENV = vitestNodeEnv;
});

const THROWN = 'the deck is empty';

const RULES = [
  "import { Action, Game, Player, actionStep, loop, type GameOptions } from 'boardsmith';",
  'export class CrashGame extends Game<CrashGame, Player> {',
  '  constructor(options: GameOptions) {',
  '    super(options);',
  `    this.registerAction(Action.create('draw').execute(() => { throw new Error('${THROWN}'); }));`,
  "    this.setFlow({ root: loop({ name: 'turns', maxIterations: 50, do: actionStep({ name: 'a', actions: ['draw'] }) }) });",
  '  }',
  '}',
  "export const gameDefinition = { gameClass: CrashGame, gameType: 'dev-detail-crash', minPlayers: 1, maxPlayers: 1 };",
].join('\n');

describe('#1121: a crashing action in boardsmith dev', () => {
  it('shows the page the thrown message after the player sentence', async () => {
    const runtime = await tableProject('bs-dev-detail-', RULES).load();
    try {
      const table = await openTable(runtime, createDevHostClientMemory(), { makeSeed: () => 'dev-detail' });
      const answer = await table.act('draw');
      expect(answer?.success).toBe(false);
      expect(answer?.error).toContain(rulesErrorSentence('draw'));
      expect(answer?.error).toContain(THROWN);
      expect(process.env.NODE_ENV).toBeUndefined();
    } finally {
      await runtime.close();
    }
  }, 60_000);

  it('answers only the player sentence where the rules run outside the dev host', async () => {
    const { rulesPath, tempDir } = rulesProject('bs-dev-detail-prod-', RULES);
    const session = JSON.stringify(toPosix(cliSourceFile('../session/index.ts')));
    const bundlePath = await buildRuntimeBundle({
      rulesPath,
      tempDir,
      name: 'prod',
      context: 'monorepo',
      exports: [`export { executeOp } from ${session};`],
    });
    // A worker with this process's environment, NODE_ENV unset, as any executor but the dev host's.
    const worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads');
      import(workerData).then(async ({ gameDefinition, executeOp }) => {
        const options = { playerCount: 1, seed: 'prod' };
        const started = await executeOp(gameDefinition, options, null, null, { type: 'start' });
        parentPort.postMessage(await executeOp(gameDefinition, options, started.snapshot, null,
          { type: 'action', actionName: 'draw', player: 1, args: {} }));
      });`,
      { eval: true, workerData: pathToFileURL(bundlePath).href },
    );
    try {
      const answer = await new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      expect(answer.success).toBe(false);
      expect(answer.error).toBe(`${rulesErrorSentence('draw')} ${NOTHING_CHANGED}`);
    } finally {
      await worker.terminate();
    }
  }, 60_000);
});
