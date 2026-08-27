// @vitest-environment jsdom
/**
 * THE LOBBY, on its own (#41).
 *
 * Create, join, seat claim, the ten mutating controls, and leaving -- around 470
 * lines that sat inside GameShell.vue amongst the transport bridge, the teaching
 * controller, clipboard, localStorage and the platform postMessage bridge. The
 * only way to exercise any of it was to mount the whole shell against a fake
 * server, so most of it had no test: one file covered the join fall-through
 * decision and nothing covered the rest.
 *
 * Nine of the ten mutating handlers were the same six lines with a different
 * client method and a different failure sentence, which is the same finding
 * `useDebugBridge` collapsed for the twelve `debug:*` ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useLobby, type LobbyDeps } from './useLobby.js';
import { MeepleClientError } from '../../client/index.js';

function makeLobby(overrides: Record<string, unknown> = {}) {
  return {
    gameType: 'chess',
    state: 'waiting',
    slots: [
      { seat: 1, status: 'claimed', playerId: 'host' },
      { seat: 2, status: 'open' },
    ],
    ...overrides,
  };
}

function harness(clientOverrides: Record<string, unknown> = {}) {
  const connection = {
    onLobbyChange: vi.fn(),
    onError: vi.fn(),
    onConnectionChange: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const client = {
    createGame: vi.fn(async () => ({ gameId: 'GAME1', lobby: makeLobby() })),
    getLobby: vi.fn(async () => makeLobby()),
    joinLobby: vi.fn(async () => ({ lobby: makeLobby() })),
    getGameState: vi.fn(async () => ({ state: {} })),
    setPlayerId: vi.fn(),
    updateLobbyName: vi.fn(async () => ({})),
    setReady: vi.fn(async () => ({ lobby: makeLobby() })),
    addSlot: vi.fn(async () => ({ lobby: makeLobby({ displayName: 'ADDED' }) })),
    removeSlot: vi.fn(async () => ({ lobby: makeLobby({ displayName: 'REMOVED' }) })),
    setSlotBot: vi.fn(async () => ({ lobby: makeLobby({ displayName: 'BOT' }) })),
    kickPlayer: vi.fn(async () => ({ lobby: makeLobby({ displayName: 'KICKED' }) })),
    updatePlayerOptions: vi.fn(async () => ({ lobby: makeLobby({ displayName: 'PO' }) })),
    updateGameOptions: vi.fn(async () => ({ lobby: makeLobby({ displayName: 'GO' }) })),
    updateSlotPlayerOptions: vi.fn(async () => ({ lobby: makeLobby({ displayName: 'SPO' }) })),
    leavePosition: vi.fn(async () => ({})),
    ...clientOverrides,
  };

  const errors: string[] = [];
  const successes: string[] = [];
  const session = {
    setSessionPlayerId: vi.fn(),
    clearSessionPlayerId: vi.fn(),
    getPlayerName: vi.fn(() => 'Ada'),
    setPlayerName: vi.fn(),
  };

  const deps = {
    client,
    apiUrl: 'http://host',
    gameType: 'chess',
    playerCount: 2,
    playerId: ref('host'),
    playerSeat: ref(-1),
    gameId: ref<string | null>(null),
    currentScreen: ref<'lobby' | 'waiting' | 'game'>('lobby'),
    toast: { error: (m: string) => errors.push(m), success: (m: string) => successes.push(m) },
    fetchPlayerOptions: vi.fn(async () => ({ colour: {} })),
    createConnection: vi.fn(() => connection),
    ...session,
  } as unknown as LobbyDeps;

  return { lobby: useLobby(deps), deps, client, connection, errors, successes, session };
}

describe('useLobby', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('creating', () => {
    it('opens the waiting room, claims seat 1, and connects', async () => {
      const h = harness();

      await h.lobby.createGame({ playerCount: 2, gameOptions: {}, playerConfigs: [] });

      expect(h.deps.currentScreen.value).toBe('waiting');
      expect(h.deps.playerSeat.value).toBe(1);
      expect(h.lobby.isCreator.value).toBe(true);
      expect(h.lobby.gamePlayerOptions.value).toEqual({ colour: {} });
      expect(window.location.pathname).toBe('/lobby/GAME1');
      expect(h.connection.connect).toHaveBeenCalled();
    });

    it('names the bot seats and their level from the lobby config', async () => {
      const h = harness();

      await h.lobby.createGame({
        playerCount: 3,
        gameOptions: { variant: 'quick' },
        playerConfigs: [
          { name: 'Ada', isBot: false, botLevel: 'medium' },
          { name: '', isBot: true, botLevel: 'hard' },
          { name: '', isBot: false, botLevel: 'medium' },
        ],
      });

      expect(h.client.createGame).toHaveBeenCalledWith(expect.objectContaining({
        playerCount: 3,
        playerNames: ['Ada', 'Bot', 'Player 3'],
        botPlayers: [1],
        botLevel: 'hard',
        gameOptions: { variant: 'quick' },
        useLobby: true,
        creatorId: 'host',
      }));
    });

    it('goes straight to the game when the server made no lobby', async () => {
      const h = harness({ createGame: vi.fn(async () => ({ gameId: 'GAME1' })) });

      await h.lobby.createGame();

      expect(h.deps.currentScreen.value).toBe('game');
      expect(h.deps.gameId.value).toBe('GAME1');
      expect(window.location.pathname).toBe('/game/GAME1/1');
    });

    it('tells the player when the server refuses', async () => {
      const h = harness({ createGame: vi.fn(async () => { throw new Error('server on fire'); }) });

      await h.lobby.createGame();

      expect(h.errors).toEqual(['server on fire']);
      expect(h.deps.currentScreen.value).toBe('lobby');
    });
  });

  describe('joining', () => {
    it('refuses an empty code without calling the server', async () => {
      const h = harness();
      h.lobby.joinGameId.value = '   ';

      await h.lobby.joinGame();

      expect(h.client.getLobby).not.toHaveBeenCalled();
      expect(h.errors).toEqual(['Please enter a game code.']);
    });

    it('auto-joins an open slot and opens the waiting room', async () => {
      const h = harness();
      h.lobby.joinGameId.value = ' GAME1 ';

      await h.lobby.joinGame();

      expect(h.client.joinLobby).toHaveBeenCalledWith('GAME1', 'Ada');
      expect(h.deps.currentScreen.value).toBe('waiting');
      expect(h.lobby.isCreator.value).toBe(false);
      expect(h.connection.connect).toHaveBeenCalled();
    });

    it('mints a new player id when this browser already holds a slot', async () => {
      const h = harness({
        getLobby: vi.fn(async () => makeLobby({
          slots: [{ seat: 1, status: 'claimed', playerId: 'host' }, { seat: 2, status: 'open' }],
        })),
      });
      h.lobby.joinGameId.value = 'GAME1';

      await h.lobby.joinGame();

      expect(h.deps.playerId.value).not.toBe('host');
      expect(h.client.setPlayerId).toHaveBeenCalledWith(h.deps.playerId.value);
      expect(h.session.setSessionPlayerId).toHaveBeenCalledWith(h.deps.playerId.value);
    });

    it('goes to the game when the join fills the table', async () => {
      const h = harness({
        joinLobby: vi.fn(async () => ({ lobby: makeLobby({ state: 'playing' }), seat: 2 })),
      });
      h.lobby.joinGameId.value = 'GAME1';

      await h.lobby.joinGame();

      expect(h.deps.playerSeat.value).toBe(2);
      expect(h.deps.currentScreen.value).toBe('game');
      expect(window.location.pathname).toBe('/game/GAME1/2');
    });

    it('says the game is full rather than opening an empty waiting room', async () => {
      const h = harness({
        getLobby: vi.fn(async () => makeLobby({ slots: [{ seat: 1, status: 'claimed', playerId: 'other' }] })),
      });
      h.lobby.joinGameId.value = 'GAME1';

      await h.lobby.joinGame();

      expect(h.errors).toEqual(['This game is full. No open positions available.']);
      expect(h.deps.currentScreen.value).toBe('lobby');
    });

    it('quotes the code back on a 404 instead of falling through', async () => {
      const h = harness({ getLobby: vi.fn(async () => { throw new Error('HTTP 404 not found'); }) });
      h.lobby.joinGameId.value = 'NOPE';

      await h.lobby.joinGame();

      expect(h.errors).toEqual(['No game found with code "NOPE". Check the code and try again.']);
      expect(h.client.getGameState).not.toHaveBeenCalled();
    });

    it('falls through to a direct join when the server says the game is already playing', async () => {
      const h = harness({
        getLobby: vi.fn(async () => { throw new MeepleClientError('Game already in progress'); }),
      });
      h.lobby.joinGameId.value = 'GAME1';

      await h.lobby.joinGame();

      expect(h.client.getGameState).toHaveBeenCalledWith('GAME1', 1);
      expect(h.deps.currentScreen.value).toBe('game');
      expect(h.deps.playerSeat.value).toBe(1);
    });

    it('surfaces a network failure rather than treating it as a game in progress', async () => {
      const h = harness({ getLobby: vi.fn(async () => { throw new Error('network down'); }) });
      h.lobby.joinGameId.value = 'GAME1';

      await h.lobby.joinGame();

      expect(h.client.getGameState).not.toHaveBeenCalled();
      expect(h.errors).toEqual(['network down']);
    });
  });

  describe('the waiting room controls', () => {
    it('adopts the lobby each control returns', async () => {
      const h = harness();
      await h.lobby.createGame();

      await h.lobby.handleAddSlot();
      expect(h.lobby.lobbyInfo.value?.displayName).toBe('ADDED');

      await h.lobby.handleRemoveSlot(2);
      expect(h.lobby.lobbyInfo.value?.displayName).toBe('REMOVED');

      await h.lobby.handleSetSlotBot(2, true, 'hard');
      expect(h.lobby.lobbyInfo.value?.displayName).toBe('BOT');

      await h.lobby.handleKickPlayer(2);
      expect(h.lobby.lobbyInfo.value?.displayName).toBe('KICKED');

      await h.lobby.handleUpdatePlayerOptions({ colour: 'red' });
      expect(h.lobby.lobbyInfo.value?.displayName).toBe('PO');

      await h.lobby.handleUpdateGameOptions({ variant: 'quick' });
      expect(h.lobby.lobbyInfo.value?.displayName).toBe('GO');

      await h.lobby.handleUpdateSlotPlayerOptions(2, { colour: 'blue' });
      expect(h.lobby.lobbyInfo.value?.displayName).toBe('SPO');
    });

    it('keeps each control its own failure sentence', async () => {
      const boom = () => { throw new Error(''); };
      const h = harness({
        addSlot: vi.fn(boom), removeSlot: vi.fn(boom), setSlotBot: vi.fn(boom),
        kickPlayer: vi.fn(boom), updateGameOptions: vi.fn(boom),
      });
      await h.lobby.createGame();

      await h.lobby.handleAddSlot();
      await h.lobby.handleRemoveSlot(2);
      await h.lobby.handleSetSlotBot(2, true);
      await h.lobby.handleKickPlayer(2);
      await h.lobby.handleUpdateGameOptions({});

      expect(h.errors).toEqual([
        'Failed to add slot',
        'Failed to remove slot',
        'Failed to update slot',
        'Failed to kick player',
        'Failed to update game options',
      ]);
    });

    it('does nothing at all before a game exists', async () => {
      const h = harness();

      await h.lobby.handleAddSlot();
      await h.lobby.handleSetReady(true);
      await h.lobby.handleJoinLobby('Ada');

      expect(h.client.addSlot).not.toHaveBeenCalled();
      expect(h.client.setReady).not.toHaveBeenCalled();
      expect(h.client.joinLobby).not.toHaveBeenCalled();
    });

    it('starts the game when readying up fills the table', async () => {
      const h = harness({
        setReady: vi.fn(async () => ({
          lobby: makeLobby({ state: 'playing', slots: [{ seat: 3, status: 'claimed', playerId: 'host' }] }),
        })),
      });
      await h.lobby.createGame();

      await h.lobby.handleSetReady(true);

      expect(h.deps.playerSeat.value).toBe(3);
      expect(h.deps.currentScreen.value).toBe('game');
      expect(h.connection.disconnect).toHaveBeenCalled();
    });
  });

  describe('leaving', () => {
    it('releases the slot when a guest cancels, and not when the host does', async () => {
      const guest = harness();
      guest.lobby.joinGameId.value = 'GAME1';
      await guest.lobby.joinGame();
      await guest.lobby.handleLobbyCancel();
      expect(guest.client.leavePosition).toHaveBeenCalledWith('GAME1');
      expect(guest.deps.currentScreen.value).toBe('lobby');
      expect(guest.lobby.lobbyInfo.value).toBeNull();
      expect(window.location.pathname).toBe('/');

      const host = harness();
      await host.lobby.createGame();
      await host.lobby.handleLobbyCancel();
      expect(host.client.leavePosition).not.toHaveBeenCalled();
    });

    it('clears the session and the connection when leaving a game', async () => {
      const h = harness();
      await h.lobby.createGame();

      h.lobby.leaveGame();

      expect(h.connection.disconnect).toHaveBeenCalled();
      expect(h.session.clearSessionPlayerId).toHaveBeenCalled();
      expect(h.deps.gameId.value).toBeNull();
      expect(h.lobby.joinGameId.value).toBe('');
      expect(h.lobby.isCreator.value).toBe(false);
      expect(h.deps.currentScreen.value).toBe('lobby');
    });
  });

  it('moves everyone into the game when the lobby broadcast says it started', async () => {
    const h = harness();
    await h.lobby.createGame();

    const onLobbyChange = h.connection.onLobbyChange.mock.calls[0][0] as (l: unknown) => void;
    onLobbyChange(makeLobby({ state: 'playing', slots: [{ seat: 2, status: 'claimed', playerId: 'host' }] }));

    expect(h.deps.playerSeat.value).toBe(2);
    expect(h.deps.currentScreen.value).toBe('game');
    expect(h.connection.disconnect).toHaveBeenCalled();
  });
});
