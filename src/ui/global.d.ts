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

// Vue single-file component declarations
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// three is an optional peer dependency (used by Die3D) — stub to satisfy vue-tsc
declare module 'three' {
  type Any = any;
  export type Scene = Any;
  export type PerspectiveCamera = Any;
  export type WebGLRenderer = Any;
  export type Mesh = Any;
  export type MeshPhongMaterial = Any;
  export type Vector3 = Any;
  export type CanvasTexture = Any;
  export type Euler = Any;
  export type BufferGeometry = Any;
  export type Quaternion = Any;
  export type Color = Any;
  export type AmbientLight = Any;
  export type DirectionalLight = Any;
  export type Float32BufferAttribute = Any;
  export const Scene: Any;
  export const PerspectiveCamera: Any;
  export const WebGLRenderer: Any;
  export const Mesh: Any;
  export const MeshPhongMaterial: Any;
  export const Vector3: Any;
  export const CanvasTexture: Any;
  export const Euler: Any;
  export const BufferGeometry: Any;
  export const Quaternion: Any;
  export const Color: Any;
  export const AmbientLight: Any;
  export const DirectionalLight: Any;
  export const Float32BufferAttribute: Any;
  export const SRGBColorSpace: Any;
}

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
