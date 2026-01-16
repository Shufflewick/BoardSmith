/**
 * Benchmark PN-MCTS vs vanilla MCTS on Hex.
 *
 * Compares proof-number enhanced MCTS against standard MCTS to evaluate:
 * - Win rate differences (P1 and P2)
 * - Average game length
 * - Move times
 *
 * Run with: cd packages/ai-trainer && npx tsx scripts/pn-mcts-benchmark.ts
 */

import { resolve } from 'path';
import { GameRunner } from '@boardsmith/runtime';
import { createBot } from '@boardsmith/ai';
import type { BotConfig } from '@boardsmith/ai';

// Configuration
const GAME_COUNT = 40;
const MCTS_ITERATIONS = 500; // Hard difficulty
const TIMEOUT = 10000;
const MAX_ACTIONS = 200;

// Dynamically load the Hex game module
// Note: process.cwd() is packages/ai-trainer when run from there, so we go up two levels
const hexModulePath = resolve(process.cwd(), '../../packages/games/hex/rules/dist/index.js');
const hexModule = await import(`file://${hexModulePath}`);
const HexGame = hexModule.HexGame;
const hexAI = hexModule.hexAI;

interface GameResult {
  winner: number | null; // 1 or 2, or null for draw
  gameLength: number; // number of moves
  totalMoveTimeMs: number; // total time spent on moves
  moveCount: number; // number of moves made
}

interface BenchmarkResults {
  p1Wins: number;
  p2Wins: number;
  draws: number;
  avgGameLength: number;
  avgMoveTimeMs: number;
  totalGames: number;
}

/**
 * Run a single game between two bots with the specified config
 */
async function runGame(
  p1Config: Partial<BotConfig>,
  p2Config: Partial<BotConfig>,
  gameSeed: string
): Promise<GameResult> {
  const runner = new GameRunner({
    GameClass: HexGame as any,
    gameType: 'hex',
    gameOptions: {
      playerCount: 2,
      seed: gameSeed,
    },
  });

  let flowState = runner.start();
  let gameLength = 0;
  let totalMoveTimeMs = 0;
  let moveCount = 0;

  while (!flowState.complete && gameLength < MAX_ACTIONS) {
    if (!flowState.awaitingInput) break;

    const currentPlayer = flowState.currentPlayer;
    if (currentPlayer === undefined) break;

    const availableActions = flowState.availableActions ?? [];
    if (availableActions.length === 0) break;

    // Select config based on current player
    const config = currentPlayer === 1 ? p1Config : p2Config;

    const startTime = performance.now();

    const bot = createBot(
      runner.game,
      HexGame as any,
      'hex',
      currentPlayer,
      runner.actionHistory,
      config.iterations ?? MCTS_ITERATIONS,
      hexAI
    );

    // Override bot config with PNS settings
    (bot as any).config = { ...(bot as any).config, ...config };

    const move = await bot.play();
    const endTime = performance.now();

    totalMoveTimeMs += endTime - startTime;
    moveCount++;

    const result = runner.performAction(move.action, currentPlayer, move.args);
    if (!result.success) break;

    gameLength++;
    flowState = runner.getFlowState() ?? flowState;
  }

  // Determine winner
  let winner: number | null = null;
  if (flowState.complete) {
    const winners = (runner.game.settings.winners as number[]) ?? [];
    if (winners.length === 1) {
      winner = winners[0];
    }
  }

  return {
    winner,
    gameLength,
    totalMoveTimeMs,
    moveCount,
  };
}

/**
 * Run benchmark suite with the specified config
 */
async function runBenchmark(
  name: string,
  p1Config: Partial<BotConfig>,
  p2Config: Partial<BotConfig>
): Promise<BenchmarkResults> {
  console.log(`\n=== ${name} ===`);
  console.log(`Running ${GAME_COUNT} games...`);

  let p1Wins = 0;
  let p2Wins = 0;
  let draws = 0;
  let totalGameLength = 0;
  let totalMoveTimeMs = 0;
  let totalMoves = 0;

  const startTime = Date.now();

  for (let i = 0; i < GAME_COUNT; i++) {
    const result = await runGame(p1Config, p2Config, `benchmark-${name}-${i}`);

    if (result.winner === 1) {
      p1Wins++;
    } else if (result.winner === 2) {
      p2Wins++;
    } else {
      draws++;
    }

    totalGameLength += result.gameLength;
    totalMoveTimeMs += result.totalMoveTimeMs;
    totalMoves += result.moveCount;

    // Progress indicator
    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${GAME_COUNT} games`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`  Completed in ${(elapsed / 1000).toFixed(1)}s`);

  return {
    p1Wins,
    p2Wins,
    draws,
    avgGameLength: totalGameLength / GAME_COUNT,
    avgMoveTimeMs: totalMoves > 0 ? totalMoveTimeMs / totalMoves : 0,
    totalGames: GAME_COUNT,
  };
}

async function main() {
  console.log('===========================================');
  console.log('  PN-MCTS vs Vanilla MCTS Benchmark');
  console.log('===========================================');
  console.log(`\nConfiguration:`);
  console.log(`  Games per test: ${GAME_COUNT}`);
  console.log(`  MCTS iterations: ${MCTS_ITERATIONS} (hard difficulty)`);
  console.log(`  Board size: 11x11 (default Hex)`);
  console.log(`  Timeout: ${TIMEOUT}ms`);

  // Vanilla MCTS: usePNS disabled
  const vanillaConfig: Partial<BotConfig> = {
    iterations: MCTS_ITERATIONS,
    timeout: TIMEOUT,
    usePNS: false,
    useRAVE: true,
    useTranspositionTable: true,
  };

  // PN-MCTS: usePNS enabled (default)
  const pnMctsConfig: Partial<BotConfig> = {
    iterations: MCTS_ITERATIONS,
    timeout: TIMEOUT,
    usePNS: true,
    pnWeight: 0.5,
    useRAVE: true,
    useTranspositionTable: true,
  };

  // Run benchmark: Vanilla vs Vanilla (baseline)
  console.log('\n--- Test 1: Vanilla MCTS vs Vanilla MCTS (baseline) ---');
  const vanillaVsVanilla = await runBenchmark('Vanilla-vs-Vanilla', vanillaConfig, vanillaConfig);

  // Run benchmark: PN-MCTS vs Vanilla
  console.log('\n--- Test 2: PN-MCTS (P1) vs Vanilla MCTS (P2) ---');
  const pnVsVanilla = await runBenchmark('PNMCTS-vs-Vanilla', pnMctsConfig, vanillaConfig);

  // Run benchmark: Vanilla vs PN-MCTS
  console.log('\n--- Test 3: Vanilla MCTS (P1) vs PN-MCTS (P2) ---');
  const vanillaVsPn = await runBenchmark('Vanilla-vs-PNMCTS', vanillaConfig, pnMctsConfig);

  // Run benchmark: PN-MCTS vs PN-MCTS
  console.log('\n--- Test 4: PN-MCTS vs PN-MCTS (both enabled) ---');
  const pnVsPn = await runBenchmark('PNMCTS-vs-PNMCTS', pnMctsConfig, pnMctsConfig);

  // Print results table
  console.log('\n\n===========================================');
  console.log('              RESULTS SUMMARY');
  console.log('===========================================\n');

  console.log('Win Rates:');
  console.log('-------------------------------------------');
  console.log('Test                    | P1 Win | P2 Win | Draw');
  console.log('-------------------------------------------');
  printResults('Vanilla vs Vanilla', vanillaVsVanilla);
  printResults('PN-MCTS vs Vanilla', pnVsVanilla);
  printResults('Vanilla vs PN-MCTS', vanillaVsPn);
  printResults('PN-MCTS vs PN-MCTS', pnVsPn);
  console.log('-------------------------------------------');

  console.log('\nGame Metrics:');
  console.log('-------------------------------------------');
  console.log('Test                    | Avg Length | Avg Move Time');
  console.log('-------------------------------------------');
  printMetrics('Vanilla vs Vanilla', vanillaVsVanilla);
  printMetrics('PN-MCTS vs Vanilla', pnVsVanilla);
  printMetrics('Vanilla vs PN-MCTS', vanillaVsPn);
  printMetrics('PN-MCTS vs PN-MCTS', pnVsPn);
  console.log('-------------------------------------------');

  // Compute PN-MCTS win rate advantage
  const pnMctsAsP1WinRate = pnVsVanilla.p1Wins / pnVsVanilla.totalGames;
  const pnMctsAsP2WinRate = vanillaVsPn.p2Wins / vanillaVsPn.totalGames;
  const combinedPnWinRate = (pnVsVanilla.p1Wins + vanillaVsPn.p2Wins) / (pnVsVanilla.totalGames + vanillaVsPn.totalGames);

  const vanillaAsP1WinRate = vanillaVsVanilla.p1Wins / vanillaVsVanilla.totalGames;
  const vanillaAsP2WinRate = vanillaVsVanilla.p2Wins / vanillaVsVanilla.totalGames;

  console.log('\n\nPN-MCTS Performance Analysis:');
  console.log('===========================================');
  console.log(`PN-MCTS as P1 win rate: ${(pnMctsAsP1WinRate * 100).toFixed(1)}% (vs Vanilla P2)`);
  console.log(`PN-MCTS as P2 win rate: ${(pnMctsAsP2WinRate * 100).toFixed(1)}% (vs Vanilla P1)`);
  console.log(`PN-MCTS combined win rate: ${(combinedPnWinRate * 100).toFixed(1)}%`);
  console.log('');
  console.log(`Baseline P1 win rate: ${(vanillaAsP1WinRate * 100).toFixed(1)}% (Vanilla vs Vanilla)`);
  console.log(`Baseline P2 win rate: ${(vanillaAsP2WinRate * 100).toFixed(1)}% (Vanilla vs Vanilla)`);
  console.log('');

  const p1Advantage = pnMctsAsP1WinRate - vanillaAsP1WinRate;
  const p2Advantage = pnMctsAsP2WinRate - vanillaAsP2WinRate;

  console.log(`PN-MCTS advantage as P1: ${p1Advantage >= 0 ? '+' : ''}${(p1Advantage * 100).toFixed(1)}%`);
  console.log(`PN-MCTS advantage as P2: ${p2Advantage >= 0 ? '+' : ''}${(p2Advantage * 100).toFixed(1)}%`);

  // Move time comparison
  const vanillaAvgMoveTime = vanillaVsVanilla.avgMoveTimeMs;
  const pnMctsAvgMoveTime = pnVsPn.avgMoveTimeMs;
  const timeDiff = ((pnMctsAvgMoveTime - vanillaAvgMoveTime) / vanillaAvgMoveTime) * 100;

  console.log('');
  console.log(`Vanilla avg move time: ${vanillaAvgMoveTime.toFixed(0)}ms`);
  console.log(`PN-MCTS avg move time: ${pnMctsAvgMoveTime.toFixed(0)}ms (${timeDiff >= 0 ? '+' : ''}${timeDiff.toFixed(1)}%)`);

  console.log('\n===========================================');
  console.log('              BENCHMARK COMPLETE');
  console.log('===========================================\n');
}

function printResults(name: string, results: BenchmarkResults) {
  const p1Rate = ((results.p1Wins / results.totalGames) * 100).toFixed(0);
  const p2Rate = ((results.p2Wins / results.totalGames) * 100).toFixed(0);
  const drawRate = ((results.draws / results.totalGames) * 100).toFixed(0);
  console.log(`${name.padEnd(23)} | ${p1Rate.padStart(5)}% | ${p2Rate.padStart(5)}% | ${drawRate.padStart(3)}%`);
}

function printMetrics(name: string, results: BenchmarkResults) {
  const avgLength = results.avgGameLength.toFixed(1);
  const avgTime = results.avgMoveTimeMs.toFixed(0) + 'ms';
  console.log(`${name.padEnd(23)} | ${avgLength.padStart(10)} | ${avgTime.padStart(12)}`);
}

main().catch(console.error);
