// @vitest-environment jsdom
/**
 * GameShell — LIBX-01 dock suppression: per-action suppressFromDock all-suppressed
 * fallback + platformActionPanelEscapeHatch rename (164-03).
 *
 * Uses a harness that mirrors the exact production wiring from GameShell.vue
 * (same pattern as GameShell.action-help.test.ts / GameShell.ia.test.ts) rather
 * than mounting the full WebSocket-dependent GameShell.
 *
 * Mirrors GameShell.vue's:
 *   const allDockActionsSuppressed = computed(() => {
 *     const meta = actionMetadata.value;
 *     const names = availableActions.value as string[];
 *     if (!meta || names.length === 0) return false;
 *     return names.every((n) => meta[n]?.suppressFromDock === true);
 *   });
 *   const hasInProgressPick = computed(() => actionController.currentAction.value !== null);
 *
 *   <span v-if="props.platformActionPanelEscapeHatch || (allDockActionsSuppressed && !hasInProgressPick)" class="turn">
 *   <template v-if="!props.platformActionPanelEscapeHatch && (!allDockActionsSuppressed || hasInProgressPick)">
 *     <ActionPanel .../>
 *   </template>
 *
 * Pre-fix (LIBX-01 rename): the old passthrough prop name `suppressActionPanel` and
 * a missing allDockActionsSuppressed computed mean an all-suppressed availableActions
 * set still mounts the full ActionPanel (which itself renders zero buttons post-Task-2,
 * leaving no turn indicator at all) — these tests fail pre-fix.
 *
 * Pre-fix (164-WR-01): `allDockActionsSuppressed` alone (without the `hasInProgressPick`
 * escape hatch) fully unmounts ActionPanel — including its anchored-choices operable
 * button list — the instant EVERY available action is suppressFromDock, even mid-pick
 * on such an action. That drops the keyboard/SR safety net (A11Y C-2) for exactly the
 * scenario it exists to protect (a suppressFromDock action whose board widget isn't
 * itself keyboard-operable). Case (d) below fails pre-fix.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, computed } from 'vue';
import { mount } from '@vue/test-utils';

interface ActionMetaEntry {
  suppressFromDock?: boolean;
}

const DockHarness = defineComponent({
  name: 'DockHarness',
  props: {
    platformActionPanelEscapeHatch: { type: Boolean, default: false },
    availableActionNames: { type: Array as () => string[], default: () => [] },
    actionMetadata: {
      type: Object as () => Record<string, ActionMetaEntry> | undefined,
      default: undefined,
    },
    // WR-01: mirrors `actionController.currentAction.value !== null`.
    hasInProgressPick: { type: Boolean, default: false },
  },
  setup(props) {
    // Mirrors GameShell.vue's allDockActionsSuppressed computed exactly.
    const allDockActionsSuppressed = computed(() => {
      const meta = props.actionMetadata;
      const names = props.availableActionNames;
      if (!meta || names.length === 0) return false;
      return names.every((n) => meta[n]?.suppressFromDock === true);
    });

    return { allDockActionsSuppressed };
  },
  template: `
    <div class="actionbar">
      <span v-if="platformActionPanelEscapeHatch || (allDockActionsSuppressed && !hasInProgressPick)" class="turn">
        <span class="pr">turn prompt</span>
      </span>
      <template v-if="!platformActionPanelEscapeHatch && (!allDockActionsSuppressed || hasInProgressPick)">
        <div class="action-panel-stub">action buttons</div>
      </template>
    </div>
  `,
});

describe('GameShell dock suppression (LIBX-01, 164-03)', () => {
  it('(a) all-suppressed: renders the turn-strip and does NOT mount the ActionPanel', () => {
    const wrapper = mount(DockHarness, {
      props: {
        availableActionNames: ['hiddenA', 'hiddenB'],
        actionMetadata: {
          hiddenA: { suppressFromDock: true },
          hiddenB: { suppressFromDock: true },
        },
      },
    });

    expect(wrapper.find('.turn').exists()).toBe(true);
    expect(wrapper.find('.action-panel-stub').exists()).toBe(false);
  });

  it('(b) some-un-suppressed: ActionPanel mounts (turn strip absent)', () => {
    const wrapper = mount(DockHarness, {
      props: {
        availableActionNames: ['hiddenA', 'visibleB'],
        actionMetadata: {
          hiddenA: { suppressFromDock: true },
          visibleB: {},
        },
      },
    });

    expect(wrapper.find('.action-panel-stub').exists()).toBe(true);
    expect(wrapper.find('.turn').exists()).toBe(false);
  });

  it('(c) platformActionPanelEscapeHatch:true regression — full suppression + turn strip under the new name', () => {
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

  it('no metadata / empty availableActions → default unsuppressed rendering (ActionPanel mounts, no turn strip)', () => {
    const wrapper = mount(DockHarness, {
      props: {
        availableActionNames: [],
        actionMetadata: undefined,
      },
    });

    expect(wrapper.find('.action-panel-stub').exists()).toBe(true);
    expect(wrapper.find('.turn').exists()).toBe(false);
  });

  it('a turn indicator is always present in the all-suppressed case (T-164-01-02)', () => {
    const wrapper = mount(DockHarness, {
      props: {
        availableActionNames: ['hiddenA'],
        actionMetadata: { hiddenA: { suppressFromDock: true } },
      },
    });

    // Never zero turn indicator: either the ActionPanel or the turn strip renders.
    const hasIndicator =
      wrapper.find('.turn').exists() || wrapper.find('.action-panel-stub').exists();
    expect(hasIndicator).toBe(true);
    // And specifically it's the turn strip (ActionPanel is deliberately absent here).
    expect(wrapper.find('.turn').exists()).toBe(true);
  });

  it('(d) all-suppressed BUT a pick is in progress: ActionPanel stays mounted (keyboard/SR safety net, WR-01), turn strip yields', () => {
    const wrapper = mount(DockHarness, {
      props: {
        availableActionNames: ['hiddenA'],
        actionMetadata: { hiddenA: { suppressFromDock: true } },
        hasInProgressPick: true,
      },
    });

    expect(wrapper.find('.action-panel-stub').exists()).toBe(true);
    expect(wrapper.find('.turn').exists()).toBe(false);
  });

  it('(e) platformActionPanelEscapeHatch:true still fully suppresses even with a pick in progress (explicit escape hatch wins)', () => {
    const wrapper = mount(DockHarness, {
      props: {
        platformActionPanelEscapeHatch: true,
        availableActionNames: ['hiddenA'],
        actionMetadata: { hiddenA: { suppressFromDock: true } },
        hasInProgressPick: true,
      },
    });

    expect(wrapper.find('.turn').exists()).toBe(true);
    expect(wrapper.find('.action-panel-stub').exists()).toBe(false);
  });
});

// ── Direct source assertions: confirm GameShell.vue itself carries the new
// prop name and computed (not just the mirrored harness above) ──────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('GameShell.vue source: platformActionPanelEscapeHatch rename + allDockActionsSuppressed', () => {
  const gameShellSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'),
    'utf-8'
  );

  it('no longer references the old suppressActionPanel prop name', () => {
    expect(gameShellSource.includes('suppressActionPanel')).toBe(false);
  });

  it('declares the renamed platformActionPanelEscapeHatch prop (decl + default + both v-if usages)', () => {
    const occurrences = gameShellSource.split('platformActionPanelEscapeHatch').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it('defines the allDockActionsSuppressed computed used by both v-if gates', () => {
    expect(gameShellSource).toContain('allDockActionsSuppressed');
    expect(gameShellSource).toMatch(
      /v-if="props\.platformActionPanelEscapeHatch \|\| \(allDockActionsSuppressed && !hasInProgressPick\)"/
    );
    expect(gameShellSource).toMatch(
      /v-if="!props\.platformActionPanelEscapeHatch && \(!allDockActionsSuppressed \|\| hasInProgressPick\)"/
    );
  });

  it('defines the hasInProgressPick computed (WR-01: preserves the A11Y C-2 safety net mid-pick)', () => {
    expect(gameShellSource).toContain('hasInProgressPick');
    expect(gameShellSource).toMatch(
      /hasInProgressPick = computed\(\(\) => actionController\.currentAction\.value !== null\)/
    );
  });
});
