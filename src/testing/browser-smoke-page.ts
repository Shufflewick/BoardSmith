/**
 * WHAT THE SMOKE WALK READS OFF THE PAGE (#461, #462, #464), as plain functions Playwright runs in
 * the page over the elements a locator matched (`locator.evaluateAll`).
 *
 * Each is ONE look at the page. The walk used to count a locator's matches and then read each match
 * in turn, and an element the page removed between the count and a read left that read waiting for
 * it with no end (#464). A look taken in one go cannot see an element half gone.
 *
 * Playwright sends each function's source to the page and runs it there, so each one is
 * self-contained: no imports, and nothing from outside its own body. Kept apart from
 * `browser-smoke.ts`, which needs Playwright, so a vitest test can hold them to what they pick.
 */

/** One control the walk may press, as one look at the page showed it. */
export interface PageControl {
  /** Its place among the elements the locator matched, which `locator.nth` presses. */
  readonly index: number;
  /** How it reads to a person: its `aria-label`, else its `title`, else its text. */
  readonly label: string;
  /**
   * What it stands for: the game element (`data-bs-el-id`) when it has one, else the choice a pick's
   * candidate stands for (`data-bs-candidate`), else its label.
   */
  readonly key: string;
  /** Whether a player can press it now: not `aria-disabled`, not `disabled`. */
  readonly enabled: boolean;
  /**
   * Whether its players press it from the keyboard (#457): it takes no pointer (`pointer-events:
   * none`) AND cannot be seen (no opacity, hidden, or not rendered, on it or an ancestor), as a
   * keyboard board laid invisibly over a canvas is. A control a sighted player can see is clicked,
   * even when it takes no pointer, so one a mouse cannot press fails the walk.
   */
  readonly keyboardOnly: boolean;
}

/**
 * The controls among `elements` a player can reach, in order. One inside the game-over card is not
 * the game's (#462): the walk sees that card as the game ending, and its Close would hide the end.
 * One inside an `inert` subtree cannot be reached by anyone, so it is not a control either (#461).
 */
export function pageControls(elements: Element[]): PageControl[] {
  const found: PageControl[] = [];
  elements.forEach((element, index) => {
    if (element.closest('.game-over-card, [inert]') !== null) return;
    const html = element as HTMLElement;
    const label = (html.getAttribute('aria-label') ?? html.getAttribute('title') ?? html.innerText).replace(/\s+/g, ' ').trim();
    const id = html.getAttribute('data-bs-el-id');
    const candidate = html.getAttribute('data-bs-candidate');
    const key = id !== null ? `element:${id}` : candidate !== null ? `candidate:${candidate}` : `label:${label}`;
    const enabled = html.getAttribute('aria-disabled') !== 'true' && !(html as HTMLButtonElement).disabled;
    const keyboardOnly =
      getComputedStyle(html).pointerEvents === 'none' && !html.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    found.push({ index, label, key, enabled, keyboardOnly });
  });
  return found;
}

/** An open modal dialog, as one look at the page showed it. */
interface PageDialog {
  /** Its place among the elements the locator matched. */
  readonly index: number;
  /** Its accessible name: `aria-label`, else the text `aria-labelledby` names, else its first heading. */
  readonly name: string;
}

/** The open modal dialogs on a page: an `aria-modal="true"` dialog, or a `<dialog>` shown modally. */
export const MODAL_DIALOGS = '[aria-modal="true"], dialog:modal';

/**
 * The open modal dialogs among `elements` (matches of {@link MODAL_DIALOGS}), in order, so the last
 * is the one on top, each with its name. While one is open a player can reach only what is inside it
 * (#461). The game-over card is a modal too, but the walk sees it as the game ending (#462), so it
 * is not one of these.
 */
export function pageDialogs(elements: Element[]): PageDialog[] {
  const found: PageDialog[] = [];
  elements.forEach((element, index) => {
    if (element.closest('.game-over-card') !== null) return;
    const labelledBy = element.ownerDocument.getElementById(element.getAttribute('aria-labelledby') ?? '');
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
    const name = element.getAttribute('aria-label') ?? (labelledBy ?? heading)?.textContent ?? '';
    found.push({ index, name: name.replace(/\s+/g, ' ').trim() });
  });
  return found;
}

/**
 * The value the walk enters in an empty number field (#465): the field's own least value, else 1,
 * whole when the field takes whole numbers (`step="1"`), plus one for each of the `refused` values
 * the game's own rules turned down before (#466), and never past its most.
 */
export function numberToEnter(input: HTMLInputElement, refused: number): string {
  const least = input.min === '' ? 1 : Number(input.min);
  const most = input.max === '' ? Infinity : Number(input.max);
  return String(Math.min((input.step === '1' ? Math.ceil(least) : least) + refused, most));
}
