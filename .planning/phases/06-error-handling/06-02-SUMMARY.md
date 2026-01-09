# Summary: Add JSON.parse error handling in sqlite-storage

SqliteStorageAdapter.load() now catches JSON.parse exceptions, logs with gameId context, and returns null instead of crashing the server.

## Tasks Completed

- [x] Task 1: Add try/catch around JSON.parse in load() (`1cd6a81`)
- [x] Task 2: Verify build passes (no commit needed)

## Files Modified

- packages/server/src/stores/sqlite-storage.ts

## Verification Checklist

- [x] JSON.parse is wrapped in try/catch
- [x] Error is logged with gameId for context
- [x] Returns null on parse failure (not throwing)
- [x] Build passes

## Deviations

None

## Performance

- Start: 2026-01-09T01:16:47Z
- End: 2026-01-09T01:17:30Z
- Duration: ~43 seconds
