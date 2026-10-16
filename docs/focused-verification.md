# Focused ticket verification

Repositories that opt into authored tests per ticket can use the exact-selection
runner in a library workspace or a game:

```sh
boardsmith test --selection .agent-policy-tests.json
```

The JSON selection identifies the ticket, the full commit where its work started,
and exact files and full test names. Nested `describe` titles precede the test
title, separated by spaces:

```json
{
  "ticket": "Owner/repo#123",
  "base": "<full base commit ID>",
  "tests": [
    { "file": "tests/deal.test.ts", "names": ["dealing gives each player a hand"] }
  ]
}
```

The runner preserves the project's test configuration and accepts only declared
cases reported as passed. An empty selection, missing file, missing name, skipped
case or interrupted run fails. `--selection` cannot be combined with filename
filters, watch mode, browser regressions or coverage. Library runs still
typecheck first. This command can consume an uncommitted selection while writing
tests.

A game's chunk work does not use a selection: `boardsmith verify --chunk <slug>`
picks the chunk's own tests itself (see
[Before you call a change done](./getting-started.md#before-you-call-a-change-done-boardsmith-verify)).

The runner lives in `src/cli/lib/authored-tests.ts`:
`runAuthoredTests(projectDir, selectionPath)` runs the current selection and
returns its declaration and passing counts.
