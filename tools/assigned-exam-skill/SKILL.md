---
name: assigned-exam
description: Prepare, upload and assign Kirill's own mock exams (пробники) for the exam trainer, and report what is assigned or waiting for a check. Use when Кирилл sends the source of a new пробник (PDF, Word, text, photos), asks to load a пробник into the catalog, asks to assign one to a student for a date and time, or asks what is assigned or waiting for a check.
---

# Assigned mock exams (пробники от преподавателя)

The trainer has a hidden catalog of Кирилл's own exams. He assigns one exam to one student for a date
and time; the student writes it inside a hard time window, photos of part 2 go to the site or the bot,
Кирилл checks part 2 in the panel. Design: `docs/superpowers/specs/2026-10-05-assigned-exams-design.md`.
Your job: turn his source into a correct `exam.json`, get it approved, give him the upload command, and
assign when he explicitly asks. Run every command from the repo root (`~/math`). Messages to Кирилл are in Russian.

## Hard rules

- The repository is public. Never put exam statements, answers, solutions or figures into the repo, a
  commit or `/tmp`. Work in `~/math-source/exams/<slug>/` (slug: `proba-<n>` or `YYYY-MM-DD-<name>`).
- Never print, log or paste `~/ege-teacher-link.txt`, a token or any secret. The tools read the file themselves.
- Never invent answers. Recompute every part 1 answer yourself (Python/sympy) and compare with the source.
- **Production writes are the owner's to run.** `tools/exam_api.mjs` targets production by default. You never run
  `upload`, `assign` or `delete` against production: you give Кирилл the command in a bash block. The read-only
  `exams`, `students` and `status` you may run for him. To test the tools, use only a local dev stack (`node tools/exam-dev-stack.mjs`), always with an explicit
  `--api http://127.0.0.1:8090/api --link-file <throwaway file>`.
- Assigning sends a Telegram message to the student. Run `--yes` (or give him the `--yes` command) only after
  his explicit yes that names the student, the exam (№ and title) and the time.
- Times are Moscow time. Default duration is 235 minutes.

## Workflow

1. **Collect the source** into `~/math-source/exams/<slug>/` (`source.pdf|docx|md|jpg…`). Ask only for what
   is missing: the title (up to 120 characters, plain text), whether it is a full variant (`full: true` only for
   a full variant: ask), and the answers if the source has none.
2. **Typeset `exam.json`** next to the source (write it with Python `json.dump`, so escaping is right):
   ```json
   { "title": "Пробник 3", "full": false,
     "tasks": [ {"n": 1, "kind": "short", "max": 1, "cond": "<p>Найдите $2+3$.</p>"},
                {"n": 13, "kind": "long", "max": 2, "cond": "<p>Решите уравнение …</p>"} ],
     "key": { "1": {"a": "5", "sol": "<p>…</p>"}, "13": {"a": "<p>$x=\\pm1$</p>"} } }
   ```
   - `short` = part 1, 1 point. `a` is **plain text** as a student types it (decimal comma allowed, minus as
     `-`), no tags. `sol` is required, in the approved format: «Идея» → numbered one-action steps → «Где
     ошибаются» (only if a typical mistake really exists) → the answer.
   - `long` = part 2, `max` from the criteria, `a` is HTML, no solution (it is not shown; do not add one).
   - Formulas: `$…$` inline, `$$…$$` display, LaTeX. A "less than" sign is `\lt`, never a bare `<` (a `<`
     followed by a letter is an error). A dollar sign in text goes only inside a formula: `$\$5$`.
   - HTML is an allowlist, nothing else passes. Tags: p br hr b i em strong u sup sub span div ul ol li table
     thead tbody tr th td blockquote pre code h3 h4 img. Attributes: only `img` src/width/height/alt and
     `th`/`td` colspan/rowspan/align. No links, forms, scripts, handlers, `style`, `class`, svg.
   - Figures only as `<img src="data:image/(png|jpeg|webp|gif);base64,…">`. Crop, shrink with Pillow to at most
     ~900 px wide, save as PNG/JPEG, then check the file size stays small (the validator rejects oversize files).
3. **Verify.** Recompute every part 1 answer independently. Show Кирилл a table: task · source answer · your
   answer · match. Resolve every mismatch with him before going on; never pick one silently.
4. **Check:** `node tools/exam_check.mjs ~/math-source/exams/<slug>/exam.json` until "Ошибок нет".
5. **Preview:** `node tools/exam_preview.mjs ~/math-source/exams/<slug>/exam.json` writes `preview.html` next to
   the file (it refuses to build while there are errors). Give him `open ~/math-source/exams/<slug>/preview.html`
   in a bash block. Wait for his «ок»; corrections mean repeating steps 3–5.
6. **Upload** (only after «ок»): give him this in a bash block, he runs it against production:
   `node tools/exam_api.mjs upload ~/math-source/exams/<slug>/exam.json`. It prints the catalog number
   («№N») and that students do not see the exam until it is assigned. `node tools/exam_api.mjs exams`
   lists the numbered catalog (same numbers as the panel).
   To fix an uploaded exam that was **never assigned**: `delete --exam <№ or title>` (add `--yes` after he
   confirms), then upload again. Deleting shifts the numbers of later exams: tell him.
7. **Assign.** He can do it in the panel (tab «Пробники» → «Назначить пробник»), or ask you ("назначь Ивану
   пробник 3 на пятницу 18:00"). Resolve names with `students` and `exams`. Build the command **without**
   `--yes` and show him the plan the tool prints, as it would run:
   `node tools/exam_api.mjs assign --student "<name>" --exam <№> --at "YYYY-MM-DD HH:MM" [--minutes 235]`.
   Ask for his explicit yes naming student, exam (№ and title) and time. After it, give him the same command
   with `--yes` to run against production. Ambiguous student or exam: ask, do not guess.
8. **Status:** `node tools/exam_api.mjs status` answers "что назначено / ждёт проверки" (read-only, you may run it).
   Part 2 is checked in the panel: `teacher.html#/check/<assignment id>`; the bot sends that
   link when a student submits.

## When something fails

- `exam_check` errors: fix the JSON, never loosen the validator.
- Upload answers 413: the Caddy body-limit step of `backend/README.md` was not applied on the server; tell Кирилл.
- Assign says "уже назначен": that exam is already given to that student; assignments can be moved or
  canceled in the panel only before the start.
