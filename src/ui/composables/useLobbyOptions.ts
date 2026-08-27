import { computed, type Ref } from 'vue';
import type { LobbyInfo } from '../../client/index.js';
import type { PlayerOptionDefinition, StandardPlayerOption, ExclusivePlayerOption } from '../../session/types.js';

export interface LobbyOptionsDeps {
  lobby: Ref<LobbyInfo>;
  /** The game's declared per-player options, as fetched for the lobby. */
  playerOptions: Ref<Record<string, unknown> | undefined>;
}

/**
 * WHAT THE WAITING ROOM OFFERS, and where each option belongs (#157).
 *
 * Three facts the room's markup used to derive inline:
 *
 *  - A STANDARD option is the player's own: it renders in "Your Settings".
 *  - An EXCLUSIVE option renders on the seat rows, because no two seats may hold
 *    the same value and a player has to see what the others took.
 *  - COLOUR is special. A lobby can enable colour selection for a game that
 *    never declared a colour option, so one is injected -- but only then. A game
 *    that declared its own says what its colours MEAN ("Red", "The Crimson
 *    Legion"), and injecting a generic list over it would erase that.
 */
export function useLobbyOptions(deps: LobbyOptionsDeps) {
  const typedPlayerOptions = computed(() =>
    deps.playerOptions.value
      ? (deps.playerOptions.value as Record<string, PlayerOptionDefinition>)
      : null
  );

  const effectivePlayerOptions = computed((): Record<string, PlayerOptionDefinition> | null => {
    const baseOptions = typedPlayerOptions.value ?? {};

    if (!deps.lobby.value.colorSelectionEnabled) {
      return Object.keys(baseOptions).length > 0 ? baseOptions : null;
    }

    // The game's own colour option wins: it carries the labels.
    if ('color' in baseOptions) return baseOptions;

    const colorOption: StandardPlayerOption = {
      type: 'color' as const,
      label: 'Color',
      choices: (deps.lobby.value.colors || []).map((c) => ({ value: c, label: c })),
    };

    return { color: colorOption, ...baseOptions };
  });

  /** Null rather than `{}` so the template can ask "is there a panel to render?". */
  function partition<T extends PlayerOptionDefinition>(keep: (opt: PlayerOptionDefinition) => boolean) {
    return computed((): Record<string, T> | null => {
      if (!effectivePlayerOptions.value) return null;
      const filtered: Record<string, T> = {};
      for (const [key, opt] of Object.entries(effectivePlayerOptions.value)) {
        if (keep(opt)) filtered[key] = opt as T;
      }
      return Object.keys(filtered).length > 0 ? filtered : null;
    });
  }

  const standardPlayerOptions = partition<PlayerOptionDefinition>((opt) => opt.type !== 'exclusive');
  const exclusivePlayerOptions = partition<ExclusivePlayerOption>((opt) => opt.type === 'exclusive');

  /** `playerConfigs` is how the lobby was BUILT, not a setting anyone chose. */
  const displayableGameOptions = computed((): Record<string, unknown> | null => {
    if (!deps.lobby.value.gameOptions) return null;
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(deps.lobby.value.gameOptions)) {
      if (key === 'playerConfigs') continue;
      filtered[key] = value;
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  });

  /** A choice list as value/label pairs, however the game declared it. */
  function getPlayerOptionChoices(opt: PlayerOptionDefinition): Array<{ value: string; label: string }> {
    if (opt.type === 'exclusive') return [];
    const stdOpt = opt as StandardPlayerOption;
    if (!stdOpt.choices) return [];
    return stdOpt.choices.map((c: string | { value: string; label: string }) =>
      typeof c === 'string' ? { value: c, label: c } : c
    );
  }

  return {
    effectivePlayerOptions,
    standardPlayerOptions,
    exclusivePlayerOptions,
    displayableGameOptions,
    getPlayerOptionChoices,
  };
}
