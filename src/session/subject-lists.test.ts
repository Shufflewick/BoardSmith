/**
 * A TABLE'S STATE PUSH CARRIES ITS SUBJECT PICKS' LISTS (#1640).
 *
 * The panel inverts each action's first-pick list into which verbs take which
 * thing. A table carried only element lists (#1615), so a choice pick that
 * binds a subject now travels too, as the seat would be answered on opening
 * it. A subject list over MAX_SUBJECT_ROWS is refused: it would ride in every
 * push.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Action, actionStep, subjectType, subjectIndex, MAX_SUBJECT_ROWS, type GameOptions } from '../engine/index.js';
import { createHeadlessSession } from '../testing/headless-session.js';

class Pack extends Piece<SubjectGame> {}
const PACKS = subjectType<Pack>({ name: 'Packs', onBoard: true, label: (pack) => `${pack.name} pack` });
const SECTORS = subjectType<string>({ name: 'Sectors', onBoard: false, key: (sector) => sector, label: (sector) => `Sector ${sector}` });
const done = () => ({ success: true });

class SubjectGame extends Game<SubjectGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const name of ['fusiliers', 'lancers']) this.create(Pack, name);
    const token = (pack: Pack) => `fielded:${pack.id}`;
    const packOf = (value: string, ctx: { game: Game }) => ctx.game.getElementById(Number(value.slice('fielded:'.length))) as Pack;
    const sectors = Array.from({ length: MAX_SUBJECT_ROWS + 1 }, (_, i) => String(i));
    this.registerActions(
      Action.create<SubjectGame>('sellPack').chooseFrom('pack', { choices: (ctx) => ctx.game.all(Pack).map(token), subject: PACKS.of(packOf) }).execute(done),
      Action.create<SubjectGame>('chant').chooseFrom('word', { choices: ['hey', 'ho'] }).execute(done),
      Action.create<SubjectGame>('scan').chooseFrom('sector', { choices: sectors, subject: SECTORS }).execute(done),
      Action.create<SubjectGame>('survey').chooseFrom('sector', { choices: sectors }).execute(done),
    );
    this.setFlow({ root: actionStep({ actions: ['sellPack', 'chant', 'scan', 'survey'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 5 }) });
  }
}

async function table() {
  const session = createHeadlessSession(
    { gameClass: SubjectGame, gameType: 'subjects', minPlayers: 2, maxPlayers: 2 },
    { playerCount: 2, seed: 'subjects', playerNames: ['Alice', 'Bob'] },
  );
  await session.start();
  return session;
}

describe('subject lists in the table state push (#1640)', () => {
  it('carries a subject choice pick\'s list with each row\'s thing, and no list for a pick that binds none', async () => {
    const session = await table();
    const meta = session.playerState(1).actionMetadata!;
    const [fusiliers] = session.readGame().all(Pack);
    expect(meta.sellPack!.selections[0]!.choices![0]).toEqual({
      value: `fielded:${fusiliers!.id}`,
      display: `fielded:${fusiliers!.id}`,
      subject: { type: 'Packs', key: String(fusiliers!.id), element: fusiliers!.id, label: 'fusiliers pack' },
    });
    expect(meta.chant!.selections[0]!.choices).toBeUndefined();
    expect(meta.survey!.selections[0]!.choices).toBeUndefined();
  });

  it('inverts what the push carried into the verbs each thing takes', async () => {
    const session = await table();
    const index = subjectIndex(Object.values(session.playerState(1).actionMetadata!));
    expect(index.things.map((thing) => [thing.label, thing.verbs.map((verb) => verb.action)])).toEqual([
      ['fusiliers pack', ['sellPack']],
      ['lancers pack', ['sellPack']],
    ]);
    expect([...index.listedUnderThings]).toEqual(['sellPack']);
  });

  it('refuses a subject pick over the cap, carrying nothing and saying why when the seat opens it', async () => {
    const session = await table();
    expect(session.playerState(1).actionMetadata!.scan!.selections[0]!.choices).toBeUndefined();
    const opened = await session.send(1, { type: 'resolveChoices', actionName: 'scan', selectionName: 'sector', player: 1, args: {} });
    expect(opened).toMatchObject({ success: false });
    expect((opened as { error: string }).error).toMatch(/"scan".*"sector" lists 201 Sectors.*at most 200.*every state push/);
    const survey = await session.send(1, { type: 'resolveChoices', actionName: 'survey', selectionName: 'sector', player: 1, args: {} });
    expect(survey).toMatchObject({ success: true });
  });
});
