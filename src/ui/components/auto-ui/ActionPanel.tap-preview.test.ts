// @vitest-environment jsdom
/**
 * A choice button's board highlight needs a path that is not the mouse (#1606).
 *
 * The highlight hung off `mouseenter` alone. A keyboard player never sees it,
 * and on touch the compatibility mouse events fire in the same gesture as the
 * click, so the choice is committed before its pieces light up. Focus now
 * previews, and on touch the first tap previews and the second commits.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, provide, ref } from 'vue';
import { useActionController } from '../../composables/useActionController.js';
import type { EnrichedActionMetadata } from '../../composables/useActionController.js';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { createBoardInteraction, provideBoardInteraction, type BoardInteraction } from '../../composables/useBoardInteraction.js';
import { documentHasFocus } from './document-has-focus.test-helper.js';

documentHasFocus();

// Go Fish's ask: each rank highlights the cards it names, by id, so the panel is the surface.
const ask: EnrichedActionMetadata = {
  name: 'ask',
  prompt: 'Ask',
  selections: [
    {
      name: 'rank',
      type: 'choice',
      prompt: 'Which rank?',
      choices: [
        { value: '7', display: 'Sevens', refs: [{ ref: { id: 41 }, role: 'highlight' }] },
        { value: 'K', display: 'Kings', refs: [{ ref: { id: 52 }, role: 'highlight' }] },
      ],
    },
  ],
};

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

async function mountPanel() {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  let board!: BoardInteraction;
  const Harness = defineComponent({
    components: { ActionPanel },
    setup() {
      board = createBoardInteraction();
      provideBoardInteraction(board);
      const controller = useActionController({
        sendAction,
        availableActions: ref(['ask']),
        actionMetadata: ref({ ask }),
        isMyTurn: ref(true),
        autoFill: false,
      });
      provide(GAME_CONTEXT_KEYS.actionController, controller);
      return { ask };
    },
    template: `<ActionPanel :available-actions="['ask']" :player-seat="1" :is-my-turn="true" :action-metadata="{ ask }" />`,
  });
  const wrapper = mount(Harness, { attachTo: document.body });
  await flush();
  await wrapper.find('[data-bs-action="ask"]').trigger('click');
  await flush();
  const button = (label: string) => wrapper.findAll('.choice-btn').find(b => b.text() === label)!.element as HTMLElement;
  return { wrapper, board, sendAction, button };
}

/** A tap as the browser reports it: a touch pointerdown, then a click with a press count. */
async function tap(el: HTMLElement): Promise<void> {
  el.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true }), { pointerType: 'touch' }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

it('a first tap on a choice highlights its pieces without committing it, and a second tap commits', async () => {
  const { wrapper, board, sendAction, button } = await mountPanel();

  await tap(button('Sevens'));
  expect(board.hoveredChoice?.targetRefs).toEqual([{ id: 41 }]);
  expect(sendAction).not.toHaveBeenCalled();

  await tap(button('Kings'));
  expect(board.hoveredChoice?.targetRefs).toEqual([{ id: 52 }]);
  expect(sendAction).not.toHaveBeenCalled();

  await tap(button('Kings'));
  expect(sendAction).toHaveBeenCalledWith('ask', { rank: 'K' });
  wrapper.unmount();
});

it('a mouse click commits a choice at once', async () => {
  const { wrapper, sendAction, button } = await mountPanel();
  const kings = button('Kings');
  kings.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true }), { pointerType: 'mouse' }));
  kings.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await flush();
  expect(sendAction).toHaveBeenCalledWith('ask', { rank: 'K' });
  wrapper.unmount();
});

it('a keyboard player focusing a choice sees its pieces highlighted, and leaving it clears them', async () => {
  const { wrapper, board, sendAction, button } = await mountPanel();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

  button('Kings').focus();
  await flush();
  expect(board.hoveredChoice?.targetRefs).toEqual([{ id: 52 }]);
  expect(sendAction).not.toHaveBeenCalled();

  button('Kings').blur();
  await flush();
  expect(board.hoveredChoice).toBeNull();
  wrapper.unmount();
});

it('focus the panel places after a pointer gesture highlights nothing', async () => {
  const { wrapper, board, button } = await mountPanel();
  document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

  button('Sevens').focus();
  await flush();
  expect(board.hoveredChoice).toBeNull();
  wrapper.unmount();
});

it('a highlight a keyboard player focused clears when a pointer moves focus away', async () => {
  const { wrapper, board, button } = await mountPanel();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  button('Kings').focus();
  await flush();
  expect(board.hoveredChoice?.targetRefs).toEqual([{ id: 52 }]);

  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  button('Kings').blur();
  await flush();
  expect(board.hoveredChoice).toBeNull();
  wrapper.unmount();
});

it('focus the panel places on a choice by itself highlights nothing, even for a keyboard player', async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  const { wrapper, board } = await mountPanel();
  expect(document.activeElement?.classList.contains('choice-btn')).toBe(true);
  expect(board.hoveredChoice).toBeNull();
  wrapper.unmount();
});

it('a tap elsewhere ends a preview, so the next tap on the same choice previews it again', async () => {
  const { wrapper, board, sendAction, button } = await mountPanel();
  await tap(button('Kings'));
  document.body.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true }), { pointerType: 'touch' }));
  board.setHoveredChoice(null);

  await tap(button('Kings'));
  expect(board.hoveredChoice?.targetRefs).toEqual([{ id: 52 }]);
  expect(sendAction).not.toHaveBeenCalled();
  wrapper.unmount();
});
