---
created: 2026-07-28
title: "boardsmith.json's stub description/playtime ownership after init is unstated"
area: bs- skills / ingest
severity: low
files:
  - src/cli/slash-command/bs/build/scaffold.md
  - src/cli/slash-command/bs/build/ingest.md
---

## Problem

Carried in from `170-PROOF-RUN-2.md` finding F-3, filed here per `171-07-PLAN.md`'s explicit
instruction (this belongs to no PROV requirement in Phase 171, and is not fixed by it).

`boardsmith init` scaffolds `boardsmith.json` with stub `description` ("A fun game for 2-4
players") and a placeholder `playtime`. Two separate live `/bs-ingest-rules` runs against the
same reference game (`seven`) made **opposite** scope calls on whether a later ingest step should
correct those stub fields to match the transcribed rulebook:

- Run 1's session flagged the mismatch (rulebook states 1-7 players, stub says 2-4) and
  **declined** to touch `boardsmith.json`, reasoning it was outside its step's scope.
- Run 2's session, facing the same mismatch, **corrected** `description` and `playtime` to match
  the rulebook and reported the change.

Both decisions were internally reasoned and neither is obviously wrong — the disagreement itself
is the defect: no skill text says who owns `boardsmith.json`'s stub fields after `init`, or
which step (if any) is responsible for reconciling them against a freshly-ingested rulebook.

## Proposed direction (not decided)

Either:
1. Make `init`'s scaffold step explicitly own these fields until a named later step updates them
   (and name that step), or
2. Make the ingest step explicitly responsible for reconciling `description`/`playtime` against
   the transcribed rulebook, with the correction recorded like any other ingest side-effect.

Whichever is chosen, state it in the owning skill text so two live sessions can no longer make
opposite scope calls on the same file for the same reason.

## Not in scope for Phase 171

`171-CONTEXT.md`'s "Deferred / Carried In" section is explicit: F-3 "is not PROV work; file as a
todo." No PROV-01/02/03 requirement touches `boardsmith.json`.
