declare const __BOARDSMITH_DEV__: boolean | undefined;
declare const __API_URL__: string | undefined;

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
