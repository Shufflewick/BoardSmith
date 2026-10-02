/**
 * #451: shell text surfaces teleported to <body> must set the shell's font.
 *
 * GameShell sets `font-family: var(--bsg-font)` on its own root. A surface
 * teleported to <body> is outside that root, so it inherits the HOST page's
 * font instead, which for a bare page is the browser's default serif. The
 * `--bsg-font` token itself lives on `:root` (theme.ts), so the surface only has
 * to read it.
 *
 * Asserted against each component's real `<style scoped>` block, as
 * GameShell.panel-footprint.test.ts does, because jsdom applies no SFC styles:
 * the CSS is the behaviour.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Each text surface that teleports to body, and the class on its teleported root. */
const TELEPORTED_TEXT_SURFACES = [
  { file: path.join(HERE, 'ActionHelpPopover.vue'), root: '.action-help-popover' },
  { file: path.join(HERE, 'DisabledReasonTooltip.vue'), root: '.bs-disabled-tip' },
  { file: path.join(HERE, '..', 'Toast.vue'), root: '.toast-container' },
];

describe('teleported shell text uses the shell font (#451)', () => {
  for (const { file, root } of TELEPORTED_TEXT_SURFACES) {
    it(`${path.basename(file)} sets font-family on ${root}`, () => {
      const source = fs.readFileSync(file, 'utf-8');
      expect(source, `${path.basename(file)} no longer teleports to body`).toContain('<Teleport to="body">');
      expect(source, `${root} is not in the template of ${path.basename(file)}`).toContain(`class="${root.slice(1)}"`);

      const at = source.indexOf(`\n${root} {`);
      expect(at, `${root} { ... } not found in ${path.basename(file)}`).toBeGreaterThan(-1);
      const block = source.slice(at, source.indexOf('\n}', at));
      expect(block).toMatch(/font-family\s*:\s*var\(--bsg-font\)\s*;/);
    });
  }
});
