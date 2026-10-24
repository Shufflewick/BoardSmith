// @vitest-environment jsdom
/**
 * `assertNoHiddenInfoLeak` CHECKS WHAT A BOARD ANNOUNCES (#1470).
 *
 * `renderAsSeat` draws the seat's live regions beside the board (#1468), so a
 * screen reader speaks every announcement to the seat. An announcement naming a
 * card the seat may not see is a leak, even when the board's markup is clean.
 * Spoken sentences are full of counts, seat numbers and ordinary words, so only
 * a whole-word mention of a marker of three or more characters, that the seat is
 * not shown anywhere in its own view, counts.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, onMounted } from 'vue';
import { Card } from '../engine/index.js';
import { makeSecretHandGame, type SecretHandGame } from './dom-leak.test-helper.js';
import { assertNoHiddenInfoLeak, preloadSeatRenderer } from './dom-leak.js';
import { useAnnouncer } from '../ui/composables/useAnnouncer.js';
import type { TestGame } from './test-game.js';

await preloadSeatRenderer();

/** A board with clean markup that makes the given announcements, in order, once mounted. */
function announcingBoard(...messages: Array<{ text: string; assertive?: boolean }>) {
  return defineComponent({
    name: 'AnnouncingBoard',
    setup() {
      const { announce } = useAnnouncer();
      onMounted(() => {
        for (const { text, assertive } of messages) announce(text, { assertive });
      });
      return () => h('div', { class: 'board' });
    },
  });
}

/** Sets the rank of `seat`'s secret card. */
function setRank(tg: TestGame<SecretHandGame>, seat: number, rank: string): void {
  (tg.game.first(Card, `${seat}-secret-card`) as Card & { rank: string }).rank = rank;
}

describe('assertNoHiddenInfoLeak checks what the board announces (#1470)', () => {
  it("fails when the board announces another seat's hidden card, naming it", async () => {
    const tg = makeSecretHandGame('announce-leak');
    const board = announcingBoard({ text: 'Your opponent drew the King' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).rejects.toThrow(
      /Hidden-info leak: "King".*the polite live region \(announce\): Your opponent drew the King/s,
    );
  });

  it('fails on an urgent announcement a later one replaced', async () => {
    const tg = makeSecretHandGame('announce-replaced');
    const board = announcingBoard({ text: 'Opponent holds 2-secret-card', assertive: true }, { text: 'Your turn', assertive: true });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).rejects.toThrow(
      /Hidden-info leak: "2-secret-card".*the assertive live region \(announce\)/s,
    );
  });

  it("passes a word the seat is shown elsewhere, though another seat's hidden card holds it too", async () => {
    const tg = makeSecretHandGame('announce-shown');
    setRank(tg, 1, 'King');
    const board = announcingBoard({ text: 'You hold the King' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).resolves.not.toThrow();
  });

  it('passes a hidden value that is only part of a longer word', async () => {
    const tg = makeSecretHandGame('announce-part-word');
    const board = announcingBoard({ text: 'Welcome to the Kingdom' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).resolves.not.toThrow();
  });

  it('fails on a hidden value said in lowercase (#1471)', async () => {
    const tg = makeSecretHandGame('announce-lowercase');
    const board = announcingBoard({ text: 'Your opponent drew a king' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).rejects.toThrow(/Hidden-info leak: "King".*drew a king/s);
  });

  it('fails on a hidden value said as a plural (#1471)', async () => {
    const tg = makeSecretHandGame('announce-plural');
    const board = announcingBoard({ text: 'Two Kings left' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).rejects.toThrow(/Hidden-info leak: "King".*Two Kings left/s);
    setRank(tg, 2, 'Glass');
    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: announcingBoard({ text: 'Two glasses broke' }) }),
    ).rejects.toThrow(/Hidden-info leak: "Glass"/);
  });

  it('passes a word the seat is shown elsewhere in a different case (#1471)', async () => {
    const tg = makeSecretHandGame('announce-shown-case');
    setRank(tg, 1, 'king');
    const board = announcingBoard({ text: 'Bob asked for a King' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).resolves.not.toThrow();
  });

  it('does not read an es word as the plural of a hidden value that takes s (#1471 review F1)', async () => {
    const tg = makeSecretHandGame('announce-not-es');
    setRank(tg, 2, 'Not');
    const board = announcingBoard({ text: 'Take notes' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).resolves.not.toThrow();
  });

  it('passes a word the seat is shown elsewhere as a plural (#1471 review F8)', async () => {
    const tg = makeSecretHandGame('announce-shown-plural');
    setRank(tg, 1, 'Kings');
    const board = announcingBoard({ text: 'Bob asked for a King' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).resolves.not.toThrow();
  });

  it('does not read a count as a short hidden rank', async () => {
    const tg = makeSecretHandGame('announce-short');
    setRank(tg, 2, '7');
    const board = announcingBoard({ text: 'Your opponent holds 7 cards' });

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).resolves.not.toThrow();
  });

  describe('a hidden value that is also an ordinary word (#1472)', () => {
    const willEntry = (tg: TestGame<SecretHandGame>) =>
      `allow: (marker, ctx) => marker === "Will" && ctx.elementId === ${tg.game.first(Card, '2-secret-card')!.id} && ctx.announcement === "you will draw"`;

    it('fails naming the allow entry that accepts the announcement', async () => {
      const tg = makeSecretHandGame('announce-ordinary-word');
      setRank(tg, 2, 'Will');
      const board = announcingBoard({ text: 'you will draw' });

      await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining(willEntry(tg)) }),
      );
    });

    it('passes with that allow entry, while the hidden value said elsewhere still fails', async () => {
      const tg = makeSecretHandGame('announce-ordinary-word-allowed');
      setRank(tg, 2, 'Will');
      const card = tg.game.first(Card, '2-secret-card')!;
      const allow = (marker: string, ctx: { elementId: number; announcement?: string }) =>
        marker === 'Will' && ctx.elementId === card.id && ctx.announcement === 'you will draw';

      await expect(
        assertNoHiddenInfoLeak(tg, 1, { component: announcingBoard({ text: 'you will draw' }), allow }),
      ).resolves.not.toThrow();
      await expect(
        assertNoHiddenInfoLeak(tg, 1, {
          component: announcingBoard({ text: 'you will draw' }, { text: 'Opponent drew a Will' }),
          allow,
        }),
      ).rejects.toThrow(/Hidden-info leak: "Will".*Opponent drew a Will/s);
      await expect(
        assertNoHiddenInfoLeak(tg, 1, {
          component: announcingBoard({ text: 'you will draw' }, { text: 'Opponent holds 2-secret-card' }),
          allow,
        }),
      ).rejects.toThrow(/Hidden-info leak: "2-secret-card"/);
    });
  });
});
