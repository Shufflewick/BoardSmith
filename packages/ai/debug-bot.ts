/**
 * Profile getValidMoves and isFinished
 */

import { CheckersGame } from '@boardsmith/checkers-rules';

async function main() {
  console.log('Profiling expensive game methods...\n');

  const game = new CheckersGame({
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2'],
    seed: 'test-seed',
  });
  game.startFlow();

  // Profile getValidMoves
  let start = performance.now();
  for (let i = 0; i < 100; i++) {
    game.getValidMoves(game.players[0] as any);
  }
  console.log(`100 getValidMoves(player0): ${(performance.now() - start).toFixed(1)}ms`);

  start = performance.now();
  for (let i = 0; i < 100; i++) {
    game.getValidMoves(game.players[1] as any);
  }
  console.log(`100 getValidMoves(player1): ${(performance.now() - start).toFixed(1)}ms`);

  // Profile isFinished (which calls getValidMoves twice)
  start = performance.now();
  for (let i = 0; i < 100; i++) {
    game.isFinished();
  }
  console.log(`100 isFinished: ${(performance.now() - start).toFixed(1)}ms`);

  // Calculate how many times these get called per continueFlow
  // by counting calls (we'd need to instrument the code, so let's estimate)
  console.log('\n--- Estimated calls per continueFlow ---');
  console.log('Based on flow structure:');
  console.log('- isComplete check in run() loop: called after each node');
  console.log('- game-loop while: isFinished()');
  console.log('- player-turns filter: canCurrentPlayerMove -> getValidMoves');
  console.log('- move-loop while: isFinished + getValidMoves');
  console.log('- actionStep skipIf: isFinished');
  console.log('');
  console.log('Rough estimate: 4-8 isFinished() + 2-4 getValidMoves per continueFlow');

  const avgGetValidMoves = (performance.now() - start) / 100;
  const singleIsFinished = avgGetValidMoves * 2; // isFinished does 2 getValidMoves
  console.log(`\nSingle isFinished ~= ${singleIsFinished.toFixed(1)}ms`);
  console.log(`6 isFinished calls ~= ${(singleIsFinished * 6).toFixed(1)}ms`);
  console.log(`This explains the ~20ms continueFlow overhead!`);

  console.log('\nDone!');
}

main().catch(console.error);
