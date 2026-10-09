// @vitest-environment jsdom
/**
 * `assertNoHiddenInfoLeak` SCANS THE PROMPT A BOARD SETS (#564).
 *
 * A table board can replace the action bar's prompt with `setBoardPrompt`, and
 * GameShell shows that text to the seat. So a prompt is a surface hidden
 * information can leak through, even when the board's own markup is clean.
 * `renderAsSeat` records the last prompt the board set, and the scan checks it.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, onMounted, type PropType } from 'vue';
import { collectCards, makeSecretHandGame, type ViewNode } from './dom-leak.test-helper.js';
import { assertNoHiddenInfoLeak, preloadSeatRenderer } from './dom-leak.js';

await preloadSeatRenderer();

/**
 * A board whose markup shows only the redacted view, and which sets the given
 * prompts in order once mounted. `fullTree` is the unredacted tree a careless
 * board might read a prompt from.
 */
function promptingBoard(prompts: (fullTree: ViewNode) => Array<string | null>) {
  return defineComponent({
    name: 'PromptingBoard',
    props: {
      gameView: { type: Object as PropType<ViewNode | null>, default: null },
      fullTree: { type: Object as PropType<ViewNode>, required: true },
      setBoardPrompt: { type: Function as PropType<(prompt: string | null) => void>, required: true },
    },
    setup(props) {
      onMounted(() => {
        for (const prompt of prompts(props.fullTree)) props.setBoardPrompt(prompt);
      });
      return () =>
        h(
          'div',
          { class: 'board' },
          collectCards(props.gameView ?? {}).map((card) =>
            h('div', { 'data-element-id': String(card.id ?? ''), 'aria-label': card.name ?? 'a face-down card' }),
          ),
        );
    },
  });
}

/** The other seat's secret card's rank, read from the unredacted tree. */
function opponentRank(fullTree: ViewNode): string {
  const card = collectCards(fullTree).find((node) => node.name === '2-secret-card') as
    | (ViewNode & { attributes?: { rank?: string } })
    | undefined;
  const rank = card?.attributes?.rank;
  if (rank === undefined) throw new Error('The fixture no longer gives seat 2 a secret card with a rank.');
  return rank;
}

describe('assertNoHiddenInfoLeak scans the board prompt (#564)', () => {
  it('fails when the board sets a prompt naming another seat\'s hidden card', async () => {
    const tg = makeSecretHandGame('board-prompt-leak');
    const board = promptingBoard((tree) => [`Your opponent holds the ${opponentRank(tree)}`]);

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: board, componentProps: { fullTree: tg.game.toJSON() } }),
    ).rejects.toThrow(/Hidden-info leak: "King".*board prompt/s);
  });

  it('passes when the board sets a prompt that names nothing hidden', async () => {
    const tg = makeSecretHandGame('board-prompt-clean');
    const board = promptingBoard(() => ['Pick a card to play']);

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: board, componentProps: { fullTree: tg.game.toJSON() } }),
    ).resolves.not.toThrow();
  });

  it('scans only the last prompt: one the board has given back is no longer shown', async () => {
    const tg = makeSecretHandGame('board-prompt-cleared');
    const board = promptingBoard((tree) => [`Your opponent holds the ${opponentRank(tree)}`, null]);

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: board, componentProps: { fullTree: tg.game.toJSON() } }),
    ).resolves.not.toThrow();
  });
});
