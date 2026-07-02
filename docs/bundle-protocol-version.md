# Bundle protocol version (game↔engine ABI)

A published game's `rules.js` **externalizes** `boardsmith` — the game bundle
contains only game logic, and the runtime engine is supplied by whatever platform
executes it (e.g. Shufflewick's executor runs it with the engine version it has
vendored). This means a game and the engine that runs it can come from different
BoardSmith builds. When the contract between a built bundle and the engine changes
incompatibly, an old bundle **silently misbehaves** on a newer engine (classic
symptom: a blank action bar).

To fail loudly on that skew instead, BoardSmith stamps a **bundle protocol
version** into every published manifest, and the executor enforces it.

## For game authors — nothing to do

`boardsmith build` automatically writes the current engine's protocol version into
`manifest.json` as `engineProtocol`. You never set it, can't misconfigure it, and
don't think about it. If a platform ever rejects your bundle for a protocol
mismatch, the fix is simply to rebuild/republish with the current BoardSmith CLI.

## For BoardSmith maintainers — when to bump

`BUNDLE_PROTOCOL_VERSION` lives in `src/engine/protocol-version.ts` and is
re-exported from the engine entry (`import { BUNDLE_PROTOCOL_VERSION } from 'boardsmith'`).

- Bump it **only** when a change breaks how an already-built `rules.js` runs
  against the engine — i.e. a breaking change to the bundle↔engine ABI (the shape
  of `executeOp`, the serialized-state/player-view contract, the externalized
  `boardsmith`/`boardsmith/session` API surface a bundle depends on, etc.).
- Do **not** bump it for ordinary releases, additive/back-compatible changes, or
  engine-internal refactors that don't change the bundle-facing contract.
- It is independent of the npm package `version` and of any build tag.

## How enforcement works

1. `boardsmith build` (`src/cli/commands/build.ts`) stamps
   `engineProtocol: BUNDLE_PROTOCOL_VERSION` into `manifest.json`.
2. The executing platform reads its own vendored BoardSmith's
   `BUNDLE_PROTOCOL_VERSION` and compares. A mismatch is rejected with an
   actionable error telling the author to republish with the current CLI.

Because the value is a single integer bumped only on real breaks, compatible
builds (even different build tags of the same protocol) all interoperate; only a
genuine ABI break trips the check.
