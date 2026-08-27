import { computed, ref, type Ref } from 'vue';
import type { LobbyInfo, LobbySlot } from '../../client/index.js';

/** A neutral swatch for a seat nobody has coloured yet. */
const UNCOLOURED = '#888888';

export interface LobbySeatsDeps {
  lobby: Ref<LobbyInfo>;
  /** Whether the asker is the host. */
  isCreator: Ref<boolean>;
  /** The asker's own player id, which is how "my seat" is decided. */
  playerId: Ref<string>;
  /** Called when the asker recolours their OWN seat. */
  onOwnColor?: (options: Record<string, unknown>) => void;
  /** Called when the host recolours SOMEONE ELSE'S seat (a player's or a bot's). */
  onSlotColor?: (seat: number, options: Record<string, unknown>) => void;
}

/**
 * WHO MAY DO WHAT to a seat in the waiting room (#157).
 *
 * Fifteen small rules that decided every control the room renders, extracted
 * from a 1674-line component where the only way to ask one was to mount the
 * whole room and read the DOM back. They are pure functions of the lobby and who
 * is asking, so they belong where a test can ask them directly.
 *
 * The rules, stated once here rather than implied across a template:
 *
 *  - Seat 1 is the host's. They cannot manage, remove or kick themselves.
 *  - A CLAIMED seat has a person in it: the host may kick them, but not
 *    reconfigure the seat under them.
 *  - A BOT seat is the host's to reconfigure or remove; kicking does not apply.
 *  - A seat's COLOUR is its occupant's to choose, and the host's to override for
 *    anyone (including a bot). An empty seat has no colour to change.
 *  - Adding and removing seats is bounded by the game's own min/max.
 */
export function useLobbySeats(deps: LobbySeatsDeps) {
  const expandedColorSlot = ref<number | null>(null);

  const filledCount = computed(() =>
    deps.lobby.value.slots.filter((s) => s.status !== 'open').length
  );

  const readyCount = computed(() =>
    deps.lobby.value.slots.filter((s) => s.status !== 'open' && s.ready).length
  );

  const canAddSlot = computed(() => {
    if (!deps.isCreator.value) return false;
    const maxPlayers = deps.lobby.value.maxPlayers ?? 10;
    return deps.lobby.value.slots.length < maxPlayers;
  });

  const canRemoveSlots = computed(() => {
    if (!deps.isCreator.value) return false;
    const minPlayers = deps.lobby.value.minPlayers ?? 2;
    return deps.lobby.value.slots.length > minPlayers;
  });

  /** The host may reconfigure an open or bot seat -- never their own, never an occupied one. */
  function canHostManageSlot(slot: LobbySlot): boolean {
    return deps.isCreator.value && slot.seat !== 1 && slot.status !== 'claimed';
  }

  /** ...and may remove an EMPTY one, while the table stays above its minimum. */
  function canHostRemoveSlot(slot: LobbySlot): boolean {
    return deps.isCreator.value && slot.seat !== 1 && slot.status === 'open' && canRemoveSlots.value;
  }

  /** Kicking applies to a person. A bot is removed, and an empty seat is nobody. */
  function canHostKickPlayer(slot: LobbySlot): boolean {
    return deps.isCreator.value && slot.seat !== 1 && slot.status === 'claimed';
  }

  function getSlotStatusClass(slot: LobbySlot): string {
    if (slot.status === 'bot') return 'bot';
    if (slot.status === 'claimed') return 'claimed';
    return 'open';
  }

  function getSlotColor(slot: LobbySlot): string {
    return (slot.playerOptions?.color as string | undefined) ?? UNCOLOURED;
  }

  function canEditSlotColor(slot: LobbySlot): boolean {
    // The host may recolour any seat that is taken -- a player's or a bot's.
    if (deps.isCreator.value && slot.status !== 'open') return true;
    // Anyone may recolour their own.
    return slot.playerId === deps.playerId.value;
  }

  /** One picker at a time, and only for a seat the asker may actually edit. */
  function toggleColorPicker(slot: LobbySlot): void {
    if (!canEditSlotColor(slot)) return;
    expandedColorSlot.value = expandedColorSlot.value === slot.seat ? null : slot.seat;
  }

  /** Is another OCCUPIED seat already using this colour? */
  function isColorTakenByOther(color: string, currentSeat: number): boolean {
    return deps.lobby.value.slots.some(
      (s) => s.seat !== currentSeat && s.status !== 'open' && s.playerOptions?.color === color
    );
  }

  function handleSlotColorChange(seat: number, color: string): void {
    const slot = deps.lobby.value.slots.find((s) => s.seat === seat);
    if (!slot) return;

    if (slot.playerId === deps.playerId.value) {
      deps.onOwnColor?.({ color });
    } else if (deps.isCreator.value) {
      deps.onSlotColor?.(seat, { color });
    }

    expandedColorSlot.value = null;
  }

  return {
    expandedColorSlot,
    filledCount,
    readyCount,
    canAddSlot,
    canRemoveSlots,
    canHostManageSlot,
    canHostRemoveSlot,
    canHostKickPlayer,
    getSlotStatusClass,
    getSlotColor,
    canEditSlotColor,
    toggleColorPicker,
    isColorTakenByOther,
    handleSlotColorChange,
  };
}
