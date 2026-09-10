/**
 * THE ACTION PANEL'S START-BUTTON HIERARCHY (#228).
 *
 * A world with seventeen simultaneously available actions gives "Rename planet"
 * the same prominence as "Construct building". A game says how its verbs are
 * arranged with `.group()` and `.order()`, and this module is the whole of what
 * that declaration means: a pure derivation from the action metadata the panel
 * was already handed, to a tree of nodes it draws one level at a time.
 *
 * ## Why this is a separate module, and pure
 *
 * A GROUP IS NAVIGATION, NOT A GAME COMMAND. Opening or closing one may not
 * submit an order, consume a turn, or move any persistent state. Nothing here
 * imports a controller, a transport or an engine, and the panel's own group
 * handler does nothing but assign a local ref -- so that guarantee is a fact
 * about what this code CAN reach rather than a behaviour somebody checked.
 *
 * The type carries the other half: `ActionMenuGroup` has no action name on it.
 * There is no field on a group node that `startAction(name)` could be fed, so
 * the mistake is not available to write, let alone to ship.
 *
 * ## What the model does NOT decide
 *
 * Availability. The caller passes the actions it is willing to draw -- already
 * filtered for what the seat may see -- and a group exists only because
 * something in the list named it. So an emptied group is ABSENT by
 * construction, not pruned by a rule that a later edit could forget, and a
 * group's membership can never disagree with the panel's own button list.
 *
 * Executability either. Grouping moves a button; it changes no condition, no
 * `.disabled()` reason and nothing the server validates. A leaf's metadata
 * reaches the panel verbatim, which is why the disabled reason and the help
 * popover keep working inside a group exactly as they do at the root.
 */

/** The part of an action's metadata that decides where its button sits. */
export interface MenuAction {
  readonly name: string;
  /**
   * The menu path this action's start button sits at, outermost first. Absent
   * means the top level, which is where every action sat before #228 and where
   * a game that declares nothing keeps them.
   */
  readonly group?: readonly string[];
  /** Sort key within its level. Absent sorts as `0` -- see `sortKeyOf`. */
  readonly order?: number;
}

/** One action's start button. Not exported: `ActionMenuNode` is the arm a
 *  consumer narrows, and `kind` is what narrows it. */
interface ActionMenuLeaf<A extends MenuAction> {
  readonly kind: 'action';
  /** The metadata verbatim, so a leaf renders exactly as a flat button does. */
  readonly action: A;
}

/**
 * One group's button, and the level it opens.
 *
 * `label` is the group's identity as well as its text: a path is a list of
 * labels, so two actions in one group cannot disagree about what it is called.
 * That is why there is no id to register and no dangling reference to make.
 */
export interface ActionMenuGroup<A extends MenuAction> {
  readonly kind: 'group';
  readonly label: string;
  /** The full path from the root, so a level can be addressed by it. */
  readonly path: readonly string[];
  readonly children: readonly ActionMenuNode<A>[];
}

export type ActionMenuNode<A extends MenuAction> = ActionMenuLeaf<A> | ActionMenuGroup<A>;

/** One rendered level: the nodes in it, and the group it belongs to. */
interface ActionMenuLevel<A extends MenuAction> {
  /** The group whose level this is; `null` at the root. */
  readonly group: ActionMenuGroup<A> | null;
  readonly nodes: readonly ActionMenuNode<A>[];
}

/**
 * WHERE AN UNDECLARED ORDER SORTS.
 *
 * Zero, so a game that orders some of its verbs and not others gets a
 * predictable answer rather than an accident: a negative order is "before
 * everything I did not think about", a positive one is "after". Ties keep the
 * order the actions arrived in, which for an ungrouped game is the availability
 * order the panel has always drawn.
 */
const sortKeyOf = <A extends MenuAction>(action: A): number => action.order ?? 0;

/** A mutable group while the tree is being built. */
interface Building<A extends MenuAction> {
  readonly label: string;
  readonly path: readonly string[];
  readonly children: Slot<A>[];
  readonly groups: Map<string, Building<A>>;
}

/** One entry at a level, with the two keys a level is sorted by. */
interface Slot<A extends MenuAction> {
  readonly arrival: number;
  sortKey: number;
  readonly node: ActionMenuLeaf<A> | Building<A>;
}

const isBuilding = <A extends MenuAction>(
  node: ActionMenuLeaf<A> | Building<A>,
): node is Building<A> => !('kind' in node);

function newLevel<A extends MenuAction>(label: string, path: readonly string[]): Building<A> {
  return { label, path, children: [], groups: new Map() };
}

/**
 * Find or create the group a path names, recording the arrival and sort key of
 * every level it passes through.
 *
 * A GROUP'S SORT KEY IS THE LOWEST ITS MEMBERS ASK FOR, which puts a group
 * where its most important child sits. The alternative -- an order declared on
 * the group itself -- would have to be declared once per member, and two
 * members disagreeing about it is a state this shape simply cannot reach.
 */
function levelFor<A extends MenuAction>(
  root: Building<A>,
  path: readonly string[],
  sortKey: number,
  arrival: number,
): Building<A> {
  let at = root;
  for (const label of path) {
    const existing = at.groups.get(label);
    if (existing) {
      const slot = at.children.find((child) => child.node === existing)!;
      slot.sortKey = Math.min(slot.sortKey, sortKey);
      at = existing;
      continue;
    }
    const made = newLevel<A>(label, [...at.path, label]);
    at.groups.set(label, made);
    at.children.push({ arrival, sortKey, node: made });
    at = made;
  }
  return at;
}

/** Sorted, frozen output for one built level. */
function freeze<A extends MenuAction>(level: Building<A>): readonly ActionMenuNode<A>[] {
  const ordered = [...level.children].sort(
    (a, b) => a.sortKey - b.sortKey || a.arrival - b.arrival,
  );
  return ordered.map((slot) => (isBuilding(slot.node)
    ? {
      kind: 'group' as const,
      label: slot.node.label,
      path: slot.node.path,
      children: freeze(slot.node),
    }
    : slot.node));
}

/**
 * Arrange the actions the panel is willing to draw into its menu tree.
 *
 * With no `group` anywhere this returns the flat list it was given, in the same
 * order, which is how a game that declares nothing keeps the panel it has.
 */
export function buildActionMenu<A extends MenuAction>(
  actions: readonly A[],
): readonly ActionMenuNode<A>[] {
  const root = newLevel<A>('', []);
  actions.forEach((action, arrival) => {
    const sortKey = sortKeyOf(action);
    const level = levelFor(root, action.group ?? [], sortKey, arrival);
    level.children.push({ arrival, sortKey, node: { kind: 'action', action } });
  });
  return freeze(root);
}

/** The group a level's path names, or `null` for the root / a path that has gone. */
function groupAt<A extends MenuAction>(
  nodes: readonly ActionMenuNode<A>[],
  path: readonly string[],
): ActionMenuGroup<A> | null {
  let level = nodes;
  let group: ActionMenuGroup<A> | null = null;
  for (const label of path) {
    const found = level.find(
      (node): node is ActionMenuGroup<A> => node.kind === 'group' && node.label === label,
    );
    if (!found) return null;
    group = found;
    level = found.children;
  }
  return group;
}

/**
 * The deepest prefix of `requested` that is still a group in this tree.
 *
 * THE ANSWER TO "AVAILABILITY CHANGED WHILE A GROUP WAS OPEN". The panel keeps
 * the path the player navigated to and resolves it against the tree on every
 * recompute, so a group that empties under them drops them one level at a time
 * to whichever ancestor still exists -- never into a level that is not there,
 * and never all the way to the root when the parent survived.
 *
 * A leaf's name is not a level: `['build']` resolves to the root, so a path can
 * never address something the panel would then try to draw children for.
 */
export function resolveMenuPath<A extends MenuAction>(
  nodes: readonly ActionMenuNode<A>[],
  requested: readonly string[],
): readonly string[] {
  for (let depth = requested.length; depth > 0; depth -= 1) {
    const prefix = requested.slice(0, depth);
    if (groupAt(nodes, prefix)) return prefix;
  }
  return [];
}

/**
 * The level to draw for a path, resolved first.
 *
 * A path that no longer exists answers the root rather than nothing, because
 * the panel must always have something to draw: an empty level is a prompt with
 * nothing to press, which is the trap `suppressFromActionPanel` already learned.
 */
export function menuLevelAt<A extends MenuAction>(
  nodes: readonly ActionMenuNode<A>[],
  path: readonly string[],
): ActionMenuLevel<A> {
  const group = groupAt(nodes, resolveMenuPath(nodes, path));
  return { group, nodes: group ? group.children : nodes };
}
