<script setup lang="ts">
/**
 * GameLobby - Simple lobby for creating or joining a game
 *
 * Features:
 * - Create game button (configuration happens in WaitingRoom)
 * - Join existing game by code
 */
import { ref, onMounted } from 'vue';

interface PlayerConfig {
  name: string;
  isAI: boolean;
  aiLevel: string;
  [key: string]: unknown;
}

interface GameDefinitionMeta {
  gameType: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
}

interface LobbyConfig {
  playerCount: number;
  gameOptions: Record<string, unknown>;
  playerConfigs: PlayerConfig[];
}

const props = defineProps<{
  /** Display name for the game */
  displayName: string;
  /** API base URL (optional, defaults to same origin with port 8787) */
  apiUrl?: string;
}>();

const joinGameId = defineModel<string>('joinGameId', { required: true });

const emit = defineEmits<{
  (e: 'create', config: LobbyConfig): void;
  (e: 'join'): void;
}>();

// Game definition metadata (fetched from server)
const definition = ref<GameDefinitionMeta | null>(null);

// Fetch game definition on mount (to get min players)
onMounted(async () => {
  try {
    const baseUrl =
      props.apiUrl || window.location.origin.replace(/:\d+$/, ':8787');
    const res = await fetch(`${baseUrl}/games/definitions`);
    const data = await res.json();

    if (data.success && data.definitions?.length > 0) {
      definition.value = data.definitions[0];
    }
  } catch (e) {
    console.warn('Could not fetch game definitions:', e);
  }
});

// Handle create game - just use defaults, host will configure in waiting room
function handleCreate() {
  const minPlayers = definition.value?.minPlayers ?? 2;

  // Create with minimum players, all human, default names
  const playerConfigs: PlayerConfig[] = Array.from({ length: minPlayers }, (_, i) => ({
    name: `Player ${i + 1}`,
    isAI: false,
    aiLevel: 'medium',
  }));

  emit('create', {
    playerCount: minPlayers,
    gameOptions: {},
    playerConfigs,
  });
}
</script>

<template>
  <div class="game-lobby">
    <h1>{{ displayName }}</h1>

    <div class="lobby-form">
      <div class="lobby-actions">
        <!-- Create Game Section -->
        <div class="action-box">
          <h3>Create New Game</h3>
          <p>Start a new game and invite friends</p>
          <button @click="handleCreate" class="btn primary">Create Game</button>
        </div>

        <div class="divider">OR</div>

        <!-- Join Game Section -->
        <div class="action-box">
          <h3>Join Existing Game</h3>
          <p>Enter the game code from your friend</p>
          <input
            v-model="joinGameId"
            type="text"
            placeholder="Enter game code"
            class="game-code-input"
          />
          <button @click="emit('join')" class="btn secondary">Join Game</button>
        </div>
      </div>
    </div>

    <slot></slot>
  </div>
</template>

<style scoped>
.game-lobby {
  max-width: 500px;
  margin: 0 auto;
  padding: 40px 20px;
  text-align: center;
}

.game-lobby h1 {
  font-size: 2.5rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 30px;
}

.lobby-form {
  max-width: 500px;
  margin: 0 auto;
}

.lobby-actions {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.action-box {
  background: rgba(255, 255, 255, 0.05);
  padding: 25px;
  border-radius: 12px;
  text-align: center;
}

.action-box h3 {
  margin-bottom: 16px;
  color: #fff;
}

.action-box p {
  color: #aaa;
  margin-bottom: 16px;
  font-size: 0.9rem;
}

.game-code-input {
  width: 100%;
  padding: 12px;
  margin-bottom: 15px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 1rem;
  font-family: monospace;
}

.game-code-input:focus {
  outline: none;
  border-color: #00d9ff;
}

.game-code-input::placeholder {
  color: #666;
}

.divider {
  color: #666;
  font-size: 0.9rem;
}

/* Buttons */
.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  width: 100%;
}

.btn.primary {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  font-weight: bold;
}

.btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4);
}

.btn.secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.btn.secondary:hover {
  border-color: #00d9ff;
}
</style>
