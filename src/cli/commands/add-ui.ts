import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import chalk from 'chalk';

import { getProjectContext, loadGameDefinition } from './game-runtime.js';
import { constructGame } from '../../engine/element/game.js';
import { withCommandBuildDir } from '../lib/command-build-dir.js';
import { requireGameProjectManifests, requireRulesIndex, resolveRulesDir } from '../lib/game-project.js';
import { tableUiFiles } from '../lib/project-scaffold.js';
import { resolveWorldMode } from '../lib/world-project.js';

/**
 * `boardsmith add-ui`: writes a table's UI into a project `boardsmith init --sim` started without
 * one, the same files `boardsmith init` writes for a table. The smoke spec lists the actions the
 * rules register now, read from the loaded game. Refuses, writing nothing, when any of the files
 * already exists.
 */
export async function addUiCommand(): Promise<void> {
  const cwd = process.cwd();
  const { config } = requireGameProjectManifests(cwd);
  if (resolveWorldMode(config)) {
    throw new Error(
      'This project is a persistent world, and `boardsmith init --world` already wrote its UI ' +
        '(world.html and src/ui/). `boardsmith add-ui` adds the UI of a table game.',
    );
  }
  const uiConfig = { displayName: String(config.displayName || config.name) };

  // Refused before the rules load: which files the UI is does not depend on the game's actions.
  const existing = tableUiFiles(uiConfig, [])
    .map((file) => file.path)
    .filter((path) => existsSync(join(cwd, path)));
  if (existing.length > 0) {
    throw new Error(
      'This project already has some of the UI files `boardsmith add-ui` writes, so nothing was changed:\n' +
        existing.map((path) => `  ${path}`).join('\n') +
        '\nMove or rename them, run add-ui again, then merge anything you still need back in.',
    );
  }

  const rulesPath = resolveRulesDir(cwd, config);
  requireRulesIndex(rulesPath);
  const { gameDefinition } = await withCommandBuildDir(cwd, 'add-ui', (buildDir) =>
    loadGameDefinition(rulesPath, buildDir, getProjectContext(cwd)),
  );
  const game = constructGame(gameDefinition.gameClass, { playerCount: gameDefinition.minPlayers ?? 1, seed: 'add-ui' });
  const files = tableUiFiles(uiConfig, game.getActionNames());

  for (const file of files) {
    await mkdir(dirname(join(cwd, file.path)), { recursive: true });
    await writeFile(join(cwd, file.path), file.content);
  }
  console.log(chalk.green('Added the UI:'));
  for (const file of files) console.log(chalk.dim(`  ${file.path}`));
  console.log(`\nRun ${chalk.cyan('boardsmith dev')} to play the game in your browser.`);
}
