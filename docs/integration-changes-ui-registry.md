# Integration changes: the game UI registry

**For:** the Shufflewick.pub team
**Change:** BoardSmith games now declare their UIs in `src/ui/uis.ts` instead of in `App.vue` and `boardsmith.json`.
**Breaking:** yes, for anything that reads a game's `ui` manifest field or mounts `GameShell` directly.

---

## TL;DR

1. **`boardsmith.json` no longer has a `"ui"` key.** If you read it, stop — it will be absent from every game, and `boardsmith validate` now rejects it. It was never a reliable field (see below).
2. **`GameShell` now requires a `uis` prop** and no longer has a `#game-board` slot. This only affects you if you mount `GameShell` yourself rather than loading a game's built bundle.
3. **Published bundles get smaller.** Games can keep old boards for development and pay nothing for them in production. Cribbage's bundle dropped 40,063 bytes (1,022,379 → 982,316, −3.9%).
4. **Nothing changes in the iframe/postMessage embed contract.** No message types, payloads, origins, or lifecycle changed.

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

Measured, real `boardsmith build` output:

| Game | Before | After | Saved |
|---|---|---|---|
| cribbage | 1,022,379 B | 982,316 B | 40,063 B (−3.9%) |

Chess additionally lost its second board outright — see below.

Verified absent from all 14 built games: every dev-only board, and the auto-UI in all 13 games that don't ship it. (`demo-action-panel` ships the auto-UI on purpose — it declares it `defaultUI()`.)

**Related fix shipped alongside:** `boardsmith/ui` used to re-export `AutoUI` from its barrel, so `import { GameShell } from 'boardsmith/ui'` pulled `AutoUI.vue` into every game's module graph. Rollup shook out the JS, but a Vue SFC's `<style>` block compiles to a *side-effectful* CSS import that survives tree-shaking — so the entire auto-UI stylesheet shipped in every custom-UI game. AutoUI now lives behind the `boardsmith/ui/auto-ui` subpath. That alone cut 24.5 KB of dead CSS from cribbage (−15.6% of its stylesheet).

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

## 4. What did NOT change

- The iframe embed contract: postMessage types, payloads, `trustedOrigins`, init handshake, and lifecycle are untouched.
- `manifest.json` structure apart from the removed `ui` key. `engineProtocol`, `playerCount`, `gameOptions`, `playerOptions`, `colorPalette`, `scoreboard`, `thumbnail` are all unchanged.
- The publish flow, bundle layout (`dist/rules`, `dist/ui`, `manifest.json`), and protocol version.
- Game rules, session, and client APIs.

---

## 5. Action items

| # | Owner | Action | Priority |
|---|---|---|---|
| 1 | Shufflewick | Stop reading `manifest.ui`; drop any stored value | **Required** — the field is gone from all games |
| 2 | Shufflewick | Confirm nothing else keys off it (catalog, admin, importer) | **Required** |
| 3 | Shufflewick | Tell us if you need UI metadata in the manifest; we'll derive it | Optional |
| 4 | Shufflewick | If you mount `GameShell` directly anywhere, adopt the `uis` prop | Only if applicable |
| 5 | Both | Re-publish example games so catalog entries carry the new manifests | When convenient |

**One open question for you, and the only one that can bite:** does anything on the platform read `manifest.ui` today? We could not check from this side. Given 8 of 14 games never set it, we expect the answer is no, or that it's already tolerant of absence — but please confirm.

---

## Appendix: verification performed

- All 14 example games: `boardsmith validate` passes (includes `vue-tsc` over the whole project).
- All 14 example games: `boardsmith build` succeeds.
- Bundle greps confirm dev-only boards and auto-UI are absent from every production build.
- BoardSmith library suite: 4417 tests, all passing.
- `treeshake-bundle.test.ts` gained a case that does a real Vite build and asserts a `devUI()` component is absent from JS, from CSS, **and** emits no code-split chunk. The prior version only checked JS, which is exactly how the CSS leak survived a green suite for months.
- Browser-verified in `boardsmith dev` (cribbage): the default board mounts at 1272×681 with live game state and no console errors; the UI switcher lists exactly the registry's entries and each one mounts when selected.

## Appendix: MERC is migrated and re-vendored

MERC now ships `src/ui/MercBoard.vue` as its registry UI. Its animation wiring
moved out of the old slot (where it reached back out through `@vue:mounted` for
slot props) into ordinary `onMounted`/`watch` inside the component. The
combatant modal that its `#player-stats` slot opens and its board renders is now
shared through `src/ui/combatant-modal-state.ts`, matching the module-scope
pattern MERC already uses in `drag-drop-state.ts`.

Verified: builds clean, auto-UI stripped from production, board mounts in the
browser at 1022×897 with live state, switcher lists exactly its registry entries.

Two pre-existing MERC issues surfaced during this work and are NOT caused by it —
both were confirmed against a baseline build of the previous vendored BoardSmith:

1. **`tactics-hand-visibility` test fails.** Current BoardSmith deliberately omits
   `childCount` for non-owner hidden containers (`game.ts:2906` — "no `childCount`
   key at all (not `childCount: 0`, which would still distinguish empty from
   full)"), while MERC's audit-F32 test asserts draw-deck counts stay visible to
   both players. This is an engine-contract disagreement introduced by re-vendoring
   six months of BoardSmith, and deciding it changes hidden-information handling
   for every game — so it is flagged, not guessed at. MERC: 737 passing, 1 failing.
2. **Two type errors in `GameTable.vue`** (`UseActionControllerReturn`
   assignability, and `ValidElement.ref`). Both present in the baseline. The second
   has a real root cause in BoardSmith: `ValidElement` is declared TWICE with
   different shapes — `useBoardInteraction.ts:40` (`{ id, ref }`) and
   `useActionControllerTypes.ts:44` (`{ id, refs }`) — and `boardsmith/ui` exports
   the latter. Same name, two meanings. Worth fixing, but reconciling them touches
   board interaction in every game, so it is not bundled into this change.

MERC's typecheck went from **21 errors to 2** across the re-vendor.
