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
