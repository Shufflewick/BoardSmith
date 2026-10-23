/**
 * A game's own one-shot commands in the controls menu (#1448).
 *
 * The board that owns the state a command acts on registers it in its `setup`:
 *
 * ```ts
 * import { useMenuCommands } from 'boardsmith/ui';
 *
 * useMenuCommands(() => [
 *   { label: 'Watch the last battle', enabled: lastBattle.value !== null, run: replayLastBattle },
 * ]);
 * ```
 *
 * The function is read reactively, so a command's label and `enabled` follow the
 * board's state. The commands leave the menu when the board unmounts.
 */
import { computed, inject, onScopeDispose, shallowReactive, type ComputedRef, type InjectionKey } from 'vue';

export interface MenuCommand {
  /** The menu item's text. */
  label: string;
  /** Whether it can run right now. Defaults to true. */
  enabled?: boolean;
  /** Runs after the menu has closed and handed focus back. */
  run: () => void;
}

/** A shell's register of the commands its board lists. */
interface MenuCommands {
  /** Add commands to the menu; returns the release. */
  register(commands: () => readonly MenuCommand[]): () => void;
  /** Every registered command, in registration order. */
  commands: ComputedRef<MenuCommand[]>;
}

export const MENU_COMMANDS_KEY: InjectionKey<MenuCommands> = Symbol('boardsmith:menu-commands');

export function createMenuCommands(): MenuCommands {
  const active = shallowReactive(new Set<() => readonly MenuCommand[]>());
  return {
    register(commands) {
      // Wrapped, so one function registered twice is two entries, each released on its own.
      const entry = () => commands();
      active.add(entry);
      return () => active.delete(entry);
    },
    commands: computed(() => [...active].flatMap((commands) => commands())),
  };
}

/**
 * List the game's own commands in the controls menu, in a group of their own.
 * Call it in a board's `setup`; see the file comment.
 */
export function useMenuCommands(commands: () => readonly MenuCommand[]): void {
  const menu = inject(MENU_COMMANDS_KEY, null);
  if (!menu) {
    throw new Error(
      'useMenuCommands() was called outside a board. Call it in the setup of the board ' +
        'GameShell or WorldShell renders (or one renderAsSeat mounts): the menu it adds to is theirs.',
    );
  }
  onScopeDispose(menu.register(commands));
}
