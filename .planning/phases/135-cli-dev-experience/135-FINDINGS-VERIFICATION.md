# Phase 135: Findings Verification

**Purpose:** PROC-01 gate. Every finding in scope for Phase 135 (F9, F21, F22, F32, F33, F34)
must have a recorded verdict — LEGITIMATE or REJECTED — with a current-HEAD file:line trace,
BEFORE any fix task in Plans 02-06 runs. No fix code is written in this document.

**Re-verified against:** HEAD as of 2026-07-03, post-Phase-134 (commit 72dafc0 and earlier).

---

## F9 / CLIX-01 — boardsmith.json `playerCount` is silently dead config

**Audit claim:** `boardsmith.json`'s `playerCount` key is silently dead — `gameDefinition`
(compiled rules) always wins in `dev.ts`'s resolution chain — and the scaffold hardcodes the
same value into two separate places.

**Current HEAD trace:**

1. **Dual authorship of player count confirmed.** `src/cli/lib/project-scaffold.ts:109`
   (`generateBoardsmithJson`) writes `playerCount: config.playerCount` into `boardsmith.json`.
   Separately, `src/cli/lib/project-scaffold.ts:244-245` (`generateRulesIndexTs`) hardcodes
   `minPlayers: ${config.playerCount.min}` / `maxPlayers: ${config.playerCount.max}` directly
   into the generated `src/rules/index.ts`'s `gameDefinition` object literal — two independent
   write sites seeded from the same scaffold-time value, which can drift the moment either file
   is hand-edited afterward.
2. **`gameDefinition` always wins at runtime.** `src/cli/commands/dev.ts:359-360`:
   ```
   minPlayers = gameDefinition.minPlayers ?? config.playerCount?.min ?? config.minPlayers ?? 2;
   maxPlayers = gameDefinition.maxPlayers ?? config.playerCount?.max ?? config.maxPlayers ?? 4;
   ```
   Since `gameDefinition.minPlayers`/`maxPlayers` are always defined (the scaffold always writes
   them per point 1), `config.playerCount` is provably unreachable dead code in this chain —
   confirmed by direct read, not inference.
3. **`build.ts`'s manifest silently forwards any stale `playerCount`.** `src/cli/commands/build.ts:108-116`:
   ```
   const manifest = {
     ...config,
     buildTime: new Date().toISOString(),
     version: config.version || '1.0.0',
     engineProtocol: BUNDLE_PROTOCOL_VERSION,
   };
   ```
   This is a raw spread of the parsed `boardsmith.json` — `build.ts` never calls
   `loadGameDefinition` (confirmed: no import of `game-runtime.js` anywhere in `build.ts`, full
   file read). Any `playerCount` value present in `boardsmith.json` — correct, stale, or
   hand-edited to diverge from `gameDefinition` — rides unchanged into the published
   `manifest.json`. This is a second, distinct silent-divergence surface beyond the `dev.ts`
   chain the audit named.
4. **`validate.ts` currently requires `playerCount` and validates its shape**, reinforcing the
   impression that it is authoritative when it is not: `src/cli/commands/validate.ts:94`
   (`required` list includes `'playerCount'`) and `:102-108` (min/max shape + ordering checks).

**CONTEXT.md locked decision:** `gameDefinition` (code) is the SOLE source of truth for player
count. `playerCount` is to be removed from `boardsmith.json` and the scaffold entirely;
`build.ts`'s manifest must actively derive `playerCount: {min, max}` from `gameDefinition` (via
`loadGameDefinition`, the existing helper already used by `simulate.ts:167`), not merely stop
receiving the field from a deleted scaffold key.

**VERDICT: LEGITIMATE**

The audit's core claim (config vs. code drift, chain resolves to code) is confirmed exactly as
described. Research additionally surfaced a second silent-forwarding site (`build.ts`'s
`{...config}` manifest spread) not named in the original audit text — this is in-scope for the
same fix (derive-not-duplicate) and must be included in the Plan 02 fix task, not treated as a
separate finding.

---

## F21 / CLIX-03 — Bundle-size validation passes bundles 4x larger than the server limit

**Audit claim:** `boardsmith validate`'s bundle-size check passes bundles up to 200MB while its
own comment and the real server enforcement limit is 50MB.

**Current HEAD trace:**

`src/cli/commands/validate.ts:222-226`:
```
async function validateBundleSize(cwd: string): Promise<ValidationResult> {
  // Limits match server-side enforcement:
  //   rules.js: 1MB (executor MAX_BUNDLE_SIZE)
  //   total bundle zip: 50MB (games worker MAX_BUNDLE_SIZE)
  const maxRulesJs = 1 * 1024 * 1024; // 1MB - executor limit
  const maxTotalBundle = 200 * 1024 * 1024; // 200MB - upload limit
```
The comment on line 224 states the total-bundle server enforcement is **50MB**. The constant on
line 226 (`maxTotalBundle`) is set to **200MB** (`200 * 1024 * 1024`). These disagree by 4x.

**Independent re-confirmation of the authoritative external value** — re-read directly this
session, not taken from the audit or RESEARCH.md's citation alone:
```
$ grep -n "MAX_BUNDLE_SIZE" ~/ShufflewickPubGames/src/upload.ts
4:const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50MB
57:    if (contentLength > MAX_BUNDLE_SIZE) {
60:        `Bundle size ${contentLength} bytes exceeds maximum of ${MAX_BUNDLE_SIZE} bytes (50MB)`,
67:  if (body.byteLength > MAX_BUNDLE_SIZE) {
70:      `Bundle size ${body.byteLength} bytes exceeds maximum of ${MAX_BUNDLE_SIZE} bytes (50MB)`,
```
`~/ShufflewickPubGames/src/upload.ts:4` — the real, authoritative games-worker upload gate — is
`MAX_BUNDLE_SIZE = 50 * 1024 * 1024` (50MB), matching the comment in `validate.ts`, not the
constant.

**VERDICT: LEGITIMATE.** The CODE (`maxTotalBundle = 200 * 1024 * 1024` at
`validate.ts:226`) is wrong; the COMMENT (`validate.ts:224`, "50MB") is correct and matches the
authoritative external server value at `~/ShufflewickPubGames/src/upload.ts:4`. The fix is to
change the constant to `50 * 1024 * 1024`, NOT to rewrite the comment to say 200MB. `publish.ts`
(which reuses this same `validateBundleSize` check per RESEARCH.md's trace) inherits the same
false-pass risk and is in scope for the same fix.

---

## F22 / CLIX-02 — boardsmith.json accepts any keys silently

**Audit claim:** `boardsmith.json` accepts any top-level keys silently; a misspelled
`gameOptions`/`playerOptions`/`colorPalette` key just vanishes with no error.

**Current HEAD trace:**

`src/cli/commands/validate.ts:86-143` (`validateMetadata`):
- Line 94: `const required = ['name', 'displayName', 'description', 'playerCount'];` — checks only
  that these four keys are *present*.
- Lines 102-108: additional shape checks scoped to `playerCount` only (min/max present,
  min <= max).
- Lines 115-128: additional shape checks scoped to `ui` only.
- **No code path anywhere in `validateMetadata` (or elsewhere in `validate.ts`, confirmed by full
  file read) iterates the actual keys present in `config` and compares them against an allowed
  set.** A required-field presence check is not the same as a closed-set key check — the function
  can never detect an *unexpected* key, whatever its name. A misspelled `gameOption` (missing
  's') or `colorPallete` (typo) is simply an inert extra key on the parsed object: no required
  field references it, so `issues` never grows, and `validateMetadata` returns `passed: true`.
- Confirmed at the consumption side too: `src/cli/commands/dev.ts:363-364` and `:371` read
  `config.gameOptions`, `config.playerOptions`, `config.colorPalette` directly by exact key name
  with no fallback/did-you-mean — a misspelled key is simply `undefined` and the corresponding
  feature (custom game options, player options, color palette) silently doesn't apply, with zero
  console output.
- `src/cli/lib/project-scaffold.ts:105` additionally emits a dead `$schema` URL
  (`https://boardsmith.io/schemas/game.json`) in every scaffolded project — no schema is actually
  shipped or served at that URL (confirmed: no `schemas/` directory or route exists in this
  repo), so editors that try to resolve it for autocomplete/validation get nothing, reinforcing
  the "nothing catches typos" surface named by this finding.

**VERDICT: LEGITIMATE.** `validateMetadata` implements only a required-field presence check, with
zero unknown/unexpected-key detection at any layer (`validate` or `dev` startup). The dead
`$schema` URL compounds the problem by suggesting editor-time validation exists when none does.

---

## F32 / CLIX-04 — boardsmith dev binds 0.0.0.0 by default while its own --host help text implies localhost

**Audit claim:** `boardsmith dev` binds to `0.0.0.0` (all interfaces) by default, but its own
`--host` help text implies localhost is the default — a LAN-exposure footgun that is also
mis-documented.

**Current HEAD trace:**

- `src/cli/commands/dev.ts:283`: `const host = options.host ?? '0.0.0.0';` — confirmed, default
  bind is `0.0.0.0` (all interfaces) when `--host` is not passed.
- `src/cli/cli.ts:35`: `.option('--host <host>', 'Host to bind the server to (e.g., 0.0.0.0 for
  network access)')` — the help text frames `0.0.0.0` as something the user must opt into
  ("e.g., 0.0.0.0 for network access"), implying the default is something else (localhost). This
  is misleading relative to the actual default confirmed above.
- A network-URL disclosure banner already exists and was independently re-confirmed present at
  `src/cli/commands/dev.ts:594-599` (prints `Network (others can join): <url>` for each resolved
  network URL) — this is a *reactive* disclosure of whatever interfaces Vite resolved, not a
  banner about the *host default itself* when binding to all interfaces.

**CONTEXT.md's LOCKED decision (authoritative, overrides any prior draft table):**
`boardsmith dev` must default to **127.0.0.1** (localhost-only). LAN play becomes explicit via
`--host 0.0.0.0` (plus an optional `--lan` shorthand). When binding to a non-localhost address,
print a loud startup banner (e.g. "Serving to your whole network — pass --host 127.0.0.1 for
local-only"). Help text must be corrected to match the actual (new) default.

**Correction of a RESEARCH.md discrepancy (recorded here per the plan's must-have):**
`135-RESEARCH.md`'s "State of the Art" table (row 2, "Old Approach"/"Current Approach" pair) is
**WRONG** where it states the CONTEXT decision is "Same 0.0.0.0 default (CONTEXT.md keeps
LAN-by-default as a product decision)". Re-reading `135-CONTEXT.md` directly
(`### Dev Host & Flags`, CLIX-04 bullet) shows the actual locked text: **"`boardsmith dev`
defaults to 127.0.0.1. LAN play is explicit: `--host 0.0.0.0` (plus a `--lan` shorthand)."**
There is no ambiguity in CONTEXT.md's wording — it explicitly states the new default is
127.0.0.1, not 0.0.0.0. CONTEXT.md is the authoritative source for locked product decisions in
this repo's planning hierarchy; RESEARCH.md's misreading must NOT be carried into the fix plan.
The Plan 02-06 fix task for CLIX-04 must implement default-127.0.0.1 (a behavior change from
current 0.0.0.0), not merely fix the help text around an unchanged 0.0.0.0 default.

**VERDICT: LEGITIMATE.** Current default is `0.0.0.0` (dev.ts:283) with misleading help text
(cli.ts:35). The fix is a real default-value change to 127.0.0.1 per CONTEXT.md's locked
decision, not a documentation-only correction — RESEARCH.md's State-of-the-Art table is
incorrect on this point and is superseded by this verdict.

---

## F33 / CLIX-05 — boardsmith init -t/--template is accepted, documented, and ignored

**Audit claim:** `boardsmith init` accepts a `-t/--template` flag with a documented default, but
the value is never read or acted upon anywhere in `initCommand`.

**Current HEAD trace:**

- `src/cli/cli.ts:27`: `.option('-t, --template <template>', 'Template to use (default:
  card-game)', 'card-game')` — flag is registered with a fake default value of `'card-game'`
  (there is no other template; the word "default" implies alternatives exist).
- `src/cli/commands/init.ts:15-17`: `interface InitOptions { template: string; }` — the option is
  typed and received into `initCommand(name, options)`.
- Full-file read of `src/cli/commands/init.ts` (all 317 lines) confirms **zero** read sites for
  `options.template` anywhere in `initCommand`'s body (lines 19-80) or any helper function it
  calls (`generateGameTs`, `generateElementsTs`, `generateActionsTs`, `generateFlowTs`,
  `generateTestTs`, lines 82-317). Every generated file's content is identical regardless of what
  value `--template` is passed. `grep -n "options.template\|\.template" src/cli/commands/init.ts`
  confirms only the interface declaration and the destructure — no usage.

**VERDICT: LEGITIMATE.** `-t/--template` is a fully silent no-op: it parses, accepts any string,
and has provably zero effect on `initCommand`'s output. Per CONTEXT.md's locked decision and the
No Backward Compatibility rule, the fix is outright removal of the flag from `cli.ts` and the
`InitOptions` interface (not documentation of the no-op behavior), until multiple templates
actually exist.

---

## F34 / CLIX-06 — --players silently clamped; --ai validated against pre-clamp count

**Audit claim:** `--players` is silently clamped into range (rather than erroring) and can
silently produce a zero-seat host if NaN; `--ai` seat validation runs against the raw pre-clamp
player count instead of the effective post-clamp count.

**Current HEAD trace:**

1. **Unguarded parseInt, no NaN/range guard before use.** `src/cli/commands/dev.ts:280-281`:
   ```
   const port = parseInt(options.port, 10);
   const playerCount = parseInt(options.players, 10);
   ```
   Neither line is followed by an `isNaN`/`Number.isInteger` check before `playerCount` and
   `port` are used downstream (`port` is checked only against `UNSAFE_PORTS` at line 286, which
   does not catch `NaN`; `playerCount` flows straight into the `--ai` filter at line 302 and later
   into the clamp at line 393). Contrast with the existing house pattern already in the codebase
   at `src/cli/commands/simulate.ts:145-153`, which does
   `if (!Number.isInteger(playersCount) || playersCount < 1) { ...error...; process.exit(1); }`
   before use — `dev.ts` has no equivalent guard.
2. **`--ai` validated against raw pre-clamp `playerCount`, before `minPlayers`/`maxPlayers` are
   even known.** `src/cli/commands/dev.ts:302`:
   ```
   const invalidAiPlayers = aiPlayers.filter(p => p < 1 || p > playerCount);
   ```
   This runs at line 302 — before `boardsmith.json` is read (`configPath` existence check is at
   line 310-315, after this), and long before `gameDefinition.minPlayers`/`maxPlayers` are
   resolved inside the `try` block starting at line 354 (`minPlayers`/`maxPlayers` assigned at
   lines 359-360). The clamp that produces the actual effective player count happens even later,
   at line 393: `const effectivePlayerCount = Math.min(Math.max(playerCount, minPlayers),
   maxPlayers);`. So today's `--ai` bounds check validates against a number (`playerCount`, the
   raw un-clamped CLI value) that may not equal the game's actual seat count once
   `minPlayers`/`maxPlayers` are applied — e.g. `--players 10 --ai 5` on a 2-4 player game where
   the raw `playerCount=10` passes the pre-clamp check (`5 <= 10`) even though after the clamp at
   line 393 `effectivePlayerCount` becomes 4, making AI seat 5 invalid against the real
   post-clamp seat count — confirmed as a genuine ordering bug, not merely an audit overstatement.
3. **No fail-fast on out-of-range `--players`; current behavior clamps silently.** Line 393's
   `Math.min(Math.max(playerCount, minPlayers), maxPlayers)` silently coerces any out-of-range
   `playerCount` into the game's valid range with no error or warning printed anywhere in the
   function (confirmed: no `console.error`/`console.warn` between lines 380-403 referencing the
   clamp).

**CONTEXT.md's locked decision:** Fail fast on invalid numeric flags — non-numeric
`--players`/`--port`/`--ai` values error immediately; out-of-range `--players` ERRORS (not
clamps) once the game's min/max are known; `--ai` seats validated against the effective final
player count.

**Ordering fix recorded (per 135-RESEARCH.md Pitfall 3, independently re-confirmed by this
trace):** The `--ai` bounds-check block (currently at dev.ts:302-308) must MOVE to after
`effectivePlayerCount` is computed (after line 393), validating against
`effectivePlayerCount` — not merely swap `playerCount` for `effectivePlayerCount` in place at the
current line 302 location, since `effectivePlayerCount` does not exist yet at that point in the
function (this would be a build error if attempted naively, which is a useful compile-time
tripwire but the correct fix is still a relocation, not a bare identifier swap). The early
NaN/non-numeric checks for `--players`/`--port` (which do NOT depend on `gameDefinition`) can
stay at their current early position in the function.

**VERDICT: LEGITIMATE.** All three sub-claims (unguarded parseInt, silent clamp, pre-clamp `--ai`
validation) are confirmed at current HEAD. The `--ai` validation fix requires relocating the
check block, not just changing its comparison operand — the code-location move is a load-bearing
detail for the fix plan (Pitfall 3 concern), and is recorded here per the plan's requirements so
Plans 02-06 do not attempt an in-place operand swap that would fail to compile.

---

## Summary

| Finding | Requirement | Verdict | Key correction/note |
|---------|-------------|---------|----------------------|
| F9  | CLIX-01 | LEGITIMATE | `build.ts`'s manifest spread is a second, audit-unnamed silent-forward site; must derive via `loadGameDefinition`, not just delete the scaffold key |
| F21 | CLIX-03 | LEGITIMATE | The CODE (200MB constant) is wrong; the COMMENT (50MB) is correct and matches `~/ShufflewickPubGames/src/upload.ts:4` (50MB) — change the constant, not the comment |
| F22 | CLIX-02 | LEGITIMATE | No unknown-key detection exists at any layer; dead `$schema` URL compounds the gap |
| F32 | CLIX-04 | LEGITIMATE | CONTEXT.md's locked decision is default **127.0.0.1** (NOT 0.0.0.0-by-default as 135-RESEARCH.md's State-of-the-Art table mistakenly states); dev.ts:283 currently defaults to 0.0.0.0 — this is a real default-value fix, not docs-only |
| F33 | CLIX-05 | LEGITIMATE | `-t/--template` provably has zero read sites in `initCommand`; remove outright |
| F34 | CLIX-06 | LEGITIMATE | `--ai` validation must be relocated to after `effectivePlayerCount` is computed (dev.ts:393), not edited in place at dev.ts:302 |

All six findings LEGITIMATE. No fix code written in this document. Plans 02-06 are unblocked.
