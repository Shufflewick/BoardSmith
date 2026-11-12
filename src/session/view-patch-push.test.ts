import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import type { GameDefinitionLike } from './stateless-ops.js';
import type { PlayerGameState } from './types.js';
import { createHeadlessSession } from '../testing/headless-session.js';
import { applyViewPatch, type ViewPatchOp } from './view-patch.js';

// #1616: after its first push a seat is pushed a patch against the view it was
// last pushed, and a page that applies each push to what it holds has the view
// of record. A patch carries a new log line, not the whole log (#1614).

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

type View = { rev: string; state: PlayerGameState };

async function talkTable() {
  const table = createHeadlessSession(talkDef, { playerCount: 2, seed: 'bs1616' });
  await table.start();
  const recordOf = (seat: number) => (seat === 0 ? table.spectatorViews.at(-1) : (table.broadcasts.at(-1) as unknown[])[seat - 1]) as View;
  // A page connects from the view of record, then applies every push for its seat.
  const pages = new Map<number, unknown>([0, 1, 2].map((seat) => [seat, recordOf(seat)]));
  let read = table.pushes.length;
  const deliver = () => {
    for (const push of table.pushes.slice(read)) {
      for (const p of push) pages.set(p.seat, 'view' in p ? p.view : applyViewPatch(pages.get(p.seat), p.patch));
    }
    read = table.pushes.length;
  };
  const say = async (word = 'hi') => {
    expect((await table.send(1, { type: 'action', actionName: 'say', player: 1, args: { word } })).success).toBe(true);
    deliver();
  };
  const lastOps = (seat: number): ViewPatchOp[] => {
    const push = table.pushes.at(-1)!.find((p) => p.seat === seat)!;
    if (!('patch' in push)) throw new Error(`seat ${seat} was pushed its whole view`);
    return push.patch.ops;
  };
  return { table, pages, say, deliver, recordOf, lastOps };
}

/** The log lines a patch adds, wherever in the log it adds them. */
function linesAdded(ops: ViewPatchOp[]): unknown[] {
  return ops.flatMap((op) => (op[0] === 'splice' && op[1].join('.') === 'state.messages' ? op[4] : []));
}

describe('a seat is pushed what changed, and a page that applies it holds the view of record (#1616)', () => {
  it('after N actions each push carries only that action\'s lines, and every page holds the view of record', async () => {
    const { pages, say, recordOf, lastOps } = await talkTable();
    for (let n = 1; n <= 30; n++) await say();

    // Seat 1 hears the public line and its own; seat 2 and the spectators, the public line only.
    expect(linesAdded(lastOps(1))).toEqual([{ text: 'Player 1 says hi 30' }, { text: 'only you hear 30' }]);
    expect(linesAdded(lastOps(2))).toEqual([{ text: 'Player 1 says hi 30' }]);
    expect(linesAdded(lastOps(0))).toEqual([{ text: 'Player 1 says hi 30' }]);

    for (const seat of [0, 1, 2]) {
      expect(recordOf(seat).state.messages).toHaveLength(seat === 1 ? 61 : 31);
      expect(pages.get(seat)).toEqual(recordOf(seat));
    }
  });

  it('an undo that takes lines back leaves every page holding the view of record', async () => {
    const { table, pages, say, deliver, recordOf } = await talkTable();
    for (let n = 1; n <= 3; n++) await say();
    expect((await table.send(1, { type: 'undo', player: 1 })).success).toBe(true);
    deliver();
    await say('bye');

    // The undo takes back the turn's lines, and the line before the turn stays.
    expect(recordOf(2).state.messages!.map((m) => m.text)).toEqual(['The table opens', 'Player 1 says bye 1']);
    for (const seat of [0, 1, 2]) expect(pages.get(seat)).toEqual(recordOf(seat));
  });

  it('a page that missed a push cannot apply the next, and is served the view of record instead', async () => {
    const { table, pages, say, recordOf } = await talkTable();
    const behind = pages.get(2);
    await say();
    await say();
    const next = table.pushes.at(-1)!.find((p) => p.seat === 2)!;
    expect('patch' in next && applyViewPatch(behind, next.patch)).toBeUndefined();
    expect(pages.get(2)).toEqual(recordOf(2));
  });
});
