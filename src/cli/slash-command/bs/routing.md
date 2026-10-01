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
outside a chunk uses the skill's name: `ingest-rules`, `verify-game`, except a `/bs-verify-game`
repair of a stale chunk, which runs through that chunk's own pipeline under the chunk's slug. A dispatch template in these
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
| `re-investigate`: a red-team re-investigation | `judgement`, the first named exception (below) | no |
| `quote-fix`: the narrower fix after `claim-quote-check` refuses the claims | `judgement`, the second named exception (below) | no |
| `transcribe <range>` again after `verify-run-record` refused the range | `judgement`, the third named exception (below) | no |
| A narrower follow-up on a returned summary that looks incomplete or wrong, where no check refused it (investigate, red team, transcription), and a follow-up amending a slice with the designer's correction | the role of the work it follows up | no |
| `final-acceptance`'s automated design-QA dispatch | `review` | yes |
| The cross-chunk lens after `chunk-merge` | `judgement` | yes |
| A bulk edit, search or summary any step hands off | `mechanical` | no |
| Rulebook transcription (`transcribe`, `BS-DISPATCH-V3`): `/bs-ingest-rules`' fan-out and `/bs-verify-game` Step 2's staging | `judgement` | no |
| `/bs-verify-game` Step 3: classification (`classify`, `BS-CLASSIFY-V1`) | `judgement` | no |
| `/bs-verify-game` Step 5: the ruling re-check (`ruling-recheck`, `BS-RULING-RECHECK-V1`) | `judgement` | no |
| `/bs-verify-game` Step 7: enumerator A (`enumerate`, `BS-ENUMERATE-V1`) and the reconciler (`reconcile`, `BS-RECONCILE-V1`) | `judgement` | no |
| `/bs-verify-game` Step 7: enumerator B (`enumerate`, `BS-ENUMERATE-V1`) | `second-opinion` | no |
| Worked-example replay, in `/bs-verify-game` Step 8 and the `test` step: extraction (`extract-example`, `BS-EXAMPLE-EXTRACT-V1`) and translation (`translate-example`, `BS-EXAMPLE-TRANSLATE-V1`) | `judgement` | no |

The name in backticks in the first column is the dispatch's `Work` in the run log (below). Work
done once per unit (a page range, a pair, a ruling, a slice, an example) adds the unit after the
name, `transcribe rulebook.pdf pp. 1-8` or `enumerate rulebook/03-scoring.md`, because the run log
tells a retry from new work by its `Work`: a second dispatch of the same unit after it failed is a
retry, and the next unit's first dispatch is not.

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

A step fails when its verify fails, when `boardsmith claim-quote-check` refuses the claims it wrote
(`investigate` and `re-investigate`), when `boardsmith verify-run-record` refuses a page range it
transcribed, or when its reviewer asks for changes. The retry goes to the next role up, straight
away, never again to the same role:

```bash
npx boardsmith agent <the role that failed> --escalate
```

prints the next role and its agent type: `mechanical`, then `bounded`, then `judgement`. There is
nothing above `judgement` (or beside it, for `second-opinion`), so there the command refuses. Apart
from the three named exceptions below, the session then **stops and asks the designer**: what the
step was for, what failed, and what each attempt tried, in the designer's terms (`reporting.md`).
Nothing more is dispatched for that step until the designer answers. In orchestrated mode that is
a gate returned to `/bs-build-game` (`repair-triage` for a build or repair, the ordinary `ask` gate
for a red team finding); a whole chunk that returns `closed` but fails its check has failed at
`judgement`, and goes to the designer the same way.

**The first named exception: one more `judgement` round for a red-team re-investigation and for a
repair.** A red-team re-investigation and a repair that fail at `judgement` each get exactly one
more round at `judgement` before the designer: `judgement`, then one `judgement`
re-investigation or repair, then the designer. The reason: the claims, and by the time of a
repair the work too, are already at the top role, so there is no higher role to send them to, and
the designer's time is the scarcer resource. A single second look at the same role catches most
of what a first pass misses, and costs the designer nothing. Audit findings on work already at
`judgement` (a `build` that `test` sent up to `judgement`, then an audit round with findings)
count as a failed repair at `judgement`: they get this one more round, as a `repair`, and the next
failure goes to the designer.

**The second named exception: one narrower `quote-fix` for a `claim-quote-check` refusal.** When
`boardsmith claim-quote-check` refuses the claims an `investigate` or `re-investigate` dispatch
wrote, that dispatch has failed at `judgement`. It gets exactly one narrower `quote-fix` at
`judgement`, handed only the refusals, which fixes each quote or location or turns the claim into
an open question; if the check still refuses, the designer decides. The reason: quote fixes are
mechanical and cheap, and the designer's time is scarcer, so one narrow retry is worth more than
a question to the designer about a misplaced quote.

**The third named exception: one re-transcription of a page range `verify-run-record` refused.**
When `boardsmith verify-run-record` refuses a unit of a page range `/bs-verify-game` Step 2 had
transcribed (a staged slice whose `Source:` line names the wrong document or none, a slice not
found in the staging directory, an empty slice), that range's `transcribe` dispatch has failed at
`judgement`, and its run log Detail holds the refusal, naming `verify-run-record`. The range gets
exactly one re-transcription at `judgement`, the same range dispatched again after `--reset-range`;
if the command refuses it again, the designer decides. A `/bs-ingest-rules` transcription is not
checked by that command and does not get this round. The reason:
transcription slips are usually mechanical, a header written wrong or a write that did not
finish, and the designer's time is scarcer, so one more pass at the same range is worth more
than a question to the designer about a slice's header.

No other step gets these rounds, and no step gets a third round: a `re-investigate` or `repair`
that is itself the one more round goes to the designer when it fails, and so does a `quote-fix`
that the check still refuses, and a re-transcription the command still refuses.

A reviewer never climbs: when it asks for changes, the step whose work it reviewed is the one that
failed. The retry is handed the failed attempt's report and the verify output, check refusals or
review findings. What applies in each step:

- **`investigate`:** a `claim-quote-check` refusal gets the one `quote-fix` above, then the
  designer.
- **`test`:** `build` ran at `bounded`, and its check is this step's verify, so the build's run
  log entry stays `pending` until the done gate answers and is then `done` or `failed`, naming
  the check. A failing verify sends `build` to `judgement`, escalated from the failed build; a
  second failure goes to the designer.
- **`audit`:** a round with findings is a request for changes to the work it reviewed. The first
  `repair` runs one role above whoever last changed that work (`judgement` after a `bounded`
  build), then commits, verifies, and goes back to review with `--since`. If that repair fails, or
  the work was already at `judgement`, it gets the one more `judgement` round above; findings
  after that go to the designer, as the round-3 triage in `build/repair.md` describes. After a
  `bounded` build that is three audit rounds.
- **`redteam`:** the claims were written at `judgement`. A claim refuted once, or a coverage gap,
  gets the one re-investigate round at `judgement` above, reviewed again by a second red-team
  round; a claim refuted twice goes to the designer (`build/redteam.md`).
- **`/bs-verify-game` Step 2:** a page range `verify-run-record` refuses gets the one
  re-transcription above, then the designer (`verify/staging-dispatch.md`).

A gate the designer answered, an answer that reshapes the work, a dispatch that stopped at its
context ceiling and a dispatch that never returned are not failures: the re-dispatch after them
keeps its role, writes `Escalated from: none`, and carries on the round it resumes. Nor is a
returned summary that merely looks incomplete or wrong, with no check refusing it: its narrower
follow-up keeps the role of the work it follows up.

## The Run Log

Each work package's run log (`design/run-log/<id>.md`, from `templates/RUN-LOG.template.md`)
records every dispatch made for it, by whoever makes it: `/bs-build-game` for the chunk,
`/bs-build-chunk` for its steps and reviewers, and `/bs-ingest-rules` and `/bs-verify-game` for
their own dispatches, in `design/run-log/ingest-rules.md` and `design/run-log/verify-game.md`
(so no chunk may be named `ingest-rules` or `verify-game`; `ledger-check` refuses one).

A `### Dispatch N` entry records the work (the name in the step table above, a step name, or a
short name for a bulk edit), the role, the agent type actually dispatched, and what it answers:
`Escalated from: Dispatch N` for a dispatch that failed, or `Escalated from: Review Round N` for a
round that asked for changes; at the top role that names the failure a named exception answers. A
dispatch that does work again after it failed at the top role, once the designer has answered,
records where their answer is in `Designer answer:`. A dispatch's Outcome is `failed` when its
verify failed or a check run on its return refused it (for `build`, once `test`'s verify has run,
since that is its check); a reviewer's request for changes is the round's Outcome, not the
dispatch's.

A `### Review Round N` entry records each review round: the step, `Reviewed: Dispatch N` (the
finished dispatch whose work it reviews), the level, the verify result the round started from (the
commit and `passed`, as `review-gate` printed it), the agents dispatched, and whether the
reviewers asked for changes. So the number of review rounds per chunk, and what each one started
from, is on file.

`boardsmith ledger-check` refuses an entry that leaves a field out, names a role that does not
exist, escalates by anything but one role, answers one failure twice, does failed work again
without naming the failure, escalates from the top role outside the three named exceptions (or
gives one a second time), reviews a dispatch that did not finish or one a later finished dispatch
carried on from, or records a review round that did not start from a passing verify, checked
against `.boardsmith/verify/<commit>.json` when that result is on this machine.
