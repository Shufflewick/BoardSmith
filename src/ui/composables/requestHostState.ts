import type { InjectionKey } from 'vue';

/** Asks the table host to re-send the game state; a shell whose host cannot be asked provides none (#1553). */
export const REQUEST_HOST_STATE_KEY: InjectionKey<() => void> = Symbol('boardsmith:request-host-state');
