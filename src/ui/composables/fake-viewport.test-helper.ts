/**
 * A `window.matchMedia` that answers for a viewport size a test sets, and tells
 * its listeners when the size changes, as a browser does on resize or rotation.
 * jsdom lays nothing out and ships no matchMedia, so this is the only way a
 * shell test can see a phone. It understands the queries the shells ask:
 * `(max-width: Npx)` and `(orientation: portrait)`, and reduced motion is off.
 */
type Size = { width: number; height: number };
type Listener = (event: { matches: boolean; media: string }) => void;

interface FakeQuery {
  media: string;
  matches: boolean;
  listeners: Set<Listener>;
}

function answer(media: string, { width, height }: Size): boolean {
  const maxWidth = /^\(max-width: (\d+)px\)$/.exec(media);
  if (maxWidth) return width <= Number(maxWidth[1]);
  if (media === '(orientation: portrait)') return height >= width;
  if (media === '(prefers-reduced-motion: reduce)') return false;
  throw new Error(`The fake viewport cannot answer the media query ${media}; teach fake-viewport.test-helper.ts it.`);
}

/** Install the fake at `size`. `resize` moves it and fires `change` on every query whose answer flipped; `restore` puts the old matchMedia back. */
export function fakeViewport(size: Size) {
  const previous = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  let current = size;
  const queries: FakeQuery[] = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => {
      const query: FakeQuery = { media, matches: answer(media, current), listeners: new Set() };
      queries.push(query);
      return {
        media,
        get matches() { return query.matches; },
        addEventListener: (_type: 'change', listener: Listener) => query.listeners.add(listener),
        removeEventListener: (_type: 'change', listener: Listener) => query.listeners.delete(listener),
      };
    },
  });
  return {
    resize(next: Size): void {
      current = next;
      for (const query of queries) {
        const matches = answer(query.media, next);
        if (matches === query.matches) continue;
        query.matches = matches;
        for (const listener of query.listeners) listener({ matches, media: query.media });
      }
    },
    /** How many change listeners are still attached, to prove an unmount removed its own. */
    listening: () => queries.reduce((sum, query) => sum + query.listeners.size, 0),
    restore(): void {
      if (previous) Object.defineProperty(window, 'matchMedia', previous);
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}
