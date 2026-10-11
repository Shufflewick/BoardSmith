import { afterEach, beforeEach, vi, type MockInstance } from 'vitest';

/**
 * Call at the top of a test file whose tests play a keyboard user inside the
 * page: `document.hasFocus()` then answers true for each test, as a browser
 * does for the page the player is using.
 *
 * The Action Panel repairs stranded focus only in a document that has focus
 * (#649). jsdom answers `hasFocus()` from whether an element holds focus, so it
 * turns false the moment the focused element is removed, which is exactly the
 * stranded moment those tests exercise.
 */
export function documentHasFocus(): void {
  let hasFocus: MockInstance<() => boolean>;
  beforeEach(() => {
    hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => {
    hasFocus.mockRestore();
  });
}
