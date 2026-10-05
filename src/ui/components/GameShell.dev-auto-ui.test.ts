// @vitest-environment jsdom
/**
 * THE SHELL OFFERS THE AUTO UI ITSELF, AND ONLY UNDER `boardsmith dev` (#525).
 *
 * Ten games repeated one line in their `src/ui/uis.ts` to get the same
 * dev-only Auto UI: `Auto: devUI(() => import('boardsmith/ui/auto-ui'))`. The
 * shell adds that entry now, so a game's registry lists only its own boards.
 * A production build never sees it: the entry is added behind the same
 * `import.meta.env.DEV` branch `devUI()` uses, which a production build folds
 * away along with the import (treeshake-bundle.test.ts proves the bundle).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { defineGameUIs, defaultUI, devUI, resolveUiComponent, withDevAutoUI } from '../game-uis.js';
import {
  enterIframe,
  leaveIframe,
  mountPlatformShell,
} from './GameShell.platform-mount.test-helper.js';

const Board = defineComponent({ name: 'Board', setup: () => () => h('div', 'board') });
const Other = defineComponent({ name: 'Other', setup: () => () => h('div', 'other') });

afterEach(() => {
  leaveIframe();
  vi.unstubAllEnvs();
});

function devUiLists(posted: unknown[]): unknown[] {
  return posted
    .filter((m) => (m as { type?: unknown }).type === 'dev-ui-list')
    .map((m) => (m as { uis: unknown }).uis);
}

describe('the Auto UI under boardsmith dev (#525)', () => {
  it('is offered in the dev UI switcher without the game listing it', async () => {
    const posted = enterIframe();
    const wrapper = mountPlatformShell({ board: Board });
    await nextTick();

    expect(devUiLists(posted)).toContainEqual(['Stub', 'Auto']);
    wrapper.unmount();
  });

  it('renders the auto UI when the switcher selects it', () => {
    const registry = withDevAutoUI(defineGameUIs({ Board: defaultUI(Board) }));
    expect(registry.names).toEqual(['Board', 'Auto']);
    expect(registry.entries.Auto.devOnly).toBe(true);
    expect(resolveUiComponent(registry, 'Auto', true)).not.toBe(Board);
    expect(resolveUiComponent(registry, 'Auto', true)).not.toBeNull();
  });

  it("leaves a game's own entry named Auto alone, so an auto-UI game is not offered it twice", () => {
    const registry = withDevAutoUI(defineGameUIs({ Auto: defaultUI(Board), Other: devUI(async () => ({ default: Other })) }));
    expect(registry.names).toEqual(['Auto', 'Other']);
    expect(resolveUiComponent(registry, 'Auto', true)).toBe(Board);
  });
});

describe('the Auto UI in a production build (#525)', () => {
  it('is absent: the registry is exactly what the game declared', () => {
    vi.stubEnv('DEV', false);
    const declared = defineGameUIs({ Board: defaultUI(Board) });
    const registry = withDevAutoUI(declared);

    expect(registry.names).toEqual(['Board']);
    expect(registry.entries.Auto).toBeUndefined();
    expect(resolveUiComponent(registry, 'Auto', false)).toBe(Board);
  });
});
