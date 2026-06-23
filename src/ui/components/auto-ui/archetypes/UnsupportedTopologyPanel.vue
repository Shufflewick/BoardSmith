<script setup lang="ts">
/**
 * UnsupportedTopologyPanel — Loud honest-fail boundary panel (RENDER-04).
 *
 * Rendered when selectArchetype() returns 'unsupported' — the topology uses
 * a free-form or otherwise un-addressable layout that the auto-UI cannot render.
 *
 * Design requirements (UI-SPEC §Template 4 + Copywriting Contract):
 *   - Visually LOUD — amber/warning treatment, NOT a subtle gray placeholder
 *   - Locked copy rendered verbatim (heading + body — do not paraphrase)
 *   - Actionable: always includes a next-step instruction (custom UI guide reference)
 *   - Never shows: stack traces, element IDs, attribute names, TypeScript types
 *   - No dynamic HTML injection (CLAUDE.md: never leak implementation details; XSS guard)
 *
 * Takes no required props — the copy is fully static.
 */
</script>

<template>
  <div class="unsupported-topology-panel">
    <h3 class="unsupported-topology-panel__heading">
      This layout cannot be auto-generated
    </h3>
    <p class="unsupported-topology-panel__body">
      This game uses a layout that is outside the auto-UI's supported set
      (grid, hex, stack, hand). Build a custom UI component for this game
      — see the custom UI guide.
    </p>
  </div>
</template>

<style scoped>
.unsupported-topology-panel {
  border-radius: 8px;
  padding: 24px;
  border: 1px solid color-mix(in srgb, var(--bsg-warn) 40%, transparent);
  background: color-mix(in srgb, var(--bsg-warn) 10%, transparent);
}

.unsupported-topology-panel__heading {
  color: var(--bsg-warn);
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 12px 0;
  line-height: 1.2;
}

.unsupported-topology-panel__body {
  color: var(--bsg-ink);
  font-size: 16px;
  line-height: 1.5;
  margin: 0;
}
</style>
