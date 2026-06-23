/**
 * useSelectable divergence guard (A11Y-01 architectural invariant)
 *
 * Reads each renderer .vue source file and asserts:
 *   1. None of the forbidden pre-migration handler names are present:
 *      - `function handleClick`  — old per-renderer click handler
 *      - `handleCellClick`        — old grid cell click handler name
 *      - `handleHexClick`         — old hex cell click handler name
 *   2. `@click` is NOT bound directly to `triggerElementSelect` (bypassing the composable).
 *   3. Each renderer imports `useSelectable` or `useSelectableGrid`.
 *
 * Purpose: Makes "Critical finding #1" (keyboard-via-one-composable) divergence-
 * impossible in CI. Any future edit that re-adds a per-renderer click handler causes
 * this test to fail, surfacing the regression before it ships.
 *
 * Note: `handleCellActivate` and `handleHexActivate` (used in GridBoardRenderer /
 * HexBoardRenderer) are NOT forbidden — they are the correct post-migration local
 * wrappers that go through `useSelectableGrid` and `boardInteraction.triggerElementSelect`.
 * Only the original pre-migration names are listed here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const RENDERERS_DIR = dirname(fileURLToPath(import.meta.url));

/** The eight interactive renderers that must use the shared composable for selection. */
const RENDERER_FILES = [
  'CardRenderer.vue',
  'PieceRenderer.vue',
  'DeckRenderer.vue',
  'HandRenderer.vue',
  'SpaceRenderer.vue',
  'DieRenderer.vue',
  'GridBoardRenderer.vue',
  'HexBoardRenderer.vue',
] as const;

/**
 * Forbidden tokens: pre-migration handler names that must NEVER reappear.
 * These are the identifiers that were replaced by useSelectable / useSelectableGrid
 * during the A11Y-01 keyboard migration (plans 02/03/04).
 */
const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'function handleClick',
    pattern: /function handleClick\b/,
  },
  {
    name: 'handleCellClick identifier',
    pattern: /\bhandleCellClick\b/,
  },
  {
    name: 'handleHexClick identifier',
    pattern: /\bhandleHexClick\b/,
  },
  {
    name: '@click bound directly to triggerElementSelect',
    // Matches @click="boardInteraction.triggerElementSelect(...)" or similar —
    // callers must go through useSelectable/useSelectableGrid, not bypass it.
    pattern: /@click(?:\.[\w]+)*="[^"]*triggerElementSelect/,
  },
];

describe('useSelectable divergence guard — renderer source scan', () => {
  for (const filename of RENDERER_FILES) {
    const filepath = join(RENDERERS_DIR, filename);

    it(`${filename}: no forbidden handlers; imports useSelectable or useSelectableGrid`, () => {
      let source: string;
      try {
        source = readFileSync(filepath, 'utf8');
      } catch (err) {
        throw new Error(
          `Cannot read renderer source for divergence scan: ${filepath}\n` +
          `Ensure the file exists and all A11Y-01 migration plans (101-02/03/04) have run.\n` +
          `Original error: ${String(err)}`,
        );
      }

      // ── 1. Assert no forbidden pre-migration handler names ──────────────────
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        const match = source.match(pattern);
        expect(
          match,
          `${filename}: found forbidden token "${name}" — ` +
          `re-adding per-renderer selection wiring breaks the A11Y-01 invariant. ` +
          `Use useSelectable / useSelectableGrid instead. Matched: "${match?.[0]}"`,
        ).toBeNull();
      }

      // ── 2. Assert composable import is present ───────────────────────────────
      // Both useSelectable (element renderers) and useSelectableGrid (grid renderers)
      // satisfy this requirement — the import pattern covers both forms.
      const importsComposable = /useSelectable(?:Grid)?/.test(source);
      expect(
        importsComposable,
        `${filename}: missing import of useSelectable or useSelectableGrid. ` +
        `Every interactive renderer must wire click+keydown through the shared A11Y-01 composable.`,
      ).toBe(true);
    });
  }
});
