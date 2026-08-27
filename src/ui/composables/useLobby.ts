import { ref, type Ref } from 'vue';
import { MeepleClientError, GameConnection, generatePlayerId, type MeepleClient, type LobbyInfo } from '../../client/index.js';

/** The screen the shell is showing. Owned by the shell; the lobby drives it. */
export type LobbyScreen = 'lobby' | 'waiting' | 'game';

/** What a host declares before the table opens. */
export interface LobbyConfig {
  playerCount: number;
  gameOptions: Record<string, unknown>;
  playerConfigs: Array<{
    name: string;
    isBot: boolean;
    botLevel: string;
    [key: string]: unknown;
  }>;
}

/**
 * The subset of the SDK client the lobby actually uses.
 *
 * A `Pick` of the real client rather than a hand-written shape: the point is to
 * say what this composable touches, not to restate the signatures, and a
 * restatement would drift the first time one of them gains an argument.
 */
type LobbyClient = Pick<
  MeepleClient,
  | 'createGame'
  | 'getLobby'
  | 'joinLobby'
  | 'getGameState'
  | 'setPlayerId'
  | 'updateLobbyName'
  | 'setReady'
  | 'addSlot'
  | 'removeSlot'
  | 'setSlotBot'
  | 'kickPlayer'
  | 'updatePlayerOptions'
  | 'updateGameOptions'
  | 'updateSlotPlayerOptions'
  | 'leavePosition'
>;

/** A live lobby socket. Narrowed to what this composable drives. */
interface LobbySocket {
  onLobbyChange(handler: (lobby: LobbyInfo) => void): void;
  onError(handler: (err: unknown) => void): void;
  onConnectionChange?(handler: (status: unknown) => void): void;
  connect(): void;
  disconnect(): void;
}

export interface LobbyDeps {
  client: LobbyClient;
  apiUrl: string;
  gameType: string;
  playerCount: number;
  /** The shell's identity and seat, which a same-browser join can replace. */
  playerId: Ref<string>;
  playerSeat: Ref<number>;
  gameId: Ref<string | null>;
  currentScreen: Ref<LobbyScreen>;
  toast: { error(message: string): void; success(message: string): void };
  /** Fetch the game's declared playerOptions for the waiting room. */
  fetchPlayerOptions(gameType: string): Promise<Record<string, unknown> | undefined>;
  setSessionPlayerId(id: string): void;
  clearSessionPlayerId(): void;
  getPlayerName(): string | null;
  setPlayerName(name: string): void;
  /** Overridable so a test can drive the socket without a server. */
  createConnection?(gameId: string): LobbySocket;
  /** Dev-only tracing hook. */
  log?(...args: unknown[]): void;
}

export interface Lobby {
  joinGameId: Ref<string>;
  createdGameId: Ref<string | null>;
  lobbyInfo: Ref<LobbyInfo | null>;
  isCreator: Ref<boolean>;
  gamePlayerOptions: Ref<Record<string, unknown> | undefined>;
  createGame(config?: LobbyConfig): Promise<void>;
  joinGame(): Promise<void>;
  resumeGame(gameId: string): Promise<void>;
  handleJoinLobby(name: string): Promise<void>;
  handleUpdateLobbyName(name: string): Promise<void>;
  handleSetReady(ready: boolean): Promise<void>;
  handleAddSlot(): Promise<void>;
  handleRemoveSlot(position: number): Promise<void>;
  handleSetSlotBot(position: number, isBot: boolean, botLevel?: string): Promise<void>;
  handleKickPlayer(position: number): Promise<void>;
  handleUpdatePlayerOptions(options: Record<string, unknown>): Promise<void>;
  handleUpdateGameOptions(options: Record<string, unknown>): Promise<void>;
  handleUpdateSlotPlayerOptions(position: number, options: Record<string, unknown>): Promise<void>;
  handleLobbyCancel(): Promise<void>;
  copyGameCode(): void;
  leaveGame(): void;
  disconnect(): void;
}

/**
 * Decide whether a `getLobby()` failure means "this game is already in progress
 * -- join it directly" vs. a real error to surface.
 *
 * Fall through ONLY on `MeepleClientError`: the server answered, and what it
 * answered is a game/lobby state error. An HTTP 404 does NOT fall through
 * (#63) -- it used to, on the theory that the server might be an old-style one
 * without a lobby endpoint, which is a backward-compatibility branch this
 * library does not keep, and which swallowed the far more common cause of a
 * 404: a mistyped game code. Network failures and 5xx never fell through.
 */
export function shouldFallThroughToDirectJoin(e: unknown): boolean {
  return e instanceof MeepleClientError;
}

/**
 * CREATE, JOIN, CONFIGURE, LEAVE -- the whole pre-game half of the shell (#41).
 *
 * Extracted from GameShell.vue, where it sat amongst the transport bridge, the
 * teaching controller, clipboard, localStorage and the platform postMessage
 * bridge. It reaches the shell through refs passed in (`playerSeat`, `gameId`,
 * `currentScreen`) rather than by owning them, because the game half reads them
 * too; everything that is purely the lobby's -- the code being typed, the lobby
 * snapshot, whether we are the host, the socket -- is owned here.
 *
 * Nine of the ten waiting-room controls were the same six lines with a different
 * client method and a different failure sentence. They go through `mutate` now,
 * which keeps each control's own sentence (the sentence is what the player
 * reads) while there is one copy of the shape.
 */
export function useLobby(deps: LobbyDeps): Lobby {
  const log = deps.log ?? (() => {});

  const joinGameId = ref('');
  const createdGameId = ref<string | null>(null);
  const lobbyInfo = ref<LobbyInfo | null>(null);
  const isCreator = ref(false);
  const gamePlayerOptions = ref<Record<string, unknown> | undefined>(undefined);
  const connection = ref<LobbySocket | null>(null);

  function updateUrl(gid: string, position: number): void {
    window.history.pushState({ gameId: gid, position }, '', `/game/${gid}/${position}`);
  }

  function updateLobbyUrl(gid: string): void {
    window.history.pushState({ gameId: gid, lobby: true }, '', `/lobby/${gid}`);
  }

  function clearUrl(): void {
    window.history.pushState({}, '', '/');
  }

  /** Enter the game as `seat`, dropping the lobby socket on the way. */
  function enterGame(gid: string, seat: number): void {
    disconnect();
    deps.playerSeat.value = seat;
    deps.gameId.value = gid;
    deps.currentScreen.value = 'game';
    updateUrl(gid, seat);
  }

  /** The seat this player holds in `lobby`, if any. */
  function mySeat(lobby: LobbyInfo): number | undefined {
    return lobby.slots.find((s) => s.playerId === deps.playerId.value)?.seat;
  }

  function connect(gid: string): void {
    log('connectToLobby', gid, { existingConnection: !!connection.value });
    disconnect();

    const socket = deps.createConnection
      ? deps.createConnection(gid)
      : new GameConnection(deps.apiUrl, {
          gameId: gid,
          playerId: deps.playerId.value,
          playerSeat: deps.playerSeat.value,
          autoReconnect: true,
        }) as unknown as LobbySocket;

    socket.onLobbyChange((lobby) => {
      log('onLobbyChange', { state: lobby.state, slots: lobby.slots.map((s) => ({ seat: s.seat, status: s.status })) });
      lobbyInfo.value = lobby;
      if (lobby.state === 'playing') {
        enterGame(gid, mySeat(lobby) ?? deps.playerSeat.value);
      }
    });

    socket.onError((err) => {
      log('connection.onError', err);
      console.error('Lobby connection error:', err);
    });

    socket.onConnectionChange?.((status) => {
      log('connection.onConnectionChange', status);
    });

    socket.connect();
    connection.value = socket;
  }

  function disconnect(): void {
    log('disconnectFromLobby', { hadConnection: !!connection.value });
    if (connection.value) {
      connection.value.disconnect();
      connection.value = null;
    }
  }

  /** Open the waiting room for `gid`, fetching the options it renders. */
  async function openWaitingRoom(gid: string, lobby: LobbyInfo, gameType: string): Promise<void> {
    lobbyInfo.value = lobby;
    gamePlayerOptions.value = await deps.fetchPlayerOptions(gameType);
    deps.currentScreen.value = 'waiting';
    updateLobbyUrl(gid);
    connect(gid);
  }

  async function createGame(config?: LobbyConfig): Promise<void> {
    try {
      const effectivePlayerCount = config?.playerCount ?? deps.playerCount;

      let playerNames: string[];
      let botPlayers: number[] = [];
      let botLevel = 'medium';

      if (config?.playerConfigs?.length) {
        playerNames = config.playerConfigs.map((pc, i) => pc.name || (pc.isBot ? 'Bot' : `Player ${i + 1}`));
        botPlayers = config.playerConfigs.map((pc, i) => (pc.isBot ? i : -1)).filter((i) => i >= 0);
        const firstBot = config.playerConfigs.find((pc) => pc.isBot);
        if (firstBot) botLevel = firstBot.botLevel || 'medium';
      } else {
        playerNames = Array.from({ length: effectivePlayerCount }, (_, i) => `Player ${i + 1}`);
      }

      // Always use the lobby so the host can configure players, add a bot, and
      // change settings before anyone is committed to a table.
      const result = await deps.client.createGame({
        gameType: deps.gameType,
        playerCount: effectivePlayerCount,
        playerNames,
        botPlayers: botPlayers.length > 0 ? botPlayers : undefined,
        botLevel: botPlayers.length > 0 ? botLevel : undefined,
        gameOptions: config?.gameOptions,
        playerConfigs: config?.playerConfigs,
        useLobby: true,
        creatorId: deps.playerId.value,
      });

      if (!result.gameId) return;

      createdGameId.value = result.gameId;
      deps.playerSeat.value = 1; // Creator defaults to seat 1
      isCreator.value = true;

      if (result.lobby) {
        await openWaitingRoom(result.gameId, result.lobby, deps.gameType);
      } else {
        // Fallback if the lobby wasn't created (shouldn't happen).
        deps.gameId.value = result.gameId;
        deps.currentScreen.value = 'game';
        updateUrl(result.gameId, 1);
      }
    } catch (err) {
      console.error('Failed to create game:', err);
      deps.toast.error(err instanceof Error ? err.message : 'Failed to create game.');
    }
  }

  async function joinGame(): Promise<void> {
    if (!joinGameId.value.trim()) {
      deps.toast.error('Please enter a game code.');
      return;
    }

    try {
      const gid = joinGameId.value.trim();

      try {
        const lobby = await deps.client.getLobby(gid);
        createdGameId.value = gid;
        isCreator.value = false;

        if (lobby.state === 'waiting') {
          // Same browser, second window: our playerId already holds a slot, so
          // mint a new one through the SDK's secure path -- it is a capability
          // token -- and keep it for this tab only.
          if (mySeat(lobby) !== undefined) {
            const newPlayerId = generatePlayerId();
            deps.playerId.value = newPlayerId;
            deps.client.setPlayerId(newPlayerId);
            deps.setSessionPlayerId(newPlayerId);
          }

          if (!lobby.slots.some((s) => s.status === 'open')) {
            deps.toast.error('This game is full. No open positions available.');
            return;
          }

          const playerName = deps.getPlayerName() || `Player ${lobby.slots.length + 1}`;
          let joined: LobbyInfo = lobby;

          try {
            const joinResult = await deps.client.joinLobby(gid, playerName);
            joined = joinResult.lobby ?? lobby;

            if (joinResult.lobby?.state === 'playing' && joinResult.seat) {
              lobbyInfo.value = joinResult.lobby;
              enterGame(gid, joinResult.seat);
              return;
            }
          } catch (joinErr) {
            // Join failed: show the lobby anyway so they can try manually.
            console.error('Failed to auto-join lobby:', joinErr);
          }

          await openWaitingRoom(gid, joined, lobby.gameType);
          return;
        }
        // Game already started -- fall through to a direct join.
      } catch (e) {
        if (e instanceof Error && /HTTP 404/.test(e.message)) {
          throw new Error(`No game found with code "${gid}". Check the code and try again.`);
        }
        if (!shouldFallThroughToDirectJoin(e)) throw e;
        // The server answered with a lobby/game-state error -- most often "this
        // game is already in progress", which is what a direct join is for.
      }

      const stateResult = await deps.client.getGameState(gid, 1);
      if (stateResult) {
        deps.playerSeat.value = 1;
        deps.gameId.value = gid;
        deps.currentScreen.value = 'game';
        updateUrl(gid, 1);
      }
    } catch (err) {
      console.error('Failed to join game:', err);
      deps.toast.error(err instanceof Error ? err.message : 'Failed to join game. Check the game code.');
    }
  }

  async function resumeGame(gid: string): Promise<void> {
    joinGameId.value = gid;
    await joinGame();
  }

  /**
   * One waiting-room control: call the server for the game we are in, adopt the
   * lobby it returns, and say what failed in this control's own words.
   *
   * `failure` is per control on purpose. It is what the player reads, and "Failed
   * to kick player" and "Failed to add slot" are not interchangeable, however
   * identical the six lines around them were.
   */
  async function mutate(
    failure: string,
    call: (gid: string) => Promise<{ lobby?: LobbyInfo }>,
    options: { toastOnFailure?: boolean } = {},
  ): Promise<{ lobby?: LobbyInfo } | undefined> {
    const gid = createdGameId.value;
    if (!gid) return undefined;

    try {
      const result = await call(gid);
      if (result?.lobby) lobbyInfo.value = result.lobby;
      return result;
    } catch (err) {
      console.error(`${failure}:`, err);
      if (options.toastOnFailure !== false) {
        deps.toast.error(err instanceof Error && err.message ? err.message : failure);
      }
      return undefined;
    }
  }

  /** Adopt a lobby that has started, from whichever control learned it first. */
  function startIfPlaying(gid: string, lobby: LobbyInfo | undefined, seat?: number): void {
    if (lobby?.state !== 'playing') return;
    enterGame(gid, seat ?? mySeat(lobby) ?? deps.playerSeat.value);
  }

  async function handleJoinLobby(name: string): Promise<void> {
    const gid = createdGameId.value;
    const result = await mutate('Failed to join lobby.', (id) => deps.client.joinLobby(id, name));
    if (!result || !gid) return;
    deps.setPlayerName(name);
    startIfPlaying(gid, result.lobby, (result as { seat?: number }).seat);
  }

  async function handleUpdateLobbyName(name: string): Promise<void> {
    const result = await mutate(
      'Failed to update name',
      async (id) => { await deps.client.updateLobbyName(id, name); return {}; },
      { toastOnFailure: false },
    );
    if (result) deps.setPlayerName(name);
  }

  async function handleSetReady(ready: boolean): Promise<void> {
    const gid = createdGameId.value;
    const result = await mutate('Failed to mark as ready.', (id) => deps.client.setReady(id, ready));
    if (result && gid) startIfPlaying(gid, result.lobby);
  }

  async function handleAddSlot(): Promise<void> {
    await mutate('Failed to add slot', (id) => deps.client.addSlot(id));
  }

  async function handleRemoveSlot(position: number): Promise<void> {
    await mutate('Failed to remove slot', (id) => deps.client.removeSlot(id, position));
  }

  async function handleSetSlotBot(position: number, isBot: boolean, botLevel?: string): Promise<void> {
    await mutate('Failed to update slot', (id) => deps.client.setSlotBot(id, position, isBot, botLevel));
  }

  async function handleKickPlayer(position: number): Promise<void> {
    await mutate('Failed to kick player', (id) => deps.client.kickPlayer(id, position));
  }

  async function handleUpdatePlayerOptions(options: Record<string, unknown>): Promise<void> {
    await mutate('Failed to update options', (id) => deps.client.updatePlayerOptions(id, options));
  }

  async function handleUpdateGameOptions(options: Record<string, unknown>): Promise<void> {
    await mutate('Failed to update game options', (id) => deps.client.updateGameOptions(id, options));
  }

  async function handleUpdateSlotPlayerOptions(position: number, options: Record<string, unknown>): Promise<void> {
    await mutate('Failed to update slot options', (id) => deps.client.updateSlotPlayerOptions(id, position, options));
  }

  async function handleLobbyCancel(): Promise<void> {
    // A guest holds a slot someone else could take; release it before leaving.
    // The host's lobby goes away with them.
    if (!isCreator.value && createdGameId.value) {
      try {
        await deps.client.leavePosition(createdGameId.value);
      } catch (err) {
        console.error('[Leave] Failed to leave position:', err);
        // Continue with cleanup even if leave fails.
      }
    }

    disconnect();
    deps.clearSessionPlayerId();
    lobbyInfo.value = null;
    createdGameId.value = null;
    isCreator.value = false;
    deps.currentScreen.value = 'lobby';
    clearUrl();
  }

  function copyGameCode(): void {
    if (createdGameId.value) {
      navigator.clipboard.writeText(createdGameId.value);
      deps.toast.success('Copied!');
    }
  }

  function leaveGame(): void {
    disconnect();
    deps.clearSessionPlayerId();
    deps.gameId.value = null;
    createdGameId.value = null;
    joinGameId.value = '';
    lobbyInfo.value = null;
    isCreator.value = false;
    deps.currentScreen.value = 'lobby';
    clearUrl();
  }

  return {
    joinGameId,
    createdGameId,
    lobbyInfo,
    isCreator,
    gamePlayerOptions,
    createGame,
    joinGame,
    resumeGame,
    handleJoinLobby,
    handleUpdateLobbyName,
    handleSetReady,
    handleAddSlot,
    handleRemoveSlot,
    handleSetSlotBot,
    handleKickPlayer,
    handleUpdatePlayerOptions,
    handleUpdateGameOptions,
    handleUpdateSlotPlayerOptions,
    handleLobbyCancel,
    copyGameCode,
    leaveGame,
    disconnect,
  };
}
