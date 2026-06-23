<script setup lang="ts">
import { ref } from 'vue';

interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  action?: () => void;
  href?: string;
  divider?: boolean;
}

interface HamburgerMenuProps {
  /** Menu items */
  items?: MenuItem[];
  /** Game title to display */
  gameTitle?: string;
  /** Game ID (for mobile display) */
  gameId?: string | null;
  /** Connection status (for mobile display) */
  connectionStatus?: string;
}

const props = withDefaults(defineProps<HamburgerMenuProps>(), {
  items: () => [],
  gameTitle: 'BoardSmith',
  gameId: null,
  connectionStatus: 'disconnected',
});

const emit = defineEmits<{
  'menu-item-click': [id: string];
  'leave-game': [];
}>();

const isOpen = ref(false);

function toggleMenu() {
  isOpen.value = !isOpen.value;
}

function closeMenu() {
  isOpen.value = false;
}

function handleItemClick(item: MenuItem) {
  if (item.action) {
    item.action();
  }
  emit('menu-item-click', item.id);
  closeMenu();
}

// Default menu items if none provided
const defaultItems: MenuItem[] = [
  { id: 'new-game', label: 'New Game', icon: '+' },
  { id: 'leave', label: 'Leave Game', icon: 'X' },
];

const menuItems = props.items.length > 0 ? props.items : defaultItems;
</script>

<template>
  <div class="hamburger-menu">
    <!-- Hamburger Button -->
    <button
      class="hamburger-btn"
      @click="toggleMenu"
      :class="{ open: isOpen }"
      :aria-label="isOpen ? 'Close menu' : 'Open menu'"
      :aria-expanded="isOpen"
      aria-controls="hamburger-menu-drawer"
    >
      <span class="bar"></span>
      <span class="bar"></span>
      <span class="bar"></span>
    </button>

    <!-- Overlay -->
    <div v-if="isOpen" class="menu-overlay" @click="closeMenu"></div>

    <!-- Menu Drawer -->
    <Transition name="slide">
      <div v-if="isOpen" id="hamburger-menu-drawer" class="menu-drawer">
        <div class="drawer-header">
          <div class="logo">
            <span class="logo-text">{{ gameTitle }}</span>
          </div>
          <button class="close-btn" @click="closeMenu" aria-label="Close menu">
            <span aria-hidden="true">X</span>
          </button>
        </div>

        <!-- Game Info (visible in menu for mobile) -->
        <div v-if="gameId" class="drawer-game-info">
          <div class="game-info-row">
            <span class="info-label">Game:</span>
            <span class="info-value">{{ gameId }}</span>
          </div>
          <div class="game-info-row">
            <span class="info-label">Status:</span>
            <span class="connection-dot" :class="connectionStatus"></span>
            <span class="info-value">{{ connectionStatus }}</span>
          </div>
        </div>

        <nav class="drawer-nav">
          <template v-for="item in menuItems" :key="item.id">
            <div v-if="item.divider" class="menu-divider"></div>
            <a
              v-else-if="item.href"
              :href="item.href"
              class="menu-item"
              @click="closeMenu"
            >
              <span class="item-icon">{{ item.icon }}</span>
              <span class="item-label">{{ item.label }}</span>
            </a>
            <button
              v-else
              class="menu-item"
              @click="handleItemClick(item)"
              :class="{ danger: item.id === 'leave' }"
            >
              <span class="item-icon">{{ item.icon }}</span>
              <span class="item-label">{{ item.label }}</span>
            </button>
          </template>
        </nav>

      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hamburger-menu {
  position: relative;
  z-index: 100;
}

/* Hamburger Button */
.hamburger-btn {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 28px;
  height: 20px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

.bar {
  display: block;
  width: 100%;
  height: 3px;
  background: var(--bsg-ink);
  border-radius: 2px;
  transition: all 0.3s ease;
}

.hamburger-btn.open .bar:nth-child(1) {
  transform: translateY(8px) rotate(45deg);
}

.hamburger-btn.open .bar:nth-child(2) {
  opacity: 0;
}

.hamburger-btn.open .bar:nth-child(3) {
  transform: translateY(-9px) rotate(-45deg);
}

/* Overlay */
.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
}

/* Drawer — background: transparent is injected by .game-shell--platform :deep(.menu-drawer)
   when embedded so the host backdrop shows through; var(--bsg-bg) is the standalone fallback. */
.menu-drawer {
  position: fixed;
  top: 0;
  left: 0;
  width: 280px;
  height: 100vh; /* fallback: browsers without dvh support */
  height: 100dvh;
  background: var(--bsg-bg);
  z-index: 300;
  display: flex;
  flex-direction: column;
  box-shadow: var(--bsg-shadow);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--bsg-line);
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Solid display title — clip-text removed (THEME-04) */
.logo-text {
  font-family: var(--bsg-display);
  font-size: 18px;
  font-weight: 600;
  color: var(--bsg-ink);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.close-btn {
  width: 32px;
  height: 32px;
  background: var(--bsg-field);
  border: none;
  border-radius: 8px;
  color: var(--bsg-ink-2);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bsg-line-2);
  color: var(--bsg-ink);
}

/* Game Info Section */
.drawer-game-info {
  padding: 12px 20px;
  background: var(--bsg-surface-2);
  border-bottom: 1px solid var(--bsg-line);
}

.game-info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 6px;
}

.game-info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  color: var(--bsg-ink-2);
}

.info-value {
  color: var(--bsg-ink);
  font-family: var(--bsg-mono);
}

.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bsg-away);
}

.connection-dot.connected { background: var(--bsg-ok); }
.connection-dot.connecting,
.connection-dot.reconnecting { background: var(--bsg-warn); }
.connection-dot.disconnected,
.connection-dot.error { background: var(--bsg-danger); }

/* Navigation */
.drawer-nav {
  flex: 1;
  padding: 20px 0;
  overflow-y: auto;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 24px;
  background: transparent;
  border: none;
  color: var(--bsg-ink-2);
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.menu-item:hover {
  background: var(--bsg-selectable);
  color: var(--bsg-accent);
}

.menu-item.danger {
  color: var(--bsg-danger);
}

.menu-item.danger:hover {
  background: color-mix(in srgb, var(--bsg-danger) 12%, transparent);
}

.item-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bsg-field);
  border-radius: 6px;
  font-size: 12px;
}

.menu-divider {
  height: 1px;
  background: var(--bsg-line);
  margin: 10px 24px;
}

/* Slide transition */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}
</style>
