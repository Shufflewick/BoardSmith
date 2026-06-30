# Phase 38: target-integration - Context

**Gathered:** 2026-01-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `--target` flag to `boardsmith pack` that copies tarballs to a consumer project and updates its package.json with file: dependencies. The target project should be able to run `npm install` successfully after.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User deferred all implementation decisions to Claude. The following areas are open:

- **Vendor directory structure** — Where tarballs go, organization, cleanup of old versions
- **package.json modification** — How to update dependencies, backup strategy, handling existing file: deps
- **Error handling & recovery** — Target validation, parse failures, partial write recovery
- **Output & feedback** — Progress indication, success summary, verbosity

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 38-target-integration*
*Context gathered: 2026-01-18*
