# Assigned Mock Exams, Part 1b: Photos Through the Bot (Server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student who finds the site inconvenient sends photos of part 2 to the sign-in bot (`@kirill_repet_bot`) instead of to the teacher's private chat; the bot attaches them to the student's running exam, so everything lives in one place. The trainer can list the photos with a small route.

**Architecture:** The bot webhook (`backend/pb_hooks/tg.js`) hands photo messages to a new `botPhoto()` in `backend/pb_hooks/exams.js`, which finds the student's exam that accepts photos right now (server clock), picks the task from the caption, downloads the file from Telegram into `exam_photos`, and answers the student. A new migration adds three small bookkeeping columns. A new student route `GET /api/ege/exams/{id}/photos` returns the photo list.

**Tech Stack:** PocketBase 0.40.4 JS hooks on goja (plain ES6: no `?.`, `??`, spread, async), Node's built-in test runner, the Telegram stub of `backend/tests/exams.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-05-assigned-exams-design.md`, section "Amendments", item 1.

## Global Constraints

- The repository is public; tests use made-up data only. Never log or print the bot token or any URL that contains it (Telegram file URLs do).
- Hook code runs on goja: no `?.`, no `??`, no object spread, no `async`/`await`.
- Never save the `users` collection in a migration. Never edit an already-applied migration: this plan adds `1790800008_exam_tg_photos.js`.
- Every write to `exam_assignments` goes through `mutate()` (re-read inside the transaction; no network call inside a transaction; use only `tx.*` inside the callback).
- Photos are accepted only while the assignment's phase is `open` or `photos` by the server clock; at most 5 per task; 10 MB; JPEG, PNG or WebP.
- Bot texts in Russian, on «ты», no emoji; comments in English.
- Commit after every task; never push to `master`; never touch the production server.
- Backend tests: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`. Unit tests: `node --test 'tests/*.test.mjs'`.

## Behaviour

A photo (`message.photo`) or an image sent as a file (`message.document` with an image mime type) from a private chat:

1. Sender has no bot profile, or the account is disabled → not handled here; the normal sign-in flow answers.
2. No assignment in phase `open`/`photos` (server clock) → "Сейчас нет пробника, к которому можно прикрепить фото…"; nothing stored.
3. Document that is not JPEG/PNG/WebP, or a file over 10 MB → "Такой файл я не принимаю…"; nothing stored.
4. The task `n`: a number in the caption that is a part 2 (`long`) task of the exam; else the task of the previous captioned photo if it was at most 300 s ago; else the exam's only part 2 task if it has exactly one; else → "Принял… не понял, к какому заданию. Пришли ещё раз с подписью…"; nothing stored.
5. Five photos already on that task → "К заданию N уже прикреплено пять фото…"; nothing stored.
6. Otherwise the photo is downloaded and stored as an `exam_photos` row (`user`, `assignment`, `n`) and the bot answers "Принял фото к заданию N (всего K)." — once per album (same `media_group_id` as the previous photo → no second answer).

Known limit: Telegram may deliver the photos of an album out of order; an uncaptioned photo that arrives before the captioned one is answered with the "не понял" text and must be resent.

## File Structure

| File | Responsibility |
|---|---|
| `backend/pb_migrations/1790800008_exam_tg_photos.js` (new) | Columns `tg_task`, `tg_task_at`, `tg_group` on `exam_assignments`. |
| `backend/pb_hooks/exams.js` (modify) | `photoList` route handler, `botPhoto()`, new bot texts. |
| `backend/pb_hooks/exams.pb.js` (modify) | Register `GET /api/ege/exams/{id}/photos`. |
| `backend/pb_hooks/tg.js` (modify) | Webhook hands photo messages to `botPhoto()`. |
| `backend/tests/exams.test.mjs` (modify) | Stub serves `getFile` and file bytes; new tests. |
| `backend/README.md` (modify) | Rollout note. |

---

### Task 1: Migration and the student photo-list route

**Files:**
- Create: `backend/pb_migrations/1790800008_exam_tg_photos.js`
- Modify: `backend/pb_hooks/exams.js`, `backend/pb_hooks/exams.pb.js`, `backend/tests/exams.test.mjs`

**Interfaces:**
- Produces: columns `exam_assignments.tg_task` (text ≤ 8), `tg_task_at` (int), `tg_group` (text ≤ 40); route `GET /api/ege/exams/{id}/photos` → `200 {photos:[{id,n,file}]}` for the owner in any phase except `scheduled` and `missed` (`409`), `403` signed out / inactive, `404` not own.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/exams.test.mjs`:

```js
test('the photo list route returns the own photos and refuses before the start', async () => {
  const exam = await mkExam(), s = await student(7000000290), other = await student(7000000291);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  assert.equal((await req('GET', `/ege/exams/${id}/photos`, s.token)).status, 409);       // scheduled
  await shift(id, { start: nowS() - 10, duration: 600 });
  await view(id, s.token);
  const up = await upload(id, s.token, 13);
  assert.equal(up.status, 200);
  const r = await req('GET', `/ege/exams/${id}/photos`, s.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.photos, [{ id: up.json.id, n: '13', file: up.json.file }]);
  assert.equal((await req('GET', `/ege/exams/${id}/photos`, other.token)).status, 404);
  assert.equal((await req('GET', `/ege/exams/${id}/photos`, null)).status, 403);
});

test('the bot bookkeeping columns exist and start empty', async () => {
  const exam = await mkExam(), s = await student(7000000292);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  const row = await rowOf(id);
  assert.equal(row.tg_task, ''); assert.equal(row.tg_group, ''); assert.equal(row.tg_task_at, 0);
});
```

(`upload`, `view`, `rowOf`, `assign`, `shift` are existing helpers of this file; if a helper is defined later in the file than where you append, append at the very end.)

- [ ] **Step 2: Run it and see it fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: both new tests FAIL (404 for the route; `undefined` for the columns).

- [ ] **Step 3: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />
// Bookkeeping for photos that arrive through the bot: the task of the last
// captioned photo (an album or a follow-up then needs no second caption) and the
// album id of the last photo (the bot answers once per album). `users` is not touched.
migrate((app) => {
  const c = app.findCollectionByNameOrId("exam_assignments");
  c.fields.add(new TextField({ name: "tg_task", max: 8 }));
  c.fields.add(new NumberField({ name: "tg_task_at", onlyInt: true }));
  c.fields.add(new TextField({ name: "tg_group", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("exam_assignments");
  c.fields.removeByName("tg_task"); c.fields.removeByName("tg_task_at"); c.fields.removeByName("tg_group");
  app.save(c);
});
```

If PocketBase 0.40.4 rejects `TextField`/`NumberField` or `fields.add`, look up the exact constructors in `~/.local/pocketbase/pb_data/types.d.ts` (search `class TextField`) and adapt; keep the three column names and types.

- [ ] **Step 4: Add the route**

In `exams.pb.js`, next to the other photo routes:

```js
routerAdd("GET", "/api/ege/exams/{id}/photos", (e) => require(`${__hooks}/exams.js`).photoList(e));
```

In `exams.js` (before `module.exports`):

```js
// The caller's photos for the page to poll while photos can still arrive from the bot.
function photoList(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const a = own(e);
  if (!a) return fail(e, 404, "not found");
  const p = Core.phase(shape(a.rec), nowS());
  if (p === "scheduled" || p === "missed") return fail(e, 409, "closed");
  return e.json(200, { photos: photosOf(a.rec) });
}
```

and add `photoList: photoList` to `module.exports`.

- [ ] **Step 5: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/pb_migrations/1790800008_exam_tg_photos.js backend/pb_hooks backend/tests/exams.test.mjs
git commit -m "Exams: bot bookkeeping columns and the student photo-list route"
```

---

### Task 2: Photos from the bot

**Files:**
- Modify: `backend/pb_hooks/exams.js`, `backend/pb_hooks/tg.js`, `backend/tests/exams.test.mjs`

**Interfaces:**
- Consumes: `mutate`, `own`-style helpers, `photosOf`, `J`, `shape`, `byId`, `nowS`, `MAX_PHOTOS`, `Core`, `tg.send`.
- Produces: `botPhoto(msg) -> boolean` (true = handled; false = let the sign-in flow answer); `TEXT.bot*` strings.

- [ ] **Step 1: Make the test stub serve Telegram's file API and add helpers**

In `backend/tests/exams.test.mjs`, replace the stub handler in `before()` (the `createServer((q, s) => {...})` for `STUB_PORT`) with:

```js
  stub = createServer((q, s) => {
    if (q.method === 'GET' && q.url.includes('/getFile')) {             // getFile: where the bytes are
      s.setHeader('content-type', 'application/json');
      return s.end(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } }));
    }
    if (q.method === 'GET' && q.url.includes('/file/bot')) {            // the bytes themselves
      s.setHeader('content-type', 'image/png');
      return s.end(PNG);
    }
    let b = ''; q.on('data', d => b += d);
    q.on('end', () => { sent.push({ path: q.url, ...JSON.parse(b) }); s.end('{"ok":true}'); });
  }).listen(STUB_PORT, '127.0.0.1');
```

(If your stub has delay logic from an earlier fix, keep it and add the two GET branches in front.) Append the helpers:

```js
const photoUpdate = (tgId, o = {}) => ({ update_id: 1, message: {
  message_id: 1, from: { id: tgId, is_bot: false, first_name: 'Маша' }, chat: { id: tgId, type: 'private' },
  caption: o.caption, media_group_id: o.group,
  ...(o.doc ? { document: { file_id: 'F1', file_size: 1000, mime_type: o.doc } }
            : { photo: [{ file_id: 'S', file_size: 10 }, { file_id: 'L', file_size: 1000 }] }) } });
const botHook = (upd) => req('POST', '/tg/webhook', null, upd, { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
const TASKS2 = [...TASKS, { n: 14, kind: 'long', max: 3, cond: '<p>Докажите, что 1 + 1 = 2.</p>' }];
const KEY2 = { ...KEY, 14: { a: '<p>Очевидно.</p>' } };
async function mkExam2() {
  const r = await req('POST', '/collections/exams/records', tok.teacher, { title: 'Пробник 2', full: false, tasks: TASKS2, key: KEY2 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.id;
}
const photosOf = async (id, token) => (await req('GET', `/ege/exams/${id}/photos`, token)).json.photos;
```

- [ ] **Step 2: Write the failing tests**

```js
test('a photo sent to the bot lands on the only part 2 task and the sign-in link is not sent', async () => {
  const exam = await mkExam(), s = await student(7000000300);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  const before = sent.length;
  assert.equal((await botHook(photoUpdate(7000000300))).status, 200);
  const ph = await photosOf(id, s.token);
  assert.equal(ph.length, 1); assert.equal(ph[0].n, '13');
  assert.equal(said(s.chat, 'Принял фото к заданию 13 (всего 1)'), 1);
  assert.equal(sent.slice(before).filter(m => m.reply_markup).length, 0);
});

test('with several part 2 tasks the caption picks the task, the next photos follow it, an album is answered once', async () => {
  const exam = await mkExam2(), s = await student(7000000301);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  await botHook(photoUpdate(7000000301));                                          // no caption, no sticky task, two candidates
  assert.equal((await photosOf(id, s.token)).length, 0);
  assert.equal(said(s.chat, 'не понял, к какому заданию'), 1);
  await botHook(photoUpdate(7000000301, { caption: 'задание 14', group: 'g1' }));  // captioned: task 14
  await botHook(photoUpdate(7000000301, { group: 'g1' }));                         // same album, no caption: sticky 14, silent
  await botHook(photoUpdate(7000000301, { caption: '13' }));                       // another task
  await botHook(photoUpdate(7000000301, { caption: '99' }));                       // not a part 2 task: sticky (13) wins
  const ph = await photosOf(id, s.token);
  assert.deepEqual(ph.map(p => p.n).sort(), ['13', '13', '14', '14']);
  assert.equal(said(s.chat, 'Принял фото к заданию 14'), 1);                       // once per album
  assert.equal(said(s.chat, 'Принял фото к заданию 13'), 2);
});

test('the sticky task expires after five minutes', async () => {
  const exam = await mkExam2(), s = await student(7000000302);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  await botHook(photoUpdate(7000000302, { caption: '14' }));
  await shift(id, { tg_task_at: nowS() - 400 });
  await botHook(photoUpdate(7000000302));
  assert.equal((await photosOf(id, s.token)).length, 1);                            // the second one was refused
  assert.equal(said(s.chat, 'не понял, к какому заданию'), 1);
});

test('no exam that accepts photos: a polite refusal and nothing stored', async () => {
  const s = await student(7000000303);
  await botHook(photoUpdate(7000000303));
  assert.equal(said(s.chat, 'Сейчас нет пробника'), 1);
  const exam = await mkExam();
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  await shift(id, { start: nowS() - 700, duration: 600 });                          // photo grace
  await botHook(photoUpdate(7000000303));
  assert.equal((await photosOf(id, s.token)).length, 1);
  await shift(id, { start: nowS() - 1300, duration: 600 });                         // grace is over
  await botHook(photoUpdate(7000000303));
  assert.equal(said(s.chat, 'Сейчас нет пробника'), 2);
});

test('five photos per task, unsupported files refused, a png sent as a file accepted', async () => {
  const exam = await mkExam(), s = await student(7000000304);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  await botHook(photoUpdate(7000000304, { doc: 'image/heic' }));
  await botHook(photoUpdate(7000000304, { doc: 'application/pdf' }));
  assert.equal((await photosOf(id, s.token)).length, 0);
  for (let i = 0; i < 5; i++) await botHook(photoUpdate(7000000304, { doc: 'image/png' }));
  assert.equal((await photosOf(id, s.token)).length, 5);
  await botHook(photoUpdate(7000000304));
  assert.equal((await photosOf(id, s.token)).length, 5);
  assert.equal(said(s.chat, 'уже прикреплено пять фото'), 1);
  assert.ok(said(s.chat, 'Такой файл я не принимаю') >= 1);
});

test('someone who never started the bot gets the normal sign-in flow, not a crash', async () => {
  const before = sent.length;
  assert.equal((await botHook(photoUpdate(7000000399))).status, 200);
  assert.equal(sent.slice(before).filter(m => m.chat_id === 7000000399 && m.reply_markup).length, 1);   // the sign-in link
});
```

Notes for the implementer: the PDF document must NOT be handled as a photo (`application/pdf` is not an `image/*` type) — it falls through to the normal flow and the student gets the sign-in link message; the test only asserts that nothing was stored. The `said(…'Такой файл я не принимаю')` count is for the HEIC one.

- [ ] **Step 3: Run and see them fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the new tests FAIL (the webhook answers every photo with the sign-in link).

- [ ] **Step 4: Implement `botPhoto`**

In `exams.js` extend `TEXT` with:

```js
  botNoExam: "Сейчас нет пробника, к которому можно прикрепить фото: он должен идти или быть в последних 10 минутах после окончания.",
  botLost: "Принял фото, но не понял, к какому заданию. Пришли его ещё раз с подписью — номером задания, например «13».",
  botTooMany: (n) => "К заданию " + n + " уже прикреплено пять фото — больше нельзя. Лишнее можно удалить на сайте.",
  botBadFile: "Такой файл я не принимаю. Пришли фото или картинку JPEG, PNG или WebP.",
  botFail: "Не получилось забрать фото. Пришли его ещё раз.",
  botOk: (n, k) => "Принял фото к заданию " + n + " (всего " + k + ").",
```

Add before `module.exports`:

```js
const tgApi = () => env("TG_API") || "https://api.telegram.org";

// A photo, or an image sent as a file, from the student's own Telegram chat.
// Returns true when handled here, false to let the sign-in flow answer.
function botPhoto(msg) {
  const chat = msg.chat.id, t = nowS();
  let profile;
  try { profile = $app.findFirstRecordByData("tg_profiles", "tg_id", String(msg.from.id)); } catch (_) { return false; }
  const user = byId("users", profile.getString("user"));
  if (!user || !user.getBool("active")) return false;
  const say = (text) => tg.send(chat, text);

  // the exam that takes photos right now: open, or inside the 10 minutes of grace
  const rows = $app.findRecordsByFilter("exam_assignments", "user = {:u} && start < {:t} && start > {:old}", "-start", 10, 0,
    { u: user.id, t: t, old: t - 2 * 86400 });
  let a = null;
  for (let i = 0; i < rows.length && !a; i++) {
    const p = Core.phase(shape(rows[i]), t);
    if (p === "open" || p === "photos") a = rows[i];
  }
  if (!a) { say(TEXT.botNoExam); return true; }

  const doc = msg.document, f = msg.photo ? msg.photo[msg.photo.length - 1] : doc;
  if (!f || (doc && ["image/jpeg", "image/png", "image/webp"].indexOf(doc.mime_type) < 0) || (f.file_size || 0) > 10485760) {
    say(TEXT.botBadFile); return true;
  }

  const exam = $app.findRecordById("exams", a.getString("exam")), longN = [];
  J(exam, "tasks", []).forEach((x) => { if (x.kind === "long") longN.push(String(x.n)); });
  const m = /(\d{1,2})/.exec(String(msg.caption || "")), group = String(msg.media_group_id || "");
  // decide the task on the fresh row and remember it for the next photos
  const plan = mutate(a.id, (r) => {
    const p = Core.phase(shape(r), t);
    if (p !== "open" && p !== "photos") return { closed: true };
    let n = "";
    if (m && longN.indexOf(m[1]) >= 0) n = m[1];
    else if (r.getString("tg_task") && t - r.getInt("tg_task_at") <= 300 && longN.indexOf(r.getString("tg_task")) >= 0) n = r.getString("tg_task");
    else if (longN.length === 1) n = longN[0];
    if (!n) return { n: "" };
    const quiet = group !== "" && group === r.getString("tg_group");
    r.set("tg_task", n); r.set("tg_task_at", t); r.set("tg_group", group);
    return { n: n, quiet: quiet };
  });
  if (!plan || plan.closed) { say(TEXT.botNoExam); return true; }
  if (!plan.n) { say(TEXT.botLost); return true; }
  if ($app.countRecords("exam_photos", $dbx.hashExp({ assignment: a.id, n: plan.n })) >= MAX_PHOTOS) { say(TEXT.botTooMany(plan.n)); return true; }

  let saved = false;
  try {
    const info = $http.send({ url: tgApi() + "/bot" + env("TG_BOT_TOKEN") + "/getFile?file_id=" + encodeURIComponent(f.file_id), method: "GET", timeout: 10 });
    const path = info.json && info.json.result && info.json.result.file_path;
    if (!path) throw new Error("no file path");
    const p = new Record($app.findCollectionByNameOrId("exam_photos"));
    p.set("user", user.id); p.set("assignment", a.id); p.set("n", plan.n);
    p.set("file", $filesystem.fileFromURL(tgApi() + "/file/bot" + env("TG_BOT_TOKEN") + "/" + path, 30));
    $app.save(p);
    saved = true;
  } catch (err) { console.log("exams: bot photo failed"); }       // never log the URL or the error text: they can hold the token
  if (!saved) { say(TEXT.botFail); return true; }
  if (!plan.quiet) say(TEXT.botOk(plan.n, $app.countRecords("exam_photos", $dbx.hashExp({ assignment: a.id, n: plan.n }))));
  return true;
}
```

Add `botPhoto: botPhoto` to `module.exports`.

If `$filesystem.fileFromURL` does not exist or behaves differently on 0.40.4 (check `~/.local/pocketbase/pb_data/types.d.ts`), download with `$http.send` and `$filesystem.fileFromBytes(bytes, "photo.jpg")` instead; keep the behaviour the tests pin.

- [ ] **Step 5: Hand photo messages to it from the webhook**

In `tg.js` `webhook()`, right after the guard that returns for invalid messages and before `const r = ensure(msg.from);`:

```js
  // photos and images sent as files belong to a running exam, not to the sign-in flow
  if (msg.photo || (msg.document && /^image\//.test(msg.document.mime_type || ""))) {
    if (require(`${__hooks}/exams.js`).botPhoto(msg)) return e.json(200, { ok: true });
  }
```

(`exams.js` requires `tg.js` at its top; the `require` here runs at call time, after both modules are loaded, so there is no load-order problem. If goja complains about the cycle, move `const tg = require(...)` in `exams.js` into a lazy getter `const tgm = () => require(`${__hooks}/tg.js`)` and use `tgm().send` — change nothing else.)

- [ ] **Step 6: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass (the existing 59 plus the new ones). Run the exams suite at least 5 times in a row to check for flakiness.

- [ ] **Step 7: Commit**

```bash
git add backend/pb_hooks backend/tests/exams.test.mjs
git commit -m "Exams: photos of part 2 through the bot, attached to the student's running exam"
```

---

### Task 3: README rollout and a final check

**Files:**
- Modify: `backend/README.md`

- [ ] **Step 1: Update the README**

In the section "Assigned mock exams" add:

```markdown
### Photos through the bot

A student can send photos of part 2 to the bot instead of attaching them on the site.
The bot attaches them to the student's running exam (open, or within the 10 minutes
after it); the task comes from the caption («13»), from the previous captioned photo
(5 minutes), or from the only part 2 task. Handled in `botPhoto()` (`pb_hooks/exams.js`);
the webhook (`tg.js`) hands photo messages there. No change to the Telegram webhook
registration is needed (`message` updates already include photos).

Rollout of this part, on top of the earlier exams rollout:

    scp backend/pb_migrations/1790800008_exam_tg_photos.js root@185.249.154.78:/opt/ege-api/pb_migrations/
    scp backend/pb_hooks/exams.pb.js backend/pb_hooks/exams.js backend/pb_hooks/tg.js root@185.249.154.78:/opt/ege-api/pb_hooks/
    ssh root@185.249.154.78 'chown egeapi: /opt/ege-api/pb_migrations/1790800008_exam_tg_photos.js /opt/ege-api/pb_hooks/exams.pb.js /opt/ege-api/pb_hooks/exams.js /opt/ege-api/pb_hooks/tg.js && systemctl restart ege-api && sleep 2 && systemctl is-active ege-api'

Verify: `curl -s -o /dev/null -w '%{http_code}\n' https://api.kirillnyun.space/api/ege/exams/x/photos` prints `403`.
```

- [ ] **Step 2: Run both suites once**

Run: `node --test 'tests/*.test.mjs'` and `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add backend/README.md
git commit -m "Document the photos-through-the-bot part and its rollout"
```

## Self-Review (done by the plan author)

Spec amendment 1 coverage: bot receives photos and attaches them to the running exam with the same time rules, cap and size as the site (Task 2); task from caption / sticky 5 minutes / single long task, otherwise a resend request with nothing stored (Task 2); one answer per album (Task 2); the trainer's photo list route (Task 1); nothing changes in the webhook registration (Task 3). Out of scope here: the trainer UI (Plan 2) and the check page (Plan 3).
