// @vitest-environment jsdom
/**
 * LIBX-01 dock suppression: `.suppressFromDock()` hides a REDUNDANT dock button,
 * and never the last one.
 *
 * History, because the contract inverted here and the reason matters. LIBX-01
 * originally let per-action suppression empty the dock, and GameShell responded
 * by unmounting ActionPanel and rendering a bare turn strip instead. A review
 * (WR-01) spotted that unmounting mid-pick drops the anchored-choices operable
 * button list — the keyboard/SR safety net (A11Y C-2) — for exactly the kind of
 * action the net exists to protect, and added a `hasInProgressPick` escape hatch.
 *
 * That guard only covers actions that HAVE a pick. An action with NO selections
 * can never start one, so a game whose sole available action was a suppressed
 * no-selection confirm emptied the dock, showed a prompt with nothing to press,
 * and could never reach the guard — a state the player cannot leave. Reported
 * from a real port.
 *
 * The fix is at the mechanism rather than the guard: suppression now falls back
 * to showing the suppressed actions when they are all that is left (see
 * ActionPanel's `visibleActions`), so "all suppressed" is not a state GameShell
 * has to defend against at all. The only thing that removes the panel is the
 * explicit platform escape hatch.
 *
 * Two levels are covered below: the filter that makes the guarantee true
 * (ActionPanel), and the shell gate that no longer needs to know about it.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, computed } from 'vue';
import { mount } from '@vue/test-utils';

interface ActionMetaEntry {
  suppressFromDock?: boolean;
}

// ── Level 1: the suppression filter itself ──────────────────────────────────
// Mirrors ActionPanel.vue's `visibleActions` computed exactly.
function visibleActions<T extends ActionMetaEntry>(actions: T[]): T[] {
  const unsuppressed = actions.filter(a => !a.suppressFromDock);
  return unsuppressed.length > 0 ? unsuppressed : actions;
}

describe('suppressFromDock filter (ActionPanel.visibleActions)', () => {
  it('hides a suppressed action while another action is offered', () => {
    const actions = [
      { name: 'drag', suppressFromDock: true },
      { name: 'pass' },
    ];
    expect(visibleActions(actions).map(a => a.name)).toEqual(['pass']);
  });

  it('shows a suppressed action when it is the ONLY one — the dock is never emptied', () => {
    const actions = [{ name: 'confirm', suppressFromDock: true }];
    expect(visibleActions(actions).map(a => a.name)).toEqual(['confirm']);
  });

  it('shows ALL of them when every available action is suppressed', () => {
    const actions = [
      { name: 'dragA', suppressFromDock: true },
      { name: 'dragB', suppressFromDock: true },
    ];
    expect(visibleActions(actions).map(a => a.name)).toEqual(['dragA', 'dragB']);
  });

  it('THE REPORTED TRAP: a sole no-selection confirm still has a button to press', () => {
    // No selections means no pick can ever start, so the mid-pick keyboard/SR
    // affordance can never appear either. If this list is empty the player is
    // shown a prompt and given nothing at all — with no way out.
    const actions = [{ name: 'endScoring', suppressFromDock: true }];
    expect(visibleActions(actions).length).toBeGreaterThan(0);
  });

  it('leaves an ordinary unsuppressed dock untouched', () => {
    const actions = [{ name: 'move' }, { name: 'pass' }];
    expect(visibleActions(actions).map(a => a.name)).toEqual(['move', 'pass']);
  });
});

// ── Level 2: the shell gate ─────────────────────────────────────────────────
const DockHarness = defineComponent({
  name: 'DockHarness',
  props: {
    platformActionPanelEscapeHatch: { type: Boolean, default: false },
    availableActionNames: { type: Array as () => string[], default: () => [] },
    actionMetadata: {
      type: Object as () => Record<string, ActionMetaEntry> | undefined,
      default: undefined,
    },
  },
  setup(props) {
    // Retained only to prove it no longer gates anything: even when every
    // available action is suppressed, the panel stays mounted.
    const allSuppressed = computed(() => {
      const meta = props.actionMetadata;
      const names = props.availableActionNames;
      if (!meta || names.length === 0) return false;
      return names.every((n) => meta[n]?.suppressFromDock === true);
    });
    return { allSuppressed };
  },
  template: `
    <div class="actionbar">
      <span v-if="platformActionPanelEscapeHatch" class="turn">
        <span class="pr">turn prompt</span>
      </span>
      <template v-if="!platformActionPanelEscapeHatch">
        <div class="action-panel-stub">action buttons</div>
      </template>
    </div>
  `,
});

describe('GameShell dock suppression gate (LIBX-01)', () => {
  it('all-suppressed: ActionPanel STAYS MOUNTED (it now has buttons to show)', () => {
    const wrapper = mount(DockHarness, {
      props: {
        availableActionNames: ['hiddenA', 'hiddenB'],
        actionMetadata: {
          hiddenA: { suppressFromDock: true },
          hiddenB: { suppressFromDock: true },
        },
      },
    });

    expect(wrapper.vm.allSuppressed).toBe(true); // the condition still holds...
    expect(wrapper.find('.action-panel-stub').exists()).toBe(true); // ...and no longer matters
    expect(wrapper.find('.turn').exists()).toBe(false);
  });

  it('some-un-suppressed: ActionPanel mounts (unchanged)', () => {
    const wrapper = mount(DockHarness, {
      props: {
        availableActionNames: ['hiddenA', 'visibleB'],
        actionMetadata: { hiddenA: { suppressFromDock: true }, visibleB: {} },
      },
    });

    expect(wrapper.find('.action-panel-stub').exists()).toBe(true);
    expect(wrapper.find('.turn').exists()).toBe(false);
  });

  it('platformActionPanelEscapeHatch is now the ONLY thing that removes the panel', () => {
    const wrapper = mount(DockHarness, {
      props: {
        platformActionPanelEscapeHatch: true,
        availableActionNames: ['visibleA'],
        actionMetadata: { visibleA: {} },
      },
    });

    expect(wrapper.find('.turn').exists()).toBe(true);
    expect(wrapper.find('.action-panel-stub').exists()).toBe(false);
  });

  it('no metadata / empty availableActions → default unsuppressed rendering', () => {
    const wrapper = mount(DockHarness, {
      props: { availableActionNames: [], actionMetadata: undefined },
    });

    expect(wrapper.find('.action-panel-stub').exists()).toBe(true);
    expect(wrapper.find('.turn').exists()).toBe(false);
  });

  it('a turn indicator is always present, in every suppression combination (T-164-01-02)', () => {
    for (const props of [
      { availableActionNames: ['a'], actionMetadata: { a: { suppressFromDock: true } } },
      { availableActionNames: ['a', 'b'], actionMetadata: { a: { suppressFromDock: true }, b: {} } },
      { platformActionPanelEscapeHatch: true, availableActionNames: ['a'], actionMetadata: { a: {} } },
    ]) {
      const wrapper = mount(DockHarness, { props });
      const hasIndicator =
        wrapper.find('.turn').exists() || wrapper.find('.action-panel-stub').exists();
      expect(hasIndicator).toBe(true);
    }
  });
});

// ── Direct source assertions ────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('source: the guarantee lives in the filter, not in a shell guard', () => {
  const gameShellSource = fs.readFileSync(path.join(here, 'GameShell.vue'), 'utf-8');
  const actionPanelSource = fs.readFileSync(
    path.join(here, 'auto-ui', 'ActionPanel.vue'),
    'utf-8'
  );

  it('ActionPanel falls back to the full list rather than rendering an empty dock', () => {
    expect(actionPanelSource).toMatch(
      /unsuppressed\.length > 0 \? unsuppressed : actionsWithMetadata\.value/
    );
  });

  it('GameShell no longer gates the panel on suppression at all', () => {
    expect(gameShellSource).not.toContain('allDockActionsSuppressed');
    // The mid-pick escape hatch existed only to soften that gate; with the gate
    // gone it would be dead weight implying a hazard that no longer exists.
    expect(gameShellSource).not.toContain('hasInProgressPick');
  });

  it('GameShell still honours the platform escape hatch (decl + default + both usages)', () => {
    const occurrences = gameShellSource.split('platformActionPanelEscapeHatch').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
    expect(gameShellSource).not.toContain('suppressActionPanel');
  });
});
