# Assigned Mock Exams, Part 2 of 3: Trainer (student side) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the trainer, a signed-in student sees the exam the teacher assigned (banner with date and time), writes it inside the hard time window (answers autosaved, timer by the server clock), attaches photos of part 2 on the site or sends them to the sign-in bot, and then sees the results and, after the teacher's check, the points and comments.

**Architecture:** A new lazily-simple script `exam.js` (global `ExamUI`) renders the exam screens into the existing `#app` using the existing exam card markup and styles; pure logic lives in `exam-client-core.js` (unit-tested in Node). `index.html` gets a route `#/exam/<id>`, a hub banner hook, a few CSS rules and two script tags. All data comes from the server routes built in Plan 1; nothing about assigned exams is written to localStorage progress, marks or the regular mock-exam history.

**Tech Stack:** Vanilla JS in the existing single-page `index.html` (no build step), KaTeX (already loaded), Canvas for photo downscaling, Node's built-in test runner for the pure module, a local PocketBase stack for browser verification.

**Spec:** `docs/superpowers/specs/2026-10-05-assigned-exams-design.md` ("Trainer" section and the phase table). Server contract: `backend/pb_hooks/exams.js` (Plan 1, already merged).

## Global Constraints

- The repository is public. No real exam content anywhere; use made-up tasks in the dev stack and tests.
- Nothing about assigned exams is stored in the progress `state`, the event journal, `variants` history or `localStorage` (the only localStorage key allowed is `ege_exam_seen_v1`, the list of checked-exam ids whose result the student already opened, so the banner stops showing).
- All time decisions come from the server: the page keeps `offset = serverNow*1000 − Date.now()` from the last response and never trusts the device clock for deadlines.
- Phones are the main device: layout must work at 375 px width; dark theme must work (use tokens from `:root` in `index.html`, never new colors). Colour rule from the design system: warm colours = student status, blue accent = interface; the exam banner and buttons are interface (accent).
- Text for the student in Russian, on «ты», no emoji. Code comments in English.
- The numeric answer inputs must give iPhone the text keyboard (minus sign only exists there): use `IS_IPHONE` and the same attributes as `ansAttrs` does for iPhone, regardless of `TASKDATA`.
- Photos are never uploaded as shot: long side at most 2000 px, JPEG; an image the browser cannot decode is not uploaded, the student gets the message "Этот файл не получается обработать. Прикрепи его с телефона или отправь фото боту в Telegram."
- Photos of part 2 can also arrive through the bot (Plan 1b): the page lists them with `GET /ege/exams/{id}/photos` (polled every 15 s while the exam or the photo phase is on screen) and shows them next to the ones attached on the site. The old checkbox "Отправлю решения в Telegram" and the `via-tg` call are NOT used any more.
- No abrupt opening: the hub banner turns into the "Открыть" button with a short animation, and the exam screen fades in when the start time comes. Animations are CSS-only and switched off by `prefers-reduced-motion`.
- Bump `VERSION` in `sw.js` (currently `v86`) in the task that changes shipped files, and add the new files to `SHELL`. API requests are never cached (the service worker already ignores other origins).
- Commit after every task; never push to `master`; never touch the production server.
- Unit tests: `node --test 'tests/*.test.mjs'`. Backend tests: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`.

## Server contract the trainer relies on (from Plan 1)

All under `API` (`http://127.0.0.1:8090/api` locally), header `Authorization: <auth.token>`:

- `GET /ege/exams/mine` → `{now, items:[{id,title,full,start,duration,phase,via_tg}]}` (newest start first). Task 1 adds `until`.
- `GET /ege/exams/{id}/photos` → `{photos:[{id,n,file}]}` (Plan 1b; `409` while scheduled/missed).
- `GET /ege/exams/{id}` → meta + `now` + by phase:
  - `scheduled`, `missed`: nothing more.
  - `open`: `tasks:[{n,kind:'short'|'long',max,cond}]`, `answers:{n:text}`, `photos:[{id,n,file}]`.
  - `photos`: `tasks:[{n,kind:'long',max}]` (no `cond`), `photos`.
  - `submitted`: `tasks` (with `cond`), `answers`, `photos`, `key:{n:{a,sol?}}`, `p1`, `max1`, `ok:{n:boolean}`.
  - `checked`: the above plus `part2:{n:{pts,comment}}`, `total:{pts,max}`.
- `POST /ege/exams/{id}/answers` `{answers:{n:text}}`; `/away` `{n,sec}`; `/finish`; `/done`; `POST /ege/exams/{id}/photos` multipart `n`,`file` → `{id,n,file}`; `DELETE /ege/exams/{id}/photos/{pid}`. Wrong phase → `409`.
- Photo bytes: `POST /files/token` → `{token}` (short-lived), then `GET /files/exam_photos/{photoId}/{file}?token=…`.

## File Structure

| File | Responsibility |
|---|---|
| `backend/pb_hooks/exams.js` (modify) | `meta()` gains `until`. |
| `exam-client-core.js` (new) | Pure helpers: date text, clock offset, countdown, image fit, away tracker, save queue. |
| `tests/exam-client-core.test.mjs` (new) | Unit tests for the above. |
| `tools/exam-dev-stack.mjs` (new) | Local PocketBase + Telegram stub + seeded teacher/student/exam/assignment for browser checks (reused by Plan 3). |
| `exam.js` (new) | `ExamUI`: banner, screens for every phase, autosave, photos, away journal. |
| `index.html` (modify) | Route, banner hook, Sync guard, CSS, script tags. |
| `sw.js` (modify) | New files in `SHELL`, `VERSION` bump. |

---

### Task 1: Server — `until` in the exam meta

The client needs to know when the current phase ends (`end` while open, the photo deadline in the photo phase, the start while scheduled), including after an early finish and after a reload.

**Files:**
- Modify: `backend/pb_hooks/exams.js` (function `meta`, near line 200)
- Test: `backend/tests/exams.test.mjs`

**Interfaces:**
- Produces: `meta.until` — unix seconds: `scheduled` → `start`; `open` → `ExamCore.times(a).stop`; `photos` → `ExamCore.times(a).photoUntil`; every other phase → `0`.

- [ ] **Step 1: Update the existing assertion and add a test**

In the test `'before the start the student sees the time and nothing else'` change the `deepEqual` on `mine.json.items` to include `until: start`:

```js
  assert.deepEqual(mine.json.items, [{ id, title: 'Пробник А', full: false, start, duration: 600, phase: 'scheduled', via_tg: false, until: start }]);
```

Append a new test:

```js
test('meta.until is the end of the current phase', async () => {
  const exam = await mkExam(), s = await student(7000000200);
  const t = nowS();
  const id = (await assign(s.id, exam, t - 10, 600)).json.id;
  let v = (await view(id, s.token)).json;
  assert.equal(v.phase, 'open');
  assert.equal(v.until, t - 10 + 600);                                   // the end of the window
  await post(id, 'finish', s.token);
  v = (await view(id, s.token)).json;
  assert.equal(v.phase, 'photos');
  assert.ok(Math.abs(v.until - (nowS() + 600)) <= 2);                    // finish time + 10 minutes
  await shift(id, { start: nowS() - 5000, duration: 600, finished: 0, photos_done: 0 });
  v = (await view(id, s.token)).json;
  assert.equal(v.phase, 'submitted');
  assert.equal(v.until, 0);
});
```

- [ ] **Step 2: Run and see the new assertions fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the changed test and the new test FAIL (`until` is missing / `undefined`).

- [ ] **Step 3: Implement**

Replace `meta` with:

```js
// The moment the current phase ends, for the page's countdown: the start while
// scheduled, the end of the window while open, the photo deadline in the photo phase.
function untilOf(a, phase) {
  const t = Core.times(a);
  if (phase === "scheduled") return a.start;
  if (phase === "open") return t.stop;
  if (phase === "photos") return t.photoUntil;
  return 0;
}
function meta(rec, exam, t) {
  const a = shape(rec), phase = Core.phase(a, t);
  return { id: rec.id, title: exam.getString("title"), full: exam.getBool("full"), start: rec.getInt("start"),
    duration: rec.getInt("duration"), phase: phase, via_tg: rec.getBool("via_tg"), until: untilOf(a, phase) };
}
```

- [ ] **Step 4: Run the whole backend suite**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass. If another existing assertion compares a whole meta object, add `until` there as well.

- [ ] **Step 5: Commit**

```bash
git add backend/pb_hooks/exams.js backend/tests/exams.test.mjs
git commit -m "Exams: expose until, the end of the current phase, in the meta"
```

---

### Task 2: `exam-client-core.js` — pure helpers

**Files:**
- Create: `exam-client-core.js`
- Test: `tests/exam-client-core.test.mjs`

**Interfaces:**
- Produces (`ExamClientCore`, Node: `require('../exam-client-core.js')`, browser: `window.ExamClientCore`):
  - `whenText(ts) -> string` — "в пятницу, 9 октября, в 18:00" (Moscow time, UTC+3).
  - `offsetOf(serverNowSec, clientNowMs) -> ms` — add to the client clock to get the server clock.
  - `leftSec(untilSec, offsetMs, clientNowMs) -> integer >= 0`.
  - `fmtLeft(sec) -> "H:MM:SS"` for an hour or more, else `"MM:SS"`.
  - `fitSize(w, h, max) -> {w, h}` — scale so the long side is at most `max`, never upscale.
  - `AwayTracker(minSec)` with `hide(nowMs, n)` and `show(nowMs) -> {n, sec} | null`.
  - `SaveQueue()` with `set(n, v)`, `has()`, `snapshot()`, `ack(snap)`.

- [ ] **Step 1: Write the failing test**

```js
// tests/exam-client-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../exam-client-core.js');

test('whenText formats Moscow time with the weekday and the right preposition', () => {
  assert.equal(C.whenText(1791558000), 'в пятницу, 9 октября, в 18:00');
  assert.equal(C.whenText(1791579900), 'в субботу, 10 октября, в 0:05');          // day rolls over at midnight MSK
  assert.equal(C.whenText(1798750800), 'в пятницу, 1 января, в 0:00');           // year rolls over
});

test('the clock offset turns the device clock into the server clock', () => {
  const off = C.offsetOf(1000, 5_000_000);                    // device is way off
  assert.equal(off, 1000 * 1000 - 5_000_000);
  assert.equal(C.leftSec(1100, off, 5_000_000), 100);         // 100 s left by the server clock
  assert.equal(C.leftSec(1100, off, 5_000_000 + 99_500), 1);  // rounds up: never shows 0 early
  assert.equal(C.leftSec(1100, off, 5_000_000 + 200_000), 0); // never negative
});

test('fmtLeft shows hours only when there are some', () => {
  assert.equal(C.fmtLeft(14100), '3:55:00');
  assert.equal(C.fmtLeft(3599), '59:59');
  assert.equal(C.fmtLeft(65), '01:05');
  assert.equal(C.fmtLeft(0), '00:00');
});

test('fitSize scales the long side to the limit and never upscales', () => {
  assert.deepEqual(C.fitSize(4032, 3024, 2000), { w: 2000, h: 1500 });
  assert.deepEqual(C.fitSize(3024, 4032, 2000), { w: 1500, h: 2000 });
  assert.deepEqual(C.fitSize(800, 600, 2000), { w: 800, h: 600 });
});

test('AwayTracker reports the away time once, ignores short blips and repeated hides', () => {
  const t = new C.AwayTracker(2);
  assert.equal(t.show(1000), null);                           // never hidden
  t.hide(10_000, 3);
  t.hide(11_000, 4);                                          // a second hide while hidden changes nothing
  assert.deepEqual(t.show(17_400), { n: 3, sec: 7 });
  assert.equal(t.show(18_000), null);                         // already reported
  t.hide(20_000, 5);
  assert.equal(t.show(20_900), null);                         // under the minimum: a flicker
});

test('SaveQueue keeps values that changed while a save was in flight', () => {
  const q = new C.SaveQueue();
  assert.equal(q.has(), false);
  q.set(1, '5'); q.set(2, '0,5');
  const snap = q.snapshot();
  assert.deepEqual(snap, { 1: '5', 2: '0,5' });
  q.set(2, '0,6');                                            // typed again during the request
  q.ack(snap);
  assert.deepEqual(q.snapshot(), { 2: '0,6' });
  q.ack(q.snapshot());
  assert.equal(q.has(), false);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/exam-client-core.test.mjs`
Expected: FAIL, `Cannot find module '../exam-client-core.js'`.

- [ ] **Step 3: Write the module**

```js
/* Assigned mock exams, trainer side — pure helpers shared with the tests
   (node: require, browser: window.ExamClientCore). No DOM here. */
(function (root) {
  'use strict';

  const DAYS = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // "в пятницу, 9 октября, в 18:00" — Moscow time is UTC+3 all year round.
  function whenText(ts) {
    const d = new Date((ts + 10800) * 1000), m = d.getUTCMinutes();
    return DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', в ' + d.getUTCHours() + ':' + (m < 10 ? '0' : '') + m;
  }

  const offsetOf = (serverNowSec, clientNowMs) => serverNowSec * 1000 - clientNowMs;

  function leftSec(untilSec, offsetMs, clientNowMs) {
    return Math.max(0, Math.ceil((untilSec * 1000 - (clientNowMs + offsetMs)) / 1000));
  }

  function fmtLeft(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (x) => String(x).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }

  function fitSize(w, h, max) {
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }

  /* Tracks when the exam page was hidden or lost focus and for how long.
     Intervals shorter than minSec are ignored (a keyboard or a notification). */
  function AwayTracker(minSec) {
    let since = 0, task = '';
    this.hide = function (nowMs, n) { if (since) return; since = nowMs; task = n == null ? '' : String(n); };
    this.show = function (nowMs) {
      if (!since) return null;
      const sec = Math.round((nowMs - since) / 1000), n = task;
      since = 0; task = '';
      return sec >= minSec ? { n: n, sec: Math.min(sec, 21600) } : null;
    };
  }

  // Typed answers waiting to be sent; a value typed again during a request stays queued.
  function SaveQueue() {
    const dirty = {};
    this.set = function (n, v) { dirty[n] = v; };
    this.has = function () { return Object.keys(dirty).length > 0; };
    this.snapshot = function () { return Object.assign({}, dirty); };
    this.ack = function (snap) {
      Object.keys(snap).forEach(function (k) { if (dirty[k] === snap[k]) delete dirty[k]; });
    };
  }

  const api = { whenText: whenText, offsetOf: offsetOf, leftSec: leftSec, fmtLeft: fmtLeft, fitSize: fitSize,
    AwayTracker: AwayTracker, SaveQueue: SaveQueue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamClientCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run the tests**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass (the new file adds 6 tests).

- [ ] **Step 5: Commit**

```bash
git add exam-client-core.js tests/exam-client-core.test.mjs
git commit -m "Add exam-client-core: date text, countdown, image fit, away tracker, save queue"
```

---

### Task 3: Local dev stack for browser checks

A script that starts a throwaway PocketBase on `127.0.0.1:8090` (the port `index.html` and `teacher.html` use on localhost), a Telegram stub, and seeds a teacher, a student with a personal login link, a made-up exam and an assignment. Plan 3 reuses it.

**Files:**
- Create: `tools/exam-dev-stack.mjs`

**Interfaces:**
- Produces: `node tools/exam-dev-stack.mjs` prints the student link, the teacher link, the ids, and keeps running until Ctrl+C. Environment: `START_IN` (seconds from now to the exam start, default `20`, may be negative), `DURATION` (seconds, default `900`), `PB_BIN`. Port 8090 busy → exits with a clear message and kills nothing.

- [ ] **Step 1: Write the script**

```js
// Local stack for checking assigned exams in a browser:
//   node tools/exam-dev-stack.mjs            (START_IN=20 DURATION=900 by default)
// Serve the site next to it (port 3456 is in .claude/launch.json):
//   python3 -m http.server 3456
// then open the printed student link. The data is made up and lives in a temp dir.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PB = process.env.PB_BIN || join(homedir(), '.local/pocketbase/pocketbase');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = join(ROOT, 'backend/pb_migrations'), HOOKS = join(ROOT, 'backend/pb_hooks');
const PORT = 8090, STUB = 8099, B = `http://127.0.0.1:${PORT}/api`;
const START_IN = Number(process.env.START_IN ?? 20), DURATION = Number(process.env.DURATION ?? 900);
const nowS = () => Math.floor(Date.now() / 1000);

const busy = (port) => new Promise((res) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false));
});
if (await busy(PORT)) { console.error(`Port ${PORT} is busy (another PocketBase?). Stop it or wait; nothing was killed.`); process.exit(1); }

async function req(method, path, token, body) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json)}`);
  return json;
}
const login = async (identity, password, coll = 'users') =>
  (await req('POST', `/collections/${coll}/auth-with-password`, null, { identity, password }));

// Telegram stub: answers sendMessage, getFile and serves one tiny PNG for every file download.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const stub = createServer((q, s) => {
  q.resume();
  q.on('end', () => {
    if (q.url.includes('/getFile')) { s.setHeader('content-type', 'application/json'); return s.end(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } })); }
    if (q.url.includes('/file/bot')) { s.setHeader('content-type', 'image/png'); return s.end(PNG); }
    s.end('{"ok":true}');
  });
}).listen(STUB, '127.0.0.1');
const dir = mkdtempSync(join(tmpdir(), 'pbdev-'));
const args = ['--dir', join(dir, 'pb_data'), '--migrationsDir', MIG];
execFileSync(PB, ['migrate', 'up', ...args], { stdio: 'ignore' });
execFileSync(PB, ['superuser', 'upsert', 'root@dev.local', 'rootpassword123', ...args], { stdio: 'ignore' });
const proc = spawn(PB, ['serve', '--http', `127.0.0.1:${PORT}`, ...args, '--hooksDir', HOOKS], {
  stdio: 'inherit',
  env: { ...process.env, TG_API: `http://127.0.0.1:${STUB}`, TG_BOT_TOKEN: 'dev', TG_WEBHOOK_SECRET: 'dev', TEACHER_TG_ID: '1' },
});
const stop = () => { proc.kill(); stub.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

const su = (await login('root@dev.local', 'rootpassword123', '_superusers')).token;
// rate limits would get in the way of repeated logins while testing by hand
await req('PATCH', '/settings', su, { rateLimits: { enabled: false } });
const mkUser = async (login_, role, name) => {
  const pw = 'P' + 'x'.repeat(31);
  const u = await req('POST', '/collections/users/records', su, { login: login_, role, name, active: true, password: pw, passwordConfirm: pw });
  await req('POST', '/collections/links/records', su, { user: u.id, secret: pw });
  return { id: u.id, link: `#/login/${login_}.${pw}` };
};
const teacher = await mkUser('teacher', 'teacher', 'Преподаватель');
const stud = await mkUser('stud1', 'student', 'Тест Ученик');
// a bot profile for the student, so that photos "sent to the bot" can be simulated with the webhook
await req('POST', '/collections/tg_profiles/records', su, { user: stud.id, tg_id: '7000000001', username: 'stud1', first_name: 'Тест', mine: true });
const tt = (await login('teacher', 'P' + 'x'.repeat(31))).token;

const TASKS = [
  { n: 1, kind: 'short', max: 1, cond: '<p>Найдите значение выражения $2+3$.</p>' },
  { n: 2, kind: 'short', max: 1, cond: '<p>Решите уравнение $2x=-3$. В ответе укажите $x$.</p>' },
  { n: 3, kind: 'short', max: 1, cond: '<p>Найдите $\\dfrac{1}{2}$ в виде десятичной дроби.</p>' },
  { n: 13, kind: 'long', max: 2, cond: '<p>Решите уравнение $x^2=1$.</p>' },
  { n: 14, kind: 'long', max: 3, cond: '<p>Докажите, что $1+1=2$.</p>' },
];
const KEY = { 1: { a: '5', sol: '<p>$2+3=5$.</p>' }, 2: { a: '-1,5', sol: '<p>$x=-\\dfrac{3}{2}$.</p>' }, 3: { a: '0,5', sol: '<p>$\\dfrac{1}{2}=0{,}5$.</p>' },
  13: { a: '<p>$x=\\pm1$</p>' }, 14: { a: '<p>Очевидно.</p>' } };
const exam = await req('POST', '/collections/exams/records', tt, { title: 'Тестовый пробник', full: false, tasks: TASKS, key: KEY });
const asg = await req('POST', '/ege/exams/assign', tt, { user: stud.id, exam: exam.id, start: nowS() + START_IN, duration: DURATION });

console.log(`\nStack is up. Serve the site:  python3 -m http.server 3456`);
console.log(`Student: http://localhost:3456/${stud.link}`);
console.log(`Teacher: http://localhost:3456/teacher.html${teacher.link}`);
console.log(`Exam ${exam.id}, assignment ${asg.id}, starts in ${START_IN}s, lasts ${DURATION}s. Ctrl+C to stop.`);
console.log(`Simulate a photo sent to the bot (caption = task number):
  curl -s -X POST http://127.0.0.1:${PORT}/api/tg/webhook -H 'X-Telegram-Bot-Api-Secret-Token: dev' -H 'content-type: application/json' \\
    -d '{"update_id":1,"message":{"message_id":1,"from":{"id":7000000001,"is_bot":false,"first_name":"Тест"},"chat":{"id":7000000001,"type":"private"},"caption":"13","photo":[{"file_id":"A","file_size":10},{"file_id":"B","file_size":1000}]}}'\n`);
```

- [ ] **Step 2: Run it and check it comes up**

Run: `START_IN=5 node tools/exam-dev-stack.mjs` (in a second terminal or in the background) and then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/ege/exams/mine
```

Expected: `200`, then `403` (route exists, signed-out). The script prints both links. Stop it with Ctrl+C. If port 8090 is busy the script must exit with its message and leave the other process alone.

- [ ] **Step 3: Commit**

```bash
git add tools/exam-dev-stack.mjs
git commit -m "Add a local dev stack for browser checks of assigned exams"
```

---

### Task 4: `exam.js` skeleton, route, banner, scheduled and missed screens

**Files:**
- Create: `exam.js`
- Modify: `index.html` (parseRoute ~2574; `render` ~2998-3027; `Sync.refresh` ~1774; `renderHub` ~2672; CSS; script tags before `</body>`), `sw.js`

**Interfaces:**
- Consumes: `ExamClientCore`; from `index.html` globals: `API`, `auth`, `appEl`, `statsEl`, `setBack`, `parseRoute`, `go`, `escapeHtml`, `render`, `stageAndMount`, `IS_IPHONE`, `ask`, `note`, `scrollTop`.
- Produces: `window.ExamUI = { bannerHTML(), render(id), leave() }`; helpers inside `exam.js` used by later tasks: `st` (state object), `xapi(path, opt)`, `later(fn, ms)`, `every(fn, ms)`, `clearTimers()`, `paint(v)`, `shell(inner)`, `fail(msg)`.

- [ ] **Step 1: Create `exam.js` with the skeleton**

```js
/* Assigned mock exams, trainer side. The teacher's own exams are opened to one
   student for a fixed window; everything here is rendered from what the server
   returns for the current phase (see backend/pb_hooks/exams.js). Nothing is
   written to the progress state, the event journal or the mock-exam history.
   Globals from index.html: API, auth, appEl, statsEl, setBack, parseRoute, go,
   escapeHtml, render, stageAndMount, IS_IPHONE, ask, note, scrollTop. */
(function () {
  'use strict';
  const C = window.ExamClientCore;
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const SEEN_KEY = 'ege_exam_seen_v1';
  const TG = 'https://t.me/kirill_math_tutor';   // the teacher, used on the "missed" screen
  const TG_BOT = 'kirill_repet_bot';             // the sign-in bot that also takes photos of part 2

  const st = { mine: null, mineAt: 0, loading: false, hubTimer: 0, id: null, view: null, offset: 0, timers: [],
    queue: null, away: null, photos: [], ftoken: '', ftokenAt: 0, picker: false, saveTimer: 0, saveFail: false };

  const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch (e) { return []; } };
  const markSeen = (id) => { try { const s = seen(); if (s.indexOf(id) < 0) { s.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-50))); } } catch (e) {} };

  async function xapi(path, opt) {
    opt = opt || {};
    const r = await fetch(API + '/ege/exams' + path, {
      method: opt.method || 'GET',
      body: opt.form || (opt.body && JSON.stringify(opt.body)),
      headers: Object.assign(opt.form ? {} : { 'content-type': 'application/json' }, auth ? { Authorization: auth.token } : {}),
    });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json: json };
  }

  // ---- timers owned by the open exam screen ----
  function clearTimers() { st.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); st.timers = []; }
  function later(fn, ms) { const t = setTimeout(fn, Math.max(0, Math.min(ms, 2147483000))); st.timers.push(t); return t; }
  function every(fn, ms) { const t = setInterval(fn, ms); st.timers.push(t); return t; }
  const serverNowMs = () => Date.now() + st.offset;

  // ---- hub banner ----
  const shown = (it) => it.phase === 'scheduled' || it.phase === 'open' || it.phase === 'photos' || it.phase === 'submitted' ||
    (it.phase === 'checked' && seen().indexOf(it.id) < 0);

  // The phase each banner was last drawn with: a changed phase animates in (scheduled -> open is the one that matters).
  const drawnPhase = {};
  function bannerOf(it) {
    const t = esc(it.title);
    const fresh = drawnPhase[it.id] && drawnPhase[it.id] !== it.phase;
    drawnPhase[it.id] = it.phase;
    const row = (title, sub, act) => '<div class="ex-banner' + (fresh ? ' ex-fresh' : '') + '"><div class="ex-b-body"><span class="ex-b-t">' + title + '</span>' +
      (sub ? '<span class="ex-b-s">' + sub + '</span>' : '') + '</div>' +
      (act ? '<button class="btn primary" data-exam="' + it.id + '">' + act + '</button>' : '') + '</div>';
    if (it.phase === 'scheduled') return row('Пробник «' + t + '»', C.whenText(it.start) + ' · время московское', '');
    if (it.phase === 'open') return row('Пробник «' + t + '» идёт', 'Время на работу уже идёт', 'Открыть');
    if (it.phase === 'photos') return row('Пробник «' + t + '»', 'Осталось прикрепить фото второй части', 'Открыть');
    if (it.phase === 'submitted') return row('Пробник «' + t + '» сдан', 'Вторую часть проверяет преподаватель', 'Результат');
    return row('Пробник «' + t + '» проверен', 'Баллы и комментарии готовы', 'Результат');
  }

  // Called from renderHub on every render; asks the server at most every 30 s.
  function bannerHTML() {
    if (!auth) return '';
    loadMine();
    return (st.mine || []).filter(shown).slice(0, 3).map(bannerOf).join('');
  }

  async function loadMine(force) {
    if (!auth || st.loading) return;
    if (!force && Date.now() - st.mineAt < 30000) return;
    st.loading = true; st.mineAt = Date.now();          // set even on failure: no retry storm
    const before = JSON.stringify(st.mine);
    try {
      const r = await xapi('/mine');
      if (r.status === 200) { st.mine = r.json.items; st.offset = C.offsetOf(r.json.now, Date.now()); }
    } catch (e) { /* offline: keep what we had */ }
    st.loading = false;
    clearTimeout(st.hubTimer);
    const next = (st.mine || []).filter((it) => it.phase === 'scheduled').map((it) => it.until).sort()[0];
    if (next) st.hubTimer = setTimeout(() => loadMine(true), Math.max(1000, next * 1000 - serverNowMs() + 1500));
    if (JSON.stringify(st.mine) !== before && parseRoute().view === 'hub') render();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && parseRoute().view === 'hub') loadMine();
  });

  // ---- screens ----
  const shell = (inner) => '<div class="vbox">' + inner + '</div>';
  function fail(msg, retry) {
    appEl.innerHTML = shell('<div class="vintro"><h2>Пробник</h2><p class="lead">' + msg + '</p>' +
      '<div class="vactions">' + (retry ? '<button class="btn primary" data-ex-retry>Попробовать снова</button> ' : '') +
      '<button class="btn" data-home>К заданиям</button></div></div>');
  }

  function leave() { clearTimers(); st.id = null; st.view = null; st.queue = null; st.away = null; }

  async function renderExam(id) {
    leave();
    st.id = id;
    setBack(true); statsEl.innerHTML = '';
    appEl.innerHTML = '<div class="vbox"><div class="vwait" role="status"><div class="vwait-ring" aria-hidden="true"></div><p>Загружаю пробник…</p></div></div>';
    let r;
    try { r = await xapi('/' + encodeURIComponent(id)); }
    catch (e) { if (st.id === id) fail('Нет связи с сервером. Проверь интернет.', true); return; }
    if (st.id !== id) return;                          // the student already went elsewhere
    if (r.status === 403) { fail('Чтобы открыть пробник, войди в тренажёр через Telegram.'); return; }
    if (r.status === 404) { fail('Такого пробника нет, или он назначен не тебе.'); return; }
    if (r.status !== 200) { fail('Не получилось загрузить пробник.', true); return; }
    st.view = r.json;
    st.offset = C.offsetOf(r.json.now, Date.now());
    paint(r.json);
  }

  function paint(v) {
    scrollTop();
    if (st.shownPhase && st.shownPhase !== v.phase && st.shownId === v.id) fadeIn();
    st.shownPhase = v.phase; st.shownId = v.id;
    if (v.phase === 'scheduled') return paintScheduled(v);
    if (v.phase === 'missed') return paintMissed(v);
    appEl.innerHTML = shell('<p class="lead">' + esc(v.phase) + '</p>');   // replaced by later tasks
  }

  function paintScheduled(v) {
    appEl.innerHTML = shell('<div class="vintro"><h2>' + esc(v.title) + '</h2>' +
      '<p class="lead">Начало ' + C.whenText(v.start) + ' (по Москве). Когда время придёт, пробник откроется на этой странице.</p>' +
      '<p class="mode-hint">Подготовь чистые листы и ручку. На работу даётся ' + Math.round(v.duration / 60) + ' минут, время идёт с назначенного начала.</p>' +
      '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>');
    const id = v.id;
    later(() => { if (st.id === id) renderExam(id); }, v.until * 1000 - serverNowMs() + 1200);
  }

  // A phase change on screen (the scheduled page becoming the exam) eases in instead of a hard cut.
  function fadeIn() {
    appEl.classList.remove('ex-screen-in'); void appEl.offsetWidth; appEl.classList.add('ex-screen-in');
    setTimeout(() => appEl.classList.remove('ex-screen-in'), 700);
  }

  function paintMissed(v) {
    appEl.innerHTML = shell('<div class="vintro"><h2>' + esc(v.title) + '</h2>' +
      '<p class="lead">Время пробника прошло, а ты его не открывал. Напиши преподавателю — договоритесь о новом времени.</p>' +
      '<div class="vactions"><a class="btn primary" href="' + TG + '" target="_blank" rel="noopener">Написать в Telegram</a> ' +
      '<button class="btn" data-home>К заданиям</button></div></div>');
  }

  // ---- clicks on this module's elements ----
  appEl.addEventListener('click', (e) => {
    const open = e.target.closest('[data-exam]');
    if (open) { go('#/exam/' + open.dataset.exam); return; }
    if (e.target.closest('[data-ex-retry]') && st.id) { renderExam(st.id); return; }
  });

  window.ExamUI = { bannerHTML: bannerHTML, render: renderExam, leave: leave };
})();
```

- [ ] **Step 2: Wire it into `index.html`**

(a) `parseRoute` — add the exam route before the task match:

```js
function parseRoute(){
  if(/#\/help\b/.test(location.hash))return{view:'help'};
  if(/#\/v\b/.test(location.hash))return{view:'variant'};
  const ex=location.hash.match(/#\/exam\/([A-Za-z0-9]+)/);if(ex)return{view:'exam',id:ex[1]};
  const m=location.hash.match(/#\/t\/(\d+)/);return m?{view:'task',n:+m[1]}:{view:'hub'};
}
```

(b) `render()` — at the very top call `leave`, and add the dispatch (before `else if(r.view==='variant')`):

```js
function render(){
  if(window.ExamUI)ExamUI.leave();
  if(variantTimerId){clearInterval(variantTimerId);variantTimerId=null;}
```
```js
  if(r.view==='help')renderHelp();
  else if(r.view==='exam'&&window.ExamUI)ExamUI.render(r.id);
  else if(r.view==='variant')renderVariant();
```

(c) `Sync.refresh` — background sync must not redraw an open exam. After the existing `variant` guard line add:

```js
    if(parseRoute().view==='exam')return;
```

(d) `renderHub` — insert the banner after `${noteHTML}`:

```js
    ${noteHTML}
    ${window.ExamUI?ExamUI.bannerHTML():''}
    ${progHTML}
```

(e) Script tags — just before `</body>` (after the big inline script, so `appEl` already exists):

```html
<script src="exam-client-core.js"></script>
<script src="exam.js"></script>
```

(f) CSS — add inside the main `<style>`, next to the `.hub-note` rules (tokens only, no new colours):

```css
  .ex-banner{display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap;margin:var(--s4) 0;padding:var(--s4) var(--s5);
    background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:var(--r-lg);}
  .ex-banner .ex-b-body{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:2px;}
  .ex-banner .ex-b-t{font-family:'Literata',Georgia,serif;font-weight:600;color:var(--ink);}
  .ex-banner .ex-b-s{font-size:var(--fs-sm);color:var(--ink-2);}
  /* the banner changed state (e.g. the exam just opened): the new text and button ease in instead of snapping */
  @keyframes exIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
  @keyframes exGlow{0%{box-shadow:0 0 0 0 var(--accent-line);}100%{box-shadow:0 0 0 12px transparent;}}
  .ex-banner.ex-fresh{animation:exGlow .9s ease-out 1;}
  .ex-banner.ex-fresh .ex-b-body,.ex-banner.ex-fresh .btn{animation:exIn .45s ease-out both;}
  .ex-banner.ex-fresh .btn{animation-delay:.12s;}
  .ex-screen-in{animation:exIn .5s ease-out both;}
  @media (prefers-reduced-motion:reduce){.ex-banner.ex-fresh,.ex-banner.ex-fresh .ex-b-body,.ex-banner.ex-fresh .btn,.ex-screen-in{animation:none;}}
```

(g) `sw.js` — add `'./exam-client-core.js', './exam.js'` to `SHELL` and bump `VERSION` to `'v87'`.

- [ ] **Step 3: Verify in the browser on the local stack**

1. Terminal A: `START_IN=3600 node tools/exam-dev-stack.mjs` (starts one hour ahead). Terminal B: `python3 -m http.server 3456`. Or use `preview_start` with the `math` entry of `.claude/launch.json` for the site.
2. Open the printed student link. After login the hub shows the banner "Пробник «Тестовый пробник» — в <день>, <дата>, в <время> · время московское" and no button. Check at 375 px width too (`resize_window` mobile) and in dark theme.
3. Open `http://localhost:3456/#/exam/<assignment id>` (the id is printed): the scheduled screen shows the title and the start text.
4. Restart the stack with `START_IN=-5000 DURATION=60`: the exam window already passed unopened → the banner is gone and the screen shows "Время пробника прошло…" (`missed`).
5. Animation: with `START_IN=15`, leave the hub open on the banner. At the start time the banner text and the "Открыть" button ease in (no snap); the scheduled exam screen turning into the exam fades in too. With reduced motion enabled in the browser the change is instant. No errors.
6. `read_console_messages`: no errors. A signed-out visitor to `#/exam/xyz` gets the wall/login flow unchanged (no exceptions).

Expected: all five checks pass. Fix and re-check if not.

- [ ] **Step 4: Run the unit and backend suites**

Run: `node --test 'tests/*.test.mjs'` and `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add exam.js index.html sw.js
git commit -m "Trainer: exam route, hub banner, scheduled and missed screens; sw v87"
```

---

### Task 5: The open phase — cards, answers, timer, autosave, finish, away journal

**Files:**
- Modify: `exam.js`
- Modify: `index.html` (CSS only)

**Interfaces:**
- Consumes: Task 4 helpers; `C.SaveQueue`, `C.AwayTracker`, `C.leftSec`, `C.fmtLeft`.
- Produces: `paintOpen(v)`, `flush(id)`, `syncPhase(id)`; DOM hooks `data-ex-in`, `data-ex-finish`, `#ex-timer`, `#ex-save`, cards with `data-exn`.

- [ ] **Step 1: Replace the placeholder in `paint` and add `paintOpen` and its helpers**

In `paint(v)` replace the last line (the placeholder) with:

```js
    if (v.phase === 'open') return paintOpen(v);
    appEl.innerHTML = shell('<p class="lead">' + esc(v.phase) + '</p>');   // replaced by later tasks
```

Add to `exam.js` (inside the IIFE, before the click listener):

```js
  // iPhone has no minus sign on a numeric keypad: always the text keyboard there.
  const ansAttrs = () => IS_IPHONE ? 'type="text" autocapitalize="off" autocorrect="off" spellcheck="false"'
    : 'type="text" inputmode="decimal"';
  const ballWordOf = (n) => (typeof ballWord === 'function' ? ballWord(n) : 'б.');

  function cardHTML(t, v) {
    const long = t.kind === 'long';
    return '<div class="vcard" data-n="' + t.n + '" data-exn="' + t.n + '">' +
      '<div class="vlabel">Задание ' + t.n + (long ? '<span class="vlabel-art"> · максимум ' + t.max + ' ' + ballWordOf(t.max) + '</span>' : '') + '</div>' +
      '<div class="cond"><div class="tex">' + (t.cond || '') + '</div></div>' +
      (long ? photoBlockHTML(t.n) :
        '<input class="v-input" ' + ansAttrs() + ' placeholder="Ответ" data-ex-in="' + t.n + '" value="' + esc((v.answers || {})[t.n]) + '" autocomplete="off" aria-label="Ответ на задание ' + t.n + '">') +
      '</div>';
  }
  const photoBlockHTML = () => '';   // filled in by the photos task

  function barHTML(finishLabel) {
    return '<div class="vbar"><span class="vtimer" id="ex-timer" role="timer">--:--</span>' +
      '<span class="vprog" id="ex-save" role="status" aria-live="polite"></span><span class="spacer"></span>' +
      '<button class="btn primary" data-ex-finish>' + finishLabel + '</button></div>';
  }

  function paintOpen(v) {
    const id = v.id, hasLong = v.tasks.some((t) => t.kind === 'long');
    st.queue = new C.SaveQueue(); st.away = new C.AwayTracker(2);
    st.photos = (v.photos || []).slice();
    appEl.innerHTML = '';                                   // stageAndMount swaps the content in when ready
    stageAndMount(shell(barHTML('Завершить') +
        v.tasks.map((t) => cardHTML(t, v)).join('') +
        (hasLong ? tgBlockHTML(v) : '') +
        '<div style="text-align:center;margin-top:8px"><button class="btn primary" data-ex-finish>Завершить пробник</button></div>'),
      () => st.id === id && parseRoute().view === 'exam',
      () => { startTimer(v); mountPhotos(v); });
  }
  const tgBlockHTML = () => '';      // filled in by the photos task
  function mountPhotos() {}           // filled in by the photos task

  // ---- countdown by the server clock ----
  function startTimer(v) {
    const id = v.id, el = () => document.getElementById('ex-timer');
    const tick = () => {
      const sec = C.leftSec(v.until, st.offset, Date.now()), e = el();
      if (e) { e.textContent = C.fmtLeft(sec); e.classList.toggle('low', sec <= 300); }
      if (sec === 0) { clearInterval(iv); syncPhase(id); }
    };
    const iv = every(tick, 1000); tick();
  }

  // The window ended (or the server says so): flush what we have and follow the server's phase.
  async function syncPhase(id, tries) {
    if (st.id !== id) return;
    await flush(id);
    if (st.id !== id) return;
    const r = await xapi('/' + id).catch(() => null);
    if (st.id !== id) return;
    if (!r || r.status !== 200) { later(() => syncPhase(id, (tries || 0) + 1), 3000); return; }
    st.view = r.json; st.offset = C.offsetOf(r.json.now, Date.now());
    if (r.json.phase === 'open' && (tries || 0) < 5) { later(() => syncPhase(id, (tries || 0) + 1), 2000); return; }  // device clock ahead of the server
    paint(r.json);
  }

  // ---- autosave of part 1 ----
  const setSaveText = (t) => { const e = document.getElementById('ex-save'); if (e) e.textContent = t; };
  // `q` is passed explicitly so a flush started by leave() can still finish after st.queue is cleared.
  async function flush(id, q) {
    q = q || st.queue;
    if (!q || !q.has()) return;
    const here = () => st.id === id;
    clearTimeout(st.saveTimer);
    const snap = q.snapshot();
    if (here()) setSaveText('Сохраняю…');
    let r;
    try { r = await xapi('/' + id + '/answers', { method: 'POST', body: { answers: snap } }); }
    catch (e) { r = null; }
    if (r && r.status === 200) {
      q.ack(snap);
      if (here()) { st.saveFail = false; setSaveText(q.has() ? 'Сохраняю…' : 'Сохранено'); }
      if (q.has()) flush(id, q);
      return;
    }
    if (!here()) return;                        // left the screen: nothing more to do or to show
    if (r && r.status === 409) { syncPhase(id); return; }
    st.saveFail = true; setSaveText('Не сохранено — повторю');
    later(() => flush(id, q), 5000);
  }
  function scheduleSave(id) { clearTimeout(st.saveTimer); st.saveTimer = setTimeout(() => flush(id), 700); setSaveText('…'); }
  window.addEventListener('online', () => { if (st.id) flush(st.id); });

  appEl.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-ex-in]');
    if (!inp || !st.queue || !st.id) return;
    st.queue.set(inp.dataset.exIn, inp.value);
    scheduleSave(st.id);
  });
  appEl.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('[data-ex-in]') && st.id) flush(st.id); });

  // ---- finishing early ----
  async function finishNow(id) {
    const ok = await ask({ title: 'Завершить пробник?',
      text: 'Ответы первой части после этого изменить нельзя. Фото второй части можно будет прикрепить ещё 10 минут.',
      ok: 'Завершить', cancel: 'Вернуться' });
    if (!ok || st.id !== id) return;
    await flush(id);
    const r = await xapi('/' + id + '/finish', { method: 'POST' }).catch(() => null);
    if (st.id !== id) return;
    if (!r || (r.status !== 200 && r.status !== 409)) { note('Не получилось завершить', 'Проверь интернет и нажми «Завершить» ещё раз. Ответы сохранены.'); return; }
    renderExam(id);
  }

  // ---- the away journal: when the page is hidden or loses focus ----
  function currentTask() {
    const cards = document.querySelectorAll('[data-exn]');
    for (const c of cards) { if (c.getBoundingClientRect().bottom > 130) return c.dataset.exn; }
    return '';
  }
  function awayOut() { if (st.id && st.away && st.view && st.view.phase === 'open' && !st.picker) st.away.hide(Date.now(), currentTask()); }
  function awayBack() {
    if (!st.id || !st.away || !st.view || st.view.phase !== 'open') return;
    if (st.picker) { st.picker = false; return; }
    const a = st.away.show(Date.now());
    if (a) xapi('/' + st.id + '/away', { method: 'POST', body: { n: a.n, sec: a.sec } }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { awayOut(); if (st.id) flush(st.id); } else awayBack();
  });
  window.addEventListener('blur', awayOut);
  window.addEventListener('focus', awayBack);
```

And in the existing click listener add finish handling:

```js
    if (e.target.closest('[data-ex-finish]') && st.id) { finishNow(st.id); return; }
```

`leave()` must send pending answers before clearing (typed answers must never be lost by navigating away). Replace the `leave` from Task 4 with:

```js
  function leave() {
    if (st.id && st.queue && st.queue.has()) flush(st.id, st.queue);   // fire and forget; no retry once we left
    clearTimers(); st.id = null; st.view = null; st.away = null; st.queue = null;
  }
```

- [ ] **Step 2: CSS** (inside the main `<style>`, next to the banner rules)

```css
  .vtimer.low{color:var(--err-text);}
  .ex-note{font-size:var(--fs-sm);color:var(--ink-2);}
```

- [ ] **Step 3: Verify in the browser on the local stack**

1. `START_IN=-5 DURATION=900 node tools/exam-dev-stack.mjs`; serve the site; open the student link, then the banner's "Открыть".
2. The exam opens: a countdown near 15:00 counting down, three answer inputs with formulas rendered, two long tasks with the hint text (photos come in the next task).
3. Type `5` in task 1 and `-1,5` in task 2, wait a second: the bar says "Сохранено". Reload the page: the answers are still there and the timer continues (not reset).
4. Failed save: in the page console run `window.__f=window.fetch; window.fetch=(u,o)=>/answers/.test(String(u))?Promise.reject(new Error('x')):window.__f(u,o)`, type `7` in task 3: the bar says "Не сохранено — повторю". Restore with `window.fetch=window.__f`: within 5 seconds the bar says "Сохранено" and the superuser API (`/api/collections/exam_assignments/records`) shows `answers` containing `"3":"7"`. Also confirm with `read_network_requests` that normal typing sends one POST `/answers` per pause with a 200.
5. Switch to another tab and back after ~5 s (or `javascript_tool` dispatching `visibilitychange` with `document.visibilityState` stubbed): a POST `/away` with `sec` ≥ 2 is sent, and the teacher-side row's `log` later shows `[ts,"w",n,sec]` (check with `curl` against `/api/collections/exam_assignments/records` using the superuser token, or the exams test helpers).
6. "Завершить" → the confirm sheet → confirm: the screen switches to the photo phase placeholder (Task 6 builds it); the answers stay saved. Reopen: phase is `photos` (placeholder text).
7. Let a 60-second exam (`DURATION=60`) run to zero with the page open: the timer reaches 00:00 and the page moves to the next phase by itself.
8. Phone width 375 px: the sticky bar does not wrap badly; dark theme readable. Console: no errors.

Expected: all pass; fix and re-check otherwise.

- [ ] **Step 4: Run the unit and backend suites**

Run: `node --test 'tests/*.test.mjs'` and `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add exam.js index.html
git commit -m "Trainer: open exam screen with timer, autosave, finish and away journal"
```

---

### Task 6: Photos of part 2 (site and bot) and the photo phase

**Files:**
- Modify: `exam.js`, `index.html` (CSS)

**Interfaces:**
- Consumes: Task 4–5 helpers; server routes for photos (upload, delete, list), `done`, `/files/token`.
- Produces: `photoBlockHTML(n)`, `tgBlockHTML(v)`, `mountPhotos(v)`, `paintPhotos(v)`, `downscale(file) -> Promise<Blob>`, `uploadPhoto(id, n, file)`, `thumbSrc(p)`.

- [ ] **Step 1: Replace the three stubs and add the photo code**

Replace the stubs `photoBlockHTML`, `tgBlockHTML`, `mountPhotos` from Task 5 with the real ones, and add the rest (all inside the IIFE):

```js
  const photoBlockHTML = (n) => '<div class="ex-photos" data-ex-ph="' + n + '">' +
    '<div class="ex-thumbs" id="ex-th-' + n + '"></div>' +
    '<label class="btn ex-add">Прикрепить фото<input type="file" accept="image/*" multiple hidden data-ex-file="' + n + '"></label>' +
    '<span class="ex-msg" id="ex-msg-' + n + '" role="status" aria-live="polite"></span></div>';

  // Photos can also be sent to the sign-in bot; the page picks them up by polling.
  const tgBlockHTML = () => '<div class="vcard ex-tg"><div class="vlabel">Неудобно прикреплять с компьютера?</div>' +
    '<p class="ex-note">Пришли фото решения боту <a href="https://t.me/' + TG_BOT + '" target="_blank" rel="noopener">@' + TG_BOT + '</a> ' +
    'и напиши в подписи номер задания, например «13». Если снимков несколько, отправь их одним альбомом с одной подписью. ' +
    'Фото появятся здесь сами.</p></div>';

  // ---- file access: a short-lived token, refreshed when it is about to expire ----
  async function ensureToken() {
    if (st.ftoken && Date.now() - st.ftokenAt < 60000) return;
    try {
      const r = await fetch(API + '/files/token', { method: 'POST', headers: { Authorization: auth.token } });
      const j = await r.json();
      if (r.status === 200 && j.token) { st.ftoken = j.token; st.ftokenAt = Date.now(); }
    } catch (e) { /* thumbnails stay broken until the next try */ }
  }
  const thumbSrc = (p) => p.local || (API + '/files/exam_photos/' + p.id + '/' + p.file + '?token=' + encodeURIComponent(st.ftoken));

  async function renderThumbs(n) {
    const box = document.getElementById('ex-th-' + n);
    if (!box) return;
    if (st.photos.some((p) => !p.local)) await ensureToken();
    box.innerHTML = st.photos.filter((p) => String(p.n) === String(n)).map((p) =>
      '<figure class="ex-thumb"><img src="' + esc(thumbSrc(p)) + '" alt="Фото решения, задание ' + n + '" loading="lazy">' +
      (st.view && (st.view.phase === 'open' || st.view.phase === 'photos')
        ? '<button class="ex-del" data-ex-del="' + p.id + '" aria-label="Удалить фото">×</button>' : '') + '</figure>').join('');
  }
  function mountPhotos(v) {
    (v.tasks || []).filter((t) => t.kind === 'long').forEach((t) => renderThumbs(t.n));
    pollPhotos(v);
  }

  // Photos can arrive through the bot: take the server's list as the truth every 15 s while photos are possible.
  function pollPhotos(v) {
    const id = v.id;
    const tick = async () => {
      if (st.id !== id || document.visibilityState === 'hidden') return;
      let r; try { r = await xapi('/' + id + '/photos'); } catch (e) { return; }
      if (st.id !== id || !r || r.status !== 200) return;
      const have = {}; st.photos.forEach((p) => { have[p.id] = p; });
      const next = r.json.photos.map((p) => (have[p.id] && have[p.id].local) ? Object.assign({}, p, { local: have[p.id].local }) : p);
      if (JSON.stringify(next.map((p) => p.id)) === JSON.stringify(st.photos.map((p) => p.id))) return;
      st.photos = next;
      (v.tasks || []).filter((t) => t.kind === 'long').forEach((t) => renderThumbs(t.n));
    };
    every(tick, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  }

  // ---- downscale before upload: phone originals are tens of MB ----
  async function decode(file) {
    if (window.createImageBitmap) {
      try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { src: b, w: b.width, h: b.height }; }
      catch (e) { /* fall through to <img> */ }
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res({ src: img, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  async function downscale(file) {
    const d = await decode(file);
    if (!d.w || !d.h) throw new Error('decode');
    const s = C.fitSize(d.w, d.h, 2000), cv = document.createElement('canvas');
    cv.width = s.w; cv.height = s.h;
    cv.getContext('2d').drawImage(d.src, 0, 0, s.w, s.h);
    const toBlob = (q) => new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
    let blob = await toBlob(0.85);
    if (blob && blob.size > 9 * 1024 * 1024) blob = await toBlob(0.6);
    if (!blob) throw new Error('encode');
    return blob;
  }

  const setMsg = (n, t) => { const e = document.getElementById('ex-msg-' + n); if (e) e.textContent = t; };
  const BAD_FILE = 'Этот файл не получается обработать. Прикрепи его с телефона или отправь решения в Telegram.';
  async function uploadPhotos(id, n, files) {
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setMsg(n, 'Загружаю ' + (i + 1) + ' из ' + list.length + '…');
      let blob;
      try { blob = await downscale(list[i]); } catch (e) { setMsg(n, BAD_FILE); continue; }
      const fd = new FormData(); fd.append('n', String(n)); fd.append('file', blob, 'photo.jpg');
      let r;
      try { r = await xapi('/' + id + '/photos', { method: 'POST', form: fd }); } catch (e) { r = null; }
      if (st.id !== id) return;
      if (r && r.status === 200) {
        st.photos.push({ id: r.json.id, n: String(n), file: r.json.file, local: URL.createObjectURL(blob) });
        renderThumbs(n); setMsg(n, '');
      } else if (r && r.status === 409) { syncPhase(id); return; }
      else setMsg(n, r && r.status === 400 ? 'Не получилось: на задание можно прикрепить не больше пяти фото, до 10 МБ.' : 'Не загрузилось — проверь интернет и попробуй ещё раз.');
    }
  }

  // ---- the photo phase: only photos are left, for 10 minutes ----
  function paintPhotos(v) {
    const id = v.id;
    st.queue = null; st.away = null; st.photos = (v.photos || []).slice();
    appEl.innerHTML = shell('<div class="vbar"><span class="vtimer" id="ex-timer" role="timer">--:--</span>' +
      '<span class="vprog">Осталось прикрепить фото</span><span class="spacer"></span>' +
      '<button class="btn primary" data-ex-done>Готово</button></div>' +
      '<div class="vintro"><p class="lead">Ответы первой части сохранены. Сфотографируй решения второй части и прикрепи к своим заданиям — на это есть 10 минут.</p></div>' +
      v.tasks.map((t) => '<div class="vcard" data-n="' + t.n + '"><div class="vlabel">Задание ' + t.n + '<span class="vlabel-art"> · максимум ' + t.max + ' ' + ballWordOf(t.max) + '</span></div>' +
        photoBlockHTML(t.n) + '</div>').join('') + tgBlockHTML(v) +
      '<div style="text-align:center;margin-top:8px"><button class="btn primary" data-ex-done>Готово</button></div>');
    startTimer(v); mountPhotos(v);
  }

  async function doneNow(id) {
    const ok = await ask({ title: 'Всё прикреплено?', text: 'После этого фото добавить уже нельзя.', ok: 'Готово', cancel: 'Ещё добавлю' });
    if (!ok || st.id !== id) return;
    const r = await xapi('/' + id + '/done', { method: 'POST' }).catch(() => null);
    if (st.id !== id) return;
    if (!r || (r.status !== 200 && r.status !== 409)) { note('Не получилось', 'Проверь интернет и нажми «Готово» ещё раз.'); return; }
    renderExam(id);
  }

  appEl.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-ex-file]');
    if (f && st.id) { st.picker = false; const n = f.dataset.exFile, files = f.files; await uploadPhotos(st.id, n, files); f.value = ''; return; }
  });
```

Extend the click listener:

```js
    if (e.target.closest('[data-ex-done]') && st.id) { doneNow(st.id); return; }
    const pick = e.target.closest('.ex-add');
    if (pick) { st.picker = true; return; }          // the native file dialog blurs the window: not "away"
    const del = e.target.closest('[data-ex-del]');
    if (del && st.id) {
      const id = st.id, pid = del.dataset.exDel;
      xapi('/' + id + '/photos/' + pid, { method: 'DELETE' }).then((r) => {
        if (st.id !== id || !r || r.status !== 200) return;
        const p = st.photos.find((x) => x.id === pid); st.photos = st.photos.filter((x) => x.id !== pid);
        if (p) renderThumbs(p.n);
      }).catch(() => {});
      return;
    }
```

Finally in `paint(v)` add, before the placeholder line: `if (v.phase === 'photos') return paintPhotos(v);`

- [ ] **Step 2: CSS**

```css
  .ex-photos{display:flex;flex-direction:column;gap:var(--s3);margin-top:var(--s4);}
  .ex-thumbs{display:flex;flex-wrap:wrap;gap:var(--s3);}
  .ex-thumb{position:relative;margin:0;width:96px;height:96px;border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;background:var(--surface-2);}
  .ex-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
  .ex-del{position:absolute;top:4px;right:4px;width:28px;height:28px;border-radius:var(--r-full);border:1px solid var(--line-strong);
    background:var(--surface);color:var(--ink);font:inherit;font-size:18px;line-height:1;cursor:pointer;}
  .ex-add{align-self:flex-start;}
  .ex-msg{font-size:var(--fs-sm);color:var(--ink-2);}
```

- [ ] **Step 3: Verify in the browser on the local stack**

1. `START_IN=-5 DURATION=900`; open the exam. Each long task shows "Прикрепить фото" and the Telegram checkbox block appears under the tasks.
2. Attach a real phone-sized photo (a JPEG of at least 3000 px; any test image works) to task 13: the thumbnail appears; in `read_network_requests` the multipart POST is far smaller than the original (long side 2000, a few hundred KB to ~1.5 MB). Attach three more, then a fifth and a sixth: the sixth shows the five-photo message. Delete one: it disappears; reload: the remaining photos still show (they load through the file token).
3. Attach a non-image renamed `x.png` containing text: the page shows the "не получается обработать" message and nothing is uploaded.
4. Bot photos (needs Plan 1b's server code): the block "Неудобно прикреплять с компьютера?" under the tasks names the bot. Run the `curl` printed by the dev stack (it posts a photo update from the student's Telegram id with caption `13`): within 15 seconds a thumbnail for task 13 appears on the page without a reload, and it survives a page reload. Send the same with caption `99` (not a task of this exam, but with a single part 2 task it still lands on 13) — and check the bot stub received an "Принял фото…" message (the dev stack stub ignores it; verify instead through `GET /api/ege/exams/<id>/photos`).
5. Away journal: choosing a file must NOT create an away entry (check the row's `log` through the superuser API).
6. "Завершить" → photo phase: only long tasks, no conditions, the 10-minute timer, the thumbnails, "Готово" → confirm → the screen moves to the results placeholder. Let a `DURATION=60` exam end by itself and check the photo phase appears with a 10-minute timer.
7. Phone width and dark theme; console clean.

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add exam.js index.html
git commit -m "Trainer: part 2 photos from the site and from the bot, and the photo phase"
```

---

### Task 7: Results screen

**Files:**
- Modify: `exam.js`, `index.html` (CSS if needed)

**Interfaces:**
- Consumes: `v` for phases `submitted` and `checked` (see the contract above); globals `secondaryScore`, `ballWord`.
- Produces: `paintResult(v)`.

- [ ] **Step 1: Add `paintResult` and call it from `paint`**

In `paint(v)` add before the placeholder: `if (v.phase === 'submitted' || v.phase === 'checked') return paintResult(v);`

```js
  const plain = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').trim(); };

  function resultCard(t, v) {
    const k = (v.key || {})[t.n] || {};
    const head = (tag) => '<div class="vlabel">Задание ' + t.n + tag + '</div><div class="cond"><div class="tex">' + (t.cond || '') + '</div></div>';
    if (t.kind === 'short') {
      const ok = !!(v.ok || {})[t.n], given = (v.answers || {})[t.n];
      return '<div class="vcard ' + (ok ? 'r-ok' : 'r-no') + '" data-n="' + t.n + '">' +
        head('<span class="vtag ' + (ok ? 'ok' : 'no') + '">' + (ok ? 'верно' : 'неверно') + '</span>') +
        '<div class="vans-row"><span class="yours">Твой ответ: ' + (given ? esc(given) : '—') + '</span> · <span class="right">Верный: ' + esc(k.a == null ? '—' : plain(String(k.a))) + '</span></div>' +
        (k.sol ? '<details class="ex-sol"><summary>Решение</summary><div class="tex">' + k.sol + '</div></details>' : '') + '</div>';
    }
    const g = (v.part2 || {})[t.n], checked = v.phase === 'checked' && g;
    const full = checked && g.pts >= t.max;
    const ph = st.photos.filter((p) => String(p.n) === String(t.n));
    return '<div class="vcard ' + (checked ? (full ? 'r-ok' : g.pts ? 'is-o' : 'r-no') : '') + '" data-n="' + t.n + '">' +
      head('<span class="vtag ' + (checked ? (full ? 'ok' : g.pts ? 'part' : 'no') : '') + '">' +
        (checked ? g.pts + ' из ' + t.max : 'на проверке') + '</span>') +
      '<div class="answer long tex">Ответ: ' + (k.a || 'не указан') + '</div>' +
      (ph.length ? '<div class="ex-thumbs" id="ex-th-' + t.n + '"></div>' : '') +
      (checked && g.comment ? '<div class="ex-comment"><div class="ex-comment-h">Комментарий преподавателя</div>' + esc(g.comment) + '</div>' : '') +
      '</div>';
  }

  async function paintResult(v) {
    const id = v.id, checked = v.phase === 'checked';
    st.photos = (v.photos || []).slice(); st.queue = null; st.away = null;
    if (st.photos.length) await ensureToken();
    if (st.id !== id) return;
    const long = v.tasks.filter((t) => t.kind === 'long'), max2 = long.reduce((s, t) => s + t.max, 0);
    const sub = 'style="font-size:16px;font-weight:500;opacity:.7"';
    const tiles = '<div class="vscore"><div class="vk">Часть 1</div><div class="vv">' + v.p1 + '<span ' + sub + '>/' + v.max1 + '</span></div></div>' +
      (long.length ? '<div class="vscore"><div class="vk">Часть 2</div><div class="vv">' +
        (checked ? v.total.pts - v.p1 + '<span ' + sub + '>/' + max2 + '</span>' : '<span style="font-size:16px">на проверке</span>') + '</div></div>' : '') +
      (checked ? '<div class="vscore"><div class="vk">Первичный балл</div><div class="vv">' + v.total.pts + '<span ' + sub + '>/' + v.total.max + '</span></div></div>' : '') +
      (checked && v.full ? '<div class="vscore"><div class="vk">Тестовый балл</div><div class="vv">' + secondaryScore(v.total.pts) + '</div></div>' : '');
    const note1 = !checked && long.length
      ? '<p class="lead">Первая часть проверена. Вторую часть посмотрит преподаватель — когда она будет проверена, баллы и комментарии появятся здесь, и тебе придёт сообщение в Telegram.</p>'
      : '';
    const viaTg = v.via_tg && !st.photos.length ? '<p class="ex-note">Решения второй части ты отправляешь в Telegram.</p>' : '';
    stageAndMount(shell('<div class="vresult"><h2>' + esc(v.title) + '</h2><div class="vscores">' + tiles + '</div>' + note1 + viaTg +
        '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>' +
        v.tasks.map((t) => resultCard(t, v)).join('')),
      () => st.id === id && parseRoute().view === 'exam',
      () => { long.forEach((t) => renderThumbs(t.n)); if (checked) markSeen(id); });
  }
```

(`renderThumbs` hides the delete buttons automatically outside the `open`/`photos` phases.)

CSS:

```css
  .ex-sol{margin-top:var(--s3);}
  .ex-sol summary{cursor:pointer;color:var(--accent);font-weight:500;}
  .ex-comment{margin-top:var(--s4);padding:var(--s3) var(--s4);background:var(--surface-2);border-radius:var(--r-md);white-space:pre-wrap;}
  .ex-comment-h{font-size:var(--fs-xs);font-weight:600;color:var(--ink-3);margin-bottom:var(--s2);}
```

- [ ] **Step 2: Verify in the browser on the local stack**

1. Run the exam from the previous tasks to the end (answer `5` correct, `1` wrong in task 2 whose key is `-1,5`, leave task 3 empty). The result screen shows part 1 = 1 of 3, per-task "верно/неверно" with the correct answer and a "Решение" disclosure with the rendered formula, part 2 "на проверке" with the thumbnails.
2. Teacher check through the API (made-up points):

```bash
TT=$(curl -s -X POST http://127.0.0.1:8090/api/collections/users/auth-with-password -H 'content-type: application/json' \
  -d '{"identity":"teacher","password":"Pxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST http://127.0.0.1:8090/api/ege/exams/<assignment id>/check -H "Authorization: $TT" -H 'content-type: application/json' \
  -d '{"part2":{"13":{"pts":1,"comment":"Потерян корень x = -1"},"14":{"pts":0,"comment":""}}}'
```

   (the password is `P` followed by 31 `x`; it is the throwaway dev password.) Reload the student page: part 2 shows `1/5` with the comment, the total `2/8`-style tiles; the hub banner shows "проверен" until the result is opened and is gone afterwards.
3. Make an exam with `full: true` (edit the stack seed or `curl` PATCH `exams`): the "Тестовый балл" tile appears. Without `full` it does not.
4. A `missed`-style or someone else's id → the not-found message, no exceptions.
5. 375 px width, dark theme, long conditions wrap properly, formulas do not overflow; console clean.

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add exam.js index.html
git commit -m "Trainer: results screen with part 1 answers and solutions, part 2 points and comments"
```

---

### Task 8: Final pass, service worker and notes

**Files:**
- Modify: `sw.js` (VERSION), `README.md` only if it lists files (check), memory note

- [ ] **Step 1: Full checks**

Run: `node --test 'tests/*.test.mjs'` and `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 2: End-to-end browser pass on the local stack, start to finish**

With `START_IN=20 DURATION=300`: banner before start (no button) → at the start it turns into "идёт · Открыть" without a reload (the hub timer) → exam, answers, photos, finish → photo phase → done → result → teacher check via the API → student sees the points. Also test a returning student: close the tab in the middle, open the link again, the answers and timer are intact; and a second device (another browser profile): the same state. Record any bug and fix it in this task.

- [ ] **Step 3: Confirm nothing leaked into progress**

Run in the page console after a full run: `Object.keys(localStorage)`. Expected: no key contains exam answers; the only exam-related key is `ege_exam_seen_v1`. `state` and the mock-exam history are unchanged by the exam.

- [ ] **Step 4: Bump the service worker**

`sw.js`: `VERSION` to `'v88'` if Task 4's `v87` was already released by a merge in between, otherwise leave `v87`. Check `git log origin/master -3 -- sw.js` first; the number must be strictly greater than master's.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Trainer: assigned exams end-to-end pass; sw version"
```

## Self-Review (done by the plan author)

Spec coverage for the trainer: banner with date and time and no countdown (Task 4); the start opens the exam, hard window by server clock, timer (Tasks 4–5); part 1 in answer fields with autosave and reload recovery (5); photos per task with downscaling, the HEIC message, the five-photo limit (6); the bot photos (6); finish early and the 10-minute photo phase (5–6); results with part 1 answers, solutions, and part 2 on review / points and comments (7); away journal and time per task are collected by the server from the calls made in Task 5; nothing in local progress (Task 8). The bot messages and the teacher side belong to Plan 1 and Plan 3.

Known limits: a student whose device clock is far off sees a countdown from the server offset, so it is right; the page needs the network to autosave (offline typing is kept in the input and sent when the connection returns, as long as the tab stays open).
