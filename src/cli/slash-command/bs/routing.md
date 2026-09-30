# Routing: Which Role Does the Work, and When Review May Start

The one authority, shared by every `bs-` skill, for who a piece of work is dispatched to, when a
review of it may start, and what happens when it fails. Every other file cites this one and does
not restate it.

Two facts shaped it. Building a real game, about two thirds of the tokens went to model reviewers
re-running checks that need no model (the suite, typecheck, build, validate, and breaking code to
see whether a test notices), over two to seven review rounds per chunk. And agents that reported
"done" or "all green" were often wrong, which only a run of those checks caught. So the checks run
as code (`boardsmith verify`), review starts only once they pass, and the reviewer is told they did.

## The Roles

The skills name roles, never models. A project decides which agent does each role (below).

| Role | What it does |
|------|--------------|
| `mechanical` | Bulk edits applied the same way across files (a rename, a settled ruling applied to every call site, citations updated after a renumber), searches ("where is this used"), summaries of logs or files. Work a machine can check. |
| `bounded` | Implementation where failing tests already say what done is: a chunk's `build` step, after `spec` observed its tests failing. |
| `judgement` | `spec`, `investigate`, the red team, the fidelity lens, the cross-chunk lens, whole chunks, and anything touching a ruling or the rulebook's meaning. |
| `review` | The review of finished work, run once `boardsmith verify` has passed for it: the audit's visibility, undo and constraints lenses, the design review, and the final-acceptance pass. |
| `second-opinion` | An independent second reading of work the `judgement` role also does: `/bs-verify-game`'s second enumerator. Its value is that it is not the same agent, so `boardsmith validate` refuses a mapping that sends it and `judgement` to the same agent type, and its default agent runs on a different model family from `bs-judgement`'s. |

The mechanical checks need no agent at all. The session that needs one runs it itself:
`boardsmith verify`, `test-step-check`, `chunk-check`, `ledger-check`, `claim-quote-check`,
`constraint-check`, `parallel-check`, `chunk-merge` and `review-gate`.

## Which Agent a Role Is Dispatched As

Before every dispatch, ask the project:

```bash
npx boardsmith agent <role>
```

It prints `<role>: <agent type>`. Dispatch with the Agent tool as exactly that agent type, never a
generic agent and never a model named in the prompt. The type is the one the project's
`boardsmith.json` maps the role to, for example `"agents": { "judgement": "senior", "review":
"reviewer" }`, or else BoardSmith's own `bs-<role>` agent, which `boardsmith claude` installs with
a sensible default model and effort. Nothing is detected or guessed: the mapping is what the project
says, or the default. A refusal (a mapping `boardsmith validate` would also refuse, or a `bs-`
agent that is not installed) says what to fix; fix it before dispatching anything.

## Every Dispatch Prompt Starts With the Work Package

The first line of every dispatch prompt, in every `bs-` skill, is:

```
Work package: <id>
```

For chunk work the id is the chunk's slug, for every step of it and every reviewer of it. Work
outside a chunk uses the skill's name: `ingest-rules`, `verify-game`. A dispatch template in these
files that begins `Work package: {slug}` already carries it; a template that begins otherwise gets
the line added above its first line, and the rest of the template follows unchanged (a handshake
token such as `BS-DISPATCH-V3` still comes first after it).

## Which Role Each Step Uses

| Work | Role | A review step? |
|------|------|----------------|
| A whole chunk dispatched by `/bs-build-game` (`bs-build-chunk`, `bs-build-bot`) and a sketch reshape (`bs-insert-chunk`) | `judgement` | no |
| `investigate`, and `spec` | `judgement` | no |
| `redteam`: both refuters and the coverage adversary | `judgement` | yes |
| `build` | `bounded` | no |
| `audit`: the fidelity lens | `judgement` | yes |
| `audit`: the visibility, undo and constraints lenses, and the design review | `review` | yes |
| `repair`, and `build` again after `test`'s verify failed | one role above the role whose work failed (below) | no |
| `final-acceptance`'s automated design-QA dispatch | `review` | yes |
| The cross-chunk lens after `chunk-merge` | `judgement` | yes |
| A bulk edit, search or summary any step hands off | `mechanical` | no |
| `/bs-verify-game` Step 7: enumerator A and the reconciler | `judgement` | no |
| `/bs-verify-game` Step 7: enumerator B | `second-opinion` | no |

The gates where the designer decides (`ask`, `playtest`, a triage) are never dispatched.

## No Review Before Verify

No review step starts until `boardsmith verify` has passed for the commit under review. Code
holds this line, not prose: before dispatching any reviewer, the session runs

```bash
npx boardsmith review-gate <slug> [--work-role <role>] [--since <commit>]
```

in the chunk's checkout (the main checkout, for the cross-chunk lens). It exits non-zero unless
the current commit, on a clean tree, has a passing `boardsmith verify --chunk <slug>` result
that measured the chunk's whole change, and its refusal says to run `boardsmith verify`. So the
order is always: commit, `npx boardsmith verify --chunk <slug>`, then `review-gate`. Writing the
Step Checklist or a ledger after verify makes a new commit, which needs its own verify run; the
mutation outcomes of unchanged code are reused, so that run is cheap.

- **Refused:** no review round runs. A failing verify is a failure of the step that made the
  change (below), and goes back with verify's own output, never to a reviewer.
- **Open:** it prints `Review level: <none | light | full>` and then the verify brief: that the
  mechanical checks are done, each check's outcome, the result file, the change under review, and
  not to run the checks again. Every review prompt carries that brief verbatim in its
  `{verifyResult}` slot, and lists only judgement checks.

**The size rule** is the command's, not a judgement made here. Work by the `bounded` or
`judgement` role is always reviewed in full. A `mechanical` change (pass `--work-role mechanical
--since <the commit before it began>`) is sized in changed lines: a small one needs no review
(`none`: verify is its whole gate, and no review round is recorded), a middling one gets a light
review, and a large one a full review. A **light** review is one agent of the step's review role,
given the brief and the step's whole judgement checklist, reviewing only the change the brief
names, in place of the step's full fan-out.

**A re-review** after a repair passes `--since <the commit the last round reviewed>`, so only the
changed parts go back to the reviewer.

## When a Step Fails: One Role Up, Never the Same Role

A step fails when its verify fails, or when its reviewer asks for changes. The retry goes to the
next role up, straight away, never again to the same role:

```bash
npx boardsmith agent <the role that failed> --escalate
```

prints the next role and its agent type: `mechanical`, then `bounded`, then `judgement`. There is
nothing above `judgement`, so there the command refuses. Apart from the one exception below, the
session then **stops and asks the designer**: what the step was for, what failed, and what each attempt tried, in the designer's
terms (`reporting.md`). Nothing more is dispatched for that step until the designer answers. In
orchestrated mode that is a gate returned to `/bs-build-game` (`repair-triage` for a build or
repair, the ordinary `ask` gate for a red team finding); a whole chunk that returns `closed` but
fails its check has failed at `judgement`, and goes to the designer the same way.

**The one named exception: one more `judgement` round for a red-team re-investigation and for a
repair.** A red-team re-investigation and a repair that fail at `judgement` each get exactly one
more round at `judgement` before the designer: `judgement`, then one `judgement`
re-investigation or repair, then the designer. The reason: the claims, and by the time of a
repair the work too, are already at the top role, so there is no higher role to send them to, and
the designer's time is the scarcer resource. A single second look at the same role catches most
of what a first pass misses, and costs the designer nothing. No other step gets it, and no step
gets a third round.

A reviewer never climbs: when it asks for changes, the step whose work it reviewed is the one that
failed. The retry is handed the failed attempt's report and the verify output or review findings.
What applies in each step:

- **`test`:** `build` ran at `bounded`. A failing verify sends `build` to `judgement`; a second
  failure goes to the designer.
- **`audit`:** a round with findings is a request for changes to the work it reviewed. The first
  `repair` runs one role above whoever last changed that work (`judgement` after a `bounded`
  build), then commits, verifies, and goes back to review with `--since`. If that repair fails, it
  gets the one more `judgement` round above; findings after that go to the designer, as the
  round-3 triage in `build/repair.md` describes. After a `bounded` build that is three audit
  rounds.
- **`redteam`:** the claims were written at `judgement`. A claim refuted once, or a coverage gap,
  gets the one re-investigate round at `judgement` above, reviewed again by a second red-team
  round; a claim refuted twice goes to the designer (`build/redteam.md`).

A gate the designer answered, an answer that reshapes the work, and a dispatch that stopped at its
context ceiling are not failures: the re-dispatch after them keeps its role.

## The Run Log

Each work package's run log (`design/run-log/<slug>.md`, from `templates/RUN-LOG.template.md`)
records every dispatch made for it, by whoever makes it: `/bs-build-game` for the chunk,
`/bs-build-chunk` for its steps and reviewers. A `### Dispatch N` entry records the work, the role,
the agent type actually dispatched, and which failed dispatch it escalates from, if any. A
`### Review Round N` entry records each review round: the step, the level, the verify result the
round started from (the commit and `passed`, as `review-gate` printed it), the agents dispatched,
and whether the reviewers asked for changes. So the number of review rounds per chunk, and what
each one started from, is on file. `boardsmith ledger-check` refuses an entry that leaves a field
out, names a role that does not exist, escalates by anything but one role, retries a failed
dispatch at the same role, or records a review round that did not start from a passing verify.
