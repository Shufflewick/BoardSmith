/**
 * Mutation types captured during game.animate() callbacks.
 *
 * These are observations of state changes, not commands to execute.
 * They record what happened so the theatre view can advance state per-event.
 *
 * @module
 */

/**
 * A mutation captured during an animate() callback.
 * Union of all mutation types that can occur inside a scoped callback.
 */
export type CapturedMutation =
  | CreateMutation
  | MoveMutation
  | SetAttributeMutation
  | SetPropertyMutation;

/** An element was created inside the callback */
export interface CreateMutation {
  type: 'CREATE';
  /** Class name of created element */
  className: string;
  /** Name of created element */
  name: string;
  /** ID of parent element */
  parentId: number;
  /** ID assigned to the new element */
  elementId: number;
  /** Initial attributes (if any) */
  attributes?: Record<string, unknown>;
}

/** An element was moved to a different parent */
export interface MoveMutation {
  type: 'MOVE';
  /** ID of moved element */
  elementId: number;
  /** ID of previous parent */
  fromParentId: number;
  /** ID of new parent */
  toParentId: number;
  /** Position in destination */
  position?: 'first' | 'last';
}

/** An element attribute was changed */
export interface SetAttributeMutation {
  type: 'SET_ATTRIBUTE';
  /** ID of element */
  elementId: number;
  /** Attribute name */
  attribute: string;
  /** Previous value */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
}

/** A custom game property was changed */
export interface SetPropertyMutation {
  type: 'SET_PROPERTY';
  /** Property name on the Game instance */
  property: string;
  /** Previous value (deep clone) */
  oldValue: unknown;
  /** New value (deep clone) */
  newValue: unknown;
}

/**
 * Active capture context during an animate() callback.
 * Holds the mutable mutations array that element operations append to.
 */
export interface MutationCaptureContext {
  mutations: CapturedMutation[];
}
