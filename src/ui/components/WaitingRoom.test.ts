// @vitest-environment jsdom
/**
 * WaitingRoom is the pre-game lobby: seats, readiness, AI slots, colours and
 * host-only controls. Everything it emits is an authority-checked op on the
 * host, so the UI must not offer a control the sender is not allowed to use —
 * a host-only button shown to a guest reads as a broken game.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import WaitingRoom from './WaitingRoom.vue';
import type { LobbyInfo, LobbySlot } from '../../types/protocol.js';

const slot = (overrides: Partial<LobbySlot> & { seat: number }): LobbySlot => ({
  status: 'open',
  name: 'Open',
  ready: false,
  ...overrides,
});

const lobby = (overrides: Partial<LobbyInfo> = {}): LobbyInfo => ({
  state: 'waiting',
  gameType: 'go-fish',
  displayName: 'Go Fish',
  slots: [
    slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id', isHost: true, connected: true }),
    slot({ seat: 2 }),
  ],
  openSlots: 1,
  isReady: false,
  minPlayers: 2,
  maxPlayers: 4,
  ...overrides,
} as LobbyInfo);

const room = (props: Partial<Record<string, unknown>> = {}) =>
  mount(WaitingRoom, {
    props: {
      gameId: 'abc123',
      lobby: lobby(),
      playerId: 'host-id',
      isCreator: true,
      ...props,
    },
  });

const buttonWith = (wrapper: ReturnType<typeof room>, text: string) =>
  wrapper.findAll('button').find((b) => b.text() === text);

/** Restores whatever `navigator.clipboard` was before this file replaced it. */
let restoreClipboard: () => void;

beforeEach(() => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
    writable: true,
  });
  restoreClipboard = () => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  };
});

afterEach(() => {
  // navigator is shared with every other test in this worker, so the stub has
  // to come back off whether the test passed or threw.
  restoreClipboard();
  vi.restoreAllMocks();
});

describe('WaitingRoom', () => {
  describe('header', () => {
    it('shows the game display name', () => {
      expect(room().find('h2').text()).toBe('Go Fish');
    });

    it('falls back to the game type when there is no display name', () => {
      expect(room({ lobby: lobby({ displayName: undefined }) }).find('h2').text())
        .toBe('go-fish');
    });

    it('shows the game code so it can be shared', () => {
      expect(room().find('.code').text()).toBe('abc123');
    });

    it('copies the code to the clipboard', async () => {
      const wrapper = room();
      await buttonWith(wrapper, 'Copy')!.trigger('click');
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc123');
    });
  });

  describe('slot list', () => {
    it('renders a row per seat', () => {
      expect(room().findAll('.slot')).toHaveLength(2);
    });

    it('counts filled seats against the total', () => {
      expect(room().find('.slots-header').text()).toContain('Players (1/2)');
    });

    it('labels an unclaimed seat as open', () => {
      expect(room().text()).toContain('Open Slot');
    });

    it('marks the viewer own slot', () => {
      expect(room().findAll('.slot')[0].classes()).toContain('is-me');
    });

    it('badges the host', () => {
      expect(room().find('.host-badge').exists()).toBe(true);
    });

    it('shows an AI slot with its difficulty', () => {
      const wrapper = room({
        lobby: lobby({
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
            slot({ seat: 2, status: 'ai', name: 'Bot', aiLevel: 'hard', ready: true }),
          ],
          openSlots: 0,
        }),
      });
      expect(wrapper.text()).toContain('AI (hard)');
    });

    it('defaults an AI slot with no level to medium', () => {
      const wrapper = room({
        lobby: lobby({
          slots: [slot({ seat: 1, status: 'ai', name: 'Bot', ready: true })],
          openSlots: 0,
        }),
      });
      expect(wrapper.text()).toContain('AI (medium)');
    });

    it('shows another player readiness', () => {
      const wrapper = room({
        lobby: lobby({
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
            slot({ seat: 2, status: 'claimed', name: 'Guest', ready: true, connected: true }),
          ],
          openSlots: 0,
        }),
      });
      expect(wrapper.text()).toContain('Ready');
    });

    it('flags a disconnected player', () => {
      const wrapper = room({
        lobby: lobby({
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
            slot({ seat: 2, status: 'claimed', name: 'Guest', connected: false }),
          ],
          openSlots: 0,
        }),
      });
      expect(wrapper.find('.connection-dot.offline').exists()).toBe(true);
    });
  });

  describe('readiness', () => {
    it('offers the viewer a ready button on their own slot', () => {
      expect(buttonWith(room(), 'Ready?')).toBeDefined();
    });

    it('emits set-ready true when the viewer readies up', async () => {
      const wrapper = room();
      await buttonWith(wrapper, 'Ready?')!.trigger('click');
      expect(wrapper.emitted('set-ready')![0]).toEqual([true]);
    });

    it('emits set-ready false to un-ready', async () => {
      const wrapper = room({
        lobby: lobby({
          slots: [slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id', ready: true })],
          openSlots: 0,
        }),
      });
      await buttonWith(wrapper, 'Ready')!.trigger('click');
      expect(wrapper.emitted('set-ready')![0]).toEqual([false]);
    });
  });

  describe('host controls', () => {
    it('lets the host turn an open slot into an AI', async () => {
      const wrapper = room();
      await buttonWith(wrapper, 'Make AI')!.trigger('click');
      expect(wrapper.emitted('set-slot-ai')![0]).toEqual([2, true, 'medium']);
    });

    it('lets the host turn an AI slot back into an open one', async () => {
      const wrapper = room({
        lobby: lobby({
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
            slot({ seat: 2, status: 'ai', name: 'Bot', ready: true }),
          ],
          openSlots: 0,
        }),
      });
      await buttonWith(wrapper, 'Open')!.trigger('click');
      expect(wrapper.emitted('set-slot-ai')![0]).toEqual([2, false]);
    });

    it('cycles AI difficulty easy → medium → hard → easy', async () => {
      const withLevel = (aiLevel: string) => room({
        lobby: lobby({
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
            slot({ seat: 2, status: 'ai', name: 'Bot', aiLevel, ready: true }),
          ],
          openSlots: 0,
        }),
      });
      for (const [from, to] of [['easy', 'medium'], ['medium', 'hard'], ['hard', 'easy']]) {
        const wrapper = withLevel(from);
        await buttonWith(wrapper, `AI (${from})`)!.trigger('click');
        expect(wrapper.emitted('set-slot-ai')![0]).toEqual([2, true, to]);
      }
    });

    it('lets the host add a seat while below the maximum', async () => {
      const wrapper = room();
      await buttonWith(wrapper, '+ Add Player')!.trigger('click');
      expect(wrapper.emitted('add-slot')).toHaveLength(1);
    });

    it('hides add-player once the table is full', () => {
      const full = lobby({
        maxPlayers: 2,
        slots: [
          slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
          slot({ seat: 2 }),
        ],
      });
      expect(buttonWith(room({ lobby: full }), '+ Add Player')).toBeUndefined();
    });

    it('lets the host remove a spare open seat', async () => {
      const wrapper = room({
        lobby: lobby({
          minPlayers: 2,
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
            slot({ seat: 2 }),
            slot({ seat: 3 }),
          ],
          openSlots: 2,
        }),
      });
      await wrapper.findAll('button').filter((b) => b.text() === 'Remove')[0].trigger('click');
      expect(wrapper.emitted('remove-slot')![0]).toEqual([2]);
    });

    it('will not let the host drop below the minimum player count', () => {
      expect(buttonWith(room(), 'Remove')).toBeUndefined();
    });

    it('lets the host kick another human player', async () => {
      const wrapper = room({
        lobby: lobby({
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }),
            slot({ seat: 2, status: 'claimed', name: 'Guest', connected: true }),
          ],
          openSlots: 0,
        }),
      });
      await buttonWith(wrapper, 'Kick')!.trigger('click');
      expect(wrapper.emitted('kick-player')![0]).toEqual([2]);
    });

    it('never offers the host a kick button for their own seat', () => {
      expect(buttonWith(room(), 'Kick')).toBeUndefined();
    });
  });

  describe('a guest view', () => {
    const guestLobby = lobby({
      slots: [
        slot({ seat: 1, status: 'claimed', name: 'Host', isHost: true }),
        slot({ seat: 2 }),
      ],
    });
    const guest = (props = {}) =>
      room({ lobby: guestLobby, playerId: 'guest-id', isCreator: false, ...props });

    it('offers no host-only controls', () => {
      const wrapper = guest();
      for (const label of ['Make AI', 'Remove', '+ Add Player', 'Kick']) {
        expect(buttonWith(wrapper, label), `guest was offered "${label}"`).toBeUndefined();
      }
    });

    it('offers a join form while a seat is open', () => {
      expect(guest().find('.join-name-input').exists()).toBe(true);
    });

    it('will not submit an empty name', async () => {
      const wrapper = guest();
      expect((buttonWith(wrapper, 'Join Game')!.element as HTMLButtonElement).disabled).toBe(true);
      await buttonWith(wrapper, 'Join Game')!.trigger('click');
      expect(wrapper.emitted('join')).toBeUndefined();
    });

    it('emits join with the trimmed name', async () => {
      const wrapper = guest();
      await wrapper.find('.join-name-input').setValue('  Ada  ');
      await buttonWith(wrapper, 'Join Game')!.trigger('click');
      expect(wrapper.emitted('join')![0]).toEqual(['Ada']);
    });

    it('joins on Enter as well as on the button', async () => {
      const wrapper = guest();
      await wrapper.find('.join-name-input').setValue('Ada');
      await wrapper.find('.join-name-input').trigger('keyup.enter');
      expect(wrapper.emitted('join')![0]).toEqual(['Ada']);
    });

    it('hides the join form once every seat is taken', () => {
      const wrapper = guest({
        lobby: lobby({
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host' }),
            slot({ seat: 2, status: 'claimed', name: 'Other' }),
          ],
          openSlots: 0,
        }),
      });
      expect(wrapper.find('.join-name-input').exists()).toBe(false);
    });

    it('labels the exit as leaving rather than cancelling', () => {
      expect(buttonWith(guest(), 'Leave')).toBeDefined();
    });
  });

  describe('your settings', () => {
    it('shows the name editor once the viewer holds a seat', () => {
      expect(room().find('.name-edit-row').exists()).toBe(true);
    });

    it('hides it from someone who has not claimed a seat', () => {
      const wrapper = room({ playerId: 'nobody', isCreator: false });
      expect(wrapper.find('.name-edit-row').exists()).toBe(false);
    });

    it('seeds the field from the seat name', () => {
      const input = room().find('.name-edit-row input').element as HTMLInputElement;
      expect(input.value).toBe('Host');
    });

    it('emits update-name with the trimmed value', async () => {
      const wrapper = room();
      await wrapper.find('.name-edit-row input').setValue('  Ada  ');
      await buttonWith(wrapper, 'Update')!.trigger('click');
      expect(wrapper.emitted('update-name')![0]).toEqual(['Ada']);
    });

    it('ignores an empty name', async () => {
      const wrapper = room();
      await wrapper.find('.name-edit-row input').setValue('   ');
      await buttonWith(wrapper, 'Update')!.trigger('click');
      expect(wrapper.emitted('update-name')).toBeUndefined();
    });

    it('does not overwrite what the player is typing when the lobby updates', async () => {
      const wrapper = room();
      await wrapper.find('.name-edit-row input').setValue('Typing');
      await wrapper.setProps({
        lobby: lobby({
          slots: [slot({ seat: 1, status: 'claimed', name: 'RenamedByServer', playerId: 'host-id' })],
        }),
      });
      expect((wrapper.find('.name-edit-row input').element as HTMLInputElement).value)
        .toBe('Typing');
    });
  });

  describe('colour selection', () => {
    const coloured = () => lobby({
      colorSelectionEnabled: true,
      colors: ['#ff0000', '#00ff00'],
      slots: [
        slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id', playerOptions: { color: '#ff0000' } }),
        slot({ seat: 2, status: 'claimed', name: 'Guest', playerOptions: { color: '#00ff00' } }),
      ],
      openSlots: 0,
    });

    it('offers a swatch per palette colour when the lobby enables colours', () => {
      const wrapper = room({ lobby: coloured() });
      expect(wrapper.findAll('.my-settings .color-swatch')).toHaveLength(2);
    });

    it('offers no colour picker when the lobby disables colours', () => {
      expect(room().findAll('.my-settings .color-swatch')).toHaveLength(0);
    });

    it('disables a colour another player already took', () => {
      const wrapper = room({ lobby: coloured() });
      const swatches = wrapper.findAll('.my-settings .color-swatch');
      expect((swatches[1].element as HTMLButtonElement).disabled).toBe(true);
    });

    it('emits update-player-options when a free colour is picked', async () => {
      const wrapper = room({
        lobby: lobby({
          colorSelectionEnabled: true,
          colors: ['#ff0000', '#00ff00'],
          slots: [slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' })],
          openSlots: 0,
        }),
      });
      await wrapper.findAll('.my-settings .color-swatch')[1].trigger('click');
      expect(wrapper.emitted('update-player-options')![0]).toEqual([{ color: '#00ff00' }]);
    });
  });

  describe('game options', () => {
    const definitions = {
      handSize: { type: 'number' as const, label: 'Hand size', default: 7, min: 5, max: 10 },
      variant: {
        type: 'select' as const,
        label: 'Variant',
        default: 'classic',
        choices: [{ value: 'classic', label: 'Classic' }, { value: 'quick', label: 'Quick' }],
      },
      hardMode: { type: 'boolean' as const, label: 'Hard mode', default: false },
    };

    it('lets the host edit each declared option', () => {
      const wrapper = room({ lobby: lobby({ gameOptionsDefinitions: definitions }) });
      expect(wrapper.find('.game-settings').exists()).toBe(true);
      expect(wrapper.findAll('.game-option')).toHaveLength(3);
    });

    it('shows a guest the values as read-only badges', () => {
      const wrapper = room({
        isCreator: false,
        playerId: 'guest-id',
        lobby: lobby({ gameOptionsDefinitions: definitions, gameOptions: { handSize: 7 } }),
      });
      expect(wrapper.find('.game-settings').exists()).toBe(false);
      expect(wrapper.find('.option-badge').text()).toContain('handSize: 7');
    });

    it('never shows the internal playerConfigs option', () => {
      const wrapper = room({
        isCreator: false,
        playerId: 'guest-id',
        lobby: lobby({ gameOptions: { playerConfigs: [{ name: 'x' }], handSize: 7 } }),
      });
      expect(wrapper.text()).not.toContain('playerConfigs');
    });

    it('falls back to an option default when the lobby has no value yet', () => {
      const wrapper = room({ lobby: lobby({ gameOptionsDefinitions: definitions }) });
      expect((wrapper.find('.game-option-input').element as HTMLInputElement).value).toBe('7');
    });

    it('emits a numeric value for a number option', async () => {
      const wrapper = room({ lobby: lobby({ gameOptionsDefinitions: definitions }) });
      const input = wrapper.find('.game-option-input');
      (input.element as HTMLInputElement).value = '9';
      await input.trigger('change');
      expect(wrapper.emitted('update-game-options')![0]).toEqual([{ handSize: 9 }]);
    });

    it('merges the change into the options already set', async () => {
      const wrapper = room({
        lobby: lobby({ gameOptionsDefinitions: definitions, gameOptions: { variant: 'quick' } }),
      });
      const input = wrapper.find('.game-option-input');
      (input.element as HTMLInputElement).value = '9';
      await input.trigger('change');
      expect(wrapper.emitted('update-game-options')![0])
        .toEqual([{ variant: 'quick', handSize: 9 }]);
    });

    it('emits the chosen value for a select option', async () => {
      const wrapper = room({ lobby: lobby({ gameOptionsDefinitions: definitions }) });
      const select = wrapper.find('.game-option-select');
      (select.element as HTMLSelectElement).value = 'quick';
      await select.trigger('change');
      expect(wrapper.emitted('update-game-options')![0]).toEqual([{ variant: 'quick' }]);
    });

    it('emits a boolean for a toggle option', async () => {
      const wrapper = room({ lobby: lobby({ gameOptionsDefinitions: definitions }) });
      const toggle = wrapper.find('.boolean-toggle input');
      (toggle.element as HTMLInputElement).checked = true;
      await toggle.trigger('change');
      expect(wrapper.emitted('update-game-options')![0]).toEqual([{ hardMode: true }]);
    });
  });

  describe('status line', () => {
    it('counts the seats still to fill', () => {
      expect(room().find('.status-message').text()).toContain('Waiting for 1 more player');
    });

    it('pluralises the wait', () => {
      const wrapper = room({
        lobby: lobby({
          openSlots: 2,
          slots: [slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id' }), slot({ seat: 2 }), slot({ seat: 3 })],
        }),
      });
      expect(wrapper.find('.status-message').text()).toContain('2 more players');
    });

    it('counts who has readied once the table is full', () => {
      const wrapper = room({
        lobby: lobby({
          openSlots: 0,
          slots: [
            slot({ seat: 1, status: 'claimed', name: 'Host', playerId: 'host-id', ready: true }),
            slot({ seat: 2, status: 'claimed', name: 'Guest' }),
          ],
        }),
      });
      expect(wrapper.find('.status-message').text()).toContain('(1/2)');
    });

    it('announces the start when everyone is ready', () => {
      const wrapper = room({ lobby: lobby({ isReady: true, openSlots: 0 }) });
      expect(wrapper.find('.status-message').text()).toContain('Starting game');
    });
  });

  describe('leaving', () => {
    it('emits cancel from the host exit', async () => {
      const wrapper = room();
      await buttonWith(wrapper, 'Cancel Game')!.trigger('click');
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });
  });
});
