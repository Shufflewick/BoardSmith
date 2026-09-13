<script setup lang="ts">
/**
 * ActionPanel - Automatically generates action UI from action metadata
 *
 * Features:
 * - Generates UI for each pick type (choice, element, number, text)
 * - Hover over choices to highlight elements on the board
 * - Click elements on board to filter choices
 * - Bidirectional interaction with the game board
 * - Element picks show buttons for valid elements
 * - Choice picks can filter based on previous picks (filterBy)
 *
 * Requires: ActionPanel must be used inside a GameShell context where the
 * action controller is provided via inject('actionController').
 */
import { ref, computed, watch, inject, nextTick, useId } from 'vue';
import { tryUseBoardInteraction } from '../../composables/useBoardInteraction';
import { useAnimationEvents } from '../../composables/useAnimationEvents.js';
import { resolvePickCounts } from '../../composables/actionControllerHelpers.js';
import { startActionWithBoardReset } from '../../composables/useBoardActionBridge.js';
import type {
  UseActionControllerReturn,
  PickMetadata,
  ActionMetadata as ControllerActionMetadata,
  ChoiceWithRefs,
  ValidElement,
  ElementRef,
} from '../../composables/useActionController';
import DoneButton from './DoneButton.vue';
import {
  splitAnchoredChoices,
  shouldDeferElementPickToBoard,
  textLengthHint,
  numberRangeHint,
} from './action-panel-helpers.js';
import {
  buildActionMenu,
  menuLevelAt,
  resolveMenuPath,
  type ActionMenuGroup,
} from './action-menu.js';
// The engine's own validators, reached the way `action-panel-helpers.ts`
// reaches for `MAX_FLAT_CHOICE_CANDIDATES`: the panel must apply the SAME
// rules the server applies, and a second copy of them is a second rule set
// (#229 for text, #237 for number).
import { numberRuleErrors } from '../../../engine/action/number-rules.js';
import { textRuleErrors } from '../../../engine/action/text-rules.js';
import ActionHelpPopover from '../helpers/ActionHelpPopover.vue';
// Type-only, so the log component's module (and its stylesheet) never enters
// this graph -- `verbatimModuleSyntax` erases the import outright.
import type { HistoryMessage } from '../GameHistory.vue';
import { vDisabledReason, isDisabled, type DisabledReason } from '../../directives/vDisabledReason.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

// Inject the action controller from GameShell (REQUIRED)
// ActionPanel is now a thin UI layer over the controller
const _actionController = inject(GAME_CONTEXT_KEYS.actionController, undefined) as UseActionControllerReturn | undefined;
if (!_actionController) {
  throw new Error('ActionPanel requires actionController to be provided via inject. Use inside GameShell.');
}
const actionController = _actionController;

// Re-export types
export type { ChoiceWithRefs, ValidElement, ElementRef };
/** A pick/choice the player must make */
export type Pick = PickMetadata;
/**
 * A seat the panel names in "waiting for ..." during a simultaneous step.
 *
 * Exported because `PlayShell` forwards this prop straight through and must
 * declare the SAME shape. It once declared `string[]`, which type-checked
 * nowhere and would have rendered a row of blanks had anything ever passed
 * bare names (#179).
 */
export interface AwaitingPlayer { seat: number; name: string; color?: string }
export type ActionMetadata = ControllerActionMetadata;

const props = defineProps<{
  availableActions: string[];
  actionMetadata?: Record<string, ActionMetadata>;
  playerSeat: number;
  isMyTurn: boolean;
  /**
   * The viewer's OWN `completed` flag for the current simultaneous step
   * (from `flowState.awaitingPlayers[playerSeat].completed`; `false`/
   * `undefined` outside a simultaneous step). D27 (T-160-27): a seat that
   * already committed this step must never be able to re-submit — gated
   * in `executeAction` in addition to `isMyTurn`, since `isMyTurn` alone
   * is not a contractual guarantee against a stale/optimistic prop value.
   */
  completed?: boolean;
  canUndo?: boolean;
  /**
   * Auto mode: streamlines UX by reducing unnecessary clicks (default: true)
   * - Auto-executes endTurn when it's the only available action
   * - Auto-starts any single available action (shows its first selection prompt)
   * - Auto-executes actions with no selections when they're the only option
   */
  autoEndTurn?: boolean;
  /** Game messages to display while waiting. The same shape the log renders:
   *  a line is a bare string or a `{ text }` record, and `latestMessage` below
   *  has always handled both -- only this declaration disagreed (#179). */
  messages?: HistoryMessage[];
  /** Name of the player whose turn it is */
  currentPlayerName?: string;
  /** Color of the player whose turn it is */
  currentPlayerColor?: string;
  /** Players currently awaiting action during simultaneous steps */
  awaitingPlayers?: AwaitingPlayer[];
  /** Global action-help visibility — driven by localStorage toggle in GameShell (Plan 03) */
  isActionHelpVisible?: boolean;
  /** Per-action disabled reasons from PlayerGameState.disabledActions */
  disabledActions?: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'selectingElement', selectionName: string, elementClassName?: string): void;
  (e: 'cancelSelection'): void;
  (e: 'undo'): void;
}>();

// Latest game message to show as status while waiting
const latestMessage = computed(() => {
  if (!props.messages?.length) return null;
  const last = props.messages[props.messages.length - 1];
  return typeof last === 'string' ? last : last.text;
});

// Board interaction for hover/selection sync
const boardInteraction = tryUseBoardInteraction();

// Animation events for skip functionality (optional - may not be provided)
const animationEvents = useAnimationEvents();

// Animation gating from controller
const animationsPending = computed(() => actionController.animationsPending.value);
const showActionPanel = computed(() => actionController.showActionPanel.value);

// Skip handler
function skipAnimations(): void {
  animationEvents?.skipAll();
}

// Use controller state directly (controller is required)
const currentAction = actionController.currentAction;
const isExecuting = actionController.isExecuting;
const isLoadingChoices = actionController.isLoadingChoices;

// Repeating state from controller
const repeatingState = computed(() => {
  const rs = actionController.repeatingState.value;
  if (!rs) return null;
  return {
    selectionName: rs.selectionName,
    accumulated: rs.accumulated,
    awaitingServer: rs.awaitingServer,
    currentChoices: rs.currentChoices as ChoiceWithRefs[] | undefined,
  };
});

// Multi-select draft now lives in the shared controller (actionController.multiSelectDraft)
// so the auto ActionPanel and custom UIs share one source of truth and stay in parity.
// Convenience accessor for the current draft's selected values.
const multiSelectValues = computed<unknown[]>(
  () => actionController.multiSelectDraft.value?.values ?? []
);

/**
 * THE ID A NUMBER OR TEXT EDITOR'S LABEL POINTS AT (#199).
 *
 * One per mounted panel, not per pick: the panel draws at most one editor at a
 * time, so one id is enough -- and a stable one keeps a `for`/`id` pair from
 * being rebuilt on every step of an action's walk. `useId` because a page may
 * hold more than one panel (the dev host's seat frames), and two labels
 * pointing at one id would send both to the same field.
 */
const editorInputId = `bs-editor-${useId()}`;
/**
 * The three things that DESCRIBE the editor's field, each with its own id.
 *
 * A hint, a character count and an error are all rules about the field rather
 * than names for it, so they belong in `aria-describedby` and not in the label.
 * They are separate ids rather than one wrapper because the error comes and
 * goes: `aria-describedby` naming an element that is not in the document is
 * read as nothing at all by some screen readers, so the list is assembled from
 * whichever of them is actually rendered.
 */
const editorHintId = `${editorInputId}-hint`;
const editorCountId = `${editorInputId}-count`;
const editorErrorId = `${editorInputId}-error`;

const currentArgs = computed(() => actionController.currentArgs.value);

// Get metadata for available actions
// Annotated as ActionMetadata[] on purpose: without it the synthesized
// fallback entries below form a union with the real metadata, and reading an
// OPTIONAL field (help, suppressFromActionPanel) off that union fails to compile even
// though it is valid on both arms. The annotation says what this list is — action
// metadata, with a minimal entry synthesized for actions that have none.
const actionsWithMetadata = computed<ActionMetadata[]>(() => {
  if (!props.actionMetadata) {
    return props.availableActions.map(name => ({
      name,
      prompt: formatActionName(name),
      selections: [] as PickMetadata[],
    }));
  }
  // Map available actions to their metadata, falling back to a basic entry
  // if the action doesn't have metadata (e.g., actions with no selections)
  return props.availableActions.map(name => {
    const meta = props.actionMetadata![name];
    if (meta) return meta;
    // Fallback for actions without metadata entry
    return {
      name,
      prompt: formatActionName(name),
      selections: [] as PickMetadata[],
    };
  });
});

// Actions to display in the UI
// endTurn is always shown so users can manually end their turn
// Auto-execute only happens when endTurn is the only available action
// LIBX-01: actions declared with .suppressFromActionPanel() are filtered out of the
// rendered Action Panel here ONLY -- they remain in actionsWithMetadata / the board
// substrate (useBoardActionBridge) and stay fully executable there.
//
// ...UNLESS suppressing them would leave the Action Panel empty. `.suppressFromActionPanel()`
// means "this button is redundant with the board affordance", and a button is
// only redundant while something else is offered. When every available action
// is suppressed, the Action Panel is the player's only remaining control: emptying it
// leaves a prompt with nothing to press, and for an action with NO selections
// that state is terminal — no pick can start, so the mid-pick keyboard/SR
// safety net (A11Y C-2) never engages either. Falling back to the full list
// keeps the API's purpose (remove clutter) and drops its trap (remove the last
// way to act).
//
// SUPPRESSION DECIDES MEMBERSHIP; GROUPING DECIDES ARRANGEMENT (#228). This is
// the whole of the relationship between the two, and it is why the fallback
// restores the LIST rather than the FLATNESS: the menu below is built from
// whatever this returns, so an all-suppressed panel comes back as the game's own
// hierarchy and not as the flat list the fallback used to imply. Two mechanisms
// that disagreed about arrangement would have made "grouping remains effective
// when no ungrouped action is available" false in exactly the case the fallback
// fires.
const visibleActions = computed(() => {
  const unsuppressed = actionsWithMetadata.value.filter(a => !a.suppressFromActionPanel);
  return unsuppressed.length > 0 ? unsuppressed : actionsWithMetadata.value;
});

// ── The start-button hierarchy (#228) ──────────────────────────────────────
//
// A game declares where a start button sits with `.group()` and `.order()`, and
// the menu is DERIVED from the action metadata the panel was already handed --
// see action-menu.ts for the model and for why it is a separate, pure module.
//
// OPENING A MENU CANNOT BE A GAME COMMAND. The only state a group interaction
// touches is `openPath` -- a list of group labels the controller stores and
// never reads, and cannot interpret, because it does not import the menu model
// at all: no controller verb, no transport, no engine. And a group node carries
// no action name, so `enterGroup` has nothing it could submit even by mistake.
const actionMenu = computed(() => buildActionMenu(visibleActions.value));

/**
 * The level the player has navigated to -- REQUESTED, never trusted.
 *
 * Availability moves underneath a player who is standing in a group, so every
 * read resolves this against the menu as it is now (`menuLevelAt`), and the
 * watcher below writes the resolved answer back so the ref cannot drift from
 * what is on screen. That is what makes "a group emptied while it was open"
 * land on the deepest ancestor that survived rather than on a level that is not
 * there.
 *
 * IT IS THE CONTROLLER'S REF, not this component's (#235). It was local until a
 * collapse -- which unmounts the panel rather than hiding it -- was found to
 * take the player back to the top level of a menu they had walked two steps
 * into. Resolving on every read is what makes remembering it safe: a path is
 * never trusted, so it does not matter how long the bar was down for.
 */
const openPath = actionController.actionMenuPath;

const menuLevel = computed(() => menuLevelAt(actionMenu.value, openPath.value));

/** The full path, for the current-level label. */
const menuBreadcrumb = computed(() => menuLevel.value.group?.path.join(' / ') ?? '');

/** Where Back goes, said out loud for a screen reader. */
const backLabel = computed(() => {
  const path = menuLevel.value.group?.path ?? [];
  return path.length > 1 ? `Back to ${path[path.length - 2]}` : 'Back to all actions';
});

/** What a screen reader is told when a level moved under the player. */
const menuAnnouncement = ref('');

/** How many things are behind a group's button, for its accessible name. */
function groupContents(group: ActionMenuGroup<ActionMetadata>): string {
  const count = group.children.length;
  return `submenu, ${count} ${count === 1 ? 'action' : 'actions'}`;
}

const MENU_BUTTONS = '[data-bs-action], [data-bs-action-group]';

/** The group button carrying `label` in the level now rendered. */
function groupButton(root: HTMLElement, label: string): HTMLElement | null {
  for (const candidate of root.querySelectorAll<HTMLElement>('[data-bs-action-group]')) {
    if (candidate.getAttribute('data-bs-action-group') === label) return candidate;
  }
  return null;
}

/**
 * Enter a group: draw its level and put the keyboard in it.
 *
 * Focus moves to the level's first button rather than to Back, for the reason
 * `focusTargetFor` gives about a selection's own controls: it is where the
 * player was going, and Back is one keystroke from undoing the navigation they
 * just performed.
 */
function enterGroup(group: ActionMenuGroup<ActionMetadata>): void {
  menuAnnouncement.value = '';
  openPath.value = group.path;
  void focusIntoLevel();
}

/** Leave the current group, and put the keyboard back on the button that opened it. */
function leaveGroup(): void {
  const path = menuLevel.value.group?.path;
  if (!path || path.length === 0) return;
  const leaving = path[path.length - 1];
  menuAnnouncement.value = '';
  openPath.value = path.slice(0, -1);
  void restoreFocusToGroup(leaving);
}

async function focusIntoLevel(): Promise<void> {
  await nextTick();
  const root = panelRoot.value;
  if (!root?.isConnected) return;
  firstOperableOf(root.querySelectorAll<HTMLElement>(MENU_BUTTONS))?.focus();
}

async function restoreFocusToGroup(label: string): Promise<void> {
  await nextTick();
  const root = panelRoot.value;
  if (!root?.isConnected) return;
  const button = groupButton(root, label)
    ?? firstOperableOf(root.querySelectorAll<HTMLElement>(MENU_BUTTONS));
  button?.focus();
}

/**
 * Escape is Back, one level per press.
 *
 * Only while a menu level is open: an action under way owns its own cancel
 * button, and hijacking Escape there would be a second way to abandon an
 * action that nothing else in the panel agrees with.
 */
function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (currentAction.value) return;
  if (!menuLevel.value.group) return;
  event.preventDefault();
  leaveGroup();
}

/**
 * KEEP `openPath` HONEST, AND SAY SO WHEN IT MOVES.
 *
 * `menuLevelAt` already resolves, so the render is correct the instant
 * availability changes; this exists for the two things a render cannot do --
 * write the truncated path back so the ref and the screen agree, and tell a
 * screen-reader user that the level they were standing in went away. Without
 * the announcement the only signal is a silent change of button list.
 */
watch(actionMenu, () => {
  const resolved = resolveMenuPath(actionMenu.value, openPath.value);
  if (resolved.length === openPath.value.length) return;
  const lost = openPath.value[resolved.length];
  openPath.value = resolved;
  menuAnnouncement.value = resolved.length === 0
    ? `${lost} is no longer available. Showing all actions.`
    : `${lost} is no longer available. Showing ${resolved[resolved.length - 1]}.`;
});

// Current action metadata
// Note: For followUp actions, the action may not be in availableActions,
// so we check the controller's snapshot first (which has the correct metadata)
const currentActionMeta = computed(() => {
  if (!currentAction.value) return null;

  // Check actionSnapshot first - handles followUp actions that aren't in availableActions
  const snapshotMeta = actionController.actionSnapshot?.value;
  if (snapshotMeta?.actionName === currentAction.value && snapshotMeta.metadata) {
    return snapshotMeta.metadata;
  }

  // Fall back to looking up in actionsWithMetadata
  return actionsWithMetadata.value.find(a => a.name === currentAction.value) ?? null;
});

// Current pick - delegates to controller (required)
const currentPick = computed(() => actionController.currentPick.value);

/**
 * THE TWO EDITORS' VALUES LIVE IN THE CONTROLLER (#235).
 *
 * They were refs here, and the bar's collapse is a `v-if` swap in `PlayShell`:
 * it UNMOUNTS this component rather than hiding it, so everything the player
 * had typed went with it, silently, from a control whose own promise is that it
 * is reversible. `useActionController` outlives the panel and is already where
 * `multiSelectDraft` lives for the same reason -- and putting it there is also
 * what lets a custom UI see the in-progress text, which the parity rule wants
 * and a ref in here could never give it.
 *
 * The controller stamps a draft with the question it belongs to and resolves it
 * on read, so these are plain views onto it: whichever kind of value the pick
 * being asked for cannot use reads as empty rather than as itself.
 */
const numberInputValue = computed<number | null>({
  get: () => {
    const draft = actionController.currentPickDraft.value;
    return typeof draft === 'number' ? draft : null;
  },
  // An emptied number field gives back `''` through `v-model.number`, and a
  // half-typed one can give back `NaN`; neither is a number the player has
  // entered, so both clear the draft.
  set: (value) => actionController.setPickDraft(
    typeof value === 'number' && !Number.isNaN(value) ? value : null,
  ),
});
const textInputValue = computed<string>({
  get: () => {
    const draft = actionController.currentPickDraft.value;
    return typeof draft === 'string' ? draft : '';
  },
  set: (value) => actionController.setPickDraft(value === '' ? null : value),
});
/**
 * THE PRICE OF THE DRAFT, STRAIGHT OFF THE CONTROLLER (#248).
 *
 * Plain views, exactly as the editor bindings above are: the controller holds the
 * quote, stamps it with the draft it was computed for, and withdraws it the moment
 * the draft moves -- so there is nothing here that could render a stale price, and
 * a custom UI reading the same refs shows the same one.
 *
 * `quotesDraft` is the action's own declaration (`.quote()` on the world action),
 * arriving as `ActionMetadata.quote`. With it absent this whole region is not
 * rendered and the panel behaves as it always did.
 */
const quotesDraft = computed(() => currentActionMeta.value?.quote === true);
const quoteLines = computed(() => actionController.actionQuote.value);
const quoteError = computed(() => actionController.quoteError.value);
const awaitingConfirmation = computed(() => actionController.awaitingConfirmation.value);
const confirmDisabledReason = computed(() => actionController.confirmDisabledReason.value);

/** Submit the draft the player has just been quoted. The controller refuses an
 *  unfinished draft and one whose price is not on screen, so this passes the
 *  press on rather than deciding anything. */
function confirmDraft(): void {
  void actionController.confirm();
}

/**
 * Why what the player has entered will not be accepted, or null.
 *
 * Set when they try to submit and cleared the moment they change the field, so
 * the message is about what is in front of them rather than what used to be.
 * Before #229 the submit handler simply RETURNED on a value the rules refused:
 * the button moved, nothing happened, and there was no way to find out why.
 *
 * ONE ref for both editors, not one each (#237). The panel draws at most one
 * typed field at a time, and the number editor spent two tickets carrying the
 * silent-return the text editor had already lost because the repair was written
 * per-editor. There is no per-editor copy of this left to forget.
 */
const editorInputError = ref<string | null>(null);

watch(() => actionController.currentPickDraft.value, () => {
  editorInputError.value = null;
});

/**
 * A NEW PICK IS NOT REFUSING ANYTHING YET.
 *
 * The VALUE opening empty is the controller's business now: a draft is stamped
 * with the action, the selection and the repeating round it belongs to, and
 * reads as empty outside them, which is what #229's leak needed (a 200
 * character creed opening a 20 character nickname already too long). The
 * refusal is this component's, because it is about the player's last press
 * rather than about anything they wrote, so it does not follow them to the next
 * question -- or back from a collapse they have pressed nothing in.
 */
watch(
  () => `${currentAction.value ?? ''}/${currentPick.value?.name ?? ''}`,
  () => {
    editorInputError.value = null;
  },
);

/**
 * The rule of the pick being edited, as a sentence -- whichever editor is open.
 *
 * ONE computed over both kinds (#237). `numberRangeHint` and `textLengthHint`
 * stay separate because the WORDING differs, which is deliberate and was
 * decided twice (#229, #234); which sentence a field shows and where it is
 * rendered does not differ at all, and that half was what kept getting fixed on
 * one editor and not the other.
 *
 * A multiline field states only its FLOOR, because its character count already
 * states the ceiling and better: "140 of 1000 characters" carries the maximum
 * and where the player stands in it, so a hint reading "(up to 1000
 * characters)" beside it is the same fact twice -- and it costs a row of an
 * action bar that caps its own height and scrolls, which is how the count ended
 * up scrolled out of sight while the hint it duplicated stayed on screen.
 */
const editorHint = computed(() => {
  const pick = currentPick.value;
  if (!pick) return undefined;
  if (pick.type === 'number') return numberRangeHint(pick);
  if (pick.type !== 'text') return undefined;
  return pick.multiline
    ? textLengthHint({ minLength: pick.minLength })
    : textLengthHint(pick);
});

/**
 * How much the player has written, against the bound the engine will enforce.
 *
 * Read on arrival at the field through `aria-describedby` rather than announced
 * on every keystroke: a polite live region that changed with each character
 * would talk over a player for a thousand of them.
 */
const textCharCount = computed(() => {
  const max = currentPick.value?.maxLength;
  const written = textInputValue.value.length;
  return max === undefined
    ? `${written} characters`
    : `${written} of ${max} characters`;
});

/**
 * The one moment the field's behaviour changes without anything being said: a
 * keystroke that no longer does anything. A sighted player sees the text stop
 * growing; this is what the other player hears. It is empty at every other
 * length, so the region speaks once and then goes quiet again.
 */
const textLimitAnnouncement = computed(() => {
  const max = currentPick.value?.maxLength;
  if (max === undefined || textInputValue.value.length < max) return '';
  return `You have reached the ${max} character limit.`;
});

/** Whichever of hint, count and error the open editor is actually showing. */
const editorDescribedBy = computed(() => {
  const pick = currentPick.value;
  const ids: string[] = [];
  if (editorHint.value) ids.push(editorHintId);
  if (pick?.type === 'text' && pick.multiline) ids.push(editorCountId);
  if (editorInputError.value) ids.push(editorErrorId);
  return ids.length ? ids.join(' ') : undefined;
});

/**
 * WHAT MAKES THE FIELD A FIELD, AS ONE OBJECT EVERY CONTROL BINDS (#237).
 *
 * The number input, the single-line text input and the textarea are three
 * different controls for the same job, and the accessible wiring is the same on
 * all three: the id the prompt's `for` points at, the descriptions the field
 * carries, and whether it currently stands refused. Written once and `v-bind`ed
 * three times, so it is not possible to give one control a description list and
 * leave another with a hint nobody hears -- which is exactly what the number
 * editor was, for two tickets after the text editor was fixed.
 */
/**
 * The editor's own class, which is what its layout hangs off.
 *
 * The two kinds share one block of markup now, but they do not share a width:
 * a number field is 120px and a multiline box takes a whole row of the action
 * bar. The stylesheet still addresses them by the classes it always did.
 */
const editorWrapperClass = computed(() => {
  const pick = currentPick.value;
  if (pick?.type !== 'text') return 'number-input';
  return pick.multiline ? ['text-input', 'text-input-multiline'] : 'text-input';
});

const editorFieldAttrs = computed(() => ({
  id: editorInputId,
  'aria-describedby': editorDescribedBy.value,
  // The literal type, not `string`: Vue types `aria-invalid` as a union of the
  // values it accepts, and a widened `string` is not assignable to it.
  'aria-invalid': editorInputError.value ? ('true' as const) : undefined,
}));

// ── Keyboard focus across step transitions (#27) ───────────────────────────
//
// The Action Panel replaces the control the player is standing on at every step
// of a chained action: the action button becomes the first selection's list,
// each list becomes the next selection's, and the last becomes the idle list
// again. A removed node cannot hold focus, so each of those transitions dropped
// `document.activeElement` back to `document.body` — no position in the tab
// order, nothing announced, and a tab-in from the top of the document required
// for every selection. Six selections meant seven strandings.
//
// The repair is deliberately narrow: focus is placed ONLY when it has actually
// been stranded, so a player who tabbed somewhere else on purpose is never
// yanked back into the Action Panel.

/** The panel root, so focus can be searched for and scoped within it. */
const panelRoot = ref<HTMLElement | null>(null);

/**
 * Identity of the step being rendered. Changes exactly when the Action Panel
 * swaps its controls out: opening an action, advancing a selection, and
 * returning to idle.
 */
const stepIdentity = computed(() => {
  const action = currentAction.value ?? '(idle)';
  const pick = currentPick.value?.name ?? '(none)';
  const accumulated = repeatingState.value?.accumulated.length ?? 0;
  return `${action}/${pick}/${accumulated}`;
});

/** Focus is stranded when it is nowhere, on the body, or on a removed node. */
function focusIsStranded(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The first of `candidates` a keyboard user can actually operate. */
function firstOperableOf(candidates: Iterable<HTMLElement>): HTMLElement | null {
  for (const candidate of candidates) {
    if (candidate.hasAttribute('disabled')) continue;
    // `aria-disabled` controls stay focusable on purpose (see v-disabled-reason:
    // a natively-disabled button cannot be reached by keyboard, which takes its
    // refusal reason with it), but they are a poor landing spot when anything
    // else is offered.
    if (candidate.getAttribute('aria-disabled') === 'true') continue;
    return candidate;
  }
  // Nothing enabled: an aria-disabled control still beats the body, because it
  // holds a place in the tab order and can announce why it is refused.
  for (const candidate of candidates) {
    if (!candidate.hasAttribute('disabled')) return candidate;
  }
  return null;
}

/** Every focusable node in `scope`, in document order. */
const focusableIn = (scope: HTMLElement): Iterable<HTMLElement> =>
  scope.querySelectorAll<HTMLElement>(FOCUSABLE);

/**
 * Where focus should land for the step now rendered.
 *
 * The step's OWN controls come first — the choices for this selection, or the
 * action and group buttons when idle. That is where a mouse user's attention
 * already is, and it is the only landing spot where pressing Enter does what
 * the player came to do. Falling straight to the panel's first focusable node
 * would put them on the cancel button, one keystroke from abandoning the
 * action, or, inside a menu level, on Back (#228), one keystroke from leaving
 * the level they were just put back into.
 */
function focusTargetFor(root: HTMLElement): HTMLElement | null {
  const selection = root.querySelector<HTMLElement>('.selection-input');
  if (selection) return firstOperableOf(focusableIn(selection)) ?? firstOperableOf(focusableIn(root));
  const menu = firstOperableOf(root.querySelectorAll<HTMLElement>(MENU_BUTTONS));
  return menu ?? firstOperableOf(focusableIn(root));
}

// AVAILABILITY IS THE SECOND THING THAT STRANDS FOCUS (#228). The idle list is
// keyed on `availableActions`, so a change re-mounts every button in it and
// takes the focused one with it -- which is precisely the moment a player
// standing in a group is most likely to be moved. `stepIdentity` cannot see it:
// idle to idle is the same step.
watch([stepIdentity, () => props.availableActions.join(',')], async () => {
  // Wait for the swap to actually land in the DOM before looking for a target.
  await nextTick();
  if (!focusIsStranded()) return;
  const root = panelRoot.value;
  if (!root || !root.isConnected) return;
  const target = focusTargetFor(root);
  // Focusing the container itself would be worse than the body — it is not
  // operable and announces nothing. Better to leave the player where they are.
  target?.focus();
});


// Note: Auto-fill is handled by the controller's internal watch

/**
 * The current pick's count shapes -- a multiSelect set, an ordered list, or
 * neither. Delegates to the shared `resolvePickCounts` helper (the single source
 * of truth also used by `useActionController` and `useBoardActionBridge`) so the
 * panel prefers the per-step server-resolved snapshot value (real accumulated
 * args) over the static metadata baked in at action-start time (v4.8-WR01).
 */
const currentPickCounts = computed(() =>
  resolvePickCounts(
    currentPick.value,
    currentArgs.value,
    actionController.actionSnapshot.value?.pickSnapshots,
  )
);

/** The pick's multiSelect bounds, or undefined when it is not a set. */
const currentMultiSelect = computed(() => currentPickCounts.value.multiSelect);

/** The pick's ordered-list bounds, or undefined when it is not a sequence (#249). */
const currentOrderedList = computed(() => currentPickCounts.value.orderedList);

/** The entries the player has built so far, in order, repeats and all (#249). */
const orderedListEntries = computed<unknown[]>(() =>
  currentOrderedList.value ? multiSelectValues.value : []
);

/** The numbered entries, so a removal can hand the keyboard to a survivor (#252). */
const orderedEntriesList = ref<HTMLElement | null>(null);

/** The Add/Done row, where focus goes when the last entry is removed (#252). */
const orderedChoiceRow = ref<HTMLElement | null>(null);

// Filter args for display - exclude current multiSelect selection
// (multiSelect shows its state via checkboxes, not chips)
const displayableArgs = computed(() => {
  const result: Record<string, unknown> = {};
  const currentSelName = currentPick.value?.name;
  const isMultiSelectActive = currentMultiSelect.value !== undefined;

  for (const [key, value] of Object.entries(currentArgs.value)) {
    // Skip the current multiSelect selection (checkboxes show it)
    if (isMultiSelectActive && key === currentSelName) continue;

    // Skip empty arrays (deselected multiSelect)
    if (Array.isArray(value) && value.length === 0) continue;

    // Skip null values (skipped optional selections)
    if (value === null) continue;

    result[key] = value;
  }
  return result;
});

// Split choices into primary (unanchored) and anchored (notation-anchored) sets.
// Delegates to controller for base choices, then applies ActionPanel-specific filtering
// and D-03 partitioning (splitAnchoredChoices). Primary choices render as normal
// choice buttons; anchored choices render as a secondary focusable button list so
// keyboard/SR users always have an operable control even when all picks are board-anchored.
const _splitChoices = computed<{ primary: ChoiceWithRefs[]; anchored: ChoiceWithRefs[] }>(() => {
  if (!currentPick.value) return { primary: [], anchored: [] };

  // Get base choices from controller (handles repeating, dependsOn, filterBy).
  // PIT OF SUCCESS: read the REACTIVE computed (currentChoices.value tracks snapshotVersion)
  // rather than the bare getCurrentChoices() helper which does not. When async-fetched
  // choices arrive, snapshotVersion++ marks currentChoices dirty → this computed re-runs.
  let choices = (actionController.currentChoices.value as ChoiceWithRefs[]).slice();

  // ActionPanel-specific: Exclude choices that were already selected in previous choice selections
  // This handles sequential choice selections where user shouldn't pick the same thing twice
  if (currentActionMeta.value) {
    const alreadySelectedValues = new Set<unknown>();
    for (const sel of currentActionMeta.value.selections) {
      if (sel.type === 'choice' && sel.name !== currentPick.value.name) {
        const selectedValue = currentArgs.value[sel.name];
        if (selectedValue !== undefined) {
          alreadySelectedValues.add(selectedValue);
        }
      }
    }

    if (alreadySelectedValues.size > 0) {
      choices = choices.filter(choice => !alreadySelectedValues.has(choice.value));
    }
  }

  // D-03: Partition choices — notation-anchored choices go to the secondary list,
  // never dropped. splitAnchoredChoices applies only for 'choice' picks.
  return splitAnchoredChoices(choices, currentPick.value?.type);
});

// Primary (unanchored) choices: rendered as the main choice buttons in the panel.
const filteredChoices = computed(() => _splitChoices.value.primary);

// Notation-anchored choices: rendered as a secondary focusable list of buttons
// whose activation calls triggerElementSelect — parity with clicking the board element.
const anchoredChoices = computed(() => _splitChoices.value.anchored);

// Filtered valid elements - excludes elements already selected in previous selections
// This handles the case where an action has multiple element selections and the filter
// depends on previous selections (e.g., "select second die, excluding the first")
const filteredValidElements = computed(() => {
  if (!currentPick.value || (currentPick.value.type !== 'element' && currentPick.value.type !== 'elements')) return [];

  // Get valid elements from controller cache.
  // PIT OF SUCCESS: read the REACTIVE computed (validElements.value tracks snapshotVersion)
  // rather than the non-reactive getValidElements() helper.
  const validElements = actionController.validElements.value;
  if (validElements.length === 0) return [];

  // Get IDs of elements already selected in previous element/elements selections
  const alreadySelectedIds = new Set<number>();
  if (currentActionMeta.value) {
    for (const sel of currentActionMeta.value.selections) {
      if ((sel.type === 'element' || sel.type === 'elements') && sel.name !== currentPick.value.name) {
        const selectedValue = currentArgs.value[sel.name];
        if (typeof selectedValue === 'number') {
          alreadySelectedIds.add(selectedValue);
        } else if (Array.isArray(selectedValue)) {
          // For elements multiSelect - array of IDs
          for (const id of selectedValue) {
            if (typeof id === 'number') alreadySelectedIds.add(id);
          }
        }
      }
    }
  }

  // Filter out already-selected elements
  if (alreadySelectedIds.size === 0) {
    return validElements;
  }

  return validElements.filter(elem => !alreadySelectedIds.has(elem.id));
});

/**
 * #172: a candidate set too large for the panel to read, every one of which the
 * board is already drawing. The panel keeps the prompt and offers ONE control
 * that hands keyboard focus to the board, instead of a wall of buttons nobody
 * can scan.
 *
 * This is a change of SURFACE, not of content: the board offers the identical
 * enumeration, and requestBoardFocus() carries focus across so the keyboard path
 * is continuous. It is emphatically not a filter — see
 * shouldDeferElementPickToBoard for why every candidate must be board-drawable
 * before the panel will yield.
 */
const deferPickToBoard = computed(() =>
  shouldDeferElementPickToBoard(currentPick.value?.type, filteredValidElements.value),
);

/** Send keyboard focus to the board's first valid target for this pick. */
function handOffToBoard() {
  boardInteraction?.requestBoardFocus();
}

// Skip an optional selection
function skipOptionalSelection() {
  if (!currentPick.value || !currentPick.value.optional) return;
  // Delegate to controller — updates both currentArgs and collectedPicks (source of truth).
  // The controller's auto-execute watch handles execution when all selections are filled.
  actionController.skip(currentPick.value.name);
}

/**
 * Why the value in the open editor cannot be submitted, or null.
 *
 * The rules come from the engine's OWN validators -- `textRuleErrors` (#229)
 * and `numberRuleErrors` (#237) -- so what the panel refuses here and what the
 * server would refuse are the same rule in the same words, rather than two
 * copies that drift. `validate` is deliberately not among them: a game's custom
 * validator closes over game state and never reaches a client, so the engine
 * stays the authority and this is the subset a client can honestly check.
 *
 * Returning null for a pick that is not being edited, or an empty editor, is
 * how "there is nothing to submit" and "this cannot be submitted" stay
 * different answers to the caller below.
 */
function editorValueRefusal(): string | null {
  const pick = currentPick.value;
  if (!pick) return null;
  if (pick.type === 'number') {
    const val = numberInputValue.value;
    if (val === null) return null;
    return numberRuleErrors(pick.name, val, pick)[0] ?? null;
  }
  if (pick.type === 'text') {
    return textRuleErrors(pick.name, textInputValue.value, {
      minLength: pick.minLength,
      maxLength: pick.maxLength,
      // The wire carries a pattern as its source string; compiling it here is
      // the only form the rule can be applied in.
      pattern: pick.pattern === undefined ? undefined : new RegExp(pick.pattern),
    })[0] ?? null;
  }
  return null;
}

/**
 * Submit whatever the open editor holds, or say why it cannot be (#229, #237).
 *
 * ONE handler for the number field, the single-line text field and the box. It
 * was two, and the second one silently `return`ed on a value outside its
 * bounds: the button moved, nothing happened, and there was no way to find out
 * why. That is not a defect worth fixing twice, so there is no longer a second
 * handler to fix.
 *
 * The refused value STAYS in the field. It is still a draft the player wrote,
 * so `useActionController` keeps it across a collapse (#235) -- while the
 * message does not, because that is about the press rather than the value.
 */
function submitEditorValue() {
  const pick = currentPick.value;
  if (!pick) return;

  const refusal = editorValueRefusal();
  if (refusal !== null) {
    editorInputError.value = refusal;
    return;
  }

  if (pick.type === 'number') {
    const val = numberInputValue.value;
    if (val === null) return;
    editorInputError.value = null;
    // Consumed, so the draft goes before the value does: `setSelectionValue`
    // moves the pick on, and clearing after it would be tidying up a question
    // nobody is being asked any more.
    numberInputValue.value = null;
    setSelectionValue(pick.name, val);
    return;
  }

  if (pick.type === 'text') {
    const val = textInputValue.value;
    editorInputError.value = null;
    textInputValue.value = '';
    setSelectionValue(pick.name, val);
  }
}

// Select an element (from element selection buttons)
function selectElement(elementId: number) {
  if (!currentPick.value || (currentPick.value.type !== 'element' && currentPick.value.type !== 'elements')) return;

  // Get the selection name BEFORE calling setSelectionValue
  // (because setSelectionValue will change currentPick)
  const selectionName = currentPick.value.name;

  // Look up display from validElements
  const validElem = currentPick.value.validElements?.find((e: ValidElement) => e.id === elementId);
  const display = validElem?.display || String(elementId);

  // Use setSelectionValue which handles auto-execute
  setSelectionValue(selectionName, elementId, display);

  // Note: We don't call boardInteraction.selectElement here because it triggers the watch
  // which would try to fill the NEXT selection with the same element
}

// Execute a choice for filtered/dependent selections
// Uses setSelectionValue to ensure auto-execute watcher fires (and beforeAutoExecuteHook)
function executeChoice(selectionName: string, choice: ChoiceWithRefs) {
  if (!currentAction.value) return;

  // Set the hovered choice to show on board briefly
  if (boardInteraction) {
    boardInteraction.setHoveredChoice({
      value: choice.value,
      display: choice.display,
      sourceRefs: (choice.refs ?? []).filter(r => r.role === 'source').map(r => r.ref),
      targetRefs: (choice.refs ?? []).filter(r => r.role === 'target' || r.role === 'highlight').map(r => r.ref),
    });
  }

  // Use setSelectionValue which delegates to controller.fill()
  // This triggers the isReady watcher to detect completion, fire beforeAutoExecuteHook,
  // then auto-execute the action
  setSelectionValue(selectionName, choice.value, choice.display);
}

// Hover handlers for element buttons (highlight on board)
function handleElementHover(element: ValidElement) {
  const highlightRef = (element.refs ?? []).find(r => r.role === 'highlight')?.ref;
  if (boardInteraction && highlightRef) {
    boardInteraction.setHoveredChoice({
      value: element.id,
      display: element.display || String(element.id),
      sourceRefs: [highlightRef],
      targetRefs: [],
    });
  }
}

function handleElementLeave() {
  if (boardInteraction) {
    boardInteraction.setHoveredChoice(null);
  }
}

// Get display text for a selection value
// PIT OF SUCCESS: Uses controller's snapshot as single source of truth
function getSelectionDisplay(selectionName: string, value: unknown): string {
  // Check controller's snapshot (single source of truth)
  const collected = actionController.getCollectedPick(selectionName);
  if (collected && !collected.skipped) {
    // Check if this is the same value (handles array values too)
    const sameValue = JSON.stringify(collected.value) === JSON.stringify(value);
    if (sameValue && collected.display) {
      return collected.display;
    }
  }

  // Fallback for edge cases (shouldn't normally be needed)
  return getDisplayLabel(value);
}

/**
 * Get display text for an accumulated value in a repeating selection.
 * PIT OF SUCCESS: Now that accumulated stores {value, display} objects,
 * we can directly use the stored display.
 */
function getAccumulatedDisplay(accumulated: unknown): string {
  // New format: accumulated items are {value, display} objects
  if (accumulated && typeof accumulated === 'object' && 'display' in accumulated) {
    return (accumulated as { display: string }).display;
  }

  // Legacy fallback: accumulated item is just a value
  const value = accumulated;
  if (!currentPick.value) return getDisplayLabel(value);

  // For choice selections, look up display in choices
  if (currentPick.value.type === 'choice') {
    const choices = repeatingState.value?.currentChoices || currentPick.value.choices || [];
    const choice = choices.find((c: ChoiceWithRefs) => c.value === value);
    if (choice) return choice.display;
  }

  return getDisplayLabel(value);
}

// Clear a specific selection (and all subsequent selections)
function clearSelection(selectionName: string) {
  if (!currentActionMeta.value) return;

  // Find the index of this selection
  const index = currentActionMeta.value.selections.findIndex(s => s.name === selectionName);
  if (index === -1) return;

  // Clear this selection and all subsequent ones
  for (let i = index; i < currentActionMeta.value.selections.length; i++) {
    const sel = currentActionMeta.value.selections[i];
    actionController.clear(sel.name);
  }

  // Clear board interaction
  boardInteraction?.clear();
}

// Auto-start, stale-action cleanup, and execution-complete retry now live in
// useBoardActionBridge (GameShell), the single always-on controller→board source.
// ActionPanel is purely presentational and no longer drives these reactively.


function formatActionName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Get a human-readable display label for any value.
 * Priority: display property > name property > stringified primitive
 * Never returns [object Object]
 */
function getDisplayLabel(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  // Handle primitives directly
  if (typeof value !== 'object') {
    return String(value);
  }

  // For objects, look for common display properties
  const obj = value as Record<string, unknown>;

  // Priority 1: display property (most explicit)
  if (typeof obj.display === 'string') {
    return obj.display;
  }

  // Priority 2: name property (common for elements/entities)
  if (typeof obj.name === 'string') {
    return obj.name;
  }

  // Priority 3: value property that's a primitive (like playerChoices returns)
  if (obj.value !== undefined && typeof obj.value !== 'object') {
    return String(obj.value);
  }

  // Fallback: JSON for debugging (better than [object Object])
  try {
    return JSON.stringify(value);
  } catch {
    return '[Complex Object]';
  }
}

/**
 * Check if a pick is repeating
 */
function isRepeatingSelection(sel: PickMetadata): boolean {
  return sel.repeat !== undefined;
}

/**
 * Check if a value is currently selected in multi-select mode (reads shared draft)
 */
function isMultiSelectValueSelected(value: unknown): boolean {
  return actionController.isMultiSelectSelected(currentPick.value?.name ?? '', value);
}

/**
 * Toggle a value in multi-select mode.
 * Delegates the draft to the shared controller (so custom UIs stay in parity), then
 * refreshes board highlights. The controller owns max-enforcement and min===max
 * auto-confirm (which runs fill → auto-execute).
 */
async function toggleMultiSelectValue(selectionName: string, value: unknown, _display?: string) {
  await actionController.toggleMultiSelect(selectionName, value);

  // Update AutoUI board highlighting for selected items
  updateMultiSelectBoardHighlights();
}

/**
 * Add one entry to the ordered list (#249) -- pressed again, it adds another.
 *
 * A separate handler from `toggleMultiSelectValue` rather than a mode inside it,
 * because the two gestures MEAN opposite things on a second press: a set removes
 * the option, a list repeats it.
 */
async function addListEntry(selectionName: string, value: unknown) {
  await actionController.appendListEntry(selectionName, value);
  updateMultiSelectBoardHighlights();
}

/** Drop the entry the player pointed at, BY INDEX (#249). */
async function dropListEntry(selectionName: string, index: number) {
  actionController.removeListEntry(selectionName, index);
  updateMultiSelectBoardHighlights();
  await nextTick();
  restoreFocusAfterRemoval(index);
}

/**
 * PUT THE KEYBOARD BACK AFTER A REMOVAL (#252).
 *
 * The button that was pressed is the node that just unmounted, so focus falls to
 * the body and building a list from the keyboard means tabbing in from the top of
 * the document once per entry removed. #228's stranding repair cannot catch this
 * one: it is keyed on `stepIdentity`, and a removal is the same action, the same
 * pick and the same accumulated answers -- the step did not change, only the
 * draft did.
 *
 * The entry that slid into the removed one's place is the nearest thing to
 * "where I was", and the likeliest next target; with the list emptied there is no
 * entry left to stand on, so the Add row is. Narrow in the same way #228's is:
 * only when focus was ACTUALLY stranded, so a player who tabbed elsewhere on
 * purpose is never yanked back into the panel.
 */
function restoreFocusAfterRemoval(index: number): void {
  if (!focusIsStranded()) return;
  const removes = orderedEntriesList.value?.querySelectorAll<HTMLElement>('.ordered-list-remove');
  if (removes && removes.length > 0) {
    removes[Math.min(index, removes.length - 1)]?.focus();
    return;
  }
  firstOperableOf(
    orderedChoiceRow.value?.querySelectorAll<HTMLElement>('.ordered-list-add') ?? [],
  )?.focus();
}

/** What one built entry reads as: the choice's own label, by preference. */
function orderedEntryDisplay(value: unknown): string {
  const choice = filteredChoices.value.find(c => c.value === value);
  return choice?.display ?? getDisplayLabel(value);
}

/** "Added: 2/3", or "Added: 2" when the list has no upper bound. */
const orderedListCountDisplay = computed(() => {
  if (!currentOrderedList.value) return '';
  const count = orderedListEntries.value.length;
  const max = currentOrderedList.value.max;
  return max === undefined ? `Added: ${count}` : `Added: ${count}/${max}`;
});

/**
 * Why an Add button cannot be pressed: the choice's own reason if it has one,
 * otherwise a FULL list -- which, unlike a full multiSelect, blocks every option
 * including ones already in the list, because adding is never a deselect here.
 */
function orderedListAddDisabledReason(own: DisabledReason): DisabledReason {
  if (isDisabled(own)) return own;
  const max = currentOrderedList.value?.max;
  if (max === undefined) return false;
  if (orderedListEntries.value.length < max) return false;
  return max === 1
    ? 'The list holds one entry. Remove it to choose differently.'
    : `The list is full at ${max} entries. Remove one to add another.`;
}

/** Why the ordered list's Done cannot be pressed yet: too few entries. */
const orderedListDoneDisabledReason = computed<DisabledReason>(() => {
  const config = currentOrderedList.value;
  if (!config) return false;
  const short = (config.min ?? 0) - orderedListEntries.value.length;
  if (short <= 0) return false;
  return `Add ${short} more to continue (at least ${config.min} required).`;
});

/**
 * Update board highlighting to show all selected multiSelect items
 * This makes the AutoUI highlight the selected elements
 */
function updateMultiSelectBoardHighlights() {
  const selectedValues = multiSelectValues.value;
  if (!boardInteraction || selectedValues.length === 0) {
    boardInteraction?.setHoveredChoice(null);
    return;
  }

  // Collect all boardRefs for selected values from filteredChoices
  const sourceRefs: ElementRef[] = [];
  const targetRefs: ElementRef[] = [];

  for (const val of selectedValues) {
    const choice = filteredChoices.value.find(c => c.value === val);
    if (choice) {
      for (const r of choice.refs ?? []) {
        if (r.role === 'source') sourceRefs.push(r.ref);
        else targetRefs.push(r.ref); // 'target' and 'highlight' both highlight as target-side
      }
    }
  }

  if (sourceRefs.length > 0 || targetRefs.length > 0) {
    boardInteraction.setHoveredChoice({
      value: selectedValues,
      display: `${selectedValues.length} selected`,
      sourceRefs,
      targetRefs,
    });
  }
}

/**
 * Confirm multi-select and move to next selection or execute action.
 * Delegates to the controller, which runs the fill() path (currentArgs → readiness →
 * auto-execute) with the complete array.
 */
async function confirmMultiSelect() {
  await actionController.confirmMultiSelect();
  boardInteraction?.setHoveredChoice(null);
}

/**
 * Check if multi-select "Done" button should be enabled.
 *
 * Derived from `multiSelectDoneDisabledReason` (defined below with the other
 * disabled reasons) so the enabled state and the explanation the player reads
 * come from ONE calculation. `min` is optional; absent means "no minimum" —
 * i.e. 0 — which that reason already handles.
 */
const isMultiSelectReady = computed(() => {
  if (!currentMultiSelect.value) return false;
  return !isDisabled(multiSelectDoneDisabledReason.value);
});

/**
 * Check if Done button should be shown (hidden when min === max, since auto-confirms)
 */
const showMultiSelectDoneButton = computed(() => {
  if (!currentMultiSelect.value) return false;
  const { min, max } = currentMultiSelect.value;
  // Hide Done button when exact count required - auto-confirms on reaching count
  return min !== max;
});

/**
 * Get display text for multi-select count (e.g., "Selected: 1/2")
 */
const multiSelectCountDisplay = computed(() => {
  if (!currentMultiSelect.value) return '';
  const count = multiSelectValues.value.length;
  const max = currentMultiSelect.value.max;
  if (max !== undefined) {
    return `Selected: ${count}/${max}`;
  }
  return `Selected: ${count}`;
});

async function startAction(
  actionName: string,
  options?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> }
) {
  const meta = actionsWithMetadata.value.find(a => a.name === actionName);

  if (!meta || meta.selections.length === 0) {
    await executeAction(actionName, {});
    return;
  }

  const firstSel = meta.selections[0];

  // The board half of the start is NOT the panel's to sequence (#185). It used
  // to clear the board AFTER the await and then restore the action name alone,
  // which wiped the valid elements and both selection callbacks the bridge had
  // just installed from inside that await -- leaving a board that named an
  // action it could not answer. `startActionWithBoardReset` is the single
  // statement of the order; the bridge's watchers do the wiring.
  await startActionWithBoardReset(actionController, boardInteraction, actionName, options);

  if (firstSel.type === 'element' || firstSel.type === 'elements') {
    emit('selectingElement', firstSel.name, firstSel.elementClassName);
  }
}

function cancelAction() {
  // Delegate cancel to controller (handles repeating selection + multiSelect draft cleanup)
  actionController.cancel();

  // Clear ActionPanel-specific state
  boardInteraction?.clear();
  emit('cancelSelection');
}

/**
 * Handle a selection choice - delegates to controller.fill() for core logic.
 * This is a thin wrapper that handles UI concerns (display caching, board interaction).
 *
 * The controller handles:
 * - Validation
 * - Repeating selections (via selectionStep)
 * - Deferred choices
 * - Auto-execute when ready
 *
 * ActionPanel handles:
 * - Display caching
 * - Board interaction (highlighting, selecting)
 * - Element selection emits
 */
async function setSelectionValue(name: string, value: unknown, display?: string) {
  const selection = currentPick.value;

  // Delegate to controller for core fill logic
  // Controller stores display in collectedSelections automatically
  // Controller handles: validation, repeating selections, auto-execute
  const result = await actionController.fill(name, value);
  if (!result.valid) {
    // UIX-01: no direct toast here — fill() sets actionController.lastError
    // on every failure path, which GameShell's central watch surfaces as the
    // single failure toast (parity with custom UIs, no double-toast).
    return;
  }

  // UI-only concerns below (controller doesn't handle these)

  // For choice selections with board refs, mark the selected element
  if (selection?.type === 'choice' && selection.choices) {
    const choice = selection.choices.find((c: ChoiceWithRefs) => c.value === value);
    if (choice?.refs?.length) {
      const ref = (choice.refs ?? []).find(r => r.role === 'target')?.ref ?? choice.refs[0]?.ref;
      if (ref && boardInteraction) {
        boardInteraction.selectElement(ref);
      }
    }
  }

  // Keep the selected move highlighted on the board
  if (boardInteraction && display) {
    boardInteraction.setHoveredChoice({
      value,
      display,
    });
  }

  if (selection?.type === 'element' || selection?.type === 'elements') {
    emit('selectingElement', selection.name, selection.elementClassName);
  }
}

async function executeAction(actionName: string, args: Record<string, unknown>) {
  // CRITICAL: Atomic check-and-set MUST happen first, before any other code
  // This prevents race conditions when multiple reactive paths trigger in the same tick
  if (isExecuting.value) {
    return;
  }

  // Extra safeguard: don't execute if it's not our turn
  if (!props.isMyTurn) {
    return;
  }

  // D27 commit-leak gate (T-160-27): a seat that already committed this
  // simultaneous step can never re-submit, even if `isMyTurn` is (still,
  // or again) true. Checked in addition to — not instead of — isMyTurn:
  // this is the honest guard for the case `isMyTurn` was designed to
  // cover but a stale/optimistic prop value defeats.
  if (props.completed) {
    return;
  }

  // Filter out null values (explicitly skipped optional selections)
  // Server expects undefined for missing optional args, not null
  const filteredArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== null) {
      filteredArgs[key] = value;
    }
  }

  try {
    // Delegate to controller for execution. execute() never re-throws — on
    // failure it sets actionController.lastError internally, which GameShell's
    // central watch surfaces as the single failure toast (UIX-01 chokepoint).
    // The catch below is defensive only (kept so `finally` always runs).
    await actionController.execute(actionName, filteredArgs);
  } catch {
    // Defensive only — execute() does not throw; lastError already covers it.
  } finally {
    boardInteraction?.clear();
    emit('cancelSelection');
  }
}


// Hover handlers for choice buttons
function handleChoiceHover(choice: ChoiceWithRefs) {
  boardInteraction?.setHoveredChoice({
    value: choice.value,
    display: choice.display,
    sourceRefs: (choice.refs ?? []).filter(r => r.role === 'source').map(r => r.ref),
    targetRefs: (choice.refs ?? []).filter(r => r.role === 'target' || r.role === 'highlight').map(r => r.ref),
  });
}

function handleChoiceLeave() {
  // Don't clear hover if we have multiSelect items selected - keep them highlighted
  if (multiSelectValues.value.length > 0) {
    // Re-apply the multiSelect highlights instead of clearing
    updateMultiSelectBoardHighlights();
    return;
  }
  boardInteraction?.setHoveredChoice(null);
}

// Clear board selection
function clearBoardSelection() {
  boardInteraction?.selectElement(null);
}

// ── Disabled reasons ─────────────────────────────────────────────────────────
// Every control this panel can grey out must say WHY — on hover, on focus, and
// on tap. Each site below resolves to a single DisabledReason handed to
// `v-disabled-reason`, which owns the dimming, the tooltip, and the inert
// activation together, so the look and the behavior cannot drift apart.

/**
 * Why nothing can be pressed while an action is in flight, or `false` when
 * none is. Shared by the action buttons and Undo.
 */
const submissionInFlightReason = computed<DisabledReason>(() =>
  isExecuting.value ? 'Finishing your last move — one moment.' : false
);

/**
 * Why an action's button is disabled: the server-supplied reason for this
 * action (its `.disabled()` rule or the tutorial gate) if any, otherwise the
 * in-flight submission. The server reason wins — it is the specific one, and
 * it stays true after the in-flight moment passes.
 */
function actionDisabledReason(actionName: string): DisabledReason {
  return props.disabledActions?.[actionName] || submissionInFlightReason.value;
}

/**
 * Why a multi-select option cannot be toggled: its own disabled reason if it
 * has one, otherwise the max-selections cap (which blocks only options that
 * are not already selected — deselecting is always allowed).
 */
function multiSelectDisabledReason(own: DisabledReason, value: unknown): DisabledReason {
  if (isDisabled(own)) return own;
  const max = currentMultiSelect.value?.max;
  if (max === undefined) return false;
  if (isMultiSelectValueSelected(value)) return false;
  if (multiSelectValues.value.length < max) return false;
  return max === 1
    ? 'You can pick only one — deselect the other first.'
    : `You have already picked ${max}. Deselect one to change your mind.`;
}

/**
 * Why the multi-select Done button cannot be pressed yet: too few selected.
 * Mirrors `isMultiSelectReady`, which is derived from this so the enabled
 * state and the explanation can never disagree.
 */
const multiSelectDoneDisabledReason = computed<DisabledReason>(() => {
  const config = currentMultiSelect.value;
  if (!config) return false;
  const min = config.min ?? 0;
  const short = min - multiSelectValues.value.length;
  if (short <= 0) return false;
  return `Pick ${short} more to continue (at least ${min} required).`;
});


</script>

<template>
  <!-- Animations pending indicator -->
  <div v-if="animationsPending" class="action-panel-pending">
    <span class="pending-text">Playing animations...</span>
    <button class="skip-btn" @click="skipAnimations">Skip</button>
  </div>

  <!-- Normal action panel content, gated on showActionPanel -->
  <div
    ref="panelRoot"
    class="action-panel"
    data-bs-panel
    v-else-if="showActionPanel"
    @keydown="onPanelKeydown"
  >
    <!-- What a screen reader is told when a menu level moved under the player
         (#228). OUTSIDE the keyed list below on purpose: that list re-mounts
         whenever availability changes, and a live region created in the same
         tick as its text is not reliably announced. -->
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      data-bs-menu-announcement
    >{{ menuAnnouncement }}</span>

    <!-- No action being configured.

         NO KEY ON THIS LIST (#235). It was keyed on `availableActions.join(',')`
         to force a re-render, which re-mounted every button whenever the
         available set changed -- the same unmount-loses-state mechanism as the
         collapse, and the reason #228 had to extend the focus watcher to put
         focus back afterwards. The only state that re-render existed to keep
         honest, the open level, is resolved against the menu on every read and
         kept outside this component, so the key had nothing left to do and a
         button that still exists now keeps its DOM node and its focus. -->
    <div v-if="!currentAction" class="action-buttons">
      <!-- Menu chrome, drawn only inside a group (#228). At the top level there
           is none, so a game that declares no grouping renders exactly the flat
           panel it always did. -->
      <div v-if="menuLevel.group" class="action-menu-header">
        <button
          class="action-btn menu-back-btn"
          data-bs-menu-back
          :aria-label="backLabel"
          @click="leaveGroup"
        >
          <span aria-hidden="true">&lsaquo;</span> Back
        </button>
        <span class="action-menu-label">{{ menuBreadcrumb }}</span>
      </div>
      <!-- Each action wrapped in .action-btn-group: positioning context for "?" affordance.
           .action-buttons { display: contents } propagates the parent flex context so
           .action-btn-group (inline-flex) becomes a direct action bar flex item — no layout change. -->
      <div
        v-for="node in menuLevel.nodes"
        :key="node.kind === 'group' ? `group:${node.label}` : node.action.name"
        class="action-btn-group"
      >
        <!-- A GROUP BUTTON IS NAVIGATION AND NOTHING ELSE. `enterGroup` assigns
             one local ref; the node it is handed has no action name on it, so
             there is nothing here that could submit an order or take a turn. -->
        <button
          v-if="node.kind === 'group'"
          class="action-btn action-group-btn"
          :data-bs-action-group="node.label"
          @click="enterGroup(node)"
        >
          {{ node.label }}
          <span aria-hidden="true" class="action-group-chevron">&rsaquo;</span>
          <span class="sr-only">{{ groupContents(node) }}</span>
        </button>
        <template v-else>
          <!-- v-disabled-reason dims the button, shows the reason on hover/focus/tap,
               and swallows the activation. It uses aria-disabled rather than the
               native attribute so the control stays focusable — a natively-disabled
               button cannot be reached by keyboard, taking the reason with it. -->
          <button
            class="action-btn"
            :data-bs-action="node.action.name"
            v-disabled-reason="actionDisabledReason(node.action.name)"
            @click="startAction(node.action.name)"
          >
            {{ node.action.prompt || formatActionName(node.action.name) }}
          </button>
          <!-- "?" affordance: shown when global toggle is ON and content exists.
               Disabled-reason-only case also shows the affordance (UI-SPEC Interaction States). -->
          <ActionHelpPopover
            v-if="isActionHelpVisible && (node.action.help || disabledActions?.[node.action.name])"
            :action-name="node.action.name"
            :help-text="node.action.help"
            :disabled-reason="disabledActions?.[node.action.name]"
            :trigger-label="node.action.prompt || formatActionName(node.action.name)"
          />
        </template>
      </div>
      <!-- Undo button — no help affordance (outside the group) -->
      <button
        v-if="canUndo"
        class="action-btn undo-btn"
        v-disabled-reason="submissionInFlightReason"
        @click="emit('undo')"
      >
        Undo
      </button>
    </div>

    <!-- Configuring an action -->
    <div v-else class="action-config">
      <div class="config-header">
        <span class="config-title">{{ currentActionMeta?.prompt || formatActionName(currentAction) }}</span>
        <button class="cancel-btn" @click="cancelAction" aria-label="Cancel action">
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <!-- Selected values (show previous selections as chips) -->
      <!-- Note: displayableArgs filters out internal keys and current multiSelect selection -->
      <div v-if="Object.keys(displayableArgs).length > 0" class="selected-values">
        <template v-for="(value, key) in displayableArgs" :key="key">
          <div class="selected-value from-board">
            <span class="value-display">{{ getSelectionDisplay(key as string, value) }}</span>
            <button
              class="clear-selection-btn"
              @click="clearSelection(key as string)"
              :aria-label="`Clear ${(key as string).replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </template>
      </div>

      <!-- Accumulated selections for repeating selection in progress -->
      <div v-if="repeatingState && repeatingState.accumulated.length > 0" class="accumulated-selections">
        <span class="accumulated-label">Selected:</span>
        <span
          v-for="(val, idx) in repeatingState.accumulated"
          :key="idx"
          class="accumulated-chip"
        >
          {{ getAccumulatedDisplay(val) }}
        </span>
        <span v-if="repeatingState.awaitingServer" class="loading-indicator">...</span>
      </div>

      <!-- WHAT THIS DRAFT WOULD COST, ACCORDING TO THE GAME (#248).
           Above the question, so the price is read before the field is answered
           and stays on screen through the confirmation below. A LIVE REGION,
           because the price moves while the player types and a sighted player
           sees that happen: `role="status"` is how the other one hears it.
           One source of truth with a custom UI -- both read
           `actionController.actionQuote`, so the two surfaces cannot quote
           different prices for one draft. -->
      <div
        v-if="quotesDraft"
        class="action-quote"
        data-bs-quote
        role="status"
        aria-live="polite"
      >
        <template v-if="quoteLines">
          <span v-for="(line, i) in quoteLines" :key="i" class="quote-line">{{ line }}</span>
        </template>
        <!-- A refusal in place of a price, never beside one. -->
        <span v-else-if="quoteError" class="quote-refusal">{{ quoteError }}</span>
        <span v-else class="quote-pending">Working out the price…</span>
      </div>

      <!-- Current selection input -->
      <div v-if="currentPick" class="selection-input">
        <!-- #172: too many candidates to read as a list, and the board draws every
             one of them. Prompt + a single control that hands focus to the board. -->
        <template v-if="deferPickToBoard">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.elementClassName || currentPick.name}` }}
            <span v-if="currentMultiSelect" class="multi-select-count">{{ multiSelectCountDisplay }}</span>
            <span v-else-if="currentPick.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons board-handoff">
            <button
              class="choice-btn board-handoff-btn"
              :aria-label="`Choose on the board — ${filteredValidElements.length} options. Use the arrow keys to move between them and Enter to choose.`"
              @click="handOffToBoard"
            >
              Choose on the board ({{ filteredValidElements.length }})
            </button>
            <DoneButton
              v-if="showMultiSelectDoneButton"
              :disabled-reason="multiSelectDoneDisabledReason"
              @click="confirmMultiSelect"
            />
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
          </div>
        </template>

        <!-- Element selection with validElements (shows buttons for each valid element) -->
        <template v-else-if="currentPick.type === 'element' && filteredValidElements.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.elementClassName || 'element'}` }}
            <span v-if="currentPick.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons element-selection">
            <button
              v-for="element in filteredValidElements"
              :key="element.id"
              class="choice-btn element-btn"
              v-disabled-reason="element.disabled"
              @click="selectElement(element.id)"
              @mouseenter="handleElementHover(element)"
              @mouseleave="handleElementLeave"
            >
              {{ element.display || element.id }}
            </button>
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
          </div>
        </template>

        <!-- Elements selection with multiSelect (checkboxes for multiple element selection) -->
        <template v-else-if="currentPick.type === 'elements' && currentMultiSelect && filteredValidElements.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span class="multi-select-count">{{ multiSelectCountDisplay }}</span>
          </div>
          <div class="choice-buttons multi-select-choices">
            <!-- The directive goes on the LABEL: it is the whole visible option, so
                 hovering anywhere on it reveals the reason, and its capture-phase
                 click guard also covers the checkbox nested inside it. The input
                 additionally carries aria-disabled, because THAT is the control a
                 screen reader announces. -->
            <label
              v-for="element in filteredValidElements"
              :key="element.id"
              class="multi-select-choice"
              :class="{ selected: isMultiSelectValueSelected(element.id) }"
              v-disabled-reason="multiSelectDisabledReason(element.disabled, element.id)"
              @mouseenter="handleElementHover(element)"
              @mouseleave="handleElementLeave"
            >
              <input
                type="checkbox"
                :checked="isMultiSelectValueSelected(element.id)"
                :aria-disabled="isDisabled(multiSelectDisabledReason(element.disabled, element.id)) || undefined"
                @click="toggleMultiSelectValue(currentPick.name, element.id, element.display)"
              />
              <span class="checkbox-label">{{ element.display || element.id }}</span>
            </label>
            <span v-if="filteredValidElements.length === 0" class="no-choices">
              No options available
            </span>
            <DoneButton
              v-if="showMultiSelectDoneButton"
              :disabled-reason="multiSelectDoneDisabledReason"
              @click="confirmMultiSelect"
            />
          </div>
        </template>

        <!-- Elements selection without multiSelect (buttons for single element selection) -->
        <template v-else-if="currentPick.type === 'elements' && filteredValidElements.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span v-if="currentPick.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons element-selection">
            <button
              v-for="element in filteredValidElements"
              :key="element.id"
              class="choice-btn element-btn"
              v-disabled-reason="element.disabled"
              @click="selectElement(element.id)"
              @mouseenter="handleElementHover(element)"
              @mouseleave="handleElementLeave"
            >
              {{ element.display || element.id }}
            </button>
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
          </div>
        </template>

        <!-- ORDERED, REPEATABLE list of choices (#249): Add buttons over the list
             being built, each entry removable, then Done. Before the multi-select
             template because the two are mutually exclusive and this one is the
             more specific. A checkbox cannot express "again", which is why this
             pick gets its own control rather than a flag on that one. -->
        <template v-else-if="currentPick.type === 'choice' && currentOrderedList && filteredChoices.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <!-- SPOKEN, because nothing else about an Add is (#252): focus stays
                 on the button, whose name and state do not change, and the new
                 entry is drawn where the keyboard is not. -->
            <span class="multi-select-count ordered-list-count" aria-live="polite">
              {{ orderedListCountDisplay }}
            </span>
          </div>
          <ol
            v-if="orderedListEntries.length"
            ref="orderedEntriesList"
            class="ordered-list-entries"
            aria-label="Entries added so far, in order"
          >
            <li
              v-for="(entry, index) in orderedListEntries"
              :key="`${index}-${String(entry)}`"
              class="ordered-list-entry"
            >
              <span class="ordered-list-position">{{ index + 1 }}.</span>
              <span class="ordered-list-label">{{ orderedEntryDisplay(entry) }}</span>
              <button
                class="ordered-list-remove"
                :aria-label="`Remove entry ${index + 1}, ${orderedEntryDisplay(entry)}`"
                @click="dropListEntry(currentPick.name, index)"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          </ol>
          <div ref="orderedChoiceRow" class="choice-buttons ordered-list-choices">
            <!-- The visible label is the choice; the ACCESSIBLE name carries the
                 gesture (#252). Announced on its own, "University" says neither
                 what pressing it does nor that pressing it again repeats it, and
                 a row of buttons all reading "Add University" is unreadable. -->
            <button
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="choice-btn ordered-list-add"
              :aria-label="`Add ${choice.display}`"
              v-disabled-reason="orderedListAddDisabledReason(choice.disabled)"
              :aria-disabled="isDisabled(orderedListAddDisabledReason(choice.disabled)) || undefined"
              @click="addListEntry(currentPick.name, choice.value)"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              {{ choice.display }}
            </button>
            <DoneButton
              :disabled-reason="orderedListDoneDisabledReason"
              @click="confirmMultiSelect"
            />
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
          </div>
        </template>

        <!-- Multi-select choice selection (checkboxes with Done button) - MUST come before dependsOn template -->
        <template v-else-if="currentPick.type === 'choice' && currentMultiSelect && filteredChoices.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span class="multi-select-count">{{ multiSelectCountDisplay }}</span>
          </div>
          <div class="choice-buttons multi-select-choices">
            <!-- Directive on the label, aria-disabled on the control — see the
                 elements variant above for why they are split. -->
            <label
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="multi-select-choice"
              :class="{ selected: isMultiSelectValueSelected(choice.value) }"
              v-disabled-reason="multiSelectDisabledReason(choice.disabled, choice.value)"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              <input
                type="checkbox"
                :checked="isMultiSelectValueSelected(choice.value)"
                :aria-disabled="isDisabled(multiSelectDisabledReason(choice.disabled, choice.value)) || undefined"
                @click="toggleMultiSelectValue(currentPick.name, choice.value, choice.display)"
              />
              <span class="checkbox-label">{{ choice.display }}</span>
            </label>
            <span v-if="filteredChoices.length === 0" class="no-choices">
              No options available
            </span>
            <DoneButton
              v-if="showMultiSelectDoneButton"
              :disabled-reason="multiSelectDoneDisabledReason"
              @click="confirmMultiSelect"
            />
          </div>
        </template>

        <!-- Choice selection with filterBy or dependsOn (shows filtered choices, executes immediately) -->
        <!-- This comes AFTER multi-select so multiSelect+dependsOn uses multi-select template above -->
        <template v-else-if="currentPick.type === 'choice' && (currentPick.filterBy || currentPick.dependsOn)">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
          </div>
          <div class="choice-buttons">
            <button
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="choice-btn filtered-choice-btn"
              v-disabled-reason="choice.disabled"
              @click="executeChoice(currentPick.name, choice)"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              {{ choice.display }}
            </button>
            <!-- Loading guard (R-06): show loading indicator while choices are being fetched
                 so we never flash "No options available" when choices are in-flight.
                 Only show "No options available" once the fetch completes with zero results.
                 R-06b: notation-anchored choices render in the secondary "Select on board
                 or choose here" list (anchoredChoices), NOT in filteredChoices. When EVERY
                 choice is board-anchored (e.g. checkers move destinations — every square has
                 a notation), filteredChoices is empty but valid options DO exist. Gate the
                 empty/loading states on BOTH lists so we never claim "No options available"
                 while the anchored list is showing real choices. -->
            <div v-if="filteredChoices.length === 0 && anchoredChoices.length === 0 && isLoadingChoices" class="loading-choices">
              Loading choices...
            </div>
            <span v-else-if="filteredChoices.length === 0 && anchoredChoices.length === 0" class="no-choices">
              No options available
            </span>
          </div>
        </template>

        <!-- Regular choice selection -->
        <template v-else-if="currentPick.type === 'choice' && filteredChoices.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span v-if="currentPick.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons">
            <button
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="choice-btn"
              v-disabled-reason="choice.disabled"
              @click="setSelectionValue(currentPick.name, choice.value, choice.display)"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              {{ choice.display }}
            </button>
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
            <span v-if="filteredChoices.length === 0 && !currentPick.optional" class="no-choices">
              No options available
            </span>
          </div>
        </template>

        <!-- Loading choices indicator for element selections -->
        <div v-else-if="(currentPick.type === 'element' || currentPick.type === 'elements') && isLoadingChoices" class="loading-choices">
          Loading choices...
        </div>

        <!-- Element selection (fallback when no validElements and not loading) -->
        <div v-else-if="currentPick.type === 'element' || currentPick.type === 'elements'" class="element-instruction">
          <span class="instruction-text">
            Click on a {{ currentPick.elementClassName || 'element' }} to select it
          </span>
        </div>

        <!-- THE TYPED EDITOR, FOR BOTH PICKS THAT HAVE ONE (#237).
             A number field, a single-line text field and a box are three
             controls for one job, and everything around the control is the
             same: the prompt is a real <label> bound to the field (#199,
             because a line of text above an input is a label to a sighted
             player and nothing at all to a screen reader), the hint below it
             is the rule and not the question, the descriptions reach the field
             through `editorFieldAttrs`, and one submit button reports one
             refusal.

             It was two blocks, and three tickets running fixed one of them:
             #199 the prompt on both, #229 the hint binding and the silent
             refusal on text only, #234 the number hint's wording on its own.
             There is one block now, so the next repair cannot land on half the
             editor -- and the only thing that varies with the kind is which
             control renders and what the value is. -->
        <div
          v-else-if="currentPick.type === 'number' || currentPick.type === 'text'"
          :class="editorWrapperClass"
        >
          <label class="selection-prompt" :for="editorInputId">
            {{ currentPick.prompt || `Enter ${currentPick.name}` }}
            <span v-if="currentPick.optional" class="optional-label">(optional)</span>
          </label>
          <span v-if="editorHint" :id="editorHintId" class="input-hint">({{ editorHint }})</span>
          <div class="input-row">
            <input
              v-if="currentPick.type === 'number'"
              v-bind="editorFieldAttrs"
              type="number"
              v-model.number="numberInputValue"
              :min="currentPick.min"
              :max="currentPick.max"
              :step="currentPick.integer ? 1 : 'any'"
              @keyup.enter="submitEditorValue"
            />
            <!-- No Enter handler, which is the point: in a box Enter starts a
                 new line and the submit button is the only way out. -->
            <textarea
              v-else-if="currentPick.multiline"
              v-bind="editorFieldAttrs"
              v-model="textInputValue"
              :minlength="currentPick.minLength"
              :maxlength="currentPick.maxLength"
              rows="6"
            ></textarea>
            <input
              v-else
              v-bind="editorFieldAttrs"
              type="text"
              v-model="textInputValue"
              :minlength="currentPick.minLength"
              :maxlength="currentPick.maxLength"
              :pattern="currentPick.pattern"
              @keyup.enter="submitEditorValue"
            />
            <!-- Above the submit button, not below it: the bar caps its own
                 height and scrolls, and the count is the line the player needs
                 while typing. -->
            <span v-if="currentPick.multiline" :id="editorCountId" class="char-count">
              {{ textCharCount }}
            </span>
            <DoneButton @click="submitEditorValue" />
            <!-- THE SKIP AN OPTIONAL EDITOR PICK NEVER HAD (#248).
                 Every other optional pick offers one; the editor block rendered
                 the "(optional)" label and the game's own skip WORDING -- "skip
                 for one week" -- with no control that could take it, so an
                 omitted quantity was unreachable from the standard panel and the
                 game's default was a branch only a custom UI could get to. -->
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              data-bs-skip-editor
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
          </div>
          <!-- Empty at every length but the last one, so it speaks when a
               keystroke stops working and stays quiet while the player types. -->
          <span v-if="currentPick.multiline" class="sr-only" role="status">
            {{ textLimitAnnouncement }}
          </span>
          <p v-if="editorInputError" :id="editorErrorId" class="selection-error" role="alert">
            {{ editorInputError }}
          </p>
        </div>

        <!-- A11Y-02: notation-anchored choices (board squares). Rendered INLINE as
             flow buttons — direct siblings of the prompt in the action bar's flex flow — so
             the action reads as one wrapping sentence (e.g. "Move · b6 · Select
             destination · a5 · c5"), in parity with primary choice buttons. They remain
             keyboard/SR-operable: each is a real <button> whose activation resolves
             the choice directly via executeChoice — identical to the primary choice
             buttons — and the aria-label carries the square notation. (It must NOT
             route through triggerElementSelect on a notation: a destination choice's
             first notation ref is its SOURCE square, which is shared by every
             destination from the same piece and so cannot disambiguate the target.) -->
        <template v-if="anchoredChoices.length">
          <button
            v-for="choice in anchoredChoices"
            :key="String(choice.value)"
            class="choice-btn anchored-choice-btn"
            v-disabled-reason="choice.disabled"
            :aria-label="`${choice.display}${choice.refs?.find(r => r.ref.notation)?.ref.notation ? ' (' + choice.refs.find(r => r.ref.notation)!.ref.notation + ')' : ''}`"
            @click="executeChoice(currentPick.name, choice)"
            @mouseenter="handleChoiceHover(choice)"
            @mouseleave="handleChoiceLeave"
          >
            {{ choice.display }}
          </button>
        </template>
      </div>

      <!-- THE CONFIRMATION A QUOTED ACTION ENDS ON (#248).
           Reached only when every selection is answered and the action prices its
           own draft. Before this, filling the last field WAS the purchase -- the
           total and the charge landed in the same tick, so there was no moment in
           which a player could read a price and then decide.

           The reason lives on `v-disabled-reason`, not on a native `disabled`:
           the control stays focusable, so the player who cannot press it is told
           why. And the rule behind it is the controller's -- `confirm()` refuses
           the same cases -- so a surface that forgot to grey the button still
           cannot submit a draft nobody was quoted. -->
      <div v-else-if="awaitingConfirmation" class="action-review">
        <button
          class="choice-btn confirm-btn"
          data-bs-confirm
          v-disabled-reason="confirmDisabledReason ?? undefined"
          @click="confirmDraft"
        >
          Confirm
        </button>
      </div>
    </div>
  </div>

  <!-- Not my turn -->
  <div v-else class="waiting-message">
    <template v-if="awaitingPlayers?.length">
      <template v-for="(p, i) in awaitingPlayers" :key="p.seat">
        <span class="awaiting-seat" :style="p.color ? { color: p.color } : undefined">{{ p.name }}</span><template v-if="i < awaitingPlayers.length - 1">, </template>
      </template><template v-if="latestMessage">: {{ latestMessage }}</template>
      <template v-else>: Waiting...</template>
    </template>
    <template v-else-if="latestMessage">
      <span v-if="currentPlayerName" class="player-name-prefix" :style="currentPlayerColor ? { color: currentPlayerColor } : undefined">{{ currentPlayerName }}:</span>
      {{ latestMessage }}
    </template>
    <template v-else>
      It is <span v-if="currentPlayerName" :style="currentPlayerColor ? { color: currentPlayerColor } : undefined">{{ currentPlayerName }}</span><span v-else>the other player</span>'s turn
    </template>
  </div>
</template>

<style scoped>
.action-panel {
  /* Flattened into the action bar's flex flow: ActionPanel's own box disappears so its
     children (action title, cancel, prompt, option buttons) flow INLINE alongside the
     ⋯ menu + token, wrapping like one sentence (no header row before the buttons).
     The wrapper chain below is also display:contents to reach the leaf items. */
  display: contents;
}

.action-buttons {
  /* Flattened into the action bar's flow so available-action buttons wrap inline with the
     ⋯ menu + token (see .action-panel). */
  display: contents;
}

/* Action button group — wraps each action + its "?" affordance.
   inline-flex becomes a direct action bar flex item (because .action-buttons has
   display:contents, propagating the parent flex context). The "?" is absolutely
   positioned so it does NOT affect the group's intrinsic width (RESEARCH Pitfall 5).
   No width or flex-grow set — action-btn retains its own sizing rules. */
.action-btn-group {
  display: inline-flex;
  align-items: stretch;
  position: relative;
}

/* Primary action button — Slate teal plate */
.action-btn {
  /* min-height floor meets the WCAG 2.2 AA 44px touch-target target (SC 2.5.8);
     these are the primary in-game interactions and were previously ~38px. */
  min-height: 44px;
  padding: 10px 20px;
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: bold;
  cursor: pointer;
  box-shadow: var(--bsg-shadow-sm);
  transition: all 0.2s;
}

.action-btn:hover:not([aria-disabled='true']) {
  transform: translateY(-1px);
  box-shadow: var(--bsg-shadow);
}

.action-btn[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Undo button - secondary/neutral style */
.undo-btn {
  background: var(--bsg-surface-2);
  border: 1px solid var(--bsg-line-2);
  color: var(--bsg-ink);
  box-shadow: none;
}

.undo-btn:hover:not([aria-disabled='true']) {
  background: var(--bsg-surface-3);
  box-shadow: var(--bsg-shadow-sm);
}

/* Menu chrome (issue 228): Back and the current-level label.
   display:contents for the same reason .config-header uses it: the header's
   parts become direct items of the action bar's flex flow, so on a narrow
   screen they wrap with the buttons instead of forcing a fixed-width row. */
.action-menu-header {
  display: contents;
}

.action-menu-label {
  font-weight: bold;
  font-size: 1rem;
  color: var(--bsg-ink-2);
  align-self: center;
  /* The one thing that must not wrap mid-word; the flex flow wraps it whole. */
  white-space: nowrap;
}

/* Back reads as a way out, not as a move: the neutral plate the Undo button
   uses, so a group's own actions keep the accent to themselves. */
.menu-back-btn {
  background: var(--bsg-surface-2);
  border: 1px solid var(--bsg-line-2);
  color: var(--bsg-ink);
  box-shadow: none;
}

.menu-back-btn:hover:not([aria-disabled='true']) {
  background: var(--bsg-surface-3);
  box-shadow: var(--bsg-shadow-sm);
}

/* A group button says it leads somewhere. Same plate as an action button so the
   level reads as one row of choices, with the chevron carrying the difference. */
.action-group-chevron {
  margin-left: 6px;
  opacity: 0.75;
}

/* Announcements for a screen reader only. The visible half of every one of
   these is the button list itself. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Action configuration - horizontal flow layout */
/* Flattened into the action bar's flow (see .action-panel) so the action title, cancel,
   prompt, and option buttons all wrap inline together. */
.action-config {
  display: contents;
}
.config-header {
  display: contents;
}

.config-title {
  font-weight: bold;
  font-size: 1rem;
  white-space: nowrap;
}

.cancel-btn {
  background: transparent;
  border: none;
  color: var(--bsg-ink-3);
  font-size: 1rem;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
  min-height: 24px;
  min-width: 24px;
}

.cancel-btn:hover {
  color: var(--bsg-ink);
}

.selected-values {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.selected-value {
  background: var(--bsg-surface-2);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
}

/* Accumulated selections for repeating choices */
.accumulated-selections {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bsg-selectable);
  border-radius: 6px;
  border: 1px solid var(--bsg-line-2);
}

.accumulated-label {
  font-size: 0.8rem;
  color: var(--bsg-ink-2);
  margin-right: 4px;
}

.accumulated-chip {
  background: var(--bsg-selectable);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  color: var(--bsg-accent);
}

.loading-indicator {
  color: var(--bsg-ink-3);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.value-display {
  color: var(--bsg-accent);
}

.selected-value.from-board {
  background: var(--bsg-selectable);
  border: 1px solid var(--bsg-line-2);
  display: flex;
  align-items: center;
  gap: 6px;
}

.selected-value.from-board .value-display {
  color: var(--bsg-accent);
  font-weight: bold;
}

.clear-selection-btn {
  background: transparent;
  border: none;
  color: var(--bsg-ink-3);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  min-height: 24px;
  min-width: 24px;
}

.clear-selection-btn:hover {
  color: var(--bsg-ink);
}

/* Selection input - flows inline */
.selection-input {
  /* Flattened into the action bar's flow so the prompt + option buttons wrap inline with the
     ⋯ menu / token / title (see .action-panel). */
  display: contents;
}

.selection-prompt {
  font-size: 0.9rem;
  color: var(--bsg-ink-2);
  white-space: nowrap;
}

.choice-buttons {
  /* Flattened into the action bar's flow so every option button is a direct sibling of the
     ⋯ menu / token / prompt and they all wrap inline together. The 5-row cap + scroll
     now lives on the action bar itself (GameShell .actionbar). */
  display: contents;
}

.choice-btn {
  /* 44px touch-target floor (WCAG 2.2 AA SC 2.5.8); inline-flex centers the label
     within the taller box. Covers element-/filtered-/anchored-/skip-choice variants. */
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  background: var(--bsg-surface-2);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  color: var(--bsg-ink);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.choice-btn[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(0.5);
  border-color: var(--bsg-line);
  color: var(--bsg-ink-3);
}

.choice-btn:hover:not([aria-disabled='true']) {
  border-color: var(--bsg-accent);
  background: var(--bsg-selectable);
}

/* Element selection buttons */
.element-btn {
  font-weight: bold;
}

/* Optional label */
.optional-label {
  color: var(--bsg-ink-3);
  font-style: italic;
  font-size: 0.85em;
  margin-left: 6px;
}

/* Filtered choice buttons */
.filtered-choice-btn {
  background: var(--bsg-surface-2);
  border-color: var(--bsg-line-2);
}

.filtered-choice-btn:hover:not([aria-disabled='true']) {
  border-color: var(--bsg-accent);
  background: var(--bsg-selectable);
}

/* A11Y-02: notation-anchored choices now flow inline as flow buttons (see template).
   No wrapper block / centered label — they are direct action bar flex items that wrap with
   the prompt. The accent border distinguishes them as board-anchored options. */
.anchored-choice-btn {
  border-color: var(--bsg-accent);
}

.anchored-choice-btn:hover:not([aria-disabled='true']) {
  background: var(--bsg-selectable);
}

/* Issue 172: the one control that stands in for a candidate set too large to
   list. Accented like an anchored choice, because that is what it leads to. */
.board-handoff-btn {
  border-color: var(--bsg-accent);
}

.board-handoff-btn:hover {
  background: var(--bsg-selectable);
}

.no-choices {
  color: var(--bsg-ink-2);
  font-style: italic;
  font-size: 0.85rem;
}

.element-instruction {
  padding: 10px 16px;
  background: var(--bsg-field);
  border-radius: 6px;
  text-align: center;
}

.instruction-text {
  color: var(--bsg-ink-2);
  font-size: 0.9rem;
}

/* ISSUE 199: THE EDITORS ARE A COLUMN, AND THEY SAY SO.
   Three rows -- the prompt, the range, the field and its Done -- and the gap is
   what clears the focus ring. The ring is a `box-shadow` (see GameShell's
   `:focus-visible`), so it is painted OUTSIDE the border box and no margin on a
   sibling can be relied on to make room for it; `.input-hint` used to be an
   inline span with a `margin-bottom` that did not apply to it at all, and the
   ring crossed the hint the moment the field took focus. */
.number-input,
.text-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.number-input .selection-prompt,
.text-input .selection-prompt {
  /* The panel's prompts do not wrap elsewhere, but an editor's is a full
     sentence in a column rather than a word on a row of buttons. */
  white-space: normal;
}

.number-input input,
.text-input input {
  padding: 8px 12px;
  background: var(--bsg-field);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  color: var(--bsg-ink);
  font-size: 0.9rem;
  width: 120px;
}

.number-input input:focus,
.text-input input:focus,
.text-input textarea:focus {
  border-color: var(--bsg-accent);
}

/* ISSUE 229: A BOX, NOT A LINE.
   The single-line field above is `width: 120px`, which is the whole complaint:
   a 1,000 character description shown 120px at a time cannot be read back, let
   alone written. So the multiline editor takes a full row of the action bar
   (`flex: 1 1 100%` -- the bar is a wrapping flex row and ActionPanel's own
   wrappers are `display: contents`, so this box IS a bar item and nothing else
   can give it the width), and the box fills that row.

   `min-height` rather than a fixed height so `rows` sets the resting size and
   the player's own drag can only make it bigger; `resize: vertical` because
   horizontal resizing inside a flex row fights the bar's wrapping. */
.text-input-multiline {
  flex: 1 1 100%;
}

.text-input-multiline .input-row {
  /* STILL A ROW, ALLOWED TO WRAP. The box below takes a whole flex line
     (`flex-basis: 100%`), so the character count and the submit button land
     together on the next one -- one row for the two of them rather than one
     each. That row is what keeps the whole editor inside the bar's own height
     cap: past it the bar scrolls, and the control scrolled away would be the
     only way the player has to finish. */
  flex-wrap: wrap;
  align-items: center;
  align-self: stretch;
}

.text-input textarea {
  flex: 1 1 100%;
  width: 100%;
  /* Four and a half lines at rest, and the player's own drag from there. Chosen
     against the bar's height cap rather than by eye: the editor has to fit
     inside it whole, and `resize: vertical` is how somebody who wants more
     takes it. */
  min-height: 5.5rem;
  resize: vertical;
  padding: 8px 12px;
  background: var(--bsg-field);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  color: var(--bsg-ink);
  /* A textarea does not inherit the page's font, and a description written in
     the browser's default monospace looks like a bug report. */
  font-family: inherit;
  font-size: 0.9rem;
  line-height: 1.4;
}

.char-count {
  color: var(--bsg-ink-2);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

/* The reason a value was refused, in the panel's own error colour so it does
   not read as another hint. */
.selection-error {
  margin: 0;
  color: var(--bsg-danger);
  font-size: 0.85rem;
  white-space: normal;
}

/* Screen-reader only (mirrors AutoRenderer's helper; scoped styles don't share). */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.input-hint {
  color: var(--bsg-ink-2);
  font-size: 0.8rem;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.waiting-message {
  flex: 1 1 0;
  min-width: 0;
  padding: 10px 20px;
  background: var(--bsg-surface-2);
  border-radius: 8px;
  text-align: left;
  color: var(--bsg-ink-2);
  font-size: 0.9rem;
}

.player-name-prefix {
  font-weight: 600;
}

.awaiting-seat {
  font-weight: 700;
  font-size: 0.95rem;
}

/* Ordered, repeatable list styles (issue 249) */
.ordered-list-entries {
  list-style: none;
  margin: 6px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ordered-list-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
}

.ordered-list-position {
  color: var(--bsg-accent);
  font-weight: bold;
  min-width: 1.5em;
  text-align: right;
}

.ordered-list-label {
  flex: 1;
}

.ordered-list-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  padding: 2px 4px;
}

.ordered-list-choices {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* Multi-select styles */
.multi-select-count {
  color: var(--bsg-accent);
  font-weight: bold;
  margin-left: 8px;
}

.multi-select-choices {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.multi-select-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--bsg-surface-2);
  border: 1px solid var(--bsg-line);
  border-radius: 6px;
  color: var(--bsg-ink);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.multi-select-choice[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(0.5);
  border-color: var(--bsg-line);
  color: var(--bsg-ink-3);
}

.multi-select-choice:hover:not([aria-disabled='true']) {
  border-color: var(--bsg-accent);
  background: var(--bsg-selectable);
}

.multi-select-choice.selected {
  border-color: var(--bsg-accent);
  background: var(--bsg-selectable);
}

.multi-select-choice input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--bsg-line-2);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}

.multi-select-choice input[type="checkbox"]:checked {
  border-color: var(--bsg-accent);
  background: var(--bsg-accent);
}

.multi-select-choice input[type="checkbox"]:checked::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--bsg-accent-ink);
  font-size: 12px;
  font-weight: bold;
}

.multi-select-choice input[type="checkbox"][aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}

.checkbox-label {
  flex: 1;
}

/* Choice loading styles */
.loading-choices {
  color: var(--bsg-ink-2);
  font-style: italic;
  font-size: 0.9rem;
  animation: pulse 1.5s infinite;
}

/* Animation pending state */
.action-panel-pending {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--bsg-surface-2);
  border-radius: 0.5rem;
}

.pending-text {
  color: var(--bsg-ink-2);
  font-style: italic;
}

.skip-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--bsg-line);
  border-radius: 0.25rem;
  background: var(--bsg-surface);
  color: var(--bsg-ink-2); /* explicit — do not rely on Rule A cascade */
  cursor: pointer;
  font-size: 0.875rem;
}

.skip-btn:hover {
  background: var(--bsg-surface-3);
}

/* THE PRICE OF THE DRAFT (issue 248).
   `display: contents` like every other region in this bar, so the lines wrap
   inline with the prompt and the field rather than forcing a row of their own --
   the bar caps its own height and scrolls, and a block here would push the field
   the player is typing into out of view on a phone. */
.action-quote {
  display: contents;
}

.quote-line {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--bsg-ink);
  white-space: nowrap;
}

.quote-pending {
  font-size: 0.9rem;
  color: var(--bsg-ink-2);
  font-style: italic;
}

.quote-refusal {
  font-size: 0.9rem;
  color: var(--bsg-danger);
}

.action-review {
  display: contents;
}

/* The purchase, so it reads as the primary control of the bar rather than as one
   more option beside the cancel cross. */
.confirm-btn {
  font-weight: 600;
  border-color: var(--bsg-accent);
}
</style>
