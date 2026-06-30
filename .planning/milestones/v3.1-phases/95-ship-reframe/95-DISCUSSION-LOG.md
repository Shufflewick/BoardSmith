# Phase 95: Ship & Reframe - Discussion Log

> **Audit trail only.** Not consumed by downstream agents — decisions are in CONTEXT.md.

**Date:** 2026-06-21
**Phase:** 95-ship-reframe
**Areas discussed:** Default UI, Export mechanism, Custom stub, Dev peek

---

## Default UI for a new scaffold (SHIP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-UI by default | New game opens in auto-UI, custom slot empty/ready. | ✓ |
| Prompt at creation | Scaffold asks auto vs custom up front. | |

**User's choice:** Auto-UI by default

---

## Single-UI export mechanism (SHIP-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Import-convention (§0 C5) | Entry statically imports only the chosen UI; tree-shaking drops the rest; no config. | |
| boardsmith.json "ui" field | Config names the chosen UI; build resolves it. | ✓ |

**User's choice:** boardsmith.json "ui" field
**Notes:** DIVERGES from §0's "no config" suggestion. Reconciliation: config must resolve to a SINGLE static
import so SHIP-02's tree-shaking guarantee holds (no runtime registry, no rollupOptions.input). Recorded in CONTEXT D-02.

---

## Custom-UI stub in scaffold (SHIP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Empty custom-UI stub | Scaffold generates a "start here" stub; auto-UI renders until filled. | ✓ |
| Auto-only, no stub | No custom file; author creates from scratch. | |

**User's choice:** Empty custom-UI stub

---

## Dev-time auto-UI peek (§0 C5c)

| Option | Description | Selected |
|--------|-------------|----------|
| Strict single-UI | dev shows the chosen UI only; no switcher/peek (honors C5c deferral). | ✓ |
| ?ui=auto escape hatch | URL param previews auto-UI in dev. | |

**User's choice:** Strict single-UI

## Claude's Discretion

- boardsmith.json "ui" schema, stub contents, reframe wording, dev/build resolution of "ui".

## Deferred Ideas

- Cross-repo migration → Phase 96; N-UI live switcher → later; auto-eject (S10) → later.
