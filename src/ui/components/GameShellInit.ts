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
 * Returns true if `origin` is allowed to send postMessages to this iframe.
 *
 * When `trustedOrigins` is a non-empty array only listed origins pass — this
 * is the primary security control for the theme-injection path (T-98-04).
 * When `trustedOrigins` is undefined or empty, all origins pass so the
 * existing embed flow is unbroken; the host locks this down via HOST-02.
 *
 * Use event.origin (browser-enforced) not data.source (sender-controlled).
 */
export function isOriginAllowed(origin: string, trustedOrigins: string[] | undefined): boolean {
  if (!trustedOrigins || trustedOrigins.length === 0) return true;
  return trustedOrigins.includes(origin);
}

/**
 * Consume an `init` postMessage from the host page.
 *
 * Called on every `init` event. Always calls `applyTheme()` at minimum so
 * the Slate base token <style> is idempotently present. If `data.theme` is a
 * non-null object, passes it as an override; if `data.scheme` is present,
 * forwards it as the scheme option.
 *
 * applyTheme enforces the --bsg-* key allowlist (prevents unknown CSS
 * property names) but does NOT prevent an attacker from overriding legitimate
 * tokens with attacker-chosen values. Origin validation in the GameShell
 * postMessage handler (trustedOrigins prop) is the primary security control
 * for this path. This function trusts that the caller has already verified
 * the message origin.
 */
export function consumeInitMessage(data: InitMessageData, deps: InitDeps): void {
  const { applyTheme } = deps;
  const overrides = data.theme && typeof data.theme === 'object' ? data.theme : undefined;
  const scheme = data.scheme as 'light' | 'dark' | 'auto' | undefined;
  applyTheme(overrides, scheme ? { scheme } : undefined);
}
