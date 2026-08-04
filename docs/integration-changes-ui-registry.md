# Integration changes: the game UI registry

**For:** the Shufflewick.pub team
**Change:** BoardSmith games now declare their UIs in `src/ui/uis.ts` instead of in `App.vue` and `boardsmith.json`, and production bundles stop carrying code no game asked for.
**Breaking:** yes — for anything that reads a game's `ui` manifest field, mounts `GameShell` directly, imports `AutoUI`/`Die3D` from `boardsmith/ui`, or snapshots per-player state containing a `Deck`.

---

## TL;DR

1. **`boardsmith.json` no longer has a `"ui"` key.** If you read it, stop — it will be absent from every game, and `boardsmith validate` now rejects it. It was never a reliable field (see below).
2. **`GameShell` now requires a `uis` prop** and no longer has a `#game-board` slot. This only affects you if you mount `GameShell` yourself rather than loading a game's built bundle.
3. **Published bundles get much smaller** — roughly half, for most games. Cribbage went 1,046,898 → 480,005 bytes (**−54%**). Most of that is three.js, which every game was shipping whether or not it had dice.
4. **`Deck` visibility changed.** A draw pile now reports its card count again (faces still concealed). This is a per-player state-payload change — see §3b, the one item here that touches game data rather than build output.
5. **Two exports moved off the `boardsmith/ui` barrel** (`AutoUI`, `Die3D`) and one type was renamed (`ValidElement` → `BoardTarget` for the board-side shape). Only affects code importing them directly.
6. **Nothing changes in the iframe/postMessage embed contract.** No message types, payloads, origins, or lifecycle changed.

---

## 1. The `"ui"` manifest field is gone

Games used to carry an optional `"ui"` key (`"auto"` or a path to a `.vue` file). It is removed from the schema, the scaffold, and all 14 example games.

**Why it's safe to stop reading it:** it was never authoritative. Nothing in BoardSmith read it after project creation — not `dev`, not `build`. In practice it had already rotted:

- 8 of 14 example games omitted it entirely while shipping custom UIs.
- `lanternfall` set it to `./ui/App.vue` — the app root, not a board.
- The schema's own description claimed it was *"read by validate.ts and dev.ts"*. `dev.ts` never read it.

If you have a catalog column or display logic keyed on it, it has been showing you a field most games didn't set and no game honored. Drop it.

**If you need UI metadata on the platform side**, tell us what you need and we'll derive it into `manifest.json` at build time — the same way `playerCount` is already derived from compiled rules rather than authored by hand. We deliberately did not invent a replacement field speculatively.

**Migration:** if you have games in your catalog with a stored `ui` value, it can be deleted. `boardsmith validate` now emits:

```
Unknown key 'ui' — a game's UIs are declared in src/ui/uis.ts (defineGameUIs),
which is the single source of truth for which boards exist and which one ships.
Remove this key from boardsmith.json.
```

---

## 2. `GameShell` API change

**This section only matters if you mount `GameShell` directly.** If you embed built game bundles in an iframe (the normal path), skip it — nothing changes for you.

### Before

```vue
<GameShell game-type="cribbage" display-name="Cribbage" :player-count="2"
           :uis="[{ name: 'Classic', component: CribbageBoard }]">
  <template #game-board="{ gameView, playerSeat, ... }">
    <HeirloomTable ... />
  </template>
</GameShell>
```

### After

```vue
<!-- src/ui/uis.ts is the single source of truth -->
<GameShell game-type="cribbage" display-name="Cribbage" :player-count="2" :uis="uis" />
```

```ts
// src/ui/uis.ts
import { defineGameUIs, defaultUI, devUI } from 'boardsmith/ui';
import HeirloomTable from './heirloom/HeirloomTable.vue';

export default defineGameUIs({
  HeirloomTable: defaultUI(HeirloomTable),                            // ships, statically imported
  Classic: devUI(() => import('./components/CribbageBoard.vue')),     // dev only, stripped
  Auto: devUI(() => import('boardsmith/ui/auto-ui')),                 // dev only, stripped
});
```

`defaultUI()` takes the component itself; `devUI()` takes a loader. That asymmetry
is deliberate: the shipped board is part of the bundle already running, so it
cannot fail to arrive on its own, while the dynamic import in `devUI()` inside a
dev-only branch is exactly what lets production strip it.

Concretely:

| | Before | After |
|---|---|---|
| `uis` prop | optional array of `{name, component}` | **required** `GameUIRegistry` from `defineGameUIs()` |
| `#game-board` slot | how you supplied the default board | **removed** |
| Default UI | whatever filled the slot | the one entry marked `defaultUI()` |
| Other slots (`#player-stats`, etc.) | unchanged | unchanged |

`defaultUI()` / `devUI()` are exported from `boardsmith/ui`.

### Why the slot was removed

With both a slot and a `uis` prop, there were two places to name the default UI and they could disagree. They already had: the slot never received the `flow-state` prop or the `@retry` event that the `uis` path did, so a game's primary board silently got fewer props than its alternates. One render path fixes that class of bug permanently.

---

## 3. Production bundles are smaller

`devUI()` entries are eliminated from production builds **entirely** — JavaScript, compiled CSS, and any assets they reference. Not lazily loaded; not present.

This works because `devUI()` puts its `import()` inside a branch on `import.meta.env.DEV`, which Vite constant-folds to `false` in production. Rollup drops the dead branch and the dynamic import with it, so the module never enters the build graph.

Dev-only boards were the smallest of three savings. Measured, real `boardsmith build`
output (JS + CSS in `dist/ui/assets`):

| Game | Before | After | Saved |
|---|---|---|---|
| cribbage | 1,046,898 B | **480,005 B** | −566,893 (−54%) |
| hex | 934,416 B | **432,030 B** | −502,386 (−54%) |
| go-fish | 970,683 B | **467,739 B** | −502,944 (−52%) |
| chess | 1,516,906 B | **1,001,977 B** | −514,929 (−34%) |

Three separate fixes got there, and only the first one is the registry:

**Dev-only boards.** `devUI()` entries are eliminated from production
**entirely** — JavaScript, compiled CSS, and any assets they reference. Not lazily
loaded; not present. Verified absent from all 14 built games.

**The auto-UI stylesheet.** `boardsmith/ui` re-exported `AutoUI` from its
barrel, so `import { GameShell } from 'boardsmith/ui'` pulled `AutoUI.vue` into
every game's module graph. Rollup shook out the JS, but a Vue SFC's `<style>`
block compiles to a *side-effectful* CSS import that survives tree-shaking — so
the entire auto-UI stylesheet shipped in every custom-UI game. AutoUI moved to
the `boardsmith/ui/auto-ui` subpath. −24.5 KB of dead CSS from cribbage alone.

**three.js — by far the largest.** GameShell always renders a zoom-preview
overlay, and that overlay imported `Die3D` so it could preview a die. The
reference was live in every game's module graph, so Rollup emitted the ~500 kB
three.js chunk into **all 14 example games — 12 of which have no dice.** It was
lazily fetched, so no player ever downloaded it, but it sat in every published
package.

Dice now live at `boardsmith/ui/dice`, and importing that module is what
registers the die preview renderer. A game that draws dice already imports
`Die3D` from there, so nothing extra is declared and nothing can be forgotten:
the preview works exactly when the game has dice, and the bundle carries three.js
exactly then too.

Two games still ship it, correctly: `polyhedral-potions` (has dice) and
`demo-action-panel` (ships the auto-UI, which can render any element type). The
other twelve carry none.

---

## 3a. Chess ships one board now

Chess used to render a 2D board when a machine had no WebGL, which meant chess
shipped two boards while every other game shipped one, and no registry could
describe that honestly (the 2D board shipped regardless of what was declared).

The accessible 8×8 grid inside the 3D board is plain DOM and works without
WebGL, so the fallback was solving a problem the primary board already solved.
It is gone. Without WebGL the pieces are not drawn, a visible notice says so,
and the game stays fully playable and screen-reader complete through the grid.

`GameTable.vue` is no longer referenced by any shipped code and is absent from
chess's production bundle (verified by grep).

---

## 3b. `Deck` visibility: draw piles report their count again

**This is the one change here that alters game state payloads rather than build
output.** If you cache, diff, snapshot, or replay per-player state, read this.

A `Deck` used to default to `'hidden'`. That was correct while `'hidden'` and
`'count-only'` were synonyms in the engine. When `'hidden'` was later given true
concealment semantics — no `childCount` key at all, so a non-owner cannot even
distinguish an empty pile from a full one — the `Deck` default was never
revisited. Every game silently stopped reporting how many cards were left in a
draw pile, which is table information in essentially every card game and which
UIs legitimately read (card-back stacks, "cards remaining", scoring panels).

`Deck` now defaults to `contentsCountOnly()`: **card faces stay concealed, the
size is public.** A pile whose depth must also be secret opts in explicitly with
`contentsHidden()` — go-fish's pond already does exactly that, and is unaffected.

What this means for a per-player state payload of a default `Deck`:

| | Before | After |
|---|---|---|
| `childCount` | absent | present (the real count) |
| `children` | absent | anonymized placeholders, `__hidden: true` |
| Card identity (suit/rank/image) | never present | still never present |

No identity is exposed that was not exposed before. The only new information is
the size of the pile.

---

## 3c. Moved exports and one renamed type

Only relevant if you import from `boardsmith/ui` directly.

| Was | Now | Why |
|---|---|---|
| `import { AutoUI } from 'boardsmith/ui'` | `from 'boardsmith/ui/auto-ui'` | On the barrel it entered every game's graph and leaked its stylesheet (§3) |
| `import { Die3D } from 'boardsmith/ui'` | `from 'boardsmith/ui/dice'` | On the barrel it put three.js in every game; the import is now the opt-in |
| `type ValidElement` (board-side, `{ id, ref }`) | `type BoardTarget` | Two different types shared this name |

That last one is worth a sentence. `ValidElement` was declared twice with
different shapes — `{ id, ref }` for a board element the player can click, and
`{ id, refs: RefWithRole[] }` for a choice the action controller is offering —
and `boardsmith/ui` exported the second. Code reading `element.ref` got
"Property 'ref' does not exist… Did you mean 'refs'?" with no way to tell the two
apart by name. The board-side one is now `BoardTarget`; `ValidElement` still means
the controller's shape and is unchanged. (This rename immediately surfaced a real
bug in MERC that had been silently dropping values.)

---

## 4. What did NOT change

- The iframe embed contract: postMessage types, payloads, `trustedOrigins`, init handshake, and lifecycle are untouched.
- `manifest.json` structure apart from the removed `ui` key. `engineProtocol`, `playerCount`, `gameOptions`, `playerOptions`, `colorPalette`, `scoreboard`, `thumbnail` are all unchanged.
- The publish flow, bundle layout (`dist/rules`, `dist/ui`, `manifest.json`), and protocol version.
- Game rules, session, and client APIs.
- Hidden-information guarantees. The `Deck` change (§3b) exposes a pile's SIZE, never any card's identity; hands, owner-only zones, and explicitly `contentsHidden()` zones behave exactly as before.

---

## 5. Action items

| # | Owner | Action | Priority |
|---|---|---|---|
| 1 | Shufflewick | Stop reading `manifest.ui`; drop any stored value | **Required** — the field is gone from all games |
| 2 | Shufflewick | Confirm nothing else keys off it (catalog, admin, importer) | **Required** |
| 3 | Shufflewick | Tell us if you need UI metadata in the manifest; we'll derive it | Optional |
| 4 | Shufflewick | If you mount `GameShell` directly anywhere, adopt the `uis` prop | Only if applicable |
| 5 | Shufflewick | If anything caches/diffs per-player state, note that default `Deck` nodes now carry `childCount` (§3b) | **Required if you snapshot state** |
| 6 | Shufflewick | If you import `Die3D` or `AutoUI` from `boardsmith/ui`, switch to `boardsmith/ui/dice` / `boardsmith/ui/auto-ui` | Only if applicable |
| 7 | Both | Re-publish example games so catalog entries carry the new manifests and the smaller bundles | When convenient |

**One open question for you, and the only one that can bite:** does anything on the platform read `manifest.ui` today? We could not check from this side. Given 8 of 14 games never set it, we expect the answer is no, or that it's already tolerant of absence — but please confirm.

---

## Appendix: verification performed

- All 14 example games: `boardsmith validate` passes (includes `vue-tsc` over the whole project) and `boardsmith build` succeeds.
- Bundle greps confirm dev-only boards, the auto-UI, and three.js are absent from every production build that should not have them — and present in the two that should.
- BoardSmith library suite: **4419 tests, all passing.**
- MERC: **738 tests passing, 0 failing; typecheck 0 errors.**
- `treeshake-bundle.test.ts` now does real Vite builds and asserts, for a `devUI()` component, that it is absent from JS, from CSS, **and** emits no code-split chunk; and for dice, that three.js is absent from a game with no dice and present in one with dice. The prior version only checked JS, which is exactly how the CSS leak survived a green suite for months. Every claim in §3 is covered by one of these, so a future change cannot quietly undo it.
- Browser-verified in `boardsmith dev`: cribbage's default board mounts at 1272×681 with live game state and no console errors, and the UI switcher lists exactly the registry's entries with each one mounting when selected; MERC's board mounts at 1022×897 with live state.

## Appendix: chess ships one board, and its a11y suite now tests it

Removing the 2D fallback exposed something worth naming: chess's 1556-line
accessibility suite targeted `GameTable.vue`, so it was green while testing a
component no player could reach. The whole suite now mounts `ChessTable3D` (it
works in jsdom for the same reason the fallback was removable — the accessible
8×8 grid is plain DOM and needs no WebGL). `GameTable.vue` is deleted. 240 chess
tests pass.

Three parts of that port needed judgement rather than a rename, in case the
reasoning matters to you: blocked squares use `aria-disabled` with a roving
tabindex rather than the `disabled` attribute; the reduced-motion check asserts
the preference is *observed in JS* rather than "contains no requestAnimationFrame"
(which a WebGL renderer cannot satisfy); and the draw/resign control-row tests
were removed because that row duplicated GameShell's action dock, which the 3D
board deliberately does not repeat.

## Appendix: MERC is migrated, re-vendored, and green

MERC ships `src/ui/MercBoard.vue` as its registry UI. Its animation wiring moved
out of the old slot (where it reached back out through `@vue:mounted` for slot
props) into ordinary `onMounted`/`watch` inside the component. The combatant modal
that its `#player-stats` slot opens and its board renders is shared through
`src/ui/combatant-modal-state.ts`, matching the module-scope pattern MERC already
uses in `drag-drop-state.ts`.

**738 tests passing, 0 failing. Typecheck 21 errors → 0.**

Three issues were fixed there along the way, all worth knowing because two of
them were live bugs rather than migration fallout:

1. **Tactics-deck count.** `setup.ts` called `contentsHidden()` on the tactics
   deck — correct when `'hidden'` and `'count-only'` were the same thing. Once
   `'hidden'` gained true-concealment semantics it began genuinely hiding the
   size, and MERC's victory panel lost its number. Now `contentsCountOnly()`,
   which is what that deck always meant. (This is the game-side half of §3b.)
2. **A silently-dropped value.** `GameTable` read `element.ref` on the
   controller's `ValidElement`, which carries role-tagged `refs` — so the
   expression was always `undefined` and every retreat sector fell out of the
   valid list. Invisible until the `BoardTarget` rename (§3c) made the error
   message legible.
3. **A drifted duplicate type.** `useActionState` re-declared its own structural
   copy of `UseActionControllerReturn` that no longer matched the real one. It
   imports the real type now.
