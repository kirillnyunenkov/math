# Assigned Mock Exams, Part 1 of 3: Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PocketBase backend that stores the teacher's hidden exams, opens one exam to one student inside a hard time window, collects part 1 answers and part 2 photos, grades part 1, records the teacher's check, and sends the bot messages.

**Architecture:** Three closed collections (`exams`, `exam_assignments`, `exam_photos`) and a set of custom routes in `backend/pb_hooks/exams.js`; students never touch the collections directly. The phase of an assignment and the answer comparison are pure functions in two shared files that the site and the server both load. A once-a-minute cron job sends reminders and settles finished assignments.

**Tech Stack:** PocketBase 0.40.4 (JS hooks run on the goja engine: ES6, no optional chaining, no `async`), Node 20+ built-in test runner, no npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-assigned-exams-design.md`

## The three plans

The spec is one feature but three deliverables that can each be tested alone:

1. **Server (this plan)** — testable end to end with `backend/tests/exams.test.mjs`. Nothing on the public site changes; safe to merge and roll out on its own.
2. **Trainer** — `exam.js`, hub banner, exam screen, photos, results; `index.html` switches to `answers-core.js`. Written after this plan passes, against the real responses.
3. **Teacher panel and content tool** — "Пробники" tab, assign/reschedule/cancel, check screen with the activity summary, `tools/exam_check.mjs`.

## Global Constraints

- The repository is public. No real exam statements, answers or solutions in any committed file; tests use made-up tasks.
- Never save the `users` collection in a migration (it logs every student out).
- Never log or print the bot token or any secret; `TEACHER_TG_ID` is read from the environment only.
- All times are unix seconds by the server clock. `end = start + duration`. Photo grace is 600 seconds.
- Default duration 14100 seconds (3 h 55 min); accepted range 60..21600.
- At most 5 photos per task, 10 MB each, `image/jpeg`, `image/png`, `image/webp`.
- Hook code must run on goja: no `?.`, no `??`, no `async/await`, no object spread.
- Comments and docs in English; bot texts in Russian, on «ты», no emoji.
- Commit after every task; never push to `master`.
- Backend tests: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`. Unit tests: `node --test 'tests/*.test.mjs'`.
- Rollout to the production server is done by the owner with commands prepared in Task 10; do not run `scp`/`ssh` writes yourself.

## File Structure

| File | Responsibility |
|---|---|
| `answers-core.js` (new, repo root) | Compare a typed answer with the key; grade part 1 of an exam. |
| `exam-core.js` (new, repo root) | Phase of an assignment at a given time; deadlines; totals. |
| `backend/pb_hooks/lib/answers-core.js`, `backend/pb_hooks/lib/exam-core.js` (new) | Byte-identical tracked copies: the server only receives `pb_hooks/`. |
| `tests/answers-core.test.mjs`, `tests/exam-core.test.mjs`, `tests/cores-in-sync.test.mjs` (new) | Unit tests; the last one fails if a copy drifts. |
| `backend/pb_migrations/1790800007_exams.js` (new) | The three collections. |
| `backend/pb_hooks/exams.pb.js` (new) | Route and cron registration only. |
| `backend/pb_hooks/exams.js` (new) | All exam logic and bot texts. |
| `backend/pb_hooks/tg.js` (modify) | `send` takes a button label, returns success, is exported. |
| `backend/tests/exams.test.mjs` (new) | End-to-end tests against a throwaway PocketBase. |
| `backend/README.md` (modify) | Exams section, env variable, rollout commands. |

Data shapes used everywhere below:

```
exam.tasks = [ { n: 1, kind: "short", max: 1, cond: "<p>…</p>" },
               { n: 13, kind: "long",  max: 2, cond: "<p>…</p>" } ]
exam.key   = { "1": { a: "12,5", sol: "<p>…</p>" }, "13": { a: "<p>…</p>" } }
assignment.answers = { "1": "12,5" }
assignment.ok      = { "1": true }
assignment.part2   = { "13": { pts: 1, comment: "…" } }
assignment.log     = [ [1790000000, "a", "1", "12,5"], [1790000050, "w", "3", 42] ]
```

`n` is the task number inside the exam; in JSON object keys it is always a string.

---

### Task 1: `answers-core.js` — answer comparison and part 1 grading

**Files:**
- Create: `answers-core.js`
- Test: `tests/answers-core.test.mjs`

**Interfaces:**
- Produces: `AnswersCore.normAns(s)`, `AnswersCore.parseNum(s) -> number|null`, `AnswersCore.answersEqual(given, correct) -> boolean`, `AnswersCore.gradePart1(tasks, key, answers) -> { p1: number, max1: number, ok: {[n]: boolean} }`. In Node: `require('../answers-core.js')`; in the browser: `window.AnswersCore`.

`index.html` keeps its own copy of the three small functions until Plan 2 switches it over; the behaviour must be identical, which the tests below pin.

- [ ] **Step 1: Write the failing test**

```js
// tests/answers-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const A = createRequire(import.meta.url)('../answers-core.js');

test('numbers compare by value: comma, minus sign, spaces, trailing dot', () => {
  assert.equal(A.answersEqual('12,5', '12.5'), true);
  assert.equal(A.answersEqual('−3', '-3'), true);
  assert.equal(A.answersEqual(' 0,50 ', '0.5'), true);
  assert.equal(A.answersEqual('7.', '7'), true);
  assert.equal(A.answersEqual('7', '8'), false);
});

test('non-numbers compare as normalised text', () => {
  assert.equal(A.answersEqual('АБВ', 'абв'), true);
  assert.equal(A.answersEqual('1 3 2', '132'), true);
  assert.equal(A.answersEqual('132', '123'), false);
});

test('parseNum rejects what is not a plain decimal', () => {
  assert.equal(A.parseNum(''), null);
  assert.equal(A.parseNum('1/2'), null);
  assert.equal(A.parseNum('-0,25'), -0.25);
});

test('gradePart1 counts only short tasks and treats an empty answer as wrong', () => {
  const tasks = [{ n: 1, kind: 'short', max: 1 }, { n: 2, kind: 'short', max: 1 },
    { n: 3, kind: 'short', max: 1 }, { n: 13, kind: 'long', max: 2 }];
  const key = { 1: { a: '5' }, 2: { a: '0,5' }, 3: { a: '-1' }, 13: { a: 'x' } };
  const g = A.gradePart1(tasks, key, { 1: '5', 2: '0.6', 13: 'x' });
  assert.deepEqual(g, { p1: 1, max1: 3, ok: { 1: true, 2: false, 3: false } });
});

test('gradePart1 survives missing key and missing answers', () => {
  assert.deepEqual(A.gradePart1([{ n: 1, kind: 'short', max: 1 }], {}, null), { p1: 0, max1: 1, ok: { 1: false } });
  assert.deepEqual(A.gradePart1(null, null, null), { p1: 0, max1: 0, ok: {} });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/answers-core.test.mjs`
Expected: FAIL, `Cannot find module '../answers-core.js'`.

- [ ] **Step 3: Write the module**

```js
/* Answer comparison — pure functions shared by the trainer, the teacher panel,
   the server hooks and the tests (node/goja: require, browser:
   window.AnswersCore). Keep it ES6-plain: the server runs it on goja. */
(function (root) {
  'use strict';

  function normAns(s) {
    return (s || '').toString().toLowerCase().replace(/−/g, '-').replace(/\s+/g, '').replace(/,/g, '.');
  }

  function parseNum(s) {
    const t = (s || '').toString().replace(/−/g, '-').replace(/\s+/g, '').replace(/,/g, '.').replace(/\.$/, '');
    if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null;
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  function answersEqual(given, correct) {
    const a = parseNum(given), b = parseNum(correct);
    if (a !== null && b !== null) return Math.abs(a - b) < 1e-9;
    return normAns(given) === normAns(correct);
  }

  /* Part 1 of an assigned exam. tasks: [{n, kind, max}], key: {n: {a}},
     answers: {n: typed text}. Long tasks are graded by the teacher. */
  function gradePart1(tasks, key, answers) {
    const ok = {};
    let p1 = 0, max1 = 0;
    (tasks || []).forEach(function (t) {
      if (t.kind !== 'short') return;
      const mx = t.max || 1;
      const raw = (answers || {})[t.n];
      const given = (raw == null ? '' : String(raw)).trim();
      const k = (key || {})[t.n];
      ok[t.n] = given !== '' && !!k && k.a != null && answersEqual(given, String(k.a));
      max1 += mx;
      if (ok[t.n]) p1 += mx;
    });
    return { p1: p1, max1: max1, ok: ok };
  }

  const api = { normAns: normAns, parseNum: parseNum, answersEqual: answersEqual, gradePart1: gradePart1 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnswersCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/answers-core.test.mjs`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add answers-core.js tests/answers-core.test.mjs
git commit -m "Add answers-core: shared answer comparison and part 1 grading"
```

---

### Task 2: `exam-core.js` — phases and deadlines

**Files:**
- Create: `exam-core.js`
- Test: `tests/exam-core.test.mjs`

**Interfaces:**
- Produces: `ExamCore.PHOTO_GRACE` (600), `ExamCore.DEFAULT_DURATION` (14100), `ExamCore.times(a) -> {end, stop, photoUntil}`, `ExamCore.phase(a, now) -> 'scheduled'|'open'|'photos'|'submitted'|'checked'|'missed'`, `ExamCore.total(tasks, p1, part2) -> {pts, max}`.
- `a` is `{start, duration, opened, finished, photos_done, checked}`, all unix seconds, `0` = not set.

- [ ] **Step 1: Write the failing test**

```js
// tests/exam-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../exam-core.js');

const base = { start: 1000, duration: 100, opened: 0, finished: 0, photos_done: 0, checked: 0 };
const a = (o) => Object.assign({}, base, o);

test('before the start it is scheduled, whatever else is set', () => {
  assert.equal(C.phase(a({}), 999), 'scheduled');
});

test('never opened: open during the window, missed after it', () => {
  assert.equal(C.phase(a({}), 1000), 'open');
  assert.equal(C.phase(a({}), 1099), 'open');
  assert.equal(C.phase(a({}), 1100), 'missed');
  assert.equal(C.phase(a({}), 99999), 'missed');
});

test('opened and not finished: open until end, then 600 s of photos, then submitted', () => {
  const x = a({ opened: 1005 });
  assert.equal(C.phase(x, 1099), 'open');
  assert.equal(C.phase(x, 1100), 'photos');
  assert.equal(C.phase(x, 1699), 'photos');
  assert.equal(C.phase(x, 1700), 'submitted');
});

test('early finish starts the photo phase from the finish time', () => {
  const x = a({ opened: 1005, finished: 1040 });
  assert.equal(C.phase(x, 1040), 'photos');
  assert.equal(C.phase(x, 1639), 'photos');
  assert.equal(C.phase(x, 1640), 'submitted');
  assert.deepEqual(C.times(x), { end: 1100, stop: 1040, photoUntil: 1640 });
});

test('"done" ends the photo phase at once', () => {
  assert.equal(C.phase(a({ opened: 1005, finished: 1040, photos_done: 1050 }), 1051), 'submitted');
  assert.equal(C.phase(a({ opened: 1005, photos_done: 1110 }), 1111), 'submitted');
});

test('checked wins over everything after the start', () => {
  assert.equal(C.phase(a({ opened: 1005, checked: 5000 }), 5001), 'checked');
});

test('total adds part 1 and the teacher points, capped by each task max', () => {
  const tasks = [{ n: 1, kind: 'short', max: 1 }, { n: 2, kind: 'short', max: 1 },
    { n: 13, kind: 'long', max: 2 }, { n: 14, kind: 'long', max: 3 }];
  assert.deepEqual(C.total(tasks, 1, { 13: { pts: 2 }, 14: { pts: 9 } }), { pts: 6, max: 7 });
  assert.deepEqual(C.total(tasks, 2, null), { pts: 2, max: 7 });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/exam-core.test.mjs`
Expected: FAIL, `Cannot find module '../exam-core.js'`.

- [ ] **Step 3: Write the module**

```js
/* Assigned mock exams — the phase of an assignment at a given moment. Pure
   functions shared by the trainer, the teacher panel, the server hooks and
   the tests (node/goja: require, browser: window.ExamCore). ES6-plain: the
   server runs it on goja.

   All times are unix seconds, 0 = not set. The window is hard:
   end = start + duration, a late start does not move it. After the window
   (or an early finish) the student has PHOTO_GRACE seconds for photos only. */
(function (root) {
  'use strict';

  const PHOTO_GRACE = 600;
  const DEFAULT_DURATION = 14100;   // 3 h 55 min

  function times(a) {
    const end = a.start + a.duration;
    const stop = a.finished ? Math.min(a.finished, end) : end;
    return { end: end, stop: stop, photoUntil: stop + PHOTO_GRACE };
  }

  function phase(a, now) {
    if (now < a.start) return 'scheduled';
    if (a.checked) return 'checked';
    const t = times(a);
    // never opened: the statements were not seen, so the exam stays reusable
    if (!a.opened) return now < t.end ? 'open' : 'missed';
    if (now < t.stop) return 'open';
    if (!a.photos_done && now < t.photoUntil) return 'photos';
    return 'submitted';
  }

  function total(tasks, p1, part2) {
    let pts = p1 || 0, max = 0;
    (tasks || []).forEach(function (t) {
      const mx = t.max || 1;
      max += mx;
      if (t.kind !== 'long') return;
      const g = (part2 || {})[t.n];
      if (g && g.pts > 0) pts += Math.min(g.pts, mx);
    });
    return { pts: pts, max: max };
  }

  const api = { PHOTO_GRACE: PHOTO_GRACE, DEFAULT_DURATION: DEFAULT_DURATION, times: times, phase: phase, total: total };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/exam-core.test.mjs`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add exam-core.js tests/exam-core.test.mjs
git commit -m "Add exam-core: phases and deadlines of an assigned exam"
```

---

### Task 3: Server copies of the shared files

The production server receives only `backend/pb_hooks/`. The hooks therefore load tracked copies from `backend/pb_hooks/lib/`; a test keeps the copies identical. PocketBase auto-loads only `*.pb.js` from the top of the hooks directory, so files in `lib/` are inert until required.

**Files:**
- Create: `backend/pb_hooks/lib/answers-core.js`, `backend/pb_hooks/lib/exam-core.js`
- Test: `tests/cores-in-sync.test.mjs`

**Interfaces:**
- Produces: `require(`${__hooks}/lib/exam-core.js`)` and `require(`${__hooks}/lib/answers-core.js`)` inside hooks, same API as Tasks 1–2.

- [ ] **Step 1: Write the failing test**

```js
// tests/cores-in-sync.test.mjs
// The server loads copies of the shared files from backend/pb_hooks/lib/.
// After editing a shared file run: cp answers-core.js exam-core.js backend/pb_hooks/lib/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const f of ['answers-core.js', 'exam-core.js']) {
  test(`backend/pb_hooks/lib/${f} is identical to ${f}`, () => {
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
    assert.equal(read(`../backend/pb_hooks/lib/${f}`), read(`../${f}`));
  });
}
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/cores-in-sync.test.mjs`
Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Create the copies**

```bash
mkdir -p backend/pb_hooks/lib
cp answers-core.js exam-core.js backend/pb_hooks/lib/
```

- [ ] **Step 4: Run all unit tests**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass, including the existing `sync-core` and `stats-core` suites.

- [ ] **Step 5: Commit**

```bash
git add backend/pb_hooks/lib tests/cores-in-sync.test.mjs
git commit -m "Track server copies of the shared exam files and keep them in sync"
```

---

### Task 4: Migration and the closed-collection rules

**Files:**
- Create: `backend/pb_migrations/1790800007_exams.js`
- Create: `backend/tests/exams.test.mjs` (harness + rule tests; later tasks append to it)

**Interfaces:**
- Produces: collections `exams`, `exam_assignments`, `exam_photos` with the fields below.
- Produces (test harness, used by every later task): `req(method, path, token, body)`, `tok.su`, `tok.teacher`, `student(tgId) -> {token, id}`, `mkExam() -> id`, `sent` (array of bot messages), `shift(assignmentId, patch)`, `nowS()`, constants `TEACHER_CHAT = '555'`.

- [ ] **Step 1: Write the harness and the failing rule tests**

```js
// backend/tests/exams.test.mjs
// Assigned mock exams: a throwaway PocketBase with our migrations and hooks,
// plus a stub standing in for the Telegram Bot API.
// Run: PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PB = process.env.PB_BIN || join(homedir(), '.local/pocketbase/pocketbase');
const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = join(HERE, '../pb_migrations'), HOOKS = join(HERE, '../pb_hooks');
// other suites use 8097-8099; a local dev PocketBase uses 8090
const PORT = 8094, STUB_PORT = 8095, B = `http://127.0.0.1:${PORT}/api`;
const SECRET = 'whsecret', TEACHER_CHAT = '555';
let dir, proc, stub;
const sent = [], tok = {};
const nowS = () => Math.floor(Date.now() / 1000);

async function req(method, path, token, body, headers = {}) {
  const r = await fetch(B + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function login(identity, password, coll = 'users') {
  const r = await req('POST', `/collections/${coll}/auth-with-password`, null, { identity, password });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
// A student registered through the bot, so bot messages have somewhere to go.
async function student(tgId) {
  const upd = { update_id: 1, message: { message_id: 1, text: '/start',
    from: { id: tgId, is_bot: false, first_name: 'Маша' }, chat: { id: tgId, type: 'private' } } };
  const h = await req('POST', '/tg/webhook', null, upd, { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
  assert.equal(h.status, 200);
  const m = [...sent].reverse().find(s => s.chat_id === tgId && s.reply_markup);
  const [, l, s] = m.reply_markup.inline_keyboard[0][0].url.match(/#\/login\/([a-z0-9_-]+)\.([A-Za-z0-9]+)$/);
  const a = await login(l, s);
  return { token: a.token, id: a.record.id, chat: tgId };
}
const TASKS = [
  { n: 1, kind: 'short', max: 1, cond: '<p>Сколько будет 2 + 3?</p>' },
  { n: 2, kind: 'short', max: 1, cond: '<p>Сколько будет 1 : 2?</p>' },
  { n: 13, kind: 'long', max: 2, cond: '<p>Решите уравнение x = 1.</p>' },
];
const KEY = { 1: { a: '5', sol: '<p>2 + 3 = 5.</p>' }, 2: { a: '0,5', sol: '<p>1 : 2 = 0,5.</p>' }, 13: { a: '<p>x = 1</p>' } };
async function mkExam(title = 'Пробник 1') {
  const r = await req('POST', '/collections/exams/records', tok.teacher, { title, full: false, tasks: TASKS, key: KEY });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.id;
}
// Moves an assignment in time; only a superuser may write the collection.
async function shift(id, patch) {
  const r = await req('PATCH', `/collections/exam_assignments/records/${id}`, tok.su, patch);
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
const said = (chat, part) => sent.filter(s => String(s.chat_id) === String(chat) && s.text.includes(part)).length;

before(async () => {
  stub = createServer((q, s) => {
    let b = ''; q.on('data', d => b += d);
    q.on('end', () => { sent.push({ path: q.url, ...JSON.parse(b) }); s.end('{"ok":true}'); });
  }).listen(STUB_PORT, '127.0.0.1');
  dir = mkdtempSync(join(tmpdir(), 'pbex-'));
  const args = ['--dir', join(dir, 'pb_data'), '--migrationsDir', MIG];
  execFileSync(PB, ['migrate', 'up', ...args]);
  execFileSync(PB, ['superuser', 'upsert', 'root@test.local', 'rootpassword123', ...args]);
  proc = spawn(PB, ['serve', '--http', `127.0.0.1:${PORT}`, ...args, '--hooksDir', HOOKS], {
    stdio: 'ignore',
    env: { ...process.env, TG_API: `http://127.0.0.1:${STUB_PORT}`, TG_BOT_TOKEN: 'test',
      TG_WEBHOOK_SECRET: SECRET, TEACHER_TG_ID: TEACHER_CHAT },
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(B + '/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  tok.su = (await login('root@test.local', 'rootpassword123', '_superusers')).token;
  const pw = 'T'.repeat(32);
  const r = await req('POST', '/collections/users/records', tok.su,
    { login: 'teacher', role: 'teacher', name: 'T', active: true, password: pw, passwordConfirm: pw });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  tok.teacher = (await login('teacher', pw)).token;
});
after(() => { proc?.kill(); stub?.close(); rmSync(dir, { recursive: true, force: true }); });

test('exams are readable and writable by the teacher only', async () => {
  const id = await mkExam();
  const s = await student(7000000001);
  assert.equal((await req('GET', '/collections/exams/records', s.token)).json.totalItems, 0);
  assert.equal((await req('GET', `/collections/exams/records/${id}`, s.token)).status, 404);
  assert.equal((await req('GET', `/collections/exams/records/${id}`, null)).status, 404);
  assert.equal((await req('GET', `/collections/exams/records/${id}`, tok.teacher)).status, 200);
});

test('assignments and photos cannot be written through the collection API', async () => {
  const id = await mkExam();
  const s = await student(7000000002);
  const body = { user: s.id, exam: id, start: nowS(), duration: 600 };
  for (const t of [s.token, tok.teacher]) {
    const r = await req('POST', '/collections/exam_assignments/records', t, body);
    assert.ok([400, 403].includes(r.status), String(r.status));
    const p = await req('POST', '/collections/exam_photos/records', t, { user: s.id, n: '13' });
    assert.ok([400, 403].includes(p.status), String(p.status));
  }
  assert.equal((await req('GET', '/collections/exam_assignments/records', s.token)).json.totalItems, 0);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: FAIL in `mkExam` with status 404 (collection `exams` does not exist).

- [ ] **Step 3: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams: the teacher's own exams, opened to one student for a
// fixed time window. Students never read these collections directly — only
// through the routes in pb_hooks/exams.js, which decide by the server clock
// what may be shown. `users` is deliberately not touched.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const teacher = '@request.auth.role = "teacher"';
  const own = 'user = @request.auth.id || @request.auth.role = "teacher"';
  const userRel = { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true };
  const created = { type: "autodate", name: "created", onCreate: true, onUpdate: false };
  const num = (name) => ({ type: "number", name, onlyInt: true });   // unix seconds, 0 = not set

  const exams = new Collection({
    type: "base", name: "exams",
    listRule: teacher, viewRule: teacher, createRule: teacher, updateRule: teacher, deleteRule: teacher,
    fields: [
      { type: "text", name: "title", required: true, max: 120 },
      { type: "bool", name: "full" },                              // a full variant: show the test score
      { type: "json", name: "tasks", required: true, maxSize: 5000000 },
      { type: "json", name: "key", required: true, maxSize: 2000000 },
      created,
    ],
  });
  app.save(exams);

  const assignments = new Collection({
    type: "base", name: "exam_assignments",
    listRule: teacher, viewRule: teacher, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      userRel,
      // no cascade: an exam that was assigned cannot be deleted by accident
      { type: "relation", name: "exam", required: true, collectionId: exams.id, maxSelect: 1, cascadeDelete: false },
      { ...num("start"), required: true }, { ...num("duration"), required: true },
      num("opened"), num("finished"), num("photos_done"), num("settled"), num("checked"),
      num("p1"), { type: "bool", name: "via_tg" },
      { type: "json", name: "answers", maxSize: 20000 },
      { type: "json", name: "ok", maxSize: 20000 },
      { type: "json", name: "part2", maxSize: 100000 },
      { type: "json", name: "log", maxSize: 400000 },
      num("m_hour"), num("m_open"),                                // bot messages already sent
      created,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_exas_user_exam ON exam_assignments (user, exam)",
      "CREATE INDEX idx_exas_start ON exam_assignments (start)",
    ],
  });
  app.save(assignments);

  app.save(new Collection({
    type: "base", name: "exam_photos",
    listRule: own, viewRule: own, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      userRel,
      { type: "relation", name: "assignment", required: true, collectionId: assignments.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "n", required: true, max: 8 },
      { type: "file", name: "file", required: true, maxSelect: 1, maxSize: 10485760, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      created,
    ],
    indexes: ["CREATE INDEX idx_exph_assignment ON exam_photos (assignment, n)"],
  }));
}, (app) => {
  for (const c of ["exam_photos", "exam_assignments", "exams"]) app.delete(app.findCollectionByNameOrId(c));
});
```

- [ ] **Step 4: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: 2 pass. If `migrate up` rejects a field option, check the exact option name in `~/.local/pocketbase/pb_data/types.d.ts` (search `interface FileField`) and fix the migration, not the test.

- [ ] **Step 5: Run the whole backend suite (nothing else broke)**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/pb_migrations/1790800007_exams.js backend/tests/exams.test.mjs
git commit -m "Add collections for assigned mock exams, closed to students"
```

---

### Task 5: Bot `send` that reports success and takes a button label

**Files:**
- Modify: `backend/pb_hooks/tg.js` (function `send`, last line `module.exports`)

**Interfaces:**
- Produces: `require(`${__hooks}/tg.js`).send(chatId, text, url?, label?) -> boolean` — `true` only when Telegram answered 200. Existing callers ignore the return value and pass no label, so their behaviour is unchanged.

- [ ] **Step 1: Replace `send` and the export**

```js
// Returns true when Telegram accepted the message (a person who blocked the
// bot gives 403 — callers that retry need to know).
function send(chatId, text, url, label) {
  const body = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (url) body.reply_markup = { inline_keyboard: [[{ text: label || TEXT.button, url: url }]] };
  try {
    const res = $http.send({
      url: (env("TG_API") || "https://api.telegram.org") + "/bot" + env("TG_BOT_TOKEN") + "/sendMessage",
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, timeout: 10,
    });
    return res.statusCode === 200;
  } catch (err) { console.log("tg: sendMessage failed"); return false; }   // never log the URL: it holds the token
}
```

```js
module.exports = { webhook: webhook, leads: leads, claim: claim, send: send };
```

- [ ] **Step 2: Run the bot suite**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/telegram.test.mjs`
Expected: all pass, unchanged count.

- [ ] **Step 3: Commit**

```bash
git add backend/pb_hooks/tg.js
git commit -m "Bot send: report success, accept a button label, export for other hooks"
```

---

### Task 6: Teacher routes — assign, move, cancel

**Files:**
- Create: `backend/pb_hooks/exams.pb.js`, `backend/pb_hooks/exams.js`
- Modify: `backend/tests/exams.test.mjs` (append)

**Interfaces:**
- Consumes: `ExamCore.phase`, `tg.send`.
- Produces routes (teacher only, JSON):
  - `POST /api/ege/exams/assign` body `{user, exam, start, duration?}` → `200 {id}`; `400` on bad input or duplicate.
  - `POST /api/ege/exams/{id}/move` body `{start, duration?}` → `200 {ok:true}`; `409` unless the phase is `scheduled` or `missed`.
  - `POST /api/ege/exams/{id}/cancel` → `200 {ok:true}`, deletes the row; `409` unless `scheduled` or `missed`.
- Produces helpers inside `exams.js` reused by later tasks: `each(rows, fn)`, `nowS()`, `J(rec, field, fallback)`, `shape(rec)`, `isTeacher(e)`, `isStudent(e)`, `fail(e, code, msg)`, `when(ts)`, `tell(userId, text, url, label)`, `TEXT`.

- [ ] **Step 1: Append the failing tests**

```js
const assign = (user, exam, start, duration = 600, token = tok.teacher) =>
  req('POST', '/ege/exams/assign', token, { user, exam, start, duration });

test('only the teacher assigns; the student is told at once', async () => {
  const exam = await mkExam(), s = await student(7000000010);
  assert.equal((await assign(s.id, exam, nowS() + 7200, 600, s.token)).status, 403);
  assert.equal((await assign(s.id, exam, nowS() + 7200, 600, null)).status, 403);
  const r = await assign(s.id, exam, nowS() + 7200);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(said(s.chat, 'Тебе назначен пробник'), 1);
  const rec = await req('GET', `/collections/exam_assignments/records/${r.json.id}`, tok.teacher);
  assert.equal(rec.json.duration, 600);
  assert.equal(rec.json.m_hour, 0);
});

test('assign validates input and refuses the same exam twice', async () => {
  const exam = await mkExam(), s = await student(7000000011);
  assert.equal((await assign('nope', exam, nowS() + 100)).status, 400);
  assert.equal((await assign(s.id, 'nope', nowS() + 100)).status, 400);
  assert.equal((await assign(s.id, exam, 'soon')).status, 400);
  assert.equal((await assign(s.id, exam, nowS() + 100, 30)).status, 400);
  assert.equal((await assign(s.id, exam, nowS() + 100, 99999)).status, 400);
  assert.equal((await assign(s.id, exam, nowS() + 100)).status, 200);
  assert.equal((await assign(s.id, exam, nowS() + 900)).status, 400);
});

test('default duration is 3 h 55 min; a start within the hour skips the hour reminder', async () => {
  const exam = await mkExam(), s = await student(7000000012);
  const r = await req('POST', '/ege/exams/assign', tok.teacher, { user: s.id, exam, start: nowS() + 600 });
  const rec = await req('GET', `/collections/exam_assignments/records/${r.json.id}`, tok.teacher);
  assert.equal(rec.json.duration, 14100);
  assert.ok(rec.json.m_hour > 0);
});

test('move and cancel work before the start only, and tell the student', async () => {
  const exam = await mkExam(), s = await student(7000000013);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  const moved = nowS() + 9000;
  assert.equal((await req('POST', `/ege/exams/${id}/move`, s.token, { start: moved })).status, 403);
  assert.equal((await req('POST', `/ege/exams/${id}/move`, tok.teacher, { start: moved })).status, 200);
  assert.equal((await req('GET', `/collections/exam_assignments/records/${id}`, tok.teacher)).json.start, moved);
  assert.equal(said(s.chat, 'перенесён'), 1);

  await shift(id, { start: nowS() - 10, opened: nowS() - 5 });           // the exam is being written
  assert.equal((await req('POST', `/ege/exams/${id}/move`, tok.teacher, { start: moved })).status, 409);
  assert.equal((await req('POST', `/ege/exams/${id}/cancel`, tok.teacher)).status, 409);

  await shift(id, { start: nowS() + 7200, opened: 0 });
  assert.equal((await req('POST', `/ege/exams/${id}/cancel`, tok.teacher)).status, 200);
  assert.equal((await req('GET', `/collections/exam_assignments/records/${id}`, tok.teacher)).status, 404);
  assert.equal(said(s.chat, 'отменён'), 1);
  assert.equal((await assign(s.id, exam, nowS() + 7200)).status, 200);   // free to assign again
});
```

- [ ] **Step 2: Run and see them fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the four new tests FAIL with status 404 (routes do not exist).

- [ ] **Step 3: Register the routes**

```js
/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams. Logic lives in exams.js because PocketBase runs every
// handler in an isolated scope.
routerAdd("POST", "/api/ege/exams/assign", (e) => require(`${__hooks}/exams.js`).assign(e));
routerAdd("POST", "/api/ege/exams/{id}/move", (e) => require(`${__hooks}/exams.js`).move(e));
routerAdd("POST", "/api/ege/exams/{id}/cancel", (e) => require(`${__hooks}/exams.js`).cancel(e));
```

- [ ] **Step 4: Write `exams.js` (first part)**

```js
/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams: what a student may see is decided here, by the server
// clock and the phase from lib/exam-core.js. Runs on goja: plain ES6 only.
const Core = require(`${__hooks}/lib/exam-core.js`);
const Ans = require(`${__hooks}/lib/answers-core.js`);
const tg = require(`${__hooks}/tg.js`);

// Texts the bot sends. Edit here; no other code depends on the wording.
const TEXT = {
  assigned: (title, at) => "Тебе назначен пробник «" + title + "».\nНачало: " + at + " (по Москве).\n\nВ это время он откроется в тренажёре. Напомню за час.",
  moved: (title, at) => "Пробник «" + title + "» перенесён.\nНовое начало: " + at + " (по Москве).",
  canceled: (title) => "Пробник «" + title + "» отменён.",
  hour: (title, at) => "Через час пробник «" + title + "»: начало " + at + " (по Москве).\nПриготовь черновики и ручку.",
  open: (title, mins) => "Пробник «" + title + "» открыт. На работу " + mins + " мин, время уже идёт.",
  checked: (title, pts, max) => "Пробник «" + title + "» проверен: " + pts + " из " + max + ".\nБаллы и комментарии по второй части — в тренажёре.",
  done: (name, title, p1, max1, how) => name + " сдал(а) пробник «" + title + "».\nПервая часть: " + p1 + " из " + max1 + ".\nВторая часть: " + how + ".",
  howPhotos: (k) => "фото на сайте — " + k,
  howTg: "решения пришлёт в Telegram",
  howNone: "фото нет",
  btnOpen: "Открыть пробник",
  btnResult: "Посмотреть результат",
  btnCheck: "Проверить",
};
const MAX_PHOTOS = 5, MAX_LOG = 3000, MIN_DURATION = 60, MAX_DURATION = 21600;
const DAYS = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const env = (k) => $os.getenv(k);
const site = () => env("SITE_URL") || "https://kirillnyunenkov.github.io/math/";
const nowS = () => Math.floor(Date.now() / 1000);
const fail = (e, code, msg) => e.json(code, { message: msg });
const inUsers = (e) => e.auth && e.auth.collection().name === "users";
const isTeacher = (e) => inUsers(e) && e.auth.get("role") === "teacher";
const isStudent = (e) => inUsers(e) && e.auth.get("active") === true;

// A json field as a plain value (goja hands it over as raw bytes otherwise).
function J(rec, field, fallback) {
  try { const v = JSON.parse(rec.getString(field)); return v == null ? fallback : v; } catch (_) { return fallback; }
}
function shape(rec) {
  return { start: rec.getInt("start"), duration: rec.getInt("duration"), opened: rec.getInt("opened"),
    finished: rec.getInt("finished"), photos_done: rec.getInt("photos_done"), checked: rec.getInt("checked") };
}
// "в пятницу, 9 октября, в 18:00" — Moscow time is UTC+3 all year round.
function when(ts) {
  const d = new Date((ts + 10800) * 1000), m = d.getUTCMinutes();
  return DAYS[d.getUTCDay()] + ", " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + ", в " + d.getUTCHours() + ":" + (m < 10 ? "0" : "") + m;
}
// Sends to the student's Telegram; false if the account has none or it failed.
function tell(userId, text, url, label) {
  let chat = "";
  try { chat = $app.findFirstRecordByData("tg_profiles", "user", userId).getString("tg_id"); } catch (_) { return false; }
  return tg.send(chat, text, url, label);
}
const examUrl = (id) => site() + "#/exam/" + id;
function byId(coll, id) { try { return $app.findRecordById(coll, id); } catch (_) { return null; } }
const intOf = (v) => (typeof v === "number" && isFinite(v) && Math.floor(v) === v ? v : null);
// Record lists come from Go as slices; index them instead of relying on Array methods.
function each(rows, fn) { const out = []; for (let i = 0; i < rows.length; i++) out.push(fn(rows[i])); return out; }

function assign(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const b = e.requestInfo().body || {}, t = nowS();
  const user = byId("users", String(b.user || "")), exam = byId("exams", String(b.exam || ""));
  const start = intOf(b.start), duration = b.duration == null ? Core.DEFAULT_DURATION : intOf(b.duration);
  if (!user || !exam || start === null || duration === null) return fail(e, 400, "bad input");
  if (duration < MIN_DURATION || duration > MAX_DURATION) return fail(e, 400, "bad duration");
  const rec = new Record($app.findCollectionByNameOrId("exam_assignments"));
  rec.set("user", user.id); rec.set("exam", exam.id); rec.set("start", start); rec.set("duration", duration);
  rec.set("m_hour", start - t < 3600 ? t : 0);   // too close for a "one hour before"
  try { $app.save(rec); } catch (_) { return fail(e, 400, "already assigned"); }
  tell(user.id, TEXT.assigned(exam.getString("title"), when(start)), examUrl(rec.id), TEXT.btnOpen);
  return e.json(200, { id: rec.id });
}

// The row and its exam, for teacher actions allowed only while nothing was seen.
function untouched(e) {
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec) return { code: 404 };
  const p = Core.phase(shape(rec), nowS());
  if (p !== "scheduled" && p !== "missed") return { code: 409 };
  return { rec: rec, exam: $app.findRecordById("exams", rec.getString("exam")) };
}

function move(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const a = untouched(e);
  if (a.code) return fail(e, a.code, a.code === 404 ? "not found" : "already started");
  const b = e.requestInfo().body || {}, t = nowS();
  const start = intOf(b.start), duration = b.duration == null ? a.rec.getInt("duration") : intOf(b.duration);
  if (start === null || duration === null || duration < MIN_DURATION || duration > MAX_DURATION) return fail(e, 400, "bad input");
  a.rec.set("start", start); a.rec.set("duration", duration);
  a.rec.set("m_hour", start - t < 3600 ? t : 0); a.rec.set("m_open", 0);
  $app.save(a.rec);
  tell(a.rec.getString("user"), TEXT.moved(a.exam.getString("title"), when(start)), examUrl(a.rec.id), TEXT.btnOpen);
  return e.json(200, { ok: true });
}

function cancel(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const a = untouched(e);
  if (a.code) return fail(e, a.code, a.code === 404 ? "not found" : "already started");
  const user = a.rec.getString("user");
  $app.delete(a.rec);
  tell(user, TEXT.canceled(a.exam.getString("title")));
  return e.json(200, { ok: true });
}

module.exports = { assign: assign, move: move, cancel: cancel };
```

- [ ] **Step 5: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: 6 pass. If a route returns 500, start PocketBase by hand to read the error: `~/.local/pocketbase/pocketbase serve --http 127.0.0.1:8093 --dir /tmp/claude-pbdbg --migrationsDir backend/pb_migrations --hooksDir backend/pb_hooks` and repeat the request with `curl`.

- [ ] **Step 6: Commit**

```bash
git add backend/pb_hooks/exams.pb.js backend/pb_hooks/exams.js backend/tests/exams.test.mjs
git commit -m "Exams: teacher routes to assign, reschedule and cancel, with bot messages"
```

---

### Task 7: Student read routes — what is visible in each phase

**Files:**
- Modify: `backend/pb_hooks/exams.pb.js`, `backend/pb_hooks/exams.js`, `backend/tests/exams.test.mjs`

**Interfaces:**
- Consumes: Task 6 helpers.
- Produces:
  - `GET /api/ege/exams/mine` → `200 {now, items: [meta]}`, newest start first, own assignments only.
  - `GET /api/ege/exams/{id}` → `200 view`; `404` for someone else's or unknown id; `403` when signed out or inactive.
  - `meta = {id, title, full, start, duration, phase, via_tg}`.
  - `view = meta + {now}` plus, by phase: `open` → `tasks` (with `cond`), `answers`, `photos`; `photos` → `tasks` (long only, no `cond`), `photos`; `submitted` → `tasks`, `answers`, `photos`, `key`, `p1`, `max1`, `ok`; `checked` → the same plus `part2`, `total: {pts, max}`. `scheduled` and `missed` carry nothing more.
  - `photos = [{id, n, file}]` (`file` is the stored file name).
  - `own(e) -> {rec, exam} | null` and `settle(rec, exam, t)` (a no-op stub until Task 9) for later tasks.
- The first `GET {id}` during `open` sets `opened`.

- [ ] **Step 1: Append the failing tests**

```js
const view = (id, token) => req('GET', `/ege/exams/${id}`, token);

test('before the start the student sees the time and nothing else', async () => {
  const exam = await mkExam('Пробник А'), s = await student(7000000020), other = await student(7000000021);
  const start = nowS() + 7200;
  const id = (await assign(s.id, exam, start)).json.id;
  const mine = await req('GET', '/ege/exams/mine', s.token);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.items, [{ id, title: 'Пробник А', full: false, start, duration: 600, phase: 'scheduled', via_tg: false }]);
  assert.ok(Math.abs(mine.json.now - nowS()) <= 2);
  assert.deepEqual((await req('GET', '/ege/exams/mine', other.token)).json.items, []);
  assert.equal((await req('GET', '/ege/exams/mine', null)).status, 403);

  const v = await view(id, s.token);
  assert.equal(v.json.phase, 'scheduled');
  for (const k of ['tasks', 'key', 'answers', 'photos']) assert.equal(k in v.json, false, k);
  assert.equal((await view(id, other.token)).status, 404);
  assert.equal((await view(id, null)).status, 403);
  // looking early does not count as opening
  assert.equal((await req('GET', `/collections/exam_assignments/records/${id}`, tok.teacher)).json.opened, 0);
});

test('during the window: statements without the key; the first look marks it opened', async () => {
  const exam = await mkExam(), s = await student(7000000022);
  const id = (await assign(s.id, exam, nowS() - 10)).json.id;
  const v = await view(id, s.token);
  assert.equal(v.json.phase, 'open');
  assert.deepEqual(v.json.tasks, TASKS);
  assert.deepEqual(v.json.answers, {});
  assert.deepEqual(v.json.photos, []);
  assert.equal('key' in v.json, false);
  assert.equal(JSON.stringify(v.json).includes('2 + 3 = 5'), false);   // a solution text
  const rec = (await req('GET', `/collections/exam_assignments/records/${id}`, tok.teacher)).json;
  assert.ok(rec.opened >= nowS() - 2);
});

test('a window nobody opened is missed and shows nothing', async () => {
  const exam = await mkExam(), s = await student(7000000023);
  const id = (await assign(s.id, exam, nowS() - 5000, 60)).json.id;
  const v = await view(id, s.token);
  assert.equal(v.json.phase, 'missed');
  assert.equal('tasks' in v.json, false);
  assert.equal((await req('GET', `/collections/exam_assignments/records/${id}`, tok.teacher)).json.opened, 0);
});

test('photo phase hides the statements; after it the key is released', async () => {
  const exam = await mkExam(), s = await student(7000000024);
  const id = (await assign(s.id, exam, nowS() - 10)).json.id;
  await view(id, s.token);
  await shift(id, { start: nowS() - 700, duration: 600 });               // window ended 100 s ago
  let v = await view(id, s.token);
  assert.equal(v.json.phase, 'photos');
  assert.deepEqual(v.json.tasks, [{ n: 13, kind: 'long', max: 2 }]);
  assert.equal('key' in v.json, false);
  assert.equal('answers' in v.json, false);

  await shift(id, { start: nowS() - 1300, duration: 600 });              // photo grace is over too
  v = await view(id, s.token);
  assert.equal(v.json.phase, 'submitted');
  assert.deepEqual(v.json.tasks, TASKS);
  assert.deepEqual(v.json.key, KEY);
  assert.equal('part2' in v.json, false);
});
```

- [ ] **Step 2: Run and see them fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the four new tests FAIL with 404.

- [ ] **Step 3: Add the routes to `exams.pb.js`**

```js
routerAdd("GET", "/api/ege/exams/mine", (e) => require(`${__hooks}/exams.js`).mine(e));
routerAdd("GET", "/api/ege/exams/{id}", (e) => require(`${__hooks}/exams.js`).get(e));
```

- [ ] **Step 4: Add to `exams.js` (above `module.exports`) and extend the export**

```js
// The caller's own assignment with its exam, or null.
function own(e) {
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec || rec.getString("user") !== e.auth.id) return null;
  return { rec: rec, exam: $app.findRecordById("exams", rec.getString("exam")) };
}

function meta(rec, exam, t) {
  return { id: rec.id, title: exam.getString("title"), full: exam.getBool("full"), start: rec.getInt("start"),
    duration: rec.getInt("duration"), phase: Core.phase(shape(rec), t), via_tg: rec.getBool("via_tg") };
}

function photosOf(rec) {
  return each($app.findRecordsByFilter("exam_photos", "assignment = {:a}", "created", 200, 0, { a: rec.id }),
    (p) => ({ id: p.id, n: p.getString("n"), file: p.getString("file") }));
}

// Grades part 1 once the photo phase is over. Filled in by a later task.
function settle(rec, exam, t) {}

// Everything the student may see right now — and nothing more.
function viewOf(rec, exam, t) {
  const v = meta(rec, exam, t), tasks = J(exam, "tasks", []);
  v.now = t;
  if (v.phase === "open") {
    v.tasks = tasks; v.answers = J(rec, "answers", {}); v.photos = photosOf(rec);
  } else if (v.phase === "photos") {
    v.tasks = tasks.filter((x) => x.kind === "long").map((x) => ({ n: x.n, kind: x.kind, max: x.max }));
    v.photos = photosOf(rec);
  } else if (v.phase === "submitted" || v.phase === "checked") {
    const g = Ans.gradePart1(tasks, {}, {});
    v.tasks = tasks; v.answers = J(rec, "answers", {}); v.photos = photosOf(rec);
    v.key = J(exam, "key", {}); v.p1 = rec.getInt("p1"); v.max1 = g.max1; v.ok = J(rec, "ok", {});
    if (v.phase === "checked") { v.part2 = J(rec, "part2", {}); v.total = Core.total(tasks, v.p1, v.part2); }
  }
  return v;
}

function mine(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const t = nowS();
  const rows = $app.findRecordsByFilter("exam_assignments", "user = {:u}", "-start", 50, 0, { u: e.auth.id });
  const items = each(rows, (rec) => {
    const exam = $app.findRecordById("exams", rec.getString("exam"));
    settle(rec, exam, t);
    return meta(rec, exam, t);
  });
  return e.json(200, { now: t, items: items });
}

function get(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const a = own(e);
  if (!a) return fail(e, 404, "not found");
  const t = nowS();
  if (Core.phase(shape(a.rec), t) === "open" && !a.rec.getInt("opened")) { a.rec.set("opened", t); $app.save(a.rec); }
  settle(a.rec, a.exam, t);
  return e.json(200, viewOf(a.rec, a.exam, t));
}
```

```js
module.exports = { assign: assign, move: move, cancel: cancel, mine: mine, get: get };
```

- [ ] **Step 5: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: 10 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/pb_hooks backend/tests/exams.test.mjs
git commit -m "Exams: student read routes that reveal content by phase"
```

---

### Task 8: Student write routes — answers, away journal, finish, done, Telegram route

**Files:**
- Modify: `backend/pb_hooks/exams.pb.js`, `backend/pb_hooks/exams.js`, `backend/tests/exams.test.mjs`

**Interfaces:**
- Consumes: `own(e)`, `shape`, `J`.
- Produces (student, own assignment; `404` otherwise; `409 {message:"closed"}` in a wrong phase):
  - `POST /api/ege/exams/{id}/answers` body `{answers: {n: text}}` — only in `open`; merges, keeps short tasks only, trims each value to 40 chars, appends `[t, "a", n, value]` to `log` for every changed value → `200 {ok:true}`.
  - `POST /api/ege/exams/{id}/away` body `{n, sec}` — only in `open`; appends `[t, "w", n, sec]` → `200 {ok:true}`; `400` unless `sec` is an integer 1..duration.
  - `POST /api/ege/exams/{id}/finish` — only in `open` after it was opened; sets `finished` → `200 {ok:true}`.
  - `POST /api/ege/exams/{id}/done` — only in `photos`; sets `photos_done` → `200 {ok:true}`.
  - `POST /api/ege/exams/{id}/via-tg` body `{on: boolean}` — in `open` or `photos` → `200 {ok:true}`.
- The student never receives `log`.

- [ ] **Step 1: Append the failing tests**

```js
const post = (id, what, token, body) => req('POST', `/ege/exams/${id}/${what}`, token, body);
const rowOf = async (id) => (await req('GET', `/collections/exam_assignments/records/${id}`, tok.teacher)).json;
async function started(tgId, duration = 600) {
  const exam = await mkExam(), s = await student(tgId);
  const id = (await assign(s.id, exam, nowS() - 10, duration)).json.id;
  await view(id, s.token);
  return { id, s, exam };
}

test('answers are saved while the window is open and come back on reload', async () => {
  const { id, s } = await started(7000000030);
  assert.equal((await post(id, 'answers', s.token, { answers: { 1: '5', 2: ' 0,6 ', 13: 'x', 99: '1' } })).status, 200);
  assert.equal((await post(id, 'answers', s.token, { answers: { 2: '0,5' } })).status, 200);
  assert.equal((await post(id, 'answers', s.token, { answers: { 2: '0,5' } })).status, 200);   // unchanged
  const v = await view(id, s.token);
  assert.deepEqual(v.json.answers, { 1: '5', 2: '0,5' });        // only short tasks, trimmed
  assert.equal('log' in v.json, false);
  const log = (await rowOf(id)).log;
  assert.deepEqual(log.map(x => x.slice(1)), [['a', '1', '5'], ['a', '2', '0,6'], ['a', '2', '0,5']]);
  assert.ok(log.every(x => Math.abs(x[0] - nowS()) <= 3));
});

test('nobody else can write, and a very long answer is cut', async () => {
  const { id, s } = await started(7000000031);
  const other = await student(7000000032);
  assert.equal((await post(id, 'answers', other.token, { answers: { 1: '5' } })).status, 404);
  assert.equal((await post(id, 'answers', null, { answers: { 1: '5' } })).status, 403);
  await post(id, 'answers', s.token, { answers: { 1: '9'.repeat(500) } });
  assert.equal((await view(id, s.token)).json.answers[1].length, 40);
});

test('away intervals go to the journal', async () => {
  const { id, s } = await started(7000000033);
  assert.equal((await post(id, 'away', s.token, { n: 2, sec: 42 })).status, 200);
  assert.equal((await post(id, 'away', s.token, { n: 2, sec: 0 })).status, 400);
  assert.equal((await post(id, 'away', s.token, { n: 2, sec: 'x' })).status, 400);
  assert.equal((await post(id, 'away', s.token, { n: 2, sec: 100000 })).status, 400);
  assert.deepEqual((await rowOf(id)).log.map(x => x.slice(1)), [['w', '2', 42]]);
});

test('after the window nothing is accepted', async () => {
  const { id, s } = await started(7000000034);
  await post(id, 'answers', s.token, { answers: { 1: '5' } });
  await shift(id, { start: nowS() - 700, duration: 600 });
  assert.equal((await post(id, 'answers', s.token, { answers: { 1: '6' } })).status, 409);
  assert.equal((await post(id, 'away', s.token, { n: 1, sec: 5 })).status, 409);
  assert.equal((await post(id, 'finish', s.token)).status, 409);
  assert.deepEqual((await rowOf(id)).answers, { 1: '5' });
});

test('early finish opens the photo phase; done closes it', async () => {
  const { id, s } = await started(7000000035);
  assert.equal((await post(id, 'done', s.token)).status, 409);            // not in the photo phase yet
  assert.equal((await post(id, 'via-tg', s.token, { on: true })).status, 200);
  assert.equal((await post(id, 'finish', s.token)).status, 200);
  assert.equal((await view(id, s.token)).json.phase, 'photos');
  assert.equal((await post(id, 'answers', s.token, { answers: { 1: '5' } })).status, 409);
  assert.equal((await post(id, 'via-tg', s.token, { on: false })).status, 200);
  assert.equal((await post(id, 'done', s.token)).status, 200);
  const v = await view(id, s.token);
  assert.equal(v.json.phase, 'submitted');
  assert.equal(v.json.via_tg, false);
  assert.equal((await post(id, 'via-tg', s.token, { on: true })).status, 409);
});

test('an exam that was never opened cannot be finished', async () => {
  const exam = await mkExam(), s = await student(7000000036);
  const id = (await assign(s.id, exam, nowS() - 10)).json.id;
  assert.equal((await post(id, 'finish', s.token)).status, 409);
});
```

- [ ] **Step 2: Run and see them fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the six new tests FAIL with 404.

- [ ] **Step 3: Add the routes to `exams.pb.js`**

```js
routerAdd("POST", "/api/ege/exams/{id}/answers", (e) => require(`${__hooks}/exams.js`).answers(e));
routerAdd("POST", "/api/ege/exams/{id}/away", (e) => require(`${__hooks}/exams.js`).away(e));
routerAdd("POST", "/api/ege/exams/{id}/finish", (e) => require(`${__hooks}/exams.js`).finish(e));
routerAdd("POST", "/api/ege/exams/{id}/done", (e) => require(`${__hooks}/exams.js`).done(e));
routerAdd("POST", "/api/ege/exams/{id}/via-tg", (e) => require(`${__hooks}/exams.js`).viaTg(e));
```

- [ ] **Step 4: Add to `exams.js` and extend the export**

```js
// The caller's assignment if its phase is one of `phases`; otherwise the
// handler's error answer is already written and `res` holds it.
function during(e, phases) {
  if (!isStudent(e)) return { res: fail(e, 403, "forbidden") };
  const a = own(e);
  if (!a) return { res: fail(e, 404, "not found") };
  a.t = nowS(); a.phase = Core.phase(shape(a.rec), a.t);
  if (phases.indexOf(a.phase) < 0) return { res: fail(e, 409, "closed") };
  return a;
}
function logPush(rec, entries) {
  const log = J(rec, "log", []);
  entries.forEach((x) => { if (log.length < MAX_LOG) log.push(x); });
  rec.set("log", log);
}

function answers(e) {
  const a = during(e, ["open"]);
  if (a.res) return a.res;
  const incoming = (e.requestInfo().body || {}).answers || {};
  const short = {};
  J(a.exam, "tasks", []).forEach((x) => { if (x.kind === "short") short[String(x.n)] = true; });
  const cur = J(a.rec, "answers", {}), added = [];
  Object.keys(incoming).forEach((n) => {
    if (!short[n]) return;
    const v = String(incoming[n] == null ? "" : incoming[n]).trim().slice(0, 40);
    if ((cur[n] || "") === v) return;
    cur[n] = v; added.push([a.t, "a", n, v]);
  });
  if (added.length) { a.rec.set("answers", cur); logPush(a.rec, added); $app.save(a.rec); }
  return e.json(200, { ok: true });
}

function away(e) {
  const a = during(e, ["open"]);
  if (a.res) return a.res;
  const b = e.requestInfo().body || {}, sec = intOf(b.sec);
  if (sec === null || sec < 1 || sec > a.rec.getInt("duration")) return fail(e, 400, "bad input");
  logPush(a.rec, [[a.t, "w", String(b.n == null ? "" : b.n).slice(0, 8), sec]]);
  $app.save(a.rec);
  return e.json(200, { ok: true });
}

function finish(e) {
  const a = during(e, ["open"]);
  if (a.res) return a.res;
  if (!a.rec.getInt("opened")) return fail(e, 409, "closed");
  a.rec.set("finished", a.t); $app.save(a.rec);
  return e.json(200, { ok: true });
}

function done(e) {
  const a = during(e, ["photos"]);
  if (a.res) return a.res;
  a.rec.set("photos_done", a.t); $app.save(a.rec);
  settle(a.rec, a.exam, a.t);
  return e.json(200, { ok: true });
}

function viaTg(e) {
  const a = during(e, ["open", "photos"]);
  if (a.res) return a.res;
  a.rec.set("via_tg", (e.requestInfo().body || {}).on === true); $app.save(a.rec);
  return e.json(200, { ok: true });
}
```

```js
module.exports = { assign: assign, move: move, cancel: cancel, mine: mine, get: get,
  answers: answers, away: away, finish: finish, done: done, viaTg: viaTg };
```

- [ ] **Step 5: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: 16 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/pb_hooks backend/tests/exams.test.mjs
git commit -m "Exams: autosave of answers, away journal, finish and photo-phase controls"
```

---

### Task 9: Photos, settling, the teacher's check, and the cron tick

**Files:**
- Modify: `backend/pb_hooks/exams.pb.js`, `backend/pb_hooks/exams.js`, `backend/tests/exams.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `POST /api/ege/exams/{id}/photos` multipart `n`, `file` — in `open` or `photos`, long tasks only, at most 5 per task → `200 {id, n, file}`; `400` bad task / bad file / too many; `409` closed.
  - `DELETE /api/ege/exams/{id}/photos/{pid}` — in `open` or `photos`, own photo → `200 {ok:true}`.
  - Photo bytes are read through PocketBase's own protected-file URL: `POST /api/files/token` → `GET /api/files/exam_photos/{photoId}/{file}?token=…` (owner or teacher).
  - `settle(rec, exam, t)` — real body: when the phase is `submitted` and `settled` is 0, stores `p1`, `ok`, `settled` and messages the teacher once.
  - `POST /api/ege/exams/{id}/check` teacher only, body `{part2: {n: {pts, comment}}}` — requires `settled`; every long task must have integer `pts` in `0..max`; comments cut to 2000 chars → `200 {ok:true}`; the first check sets `checked` and messages the student, later ones only update.
  - `POST /api/ege/exams/tick` superuser only → `200 {ok:true}`; the same `tick()` runs from `cronAdd("exams-tick", "* * * * *", …)`.

- [ ] **Step 1: Append the failing tests**

```js
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function upload(id, token, n, bytes = PNG, type = 'image/png', name = 'p.png') {
  const fd = new FormData();
  fd.append('n', String(n));
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(`${B}/ege/exams/${id}/photos`, { method: 'POST', headers: token ? { Authorization: token } : {}, body: fd });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const tick = () => req('POST', '/ege/exams/tick', tok.su);

test('photos: long tasks only, five per task, owner and teacher can read the file', async () => {
  const { id, s } = await started(7000000040);
  const other = await student(7000000041);
  assert.equal((await upload(id, other.token, 13)).status, 404);
  assert.equal((await upload(id, s.token, 1)).status, 400);                 // a short task
  assert.equal((await upload(id, s.token, 13, Buffer.from('hello'), 'text/plain', 'a.txt')).status, 400);
  const up = await upload(id, s.token, 13);
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.deepEqual((await view(id, s.token)).json.photos, [{ id: up.json.id, n: '13', file: up.json.file }]);

  const url = (t) => `${B}/files/exam_photos/${up.json.id}/${up.json.file}?token=${t}`;
  const ft = async (token) => (await req('POST', '/files/token', token)).json.token;
  assert.equal((await fetch(url(await ft(s.token)))).status, 200);
  assert.equal((await fetch(url(await ft(tok.teacher)))).status, 200);
  // PocketBase refuses a protected file with 403 or 404 depending on the case
  assert.ok([403, 404].includes((await fetch(url(await ft(other.token)))).status));
  assert.ok([403, 404].includes((await fetch(`${B}/files/exam_photos/${up.json.id}/${up.json.file}`)).status));

  for (let i = 0; i < 4; i++) assert.equal((await upload(id, s.token, 13)).status, 200);
  assert.equal((await upload(id, s.token, 13)).status, 400);                // the sixth
  assert.equal((await req('DELETE', `/ege/exams/${id}/photos/${up.json.id}`, other.token)).status, 404);
  assert.equal((await req('DELETE', `/ege/exams/${id}/photos/${up.json.id}`, s.token)).status, 200);
  assert.equal((await view(id, s.token)).json.photos.length, 4);
});

test('photos are accepted in the photo phase and refused after it', async () => {
  const { id, s } = await started(7000000042);
  await post(id, 'finish', s.token);
  assert.equal((await upload(id, s.token, 13)).status, 200);
  await post(id, 'done', s.token);
  assert.equal((await upload(id, s.token, 13)).status, 409);
});

test('settling grades part 1 and tells the teacher once', async () => {
  const { id, s } = await started(7000000043);
  await post(id, 'answers', s.token, { answers: { 1: '5', 2: '0,6' } });
  await post(id, 'finish', s.token);
  await upload(id, s.token, 13);
  await post(id, 'done', s.token);
  const v = (await view(id, s.token)).json;
  assert.equal(v.phase, 'submitted');
  assert.equal(v.p1, 1); assert.equal(v.max1, 2);
  assert.deepEqual(v.ok, { 1: true, 2: false });
  await view(id, s.token); await tick();
  const msgs = sent.filter(m => String(m.chat_id) === TEACHER_CHAT && m.text.includes('Первая часть: 1 из 2'));
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].text.includes('фото на сайте — 1'));
  assert.ok(msgs[0].reply_markup.inline_keyboard[0][0].url.endsWith('teacher.html#/check/' + id));
});

test('the tick settles a student who closed the page, and leaves a missed exam alone', async () => {
  const { id, s } = await started(7000000044);
  await post(id, 'answers', s.token, { answers: { 1: '5' } });
  await post(id, 'via-tg', s.token, { on: true });
  await shift(id, { start: nowS() - 1300, duration: 600 });
  const exam = await mkExam(), lazy = await student(7000000045);
  const missed = (await assign(lazy.id, exam, nowS() - 5000, 60)).json.id;
  assert.equal((await req('POST', '/ege/exams/tick', tok.teacher)).status, 403);
  assert.equal((await tick()).status, 200);
  const row = await rowOf(id);
  assert.ok(row.settled > 0); assert.equal(row.p1, 1);
  assert.equal(sent.filter(m => String(m.chat_id) === TEACHER_CHAT && m.text.includes('решения пришлёт в Telegram')).length, 1);
  assert.equal((await rowOf(missed)).settled, 0);
});

test('the tick sends the hour reminder and the opening message once each', async () => {
  const exam = await mkExam('Пробник Ч'), s = await student(7000000046);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  await tick();
  assert.equal(said(s.chat, 'Через час пробник «Пробник Ч»'), 0);          // two hours away
  await shift(id, { start: nowS() + 1800 });
  await tick(); await tick();
  assert.equal(said(s.chat, 'Через час пробник «Пробник Ч»'), 1);
  await shift(id, { start: nowS() - 5 });
  await tick(); await tick();
  const open = sent.filter(m => String(m.chat_id) === String(s.chat) && m.text.includes('«Пробник Ч» открыт'));
  assert.equal(open.length, 1);
  assert.ok(open[0].reply_markup.inline_keyboard[0][0].url.endsWith('#/exam/' + id));
});

test('check: teacher only, valid points only, the student is told once', async () => {
  const { id, s } = await started(7000000047);
  const check = (token, part2) => post(id, 'check', token, { part2 });
  assert.equal((await check(tok.teacher, { 13: { pts: 1 } })).status, 409);     // not submitted yet
  await post(id, 'answers', s.token, { answers: { 1: '5', 2: '0,5' } });
  await post(id, 'finish', s.token); await post(id, 'done', s.token);
  assert.equal((await check(s.token, { 13: { pts: 1 } })).status, 403);
  assert.equal((await check(tok.teacher, {})).status, 400);                     // task 13 missing
  assert.equal((await check(tok.teacher, { 13: { pts: 3 } })).status, 400);     // above max
  assert.equal((await check(tok.teacher, { 13: { pts: 1.5 } })).status, 400);
  assert.equal((await check(tok.teacher, { 13: { pts: 1, comment: 'Потерян корень' } })).status, 200);
  const v = (await view(id, s.token)).json;
  assert.equal(v.phase, 'checked');
  assert.deepEqual(v.part2, { 13: { pts: 1, comment: 'Потерян корень' } });
  assert.deepEqual(v.total, { pts: 3, max: 4 });
  assert.equal(said(s.chat, 'проверен: 3 из 4'), 1);
  assert.equal((await check(tok.teacher, { 13: { pts: 2, comment: '' } })).status, 200);   // a correction
  assert.equal((await view(id, s.token)).json.total.pts, 4);
  assert.equal(said(s.chat, 'проверен:'), 1);
});
```

- [ ] **Step 2: Run and see them fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the six new tests FAIL (404 on the new routes).

- [ ] **Step 3: Add the routes and the cron job to `exams.pb.js`**

```js
routerAdd("POST", "/api/ege/exams/{id}/photos", (e) => require(`${__hooks}/exams.js`).addPhoto(e));
routerAdd("DELETE", "/api/ege/exams/{id}/photos/{pid}", (e) => require(`${__hooks}/exams.js`).delPhoto(e));
routerAdd("POST", "/api/ege/exams/{id}/check", (e) => require(`${__hooks}/exams.js`).check(e));
// The same work the cron does, callable on demand (tests, a manual kick).
routerAdd("POST", "/api/ege/exams/tick", (e) => {
  if (!e.hasSuperuserAuth()) return e.json(403, { message: "forbidden" });
  require(`${__hooks}/exams.js`).tick();
  return e.json(200, { ok: true });
});
cronAdd("exams-tick", "* * * * *", () => require(`${__hooks}/exams.js`).tick());
```

- [ ] **Step 4: In `exams.js` replace the `settle` stub, add the rest, extend the export**

Replace `function settle(rec, exam, t) {}` with:

```js
// Once the photo phase is over: grade part 1 and tell the teacher. Runs from
// the student's own requests and from the cron tick, whichever comes first.
function settle(rec, exam, t) {
  if (rec.getInt("settled") || Core.phase(shape(rec), t) !== "submitted") return;
  const g = Ans.gradePart1(J(exam, "tasks", []), J(exam, "key", {}), J(rec, "answers", {}));
  rec.set("p1", g.p1); rec.set("ok", g.ok); rec.set("settled", t);
  $app.save(rec);
  const chat = env("TEACHER_TG_ID");
  if (!chat) return;
  const k = photosOf(rec).length;
  const how = k ? TEXT.howPhotos(k) : rec.getBool("via_tg") ? TEXT.howTg : TEXT.howNone;
  const name = $app.findRecordById("users", rec.getString("user")).getString("name");
  tg.send(chat, TEXT.done(name, exam.getString("title"), g.p1, g.max1, how), site() + "teacher.html#/check/" + rec.id, TEXT.btnCheck);
}
```

Add above `module.exports`:

```js
function addPhoto(e) {
  const a = during(e, ["open", "photos"]);
  if (a.res) return a.res;
  const n = String(e.request.formValue("n") || "");
  const task = J(a.exam, "tasks", []).filter((x) => String(x.n) === n && x.kind === "long")[0];
  if (!task) return fail(e, 400, "bad task");
  const files = e.findUploadedFiles("file");
  if (!files || files.length !== 1) return fail(e, 400, "one file expected");
  if ($app.countRecords("exam_photos", $dbx.hashExp({ assignment: a.rec.id, n: n })) >= MAX_PHOTOS) return fail(e, 400, "too many");
  const p = new Record($app.findCollectionByNameOrId("exam_photos"));
  p.set("user", e.auth.id); p.set("assignment", a.rec.id); p.set("n", n); p.set("file", files[0]);
  try { $app.save(p); } catch (_) { return fail(e, 400, "bad file"); }   // size or type refused by the field
  return e.json(200, { id: p.id, n: n, file: p.getString("file") });
}

function delPhoto(e) {
  const a = during(e, ["open", "photos"]);
  if (a.res) return a.res;
  const p = byId("exam_photos", e.request.pathValue("pid"));
  if (!p || p.getString("assignment") !== a.rec.id) return fail(e, 404, "not found");
  $app.delete(p);
  return e.json(200, { ok: true });
}

function check(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec) return fail(e, 404, "not found");
  const exam = $app.findRecordById("exams", rec.getString("exam")), t = nowS();
  settle(rec, exam, t);
  if (!rec.getInt("settled")) return fail(e, 409, "not submitted");
  const incoming = (e.requestInfo().body || {}).part2 || {}, tasks = J(exam, "tasks", []), part2 = {};
  for (let i = 0; i < tasks.length; i++) {
    const x = tasks[i];
    if (x.kind !== "long") continue;
    const g = incoming[String(x.n)] || {}, pts = intOf(g.pts);
    if (pts === null || pts < 0 || pts > (x.max || 1)) return fail(e, 400, "bad points for task " + x.n);
    part2[String(x.n)] = { pts: pts, comment: String(g.comment == null ? "" : g.comment).slice(0, 2000) };
  }
  const first = !rec.getInt("checked");
  rec.set("part2", part2);
  if (first) rec.set("checked", t);
  $app.save(rec);
  if (first) {
    const sum = Core.total(tasks, rec.getInt("p1"), part2);
    tell(rec.getString("user"), TEXT.checked(exam.getString("title"), sum.pts, sum.max), examUrl(rec.id), TEXT.btnResult);
  }
  return e.json(200, { ok: true });
}

// Every minute: reminders, the opening message, settling of finished work.
// A message flag is set only when Telegram accepted the message, so a failed
// send is retried on the next runs while the message still makes sense.
function tick() {
  const t = nowS();
  const rows = $app.findRecordsByFilter("exam_assignments",
    "checked = 0 && settled = 0 && start < {:soon} && start > {:old}", "start", 500, 0,
    { soon: t + 3600, old: t - 7 * 86400 });
  each(rows, (rec) => {
    try {
      const exam = $app.findRecordById("exams", rec.getString("exam"));
      const start = rec.getInt("start"), duration = rec.getInt("duration"), title = exam.getString("title");
      if (t < start && !rec.getInt("m_hour")) {
        if (tell(rec.getString("user"), TEXT.hour(title, when(start)))) { rec.set("m_hour", t); $app.save(rec); }
      } else if (t >= start && t < start + duration && !rec.getInt("m_open")) {
        const mins = Math.floor((start + duration - t) / 60);
        if (tell(rec.getString("user"), TEXT.open(title, mins), examUrl(rec.id), TEXT.btnOpen)) { rec.set("m_open", t); $app.save(rec); }
      }
      settle(rec, exam, t);
    } catch (err) { console.log("exams: tick failed for " + rec.id); }
  });
}
```

```js
module.exports = { assign: assign, move: move, cancel: cancel, mine: mine, get: get,
  answers: answers, away: away, finish: finish, done: done, viaTg: viaTg,
  addPhoto: addPhoto, delPhoto: delPhoto, check: check, tick: tick };
```

- [ ] **Step 5: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: 22 pass. Known points to check in `~/.local/pocketbase/pb_data/types.d.ts` if a route answers 500: `findUploadedFiles`, `request.formValue`, `countRecords`, `$dbx.hashExp`, `hasSuperuserAuth`, `cronAdd`.

- [ ] **Step 6: Run everything**

```bash
node --test 'tests/*.test.mjs'
PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'
```

Expected: both runs all green.

- [ ] **Step 7: Commit**

```bash
git add backend/pb_hooks backend/tests/exams.test.mjs
git commit -m "Exams: photos, part 1 grading, teacher check and the reminder cron"
```

---

### Task 10: Documentation and rollout commands

**Files:**
- Modify: `backend/README.md`

**Interfaces:**
- Produces: a README section the owner follows to roll the server part out; nothing in code.

- [ ] **Step 1: Add `TEACHER_TG_ID` to the layout table**

In the row for `/etc/ege-api.env` change the description to:

```
| `/etc/ege-api.env` | `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TEACHER_TG_ID` (root-only, mode 600) |
```

- [ ] **Step 2: Append the section**

````markdown
## Assigned mock exams

Design: `docs/superpowers/specs/2026-10-05-assigned-exams-design.md`.

The teacher's own exams live in `exams` (statements in `tasks`, answers and
part 1 solutions in `key`) and are never part of the public site. An exam is
opened to one student by a row in `exam_assignments`; photos of part 2 go to
`exam_photos` (protected files). Students reach all of it only through the
routes in `pb_hooks/exams.js`, which decide by the server clock what may be
shown (phases: `exam-core.js`). Bot texts are at the top of `exams.js`.

`pb_hooks/lib/` holds copies of `exam-core.js` and `answers-core.js` from the
repository root. After editing either file:

    cp answers-core.js exam-core.js backend/pb_hooks/lib/

(`tests/cores-in-sync.test.mjs` fails if you forget.)

A cron job inside PocketBase (`exams-tick`, every minute) sends the "one hour
before" and "exam is open" messages and settles finished work. Messages to the
teacher go to the chat in `TEACHER_TG_ID`.

### Rollout

1. The teacher presses "Старт" in the bot once, from the account that should
   receive "student has submitted" messages.
2. On the server, find that chat id and add it to the env file (prints only
   the id):

       sqlite3 /opt/ege-api/pb_data/data.db "SELECT tg_id FROM tg_profiles WHERE username = '<telegram username>'"
       echo 'TEACHER_TG_ID=<id>' >> /etc/ege-api.env

3. Check free disk space (photos): `df -h /opt/ege-api`.
4. Copy the migration and the hooks, restart:

       scp backend/pb_migrations/1790800007_exams.js root@185.249.154.78:/opt/ege-api/pb_migrations/
       scp -r backend/pb_hooks/exams.pb.js backend/pb_hooks/exams.js backend/pb_hooks/tg.js backend/pb_hooks/lib root@185.249.154.78:/opt/ege-api/pb_hooks/
       ssh root@185.249.154.78 'chown -R egeapi: /opt/ege-api/pb_migrations /opt/ege-api/pb_hooks && systemctl restart ege-api && sleep 2 && systemctl is-active ege-api'

5. Verify from anywhere: `curl -s -o /dev/null -w '%{http_code}\n' https://api.kirillnyun.space/api/ege/exams/mine`
   must print `403` (the route exists and refuses a signed-out caller).

The nightly backup archives `pb_data`, which now includes the photos in
`pb_data/storage/`; watch the size of `/opt/ege-api/backups/`.
````

- [ ] **Step 3: Confirm the facts the section states**

Run: `grep -n "egeapi\|pb_data\|tar" backend/deploy/backup.sh backend/deploy/ege-api.service`
Expected: the service user is `egeapi` and the backup archives the whole `pb_data` directory. If either differs, correct the README text to what the files say.

- [ ] **Step 4: Commit**

```bash
git add backend/README.md
git commit -m "Document assigned exams and the server rollout"
```
