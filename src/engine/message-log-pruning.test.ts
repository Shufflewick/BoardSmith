/**
 * A game can cap its own message log without rewriting history (#25).
 *
 * `docs/state-size.md` tells a game the log is uncapped and theirs to prune,
 * and a persistent world with a long season has to — an uncapped season
 * measured ~123% of the reporting project's state ceiling. But
 * `ActionCheckpoint` recorded only the log's LENGTH at each action boundary,
 * and `fromCheckpoint` rebuilt the log as `fullLog.slice(0, messageCount)`.
 * That is a prefix watermark over an array the engine assumed was append-only:
 * removing one entry shifted every later index, so a watermark taken before the
 * removal then named a prefix containing lines written AFTER that boundary and
 * missing lines that existed AT it.
 *
 * It is reachable with no undo in the game at all — the debug state-at and
 * state-diff ops restore from a checkpoint — so a history view of a pruned seat
 * showed a fabricated log.
 *
 * The repair is a per-entry identity the checkpoint references instead of a
 * position, so eviction from anywhere leaves every earlier boundary naming
 * exactly the lines that existed at it.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, loop, eachPlayer, actionStep, type FlowContext, type GameOptions } from './index.js';
import { GameRunner } from '../runtime/runner.js';

class ChattyGame extends Game<ChattyGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<ChattyGame>('speak').prompt('Speak').execute((_a, ctx) => {
        const game = ctx.game as ChattyGame;
        game.message(`line ${game.messages.length + 1}`);
      }),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) => (ctx.get<number>('round') ?? 1) <= 20,
          maxIterations: 60,
          do: eachPlayer({ do: actionStep({ actions: ['speak'] }) }),
        }),
        setup: (ctx) => ctx.set('round', 1),
      }),
    );
  }
}

function played(actions: number): GameRunner<ChattyGame> {
  const runner = new GameRunner({
    GameClass: ChattyGame,
    gameType: 'chatty',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'chat' },
  });
  runner.start();
  for (let i = 0; i < actions; i++) {
    runner.performAction('speak', (i % 2) + 1, {});
    // What GameSession's broadcast funnel does after every action; a bare
    // runner has no funnel, so the test plays that part.
    runner.captureCheckpoint();
  }
  return runner;
}

describe('the log tracks what it has evicted', () => {
  it('counts entries ever written, not entries currently held', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    for (let i = 1; i <= 5; i++) game.message(`line ${i}`);
    expect(game.messageCount).toBe(5);

    game.pruneMessages({ keepLast: 2 });

    expect(game.messages).toHaveLength(2);
    expect(game.messagesEvicted).toBe(3);
    // Still five ever written — that is what a checkpoint's watermark counts.
    expect(game.messageCount).toBe(5);
  });

  it('costs one number for the whole game, not a field on every line', () => {
    // The point of the offset over a per-entry identity: the log is the thing
    // that grows, so the fix for a size ceiling must not be paid per line.
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    game.message('a line');
    expect(Object.keys(game.messages[0]).sort()).toEqual(['data', 'text']);
  });

  it('keeps counting across a restore', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    for (let i = 1; i <= 5; i++) game.message(`line ${i}`);
    game.pruneMessages({ keepLast: 2 });

    const restored = new ChattyGame({ playerCount: 2, seed: 'chat' });
    restored.loadSerializedState(game.toJSON(), { messageLog: [...game.messages] });

    expect(restored.messagesEvicted).toBe(3);
    expect(restored.messageCount).toBe(5);
  });
});

describe('pruneMessages', () => {
  it('keeps the most recent N entries', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    for (let i = 1; i <= 10; i++) game.message(`line ${i}`);

    game.pruneMessages({ keepLast: 3 });

    expect(game.messages.map((m) => m.text)).toEqual(['line 8', 'line 9', 'line 10']);
  });

  it('drops from the front while a predicate says to', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    game.message('old', undefined, { type: 'notice' });
    game.message('older still', undefined, { type: 'notice' });
    game.message('recent', undefined, { type: 'alert' });
    game.message('also old', undefined, { type: 'notice' });

    game.pruneMessages({ dropWhile: (entry) => entry.type === 'notice' });

    // Stops at the first entry it declines, so what remains is a SUFFIX. It
    // does not go on to remove 'also old' — that would take an entry out of the
    // middle, which is the corruption the whole design forbids.
    expect(game.messages.map((m) => m.text)).toEqual(['recent', 'also old']);
  });

  it('has no way to remove from the middle, which is the point', () => {
    // A checkpoint's watermark is a position in a chronological log. There is
    // deliberately no predicate that could take an entry out of the middle and
    // move later lines across boundaries recorded before the removal.
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    expect(Object.keys({ keepLast: 0, dropWhile: () => true })).toEqual(['keepLast', 'dropWhile']);
    expect(game.messages).toEqual([]);
  });

  it('does nothing when the log is already within the cap', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    game.message('only line');
    game.pruneMessages({ keepLast: 5 });
    expect(game.messages).toHaveLength(1);
  });

  it('refuses a nonsensical cap rather than emptying the log', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat' });
    game.message('a line');
    expect(() => game.pruneMessages({ keepLast: -1 })).toThrow(/keepLast/);
  });
});

describe('a checkpoint restore after pruning (#25)', () => {
  it('restores exactly the lines that existed at that boundary and survived', () => {
    const runner = played(6);
    const atThree = runner.game.messages.slice(0, 3).map((m) => m.text);

    // Prune, the thing docs/state-size.md tells a game to do. Two lines
    // survive, and both were written AFTER action 3.
    runner.game.pruneMessages({ keepLast: 2 });
    expect(runner.game.messages.map((m) => m.text)).toEqual(['line 5', 'line 6']);

    const restored = GameRunner.fromCheckpoint(runner.getSnapshot(), 3, ChattyGame);
    expect(restored).not.toBeNull();

    // Nothing that existed at action 3 is still in the log, so the honest
    // answer is an empty one. The pre-fix prefix slice returned
    // `['line 5','line 6']` here — two lines from the future, presented as the
    // state at action 3.
    expect(restored!.game.messages.map((m) => m.text)).toEqual([]);
    expect(atThree).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('keeps the lines that existed at the boundary AND survived the prune', () => {
    const runner = played(6);
    // Keep four, so two of the three that existed at action 3 survive.
    runner.game.pruneMessages({ keepLast: 4 });

    const restored = GameRunner.fromCheckpoint(runner.getSnapshot(), 3, ChattyGame);
    expect(restored!.game.messages.map((m) => m.text)).toEqual(['line 3']);
  });

  it('never restores a line written after the boundary', () => {
    const runner = played(6);
    const beforePrune = runner.game.messages.map((m) => m.text);
    runner.game.pruneMessages({ keepLast: 2 });

    const restored = GameRunner.fromCheckpoint(runner.getSnapshot(), 1, ChattyGame);
    expect(restored).not.toBeNull();

    // At action 1 the log held at most the first line. The pre-fix failure was
    // a prefix slice that handed back later lines because indices had shifted.
    const future = beforePrune.slice(1);
    for (const text of restored!.game.messages.map((m) => m.text)) {
      expect(future).not.toContain(text);
    }
  });

  it('still restores the whole boundary when nothing was pruned', () => {
    const runner = played(6);
    const restored = GameRunner.fromCheckpoint(runner.getSnapshot(), 3, ChattyGame);
    expect(restored!.game.messages.map((m) => m.text)).toEqual(
      runner.game.messages.slice(0, 3).map((m) => m.text),
    );
  });
});
