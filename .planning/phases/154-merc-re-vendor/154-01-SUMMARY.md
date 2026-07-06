# Plan 154-01 Summary — MERC Re-Vendor (VENDOR-01)

**Plan:** 154-01 (execute — MERC re-vendor + integration proof)
**Completed:** 2026-07-06
**Result:** ✅ PASS — MERC re-vendored to current BoardSmith HEAD; full suite green at baseline (738 passed / 7 skipped), no MERC-side changes needed.

## What was done

1. **Pre-flight (Task 1):** Confirmed BoardSmith HEAD clean and carrying the fixes — `281e8155` (DEF-B)
   is an ancestor of HEAD; `asset-scan.ts` + `generateAssetImageVue` (Phase 152) and
   `connection-handler.ts` + the `clients.get(clientId) === socket` guard (Phase 153) all present.
   BoardSmith full suite green (2677).
2. **Re-vendor (Task 2):** Ran `node bin/boardsmith.js pack --target ~/Dropbox/MERC/BoardSmith/MERC`
   from the BoardSmith root. It rebuilt the CLI, `npm pack`ed a timestamped tarball, copied it into
   MERC's `vendor/`, rewrote MERC's `boardsmith` dependency + `overrides`, and ran `npm install` in MERC.
   - **New tgz:** `vendor/boardsmith-0.0.1-20260706164142.tgz` (was `…20260703202418.tgz`, v4.5-era).
   - Confirmed the installed `node_modules/boardsmith` carries all three fixes (connection-handler.ts,
     asset-scan.ts, generateAssetImageVue, and the dev.ts guard — in both `src/` and bundled `dist/cli.js`).
3. **MERC suite (Task 3):** `npm test` (vitest --run) from the MERC repo.
   - **Result: 738 passed | 7 skipped (745), 28 test files** — **exactly the known-green baseline
     (738/7)**. Zero regressions from the v4.7 re-vendor. No compatibility gap; **no MERC-side source
     changes were needed** (SC-3 satisfied — nothing to document or patch).
4. **Commit (Task 4):** Committed the re-vendor in the MERC repo (main, following MERC's established
   pattern; the vendor `.tgz` is gitignored per that pattern, so the commit is the `package.json` +
   `package-lock.json` dep bump).
   - **MERC commit:** `38ac286` — "chore: re-vendor boardsmith (v4.7 playtest follow-up: DEF-B +
     ASSET/DEVHOST fixes)". Not pushed.

## Result vs. baseline

| Metric | Baseline (last known-green) | After re-vendor | Verdict |
|--------|-----------------------------|-----------------|---------|
| Passing | 738 | 738 | ✅ at baseline |
| Skipped | 7 | 7 | ✅ unchanged |
| Test files | 28 | 28 | ✅ |
| MERC-side changes needed | — | none | ✅ clean absorb |

## Notes

- BoardSmith repo itself is unchanged by this phase (only planning docs); all real changes are the
  MERC dep bump. This is the milestone's capstone cross-repo integration proof: the v4.7 fixes reach
  the vendored consumer and the most complex game's suite stays green.
- Pre-existing MERC `enumerateLegalMoves` stderr warning (function-based multiSelect for
  `combatSelectTarget`) is unchanged and unrelated to v4.7 — not introduced by this re-vendor.

## Self-Check: PASSED
</content>
