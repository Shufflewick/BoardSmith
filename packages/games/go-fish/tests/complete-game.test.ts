import { describe, it, expect } from 'vitest';
import { createTestGame, simulateAction } from '@boardsmith/testing';
import { Player } from '@boardsmith/engine';
import { GoFishGame, Card, GoFishPlayer } from '@boardsmith/gofish-rules';
import type { FlowState } from '@boardsmith/engine';
import type { TestGame } from '@boardsmith/testing';

describe('Complete Go Fish Game', () => {
  /**
   * Helper to get the opponent's player position (1-indexed)
   * For 2 players: opponent of player 1 is player 2, and vice versa
   */
  function getOpponentPosition(currentPosition: number, playerCount: number): number {
    // For 2 players: 3 - 1 = 2, 3 - 2 = 1
    // For N players: cycle through positions 1 to N
    return currentPosition === playerCount ? 1 : currentPosition + 1;
  }

  /**
   * Helper to play a single turn
   * Returns the new flow state after the action
   */
  function playTurn(
    testGame: TestGame<GoFishGame>,
    flowState: FlowState,
    verbose = false
  ): FlowState {
    const game = testGame.game;
    const currentPosition = flowState.currentPlayer!;
    const currentPlayer = game.getPlayer(currentPosition)! as GoFishPlayer;
    const opponentPosition = getOpponentPosition(currentPosition, [...game.all(Player)].length);

    // Get ranks the current player holds
    const myRanks = game.getPlayerRanks(currentPlayer);

    if (myRanks.length === 0) {
      throw new Error(`Player ${currentPosition} has no cards to ask for`);
    }

    // Pick a rank to ask for (just use the first one)
    const rankToAsk = myRanks[0];

    const opponent = game.getPlayer(opponentPosition)!;
    if (verbose) {
      console.log(`Player ${currentPosition} (${currentPlayer.name}) asks Player ${opponentPosition} for ${rankToAsk}s`);
    }

    // Perform the action using simulateAction with proper choice format
    const result = simulateAction(testGame, currentPosition, 'ask', {
      target: { value: opponentPosition, display: opponent.name },
      rank: rankToAsk,
    });

    if (!result.success) {
      throw new Error(`Action failed: ${result.error}`);
    }

    return testGame.getFlowState()!;
  }

  it('should play a complete 2-player game until all books are formed', () => {
    const testGame = createTestGame(GoFishGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'complete-game-test',
    });

    let flowState = testGame.getFlowState()!;
    const game = testGame.game;

    expect(flowState.awaitingInput).toBe(true);
    expect(flowState.currentPlayer).toBe(1);

    let turnCount = 0;
    const maxTurns = 500; // Safety limit
    let lastPlayer = -1;
    let consecutiveSamePlayer = 0;
    const MAX_CONSECUTIVE = 20; // If same player goes 20 times in a row, something is wrong

    while (!flowState.complete && turnCount < maxTurns) {
      // Track consecutive turns by same player
      if (flowState.currentPlayer === lastPlayer) {
        consecutiveSamePlayer++;
      } else {
        consecutiveSamePlayer = 1;
        lastPlayer = flowState.currentPlayer!;
      }

      // Fail if same player is going too many times in a row
      if (consecutiveSamePlayer > MAX_CONSECUTIVE) {
        const alice = game.getPlayer(1)! as GoFishPlayer;
        const bob = game.getPlayer(2)! as GoFishPlayer;
        console.log(`Turn ${turnCount}: Player ${flowState.currentPlayer}'s turn (${consecutiveSamePlayer} consecutive)`);
        console.log(`Alice: ${game.getPlayerHand(alice).count(Card)} cards, ${alice.bookCount} books`);
        console.log(`Bob: ${game.getPlayerHand(bob).count(Card)} cards, ${bob.bookCount} books`);
        console.log(`Pond: ${game.pond.count(Card)} cards`);
        console.log(`Total books: ${game.getTotalBooks()}`);
        throw new Error(`Player ${flowState.currentPlayer} has had ${consecutiveSamePlayer} consecutive turns - likely stuck in a loop`);
      }

      // Check if game should be waiting for input
      if (!flowState.awaitingInput) {
        throw new Error(`Flow not awaiting input at turn ${turnCount}`);
      }

      // Play a turn
      try {
        flowState = playTurn(testGame, flowState);
      } catch (error) {
        // If player has no cards, the turn should have been skipped
        const currentPlayer = game.getPlayer(flowState.currentPlayer!)! as GoFishPlayer;
        const hand = game.getPlayerHand(currentPlayer);
        if (hand.count(Card) === 0 && game.pond.count(Card) === 0) {
          // Both hand and pond empty - game should be ending
          break;
        }
        throw error;
      }

      turnCount++;
    }

    // Game should be complete
    expect(flowState.complete).toBe(true);
    expect(game.isFinished()).toBe(true);
    expect(game.getTotalBooks()).toBe(13);

    // There should be a winner
    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);

    const alice = game.getPlayer(1)! as GoFishPlayer;
    const bob = game.getPlayer(2)! as GoFishPlayer;

    console.log(`\n=== Game Complete ===`);
    console.log(`Total turns: ${turnCount}`);
    console.log(`Alice: ${alice.bookCount} books`);
    console.log(`Bob: ${bob.bookCount} books`);
    console.log(`Winner: ${winners.map(w => w.name).join(', ')}`);
  });

  it('should correctly switch turns after Go Fish', () => {
    const testGame = createTestGame(GoFishGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'turn-switch-test',
    });

    let flowState = testGame.getFlowState()!;
    const game = testGame.game;

    const alice = game.getPlayer(1)! as GoFishPlayer;
    const bob = game.getPlayer(2)! as GoFishPlayer;

    // Get initial state
    expect(flowState.currentPlayer).toBe(1); // Alice's turn

    // Find a rank Alice has that Bob doesn't have (Go Fish scenario)
    const aliceRanks = game.getPlayerRanks(alice);
    const bobRanks = new Set(game.getPlayerRanks(bob));

    let goFishRank: string | null = null;
    for (const rank of aliceRanks) {
      if (!bobRanks.has(rank)) {
        goFishRank = rank;
        break;
      }
    }

    if (goFishRank) {
      // Alice asks for a rank Bob doesn't have
      console.log(`Alice asks for ${goFishRank}s (Bob doesn't have any)`);

      const result = testGame.doAction(1, 'ask', {
        target: { value: bob.seat, display: bob.name },
        rank: goFishRank,
      });

      expect(result.success).toBe(true);
      flowState = testGame.getFlowState()!;

      // Check game messages for result
      const lastMessages = game.messages.slice(-3);
      const drewMatchMessage = lastMessages.some(m =>
        m.text.includes('lucky') || m.text.includes('another turn')
      );

      if (!drewMatchMessage) {
        // Alice Go Fished and didn't get a match - Bob's turn (player 2)
        expect(flowState.currentPlayer).toBe(2);
        console.log(`Turn correctly switched to Bob (player 2)`);
      } else {
        // Alice Go Fished but drew a match - still Alice's turn (player 1)
        expect(flowState.currentPlayer).toBe(1);
        console.log(`Alice drew a match, keeps her turn`);
      }
    } else {
      console.log('Could not find a rank for Go Fish scenario - skipping detailed check');
    }
  });

  it('should give extra turn when player gets cards from opponent', () => {
    const testGame = createTestGame(GoFishGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'extra-turn-test',
    });

    let flowState = testGame.getFlowState()!;
    const game = testGame.game;

    const alice = game.getPlayer(1)! as GoFishPlayer;
    const bob = game.getPlayer(2)! as GoFishPlayer;

    // Get initial state
    expect(flowState.currentPlayer).toBe(1); // Alice's turn

    // Find a rank Alice has that Bob also has (get cards scenario)
    const aliceRanks = game.getPlayerRanks(alice);
    const bobRanks = new Set(game.getPlayerRanks(bob));

    let matchingRank: string | null = null;
    for (const rank of aliceRanks) {
      if (bobRanks.has(rank)) {
        matchingRank = rank;
        break;
      }
    }

    if (matchingRank) {
      const bobCardsOfRank = game.getCardsOfRank(bob, matchingRank).length;
      console.log(`Alice asks for ${matchingRank}s (Bob has ${bobCardsOfRank})`);

      const result = testGame.doAction(1, 'ask', {
        target: { value: bob.seat, display: bob.name },
        rank: matchingRank,
      });

      expect(result.success).toBe(true);
      flowState = testGame.getFlowState()!;

      // Alice got cards, should still be her turn
      expect(flowState.currentPlayer).toBe(1);
      console.log(`Alice got ${bobCardsOfRank} card(s), keeps her turn`);

      // Verify the cards moved
      const aliceCardsOfRank = game.getCardsOfRank(alice, matchingRank).length;
      expect(aliceCardsOfRank).toBeGreaterThanOrEqual(bobCardsOfRank + 1); // Alice's original + Bob's
      expect(game.getCardsOfRank(bob, matchingRank).length).toBe(0); // Bob gave all
    } else {
      console.log('No matching rank found between players - skipping test');
    }
  });

  it('should track turn counts for each player throughout the game', () => {
    const testGame = createTestGame(GoFishGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'turn-tracking-test',
    });

    let flowState = testGame.getFlowState()!;
    const game = testGame.game;

    const turnCounts = [0, 0]; // Track turns per player (index 0 = position 1, index 1 = position 2)
    let totalTurns = 0;
    const maxTurns = 500;

    while (!flowState.complete && totalTurns < maxTurns) {
      if (!flowState.awaitingInput) {
        throw new Error(`Flow not awaiting input at turn ${totalTurns}`);
      }

      const currentPlayerPosition = flowState.currentPlayer!;
      turnCounts[currentPlayerPosition - 1]++; // Convert 1-indexed position to 0-indexed array

      try {
        flowState = playTurn(testGame, flowState);
      } catch (error) {
        // Handle case where player can't act
        break;
      }

      totalTurns++;
    }

    console.log(`\n=== Turn Distribution ===`);
    console.log(`Alice took ${turnCounts[0]} turns`);
    console.log(`Bob took ${turnCounts[1]} turns`);
    console.log(`Total: ${totalTurns}`);

    // Both players should have taken turns
    expect(turnCounts[0]).toBeGreaterThan(0);
    expect(turnCounts[1]).toBeGreaterThan(0);

    // No player should dominate excessively (ratio check)
    const ratio = Math.max(turnCounts[0], turnCounts[1]) / Math.min(turnCounts[0], turnCounts[1]);
    console.log(`Turn ratio: ${ratio.toFixed(2)}`);

    // Ratio shouldn't be absurdly high (e.g., one player taking 10x more turns)
    expect(ratio).toBeLessThan(10);
  });

  it('should handle consecutive Go Fish draws without getting stuck', () => {
    // Play multiple games with different seeds to ensure no stuck scenarios
    const seeds = ['seed-1', 'seed-2', 'seed-3', 'seed-4', 'seed-5'];

    for (const seed of seeds) {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed,
      });

      let flowState = testGame.getFlowState()!;
      let turnCount = 0;
      const maxTurns = 500;

      while (!flowState.complete && turnCount < maxTurns) {
        if (!flowState.awaitingInput) break;

        try {
          flowState = playTurn(testGame, flowState);
        } catch {
          break;
        }

        turnCount++;
      }

      console.log(`Seed "${seed}": ${turnCount} turns, complete: ${flowState.complete}`);

      if (turnCount >= maxTurns) {
        throw new Error(`Game with seed "${seed}" did not complete within ${maxTurns} turns`);
      }

      expect(flowState.complete).toBe(true);
    }
  });

  it('should form books automatically when 4 of a kind is collected', () => {
    const testGame = createTestGame(GoFishGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'book-formation-test',
    });

    let flowState = testGame.getFlowState()!;
    const game = testGame.game;

    const alice = game.getPlayer(1)! as GoFishPlayer;
    const bob = game.getPlayer(2)! as GoFishPlayer;

    const initialAliceBooks = alice.bookCount;
    const initialBobBooks = bob.bookCount;

    let turnCount = 0;
    const maxTurns = 500;
    let bookFormed = false;

    while (!flowState.complete && turnCount < maxTurns && !bookFormed) {
      if (!flowState.awaitingInput) break;

      try {
        flowState = playTurn(testGame, flowState);
      } catch {
        break;
      }

      // Check if any books were formed
      if (alice.bookCount > initialAliceBooks || bob.bookCount > initialBobBooks) {
        bookFormed = true;
        console.log(`Book formed! Alice: ${alice.bookCount}, Bob: ${bob.bookCount}`);
      }

      turnCount++;
    }

    // Play to completion and verify total books
    while (!flowState.complete && turnCount < maxTurns) {
      if (!flowState.awaitingInput) break;

      try {
        flowState = playTurn(testGame, flowState);
      } catch {
        break;
      }

      turnCount++;
    }

    expect(flowState.complete).toBe(true);
    expect(game.getTotalBooks()).toBe(13);

    console.log(`\nFinal book counts: Alice=${alice.bookCount}, Bob=${bob.bookCount}`);
  });
});
