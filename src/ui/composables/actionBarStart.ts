/**
 * WHETHER THE ACTION BAR STARTS CLOSED (#1826), shared by GameShell and WorldShell.
 *
 * A game may start closed only when its board offers every action
 * (`actionBarStartsCollapsed`). There the player picks Open or Closed in the
 * controls menu, saved for this game, and a host may seed that pick for a player
 * who has not made one. The automatic UI always starts open: its panel is the
 * only way to start most actions.
 *
 * The chevron on the bar is not saved: it is a gesture for this visit, and the
 * menu pick is the one saved answer to "how does the bar start" (#230).
 */
import { computed, provide, ref, watch, type InjectionKey, type Ref } from 'vue';
import { definePlayerPreferences, type PlayerPreferences } from '../player-preferences.js';

/** Set by the automatic UI while it is the board on screen. */
export const AUTO_UI_ON_SCREEN: InjectionKey<Ref<boolean>> = Symbol('boardsmith:auto-ui-on-screen');

const declarations = {
  actionPanel: {
    label: 'Action panel',
    description: 'How it starts in this game',
    options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }],
    default: 'closed',
  },
} as const;

export function useActionBarStart(startsCollapsed: boolean, gamePreferences: PlayerPreferences | undefined) {
  if (startsCollapsed && !gamePreferences && import.meta.env.DEV) {
    throw new Error(
      'actionBarStartsCollapsed lets each player choose how the action panel starts, saved for this game, '
      + "so the shell needs the game's preferences: pass :preferences=\"definePlayerPreferences('your-game', {})\".",
    );
  }
  const autoUiOnScreen = ref(false);
  provide(AUTO_UI_ON_SCREEN, autoUiOnScreen);

  const choice = startsCollapsed && gamePreferences ? definePlayerPreferences(gamePreferences.game, declarations) : null;
  const pick = choice?.use('actionPanel');
  const offered = computed(() => (choice && !autoUiOnScreen.value ? choice : null));
  const startsClosed = () => !!offered.value && pick?.value === 'closed';

  /** What the player asked for: `v-model` of PlayShell's `actionBarMinimized`. */
  const actionBarMinimized = ref(startsClosed());
  watch([offered, () => pick?.value], () => { actionBarMinimized.value = startsClosed(); });

  return {
    actionBarMinimized,
    /** The menu item, or null where the game does not let the bar start closed. */
    panelPreference: offered,
    /** The host's account setting, for a player who has not chosen. */
    seed: (value: unknown) => choice?.seed('actionPanel', value),
  };
}
