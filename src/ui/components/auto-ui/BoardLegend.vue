<script setup lang="ts">
/**
 * BoardLegend — presentational panel listing the 5 board interaction states,
 * each with a swatch that mirrors the real CSS non-color cue plus a text label.
 *
 * A11Y-05: non-color cues legend (mirroring mockup .legend section, lines 416-425).
 * Mount point: AutoUI board region (absolute, bottom-left per mockup).
 * No props — purely presentational.
 */
</script>

<template>
  <aside class="board-legend" aria-label="Interaction state legend">
    <h4 class="legend-title">Board states</h4>
    <ul class="legend-list">
      <li class="legend-row">
        <span class="sw sw-selectable" aria-hidden="true">
          <span class="sw-icon">+</span>
        </span>
        <span class="legend-label"><b>Selectable</b> · dashed, pulses</span>
      </li>
      <li class="legend-row">
        <span class="sw sw-selected" aria-hidden="true">
          <span class="sw-icon">✓</span>
        </span>
        <span class="legend-label"><b>Selected</b> · solid ring, raised</span>
      </li>
      <li class="legend-row">
        <span class="sw sw-drop" aria-hidden="true">
          <span class="sw-icon">↓</span>
        </span>
        <span class="legend-label"><b>Drop target</b> · dotted, hatched</span>
      </li>
      <li class="legend-row">
        <span class="sw sw-disabled" aria-hidden="true"></span>
        <span class="legend-label"><b>Disabled</b> · faded, striped</span>
      </li>
      <li class="legend-row">
        <span class="sw sw-active" aria-hidden="true">
          <span class="sw-dot"></span>
        </span>
        <span class="legend-label"><b>Active player</b> · pulsing dot</span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.board-legend {
  position: absolute;
  bottom: var(--bsg-s3);
  left: var(--bsg-s3);
  background: color-mix(in srgb, var(--bsg-surface) 88%, transparent);
  border: 1px solid var(--bsg-line);
  border-radius: var(--bsg-r-md);
  padding: var(--bsg-s2) var(--bsg-s3);
  font-size: 11px;
  color: var(--bsg-ink);
  pointer-events: none;
  backdrop-filter: blur(4px);
  z-index: 10;
  min-width: 180px;
}

.legend-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bsg-ink-2);
  margin: 0 0 var(--bsg-s1) 0;
}

.legend-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Base swatch — 16×16 box mirroring the board's cell appearance */
.sw {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: var(--bsg-r-sm);
  background: var(--bsg-cell);
  position: relative;
  display: grid;
  place-items: center;
}

.sw-icon {
  font-size: 10px;
  line-height: 1;
  color: var(--bsg-accent);
  font-weight: 800;
}

/* Selectable: dashed accent outline + selectable fill tint */
.sw-selectable {
  outline: 2px dashed var(--bsg-accent);
  outline-offset: 1px;
  background: var(--bsg-selectable);
}

/* Selected: solid accent outline + selected fill */
.sw-selected {
  outline: 2px solid var(--bsg-accent);
  outline-offset: 1px;
  background: var(--bsg-selectable);
}

/* Drop target: dotted accent-2 outline + droptarget background */
.sw-drop {
  outline: 1px dotted var(--bsg-accent-2);
  outline-offset: 1px;
  background: var(--bsg-droptarget);
}

/* Disabled: faded + diagonal-stripe hatch pattern (var tokens only — A11Y lint) */
.sw-disabled {
  opacity: 0.4;
  background: repeating-linear-gradient(
    45deg,
    var(--bsg-cell),
    var(--bsg-cell) 3px,
    transparent 3px,
    transparent 6px
  );
  outline: 1px solid var(--bsg-line);
  outline-offset: 1px;
}

/* Active player: accent ring + pulsing indicator dot */
.sw-active {
  outline: 2px solid var(--bsg-accent);
  outline-offset: 1px;
  background: color-mix(in srgb, var(--bsg-accent) 12%, transparent);
}

.sw-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bsg-accent);
  flex: none;
}

.legend-label {
  color: var(--bsg-ink-2);
  line-height: 1.4;
}

.legend-label b {
  color: var(--bsg-ink);
  font-weight: 600;
}
</style>
