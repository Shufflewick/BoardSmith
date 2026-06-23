/**
 * GameShell init-message theme receiver helpers — Phase 98, Plan 04
 *
 * Extracted as a pure helper so it can be unit-tested without mounting
 * the full GameShell Vue component. GameShell.vue imports and calls
 * consumeInitMessage directly.
 *
 * TOKEN-05: applyTheme() is the sole theming knob. The host page delivers a
 * partial --bsg-* override map in the iframe `init` postMessage; we consume it
 * here. The host-side SEND is HOST-02 (out of scope for this plan).
 */

import type { applyTheme as ApplyThemeFn } from '../theme.js';

export interface InitMessageData {
  type: 'init';
  seat: number;
  theme?: Record<string, string>;
  scheme?: 'light' | 'dark' | 'auto';
  [key: string]: unknown;
}

export interface InitDeps {
  applyTheme: typeof ApplyThemeFn;
}

/**
 * Consume an `init` postMessage from the host page.
 *
 * Called on every `init` event. Always calls `applyTheme()` at minimum so
 * the Slate base token <style> is idempotently present. If `data.theme` is a
 * non-null object, passes it as an override; if `data.scheme` is present,
 * forwards it as the scheme option. applyTheme enforces the --bsg-* key
 * allowlist, so no extra validation is needed here (T-98-04).
 */
export function consumeInitMessage(data: InitMessageData, deps: InitDeps): void {
  const { applyTheme } = deps;
  const overrides = data.theme && typeof data.theme === 'object' ? data.theme : undefined;
  const scheme = data.scheme as 'light' | 'dark' | 'auto' | undefined;
  applyTheme(overrides, scheme ? { scheme } : undefined);
}
