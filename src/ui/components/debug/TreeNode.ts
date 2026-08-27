/**
 * One row of the debug panel's State tab, and its children (#41).
 *
 * A render-function component rather than an SFC because it recurses into
 * itself to an unknown depth, and because scoped CSS does not reach a render
 * function's output — every rule it needs is inline here.
 *
 * It carries no state of its own: which paths are open is decided by whoever
 * mounts it and handed down through `expandedPaths`, so the whole tree opens
 * and closes from one set.
 *
 * @module
 */
import { defineComponent, h, type PropType } from 'vue';
import { formatValue, getTypeColor, isExpandable } from './debug-format.js';

// Scoped CSS does not apply to a render function's output, so the styling lives
// inline. `.tree-copy-btn` and `.tree-row` still carry class names because the
// panel's own stylesheet and its tests address them.
const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 4px',
    borderRadius: '3px',
    cursor: 'default',
  },
  rowExpandable: {
    cursor: 'pointer',
  },
  arrow: {
    color: 'var(--bsg-ink-3)',
    fontSize: '10px',
    width: '12px',
    textAlign: 'center' as const,
  },
  arrowPlaceholder: {
    width: '12px',
  },
  key: {
    color: 'var(--bsg-accent-2)',
    fontWeight: '500' as const,
  },
  separator: {
    color: 'var(--bsg-ink-3)',
  },
  value: {
    marginLeft: '4px',
  },
  copyBtn: {
    opacity: '0',
    marginLeft: 'auto',
    padding: '2px 6px',
    fontSize: '10px',
    background: 'var(--bsg-surface-3)',
    border: '1px solid var(--bsg-line-2)',
    borderRadius: '3px',
    color: 'var(--bsg-ink-2)',
    cursor: 'pointer',
  },
  children: {
    marginLeft: '16px',
    borderLeft: '1px solid var(--bsg-line)',
    paddingLeft: '8px',
  },
};

/** Reveal or hide the row's copy button as the pointer crosses the row. */
function setCopyButtonOpacity(e: MouseEvent, opacity: string): void {
  const btn = (e.currentTarget as HTMLElement).querySelector('.tree-copy-btn') as HTMLElement | null;
  if (btn) btn.style.opacity = opacity;
}

export const TreeNode = defineComponent({
  name: 'TreeNode',
  props: {
    /** The property name this row stands for. */
    nodeKey: { type: String, required: true },
    /** The value at that property. */
    value: { type: null, required: true },
    /** Dotted path from the tree's root, e.g. `root.state.view`. */
    path: { type: String, required: true },
    depth: { type: Number, default: 0 },
    /** Every open path in the whole tree, owned by the mounting component. */
    expandedPaths: { type: Object as PropType<Set<string>>, required: true },
    /**
     * The paths the State tab's search left standing, or null when no search is
     * running and every row shows. A row outside this set renders nothing at
     * all, itself included.
     */
    visiblePaths: { type: Object as PropType<Set<string> | null>, default: null },
  },
  emits: {
    /** The reader clicked an expandable row. Carries that row's path. */
    toggle: (path: string) => typeof path === 'string',
    /** The reader clicked the row's copy button. Carries that row's value. */
    copy: (_value: unknown) => true,
  },
  setup(props, { emit }) {
    const isExpanded = () => props.expandedPaths.has(props.path);
    const expandable = () => isExpandable(props.value);

    const handleToggle = () => {
      if (expandable()) emit('toggle', props.path);
    };

    const handleCopy = (e: Event) => {
      e.stopPropagation();
      emit('copy', props.value);
    };

    const isVisible = (path: string) => !props.visiblePaths || props.visiblePaths.has(path);

    return () => {
      if (!isVisible(props.path)) return null;

      const children: unknown[] = [];

      const rowStyle = expandable() ? { ...styles.row, ...styles.rowExpandable } : styles.row;

      const rowChildren = [
        expandable()
          ? h('span', { style: styles.arrow }, isExpanded() ? '▼' : '▶')
          : h('span', { style: styles.arrowPlaceholder }),
        h('span', { style: styles.key }, props.nodeKey),
        h('span', { style: styles.separator }, ':'),
        h('span', { style: { ...styles.value, color: getTypeColor(props.value) } }, formatValue(props.value)),
        h('button', {
          class: 'tree-copy-btn',
          style: styles.copyBtn,
          onClick: handleCopy,
          title: 'Copy JSON',
          'aria-label': 'Copy JSON to clipboard',
        }, h('span', { 'aria-hidden': 'true' }, '⎘')),
      ];

      children.push(
        h('div', {
          class: 'tree-row',
          style: rowStyle,
          onClick: handleToggle,
          onMouseenter: (e: MouseEvent) => setCopyButtonOpacity(e, '1'),
          onMouseleave: (e: MouseEvent) => setCopyButtonOpacity(e, '0'),
        }, rowChildren)
      );

      if (expandable() && isExpanded() && props.value) {
        const childNodes = Object.entries(props.value as Record<string, unknown>)
          .filter(([childKey]) => isVisible(`${props.path}.${childKey}`))
          .map(([childKey, childValue]) =>
            h(TreeNode, {
              key: childKey,
              nodeKey: childKey,
              value: childValue,
              path: `${props.path}.${childKey}`,
              depth: props.depth + 1,
              expandedPaths: props.expandedPaths,
              visiblePaths: props.visiblePaths,
              onToggle: (p: string) => emit('toggle', p),
              onCopy: (v: unknown) => emit('copy', v),
            })
          );
        children.push(h('div', { style: styles.children }, childNodes));
      }

      return h('div', {}, children as never);
    };
  },
});
