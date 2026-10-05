# Assigned Mock Exams, Part 3 of 3: Teacher Panel and Exam Upload Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) In `teacher.html` the teacher assigns an exam to a student for a date and time (and moves or cancels it before the start), sees what is running and what waits for a check, and checks a submitted work: part 1 results, photos of part 2, points and a comment per task, an activity summary — and sends the result to the student. (2) Exams are prepared and uploaded **through Claude Code**, not through the panel: a validator, a local preview, an API tool and a project skill standardise that work.

**Architecture:** Small pure modules (`exam-panel-core.js`, `exam-validate.js`, `tools/exam-cli-lib.mjs`) with Node tests. Command-line tools in `tools/`: `exam_check.mjs` (validate + render every formula with the KaTeX of the repo), `exam_preview.mjs` (a static `preview.html` for the owner's review), `exam_api.mjs` (upload, list, assign, status, delete — logs in with the owner's teacher link file, never prints secrets). A project skill `.claude/skills/assigned-exam/SKILL.md` ties them into one workflow. `teacher.html` loads the catalog, assignments and photo metadata with the other panel data (tolerating a server that has not been rolled out yet) and gets one new tab "Пробники" with lists and assign/move/cancel sheets, a block in the student card, and the check page. All writes go through the server routes of Plan 1.

**Tech Stack:** Vanilla JS in the existing `teacher.html`, KaTeX (already loaded), Node's built-in test runner, the dev stack from Plan 2 (`tools/exam-dev-stack.mjs`) for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-05-assigned-exams-design.md` ("Teacher panel", "Activity signals", "Content pipeline", and "Amendments" item 3: exams are uploaded through Claude Code, the panel has no upload). Server contract: `backend/pb_hooks/exams.js` (Plan 1, merged). Plan 2 (trainer) is independent of this plan, except for the dev stack it created.

## Global Constraints

- The repository is public. No real exam content in any committed file; fixtures and tests use made-up tasks. Exam source files, typeset exam JSON and previews stay outside the repo (`~/math-source/exams/<slug>/`).
- Secrets: the teacher link file `~/ege-teacher-link.txt` and the login token are never printed, logged, committed or put in command lines; the tools read the file themselves.
- Assigning an exam sends a Telegram message to a student (red zone in the owner's rules): the tool refuses to assign without `--yes`, and the skill requires the owner's explicit yes naming student, exam and time first.
- Teacher-only page: do not weaken the existing login handling. All new network calls use the panel's existing `api()` helper (token in the header, `401` → logout).
- Every string that comes from data (titles, names, comments, answers) is escaped with the panel's `esc()` before it is put into HTML; exam statements/solutions are teacher-authored HTML and are rendered as HTML, but only after `validateExam` accepted them.
- Time entered by the teacher is Moscow time regardless of the browser's time zone (the existing panel formats dates with `timeZone:'Europe/Moscow'`).
- Colours and spacing only from the tokens already in `teacher.html` `:root`; text in Russian on «ты», no emoji; code comments in English.
- The panel must keep working when the server has not been rolled out (the new collections answer 404): the exam lists are then simply empty.
- Do not load heavy fields into lists: never request `tasks`/`key` of `exams` or `log` of `exam_assignments` in list calls (use the `fields` query parameter); fetch them one record at a time.
- Bump `VERSION` in `sw.js` (strictly greater than `master`'s) in the task that adds shipped files, and add the new files to `SHELL`.
- Commit after every task; never push to `master`; never touch the production server.
- Unit tests: `node --test 'tests/*.test.mjs'`. Backend tests: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`.

## Server contract the panel relies on

Collections API (teacher token): `exams` (`id,title,full,created,tasks,key`), `exam_assignments` (`id,user,exam,start,duration,opened,finished,photos_done,settled,checked,p1,via_tg,answers,ok,part2,log,created`), `exam_photos` (`id,assignment,user,n,file`). Routes (teacher token, JSON): `POST /ege/exams/assign {user,exam,start,duration}` → `{id}` (400 bad input or already assigned); `POST /ege/exams/{id}/move {start,duration?}`; `POST /ege/exams/{id}/cancel` (both 409 once started); `POST /ege/exams/{id}/check {part2:{n:{pts,comment}}}` → 200 / 409 not submitted / 400 bad points. Photos: `POST /files/token` → `{token}`, then `GET /files/exam_photos/{photoId}/{file}?token=…`. `log` entries: `[ts,"a",n,text]` (answer changed) and `[ts,"w",n,seconds]` (page was away).

## File Structure

| File | Responsibility |
|---|---|
| `exam-panel-core.js` (new) | Moscow time input conversion, activity summary from `log`, phase labels. |
| `exam-validate.js` (new) | `validateExam()` for an exam file; `extractFormulas()`. Node only: the panel does not upload exams. |
| `tests/exam-panel-core.test.mjs`, `tests/exam-validate.test.mjs` (new) | Unit tests. |
| `tests/fixtures/exam-sample.json` (new) | A small made-up valid exam. |
| `tools/exam-check-lib.mjs`, `tools/exam_check.mjs` (new) | `checkExam()` (validate + render every formula with KaTeX) and its CLI. |
| `tools/exam-cli-lib.mjs` (new), `tests/exam-cli-lib.test.mjs` (new) | Pure helpers of the API tool: time parsing, picking one item by name. |
| `tools/exam_api.mjs`, `tools/exam_preview.mjs` (new) | API tool for Claude Code (upload, exams, students, assign, status, delete); static preview page. |
| `.claude/skills/assigned-exam/SKILL.md` (new) | The workflow: sources → exam.json → verify → check → preview → upload → assign. |
| `teacher.html` (modify) | Data load, tab "Пробники" (lists, catalog), assign/move/cancel sheets, student-card block, check page. |
| `sw.js` (modify) | New files in `SHELL`, version bump. |

---

### Task 1: `exam-panel-core.js` — pure helpers

**Files:**
- Create: `exam-panel-core.js`
- Test: `tests/exam-panel-core.test.mjs`

**Interfaces:**
- Produces (`ExamPanelCore`, Node: `require('../exam-panel-core.js')`, browser: `window.ExamPanelCore`):
  - `moscowInputToTs(str) -> unix seconds | null` — `"2026-10-09T18:00"` (a `datetime-local` value, read as Moscow time).
  - `tsToMoscowInput(ts) -> "YYYY-MM-DDTHH:MM"`.
  - `activitySummary(log, start) -> { away:{count,totalSec,longest:{sec,n}|null}, tasks:{[n]:{changes,firstSec,lastSec}} }` — times relative to `start`.
  - `PHASE_TEXT` — `{scheduled:'назначен', open:'идёт', photos:'фото', submitted:'ждёт проверки', checked:'проверен', missed:'пропущен'}`.
  - `fmtSec(sec) -> "H:MM:SS" | "M:SS"`.

- [ ] **Step 1: Write the failing test**

```js
// tests/exam-panel-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../exam-panel-core.js');

test('a datetime-local value is read as Moscow time, whatever the machine zone is', () => {
  assert.equal(P.moscowInputToTs('2026-10-09T18:00'), 1791558000);          // 15:00 UTC
  assert.equal(P.moscowInputToTs('2026-10-10T00:05'), 1791579900);
  assert.equal(P.moscowInputToTs('garbage'), null);
  assert.equal(P.moscowInputToTs(''), null);
});

test('tsToMoscowInput is the inverse', () => {
  assert.equal(P.tsToMoscowInput(1791558000), '2026-10-09T18:00');
  assert.equal(P.tsToMoscowInput(1791579900), '2026-10-10T00:05');
  assert.equal(P.moscowInputToTs(P.tsToMoscowInput(1798750800)), 1798750800);
});

test('activitySummary counts away intervals and answer changes relative to the start', () => {
  const start = 1000;
  const log = [[1060, 'a', '1', '5'], [1100, 'w', '1', 30], [1500, 'a', '2', '0,6'], [1520, 'a', '2', '0,5'],
    [2000, 'w', '3', 200], [2100, 'a', '1', '6']];
  const s = P.activitySummary(log, start);
  assert.deepEqual(s.away, { count: 2, totalSec: 230, longest: { sec: 200, n: '3' } });
  assert.deepEqual(s.tasks['1'], { changes: 2, firstSec: 60, lastSec: 1100 });
  assert.deepEqual(s.tasks['2'], { changes: 2, firstSec: 500, lastSec: 520 });
});

test('activitySummary copes with an empty or missing log', () => {
  assert.deepEqual(P.activitySummary(null, 0), { away: { count: 0, totalSec: 0, longest: null }, tasks: {} });
  assert.deepEqual(P.activitySummary([], 0).tasks, {});
});

test('fmtSec', () => {
  assert.equal(P.fmtSec(65), '1:05');
  assert.equal(P.fmtSec(3725), '1:02:05');
  assert.equal(P.fmtSec(0), '0:00');
});

test('every phase the server can return has a label', () => {
  for (const p of ['scheduled', 'open', 'photos', 'submitted', 'checked', 'missed']) assert.ok(P.PHASE_TEXT[p], p);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/exam-panel-core.test.mjs`
Expected: FAIL, `Cannot find module '../exam-panel-core.js'`.

- [ ] **Step 3: Write the module**

```js
/* Assigned mock exams, teacher panel — pure helpers shared with the tests
   (node: require, browser: window.ExamPanelCore). No DOM here. */
(function (root) {
  'use strict';

  // The panel always works in Moscow time (UTC+3 all year), whatever the browser zone is.
  function moscowInputToTs(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s || '');
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000) - 10800;
  }

  function tsToMoscowInput(ts) {
    const d = new Date((ts + 10800) * 1000), p = (x) => String(x).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  /* The server journal: [ts,"a",n,text] — an answer changed; [ts,"w",n,seconds] — the
     page was hidden / lost focus. Facts for the teacher, not proof of anything. */
  function activitySummary(log, start) {
    const away = { count: 0, totalSec: 0, longest: null }, tasks = {};
    (log || []).forEach(function (e) {
      const t = e[0], kind = e[1], n = String(e[2]), v = e[3];
      if (kind === 'w') {
        away.count++; away.totalSec += v;
        if (!away.longest || v > away.longest.sec) away.longest = { sec: v, n: n };
      } else if (kind === 'a') {
        const k = tasks[n] || (tasks[n] = { changes: 0, firstSec: t - start, lastSec: t - start });
        k.changes++; k.lastSec = t - start;
      }
    });
    return { away: away, tasks: tasks };
  }

  function fmtSec(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = (x) => String(x).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  const PHASE_TEXT = { scheduled: 'назначен', open: 'идёт', photos: 'фото', submitted: 'ждёт проверки', checked: 'проверен', missed: 'пропущен' };

  const api = { moscowInputToTs: moscowInputToTs, tsToMoscowInput: tsToMoscowInput, activitySummary: activitySummary,
    fmtSec: fmtSec, PHASE_TEXT: PHASE_TEXT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamPanelCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run all unit tests**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add exam-panel-core.js tests/exam-panel-core.test.mjs
git commit -m "Add exam-panel-core: Moscow time input, activity summary, phase labels"
```

---

### Task 2: `exam-validate.js`, the sample fixture and `tools/exam_check.mjs`

An exam file is JSON: `{title, full?, tasks:[{n,kind,max,cond}], key:{n:{a,sol?}}}` (see the server contract in Plan 1). This validator is the gate before anything is uploaded (by the API tool of Task 4): structure, answers, safe HTML, sizes, formulas.

**Files:**
- Create: `exam-validate.js`, `tests/exam-validate.test.mjs`, `tests/fixtures/exam-sample.json`, `tools/exam-check-lib.mjs`, `tools/exam_check.mjs`

**Interfaces:**
- Produces (`ExamValidate`, Node `require('../exam-validate.js')`, browser `window.ExamValidate`):
  - `validateExam(x) -> { errors: string[], warnings: string[], stats: {short:number, long:number} }`.
  - `extractFormulas(html) -> [{tex, display}]` — `$$…$$` (display) and `$…$` (inline) segments.
- Produces `tools/exam-check-lib.mjs`: `checkExam(exam) -> { errors, warnings, stats }` — `validateExam` plus a KaTeX render of every formula (the KaTeX of the repo, `throwOnError`).
- Produces CLI: `node tools/exam_check.mjs path/to/exam.json` — prints the summary and the part 1 answers; exit code `0` when no errors, `1` otherwise.

Rules enforced (errors unless marked):
- `title` non-empty string ≤ 120 chars; `full` boolean if present.
- `tasks`: 1..40 items; `n` integers 1..40, unique; `kind` is `short` or `long`; `max` integer 1..10 (short must be exactly 1 — a part 1 task is one point); `cond` non-empty string.
- `key`: an entry for every task. Short: `a` non-empty **plain text** (no `<`/`>`), `sol` non-empty string. Long: `a` non-empty string (HTML allowed; no `sol` needed — warning if present: solutions of part 2 are not shown). Entries without a task → warning.
- Safe HTML in `cond`, `sol` and long `a`: no `<script`, `<iframe`, `<object`, `<embed`, `<link`, `<meta`, `<style`, no inline `on…=` handlers, no `javascript:`; every `<img src=…>` must be a `data:image/(png|jpeg|webp|gif|svg+xml);base64,` URI.
- Sizes: `JSON.stringify(tasks)` ≤ 4,800,000 chars and `JSON.stringify(key)` ≤ 1,900,000 (the server fields cap at 5,000,000 / 2,000,000).
- Warning when a short answer does not parse as a number and is not a short text of at most 20 characters.

- [ ] **Step 1: Write the failing test and the fixture**

`tests/fixtures/exam-sample.json`:

```json
{
  "title": "Пример пробника",
  "full": false,
  "tasks": [
    { "n": 1, "kind": "short", "max": 1, "cond": "<p>Найдите значение выражения $2+3$.</p>" },
    { "n": 2, "kind": "short", "max": 1, "cond": "<p>Решите уравнение $2x=-3$. В ответе укажите $x$.</p>" },
    { "n": 13, "kind": "long", "max": 2, "cond": "<p>Решите уравнение $$x^2=1.$$</p>" }
  ],
  "key": {
    "1": { "a": "5", "sol": "<p>$2+3=5$.</p>" },
    "2": { "a": "-1,5", "sol": "<p>$x=-\\dfrac{3}{2}$.</p>" },
    "13": { "a": "<p>$x=\\pm1$</p>" }
  }
}
```

```js
// tests/exam-validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const V = createRequire(import.meta.url)('../exam-validate.js');
const sample = () => JSON.parse(readFileSync(new URL('./fixtures/exam-sample.json', import.meta.url), 'utf8'));
const errs = (x) => V.validateExam(x).errors;

test('the sample exam is valid and counted', () => {
  const r = V.validateExam(sample());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stats, { short: 2, long: 1 });
});

test('structure errors are reported with the task number', () => {
  let x = sample(); x.title = '';
  assert.ok(errs(x).some((e) => /название/i.test(e)));
  x = sample(); x.tasks[1].n = 1;
  assert.ok(errs(x).some((e) => /повтор/i.test(e)));
  x = sample(); x.tasks[0].kind = 'medium';
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /kind/i.test(e)));
  x = sample(); x.tasks[0].max = 2;
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /1 балл/i.test(e)));
  x = sample(); x.tasks[2].max = 0;
  assert.ok(errs(x).some((e) => /задание 13/i.test(e) && /max/i.test(e)));
  x = sample(); x.tasks = [];
  assert.ok(errs(x).length > 0);
  assert.ok(errs(null).length > 0);
});

test('every task needs a key; short answers are plain text with a solution', () => {
  let x = sample(); delete x.key['2'];
  assert.ok(errs(x).some((e) => /задание 2/i.test(e) && /ключ|ответ/i.test(e)));
  x = sample(); x.key['1'].a = '<p>5</p>';
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /простым текстом/i.test(e)));
  x = sample(); x.key['1'].sol = '';
  assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /решени/i.test(e)));
  x = sample(); x.key['13'].a = '';
  assert.ok(errs(x).some((e) => /задание 13/i.test(e)));
  x = sample(); x.key['99'] = { a: '1' };
  const r = V.validateExam(x);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /99/.test(w)));
});

test('unsafe HTML is refused', () => {
  const bad = ['<script>alert(1)</script>', '<p onclick="x()">a</p>', '<a href="javascript:alert(1)">a</a>',
    '<iframe src="x"></iframe>', '<img src="https://example.com/a.png">', '<style>p{display:none}</style>', '<img src=x onerror=alert(1)>'];
  for (const html of bad) { const x = sample(); x.tasks[0].cond = html; assert.ok(errs(x).some((e) => /задание 1/i.test(e) && /html/i.test(e)), html); }
  const ok = sample(); ok.tasks[0].cond = '<p>a</p><img src="data:image/png;base64,iVBORw0KGgo=" width="10">';
  assert.deepEqual(errs(ok), []);
});

test('the size caps match the server fields', () => {
  const x = sample(); x.tasks[0].cond = '<p>' + 'a'.repeat(4_900_000) + '</p>';
  assert.ok(errs(x).some((e) => /размер/i.test(e) && /задан/i.test(e)));
  const y = sample(); y.key['1'].sol = '<p>' + 'a'.repeat(1_950_000) + '</p>';
  assert.ok(errs(y).some((e) => /размер/i.test(e) && /ключ/i.test(e)));
});

test('a part 2 solution is a warning, an odd short answer is a warning', () => {
  const x = sample(); x.key['13'].sol = '<p>x</p>'; x.key['1'].a = 'очень длинный текст ответа';
  const r = V.validateExam(x);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
});

test('extractFormulas finds inline and display formulas', () => {
  assert.deepEqual(V.extractFormulas('<p>Найдите $2+3$ и $$x^2$$ и $\\dfrac{1}{2}$.</p>'),
    [{ tex: 'x^2', display: true }, { tex: '2+3', display: false }, { tex: '\\dfrac{1}{2}', display: false }]);
  assert.deepEqual(V.extractFormulas('<p>без формул, цена 5 рублей</p>'), []);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/exam-validate.test.mjs`
Expected: FAIL, `Cannot find module '../exam-validate.js'`.

- [ ] **Step 3: Write the module**

```js
/* Validation of an assigned-exam file before upload (node: require, browser:
   window.ExamValidate). Teacher-authored HTML ends up in students' pages, so
   the safe-HTML rules here are a real gate, not a nicety. */
(function (root) {
  'use strict';

  const MAX_TASKS_JSON = 4800000, MAX_KEY_JSON = 1900000;

  // Formulas in display ($$…$$) first, so their dollars are not taken for inline ones.
  function extractFormulas(html) {
    const out = [], src = String(html || '');
    let rest = src.replace(/\$\$([\s\S]+?)\$\$/g, function (_, t) { out.push({ tex: t, display: true }); return ' '; });
    rest.replace(/\$([^$\n]+?)\$/g, function (_, t) { out.push({ tex: t, display: false }); return ' '; });
    return out;
  }

  function htmlProblem(html) {
    const s = String(html || '');
    if (/<\s*(script|iframe|object|embed|link|meta|style)\b/i.test(s)) return 'запрещённый тег';
    if (/\son[a-z]+\s*=/i.test(s)) return 'обработчик события в атрибуте';
    if (/javascript\s*:/i.test(s)) return 'ссылка javascript:';
    const imgs = s.match(/<img\b[^>]*>/gi) || [];
    for (let i = 0; i < imgs.length; i++) {
      const m = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(imgs[i]);
      if (!m || !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(m[1])) return 'картинка не data:-адресом (допустимы только встроенные)';
    }
    return '';
  }

  const isInt = (v, lo, hi) => typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi;
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

  function validateExam(x) {
    const errors = [], warnings = [], stats = { short: 0, long: 0 };
    if (!x || typeof x !== 'object' || Array.isArray(x)) { errors.push('Файл должен содержать объект с полями title, tasks и key.'); return { errors: errors, warnings: warnings, stats: stats }; }
    if (!nonEmpty(x.title) || x.title.length > 120) errors.push('Название: непустая строка до 120 символов.');
    if (x.full != null && typeof x.full !== 'boolean') errors.push('Поле full должно быть true или false.');
    if (!Array.isArray(x.tasks) || x.tasks.length < 1 || x.tasks.length > 40) { errors.push('tasks: список из 1–40 заданий.'); return { errors: errors, warnings: warnings, stats: stats }; }
    if (!x.key || typeof x.key !== 'object' || Array.isArray(x.key)) { errors.push('key: объект с ответами по номерам заданий.'); return { errors: errors, warnings: warnings, stats: stats }; }

    const seen = {};
    x.tasks.forEach(function (t, i) {
      const where = 'Задание ' + (t && t.n != null ? t.n : '#' + (i + 1)) + ': ';
      if (!t || typeof t !== 'object') { errors.push(where + 'не объект.'); return; }
      if (!isInt(t.n, 1, 40)) { errors.push(where + 'номер n должен быть целым от 1 до 40.'); return; }
      if (seen[t.n]) { errors.push(where + 'номер повторяется.'); return; }
      seen[t.n] = true;
      if (t.kind !== 'short' && t.kind !== 'long') { errors.push(where + 'kind должен быть "short" или "long".'); return; }
      t.kind === 'short' ? stats.short++ : stats.long++;
      if (!isInt(t.max, 1, 10)) errors.push(where + 'max — целое от 1 до 10.');
      else if (t.kind === 'short' && t.max !== 1) errors.push(where + 'задание первой части стоит 1 балл.');
      if (!nonEmpty(t.cond)) errors.push(where + 'условие cond не должно быть пустым.');
      else { const p = htmlProblem(t.cond); if (p) errors.push(where + 'в условии небезопасный HTML: ' + p + '.'); }

      const k = x.key[String(t.n)];
      if (!k || typeof k !== 'object') { errors.push(where + 'нет ключа с ответом.'); return; }
      if (!nonEmpty(k.a)) { errors.push(where + 'пустой ответ a.'); return; }
      if (t.kind === 'short') {
        if (/[<>]/.test(k.a)) errors.push(where + 'ответ первой части нужно записать простым текстом, без тегов.');
        else if (!/^-?\d+([.,]\d+)?$/.test(k.a.trim().replace(/\u2212/g, '-')) && k.a.trim().length > 20) warnings.push(where + 'необычный ответ «' + k.a.slice(0, 30) + '» — проверь, что ученик сможет так ввести.');
        if (!nonEmpty(k.sol)) errors.push(where + 'нет решения sol (к первой части решения обязательны).');
        else { const p = htmlProblem(k.sol); if (p) errors.push(where + 'в решении небезопасный HTML: ' + p + '.'); }
      } else {
        const p = htmlProblem(k.a); if (p) errors.push(where + 'в ответе небезопасный HTML: ' + p + '.');
        if (k.sol != null && k.sol !== '') warnings.push(where + 'решение второй части не показывается ученику, оно будет проигнорировано.');
      }
    });
    Object.keys(x.key).forEach(function (n) { if (!seen[n]) warnings.push('В key есть ответ для задания ' + n + ', а самого задания нет.'); });

    if (JSON.stringify(x.tasks).length > MAX_TASKS_JSON) errors.push('Размер условий заданий больше допустимого (картинки лучше ужать).');
    if (JSON.stringify(x.key).length > MAX_KEY_JSON) errors.push('Размер ключа (ответы и решения) больше допустимого.');
    return { errors: errors, warnings: warnings, stats: stats };
  }

  const api = { validateExam: validateExam, extractFormulas: extractFormulas };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamValidate = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run all unit tests**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass. If a size test is slow or the `warnings.length === 2` test is off by one, fix the module, not the test (the test pins the rules written above).

- [ ] **Step 5: Write the library and the CLI**

```js
// tools/exam-check-lib.mjs — validation plus formula rendering, shared by exam_check.mjs and exam_api.mjs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const V = require(join(ROOT, 'exam-validate.js'));
const katex = require(join(ROOT, 'katex/katex.min.js'));

export function checkExam(exam) {
  const r = V.validateExam(exam), errors = r.errors.slice(), warnings = r.warnings.slice();
  if (!errors.length) {
    const bad = (where, html) => V.extractFormulas(html).forEach((f) => {
      try { katex.renderToString(f.tex, { throwOnError: true, displayMode: f.display }); }
      catch (e) { errors.push(where + ': формула «' + f.tex.slice(0, 40) + '» не рисуется (' + String(e.message).split('\n')[0] + ')'); }
    });
    exam.tasks.forEach((t) => {
      const k = exam.key[String(t.n)];
      bad('Задание ' + t.n + ', условие', t.cond);
      if (t.kind === 'short') bad('Задание ' + t.n + ', решение', k.sol); else bad('Задание ' + t.n + ', ответ', k.a);
    });
  }
  return { errors: errors, warnings: warnings, stats: r.stats };
}
```

```js
// tools/exam_check.mjs — checks an exam file before it is uploaded:
//   node tools/exam_check.mjs ~/math-source/exams/proba-1/exam.json
// Exit code 1 when there are errors.
import { readFileSync } from 'node:fs';
import { checkExam } from './exam-check-lib.mjs';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/exam_check.mjs <exam.json>'); process.exit(2); }
let exam;
try { exam = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('Cannot read JSON: ' + e.message); process.exit(1); }

const r = checkExam(exam);
console.log('«' + exam.title + '»: ' + r.stats.short + ' заданий первой части, ' + r.stats.long + ' второй' + (exam.full ? ', полный вариант' : ''));
console.log('Ответы первой части (сверь с исходником):');
(exam.tasks || []).filter((t) => t.kind === 'short').forEach((t) => console.log('  ' + t.n + ': ' + ((exam.key || {})[String(t.n)] || {}).a));
r.warnings.forEach((w) => console.log('ВНИМАНИЕ: ' + w));
r.errors.forEach((e) => console.log('ОШИБКА: ' + e));
console.log(r.errors.length ? '\nНе загружать: ' + r.errors.length + ' ошибок.' : '\nОшибок нет, можно загружать.');
process.exit(r.errors.length ? 1 : 0);
```

- [ ] **Step 6: Run the CLI on the fixture and on a broken copy**

```bash
node tools/exam_check.mjs tests/fixtures/exam-sample.json
echo "exit=$?"
sed 's/x^2=1/x^2=\\\\badmacro{1}/' tests/fixtures/exam-sample.json > "$TMPDIR/broken.json" 2>/dev/null || true
node tools/exam_check.mjs "$TMPDIR/broken.json"; echo "exit=$?"
```

Expected: the first run lists answers `1: 5`, `2: -1,5`, ends with "Ошибок нет, можно загружать." and `exit=0`. The broken copy reports an "ОШИБКА: Задание 13, условие: формула … не рисуется" line and `exit=1`. (If `$TMPDIR` is unset use a file in the scratchpad directory.)

- [ ] **Step 7: Commit**

```bash
git add exam-validate.js tests/exam-validate.test.mjs tests/fixtures/exam-sample.json tools/exam-check-lib.mjs tools/exam_check.mjs
git commit -m "Add exam-validate and tools/exam_check.mjs: gate for exam files before upload"
```

---

### Task 3: Panel data, the "Пробники" tab and the lists

**Files:**
- Modify: `teacher.html` (`all()` ~line 33, `load()` ~line 289, `tabs()` ~line 333, `route()` ~line 527, click handler ~line 540, script tags ~line 237, CSS), `sw.js`

**Interfaces:**
- Consumes: `ExamCore` (root `exam-core.js`, Plan 1), `ExamPanelCore`.
- Produces in `teacher.html`: `data.exams`, `data.asg`, `data.photos`; helpers `nowS()`, `examOf(id)`, `nameOf(userId)`, `phaseOf(a)`, `asgOfUser(uid)`, `renderExams()`; route `#/exams`; tab "Пробники".

- [ ] **Step 1: Script tags, `all()` with a field list, loading**

Next to the other `<script src=…>` lines (~237) add:

```html
<script src="exam-core.js"></script>
<script src="exam-panel-core.js"></script>
```

Change `all` to accept a field list:

```js
async function all(c,filter,fields){
  const out=[];
  for(let page=1;;page++){
    const r=await api(`/collections/${c}/records?perPage=500&page=${page}&skipTotal=1&sort=created`+(filter?'&filter='+encodeURIComponent(filter):'')+(fields?'&fields='+encodeURIComponent(fields):''));
    if(r.status!==200)throw new Error(c+' '+r.status);
    out.push(...r.json.items);if(r.json.items.length<500)return out;
  }}
```

In `load()` after `data={…}` is built add (tolerating a server without the exam collections):

```js
  const soft=p=>p.catch(e=>{if(e.message==='401')throw e;return [];});
  const [exams,asg,photos]=await Promise.all([
    soft(all('exams',null,'id,title,full,created')),
    soft(all('exam_assignments',null,'id,user,exam,start,duration,opened,finished,photos_done,settled,checked,p1,via_tg,answers,ok,part2,created')),
    soft(all('exam_photos',null,'id,assignment,user,n,file'))]);
  data.exams=exams;data.asg=asg;data.photos=photos;
```

(`all()` throws `new Error(c+' '+status)`; a `401` goes through `api()`'s own logout, which throws `Error('401')` — keep that propagating.)

- [ ] **Step 2: Helpers, tab and the list screen**

Add after the `fmtDay` helper:

```js
// ---- пробники от преподавателя ----
const nowS=()=>Math.floor(Date.now()/1000);
const examOf=id=>(data.exams||[]).find(e=>e.id===id);
const nameOf=uid=>{const u=data.userOf[uid];return u?(u.name||u.login):'—';};
const phaseOf=a=>ExamCore.phase({start:a.start,duration:a.duration,opened:a.opened,finished:a.finished,photos_done:a.photos_done,checked:a.checked},nowS());
const asgOfUser=uid=>(data.asg||[]).filter(a=>a.user===uid);
const photosOfAsg=id=>(data.photos||[]).filter(p=>p.assignment===id);
const fmtTs=ts=>fmtDate(ts*1000);
const chipFor=ph=>`<span class="chip ex-${ph}">${ExamPanelCore.PHASE_TEXT[ph]}</span>`;
```

Change the `tabs` function to three tabs (the badge counts works waiting for a check):

```js
const tabs=cur=>{const wait=(data.asg||[]).filter(a=>phaseOf(a)==='submitted').length;
  return `<div class="tabs">
  <a href="#/" class="${cur==='s'?'on':''}">Ученики <span>${data.students.length}</span></a>
  <a href="#/leads" class="${cur==='l'?'on':''}">Из канала <span>${data.leads.length}</span></a>
  <a href="#/exams" class="${cur==='x'?'on':''}">Пробники <span>${wait||(data.exams||[]).length}</span></a></div>`;};
```

Add `renderExams` (the three sections; actions are wired in later tasks, the buttons exist now so the markup is final):

```js
function asgRow(a,acts){
  const e=examOf(a.exam),ph=phaseOf(a),ps=photosOfAsg(a.id).length;
  return `<tr class="row" data-act="open-check" data-id="${a.id}">
    <td><span class="name">${esc(nameOf(a.user))}</span></td>
    <td>${esc(e?e.title:'—')}</td><td>${fmtTs(a.start)}</td><td>${chipFor(ph)}</td>
    <td class="num">${a.settled?`${a.p1}`:'—'}</td>
    <td class="hide-m">${ps?ps+' фото':'—'}</td>
    <td class="acts-cell">${acts||''}</td></tr>`;
}
function renderExams(){
  const A=data.asg||[],by=ph=>A.filter(a=>phaseOf(a)===ph).sort((x,y)=>y.start-x.start);
  const table=(rows,withActs)=>rows.length?`<div class="table-wrap"><table>
    <thead><tr><th>Ученик</th><th>Пробник</th><th>Начало</th><th>Статус</th><th class="num">1 часть</th><th class="hide-m">Вторая часть</th><th></th></tr></thead>
    <tbody>${rows.map(a=>asgRow(a,withActs?`<button class="btn quiet" data-act="move" data-id="${a.id}">Перенести</button> <button class="btn danger" data-act="cancel" data-id="${a.id}">Отменить</button>`:'')).join('')}</tbody></table></div>`:'';
  const toCheck=by('submitted'),live=[...by('open'),...by('photos'),...by('scheduled')],missed=by('missed'),done=by('checked').slice(0,20);
  const sec=(title,html,empty)=>`<div class="panel"><h3>${title}</h3>${html||`<p class="muted">${empty}</p>`}</div>`;
  app.innerHTML=`${tabs('x')}
    <h2>Пробники</h2>
    <p class="lead">Свои пробники лежат в закрытом каталоге. Ученик видит пробник только после того, как ты назначил его на время.</p>
    ${sec('Ждут проверки',table(toCheck),'Работ на проверку нет.')}
    ${sec('Назначены и идут',table(live,true),'Ничего не назначено.')}
    ${missed.length?sec('Пропущены',table(missed,true),''):''}
    <div class="panel"><h3>Каталог</h3>
      ${(data.exams||[]).length?`<div class="list">${data.exams.map(e=>`<div class="it"><span><b>${esc(e.title)}</b>${e.full?' <span class="chip">полный вариант</span>':''} <span class="muted">· загружен ${fmtDay(pbTime(e.created))}</span></span>
        <span><button class="btn" data-act="assign" data-exam="${e.id}">Назначить</button></span></div>`).join('')}</div>`
        :'<p class="muted">Каталог пуст. Пробники готовятся и загружаются через Claude Code (навык assigned-exam).</p>'}
      <p class="muted">Новый пробник: пришли исходник в чат Claude Code — он соберёт файл, сверит ответы, покажет предпросмотр и загрузит сюда.</p>
    </div>
    ${done.length?sec('Проверены (последние 20)',table(done),''):''}`;
}
```

In `route()` add `else if(location.hash==='#/exams')renderExams();` before the final `else renderList();`.

In the click handler, rows with `data-act="open-check"` must open the check page (built in Task 6); to stop a button inside the row from also opening it, the existing rule already skips: the handler reads `e.target.closest('[data-act]')` — a button's own `data-act` wins. Add to the action chain: `else if(a==='open-check')location.hash='#/check/'+id;` (the check page itself comes in Task 6; until then the hash route falls through to `renderList`).

CSS (tokens only):

```css
  .chip.ex-open,.chip.ex-photos{background:var(--accent-soft);color:var(--accent);}
  .chip.ex-submitted{background:var(--warn-soft);color:var(--warn-text);}
  .chip.ex-checked{background:var(--ok-soft);color:var(--ok-text);}
  .chip.ex-missed{background:var(--err-soft);color:var(--err-text);}
  .acts-cell{white-space:nowrap;text-align:right;}
  .list .it{display:flex;justify-content:space-between;gap:var(--s3);align-items:center;flex-wrap:wrap;}
```

(Check the actual token names in `teacher.html` `:root` — `--warn-soft`, `--ok-soft`, `--err-soft` and `-text` variants; use the ones that exist, add none.)

`sw.js`: add `'./exam-core.js', './exam-panel-core.js'` to `SHELL`; bump `VERSION` (strictly greater than master's — run `git fetch origin && git show origin/master:sw.js | head -6` and compare, and with Plan 2 merged or not).

- [ ] **Step 2b: Verify in the browser on the local stack**

1. `START_IN=-5 DURATION=300 node tools/exam-dev-stack.mjs`, serve the site (`python3 -m http.server 3456`), open the **teacher link** it prints.
2. The tab "Пробники" shows the assignment under "Назначены и идут" with the chip "идёт", the catalog lists "Тестовый пробник" with a "Назначить" button (the sheet comes in Task 5). The other tabs (Ученики, Из канала) work as before.
3. Stop the stack and open the panel against a server that returns 404 for the exam collections? Simulate: in the console run `data.exams=[];data.asg=[];data.photos=[];renderExams()` — the page renders with empty states and no exceptions. Also make sure `load()` itself survives a 404: temporarily rename a collection in the dev stack is overkill; instead read the code path and confirm `soft()` swallows non-401 errors.
4. Console clean; phone width OK.

- [ ] **Step 3: Run the unit suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add teacher.html sw.js
git commit -m "Panel: exam data load, the Пробники tab with assigned, missed and checked lists"
```

---

### Task 4: Command-line tools and the `assigned-exam` skill (exams are prepared in Claude Code)

The owner uploads exams through a chat with Claude Code, not through the panel. This task builds the tools and the skill that make that work the same every time.

**Files:**
- Create: `tools/exam-cli-lib.mjs`, `tests/exam-cli-lib.test.mjs`, `tools/exam_api.mjs`, `tools/exam_preview.mjs`, `.claude/skills/assigned-exam/SKILL.md`

**Interfaces:**
- Consumes: `checkExam` (Task 2), `ExamCore` (root `exam-core.js`), `ExamPanelCore.moscowInputToTs`.
- Produces `tools/exam-cli-lib.mjs`: `parseWhen("2026-10-09 18:00" | "2026-10-09T18:00") -> unix seconds | null` (Moscow time), `pickOne(items, query, getName) -> {item} | {error}` (case-insensitive: an exact name wins, otherwise a unique substring; none or several → an error text listing the candidates), `linkFromText(text) -> {login, secret} | null` (reads `#/login/<login>.<secret>`).
- Produces `node tools/exam_api.mjs <command>` (options `--api <url>` default `https://api.kirillnyun.space/api`, `--link-file <path>` default `~/ege-teacher-link.txt`):
  - `exams` — the catalog; `students` — accounts that can be assigned (name, login, student or "из канала"); `status` — all assignments with phase, first-part score and photo count.
  - `upload <exam.json>` — runs `checkExam` first (refuses on errors), refuses a title that already exists, then creates the exam. Does not notify anybody.
  - `assign --student <name> --exam <title> --at "YYYY-MM-DD HH:MM" [--minutes 235] [--yes]` — resolves names with `pickOne`, prints the plan ("Назначу: … Ученику уйдёт сообщение в Telegram."), and without `--yes` exits with code 3 without doing anything.
  - `delete --exam <title> [--yes]` — removes an exam that was never assigned (the server refuses otherwise); without `--yes` it only prints what it would do.
  - Never prints the link file, the secret or the token.
- Produces `node tools/exam_preview.mjs <exam.json> [out.html]` — a self-contained static page (default `preview.html` next to the JSON) with all tasks, answers and solutions, formulas rendered with the repo's KaTeX, and a table of the part 1 answers on top.

- [ ] **Step 1: Write the failing test**

```js
// tests/exam-cli-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, pickOne, linkFromText } from '../tools/exam-cli-lib.mjs';

test('parseWhen reads Moscow wall time in both spellings', () => {
  assert.equal(parseWhen('2026-10-09 18:00'), 1791558000);
  assert.equal(parseWhen('2026-10-09T18:00'), 1791558000);
  assert.equal(parseWhen('2026-10-10 00:05'), 1791579900);
  assert.equal(parseWhen('9 октября'), null);
  assert.equal(parseWhen(''), null);
});

test('pickOne prefers an exact name, accepts a unique fragment, explains the rest', () => {
  const people = [{ name: 'Иван Петров' }, { name: 'Иван Сидоров' }, { name: 'Мария' }];
  const name = (p) => p.name;
  assert.equal(pickOne(people, 'мария', name).item.name, 'Мария');
  assert.equal(pickOne(people, 'Иван Петров', name).item.name, 'Иван Петров');
  assert.equal(pickOne(people, 'сидор', name).item.name, 'Иван Сидоров');
  const many = pickOne(people, 'иван', name);
  assert.ok(many.error && /Иван Петров/.test(many.error) && /Иван Сидоров/.test(many.error));
  const none = pickOne(people, 'Пётр', name);
  assert.ok(none.error);
});

test('linkFromText finds the login pair in a pasted teacher link', () => {
  assert.deepEqual(linkFromText('https://x.github.io/math/teacher.html#/login/teacher.AbC123\n'), { login: 'teacher', secret: 'AbC123' });
  assert.equal(linkFromText('nothing here'), null);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/exam-cli-lib.test.mjs`
Expected: FAIL, `Cannot find module '../tools/exam-cli-lib.mjs'`.

- [ ] **Step 3: Write the library**

```js
// tools/exam-cli-lib.mjs — pure helpers of tools/exam_api.mjs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const P = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'exam-panel-core.js'));

// "2026-10-09 18:00" or "2026-10-09T18:00", Moscow time.
export const parseWhen = (s) => P.moscowInputToTs(String(s || '').trim().replace(' ', 'T'));

// An exact (case-insensitive) name wins; otherwise a unique fragment; otherwise an explanation.
export function pickOne(items, query, getName) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { error: 'Не указано, кого искать.' };
  const exact = items.filter((x) => getName(x).toLowerCase() === q);
  if (exact.length === 1) return { item: exact[0] };
  const part = items.filter((x) => getName(x).toLowerCase().includes(q));
  if (part.length === 1) return { item: part[0] };
  if (!part.length) return { error: 'Не нашёл «' + query + '». Есть: ' + items.map(getName).join(', ') + '.' };
  return { error: 'Подходит несколько: ' + part.map(getName).join(', ') + '. Уточни.' };
}

export function linkFromText(text) {
  const m = /#\/login\/([a-z0-9_-]+)\.([A-Za-z0-9]+)/.exec(String(text || ''));
  return m ? { login: m[1], secret: m[2] } : null;
}
```

- [ ] **Step 4: Run the unit tests**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 5: Write the API tool**

```js
// Owner's tool for Claude Code: work with assigned exams on the server.
//   node tools/exam_api.mjs exams | students | status
//   node tools/exam_api.mjs upload <exam.json>
//   node tools/exam_api.mjs assign --student "Иван" --exam "Пробник 1" --at "2026-10-09 18:00" [--minutes 235] --yes
//   node tools/exam_api.mjs delete --exam "Пробник 1" --yes
// Logs in with the teacher link file; never prints the link, the secret or the token.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkExam } from './exam-check-lib.mjs';
import { parseWhen, pickOne, linkFromText } from './exam-cli-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Core = require(join(ROOT, 'exam-core.js'));
const P = require(join(ROOT, 'exam-panel-core.js'));

const argv = process.argv.slice(2), cmd = argv.shift();
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes('--' + name);
const API = opt('api', 'https://api.kirillnyun.space/api');
const LINK = opt('link-file', join(homedir(), 'ege-teacher-link.txt'));
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

let token = '';
async function call(method, path, body) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function login() {
  let text; try { text = readFileSync(LINK, 'utf8'); } catch { die('Не нашёл файл со ссылкой преподавателя (' + LINK + ').'); }
  const l = linkFromText(text);
  if (!l) die('В файле со ссылкой нет ссылки вида #/login/<логин>.<секрет>.');
  const r = await call('POST', '/collections/users/auth-with-password', { identity: l.login, password: l.secret });
  if (r.status !== 200 || r.json.record.role !== 'teacher') die('Не удалось войти как преподаватель (ответ сервера ' + r.status + ').');
  token = r.json.token;
}
async function all(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await call('GET', path + (path.includes('?') ? '&' : '?') + 'perPage=500&page=' + page + '&skipTotal=1');
    if (r.status !== 200) die('Сервер ответил ' + r.status + ' на ' + path.split('?')[0] + '.');
    out.push(...r.json.items); if (r.json.items.length < 500) return out;
  }
}
const fmt = (ts) => new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const exams = () => all('/collections/exams/records?fields=id,title,full,created');
async function people() {
  const users = await all('/collections/users/records?filter=' + encodeURIComponent('role="student"') + '&fields=id,name,login,active');
  const leads = await call('GET', '/ege/leads');
  const prof = {}; (leads.json && leads.json.items || []).forEach((p) => { prof[p.user] = p; });
  return users.filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name || u.login, login: u.login, lead: !!prof[u.id] && !prof[u.id].mine }));
}

if (!['exams', 'students', 'status', 'upload', 'assign', 'delete'].includes(cmd)) {
  die('Команды: exams | students | status | upload <exam.json> | assign --student --exam --at [--minutes] [--yes] | delete --exam [--yes]', 2);
}
await login();

if (cmd === 'exams') {
  (await exams()).forEach((e) => console.log('• ' + e.title + (e.full ? ' (полный вариант)' : '')));
} else if (cmd === 'students') {
  (await people()).forEach((p) => console.log('• ' + p.name + ' (' + p.login + ')' + (p.lead ? ' — из канала' : '')));
} else if (cmd === 'status') {
  const [asg, ex, ph, ppl] = await Promise.all([all('/collections/exam_assignments/records?fields=id,user,exam,start,duration,opened,finished,photos_done,settled,checked,p1'),
    exams(), all('/collections/exam_photos/records?fields=id,assignment'), people()]);
  const now = Math.floor(Date.now() / 1000);
  asg.sort((a, b) => b.start - a.start).forEach((a) => {
    const phase = Core.phase(a, now), who = (ppl.find((p) => p.id === a.user) || {}).name || '—', title = (ex.find((e) => e.id === a.exam) || {}).title || '—';
    console.log('• ' + who + ' · ' + title + ' · ' + fmt(a.start) + ' · ' + P.PHASE_TEXT[phase] + (a.settled ? ' · 1 часть: ' + a.p1 : '') + ' · фото: ' + ph.filter((x) => x.assignment === a.id).length);
  });
  if (!asg.length) console.log('Назначений нет.');
} else if (cmd === 'upload') {
  const file = argv[0]; if (!file) die('Укажи файл: upload <exam.json>', 2);
  let exam; try { exam = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { die('Не прочитал JSON: ' + e.message); }
  const r = checkExam(exam);
  r.warnings.forEach((w) => console.log('ВНИМАНИЕ: ' + w));
  if (r.errors.length) { r.errors.forEach((e) => console.log('ОШИБКА: ' + e)); die('Не загружаю: есть ошибки.'); }
  if ((await exams()).some((e) => e.title === exam.title)) die('Пробник с названием «' + exam.title + '» уже есть. Смени название.');
  const res = await call('POST', '/collections/exams/records', { title: exam.title, full: !!exam.full, tasks: exam.tasks, key: exam.key });
  if (res.status === 413) die('Сервер отклонил размер файла (413): на сервере не применена настройка Caddy из backend/README.md.');
  if (res.status !== 200) die('Сервер ответил ' + res.status + '.');
  console.log('Загружено: «' + exam.title + '» (' + r.stats.short + ' + ' + r.stats.long + ' заданий). Ученики его не видят, пока ты не назначишь.');
} else if (cmd === 'assign') {
  const [list, ppl] = await Promise.all([exams(), people()]);
  const s = pickOne(ppl, opt('student'), (p) => p.name), e = pickOne(list, opt('exam'), (x) => x.title);
  if (s.error) die('Ученик: ' + s.error); if (e.error) die('Пробник: ' + e.error);
  const start = parseWhen(opt('at')); if (!start) die('Время: укажи --at "ГГГГ-ММ-ДД ЧЧ:ММ" (по Москве).');
  const minutes = Number(opt('minutes', '235'));
  if (!(minutes >= 1 && minutes <= 360)) die('Минут на работу: от 1 до 360.');
  console.log('Назначу: ' + s.item.name + ' · «' + e.item.title + '» · ' + fmt(start) + ' (МСК) · ' + minutes + ' мин.');
  console.log('Ученику сразу уйдёт сообщение в Telegram, потом напоминание за час.');
  if (start < Math.floor(Date.now() / 1000)) console.log('ВНИМАНИЕ: это время уже прошло, пробник откроется сразу.');
  if (!flag('yes')) die('Ничего не сделано. Подтверди и добавь --yes.', 3);
  const r = await call('POST', '/ege/exams/assign', { user: s.item.id, exam: e.item.id, start, duration: Math.round(minutes * 60) });
  if (r.status === 400) die('Сервер отказал: такой пробник этому ученику уже назначен, или данные не подошли.');
  if (r.status !== 200) die('Сервер ответил ' + r.status + '.');
  console.log('Назначено. Ученик получил сообщение.');
} else if (cmd === 'delete') {
  const e = pickOne(await exams(), opt('exam'), (x) => x.title);
  if (e.error) die('Пробник: ' + e.error);
  console.log('Удалю из каталога: «' + e.item.title + '» (если его ни разу не назначали).');
  if (!flag('yes')) die('Ничего не сделано. Подтверди и добавь --yes.', 3);
  const r = await call('DELETE', '/collections/exams/records/' + e.item.id);
  if (r.status !== 204 && r.status !== 200) die(r.status === 400 ? 'Нельзя: пробник уже назначали ученикам.' : 'Сервер ответил ' + r.status + '.');
  console.log('Удалено.');
}
```

- [ ] **Step 6: Write the preview tool**

```js
// Static preview of an exam for the owner's review (no server needed):
//   node tools/exam_preview.mjs ~/math-source/exams/proba-1/exam.json   -> preview.html next to the file
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const katex = require(join(ROOT, 'katex/katex.min.js'));

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/exam_preview.mjs <exam.json> [out.html]'); process.exit(2); }
const exam = JSON.parse(readFileSync(file, 'utf8'));
const out = process.argv[3] || join(dirname(resolve(file)), 'preview.html');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const render = (html) => String(html || '')
  .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => katex.renderToString(t, { throwOnError: false, displayMode: true }))
  .replace(/\$([^$\n]+?)\$/g, (_, t) => katex.renderToString(t, { throwOnError: false }));

const short = exam.tasks.filter((t) => t.kind === 'short'), long = exam.tasks.filter((t) => t.kind === 'long');
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>${esc(exam.title)} — предпросмотр</title>
<link rel="stylesheet" href="${pathToFileURL(join(ROOT, 'katex/katex.min.css')).href}">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:24px}.t{border:1px solid #ddd;border-radius:12px;padding:16px;margin:16px 0}.k{background:#f4f7fb;border-radius:8px;padding:8px 12px;margin-top:8px}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 10px}.m{color:#666;font-size:14px}img{max-width:100%}</style>
<h1>${esc(exam.title)}${exam.full ? ' <span class="m">· полный вариант</span>' : ''}</h1>
<p class="m">Первая часть: ${short.length}, вторая: ${long.length}. Так видишь только ты; ученик увидит ответы и решения после сдачи.</p>
<h2>Ответы первой части (сверь с источником)</h2>
<table><tr><th>Задание</th>${short.map((t) => '<th>' + t.n + '</th>').join('')}</tr><tr><td>Ответ</td>${short.map((t) => '<td>' + esc((exam.key[String(t.n)] || {}).a) + '</td>').join('')}</tr></table>
${exam.tasks.map((t) => { const k = exam.key[String(t.n)] || {};
  return `<div class="t"><b>Задание ${t.n}</b> <span class="m">· ${t.kind === 'short' ? 'первая часть' : 'вторая часть, максимум ' + t.max}</span>
  <div>${render(t.cond)}</div>
  <div class="k"><b>Ответ:</b> ${t.kind === 'short' ? esc(k.a) : render(k.a)}</div>
  ${t.kind === 'short' && k.sol ? '<div class="k"><b>Решение</b><div>' + render(k.sol) + '</div></div>' : ''}</div>`; }).join('')}
</html>`;
writeFileSync(out, html);
console.log('Предпросмотр: ' + out);
```

- [ ] **Step 7: Verify the tools against the dev stack and the fixture**

1. `node tools/exam_preview.mjs tests/fixtures/exam-sample.json "$TMPDIR/preview.html"` then open the file (`open "$TMPDIR/preview.html"`, or the browser pane with a `file://` URL): formulas rendered, answers table on top.
2. Start `START_IN=3600 node tools/exam-dev-stack.mjs`, write its teacher link into a throwaway file (`printf '%s\n' '<printed teacher link>' > "$TMPDIR/link.txt"`; do not echo it elsewhere) and run, with `--api http://127.0.0.1:8090/api --link-file "$TMPDIR/link.txt"`:
   - `exams` lists "Тестовый пробник"; `students` lists "Тест Ученик (stud1)".
   - `upload tests/fixtures/exam-sample.json` → "Загружено…"; the same again → "уже есть".
   - `assign --student "тест" --exam "Пример" --at "2026-12-01 18:00"` prints the plan and exits with code 3, nothing assigned; the same with `--yes` assigns; `status` shows it as "назначен".
   - `assign --student "т"` (several or none) prints the explanation; a bad `--at` is refused.
   - `delete --exam "Пример" --yes` fails while assigned ("Нельзя…"), works for an unassigned one.
3. Check that no command printed the link, the secret or a token (scroll the output).

- [ ] **Step 8: Write the skill**

`.claude/skills/assigned-exam/SKILL.md`:

```markdown
---
name: assigned-exam
description: Prepare, upload, assign and check the owner's own mock exams (пробники) for the trainer. Use when Кирилл sends a source of a new пробник (PDF, Word, text, photos), asks to load it, assign it to a student for a time, or asks what is assigned / waiting for a check.
---

# Assigned mock exams (пробники от преподавателя)

The trainer has a hidden catalog of Кирилл's own exams on the server. He assigns one exam to one
student for a date and time; the student writes it inside a hard window, photos of part 2 go to the
site or to the bot, Кирилл checks part 2 in the panel. Design: `docs/superpowers/specs/2026-10-05-assigned-exams-design.md`.
Your job in this skill: turn his source into a correct `exam.json`, get it approved, upload it,
and assign it when he asks.

## Hard rules

- The repository is public. Never put exam statements, answers, solutions or figures into the repo
  or a commit. Work in `~/math-source/exams/<slug>/` (slug: `proba-<n>` or `YYYY-MM-DD-<name>`).
- Never print, log or paste the contents of `~/ege-teacher-link.txt`, a token or any secret. The tools
  read the file themselves.
- Answers are never invented or taken on trust: compute every part 1 answer yourself (Python/sympy)
  and compare with the source. A mismatch goes to Кирилл as a table, you do not silently pick one.
- Uploading changes nothing for students. **Assigning sends a Telegram message to a student**
  (red zone): name the student, the exam and the time, wait for an explicit yes, only then run it with `--yes`.
- Times are Moscow time.

## Workflow

1. **Collect the source** into `~/math-source/exams/<slug>/` (`source.pdf|docx|md|jpg…`). Ask only for
   what is missing: exam title, whether it is a full variant (`full: true` only when it has the full
   task set that matches the 0..33 test-score scale — ask), and the answers if the source has none.
2. **Typeset `exam.json`** next to the source:
   ```json
   { "title": "Пробник 3", "full": false,
     "tasks": [ {"n": 1, "kind": "short", "max": 1, "cond": "<p>Найдите $2+3$.</p>"},
                {"n": 13, "kind": "long", "max": 2, "cond": "<p>Решите уравнение …</p>"} ],
     "key": { "1": {"a": "5", "sol": "<p>…</p>"}, "13": {"a": "<p>$x=\\pm1$</p>"} } }
   ```
   - `kind: short` = part 1, one point, answer `a` is **plain text** exactly as a student types it
     (decimal comma allowed, minus as `-`), plus a solution `sol`.
   - `kind: long` = part 2, `max` from the criteria, `a` is HTML, **no solution** (not shown).
   - Formulas in `$…$` / `$$…$$`; HTML only `p`, `b`, `i`, lists, tables, `sup/sub`; no scripts, no
     handlers, figures only as `data:image/(png|jpeg|webp);base64,…` (crop and shrink to ≤ ~900 px
     wide with Pillow; check the total size).
   - Solutions of part 1 follow the approved format: «Идея» → numbered one-action steps with short
     explanations → «Где ошибаются» (only if a typical mistake really exists) → answer. Plain text with `$…$`,
     no images of formulas.
3. **Verify.** Recompute every part 1 answer independently. Show Кирилл a table: task · source answer ·
   your answer · match. Resolve every mismatch with him before going on.
4. **Check:** `node tools/exam_check.mjs ~/math-source/exams/<slug>/exam.json` until "Ошибок нет".
5. **Preview:** `node tools/exam_preview.mjs …/exam.json`, then give him `open <path>/preview.html`
   as a bash block. Wait for his «ок» (or corrections, then repeat 3–5).
6. **Upload.** Production write: give him the command to run (bash block):
   `node tools/exam_api.mjs upload ~/math-source/exams/<slug>/exam.json`. After it, `node tools/exam_api.mjs exams` confirms.
   To fix an uploaded exam that was never assigned: `delete --exam "<title>" --yes`, then upload again.
7. **Assign** only when he asks ("назначь Ивану пробник на пятницу 18:00"): resolve with
   `node tools/exam_api.mjs students` / `exams`; run `assign … --at "YYYY-MM-DD HH:MM"` **without** `--yes` and show him
   the printed plan; after his explicit yes run it again with `--yes`. Ambiguous name → ask.
   Default duration is 235 minutes; change with `--minutes` if he says so.
8. **Status:** `node tools/exam_api.mjs status` answers "что назначено / ждёт проверки". Checking part 2
   itself happens in the panel: `teacher.html#/check/<assignment id>` (the bot sends him that link when a student submits).

## When something fails

- `exam_check` errors: fix the JSON, never loosen the validator.
- Upload answers 413: the Caddy body-limit step of `backend/README.md` was not applied on the server; tell Кирилл.
- Assign answers "уже назначен": that exam was already given to that student; assignments can be moved or
  canceled in the panel only before the start.
```

- [ ] **Step 9: Commit**

```bash
git add tools/exam-cli-lib.mjs tests/exam-cli-lib.test.mjs tools/exam_api.mjs tools/exam_preview.mjs .claude/skills/assigned-exam/SKILL.md
git commit -m "Add exam_api, exam_preview and the assigned-exam skill: exams are prepared in Claude Code"
```

### Task 5: Assign, move and cancel; the student-card block

**Files:**
- Modify: `teacher.html`

**Interfaces:**
- Consumes: Task 3 helpers, `ExamPanelCore.moscowInputToTs`, `tsToMoscowInput`; routes `assign`, `move`, `cancel`.
- Produces: `assignSheet({user,exam})`, `assignGo()`, `moveSheet(id)`, `moveGo(id)`, `cancelSheet(id)`, `cancelGo(id)`, `examBlock(uid)`; actions `assign`, `assign-go`, `move`, `move-go`, `cancel`, `cancel-go`.

- [ ] **Step 1: The sheets and requests**

```js
// ---- назначить, перенести, отменить ----
const fmtErr=(r,fallback)=>r.status===400?'Такой пробник этому ученику уже назначен, или данные не подошли.':r.status===409?'Пробник уже начался — перенести или отменить его нельзя.':fallback;
function personOptions(sel){
  const opt=u=>`<option value="${u.id}"${u.id===sel?' selected':''}>${esc(u.name||u.login)}</option>`;
  const students=data.students.filter(u=>u.active!==false),leads=data.leads.map(p=>data.userOf[p.user]).filter(Boolean);
  return `<optgroup label="Ученики">${students.map(opt).join('')}</optgroup>${leads.length?`<optgroup label="Из канала">${leads.map(opt).join('')}</optgroup>`:''}`;
}
function assignSheet(o){
  o=o||{};
  if(!(data.exams||[]).length){sheet(`<h3>Нет пробников</h3><p>Сначала загрузи пробник в каталог.</p><div class="acts"><button class="btn" data-act="close">Понятно</button></div>`);return;}
  const soon=ExamPanelCore.tsToMoscowInput(nowS()+86400);
  sheet(`<h3>Назначить пробник</h3>
    <label class="fld">Ученик<select id="as-user">${personOptions(o.user)}</select></label>
    <label class="fld">Пробник<select id="as-exam">${data.exams.map(e=>`<option value="${e.id}"${e.id===o.exam?' selected':''}>${esc(e.title)}</option>`).join('')}</select></label>
    <label class="fld">Начало (по Москве)<input type="datetime-local" id="as-start" value="${soon.slice(0,11)}18:00"></label>
    <label class="fld">Время на работу, минут<input type="number" id="as-dur" min="1" max="360" value="235"></label>
    <p class="muted" id="as-err" role="alert"></p>
    <div class="acts"><button class="btn quiet" data-act="close">Отмена</button><button class="btn" data-act="assign-go">Назначить</button></div>`);
}
const readWhen=()=>{
  const start=ExamPanelCore.moscowInputToTs(document.getElementById('as-start').value),min=+document.getElementById('as-dur').value;
  return(start&&min>=1&&min<=360)?{start,duration:Math.round(min*60)}:null;
};
async function assignGo(){
  const w=readWhen(),err=document.getElementById('as-err');
  if(!w){err.textContent='Проверь дату, время и длительность.';return;}
  const body={user:document.getElementById('as-user').value,exam:document.getElementById('as-exam').value,...w};
  if(body.start<nowS()&&!confirm('Это время уже прошло: пробник откроется сразу. Назначить?'))return;
  let r;try{r=await api('/ege/exams/assign',{method:'POST',body});}catch(e){if(e.message!=='401')err.textContent='Нет связи с сервером.';return;}
  if(r.status!==200){err.textContent=fmtErr(r,`Сервер ответил ${r.status}.`);return;}
  closeSheet();await refresh();
}
function moveSheet(id){
  const a=(data.asg||[]).find(x=>x.id===id);if(!a)return;
  sheet(`<h3>Перенести пробник</h3><p>${esc(nameOf(a.user))} · ${esc((examOf(a.exam)||{}).title||'')}. Сейчас: ${fmtTs(a.start)}. Ученик получит сообщение в Telegram.</p>
    <label class="fld">Новое начало (по Москве)<input type="datetime-local" id="as-start" value="${ExamPanelCore.tsToMoscowInput(a.start)}"></label>
    <label class="fld">Время на работу, минут<input type="number" id="as-dur" min="1" max="360" value="${Math.round(a.duration/60)}"></label>
    <p class="muted" id="as-err" role="alert"></p>
    <div class="acts"><button class="btn quiet" data-act="close">Отмена</button><button class="btn" data-act="move-go" data-id="${id}">Перенести</button></div>`);
}
async function moveGo(id){
  const w=readWhen(),err=document.getElementById('as-err');
  if(!w){err.textContent='Проверь дату, время и длительность.';return;}
  let r;try{r=await api(`/ege/exams/${id}/move`,{method:'POST',body:w});}catch(e){if(e.message!=='401')err.textContent='Нет связи с сервером.';return;}
  if(r.status!==200){err.textContent=fmtErr(r,`Сервер ответил ${r.status}.`);return;}
  closeSheet();await refresh();
}
function cancelSheet(id){
  const a=(data.asg||[]).find(x=>x.id===id);if(!a)return;
  sheet(`<h3>Отменить пробник?</h3><p>${esc(nameOf(a.user))} · ${esc((examOf(a.exam)||{}).title||'')} · ${fmtTs(a.start)}. Назначение исчезнет, ученик получит сообщение. Потом можно назначить заново.</p>
    <div class="acts"><button class="btn quiet" data-act="close">Не отменять</button><button class="btn danger" data-act="cancel-go" data-id="${id}">Отменить</button></div>`);
}
async function cancelGo(id){
  let r;try{r=await api(`/ege/exams/${id}/cancel`,{method:'POST'});}catch(e){return;}
  closeSheet();
  if(r.status!==200){sheet(`<h3>Не получилось</h3><p>${esc(fmtErr(r,'Сервер ответил '+r.status+'.'))}</p><div class="acts"><button class="btn" data-act="close">Понятно</button></div>`);return;}
  await refresh();
}
```

Chain in the click handler:

```js
  else if(a==='assign')assignSheet({exam:b.dataset.exam,user:b.dataset.user});
  else if(a==='assign-go')assignGo();
  else if(a==='move')moveSheet(id);
  else if(a==='move-go')moveGo(id);
  else if(a==='cancel')cancelSheet(id);
  else if(a==='cancel-go')cancelGo(id);
```

CSS: `.fld{display:flex;flex-direction:column;gap:var(--s2);margin:var(--s3) 0;font-size:var(--fs-sm);font-weight:500;}` `.fld select,.fld input{font:inherit;min-height:40px;padding:0 var(--s3);border:1px solid var(--line-strong);border-radius:var(--r-md);background:var(--surface);color:var(--ink);}`

- [ ] **Step 2: The block in the student card**

```js
function examBlock(uid){
  const rows=asgOfUser(uid).sort((x,y)=>y.start-x.start);
  return `<div class="panel"><div class="toolbar"><h3 class="grow">Пробники от преподавателя</h3>
      <button class="btn" data-act="assign" data-user="${uid}">Назначить пробник</button></div>
    ${rows.length?`<div class="list">${rows.map(a=>{const ph=phaseOf(a),e=examOf(a.exam);
      return `<div class="it"><span><b>${esc(e?e.title:'—')}</b> <span class="muted">· ${fmtTs(a.start)}</span> ${chipFor(ph)}${a.settled?` <span class="muted">· 1 часть: ${a.p1}</span>`:''}</span>
        <span>${ph==='scheduled'||ph==='missed'?`<button class="btn quiet" data-act="move" data-id="${a.id}">Перенести</button> <button class="btn danger" data-act="cancel" data-id="${a.id}">Отменить</button>`:''}
        ${ph==='submitted'||ph==='checked'?`<button class="btn quiet" data-act="open-check" data-id="${a.id}">Открыть</button>`:''}</span></div>`;}).join('')}</div>`
      :'<p class="muted">Своих пробников этому ученику ещё не назначали.</p>'}</div>`;
}
```

In `renderStudent`, insert `${examBlock(id)}` immediately before the final `<div class="grid2">` (the one that holds the "Пробники" panel). Leads' cards show it too (same function).

- [ ] **Step 3: Verify in the browser on the local stack**

1. `START_IN=3600 node tools/exam-dev-stack.mjs`; serve; teacher link. In "Пробники" the seeded assignment is "назначен" with Перенести/Отменить.
2. "Перенести": enter a new time (e.g. tomorrow 19:30 Moscow) → the row shows the new start; open the student's page as the student: the banner (Plan 2, if merged) shows the new time; otherwise confirm via the superuser API that `start` changed to `moscowInputToTs(...)`. Confirm the sheet's `datetime-local` value is read as Moscow time: pick 18:00 and check the stored `start` equals 15:00 UTC.
3. "Отменить" → row gone, "Назначить" from the catalog with the same student works again; assigning the same exam twice shows "уже назначен".
4. A time in the past asks for confirmation. Duration 0 or empty date shows "Проверь дату…".
5. The student card shows the block with the assignments; "Назначить пробник" there preselects the student. Phone width; console clean.

- [ ] **Step 4: Commit**

```bash
git add teacher.html
git commit -m "Panel: assign, move and cancel exams; assignments block in the student card"
```

---

### Task 6: The check page

**Files:**
- Modify: `teacher.html`

**Interfaces:**
- Consumes: `ExamPanelCore.activitySummary`, `fmtSec`; `api()`; `POST /files/token`; `POST /ege/exams/{id}/check`.
- Produces: `renderCheck(id)`, route `#/check/<assignmentId>` (the target of the bot's "Проверить" button: `teacher.html#/check/<id>`), actions `check-send`.

- [ ] **Step 1: The page**

```js
// ---- проверка работы ----
async function fileToken(){
  const r=await api('/files/token',{method:'POST'});
  return r.status===200&&r.json?r.json.token:'';
}
const pointsOptions=(max,cur)=>Array.from({length:max+1},(_,k)=>`<option value="${k}"${k===cur?' selected':''}>${k}</option>`).join('');

async function renderCheck(id){
  app.innerHTML='<p class="center muted">Загружаю работу…</p>';
  let ra,tok='';
  try{ra=await api('/collections/exam_assignments/records/'+id);}catch(e){return;}
  if(ra.status!==200){app.innerHTML=`<p class="center muted">Работа не найдена (сервер ответил ${esc(ra.status)}). <a href="#/exams">К списку</a></p>`;return;}
  const a=ra.json;
  let re;try{re=await api('/collections/exams/records/'+a.exam);}catch(e){return;}
  if(re.status!==200){app.innerHTML=`<p class="center muted">Не удалось открыть пробник (${esc(re.status)}).</p>`;return;}
  const e=re.json,ph=phaseOf(a),photos=photosOfAsg(id);
  if(photos.length)tok=await fileToken();
  const P=ExamPanelCore,act=P.activitySummary(a.log,a.start),part2=a.part2||{},answers=a.answers||{},ok=a.ok||{};
  const url=p=>`${API}/files/exam_photos/${p.id}/${p.file}?token=${encodeURIComponent(tok)}`;
  const short=e.tasks.filter(t=>t.kind==='short'),long=e.tasks.filter(t=>t.kind==='long');
  const ready=!!a.settled;
  const away=act.away.count?`уходил со страницы ${act.away.count} раз(а), всего ${P.fmtSec(act.away.totalSec)}; дольше всего ${P.fmtSec(act.away.longest.sec)} (на задании ${esc(act.away.longest.n)||'—'})`:'со страницы не уходил';
  app.innerHTML=`<p><a href="#/exams">← Пробники</a> · <a href="#/s/${a.user}">${esc(nameOf(a.user))}</a></p>
    <div class="toolbar"><h2 class="grow">${esc(e.title)} · ${esc(nameOf(a.user))} ${chipFor(ph)}</h2></div>
    <p class="lead">Начало ${fmtTs(a.start)}, на работу ${Math.round(a.duration/60)} мин. ${a.opened?'Открыл в '+fmtTs(a.opened)+'.':'Не открывал.'}${a.finished?' Завершил досрочно в '+fmtTs(a.finished)+'.':''}</p>
    ${ready?'':`<div class="panel"><p class="muted">Работа ещё не сдана (${P.PHASE_TEXT[ph]}). Баллы поставить можно будет после сдачи.</p></div>`}
    <div class="panel"><h3>Активность</h3>
      <p>${away}.</p>
      <p class="muted">Это только факты: второй телефон или книгу сайт не видит.</p>
      <details><summary>Когда вводились ответы</summary><div class="list">${short.map(t=>{const k=act.tasks[t.n];
        return `<div class="it"><span>Задание ${t.n}</span><span class="muted">${k?`${k.changes} изм., первый ввод на ${P.fmtSec(k.firstSec)}, последнее изменение на ${P.fmtSec(k.lastSec)}`:'ответа не вводил'}</span></div>`;}).join('')}</div></details></div>
    <div class="panel"><h3>Первая часть: ${a.p1||0} из ${short.reduce((s,t)=>s+(t.max||1),0)}</h3>
      <div class="table-wrap"><table><thead><tr><th>Задание</th><th>Ответ ученика</th><th>Верный</th><th></th></tr></thead><tbody>
      ${short.map(t=>{const g=answers[t.n];return `<tr><td>${t.n}</td><td>${g?esc(g):'<span class="muted">—</span>'}</td><td>${esc((e.key[String(t.n)]||{}).a)}</td>
        <td>${ready?(ok[t.n]?'<span class="chip ex-checked">верно</span>':'<span class="chip ex-missed">неверно</span>'):''}</td></tr>`;}).join('')}</tbody></table></div></div>
    ${long.map(t=>{const g=part2[t.n]||{},ps=photos.filter(p=>String(p.n)===String(t.n));
      return `<div class="panel" data-ck="${t.n}"><h3>Задание ${t.n} <span class="muted">· максимум ${t.max}</span></h3>
        <details><summary>Условие и ответ</summary><div class="tex">${t.cond}</div><p><b>Ответ:</b> <span class="tex">${(e.key[String(t.n)]||{}).a||''}</span></p></details>
        <div class="ex-ph">${ps.length?ps.map(p=>`<a href="${esc(url(p))}" target="_blank" rel="noopener"><img src="${esc(url(p))}" alt="Фото решения, задание ${t.n}"></a>`).join(''):'<p class="muted">Фото нет.</p>'}</div>
        <div class="ck-row"><label class="fld">Баллы<select data-ck-pts="${t.n}" ${ready?'':'disabled'}>${pointsOptions(t.max,+g.pts||0)}</select></label>
          <label class="fld grow">Комментарий ученику<textarea data-ck-note="${t.n}" rows="3" maxlength="2000" ${ready?'':'disabled'}>${esc(g.comment||'')}</textarea></label></div></div>`;}).join('')}
    <div class="toolbar"><p class="muted grow" id="ck-msg" role="status"></p>
      <button class="btn" data-act="check-send" data-id="${id}" ${ready?'':'disabled'}>${a.checked?'Сохранить изменения':'Проверено, отправить ученику'}</button></div>`;
  if(window.renderMathInElement)try{renderMathInElement(app,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false});}catch(err){}
  window.__checkExam=e;
}
async function checkSend(id){
  const e=window.__checkExam,msg=document.getElementById('ck-msg'),part2={};
  (e.tasks||[]).filter(t=>t.kind==='long').forEach(t=>{
    part2[t.n]={pts:+document.querySelector(`[data-ck-pts="${t.n}"]`).value,comment:document.querySelector(`[data-ck-note="${t.n}"]`).value};});
  msg.textContent='Отправляю…';
  let r;try{r=await api(`/ege/exams/${id}/check`,{method:'POST',body:{part2}});}catch(err){if(err.message!=='401')msg.textContent='Нет связи с сервером.';return;}
  if(r.status===200){msg.textContent='Готово. Ученик получил сообщение в Telegram.';await refresh();return;}
  msg.textContent=r.status===409?'Работа ещё не сдана.':r.status===400?'Проверь баллы: они должны быть целыми от нуля до максимума.':`Сервер ответил ${r.status}.`;
}
```

`refresh()` re-runs `route()` and so redraws the check page (it reloads the assignment, which now has `checked`), so the button label flips to "Сохранить изменения"; the status line is lost on the redraw — acceptable; if you prefer to keep it, set it again after `await refresh()`.

Wire up: in `route()` add `const mc=location.hash.match(/^#\/check\/([a-z0-9]+)$/);if(mc)return renderCheck(mc[1]);` (same placement rule as `#/x/`). In the click handler: `else if(a==='check-send')checkSend(id);` (`open-check` from Task 3 already navigates to `#/check/<id>`).

CSS:

```css
  .ex-ph{display:flex;flex-wrap:wrap;gap:var(--s3);margin:var(--s4) 0;}
  .ex-ph img{height:180px;width:auto;max-width:100%;border:1px solid var(--line);border-radius:var(--r-md);display:block;background:var(--surface-2);}
  .ck-row{display:flex;gap:var(--s4);flex-wrap:wrap;align-items:flex-start;}
  .ck-row textarea{font:inherit;padding:var(--s3);border:1px solid var(--line-strong);border-radius:var(--r-md);background:var(--surface);color:var(--ink);resize:vertical;}
```

- [ ] **Step 2: Verify in the browser on the local stack (full cycle with the student side)**

If Plan 2 is merged, use the real trainer for the student part; otherwise drive the student side with `curl` against the server (token from `/api/collections/users/auth-with-password` for `stud1`, the throwaway password is `P` plus 31 `x`): open (`GET /ege/exams/<id>`), `POST answers {"answers":{"1":"5","2":"-1,5"}}`, `POST finish`, upload a photo with `curl -F n=13 -F file=@some.jpg`, `POST done`.

1. Start `START_IN=-5 DURATION=600`. After the student side is done the assignment shows in "Ждут проверки" (open the "Пробники" tab; the badge on the tab counts it).
2. Open the row: header, "Активность" (e.g. "со страницы не уходил" or the away facts if you posted `/away`), the answer table with верно/неверно, the photo thumbnails of task 13 (click opens the full image), points selects, comment boxes. A work in `open`/`photos` phase shows the "ещё не сдана" note and disabled controls.
3. Set 13 → 1, 14 → 0 with a comment and press "Проверено": the status says "Готово…", the button becomes "Сохранить изменения", the row moves to "Проверены". As the student (trainer or `GET /ege/exams/<id>`) the phase is `checked` with `part2` and `total`. Change the points and save again: no second bot message (the dev stack's Telegram stub is silent; check the server log or the stub is not needed — rely on the Plan 1 test for exactly-once).
4. Bad input: edit the select value in devtools to `9` and send: "Проверь баллы…".
5. The deep link `http://localhost:3456/teacher.html#/check/<assignment id>` opens the page directly after login (the bot's "Проверить" button target).
6. Phone width, dark theme, console clean.

- [ ] **Step 3: Commit**

```bash
git add teacher.html
git commit -m "Panel: check page with activity summary, photos, points and comments"
```

---

### Task 7: Final pass, notes

**Files:**
- Modify: `sw.js` (version), `backend/README.md` (a short "Preparing an exam file" section), `tools/` docs if any

- [ ] **Step 1: Full checks**

Run: `node --test 'tests/*.test.mjs'` and `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 2: Full cycle once more, end to end**

With the dev stack and `tools/exam_api.mjs` (`--api http://127.0.0.1:8090/api --link-file <throwaway file>`): upload the fixture → assign for 2 minutes ahead (without `--yes` first: nothing happens; then with it) → in the panel move it → cancel and assign again → (student side, Plan 2 trainer if merged) write it → check it → verify the student sees points and comment. Note any bug and fix it in this task.

- [ ] **Step 3: Document the workflow**

Add to `backend/README.md`, section "Assigned mock exams", a subsection:

```markdown
### Preparing and assigning exams (Claude Code)

Exams are not uploaded through the panel. Work happens in a Claude Code chat with the project
skill `.claude/skills/assigned-exam/`: source files in `~/math-source/exams/<slug>/` (outside the
repository), a typeset `exam.json`, answers verified by computation, then
`node tools/exam_check.mjs`, a local `node tools/exam_preview.mjs` for review,
`node tools/exam_api.mjs upload`, and — only with an explicit yes, because the student gets a
Telegram message — `node tools/exam_api.mjs assign … --yes`. `exams`, `students`, `status` and
`delete` are also there. The tool logs in with `~/ege-teacher-link.txt` and prints no secrets.
`tests/fixtures/exam-sample.json` is a made-up example of the file format.
```

- [ ] **Step 4: Service worker version and commit**

Check `git fetch origin && git show origin/master:sw.js | head -6`; set `VERSION` strictly greater than master's.

```bash
git add -A
git commit -m "Panel: assigned exams end-to-end pass; docs for the exam file; sw version"
```

## Self-Review (done by the plan author)

Spec coverage for the panel and the content pipeline: tab "Пробники" with the lists of assigned, missed and checked works and the catalog (Task 3); assign with date, time and duration, move and cancel before the start, the student-card block (Task 5); the check page with part 1 results, photos of part 2 (from the site and from the bot alike), points and a comment per task, the activity summary (away journal and time per task), and "Проверено" that sends the result (Task 6); validation, preview, upload, assign, status and delete as command-line tools plus the `assigned-exam` skill so that exams are prepared in Claude Code (Tasks 2, 4, 7). Photos arriving through the bot are Plan 1b, the student screens are Plan 2.

Known limits: the catalog list shows no task count (it would need a server column or `tasks` in the list call); the status line of the check page is reset when the page redraws; the panel's phase labels use the teacher's device clock, which only affects labels, never access; `exam_api.mjs` writes to production with the owner's teacher login, so it is meant to be run by the owner or with his approval of each production call.
