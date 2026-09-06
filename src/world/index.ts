/**
 * `boardsmith/world` -- THE PERSISTENT-WORLD RUNTIME CORE.
 *
 * A persistent world is the other backend. Where a table holds its whole
 * element tree resident, snapshots per action and keeps history, undo, bots and
 * spectators, a world keeps only NAMED PARTITIONS resident, checkpoints what a
 * command dirtied, and drives itself with scheduled events. Same engine, same
 * element tree, different storage and checkpoint policy -- the way two storage
 * engines sit under one database.
 *
 * This module is the part of that runtime that is model-independent: residency
 * bookkeeping, declare-then-run, rollback baselines, dirty-set accumulation,
 * per-seat views, event routing by scope, the drift-free recurrence and keyed
 * schedule semantics, the partition-store contract, the read-only projection a
 * declaration sees, and every way a world can refuse.
 *
 * ## PURE ONLY, and the rule is the same one `boardsmith/persistence` keeps
 *
 * Nothing reachable from this barrel may import `node:fs`, `cloudflare:workers`,
 * `ws`, a socket, or a timer-driven clock. A hosting platform imports it inside
 * a Cloudflare Worker bundle and `boardsmith dev` imports it inside a Node
 * process, and the two must get the same world. TIME ARRIVES AS AN ARGUMENT --
 * a command's stamped `arrivedAt`, a scheduled event's own `due` -- and STORAGE
 * ARRIVES AS AN INTERFACE (`WorldPartitionStore`, `WorldPartitionWriter`). A
 * world that read a clock would compute a different state depending on how busy
 * its host was; one that opened a file could not run in a Worker at all.
 *
 * ## What is NOT here, and why
 *
 * Every host's own lifecycle policy. Sockets and transport, hibernation and
 * eviction timing, rate limits, presence ledgers, dead letters, ejection, the
 * park ladder, and the CPU budget one drain may spend holding a world lock.
 * Those are answers about a place: a laptop with one browser tab and a Durable
 * Object holding 500 sockets answer them differently and should. What they must
 * NOT answer differently is what a world IS, which is what this module is.
 *
 * ## Budgets are parameters, not constants
 *
 * `worldBudgets()` carries the defaults and a host overrides what it needs.
 * Nothing in here reads a ceiling it was not passed, because a ceiling read
 * rather than passed is one two hosts can silently disagree about -- and a
 * laptop running different budgets from production makes a game's local
 * behaviour a poor guide to its published behaviour.
 */
export * from './budgets.js';
export * from './refusals.js';
export * from './contract.js';
export * from './partition-store.js';
export * from './declaration.js';
export * from './readonly.js';
export * from './schedule.js';
export * from './schedule-api.js';
export * from './engine.js';
export * from './runner.js';
export * from './definition.js';
