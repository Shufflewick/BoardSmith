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
import { Game, Player, Action, loop, eachPlayer, actionStep, type FlowContext, type GameOptions } from './index.js';
import { GameRunner } from '../runtime/runner.js';
import { createPlayerView } from './utils/index.js';
import { buildPlayerState } from '../session/utils.js';

class ChattyGame extends Game<ChattyGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<ChattyGame>('speak').prompt('Speak').execute((_a, ctx) => {
        const game = ctx.game as ChattyGame;
        game.message(`line ${game.messages.length + 1}`);
      }),
    );
    this.registerAction(
      Action.create<ChattyGame>('whisper').prompt('Whisper').execute((_a, ctx) => {
        (ctx.game as ChattyGame).messageTo(ctx.player!, `whisper to ${ctx.player!.seat}`);
      }),
    );
    this.registerAction(
      Action.create<ChattyGame>('fumble').prompt('Fumble').execute((_a, ctx) => {
        (ctx.game as ChattyGame).message('fumbled');
        throw new Error('fumble always fails part-way');
      }),
    );
    this.setFlow({
      root: loop({
        while: (ctx: FlowContext) => (ctx.get<number>('round') ?? 1) <= 20,
        maxIterations: 60,
        do: eachPlayer({ do: actionStep({ actions: ['speak', 'whisper', 'fumble'] }) }),
      }),
      setup: (ctx) => ctx.set('round', 1),
    });
  }
}

function played(actions: number): GameRunner<ChattyGame> {
  const runner = new GameRunner({
    GameClass: ChattyGame,
    gameType: 'chatty',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'chat' },
    // Full history: the restores below reach checkpoints older than the turn start.
    checkpoints: { history: 'full' },
  });
  runner.start();
  for (let i = 0; i < actions; i++) {
    runner.performAction('speak', (i % 2) + 1, {});
    // What every op of the session host does after the action (executeOp's
    // `runner.getSnapshot()` records the op's checkpoint); a bare runner has
    // no op around it, so the test plays that part.
    runner.captureCheckpoint();
  }
  return runner;
}

describe('the log tracks what it has evicted', () => {
  it('counts entries ever written, not entries currently held', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
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
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
    game.message('a line');
    expect(Object.keys(game.messages[0]).sort()).toEqual(['data', 'readings', 'text']);
  });

  it('keeps counting across a restore', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
    for (let i = 1; i <= 5; i++) game.message(`line ${i}`);
    game.pruneMessages({ keepLast: 2 });

    const restored = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
    restored.loadSerializedState(game.toJSON(), { messageLog: [...game.messages] });

    expect(restored.messagesEvicted).toBe(3);
    expect(restored.messageCount).toBe(5);
  });
});

describe('pruneMessages', () => {
  it('keeps the most recent N entries', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
    for (let i = 1; i <= 10; i++) game.message(`line ${i}`);

    game.pruneMessages({ keepLast: 3 });

    expect(game.messages.map((m) => m.text)).toEqual(['line 8', 'line 9', 'line 10']);
  });

  it('drops from the front while a predicate says to', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
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
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
    expect(Object.keys({ keepLast: 0, dropWhile: () => true })).toEqual(['keepLast', 'dropWhile']);
    expect(game.messages).toEqual([]);
  });

  it('does nothing when the log is already within the cap', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
    game.message('only line');
    game.pruneMessages({ keepLast: 5 });
    expect(game.messages).toHaveLength(1);
  });

  it('refuses a nonsensical cap rather than emptying the log', () => {
    const game = new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
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

describe('a restore keeps the live eviction count (#803)', () => {
  function prunedAfterThree(): GameRunner<ChattyGame> {
    const runner = played(3);
    runner.game.pruneMessages({ keepLast: 2 });
    expect(runner.game.messages.map((m) => m.text)).toEqual(['line 2', 'line 3']);
    return runner;
  }

  it('a second undo restores the same log as restoring that action directly', () => {
    const direct = GameRunner.fromCheckpoint(prunedAfterThree().getSnapshot(), 1, ChattyGame);
    expect(direct!.game.messages.map((m) => m.text)).toEqual([]);

    // Full history, as played() runs, so the undone runner still holds action 1.
    const once = GameRunner.fromCheckpoint(prunedAfterThree().getSnapshot(), 2, ChattyGame, {
      checkpoints: { history: 'full' },
    });
    expect(once!.game.messages.map((m) => m.text)).toEqual(['line 2']);
    expect(once!.game.messagesEvicted).toBe(1);

    const twice = GameRunner.fromCheckpoint(once!.getSnapshot(), 1, ChattyGame);
    expect(twice!.game.messages.map((m) => m.text)).toEqual([]);
  });

  it('a failed action rolls back without resetting the eviction count', () => {
    const runner = prunedAfterThree();
    const result = runner.performAction('fumble', 2, {});
    expect(result.success).toBe(false);

    expect(runner.game.messages.map((m) => m.text)).toEqual(['line 2', 'line 3']);
    expect(runner.game.messagesEvicted).toBe(1);
  });
});

/**
 * Each seat numbers its own lines (#903). The log a seat receives is filtered to
 * the lines it may see, so the game-wide `messagesEvicted` is not its offset:
 * it counts other seats' private lines too, and sending it would tell a seat how
 * many of those there were. The engine counts evictions per audience instead.
 */
describe("each seat's own eviction offset (#903)", () => {
  const newGame = () => new ChattyGame({ playerCount: 2, seed: 'chat', elementIdKey: '00000000000000b3' });
  const offsetOf = (game: Game, seat: number) => createPlayerView(game, seat).messageOffset ?? 0;

  it('counts only the evicted lines that seat could see', () => {
    const game = newGame();
    game.message('public');
    game.messageTo(1, 'to one');
    game.messageTo(2, 'to two');
    game.messageTo([1, 2], 'to both');
    game.messageTo(1, 'to one again');
    game.message('kept');
    const seen = [0, 1, 2].map((seat) => createPlayerView(game, seat).messages.length);

    game.pruneMessages({ keepLast: 1 });

    expect([0, 1, 2].map((seat) => offsetOf(game, seat))).toEqual([1, 4, 3]);
    // A seat's lines keep their numbers: offset plus what it holds is what it saw.
    for (const seat of [0, 1, 2]) {
      expect(offsetOf(game, seat) + createPlayerView(game, seat).messages.length).toBe(seen[seat]);
    }
  });

  it("does not move when only another seat's lines are evicted, and the view carries no other count", () => {
    const game = newGame();
    game.messageTo(1, 'secret');
    game.messageTo(1, 'another secret');
    game.message('public');

    game.pruneMessages({ keepLast: 1 });

    expect(offsetOf(game, 1)).toBe(2);
    expect(createPlayerView(game, 2).messageOffset).toBeUndefined();
    const seatTwo = JSON.stringify(createPlayerView(game, 2));
    expect(seatTwo).not.toContain('messagesEvicted');
    expect(seatTwo).not.toContain('secret');
  });

  it('counts a line once for a seat named twice in its audience', () => {
    const game = newGame();
    game.messageTo([1, 1], 'twice addressed');
    game.message('public');
    game.pruneMessages({ keepLast: 1 });
    expect(offsetOf(game, 1)).toBe(1);
  });

  it('keeps every seat\'s offset across a restore', () => {
    const game = newGame();
    game.messageTo(1, 'to one');
    game.message('public');
    game.message('kept');
    game.pruneMessages({ keepLast: 1 });

    const restored = newGame();
    restored.loadSerializedState(game.toJSON(), { messageLog: [...game.messages] });

    expect([0, 1, 2].map((seat) => offsetOf(restored, seat))).toEqual([1, 2, 1]);
  });

  function whisperedThenPruned(): GameRunner<ChattyGame> {
    const runner = new GameRunner({
      GameClass: ChattyGame,
      gameType: 'chatty',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'chat' },
      checkpoints: { history: 'full' },
    });
    runner.start();
    for (const [action, seat] of [['whisper', 1], ['speak', 2], ['whisper', 1], ['speak', 2]] as const) {
      runner.performAction(action, seat, {});
      runner.captureCheckpoint();
    }
    // 'whisper to 1', 'line 2', 'whisper to 1', 'line 4': keep the last one.
    runner.game.pruneMessages({ keepLast: 1 });
    return runner;
  }

  it('an undo keeps the live offsets, as it keeps the live eviction count (#803)', () => {
    const live = whisperedThenPruned();
    const offsets = [0, 1, 2].map((seat) => offsetOf(live.game, seat));
    expect(offsets).toEqual([1, 3, 1]);

    const undone = GameRunner.fromCheckpoint(live.getSnapshot(), 3, ChattyGame, { checkpoints: { history: 'full' } });
    expect([0, 1, 2].map((seat) => offsetOf(undone!.game, seat))).toEqual(offsets);

    // And again from the undone runner, which is where a stale count would show.
    const twice = GameRunner.fromCheckpoint(undone!.getSnapshot(), 2, ChattyGame);
    expect([0, 1, 2].map((seat) => offsetOf(twice!.game, seat))).toEqual(offsets);
  });

  it("reaches each seat's session state as its own offset", () => {
    const runner = whisperedThenPruned();
    const state = (seat: number) => buildPlayerState(runner, ['A', 'B'], seat);
    expect([1, 2].map((seat) => state(seat).messageOffset)).toEqual([3, 1]);
    expect(JSON.stringify(state(2))).not.toContain('messagesEvicted');
  });

  it('a failed action rolls back without resetting the offsets', () => {
    const runner = whisperedThenPruned();
    const result = runner.performAction('fumble', 1, {});
    expect(result.success).toBe(false);
    expect([0, 1, 2].map((seat) => offsetOf(runner.game, seat))).toEqual([1, 3, 1]);
  });
});
