<script setup lang="ts">
/**
 * GameLobby - Initial screen for creating or joining a game
 */

const props = defineProps<{
  /** Display name for the game */
  displayName: string;
}>();

const playerName = defineModel<string>('playerName', { required: true });
const joinGameId = defineModel<string>('joinGameId', { required: true });

const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'join'): void;
}>();
</script>

<template>
  <div class="game-lobby">
    <h1>{{ displayName }}</h1>

    <div class="lobby-form">
      <div class="form-group">
        <label>Your Name:</label>
        <input v-model="playerName" type="text" placeholder="Enter your name" />
      </div>

      <div class="lobby-actions">
        <div class="action-box">
          <h3>Create New Game</h3>
          <p>Start a new game and invite friends</p>
          <button @click="emit('create')" class="btn primary">Create Game</button>
        </div>

        <div class="divider">OR</div>

        <div class="action-box">
          <h3>Join Existing Game</h3>
          <p>Enter the game code from your friend</p>
          <input v-model="joinGameId" type="text" placeholder="Enter game code" class="game-code-input" />
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
  margin-bottom: 30px;
}

.lobby-form {
  max-width: 500px;
  margin: 0 auto;
}

.form-group {
  margin-bottom: 30px;
  text-align: left;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #aaa;
}

.form-group input {
  width: 100%;
  padding: 15px;
  border: 2px solid #ccc;
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-size: 1.1rem;
}

.form-group input:focus {
  outline: none;
  border-color: #00d9ff;
  box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.2);
}

.form-group input::placeholder {
  color: #999;
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
  margin-bottom: 10px;
}

.action-box p {
  color: #aaa;
  margin-bottom: 15px;
  font-size: 0.9rem;
}

.game-code-input {
  width: 100%;
  padding: 12px;
  margin-bottom: 15px;
  border: 2px solid #ccc;
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-size: 1rem;
  font-family: monospace;
}

.game-code-input:focus {
  outline: none;
  border-color: #00d9ff;
  box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.2);
}

.game-code-input::placeholder {
  color: #999;
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
