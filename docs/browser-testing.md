# Browser Testing (Agent-Driven, No Vision)

`boardsmith dev` exposes a small dev-only bridge that lets an agent (or a
script) drive a running game **by stable element id** and **confirm outcomes
from an observable signal** — no coordinate-clicking, no screenshots, no
polling. This doc is the practical guide to that bridge.

It has three pieces:

1. **Stable selectors** — `data-bs-el-id` (and its FLIP alias
   `data-element-id`) on every selectable element, in both custom UIs and
   AutoUI, plus `data-bs-candidate` on the ones the open selection will accept.
2. **`window.__BOARDSMITH_DEVTOOLS`** — a synchronous, read-only snapshot of
   game state, available actions, and the current valid selection, exposed on
   the **outer dev-host page**.
3. **`boardsmith:action-resolved`** — a `CustomEvent` dispatched on the
   **game iframe's window** every time an action resolves, so you can confirm
   success/failure without polling.

All three are dev-only, gated by `import.meta.env.DEV`. They are
dead-code-eliminated from production builds — `window.__BOARDSMITH_DEVTOOLS`
is simply `undefined` in a shipped game, and the `action-resolved` event never
dispatches.

## Background: the dev host layout

`npx boardsmith dev` serves an outer "Dev" chrome page
(`src/cli/dev-host/DevHost.vue`) with a seat selector, UI switcher, and
debug tools. Each connected seat renders inside a `GameShell` **iframe running
in platform mode** — the exact code that runs in production. This matters for
the bridge:

- `window.__BOARDSMITH_DEVTOOLS` lives on the **outer page's `window`**, not
  inside the iframe. It's a cache that DevHost keeps up to date by listening
  for `postMessage({ type: 'boardsmith:devtools-state-update', ... })` pushed
  from the iframe on every state change — so reads are synchronous, no
  `await` needed.
- `boardsmith:action-resolved` is dispatched inside `useActionController`,
  which runs **inside the game iframe** — so you listen for it on
  `iframe.contentWindow`, not on the outer `window`.

The first page to connect to a new `boardsmith dev` run is seated in seat 1.
A tab left open from an earlier run does not count (#416). Vite reloads it
when the server comes back, but the tab remembers the run it joined, and the
new run answers it with "The dev server restarted. Reload to join the new
game." and gives it no seat. So a scripted check that opens a
fresh page after starting the server gets seat 1 even with an old tab still
open. Reloading the old tab joins the new run like any fresh page. Within one
run, a reload keeps its seat for a 10 s reconnect grace (#412).

## 1. Stable selectors: `data-bs-el-id`

Every selectable board element carries `data-bs-el-id="<elementId>"`, emitted
by the single-source `anchorAttrs()` helper
(`src/ui/composables/useBoardInteraction.ts`). This attribute is identical in
custom UIs (via `useSelectable`/`useSelectableGrid`) and in **all eight** AutoUI
renderers — so the same selector works regardless of which UI is currently
rendering the game.

`anchorAttrs()` emits `data-element-id` from the same id — the older attribute
consumed by FLIP animation (`useFLIP`'s default selector is
`[data-element-id]`). Treat `data-bs-el-id` as canonical for selection;
`data-element-id` is its animation alias, not a replacement. Both come from the
one helper, so an element never has one without the other.

```js
// Find element 42 inside the active game iframe, regardless of UI mode:
const el = iframe.contentDocument.querySelector('[data-bs-el-id="42"]');
```

Never select by CSS position, class name churn, or pixel coordinates — those
are cosmetic and change with theme/layout. `data-bs-el-id` is the only
selector contract.

### `data-bs-candidate`: naming a candidate by what a player reads

An element pick belongs to the board, not the panel: when a step is fully
board-anchored the panel is absent from the DOM (#172), and since #185 the panel
hands element candidates to the board and keeps showing the action list. So the
board is the ONLY surface the candidate appears on, and the board writes the
element's internal name (`holding-1`) where the panel would have written its
display text (`Holding 1`).

While a pick is open, every element the pick will accept carries
`data-bs-candidate="<the text the panel would have shown>"` — from
`candidateAttrs()`, alongside the anchor attributes, in all eight AutoUI
renderers and in any custom board using `useSelectable`/`useSelectableGrid`.
The attribute is present only while that element is a live candidate and
disappears with the pick, so `[data-bs-candidate]` is also the answer to "what
can I press right now".

```js
// Answer an open element pick by the wording a player would read:
const doc = iframe.contentDocument;
doc.querySelector('[data-bs-candidate="Holding 1"]').click();

// Or enumerate what the open pick will accept:
[...doc.querySelectorAll('[data-bs-candidate]')].map(el => el.dataset.bsCandidate);
```

A candidate the action refuses is still a candidate: it carries the hook and
`aria-disabled="true"`, matching `data-bs-disabled-reason` on the panel's own
refusals. When a pick supplies no wording, the label falls back to the element
id, so a candidate is never unmarked.

## 2. `window.__BOARDSMITH_DEVTOOLS`

Exposed on the **outer dev-host page** window (not the iframe) when
`import.meta.env.DEV` is true:

```ts
interface BoardsmithDevtools {
  /** Perspective-aware game state for the given seat (current seat if omitted). */
  getState(seat?: number): unknown | null;
  /** Available action names for the given seat. */
  getAvailableActions(seat?: number): string[];
  /** Action metadata (labels, help text, selection config) for the given seat. */
  getActionMetadata(seat?: number): Record<string, unknown> | undefined;
  /** Active action, current selection step, and the currently valid element ids. */
  getBoardInteractionState(): {
    activeAction: string | null;
    currentSelectionStep: number;
    validElements: number[];
  } | null;
}
```

All four methods are synchronous reads against a cached snapshot — there is
no round trip to the server or the iframe when you call them. If
`window.__BOARDSMITH_DEVTOOLS` is `undefined`, you're either in a production
build or the page hasn't finished its first snapshot push yet (reconnect or
wait a tick).

## 3. `boardsmith:action-resolved`

Dispatched on the **game iframe's `window`** at every terminal
action-resolution point inside `useActionController`
(`src/ui/composables/useActionController.ts`) — including each link of a
chained follow-up action, so you get exactly one event per resolved action:

```ts
interface BoardsmithActionResolvedDetail {
  action: string;
  success: boolean;
  seat: number;
  error?: string; // present only when success is false
}
```

```js
iframe.contentWindow.addEventListener('boardsmith:action-resolved', (e) => {
  console.log(e.detail.success ? 'OK' : 'FAIL', e.detail.action, e.detail.error ?? '');
});
```

Attach the listener **before** driving the action — there's no buffering or
polling, so a listener added after the event fires misses it.

### Important: what `success: false` does and does not cover

`success: false` fires **only when a server round-trip rejects an
in-progress action** — i.e., `sendAction()` resolved with `{ success: false }`
or threw, after the action was already dispatched to the server.

Every **client-side guard** — "Not your turn", "Action is not available",
"Invalid selection", "Missing required selection" — is an **early return that
dispatches nothing at all**. No event fires for those cases; the action never
reached the server.

This matters in practice: a pit-of-success game (e.g. go-fish) validates
input client-side before it can ever reach the server — an `ask` action's
`target`/`rank` choices *are* the valid set, so any bad value is rejected
client-side and never dispatched, while any valid value is accepted
(`success: true`). **You should not expect to see `success: false` in the
browser from normal UI-driven input on a well-designed game** — that's the
system working as intended, not a gap in the bridge.

To actually observe `success: false` in the browser, you need a rule the
client genuinely can't pre-check (a server-only invariant), or a
stale/out-of-turn submission that manages to bypass the client's
`isMyTurn` guard. The failure path itself is covered at the unit level by
`src/ui/composables/useActionController.devtools.test.ts`, which mocks
`sendAction` to return `{ success: false, error }` and asserts the event
fires with that shape at the same dispatch site.

## The agent loop: DISCOVER → SELECT → DRIVE → CONFIRM

1. **DISCOVER** — read `getActionMetadata()` and
   `getBoardInteractionState().validElements` on the outer page to learn
   which actions are available for the active seat and which element ids are
   currently selectable.
2. **SELECT** — `iframe.contentDocument.querySelector('[data-bs-el-id="<id>"]')`
   to find the live DOM node for a valid id (same attribute in custom UI and
   AutoUI).
3. **DRIVE** — dispatch a bubbling `click`; GameShell's normal interaction
   pipeline (`useBoardInteraction`) handles it exactly as it would a real
   pointer event.
4. **CONFIRM** — listen for `boardsmith:action-resolved` on
   `iframe.contentWindow`, attached *before* the click. `success: true` means
   committed; `success: false` + `error` means server-rejected. No polling,
   no fixed waits.

### Console harness (paste into the outer dev-host page console)

```js
const iframe = document.querySelector('iframe'); // the active seat's GameShell iframe
const dt = window.__BOARDSMITH_DEVTOOLS;

// 1) DISCOVER
console.log('actions', dt.getAvailableActions());
console.log('valid element ids', dt.getBoardInteractionState()?.validElements);
console.log('metadata', dt.getActionMetadata());

// 4) CONFIRM — attach before driving
iframe.contentWindow.addEventListener('boardsmith:action-resolved', (e) => {
  console.log('[resolved]', e.detail.success ? 'OK' : 'FAIL', e.detail.action, e.detail.error ?? '');
});

// 2) SELECT + 3) DRIVE
const id = dt.getBoardInteractionState().validElements[0];
const el = iframe.contentDocument.querySelector(`[data-bs-el-id="${id}"]`);
el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
// → expect boardsmith:action-resolved with success:true for a legal move
```

### Repro — custom UI (go-fish)

1. `cd ~/BoardSmithGames/go-fish && npx boardsmith dev` (serves on
   `http://localhost:5173/`).
2. Open the page in Chrome; wait to be seated.
3. Open DevTools on the **outer page** (not inside the iframe) and run the
   harness above.
4. Confirm `getAvailableActions()` is non-empty and
   `getBoardInteractionState().validElements` lists ids while it's your turn.
5. `querySelector('[data-bs-el-id="<id>"]')` resolves the element, the click
   drives the action, and you see `success: true`.
6. Kill the dev server (`Ctrl+C`) when done.

### Repro — AutoUI

1. Same setup; after seating, switch the dev-chrome UI dropdown to
   **"Auto UI"**.
2. Confirm `[data-bs-el-id]` still resolves elements rendered by AutoUI —
   the selector contract is identical across both UI modes.
3. Repeat DISCOVER/SELECT/DRIVE/CONFIRM.
4. Kill the dev server (`Ctrl+C`) when done.

## Headless alternatives (no browser needed)

Most of what this bridge is for — asserting hidden-info stays hidden,
proving an animation fired, or driving a game to completion — can be done
without a browser at all. See
[boardsmith/testing](./api/testing.md#asserting-hidden-information-vis) for:

- **VIS** — `isElementVisible`/`assertHidden`/`assertVisible`/`diffPlayerViews`,
  and the DOM-leak-proving `assertNoHiddenInfoLeak` (which mounts the real UI
  in `jsdom`, no browser).
- **ANIM** — `enableAnimationTestMode`/`getAnimationTrace` for headless
  animation assertions (`{kind,element,from,to}` traces).
- **SIM** — `createHeadlessSession` / `boardsmith simulate` for seeded batch
  playthroughs.
- **FLOW** — `getFlowDebugInfo()`/`describeFlowPosition()` for structured
  flow-position introspection instead of manually reading `FlowState`.

Reach for the browser bridge on this page specifically when you need to prove
something about the **real rendered UI/interaction pipeline** (a click
actually resolves through `useBoardInteraction`, an element is genuinely
clickable in both custom UI and AutoUI) — the headless utilities above don't
mount a live page or dispatch DOM events.

If you're driving the dev host itself (not just a single game instance) —
scripting `getState`/`getLobby`/`debugToggle`/`uiSwitch` or the `debug:logs`
ring buffer over WebSocket, including from Node with no browser at all — see
[Agent Control: Scriptable Dev Host (WS)](./agent-control.md#scriptable-dev-host-ws).
The dev-only `debug:flow-state` WS op (alongside `debug:logs`) surfaces the
same `FlowDebugInfo` shape described above, over the wire, for a connected
dev-host client.

## The checked-in browser regressions: `scripts/*-browser.mjs`

Each one is a standing regression that drives a real Chromium through the
**world** dev host, and they all share `scripts/browser-harness.mjs`: it writes a
disposable world project to a temp directory, installs this checkout into it the
way a real game does, starts the real `boardsmith dev` world server on a free
port, stops that host before removing the project, and only then lets the process
exit (#231). A script's own file is therefore nothing but its fixture world and
its checks. They run from any checkout, a worktree included: the fixture links
its packages from wherever Node resolves this checkout's install (#358).

The fixture world's lifetime (write, serve, stop, remove) is
`withFixtureWorld` in `src/cli/commands/fixture-world.test-helper.ts`, not in
the harness. It is TypeScript so `boardsmith typecheck` compiles its call to the
world dev host, and `src/cli/commands/fixture-world.test.ts` starts and stops one
in the ordinary suite with no browser. Nothing runs the scripts themselves, so
before #357 a change to that call broke all of them and nobody noticed. `scripts/*-browser.mjs` is the set — no list here, because a count in
a doc goes stale the next time one is added.

Two of them read as the worked examples:

- **`world-pick-bridge-browser.mjs`** walks a dependent selection — a crew whose
  size is the chosen ship's cargo hold — from the action panel and from a custom
  UI that prefills the earlier selection. It exists because issue #227 was a
  fully-built, fully-green feature that was dead in the field:
  `WorldDevHost.vue` relayed neither `world_pick` nor `world_pick_result`, so the
  native host's tests, the shell's tests and the controller's tests were all
  green while the browser showed `Selected: 0` where five was the answer. Nothing
  on either side of that bar can see it, so the regression has to cross it —
  including asserting the frames on the WebSocket itself, which is how the defect
  was found.
- **`ordered-list-browser.mjs`** builds an ordered, repeatable list (#249, #252):
  the same building twice, an entry removed from the middle by index, then
  submitted — and the sequence is asserted on the wire AND in what the resolver
  stored, which is the only place a handler's own argument can be observed. It
  drives both surfaces, the panel's Add buttons and a board click through
  `useBoardInteraction`, because they are two views of one draft; and it checks
  the Add and remove controls are tabbable, named, and do not strand the keyboard
  when an entry unmounts.

```sh
node scripts/ordered-list-browser.mjs
# or, pointing it at a Playwright you already have installed elsewhere:
BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \
  node scripts/ordered-list-browser.mjs
```

They are **not** part of `npx vitest run`. The suite drives Chromium only through
the smoke check below (`src/cli/commands/smoke.test.ts` and the end-to-end
`boardsmith verify` tests), with the browser `boardsmith install-browser` puts on
the machine. They never skip — with no Playwright reachable one says
how to give it one and exits non-zero, because a browser regression that silently
passes when it did not run is the failure it exists to replace. Each starts and
stops its own dev server, on its own port, inside the one process.

## The smoke test every game has: `tests/browser/smoke.spec.ts`

`boardsmith init` writes it, `boardsmith verify` runs it as its `smoke` check,
and `boardsmith smoke` runs it alone (#453). The spec is one call:

```ts
import { defineSmokeTest } from 'boardsmith/testing/browser';

defineSmokeTest({ actions: ['draw', 'play'] });
```

The walk (`src/testing/browser-smoke.ts`) drives the dev host with the same
markers this page documents, so it keeps up with any game without knowing it:

- It opens `/`, takes a seat (a table seats the first browser, a world attaches
  it; a table showing its lobby is asked for the first open seat), and waits for
  the game frame's `[data-testid="bs-actionbar"]`.
- At a table it then turns on the dev host's "Follow active seat"
  (`[data-testid="seat-switcher"]`, then `[data-testid="follow-active-seat"]`),
  so it acts for whichever seat is due and the bots stand down. That is how it
  reaches an action one seat has only after another acts, such as accepting a
  draw the other seat offered (#458). A world's dev host has no seats to follow.
- At a table it then deals a game from a seed (#460): it opens Table setup
  (`[data-testid="table-setup-toggle"]`), types the seed into
  `[data-testid="deal-seed"]`, presses `[data-testid="deal"]`, and waits until
  `[data-testid="game-seed"]` shows that seed, which the dev host shows only once
  the dealt game's state has reached the game frame. Follow-mode carries over a
  new game, so no bot moves in it, and the same seed walked the same way is the
  same game. See [Choosing the deal](#choosing-the-deal-seed).
- Each step it presses a board control it has not pressed, answers the open
  action (the panel marks it `data-bs-open-action="<name>"`), or takes the next
  `[data-bs-action]` button, preferring one not taken yet and opening
  `[data-bs-action-group]` menus to reach the actions inside them. A board
  control comes first because a player can press the board while a pick is
  open, and because a game that opens each turn's action by itself never has a
  moment with nothing open once the walk acts for every seat.
- An open action is answered one choice at a time: a price's confirm button, the
  board's own `[data-bs-candidate]` (so the board is pressed, not only the
  panel), then the panel's choice, add, done and skip buttons. An empty text
  field is filled with "smoke test" and an empty number field with a value its
  own `min`, `max` and `step` accept: its least value, else 1 (#465). Each press
  is narrated (`smoke step 4: pressing "Done" for "kindle"`).
- The walk gives up on an open action, reports it, and presses its Cancel when
  the panel offers nothing to press, when three presses in a row change nothing,
  when a press brings the panel back to a state it showed before (the walk
  answers a state the same way each time, so that is a loop it would never leave),
  or after 50 presses (#463). The report names the step, the deal and the presses.
  An action given up on counts as failed: it is not taken again while the panel
  offers anything else (#467).
- A multi-select pick (#459) is answered one distinct choice at a time: an
  unticked box in the panel, or, when the panel hands the pick to the board, a
  `[data-bs-candidate]` this pick has not chosen. Once it has at least one
  choice and its Done button is ready, it presses Done. The pick's own min and
  max decide through the panel: Done is ready from `min` on, every box left is
  refused at `max`, and a pick whose `min` is its `max` has no Done and
  completes on its last choice.
- A board control is a `button` or `[role="button"]` inside
  `[data-testid="bs-board"]` that a keyboard can reach and that is not a pick's
  candidate, nor inside an `inert` subtree, nor inside the game-over card (whose
  Close would hide the end of the game from the walk, #462). It is known by its
  `data-bs-el-id` when it has one, else its label. The walk reads the board's
  controls in one look at the page, so none can go away between being found
  and being read (#464).
  A keyboard-only control, one that takes no pointer (`pointer-events: none`)
  AND cannot be seen (`opacity: 0`, `visibility: hidden` or not rendered, on it
  or an ancestor), such as an invisible keyboard board laid over a 3D canvas for
  keyboard and screen-reader players, is pressed the way its players press it:
  focused, then Enter (#457). Any other control is clicked, including a visible
  one that takes no pointer, so a control a sighted mouse player can see but not
  press fails the walk, as does one something covers, or one that goes away
  before the press lands.
- While a modal dialog is open (`[aria-modal="true"]`, or a `<dialog>` shown
  modally), it is all a player can reach, so it is all the walk presses (#461):
  each control in it once for each time the dialog opens, so a dialog opened
  again is closed again, then Escape. A dialog still open after that fails the
  walk: a player in it has no way back to the game.
- No press or read of an element waits longer than 5 seconds, and Playwright
  bounds anything else at 15 (#464). A step that cannot go on is reported with
  its number and its deal, and ends that deal's walk; it never waits out the
  whole run.
- When a game ends with listed actions still to take, it deals a new game from
  the next seed of the deal it is walking (`smoke/2`, `smoke/3`...), the same way,
  and goes on in it (#458, #460). An action whose taking has ended every game it
  was taken in, such as resigning, is taken again only when the panel offers
  nothing else, so it does not cut each game short. A world has no new game.
- Actions it took are read from `boardsmith:action-resolved`, which also reports
  one that failed. An action that failed is reported once and not tried again
  while anything else is offered, so the walk goes on to the rest of the game. It fails on `pageerror`, console errors, responses of 400 and
  up (or failed requests) from the dev host, error toasts, presses that never
  land, an open action that offers nothing or does not change, an offered action
  `actions` does not list, and a listed one it never takes.
- It stops walking a deal when its `steps` (default 60 for each deal, counted
  across that deal's games) run out, a game ends with every required action
  taken, no seat is offered anything for 30 seconds, or every required action
  and every offer has been taken and five more steps turned up nothing new. A
  listed action it never saw offered is reported with why the walk stopped: a
  deal that stopped because nothing was offered says so and where, since more
  `steps` would not help it.
- It prints each step as it goes (`smoke step 4: pressing "6S" for "play"`), so
  `boardsmith smoke` shows exactly what the walk did, and the same seeds print
  the same steps.

### Choosing the deal: `seed`

At a table, the walk deals every game from a seed: `"smoke"` unless the spec's
`seed` names another. The seed is printed in the check's summary, pass or fail,
and recorded with it in the verify result, so a failure is walked again exactly
by running `boardsmith smoke` on the same spec. `seed` takes one seed or a list,
each walked in turn, as its own deal with its own `steps`:

```ts
defineSmokeTest({
  actions: ['draw', 'discard', 'chooseScoring', 'declareScoring', 'ready'],
  seed: ['smoke', '17'],
});
```

The walk requires every listed action across all its deals together, so the
second seed above is there for the action the first deal does not offer. To
find one, deal seeds in `boardsmith dev`: Table setup shows the seed of the game
on screen and deals a new game from any seed typed there.

A world is dealt by `boardsmith dev` from the one seed it gives that world, so a
world's spec names no `seed`, and the check fails one that does.

### Actions no walk from a fresh game can reach: `unreachable`

`actions` lists every action the game has. A few cannot be reached by any walk
from a fresh game, whatever its `steps` and whatever the deal: a claim offered
only on threefold repetition or after fifty quiet moves, say. Such an action
stays in `actions` and is also named in `unreachable`, with a sentence saying
why:

```ts
defineSmokeTest({
  actions: ['movePiece', 'resign', 'offerDraw', 'acceptDraw', 'claimDraw'],
  unreachable: {
    claimDraw:
      'Offered only when the same position has occurred three times or fifty moves have passed without a capture ' +
      'or pawn move, and a walk from a fresh game plays neither.',
  },
});
```

The walk does not require a declared action it never sees enabled, and its
passing summary quotes each such action's reason. Once it sees a declared action
enabled (offered, not greyed out), the declaration no longer excuses it: the
walk must take it like any other, so a declaration cannot hide an action that is
offered and does nothing when pressed. It fails if taking one fails. When it
takes a declared action, its passing summary names it and says to remove the
declaration, so a declaration that is no longer true does not stay. The check
fails a declaration whose reason is not a sentence (fewer than four words), one
that names an action `actions` does not list, and a spec that declares every
listed action.

An action that ends the game (resign) or that needs another seat to act first
(accept a draw) does not belong in `unreachable`: the walk starts a new game
when one ends, and acts for every seat at a table. Taking such an action is
reported as taking it, not excused.

Nor does an action that only some deals offer, such as a scoring claim offered
only when a player is dealt cards that score. A fresh game can reach it: choose
a seed whose deal offers it, with `seed`. Declare an action `unreachable` only
when no deal from a fresh game offers it within the walk.

It walks the UI players get: the `defaultUI` entry in `src/ui/uis.ts`, not a
`devUI`. Board tests stand in for the shell with `renderAsSeat`,
`tableShellContext` or `worldShellContext` from `boardsmith/testing`, which give
exactly the keys the real shell gives; `boardsmith test-step-check` reports a
test that provides a key only one of the two shells provides.

---

**Always kill the dev server before you finish.** Never leave `boardsmith dev`
running in the background — this is a hard project rule, not just tidiness.
