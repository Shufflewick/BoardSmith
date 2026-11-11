/**
 * `defaultUI()` takes the board component itself, never a loader (#1011).
 *
 * A plain function is a valid Vue component type (a functional component), so
 * `defaultUI(() => import('./Board.vue'))` used to compile and render nothing.
 * The `@ts-expect-error` below is checked by `boardsmith typecheck`; the runtime
 * assertion covers untyped JS and casts.
 *
 * A game may also ship a phone UI beside its default one (#1610). The default
 * stays one responsive board; a game that wants a different board on a phone
 * marks it `phoneUI()`, and the shell renders it at the compact size only.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { defineGameUIs, defaultUI, devUI, devUiNames, phoneUI, resolveUiComponent } from './game-uis.js';

const Board = defineComponent({ name: 'Board', render: () => h('div') });
const Phone = defineComponent({ name: 'Phone', render: () => h('div', 'phone') });
const Other = defineComponent({ name: 'Other', render: () => h('div', 'other') });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('defaultUI', () => {
  it('takes a component', () => {
    expect(defaultUI(Board).component).toBe(Board);
  });

  it('refuses a lazy loader at compile time and at run time', () => {
    expect(() =>
      // @ts-expect-error -- a loader is not a board; import the component statically.
      defaultUI(() => Promise.resolve({ default: Board })),
    ).toThrow(/defaultUI\(\) takes the board component itself, not a function/);
  });
});

describe('defineGameUIs with a phone UI (#1610)', () => {
  it('records the phone UI apart from the default, which stays the default', () => {
    const registry = defineGameUIs({ Board: defaultUI(Board), Pocket: phoneUI(Phone) });
    expect(registry.defaultName).toBe('Board');
    expect(registry.phoneName).toBe('Pocket');
    expect(registry.entries.Pocket).toMatchObject({ component: Phone, devOnly: false });
  });

  it('has no phone UI unless the game declares one', () => {
    expect(defineGameUIs({ Board: defaultUI(Board) }).phoneName).toBeNull();
  });

  it('refuses two phone UIs, at compile time and in dev', () => {
    expect(() =>
      // @ts-expect-error -- only one UI may be phoneUI()
      defineGameUIs({ Board: defaultUI(Board), A: phoneUI(Phone), B: phoneUI(Other) }),
    ).toThrow(/at most one UI with phoneUI\(\) — found A, B/);
  });

  it('refuses a phone UI with no default beside it', () => {
    expect(() =>
      // @ts-expect-error -- exactly one UI must be defaultUI()
      defineGameUIs({ Pocket: phoneUI(Phone) }),
    ).toThrow(/exactly one UI with defaultUI\(\) — found none/);
  });

  it('never falls back to the phone UI as the default in a production build missing its default', () => {
    vi.stubEnv('DEV', false);
    const broken = defineGameUIs(
      // @ts-expect-error -- exactly one UI must be defaultUI()
      { Pocket: phoneUI(Phone), Old: devUI(async () => ({ default: Other })) },
    );
    expect(broken.defaultName).toBe('Old');
    expect(resolveUiComponent(broken, '', false, 'wide')).toBeNull();
    expect(resolveUiComponent(broken, '', false, 'compact')).toBe(Phone);
  });

  it('refuses a loader, since a phone board that fails to load leaves a phone with no game', () => {
    expect(() =>
      // @ts-expect-error -- phoneUI() takes the board component itself
      phoneUI(() => Promise.resolve({ default: Phone })),
    ).toThrow(/phoneUI\(\) takes the board component itself, not a function/);
  });
});

describe('resolveUiComponent picks the phone UI only at the compact size (#1610)', () => {
  const registry = defineGameUIs({ Board: defaultUI(Board), Pocket: phoneUI(Phone), Old: devUI(async () => ({ default: Other })) });

  it('renders the phone UI at the compact size and the default at every other', () => {
    expect(resolveUiComponent(registry, '', false, 'compact')).toBe(Phone);
    expect(resolveUiComponent(registry, '', false, 'medium')).toBe(Board);
    expect(resolveUiComponent(registry, '', false, 'wide')).toBe(Board);
  });

  it('renders the default at every size for a game without a phone UI', () => {
    const plain = defineGameUIs({ Board: defaultUI(Board) });
    for (const size of ['compact', 'medium', 'wide'] as const) {
      expect(resolveUiComponent(plain, '', false, size)).toBe(Board);
    }
  });

  it('treats the dev switcher choosing the default as what ships, so a phone still sees the phone UI', () => {
    expect(resolveUiComponent(registry, 'Board', true, 'compact')).toBe(Phone);
    expect(resolveUiComponent(registry, 'Board', true, 'wide')).toBe(Board);
  });

  it('offers the default first, since the dev host selects the first offer and the default is what ships', () => {
    const phoneFirst = defineGameUIs({ Pocket: phoneUI(Phone), Old: devUI(async () => ({ default: Other })), Board: defaultUI(Board) });
    expect(devUiNames(phoneFirst)).toEqual(['Board', 'Pocket', 'Old']);
  });

  it('renders exactly what the dev switcher names otherwise, at any size', () => {
    expect(resolveUiComponent(registry, 'Pocket', true, 'wide')).toBe(Phone);
    expect(resolveUiComponent(registry, 'Old', true, 'compact')).toBe(registry.entries.Old.component);
  });
});
