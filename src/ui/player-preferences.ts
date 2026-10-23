/**
 * A game's own player preferences (#1440): declared once by the game, shown in
 * GameShell's controls menu, saved in this browser under a key scoped to the
 * game, and never sent to the server.
 */
import { computed, reactive, type Ref } from 'vue';

/** An on/off preference. */
export interface PlayerToggleDeclaration {
  label: string;
  description?: string;
  default: boolean;
}

/** A preference the player picks from a list. */
export interface PlayerChoiceDeclaration {
  label: string;
  description?: string;
  options: readonly { readonly value: string; readonly label: string }[];
  default: string;
}

export type PlayerPreferenceDeclaration = PlayerToggleDeclaration | PlayerChoiceDeclaration;

type PreferenceValue<D> = D extends { options: readonly { value: infer V }[] } ? V : boolean;

export interface PlayerPreferences<D extends Record<string, PlayerPreferenceDeclaration> = Record<string, PlayerPreferenceDeclaration>> {
  readonly declarations: D;
  use<K extends keyof D & string>(key: K): Ref<PreferenceValue<D[K]>>;
}

const isChoice = (d: PlayerPreferenceDeclaration): d is PlayerChoiceDeclaration => 'options' in d;

function accepts(declaration: PlayerPreferenceDeclaration, value: unknown): boolean {
  return isChoice(declaration)
    ? declaration.options.some((o) => o.value === value)
    : typeof value === 'boolean';
}

const storageKey = (game: string, key: string) => `boardsmith-preference:${game}:${key}`;

function readStored(storageKey: string, declaration: PlayerPreferenceDeclaration): unknown {
  try {
    const raw = localStorage.getItem(storageKey);
    const value: unknown = raw === null ? undefined : JSON.parse(raw);
    return accepts(declaration, value) ? value : declaration.default;
  } catch {
    // Storage can be blocked (private browsing, sandboxed frame) or hold text that is not JSON.
    return declaration.default;
  }
}

/**
 * Declare a game's player preferences. `game` scopes the saved values, so two
 * games never share or overwrite each other's settings. Pass the result to
 * GameShell's `preferences` prop to show them in the controls menu, and read a
 * value anywhere in the UI with `preferences.use('key')`, a ref that updates
 * live when the player changes it.
 */
export function definePlayerPreferences<const D extends Record<string, PlayerPreferenceDeclaration>>(
  game: string,
  declarations: D,
): PlayerPreferences<D> {
  if (!game) throw new Error('definePlayerPreferences needs the game name, so its saved preferences do not mix with another game\'s.');
  for (const [key, declaration] of Object.entries(declarations)) {
    if (!accepts(declaration, declaration.default)) {
      const allowed = isChoice(declaration) ? declaration.options.map((o) => o.value).join(', ') : 'true or false';
      throw new Error(`Player preference "${key}" defaults to "${String(declaration.default)}", which is not one of its options: ${allowed}.`);
    }
  }
  const values = reactive<Record<string, unknown>>(Object.fromEntries(
    Object.entries(declarations).map(([key, d]) => [key, readStored(storageKey(game, key), d)]),
  ));
  function use<K extends keyof D & string>(key: K): Ref<PreferenceValue<D[K]>> {
    if (!(key in declarations)) {
      throw new Error(`No player preference "${key}" is declared. Declared: ${Object.keys(declarations).join(', ')}.`);
    }
    return computed({
      get: () => values[key] as PreferenceValue<D[K]>,
      set: (value) => {
        values[key] = value;
        try {
          localStorage.setItem(storageKey(game, key), JSON.stringify(value));
        } catch {
          // Blocked storage: the change still applies for this visit.
        }
      },
    });
  }
  return { declarations, use };
}
