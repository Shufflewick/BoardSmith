/**
 * BoardSmith Slate Token Engine
 *
 * Single source of truth for all --bsg-* CSS custom properties.
 * Emits the full Slate dark/light token set and provides `applyTheme()`
 * as the sole host-overridable theming knob.
 *
 * COLOR LITERALS ARE ALLOWED ONLY IN THIS FILE.
 * All other source files must reference var(--bsg-*) tokens.
 */

// ---------------------------------------------------------------------------
// Responsive breakpoints — single source of truth (px).
//
// CSS @media / @container conditions cannot read CSS custom properties, so these
// live as a TS constant for JS-side consumers (matchMedia, ResizeObserver math).
// Keep the .vue @media literals aligned to these tiers:
//   compact ≤639px · medium 640–1023px · wide ≥1024px (board centers at wide).
// ---------------------------------------------------------------------------
export const BREAKPOINTS = {
  /** Phone ceiling — below this is the compact tier. */
  compact: 640,
  /** Tablet ceiling — at/above this is the wide/desktop tier. */
  medium: 1024,
  /** Wide threshold — board gains a centered max-width cap from here up. */
  wide: 1440,
} as const;

// ---------------------------------------------------------------------------
// Seat palette — single source of truth for seat color values
// Muted (~30% desaturated), colorblind-aware, harmonious on the graphite ground
// ---------------------------------------------------------------------------
export const SEAT_PALETTE: readonly string[] = [
  '#b5544e', // desaturated red
  '#5a7fa8', // slate-blue
  '#6f9e74', // sage
  '#c79a4b', // amber
  '#9a6f9b', // plum
  '#4fa39a', // teal
] as const;

// Named destructure keeps SEAT_PALETTE as the single value source while making
// the token names literal in the source (grep-verifiable per acceptance criteria).
const [p1, p2, p3, p4, p5, p6] = SEAT_PALETTE;
const seatTokens = [
  `  --bsg-seat-1: ${p1};`,
  `  --bsg-seat-2: ${p2};`,
  `  --bsg-seat-3: ${p3};`,
  `  --bsg-seat-4: ${p4};`,
  `  --bsg-seat-5: ${p5};`,
  `  --bsg-seat-6: ${p6};`,
].join('\n');

// ---------------------------------------------------------------------------
// Dark color tokens (default / :root)
// VALUES PINNED FROM 98-CONTEXT.md — do not re-derive
// ---------------------------------------------------------------------------
const DARK_COLOR_TOKENS = `
  --bsg-bg: #121417;
  --bsg-bg-2: #171a1e;
  --bsg-surface: #1c2026;
  --bsg-surface-2: #232831;
  --bsg-surface-3: #2b313b;
  --bsg-line: rgba(255,255,255,.085);
  --bsg-line-2: rgba(255,255,255,.17);
  --bsg-ink: #e8ebef;
  --bsg-ink-2: #99a3af;
  --bsg-ink-3: #69727d;
  --bsg-field: rgba(255,255,255,.04);
  --bsg-accent: #1fb8a6;
  --bsg-accent-2: #5fe6d6;
  --bsg-accent-ink: #04211d;
  --bsg-danger: #ef7a5f;
  --bsg-ok: #54cf9c;
  --bsg-warn: #e6b450;
  --bsg-away: #8a939b;
  --bsg-cell: rgba(255,255,255,.035);
  --bsg-cell-line: rgba(255,255,255,.07);
  --bsg-shadow: 0 8px 30px rgba(0,0,0,.45);
  --bsg-shadow-sm: 0 2px 10px rgba(0,0,0,.4);`.trimStart();

// ---------------------------------------------------------------------------
// Light color tokens
// VALUES PINNED FROM 98-CONTEXT.md — do not re-derive
// ---------------------------------------------------------------------------
const LIGHT_COLOR_TOKENS = `
  --bsg-bg: #f3f2ef;
  --bsg-bg-2: #eae8e4;
  --bsg-surface: #ffffff;
  --bsg-surface-2: #f7f6f3;
  --bsg-surface-3: #edeae5;
  --bsg-line: rgba(22,27,32,.10);
  --bsg-line-2: rgba(22,27,32,.20);
  --bsg-ink: #191e24;
  --bsg-ink-2: #566069;
  --bsg-ink-3: #8a939b;
  --bsg-field: rgba(22,27,32,.035);
  --bsg-accent: #0d9488;
  --bsg-accent-2: #0f766e;
  --bsg-accent-ink: #ffffff;
  --bsg-danger: #c2492f;
  --bsg-ok: #1c8a5a;
  --bsg-warn: #8c6318;
  --bsg-away: #9aa1a8;
  --bsg-cell: rgba(22,27,32,.025);
  --bsg-cell-line: rgba(22,27,32,.10);
  --bsg-shadow: 0 10px 34px rgba(22,27,32,.14);
  --bsg-shadow-sm: 0 2px 10px rgba(22,27,32,.10);`.trimStart();

// ---------------------------------------------------------------------------
// Non-color tokens — theme-independent, live once in :root
// ---------------------------------------------------------------------------
const STATIC_TOKENS = `
  /* Radius */
  --bsg-r-sm: 7px;
  --bsg-r-md: 11px;
  --bsg-r-lg: 16px;
  --bsg-r-pill: 999px;

  /* Spacing */
  --bsg-s1: 4px;
  --bsg-s2: 8px;
  --bsg-s3: 12px;
  --bsg-s4: 16px;
  --bsg-s5: 24px;
  --bsg-s6: 32px;

  /* Fonts — family tokens only; @font-face loading is the host's responsibility */
  --bsg-font: 'Hanken Grotesk', system-ui, sans-serif;
  --bsg-display: 'Hanken Grotesk', system-ui, sans-serif;
  --bsg-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Layout */
  --bsg-rail: 64px;
  --bsg-side: 286px;

  /* Board element natural sizes. Boards render at these intrinsic sizes (NOT fit to
     the viewport); the board area scrolls when larger, and zoom multiplies them.
     Games/themes can override per board. */
  --bsg-cell: 64px;     /* grid/space cell edge */
  --bsg-card-w: 72px;   /* hand/deck card width (height via aspect-ratio) */

  /* Type scale (1.25 ratio, 16px body) */
  --bsg-text-xs: .75rem;
  --bsg-text-sm: .875rem;
  --bsg-text-base: 1rem;
  --bsg-text-lg: 1.25rem;
  --bsg-text-xl: 1.5625rem;
  --bsg-text-2xl: 1.95rem;
  --bsg-line-tight: 1.2;
  --bsg-line-normal: 1.5;

  /* Motion */
  --bsg-dur-fast: 120ms;
  --bsg-dur-base: 200ms;
  --bsg-dur-slow: 360ms;
  --bsg-ease: cubic-bezier(.2,0,0,1);

  /* Interaction — derived via color-mix on accent so they auto-adapt per scheme */
  --bsg-selectable: color-mix(in srgb, var(--bsg-accent) 14%, transparent);
  --bsg-selected: var(--bsg-accent);
  --bsg-droptarget: color-mix(in srgb, var(--bsg-accent) 12%, transparent);
  --bsg-droptarget-hover: color-mix(in srgb, var(--bsg-accent) 24%, transparent);
  --bsg-ring: 0 0 0 2px var(--bsg-accent);
  --bsg-elevation: var(--bsg-shadow-sm);

  /* Drag / drop tokens — defaults registered here; Phase 99 sweep references them */
  --bsg-draggable-cursor: grab;
  --bsg-dragging-cursor: grabbing;
  --bsg-dragging-opacity: .5;
  --bsg-dragging-scale: .95;
  --bsg-droptarget-border: 1px solid color-mix(in srgb, var(--bsg-accent) 40%, transparent);
  --bsg-droptarget-shadow: 0 0 0 1px color-mix(in srgb, var(--bsg-accent) 20%, transparent);
  --bsg-droptarget-hover-border: 1px solid var(--bsg-accent);
  --bsg-droptarget-hover-shadow: 0 0 0 2px color-mix(in srgb, var(--bsg-accent) 30%, transparent);
  --bsg-droptarget-hover-scale: 1.02;
  --bsg-drag-transition: all var(--bsg-dur-base) var(--bsg-ease);

  /* Card back — composite surface token; consumers apply border separately */
  --bsg-card-back: linear-gradient(180deg, var(--bsg-surface-2), var(--bsg-bg-2));

  /* Seat colors — emitted from SEAT_PALETTE (single source of truth) */
${seatTokens}`.trimStart();

// ---------------------------------------------------------------------------
// Full token CSS — four blocks
// ---------------------------------------------------------------------------
export const themeCSS = `
/* BoardSmith Slate token defaults */
:root {
  ${DARK_COLOR_TOKENS.split('\n').join('\n  ')}

  ${STATIC_TOKENS.split('\n').join('\n  ')}
}

/* OS light mode — applies when host has not pinned a scheme */
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    ${LIGHT_COLOR_TOKENS.split('\n').join('\n    ')}
  }
}

/* Host-forced light */
html[data-theme="light"] {
  ${LIGHT_COLOR_TOKENS.split('\n').join('\n  ')}
}

/* Host-forced dark — re-asserts dark so a light-OS host can force dark */
html[data-theme="dark"] {
  ${DARK_COLOR_TOKENS.split('\n').join('\n  ')}
}
`.trim();

// ---------------------------------------------------------------------------
// applyTheme — sole host-overridable theming knob
//
// Security: only writes keys matching /^--bsg-[a-z0-9-]+$/ to prevent
// a malicious host (postMessage init.theme) from injecting arbitrary CSS.
// ---------------------------------------------------------------------------
const BSG_KEY_RE = /^--bsg-[a-z0-9-]+$/;

export function applyTheme(
  overrides?: Record<string, string>,
  options?: { scheme?: 'light' | 'dark' | 'auto' },
): void {
  // Guard for SSR / non-DOM environments
  if (typeof document === 'undefined') return;

  // (a) Idempotently inject base token CSS once
  const STYLE_ID = 'bsg-tokens';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = themeCSS;
    document.head.appendChild(style);
  }

  // (b) Scheme forcing — 'light'/'dark' sets data-theme; 'auto' removes it
  const html = document.documentElement;
  if (options?.scheme === 'light' || options?.scheme === 'dark') {
    html.setAttribute('data-theme', options.scheme);
  } else if (options?.scheme === 'auto') {
    html.removeAttribute('data-theme');
  }

  // (c) Write token overrides — only --bsg-* keys with string values
  if (overrides) {
    const root = html;
    for (const [key, value] of Object.entries(overrides)) {
      if (BSG_KEY_RE.test(key) && typeof value === 'string') {
        root.style.setProperty(key, value);
      }
      // Non-bsg keys are silently ignored (host→iframe injection guard)
    }
  }
}
