<script setup lang="ts">
/**
 * WaitingRoom - Screen shown while waiting for other players to join
 */

defineProps<{
  /** The game ID/code to share */
  gameId: string;
}>();

const emit = defineEmits<{
  (e: 'start'): void;
  (e: 'cancel'): void;
}>();

function copyGameCode(gameId: string) {
  navigator.clipboard.writeText(gameId);
  alert('Game code copied!');
}
</script>

<template>
  <div class="waiting-room">
    <h2>Waiting for other players...</h2>
    <div class="share-code">
      <p>Share this code with your friends:</p>
      <div class="code-display">
        <span class="code">{{ gameId }}</span>
        <button @click="copyGameCode(gameId)" class="btn small">Copy</button>
      </div>
    </div>
    <button @click="emit('start')" class="btn secondary">
      Start Playing
    </button>
    <button @click="emit('cancel')" class="btn text">Cancel</button>
  </div>
</template>

<style scoped>
.waiting-room {
  max-width: 500px;
  margin: 0 auto;
  text-align: center;
  padding: 40px 20px;
}

.waiting-room h2 {
  margin-bottom: 30px;
}

.share-code {
  background: rgba(0, 217, 255, 0.1);
  padding: 30px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.share-code p {
  margin-bottom: 15px;
  color: #aaa;
}

.code-display {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
}

.code {
  font-family: monospace;
  font-size: 2rem;
  color: #00d9ff;
  letter-spacing: 3px;
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

.btn.secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.btn.secondary:hover {
  border-color: #00d9ff;
}

.btn.text {
  background: transparent;
  color: #888;
}

.btn.text:hover {
  color: #fff;
}

.btn.small {
  padding: 8px 16px;
  font-size: 0.9rem;
}
</style>
