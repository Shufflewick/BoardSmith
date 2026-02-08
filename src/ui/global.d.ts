declare const __BOARDSMITH_DEV__: boolean | undefined;
declare const __API_URL__: string | undefined;

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
