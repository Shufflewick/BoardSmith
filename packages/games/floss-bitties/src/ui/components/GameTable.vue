<script setup lang="ts">
// Props from GameShell
const props = defineProps<{
  gameView: any;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  actionArgs: Record<string, unknown>;
  executeAction: (name: string) => Promise<void>;
  setBoardPrompt: (prompt: string | null) => void;
  startAction: (name: string, initialArgs?: Record<string, unknown>) => void;
}>();
</script>

<template>
  <div class="game-board">
    <p v-if="isMyTurn" class="turn-indicator">Your Turn</p>
    <p v-else class="waiting">Waiting for other player...</p>

    <div class="game-state">
      <pre>{{ JSON.stringify(gameView, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.game-board {
  padding: 20px;
}

.turn-indicator {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  padding: 8px 24px;
  border-radius: 20px;
  font-weight: bold;
  display: inline-block;
  margin-bottom: 20px;
}

.waiting {
  color: #888;
}

.game-state {
  background: rgba(0, 0, 0, 0.3);
  padding: 16px;
  border-radius: 8px;
  overflow: auto;
  max-height: 400px;
}

.game-state pre {
  font-size: 12px;
  color: #aaa;
}
</style>
