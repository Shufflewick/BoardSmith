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
 * Takes no required props — the player-facing copy is fully static.
 * Dev-only guidance block is gated by import.meta.env.DEV (T-102-04).
 */

// import.meta.env.DEV is statically replaced by Vite — false in production bundles.
// This is the correct dev-build signal (not 'platformRequest' which is always provided).
const isDev = import.meta.env.DEV;
</script>

<template>
  <!-- Player-facing panel: always visible, amber/warning treatment -->
  <div class="unsupported-topology-panel">
    <h3 class="unsupported-topology-panel__heading">
      This layout cannot be auto-generated
    </h3>
    <p class="unsupported-topology-panel__body">
      This game uses a layout that is outside the auto-UI's supported set
      (grid, hex, stack, hand). Build a custom UI component for this game
      — see the custom UI guide.
    </p>

    <!-- Dev-only aside: quiet styling, no leaked internals (T-102-04) -->
    <aside v-if="isDev" class="unsupported-topology-panel__dev-aside">
      <p class="unsupported-topology-panel__dev-text">
        Dev: this topology has no auto-UI archetype — open the Debug panel
        (Ctrl/Cmd+D) to inspect the element tree, then implement a custom UI.
        See the
        <a
          class="unsupported-topology-panel__dev-link"
          href="/docs/custom-ui-guide.md"
          target="_blank"
          rel="noopener noreferrer"
        >custom UI guide</a>
        to get started.
      </p>
    </aside>
  </div>
</template>

<style scoped>
.unsupported-topology-panel {
  border-radius: 8px;
  padding: 24px;
  border: 1px solid color-mix(in srgb, var(--bsg-warn) 40%, transparent);
  background: color-mix(in srgb, var(--bsg-warn) 10%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0;
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

/* Dev-only aside — quiet, clearly separate from the loud amber player panel */
.unsupported-topology-panel__dev-aside {
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: 6px;
  border: 1px solid var(--bsg-line);
  background: var(--bsg-surface);
}

.unsupported-topology-panel__dev-text {
  color: var(--bsg-ink-3);
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}

.unsupported-topology-panel__dev-link {
  color: var(--bsg-accent);
  text-decoration: underline;
}

.unsupported-topology-panel__dev-link:hover {
  color: var(--bsg-ink);
}
</style>
