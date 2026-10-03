/**
 * #451: every surface teleported to <body> sets the shell's font.
 *
 * GameShell sets `font-family: var(--bsg-font)` on its own root. A surface
 * teleported to <body> is outside that root, so it inherits the HOST page's
 * font instead, which for a bare page is the browser's default serif. The
 * `--bsg-font` token itself lives on `:root` (theme.ts), so the surface only has
 * to read it.
 *
 * The list is FOUND, not written: every `<Teleport to="body">` under src/ui,
 * and the first static class inside it as its root. The issue named one popover
 * and the same cause turned out to cover seven more, so a fixed list is the
 * thing that goes stale. A surface that genuinely has no text of its own may be
 * exempted below, with the reason.
 *
 * Asserted against each component's real `<style scoped>` block, as
 * GameShell.panel-footprint.test.ts does, because jsdom applies no SFC styles:
 * the CSS is the behaviour.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TELEPORT = '<Teleport to="body">';

/**
 * Teleported surfaces that need not set the font, each with why. Keyed by the
 * file's path under src/ui. Empty today: every surface teleported to body draws
 * text somewhere.
 */
const EXEMPT: Record<string, string> = {};

function vueFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(full);
    return entry.name.endsWith('.vue') ? [full] : [];
  });
}

/** Every component that teleports to body, with the class on its teleported root. */
const SURFACES = vueFiles(UI)
  .map((file) => ({ file, source: fs.readFileSync(file, 'utf-8') }))
  .filter(({ source }) => source.includes(TELEPORT))
  .map(({ file, source }) => {
    const after = source.slice(source.indexOf(TELEPORT));
    const root = after.match(/\sclass="([\w-]+)/)?.[1] ?? null;
    return { name: path.relative(UI, file), source, root };
  });

describe('teleported shell surfaces use the shell font (#451)', () => {
  it('finds the teleported surfaces', () => {
    // If this ever reads low, the search broke and every check below went quiet.
    expect(SURFACES.length).toBeGreaterThanOrEqual(9);
  });

  it('names only exemptions that still exist', () => {
    const names = SURFACES.map((s) => s.name);
    for (const exempt of Object.keys(EXEMPT)) expect(names).toContain(exempt);
  });

  for (const { name, source, root } of SURFACES) {
    if (EXEMPT[name]) continue;
    it(`${name} sets font-family on its teleported root`, () => {
      expect(root, `no static class found inside ${TELEPORT} in ${name}`).not.toBeNull();
      const style = source.slice(source.indexOf('<style'));
      const at = style.indexOf(`\n.${root} {`);
      expect(at, `.${root} { ... } not found in ${name}'s stylesheet`).toBeGreaterThan(-1);
      const block = style.slice(at, style.indexOf('\n}', at));
      expect(block).toMatch(/font-family\s*:\s*var\(--bsg-font\)\s*;/);
    });
  }
});
