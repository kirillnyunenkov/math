# Save/Load Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the teacher panel from losing scores/comments, tell a student when a last-second answer was rejected (409), and stop the autosave route from reading the whole exam with its images.

**Architecture:** Task 1 keeps a draft of the check form in the teacher's browser (`localStorage`, one key per assignment), restored on redraw and cleared after a successful save. Task 2 keeps the unsent answers in memory when the server says 409 and shows them in a note on the next screen, the same way photos lost on a phase change are already shown (`lostBy` / `LOST_NOTE`). Task 3 stores the list of short-task numbers on the assignment row so `/answers` never loads the `exams` record.

**Tech Stack:** Plain JS in the browser (UMD "core" files with node tests), PocketBase JS hooks (goja), `node --test`.

**Spec:** none written; scope comes from the review items 7 and 9 and the audit in the chat of 2026-10-08 (panel draft, 409 notice, autosave read).

## Global Constraints

- Code and comments in English; texts shown to people in Russian.
- Core files used by the server (`answers-core.js`, `exam-core.js`, `exam-history-core.js`) have copies in `backend/pb_hooks/lib/`; `tests/cores-in-sync.test.mjs` fails if they diverge. This plan does not touch them.
- Every changed file that is in `SHELL` of [sw.js](../../../sw.js) needs `VERSION` bumped (now `v96`, becomes `v97`) once, in the last task that changes a shell file.
- No student data to external services; the draft lives only in the teacher's own browser.
- Backend tests: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/`. Front tests: `node --test tests/`.
- Never push to `master`; one PR from this branch. Deploy of the server part (migration + hooks) is run by Kirill with his own commands: do not run it.

---

### Task 1: Teacher panel keeps scores and comment (draft)

**Files:**
- Modify: `exam-panel-core.js` (new pure helpers)
- Modify: `teacher.html` (`renderCheck` ~line 1035-1045, `checkSend` ~line 1076, one `input` listener next to the `paste` listener ~line 921)
- Test: `tests/exam-panel-core.test.mjs`

**Interfaces:**
- Produces in `ExamPanelCore`:
  - `draftKey(id: string): string` → `'ck-draft:' + id`
  - `readDraft(storage, key): {pts: {[n]: number}, note: {[n]: string}} | null` (never throws; keeps only plain keys `^\d{1,2}$`, integer `pts` in 0..100, `note` strings up to 2000 chars)
  - `writeDraft(storage, key, draft | null): void` (null or empty → removes the key; never throws)
  - `draftDiffers(draft, server: {[n]: {pts, comment}}): boolean` (true when at least one draft value differs from what the server holds)

- [ ] **Step 1: Write the failing tests** (append to `tests/exam-panel-core.test.mjs`)

```js
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('draft: written, read back, removed', () => {
  const s = mem(), k = P.draftKey('abc');
  assert.equal(k, 'ck-draft:abc');
  P.writeDraft(s, k, { pts: { 13: 2 }, note: { 13: 'Не хватает обоснования' } });
  assert.deepEqual(P.readDraft(s, k), { pts: { 13: 2 }, note: { 13: 'Не хватает обоснования' } });
  P.writeDraft(s, k, null);
  assert.equal(P.readDraft(s, k), null);
});

test('draft: garbage in storage is dropped, never thrown on', () => {
  const s = mem(), k = P.draftKey('x');
  s.setItem(k, '{"pts":{"13":"2","__proto__":5,"99999":1,"14":-1,"15":101,"16":1.5},"note":{"13":7,"14":"ok"}}');
  assert.deepEqual(P.readDraft(s, k), { pts: {}, note: { 14: 'ok' } });
  s.setItem(k, 'not json');
  assert.equal(P.readDraft(s, k), null);
  assert.equal(P.readDraft({ getItem() { throw new Error('blocked'); } }, k), null);
  assert.doesNotThrow(() => P.writeDraft({ setItem() { throw new Error('full'); }, removeItem() {} }, k, { pts: { 1: 1 }, note: {} }));
});

test('draftDiffers: equal to the server is not a draft', () => {
  const server = { 13: { pts: 2, comment: 'a' } };
  assert.equal(P.draftDiffers({ pts: { 13: 2 }, note: { 13: 'a' } }, server), false);
  assert.equal(P.draftDiffers({ pts: { 13: 3 }, note: { 13: 'a' } }, server), true);
  assert.equal(P.draftDiffers({ pts: {}, note: { 13: 'b' } }, server), true);
  assert.equal(P.draftDiffers({ pts: { 14: 0 }, note: {} }, {}), false);   // nothing saved yet: 0 points and empty text is the blank form
  assert.equal(P.draftDiffers(null, server), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/exam-panel-core.test.mjs`
Expected: FAIL, `P.draftKey is not a function`.

- [ ] **Step 3: Implement the helpers** in `exam-panel-core.js` before `const api`, and add the four names to `api`

```js
  /* A draft of the check form (points and comments typed but not yet sent): kept in the teacher's own browser so that
     "back", a link, or an expired sign-in does not lose it. Read back defensively: only numeric task keys, whole points
     0..100, comments up to the 2000 characters the server takes. */
  const draftKey = function (id) { return 'ck-draft:' + String(id); };
  function readDraft(storage, key) {
    try {
      const raw = JSON.parse(storage.getItem(key));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const out = { pts: {}, note: {} };
      const pick = function (src, dst, ok) {
        if (!src || typeof src !== 'object' || Array.isArray(src)) return;
        Object.keys(src).forEach(function (k) { if (/^\d{1,2}$/.test(k) && ok(src[k])) dst[k] = src[k]; });
      };
      pick(raw.pts, out.pts, function (v) { return Number.isInteger(v) && v >= 0 && v <= 100; });
      pick(raw.note, out.note, function (v) { return typeof v === 'string' && v.length <= 2000; });
      return Object.keys(out.pts).length || Object.keys(out.note).length ? out : null;
    } catch (e) { return null; }
  }
  function writeDraft(storage, key, draft) {
    try {
      if (draft && (Object.keys(draft.pts || {}).length || Object.keys(draft.note || {}).length)) storage.setItem(key, JSON.stringify(draft));
      else storage.removeItem(key);
    } catch (e) { /* storage full or blocked: the form still works, only the safety net is gone */ }
  }
  // True when the draft holds something the server does not have (an untouched blank form is not a draft).
  function draftDiffers(draft, server) {
    if (!draft) return false;
    const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o || {}, k); };
    const cur = function (k) { return has(server, k) && server[k] && typeof server[k] === 'object' ? server[k] : {}; };
    return Object.keys(draft.pts || {}).some(function (k) { return draft.pts[k] !== (Number.isInteger(cur(k).pts) ? cur(k).pts : 0); }) ||
      Object.keys(draft.note || {}).some(function (k) { return draft.note[k] !== (typeof cur(k).comment === 'string' ? cur(k).comment : ''); });
  }
```

`api` gets: `draftKey: draftKey, readDraft: readDraft, writeDraft: writeDraft, draftDiffers: draftDiffers`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/exam-panel-core.test.mjs`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Wire it into `teacher.html`**

(a) After the `paste` listener (~line 925) add one delegated listener that rewrites the whole draft from the form on every change:

```js
// points and comments are kept as a draft in this browser until the check is saved (back / a link / an expired sign-in must not lose them)
function ckDraftSave(){
  if(!ck||location.hash!=='#/check/'+ck.id)return;
  const d={pts:{},note:{}};
  ck.long.forEach((t,i)=>{const s=document.querySelector(`[data-ck-pts="${i}"]`),c=document.querySelector(`[data-ck-note="${i}"]`);
    if(s&&!s.disabled)d.pts[t.n]=Number(s.value);
    if(c&&!c.disabled)d.note[t.n]=c.value;});
  ExamPanelCore.writeDraft(localStorage,ExamPanelCore.draftKey(ck.id),d);
}
app.addEventListener('input',e=>{if(e.target.closest&&e.target.closest('[data-ck-pts],[data-ck-note]'))ckDraftSave();});
app.addEventListener('change',e=>{if(e.target.closest&&e.target.closest('[data-ck-pts]'))ckDraftSave();});
```

(b) In `renderCheck`, after the line `ck={id,long:...};ckShown=id;` restore the draft over the server values and tell the teacher:

```js
  const dr=P.readDraft(localStorage,P.draftKey(id));
  if(dr&&ready&&P.draftDiffers(dr,part2)){
    long.forEach((t,i)=>{const s=document.querySelector(`[data-ck-pts="${i}"]`),c=document.querySelector(`[data-ck-note="${i}"]`);
      if(s&&Object.prototype.hasOwnProperty.call(dr.pts,t.n)&&[...s.options].some(o=>o.value===String(dr.pts[t.n])))s.value=String(dr.pts[t.n]);
      if(c&&Object.prototype.hasOwnProperty.call(dr.note,t.n))c.value=dr.note[t.n];});
    const m=document.getElementById('ck-msg');
    if(m&&!(ckNote&&ckNote.id===id)){m.textContent='Восстановлен черновик: баллы и комментарии, которые ты не успел отправить.';m.className='ck-msg grow';}
  }
```

(c) In `checkSend`, right after the `r.status!==200` block succeeds (just before the `say('Готово…')` line), clear the draft:

```js
  ExamPanelCore.writeDraft(localStorage,ExamPanelCore.draftKey(id),null);
```

- [ ] **Step 6: Verify in the browser** (start the dev stack from `tools/exam-dev-stack.mjs`, see its header for the command; open `teacher.html`, go to `#/check/<id>` of a submitted exam)
  1. Set points, type a comment, press browser "back", come forward: fields hold the typed values and the line "Восстановлен черновик…" shows.
  2. Type, then in DevTools remove the auth key to emulate expiry, trigger a refresh, sign in again: values are back.
  3. Press "Проверено, отправить": 200, reload the page: no draft message, server values shown (`localStorage` has no `ck-draft:*` key).
  4. A first-time blank form shows no draft message.
  Report what you saw; no "done" without it.

- [ ] **Step 7: Commit**

```bash
git add exam-panel-core.js teacher.html tests/exam-panel-core.test.mjs
git commit -m "Teacher panel: keep unsent scores and comments as a local draft"
```

---

### Task 2: The student is told when a last-second answer was rejected

**Files:**
- Modify: `exam-client-core.js` (helper `rejectedNote`)
- Modify: `exam.js` (`syncPhase` ~line 392, `takeLost` area ~line 135, the two screens that show `LOST_NOTE` ~lines 352, 1137, 1214)
- Test: `tests/exam-client-core.test.mjs`

**Interfaces:**
- Produces in `ExamClientCore` (`C`): `rejectedNote(snap: {[n]: string}, tasks: [{n, kind}]): string`: empty string when nothing non-empty was unsent; otherwise `'Время вышло, эти ответы не успели сохраниться: 3 — «12», 5 — «7».'` (short tasks only, ascending by number, answers cut to 40 characters, at most 10 listed).
- Produces in `exam.js`: `st.rejectedBy[id]` (string map by exam id), `addRejected(id, text)`, `takeRejected(id)`.

Why this shape: the server answers 409 only after the window closed, so the text cannot be accepted. The student still deserves to know which values were not counted. The existing note for lost photos (`lostBy`, `LOST_NOTE`) is the pattern to copy.

- [ ] **Step 1: Write the failing test** (append to `tests/exam-client-core.test.mjs`; use the file's existing import name for the core, check its first lines)

```js
test('rejectedNote lists the unsent short answers, nothing for empty or long tasks', () => {
  const tasks = [{ n: 3, kind: 'short' }, { n: 5, kind: 'short' }, { n: 13, kind: 'long' }];
  assert.equal(C.rejectedNote({ 5: '7', 3: '12' }, tasks), 'Время вышло, эти ответы не успели сохраниться: 3 — «12», 5 — «7».');
  assert.equal(C.rejectedNote({ 3: '' }, tasks), '');
  assert.equal(C.rejectedNote({ 13: 'x' }, tasks), '');
  assert.equal(C.rejectedNote({}, tasks), '');
  assert.equal(C.rejectedNote(null, tasks), '');
  assert.ok(C.rejectedNote({ 3: 'x'.repeat(100) }, tasks).includes('«' + 'x'.repeat(40) + '»'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/exam-client-core.test.mjs`
Expected: FAIL, `C.rejectedNote is not a function`.

- [ ] **Step 3: Implement** in `exam-client-core.js` next to `mergePending`, add to the exported object

```js
  // Unsent answers of a phase the server has already closed, as a sentence for the next screen ('' when there is nothing to say).
  function rejectedNote(snap, tasks) {
    if (!snap || typeof snap !== 'object') return '';
    const parts = [];
    (Array.isArray(tasks) ? tasks : []).slice().sort(function (a, b) { return a.n - b.n; }).forEach(function (t) {
      if (t.kind !== 'short' || !Object.prototype.hasOwnProperty.call(snap, String(t.n))) return;
      const v = snap[String(t.n)];
      if (typeof v === 'string' && v.trim() && parts.length < 10) parts.push(t.n + ' — «' + v.trim().slice(0, 40) + '»');
    });
    return parts.length ? 'Время вышло, эти ответы не успели сохраниться: ' + parts.join(', ') + '.' : '';
  }
```

Export: add `rejectedNote: rejectedNote` to the `api` object at the bottom (line ~375).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/exam-client-core.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire it into `exam.js`**

(a) Next to `takeLost` (line ~135) add:

```js
  // Answers the server refused because the window had closed: shown once on the next screen of that exam.
  function addRejected(id, text) { if (text) st.rejectedBy[id] = text; }
  function takeRejected(id) { const t = st.rejectedBy[id] || ''; delete st.rejectedBy[id]; return t; }
```

and add `rejectedBy: {}` where `lostBy: {}` is initialised in `st` (search `lostBy:`).

(b) In `syncPhase`, in the branch `if (r.json.phase !== s.phase) {...}`, take the text before `adopt`. The queue still holds the refused answers because `flush` does nothing once `s.closed`:

```js
        if (r.json.phase !== s.phase) { addRejected(s.id, C.rejectedNote(s.q.snapshot(), s.tasks)); s.closed = true; adopt(s.id, r.json); return; }
```

`makeSession(id, v, tasks)` must keep the tasks: add `tasks: tasks` to the session object. (If `s.tasks` is already there under another name, use that name.)

(c) At each place where `lost` is read and `LOST_NOTE` is shown (lines ~343/352, ~1130/1137, ~1214), read `const rej = takeRejected(id);` next to `takeLost(id)` and add after the `lost` note:

```js
        (rej ? '<p class="ex-note">' + esc(rej) + '</p>' : '') +
```

(use the exact string-concatenation style of the neighbouring `lost` line at each place).

- [ ] **Step 6: Verify in the dev stack** (`tools/exam-dev-stack.mjs`): open an exam with a short window, type an answer, take the network offline in DevTools, wait until the window ends, go online. Expected: the screen moves to the next phase and shows the sentence with that answer; a normal finish shows no sentence. Check the console for errors.

- [ ] **Step 7: Commit**

```bash
git add exam-client-core.js exam.js tests/exam-client-core.test.mjs
git commit -m "Exam page: tell the student which answers the server refused after the window closed"
```

---

### Task 3: Autosave does not read the whole exam

**Files:**
- Create: `backend/pb_migrations/1790800011_assignment_shorts.js`
- Modify: `backend/pb_hooks/exams.js` (`assign` ~line 144, `own` ~line 205, `answers` ~line 355)
- Test: `backend/tests/exams.test.mjs`

**Interfaces:**
- Produces: column `exam_assignments.shorts` (json, array of short-task numbers as strings, e.g. `["1","2"]`); `own(e, light)`: with `light === true` returns `{ rec }` and does not load the exam.

Why: `own()` loads the `exams` record on every request and `answers` parses `tasks` (up to 5 MB with images) only to learn which numbers are short. An assignment stores the list once at assignment time. Old rows are filled by the migration.

- [ ] **Step 1: Check who needs the exam** before touching `own`

Run: `grep -n "own(e)\|a\.exam" backend/pb_hooks/exams.js`
Expected: `answers` uses `a.exam` only in `prep`; `get`, `finish`, `done`, `viaTg`, `away`, photo routes: note each one. Only `answers` (and `away` if it does not use `a.exam`) switches to the light form; every other caller keeps `own(e)`.

- [ ] **Step 2: Write the failing test** in `backend/tests/exams.test.mjs`, following the existing helpers in that file (login helpers, `assign`, the stub). Two tests:

```js
test('answers are saved for a new assignment without loading the exam (shorts stored on the row)', async () => {
  // 1. assign an exam that has short tasks 1 and 2 and a long task 13 (use the file's existing fixture and helpers)
  // 2. read the assignment as the teacher: row.shorts deep-equals ['1', '2']
  // 3. open the exam as the student (phase open), POST /answers {1: '5', 13: 'text'}
  //    expect 200; GET the exam: answers has '1' === '5' and no '13'
});

test('an old assignment without shorts still saves answers (falls back to the exam)', async () => {
  // set shorts to [] on a row as superuser, POST /answers {1: '7'}: 200 and the answer is stored
});
```

Fill the bodies with the same fixtures/helpers the neighbouring `answers` tests in that file use (copy their setup lines; do not invent helpers).

- [ ] **Step 3: Run to verify it fails**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the first new test FAILS (`shorts` undefined). The second passes already: it pins the fallback.

- [ ] **Step 4: Migration** `backend/pb_migrations/1790800011_assignment_shorts.js`

```js
/// <reference path="../pb_data/types.d.ts" />
// exam_assignments.shorts: the numbers of the short-answer tasks of the assigned exam, kept on the row so that the
// autosave route does not have to load and parse the whole exam (with its pictures) on every request.
migrate((app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.add(new JSONField({ name: "shorts", maxSize: 2000 }));
  app.save(asg);
  const rows = app.findAllRecords("exam_assignments");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let tasks = [];
    try { tasks = JSON.parse(app.findRecordById("exams", r.getString("exam")).get("tasks")); } catch (_) {}
    const shorts = [];
    for (let j = 0; j < tasks.length; j++) if (tasks[j] && tasks[j].kind === "short") shorts.push(String(tasks[j].n));
    r.set("shorts", shorts);
    app.save(r);
  }
}, (app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.removeByName("shorts");
  app.save(asg);
});
```

Check how existing migrations read a json field (`J(r, "tasks", [])` in `exams.js` shows the pattern; if `.get("tasks")` returns a string or a byte array in goja, use the same conversion as `J`) and adjust the `JSON.parse` line.

- [ ] **Step 5: Hook changes** in `exams.js`

(a) `assign`: after the record is built, `rec.set("shorts", shortsOf(J(exam, "tasks", [])));` with a helper next to `intOf`:

```js
// Numbers of the short-answer tasks, as strings: what the autosave route needs to know about an exam.
function shortsOf(tasks) { return tasks.filter((x) => x && x.kind === "short").map((x) => String(x.n)); }
```

(b) `own(e, light)`:

```js
function own(e, light) {
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec || rec.getString("user") !== e.auth.id) return null;
  return light ? { rec: rec } : { rec: rec, exam: $app.findRecordById("exams", rec.getString("exam")) };
}
```

`during(e, phases, fn, prep, light)` passes `light` on to `own`.

(c) `answers`: replace the `prep` with one that uses the row, falling back to the exam for rows without `shorts`:

```js
  const a = during(e, ["open"], (r, a) => { /* unchanged body */ },
    (a) => {
      const s = J(a.rec, "shorts", []);
      if (s.length) { s.forEach((n) => { short[String(n)] = true; }); return; }
      J($app.findRecordById("exams", a.rec.getString("exam")), "tasks", []).forEach((x) => { if (x.kind === "short") short[String(x.n)] = true; });
    }, true);
```

- [ ] **Step 6: Run the backend tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/`
Expected: all PASS, including both new tests and the existing `answers` tests.

- [ ] **Step 7: Measure** (evidence, not a claim). In the test file add a temporary timing: save an exam with a 3 MB `cond` string, send 20 `/answers` requests, print total ms; run once on `master` (`git stash` is forbidden here, use `git worktree`/checkout of the old hooks in a temp dir or compare with the run before Step 5) and once now. Report both numbers; remove the timing code before committing.

- [ ] **Step 8: Bump the service worker and run everything**

Edit `sw.js`: `const VERSION = 'v97';` (Tasks 1 and 2 changed shell files).

Run: `node --test tests/ && PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/pb_migrations/1790800011_assignment_shorts.js backend/pb_hooks/exams.js backend/tests/exams.test.mjs sw.js
git commit -m "Autosave: keep short-task numbers on the assignment so the exam is not loaded on every save; sw v97"
```

---

### Task 4: Pull request

- [ ] Push the branch and open a PR to `master` (never push to `master`). Description: three fixes, what Kirill must run on the server for Task 3 (the migration applies on PocketBase start; the hooks need the usual deploy), and what was checked by hand in Tasks 1 and 2.
- [ ] After opening, bind it with the `ccd_pr` tools and read CI as the session rules require.

## Self-Review

- **Coverage:** panel draft → Task 1; 409 notice → Task 2; autosave read (item 9) → Task 3. The 401-after-login item was checked in the code and already works (copy in `localStorage`, `exam.js:337`), so there is no task. Not in this plan, on purpose: bot-blocked retries (noise only), photo thumbnails, server-side tag check (bigger, not hurting now).
- **Placeholders:** the two backend test bodies in Task 3 Step 2 are described, not written out, because they must reuse fixtures that live in `backend/tests/exams.test.mjs` (read the neighbouring `answers` tests first). Everything else has code.
- **Names:** `draftKey/readDraft/writeDraft/draftDiffers` (Task 1), `rejectedNote/addRejected/takeRejected/rejectedBy` (Task 2), `shorts/shortsOf/own(e, light)` (Task 3) are used consistently. `s.tasks` in Task 2 may need adding to `makeSession`; Step 5(b) says so.
