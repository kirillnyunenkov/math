# "Мои пробники": a page with every exam and a dashboard, manual old results, a lighter home page

Date: 2026-10-07. Status: design approved in chat by the owner (Kirill).

## Why

1. A checked exam disappears from the home page after the first view; the student can only reopen it through the Telegram button. The student is expected to come back to the result again and again (own photos, the teacher's comment and photos).
2. The owner keeps exam results of his students in a Google sheet (tasks x exams, colours, solvability per task, primary and test score). The students should see the same thing in the trainer, including exams written before the trainer existed.
3. The home page is crowded: exam tiles, a big progress card, a "build a variant" block, only then the tasks.

## Out of scope

- The same dashboard in the teacher panel (student card). It reuses the same data and is a later step.
- Editing a manual exam after the import (delete and import again).
- Any change to how exams are assigned, written, checked.
- Item 9 of the review (autosave reading the whole exam).

## Data

### Per-task score (one value per task number 1..20 and exam)

- a number: points for the task (0 included);
- `null`: the student did not solve it (blank cell in the sheet);
- the task is listed in `na`: the task did not exist in that variant (the "-" in the sheet; task 6 in the old format).

Maxima are fixed by task number: tasks 1-13: 1; 14: 2; 15: 3; 16: 2; 17: 2; 18: 3; 19: 4; 20: 4. The maximum of an exam is the sum over tasks that are not in `na`: 33 for a current exam, 32 for an old one without task 6.

### Scales

- Only the current one: 33 primary points -> test score, the existing `SEC_SCORE` of the trainer (index.html). The module holds the same numbers and a test fails if the two ever differ.
- There is NO conversion scale for the old 32-point exams, anywhere. An archive (manual) exam carries its own fixed test score, entered by the teacher from his sheet (an integer 0..100) and shown as is.
- An exam without a fixed score and with a maximum other than 33 has no test score (the primary score is still shown).

### Exams written in the trainer

Per-task score of a checked assignment:
- short task: answer empty -> `null`; right -> 1; wrong -> 0 (from the stored `ok` map and answers);
- long task: the teacher's points; 0 points with no photos at all on that task (site or bot photos count only when attached to the task) -> `null`, 0 points with photos -> 0.
- `na` is empty.

### Manual exams (new collection `exam_history`)

Fields: `user` (relation, cascade delete), `date` (text `YYYY-MM-DD`), `title` (text, up to 80), `scores` (json: task number -> number or null), `na` (json: array of task numbers), `test` (integer 0..100, the fixed test score), `created`. Index on (user, date, title) unique. API rules: the student may read own rows; nobody writes through the collection API (writes only through hooks, like the other exam collections). Personal data stays on the server, never in the repo.

## Server (`backend/pb_hooks/exams.js`, route file `exams.pb.js`)

- `GET /api/ege/exams/summary` (student): `{ items: [...] }`, sorted by date. Each item: `{ kind: "exam"|"manual", id, title, date (unix seconds of the start, or of 12:00 MSK of the manual date), scores, na, primary, max }`. For `kind: "exam"` only assignments in phase `checked`. Never includes statements, keys or other students' data. Heavy fields of the exam record are parsed only to take `n`, `kind`, `max` of each task.
- `POST /api/ege/exams/history` (teacher): body `{ user, date, title, scores, na, test }`; validates the user, the date, task numbers 1..20, scores integer in `0..max`, `na` numbers, `test` integer 0..100; refuses a duplicate (user, date, title) with 400.
- `GET /api/ege/exams/history?user=<id>` (teacher): the rows of one student (for listing before delete).
- `DELETE /api/ege/exams/history/{id}` (teacher).
- Migration `1790800010_exam_history.js` creates the collection. The Caddy rule needs no change.

## Student: page `#/exams` ("Мои пробники")

Built in `exam.js` (new view next to the exam screens), data from `summary`.

1. Dashboard (shown when there is at least one exam; the chart needs two points):
   - chart of the test score by date (points joined by a line, test score on the axis, date under the point; no chart library, inline SVG);
   - table "task x exam": rows tasks 1..20, columns exams by date (latest on the right), cell colours: green = the maximum, yellow = part of the points, red = 0, white = blank, "-" = not in the variant; the last column is solvability, the last rows are the primary and the test score. Solvability of a task = sum of points / sum of maxima over the exams where the task was solved (not blank, not `na`); "-" when no such exam. This reproduces the owner's sheet (task 14 in his data: 11/14 = 79%). On a phone the table scrolls horizontally inside its own wrapper (`.table-wrapper`), the task column is sticky.
2. The list of exams, newest first: title, date, primary and test score. Exams written in the trainer open the result screen (`#/exam/<id>`); manual ones are labelled "записан вручную" and are not clickable.
3. Empty state: "Здесь появятся твои пробники после проверки." with the one-line explanation, no dashboard.

## Student: home page

- A "Пробники" button in the header, always visible (not inside the burger menu on a phone: icon + label on desktop, icon on phone), with a dot while there is an unseen check or an exam to take. It opens `#/exams`.
- The exam banner on the home page stays only when action is needed now: open, photo phase, or starting within 24 hours; at most one line each. Everything else (further scheduled, checked) is only on `#/exams`. The existing `markSeen` rule changes: a checked exam no longer vanishes, it is just "seen" (the dot goes away).
- Progress and "build a variant" become one compact card: left "52% · освоено 121 из 234" with the existing three-colour bar and one small legend line (Умею / Повторить / Разобраться / Осталось); right the "Продолжить →" button with the last place under it (as now); "Собрать вариант" is a second ordinary button of the same card. The task tiles follow right after.

## Importing the old exams (owner, through Claude Code)

`node tools/exam_api.mjs history --student "Иван" --date 2025-10-21 --title "Вариант 1" --scores "1,1,,1,..." [--yes]`
- `--scores`: 20 comma-separated values for tasks 1..20; empty = blank, `-` = not in the variant. `--test`: the test score of that exam from the owner's sheet (stored as is).
- Without `--yes` it prints a check table (task - points) with the primary score and the test score he gave and does nothing; with `--yes` it writes. It prints the target host first like the other write commands (default is production; `--api` for local). `history list --student` and `history delete --id` complete the tool.
- The owner sends tables or screenshots in the chat; Claude converts them to commands, shows the check table, runs after his "да". Student data is never written to files of the repository.

## Testing

- node tests for `exam-history-core.js`: the 33 scale, the primary scores of the owner's sample columns (9, 15, 18, 15, 20, 20, 16, 22), a fixed test score is returned as is, max by `na`, solvability on the owner's sheet columns, cell state classes, per-task scores for exams written in the trainer.
- backend tests: `summary` returns own checked exams and manual rows only, never another student's, never a non-checked exam, no statements or keys; the teacher routes refuse a student; validation; duplicates; cascade delete.
- browser check on the local stack at 375 px and 1280 px: `#/exams` with 0, 1 and 8 exams, the header button and dot on a phone, the home page with and without an open exam, no horizontal page scroll.
- the page-scripts-parse test keeps covering exam.js.

## Rollout

New migration and server files first (owner asked Claude to run the server commands himself last time: that permission is per request, ask again), then the site. The old sw cache version is raised.
