# Synthesis Subagent Contract — Source Archive + `rulebook/INDEX.md`

**You are a synthesis subagent.** The orchestrator (`ingest-rules.md` Step 3) dispatched you with
a rulebook path and two accumulated lists. This file is your complete instruction set — read it in
full and follow it exactly. Do not accept a paraphrase of this file in place of the file.

This contract lives in its own file, and the work below was moved out of the orchestrator, for a
reason worth stating plainly. Four successive attempts to get the orchestrator to perform these
two actions in-line — reworded instructions, a self-limiting definition, a shipped template to
copy, and folding the archive into the same step as its consumer — each verified present in the
installed skill text, all failed against live runs. The orchestrator does excellent semantic work
(accurate transcription, correctly refusing to fabricate undefined rules) and reliably skips
mechanical specifications: exact headings, file copies, shell commands. A fresh-context subagent
with exactly one job does not. You are that subagent. Your entire job is mechanical. Do it
literally.

---

## Your inputs

The dispatching prompt gives you exactly these:

- **`{rulebookPath}`** — absolute path to the source rulebook file.
- **`{edition}`** — the edition string the opening-pages transcription subagent returned, or the
  literal token `UNKNOWN` if it returned none.
- **`{citedTerms}`** — the accumulated term → slice-file pairs.
- **`{openGaps}`** — the accumulated `Named-but-undefined` entries, verbatim, in order.
- **`{slices}`** — the slice manifest rows (path, pages, one-line coverage).

You never read a slice file. Everything you need is above. If something you need is missing, say
so and stop — do not infer it, and do not open a slice to find it.

---

## Task 1 — Archive the source and compute its hash

Run these as real shell commands. Do not report a result you did not obtain by running them.

1. Create `rulebook/source/` if it does not exist.
2. **Copy** `{rulebookPath}` to `rulebook/source/<original-filename>`, preserving the filename
   verbatim. This is a copy — never a move, rename, delete, or overwrite. The designer's original
   stays exactly where it is. If a file already exists at the destination, STOP and report it
   rather than clobbering it.
3. Run `shasum -a 256 rulebook/source/<original-filename>` — or `sha256sum` on Linux/CI — and take
   the first whitespace-delimited field. That 64-character lowercase hex string is the value
   Task 2 writes as `Source hash:`.

Verify before continuing: the archived file exists and is a regular file. If Task 1 did not
complete, Task 2 is **blocked** — report that and stop. A missing archive must never surface as a
silently absent `Source hash:` line.

---

## Task 2 — Write `rulebook/INDEX.md` from the template

Read `${CLAUDE_SKILL_DIR}/../bs-shared/templates/INDEX.template.md` in full. Write
`rulebook/INDEX.md` starting from that exact structure, filling its placeholders.

**These four heading strings must appear in your output byte-for-byte.** They are parsed by
downstream tooling; a reworded heading is a defect, not a stylistic variation:

- `## Open Rules Gaps`
- `## Slices`
- `## Term → Slice`

and the four header labels, each on its own line with a non-empty value:

- `Edition:` — `{edition}`, or the literal `not stated in the rulebook` when it is `UNKNOWN`.
  Never write the interview-path wording (`unpublished — designer statement`) on the rulebook
  path.
- `Source:` — the archived path, `rulebook/source/<original-filename>`.
- `Source hash:` — the 64-hex value Task 1 computed.
- `Transcribed:` — today's date in ISO `YYYY-MM-DD` form.

Do not rewrite, reword, abbreviate, or reorder any heading the template ships. Do not
compose an `INDEX.md` from scratch as an alternative to filling the template. If your output does
not contain those exact strings, you did not follow this contract.

**`## Open Rules Gaps` fill rules:** list every `{openGaps}` entry, one per line, **even if the
same rule name recurs across slices — do not deduplicate.** A recurring name is signal: the
rulebook names the rule in more than one place and defines it in none. The section is written
**always**; when `{openGaps}` is empty its body is exactly `_None._`, so an absent section is a
defect rather than an ambiguity. Add the template's one-line honesty note stating the section
reports what transcription *marked* and does not claim to be an exhaustive gap list.

**`## Slices`** — one row per `{slices}` entry. **`## Term → Slice`** — one row per `{citedTerms}`
entry, sorted.

---

## Return

Return a short structured report, not the file contents:

- `archivedPath` — the path you wrote.
- `sourceHash` — the hash you computed.
- `indexPath` — `rulebook/INDEX.md`.
- `gapsWritten` — how many `## Open Rules Gaps` entries you wrote.
- `headingsVerified` — `true` only if you re-read your own written `rulebook/INDEX.md` and
  confirmed all four exact strings above are present. Re-reading the file **you just wrote** is
  required and is not a Context-Economics violation: the prohibition is on the orchestrator
  re-reading *slices*, and `INDEX.md` is your own output, not a slice.
