# Assigned Mock Exams, Part 1b: Photos Through the Bot (Server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student who finds the site inconvenient simply sends photos of their solutions to the sign-in bot (`@kirill_repet_bot`) — no caption, no task number. The bot attaches them to the exam that started last, so everything lives in one place; the teacher sorts out what is where. The trainer and the panel can list the photos with a small route.

**Architecture:** The bot webhook (`backend/pb_hooks/tg.js`) hands photo messages to a new `botPhoto()` in `backend/pb_hooks/exams.js`, which finds the student's last started exam, checks that it takes photos right now (server clock), downloads the file from Telegram into `exam_photos` (with an empty task), and answers the student. A new migration makes the photo's task optional and adds one bookkeeping column. A new student route `GET /api/ege/exams/{id}/photos` returns the photo list.

**Tech Stack:** PocketBase 0.40.4 JS hooks on goja (plain ES6: no `?.`, `??`, spread, async), Node's built-in test runner, the Telegram stub of `backend/tests/exams.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-05-assigned-exams-design.md`, section "Amendments", item 1.

## Global Constraints

- The repository is public; tests use made-up data only. Never log or print the bot token or any URL that contains it (Telegram file URLs do).
- Hook code runs on goja: no `?.`, no `??`, no object spread, no `async`/`await`.
- Never save the `users` collection in a migration. Never edit an already-applied migration: this plan adds `1790800008_exam_tg_photos.js`.
- Every write to `exam_assignments` goes through `mutate()` (re-read inside the transaction; no network call inside a transaction; use only `tx.*` inside the callback).
- Bot photos are accepted only while the last started exam's phase is `open` or `photos` by the server clock; 10 MB; JPEG, PNG or WebP; at most 15 bot photos per exam. Photos attached on the site keep their rules (task required, at most 5 per task) and are untouched.
- Bot texts in Russian, on «ты», no emoji; comments in English.
- Commit after every task; never push to `master`; never touch the production server.
- Backend tests: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`. Unit tests: `node --test 'tests/*.test.mjs'`.

## Behaviour

A photo (`message.photo`) or an image sent as a file (`message.document` with an image mime type) from a private chat:

1. Sender has no bot profile, or the account is disabled → not handled here; the normal sign-in flow answers.
2. "The last started exam" = the sender's assignment with the greatest `start` that is not in the future. None → "Сейчас нет пробника, к которому можно прикрепить фото."
3. That exam is not `open`/`photos` (it is `submitted`, `checked`, `missed`) → "Время пробника вышло, фото прикрепить уже нельзя. Если оно нужно, напиши преподавателю: @kirill_math_tutor."
4. A document that is not JPEG/PNG/WebP, or a file over 10 MB → "Такой файл я не принимаю. Пришли фото или картинку JPEG, PNG или WebP."
5. Fifteen bot photos already → "К пробнику уже прикреплено 15 фото — больше нельзя."
6. Otherwise the photo is downloaded and stored as an `exam_photos` row (`user`, `assignment`, `n` = empty) and the bot answers "Принял фото к пробнику «<title>» (всего K)." — once per album (same `media_group_id` as the previous bot photo → no second answer).

Telegram sends the photos of an album as separate updates; the "once per album" rule uses the album id stored on the assignment.

## File Structure

| File | Responsibility |
|---|---|
| `backend/pb_migrations/1790800008_exam_tg_photos.js` (new) | `exam_photos.n` becomes optional; column `tg_group` on `exam_assignments`. |
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
- Produces: `exam_photos.n` optional (empty string = "sent to the bot, no task"); `exam_assignments.tg_group` (text ≤ 40); route `GET /api/ege/exams/{id}/photos` → `200 {photos:[{id,n,file}]}` for the owner in any phase except `scheduled` and `missed` (`409`), `403` signed out / inactive, `404` not own.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/exams.test.mjs` (at the very end, so all helpers exist):

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

test('migration 1790800008: tg_group exists and starts empty', async () => {
  const exam = await mkExam(), s = await student(7000000292);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  assert.equal((await rowOf(id)).tg_group, '');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: both new tests FAIL (404 for the route; `undefined` for the column).

- [ ] **Step 3: Write the migration**

```js
/// <reference path="../pb_data/types.d.ts" />
// Photos sent to the bot carry no task, so exam_photos.n becomes optional (empty
// = "sent to the bot"). exam_assignments.tg_group remembers the album id of the
// last bot photo: the bot answers once per album. `users` is not touched.
migrate((app) => {
  const photos = app.findCollectionByNameOrId("exam_photos");
  photos.fields.getByName("n").required = false;
  app.save(photos);
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.add(new TextField({ name: "tg_group", max: 40 }));
  app.save(asg);
}, (app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.removeByName("tg_group");
  app.save(asg);
  const photos = app.findCollectionByNameOrId("exam_photos");
  photos.fields.getByName("n").required = true;
  app.save(photos);
});
```

If PocketBase 0.40.4 rejects `TextField` / `fields.getByName` / `fields.add`, look up the exact API in `~/.local/pocketbase/pb_data/types.d.ts` (search `class TextField`, `interface FieldsList`) and adapt; keep the column name, the optional `n`, and that the down-migration reverses both.

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
git commit -m "Exams: optional photo task, album bookkeeping and the student photo-list route"
```

---

### Task 2: Photos from the bot

**Files:**
- Modify: `backend/pb_hooks/exams.js`, `backend/pb_hooks/tg.js`, `backend/tests/exams.test.mjs`

**Interfaces:**
- Consumes: `mutate`, `photosOf`, `J`, `shape`, `byId`, `nowS`, `Core`, `tg.send`.
- Produces: `botPhoto(msg) -> boolean` (true = handled; false = let the sign-in flow answer); `TEXT.bot*` strings; `MAX_BOT_PHOTOS = 15`.

- [ ] **Step 1: Make the test stub serve Telegram's file API and add helpers**

In `backend/tests/exams.test.mjs`, in `before()` put these two GET branches at the start of the Telegram stub's request handler (keep every other branch the stub already has, such as delays):

```js
    if (q.method === 'GET' && q.url.includes('/getFile')) {             // getFile: where the bytes are
      s.setHeader('content-type', 'application/json');
      return s.end(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } }));
    }
    if (q.method === 'GET' && q.url.includes('/file/bot')) {            // the bytes themselves
      s.setHeader('content-type', 'image/png');
      return s.end(PNG);
    }
```

(`PNG` is the constant already defined in this file for the upload tests; if it is defined below `before()`, move its definition above — it is a module-level `const`.) Append the helpers at the end of the file:

```js
const photoUpdate = (tgId, o = {}) => ({ update_id: 1, message: {
  message_id: 1, from: { id: tgId, is_bot: false, first_name: 'Маша' }, chat: { id: tgId, type: 'private' },
  media_group_id: o.group,
  ...(o.doc ? { document: { file_id: 'F1', file_size: o.size || 1000, mime_type: o.doc } }
            : { photo: [{ file_id: 'S', file_size: 10 }, { file_id: 'L', file_size: 1000 }] }) } });
const botHook = (upd) => req('POST', '/tg/webhook', null, upd, { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
const photosOf = async (id, token) => (await req('GET', `/ege/exams/${id}/photos`, token)).json.photos;
async function running(tgId, title = 'Пробник Ф') {
  const exam = await mkExam(title), s = await student(tgId);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  return { exam, s, id };
}
```

- [ ] **Step 2: Write the failing tests**

```js
test('a photo sent to the bot lands on the exam, with no task, and the sign-in link is not sent', async () => {
  const { s, id } = await running(7000000300);
  const before = sent.length;
  assert.equal((await botHook(photoUpdate(7000000300))).status, 200);
  const ph = await photosOf(id, s.token);
  assert.equal(ph.length, 1); assert.equal(ph[0].n, '');
  assert.equal(said(s.chat, 'Принял фото к пробнику «Пробник Ф» (всего 1)'), 1);
  assert.equal(sent.slice(before).filter(m => m.reply_markup).length, 0);
});

test('an album is answered once; the next photo counts on', async () => {
  const { s, id } = await running(7000000301);
  await botHook(photoUpdate(7000000301, { group: 'g1' }));
  await botHook(photoUpdate(7000000301, { group: 'g1' }));
  await botHook(photoUpdate(7000000301, { group: 'g1' }));
  assert.equal((await photosOf(id, s.token)).length, 3);
  assert.equal(said(s.chat, 'Принял фото к пробнику'), 1);
  await botHook(photoUpdate(7000000301));
  assert.equal((await photosOf(id, s.token)).length, 4);
  assert.equal(said(s.chat, 'Принял фото к пробнику'), 2);
  assert.equal(said(s.chat, 'всего 4'), 1);
});

test('photos go to the exam that started last, and only while it takes photos', async () => {
  const s = await student(7000000302), e1 = await mkExam('Старый'), e2 = await mkExam('Новый');
  const old = (await assign(s.id, e1, nowS() - 100000, 600)).json.id;               // long over
  const cur = (await assign(s.id, e2, nowS() - 10, 600)).json.id;
  await view(cur, s.token);
  await assign(s.id, await mkExam('Будущий'), nowS() + 7200);                       // not started: ignored
  await botHook(photoUpdate(7000000302));
  assert.equal((await photosOf(cur, s.token)).length, 1);
  assert.equal((await rowOf(old)).opened, 0);
  assert.equal(said(s.chat, 'пробнику «Новый»'), 1);

  await shift(cur, { start: nowS() - 700, duration: 600 });                          // 10-minute photo grace
  await botHook(photoUpdate(7000000302));
  assert.equal((await photosOf(cur, s.token)).length, 2);
  await shift(cur, { start: nowS() - 1300, duration: 600 });                         // grace is over
  await botHook(photoUpdate(7000000302));
  assert.equal((await photosOf(cur, s.token)).length, 2);
  assert.equal(said(s.chat, 'Время пробника вышло'), 1);
});

test('no started exam at all: a polite refusal and nothing stored', async () => {
  const s = await student(7000000303);
  await botHook(photoUpdate(7000000303));
  assert.equal(said(s.chat, 'Сейчас нет пробника'), 1);
  const exam = await mkExam();
  await assign(s.id, exam, nowS() + 7200);
  await botHook(photoUpdate(7000000303));
  assert.equal(said(s.chat, 'Сейчас нет пробника'), 2);
});

test('fifteen bot photos per exam, unsupported files refused, a png sent as a file accepted', async () => {
  const { s, id } = await running(7000000304);
  await botHook(photoUpdate(7000000304, { doc: 'image/heic' }));
  await botHook(photoUpdate(7000000304, { doc: 'image/png', size: 11 * 1024 * 1024 }));
  assert.equal((await photosOf(id, s.token)).length, 0);
  assert.equal(said(s.chat, 'Такой файл я не принимаю'), 2);
  for (let i = 0; i < 15; i++) await botHook(photoUpdate(7000000304, { doc: 'image/png' }));
  assert.equal((await photosOf(id, s.token)).length, 15);
  await botHook(photoUpdate(7000000304));
  assert.equal((await photosOf(id, s.token)).length, 15);
  assert.equal(said(s.chat, 'уже прикреплено 15 фото'), 1);
});

test('site photos and bot photos live side by side; the student can delete a bot photo', async () => {
  const { s, id } = await running(7000000305);
  await upload(id, s.token, 13);
  await botHook(photoUpdate(7000000305));
  const ph = await photosOf(id, s.token);
  assert.deepEqual(ph.map(p => p.n).sort(), ['', '13']);
  const bot = ph.find(p => p.n === '');
  assert.equal((await req('DELETE', `/ege/exams/${id}/photos/${bot.id}`, s.token)).status, 200);
  assert.equal((await photosOf(id, s.token)).length, 1);
});

test('a stranger or a non-image document gets the normal bot flow, not a crash', async () => {
  const before = sent.length;
  assert.equal((await botHook(photoUpdate(7000000399))).status, 200);                 // never started the bot
  assert.equal(sent.slice(before).filter(m => m.chat_id === 7000000399 && m.reply_markup).length, 1);
  const s = await student(7000000306);
  const b2 = sent.length;
  await botHook({ update_id: 1, message: { message_id: 1, from: { id: 7000000306, is_bot: false, first_name: 'Маша' },
    chat: { id: 7000000306, type: 'private' }, document: { file_id: 'D', file_size: 10, mime_type: 'application/pdf' } } });
  assert.equal(sent.slice(b2).filter(m => m.chat_id === 7000000306 && m.reply_markup).length, 1);   // the sign-in link
  assert.equal(said(s.chat, 'Принял фото'), 0);
});
```

- [ ] **Step 3: Run and see them fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/exams.test.mjs`
Expected: the new tests FAIL (the webhook answers every photo with the sign-in link).

- [ ] **Step 4: Implement `botPhoto`**

In `exams.js` extend `TEXT` with:

```js
  botNoExam: "Сейчас нет пробника, к которому можно прикрепить фото.",
  botLate: "Время пробника вышло, фото прикрепить уже нельзя. Если оно нужно, напиши преподавателю: @kirill_math_tutor.",
  botBadFile: "Такой файл я не принимаю. Пришли фото или картинку JPEG, PNG или WebP.",
  botTooMany: "К пробнику уже прикреплено 15 фото — больше нельзя. Лишнее можно удалить на сайте.",
  botFail: "Не получилось забрать фото. Пришли его ещё раз.",
  botOk: (title, k) => "Принял фото к пробнику «" + title + "» (всего " + k + ").",
```

and a constant `const MAX_BOT_PHOTOS = 15;` next to `MAX_PHOTOS`. Add before `module.exports`:

```js
const tgApi = () => env("TG_API") || "https://api.telegram.org";

// A photo, or an image sent as a file, from the student's own Telegram chat goes to the
// exam that started last — no caption, no task. Returns true when handled here, false
// to let the sign-in flow answer.
function botPhoto(msg) {
  const chat = msg.chat.id, t = nowS();
  let profile;
  try { profile = $app.findFirstRecordByData("tg_profiles", "tg_id", String(msg.from.id)); } catch (_) { return false; }
  const user = byId("users", profile.getString("user"));
  if (!user || !user.getBool("active")) return false;
  const say = (text) => tg.send(chat, text);

  // the exam that started last (never one in the future)
  const rows = $app.findRecordsByFilter("exam_assignments", "user = {:u} && start <= {:t}", "-start", 1, 0, { u: user.id, t: t });
  if (!rows.length) { say(TEXT.botNoExam); return true; }
  const a = rows[0], p0 = Core.phase(shape(a), t);
  if (p0 === "missed" || p0 === "scheduled") { say(TEXT.botNoExam); return true; }
  if (p0 !== "open" && p0 !== "photos") { say(TEXT.botLate); return true; }

  const doc = msg.document, f = msg.photo ? msg.photo[msg.photo.length - 1] : doc;
  if (!f || (doc && ["image/jpeg", "image/png", "image/webp"].indexOf(doc.mime_type) < 0) || (f.file_size || 0) > 10485760) {
    say(TEXT.botBadFile); return true;
  }
  if ($app.countRecords("exam_photos", $dbx.exp("assignment = {:a} && n = ''", { a: a.id })) >= MAX_BOT_PHOTOS) { say(TEXT.botTooMany); return true; }

  // remember the album on the fresh row; a closed window is re-checked there
  const group = String(msg.media_group_id || "");
  const plan = mutate(a.id, (r) => {
    const p = Core.phase(shape(r), t);
    if (p !== "open" && p !== "photos") return false;
    const quiet = group !== "" && group === r.getString("tg_group");
    r.set("tg_group", group);
    return { quiet: quiet };
  });
  if (!plan) { say(TEXT.botLate); return true; }

  let saved = false;
  try {
    const info = $http.send({ url: tgApi() + "/bot" + env("TG_BOT_TOKEN") + "/getFile?file_id=" + encodeURIComponent(f.file_id), method: "GET", timeout: 10 });
    const path = info.json && info.json.result && info.json.result.file_path;
    if (!path) throw new Error("no file path");
    const ph = new Record($app.findCollectionByNameOrId("exam_photos"));
    ph.set("user", user.id); ph.set("assignment", a.id); ph.set("n", "");
    ph.set("file", $filesystem.fileFromURL(tgApi() + "/file/bot" + env("TG_BOT_TOKEN") + "/" + path, 30));
    $app.save(ph);
    saved = true;
  } catch (err) { console.log("exams: bot photo failed"); }       // never log the URL or the error text: they can hold the token
  if (!saved) { say(TEXT.botFail); return true; }
  if (!plan.quiet) {
    const exam = $app.findRecordById("exams", a.getString("exam"));
    say(TEXT.botOk(exam.getString("title"), $app.countRecords("exam_photos", $dbx.exp("assignment = {:a} && n = ''", { a: a.id }))));
  }
  return true;
}
```

Add `botPhoto: botPhoto` to `module.exports`.

Notes: if `$dbx.exp` with a literal `''` is not accepted by the hook sandbox, filter in JS instead: `photosOf(a)` filtered by `n === ""` (`photosOf` returns `{id,n,file}`) and count that. If `$filesystem.fileFromURL` does not exist on 0.40.4 (check `types.d.ts`), download with `$http.send` and `$filesystem.fileFromBytes(bytes, "photo.jpg")`; keep the behaviour the tests pin. An album is answered once on its first photo only if the first photo's request wins the album mark; that is what the "quiet" flag does.

- [ ] **Step 5: Hand photo messages to it from the webhook**

In `tg.js` `webhook()`, right after the guard that returns for invalid messages and before `const r = ensure(msg.from);`:

```js
  // photos and images sent as files belong to a running exam, not to the sign-in flow
  if (msg.photo || (msg.document && /^image\//.test(msg.document.mime_type || ""))) {
    if (require(`${__hooks}/exams.js`).botPhoto(msg)) return e.json(200, { ok: true });
  }
```

(`exams.js` requires `tg.js` at its top; this `require` runs at call time, after both modules are loaded, so there is no load-order problem. If goja complains about the cycle, make the `tg` import in `exams.js` lazy: `const tgm = () => require(`${__hooks}/tg.js`)` and call `tgm().send` — change nothing else.)

- [ ] **Step 6: Run the tests**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all pass (the existing 59+ plus the new ones). Run the exams suite at least 5 times in a row to check for flakiness. The existing tests that count `exam_photos` or use `photosOf`-like helpers must still pass; if one compared photo lists exactly, adjust only where bot photos are involved.

- [ ] **Step 7: Commit**

```bash
git add backend/pb_hooks backend/tests/exams.test.mjs
git commit -m "Exams: photos sent to the bot attach to the exam that started last, with no task"
```

---

### Task 3: README rollout and a final check

**Files:**
- Modify: `backend/README.md`

- [ ] **Step 1: Update the README**

In the section "Assigned mock exams" add:

```markdown
### Photos through the bot

A student can send photos of part 2 to the bot instead of attaching them on the site — no
caption, no task number. The bot attaches them to the exam that started last, if it is still
open or within the 10 minutes after it; otherwise it says the time is over. Bot photos have an
empty task (`exam_photos.n = ''`), at most 15 per exam. Handled in `botPhoto()`
(`pb_hooks/exams.js`); the webhook (`tg.js`) hands photo messages there. No change to the
Telegram webhook registration is needed (`message` updates already include photos).

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

Spec amendment 1 coverage: the student sends photos to the bot with no caption; they attach to the exam that started last under the same hard window (Task 2); no task is stored, so `exam_photos.n` becomes optional (Task 1); one answer per album, a 15-photo cap, size and type limits (Task 2); the student can delete a bot photo through the existing site route; the photo-list route for the trainer and the panel (Task 1); no change to the webhook registration (Task 3). Out of scope here: the trainer UI (Plan 2) and the check page (Plan 3).
