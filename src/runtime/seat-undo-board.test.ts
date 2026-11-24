import { describe, it, expect } from 'vitest';
import { Action, Game, Player, Piece, Space, simultaneousActionStep, type GameOptions } from '../engine/index.js';
import { snapshotTree } from '../engine/utils/index.js';
import { GameRunner } from './runner.js';
import { decideUndo } from '../session/utils.js';
import { createHeadlessSession } from '../testing/headless-session.js';
import { succeeded } from '../session/op-result.test-helper.js';
import type { PlayerGameState } from '../session/types.js';
import { PendingActionManager } from '../session/pending-action-manager.js';

// #1787: in a step declared `seatUndo: true`, an action declared
// `.seatUndoable()` may change the shared board and still be taken back by its
// seat, until another seat's action changes or picks what it changed.

class Sector extends Space<MapGame> {}
class Squad extends Space<MapGame> {}
class Merc extends Piece<MapGame> {
  target?: Merc;
}

class Rebel extends Player<MapGame, Rebel> {
  inspected = 0;
}

class MapGame extends Game<MapGame, Rebel> {
  static PlayerClass = Rebel;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Sector, Squad, Merc]);
    const north = this.create(Sector, 'north');
    const south = this.create(Sector, 'south');
    this.create(Sector, 'east');
    const alpha = north.create(Squad, 'alpha');
    alpha.create(Merc, 'ann');
    alpha.create(Merc, 'bob');
    const bravo = south.create(Squad, 'bravo');
    bravo.create(Merc, 'cal').target = alpha.first(Merc, 'bob');
    bravo.create(Merc, 'dee');
    for (const player of this.players) player.create(Merc, `reserve-${player.seat}`);

    this.registerActions(
      // Breaks a MERC off its squad into a new squad in the same sector.
      Action.create<MapGame>('split')
        .seatUndoable()
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .execute(({ merc }) => {
          const squad = merc.parent as Squad;
          merc.putInto(squad.parent!.create(Squad, `${squad.name}-${merc.name}`));
        }),
      Action.create<MapGame>('join')
        .seatUndoable()
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .chooseElement<'squad', Squad>('squad', { elementClass: Squad })
        .execute(({ merc, squad }) => merc.putInto(squad)),
      Action.create<MapGame>('deploy')
        .seatUndoable()
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .execute(({ merc }) => merc.putInto(this.first(Squad, 'alpha')!)),
      Action.create<MapGame>('dismiss')
        .seatUndoable()
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .execute(({ merc }) => merc.remove()),
      // Moves the MERC as it is picked.
      Action.create<MapGame>('advance')
        .seatUndoable()
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc, onSelect: (merc) => merc.putInto(this.first(Squad, 'bravo')!) })
        .chooseFrom('side', { choices: ['left', 'right'] })
        .execute(() => {}),
      Action.create<MapGame>('reinforce')
        .chooseElement<'squad', Squad>('squad', { elementClass: Squad })
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .execute(({ merc, squad }) => merc.putInto(squad)),
      // Changes only the seat's own player, but reads the MERC it names.
      Action.create<MapGame>('inspect')
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .execute((_args, ctx) => { ctx.player.inspected += 1; }),
      Action.create<MapGame>('scout')
        .seatUndoable()
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .execute(({ merc }) => { if (this.random() < 2) merc.putInto(this.first(Squad, 'bravo')!); }),
      Action.create<MapGame>('regroup')
        .chooseElement<'merc', Merc>('merc', { elementClass: Merc })
        .execute(({ merc }) => merc.putInto(this.first(Squad, 'bravo')!)),
    );
    this.setFlow({
      root: simultaneousActionStep<MapGame>({ name: 'rebels', actions: ['split', 'join', 'deploy', 'dismiss', 'advance', 'reinforce', 'inspect', 'scout', 'regroup'], playerDone: () => false, seatUndo: true }),
    });
  }
}

const gameOptions = { playerCount: 2, seed: 'board-undo', elementIdKey: '0000000000001787' };

function runner(): GameRunner<MapGame> {
  const r = new GameRunner({ GameClass: MapGame, gameType: 'map-game', gameOptions });
  r.start();
  return r;
}

const merc = (r: GameRunner<MapGame>, name: string) => r.game.first(Merc, name)!;
const squad = (r: GameRunner<MapGame>, name: string) => r.game.first(Squad, name);

function act(r: GameRunner<MapGame>, seat: number, action: string, args: Record<string, unknown>): void {
  const result = r.performAction(action, seat, args);
  expect(result.success, result.error).toBe(true);
}

describe("a seat's undo of its own shared-board action (#1787)", () => {
  it('takes back a split straight after it', () => {
    const r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    expect(squad(r, 'alpha-ann')).toBeDefined();

    expect(decideUndo(r, 1).allowed).toBe(true);
    r.undoSeatAction(1);
    expect(squad(r, 'alpha-ann')).toBeUndefined();
    expect(merc(r, 'ann').parent!.name).toBe('alpha');
    expect(squad(r, 'alpha')!.all(Merc).map((m) => m.name)).toEqual(['ann', 'bob']);
  });

  it("takes back a split after another seat's independent action, and keeps that action", () => {
    const r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    act(r, 2, 'split', { merc: merc(r, 'cal') });

    expect(decideUndo(r, 1).allowed).toBe(true);
    r.undoSeatAction(1);
    expect(squad(r, 'alpha-ann')).toBeUndefined();
    expect(merc(r, 'ann').parent!.name).toBe('alpha');
    expect(merc(r, 'cal').parent!.name).toBe('bravo-cal');

    // Seat 2 may still take back its own.
    r.undoSeatAction(2);
    expect(squad(r, 'bravo-cal')).toBeUndefined();

    const replayed = GameRunner.replay({ GameClass: MapGame, gameType: 'map-game', gameOptions }, r.getSnapshot());
    expect(snapshotTree(replayed.getSnapshot())).toEqual(snapshotTree(r.getSnapshot()));
  });

  it("refuses the undo once another seat's action changed what it changed", () => {
    const r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    act(r, 2, 'join', { merc: merc(r, 'cal'), squad: squad(r, 'alpha') });

    expect(decideUndo(r, 1)).toMatchObject({ allowed: false, error: expect.stringMatching(/another seat's action .* changed or used/) });
    expect(() => r.undoSeatAction(1)).toThrow();
  });

  it("refuses the undo once another seat's action picked what it changed", () => {
    const r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    act(r, 2, 'inspect', { merc: merc(r, 'ann') });

    expect(decideUndo(r, 1)).toMatchObject({ allowed: false, error: expect.stringMatching(/another seat's action .* changed or used/) });
  });

  it('keeps the later actions the conflict did not reach undoable', () => {
    const r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    act(r, 2, 'inspect', { merc: merc(r, 'ann') });
    act(r, 1, 'split', { merc: merc(r, 'dee') });

    r.undoSeatAction(1);
    expect(squad(r, 'bravo-dee')).toBeUndefined();
    expect(decideUndo(r, 1).allowed).toBe(false);
  });

  it('keeps the other fences: a random draw, or a board change the action does not declare', () => {
    const r = runner();
    act(r, 1, 'scout', { merc: merc(r, 'ann') });
    expect(decideUndo(r, 1)).toMatchObject({ allowed: false, error: expect.stringContaining('drew a random number') });
    act(r, 2, 'regroup', { merc: merc(r, 'bob') });
    expect(decideUndo(r, 2)).toMatchObject({ allowed: false, error: expect.stringContaining('changed the game outside your own player') });
  });

  it("puts back a MERC brought from the seat's own player, and one removed from the board", () => {
    const r = runner();
    act(r, 1, 'deploy', { merc: merc(r, 'reserve-1') });
    act(r, 1, 'dismiss', { merc: merc(r, 'bob') });
    act(r, 2, 'split', { merc: merc(r, 'dee') });
    expect(squad(r, 'alpha')!.all(Merc).map((m) => m.name)).toEqual(['ann', 'reserve-1']);

    r.undoSeatAction(1);
    r.undoSeatAction(1);
    expect(squad(r, 'alpha')!.all(Merc).map((m) => m.name)).toEqual(['ann', 'bob']);
    expect(r.game.getPlayer(1)!.all(Merc).map((m) => m.name)).toEqual(['reserve-1']);
    expect(merc(r, 'dee').parent!.name).toBe('bravo-dee');
  });

  it('keeps every element reference on the board pointing where it pointed', () => {
    const r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    r.undoSeatAction(1);
    expect(merc(r, 'cal').target).toBe(merc(r, 'bob'));
  });

  it('takes back what the picks of the action moved', async () => {
    const r = runner();
    const picks = new PendingActionManager(r);
    succeeded(await picks.processSelectionStep(1, 'merc', merc(r, 'ann').id, 'advance'));
    succeeded(await picks.processSelectionStep(1, 'side', 'left'));
    expect(merc(r, 'ann').parent!.name).toBe('bravo');

    expect(decideUndo(r, 1).allowed).toBe(true);
    r.undoSeatAction(1);
    expect(squad(r, 'alpha')!.all(Merc).map((m) => m.name)).toEqual(['ann', 'bob']);
  });

  it("refuses the undo once another seat picked what it changed, before finishing its action", async () => {
    const r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    const picks = new PendingActionManager(r);
    succeeded(await picks.processSelectionStep(2, 'squad', squad(r, 'alpha-ann')!.id, 'reinforce'));

    expect(decideUndo(r, 1)).toMatchObject({ allowed: false, error: expect.stringMatching(/another seat's action .* changed or used/) });
  });

  it('carries the undo across a snapshot', () => {
    let r = runner();
    act(r, 1, 'split', { merc: merc(r, 'ann') });
    r = GameRunner.fromSnapshot(JSON.parse(JSON.stringify(r.getSnapshot())), MapGame);
    r.undoSeatAction(1);
    expect(squad(r, 'alpha-ann')).toBeUndefined();
  });
});

describe("a seat's undo of a shared-board action at a hosted table (#1787)", () => {
  it('shows every seat the board as it was before the action', async () => {
    const table = createHeadlessSession({ gameClass: MapGame, gameType: 'map-game', minPlayers: 2, maxPlayers: 2 }, { playerCount: 2, seed: 'board-undo' });
    await table.host.start();
    const key = () => table.metas.at(-1)!.turnBoundary.key;
    const seatState = (seat: number) => (table.broadcasts.at(-1) as Array<{ state: PlayerGameState }>)[seat - 1]!.state;
    type ViewNode = { id: number; className: string; name?: string; children?: ViewNode[] };
    const nodes = (node: ViewNode): ViewNode[] => [node, ...(node.children ?? []).flatMap(nodes)];
    const seen = (seat: number) => nodes(seatState(seat).view as unknown as ViewNode);
    const squadNames = (seat: number) => seen(seat).filter((n) => n.className === 'Squad').map((n) => `${n.name}: ${n.children?.map((c) => c.name)}`);
    const annId = seen(1).find((n) => n.name === 'ann')!.id;
    const before = squadNames(2);

    succeeded(await table.host.handleOp(1, { type: 'action', actionName: 'split', player: 1, args: { merc: annId }, boundaryKey: key() }));
    expect(squadNames(2)).not.toEqual(before);
    expect(seatState(1).canUndo).toBe(true);

    succeeded(await table.host.handleOp(1, { type: 'undo', player: 1 }));
    expect(squadNames(2)).toEqual(before);
  });
});
