/**
 * Where the zoom-preview overlay finds a component to draw a die.
 *
 * This module exists to keep three.js out of games that have no dice, and the
 * ONLY thing that makes that work is that this file imports nothing. It must
 * never import Die3D.vue, `three`, or anything that reaches them — the moment it
 * does, every game is back to shipping a WebGL renderer it never uses.
 *
 * The problem it solves: GameShell always renders ZoomPreviewOverlay, and that
 * overlay can preview a die. When it referenced Die3D directly, that reference
 * was live in every game's module graph, so Rollup emitted the ~500 kB three.js
 * chunk into all 14 example games — 12 of which have no dice at all. It was
 * lazily fetched, so no player ever downloaded it, but it sat in every published
 * package.
 *
 * The fix is the same shape as the UI registry: elimination has to come from a
 * module never entering the graph, not from a runtime flag. So `boardsmith/ui/dice`
 * calls `setDiePreviewComponent()` as a side effect of being imported, and a game
 * that renders dice already imports it to get Die3D. Nothing extra to declare, and
 * nothing to forget — if you render dice, you imported the module; if you never
 * do, the module and three.js are simply absent.
 */
import type { Component } from 'vue';

let diePreviewComponent: Component | null = null;

/**
 * Called by `boardsmith/ui/dice` on import. Not part of the public API — games
 * get this by importing the dice module, never by calling this directly.
 */
export function setDiePreviewComponent(component: Component): void {
  diePreviewComponent = component;
}

/**
 * The registered die renderer, or null when this bundle contains no dice support.
 * Callers must handle null: it is the normal state for a game without dice.
 */
export function getDiePreviewComponent(): Component | null {
  return diePreviewComponent;
}
