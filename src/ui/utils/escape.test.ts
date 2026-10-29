import { it, expect } from 'vitest';
import guide from '../../../docs/custom-ui-guide.md';

const sources = import.meta.glob<string>(
  ['/src/ui/**/*.{ts,vue}', '/src/cli/dev-host/**/*.{ts,vue}', '!**/*.test.ts', '!**/*.test-helper.ts'],
  { query: '?raw', import: 'default', eager: true },
);

// #1524: a game listening page-wide skips a handled Escape, so every Escape BoardSmith acts on goes through handleEscape.
it('no UI or dev host source reads the Escape key except through handleEscape', () => {
  const readers = Object.entries(sources)
    .filter(([path, text]) => !path.endsWith('/src/ui/utils/escape.ts') && /['"]Escape['"]|@key(?:down|up)\.esc/.test(text))
    .map(([path]) => path);
  expect(Object.keys(sources).length).toBeGreaterThan(100);
  expect(readers).toEqual([]);
});

it('the custom UI guide tells a game to skip a handled Escape when listening page-wide', () => {
  const section = guide.slice(guide.indexOf('### Listening for Escape Page-Wide'));
  expect(section).toContain("if (event.key !== 'Escape' || event.defaultPrevented) return;");
});
