# Technology Stack

**Analysis Date:** 2026-01-08

## Languages

**Primary:**
- TypeScript 5.7.0 (strict mode) - All application code

**Secondary:**
- JavaScript - Config files (`vite.config.ts`, `vitest.config.ts`)

## Runtime

**Environment:**
- Node.js >= 20 (ES2022 target)
- Browser (ES2022, Vue 3 components)
- Cloudflare Workers (Durable Objects runtime)

**Package Manager:**
- pnpm (monorepo with workspaces)
- Lockfile: `pnpm-lock.yaml` present
- Workspace config: `pnpm-workspace.yaml`

## Frameworks

**Core:**
- Vue.js 3.5.25 - UI components (`packages/ui/`)
- Three.js 0.160.1 - 3D dice rendering (`packages/ui/src/components/dice/`)
- Express 4.22.1 - Local development server (`packages/cli/`)

**Testing:**
- Vitest 2.1.9 - Unit and integration tests
- Playwright 1.57.0 - E2E testing
- Puppeteer 24.33.0 - Browser automation (AI training)

**Build/Dev:**
- Vite 5.4.21 - Development server and bundling
- esbuild 0.24.2 - Fast TypeScript compilation
- TypeScript 5.7.0 - Type checking and compilation
- @vitejs/plugin-vue 5.0.0 - Vue SFC compilation
- vite-plugin-dts 3.0.0 - TypeScript declaration generation

## Key Dependencies

**Critical:**
- better-sqlite3 11.0.0 - Embedded database for game persistence
- ws 8.18.3 - WebSocket communication for real-time gameplay
- commander 12.1.0 - CLI framework for `boardsmith` command

**Infrastructure:**
- @cloudflare/workers-types 4.20241127.0 - Cloudflare Workers runtime
- chokidar 3.6.0 - File watching for hot reload
- chalk 5.6.2 - Terminal output styling
- ora 8.2.0 - CLI spinners and progress
- prompts 2.4.2 - Interactive CLI prompts

**UI:**
- vue 3.5.25 - Reactive UI framework
- three 0.160.1 - 3D graphics (dice animations)

## Configuration

**Environment:**
- No .env files required (platform-agnostic design)
- Runtime configuration via CLI flags and `boardsmith.json`
- Cloudflare Workers environment via `Env` interface

**Build:**
- `tsconfig.json` - Root TypeScript configuration (strict mode)
- `vite.config.ts` - Vite build configuration
- `vitest.config.ts` - Test runner configuration
- Package-level `tsconfig.json` files extend root config

**Game Config:**
- `boardsmith.json` - Per-game metadata (name, players, description)

## Platform Requirements

**Development:**
- macOS/Linux/Windows (any platform with Node.js >= 20)
- pnpm installed globally
- No external services required (SQLite embedded)

**Production:**
- Option 1: Cloudflare Workers (Durable Objects + KV)
- Option 2: Self-hosted Node.js with Express
- WebSocket support required for real-time gameplay

---

*Stack analysis: 2026-01-08*
*Update after major dependency changes*
