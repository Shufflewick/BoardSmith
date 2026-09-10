/**
 * MOUNTING THE PANEL ON ONE ACTION, AND READING ITS OWN STYLE BLOCK.
 *
 * Both things every test of a panel EDITOR needs, and neither is about the
 * editor. #199 wrote them for the number editor and #229 needed the same two
 * again -- so they live here rather than in whichever test file happened to be
 * written first, which is where the second copy would have started drifting.
 *
 * `ruleFor` reads the component's own `<style>` text rather than a computed
 * style, because jsdom applies no stylesheet: what a component test can hold
 * about layout is what the file DECLARES, and that is exactly the thing a future
 * edit would quietly drop. It is the honest limit of these tests, not a
 * shortcut -- the layout itself is measured in a real browser by
 * `scripts/multiline-text-browser.mjs`.
 */
import { expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';

import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';

/**
 * Mount the panel with one action already started.
 *
 * `autoFill`/`autoExecute` off so the editor stays on screen with its value
 * un-submitted, which is the state every assertion here is about.
 */
export async function mountPanelAt(action: ActionMetadata) {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const controller = useActionController({
    sendAction,
    availableActions: ref([action.name]),
    actionMetadata: ref({ [action.name]: action }),
    isMyTurn: ref(true),
    autoFill: false,
    autoExecute: false,
    fetchPickChoices: vi.fn().mockResolvedValue({ success: true, choices: [] }),
  });
  void controller.start(action.name, {});
  await nextTick();
  const wrapper = mount(ActionPanel, {
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
    props: { availableActions: [action.name], playerSeat: 1, isMyTurn: true },
  });
  await nextTick();
  return { wrapper, controller, sendAction };
}

const PANEL_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ActionPanel.vue'),
  'utf-8',
);

/**
 * One CSS rule's body, by a selector that may be part of a selector LIST.
 *
 * `.number-input` shares its rule with `.text-input`, and a pattern anchored on
 * one of them would miss the other.
 */
export function panelRuleFor(selector: string): string {
  // Every `<selectors> { <body> }` in the file, then the one whose selector list
  // contains this selector.
  const blocks = PANEL_CSS.matchAll(/(^|\n)([^\n{}][^{}]*?)\{([^{}]*)\}/g);
  for (const block of blocks) {
    // A comment can sit on the same run as the selector list; the list is what
    // follows the last `*/`.
    const list = block[2]!.split('*/').pop() as string;
    if (list.split(',').map((one) => one.trim()).includes(selector)) return block[3]!;
  }
  expect.unreachable(`ActionPanel.vue has no \`${selector}\` rule`);
}
