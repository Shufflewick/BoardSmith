# BoardSmith + ShufflewickPub UI Redesign — Design Spec

> Adversarial UI/UX audit of the **standard BoardSmith chrome** (not individual games) and the **ShufflewickPub** host skin. Approach: **greenfield-ideal first, then map back** to current code.
> Generated 2026-06-22 by a 48-agent adversarial workflow (20 critics × red-team verification × synthesis). **Analysis only — no code changes.**

## Status & Scope

- **Deliverable:** this spec + prioritized roadmap. Generating candidate UI mockups for review is the explicit next step.
- **Core tension:** BoardSmith chrome is hardcoded **neon-noir** (`#1a1a2e→#16213e`, cyan `#00d9ff` + lime `#00ff88`, gradient clip-text, glow shadows). ShufflewickPub is **warm tavern** (`#12100d` brown, gold `#d7b06a`, Cinzel + Source Sans 3, grain). The chrome must become cozy/warm and get **out of the game’s way** so the board is the hero.

## ✅ Go-Forward Design (chosen 2026-06-22)

After exploring **five distinct directions** (Hearth / Slate / Tabletop / Press / Linen, each with light+dark), the selected go-forward chrome is:

> **`planning/mockups/boardsmith-chrome.html`** — the "Slate" direction: a **neutral graphite palette** (warm-gray light mode / true-graphite dark) with thin borders, a single restrained teal accent, Hanken Grotesk + JetBrains Mono. It is the canonical reference for the chrome redesign.

**Palette note / deliberate override of this spec's default:** the audit recommended a *warm tavern* palette for the chrome. The product owner chose the **neutral** Slate palette instead — it's the most neutral/elegant and reads as professional rather than themed. Crucially, **tavern theming belongs to the ShufflewickPub host, not to the game chrome**, which must stay generic and game-agnostic. So the go-forward design keeps every *structural/behavioral* value of this audit but swaps the warm color values for neutral ones (still a single token namespace, no hardcoded neon).

**How the go-forward design satisfies this audit:**
- **One token system, no hardcoded neon** (§ Design Language) — single namespace, all color via vars.
- **Board is the hero / chrome out of the way** (§ IA) — no top bar; the Shufflewick host button + `⋯` controls menu sit *above the player panel*; ~zero board padding; collapsible player rail.
- **Full-width action panel** that grows vertically (one line → caps ~5 rows → vertical scroll, never horizontal).
- **Turn status = active player's icon (shape+color+letter) + a natural status sentence** (no "your turn"); player panel is a **dynamic per-player status bar**; per-player connection icons.
- **Player identity = color + letter-holding shape**, scales 4→16, demonstrated with the Sam/Sally initial collision.
- **Interaction states unmistakable** across border+fill+elevation+scale+icon, colorblind-safe, with a legend.
- **Accessibility (§ Accessibility Plan):** keyboard-operable board (roving-tabindex grid, arrow/Home/End nav, Enter/Space activate — fixes critical **C-1**); `main`/`aside`/`region` landmarks + skip link + `h1`; `aria-label`s on icon controls, decorative glyphs `aria-hidden`; polite + assertive live regions; per-cell `aria-label` + `aria-selected`; visible `:focus-visible` ring; `prefers-reduced-motion` gate; follows OS light/dark by default.
- **Responsive:** phone defaults to the rail; expanding overlays the **board only** (never the action bar) with a dismiss scrim.

**Still to build for full coverage** (the play view is done; these are the remaining sub-views): phone portrait, Game Over result card, dev-server chrome (with the dropdown UI-switcher), and a standalone token sheet — all in the Slate language.

## Findings Summary

**171 verified findings** — 🔴 5 critical · 🟠 33 high · 🟡 74 medium · ⚪ 59 low

Top findings (highest severity first):

| Sev | Surface | Lens | Finding |
|---|---|---|---|
| 🔴 Critical | shell | a11y | When all choices are board-anchored the action panel is removed, leaving keyboard/SR users no operable control |
| 🔴 Critical | shell | visual | Entire shell is hardcoded neon-noir (#1a1a2e→#16213e + white text), the polar opposite of the warm tavern |
| 🔴 Critical | shell | visual | theme.ts --bsg-* token system is fully built but consumed by ZERO chrome components (pit-of-failure) |
| 🔴 Critical | board | a11y | The entire auto-generated board is mouse-only — zero keyboard operability across every renderer |
| 🔴 Critical | board | visual | theme.ts (--bsg-*) token system is entirely dead code; no renderer or panel consumes it |
| 🟠 High | shell | usability | When the board offers clickable picks the entire action panel vanishes, leaving NO prompt telling the player to click the board |
| 🟠 High | shell | usability | Selection and action failures are swallowed to console.error — the player sees nothing when a move is rejected |
| 🟠 High | shell | a11y | Turn changes, game state, and history are never announced — the game is silent to screen readers |
| 🟠 High | shell | a11y | No visible focus indicator anywhere — focus is invisible to keyboard users, and some inputs explicitly remove the outline |
| 🟠 High | shell | a11y | Icon-only controls (hamburger, ✕ close/cancel/clear) have no accessible name and rely on title or glyph text |
| 🟠 High | shell | a11y | Hamburger drawer is a modal without dialog semantics, focus trap, or Escape-to-close |
| 🟠 High | shell | visual | The most prominent interactive element — the primary action button — is bright neon with a cyan glow |
| 🟠 High | shell | visual | Type system is system-ui only with neon gradient clip-text titles — no warmth, no tavern voice |
| 🟠 High | shell | chrome | Full header bar is always rendered in platform mode, stacking a third chrome layer on top of the host's own nav |
| 🟠 High | shell | chrome | Mobile sidebar steals up to 40vh BELOW the board, squeezing the hero into ~half the phone screen |
| 🟠 High | dev | visual | Entire dev chrome is cold indigo/neon — the opposite of the warm tavern |
| 🟠 High | dev | visual | Neon cyan #00d9ff and electric green #2ecc71 accents clash with gold/bronze |
| 🟠 High | board | usability | Game Over is a literal dead-end: no winner, no score, no next action |

---

# Part I — Redesign Specification

## Unified Design Language & Token System (neon → cozy tavern)

### 1. The single source of truth

Today there are **four** disconnected palettes fighting each other:

1. BoardSmith chrome's hardcoded neon-noir (`#1a1a2e`→`#16213e`, `#00d9ff`, `#00ff88`) — inlined in ~8 chrome files and ~30+ times in `ActionPanel.vue` alone.
2. `theme.ts`'s exported-but-dead `--bsg-*` API, whose defaults are a *third* unrelated direction — a light blue scheme (`backgroundColor:'#f5f5f5'`, `textColor:'#1a1a2e'`, `primaryColor:'#4a90d9'`, `theme.ts:22-29`). A grep of `var(--bsg` across `src/ui` returns **zero** matches.
3. The renderers' separate `--bs-*` namespace (`HandRenderer.vue:431 var(--bs-drop-target-bg, ...)`) — wired to neither of the above.
4. ShufflewickPub's tavern tokens in `main.css` plus the PrimeVue `Lara` defaults that the lobby's `surface-*` utilities still resolve to.

**The greenfield rule: one prefix, one file, tavern defaults, no raw hex.** Every color, font, space, radius, shadow, and duration the chrome consumes is a `--bsg-*` variable emitted by `theme.ts`. `theme.ts` is the *only* place literals live. The host overrides the palette exactly once, at iframe init, by passing its tavern values into `applyTheme`. A stylelint `color-no-hex` rule scoped to chrome `.vue` files makes the wrong path (a raw hex) literally fail lint — pit of success.

This collapses findings about dead `--bsg-*`, the `--bs-*` split, the `ActionPanel` light-fallback third namespace (`--bg-secondary, #f5f5f5`), and the DevHost literals into one contract.

### 2. Color palette

Warm, candlelit, low-saturation. **No neon, no glow-bloom, no clip-text.** State colors are warm-tuned, not stoplight-bright.

| Role | Token | Value | Replaces |
|---|---|---|---|
| Base canvas (deepest) | `--bsg-bg` | `#0d0c09` | noir `#1a1a2e` |
| Surface (raised panel) | `--bsg-surface` | `rgba(20,16,10,0.55)` | `rgba(0,0,0,0.3)` glass |
| Surface (solid/bar) | `--bsg-surface-solid` | `#12100d` | `rgba(0,0,0,0.85)` |
| Surface raised (zones) | `--bsg-surface-raised` | `rgba(247,240,222,0.04)` | `rgba(255,255,255,0.05)` |
| Ink (primary text) | `--bsg-text` | `#f7f0de` | `#fff` |
| Ink muted | `--bsg-text-muted` | `#c9bfa6` | `#888`/`#ccc`/`#aaa` |
| Hairline / edge | `--bsg-edge` | `rgba(215,176,106,0.18)` | `rgba(255,255,255,0.1)` |
| Accent (brass) | `--bsg-accent` | `#d7b06a` | `#00d9ff` |
| Accent strong (gold leaf) | `--bsg-accent-strong` | `#f1c879` | `#00ff88` |
| Accent ink (label on gold) | `--bsg-accent-ink` | `#221d15` | `#1a1a2e` |
| Selectable (affordance) | `--bsg-selectable` | `rgba(215,176,106,0.45)` | cyan `#00d9ff` |
| Selected (committed) | `--bsg-selected` | `#f1c879` | lime `#00ff88` |
| Drop target | `--bsg-drop-target` | `rgba(215,176,106,0.15)` | `--bs-drop-target-bg rgba(0,255,136,0.15)` |
| Success / online | `--bsg-success` | `#7cbc8a` | `#2ecc71` |
| Warning | `--bsg-warn` | `#d99a52` | `#f59e0b` |
| Danger | `--bsg-danger` | `#c75d52` | raw red |

**Seat palette** (move `PLAYER_COLOR_CYCLE` out of `HexBoardRenderer.vue:108-114` — the "Flat UI 2014" swatches — into `theme.ts`, desaturated ~30% so seats don't vibrate against the candlelit ground):

```
--bsg-seat-1: #a8504a;  /* mulled-wine red */
--bsg-seat-2: #6f86a3;  /* slate blue */
--bsg-seat-3: #7c9b6e;  /* sage */
--bsg-seat-4: #c79a4e;  /* brass */
--bsg-seat-5: #8a6d8f;  /* plum */
--bsg-seat-6: #5f9b95;  /* muted teal */
```

`Piece`/`Hex`/`DebugPanel` all import this one array. **Default card back** (`CardRenderer.vue:547`/`HandRenderer.vue:554` corporate-blue gradient) becomes one shared tokenized class: deep oxblood felt `--bsg-card-back: radial-gradient(circle at 50% 40%, #3a2418, #241208)` with a `1px solid var(--bsg-accent)` gold rule.

### 3. Type pairing

The chrome is mono-`system-ui` with neon gradient clip-text titles (`GameHeader.vue:115-120`, `HamburgerMenu.vue:230-233`) — zero tavern voice. Adopt the host's pairing. **Cinzel never renders as gradient clip-text** — it's solid burnished gold with a faint carved shadow.

```
--bsg-font-display: "Cinzel", Georgia, serif;        /* titles, game name, zone signage */
--bsg-font-body:    "Source Sans 3", system-ui, sans-serif;  /* everything else */
--bsg-font-mono:    "Monaco", "Menlo", monospace;    /* debug data only */
```

Title carve treatment (replaces both clip-text blocks): `color: var(--bsg-accent); text-shadow: 0 1px 0 rgba(0,0,0,0.5); letter-spacing: 0.02em;`

**Type scale** (1.25 ratio, body anchored at 16px):

| Token | px / rem | Use |
|---|---|---|
| `--bsg-text-xs` | 12px / 0.75rem | counts, badges, captions |
| `--bsg-text-sm` | 14px / 0.875rem | secondary labels, history |
| `--bsg-text-base` | 16px / 1rem | body, action labels |
| `--bsg-text-lg` | 20px / 1.25rem | panel headers |
| `--bsg-text-xl` | 25px / 1.5625rem | game title in menu |
| `--bsg-text-2xl` | 31px / 1.95rem | victory / "Last Call" flourish |
| `--bsg-line-tight` | 1.2 | display | 
| `--bsg-line-normal` | 1.5 | body |

The host already loads Cinzel + Source Sans 3, so the iframe reuses them with zero added network cost.

### 4. Spacing scale

There is **no** spacing system anywhere — `theme.ts` tokenizes only color. Observed literals span `2,4,5,6,8,10,12,14,15,16,20,24,30,32,40px` plus `30vh`/`50px` (`TableauTemplate.vue:54 gap:32px` is 4× `GridBoardTemplate`'s 8px). The host is just as ad-hoc (`0.42rem`, `0.55rem`, `0.84rem`, `0.95rem`).

**One 4px-based scale**, shared by engine and host. Stylelint bans raw px on `padding`/`gap`/`margin` in chrome files.

```
--bsg-space-0: 0;
--bsg-space-1: 4px;
--bsg-space-2: 8px;
--bsg-space-3: 12px;
--bsg-space-4: 16px;
--bsg-space-5: 24px;
--bsg-space-6: 32px;
--bsg-density: 1;        /* host sets 0.75 phone / 1 tablet / 1 desktop */
--bsg-gutter: calc(var(--bsg-space-4) * var(--bsg-density));
```

Radii and the bar height also get tokens (the host's `0.84rem`/`0.55rem` round here):

```
--bsg-radius-sm: 6px;
--bsg-radius-md: 10px;
--bsg-radius-lg: 14px;
--bsg-bar-h: 44px;       /* min touch target, caps mobile chrome height */
```

The host mirrors the same scale in `rem` (`--space-1:0.25rem … --space-6:1.5rem`) so dev, host, and embedded game breathe one rhythm. Breakpoints become tokens too, aligned across both repos (the host currently invents `960/880/640`, the engine uses a lone `768`): **`640 / 768 / 1024 / 1440`**.

### 5. Depth, shadow, texture, grain

The chrome is flat translucent-black glass with cold blur — modern fintech glassmorphism (`GameShell.vue:1557 rgba(0,0,0,0.85); backdrop-filter: blur(10px)`). The board is flat translucent-*white* veil cards with `1px` white hairlines. Replace cold glass with **"parchment under candlelight"**: warm semi-opaque panels, warm-gold hairlines, soft warm shadows — and kill every colored glow.

```
/* warm elevation — NO colored bloom */
--bsg-shadow-sm: 0 1px 3px rgba(0,0,0,0.35);
--bsg-shadow-md: 0 2px 10px rgba(0,0,0,0.45);
--bsg-shadow-press: inset 0 1px 0 rgba(241,200,121,0.25);  /* pressed-brass highlight */

/* selection emphasis = warm rim, not a halo */
--bsg-ring: 0 0 0 1px rgba(215,176,106,0.5);
--bsg-ring-strong: 0 0 0 2px var(--bsg-selected);

/* material */
--bsg-grain-opacity: 0.16;
--bsg-grain: url("data:image/svg+xml,...fractalNoise...");  /* host-shared, NOT a white dot-grid */
--bsg-glow-warm: 0 0 6px rgba(241,200,121,0.4);  /* candle-flame cue ONLY for active-turn dot */
```

This retires the `0 0 8px rgba(0,217,255,.6)` glows in `PieceRenderer.vue:242`, `CardRenderer.vue:429`, `HandRenderer.vue:408`, `DeckRenderer.vue:192`, and the pulsing `pulse-glow` in `PlayersPanel.vue:101-119`. The active-player dot becomes a small amber dot with `--bsg-glow-warm` and an opacity-only breathe (§6), not a scaling neon halo. Texture note for the host side: the grain SVG replaces `main.css:131-139`'s regular 4px white speckle (reads as TV static), and a third candle radial should sit **low/center** — taverns are lit from table candles, not the two top-corner radials at `circle at 9% 12%` / `92% 6%`.

The **primary action button** — the loudest object on screen (`ActionPanel.vue:1103-1118` cyan→lime + cyan drop-glow) — becomes a pressed brass plate:

```css
.action-btn {
  background: linear-gradient(180deg, var(--bsg-accent-strong), var(--bsg-accent));
  color: var(--bsg-accent-ink);
  font-family: var(--bsg-font-display);
  box-shadow: var(--bsg-shadow-md), var(--bsg-shadow-press);
}
.action-btn:hover { transform: translateY(-1px); box-shadow: var(--bsg-shadow-md); }
```

### 6. Motion language

Replace restless arcade attract-mode (infinite `pulse-glow` scaling) with calm, candle-paced motion. All durations/easings are tokens, and **every** animation is wrapped so `prefers-reduced-motion` zeroes it.

```
--bsg-dur-fast: 120ms;    /* hover, press, toggle */
--bsg-dur-base: 200ms;    /* panel collapse, fades */
--bsg-dur-slow: 360ms;    /* drawer/sheet slide, FLIP */
--bsg-ease: cubic-bezier(0.2, 0, 0, 1);   /* gentle ease-out */
--bsg-breathe: 4s;        /* candle flame, opacity-only, low amplitude */
```

The active-turn cue is the only persistent animation: a 4s opacity breathe between `0.7`→`1.0` (no scale, no colored shadow keyframes). Reduced-motion contract (single global block):

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

This neutralizes the `pulse-glow` infinite loop and any card-flip/drag-drop animation for vestibular-sensitive players while leaving instant state changes intact.

### 7. Canonical token sheet

This is the block `theme.ts` emits as its **default** (tavern), the host overrides accent/bg via `applyTheme` once at init, and the host's `main.css :root` aliases the same names so the two repos cannot diverge.

```css
:root {
  /* ── color ── */
  --bsg-bg:              #0d0c09;
  --bsg-surface:         rgba(20,16,10,0.55);
  --bsg-surface-solid:   #12100d;
  --bsg-surface-raised:  rgba(247,240,222,0.04);
  --bsg-text:            #f7f0de;
  --bsg-text-muted:      #c9bfa6;
  --bsg-edge:            rgba(215,176,106,0.18);

  --bsg-accent:          #d7b06a;
  --bsg-accent-strong:   #f1c879;
  --bsg-accent-ink:      #221d15;

  --bsg-selectable:      rgba(215,176,106,0.45);
  --bsg-selected:        #f1c879;
  --bsg-drop-target:     rgba(215,176,106,0.15);

  --bsg-success:         #7cbc8a;
  --bsg-warn:            #d99a52;
  --bsg-danger:          #c75d52;

  --bsg-card-back:       radial-gradient(circle at 50% 40%, #3a2418, #241208);

  --bsg-seat-1:#a8504a; --bsg-seat-2:#6f86a3; --bsg-seat-3:#7c9b6e;
  --bsg-seat-4:#c79a4e; --bsg-seat-5:#8a6d8f; --bsg-seat-6:#5f9b95;

  /* ── type ── */
  --bsg-font-display: "Cinzel", Georgia, serif;
  --bsg-font-body:    "Source Sans 3", system-ui, sans-serif;
  --bsg-font-mono:    "Monaco","Menlo",monospace;
  --bsg-text-xs:.75rem; --bsg-text-sm:.875rem; --bsg-text-base:1rem;
  --bsg-text-lg:1.25rem; --bsg-text-xl:1.5625rem; --bsg-text-2xl:1.95rem;
  --bsg-line-tight:1.2; --bsg-line-normal:1.5;

  /* ── space / shape ── */
  --bsg-space-0:0;  --bsg-space-1:4px;  --bsg-space-2:8px;  --bsg-space-3:12px;
  --bsg-space-4:16px; --bsg-space-5:24px; --bsg-space-6:32px;
  --bsg-density:1;
  --bsg-gutter: calc(var(--bsg-space-4) * var(--bsg-density));
  --bsg-radius-sm:6px; --bsg-radius-md:10px; --bsg-radius-lg:14px;
  --bsg-bar-h:44px;

  /* ── depth / material ── */
  --bsg-shadow-sm:0 1px 3px rgba(0,0,0,.35);
  --bsg-shadow-md:0 2px 10px rgba(0,0,0,.45);
  --bsg-shadow-press:inset 0 1px 0 rgba(241,200,121,.25);
  --bsg-ring:0 0 0 1px rgba(215,176,106,.5);
  --bsg-ring-strong:0 0 0 2px var(--bsg-selected);
  --bsg-glow-warm:0 0 6px rgba(241,200,121,.4);
  --bsg-grain-opacity:.16;

  /* ── motion ── */
  --bsg-dur-fast:120ms; --bsg-dur-base:200ms; --bsg-dur-slow:360ms;
  --bsg-ease:cubic-bezier(.2,0,0,1); --bsg-breathe:4s;
}
```

### 8. Migration path

| Step | Action | Effort | Evidence anchor |
|---|---|---|---|
| 1 | **Repoint `theme.ts` defaults** from the light-blue `defaultTheme` to the block above; expand it to emit the space/type/shadow/seat tokens (today it emits only color, `theme.ts:38-118`). | M | `theme.ts:22-29` |
| 2 | **Unify prefixes**: rename `--bs-*` drop-target vars to `--bsg-drop-target`/`--bsg-drop-hover` and register defaults in `theme.ts`. | S | `HandRenderer.vue:431`, `GridBoardRenderer.vue:324` |
| 3 | **Mechanical hex sweep** of the 8 chrome files + 8 renderers + `DebugPanel` + `DevHost`: replace literals with `var(--bsg-*)`. Delete the two background gradients (`GameShell.vue:1443`, `HamburgerMenu.vue:193`) → `background: transparent` in platform mode so the host's `#0d0c09` + candle radials show through; `color:#fff` → `var(--bsg-text)`. | L | `ActionPanel.vue:1105,1209,…`; `GameShell.vue:1442-1445` |
| 4 | **Kill clip-text**: delete the gradient title blocks (`GameHeader.vue:115-120`, `HamburgerMenu.vue:230-233`); set `.game-shell` body to `--bsg-font-body`, titles to `--bsg-font-display`. Remove the `BoardSmith Dev Mode` string + neon `BS` chip from player-facing menu (`HamburgerMenu.vue:128,214-225`). | M | as cited |
| 5 | **Delete the `ActionPanel` light-fallback namespace** (`--bg-secondary, #f5f5f5` etc., `ActionPanel.vue:1505-1524`) — fold into `--bsg-surface`/`--bsg-text-muted`. | S | `ActionPanel.vue:1505-1524` |
| 6 | **Host preset**: add `definePreset(Lara, { semantic: { surface: <brown ramp from --bg-1/--panel-soft/--line>, primary: <--accent/--accent-strong> }})` in `nuxt.config.ts` so lobby `surface-*` utilities inherit tavern colors with zero per-element classes. | M | `nuxt.config.ts:37`, `GameLobby.vue:6` |
| 7 | **Theme handshake**: host forwards `theme` + the token map into the iframe init postMessage (`GameFrame.vue:58-64` currently sends only `{seat, playerCount}`); BoardSmith consumes it via `applyTheme`. Add `background: var(--bg-base)` to `.game-stage` so letterbox/loading gaps stay warm. | M | `GameFrame.vue:58-64`, `[sessionId].vue:96-103` |
| 8 | **Enforce**: add stylelint `color-no-hex` scoped to chrome `.vue` files so the wrong path fails CI. | S | — |

Sequencing matters: steps 1–2 are prerequisites for everything; step 3 is the broad-but-mechanical bulk; the host-side 6–7 can land in parallel and only depend on the token *names* existing, not the full sweep. After this, `applyTheme` is the single knob, the host and iframe literally share variables, and a contributor reaching for a raw `#00d9ff` is stopped by lint before it ships.

---

## Information Architecture & Responsive Layout

### 1. Governing principle: the chrome is a thin frame, the board is the room

Today the chrome competes with the game at every turn: a full BoardSmith header stacks under the host's own nav shade (two top bars before the board even starts — `GameShell.vue:1286-1294` renders `<GameHeader>` unconditionally, and the platform CSS only *repacks* it: `GameShell.vue:1462-1476`), a 280px sidebar permanently eats ~21% of a 1440px viewport (`GameShell.vue:1540-1548`), a mobile sidebar steals up to 40vh *below* the board (`GameShell.vue:1517-1526`), and the single most important state — whose turn it is — is signaled only by a 12px pulsing dot that scrolls off-screen on a phone (`PlayersPanel.vue:48`).

The redesign inverts this. There is exactly **one** piece of persistent in-game chrome — a **turn ribbon** — and everything else is summoned on demand. The hard rule:

> Chrome may occupy standing layout space **only** for (a) the turn ribbon and (b) the action dock *when the player has an action*. Everything else (players, history, settings, menu) is a summoned overlay that reserves **0** standing pixels.

This directly fixes the highest-severity IA failures: the vanishing prompt (finding: footer suppressed when all choices are board-anchored, `GameShell.vue:1382-1383`), the invisible turn state, and the box-in-box sidebar tax.

---

### 2. The two standing elements

#### 2.1 Turn ribbon (the one always-on element)

A single, minimal status line that **never disappears**, at every breakpoint, in every mode. It is the source of truth that today's code computes but never renders.

- **Height:** 32px (`--sw-ribbon-h`), sticky to the top of the *game stage* (not the viewport — see §5 on iframe container queries).
- **Content, left→right:** player swatch dot · turn statement · prompt.
  - Turn statement: `Your turn` (warm gold `#f1c879`, weight 600) or `Alice is playing…` (muted `#b9ad93`).
  - Prompt: the active step instruction, sourced from **`boardPrompt ?? actionController.currentPick.prompt`** — a single prompt source of truth. This kills three findings at once: the prompt that vanishes with the panel, the `setBoardPrompt` callback that is wired through every slot but rendered nowhere (`GameShell.vue:472-476`), and the absent "Your turn" affirmative.
- **What it replaces:** the entire `header-center` real estate currently given to a zoom slider + Auto + Undo toggles (`GameHeader.vue:56-88`). Those are engineering controls and move into the settings overflow (§3).
- **Color-keyed** to the active player so peripheral vision tracks turn changes without reading.

The ribbon is the spine of the action-panel↔board sync model (§4).

#### 2.2 Action dock (conditional)

The bottom dock exists **only when the player has something to do**. When it is not your turn, the dock does not render — turn status already lives in the ribbon, so the heavy blurred glass slab that today renders just to say "It is X's turn" (`ActionPanel.vue:1069-1084` wrapped in the sticky footer at `GameShell.vue:1552-1562`) is deleted.

Critically, the dock **never collapses to nothing**. When every remaining pick is board-clickable, the dock collapses to *just the one-line prompt* ("Choose a tile to claim") plus any global actions (Undo) — it does not vanish. The current `v-if="!suppressActionPanel && !allCurrentChoicesAnchored"` (`GameShell.vue:1382`) becomes `v-if="isMyTurn"` with the *buttons* (not the prompt) suppressed when anchored.

Dock geometry:
- `max-height: min(40dvh, 320px)` with `overflow-y: auto`. Today the panel has no cap and grows up over the board (`ActionPanel.vue:1096-1101`, no `max-height`).
- Board reserves the dock's *measured* height via a `--sw-dock-h` CSS var set from a `ResizeObserver`, replacing the hardcoded `padding-bottom: 80px` guess (`GameShell.vue:1496`) — and that padding is double-counted today because the footer is `sticky`, i.e. already in flow.
- `padding-bottom: max(12px, env(safe-area-inset-bottom))` — no chrome edge touches the device edge without consuming the inset.

---

### 3. What stays vs. what collapses — the IA inventory

| Element | Phone (<640) | Tablet (640–1023) | Desktop (≥1024) |
|---|---|---|---|
| **Turn ribbon** | Standing (top, 32px) | Standing | Standing |
| **Action dock** | Bottom sheet, only when acting | Bottom bar, only when acting | Bottom bar, only when acting |
| **Players** | 1-line seat strip; tap → bottom sheet | Sidebar (collapsible) | Sidebar (collapsible to 36px rail) |
| **History** | Tab inside players sheet | Tab/accordion in sidebar | Accordion in sidebar; collapsed by default |
| **Menu (Leave/New Game)** | Host corner tab | Host corner tab | Host corner tab |
| **Settings (zoom-as-a11y, Auto, Undo-visibility)** | Inside menu overflow | Inside menu overflow | Inside menu overflow |
| **Connection state** | Corner dot (real heartbeat) | Corner dot | Corner dot |
| **BoardSmith header bar** | **Never renders in platform mode** | Never | Never |

Rationale anchored to findings: zoom/Auto/Undo are demoted out of the header (engineering controls in the prime slot); the dead `Settings`/`Help` items and `BS`/`Dev Mode` branding are removed from the menu (`HamburgerMenu.vue:55-62, 84, 128`); History `Clear`/`Copy` are dev-only and leave the player roster (`GameHistory.vue:137-150`); in platform mode `<GameHeader>` is gated behind `v-if="!platformMode"` so the host owns all top chrome.

---

### 4. Action-panel ↔ board sync model

Today the only link between the action panel and the board is *color* — and even that is inconsistent (six renderers, one outlier neon-lime `border`, the rest emerald `outline`: `HandRenderer.vue:397-399` vs `CardRenderer.vue:438-440` et al.). The instruction lives far away in the header while the board throbs with no caption (`AutoUI.vue:5-6`). Three mechanisms bind them:

1. **One prompt, two surfaces.** The ribbon prompt and an *optional* on-board caption read from the **same** flow-step prompt. Thread the active prompt into `AutoRenderer` as a `prompt` prop; render a single dismissible caption pill anchored to the focal cluster. The hero gets the instruction; the chrome echoes it.
2. **One actionable token, everywhere.** Define `--bsg-actionable`, `--bsg-selected`, `--bsg-droptarget` once in `theme.ts`; every renderer consumes them via a shared `useSelectionClasses`. Always `outline` (never `border`, which reflows layout by 2px). In the tavern skin this is a warm candle-gold glow (`rgba(241,200,121,.55)`), identical across hand/card/cell/deck/space/piece.
3. **Calm, not a disco.** Replace six infinite 2s `pulse-*` keyframes (`HandRenderer.vue:401`, `CardRenderer.vue:443`, …) with one shared rule: a **static** glow ring for "selectable," motion reserved only for a single *suggested* target, all wrapped in `@media (prefers-reduced-motion: reduce)` → static only. When 12 tiles are valid, 12 static gold rings read as "pick one"; 12 throbbing ones read as noise.

Selection flow is unchanged in direction (board click → `actionController.fill`), but **failures become visible**: replace the three `console.error` swallow sites (`ActionPanel.vue:675-677, 729-731`; `GameShell.vue:482`) with `toast.error(result.error)` and re-enable the panel. The ribbon prompt + visible failure + persistent dock together guarantee the player is never staring at a silent board.

---

### 5. Responsive system: kill the zoom crutch, fit by construction

The current system is **one** breakpoint (`@media (min-width: 768px)`, `GameShell.vue:1529`) plus a manual `0.5×–2×` zoom slider doing the actual fitting (`GameHeader.vue:61-70`, `transform: scale(var(--zoom-level))`). That is a pit of *failure*: wrong usage (fixed 50px cells, `GridBoardRenderer.vue:288`; fixed 60×84 cards with `flex-shrink:0`, `HandRenderer.vue:551`) is made survivable by asking the human to drag a slider every session, and `transform: scale` blurs text and shifts hit targets.

#### 5.1 Named breakpoints (shared host + engine)

Replace the host's three orphan breakpoints (960/880/640, `main.css:501/507/527`) and BoardSmith's lone 768 with one token scale:

```
--sw-bp-compact:  40rem;   /* 640px  — phone ceiling     */
--sw-bp-medium:   64rem;   /* 1024px — tablet ceiling     */
--sw-bp-wide:     90rem;   /* 1440px — desktop→wide       */
```

→ three real tiers: **compact / medium / wide**, plus a board-centering `max-width` at `wide`.

#### 5.2 Container queries, not viewport queries

BoardSmith renders inside the host iframe, so the *viewport* is the wrong unit — the **shell width** is what matters. Every renderer and template reflows on `@container`, not `@media`:

- `.game-stage` (host) and `.game-shell__main` (engine) declare `container-type: size`.
- Board cells size from a single custom property:
  `--cell: clamp(28px, min(calc((100cqw - var(--gutters)) / var(--cols)), calc((100cqh - var(--reserved)) / var(--rows))), 96px)` — width, height, label width, and font-size all expressed in `var(--cell)`. The board fits phone→desktop with zero scrollbars and the `1fr` track finally means something.
- Hands: `--card-w: clamp(44px, 14cqw, 84px)`, height by `aspect-ratio`, overlap derived from `--card-count` so every card keeps a ≥44px exposed tap zone; strip height `clamp(96px, 18vh, 180px)` collapsing to 0 when empty (replaces the `30vh` + 90px-min-on-empty waste, `GridBoardTemplate.vue:128`, `HandRenderer.vue:487`).
- Spacing is fluid from a 4px token scale × `--bsg-density` (0.75 compact / 1 medium / 1 wide): `gap: clamp(6px, 2cqw, 24px)`. This finally gives `theme.ts` the spacing tokens it lacks entirely (it ships color-only).

Zoom survives **only as an accessibility magnifier** (pinch / Ctrl-scroll), never the fit strategy.

#### 5.3 Cross-cutting layout invariants (apply at all tiers)

- **`100dvh`, not `100vh`**, everywhere (the four sites: `GameShell.vue:1441/1451/1483`, `HamburgerMenu.vue:192`; host `main.css:123`, play-page stage) so mobile toolbars never clip the bottom dock.
- **Safe-area insets** as first-class tokens — `--bsg-safe-bottom: env(safe-area-inset-bottom)` etc. baked into the dock, ribbon, hand strip, and host stage; host meta gets `viewport-fit=cover`. Currently `grep safe-area-inset` returns **zero** matches across all of BoardSmith UI and the host app.
- **≥44px touch targets** enforced via a `min-height: 44px` floor on every interactive chrome element (today action buttons are ~38px, the zoom thumb 14px, the hamburger 28×20).
- **Landscape phone** branches on aspect, not width: `@media (orientation: landscape) and (max-height: 600px)` flips to the row layout instead of crushing the board into a sliver under a wide empty sidebar.

---

### 6. Per-device layouts (ASCII wireframes)

**Phone — compact, <640px (platform/embedded), portrait**
```
┌───────────────────────────────┐
│                          ◔ ←── │ host pull-tab, docked TOP-RIGHT corner
│ ● Your turn — Claim a tile     │ turn ribbon, 32px, sticky, ALWAYS on
├───────────────────────────────┤
│                               │
│          B O A R D            │ hero — fits container (cqw/cqh),
│       no scroll, no zoom       │ fills all remaining dvh
│                               │
│                               │
├───────────────────────────────┤
│ ●You  ○Alice  ○Bob   (tap ▴)  │ 1-line seat strip → bottom sheet
├───────────────────────────────┤
│ Choose a tile to claim         │ action dock — ONLY when acting
│ [ Tile A ] [ Tile B ]    [ ⤺ ] │ max 40dvh, scrolls, safe-area padded
└───────────────────────────────┘
   (no standing BoardSmith header; no 40vh sidebar)
```

**Tablet — medium, 640–1023px**
```
┌──────────────────────────────────────────────┐
│ ● Alice is playing… — Draw a card    [⚙]  ◔   │ ribbon + settings + host tab
├────────────────────────────────────┬─────────┤
│                                    │ Players │ sidebar: clamp(220,24vw,300)
│              B O A R D             │ ● You 12│ collapsible
│           fit-to-container         │ ○ Alice9│
│                                    │ ─────── │
│                                    │ History▸│ accordion (collapsed)
├────────────────────────────────────┴─────────┤
│ action dock (full-width, only when acting)     │
└────────────────────────────────────────────────┘
```

**Desktop — wide, ≥1024px (board centered, max-width at ≥1440)**
```
┌─────────────────────────────────────────────────────────┐
│ ● Your turn — Claim a tile               [⚙]   ◔         │ ribbon
├─────────────────────────────────────────────┬───────────┤
│        ┌───────────────────────────┐        │ Players   │
│        │                           │        │ ● You  12 │
│        │        B O A R D          │        │ ○ Alice 9 │ sidebar
│        │   max-width 1100px,       │        │ ───────── │ collapses
│        │   centered, fit, no zoom  │        │ History ▸ │ to 36px rail
│        │                           │        │ …log…     │ ──► [ » ]
│        └───────────────────────────┘        │           │
├─────────────────────────────────────────────┴───────────┤
│ Choose a tile to claim    [ Tile A ][ Tile B ]   [ Undo ]│ dock, when acting
└─────────────────────────────────────────────────────────┘
```

Note across all three: the host pull-tab moves **off top-center** to a corner (`◔`), since top-center is where boards put their own turn/score banners — today the fixed 40px sign permanently occludes that prime real estate (`main.css:259-271`).

---

### 7. Migration path (mapping to current code)

| Step | Change | Files / evidence | Effort |
|---|---|---|---|
| 1 | Gate `<GameHeader>` behind `v-if="!platformMode"`; render a corner connection dot | `GameShell.vue:1286-1294, 1462-1476` | M |
| 2 | Add **turn ribbon** driven by `boardPrompt ?? currentPick.prompt` + `currentPlayerName`/`isMyTurn`/`currentPlayerColor` (all already computed) | `GameShell.vue:472-476`; `ActionPanel.vue:1024-1028` | M |
| 3 | Change dock `v-if` to `isMyTurn`; suppress *buttons* not *prompt* when `allChoicesAnchored`; add `max-height`+scroll + `--sw-dock-h` ResizeObserver; drop the double `padding-bottom` | `GameShell.vue:1382, 1496, 1552-1562`; `ActionPanel.vue:1096` | M |
| 4 | Replace `console.error` swallows with `toast.error`; replace `alert()` calls | `ActionPanel.vue:675-677, 729-731`; `GameShell.vue:482, 755, 908, 939, 944, 825` | S |
| 5 | Define breakpoint + spacing + density + safe-area + selection-state **tokens** in `theme.ts` (today color-only) | `theme.ts:22-118` | M |
| 6 | Add `container-type` + `--cell`/`--card-w` clamp math to renderers/templates; delete fixed 50px/60×84 and the `30vh` magics | `GridBoardRenderer.vue:288`, `HandRenderer.vue:551`, `GridBoardTemplate.vue:128` | L |
| 7 | Demote zoom slider to an a11y control in settings; move Auto/Undo-visibility into menu; delete the `showUndo` toggle | `GameHeader.vue:56-88, 61-70`; `HamburgerMenu.vue:55-62` | M |
| 8 | Mobile: players → seat strip + bottom sheet (History as a tab); desktop: whole-sidebar collapse to rail | `GameShell.vue:1517-1526, 1540-1548`; reuse `GameHistory` collapse pattern | M |
| 9 | `100vh`→`100dvh`; add `env(safe-area-inset-*)`; enforce 44px floors; add landscape-aspect branch; align host breakpoints to the shared scale | shell + host (`main.css:123, 501/507/527`) | M |

Sequencing: **5 → 1/2/3/4** (token foundation, then the ribbon/dock IA that depends on it), then **6/8/9** (responsive fit), with **7** retiring the zoom crutch only after **6** makes auto-fit the default. The pit of success: once the board fits by construction and the prompt always lives in the ribbon, the player can never reach a silent, unscrollable, or guidance-free state — and the wrong-usage escape hatches (manual zoom, swallowed errors, vanishing panel) cease to exist.

---

## Redesign — BoardSmith Game-Shell Chrome (header, side panel, action panel, toasts, layout)

The chrome's job is to be a thin, warm frame that vanishes into ShufflewickPub's tavern and hands the whole stage to the board. Today it does the opposite: a cold neon-noir scene (`#1a1a2e→#16213e`, white text, cyan/lime glow) painted across two stacked top bars and a 280px rail, with a parallel-but-unused token system (`--bsg-*`) and a *light-blue* default theme that would break if anyone actually called `applyTheme`. The greenfield target inverts every one of those defaults.

### Greenfield-ideal

#### 1. One token layer, tavern defaults, zero raw hex

There is exactly **one** theming namespace, `--bsg-*`, every chrome color/space/font flows through it, and its shipped defaults are tavern — not noir, not the current light-blue `defaultTheme`, and not the orphan `--bg-*`/`--text-*` set with `#f5f5f5`/`#fff` fallbacks that ActionPanel introduces as a third convention.

```
/* color */
--bsg-bg:            transparent;            /* platform mode: host shows through */
--bsg-bg-fallback:   #12100d;                /* standalone/dev only */
--bsg-surface:       rgba(20,16,10,.55);     /* warm parchment-under-candlelight */
--bsg-surface-strong:rgba(20,16,10,.85);     /* action bar / drawer */
--bsg-border:        rgba(215,176,106,.15);  /* hairline warm gold */
--bsg-text:          #f7f0de;                /* warm off-white */
--bsg-text-muted:    #b9a98a;                /* >=4.5:1 on the brown bg */
--bsg-accent:        #d7b06a;                /* brass */
--bsg-accent-strong: #f1c879;                /* gold highlight / focus ring */
--bsg-danger:        #d36a5a;                /* warm-tuned red */
--bsg-success:       #8aa66a;                /* warm-tuned green */
/* type */
--bsg-font-display:  'Cinzel', serif;
--bsg-font-body:     'Source Sans 3', system-ui, sans-serif;
/* space — 4px scale */
--bsg-space-1:4px; --bsg-space-2:8px; --bsg-space-3:12px;
--bsg-space-4:16px; --bsg-space-5:20px; --bsg-space-6:24px;
--bsg-radius-sm:6px; --bsg-radius-md:10px;
--bsg-bar-h:48px; --bsg-safe-bottom:env(safe-area-inset-bottom);
```

The shell sets `background: var(--bsg-bg); color: var(--bsg-text)` so in the iframe the host's `#0d0c09` + candle radials + grain show through untouched. The host calls `applyTheme(tavernPalette)` **once** at iframe init; that becomes the sole knob. No `.vue` file contains a literal hex. This kills the pit-of-failure where `applyTheme({primaryColor:'#d7b06a'})` does nothing and a developer concludes theming is impossible and hardcodes more neon.

**Type:** titles/game-name/menu header render in solid `--bsg-accent` Cinzel with a faint dark `text-shadow` (carved/burnished), **never** gradient clip-text. Body is Source Sans 3. The two `-webkit-background-clip:text` neon blocks (GameHeader h1, HamburgerMenu `.logo-text`) are deleted.

**Surfaces** are warm semi-opaque panels (`--bsg-surface`) with a hairline `--bsg-border` and a soft *warm* shadow `0 2px 8px rgba(0,0,0,.45)` — not flat `rgba(0,0,0,.3)` glass-blur. Blur fights the host's grain; drop it or keep it minimal.

**Primary action button** = brass plate: `--bsg-accent` fill (or `#c79a4e→#f1c879`), dark-ink label, warm shadow, faint inner highlight, keep the `translateY(-2px)` press — **no colored glow**. This is the most-screenshotted element; it alone sets whether the product reads "candlelit pub" or "arcade."

#### 2. Layout: what's the hero, what hides

The board is the hero on every breakpoint. The chrome reduces to **at most one persistent strip** plus on-demand surfaces.

- **No standing header in platform mode.** The host already supplies the tavern-sign pull-tab nav shade; BoardSmith painting its own ~44px bar beneath it is the single biggest "chrome won't get out of the way" offense (it costs 80–90px before any board pixel on a phone, and the code comment at `GameShell.vue:1462` literally admits the host owns top chrome yet keeps the bar, only shoving controls left). In platform mode the header **does not render as a layout row**. Connection state becomes a tiny absolutely-positioned corner dot; Leave/New-Game move into the host nav shade over the existing postMessage bridge.
- **Engineering controls leave the chrome.** Zoom slider, `Auto`, and `Undo`-visibility toggles are not player-facing per-turn actions. Zoom is replaced by auto-fit (below) and survives only as an a11y override in a settings popover. The `showUndo` toggle is **deleted outright** — a one-click control whose only function is to remove the player's own undo safety net is wrong-usage-made-easy; Undo simply shows whenever `canUndo`.
- **Turn ribbon, always present.** A single thin strip is the one piece of guaranteed chrome: it shows the current instruction/turn status at all breakpoints, sourced from `boardPrompt ?? currentPick.prompt ?? turnStatus`. This both fixes the disappearing-prompt gap (when all picks are board-anchored the footer vanishes and the "click a card" hint vanishes with it) and gives the `setBoardPrompt` API — currently wired through every slot and then *rendered nowhere* — a real render target instead of an affordance that lies.
- **Players → seat strip.** Reference material, not focus. A compact horizontal row of seat chips (name, score, active marker) lives along the board edge. The active seat is a **warm candle cue**: amber `--bsg-accent` dot with a gentle opacity-only breathe (not the infinite cyan/lime `pulse-glow` scale+halo that reads as a slot machine), plus a gold left-border and faint warm tint on the card.
- **History → on-demand sheet/drawer**, never a standing 300px block. It's read-only for players: the `Clear` button (a local-cache no-op that re-populates itself on the next length-diff update) and `Copy` move into the dev `DebugPanel`. New entries auto-announce (below).
- **Action panel = the only guaranteed-operable surface.** It must never fully suppress when there are pending choices (see a11y), and it collapses to just the one-line prompt when every pick is board-clickable rather than disappearing. It gets a `max-height: min(40vh, 320px)` with internal `overflow-y:auto` so a many-choice game can't grow up over the board, and the board reserves its *measured* height via a `--action-bar-height` CSS var (ResizeObserver), not the current magic `80px`/`60px` guesses. **When it isn't your turn and you have no actions, the bar does not render at all** — turn status lives on the seat chip, not behind a full blurred glass slab.

#### 3. Spacing discipline

Every panel authors against the 4px scale above. Today the same conceptual gap is `6/8/10/12/14/15/16/20/24px` scattered across 8 files with nothing tokenized. GameHistory must become layout-agnostic — strip its intrinsic `width:280px`/`border-right` so the consumer stops cannibalizing it with five `!important` overrides (`GameShell.vue:1613-1623`); the container sets width once, padding collapses from three nested levels (20+12+8) to one token.

#### 4. Responsive — phone / tablet / desktop

Replace the single `768px` snap (and the manual zoom crutch) with container-query-driven fluid sizing. The shell, not the viewport, is what matters inside an iframe.

- **Auto-fit board by default.** Measure board vs. stage, derive scale from a ResizeObserver; the default render always fits with zero interaction. Zoom slider is an optional override only.
- **Phone (~375px):** board owns ~100% of height. Header gone (platform), players = one-line strip, history = bottom-sheet behind an icon, action bar sticky with `max(var(--bsg-space-3), var(--bsg-safe-bottom))` padding. Use `100dvh` (not `100vh`) so the sticky bar isn't shoved under the mobile toolbar.
- **Landscape phone (short+wide):** branch on `@media (orientation:landscape) and (max-height:600px)` → row layout (slim sidebar beside board), not the width-keyed mobile column that today crushes the board into ~120–150px above a 40vh empty rail.
- **Tablet (768–1024):** intermediate tier; sidebar `clamp(220px, 22vw, 320px)`, not the flat 280px shared with 4K.
- **Desktop / big-screen (1440px+):** `max-width` board stage centered; the whole aside collapses to a thin rail (default collapsed) so the board claims the freed ~21% instead of surrendering it to a static rail.
- **Touch targets:** every interactive chrome element `min-height:44px` (action buttons currently ~38px; hamburger 28×20; zoom thumb 14px on a 4px rail; Auto/Undo 32×18 — all sub-minimum). Glyph buttons (✕, Copy/Clear) get ≥24×24 hit area via padding.
- **Safe areas** are a first-class token (`--bsg-safe-bottom`) consumed by every fixed/sticky edge, so forgetting it is impossible; host iframe passes `viewport-fit=cover`.

#### 5. Accessibility — baked into the frame, not bolted on

The current pit-of-success actively pushes games toward an **inaccessible** model, this is the most serious flaw on the surface and must be fixed at the framework level:

- **Keyboard operability (WCAG 2.1.1, A):** the action panel is the guaranteed-accessible fallback. Never fully suppress it when `currentPick` has choices — `filterAnchoredChoices` returns anchored choices in a **secondary, focusable list** inside the panel (board + panel parity) instead of dropping them. Longer-term, renderers emit real `<button>`/`role="button"` with `tabindex` and keydown so the board itself is operable.
- **Visible focus (2.4.7 / 2.4.11):** one global `:focus-visible { outline:2px solid var(--bsg-accent-strong); outline-offset:2px }` on every control; delete the two bare `outline:none` (number input, zoom slider).
- **Names & roles (4.1.2):** `aria-label` + `aria-expanded`/`aria-controls` on the hamburger; `aria-label` on every ✕ (Cancel/Clear/Close); `aria-hidden` on decorative glyphs; zoom slider gets `aria-label="Board zoom"` + `aria-valuetext="${pct}%"`.
- **Drawer as real dialog:** `role="dialog" aria-modal="true"`, focus moved in on open, Tab trapped, Escape closes, focus restored to the hamburger, rest of app `inert`. The menu is the only route to leave/restart — an un-escapable focus-leaking modal is a dead-end.
- **Status messages (4.1.3):** one visually-hidden `aria-live="polite"` region mirroring turn change + latest history entry; `aria-live="assertive"` for errors; GameHistory list = `role="log" aria-live="polite" aria-relevant="additions"`; toast container `role="status"`/`aria-live`, each toast a real dismissable `<button>` with auto-timeout.
- **Don't swallow failures:** the three `console.error` sites (fill, execute, undo) become `toast.error(result.error)` with the panel re-enabled to retry; the five lobby `alert()`s become themed toasts/inline validation. Silent no-ops train players to mash buttons.
- **Not color-alone (1.4.1):** active seat gets `aria-current` + sr-only "your turn"; history messages get a text/icon type prefix; selected choices get `aria-pressed`.
- **Semantics:** players = `<ul role="list">` with an `<h2>`; history collapse = real `<button aria-expanded>` (not a clickable div) under an `<h2>`; visible-or-sr-only `<h1>` on all breakpoints (today it's `display:none` on mobile); action bar moves out of `<footer>` (contentinfo) into `role="region" aria-label="Your actions"`.
- **Contrast:** drive all muted text from `--bsg-text-muted` (≥4.5:1); the literal `#666`/`#888` greys fail AA on the dark bg — worst on the waiting-message that carries whose-turn info.
- **Reduced motion:** wrap all chrome keyframes/transitions in `@media (prefers-reduced-motion: no-preference)`; the infinite pulse becomes a static high-contrast warm border. Reuse the existing blocks already present in `animation/card-flip.css` and `drag-drop.css`.

### Map-back from current code

Ordered for safe incremental landing. Effort: **S** ≤ half-day, **M** ~1–2 days, **L** multi-day.

1. **Token foundation (L, mechanical).** Repoint `theme.ts` `defaultTheme` to tavern values, add accent/surface/danger/font/space/radius tokens, and have `applyTheme` set all of them. Then sweep the 8 chrome files replacing hardcoded hex with `var(--bsg-*)`, including the five `--bg-*`/`--text-*`/`--border-*` light-fallback refs in `ActionPanel.vue:1505-1524`. Host passes its palette into `applyTheme` at iframe init. *This single step unlocks ~10 visual findings at once — toast.info, zoom thumb, history bullets, "you" badge all point at the same `#00d9ff` literal and recolor in one move.*
2. **Type (M).** Set `.game-shell` body to `var(--bsg-font-body)`; retag h1/`.logo-text`/`.config-title` to display font; delete the two clip-text blocks (`GameHeader.vue:115-120`, `HamburgerMenu.vue:230-233`). Host already loads Cinzel + Source Sans 3.
3. **Action-button + active-player recolor (S).** Swap `.action-btn` gradient/glow (`ActionPanel.vue:1105,1117`) to brass + warm shadow; recolor `pulse-glow` + `.player-card.current` (`PlayersPanel.vue:72-75,101-119`) to amber, opacity-only.
4. **A11y quick wins (S).** Global `:focus-visible`; delete two `outline:none`; aria-labels on icon buttons; `role="alert"`/`role="status"` on error & time-travel banners; `aria-hidden` on decorative emoji; zoom `aria-label`/`aria-valuetext`; reduced-motion guards.
5. **Surface failures (S).** Replace 3 `console.error` + 5 `alert()` with toasts/inline validation; toast container `role`/`aria-live` + dismiss button + auto-timeout.
6. **Trim the menu & history (S).** Drop dead Settings/Help items and the `BS`/`BoardSmith Dev Mode` branding (dev-gate); remove `showUndo` toggle + prop threading; pull `Clear`/`Copy` out of player GameHistory into DebugPanel.
7. **Always-on prompt/turn ribbon (S–M).** Render one strip in GameShell driven by `boardPrompt ?? currentPick.prompt`; suppress only the action *buttons*, never the prompt; gate the bar on `isMyTurn || awaitingPlayerNames.length`.
8. **Header removal in platform mode (M).** `v-if="!platformMode"` on `<GameHeader>`; connection state → corner dot driven by real platformRequest round-trip liveness (`GameShell.vue:298` timeouts) instead of the hardcoded `'connected'`; relocate Leave/New-Game/Auto/zoom into host nav + settings popover via the existing `handleMenuItemClick` bridge.
9. **Keyboard-accessible action fallback (M).** `filterAnchoredChoices` returns anchored choices as a secondary focusable list rather than dropping them; footer `v-if` keeps the panel whenever `currentPick` has choices.
10. **Drawer dialog semantics (M).** Wrap the `isOpen` drawer in a focus-trap composable: `role="dialog"`, Escape, focus move/restore, `inert` siblings.
11. **Semantic markup + live regions (M).** Players `<ul>`+`<h2>`, history `role="log"` + button toggle, action bar → labelled region, persistent `<h1>`, one polite + one assertive sr-only live region.
12. **Responsive overhaul (L).** Container-query sidebar `clamp(220px,22vw,320px)` + wide-screen `max-width` stage + collapsible aside; `100dvh`; landscape/orientation rule; mobile players-strip + history bottom-sheet; `--action-bar-height` ResizeObserver replacing the `80px`/`60px` reservation; auto-fit board scale (zoom demoted to override); 44px targets + `env(safe-area-inset-*)`.
13. **GameHistory de-coupling (S–M).** Strip intrinsic `width`/`border-right`; delete the `.sidebar-history` `!important` block; collapse nested padding to one token level.

**Where the audit overreached (don't over-build):** the "all dynamic state is silent to SR" framing is *overstated* — GameHistory already accumulates a clean `processedMessages` stream, so live regions are an additive `role="log"` + one mirror region (M), not a rewrite. The "double-counted `padding-bottom`" finding is *overstated* given the footer is `sticky` (in-flow) — verify the board's last row isn't clipped before simply deleting the reservation; the ResizeObserver `--action-bar-height` approach in step 12 supersedes it cleanly. The disappearing-prompt and turn-banner findings are real but *overstated* in scope — they collapse into the single ribbon of step 7, not separate systems.

---

## Redesign — BoardSmith Board UI Variants (Auto UI, renderers, Debug panel)

The Auto UI is where "the game is the hero" lives or dies. Today it does neither: the board overflows phones, hides behind hover, throbs in neon, is invisible to a keyboard, and the one theming API that would fix all of it (`theme.ts`) is dead code that nothing reads. This section designs the surface as it should be, then maps every change back to the files that exist.

### 0. Three non-negotiables that govern everything below

1. **One token layer the board actually consumes.** `theme.ts` defines `--bsg-*` and *zero* renderers reference it (`grep "var(--bsg" src/ui` → 0 hits); renderers instead read a stray `--bs-*` namespace (`HandRenderer.vue:431 var(--bs-drop-target-bg, …)`) or raw hex. The redesign collapses to a single `--bsg-*` namespace that is the *only* place literals exist.
2. **Content fluid-fits by construction; zoom is a magnifier, not the fit strategy.** No renderer or archetype contains a single `@media`/container query; the only "responsiveness" is `zoomLevel = ref(1.0)` driving `transform: scale()` (GameShell.vue:200/1505). That is a crutch and it blurs text and desyncs hit-targets.
3. **Every interactive element is semantic and focusable by construction.** Every renderer is a `<div>`/`<g>` with `@click` and nothing else — `tabindex`/`role`/`@keydown`/`<button>` = 0 hits across auto-ui. The default Auto UI ships a WCAG 2.1.1 (keyboard, Level A) failure with no warning. The easy path must bake in accessibility.

### 1. The token foundation (`theme.ts` becomes load-bearing)

`theme.ts` is rewritten to emit a complete token set at `:root`, and renderers reference tokens **exclusively** — stylelint bans raw hex and raw px on `padding`/`gap`/`margin`/`color`/`background`. Default values ship the tavern palette so the *unconfigured* engine already looks native, and `applyTheme()` finally has an effect.

**Surface / ink (dark tavern default, internally consistent — note today's `theme.ts:22-29` default is a *light* `#f5f5f5` bg with hardcoded `#fff` ink in renderers = invisible white-on-white):**

```
--bsg-surface:        #12100d;   /* table ground */
--bsg-surface-raised: rgba(247,240,222,0.05);  /* a named zone, depth 0 only */
--bsg-ink:            #f7f0de;
--bsg-ink-muted:      #b8a888;   /* contrast-checked ≥4.5:1 on surface — replaces every #888/#666 */
--bsg-edge:           rgba(215,176,106,0.30);   /* thin brass hairline, replaces white 0.1 borders */
--bsg-elevation:      0 2px 10px rgba(0,0,0,0.45);  /* warm candlelit drop, no colored bloom */
```

**Interaction states (ONE token per state, consumed everywhere — replaces the copy-pasted neon `#00d9ff`/`#00ff88`/`#2ecc71` in all 8 renderers, and the two-greens-two-box-models inconsistency where HandRenderer uses lime `border` and everyone else emerald `outline`):**

```
--bsg-selectable: 2px dashed rgba(215,176,106,0.7);   /* "you can act" — gold, dashed */
--bsg-selected:   /* solid bronze ring + check icon */ #f1c879;
--bsg-droptarget: 2px dotted rgba(241,200,121,0.8);   /* dotted, distinct shape from selectable */
--bsg-ring:       0 0 0 1px rgba(215,176,106,0.5);    /* warm rim, NOT a cyan glow */
--bsg-focus:      0 0 0 2px var(--bsg-surface), 0 0 0 4px #f1c879;  /* focus-visible, separable from selection */
```

Crucially, **state is encoded by shape + icon, not hue alone** (today selectable/highlighted/selected differ only by color + a pulse — WCAG 1.4.1 fail for ~8% of male players): selectable = dashed gold ring, droptarget = dotted gold ring, selected = solid ring **plus a check glyph**. Color reinforces; it never carries meaning.

**Spacing — a 4px scale (today `theme.ts` ships *no* spacing tokens; literals run 2/4/6/8/10/12/16/20/24/30/32px plus `30vh`/`50px` across 15 scoped stylesheets, e.g. Tableau `gap:32px` is 4× Grid's `gap:8px`):**

```
--bsg-space-1:4px; -2:8px; -3:12px; -4:16px; -5:24px; -6:32px;
--bsg-gutter:    var(--bsg-space-3);   /* zone padding, depth-aware */
--bsg-density:   1;     /* host sets 0.75 phone / 1 tablet / 1 desktop */
```

**Type (today: `system-ui` in DebugPanel, *unset* in renderers, no Cinzel/Source Sans 3 anywhere):**

```
--bsg-font-display: "Cinzel", serif;        /* zone/element titles */
--bsg-font-body:    "Source Sans 3", sans-serif;  /* counts, labels, metadata */
```

**Seat palette — desaturated, themable, shared (today `PLAYER_COLOR_CYCLE` is the saturated 2014 Flat-UI set hardcoded *only* inside HexBoardRenderer.vue:108, so Piece/Hex/Debug can disagree):**

```
--bsg-seat-0…5: mulled-wine, brass, sage, slate-blue, plum, teal (≈30% desaturated)
```

Exported as one array from `theme.ts`; Piece/Hex/Debug import it. Pair each seat color with a non-color owner cue (initial/pattern) so ownership survives color-blindness and grayscale.

### 2. Layout — chrome that disappears

**Invisible containers by default.** Every zone currently paints its own translucent card — `GridBoardRenderer.vue:224`, `HandRenderer.vue:372`, `SpaceRenderer.vue:189`, `DeckRenderer.vue:158` each set `background: rgba(255,255,255,0.05); border-radius; padding:16px`. Because `ElementRenderer` recurses, a Space-in-Space-in-board stacks three frames — ~96px of horizontal padding burned on a phone. Rule: **a surface (`--bsg-surface-raised` + `--bsg-edge` + `--bsg-gutter`) renders only when `depth===0` AND the zone has a human-facing label.** Deeper zones are pure layout (`display:contents` / flex + `gap`, zero fill, zero padding). `depth` is already threaded through every renderer — gate `:class="{ 'is-root': depth===0 }"`.

**Headers are opt-in, never `element.name`/className.** Today each zone prepends a `Deck (40)` / `Player 2's Hand (7)` / board-classname row with 8–12px bottom margin (`GridBoardRenderer.vue:230`, `HandRenderer.vue:451`, `SpaceRenderer.vue:247`) — engineering metadata as UI. Render a header **only when `presentationEntry.label` exists**, as a small muted inline caption (or a corner count badge), never a stacked row, and never the raw class name.

**Material, not glass.** Replace `rgba(255,255,255,0.05)` veils and white 0.1 hairlines with the warm `--bsg-surface-raised` + a subtle inset shadow + `--bsg-edge` brass rule, optionally a shared felt/grain texture token, so the play area reads as a tabletop inside the host's candlelit room rather than flat glass rectangles.

### 3. Front-and-center vs hidden

| Front-and-center | Quiet / on demand | Gone |
|---|---|---|
| The board/hand/pieces (the hero) | Zone labels (only if presentation label) | Per-zone glass cards |
| Current-step **prompt anchored to the board** | Counts as corner badges | className/element.name |
| Selectable affordance (gold ring + icon) | Coordinate labels (always on for touch) | Neon glows, white hairlines |
| Result card at Game Over | Zoom slider (a11y magnifier only) | The 30vh empty-hand slab |

**The prompt belongs on the hero.** Today the board can mark N elements `action-selectable` and pulse them with **zero on-board text** explaining what choosing one does — the instruction lives far away in the header ActionPanel (`AutoUI.vue:5-6` comment confirms the board is decoupled), and on phones that header may be collapsed behind the nav shade, leaving a throbbing board with no caption. Thread the active step prompt into `AutoRenderer` and render a single lightweight caption pill at the top of the focal area (or near the highlighted cluster), sourced from the same flow-step prompt the ActionPanel uses.

### 4. The board must fit — fluid sizing for every renderer

This is the single biggest "board is NOT the hero" failure. Grid cells are hardcoded `50px` (`GridBoardRenderer.vue:288`) **overriding the `repeat(N, 1fr)` they were given** (line 62) — an 8×8 board ≈ 466px overflows a 375px phone into a scroll box, and floats as a postage stamp on a 1440px desktop. Hex, by contrast, scales perfectly via viewBox — two sibling renderers behave oppositely.

**Greenfield rule: size from container, never a constant.** Put `container-type: size` on each renderer's board/hand wrapper and derive a single custom property:

```css
.grid-board-template__board { container-type: size; }
.grid-cell { --cell: clamp(28px,
    min(calc((100cqw - var(--gutters)) / var(--cols)),
        calc((100cqh - var(--header)) / var(--rows))),
    96px);
  inline-size: var(--cell); block-size: var(--cell);
  font-size: calc(var(--cell) * .32); }
.board-label { inline-size: var(--cell); }   /* labels share the unit */
```

`cols`/`rows` already come from `resolveGridSize`. An aspect-ratio wrapper keeps it square. The board then auto-fits phone→desktop with **no scrollbar**, and the zoom slider becomes optional polish.

- **Hand cards** (`HandRenderer.vue:551` fixed `60×84`, `flex-shrink:0`, fan = `flex-wrap:nowrap` → guaranteed phone overflow + sub-44px overlapped tap targets): `--card-w: clamp(44px, 14cqw, 84px)`, height by `aspect-ratio`, allow controlled shrink; wide screens wrap into rows, phones use a scroll-snap track with a peek affordance and overlap computed from `--card-count` (already a CSS var, line 536) so each card always exposes ≥44px. Replace the `max-height:30vh` cap (GridBoardTemplate.vue:128) with `clamp(96px, 18vh, 180px)`, and **collapse to 0 when empty** rather than reserving the 90px "No cards" slab (HandRenderer.vue:586).
- **Hex** (`HexBoardRenderer.vue:256` `overflow:hidden; max-height:80vh` silently *crops* tall boards on narrow phones, and 80vh is meaningless inside the host iframe): fit to the *smaller* of width/height via `max-block-size:100%` + aspect-ratio box; switch `hidden`→`auto` as a safety net; drop the vh magic number.
- **Tableau** (the catch-all for the most un-classified games, and the *loosest* spacing in the repo — `gap:32px; padding:16px`, TableauTemplate.vue:48): default `gap: clamp(8px, 2cqw, 16px)`; reserve 32px only on explicit designer request.
- **Peripheral/chrome rows** (`auto` height + `flex-wrap` + no cap can grow *taller than the hero board* on a phone): cap with `max-height` + horizontal scroll on the phone tier so chrome can never out-grow the `1fr` board.

### 5. Responsive behavior — three real tiers

Replace "768px + a zoom slider" with content that fits by construction plus **three density tiers** that change *information density*, not just column order:

| Tier | Width | Density | Behavior |
|---|---|---|---|
| Phone | <640px | `--bsg-density:.75` | Hide row/col label gutters; collapse multi-deck chrome to one scroll strip; hand = scroll-snap peek; prompt pill on board |
| Tablet | 640–1280px | `1` | Full layout, fluid cells |
| Desktop | ≥1280px | `1` | Board centered at a `max-width`, not floating in a sea of bg |

**Touch parity (today key affordances are hover-only — `GridBoardRenderer.vue:348` coordinate label is `opacity:0` revealed on `:hover`, fan cards un-rotate on hover, hex's mid-strength hint is hover-only):** wrap all hover flourishes in `@media (hover:hover) and (pointer:fine)`; on coarse pointers keep coordinate labels permanently visible and add tap-to-enlarge for fanned cards.

**Safe areas (today `grep "env(" src/ui` → 0):** bottom hand strip and action bar get `padding-block-end: max(var(--bsg-gutter), env(safe-area-inset-bottom))`; board containers get inline safe-area padding; the host play page must set `viewport-fit=cover`. Bake into the shared layout primitive so every renderer inherits it. This is the biggest "not a native app" tell on phones.

### 6. Accessibility — the largest gap, designed in

A `useSelectable()` composable centralizes the interaction binding currently copy-pasted into every renderer's `handleClick`:

- **Semantics & keyboard.** Each selectable root becomes a real `<button>` (or `role="button" tabindex="0"` where a button breaks layout), wired to `@click` **and** `@keydown.enter/space` → the same `triggerElementSelect`. Grid boards use a roving-tabindex `role="grid"/row/gridcell` with arrow-key nav; hands become `role="group" aria-label="Your hand, 5 cards"`.
- **Names & state from one source.** The composable computes `aria-label` ("e5, white knight, selectable") and sets `aria-selected`/`aria-disabled`/`aria-current` from the *same booleans* (`isSelected`/`isDisabled`/`isHighlighted`) that drive the CSS classes, so visual and semantic state cannot diverge. Promote the `opacity:0` `.cell-notation` to a real AT-visible label.
- **Drag has a single-pointer + keyboard path (WCAG 2.5.7, new in 2.2).** Movement is modeled as two-step selection — pick source → valid targets (the already-computed `isDropTarget` set) become click/Enter-activatable — with native drag as progressive enhancement only.
- **Live regions (WCAG 4.1.3).** `AutoUI` owns one visually-hidden `role="status" aria-live="polite"` region (plus an assertive one for errors). A narration string derived from `flowState`/turn/selection ("Your turn", "Opponent played 7 of Hearts", "Game over — you win") is written on change; loading and Game Over banners live inside it.
- **Contrast (WCAG 1.4.3).** Every `#888`/`#666` (coordinates, counts, empty-zone text, die labels, the loading string) → `--bsg-ink-muted` at ≥4.5:1; disabled state uses a hatch pattern + `aria-disabled`, **not** `opacity:0.35` stacked on already-dim text (CardRenderer.vue:477, GridBoardRenderer.vue:360).
- **Motion (WCAG 2.2.2).** The eight infinite `pulse-*` keyframes collapse to one shared rule gated on `@media (prefers-reduced-motion: no-preference)`; default selectable is a **static** gold ring + icon, and motion is reserved for at most a single engine-flagged "suggested" target. No board-wide throb.
- **Focus (WCAG 2.4.7/2.4.11).** One `:focus-visible` ring from `--bsg-focus`, ≥2px, offset, visually distinct from the selection ring, on every interactive root.

### 7. Game Over, loading, empty states

- **Game Over is currently a dead-end:** `AutoUI.vue:37-42` renders `<h2>Game Over!</h2><p>The game has ended.</p>` with `v-else` hiding the final board — no winner, no score, no next action. Replace with a **result card** fed by `flowState` winners/scores, the final board kept visible behind a translucent warm scrim, and primary actions (Rematch, New Game, Back to Tavern) wired to host-provided events. Cozy and celebratory, not a gradient tombstone.
- **Loading** (`AutoRenderer.vue:154` bare gray `#888` "Waiting for game state…"): branded skeleton + "Lighting the candles…" in `--bsg-ink-muted`, escalating after ~8–10s to an actionable "Still connecting — Retry / Reload" wired to the host reconnect path. This is exactly where version-skew/blank-action-bar failures surface.
- **Unsupported topology** (`UnsupportedTopologyPanel.vue:24` shows *developers* "Build a custom UI component… see the custom UI guide" — a non-link — to *players*): split by audience. Players see "This game's table isn't available to display yet"; the technical guidance + a real anchor goes to console + DebugPanel.

### 8. Debug panel (dev-only, but the surface every author lives in)

Re-skin from `--bsg-*` (warm parchment-on-dark, brass tab, amber syntax) instead of its self-contained neon (`#1a1a2e` body, `#00d9ff` border, `#00ff88` mono) — it's the source of the copied neon literals in the renderers. Make the toggle a real `<button aria-expanded aria-controls>`; apply the `role="tablist"/tab` + `aria-selected` + roving-tabindex pattern to the existing tab strip; give the `✕`/`‹` glyphs `aria-label` + `aria-hidden`. Gate the `'d'` shortcut behind a modifier (Cmd+Shift+D) and broaden the typing guard to contenteditable/select (WCAG 2.1.4). Auto-hide the always-on right-edge pill unless pointer-near-edge so it stops occluding the board. Collapse the six overlapping tabs to ~4 (Inspect / Actions / Timeline / Controls) with one consistent "Player N (seat N−1)" numbering, and re-dock to a bottom sheet (max ~60vh) under 640px with flex-based `min-height:0` scroll regions replacing the `calc(100vh - 280px)` magic constants.

---

### Map-back from current code (ordered, with effort)

Ordered so each step unblocks the next; foundation first because eight renderers depend on it.

1. **Make `theme.ts` authoritative — emit interaction/surface/spacing/type/seat tokens at `:root`; unify `--bs-*` into `--bsg-*`; delete the contradictory light default.** This is the keystone; nothing else can reference a token until it exists. *Files:* `src/ui/theme.ts`. **Effort: M.**
2. **Sweep renderer literals → tokens.** Replace `#00d9ff`/`#00ff88`/`#2ecc71` interaction colors, `rgba(255,255,255,a)` surfaces/borders, `#fff`/`#888`/`#666` ink, colored glow box-shadows, the navy card-back gradient, and raw padding/gap across the 8 renderers + 4 archetype templates + DebugPanel. Switch HandRenderer from `border` to `outline`; consolidate the six `pulse-*` keyframes into one reduced-motion-gated rule. *Files:* all of `renderers/`, `archetypes/`, `DebugPanel.vue`. **Effort: L** (mechanical but broad).
3. **`useBoardInteraction`/`useSelectable` composable** — centralize the copy-pasted `handleClick`, adding `tabindex`/`role`/`@keydown`→activate, `aria-label`/`aria-selected`/`aria-disabled`, the two-step drag alternative, and `:focus-visible`. Apply to all 8 renderers + hex `<g>`. *Files:* new composable + every renderer. **Effort: L.**
4. **Fluid sizing per renderer** — `container-type:size` + `--cell`/`--card-w` clamps; Grid `50px`→`var(--cell)`, Hand `60×84`→`clamp`, Hex drop `80vh`+`hidden`→fit-to-container, hand `30vh`→`clamp`+collapse-empty. *Files:* `GridBoardRenderer`, `HandRenderer`, `HexBoardRenderer`, `GridBoardTemplate`, `CardTemplate`, `TableauTemplate`. **Effort: M** per renderer, independent.
5. **Container discipline** — gate surfaces/headers on `depth===0` + `presentationEntry.label`; strip fills from nested zones; replace fixed gaps with clamp/density tokens; add safe-area padding to hand + action bar; verify host `viewport-fit=cover`. *Files:* `Space/Hand/Deck/Grid` renderers, 4 templates, host play page. **Effort: M.**
6. **Live region + narration in `AutoUI`** — one sr-only `role="status"`, fed from `flowState`/turn. *Files:* `AutoUI.vue`. **Effort: M.**
7. **State screens** — result component replacing the `game-complete` block; loading component with timeout+retry; player/dev split for UnsupportedTopologyPanel; on-board prompt caption threaded into `AutoRenderer`. *Files:* `AutoUI.vue`, `AutoRenderer.vue`, `UnsupportedTopologyPanel.vue`. **Effort: M.**
8. **Touch/hover parity** — wrap hover rules in `@media (hover:hover)`, keep coordinates visible on coarse pointers, tap-to-enlarge fan cards. *Files:* `Grid/Hand/Hex` renderers. **Effort: S–M.**
9. **Debug panel** — token re-skin, ARIA tabs, `<button>` toggle, modifier-gated shortcut, bottom-sheet under 640px, flex scroll regions, auto-hide pill. *Files:* `DebugPanel.vue`. **Effort: M**, low priority (dev-only).

**Sequencing note:** steps 1→2→3 are the spine — once the token layer is real and the composable exists, the responsive (4–5), a11y-live (6), and state-screen (7) work proceeds in parallel per renderer with no cross-file coupling. The zoom slider stays only after step 4 lands, demoted in copy and keyboard story to an accessibility magnifier.

---

## Redesign — BoardSmith Dev-Server Chrome (the top bar)

This is the surface a game author stares at all day, yet today it's a slab of blue glass — `background: #0f1020` page, `#1a1b33` lobby, neon-cyan `#00d9ff` accents, emerald `#2ecc71` buttons, `system-ui` everywhere (`DevHost.vue:357–359`, `413`, `493`, `505–508`). It shares zero DNA with the tavern the game ships into. It also has **zero `@media` queries in 260 lines of scoped CSS** and **zero ARIA**. The redesign goal is a *thin strip of stained wood* that disappears when the author is judging their board and reappears with exactly the dev-only controls the embedded game can't provide.

### Greenfield-ideal

#### Layout — one slim row, collapsible to a pull-tab

The dev chrome is a single ~44px row, not the current two-deck `column` stack (`gap: 8px; padding: 10px 16px`, `:515–516`). Left-to-right:

```
[≡ seat pill ▾] · · · · · · · · · · · · · ·  [UI ▾(dev)] [⟳ follow] [↻ restart]
   seat switcher           (flex spacer)            dev-tools group
```

- **Drop the duplicated `displayName`** (`:310`). The embedded `GameShell` already renders the title via `GameHeader` (`GameShell.vue:1286`) ~50px below — it's pure double-chrome that eats the horizontal budget the actions need. The bar carries only what the game *can't* show: who you are, and dev-only knobs.
- **Collapse-by-default.** Mirror ShufflewickPub's nav-shade pattern (`default.vue` pull-tab): once a seat is taken, the bar auto-collapses to a single ~16px tavern-sign tab pinned top-center. The stage (`.dev-host__stage { flex: 1 1 auto }`, `:599`) then claims the full dynamic viewport. Open state persists in `localStorage` next to `clientId`. On a 667px phone the current bar steals ~7.5% of the viewport *every frame*; collapsed, it steals ~2.4%.

#### Front-and-center vs hidden

| Front-and-center (always visible when bar is open) | Hidden behind an affordance |
|---|---|
| **Seat switcher** — the #1 dev task | UI switcher → only inline ≥768px; in an overflow "⋯" menu on phone |
| **Co-player presence strip** (swatch + name + online/AI/away dot) | Restart → quiet ghost button, never primary |
| Reconnecting status pill (only when degraded) | **Table-setup panel** (AI seats, difficulty, player count, game/player options) behind one gear |

The single biggest IA win: the seat badge today is **dead text** (`<span>seat {{ mySeat }}</span>`, `:311`) and `leaveSeat()` is **dead code** with zero template references — violating the repo's "never leave dead code" rule. Once auto-seated, the dev is *locked* to one seat with no escape but a second browser. The badge must become a **`role="menu"` seat switcher** listing every seat with name + connected/AI status, so the dev re-seats as any player from the chrome. "Follow active seat" stays as the complementary auto-mode (renamed; see below).

Equally, the entire `DevHostConfig` payload — `aiSeats`, `aiLevel`, `playerCount`, `min/maxPlayers`, `gameOptions`, `playerOptions` — is plumbed to the browser and used **nowhere** (`config-types.ts` exports it; `DevHost.vue` references none). Changing AI difficulty or player count today requires killing the CLI and relaunching with new `--ai`/`--players` flags. A tucked-away "Table setup" panel renders these (`choices → select`, `min/max → stepper`, per-seat AI/human toggle) and applies via a `configure` WS message + restart with a clear "this resets the table" note.

#### Theming toward cozy tavern — consume the tokens, ban the hex

There are three disconnected palettes (DevHost literals, `theme.ts` `--bsg-*` defaults `#4a90d9`, host tavern tokens) and the chrome wires to **none**. Collapse to **one contract**: the tavern token set from `main.css:3–43` becomes the canonical chrome palette, imported into DevHost's scoped style.

| Element | Today (literal) | Greenfield (token) |
|---|---|---|
| Page bg | `#0f1020` | `var(--bg-base)` over `var(--bg-0)` #0d0c09 |
| Bar bg | `#1a1b33` | `var(--panel-soft)` rgba(23,21,17,.88) |
| Text | `#e8e8f0` | `var(--text)` #f7f0de |
| Hairlines | `rgba(255,255,255,.08)` | `var(--line)` #3b3426 |
| Seat-mine / follow-on / badge | `#00d9ff` cyan | `var(--accent)` #d7b06a on `rgba(215,176,106,.14)` wash |
| Restart button | `#2ecc71` emerald | `var(--button-bg)` ghost; **never** primary |
| Online dot | `#2ecc71` | `var(--success)` #7cbc8a |
| Title face | `system-ui` | `var(--font-display)` Cinzel on the seat-switcher label; `var(--font-body)` Source Sans 3 for controls |

Warmth is material, not just hue: add the host's grain overlay (`main.css .site-grain`), candle-glow radials (`--bg-glow-a/-b`), and a soft warm `box-shadow` under the bar so it reads as a wood edge, not frosted glass. Because every value is now a `var()`, a single `data-theme="light"` flips the dev bar to the host's parchment mode (`main.css:45–82`) — today it's hardcoded dark-only and can never follow the author's theme. Enforce with a `stylelint` `color-no-hex` rule scoped to chrome components so the palettes cannot drift again.

#### Spacing/padding discipline

The bar mixes three units in one component — `10px` vertical / `16px` horizontal / `8px` gap — and scatters off-grid values (`5px`, `14px`) across the file. Adopt a 4px scale as vars (`--space-1:4 … --space-6:24`): bar padding `var(--space-2) var(--space-3)`, gaps `var(--space-2)`, control padding `var(--space-1) var(--space-2)`. Snap `5→4`, `14→12`. This is the precondition for "minimal" — one knob to tighten the whole bar.

#### "Restart," not "New game"

The single most destructive control — `restart` broadcasts a table-wipe to **every** connected seat (`newGame()` → `wsSend({ type: 'restart' })`, `:200`) — is styled as the *only solid-green, highest-weight* button (`btn--start`, `:492–497`): textbook pit-of-failure. Demote to a quiet ghost outline, relabel **"Restart game,"** require a two-click inline confirm (`Restart?` → `Confirm`), and broadcast a toast to other seats ("Table reset by seat N"). Reserve any accent weight for safe, common actions.

#### Responsive behavior

Fluid from the ground up; spacing/type from `clamp()` so there are no fixed states. Three breakpoints:

- **Phone (≤640px):** `flex-wrap: nowrap` (today `.dev-chrome__bar-actions` has *no* wrap, so three controls + 16px gaps overflow and can clip Restart at 375px). Icons only: UI=gear, follow=target, restart=↻; secondary controls spill into a "⋯" menu. Title container gets `min-width:0` + ellipsis so an author-controlled long `displayName` can't shove the actions off-screen. Target a fixed ≤44px bar.
- **Tablet (641–1024px):** controls inline with labels.
- **Desktop (1440px+):** comfortable spacing, max content width, centered.
- **Landscape short-viewport (`@media (max-height:480px)`):** force the collapsed pull-tab — landscape is exactly when authors test boards and vertical pixels are scarcest.

Viewport sizing: replace `height: 100vh` (`:356`) with `height: 100dvh` (under `@supports`, `100vh` fallback first) and add `env(safe-area-inset-*)` padding. Today the iOS URL bar pushes the game's bottom action panel — where Confirm buttons live — under the browser chrome, unreachable.

Touch: every control gets `min-height: 44px`; color swatches go from `22×22` (`:467`, below the 24px AA floor) to a 36–40px tap zone (pad the hit area, keep the 22px visual) with ≥8px gaps under `@media (pointer: coarse)`. Seat cards stack to two lines (identity row + full-width "Take seat") on phone.

#### Accessibility — make announcing the default

The surface has **no live regions, no headings, no list semantics, and no `:focus-visible`** anywhere. Bake correctness into shared helpers so it can't be forgotten:

- **`announce()` helper** routing every state transition (connected, joined, error, follow toggle, restart) through one visually-hidden `role="status" aria-live="polite"` plus a `role="alert"` for errors. Today a rejected seat-claim, a disconnect, and host `error` frames (`:111–112`) all change the DOM **silently** — WCAG 4.1.3 fail; an SR dev presses "Take seat" and hears nothing.
- **Focus on view-swap:** the lobby↔in-game subtree swap (`v-else-if mySeat===null` / `v-else`) drops focus to `<body>`. Watch `mySeat`, move focus to the new region's `tabindex=-1` heading, and announce "Joined seat 2."
- **Semantics:** promote `displayName` `<strong>` → `<h1>`; seat picker `<div v-for>` → `<ul role="list"><li>`; wrap swatches in `role="radiogroup"` + `<legend>`; each "Take seat" gets `:aria-label="\`Take seat ${n} (open)\`"` (today N identical "Take seat" buttons). Color swatches become `role="radio"` with `aria-label="{color name}"`, `aria-pressed`, and a non-color hatch for `taken` (today opacity-only, `:478`).
- **Color-independence:** online/offline dot gets an `aria-label`; the mine-seat gets `aria-current="true"` + a visible "You" chip, not just a cyan border.
- **Contrast:** lift open-seat name from `#778` (`:434`, ≈4.3:1 on `#0f1020`, italic — the least-legible text where the actionable info lives) to clear 4.5:1, drop italic-as-sole-emphasis.
- **One tokenized focus ring:** `:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px }` on every interactive class, ≥3:1 against the warm panel. Today focus rests entirely on the UA default against undefined backgrounds.
- **Connecting dead-end:** `<p>Connecting to the dev host…</p>` retries silently forever (`setTimeout(connect, 1000)`, `:93`). Add a spinner, attempt counter, and after N failures an actionable message ("Can't reach the dev host — is `boardsmith dev` running on this port?") + manual "Retry now."

### Map-back from current code (ordered, with effort)

All paths under `/Users/jtsmith/BoardSmith/src/cli/dev-host/DevHost.vue` unless noted.

1. **Tokenize the palette (S).** Import the six base tavern hexes (or `@import` the shared token block from `/Users/jtsmith/ShufflewickPub/app/assets/css/main.css:3–43`) into the scoped `<style>`; replace the four bg/text literals (`:357–359`, `:378`) and the cyan/emerald accents (`:413`, `:445`, `:493`, `:505–508`, `:542`) with `var(--bg-base/--text/--line/--accent/--success)`. Foundation for everything below.
2. **Fonts (S).** Body → `var(--font-body)`; seat-switcher label → `var(--font-display)` with small letter-spacing.
3. **Restart demotion + confirm (S).** Change `:333` class `btn btn--start` → ghost variant, relabel "Restart game," wrap `newGame()` (`:200`) in a `confirmRestart` two-click ref.
4. **Spacing scale (S).** Define `--space-*` at `.dev-host`; find/replace the literals; snap `5→4`, `14→12`.
5. **`100dvh` + safe-area (S).** One-line `height` change at `:356` plus an `@supports` block and `env(safe-area-inset-*)` padding on `.dev-host`.
6. **A11y pass (S–M).** Add the `announce()` helper + two live-region divs; wire `onHostMessage` error/init/lobby cases and `connect()/close()`; `<strong>→<h1>`, seat `<div>→<ul>/<li>`, swatch `role/aria-pressed/aria-label`, `:aria-label` on Take-seat, `aria-current` + "You" chip, one `:focus-visible` rule, `#778` contrast fix.
7. **Responsive (M).** Add `@media (max-width:640px)`, `(max-height:480px)`, `(pointer:coarse)` blocks; `flex-wrap:nowrap` + overflow menu on `.dev-chrome__bar-actions` (`:536`); `min-width:0`+ellipsis on `.dev-chrome__toggle`/`.lobby__head`; `min-height:44px` on `.btn`/`.dev-chrome__select`; enlarge swatches; stack `.seat-card`.
8. **Drop duplicate title (S).** Delete `<strong>{{ cfg.displayName }}</strong>` at `:310`.
9. **Seat switcher + presence strip (M).** Replace the static badge (`:311`) with a `<select>`/menu bound to `seats`; extend the join/leave WS protocol for dev re-seating; either wire `leaveSeat()` (`:196`) to a visible control or delete it. Reuse the lobby's seat rendering (`:262–266` dots, `seatLabel` `:210`) condensed inside the bar.
10. **Reconnect decoupling (M).** Add `everConnected`/`reconnecting` refs so the iframe stays mounted across blips (`:90–94`); render the full-screen connecting view only when `!everConnected`, an inline pill otherwise.
11. **Collapse-to-pull-tab (M).** Add `chromeOpen` ref (default false post-seat, hydrated from `localStorage`); wrap `.dev-chrome` content in a collapsible region with a pull-tab; height transition, stage already flexes.
12. **Table-setup panel (L).** Collapsible panel consuming `aiSeats/aiLevel/playerCount/min-maxPlayers/gameOptions/playerOptions` from `config-types.ts`; new `configure` WS message the Node host applies on restart.
13. **Stylelint guard (S).** `color-no-hex` scoped to chrome components so palettes can't re-drift.

Sequence rationale: 1–5 are independent same-day wins that make the bar *look* native; 6 is the compliance floor; 7–8 fix the layout-breaks; 9–12 are the IA/behavior re-architecture (do after tokenization so new markup is born theme-correct); 13 locks it.

---

## Redesign — ShufflewickPub Skin & Game Hosting

The host app is the tavern. Its job is to seat the player, hand off to the game, then disappear — and to be the one place that survives when the game (a sandboxed, cross-origin iframe) cannot speak for itself: connection health, screen-reader narration, and the exits. Today it does the opposite: it renders the lobby in cool PrimeVue slate, slides its entire nav off-screen while leaving it in the tab order, swallows mid-game disconnects in silence, and lets the theme toggle lie about a neon iframe it can't reach. The redesign below treats connection state and announcements as first-class chrome, themes the host globally through a single PrimeVue preset, and reduces in-game chrome to a single reachable, safe-area-aware handle.

### Greenfield ideal

#### 1. The single source of truth: a tavern preset, not per-element color classes

The root cause of the "generic admin panel" lobby (`GameLobby.vue:6`, `LobbyPlayerList.vue` using `text-surface-400/500/600/700`, `border-surface-300`, `bg-surface-100/200`) is that `nuxt.config.ts:37` ships `preset: Lara` with **no** `definePreset`/surface override, while `main.css:466–487` only recolors legacy `.text-gray-*`/`.bg-white`. Every `surface-*` and `bg-primary` utility therefore resolves to Lara's cold slate.

Fix it once, globally. Define a warm preset so markup needs zero per-element color classes:

```ts
const Tavern = definePreset(Lara, {
  semantic: {
    surface: {           // brown ramp, mapped from existing main.css tokens
      0:  '#ffffff', 50: '#1f1c17', 100: '#1b1812', 200: '#241f18',
      300: '#3a3026', 400: '#6b5d49', 500: '#8a7a60', 600: '#b9a585',
      700: '#d7b06a', 800: '#ece0c6', 900: '#f7f0de', 950: '#fbf6ea',
    },
    primary: {           // gold/bronze, from --accent / --accent-strong
      500: '#d7b06a', 600: '#caa052', 700: '#f1c879',
    },
  },
});
```

This kills the lobby-gray finding, the off-brand status chips (replace `#9b59b6` AI badge, `bg-green-100`, `text-orange-500` in `LobbyPlayerList.vue:55–99` with `--success`/`--warning`/`--accent` tokens), and the unthemed fallback/overlay panels in one move.

#### 2. Connection state is chrome, not an afterthought

The worst defect is invisible: `play/[sessionId].vue:267–272` only reacts to `onclose` when `phase==='connecting'||'lobby'`. A drop during `playing`/`complete` freezes the iframe with **zero feedback and no reconnect** — the single most common real-world failure (sleep, wifi blip, redeploy).

Introduce one reactive `connectionState: 'live' | 'reconnecting' | 'lost'` that the stage reads, independent of `phase`:

- **`live`** — normal.
- **`reconnecting`** — `onclose` during play. Dim the iframe (`opacity: 0.5`, no `pointer-events`), show a non-blocking warm banner top-edge: *"Reconnecting to the table…"* in Cinzel on `var(--panel-gradient)`. Auto-retry the join/host-credential flow with exponential backoff (1s, 2s, 4s, 8s, cap 30s).
- **`lost`** — backoff exhausted. Banner becomes a CTA: a gold `PButton` **"Rejoin game"** + a secondary **"Back to Shufflewick."** Map known WS close codes to friendly copy; tuck the raw `event.reason` behind a `<details>` disclosure (it currently leaks verbatim into `<p>{{ errorMessage }}</p>`).

The error phase (`play:50–63`) gets the same treatment: extract `onMounted`'s connect logic into a `connect()` function and wire an in-place **Retry** button so a transient blip never forces a full navigation round-trip.

#### 3. The host is the only voice for a sandboxed game — give it live regions

Because the game is a cross-origin sandboxed iframe, the host cannot introspect it, which makes the host the *only* place screen-reader announcements can live — and there are currently **zero** (`grep aria-live|role="status"|role="alert"` → no hits). This is total silence on turn changes, joins/drops, and the winner.

Layout owns two visually-hidden regions:

```html
<p class="sr-only" aria-live="polite">{{ announcement }}</p>   <!-- state -->
<p class="sr-only" aria-live="assertive">{{ alert }}</p>       <!-- errors -->
```

Drive `announcement` from the `phase` watcher and `handleWsMessage` cases: *"Lobby — 3 of 8 players"*, *"Game started, you are seat 2"*, *"Maeve disconnected"*, *"Game over. Winner: Bram."* Drive `alert` from `connectionState==='lost'`. Extend the GameFrame postMessage contract with an **`announce`** message type so the game bundle can relay in-game turn narration ("Your turn") up into the host's polite region — define it alongside `server_request`.

#### 4. The iframe and its overlays must be real, named, focus-managed regions

- **Name the game.** `GameFrame.vue:6–13` has no `title`. Add a `gameName` prop (the play page already has `session.gameDisplayName`) and bind `:title="`${gameName} — game board, you are seat ${seat}`"`. (S, hard AA fail otherwise.)
- **Game Over is a dialog.** `play:17–38` is an anonymous `bg-black/40` div — not announced, no focus move, iframe behind it still focusable. Replace the hand-rolled scrim with **PrimeVue `PDialog`** (already a dependency): it provides `role="dialog"`, `aria-modal`, and focus trap for free. Title becomes an `<h2 id="gameover-title">`; feed the winner into the assertive region.
- **Never dead-end.** The overlay's only exit is a text-link *"Play again"* gated on `session?.gameSlug` (`play:17–38`) — falsy slug = trapped behind a dim scrim. Always render **two `PButton`s**: primary *"Play again"* (un-gate the fallback exit) and secondary *"Back to Shufflewick,"* plus a *"View final board"* dismiss.
- **Warm scrim.** Swap `bg-black/40` for `rgba(13,12,9,0.66)` (`var(--bg-0)`) with a soft radial candle vignette — cold flat black is the #1 tell of a default web modal at the emotional peak.
- **Fluid card.** Replace the fixed `w-80` (`play:21`) with `w-[min(90vw,24rem)]` so it breathes on ≤320px and isn't lost on desktop.

#### 5. In-game chrome: one handle, reachable, out of the center

The pull-tab is the only in-play affordance and it is wrong on three axes: it's a 40px image-only button (`main.css:273–278`, below the 44px target, hit area == PNG), it's parked **dead-center top** (`.shade-tab { left:50%; transform:translateX(-50%) }`) — exactly where boards put turn/score banners — and it bleeds under the notch (no `env(safe-area-inset-*)` anywhere).

Greenfield handle:
- **Dock to a top corner**, not center, so the game owns top-center exclusively. Offset by `env(safe-area-inset-top)` and a side inset for landscape.
- **≥44×44 hit area** via transparent padding around the 40px sign (or a `::before` hit box).
- **Discoverability:** add a downward chevron/grab-notch and a one-time ~8px "peek" nudge on first game load (gated by a `localStorage` seen-flag) plus `title="Menu"`. The sign image alone reads as a decorative watermark.
- **Auto-hide is optional** and lower-priority (the reviewer rated permanence "overstated" since a corner dock already clears the board); if added, fade to ~0.15 opacity after 3s idle, full on hover/proximity.

#### 6. The nav shade: inert when closed, compact when open, explicit exit

- **Inert when closed.** `main.css:241–249` hides the nav with `transform: translateY(-100%)` only — brand, theme switch, Publish, avatar, **Log out** stay focusable off-screen (focus vanishes with no visible indicator). Bind `:inert="playActive && !shadeOpen"` + `aria-hidden`, keeping the tab outside the `<nav>`. On open: move focus to the first control, trap focus, **Escape** closes and restores focus to the tab.
- **Explicit "Leave game."** Today the only route out of a match is clicking the brand wordmark (`default.vue:13–16`), which silently drops the WS — undiscoverable *and* dangerous. Add a labeled **Leave game** item that emits to the play page and shows a `PConfirm` when `phase==='playing'` (*"Leave this game? Your seat will be forfeited."*). Separate "go home" from "leave game" semantics.
- **Compact in-play variant.** The `@media (max-width:880px)` column reflow (`main.css:507–525`) turns the in-play shade into a tall stacked marketing nav with **no `max-height`/scroll** — Log out can fall off a landscape phone. Branch a slim single-row icon variant (~56px, no display-name text) for `playActive`, and add `max-height: 100dvh; overflow-y: auto` as a safety net.

#### 7. Theme honesty: forward it across the iframe boundary

`default.vue:110–118` `toggleTheme` only sets `data-theme` on the host; `GameFrame.vue:58–64` init sends `{seat, playerCount}` with **no theme**, and `.game-stage` (`play:96–103`) is `position:fixed; inset:0` with **no background**. Result: light mode = a dark neon rectangle filling the viewport; during play the tavern is gone except the 40px tab.

- Add `background: var(--bg-base)` to `.game-stage` so any letterbox/loading/aspect gap stays warm.
- Extend the GameFrame `init` payload with `theme` plus a token map (`--bg-base`, `--accent`, `--text`, `--line`…) so BoardSmith chrome can adopt host colors; re-send on toggle via shared `useGameChrome` state. (Host side S; needs BoardSmith cooperation — out of this surface's control, but the contract lives here.)

#### 8. Lobby IA: state the count, surface the action

`GameLobby.vue:3–10` titles only `gameName` + a "Lobby" tag; `minPlayers/maxPlayers` are passed but never rendered and `playersNeeded` (line 119) is computed and dropped. Guests see a passive *"Waiting for host…"* while their one job (Ready) hides inside a `LobbyPlayerList` row.

- Headline: **"Players 3 / 8 — waiting for 1 more"** (render `playersNeeded`).
- Promote the guest ready toggle to a large primary `PButton` **"I'm Ready,"** mirroring the host's Start placement.
- Copy button (`GameLobby.vue:65–72`): always `aria-label="Copy invite link"` (it's icon-only with `label:undefined` today); announce success via a `role="status"` node; on `catch` (`GameLobby.vue:137–145` currently swallows silently) select the input and toast *"Press Ctrl/Cmd+C to copy."*

#### 9. Spacing, motion, viewport, landmarks — the discipline layer

- **Spacing scale.** Replace the one-off magic rems (`0.42`, `0.55`, `0.84`, `0.9`, `0.95`, `1.1rem` across `main.css`) with an 8px token set: `--space-1:.25rem … --space-6:1.5rem` and `--radius-sm/md/lg: .375/.625/.875rem`. Express all chrome padding/gap/radius in tokens only so "tighten the chrome" is one edit.
- **Reduced motion.** No `prefers-reduced-motion` anywhere; the shade slides a full viewport height. Add the global guard and swap the slide for an opacity fade under the query:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *,::before,::after { transition-duration:.01ms!important; animation-duration:.01ms!important; }
    .site-nav--shade { transition:none; }
  }
  ```
- **Dynamic viewport + safe area.** Swap `min-height:100vh` (`main.css:123`) → `100dvh`; pin `.game-stage` with `top:0; height:100dvh` (not `bottom:0`) so the game's bottom action bar isn't eaten by the mobile URL bar. Add `viewport-fit=cover` to the meta and forward the four `env(safe-area-inset-*)` values into the iframe `init` so BoardSmith can pad its bottom bar.
- **Background performance.** Drop `background-attachment: fixed` (`main.css:99–100`) — janky/ignored on iOS Safari; paint the candle glow on a `position:fixed` decorative layer like `.site-grain` already does.
- **Landmarks.** Add a focus-visible **skip link** as the shell's first child targeting `#main`; give `<main>` an `id`; promote the lobby game name from a styled PCard-title div to a real `<h1>` so heading navigation and the document outline work.

#### Responsive targets

- **Phone (~375px, primary):** `100dvh` stage, safe-area insets on stage + corner tab, ≥44px handle, slim single-row in-play shade, fluid `min(90vw,24rem)` overlay.
- **Tablet (768–1024px):** align host nav/grid collapses to **768/1024** to match BoardSmith's 768 breakpoint, replacing the unaligned 960/880/640 trio (`main.css:501/507/527`) so chrome and board never reflow at different widths.
- **Desktop (1440px+):** lobby content max-width capped and centered on the warm background; the corner pull-tab is unobtrusive; Game Over dialog uses its `24rem` max so it reads as intentional, not undersized.

### Map-back from current code

Ordered by leverage (theme + connection health unblock the most), with effort.

| # | Change | Files | Effort |
|---|--------|-------|--------|
| 1 | `definePreset(Lara, {surface, primary})` mapping `surface-50..950`/`primary` to the brown/gold tokens already in `main.css`; remove per-element `surface-*`/inline-hex/raw-Tailwind color classes from the 5 Lobby components | `nuxt.config.ts:37`, `GameLobby.vue`, `LobbyPlayerList.vue` (+Options/Assignments/GameOptions) | **M** |
| 2 | Add `connectionState` ref; in `onclose` add a `playing`/`complete` branch → `'reconnecting'` + `reconnect()` backoff re-running join/host flow; render warm banner overlay in `.game-stage`; on exhaustion → `'lost'` CTA | `play/[sessionId].vue:267–272`, `GameFrame.vue` | **M** |
| 3 | Add two `sr-only` `aria-live` regions; set `announcement`/`alert` in the `phase` watcher and `handleWsMessage` cases (`337–393`); extend GameFrame bridge with `announce` postMessage type | `play/[sessionId].vue`, `GameFrame.vue` | **M** |
| 4 | Add `gameName` prop + `:title` to iframe | `GameFrame.vue:6–13`, `play/[sessionId].vue` | **S** |
| 5 | Replace Game-Over `absolute inset-0` div with `PDialog` (role/aria-modal/focus-trap free); `<h2 id>`; two `PButton` exits un-gated from `gameSlug`; warm scrim `var(--bg-0)`; `w-[min(90vw,24rem)]` | `play/[sessionId].vue:17–38` | **S/M** |
| 6 | `:inert="playActive && !shadeOpen"` on `<nav>` (tab stays outside); Escape handler + focus move/restore in `shadeOpen` watcher; add explicit **Leave game** item w/ `PConfirm` | `app/layouts/default.vue`, `composables/useGameChrome.ts` | **M** |
| 7 | `.game-stage { background: var(--bg-base) }`; add `theme` + token map + safe-area insets to GameFrame `init` (`60–63`); re-sync on `toggleTheme` via `useGameChrome` | `play/[sessionId].vue:96–103`, `GameFrame.vue:58–64`, `default.vue:110–118` | **M** (host S) |
| 8 | Lobby headline from `playersNeeded`/min/max; promote guest Ready to primary `PButton`; copy-button `aria-label` + `role="status"`; non-silent `catch` (select + toast) | `GameLobby.vue:3–10,65–72,119,137–145` | **S** |
| 9 | Move shade-tab to a corner w/ chevron + ≥44px hit area + `env(safe-area-inset-*)` + one-time peek; slim in-play shade variant w/ `max-height:100dvh; overflow-y:auto` | `default.vue:60–69`, `main.css:259–278,507–525` | **S/M** |
| 10 | Add `--space-*`/`--radius-*` tokens to `:root` (both themes); sweep ~15 literal rems | `main.css` (`123,159,204,207,318,342,356`), `default.vue`, `GameLobby.vue` | **M** |
| 11 | `prefers-reduced-motion` block; `100vh`→`100dvh`; stage `top:0;height:100dvh`; drop `background-attachment:fixed` → fixed pseudo-layer; consolidate 960/880/640 → 768/1024; `viewport-fit=cover` | `main.css:99–100,123,501–527`, `play/[sessionId].vue:96–103`, app head | **M** |
| 12 | Skip link + `id="main"`; `<h1>` lobby title; `role="status"`/`role="alert"` + spinner `aria-label` on connecting/error blocks; `:focus-visible` solid outline for inputs + raise `--focus-ring` alpha | `default.vue`, `GameLobby.vue:3–9`, `play/[sessionId].vue:43–63`, `main.css:30,435` | **S** |

**Sequencing note:** Items 1–3 are the spine — the preset makes every later visual fix free, and `connectionState` + live regions are the two structural gaps that no amount of CSS can paper over. Item 7 is the only one that requires BoardSmith-side cooperation; ship the host half (stage background, init payload) regardless so the contract exists when the engine consumes it.

---

## Accessibility Plan (WCAG 2.2 AA)

This is the binding accessibility contract for the *chrome* — the shell, host, dev bar, and the auto-generated board scaffolding. Individual game art is out of scope, but the renderers that wrap that art are not: today they ship mouse-only, unlabeled `<div>`s, which means the default "Auto UI" path produces a WCAG-failing product with zero warning. The Pit of Success is currently inverted. This plan flips it: accessible-by-construction primitives so a game author cannot ship an inoperable board even if they try.

### Conformance target

- **WCAG 2.2 Level AA** is the floor, gate-blocking for release.
- Selected AAA criteria adopted as policy because they're cheap and on-brand for a "calm tavern": **2.3.3 Animation from Interactions** (no unstoppable motion).
- Tested against: VoiceOver/Safari (macOS, iOS), NVDA/Firefox (Windows), and keyboard-only + 200% zoom on all three responsive targets (375 / 768–1024 / 1440+).

---

### 1. The two critical blockers (fix first, non-negotiable)

These two findings make the *default* configuration unplayable without a mouse. Everything else is secondary.

**C-1 — The board is 100% mouse-only.** Every interactive surface across all eight renderers is a bare `<div>`/`<g>` with `@click` and no `tabindex`/`role`/`@keydown` (e.g. `GridBoardRenderer.vue:188` `class="grid-cell" @click.stop`, `CardRenderer.vue:329`, `HexBoardRenderer.vue:208` `<g @click>`). Grep confirms zero `<button>`, `tabindex`, or `@keydown` in `renderers/` or `archetypes/`. **Fails SC 2.1.1 Keyboard (A).**

**C-2 — The action panel, the only keyboard-reachable surface, deletes itself.** `GameShell.vue:1382` removes the entire `<footer>` when `allCurrentChoicesAnchored` is true, and `ActionPanel.vue:255` `filterAnchoredChoices` strips anchored choices out of the panel. So when a game uses board-anchoring (the *encouraged* default), keyboard and SR users have no operable control at all.

**Contract:**
- **Board + panel parity, never board-only.** Anchored choices MUST also render as focusable `<button>`s in the action panel. `filterAnchoredChoices` returns a secondary "On the board" list instead of dropping choices; the footer `v-if` keeps the panel whenever `currentPick` has choices.
- **Renderers are focusable by construction.** A shared `useSelectable()` composable binds `@click` **and** `@keydown.enter`/`@keydown.space` to the same `triggerElementSelect`, and emits a real `<button>` (or `role="button" tabindex="0"` only where a button breaks layout). Grids adopt the **roving-tabindex grid pattern**: `role="grid"` → `role="row"` → `role="gridcell"`, arrow-key navigation between cells, Enter/Space to activate.
- **Drag has a single-pointer + keyboard alternative (SC 2.5.7, new in 2.2 AA).** Movement is modeled primarily as two-step selection: pick source → valid targets (the already-computed `isDropTarget` set) become click/Enter-activatable → activate target. Native HTML5 drag (`CardRenderer.vue:348 :draggable`, `PieceRenderer.vue:139`) stays as progressive enhancement only.

This is the load-bearing work (effort L). It must land before any visual polish, because polish on an inoperable board is wasted.

---

### 2. Semantic structure & landmarks

| Element | Required markup | Current state | Fix |
|---|---|---|---|
| Page skip link | `<a class="sr-skip" href="#main">Skip to game</a>` as first child | absent (`default.vue`, no `skip-link`) | S |
| Main region | `<main id="main">` | exists but no `id`/target | S |
| Lobby title | real `<h1>` | styled `<div>` in PCard `#title` slot (`GameLobby.vue:3`) | S |
| Game iframe | `:title="`${gameName} game board — seat ${seat}`"` | no `title` (`GameFrame.vue:6`) | S |
| Players list | `<ul role="list">`/`<li>` + `<h2>Players</h2>` | `v-for` of `<div class="player-card">` (`PlayersPanel.vue:41`) | M |
| Action bar | `<section role="region" aria-label="Your actions">`, **not** `<footer>` | inside `<footer>` = `contentinfo` landmark (`GameShell.vue:1382`) | M |
| Game History | `<h2>` + `<button aria-expanded>` toggle | clickable `<div>` toggle (`GameHistory.vue:132`), `<span>` title | S |
| Mobile heading | keep an `<h1>` (visible or `sr-only`) at every breakpoint | `h1 { display:none }` on mobile (`GameHeader.vue:114`) | S |

Rule: **structure is free when you use the right element.** No clickable `<div>` toggles, no `<strong>` standing in for a heading (dev bar `DevHost.vue:239`), no list-of-divs.

---

### 3. Naming: every control has an accessible name (SC 4.1.2 / 1.1.1)

`title` attributes do **not** count — they are unreliable for SR and invisible to touch/keyboard. Replace every icon-only control with an `aria-label`, and mark decorative glyphs `aria-hidden="true"`.

| Control | Accessible name | Evidence |
|---|---|---|
| Hamburger | `aria-label="Open menu"` + `aria-expanded` + `aria-controls` | `HamburgerMenu.vue:70` (3 empty `<span>`) |
| Close / Cancel / Clear ✕ | `aria-label="Close menu"` / `"Cancel action"` / `"Clear selection"`; glyph `aria-hidden` | `HamburgerMenu.vue:87`, `ActionPanel.vue:804,813` |
| Zoom slider | `aria-label="Board zoom"` + `:aria-valuetext="zoomPercent + '%'"` | `GameHeader.vue:61` (title-only, announces "1.5") |
| Copy invite link | `aria-label="Copy invite link"` (always, not just when copied) | `GameLobby.vue:65` (`label` undefined in default state) |
| Dev "Take seat" ×N | `:aria-label="`Take seat ${n} (open)`"` | `DevHost.vue:267` (N identical "Take seat") |
| Dev color swatches | `role="radiogroup"` + per-swatch `aria-label="{color name}"` + `aria-pressed` | `DevHost.vue:285` (title-only, 22px) |
| DebugPanel toggle/tabs | `<button aria-expanded aria-controls>`; tabs = `role="tablist"/tab/tabpanel` + `aria-selected` | `DebugPanel.vue:1182` (div toggle) |

---

### 4. Focus management & visible focus (SC 2.4.7, 2.4.11, 2.4.3)

There is currently **no `:focus-visible` rule anywhere** in the chrome, and two inputs actively destroy the ring: `ActionPanel.vue:1366 .number-input input:focus { outline: none }` and `GameHeader.vue:193 .zoom-slider { outline: none }`.

**Global focus token:**
```css
:focus-visible {
  outline: 2px solid var(--focus-ring-solid); /* #f1c879 warm gold */
  outline-offset: 2px;
}
```
- `--focus-ring-solid` = solid `#f1c879`, ≥3:1 against every adjacent surface (tavern brown `#12100d`, dev `#1a1b33`, board surface).
- This ring is **visually distinct from selection outlines** so "where focus is" and "what's selected" never collide on the board.
- Never `outline: none` without an equivalent replacement — delete the two offending rules.
- Host inputs (`main.css:30 --focus-ring: rgba(215,176,106,0.35)`) get a paired **solid** outline on `:focus-visible`; a 35%-alpha glow alone is borderline on near-black and fails the non-text-contrast bar.

**Modal focus contract (applies to hamburger drawer, Game Over overlay):**
1. `role="dialog" aria-modal="true"` + `aria-label`/`aria-labelledby`.
2. Move focus to first control (or heading) on open.
3. Trap Tab inside; apply `inert` to the rest of the app.
4. **Escape** closes.
5. Restore focus to the invoking control on close.

The hamburger drawer today has none of this (`HamburgerMenu.vue:81`, no role/trap/Escape). The Game Over overlay (`play/[sessionId].vue:17`) is a bare `absolute inset-0` div — **reuse PrimeVue `PDialog`** (already a dependency) to get role/modal/trap/focus for free.

**Off-screen-but-focusable trap:** when the nav shade is closed during play (`main.css:241 transform: translateY(-100%)`), its controls (Log out, Publish, theme) stay in the tab order. Bind `:inert="playActive && !shadeOpen"` on the `<nav>` so focus cannot land off-screen; expose only the pull-tab. On open: remove inert, focus first control, trap, Escape to close.

---

### 5. Live regions & SR narration (SC 4.1.3) — the largest gap

There is **zero `aria-live`/`role="status"`/`role="alert"`** in the shell, the board, the host (`app/`), or the dev bar. Every dynamic event — turn changes, opponent moves, joins/drops, winner, connection loss, toasts, errors — updates the DOM silently. A blind player gets total silence as the game advances.

> Note on severity: the source findings rate several of these "high" with a few "overstated." They are overstated only as *individual* items — collectively, "no live regions anywhere" is the single most important SR fix after keyboard operability. Treat the live-region layer as one coordinated workstream, not a scatter of patches.

**Architecture — three owned regions, one helper:**

1. **Polite status** (`role="status" aria-live="polite"`), visually hidden, one per surface:
   - **Host** (`play/[sessionId].vue`): phase + WS narration — "Lobby, 3 players", "Game started, you are seat 2", "Maeve disconnected", "Connecting to game".
   - **Shell/Board** (`AutoUI.vue`): turn + selection + end state — "Your turn", "Alice played 7 of hearts", "Game over — you win". Derive the string from `flowState`/turn/the existing `processedMessages` stream.
2. **Assertive alert** (`role="alert"`), visually hidden: fatal errors, connection lost, "This game is full", winner announcement.
3. **`GameHistory` message list** becomes `role="log" aria-live="polite" aria-relevant="additions"` so each new entry auto-announces — it already accumulates a clean `processedMessages` stream (`GameHistory.vue:156`).

**Cross-origin bridge:** the game runs in a sandboxed iframe the host cannot introspect. Add an `announce` message type to the GameFrame postMessage contract (alongside `server_request`); the game bundle relays turn narration to the host live region. Make `announce()` the *default* path every state transition calls so it can't be forgotten — that's the Pit of Success applied to narration.

**Also wrap as status/alert:** connecting spinner + `PProgressSpinner` `aria-label="Connecting to game"` (`play/[sessionId].vue:43`), error screen `role="alert"` (`:50`), shell error banner `role="alert"` (`GameShell.vue:1426`), time-travel banner `role="status"` + emoji `aria-hidden` (`:1404`), toasts (`Toast.vue:11`), dev-bar errors (`DevHost.vue:301`), "Copied" feedback.

---

### 6. Board narration: roles, labels, and state on every element

Board meaning is currently locked in CSS classes and color. Each renderer already computes `isSelected`/`isDisabled`/`isHighlighted`/`displayLabel` — bind those to ARIA from the *same source* so visual and semantic state cannot diverge.

- **One label builder**, shared across renderers and the hex SVG: `"e5, white knight, selectable"`. Promote the opacity:0 hover-only `.cell-notation` (`GridBoardRenderer.vue:349`) to a real AT-visible label.
- **State as ARIA, not class-only:** `aria-selected`, `aria-disabled`, `aria-current` driven by the existing booleans (today only `is-board-selected`/`is-disabled` classes, `GridBoardRenderer.vue:192`).
- **Grids** = `role="grid"`; **hands** = `role="group" aria-label="Your hand, 5 cards"` (today `HandRenderer.vue:269` has no role tying cards to an owner).
- **Hex SVG** (`HexBoardRenderer.vue:199`) gets `role="group"` + `aria-label`, each cell `<g>` an `aria-label` (coordinate + occupant + owner), and a non-color owner cue (initial/pattern) on piece circles — owner is currently `fill` color only (`:236`).

---

### 7. Don't encode meaning in color or motion alone (SC 1.4.1)

Every state below is color-only today; pair each with a non-color cue **and** a text/ARIA equivalent. Color reinforces, never carries.

| Distinction | Current (color-only) | Add |
|---|---|---|
| Selectable vs highlighted vs selected | green outline / cyan bg / green bg + pulse (`GridBoardRenderer.vue:309`, `CardRenderer.vue:432`) | dotted vs solid border, check/ring icon for selected, always-on aria-label |
| Active turn | cyan card bg + pulsing dot (`PlayersPanel.vue:72,101`) | `aria-current="true"` + sr-only "current turn" + static border |
| History message type | `border-left-color` only (`GameHistory.vue:289`) | text prefix ("Error:", "System:") or icon |
| Selected choice | `border-color:#00ff88` (`ActionPanel.vue:1442`) | `aria-pressed` + checkmark |
| Dev connection/seat | green/grey dot, cyan "mine" border (`DevHost.vue:262`, CSS:412) | `aria-label="Connected"`, `aria-current` + "You" chip |
| Lobby player color/ready/dropped | color swatch + dot | color *name* in `aria-label`, text badges for ready/disconnected |

---

### 8. Contrast (SC 1.4.3 / 1.4.11)

The chrome bypasses its own `theme.ts --bsg-*` tokens with hardcoded greys that fail on dark surfaces:

- `#666` ≈ 2.5–2.8:1 (clear fail): `GameHistory.vue:231,306,317,353`, `GridBoardRenderer.vue:348 .cell-notation`, `DeckRenderer.vue:269`, `SpaceRenderer.vue:261`.
- `#888` ≈ 4.1–4.5:1 (borderline/fail): `ActionPanel.vue:1388 .waiting-message` (carries whose-turn info!), `GridBoardRenderer.vue:255`, `HandRenderer.vue:464`, `DieRenderer.vue:174`.
- Dev open-seat `#778` italic ≈ 4.3:1 on `#0f1020` (`DevHost.vue` CSS:434).
- `opacity: 0.35` stacked on already-dim disabled text/outlines (`CardRenderer.vue:477`, `GridBoardRenderer.vue:360`) — fails text *and* 1.4.11 for the outline.

**Contract:** define exactly two tavern text tokens, contrast-verified against the brown surfaces, and route all greys through them:
- `--bsg-text` = `#f7f0de` (primary off-white, ≥12:1).
- `--bsg-text-muted` = a **warm** `~#b8a888` / `#b9a98a`, verified ≥4.5:1 on `#12100d` and on the board surface.
- **Disabled = non-opacity cue**: hatch pattern + `aria-disabled`, not dimming below readability.

This folds into the broader "stop bypassing theme.ts" rework — the tokens already exist.

---

### 9. Target size (SC 2.5.8, new in 2.2 AA)

Minimum **24×24 CSS px** hit area (44px target on touch) via `min-width`/`min-height` or padding, even when the glyph is tiny:
- `ActionPanel.vue:1163 .cancel-btn { padding:2px 6px }`, `:1245 .clear-selection-btn { padding:0 4px }`
- `GameHistory.vue:241 .header-btn { padding:3px 8px; font-size:10px }`
- `HamburgerMenu.vue:144 .hamburger-btn { width:28px; height:20px }` (20px tall)
- `DevHost.vue` color swatches `22×22px` → bump to 24px.

---

### 10. Reduced motion (SC 2.3.3 + policy)

`prefers-reduced-motion` appears only in `animation/` helpers — **never** in the chrome or any renderer. Offenders: the **infinite** turn-dot pulse (`PlayersPanel.vue:106 pulse-glow 1.5s infinite`), eight infinite renderer pulses (`GridBoardRenderer.vue:312`, `CardRenderer.vue:443`, etc.), drawer/toast slides, the full-viewport nav shade slide (`main.css:247`), tile hover lifts.

**Contract:**
- Host global reset:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
  ```
- Wrap decorative pulses in `@media (prefers-reduced-motion: no-preference)` and centralize the eight copy-pasted `.action-selectable` rules into **one** shared stylesheet so this is a single gate, not eight.
- Replace the infinite pulse with a **static** high-contrast border + sr-only "current turn" label — satisfies reduced-motion *and* the color-only fix at once.
- Shade slide → instant/opacity fade under `reduce`.

---

### 11. Character-key shortcut (SC 2.1.4)

`DebugPanel.vue:316` binds bare `'d'`/`'D'` on `window`, guarding only `HTMLInputElement`/`HTMLTextAreaElement` — not contenteditable/select, no modifier, no off switch. Speech-input users misfire it. **Fix:** require `Ctrl/Cmd+Shift+D` *or* scope the shortcut to when the panel/toggle has focus, broaden the editable guard, and add a disable flag.

---

### Dev verification checklist

A PR touching the chrome must pass all of these. Each maps to a criterion above.

**Keyboard (A — gate-blocking)**
- [ ] Every move can be made with keyboard only — including board-anchored and drag-based games (C-1, C-2, 2.5.7).
- [ ] Action panel renders anchored choices as focusable buttons; never fully suppressed while choices pending.
- [ ] Grid uses roving-tabindex + arrow keys; Enter/Space activates.
- [ ] Tab order is logical; no focus lands on off-screen nav (shade `inert` when closed).
- [ ] All modals: focus moves in, traps, Escape closes, focus restores.

**Name/Role/Value (A)**
- [ ] No control relies on `title` for its name; every icon button has `aria-label`; decorative glyphs `aria-hidden`.
- [ ] iframe has a descriptive `title`; hamburger has `aria-expanded`; tabs use the ARIA tab pattern.
- [ ] Board elements expose `aria-label` + `aria-selected`/`aria-disabled`/`aria-current` from the same booleans as the CSS.

**Status messages (AA)**
- [ ] Turn change, opponent move, join/drop, winner, error, connection loss each announce via a live region.
- [ ] GameHistory is `role="log" aria-live="polite"`; assertive region exists for errors.
- [ ] `announce` postMessage bridge wired host↔iframe.

**Perceivable**
- [ ] No information by color alone — every state has a second cue (icon/border/text).
- [ ] All text ≥4.5:1; muted text uses `--bsg-text-muted`; disabled uses hatch not opacity.
- [ ] `:focus-visible` ring (2px gold, 2px offset, ≥3:1) on every interactive element; zero `outline:none` without replacement.

**Operable**
- [ ] All targets ≥24×24px.
- [ ] `prefers-reduced-motion: reduce` stops all animation; no infinite unstoppable motion.
- [ ] No bare single-char shortcut without modifier/focus-scope/disable.

**Tooling:** axe-core in CI on host pages, plus a board-renderer Storybook axe pass; one manual VoiceOver + NVDA run per release across the three breakpoints.

### Migration sequencing

1. **Wave 1 (gate):** C-1 + C-2 keyboard operability via `useSelectable()`/`useBoardInteraction` (L) — nothing ships AA without it.
2. **Wave 2:** the live-region layer + `announce` bridge across host/shell/board (M), and the global `:focus-visible` + modal focus contract (M).
3. **Wave 3 (mechanical, parallelizable):** naming, landmarks, target sizes, contrast tokens, color-plus-cue, reduced-motion gate — mostly S, batch by component.

The ordering matters: keyboard first (an unoperable board can't be announced meaningfully), then narration, then polish.

---

# Part II — Prioritized Roadmap

## Prioritized Roadmap

This roadmap sequences the full redesign into six waves. The ordering is dictated by one hard dependency that surfaces in nearly every finding: **the `theme.ts` token layer is dead code, three color namespaces (`--bsg-*`, `--bs-*`, `--bg-*`) coexist, and its defaults describe a *third* (light blue) palette that nobody consumes.** Until a single token contract exists with tavern defaults, every visual fix is a hand-edit of literals across ~20 files and every "theme swap" is unrepeatable. So Wave 1 builds the foundation, Wave 2 spends it, and Waves 3–6 layer IA, responsiveness, accessibility, and material polish on top.

Effort key: **S** ≈ <½ day, **M** ≈ ½–2 days, **L** ≈ 3+ days. "Touches" lists the load-bearing files.

---

### Wave 0 — Quick wins (ship immediately, no dependencies)

These are isolated, low-risk, high-visibility fixes that do not need the token system. Land them first to bank credibility and de-risk later waves.

| Deliverable | Files | Effort | Why now |
|---|---|---|---|
| Give the game iframe an accessible name (`:title="`${gameName} game board`"`) | `GameFrame.vue:6-13` (add `gameName` prop from `session.gameDisplayName`) | S | The entire game is currently an unnamed "frame." Pure win. |
| Replace 5× `alert()` and 3× `console.error` with `toast.error(result.error)` | `GameShell.vue:755,825,908,939,944,482,494`; `ActionPanel.vue:675,729` | S | Rejected moves are silently swallowed today; toast system already exists. |
| Delete dead menu items + engine branding | `HamburgerMenu.vue:55-62` (Settings/Help), `:84` (`BS`), `:128` (`BoardSmith Dev Mode`) | S | Two no-op items and competing product identity in player chrome. |
| `aria-label` + `aria-expanded`/`aria-controls` on icon-only buttons; `aria-hidden` on glyph spans | `HamburgerMenu.vue:70,87`; `ActionPanel.vue:804,813`; `GameHeader.vue:58` | S | Hamburger and ✕ buttons currently announce as "button"/"multiplication x." |
| `100vh` → `100dvh` (with `100vh` fallback) | `GameShell.vue:1441,1451,1483`; `HamburgerMenu.vue:192`; host `main.css:123`, `[sessionId].vue:99` | S | Sticky bottom action bar clips under mobile toolbars. |
| Safe-area insets on every fixed/sticky edge + `viewport-fit=cover` | `GameShell.vue:1552` action bar, `GameHeader.vue:97`; host `.game-stage`, `.shade-tab`; nuxt head | S | Action bar + pull-tab fall under the notch/home indicator. |
| Game Over exit: `Play again` becomes a `PButton`, add always-present "Back to Shufflewick," remove the `gameSlug` gate that can trap the player | `[sessionId].vue:17-38` | S | End-game can dead-end with no exit and a tiny text link. |

**Risk:** negligible. **Dependency:** none.

---

### Wave 1 — Token foundation (the keystone)

Build the single source of truth that Waves 2–6 consume. No visible redesign yet beyond defaults; this is plumbing.

**Deliverables**
1. **Collapse to one namespace, `--bsg-*`.** Rename all `--bs-*` (drop-target/hover) and the orphan `--bg-*`/`--text-*`/`--border-*` (ActionPanel's light-fallback block) into `--bsg-*`. Kill the contradictory light defaults.
2. **Repoint `theme.ts` defaults to the warm tavern palette** (replacing `theme.ts:22-29`'s `#f5f5f5`/`#1a1a2e`/`#4a90d9`):
   - `--bsg-bg: #12100d`, `--bsg-surface: rgba(20,16,10,.55)`, `--bsg-surface-raised`, `--bsg-edge: rgba(215,176,106,.15)`
   - `--bsg-ink: #f7f0de`, `--bsg-ink-muted: ~#b8a888` (verified ≥4.5:1 on the brown — replaces every `#888`/`#666`)
   - `--bsg-accent: #d7b06a`, `--bsg-accent-strong: #f1c879`, `--bsg-danger`, `--bsg-success: #7cbc8a`, `--bsg-warn`
   - interaction tokens: `--bsg-selectable` (warm gold low-alpha), `--bsg-selected` (`#f1c879`), `--bsg-droptarget`, `--bsg-ring`, `--bsg-elevation: 0 2px 10px rgba(0,0,0,.45)`
   - **spacing scale** (4px base): `--bsg-space-1..6 = 4/8/12/16/24/32px`, `--bsg-radius-sm/md`, `--bsg-bar-h`, `--bsg-density`
   - **fonts:** `--bsg-font-display: 'Cinzel', serif`, `--bsg-font-body: 'Source Sans 3', system-ui`
   - **seat palette:** `--bsg-seat-1..6` (the muted, ~30%-desaturated set — replaces the hardcoded Flat-UI cycle in `HexBoardRenderer.vue:108`)
3. **Make `applyTheme()` the sole knob** and have the host call it once on iframe init: extend `GameFrame.vue`'s init postMessage (`:58-64`) to forward `theme` + the tavern token map; `useGameChrome` shares theme state so a toggle re-syncs the iframe.
4. **Lint guard (pit of success):** add a stylelint `color-no-hex` rule scoped to chrome/renderer components so the next contributor *cannot* reintroduce a literal.

**Touches:** `theme.ts` (rewrite), `GameFrame.vue`, `useGameChrome.ts`, `[sessionId].vue`, plus the host→iframe postMessage contract.
**Effort:** M (theme.ts + bridge). The sweep itself is Wave 2.
**Dependency:** none, but blocks Waves 2, 5, and the visual half of 6.
**High-risk note:** flipping the default exposes the latent collision — renderers assume a *dark* ground (`color:#fff`, `rgba(255,255,255,.05)` surfaces) while the old default was light. Land the token defaults and the renderer sweep (Wave 2) in the **same merge** so `main` is never in the half-swapped state where white ink sits on a near-white page.

---

### Wave 2 — Theming swap (make it the tavern)

Mechanically spend the tokens; this is where the product visibly changes from neon-noir to candlelit pub.

**Deliverables**
- **Backdrops go transparent/warm.** Replace the two hardcoded gradients (`GameShell.vue:1443`, `HamburgerMenu.vue:193`) with `background: transparent` in platform mode (let the host's `#0d0c09` + candle radials + grain show through) and a `var(--bsg-bg)` fallback in dev. Swap every `color:#fff` → `var(--bsg-ink)`.
- **Renderer interaction sweep (8 renderers + hex `<g>`):** find/replace `#00d9ff`/`#00ff88`/`rgba(46,204,113…)` literals → `var(--bsg-selectable|selected|droptarget)`; convert glow box-shadows (`PieceRenderer.vue:242`, `CardRenderer.vue:429`, `DeckRenderer.vue:192`, etc.) to warm `--bsg-elevation` + optional `--bsg-ring`. **Switch HandRenderer from `border` to `outline`** so it stops being the one outlier that reflows layout (`HandRenderer.vue:397` vs the other five).
- **Type system:** body → `var(--bsg-font-body)`; `h1`/`.logo-text`/`.config-title`/deck+zone headings → `var(--bsg-font-display)`; delete the two gradient clip-text blocks (`GameHeader.vue:115-120`, `HamburgerMenu.vue:230-233`) for solid gold with a faint dark text-shadow.
- **Primary action button** → brass: `var(--bsg-accent)` fill, dark-ink label, `var(--bsg-elevation)`, no colored glow (`ActionPanel.vue:1103-1118`).
- **Active-player cue** → calm candle: amber dot, opacity-only breathe, warm gold card border (`PlayersPanel.vue:101-119,72-75`).
- **Surfaces** → warm semi-opaque "parchment under candlelight": `var(--bsg-surface)` + `var(--bsg-edge)` hairline, replacing `rgba(0,0,0,x)` glass and `rgba(255,255,255,.1)` borders across `GameHeader`, `GameShell` sidebar/action-bar, `GameHistory`, `PlayersPanel`, and the renderer zone cards.
- **Default card back** → tavern stock (oxblood/bottle-green felt or aged-parchment + thin gold rule), one shared `--bsg-card-back` token consumed by `CardRenderer.vue:547` and `HandRenderer.vue:554`.
- **Host lobby (first impression):** add a PrimeVue `definePreset(Lara, { semantic: { surface: <warm brown ramp>, primary: <gold/bronze ramp> } })` in `nuxt.config.ts` so `surface-*`/`bg-primary` utilities inherit the tavern palette globally — fixes the entire Lobby + overlays in one move (`GameLobby.vue`, `LobbyPlayerList.vue`). Replace the inline `#9b59b6`/`bg-green-100`/`text-orange-500` role chips with token classes.
- **DevHost recolor:** swap the four indigo/neon literals (`DevHost.vue:353-359,517,413,505-508,542-550,493-497`) for tavern tokens; demote the emerald "New game" to a quiet outline (also see Wave 6 confirm-step).

**Touches:** the 8 chrome files, 8 renderers + 4 archetypes, `DevHost.vue`, `nuxt.config.ts`, host lobby components.
**Effort:** L (broad but mechanical once tokens exist).
**Dependency:** Wave 1. **Quick sub-win:** the `#00d9ff` info-accent (toasts, slider thumb, history bullets, "you" badge) recolors *automatically* the instant the literal becomes `var(--bsg-accent)`.

---

### Wave 3 — IA & responsive (get out of the way; make the board the hero)

**Deliverables**
- **Kill the standing header in platform mode.** Gate `<GameHeader>` behind `v-if="!platformMode"` (`GameShell.vue:1286`); fold connection status into a small corner dot; relocate Leave/New-Game into the host's nav shade over the existing `handleMenuItemClick` bridge. The host owns top chrome — stop stacking a third bar.
- **Persistent turn ribbon + prompt (never disappears).** Render one always-on prompt line driven by `boardPrompt ?? currentPick.prompt` (the wired-but-never-rendered `setBoardPrompt`, `GameShell.vue:472`); suppress only the action *buttons* when choices are board-anchored, never the prompt (`GameShell.vue:1382`). Add a strong "Your turn / Alice is playing…" status that survives all breakpoints, replacing the sidebar-only pulsing dot.
- **Action bar only when actionable.** Extend the footer `v-if` to require `isMyTurn || awaitingPlayerNames.length`; surface "It is X's turn" on the seat chip instead of a full glass slab. Give the panel `max-height: min(40vh, 320px)` + internal scroll, and drive the board's bottom reservation from a `ResizeObserver` var instead of the constant `80px`/`60px` (`GameShell.vue:1496`).
- **Fluid board sizing (retire the zoom slider as the fit strategy).** Add `container-type: size` to the board archetypes; compute a `--cell` from `gridResult.cols/rows` (`clamp(28px, min(cqw/cols, cqh/rows), 96px)`) and replace the fixed `50px`/`20px` in `GridBoardRenderer.vue:288,249`. Same treatment for `HexBoardRenderer` (`max-height:80vh; overflow:hidden` → fit-to-container, `auto` safety). Parameterize hand cards: `--card-w: clamp(44px, 14cqw, 84px)`, controlled shrink, scroll-snap track with ≥44px exposed tap zone, `max-height: clamp(96px, 22vh, 180px)` (`HandRenderer.vue:551`, `GridBoardTemplate.vue:128`). Demote the slider to an a11y magnifier.
- **Real breakpoint tiers.** Replace the lone 768px snap with compact/medium/wide tiers; `clamp()` sidebar `clamp(220px, 22vw, 320px)`; centered `max-width` board stage on ≥1280; **phone = board fills viewport, players collapse to a one-line seat strip, history becomes an on-demand bottom sheet** (drop the standing `max-height:40vh` aside, `GameShell.vue:1517`). Add an `orientation: landscape and (max-height:600px)` rule that switches to the row layout. Align host breakpoints (`960/880/640`) to a shared `640/768/1024/1440` scale.
- **Fluid spacing in archetypes:** `gap: clamp(6px, 2cqw, 24px)`; cap peripheral zones so chrome can never out-grow the `1fr` board; Tableau's `32px` → `var(--bsg-space-4)`.
- **Connection health as first-class state (host).** Add `connectionState: 'live'|'reconnecting'|'lost'`; on `onclose` during `playing`/`complete`, show a warm non-blocking "Reconnecting…" banner + backoff retry, keep the iframe mounted (`[sessionId].vue:267`; dev `DevHost.vue:90,231`). Replace the platform-mode hardcoded `'connected'` badge (`GameShell.vue:1289`) with a real postMessage heartbeat.
- **Game Over result card.** Replace the `AutoUI.vue:37-42` "Game Over!" banner with a result component fed by `flowState` winners/scores, final board visible behind a warm scrim (`rgba(13,12,9,.66)` + candle vignette), Rematch / New Game / Back to Tavern as primary buttons.
- **Host pull-tab affordance:** add a downward chevron + one-time peek bounce + tooltip; move it off dead-center top (corner or auto-hiding edge) so it stops occluding the board's turn/score zone; ≥44px hit area.

**Touches:** `GameShell.vue`, `GameHeader.vue`, `ActionPanel.vue`, `AutoUI.vue`, `AutoRenderer.vue`, all renderers/archetypes, host `[sessionId].vue`, `default.vue`, `main.css`, `DevHost.vue`.
**Effort:** L.
**Dependency:** Wave 1 (tokens for spacing/sizing); soft-couples with Wave 2.
**High-risk note:** the standing-header removal and Leave/New-Game relocation change the host↔iframe contract — test the postMessage bridge end-to-end. Fluid board sizing can regress published games that assumed 50px cells; validate against real bundles.

---

### Wave 4 — Accessibility (operability, announcement, semantics)

This wave contains the only **critical** findings that block whole user classes, so it cannot be deprioritized to "polish."

**Deliverables**
- **Keyboard-operable board (critical).** Centralize the copy-pasted `handleClick` into a `useSelectable()` composable that binds `@click` + `@keydown.enter/space` to the same `triggerElementSelect`, and emits real `<button>`/`role="button"` + `tabindex` + roving-tabindex grid (`role=grid/gridcell`, arrow nav). Apply to all 8 renderers + hex `<g>`. **Action-panel parity:** `filterAnchoredChoices` returns anchored choices in a secondary focusable list rather than dropping them, and the footer never fully suppresses when picks are pending (`ActionPanel.vue:255`, `GameShell.vue:1382`).
- **Two-step selection as the primary movement path** (drag becomes progressive enhancement): wire the already-computed `isDropTarget` set to click/Enter activation (`CardRenderer.vue:348`, `GridBoardRenderer.vue:151`, etc.).
- **Live regions everywhere** (3 surfaces): one visually-hidden `aria-live="polite"` (+ `assertive` for errors) in `GameShell`, `AutoUI`, the host `[sessionId].vue`, and `DevHost`. Make `GameHistory` messages `role="log" aria-live="polite"`. Host relays an `announce` postMessage from the bundle into its region; phase/WS transitions write "Your turn," "Maeve disconnected," "Game over — Bram wins," "Reconnecting."
- **Semantic names & state.** Each renderer computes an `aria-label` ("e5, white knight, selectable") and sets `aria-selected/-disabled/-current` from the same booleans driving CSS; grids `role=grid`, hands `role=group aria-label="Your hand, 5 cards"`, hex SVG `role=group` + per-cell labels + non-color owner glyph.
- **Non-color state cues.** Pair every color state with shape/icon/border-style + label (selected = ring/check, selectable = dotted vs solid drop-target), in the shared interaction CSS — booleans already exist.
- **Global `:focus-visible` ring:** `outline: 2px solid var(--bsg-accent-strong); outline-offset: 2px` on every interactive element; delete the two `outline:none` declarations (`ActionPanel.vue:1366`, `GameHeader.vue:193`).
- **Dialog semantics + focus management:** hamburger drawer and both Game Over overlays become `role="dialog" aria-modal` with focus move/trap, Escape-to-close, restore-on-close, and `inert` on the rest (incl. the host nav shade when closed during play, `default.vue` + `main.css:241`). Reuse PrimeVue `PDialog` for the host overlay.
- **`prefers-reduced-motion` guards** around every pulse/slide/toast/`background-attachment:fixed`; replace the infinite turn-dot pulse with a static high-contrast border.
- **Contrast + touch-target sweep:** route `#666`/`#888`/`opacity:.35` through `--bsg-ink-muted`; enforce `min-height:44px` (24px CSS-px floor) on action buttons, ✕ controls, hamburger, color swatches, dev controls.
- **Toasts** become `role="status"`/`assertive` with a real dismiss `<button aria-label="Dismiss">` and auto-timeout; skip-link + real `<h1>` on host lobby/play.

**Touches:** all 8 renderers + composables, `ActionPanel.vue`, `GameShell.vue`, `GameHistory.vue`, `PlayersPanel.vue`, `Toast.vue`, `HamburgerMenu.vue`, `DebugPanel.vue`, host `default.vue`/`[sessionId].vue`/`GameLobby.vue`, `DevHost.vue`.
**Effort:** L (board keyboard is the long pole; the rest is M of mechanical markup).
**Dependency:** Wave 1 (focus-ring token); benefits from Wave 3's IA but is independently shippable.
**High-risk note:** the board keyboard/semantics rework is architectural — do it once in the shared composable so divergence is impossible, and regression-test that drag still works as enhancement.

---

### Wave 5 — Material polish & dev/debug parity

**Deliverables**
- **Tavern material, not glass:** replace the uniform white dot-grid grain with low-opacity SVG wood/parchment noise + a screen vignette + a third candle glow placed low/center (`main.css:131,10-11`); add faint plank/seam motif and warm inset shadows to zones. Drop `background-attachment:fixed` for a fixed decorative layer.
- **Reskin `DebugPanel`** from `--bsg-*` (brass tab, parchment-on-dark, amber syntax); make its toggle a real `<button aria-expanded>`, gate the bare `D` shortcut behind a modifier + contenteditable guard, apply the ARIA tabs pattern, re-dock to a bottom sheet on phone, replace `calc(100vh-280px)` with flex `min-height:0`.
- **Dev chrome collapse:** auto-collapse the bar to a slim pull-tab (echoing the tavern sign), default-collapsed once seated, persisted in localStorage; icon-only controls below 640px with a `…` overflow; Cinzel title; drop the duplicated game title the iframe already renders.
- **Dev capability parity** (the dev's god-mode is the point): make the seat badge a **seat switcher** (wire or delete the dead `leaveSeat`), add a presence strip (who's connected/AI/away), and a tucked-away "Table setup" panel rendering the already-injected `aiSeats`/`aiLevel`/`playerCount`/`gameOptions`/`playerOptions` (currently surfaced nowhere).
- **Loading/empty/error voice:** "Lighting the candles…" skeleton with timeout→retry (`AutoRenderer.vue:154`); split `UnsupportedTopologyPanel` into a friendly player message + dev-only console/Debug guidance with a real link.
- **History/Clear cleanup:** make player history read-only; move Copy/Clear into DebugPanel (the local `clearHistory` silently un-clears today, `GameHistory.vue:90`).
- **Destructive-action guard:** the dev "New game" (broadcasts `restart` to all seats) gets a two-click confirm + neutral styling + broadcast toast.

**Touches:** host `main.css`, `DebugPanel.vue`, `DevHost.vue`, `AutoRenderer.vue`, `UnsupportedTopologyPanel.vue`, `GameHistory.vue`.
**Effort:** M–L. **Dependency:** Waves 1–2 (tokens).

---

### Dependency graph (at a glance)

```
Wave 0 (quick wins) ───────────────► ship anytime, independent
Wave 1 (tokens) ──┬─► Wave 2 (theming swap) ──┐
                  ├─► Wave 5 (material/dev) ◄──┤
                  └─► Wave 3 (IA/responsive) ──┴─► Wave 4 (a11y)
                                                   (focus token from W1;
                                                    benefits from W3 IA)
```

**Critical path:** Wave 1 → Wave 2/3 → Wave 4. Wave 0 and the host-only a11y quick wins run in parallel from day one.

**Highest-risk items (stage carefully, get explicit sign-off):**
1. `theme.ts` default flip — must merge atomically with the renderer sweep (invisible-text trap).
2. Board keyboard/semantics composable — architectural, all 8 renderers.
3. Fluid board sizing replacing fixed cells + zoom — can regress published bundles.
4. Standing-header removal + action relocation — changes the host↔iframe postMessage contract.

---

### Recommended first mockups for user review

Generate these four before any code, in priority order:

1. **Embedded play view, phone + desktop (the money shot).** Board as hero inside the ShufflewickPub tavern (host bg/grain/candle glow showing through), *no* BoardSmith standing header, a persistent warm turn ribbon, a brass primary action button, and the phone seat-strip + history-sheet layout. This validates the single biggest bet (chrome transparency + IA) at both responsive extremes.
2. **Token & state sheet.** Swatches for `--bsg-bg/surface/ink/ink-muted/accent/accent-strong/seat-1..6`, the Cinzel/Source Sans pairing, and the three interaction states (selectable / selected / drop-target) shown with their *non-color* cues — so the user signs off on the palette and the a11y-state language at once.
3. **Game Over result card** over a warm scrim with the final board visible (winner/scores + Rematch / New Game / Back to Tavern).
4. **Dev chrome:** collapsed pull-tab state vs. expanded bar with the seat switcher + presence strip + "Table setup" affordance, in the tavern skin.

Mockups 1 and 2 are the gating decisions; do not start Wave 2 until they're approved.
