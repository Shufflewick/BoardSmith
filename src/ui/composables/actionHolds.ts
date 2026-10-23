/**
 * Actions a game's screen holds back on this client only (#1450).
 *
 * Some states exist only on one player's screen, such as watching a battle
 * replay. The board that owns that state holds the actions it cannot take part
 * in yet, with a reason, in its `setup`:
 *
 * ```ts
 * import { useActionHolds } from 'boardsmith/ui';
 *
 * useActionHolds(() => (replaying.value ? { placePack: 'Placing packs waits until the battle playback ends.' } : null));
 * ```
 *
 * The function is read reactively and returns null when nothing is held. A held
 * action is greyed out with its reason everywhere a rule's `disabled()` reason
 * shows, because the shell adds the
 * holds to the same `disabledActions` the Action Panel, the board and the action
 * controller read. Nothing reaches the server or the other seats, and the rules
 * still decide what the server accepts. An open draft of an action that becomes
 * held is cancelled with the reason. The holds lift when the board unmounts.
 */
import { computed, inject, onScopeDispose, shallowReactive, type ComputedRef, type InjectionKey } from 'vue';

/** A shell's register of the actions its board holds. */
interface ActionHolds {
  /** Hold actions, by name, with the reason; returns the release. */
  register(holds: () => Readonly<Record<string, string>> | null): () => void;
  /** Every held action and its reason; a later registration's reason wins. */
  held: ComputedRef<Record<string, string>>;
}

export const ACTION_HOLDS_KEY: InjectionKey<ActionHolds> = Symbol('boardsmith:action-holds');

export function createActionHolds(): ActionHolds {
  const active = shallowReactive(new Set<() => Readonly<Record<string, string>> | null>());
  return {
    register(holds) {
      // Wrapped, so one function registered twice is two entries, each released on its own.
      const entry = () => holds();
      active.add(entry);
      return () => active.delete(entry);
    },
    // The previous record when nothing changed, so a hold that reads fast-changing state does not wake every reader.
    held: computed((previous) => {
      const next: Record<string, string> = Object.assign({}, ...[...active].map((holds) => holds()));
      const same =
        previous !== undefined &&
        Object.keys(previous).length === Object.keys(next).length &&
        Object.entries(next).every(([name, reason]) => previous[name] === reason);
      return same ? previous : next;
    }),
  };
}

/** The rules' disabled actions with the holds added; the rules' own reason wins. */
export function withHolds(
  rules: ComputedRef<Record<string, string> | undefined>,
  holds: ActionHolds,
): ComputedRef<Record<string, string> | undefined> {
  return computed(() => (Object.keys(holds.held.value).length ? { ...holds.held.value, ...rules.value } : rules.value));
}

/**
 * Grey out actions on this client, by name, with the reason the player sees.
 * Call it in a board's `setup`; see the file comment.
 */
export function useActionHolds(holds: () => Readonly<Record<string, string>> | null): void {
  const actionHolds = inject(ACTION_HOLDS_KEY, null);
  if (!actionHolds) {
    throw new Error(
      'useActionHolds() was called outside a board. Call it in the setup of the board ' +
        'GameShell or WorldShell renders, one renderAsSeat mounts, or one below a test harness that calls ' +
        'provideTableActionWiring(wiring): the Action Panel it greys out is theirs.',
    );
  }
  onScopeDispose(actionHolds.register(holds));
}
