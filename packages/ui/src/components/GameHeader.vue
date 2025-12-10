<script setup lang="ts">
/**
 * GameHeader - Top header bar for the game screen
 *
 * Contains the hamburger menu, game title, game code, and connection status.
 */
import HamburgerMenu from './HamburgerMenu.vue';

defineProps<{
  /** Display name for the game */
  gameTitle: string;
  /** Current game ID/code */
  gameId: string | null;
  /** Connection status */
  connectionStatus: string;
}>();

const emit = defineEmits<{
  (e: 'menu-item-click', id: string): void;
}>();
</script>

<template>
  <header class="game-header">
    <div class="header-left">
      <HamburgerMenu
        :game-title="gameTitle"
        :game-id="gameId"
        :connection-status="connectionStatus"
        @menu-item-click="(id) => emit('menu-item-click', id)"
      />
      <h1>{{ gameTitle }}</h1>
    </div>
    <div class="header-right">
      <span v-if="gameId" class="game-code">Game: <strong>{{ gameId }}</strong></span>
      <span class="connection-badge" :class="connectionStatus">{{ connectionStatus }}</span>
    </div>
  </header>
</template>

<style scoped>
.game-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  gap: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Hide game title on mobile - it's in the hamburger menu */
.game-header h1 {
  display: none;
  font-size: 1.3rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

/* Hide header-right on mobile - info is in hamburger menu */
.header-right {
  display: none;
  align-items: center;
  gap: 15px;
}

.game-code {
  font-size: 0.85rem;
  color: #aaa;
}

.game-code strong {
  color: #00d9ff;
  font-family: monospace;
}

.connection-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.connection-badge.connected { background: #27ae60; }
.connection-badge.connecting, .connection-badge.reconnecting { background: #f39c12; }
.connection-badge.disconnected, .connection-badge.error { background: #e74c3c; }

/* Desktop: Show header elements */
@media (min-width: 768px) {
  .game-header {
    padding: 12px 20px;
  }

  .header-left {
    gap: 20px;
  }

  .game-header h1 {
    display: block;
  }

  .header-right {
    display: flex;
  }
}
</style>
