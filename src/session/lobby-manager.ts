/**
 * LobbyManager - Handles all lobby-related functionality for GameSession
 *
 * Extracted from GameSession to improve code organization and maintainability.
 * Manages player slots, ready states, and game start logic.
 */

import type {
  StoredGameState,
  StorageAdapter,
  BroadcastAdapter,
  LobbyState,
  LobbySlot,
  LobbyInfo,
  LobbyUpdate,
  PlayerOptionDefinition,
  SessionInfo,
} from './types.js';

// ============================================
// Types
// ============================================

/**
 * Callbacks for operations that need GameSession context
 */
export interface LobbyManagerCallbacks {
  /** Called when game transitions from waiting to playing */
  onGameStart: () => void;
  /** Called to update AI config based on current slots */
  onAIConfigChanged: (aiSlots: LobbySlot[]) => void;
}

// ============================================
// LobbyManager Class
// ============================================

/**
 * Manages lobby state, player slots, and game start logic.
 *
 * This class holds a reference to StoredGameState (not a copy) so mutations flow through
 * to the parent GameSession's state.
 */
export class LobbyManager<TSession extends SessionInfo = SessionInfo> {
  /** Timeout duration before auto-kicking disconnected players (30 seconds) */
  static readonly DISCONNECT_TIMEOUT_MS = 30000;

  readonly #storedState: StoredGameState;
  readonly #storage?: StorageAdapter;
  #broadcaster?: BroadcastAdapter<TSession>;
  readonly #callbacks: LobbyManagerCallbacks;
  #displayName?: string;

  /** Map of playerId -> disconnect timeout handle for auto-kick */
  #disconnectTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    storedState: StoredGameState,
    storage: StorageAdapter | undefined,
    callbacks: LobbyManagerCallbacks,
    displayName?: string
  ) {
    this.#storedState = storedState;
    this.#storage = storage;
    this.#callbacks = callbacks;
    this.#displayName = displayName;
  }

  // ============================================
  // Accessors
  // ============================================

  /**
   * Set the broadcast adapter for real-time updates
   */
  setBroadcaster(broadcaster: BroadcastAdapter<TSession>): void {
    this.#broadcaster = broadcaster;
  }

  // ============================================
  // State Methods
  // ============================================

  /**
   * Check if the game is waiting for players to join
   */
  isWaitingForPlayers(): boolean {
    return this.#storedState.lobbyState === 'waiting';
  }

  /**
   * Get the current lobby state
   */
  getLobbyState(): LobbyState | undefined {
    return this.#storedState.lobbyState;
  }

  /**
   * Get full lobby information for clients
   */
  getLobbyInfo(): LobbyInfo | null {
    if (!this.#storedState.lobbySlots) {
      return null;
    }

    const slots = this.#storedState.lobbySlots;
    const openSlots = slots.filter(s => s.status === 'open').length;

    // All ready = no open slots AND all filled slots are ready (AI always ready)
    const allReady = openSlots === 0 &&
      slots.every(s => s.status === 'ai' || s.ready);

    return {
      state: this.#storedState.lobbyState ?? 'playing',
      gameType: this.#storedState.gameType,
      displayName: this.#displayName,
      slots,
      gameOptions: this.#storedState.gameOptions,
      gameOptionsDefinitions: this.#storedState.gameOptionsDefinitions,
      creatorId: this.#storedState.creatorId,
      openSlots,
      isReady: allReady,
      minPlayers: this.#storedState.minPlayers,
      maxPlayers: this.#storedState.maxPlayers,
      colorSelectionEnabled: this.#storedState.colorSelectionEnabled,
      colors: this.#storedState.colors,
    };
  }

  /**
   * Get seat for a player ID
   */
  getSeatForPlayer(playerId: string): number | undefined {
    if (!this.#storedState.lobbySlots) return undefined;
    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    return slot?.seat;
  }

  // ============================================
  // Slot Management Methods
  // ============================================

  /**
   * Claim a seat in the lobby
   *
   * @param seat Seat to claim (1-indexed)
   * @param playerId Player's unique ID
   * @param name Player's display name
   * @returns Result with updated lobby info
   */
  async claimSeat(
    seat: number,
    playerId: string,
    name: string
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    this.#validateSeat(seat);

    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Seat is 1-indexed, convert to array index
    const arrayIndex = seat - 1;
    if (seat < 1 || seat > this.#storedState.lobbySlots.length) {
      return { success: false, error: 'Invalid seat' };
    }

    const slot = this.#storedState.lobbySlots[arrayIndex];

    if (slot.status === 'ai') {
      return { success: false, error: 'This seat is reserved for AI' };
    }

    if (slot.status === 'claimed' && slot.playerId !== playerId) {
      return { success: false, error: 'This seat is already taken' };
    }

    // Check if player already claimed another seat
    const existingSlot = this.#storedState.lobbySlots.find(
      s => s.playerId === playerId && s.seat !== seat
    );
    if (existingSlot) {
      // Release the old seat
      existingSlot.status = 'open';
      existingSlot.playerId = undefined;
      existingSlot.name = `Player ${existingSlot.seat}`;
      existingSlot.ready = false;
    }

    // Claim the seat (starts not ready - player must explicitly ready up)
    slot.status = 'claimed';
    slot.playerId = playerId;
    slot.name = name;
    slot.ready = false;

    // Initialize player options with defaults (if definitions exist)
    // computeDefaultPlayerOptions already handles color assignment with deduplication
    if (this.#storedState.playerOptionsDefinitions) {
      slot.playerOptions = this.#computeDefaultPlayerOptions(seat);
    }

    // Assign a default color from the palette if colorSelectionEnabled and no color assigned
    // This handles cases where the game uses palette-based colors without playerOptionsDefinitions.color
    if (this.#storedState.colorSelectionEnabled &&
        this.#storedState.colors &&
        !slot.playerOptions?.color) {
      const takenColors = new Set<string>();
      for (const s of this.#storedState.lobbySlots) {
        if (s.playerOptions?.color) {
          takenColors.add(s.playerOptions.color as string);
        }
      }
      const availableColor = this.#storedState.colors.find(c => !takenColors.has(c));
      if (availableColor) {
        slot.playerOptions = { ...slot.playerOptions, color: availableColor };
      }
    }

    // Update player names in stored state (convert 1-indexed seat to array index)
    this.#storedState.playerNames[seat - 1] = name;

    // Note: Game no longer auto-starts when slots are filled
    // Players must use setReady() to ready up, and game starts when all are ready

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    // Note: Game doesn't auto-start from claimSeat anymore
    // Players must use setReady() after claiming their seat

    return { success: true, lobby: this.getLobbyInfo()! };
  }

  /**
   * Update a player's name in their slot
   *
   * @param playerId Player's unique ID
   * @param name New display name
   */
  async updateSlotName(
    playerId: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) {
      return { success: false, error: 'Player not found in lobby' };
    }

    slot.name = name;
    // Convert 1-indexed position to array index
    this.#storedState.playerNames[slot.seat - 1] = name;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true };
  }

  /**
   * Set a player's ready state
   *
   * @param playerId Player's unique ID
   * @param ready Whether the player is ready
   * @returns Result with updated lobby info
   */
  async setReady(
    playerId: string,
    ready: boolean
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo; gameStarted?: boolean }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) {
      return { success: false, error: 'Player not found in lobby' };
    }

    if (slot.status === 'ai') {
      return { success: false, error: 'Cannot change ready state for AI' };
    }

    slot.ready = ready;

    // Check if all players are ready and start game
    const gameStarted = await this.checkAndStartGame();

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo()!, gameStarted };
  }

  /**
   * Add a new player slot (host only)
   *
   * @param playerId Must be the creator's ID
   * @returns Result with updated lobby info
   */
  async addSlot(
    playerId: string
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    if (playerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can add slots' };
    }

    const currentCount = this.#storedState.lobbySlots.length;
    const maxPlayers = this.#storedState.maxPlayers ?? 10;

    if (currentCount >= maxPlayers) {
      return { success: false, error: `Cannot exceed ${maxPlayers} players` };
    }

    const newSeat = currentCount + 1;  // 1-indexed
    this.#storedState.lobbySlots.push({
      seat: newSeat,
      status: 'open',
      name: `Player ${newSeat}`,
      ready: false,
    });

    // Update player count and names
    this.#storedState.playerCount = currentCount + 1;
    this.#storedState.playerNames.push(`Player ${newSeat}`);

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo()! };
  }

  /**
   * Remove a player slot (host only, slot must be open or AI)
   *
   * @param playerId Must be the creator's ID
   * @param seat Seat of the slot to remove
   * @returns Result with updated lobby info
   */
  async removeSlot(
    playerId: string,
    seat: number
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    if (playerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can remove slots' };
    }

    const currentCount = this.#storedState.lobbySlots.length;
    const minPlayers = this.#storedState.minPlayers ?? 1;

    if (currentCount <= minPlayers) {
      return { success: false, error: `Cannot have fewer than ${minPlayers} players` };
    }

    // Seat is 1-indexed
    if (seat === 1) {
      return { success: false, error: 'Cannot remove the host slot' };
    }

    if (seat < 1 || seat > currentCount) {
      return { success: false, error: 'Invalid seat' };
    }

    const arrayIndex = seat - 1;
    const slot = this.#storedState.lobbySlots[arrayIndex];
    if (slot.status === 'claimed') {
      return { success: false, error: 'Cannot remove a slot with a player - they must leave first' };
    }

    // Remove the slot
    this.#storedState.lobbySlots.splice(arrayIndex, 1);
    this.#storedState.playerNames.splice(arrayIndex, 1);
    this.#storedState.playerCount = this.#storedState.lobbySlots.length;

    // Renumber remaining slots (1-indexed)
    this.#storedState.lobbySlots.forEach((s, i) => {
      s.seat = i + 1; // 1-indexed
      if (s.status === 'open') {
        s.name = `Player ${i + 1}`;
      }
    });

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo()! };
  }

  /**
   * Toggle a slot between open and AI (host only)
   *
   * @param playerId Must be the creator's ID
   * @param seat Seat of the slot to modify
   * @param isAI Whether to make this an AI slot
   * @param aiLevel AI difficulty level (if isAI is true)
   * @returns Result with updated lobby info
   */
  async setSlotAI(
    playerId: string,
    seat: number,
    isAI: boolean,
    aiLevel: string = 'medium'
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo; gameStarted?: boolean }> {
    this.#validateSeat(seat);

    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    if (playerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can modify slots' };
    }

    // Seat is 1-indexed
    if (seat === 1) {
      return { success: false, error: 'Cannot change the host slot to AI' };
    }

    if (seat < 1 || seat > this.#storedState.lobbySlots.length) {
      return { success: false, error: 'Invalid seat' };
    }

    const arrayIndex = seat - 1;
    const slot = this.#storedState.lobbySlots[arrayIndex];

    if (slot.status === 'claimed') {
      return { success: false, error: 'Cannot change a claimed slot - player must leave first' };
    }

    if (isAI) {
      slot.status = 'ai';
      slot.name = 'Bot';
      slot.aiLevel = aiLevel;
      slot.playerId = undefined;
      slot.ready = true; // AI is always ready

      // Compute default player options (including color with deduplication)
      if (this.#storedState.playerOptionsDefinitions) {
        slot.playerOptions = this.#computeDefaultPlayerOptions(seat);
      }

      // Assign a default color from the palette if colorSelectionEnabled and no color assigned
      if (this.#storedState.colorSelectionEnabled &&
          this.#storedState.colors &&
          !slot.playerOptions?.color) {
        const takenColors = new Set<string>();
        for (const s of this.#storedState.lobbySlots) {
          if (s.playerOptions?.color) {
            takenColors.add(s.playerOptions.color as string);
          }
        }
        const availableColor = this.#storedState.colors.find(c => !takenColors.has(c));
        if (availableColor) {
          slot.playerOptions = { ...slot.playerOptions, color: availableColor };
        }
      }
    } else {
      slot.status = 'open';
      slot.name = `Player ${slot.seat}`;
      slot.aiLevel = undefined;
      slot.playerId = undefined;
      slot.ready = false;
      slot.playerOptions = undefined;
    }

    // Update AI config if needed
    this.updateAIConfig();

    // Check if all players are ready and start game
    const gameStarted = await this.checkAndStartGame();

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo()!, gameStarted };
  }

  /**
   * Leave/unclaim a seat in the lobby
   * Used when a player leaves the waiting room
   */
  async leaveSeat(playerId: string): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Find the slot claimed by this player
    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) {
      return { success: false, error: 'Player has not claimed a seat' };
    }

    // Cannot leave if you're the creator/host (seat 1)
    if (slot.seat === 1) {
      return { success: false, error: 'Host cannot leave. Cancel the game instead.' };
    }

    // Release the seat
    slot.status = 'open';
    slot.playerId = undefined;
    slot.name = `Player ${slot.seat}`;
    slot.ready = false;
    slot.connected = undefined;
    slot.playerOptions = undefined;

    // Update player names in stored state
    this.#storedState.playerNames[slot.seat - 1] = slot.name;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  /**
   * Set the connected status for a player in the lobby
   * Called when a WebSocket connects/disconnects
   *
   * @param playerId Player's unique ID
   * @param connected Whether the player is connected
   * @returns true if a slot was updated
   */
  async setPlayerConnected(playerId: string, connected: boolean): Promise<boolean> {
    if (!this.#storedState.lobbySlots) return false;

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) return false;

    // Handle disconnect timeout logic
    if (connected) {
      // Player reconnected - cancel any pending timeout
      const existingTimeout = this.#disconnectTimeouts.get(playerId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.#disconnectTimeouts.delete(playerId);
      }
    } else {
      // Player disconnected - unready them so game doesn't start without them
      if (slot.ready && this.#storedState.lobbyState === 'waiting') {
        slot.ready = false;
      }

      // Start timeout for auto-kick (non-host players only)
      if (slot.seat !== 1 && this.#storedState.lobbyState === 'waiting') {
        // Clear any existing timeout first
        const existingTimeout = this.#disconnectTimeouts.get(playerId);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const timeout = setTimeout(async () => {
          this.#disconnectTimeouts.delete(playerId);
          // Auto-kick if still in waiting state
          if (this.#storedState.lobbyState === 'waiting') {
            await this.leaveSeat(playerId);
          }
        }, LobbyManager.DISCONNECT_TIMEOUT_MS);

        this.#disconnectTimeouts.set(playerId, timeout);
      }
    }

    // Only update if status actually changed
    if (slot.connected === connected) return false;

    slot.connected = connected;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return true;
  }

  /**
   * Kick a player from the lobby (host only)
   *
   * @param hostPlayerId Must be the creator's ID
   * @param seat Seat of the player to kick
   * @returns Result with updated lobby info
   */
  async kickPlayer(
    hostPlayerId: string,
    seat: number
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    this.#validateSeat(seat);

    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Verify caller is the host
    if (hostPlayerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can kick players' };
    }

    // Seat is 1-indexed. Can't kick yourself (host is seat 1)
    if (seat === 1) {
      return { success: false, error: 'Cannot kick the host' };
    }

    if (seat < 1 || seat > this.#storedState.lobbySlots.length) {
      return { success: false, error: 'Invalid seat' };
    }

    const arrayIndex = seat - 1;
    const slot = this.#storedState.lobbySlots[arrayIndex];

    if (slot.status !== 'claimed') {
      return { success: false, error: 'Seat is not occupied by a player' };
    }

    // Clear any pending disconnect timeout for this player
    if (slot.playerId) {
      const timeout = this.#disconnectTimeouts.get(slot.playerId);
      if (timeout) {
        clearTimeout(timeout);
        this.#disconnectTimeouts.delete(slot.playerId);
      }
    }

    // Release the slot
    slot.status = 'open';
    slot.playerId = undefined;
    slot.name = `Player ${slot.seat}`;
    slot.ready = false;
    slot.connected = undefined;
    slot.playerOptions = undefined;

    // Update player names in stored state
    this.#storedState.playerNames[slot.seat - 1] = slot.name;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  /**
   * Clear all disconnect timeouts (e.g., when game starts or ends)
   */
  clearDisconnectTimeouts(): void {
    for (const timeout of this.#disconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.#disconnectTimeouts.clear();
  }

  // ============================================
  // Player Options Methods
  // ============================================

  /**
   * Update a player's options (color, etc.)
   *
   * @param playerId Player's unique ID
   * @param options The player options to set
   * @returns Result with updated lobby info
   */
  async updatePlayerOptions(
    playerId: string,
    options: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) {
      return { success: false, error: 'Player not found in lobby' };
    }

    // Validate color change if color is being updated
    if (options.color !== undefined) {
      const colorValidation = this.#validateColorChange(slot.seat, options.color as string);
      if (!colorValidation.success) {
        return { success: false, error: colorValidation.error };
      }
    }

    // Merge new options with existing
    slot.playerOptions = {
      ...slot.playerOptions,
      ...options,
    };

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  /**
   * Update a specific slot's player options (host only)
   * Used for exclusive options that the host assigns to players
   *
   * @param hostPlayerId Must be the creator's ID
   * @param seat The slot seat to update
   * @param options The player options to set
   * @returns Result with updated lobby info
   */
  async updateSlotPlayerOptions(
    hostPlayerId: string,
    seat: number,
    options: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    this.#validateSeat(seat);

    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Verify caller is the host
    if (hostPlayerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can modify other players\' options' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.seat === seat);
    if (!slot) {
      return { success: false, error: 'Slot not found' };
    }

    if (slot.status === 'open') {
      return { success: false, error: 'Cannot set options for an open slot' };
    }

    // Validate color change if color is being updated
    if (options.color !== undefined) {
      const colorValidation = this.#validateColorChange(slot.seat, options.color as string);
      if (!colorValidation.success) {
        return { success: false, error: colorValidation.error };
      }
    }

    // Merge new options with existing
    slot.playerOptions = {
      ...slot.playerOptions,
      ...options,
    };

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  /**
   * Update game options (host only)
   *
   * @param hostPlayerId Must be the creator's ID
   * @param options The game options to set
   * @returns Result with updated lobby info
   */
  async updateGameOptions(
    hostPlayerId: string,
    options: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Verify caller is the host
    if (hostPlayerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can modify game options' };
    }

    // Merge new options with existing
    this.#storedState.gameOptions = {
      ...this.#storedState.gameOptions,
      ...options,
    };

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  // ============================================
  // Game Start Methods
  // ============================================

  /**
   * Check if all players are ready and start the game if so
   * @returns true if game started
   */
  async checkAndStartGame(): Promise<boolean> {
    if (!this.#storedState.lobbySlots) return false;
    if (this.#storedState.lobbyState !== 'waiting') return false;

    const slots = this.#storedState.lobbySlots;
    const openSlots = slots.filter(s => s.status === 'open').length;

    // All ready = no open slots AND all humans are ready (AI is always ready)
    const allReady = openSlots === 0 &&
      slots.every(s => s.status === 'ai' || s.ready);

    if (allReady) {
      this.#storedState.lobbyState = 'playing';

      // Clear any pending disconnect timeouts since game is starting
      this.clearDisconnectTimeouts();

      // Notify GameSession that game has started (for AI scheduling)
      this.#callbacks.onGameStart();

      return true;
    }

    return false;
  }

  /**
   * Update AI config based on current lobby slots
   */
  updateAIConfig(): void {
    if (!this.#storedState.lobbySlots) return;

    const aiSlots = this.#storedState.lobbySlots.filter(s => s.status === 'ai');
    this.#callbacks.onAIConfigChanged(aiSlots);
  }

  // ============================================
  // Broadcasting
  // ============================================

  /**
   * Broadcast lobby state to all connected sessions
   */
  broadcastLobby(): void {
    if (!this.#broadcaster) return;

    const lobby = this.getLobbyInfo();
    if (!lobby) return;

    const sessions = this.#broadcaster.getSessions();
    const update: LobbyUpdate = { type: 'lobby', lobby };

    for (const session of sessions) {
      try {
        this.#broadcaster.send(session, update);
      } catch (error) {
        console.error('Lobby broadcast error:', error);
      }
    }
  }

  // ============================================
  // Static Methods
  // ============================================

  /**
   * Compute default player options for a seat (static version)
   * Takes into account options already taken by other players
   */
  static computeDefaultPlayerOptions(
    seat: number,
    definitions: Record<string, PlayerOptionDefinition>,
    lobbySlots: LobbySlot[],
    playerCount: number
  ): Record<string, unknown> {
    if (seat < 1) {
      throw new Error(`Invalid seat ${seat}: seats are 1-indexed (minimum 1)`);
    }

    const result: Record<string, unknown> = {};

    // Collect values already taken by other players
    const takenValues: Record<string, Set<string>> = {};
    for (const slot of lobbySlots) {
      if (slot.seat !== seat && slot.playerOptions) {
        for (const [key, value] of Object.entries(slot.playerOptions)) {
          if (!takenValues[key]) {
            takenValues[key] = new Set();
          }
          takenValues[key].add(String(value));
        }
      }
    }

    for (const [key, opt] of Object.entries(definitions)) {
      if (opt.type === 'select' || opt.type === 'color') {
        // For select/color, pick the first available choice
        const choices = opt.choices ?? [];
        const taken = takenValues[key] ?? new Set();

        for (const choice of choices) {
          const value = typeof choice === 'string' ? choice : choice.value;
          if (!taken.has(value)) {
            result[key] = value;
            break;
          }
        }

        // If all choices are taken (shouldn't happen), use the default or first choice
        if (result[key] === undefined) {
          if (opt.default !== undefined) {
            result[key] = opt.default;
          } else if (choices.length > 0) {
            const firstChoice = choices[0];
            result[key] = typeof firstChoice === 'string' ? firstChoice : firstChoice.value;
          }
        }
      } else if (opt.type === 'exclusive') {
        // For exclusive options, check if this seat matches the default
        // defaultIndex is 0-indexed, seat is 1-indexed, so convert seat to 0-indexed
        let defaultIndex: number;
        if (opt.default === 'first' || opt.default === undefined) {
          defaultIndex = 0;
        } else if (opt.default === 'last') {
          defaultIndex = playerCount - 1;
        } else {
          defaultIndex = opt.default;
        }
        result[key] = (seat - 1) === defaultIndex;
      } else if (opt.type === 'text') {
        // For text, use the default if provided
        if (opt.default !== undefined) {
          result[key] = opt.default;
        }
      }
    }

    return result;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Validate that a seat number is 1-indexed (minimum 1).
   * Throws with an actionable error if seat < 1.
   */
  #validateSeat(seat: number): void {
    if (seat < 1) {
      throw new Error(`Invalid seat ${seat}: seats are 1-indexed (minimum 1)`);
    }
  }

  /**
   * Compute default player options for a seat (instance method wrapper)
   */
  #computeDefaultPlayerOptions(seat: number): Record<string, unknown> {
    this.#validateSeat(seat);

    const definitions = this.#storedState.playerOptionsDefinitions;
    if (!definitions || !this.#storedState.lobbySlots) return {};

    return LobbyManager.computeDefaultPlayerOptions(
      seat,
      definitions,
      this.#storedState.lobbySlots,
      this.#storedState.playerCount
    );
  }

  /**
   * Validate that a color change doesn't conflict with another player's color
   *
   * @param seat The seat of the player requesting the change
   * @param targetColor The color they want to change to
   * @returns Validation result with error message if color is taken
   */
  #validateColorChange(
    seat: number,
    targetColor: string
  ): { success: boolean; error?: string } {
    this.#validateSeat(seat);

    if (!this.#storedState.lobbySlots) {
      return { success: true }; // No lobby, no validation needed
    }

    // Check if target color is already held by another player
    const conflictingSlot = this.#storedState.lobbySlots.find(
      s => s.seat !== seat && s.playerOptions?.color === targetColor
    );

    if (conflictingSlot) {
      return {
        success: false,
        error: `Color ${targetColor} is already taken by ${conflictingSlot.name}`,
      };
    }

    return { success: true };
  }
}
