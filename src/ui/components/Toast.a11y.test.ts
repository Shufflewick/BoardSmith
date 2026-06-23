// @vitest-environment jsdom
/**
 * Accessibility assertions for Toast.vue (101-05-PLAN.md Task 3).
 *
 * Toast uses <Teleport to="body">, so we query document.body directly
 * rather than the wrapper's element tree.
 *
 * Covers:
 *  - role=status on non-error toasts; role=alert on error toasts
 *  - A real <button aria-label="Dismiss"> is rendered per toast
 *  - Clicking the button calls remove(toast.id)
 *  - Clicking the toast body does NOT call remove (only the button does)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, readonly } from 'vue';
import Toast from './Toast.vue';

// ── useToast mock ─────────────────────────────────────────────────────────────
const mockRemove = vi.fn();

const mockToasts = ref([
  { id: 1, message: 'It worked', type: 'success', duration: 2000 },
  { id: 2, message: 'Heads up', type: 'info', duration: 2000 },
  { id: 3, message: 'Warning!', type: 'warning', duration: 3000 },
  { id: 4, message: 'Something failed', type: 'error', duration: 4000 },
]);

vi.mock('../composables/useToast', () => ({
  useToast: () => ({
    toasts: readonly(mockToasts),
    remove: mockRemove,
  }),
}));

beforeEach(() => {
  mockRemove.mockReset();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function allToastEls(): Element[] {
  // Teleported toasts land in document.body, not the wrapper tree
  return Array.from(document.querySelectorAll('.toast'));
}

function toastWithText(text: string): Element | undefined {
  return allToastEls().find(el => el.textContent?.includes(text));
}

// ── role mapping ──────────────────────────────────────────────────────────────

describe('Toast a11y — role mapping', () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    wrapper = mount(Toast, { attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders success toast with role="status"', () => {
    const el = toastWithText('It worked');
    expect(el).toBeDefined();
    expect(el!.getAttribute('role')).toBe('status');
  });

  it('renders info toast with role="status"', () => {
    const el = toastWithText('Heads up');
    expect(el).toBeDefined();
    expect(el!.getAttribute('role')).toBe('status');
  });

  it('renders warning toast with role="status"', () => {
    const el = toastWithText('Warning!');
    expect(el).toBeDefined();
    expect(el!.getAttribute('role')).toBe('status');
  });

  it('renders error toast with role="alert"', () => {
    const el = toastWithText('Something failed');
    expect(el).toBeDefined();
    expect(el!.getAttribute('role')).toBe('alert');
  });
});

// ── dismiss button ────────────────────────────────────────────────────────────

describe('Toast a11y — dismiss button', () => {
  let wrapper: ReturnType<typeof mount>;

  beforeEach(() => {
    wrapper = mount(Toast, { attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders a button[aria-label="Dismiss"] per toast', () => {
    const dismissButtons = document.querySelectorAll('button[aria-label="Dismiss"]');
    // One button per toast (4 toasts in mock)
    expect(dismissButtons.length).toBe(4);
  });

  it('calls remove(id) when the dismiss button is clicked', async () => {
    // Find the dismiss button inside the first toast (id=1, "It worked")
    const firstToast = toastWithText('It worked')!;
    const dismissBtn = firstToast.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    dismissBtn.click();
    expect(mockRemove).toHaveBeenCalledWith(1);
  });

  it('does NOT call remove when clicking the toast body (only the dismiss button dismisses)', async () => {
    const toasts = allToastEls();
    expect(toasts.length).toBeGreaterThan(0);
    // Click on the toast container div (not a button inside)
    (toasts[0] as HTMLElement).click();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
