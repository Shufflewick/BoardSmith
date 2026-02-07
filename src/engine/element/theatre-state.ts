/**
 * Theatre state mutation applicators and JSON tree helpers.
 *
 * This module operates on plain ElementJSON objects (no Game instances, no class
 * registries, no side effects). Functions mutate the passed snapshot in place,
 * advancing it one mutation at a time.
 *
 * This is the mechanical core of the theatre state engine. The Game class
 * (Plan 02) will wire these functions into animate() / acknowledgeAnimationEvents()
 * to maintain a snapshot that reflects only acknowledged events.
 *
 * @module
 */

import type {
  CapturedMutation,
  CreateMutation,
  MoveMutation,
  SetAttributeMutation,
  SetPropertyMutation,
} from './mutation-capture.js';
import type { ElementJSON } from './types.js';

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/**
 * Recursive depth-first search for an element by ID in an ElementJSON tree.
 * Returns the matching node or undefined.
 */
export function findElementById(node: ElementJSON, id: number): ElementJSON | undefined {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Search all nodes for a child with the given ID.
 * If found, splice it from the parent's children array and return it.
 * If not found, return undefined.
 */
export function removeElementFromParent(root: ElementJSON, elementId: number): ElementJSON | undefined {
  function searchAndRemove(node: ElementJSON): ElementJSON | undefined {
    if (!node.children) return undefined;
    const index = node.children.findIndex(c => c.id === elementId);
    if (index !== -1) {
      return node.children.splice(index, 1)[0];
    }
    for (const child of node.children) {
      const found = searchAndRemove(child);
      if (found) return found;
    }
    return undefined;
  }
  return searchAndRemove(root);
}

// ---------------------------------------------------------------------------
// Mutation applicators (all mutate the snapshot in place)
// ---------------------------------------------------------------------------

/**
 * Apply a MOVE mutation: remove element from current parent,
 * add to destination parent.
 *
 * If the destination parent is NOT found in the snapshot, the element is being
 * removed from play (e.g. moved to the pile). The element is simply removed
 * and not re-added anywhere.
 */
export function applyMoveMutation(snapshot: ElementJSON, mutation: MoveMutation): void {
  const element = removeElementFromParent(snapshot, mutation.elementId);
  if (!element) return; // Element not found (edge case: already moved)

  const dest = findElementById(snapshot, mutation.toParentId);
  if (!dest) return; // Destination not in snapshot -- element removed from play

  if (!dest.children) dest.children = [];
  if (mutation.position === 'first') {
    dest.children.unshift(element);
  } else {
    dest.children.push(element);
  }
}

/**
 * Apply a CREATE mutation: add a new element to the parent's children.
 */
export function applyCreateMutation(snapshot: ElementJSON, mutation: CreateMutation): void {
  const parent = findElementById(snapshot, mutation.parentId);
  if (!parent) return; // Edge case: parent not found

  if (!parent.children) parent.children = [];
  parent.children.push({
    className: mutation.className,
    id: mutation.elementId,
    name: mutation.name,
    attributes: mutation.attributes ? { ...mutation.attributes } : {},
  });
}

/**
 * Apply a SET_ATTRIBUTE mutation: update an element's attribute value.
 */
export function applySetAttributeMutation(snapshot: ElementJSON, mutation: SetAttributeMutation): void {
  const element = findElementById(snapshot, mutation.elementId);
  if (!element) return; // Element not found

  element.attributes[mutation.attribute] = mutation.newValue;
}

/**
 * Apply a SET_PROPERTY mutation: update a game-level custom property.
 *
 * Game custom properties live in `snapshot.attributes` (from GameElement.toJSON()).
 * This always applies to the ROOT snapshot, not a child element.
 */
export function applySetPropertyMutation(snapshot: ElementJSON, mutation: SetPropertyMutation): void {
  snapshot.attributes[mutation.property] = mutation.newValue;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Apply a single mutation to the snapshot, dispatching by mutation type.
 */
export function applyMutation(snapshot: ElementJSON, mutation: CapturedMutation): void {
  switch (mutation.type) {
    case 'MOVE':
      applyMoveMutation(snapshot, mutation);
      break;
    case 'CREATE':
      applyCreateMutation(snapshot, mutation);
      break;
    case 'SET_ATTRIBUTE':
      applySetAttributeMutation(snapshot, mutation);
      break;
    case 'SET_PROPERTY':
      applySetPropertyMutation(snapshot, mutation);
      break;
  }
}

/**
 * Apply an ordered array of mutations to the snapshot.
 */
export function applyMutations(snapshot: ElementJSON, mutations: CapturedMutation[]): void {
  for (const mutation of mutations) {
    applyMutation(snapshot, mutation);
  }
}
