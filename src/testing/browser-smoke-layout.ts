/**
 * WHAT SCROLLS SIDEWAYS ON A PHONE (#1797). At every step the walk lays the game out at each of
 * {@link PHONE_VIEWPORTS}, with touch, and reads {@link sidewaysScrolls} in the game's frame.
 *
 * {@link sidewaysScrolls} runs in the page, so it is self-contained: no imports, and nothing from
 * outside its own body.
 */

/** A phone the walk lays the game out on. */
export interface PhoneViewport {
  readonly width: number;
  readonly height: number;
  readonly held: 'portrait' | 'landscape';
}

/** The phones every game is checked on, upright and on its side. */
export const PHONE_VIEWPORTS: readonly PhoneViewport[] = [
  { width: 390, height: 844, held: 'portrait' },
  { width: 844, height: 390, held: 'landscape' },
];

/** Something a player can scroll sideways, as one look at the page showed it. */
export interface SidewaysScroll {
  /** Its test id, else its tag and classes after the nearest test id around it; "the game's page" for the page itself. */
  readonly what: string;
  /** Where it is, by its place under the nearest test id, which a state class coming and going does not change. */
  readonly where: string;
  /** How wide its content is (`scrollWidth`), in CSS pixels. */
  readonly content: number;
  /** How wide its box is (`clientWidth`), in CSS pixels. */
  readonly box: number;
}

/**
 * Everything in the page a player can scroll sideways: the page itself, and every box whose
 * `overflow-x` is `auto` or `scroll` with content wider than it. A box clipped on purpose
 * (`overflow-x: hidden` or `clip`) is not one. Nor is a box the game marks as meant to pan sideways
 * with `data-bs-scrolls="x"`, or one that holds something so marked that is wider than it, such as a
 * large map the shell's board region pans.
 */
export function sidewaysScrolls(): SidewaysScroll[] {
  const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll';
  const name = (element: Element): string => {
    const id = element.getAttribute('data-testid');
    if (id !== null) return `[data-testid="${id}"]`;
    const own = element.tagName.toLowerCase() + (element.id === '' ? '' : `#${element.id}`) + [...element.classList].map((c) => `.${c}`).join('');
    const around = element.parentElement?.closest('[data-testid]');
    return around ? `${name(around)} ${own}` : own;
  };
  const place = (element: Element): string => {
    const id = element.getAttribute('data-testid');
    const parent = element.parentElement;
    if (id !== null) return `[data-testid="${id}"]`;
    if (parent === null) return element.tagName.toLowerCase();
    return `${place(parent)}>${[...parent.children].indexOf(element)}`;
  };
  // Widths round to whole pixels, so content a fraction of a pixel inside its box can read 1px over.
  const wider = (box: Element) => box.scrollWidth > box.clientWidth + 1;
  const panned = [...document.querySelectorAll('[data-bs-scrolls="x"]')];
  const meantToPan = (box: Element) =>
    box.getAttribute('data-bs-scrolls') === 'x' || panned.some((wide) => wide !== box && box.contains(wide) && wide.getBoundingClientRect().width > box.clientWidth);
  const root = document.documentElement;
  const rootOverflow = getComputedStyle(root).overflowX;
  // The body's overflow is the page's when the root's is visible, and the body is then no scroll box of its own.
  const pageOverflow = rootOverflow === 'visible' ? getComputedStyle(document.body).overflowX : rootOverflow;
  const found: SidewaysScroll[] = [];
  if (pageOverflow !== 'hidden' && pageOverflow !== 'clip' && wider(root) && !meantToPan(root)) {
    found.push({ what: "the game's page", where: 'page', content: root.scrollWidth, box: root.clientWidth });
  }
  const boxes = rootOverflow === 'visible' ? document.body.querySelectorAll('*') : [document.body, ...document.body.querySelectorAll('*')];
  for (const box of boxes) {
    if (scrolls(getComputedStyle(box).overflowX) && wider(box) && !meantToPan(box)) {
      found.push({ what: name(box), where: place(box), content: box.scrollWidth, box: box.clientWidth });
    }
  }
  return found;
}

/** The phone and the box, as {@link sidewaysProblem} names them, so the walk reports each once. */
export function sidewaysKey(phone: PhoneViewport, scroll: SidewaysScroll): string {
  return `${phone.width}x${phone.height} ${scroll.where}`;
}

/** The problem `scroll` is on `phone`, first seen `where` ("at step 3 of the game dealt from seed "smoke""). */
export function sidewaysProblem(phone: PhoneViewport, scroll: SidewaysScroll, where: string): string {
  return (
    `On a phone at ${phone.width}x${phone.height} (${phone.held}, touch), ${scroll.what} scrolls sideways: its content is ` +
    `${scroll.content}px wide in a box ${scroll.box}px wide, first seen ${where}. Make it fit that width (a fixed \`width\` or ` +
    '`min-width` inside it is the usual cause), or, for content meant to pan sideways such as a large map, mark it `data-bs-scrolls="x"`.'
  );
}
