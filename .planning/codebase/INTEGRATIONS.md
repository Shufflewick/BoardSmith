# External Integrations

**Analysis Date:** 2026-01-08

## APIs & External Services

**Payment Processing:**
- Not applicable - BoardSmith is a game framework, not a commercial service

**Email/SMS:**
- Not applicable

**External APIs:**
- No external API integrations - platform-agnostic by design
- All communication is internal (client ↔ server)

## Data Storage

**Databases:**
- SQLite via better-sqlite3 11.0.0 - Embedded game state persistence
  - Connection: Local file (`.boardsmith/games.db`)
  - Tables: `games` (game_id, state_json, updated_at)
  - Client: Direct better-sqlite3 API
  - Location: `packages/server/src/stores/sqlite-games.ts`, `packages/server/src/stores/sqlite-storage.ts`

**File Storage:**
- Cloudflare Durable Objects - Production game state
  - Client: Workers runtime API
  - Location: `packages/worker/src/index.ts`
- Browser localStorage - Audio preferences only
  - Keys: `boardsmith-audio-enabled`, `boardsmith-audio-volume`
  - Location: `packages/client/src/audio.ts`

**Caching:**
- In-memory game store for development
  - Location: `packages/server/src/stores/in-memory-games.ts`
- Cloudflare KV - Matchmaking queue in production
  - Location: `packages/worker/src/index.ts`

## Authentication & Identity

**Auth Provider:**
- None - Games use position-based player identification
- No user accounts required

**OAuth Integrations:**
- None

## Monitoring & Observability

**Error Tracking:**
- None (console logging only)

**Analytics:**
- None

**Logs:**
- stdout/stderr only
- No structured logging service

## CI/CD & Deployment

**Hosting:**
- Cloudflare Workers - Production deployment target
  - Durable Objects for game state
  - KV for matchmaking
- Local Express server for development
  - Location: `packages/cli/src/commands/dev.ts`

**CI Pipeline:**
- Not detected - manual deployment via `boardsmith publish`

## Environment Configuration

**Development:**
- Required env vars: None (all config via CLI flags)
- Secrets location: None required
- Mock/stub services: In-memory game store, embedded SQLite

**Staging:**
- Not applicable (local development → Cloudflare Workers)

**Production:**
- Secrets management: Cloudflare Workers environment variables
- Configuration: `wrangler.toml` for Cloudflare deployment

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Platform Adapters

BoardSmith uses adapter patterns to remain platform-agnostic:

**GameStore Interface:**
- `InMemoryGameStore` - Development, testing
- `SqliteGameStore` - Local persistence with `--persist` flag
- Cloudflare Durable Objects - Production

**BroadcastAdapter Interface:**
- WebSocket-based broadcasting to connected clients
- Factory pattern for custom implementations
- Location: `packages/session/src/game-session.ts`

**Storage Adapters:**
- `packages/server/src/stores/sqlite-storage.ts`
- `packages/server/src/stores/in-memory-games.ts`

## Internal Communication

**WebSocket (ws 8.18.3):**
- Real-time game state updates
- Auto-reconnect with ping/pong heartbeat
- Message types: `action`, `ping`, `getState`
- Client: `packages/client/src/game-connection.ts`
- Server: `packages/cli/src/commands/dev.ts`

**HTTP/REST:**
- Game creation, matchmaking, state queries
- JSON request/response format
- Endpoints: `/games`, `/matchmaking`, `/health`, `/games/:gameId/action`
- Server core: `packages/server/src/core.ts`
- Client: `packages/client/src/client.ts`

---

*Integration audit: 2026-01-08*
*Update when adding/removing external services*
