// @vitest-environment jsdom
/**
 * WHO MAY DO WHAT IN THE WAITING ROOM, and what the seat list is showing (#157).
 *
 * These rules decided every control the waiting room renders -- who may take a
 * seat's colour, whom the host may kick, when a slot may be removed -- and they
 * lived as fifteen small functions inside a 1674-line component, reachable only
 * by mounting it and reading the DOM back. They are pure functions of the lobby
 * and who is asking, so they belong somewhere a test can ask them directly.
 *
 * The rules themselves are unchanged; each one below is the behaviour the
 * component shipped.
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useLobbySeats } from './useLobbySeats.js';
import type { LobbyInfo, LobbySlot } from '../../client/index.js';

function lobby(slots: Partial<LobbySlot>[], extra: Partial<LobbyInfo> = {}): LobbyInfo {
  return {
    state: 'waiting',
    gameType: 'chess',
    slots: slots.map((s, i) => ({ seat: i + 1, status: 'open', ...s })) as LobbySlot[],
    openSlots: 0,
    ...extra,
  } as LobbyInfo;
}

function seats(l: LobbyInfo, opts: { isCreator?: boolean; playerId?: string } = {}) {
  return useLobbySeats({
    lobby: ref(l),
    isCreator: ref(opts.isCreator ?? false),
    playerId: ref(opts.playerId ?? 'me'),
  });
}

describe('useLobbySeats — counts', () => {
  it('counts filled seats and ready seats, ignoring open ones', () => {
    const s = seats(lobby([
      { status: 'claimed', ready: true },
      { status: 'claimed', ready: false },
      { status: 'bot', ready: true },
      { status: 'open', ready: true },
    ]));

    expect(s.filledCount.value).toBe(3);
    // An open slot marked ready is not a player who is ready.
    expect(s.readyCount.value).toBe(2);
  });
});

describe('useLobbySeats — what the host may do', () => {
  it('lets the host manage an open or bot seat, but never seat 1 or a claimed one', () => {
    const l = lobby([{ status: 'claimed' }, { status: 'open' }, { status: 'bot' }, { status: 'claimed' }]);
    const s = seats(l, { isCreator: true });

    expect(s.canHostManageSlot(l.slots[0])).toBe(false); // seat 1 is the host's own
    expect(s.canHostManageSlot(l.slots[1])).toBe(true);
    expect(s.canHostManageSlot(l.slots[2])).toBe(true);
    expect(s.canHostManageSlot(l.slots[3])).toBe(false); // someone is sitting there
  });

  it('gives a guest none of it', () => {
    const l = lobby([{ status: 'claimed' }, { status: 'open' }]);
    const s = seats(l, { isCreator: false });

    expect(s.canHostManageSlot(l.slots[1])).toBe(false);
    expect(s.canHostRemoveSlot(l.slots[1])).toBe(false);
    expect(s.canHostKickPlayer(l.slots[0])).toBe(false);
    expect(s.canAddSlot.value).toBe(false);
    expect(s.canRemoveSlots.value).toBe(false);
  });

  it('only kicks a seat someone is actually sitting in', () => {
    const l = lobby([{ status: 'claimed' }, { status: 'claimed' }, { status: 'bot' }, { status: 'open' }]);
    const s = seats(l, { isCreator: true });

    expect(s.canHostKickPlayer(l.slots[1])).toBe(true);
    expect(s.canHostKickPlayer(l.slots[2])).toBe(false); // a bot is removed, not kicked
    expect(s.canHostKickPlayer(l.slots[3])).toBe(false);
    expect(s.canHostKickPlayer(l.slots[0])).toBe(false); // the host's own seat
  });

  it('stops removing seats at the game\'s minimum and adding at its maximum', () => {
    const atMin = seats(lobby([{}, {}], { minPlayers: 2, maxPlayers: 4 }), { isCreator: true });
    expect(atMin.canRemoveSlots.value).toBe(false);
    expect(atMin.canAddSlot.value).toBe(true);

    const atMax = seats(lobby([{}, {}, {}, {}], { minPlayers: 2, maxPlayers: 4 }), { isCreator: true });
    expect(atMax.canAddSlot.value).toBe(false);
    expect(atMax.canRemoveSlots.value).toBe(true);
  });

  it('refuses to remove a seat someone is sitting in even when there is room to', () => {
    const l = lobby([{}, { status: 'claimed' }, { status: 'open' }], { minPlayers: 2, maxPlayers: 4 });
    const s = seats(l, { isCreator: true });

    expect(s.canHostRemoveSlot(l.slots[1])).toBe(false);
    expect(s.canHostRemoveSlot(l.slots[2])).toBe(true);
  });
});

describe('useLobbySeats — seat colours', () => {
  it('lets a player edit their own seat and nobody else\'s', () => {
    const l = lobby([{ status: 'claimed', playerId: 'them' }, { status: 'claimed', playerId: 'me' }]);
    const s = seats(l, { playerId: 'me' });

    expect(s.canEditSlotColor(l.slots[0])).toBe(false);
    expect(s.canEditSlotColor(l.slots[1])).toBe(true);
  });

  it('lets the host edit any taken seat, including a bot\'s, but not an empty one', () => {
    const l = lobby([{ status: 'claimed', playerId: 'me' }, { status: 'bot' }, { status: 'open' }]);
    const s = seats(l, { isCreator: true, playerId: 'me' });

    expect(s.canEditSlotColor(l.slots[1])).toBe(true);
    expect(s.canEditSlotColor(l.slots[2])).toBe(false);
  });

  it('opens one picker at a time, and refuses to open one it may not edit', () => {
    const l = lobby([{ status: 'claimed', playerId: 'me' }, { status: 'claimed', playerId: 'them' }]);
    const s = seats(l, { playerId: 'me' });

    s.toggleColorPicker(l.slots[0]);
    expect(s.expandedColorSlot.value).toBe(1);
    s.toggleColorPicker(l.slots[0]);
    expect(s.expandedColorSlot.value).toBeNull();

    s.toggleColorPicker(l.slots[1]);
    expect(s.expandedColorSlot.value).toBeNull();
  });

  it('reports a colour another seat has taken, ignoring empty seats and itself', () => {
    const l = lobby([
      { status: 'claimed', playerOptions: { color: '#ff0000' } },
      { status: 'claimed', playerOptions: { color: '#00ff00' } },
      { status: 'open', playerOptions: { color: '#0000ff' } },
    ]);
    const s = seats(l);

    expect(s.isColorTakenByOther('#ff0000', 2)).toBe(true);
    expect(s.isColorTakenByOther('#ff0000', 1)).toBe(false);
    // Nobody is sitting in seat 3, so its colour is not taken.
    expect(s.isColorTakenByOther('#0000ff', 1)).toBe(false);
  });

  it('falls back to a neutral swatch for a seat with no colour', () => {
    const l = lobby([{ status: 'open' }, { status: 'claimed', playerOptions: { color: '#123456' } }]);
    const s = seats(l);

    expect(s.getSlotColor(l.slots[0])).toBe('#888888');
    expect(s.getSlotColor(l.slots[1])).toBe('#123456');
  });

  it('routes a colour change to the right event and closes the picker', () => {
    const l = lobby([{ status: 'claimed', playerId: 'me' }, { status: 'bot' }]);
    const own: unknown[] = [];
    const other: unknown[] = [];
    const s = useLobbySeats({
      lobby: ref(l),
      isCreator: ref(true),
      playerId: ref('me'),
      onOwnColor: (options) => own.push(options),
      onSlotColor: (seat, options) => other.push([seat, options]),
    });

    s.toggleColorPicker(l.slots[0]);
    s.handleSlotColorChange(1, '#abcdef');
    expect(own).toEqual([{ color: '#abcdef' }]);
    expect(s.expandedColorSlot.value).toBeNull();

    s.handleSlotColorChange(2, '#fedcba');
    expect(other).toEqual([[2, { color: '#fedcba' }]]);
  });

  it('changes nothing for a seat that is not there', () => {
    const l = lobby([{ status: 'claimed', playerId: 'me' }]);
    const own: unknown[] = [];
    const s = useLobbySeats({
      lobby: ref(l), isCreator: ref(true), playerId: ref('me'),
      onOwnColor: (o) => own.push(o),
    });

    s.handleSlotColorChange(99, '#abcdef');
    expect(own).toEqual([]);
  });
});
