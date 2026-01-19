import { existsSync, readFileSync, mkdirSync, rmSync, watch } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createServer as createViteServer } from 'vite';
import type { Plugin as VitePlugin } from 'vite';
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import chalk from 'chalk';
import open from 'open';

import { createLocalServer, type LocalServer, type GameDefinition } from '../local-server.js';

/**
 * Detect if we're running in the BoardSmith monorepo or a standalone game project.
 * - Monorepo: Has src/engine/ directory (collapsed structure)
 * - Standalone: Has boardsmith.json but no src/engine/
 */
function getProjectContext(cwd: string): 'monorepo' | 'standalone' {
  const hasSrcEngine = existsSync(join(cwd, 'src', 'engine'));
  const hasBoardsmithJson = existsSync(join(cwd, 'boardsmith.json'));

  // If we're in the monorepo root, it has src/engine
  if (hasSrcEngine) return 'monorepo';

  // Standalone game project
  if (hasBoardsmithJson) return 'standalone';

  // Fallback - treat as standalone (will fail with proper error if neither)
  return 'standalone';
}

interface DevOptions {
  port: string;
  players: string;
  workerPort: string;
  ai?: string[];
  aiLevel?: string;
  lobby?: boolean;
  persist?: string | boolean;
  debug?: boolean;
}

interface BoardSmithConfig {
  name: string;
  displayName?: string;
  minPlayers?: number;
  maxPlayers?: number;
  playerCount?: { min: number; max: number };
  rulesPackage?: string;
  paths?: {
    rules?: string;
    ui?: string;
  };
}

async function createGame(workerPort: number, gameType: string, playerCount: number, playerNames: string[]): Promise<string | null> {
  console.log(chalk.dim(`  Creating game (type: ${gameType}, players: ${playerCount})...`));
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`http://localhost:${workerPort}/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameType,
        playerCount,
        playerNames,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json() as { success: boolean; gameId?: string; error?: string };
    if (data.success && data.gameId) {
      return data.gameId;
    }
    if (data.error) {
      console.error(chalk.red(`  Failed to create game: ${data.error}`));
    } else {
      console.error(chalk.red(`  Unexpected response: ${JSON.stringify(data)}`));
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(chalk.red('  Game creation timed out'));
    } else {
      console.error(chalk.red('Failed to create game:'), error);
    }
  }
  return null;
}

// Get the CLI's directory to find the monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// After monorepo collapse, CLI is at dist/cli/, monorepo root is 2 levels up
const cliMonorepoRoot = resolve(__dirname, '..', '..');

/**
 * esbuild plugin to resolve @boardsmith/* imports to the monorepo source.
 * Only used in monorepo context - standalone games resolve from node_modules.
 * Returns a no-op plugin for standalone context.
 */
function boardsmithResolvePlugin(context: 'monorepo' | 'standalone'): EsbuildPlugin {
  // In standalone context, don't intercept - let esbuild resolve from node_modules
  if (context === 'standalone') {
    return {
      name: 'boardsmith-resolve-noop',
      setup() {
        // No-op: let normal resolution handle boardsmith imports
      },
    };
  }

  return {
    name: 'boardsmith-resolve',
    setup(build) {
      // Map package names to their directory names in src/
      // After monorepo collapse, packages are at src/<name>/
      const packageDirs: Record<string, string> = {
        'boardsmith': 'engine',
        'boardsmith/ai': 'ai',
        'boardsmith/ai-trainer': 'ai-trainer',
        'boardsmith/client': 'client',
        'boardsmith/runtime': 'runtime',
        'boardsmith/server': 'server',
        'boardsmith/session': 'session',
        'boardsmith/testing': 'testing',
        'boardsmith/ui': 'ui',
        'boardsmith/worker': 'worker',
      };

      // Handle boardsmith and boardsmith/* imports
      build.onResolve({ filter: /^boardsmith(\/.*)?$/ }, (args) => {
        const importPath = args.path;
        const dirName = packageDirs[importPath];
        if (dirName) {
          // Resolve to the src/<dir>/index.ts for bundling
          return { path: join(cliMonorepoRoot, 'src', dirName, 'index.ts') };
        }
        return undefined;
      });
    },
  };
}

/**
 * Bundle and load the game rules dynamically
 */
async function loadGameDefinition(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone'
): Promise<GameDefinition> {
  const rulesIndexPath = join(rulesPath, 'index.ts');
  const bundlePath = join(tempDir, 'rules-bundle.mjs');

  // Bundle the rules with esbuild
  // In monorepo context, use plugin to resolve boardsmith imports to src/
  // In standalone context, let normal node_modules resolution work
  await build({
    entryPoints: [rulesIndexPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    logLevel: 'silent',
    plugins: [boardsmithResolvePlugin(context)],
  });

  // Import the bundled module with cache-busting to ensure fresh load
  const moduleUrl = pathToFileURL(bundlePath).href;
  const module = await import(`${moduleUrl}?t=${Date.now()}`);

  if (!module.gameDefinition) {
    throw new Error('Rules module must export a gameDefinition');
  }

  return module.gameDefinition;
}

// Ports blocked by browsers for security (Chrome's restricted port list)
const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

export async function devCommand(options: DevOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  const playerCount = parseInt(options.players, 10);
  const workerPort = parseInt(options.workerPort, 10);
  const cwd = process.cwd();

  // Warn about browser-restricted ports
  if (UNSAFE_PORTS.has(port)) {
    console.error(chalk.red(`Error: Port ${port} is blocked by browsers for security reasons.`));
    console.error(chalk.dim('Try a different port like 5173, 3000, 8080, or any port above 1024 that isn\'t restricted.'));
    process.exit(1);
  }

  // Parse AI options (player positions are 1-indexed)
  const aiPlayers = options.ai
    ? options.ai.flatMap(s => s.split(',').map(n => parseInt(n.trim(), 10))).filter(n => !isNaN(n))
    : [];
  const aiLevel = options.aiLevel ?? 'medium';

  // Validate AI player positions are 1-indexed
  const invalidAiPlayers = aiPlayers.filter(p => p < 1 || p > playerCount);
  if (invalidAiPlayers.length > 0) {
    console.error(chalk.red(`Error: Invalid AI player position(s): ${invalidAiPlayers.join(', ')}`));
    console.error(chalk.dim(`Player positions are 1-indexed (1 to ${playerCount}).`));
    console.error(chalk.dim(`Example: --ai 2 for a 2-player game means player 2 is AI.`));
    process.exit(1);
  }

  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  const config: BoardSmithConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(chalk.cyan(`\nStarting development server for ${config.displayName || config.name}...`));

  // Detect project context - monorepo or standalone game
  const context = getProjectContext(cwd);
  if (context === 'monorepo') {
    console.log(chalk.dim('  Running in monorepo context (using source resolution)'));
  }

  // Determine paths
  const uiPath = config.paths?.ui ? resolve(cwd, config.paths.ui) : cwd;
  const rulesPath = config.paths?.rules ? resolve(cwd, config.paths.rules) : join(cwd, 'src', 'rules');

  if (!existsSync(uiPath)) {
    console.error(chalk.red(`Error: UI path not found: ${uiPath}`));
    process.exit(1);
  }

  // Check for rules
  const rulesIndexPath = join(rulesPath, 'index.ts');
  if (!existsSync(rulesIndexPath)) {
    console.error(chalk.red(`Error: Rules not found at ${rulesIndexPath}`));
    console.error(chalk.dim('Make sure your game has a src/rules/index.ts that exports gameDefinition'));
    process.exit(1);
  }

  // Create temp directory
  const tempDir = join(cwd, '.boardsmith');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  console.log(chalk.dim(`  Loading game rules from ${rulesPath}...`));

  // Load the game definition
  let gameDefinition: GameDefinition;
  try {
    gameDefinition = await loadGameDefinition(rulesPath, tempDir, context);

    // Apply fallback config from boardsmith.json if needed
    const minPlayers = gameDefinition.minPlayers ?? config.playerCount?.min ?? config.minPlayers ?? 2;
    const maxPlayers = gameDefinition.maxPlayers ?? config.playerCount?.max ?? config.maxPlayers ?? 4;

    gameDefinition = {
      ...gameDefinition,
      minPlayers,
      maxPlayers,
    };

    console.log(chalk.dim(`  Loaded game: ${gameDefinition.displayName || gameDefinition.gameType}`));
  } catch (error) {
    console.error(chalk.red('Failed to load game rules:'), error);
    process.exit(1);
  }

  // Start the local game server
  let server: LocalServer | null = null;

  console.log(chalk.dim(`  Starting game server on port ${workerPort}...`));

  try {
    if (options.debug) {
      console.log(chalk.cyan('  Debug mode enabled - verbose logging active'));
    }

    server = createLocalServer({
      port: workerPort,
      definitions: [gameDefinition],
      onReady: (p) => {
        console.log(chalk.green(`  Game server ready on http://localhost:${p}`));
      },
      aiConfig: aiPlayers.length > 0 ? { players: aiPlayers, level: aiLevel } : undefined,
      persist: options.persist,
      debug: options.debug,
    });

    // Wait for server to be ready before continuing
    await server.ready;

    if (aiPlayers.length > 0) {
      console.log(chalk.cyan(`  AI players enabled: ${aiPlayers.join(', ')} (level: ${aiLevel})`));
    }
  } catch (error) {
    console.error(chalk.red('Failed to start game server:'), error);
    process.exit(1);
  }

  // Clear Vite cache to prevent stale file references when switching games
  const viteCacheDir = join(uiPath, 'node_modules', '.vite');
  if (existsSync(viteCacheDir)) {
    console.log(chalk.dim('  Clearing Vite cache...'));
    try {
      rmSync(viteCacheDir, { recursive: true, force: true });
    } catch {
      // Intentionally silent: cache cleanup is best-effort.
      // Dev server works correctly even if stale cache remains.
    }
  }

  // Start Vite dev server for UI
  // Build Vite plugins based on context
  const vitePlugins: VitePlugin[] = [
    // Always include the API URL injection plugin
    {
      name: 'inject-api-url',
      transformIndexHtml(html) {
        // Inject API URL as global variable before any scripts run
        // This works for external packages (unlike Vite's define option)
        return html.replace(
          '<head>',
          `<head>\n    <script>window.__BOARDSMITH_API_URL__ = "http://localhost:${workerPort}";</script>`
        );
      },
    },
  ];

  // In monorepo context, add plugin to resolve boardsmith imports to src/
  // In standalone context, let Vite resolve from node_modules naturally
  if (context === 'monorepo') {
    const boardsmithVitePlugin: VitePlugin = {
      name: 'boardsmith-resolve',
      enforce: 'pre',  // Run before default resolver to intercept boardsmith imports
      resolveId(source: string) {
        // Handle boardsmith and boardsmith/* imports
        if (!source.startsWith('boardsmith')) return null;

        // Map import paths to src/ directories
        const srcDirs: Record<string, string> = {
          'boardsmith': 'engine',
          'boardsmith/ai': 'ai',
          'boardsmith/ai-trainer': 'ai-trainer',
          'boardsmith/client': 'client',
          'boardsmith/runtime': 'runtime',
          'boardsmith/server': 'server',
          'boardsmith/session': 'session',
          'boardsmith/testing': 'testing',
          'boardsmith/ui': 'ui',
          'boardsmith/worker': 'worker',
        };

        const srcDir = srcDirs[source];
        if (srcDir) {
          // Resolve to the src/<dir>/index.ts
          return join(cliMonorepoRoot, 'src', srcDir, 'index.ts');
        }

        // Handle subpath imports (e.g., boardsmith/ui/GameShell.css)
        if (source.startsWith('boardsmith/')) {
          const parts = source.replace('boardsmith/', '').split('/');
          const pkgName = parts[0];
          const subpath = parts.slice(1).join('/');
          const srcDir = srcDirs[`boardsmith/${pkgName}`];

          if (srcDir && subpath) {
            const srcPath = join(cliMonorepoRoot, 'src', srcDir);
            // Check for .css files
            if (subpath.endsWith('.css')) {
              return join(srcPath, 'src', subpath);
            }
            // Check for known subpath patterns
            const subpathFile = join(srcPath, 'src', `${subpath}.ts`);
            if (existsSync(subpathFile)) {
              return subpathFile;
            }
            // Try as directory with index.ts
            const subpathIndex = join(srcPath, 'src', subpath, 'index.ts');
            if (existsSync(subpathIndex)) {
              return subpathIndex;
            }
            // Try components subdirectory (for ui package)
            const componentsPath = join(srcPath, 'src', 'components', subpath, 'index.ts');
            if (existsSync(componentsPath)) {
              return componentsPath;
            }
          }
        }

        return null;
      },
    };
    vitePlugins.unshift(boardsmithVitePlugin);
  }

  // Configure optimizeDeps based on context
  const optimizeDepsExclude = context === 'monorepo'
    ? ['boardsmith', 'boardsmith/ui', 'boardsmith/client', 'boardsmith/session']
    : ['boardsmith'];  // Exclude boardsmith in standalone to pick up local changes during dev

  try {
    const vite = await createViteServer({
      root: uiPath,
      appType: 'spa', // Enable SPA fallback so /game/:id/:position routes serve index.html
      server: {
        port,
        strictPort: true, // Fail if port unavailable instead of silently using another
        open: false,
      },
      plugins: vitePlugins,
      // Don't pre-bundle boardsmith packages so changes are picked up immediately during development
      optimizeDeps: {
        exclude: optimizeDepsExclude,
      },
    });

    await vite.listen();

    // Get the actual port Vite is using (in case config file overrode our setting)
    const resolvedUrl = vite.resolvedUrls?.local[0];
    const uiPort = resolvedUrl ? parseInt(new URL(resolvedUrl).port || '5173', 10) : port;

    if (uiPort !== port) {
      console.log(chalk.yellow(`  Warning: Vite is using port ${uiPort} instead of requested port ${port}`));
      console.log(chalk.dim(`  (Check if the game's vite.config.ts has a hardcoded port)`));
    }

    console.log(chalk.green(`  UI server running on http://localhost:${uiPort}`));

    if (options.lobby) {
      // Show any persisted games that can be resumed
      if (options.persist && server) {
        const persistedGames = server.listPersistedGames();
        if (persistedGames.length > 0) {
          console.log(chalk.cyan(`\n  Found ${persistedGames.length} persisted game(s):`));
          for (const gameId of persistedGames) {
            console.log(chalk.dim(`    Resume: http://localhost:${uiPort}/game/${gameId}/0`));
          }
        }
      }

      // Open the lobby for manual game configuration
      console.log(chalk.cyan('\n  Opening game lobby...'));
      const lobbyUrl = `http://localhost:${uiPort}`;
      await open(lobbyUrl);
      console.log(chalk.dim(`  Lobby: ${lobbyUrl}`));
    } else if (options.persist && server) {
      // Non-lobby mode with persistence: try to resume the most recent game or create new
      const persistedGames = server.listPersistedGames();
      if (persistedGames.length > 0) {
        const gameId = persistedGames[0]; // Most recently updated game
        console.log(chalk.cyan(`\n  Resuming persisted game: ${gameId}`));

        // Open browser tabs for players (1-indexed positions)
        console.log(chalk.cyan(`  Opening ${playerCount} player tab(s)...`));
        for (let position = 1; position <= playerCount; position++) {
          const url = `http://localhost:${uiPort}/game/${gameId}/${position}`;
          await open(url);
          console.log(chalk.dim(`  Player ${position}: ${url}`));
        }
      } else {
        // No persisted games - create a new one
        // aiPlayers contains 1-indexed positions from user input
        const playerNames = Array.from({ length: playerCount }, (_, i) =>
          aiPlayers.includes(i + 1) ? 'Bot' : `Player ${i + 1}`  // i+1 for 1-indexed
        );
        const gameId = await createGame(workerPort, gameDefinition.gameType, playerCount, playerNames);

        if (gameId) {
          console.log(chalk.cyan(`\n  Game created: ${gameId}`));

          // humanPlayers are 1-indexed positions
          const humanPlayers = Array.from({ length: playerCount }, (_, i) => i + 1)
            .filter(position => !aiPlayers.includes(position));

          if (humanPlayers.length > 0) {
            console.log(chalk.cyan(`  Opening ${humanPlayers.length} player tab(s)...`));
            for (const position of humanPlayers) {
              const url = `http://localhost:${uiPort}/game/${gameId}/${position}`;
              await open(url);
              console.log(chalk.dim(`  Player ${position}: ${url}`));
            }
          }

          for (const position of aiPlayers) {
            if (position >= 1 && position <= playerCount) {
              console.log(chalk.dim(`  Player ${position}: AI (${aiLevel})`));
            }
          }
        } else {
          console.log(chalk.yellow('\n  Could not auto-create game. Open the UI manually.'));
          await open(`http://localhost:${uiPort}`);
        }
      }
    } else {
      // Create a game with appropriate names for AI and human players
      // aiPlayers contains 1-indexed positions from user input
      const playerNames = Array.from({ length: playerCount }, (_, i) =>
        aiPlayers.includes(i + 1) ? 'Bot' : `Player ${i + 1}`  // i+1 for 1-indexed
      );
      const gameId = await createGame(workerPort, gameDefinition.gameType, playerCount, playerNames);

      if (gameId) {
        console.log(chalk.cyan(`\n  Game created: ${gameId}`));

        // Only open browser tabs for human players (1-indexed positions)
        const humanPlayers = Array.from({ length: playerCount }, (_, i) => i + 1)
          .filter(position => !aiPlayers.includes(position));

        if (humanPlayers.length > 0) {
          console.log(chalk.cyan(`  Opening ${humanPlayers.length} player tab(s)...`));
          for (const position of humanPlayers) {
            const url = `http://localhost:${uiPort}/game/${gameId}/${position}`;
            await open(url);
            console.log(chalk.dim(`  Player ${position}: ${url}`));
          }
        }

        // Log AI player info
        for (const position of aiPlayers) {
          if (position >= 1 && position <= playerCount) {
            console.log(chalk.dim(`  Player ${position}: AI (${aiLevel})`));
          }
        }
      } else {
        console.log(chalk.yellow('\n  Could not auto-create game. Open the UI manually.'));
        await open(`http://localhost:${uiPort}`);
      }
    }

    console.log(chalk.green('\n  Ready! Press Ctrl+C to stop.\n'));

    // Watch for rules and data changes with hot reload
    let reloadDebounce: NodeJS.Timeout | null = null;
    const watchers: ReturnType<typeof watch>[] = [];

    const triggerReload = (source: string, filename: string) => {
      // Debounce to avoid multiple reloads for rapid changes
      if (reloadDebounce) clearTimeout(reloadDebounce);

      reloadDebounce = setTimeout(async () => {
        console.log(chalk.yellow(`\n  ${source} changed: ${filename}`));
        console.log(chalk.dim('  Reloading game rules...'));

        try {
          // Reload the game definition
          const newGameDefinition = await loadGameDefinition(rulesPath, tempDir, context);
          const minPlayers = newGameDefinition.minPlayers ?? config.playerCount?.min ?? config.minPlayers ?? 2;
          const maxPlayers = newGameDefinition.maxPlayers ?? config.playerCount?.max ?? config.maxPlayers ?? 4;

          const updatedDefinition = {
            ...newGameDefinition,
            minPlayers,
            maxPlayers,
          };

          // Update the server with new rules
          if (server) {
            server.updateDefinition(updatedDefinition);
            console.log(chalk.green('  Rules reloaded successfully!'));
          }
        } catch (error) {
          console.error(chalk.red('  Failed to reload rules:'), error);
        }
      }, 100);
    };

    // Watch rules directory for .ts files
    const rulesWatcher = watch(rulesPath, { recursive: true }, async (eventType, filename) => {
      if (!filename || !filename.endsWith('.ts')) return;
      triggerReload('Rules', filename);
    });
    watchers.push(rulesWatcher);

    // Watch for JSON data files (check common locations)
    const dataDirectories = [
      join(cwd, 'data'),           // <game>/data/
      join(cwd, 'rules', 'data'),  // <game>/rules/data/
      join(rulesPath, 'data'),     // <rulesPath>/data/
    ];

    for (const dataDir of dataDirectories) {
      if (existsSync(dataDir)) {
        console.log(chalk.dim(`  Watching data directory: ${dataDir}`));
        const dataWatcher = watch(dataDir, { recursive: true }, async (eventType, filename) => {
          if (!filename || !filename.endsWith('.json')) return;
          triggerReload('Data', filename);
        });
        watchers.push(dataWatcher);
      }
    }

    // Cleanup on exit
    const cleanup = async () => {
      console.log(chalk.dim('\n  Shutting down...'));
      for (const w of watchers) {
        w.close();
      }
      await vite.close();
      if (server) {
        await server.close();
      }
      // Clean up temp files (but preserve database if persisting)
      try {
        // Only delete the rules bundle, not the entire directory (which contains the database)
        const bundlePath = join(tempDir, 'rules-bundle.mjs');
        if (existsSync(bundlePath)) {
          rmSync(bundlePath);
        }
        // Only delete the directory if it's empty (no database)
        if (!options.persist) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

  } catch (error) {
    console.error(chalk.red('Failed to start Vite dev server:'), error);
    if (server) {
      await server.close();
    }
    process.exit(1);
  }
}
