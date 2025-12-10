import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { spawn, ChildProcess } from 'child_process';

const UI_URL = 'http://localhost:3001';
const API_URL = 'http://localhost:8787';

describe('Go Fish E2E with Playwright', () => {
  let browser: Browser;
  let player1Context: BrowserContext;
  let player2Context: BrowserContext;
  let player1Page: Page;
  let player2Page: Page;

  beforeAll(async () => {
    // Launch browser with two separate contexts (like two different users)
    browser = await chromium.launch({ headless: true });
    player1Context = await browser.newContext();
    player2Context = await browser.newContext();
    player1Page = await player1Context.newPage();
    player2Page = await player2Context.newPage();
  }, 30000);

  afterAll(async () => {
    await player1Context?.close();
    await player2Context?.close();
    await browser?.close();
  });

  /**
   * Helper to wait for element and get its text
   */
  async function getText(page: Page, selector: string): Promise<string> {
    await page.waitForSelector(selector, { timeout: 5000 });
    return page.locator(selector).first().textContent() ?? '';
  }

  /**
   * Helper to get all card ranks visible in a player's hand
   */
  async function getHandRanks(page: Page): Promise<string[]> {
    await page.waitForSelector('.my-cards .card .rank', { timeout: 5000 });
    const ranks = await page.locator('.my-cards .card .rank').allTextContents();
    return ranks;
  }

  /**
   * Helper to check if it's the player's turn
   */
  async function isMyTurn(page: Page): Promise<boolean> {
    const turnIndicator = await page.locator('.turn-indicator').textContent();
    return turnIndicator?.includes('Your Turn') ?? false;
  }

  /**
   * Helper to get opponent's card count
   */
  async function getOpponentCardCount(page: Page): Promise<number> {
    const countText = await page.locator('.opponent-area .card-count').textContent();
    const match = countText?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Helper to get book counts
   */
  async function getBookCounts(page: Page): Promise<{ mine: number; opponent: number }> {
    const myBooks = await page.locator('.my-area .books-count').textContent();
    const oppBooks = await page.locator('.opponent-area .books-count').textContent();
    const myMatch = myBooks?.match(/(\d+)/);
    const oppMatch = oppBooks?.match(/(\d+)/);
    return {
      mine: myMatch ? parseInt(myMatch[1], 10) : 0,
      opponent: oppMatch ? parseInt(oppMatch[1], 10) : 0,
    };
  }

  /**
   * Perform an ask action - select rank and click ask button
   */
  async function askForRank(page: Page, rank: string): Promise<void> {
    // Click the rank button
    await page.click(`.rank-btn:has-text("${rank}")`);
    // Wait for button to be enabled
    await page.waitForSelector('.ask-btn:not([disabled])', { timeout: 5000 });
    // Click ask button
    await page.click('.ask-btn');
    // Wait for action to complete (button re-enables or turn changes)
    await page.waitForTimeout(500);
  }

  it('should play a complete 2-player game via browser', async () => {
    // ========================================
    // Step 1: Player 1 creates a game
    // ========================================
    await player1Page.goto(UI_URL);
    await player1Page.waitForSelector('input[placeholder="Enter your name"]');

    // Enter name and create game
    await player1Page.fill('input[placeholder="Enter your name"]', 'Alice');
    await player1Page.click('button:has-text("Create Game")');

    // Wait for game to be created
    await player1Page.waitForSelector('.game-code strong', { timeout: 10000 });
    const gameId = await player1Page.locator('.game-code strong').textContent();
    expect(gameId).toBeTruthy();
    console.log(`Game created: ${gameId}`);

    // Click "Start Playing" to enter the game
    const startButton = player1Page.locator('button:has-text("Start Playing")');
    if (await startButton.isVisible()) {
      await startButton.click();
    }

    // Wait for game board to load
    await player1Page.waitForSelector('.game-board', { timeout: 10000 });

    // ========================================
    // Step 2: Player 2 joins the game
    // ========================================
    await player2Page.goto(UI_URL);
    await player2Page.waitForSelector('input[placeholder="Enter your name"]');

    // Enter name and game code
    await player2Page.fill('input[placeholder="Enter your name"]', 'Bob');
    await player2Page.fill('input[placeholder="Enter game code"]', gameId!);
    await player2Page.click('button:has-text("Join Game")');

    // Wait for game board to load
    await player2Page.waitForSelector('.game-board', { timeout: 10000 });
    console.log('Player 2 joined the game');

    // Give WebSocket connections time to stabilize
    await player1Page.waitForTimeout(1000);
    await player2Page.waitForTimeout(1000);

    // ========================================
    // Step 3: Verify initial game state
    // ========================================
    // Both players should have 7 cards
    let p1Ranks = await getHandRanks(player1Page);
    let p2Ranks = await getHandRanks(player2Page);

    expect(p1Ranks.length).toBe(7);
    expect(p2Ranks.length).toBe(7);
    console.log(`P1 hand: ${p1Ranks.join(', ')}`);
    console.log(`P2 hand: ${p2Ranks.join(', ')}`);

    // Player 1 should have the first turn
    expect(await isMyTurn(player1Page)).toBe(true);
    expect(await isMyTurn(player2Page)).toBe(false);

    // ========================================
    // Step 4: Play the game until completion
    // ========================================
    let turnCount = 0;
    const maxTurns = 200;
    let gameComplete = false;

    while (turnCount < maxTurns && !gameComplete) {
      // Check if game is over
      const p1GameOver = await player1Page.locator('.game-over').isVisible();
      const p2GameOver = await player2Page.locator('.game-over').isVisible();

      if (p1GameOver || p2GameOver) {
        gameComplete = true;
        break;
      }

      // Determine whose turn it is
      const p1Turn = await isMyTurn(player1Page);
      const p2Turn = await isMyTurn(player2Page);

      const currentPage = p1Turn ? player1Page : player2Page;
      const currentPlayer = p1Turn ? 'Alice' : 'Bob';

      if (!p1Turn && !p2Turn) {
        // Neither player's turn - might be transitioning, wait a bit
        await player1Page.waitForTimeout(200);
        continue;
      }

      // Get current player's hand ranks
      const myRanks = await getHandRanks(currentPage);

      if (myRanks.length === 0) {
        console.log(`${currentPlayer} has no cards - waiting for game end`);
        await currentPage.waitForTimeout(500);
        continue;
      }

      // Pick a rank to ask for (first available)
      const rankToAsk = myRanks[0];
      console.log(`Turn ${turnCount + 1}: ${currentPlayer} asks for ${rankToAsk}s`);

      // Perform the ask action
      try {
        await askForRank(currentPage, rankToAsk);
      } catch (e) {
        console.log(`Action failed: ${e}`);
        await currentPage.waitForTimeout(500);
      }

      // Wait for state to update
      await player1Page.waitForTimeout(300);
      await player2Page.waitForTimeout(300);

      turnCount++;
    }

    // ========================================
    // Step 5: Verify game completion
    // ========================================
    // Wait for game over screen
    await player1Page.waitForSelector('.game-over', { timeout: 30000 });

    const p1Books = await getBookCounts(player1Page);
    const p2Books = await getBookCounts(player2Page);

    console.log(`\n=== Game Complete ===`);
    console.log(`Total turns: ${turnCount}`);
    console.log(`Alice's books: ${p1Books.mine}`);
    console.log(`Bob's books: ${p2Books.mine}`);
    console.log(`Total books: ${p1Books.mine + p2Books.mine}`);

    // Total books should be 13 (all ranks)
    expect(p1Books.mine + p2Books.mine).toBe(13);

    // Game should have completed
    expect(gameComplete || turnCount < maxTurns).toBe(true);
  }, 120000); // 2 minute timeout for full game

  it('should correctly transfer cards when opponent has the asked rank', async () => {
    // Create a new game via API to control the seed
    const createResponse = await fetch(`${API_URL}/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameType: 'go-fish',
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'transfer-test-e2e-12345',
      }),
    });
    const createResult = await createResponse.json();
    expect(createResult.success).toBe(true);
    const gameId = createResult.gameId;
    console.log(`Created game for transfer test: ${gameId}`);

    // Open both players' views
    await player1Page.goto(`${UI_URL}/game/${gameId}/0`);
    await player2Page.goto(`${UI_URL}/game/${gameId}/1`);

    // Wait for game boards to load
    await player1Page.waitForSelector('.game-board', { timeout: 10000 });
    await player2Page.waitForSelector('.game-board', { timeout: 10000 });

    // Get initial hands
    const p1InitialRanks = await getHandRanks(player1Page);
    const p2InitialRanks = await getHandRanks(player2Page);

    console.log(`P1 initial hand: ${p1InitialRanks.join(', ')}`);
    console.log(`P2 initial hand: ${p2InitialRanks.join(', ')}`);

    // Find a rank that P1 has that P2 also has
    const p2RankSet = new Set(p2InitialRanks);
    let commonRank: string | null = null;
    for (const rank of p1InitialRanks) {
      if (p2RankSet.has(rank)) {
        commonRank = rank;
        break;
      }
    }

    if (commonRank) {
      // Count how many of this rank each player has initially
      const p1InitialCount = p1InitialRanks.filter(r => r === commonRank).length;
      const p2InitialCount = p2InitialRanks.filter(r => r === commonRank).length;

      console.log(`Common rank: ${commonRank}`);
      console.log(`P1 has ${p1InitialCount} ${commonRank}(s), P2 has ${p2InitialCount} ${commonRank}(s)`);

      // P1 should have first turn - ask for the common rank
      expect(await isMyTurn(player1Page)).toBe(true);
      await askForRank(player1Page, commonRank);

      // Wait for state to update
      await player1Page.waitForTimeout(1000);
      await player2Page.waitForTimeout(1000);

      // Get updated hands
      const p1UpdatedRanks = await getHandRanks(player1Page);
      const p2UpdatedRanks = await getHandRanks(player2Page);

      const p1UpdatedCount = p1UpdatedRanks.filter(r => r === commonRank).length;
      const p2UpdatedCount = p2UpdatedRanks.filter(r => r === commonRank).length;

      console.log(`After transfer:`);
      console.log(`P1 has ${p1UpdatedCount} ${commonRank}(s), P2 has ${p2UpdatedCount} ${commonRank}(s)`);

      // P1 should have gotten P2's cards (unless a book was formed)
      // P2 should have 0 of that rank (gave them all away)
      expect(p2UpdatedCount).toBe(0);

      // P1 should have at least p1Initial + p2Initial cards of that rank
      // (might be fewer if a book was formed - 4 cards move to books)
      const expectedMinimum = p1InitialCount + p2InitialCount;
      if (expectedMinimum >= 4) {
        // Book formed - cards moved to books pile
        const books = await getBookCounts(player1Page);
        console.log(`Book formed! P1 now has ${books.mine} book(s)`);
        expect(books.mine).toBeGreaterThan(0);
      } else {
        // No book - cards should be in hand
        expect(p1UpdatedCount).toBe(expectedMinimum);
      }

      // P1 should still have their turn (got cards from opponent)
      expect(await isMyTurn(player1Page)).toBe(true);
    } else {
      console.log('No common rank found - skipping transfer test');
    }
  }, 60000);

  it('should switch turns after Go Fish (no match)', async () => {
    // Create a new game via API
    const createResponse = await fetch(`${API_URL}/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameType: 'go-fish',
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'gofish-turn-test-xyz',
      }),
    });
    const createResult = await createResponse.json();
    expect(createResult.success).toBe(true);
    const gameId = createResult.gameId;

    // Open both players' views
    await player1Page.goto(`${UI_URL}/game/${gameId}/0`);
    await player2Page.goto(`${UI_URL}/game/${gameId}/1`);

    // Wait for game boards to load
    await player1Page.waitForSelector('.game-board', { timeout: 10000 });
    await player2Page.waitForSelector('.game-board', { timeout: 10000 });

    // Get hands
    const p1Ranks = await getHandRanks(player1Page);
    const p2Ranks = await getHandRanks(player2Page);
    const p2RankSet = new Set(p2Ranks);

    // Find a rank P1 has that P2 doesn't have
    let uniqueRank: string | null = null;
    for (const rank of p1Ranks) {
      if (!p2RankSet.has(rank)) {
        uniqueRank = rank;
        break;
      }
    }

    if (uniqueRank) {
      console.log(`P1 asking for ${uniqueRank} (P2 doesn't have it)`);

      // P1 asks for a rank P2 doesn't have
      expect(await isMyTurn(player1Page)).toBe(true);
      await askForRank(player1Page, uniqueRank);

      // Wait for state to update
      await player1Page.waitForTimeout(1500);
      await player2Page.waitForTimeout(1500);

      // Check whose turn it is now
      // If P1 drew a match from pond, they keep their turn
      // If not, turn should switch to P2
      const p1StillTurn = await isMyTurn(player1Page);
      const p2NowTurn = await isMyTurn(player2Page);

      console.log(`After Go Fish: P1 turn=${p1StillTurn}, P2 turn=${p2NowTurn}`);

      // One of them should have the turn
      expect(p1StillTurn || p2NowTurn).toBe(true);
      // They shouldn't both have the turn
      expect(p1StillTurn && p2NowTurn).toBe(false);
    } else {
      console.log('No unique rank found - P1 and P2 have all same ranks');
    }
  }, 60000);
});
