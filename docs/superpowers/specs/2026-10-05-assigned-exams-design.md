# Assigned mock exams: a hidden catalog the teacher opens per student

Date: 2026-10-05. Scenario and decisions approved by the owner in chat.

## Problem

The trainer only builds mock exams from the public task bank. The teacher also
runs "real" mock exams made of his own tasks: he agrees a time with a student
("Friday, 18:00") and sends the paper by hand, collects photos of part 2 in
Telegram, checks them, and reports the score by hand. All of that is manual
work, and the trainer takes no part in it.

## Decisions (owner)

- A hidden catalog of the teacher's own exams. Students never see the catalog;
  the teacher assigns one exam to one student for a date and time.
- Hard window: the exam runs from the start time for a fixed duration (default
  3 h 55 min, editable per assignment). Late start means less time. At the end
  everything is submitted automatically.
- Part 1 is typed into answer fields as in the regular mock exam. Part 2 is
  solved on paper: the student either attaches photos per task on the site or
  chooses "I will send them in Telegram".
- After the window closes the student has 10 minutes for photos only.
- Right after that the student sees the part 1 score, right/wrong per task, the
  correct answers and the part 1 solutions.
- The teacher grades part 2 in the panel: points per task plus a text comment.
  The student sees them once the teacher presses "Проверено".
- Before the start the hub shows a plain banner with the date and time (no
  countdown).
- Bot messages to the student: on assignment, one hour before, when the exam
  opens, when part 2 is checked. Bot message to the teacher: when a student
  has submitted.
- Content: the owner hands over PDF/Word/text with statements and answers.
  Claude typesets it, writes part 1 solutions, verifies answers by computation,
  the owner reviews a preview before anyone gets the exam. Part 2 has answers
  but no solutions (same policy as the bank).

Assumptions the owner accepted with the design:

- Any signed-in account can be assigned an exam (students and channel leads);
  guests cannot.
- Results of assigned exams live in their own block of the student card and do
  not touch the marks of bank tasks or the regular mock-exam history.
- One exam is given to one student at most once.
- The secondary (test) score is shown only for an exam marked as a full
  variant; otherwise only primary points.

## Amendments (owner, 2026-10-05, after the server part was merged and rolled out)

1. **Photos go to the bot, not to the teacher's chat.** The "send it in Telegram"
   route is replaced: a student who finds the site inconvenient simply sends
   photos of part 2 to the same bot that signs them in (`@kirill_repet_bot`),
   with no caption and no task number. The bot attaches them to the exam that
   started last, so everything is in one place and the teacher never has to
   search a private chat. The teacher sorts out what is where on the check page.
   Rules:
   - "The last started exam" = the student's assignment with the greatest
     `start` that is not in the future. It takes photos only while it is `open`
     or in the 10-minute `photos` phase (the server clock, same hard window as
     the site); otherwise the bot says the time is over and to write to the
     teacher (`@kirill_math_tutor`). Nothing is stored then.
   - A photo, or an image sent as a file (JPEG, PNG, WebP), at most 10 MB, at
     most 15 bot photos per exam. Photos from the bot have no task (`n` is empty).
   - The bot answers once per album: "Принял фото (всего K)", or why it did not
     accept.
   - Photos sent to the bot show up in the trainer in a separate block "Фото,
     присланные боту" next to the per-task photos attached on the site (the page
     polls a small photo-list route), and on the teacher's check page in the same
     kind of block.
   - The checkbox "Отправлю решения в Telegram" and the `via-tg` flag are no
     longer used by the trainer; the server keeps the route and column.
2. **No abrupt opening.** On the hub the banner turns from "будет в 18:00" into
   an "Открыть" button with a short animation (respecting
   `prefers-reduced-motion`); the exam screen fades in when the start time comes.
3. **Exams are prepared and uploaded through Claude Code, not through the panel.**
   The panel's "Загрузить пробник" and preview are dropped. Instead there is a
   project skill (`.claude/skills/assigned-exam/`) that standardises the work:
   source files in `~/math-source/exams/<slug>/`, one `exam.json`, answers
   verified by computation, `tools/exam_check.mjs` (validation), a local
   `preview.html` for the owner's review, and `tools/exam_api.mjs` (upload,
   list, assign, status) that logs in with the owner's teacher link file and
   never prints secrets. Uploading changes nothing for students; **assigning
   sends a Telegram message to the student**, so the skill must name the
   student, the exam and the time and get an explicit yes before it assigns.
   The panel keeps — and the catalog is a required part of it: the catalog of
   uploaded exams (numbered), a form "pick a student, pick an exam from the
   catalog, set the date and time" (a button on the tab and in the student card),
   the assignments lists, move/cancel, and the check page.
4. **Looks like the existing mock-exam generator.** The student's exam screens
   are built from the generator's exam mode (`renderVariant` in `index.html`):
   the same card, bar, timer, answer input, result tiles and tags. What differs:
   the countdown to the end of the window instead of a count-up, the save
   indicator, photo blocks for part 2, the phases (waiting, photos, result), and
   the teacher's points and comments. No new visual language.

## Approach

Everything secret stays on the server (PocketBase at `api.kirillnyun.space`).
The GitHub repository and GitHub Pages are public, so exam statements, answers
and solutions are never committed and never shipped as site files. The site
asks the server for an exam; the server answers according to who asks and what
time it is by the server clock.

Rejected: encrypted exam files on the site with a key released at start time
(answers would reach the device before submission); a bot-delivered PDF plus an
answer sheet (not an on-screen exam, no solutions afterwards).

## Design

### Phases of an assignment

Computed by one pure function from the stored fields and the server time;
shared by the server, the trainer and the panel (`exam-core.js`, unit-tested).

| Phase | When | Student gets |
|---|---|---|
| `scheduled` | before `start` | title, start time, duration |
| `open` | `start` ≤ now < `end`, not finished | statements, own saved answers; can save answers, attach photos |
| `photos` | after "Завершить" or after `end`, for 10 minutes or until "Готово" | photo slots for part 2 only; answers are locked |
| `submitted` | after the photo phase | statements, own answers, part 1 result, answers, part 1 solutions; part 2 "на проверке" |
| `checked` | teacher pressed "Проверено" | the above plus part 2 points, comments and the total |
| `missed` | window passed and the student never opened the exam | nothing; the teacher may reschedule |

`end = start + duration`. The photo deadline is `min(finished, end) + 10 min`.
A student who never opened the exam has not seen the statements, so `missed`
keeps the exam reusable for the same student. Canceling before the start
deletes the assignment, so the exam can be assigned to that student again.

### Server

Migration `1790800007_exams.js`, three collections. `users` is not touched (a
save of `users` would log everyone out).

- `exams` — `title`, `full` (bool: full variant, show the test score), `tasks`
  (json: per task `n`, `kind` short/long, `max`, statement HTML with figures
  embedded as data URIs), `key` (json: per task the answer and, for part 1,
  the solution). All rules teacher-only.
- `exam_assignments` — `user`, `exam`, `start`, `duration`, `opened`,
  `finished`, `photos_done`, `answers` (json, part 1 as typed), `via_tg`
  (bool), `p1` (part 1 points), `part2` (json: per task points and comment),
  `checked`, `settled`, `ok` (json: right/wrong per part 1 task), `log` (json: answer changes and away intervals, see
  "Activity signals"), and one timestamp per bot message already sent.
  Unique on (`user`, `exam`). All rules teacher-only: students never read the
  collection directly, only through the endpoints below.
- `exam_photos` — `assignment`, `user`, `n`, `file` (protected file, images
  only, 10 MB cap). Uploaded and deleted only through endpoints, by the owner, while
  the assignment is in `open` or `photos`, at most 5 per task; the owner and
  the teacher may view.

Endpoints in `backend/pb_hooks/exams.js` (registered from a thin
`exams.pb.js`, same split as the Telegram hook):

- `GET /api/ege/exams/mine` — the caller's assignments with phase and server
  time, no content. Drives the hub banner.
- `GET /api/ege/exams/{id}` — content according to the phase table above;
  marks the assignment as opened. Never returns `key` before `submitted`.
- `POST /api/ege/exams/{id}/answers` — autosave of part 1; accepted only in
  `open`. The server stamps each changed answer with its own time and appends
  it to `log`.
- `POST /api/ege/exams/{id}/away` — the page reports that it was hidden or
  lost focus and for how long, with the task that was on screen; appended to
  `log`. Accepted only in `open`.
- `POST /api/ege/exams/{id}/finish` — early finish; `POST .../done` — ends the
  photo phase early; `POST .../via-tg` — records the Telegram route.
- `POST /api/ege/exams/{id}/check` — teacher only: stores part 2 points and
  comments, marks checked, messages the student.

Part 1 is graded on the server when the assignment reaches `submitted`. The
comparison rule (`parseNum`/`answersEqual`) moves from `index.html` into
`answers-core.js` so the server and the trainer use the same code.

A once-a-minute cron job (`cronAdd`) sends the "one hour before" and "exam is
open" messages, moves overdue assignments to `submitted` or `missed`, and
messages the teacher about each new submission (part 1 score, photos or
Telegram route, link to the panel). Assigning, rescheduling and canceling go through teacher-only endpoints
(`assign`, `move`, `cancel`), which also send the bot message; the collection
itself is read-only through the API. Every message is sent at most once (timestamp
flags). The teacher's chat id comes from `TEACHER_TG_ID` in
`/etc/ege-api.env`. Message texts sit at the top of the file, as in `tg.js`.

### Trainer (`index.html`, new `exam.js`)

- Hub: a banner for the nearest assignment — "Пробник в пятницу, 9 октября, в
  18:00" before the start, a "Начать" button during the window, "На проверке" /
  "Проверен — посмотреть результат" afterwards. Signed-in users only.
- Route `#/exam/<assignment id>` renders the exam with the existing variant
  card markup. Differences from the regular mock exam: the timer counts down to
  `end` by the server clock; answers are saved to the server while typing
  (debounced) and restored on reload; each part 2 task has "Прикрепить фото"
  (several images, downscaled on the device before upload) and the screen has
  one "Отправлю решения в Telegram" link that records the choice and opens the
  chat with the teacher.
- When the window ends the page switches to the photo phase by itself, then to
  the results.
- Results screen: part 1 points, right/wrong, correct answers, solutions on
  demand; part 2 shows "на проверке" and later points and comments; total, and
  the test score if the exam is `full`.
- Nothing about assigned exams is written to `localStorage` progress, the mark
  state or the mock-exam history. The service worker does not cache these
  requests; `exam.js`, `exam-core.js`, `answers-core.js` are added to its file
  list and `VERSION` is bumped.

### Teacher panel (`teacher.html`)

- New tab "Пробники": the catalog (title, task count, who has it and in which
  phase), "Загрузить пробник" (a JSON file prepared by Claude), a preview of
  any exam with answers and solutions, and the "На проверку" queue.
- Student card: "Назначить пробник" (exam, date, time, duration); reschedule
  and cancel before the start; a block with the student's assigned exams.
- Check screen: part 1 answers with right/wrong; for each part 2 task the
  photos (or "решения в Telegram"), a points field 0..max and a comment; the
  activity summary; "Проверено".

### Activity signals

Facts for the teacher, not protection: nothing is blocked and the student sees
no warnings.

- Away journal: every time the exam page is hidden or loses focus during
  `open` (another tab, another app, minimised browser) the page records the
  interval and the task that was on screen. A second device is invisible to
  this.
- Time per task: when each part 1 answer was entered or changed, by the server
  clock.

The check screen shows a summary — how many times and for how long the student
was away, the longest interval and its task, and a per-task timeline of
answers — with the raw list on demand. The student never receives `log`.

### Content pipeline

The owner's source files and the typeset exam JSON stay outside the repository
(`~/math-source/exams/`, private). `tools/exam_check.mjs` validates a JSON
file before upload: structure, every part 1 task has an answer and a solution,
every formula renders in KaTeX. The owner uploads the file in the panel, opens
the preview, and only then assigns it.

### Rollout order

Server first (migration, hooks, env variable, restart), then the site. The
trainer treats a failed `exams/mine` request as "no assignments", so a site
released before or after the server keeps working.

## Error handling

- No connection during the exam: typed answers stay in the page and are resent
  when the connection returns; a visible "не сохранено" marker until then. The
  server rejects saves after `end`.
- A failed photo upload shows an error on that photo with "Повторить"; the
  Telegram route is always available as a fallback.
- Photos are never uploaded as shot (phone originals reach tens of MB). The
  page redraws each image to at most 2000 px on the long side and encodes it
  as JPEG before upload; the exact size and quality are tuned on real photos
  of student work so that small handwriting stays readable. An image the
  browser cannot decode (HEIC picked on a Windows computer) is not uploaded:
  the student is told to attach it from the phone or use the Telegram route.
- Wrong device clock: all time decisions use server time; the page keeps the
  offset from the last response.
- Bot message fails (student blocked the bot): logged without the token, the
  flag stays unset and the next cron runs retry while the message is still
  relevant, the banner on the site
  still works.

## Testing

- `tests/exam-core.test.mjs`, `tests/answers-core.test.mjs`: phases at every
  boundary, answer comparison (moved code keeps its behaviour).
- `backend/tests/exams.test.mjs` against a local PocketBase and the Telegram
  stub: a student cannot read `exams` or another student's assignment; no
  statements before `start`; no key before `submitted`; saves rejected after
  `end`; photo upload rejected after the photo deadline; cron sends each
  message once; `missed` versus `submitted`; teacher check flow; `log` gets
  server-stamped answer changes and away intervals and is never returned to
  the student.
- Browser pass on a local stack: assign → banner → start → autosave and reload
  → photos → results → teacher check → student sees comments; phone width.

## Not doing

- A task editor in the panel; assigning to several students in one action.
- Anti-cheating enforcement: copy protection, forced fullscreen, camera,
  blocking on tab switch. Only the passive signals above are collected.
- Delaying answers and solutions until other students have written the same
  exam: they are shown right after submission (owner's decision); the teacher
  avoids giving one exam to students who know each other.
- Solutions for part 2; annotations drawn over the student's photos.
- Automatic deletion of old photos. Rough volume: 30 students × 10 exams × 15
  photos × 0.5 MB ≈ 2.3 GB a year. The 0.5 MB per downscaled photo is an
  estimate, to be measured on real photos; free disk space on the server is
  checked before rollout.
