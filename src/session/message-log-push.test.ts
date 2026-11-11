import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import type { GameDefinitionLike } from './stateless-ops.js';
import type { PlayerGameState } from './types.js';
import { createHeadlessSession } from '../testing/headless-session.js';
import { mergeMessageLog } from '../client/message-log.js';

// #1614: a push carries only the log lines its seat was not already sent, and
// a page that merges each push into what it holds has the whole visible log.

class TalkGame extends Game<TalkGame, Player> {
  said = 0;

  constructor(options: GameOptions) {
    super(options);
    this.message('The table opens');
    this.registerAction(
      Action.create('say').chooseFrom('word', { choices: ['hi', 'bye'] }).execute((args, ctx) => {
        this.said++;
        this.message('{{player}} says {{word}} {{n}}', { player: ctx.player, word: args.word, n: this.said });
        this.messageTo(ctx.player, 'only you hear {{n}}', { n: this.said });
        return { success: true };
      }),
    );
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({ actions: ['say'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, turnScope: 'restart' }),
      }),
    });
  }
}

const talkDef: GameDefinitionLike = { gameClass: TalkGame, gameType: 'talk', minPlayers: 2, maxPlayers: 2 };

type View = { state: PlayerGameState };

async function talkTable() {
  const table = createHeadlessSession(talkDef, { playerCount: 2, seed: 'bs1614' });
  await table.start();
  // A page connects from the state of record, then merges every push for its seat.
  const pages = new Map<number, PlayerGameState>();
  for (const seat of [0, 1, 2]) {
    pages.set(seat, seat === 0 ? (table.spectatorViews.at(-1) as View).state : table.playerState(seat));
  }
  let read = table.pushes.length;
  const deliver = () => {
    for (const push of table.pushes.slice(read)) {
      for (const { seat, view } of push) pages.set(seat, mergeMessageLog(pages.get(seat), (view as View).state));
    }
    read = table.pushes.length;
  };
  const say = async (word = 'hi') => {
    expect((await table.send(1, { type: 'action', actionName: 'say', player: 1, args: { word } })).success).toBe(true);
    deliver();
  };
  const recordOf = (seat: number) => (seat === 0 ? (table.spectatorViews.at(-1) as View).state : table.playerState(seat));
  const lastPush = (seat: number) => (table.pushes.at(-1)!.find((p) => p.seat === seat)!.view as View).state;
  return { table, pages, say, deliver, recordOf, lastPush };
}

describe('a push carries only the log lines its seat was not sent (#1614)', () => {
  it('after N actions each push holds only that action\'s lines, and the merged page holds the whole log', async () => {
    const { pages, say, recordOf, lastPush } = await talkTable();
    for (let n = 1; n <= 30; n++) await say();

    // Seat 1 hears the public line and its own; seat 2 and the spectators, the public line only.
    expect(lastPush(1).messages).toEqual([{ text: 'Player 1 says hi 30' }, { text: 'only you hear 30' }]);
    expect(lastPush(1).messagesFrom).toBe(59);
    expect(lastPush(2).messages).toEqual([{ text: 'Player 1 says hi 30' }]);
    expect(lastPush(2).messagesFrom).toBe(30);
    expect(lastPush(0).messages).toEqual([{ text: 'Player 1 says hi 30' }]);

    for (const seat of [0, 1, 2]) {
      expect(recordOf(seat).messages).toHaveLength(seat === 1 ? 61 : 31);
      expect(recordOf(seat).messagesFrom).toBeUndefined();
      expect(pages.get(seat)!.messages).toEqual(recordOf(seat).messages);
      expect(pages.get(seat)!.messagesFrom).toBeUndefined();
    }
  });

  it('an undo that takes lines back is merged into the same log the state of record holds', async () => {
    const { table, pages, say, deliver, recordOf, lastPush } = await talkTable();
    for (let n = 1; n <= 3; n++) await say();
    expect((await table.send(1, { type: 'undo', player: 1 })).success).toBe(true);
    deliver();
    await say('bye');

    // The undo takes back the turn's lines, and the line before the turn stays.
    expect(recordOf(2).messages!.map((m) => m.text)).toEqual(['The table opens', 'Player 1 says bye 1']);
    expect(lastPush(2).messagesFrom).toBe(1);
    for (const seat of [0, 1, 2]) expect(pages.get(seat)!.messages).toEqual(recordOf(seat).messages);
  });

  it('the state of record a page connects from carries the whole log', async () => {
    const { say, recordOf } = await talkTable();
    for (let n = 1; n <= 5; n++) await say();
    expect(recordOf(1).messages).toHaveLength(11);
    expect(recordOf(1).messagesFrom).toBeUndefined();
  });
});
