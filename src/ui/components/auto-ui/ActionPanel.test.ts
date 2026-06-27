// @vitest-environment jsdom
/**
 * Tests for ActionPanel helpers and D-03 anchored-choice splitting.
 *
 * The D-03 splitter (splitAnchoredChoices) is extracted as a pure function so it
 * can be tested without mounting the component. This is the "pit of success" design:
 * pure functions are trivially testable.
 *
 * Coverage:
 * - Mixed-anchor choice pick (notation refs): notation choices → anchored, others → primary
 * - Id-only ref choices: KEPT in primary (id refs are highlighting hints, not click targets)
 * - All-unanchored choice pick: all choices in primary, anchored empty
 * - All notation-anchored: primary empty, all in anchored (never dropped)
 * - Non-choice pick type: splitter does not apply (all → primary)
 *
 * D-03 anchor semantics:
 *   NOTATION refs (e.g., { notation: 'a5' }) → anchored → secondary panel list
 *     → board grid makes the cell clickable; panel list provides parity for keyboard/SR.
 *   Id-only refs (e.g., { id: 10 }) → NOT anchored → KEPT in primary
 *     → board HIGHLIGHTS the element but it is not a click selection surface;
 *       panel buttons are the selection surface (Go Fish rank pick).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { splitAnchoredChoices } from './action-panel-helpers.js';
import type { ChoiceWithRefs } from '../../composables/useActionControllerTypes.js';

// ---------------------------------------------------------------------------
// useToast mock — hoisted so the factory runs before module imports
// ---------------------------------------------------------------------------
const mockToast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../composables/useToast', () => ({
  useToast: () => mockToast,
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Panel-only choices (no refs at all)
const unanchored1: ChoiceWithRefs = { value: 'a', display: 'Option A' };
const unanchored2: ChoiceWithRefs = { value: 'b', display: 'Option B', refs: [] };

// Id-only ref choices (Go Fish style — highlighting, NOT board-clickable)
// These must STAY in the panel (not filtered) because clicking the card
// in the hand does not select the rank; the panel button does.
const idOnlyRef1: ChoiceWithRefs = {
  value: 'A',
  display: 'Aces',
  refs: [{ ref: { id: 10 }, role: 'target' }],
};
const idOnlyRef2: ChoiceWithRefs = {
  value: '7',
  display: 'Sevens',
  refs: [{ ref: { id: 11 }, role: 'target' }],
};

// Notation ref choices (Checkers style — truly board-clickable)
// These ARE filtered from the panel because the board grid can select them directly.
const notationRef1: ChoiceWithRefs = {
  value: { toNotation: 'a5' },
  display: 'a5',
  refs: [{ ref: { notation: 'a5' }, role: 'target' }],
};
const notationRef2: ChoiceWithRefs = {
  value: { toNotation: 'c5' },
  display: 'c5',
  refs: [{ ref: { notation: 'c5' }, role: 'target' }],
};

// ---------------------------------------------------------------------------
// splitAnchoredChoices (D-03)
// ---------------------------------------------------------------------------

describe('splitAnchoredChoices (D-03)', () => {
  describe('choice pick with mixed notation anchors', () => {
    it('puts notation-ref choices in anchored and unanchored ones in primary', () => {
      const choices = [unanchored1, notationRef1, unanchored2, notationRef2];
      const result = splitAnchoredChoices(choices, 'choice');
      expect(result.primary).toHaveLength(2);
      expect(result.primary).toContain(unanchored1);
      expect(result.primary).toContain(unanchored2);
      expect(result.anchored).toHaveLength(2);
      expect(result.anchored).toContain(notationRef1);
      expect(result.anchored).toContain(notationRef2);
    });
  });

  describe('id-only ref choices (Go Fish rank / highlight-only)', () => {
    it('keeps id-only ref choices in primary (not board-anchored)', () => {
      // Go Fish rank choices have id-only refs linking to card elements for visual
      // highlighting. The board cannot "click" these selections (grid matches by notation,
      // not by id). The panel buttons are the selection surface for these choices.
      const choices = [idOnlyRef1, idOnlyRef2];
      const result = splitAnchoredChoices(choices, 'choice');
      expect(result.primary).toHaveLength(2);
      expect(result.primary).toContain(idOnlyRef1);
      expect(result.primary).toContain(idOnlyRef2);
      expect(result.anchored).toHaveLength(0);
    });

    it('keeps id-only ref choices in primary even when mixed with unanchored choices', () => {
      const choices = [unanchored1, idOnlyRef1, unanchored2, idOnlyRef2];
      const result = splitAnchoredChoices(choices, 'choice');
      // No notation refs → all go to primary
      expect(result.primary).toHaveLength(4);
      expect(result.anchored).toHaveLength(0);
    });
  });

  describe('choice pick with no anchored choices (panel-only mode)', () => {
    it('keeps all choices in primary when none are notation-anchored', () => {
      const choices = [unanchored1, unanchored2];
      const result = splitAnchoredChoices(choices, 'choice');
      expect(result.primary).toHaveLength(2);
      expect(result.anchored).toHaveLength(0);
    });
  });

  describe('choice pick where all choices are notation-anchored', () => {
    it('puts all choices in anchored — never dropped (secondary panel list provides parity)', () => {
      const choices = [notationRef1, notationRef2];
      const result = splitAnchoredChoices(choices, 'choice');
      expect(result.primary).toHaveLength(0);
      expect(result.anchored).toHaveLength(2);
      expect(result.anchored).toContain(notationRef1);
      expect(result.anchored).toContain(notationRef2);
    });
  });

  describe('non-choice pick types', () => {
    it('does not split for element picks (all go to primary)', () => {
      const choices = [notationRef1, notationRef2];
      const result = splitAnchoredChoices(choices, 'element');
      expect(result.primary).toEqual(choices);
      expect(result.anchored).toHaveLength(0);
    });

    it('does not split for elements picks', () => {
      const choices = [notationRef1, unanchored1];
      const result = splitAnchoredChoices(choices, 'elements');
      expect(result.primary).toEqual(choices);
      expect(result.anchored).toHaveLength(0);
    });

    it('does not split for number picks', () => {
      const choices = [notationRef1];
      const result = splitAnchoredChoices(choices, 'number');
      expect(result.primary).toEqual(choices);
      expect(result.anchored).toHaveLength(0);
    });

    it('does not split for text picks', () => {
      const choices = [notationRef1];
      const result = splitAnchoredChoices(choices, 'text');
      expect(result.primary).toEqual(choices);
      expect(result.anchored).toHaveLength(0);
    });

    it('does not split for undefined pick type', () => {
      const choices = [notationRef1, unanchored1];
      const result = splitAnchoredChoices(choices, undefined);
      expect(result.primary).toEqual(choices);
      expect(result.anchored).toHaveLength(0);
    });
  });

  describe('refs edge cases', () => {
    it('treats a choice with an empty refs array as primary (unanchored)', () => {
      const emptyRefs: ChoiceWithRefs = { value: 'x', display: 'X', refs: [] };
      const choices = [emptyRefs, notationRef1];
      const result = splitAnchoredChoices(choices, 'choice');
      expect(result.primary).toHaveLength(1);
      expect(result.primary).toContain(emptyRefs);
      expect(result.anchored).toHaveLength(1);
      expect(result.anchored).toContain(notationRef1);
    });

    it('treats a choice with no refs property as primary (unanchored)', () => {
      const noRefs: ChoiceWithRefs = { value: 'y', display: 'Y' };
      const choices = [noRefs, notationRef1];
      const result = splitAnchoredChoices(choices, 'choice');
      expect(result.primary).toHaveLength(1);
      expect(result.primary).toContain(noRefs);
      expect(result.anchored).toHaveLength(1);
    });

    it('id-only ref is not treated as anchored (goes to primary)', () => {
      const emptyRefs: ChoiceWithRefs = { value: 'x', display: 'X', refs: [] };
      const choices = [emptyRefs, idOnlyRef1];
      const result = splitAnchoredChoices(choices, 'choice');
      expect(result.primary).toHaveLength(2);
      expect(result.anchored).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// ActionPanel QUICK-01 + QUICK-02 component tests
// ---------------------------------------------------------------------------

/**
 * Minimal controller shape for component tests.
 * Only includes the properties ActionPanel accesses during the tested paths.
 */
function makeTestController(overrides: Record<string, unknown> = {}) {
  const noop = () => undefined;
  return {
    currentAction: ref<string | null>(null),
    isExecuting: ref(false),
    isLoadingChoices: ref(false),
    actionSnapshot: ref(null),
    animationsPending: ref(false),
    showActionPanel: ref(true),
    repeatingState: ref(null),
    multiSelectDraft: ref(null),
    currentArgs: ref<Record<string, unknown>>({}),
    currentPick: ref(null),
    currentChoices: ref([]),
    getCurrentChoices: () => [] as unknown[],
    getValidElements: () => [] as unknown[],
    getCollectedPick: () => null,
    isMultiSelectSelected: () => false,
    start: async () => {},
    fill: async () => ({ valid: true }),
    skip: noop,
    cancel: noop,
    clear: noop,
    execute: async () => ({ success: true }),
    toggleMultiSelect: async () => {},
    confirmMultiSelect: async () => {},
    ...overrides,
  };
}

describe('ActionPanel QUICK-01 — toast.error on rejected actions', () => {
  beforeEach(() => {
    mockToast.error.mockReset();
  });

  it('toast.error is called with fill() rejection error string', async () => {
    const controller = makeTestController({
      currentAction: ref('testAction'),
      currentPick: ref({ name: 'color', type: 'choice', prompt: 'Pick a color' }),
      currentChoices: ref([{ value: 'red', display: 'Red' }]),
      fill: vi.fn().mockResolvedValue({ valid: false, error: 'Selection is invalid.' }),
    });

    const wrapper = mount(ActionPanel, {
      global: { provide: { actionController: controller } },
      props: { availableActions: [], playerSeat: 1, isMyTurn: true },
    });

    // Click the choice button to trigger setSelectionValue → fill()
    const choiceBtn = wrapper.find('.choice-btn');
    expect(choiceBtn.exists()).toBe(true);
    await choiceBtn.trigger('click');
    await Promise.resolve(); // flush async fill()

    expect(mockToast.error).toHaveBeenCalledWith('Selection is invalid.');
  });

  it('toast.error is called with execute() rejection error string', async () => {
    const controller = makeTestController({
      execute: vi.fn().mockResolvedValue({ success: false, error: 'Not your turn.' }),
    });

    const wrapper = mount(ActionPanel, {
      global: { provide: { actionController: controller } },
      props: {
        availableActions: ['testAction'],
        playerSeat: 1,
        isMyTurn: true,
      },
    });

    // Click an action button (no selections → goes directly to executeAction)
    const actionBtn = wrapper.find('.action-btn');
    expect(actionBtn.exists()).toBe(true);
    await actionBtn.trigger('click');
    await Promise.resolve(); // flush async execute()

    expect(mockToast.error).toHaveBeenCalledWith('Not your turn.');
  });
});

describe('ActionPanel QUICK-02 — accessible names on icon-only controls', () => {
  it('cancel button has aria-label="Cancel action"', () => {
    // currentAction must be non-null for the action-config view (and cancel button) to render
    const controller = makeTestController({
      currentAction: ref('testAction'),
    });

    const wrapper = mount(ActionPanel, {
      global: { provide: { actionController: controller } },
      props: { availableActions: [], playerSeat: 1, isMyTurn: true },
    });

    const cancelBtn = wrapper.find('.cancel-btn');
    expect(cancelBtn.exists()).toBe(true);
    expect(cancelBtn.attributes('aria-label')).toBe('Cancel action');
  });
});

// ---------------------------------------------------------------------------
// ActionPanel 108-02 — ActionHelpPopover integration
// ---------------------------------------------------------------------------

/**
 * Helper: mount ActionPanel with isMyTurn=true, no currentAction, and the given
 * action metadata + props, with Teleport stubbed to render inline.
 */
function mountWithHelp(opts: {
  actions: string[];
  actionMetadata?: Record<string, { name: string; prompt?: string; help?: string; selections: [] }>;
  isActionHelpVisible?: boolean;
  disabledActions?: Record<string, string>;
}) {
  const controller = makeTestController();
  return mount(ActionPanel, {
    global: {
      provide: { actionController: controller },
      stubs: { Teleport: true },
    },
    props: {
      availableActions: opts.actions,
      actionMetadata: opts.actionMetadata,
      playerSeat: 1,
      isMyTurn: true,
      isActionHelpVisible: opts.isActionHelpVisible,
      disabledActions: opts.disabledActions,
    },
  });
}

describe('ActionPanel 108-02 — ActionHelpPopover affordance visibility', () => {
  it('renders .action-help-btn when toggle is ON and action has help text', () => {
    const wrapper = mountWithHelp({
      actions: ['move'],
      actionMetadata: {
        move: { name: 'move', prompt: 'Move Piece', help: 'Click a square to move.', selections: [] },
      },
      isActionHelpVisible: true,
    });
    expect(wrapper.find('.action-help-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('does NOT render .action-help-btn when toggle is OFF, even if help exists', () => {
    const wrapper = mountWithHelp({
      actions: ['move'],
      actionMetadata: {
        move: { name: 'move', prompt: 'Move Piece', help: 'Click a square to move.', selections: [] },
      },
      isActionHelpVisible: false,
    });
    expect(wrapper.find('.action-help-btn').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does NOT render .action-help-btn when toggle is ON but action has no help and no disabledActions entry', () => {
    const wrapper = mountWithHelp({
      actions: ['move'],
      actionMetadata: {
        move: { name: 'move', prompt: 'Move Piece', selections: [] },
      },
      isActionHelpVisible: true,
      disabledActions: {},
    });
    expect(wrapper.find('.action-help-btn').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders .action-help-btn when toggle is ON and action has a disabledActions reason (no help)', () => {
    const wrapper = mountWithHelp({
      actions: ['build'],
      actionMetadata: {
        build: { name: 'build', prompt: 'Build', selections: [] },
      },
      isActionHelpVisible: true,
      disabledActions: { build: 'You need more resources.' },
    });
    expect(wrapper.find('.action-help-btn').exists()).toBe(true);
    wrapper.unmount();
  });

  it('existing .action-btn still dispatches startAction (behavior unchanged)', async () => {
    const startSpy = vi.fn().mockResolvedValue(undefined);
    const controller = makeTestController({ start: startSpy });

    const wrapper = mount(ActionPanel, {
      global: {
        provide: { actionController: controller },
        stubs: { Teleport: true },
      },
      props: {
        availableActions: ['attack'],
        actionMetadata: {
          attack: { name: 'attack', prompt: 'Attack', help: 'Strike an adjacent enemy.', selections: [] },
        },
        playerSeat: 1,
        isMyTurn: true,
        isActionHelpVisible: true,
      },
    });

    const actionBtn = wrapper.find('.action-btn');
    expect(actionBtn.exists()).toBe(true);
    await actionBtn.trigger('click');
    await Promise.resolve();

    expect(startSpy).toHaveBeenCalledWith('attack');
    wrapper.unmount();
  });

  it('wraps each action in .action-btn-group', () => {
    const wrapper = mountWithHelp({
      actions: ['move', 'skip'],
      actionMetadata: {
        move: { name: 'move', prompt: 'Move', help: 'Move piece.', selections: [] },
        skip: { name: 'skip', prompt: 'Skip', selections: [] },
      },
      isActionHelpVisible: true,
    });
    const groups = wrapper.findAll('.action-btn-group');
    expect(groups).toHaveLength(2);
    wrapper.unmount();
  });
});
