declare const __BOARDSMITH_DEV__: boolean | undefined;
declare const __API_URL__: string | undefined;

interface BoardsmithDevtools {
  /** Returns the perspective-aware game state for the given seat (or the current seat if omitted). */
  getState(seat?: number): unknown | null;
  /** Returns the list of available action names for the given seat. */
  getAvailableActions(seat?: number): string[];
  /** Returns action metadata (labels, help text, selection config) for the given seat. */
  getActionMetadata(seat?: number): Record<string, unknown> | undefined;
  /** Returns current board-interaction state: active action, selection step, and valid element IDs. */
  getBoardInteractionState(): { activeAction: string | null; currentSelectionStep: number; validElements: number[] } | null;
  /** Returns the serialized flow-position snapshot (FLOW-01), or null when none has been received yet. */
  getFlowDebugInfo(seat?: number): unknown | null;
  /** Returns this seat's own pending multi-step action snapshot (FLOW-03), or null when none is in progress. */
  getPendingAction(seat?: number): unknown | null;
}

interface Window {
  /** Dev-only global exposed by the `boardsmith dev` host page. Absent in production builds. */
  __BOARDSMITH_DEVTOOLS?: BoardsmithDevtools;
}

interface BoardsmithActionResolvedDetail {
  action: string;
  success: boolean;
  seat: number;
  error?: string;
}

// NO `declare module '*.vue'` here — deliberately, and do not add one back.
//
// This file is ambient, and `boardsmith/ui` resolves to raw TypeScript source,
// so anything declared here leaks into the compilation of EVERY game. A
// `*.vue` shim therefore typed every SFC in every project as
// `DefineComponent<object, object, unknown>`, which:
//
//   1. erased all prop type-checking everywhere (any bogus prop was accepted);
//   2. bound each game's own SFC types to BOARDSMITH's copy of vue, because
//      the shim's `import type { DefineComponent } from 'vue'` resolves from
//      here. A game's `createApp` (its own vue) then received a component
//      typed by our vue, and the moment the two versions stopped being
//      structurally identical that failed with TS2321 "Excessive stack depth"
//      + TS2345 — pinning every game's vue as the only workaround;
//   3. hid real type errors inside our own components.
//
// SFCs are type-checked by `vue-tsc` instead (see validate.ts), which compiles
// them for real: props are checked, and each file's `vue` resolves from its own
// location, so games can upgrade vue freely.

// Asset type declarations
declare module '*.mp3' {
  const src: string;
  export default src;
}

declare module '*.wav' {
  const src: string;
  export default src;
}

declare module '*.ogg' {
  const src: string;
  export default src;
}
