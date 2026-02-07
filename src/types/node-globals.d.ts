// Ambient declarations for Node.js globals used in isomorphic code.
// These allow consumer projects to compile BoardSmith source without @types/node.
// All usages are behind `typeof` guards, so they're safe in browser contexts.
//
// Uses the NodeJS namespace pattern so declarations MERGE with @types/node when
// present (in BoardSmith repo) rather than conflicting, and provide standalone
// types when absent (in consumer games).

declare namespace NodeJS {
  interface Process {
    env: Record<string, string | undefined>;
  }
}
declare var process: NodeJS.Process;
declare function setImmediate(callback: (...args: any[]) => void, ...args: any[]): any;
