/**
 * WHAT ONE SELECTION ACTUALLY OFFERS A PLAYER, formatted for a wire.
 *
 * A selection's candidates are evaluated by the ActionExecutor and then have to
 * be turned into something a surface can draw: a value plus a label plus the
 * board references that let a click on the board mean the same thing as a click
 * in the action panel. That formatting used to live inside
 * `session/pick-handler.ts`, which is the right place while a TABLE is the only
 * thing that enumerates.
 *
 * A world enumerates now (#169). Its verbs are ordinary `ActionDefinition`s and
 * its offer is the table's own `ActionMetadata`, so it needs the same
 * candidates formatted the same way -- and a second formatter written beside
 * this one is precisely how the board and the action panel come to disagree
 * about what a choice is called. So the two formatters live here, in the
 * engine, where both the session's `PickHandler` and `boardsmith/world`'s offer
 * builder call them.
 *
 * Nothing here decides WHETHER a candidate is offered. That is `getChoices`'s
 * and the selection's `disabled`'s business, and it has already happened by the
 * time a value reaches this file.
 */
import { isDevThrowEnabled } from '../../utils/dev.js';
import type {
  BoardElementRef,
  ChoiceSelection,
  ElementSelection,
  ElementsSelection,
} from '../action/types.js';
import type { Game } from './game.js';
import type { Player } from '../player/player.js';
import type { ChoiceWithRefs, ValidElement, WarningEntry } from '../../types/protocol.js';

/** One candidate as the executor answers it: the value, and why it cannot be
 *  taken if it cannot. */
export interface AnnotatedCandidate {
  value: unknown;
  disabled: string | false;
}

/** The context a `display()`, `boardRef()` or `boardRefs()` callback receives.
 *  Not exported: a caller writes an object literal and TypeScript checks it
 *  structurally against the two formatters' signatures. */
interface CandidateContext {
  game: Game;
  player: Player;
  args: Record<string, unknown>;
}

/**
 * Turn a throw out of a game-authored `boardRefs()`/`display()`/`boardRef()`
 * callback into a message that is safe to put on the wire (T-126-07, #47).
 *
 * It used to return `error.message` verbatim, which is not sanitizing: a
 * runtime `TypeError: Cannot read properties of undefined (reading 'suit')`
 * reached the player as-is, leaking implementation detail and offering no next
 * step. The full error is now logged where the game runs, and only in a
 * positively-labelled dev/test environment does the underlying text travel —
 * where the reader is the author who needs it and there is no player to leak to.
 *
 * @param source - Which callback failed, e.g. `boardRefs(...)`. Named in the
 *   message so the author knows where to look even in production.
 */
function sanitizeCallbackError(error: unknown, source: string): string {
  console.error(`[BoardSmith] ${source} threw and its result was dropped:`, error);
  if (isDevThrowEnabled()) {
    return `${source} threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  return `${source} could not be evaluated for this choice.`;
}

/** The label a raw choice value carries, when it carries one of its own. */
function defaultDisplay(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return String(value);
  const obj = value as Record<string, unknown>;
  if (typeof obj.display === 'string') return obj.display;
  if (typeof obj.name === 'string') return obj.name;
  if (typeof obj.label === 'string') return obj.label;
  try { return JSON.stringify(value); } catch { return '[Complex Object]'; }
}

/**
 * Format a `choice` selection's candidates.
 *
 * A choice that already carries `{ value, display }` — everything
 * `playerChoices()` produces — is passed through rather than wrapped again, so
 * a player choice does not arrive as a label wrapped around a label.
 */
export function formatChoiceCandidates(
  candidates: readonly AnnotatedCandidate[],
  selection: ChoiceSelection,
  ctx: CandidateContext,
  warnings: WarningEntry[],
): ChoiceWithRefs[] {
  return candidates.map(({ value: rawValue, disabled }) => {
    let value: unknown;
    let display: string;

    if (rawValue && typeof rawValue === 'object' && 'value' in rawValue && 'display' in rawValue) {
      const formatted = rawValue as { value: unknown; display: string };
      value = formatted.value;
      display = formatted.display;
    } else {
      value = rawValue;
      display = selection.display ? selection.display(rawValue) : defaultDisplay(rawValue);
    }

    const choice: ChoiceWithRefs = { value, display };

    // Board refs are computed from the ORIGINAL raw value: a game that returns
    // `{value, display}` pairs writes its boardRefs against the pair.
    if (selection.boardRefs) {
      try {
        choice.refs = selection.boardRefs(rawValue, ctx).refs;
      } catch (e) {
        warnings.push({
          code: 'BOARD_REFS_ERROR',
          message: sanitizeCallbackError(e, 'boardRefs(...)'),
          source: 'boardRefs(...)',
        });
      }
    }

    if (disabled !== false) choice.disabled = disabled;
    return choice;
  });
}

/**
 * Format an `element` or `elements` selection's candidates, disambiguating
 * labels against their siblings.
 *
 * Two elements with the same name are numbered, because "Holding" and
 * "Holding" is a choice nobody can make. A `display()` the game supplied wins,
 * and receives the whole candidate list so it can disambiguate on something
 * better than an index.
 */
export function formatElementCandidates(
  candidates: readonly AnnotatedCandidate[],
  selection: ElementSelection | ElementsSelection,
  ctx: CandidateContext,
  warnings: WarningEntry[],
): ValidElement[] {
  const elements = candidates.map(({ value }) => value) as ElementLike[];
  const labels = labelElements(elements, selection, ctx, warnings);

  return candidates.map(({ value: elementRaw, disabled }, index) => {
    const element = elementRaw as ElementLike;
    const validElem: ValidElement = { id: element.id, display: labels[index]! };
    validElem.refs = [{ ref: refFor(element, selection, ctx, warnings), role: 'highlight' }];
    if (disabled !== false) validElem.disabled = disabled;
    return validElem;
  });
}

/** The little of an element these formatters read. */
type ElementLike = { id: number; name?: string; notation?: string };

/**
 * One label per element, disambiguating duplicates against their siblings.
 *
 * Two elements with the same name are numbered, because "Holding" and
 * "Holding" is a choice nobody can make. A `display()` the game supplied wins,
 * and receives the whole candidate list so it can disambiguate on something
 * better than an index.
 */
function labelElements(
  elements: readonly ElementLike[],
  selection: ElementSelection | ElementsSelection,
  ctx: CandidateContext,
  warnings: WarningEntry[],
): string[] {
  const display = selection.display as
    | ((element: never, context: CandidateContext, all: never[]) => string)
    | undefined;

  if (display) {
    return elements.map((element) => {
      try {
        return display(element as never, ctx, elements as never[]);
      } catch (e) {
        warnings.push({
          code: 'DISPLAY_ERROR',
          message: sanitizeCallbackError(e, 'display(...)'),
          source: 'display(...)',
        });
        return element.name || String(element.id);
      }
    });
  }

  const counts = new Map<string, number>();
  for (const element of elements) {
    const name = element.name || 'Element';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const seen = new Map<string, number>();
  return elements.map((element) => {
    const baseName = element.name || 'Element';
    if ((counts.get(baseName) || 1) === 1) {
      return element.notation || element.name || String(element.id);
    }
    const index = (seen.get(baseName) || 0) + 1;
    seen.set(baseName, index);
    return `${baseName} #${index}`;
  });
}

/** What the board should highlight for this candidate. */
function refFor(
  element: ElementLike,
  selection: ElementSelection | ElementsSelection,
  ctx: CandidateContext,
  warnings: WarningEntry[],
): BoardElementRef {
  const boardRef = selection.boardRef as
    | ((element: never, context: CandidateContext) => BoardElementRef)
    | undefined;
  if (!boardRef) {
    return { id: element.id, ...(element.notation ? { notation: element.notation } : {}) };
  }
  try {
    return boardRef(element as never, ctx);
  } catch (e) {
    // CHOICES_ERROR is the reserved stable code for boardRef() failures.
    warnings.push({
      code: 'CHOICES_ERROR',
      message: sanitizeCallbackError(e, 'boardRef(...)'),
      source: 'boardRef(...)',
    });
    return { id: element.id };
  }
}
