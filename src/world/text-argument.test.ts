/**
 * #394, ACROSS THE WORLD BUILDER: WHAT A PLAYER TYPES IS JUDGED BEFORE IT IS STORED.
 *
 * World text (gossip, mail, shouts) lives in a partition for months, and a
 * partition is refused on the UTF-8 bytes of its JSON. So the rule is proved
 * here on the whole road a world game's text travels, through `TestWorld`:
 * the forwarding `enterText`, the offer a host ships, and a command the world
 * runs and stores. The issue's own reproduction is the first case:
 * `.enterText('message', { maxLength: 200 })` took 200 x U+0001 and stored
 * about 1,200 bytes.
 */
import { describe, expect, it } from 'vitest';
import { Game, Player, Space, type GameOptions } from '../engine/index.js';
import { worldAction, type WorldDefinition } from './index.js';
import { createTestWorld } from '../testing/test-world.js';

class NoticeBoard extends Space<Commons> {
  notice = '';
}

class Commons extends Game<Commons, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([NoticeBoard]);
  }
}

const BOARD = 'board';

function pin(ctx: { world: { partition(name: string): unknown } }, text: string): void {
  (ctx.world.partition(BOARD) as NoticeBoard).notice = text;
}

const post = worldAction<Commons>('post')
  .prompt('Post a notice')
  .needs(() => [BOARD])
  .enterText('message', { maxLength: 200 })
  .execute(({ message }, ctx) => pin(ctx, message));

const letter = worldAction<Commons>('letter')
  .prompt('Write a letter')
  .needs(() => [BOARD])
  .enterText('body', { maxLength: 200, maxBytes: 300, multiline: true })
  .execute(({ body }, ctx) => pin(ctx, body));

const handle = worldAction<Commons>('handle')
  .prompt('Pick a handle')
  .needs(() => [BOARD])
  .enterText('handle', {
    maxLength: 20,
    pattern: { regex: /^[a-z]+$/, message: 'Use lowercase letters only.' },
  })
  .execute(({ handle: chosen }, ctx) => pin(ctx, chosen));

function commons() {
  const world: WorldDefinition = {
    maxPlayers: 1,
    actions: [post, letter, handle],
    view: () => [BOARD],
    genesis: (game: Game) => ({ [BOARD]: game.create(NoticeBoard, 'board') }),
  } as WorldDefinition;
  return { gameClass: Commons, gameType: 'commons', displayName: 'Commons', world };
}

/** What the command was refused with, or null when it ran. */
async function refusalOf(sent: Promise<void>): Promise<string | null> {
  return sent.then(
    () => null,
    (error: unknown) => (error as Error).message,
  );
}

/** The notice on the board, as the seat's view shows it. */
async function notice(world: Awaited<ReturnType<typeof createTestWorld>>): Promise<string> {
  const found = JSON.stringify((await world.getPlayerView(1)).state).match(/"notice":("(?:[^"\\]|\\.)*")/);
  return found ? (JSON.parse(found[1]!) as string) : '';
}

describe("#394 - a world's text argument is judged before it is stored", () => {
  it("refuses the issue's reproduction, 200 x U+0001 in a 200-character field", async () => {
    const world = await createTestWorld({ definition: commons() });
    const refusal = await refusalOf(world.take(1, 'post', { message: '\u0001'.repeat(200) }));
    expect(refusal).toContain("contains characters that can't be stored");
    expect(refusal).toContain('Remove them and try again.');
    expect(await notice(world)).toBe('');
    await world.close();
  });

  it('refuses a lone surrogate the same way', async () => {
    const world = await createTestWorld({ definition: commons() });
    expect(await refusalOf(world.take(1, 'post', { message: 'hi \ud800' }))).toContain(
      "contains characters that can't be stored",
    );
    await world.close();
  });

  it('stores ordinary text, and line breaks in a multiline field', async () => {
    const world = await createTestWorld({ definition: commons() });
    expect(await refusalOf(world.take(1, 'letter', { body: 'Dear Oak,\n\tthe well is dry.' }))).toBeNull();
    expect(await notice(world)).toBe('Dear Oak,\n\tthe well is dry.');
    await world.close();
  });

  it('refuses text over maxBytes, though it is within maxLength', async () => {
    const world = await createTestWorld({ definition: commons() });
    // 100 emoji: 200 characters, 400 bytes.
    expect(await refusalOf(world.take(1, 'letter', { body: '🔥'.repeat(100) }))).toContain(
      'body is too long to store: it takes 400 bytes and the limit is 300.',
    );
    expect(await notice(world)).toBe('');
    await world.close();
  });

  it("refuses a pattern mismatch with the game's own sentence", async () => {
    const world = await createTestWorld({ definition: commons() });
    expect(await refusalOf(world.take(1, 'handle', { handle: 'Bad1' }))).toContain('Use lowercase letters only.');
    await world.close();
  });

  it('ships maxBytes and the pattern with its sentence on the offer, so a panel can apply them', async () => {
    const world = await createTestWorld({ definition: commons() });
    const offers = JSON.parse(JSON.stringify(await world.offersFor(1))) as Array<{
      name: string;
      selections: Array<Record<string, unknown>>;
    }>;
    const pick = (action: string) => offers.find((offer) => offer.name === action)!.selections[0]!;
    expect(pick('letter')).toMatchObject({ maxLength: 200, maxBytes: 300, multiline: true });
    expect(pick('handle')).toMatchObject({
      pattern: { source: '^[a-z]+$', message: 'Use lowercase letters only.' },
    });
    expect('maxBytes' in pick('post')).toBe(false);
    await world.close();
  });
});
