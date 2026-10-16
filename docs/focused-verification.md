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

A game can record focused verification after committing its implementation and
selection. Its committed `.agent-policy.json` must explicitly opt in:

```json
{
  "verify": [{ "name": "full", "run": "npx boardsmith verify --base {changeBase}" }],
  "focused": {
    "selection": ".agent-policy-tests.json",
    "fullEvery": 5,
    "verify": [
      { "name": "authored-tests", "run": "npx boardsmith verify --selection .agent-policy-tests.json" }
    ]
  }
}
```

```sh
boardsmith verify --chunk deal --selection .agent-policy-tests.json
boardsmith verify --check --chunk deal
boardsmith review-gate deal
```

The game receipt contains only `test` and `typecheck` checks. Its
`scope.kind` is `focused`; `scope.selection` records the path, SHA-256 of the
committed manifest, ticket, base and selected tests. Selected files must be
committed regular files with an authored change since that base. The base must
be in the verified commit's history. The tree must be clean before and after
verification. `--check` revalidates the committed policy and selection binding.

The review brief identifies authored-test scope and deferred full-suite, build,
validate, smoke and mutation checks. A focused receipt covers the named ticket's
selection; it does not claim mutation coverage of the entire chunk. Plain
`boardsmith verify` keeps its existing full checks. `agent-policy` owns the
five-ticket closure counter and the mandatory full-run deadline.

The build and merge workflow follows
[`state-machine.md`'s Focused Verification Policy](../src/cli/slash-command/bs/state-machine.md#focused-verification-policy).
That section is the authority for conditional standalone checks, combined-tree authored tests,
honest shared-file evidence and the `agent-policy` full-run deadline. Projects without an
explicit committed opt-in keep their existing full workflow and sign-off gates.

For a review backed by a focused receipt, the run log records both
`Verify: <commit> passed` and `Scope: focused <selection SHA-256>`, as
`review-gate` prints them. The ledger checker refuses a missing or mismatched
scope when the receipt is available. Existing full-run review records keep their
current format; an explicit `Scope: full` is also accepted.

The shared CLI helpers live in `src/cli/lib/authored-tests.ts`:

- `runAuthoredTests(projectDir, selectionPath)` runs the current selection and
  returns its declaration and passing counts. It requires no policy opt-in.
- `focusedSelectionPath(projectDir, revision = 'HEAD')` discovers the committed
  policy's selection path. It returns `undefined` for projects without an opt-in
  and rejects malformed focused configuration.
- `focusedVerificationScope(projectDir, selectionPath, revision = 'HEAD')`
  authorizes and hashes the manifest committed at a pinned revision, validates
  its authored files and base, and requires the current manifest to match it.
  It writes no receipt and does not assert that the current tree is clean. Merge
  gates can use it before running the actual authored tests on a prospective
  merged tree, including citation renumbering in test files.
