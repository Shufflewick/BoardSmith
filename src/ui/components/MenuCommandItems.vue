<script setup lang="ts">
/**
 * The game's own commands (#1448) as controls menu items. Their style comes
 * from ControlsMenu, which closes the menu before running one.
 */
import type { MenuCommand } from '../composables/menuCommands.js';

defineProps<{ commands: readonly MenuCommand[] }>();
defineEmits<{ run: [command: MenuCommand] }>();
</script>

<template>
  <button
    v-for="(command, index) in commands"
    :key="index"
    class="mi mi-command"
    type="button"
    role="menuitem"
    :aria-disabled="command.enabled === false"
    @click="$emit('run', command)"
  >
    {{ command.label }}
  </button>
</template>

