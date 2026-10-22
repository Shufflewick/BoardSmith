// vitest.config.ts loads a `.md` file as its text, so a test imports the Markdown it reads (#1370).
declare module '*.md' {
  const text: string;
  export default text;
}
