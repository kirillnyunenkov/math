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
- Assign only after the trainer screens release has been deployed together with the updated server hooks (backend/README.md, "Rollout of the trainer screens"), and only if the photo routes are on the server (`curl -s -o /dev/null -w '%{http_code}\n' https://api.kirillnyun.space/api/ege/exams/x/photos` prints 403; 404 = not deployed). Until then the student cannot open the exam.
- Times are Moscow time. Default duration is 235 minutes.

## The usual request: a saved Школково variant (the owner sends this almost every time)

Кирилл builds a variant in the Школково constructor, saves the page (`Поставьте баллы своим ответам.html` + the
`…_files` folder in ~/Downloads) and writes something like «название "пробник №N", разборы пиши сам, у тренажёра
разборы идеальные — делай по такому же принципу, найди ту же задачу и замени числа». That sentence is the whole brief:
do not ask what he wants, do the steps below and show the preview. Ask only if the title is missing (default: «Пробник №N»
with the next free number from `exams`) — the variant is always full (`full: true`, 13 + 7 tasks).

1. **Dump the page** (no repository files are written):
   `python3 tools/assigned-exam-skill/shkolkovo_extract.py "<page>.html" ~/math-source/exams/<slug>/` → `tasks.txt`
   (statement, the site's answer and solution, criteria of every task) and `src/` (statement drawings and graphs).
   Formulas in `tasks.txt` are ASCII-art alt text and can be wrong (fractions, roots, systems): render a picture to look
   at it (`/usr/bin/python3 tools/assigned-exam-skill/render_svg.py <svg> <png>`, then Read the PNG) before typesetting anything unclear.
   The site's answer and solution are claims, not truth: recompute (step 3 of the workflow). Its solutions have typos
   (one said "интервале (−3;5)" for (−3;6)); never copy a solution of the site, only use it to see the intended method.
   The pages are the site's copyright and Кирилл's private material: keep them in `~/math-source/`, never in the repo.
2. **Part 1 solutions come from the trainer, not from the site.** For each task 1–13 find the same prototype in the bank
   (`node tools/sol_show.mjs <n>` lists prototypes, `… <n> p<k>` shows statement, bank answer and solution) and adapt its
   solution with this variant's numbers. Typical matches: 1 → 1.2 (sin A), 2 → 2.1, 3 → 3.1 (prism = half), 4 → 4.15,
   5 → 5.8 (batteries, tree), 6 → 6.1, 7 → 7.9/7.10 (log), 8 → 8.15/8.16 (double angle), 9 → 9.9 (extremum from the graph of f′),
   10 → 10.21/10.x (formula), 11 → 11.7/11.8 (table + equation of times), 12 → 12.x by the function type, 13 → 13.x by the credit type
   (the same task can be in the bank verbatim: 4.15, 6.1, 13.23 were — then copy). The bank answer must equal the variant's answer when the
   statement is identical. No prototype for the task (task 11 of Пробник №1 was a «две половины пути» problem) → write the solution
   yourself in the same format and the same style (idea, one action per step, a table for motion/work/mixtures, a real typical mistake),
   say so in the report. Keep the order: Идея → picture → steps → «Где ошибаются» (only if a mistake really exists; compute the wrong
   answer it leads to and check that it differs from the right one). Exam HTML has no classes: write plain `<p><b>Идея.</b>`, `<ol>`,
   `<table>` (no `table-wrapper`), `<p>$$…$$</p>` (no `math-display`). Part 2 (14–20): only the answer, no solution.
3. **Pictures.** Statement drawings come from `src/` (render to PNG). Solution figures follow the `solution-visuals` skill: overlay
   on the statement drawing (graphs, triangles), the bank's own tree/box helpers (`tools/figs/t5.py` `_tree`, `t3.py` BOX) for the rest.
   Work outside the repo: copy `~/math-source/exams/proba-1/mkfigs.py` / `build_exam.py` as the starting point of a new exam (they
   show how to overlay on a dvisvgm drawing: the page group is scaled ×2, grid origin and cell are read from the SVG's axis paths).
   Render with `render_svg.py` (headless Chrome, no extra installs), shrink with Pillow via `/usr/bin/python3` (the `python3` on PATH has no Pillow).
   `exam_build_lib.py` has `Exam.img / sol / short / long / write` so `build_exam.py` stays about content only. Look at every PNG you made.
   Do not draw over a statement figure when the picture contradicts the numbers; if it is merely not to scale (Школково triangles often
   are), overlay anyway and tell Кирилл.
4. **Checks before showing him anything:** `exam_check` clean; `exam_preview`, then open `preview.html` in headless Chrome
   (`--allow-file-access-from-files --virtual-time-budget=5000 --dump-dom`) and count `katex-error` (must be 0); look at screenshots of
   the tables and figures. Dark theme: exam text lives in `.tex`, so the trainer's `--img-filter: invert(.92) hue-rotate(180deg)` is applied
   to every `<img>`; drawings on a white background with black ink and ACCENT blue work (checked 07.10.2026), do not use other colours.
5. **Report to Кирилл** (short, Russian): the answer table (task · answer · matched the site), which solutions are copies / adapted /
   written anew, where a picture is not to scale, what was verified by computation. Then `open …/preview.html` and wait for «ок».

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
   - `short` = part 1, 1 point. `a` is **plain text** as a student types it: only digits, a comma and a minus
     (`-1,5`; the answer field accepts nothing else, `exam_check` refuses any other character, so no fractions
     like `3/2`, no letters, no units), no tags. `sol` is required, in the approved format: «Идея» → numbered one-action steps → «Где
     ошибаются» (only if a typical mistake really exists) → the answer.
   - `long` = part 2, `max` from the criteria, `a` is HTML, no solution (it is not shown; do not add one).
   - A full variant (`full: true`) has exactly 20 tasks: 1-13 `short` (1 point each) and 14-20 `long` with the maxima of the
     generator's table (14:2, 15:3, 16:2, 17:2, 18:3, 19:4, 20:4; 33 primary points in all, the test score is shown only then).
     `exam_check` refuses a full exam that has another shape. An exam with `full: false` can have any tasks.
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
   lists the numbered catalog (same numbers as the panel). `exams` prints «(полный вариант)» after a full exam's title:
   that is only the tool's label (the panel shows a chip), the title students see is exactly the `title` of the file.
   There is no edit in place. To fix an uploaded exam that was **never assigned** (or whose assignment he cancelled in the panel
   before the start): `delete --exam <№ or title>` (add `--yes` after he confirms), then upload again. Deleting shifts the numbers of
   later exams: tell him. What deleting does to a result of a student who already wrote it is not documented: do not promise anything,
   check `backend/` first. So catch mistakes before assigning.
7. **Assign.** He can do it in the panel (tab «Пробники» → «Назначить пробник»), or ask you ("назначь Ивану
   пробник 3 на пятницу 18:00"). Resolve names with `students` and `exams` (read-only). You never run `assign`
   against production, not even without `--yes`: describe the plan yourself from that output (student, exam
   № and title, start in Moscow time, duration, "the student gets a Telegram message now and a reminder an hour
   before"). Ask for his explicit yes naming student, exam (№ and title) and time. After it, give him the command
   in a bash block for him to run against production (he sees the tool's own plan, then adds `--yes`):
   `node tools/exam_api.mjs assign --student "<name>" --exam <№> --at "YYYY-MM-DD HH:MM" [--minutes 235]`.
   Ambiguous student or exam: ask, do not guess.
8. **Status:** `node tools/exam_api.mjs status` answers "что назначено / ждёт проверки" (read-only, you may run it).
   Part 2 is checked in the panel: `teacher.html#/check/<assignment id>`; the bot sends that
   link when a student submits.

## When something fails

- `exam_check` errors: fix the JSON, never loosen the validator.
- Upload answers 413: the Caddy body-limit step of `backend/README.md` was not applied on the server; tell Кирилл.
- Assign says "уже назначен": that exam is already given to that student; assignments can be moved or
  canceled in the panel before the start, or when it was missed (never opened and the window has passed).
