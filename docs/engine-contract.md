# The engine contract

**Who this is for:** anyone changing BoardSmith, and anyone maintaining
ShufflewickPub. It replaces the ad-hoc "tell the platform team when something
big changes" convention with a mechanism that runs on every test.

---

## The problem it solves

A published game does not carry an engine. `boardsmith build` marks
`boardsmith` and all its subpaths as `external`, so `dist/rules/rules.js`
contains only game code. At runtime the ShufflewickPub executor supplies the
engine from **its own vendored copy** of BoardSmith.

The consequence is unintuitive and worth stating plainly:

> A game's rules run on the engine **the platform vendored**, not the engine
> the game was built against.

So "we changed BoardSmith" does not mean "the platform changed". And "a game
re-published" does not mean "it picked up the new engine". Those only happen
when the platform **re-vendors**. Two failure modes follow, and both are silent:

1. **The platform lags.** An engine fix or behaviour change never reaches
   production because nobody re-vendored. This is how the `Deck` default
   stopped reporting draw-pile counts for months without anyone noticing.
2. **The platform lags *and* a game moves ahead.** A game built against a newer
   BoardSmith uses an API the vendored engine does not have. It publishes fine
   and breaks at runtime, usually as something baffling like a blank action bar.

`BUNDLE_PROTOCOL_VERSION` already existed but cannot catch either: by design it
bumps only when an already-built `rules.js` stops running at all, which is rare
and is a different question from "should the platform re-vendor?"

---

## The three numbers, and what each one means

| Number | Lives in | Bumped when | Who reads it |
|---|---|---|---|
| `revision` | `src/contract/engine-contract.json` | the platform-reachable API surface or the player-view payload changes | the platform's `vendor:check`; stamped into every manifest as `engineRevision` |
| `bundleProtocol` | same file | an already-built `rules.js` would stop working — a true ABI break | the games worker, which rejects mismatched bundles outright |
| package `version` | `package.json` | never, in practice | nobody; it is not a release channel |

`revision` is the everyday one. `bundleProtocol` is the emergency one. They are
deliberately separate: conflating them would either force every game to be
rebuilt for a harmless change, or let a real break slip through unannounced.

The JSON file is the **single source of truth for both**.
`src/engine/protocol-version.ts` reads `bundleProtocol` from it rather than
declaring a literal, so the constant the engine exports and the number the
platform's tooling reads cannot drift apart.

---

## How a change gets noticed

Two fingerprints, both recomputed by `src/contract/engine-contract.test.ts` on
every test run:

- **`surfaceHash`** — the sorted runtime export names of the three entrypoints
  the platform can reach: `boardsmith` and `boardsmith/session` (supplied to
  game rules by the executor's `sandboxedRequire`) and
  `boardsmith/session-host` (imported directly by the games worker). Catches
  added, removed, and renamed API.
- **`payloadHash`** — a canonical per-player view rendered from a fixed fixture
  game in `src/contract/fingerprint.ts`. Catches semantic changes that leave the
  API identical but alter what the platform ships to clients. The fixture
  deliberately includes a default `Deck`, an owner-visible hand, an explicitly
  count-only pile and an explicitly hidden pile, because those are the shapes
  whose defaults have actually bitten us.

If either moves and the contract was not updated, the test fails with the
command to run. **That is the whole enforcement story** — you cannot land a
platform-visible engine change without either recording it or deleting a test.

### The known limit

`surfaceHash` sees runtime values only. `verbatimModuleSyntax` erases type-only
exports, so changing an exported **type** — adding an optional field to
`PlayerStateView`, say — moves neither hash unless it also changes a real
payload. Type-level contract changes still need a judgement call. If you make
one, extend the fixture so the change becomes visible, then update the contract.

This limit is stated rather than hidden because a fingerprint people
over-trust is worse than one they understand.

---

## Protocol: changing BoardSmith

1. Make your change.
2. Run `boardsmith test` (or `boardsmith contract` on its own for just this check).
3. If `engine contract` fails, that is the system working. Record the change:

   ```
   boardsmith contract --update --summary "Deck defaults to count-only; draw piles report size again"
   ```

   `--summary` is required. It is the text the platform maintainer reads when
   deciding whether to re-vendor, so write it for them, not for yourself.
   For a true ABI break add `--breaking`, which also bumps `bundleProtocol`.
4. Commit `src/contract/engine-contract.json` with your change.

The command refuses to bump when nothing actually moved, so revisions stay
meaningful.

## Protocol: updating the platform

On ShufflewickPub:

```
npm run vendor:check       # is our vendored engine behind? what changed?
npm run vendor:boardsmith  # re-pack, install into games/ and executor/, verify
```

`vendor:check` compares the installed engine's contract against BoardSmith's
current one and prints every intervening revision summary, so the decision is
made from a changelog rather than a hash. It classifies the result:

- **in sync** — nothing to do.
- **behind** — re-vendor when convenient; game behaviour on the platform is
  frozen at the older engine until you do.
- **behind, ABI break** — re-vendor *and* rebuild/republish every game; already
  published bundles are invalid.

See `docs/BOARDSMITH-VENDORING.md` in the ShufflewickPub repo for the full
platform-side runbook.

## Protocol: publishing a game

`boardsmith build` stamps both `engineProtocol` and `engineRevision` into the
manifest automatically — game authors never set them, and a hand-edited value
in `boardsmith.json` is overwritten rather than merged.

The games worker rejects an upload whose `engineRevision` **exceeds** the
platform's own. That is the asymmetry that matters: a game built on an older
engine is fine (the newer engine still runs it, and `bundleProtocol` guards the
case where it would not), but a game built on a *newer* engine may call
something the vendored engine does not have. The rejection message names both
revisions and says to re-vendor.

So the ordering rule is simply: **re-vendor the platform before publishing
games built against a newer BoardSmith.**
