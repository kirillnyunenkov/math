# Telegram Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can register for the trainer through a Telegram bot; the trainer is closed behind a sign-in wall; the teacher panel separates the owner's students from channel leads.

**Architecture:** The bot is a PocketBase JS hook (`backend/pb_hooks/`) that receives Telegram webhook calls, creates an ordinary `users` account plus a `links` secret and a `tg_profiles` row, and replies with the same `#/login/<login>.<secret>` link the trainer already understands. The trainer (`index.html`) only gains a wall in `render()`. The panel (`teacher.html`) splits users by `tg_profiles.mine`.

**Tech Stack:** PocketBase 0.40.4 (JSVM hooks, migrations), vanilla JS single-file pages, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-02-telegram-registration-design.md`

## Global Constraints

- Never modify the `users` collection in a migration (it invalidates every session). Verified 2026-10-02: the migration in Task 1 keeps existing sessions valid.
- Never edit an already applied migration; add new files only.
- Secrets (`TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`) never go to the repo, logs or chat. Never log a Telegram API URL (it contains the token).
- PocketBase runs each hook handler in an isolated scope: handlers must `require()` shared code, they cannot see file-level variables.
- Code comments and docs in English; all UI and bot texts in Russian, no emoji.
- Colour rule: accent blue = interface, warm colours = student status. The wall and tabs use only `--accent*`, `--ink*`, `--surface*`, `--line*` tokens.
- `sw.js` `VERSION` must be bumped once (Task 6); before the PR, rebase on fresh `master` and bump again if `master` moved it.
- Deploy to the server and merge to `master` are owner-gated (Task 7). Do not do them inside Tasks 1–6.
- Test commands:
  - `node --test 'tests/*.test.mjs'`
  - `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`

## File Structure

| File | Responsibility |
|---|---|
| `backend/pb_migrations/1790800004_tg_profiles.js` (new) | `tg_profiles` collection, trusted proxy header |
| `backend/pb_hooks/telegram.pb.js` (new) | route registration only |
| `backend/pb_hooks/tg.js` (new) | bot texts, account creation, webhook and leads handlers |
| `backend/tests/telegram.test.mjs` (new) | bot, leads and `tg_profiles` rule tests |
| `backend/deploy/ege-api.service`, `backend/README.md` | hooks dir, env file, runbook |
| `index.html` | wall (`TG_BOT`, `FREE_CHECKS`), sign-in texts, history hardening |
| `teacher.html` | tabs, leads table, promote/demote, scoped data loading |
| `privacy.html` (new), `sw.js` | privacy page, cache mapping, version |

---

### Task 1: `tg_profiles` collection and per-visitor rate limits

**Files:**
- Create: `backend/pb_migrations/1790800004_tg_profiles.js`
- Create: `backend/tests/telegram.test.mjs`

**Interfaces:**
- Produces: collection `tg_profiles` with fields `user` (relation to users, unique), `tg_id` (text digits, unique), `username`, `first_name`, `mine` (bool), `created`. Rules: list/view/update teacher only; create/delete nobody.
- Produces: test helpers in `telegram.test.mjs` — `req(method, path, token, body, headers)`, `login(identity, password, coll)`, `hook(update, secret)`, `sent` (array of bodies the stub Telegram API received), `tok.teacher`, `tok.su`.

- [ ] **Step 1: Write the failing test file**

`backend/tests/telegram.test.mjs`:

```js
// Bot registration tests: a throwaway PocketBase with our migrations and
// hooks, plus a stub standing in for the Telegram Bot API.
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
const PORT = 8098, STUB_PORT = 8099, B = `http://127.0.0.1:${PORT}/api`;
const SECRET = 'whsecret';
let dir, proc, stub;
const sent = [], tok = {};

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
const from = (id, extra = {}) => ({ id, is_bot: false, first_name: 'Маша', username: 'masha_k', ...extra });
const update = (f, chatType = 'private') =>
  ({ update_id: 1, message: { message_id: 1, from: f, chat: { id: f.id, type: chatType }, text: '/start channel' } });
const hook = (upd, secret = SECRET) =>
  req('POST', '/tg/webhook', null, upd, secret == null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret });
// "#/login/<login>.<secret>" from the button of the last message sent to chatId
function linkOf(chatId) {
  const m = [...sent].reverse().find(s => s.chat_id === chatId && s.reply_markup);
  const [, l, s] = m.reply_markup.inline_keyboard[0][0].url.match(/#\/login\/([a-z0-9_-]+)\.([A-Za-z0-9]+)$/);
  return { login: l, secret: s };
}

before(async () => {
  stub = createServer((q, s) => {
    let b = ''; q.on('data', d => b += d);
    q.on('end', () => { sent.push({ path: q.url, ...JSON.parse(b) }); s.end('{"ok":true}'); });
  }).listen(STUB_PORT, '127.0.0.1');
  dir = mkdtempSync(join(tmpdir(), 'pbtg-'));
  const args = ['--dir', join(dir, 'pb_data'), '--migrationsDir', MIG];
  execFileSync(PB, ['migrate', 'up', ...args]);
  execFileSync(PB, ['superuser', 'upsert', 'root@test.local', 'rootpassword123', ...args]);
  proc = spawn(PB, ['serve', '--http', `127.0.0.1:${PORT}`, ...args, '--hooksDir', HOOKS], {
    stdio: 'ignore',
    env: { ...process.env, TG_API: `http://127.0.0.1:${STUB_PORT}`, TG_BOT_TOKEN: 'test', TG_WEBHOOK_SECRET: SECRET },
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

test('tg_profiles cannot be created through the API, even by the teacher', async () => {
  const r = await req('POST', '/collections/tg_profiles/records', tok.teacher, { user: 'x', tg_id: '1' });
  assert.ok([400, 403].includes(r.status), String(r.status));
});

test('rate limits trust the proxy header', async () => {
  const s = await req('GET', '/settings', tok.su);
  assert.deepEqual(s.json.trustedProxy.headers, ['X-Forwarded-For']);
  assert.equal(s.json.trustedProxy.useLeftmostIP, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/telegram.test.mjs`
Expected: both tests FAIL (collection missing -> 404; `trustedProxy.headers` is `[]`). If `pb_hooks` does not exist yet PocketBase still starts.

- [ ] **Step 3: Write the migration**

`backend/pb_migrations/1790800004_tg_profiles.js`:

```js
/// <reference path="../pb_data/types.d.ts" />
// Telegram profiles of people registered through the bot; `mine` marks the
// teacher's own students. Deliberately a separate collection: saving `users`
// would log every student out. Also makes rate limits count per visitor
// instead of treating everyone behind Caddy as one address.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const teacher = '@request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "tg_profiles",
    listRule: teacher, viewRule: teacher, createRule: null, updateRule: teacher, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "tg_id", required: true, max: 20, pattern: "^[0-9]+$" },
      { type: "text", name: "username", max: 64 },
      { type: "text", name: "first_name", max: 80 },
      { type: "bool", name: "mine" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_tgp_user ON tg_profiles (user)",
      "CREATE UNIQUE INDEX idx_tgp_tg ON tg_profiles (tg_id)",
    ],
  }));
  const s = app.settings();
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;
  app.save(s);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("tg_profiles"));
  const s = app.settings();
  s.trustedProxy.headers = [];
  app.save(s);
});
```

- [ ] **Step 4: Run both backend suites**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all PASS (the existing `rules.test.mjs` must stay green).

- [ ] **Step 5: Commit**

```bash
git add backend/pb_migrations/1790800004_tg_profiles.js backend/tests/telegram.test.mjs
git commit -m "Add tg_profiles collection and per-visitor rate limits"
```

---

### Task 2: Bot webhook — registration and sign-in link

**Files:**
- Create: `backend/pb_hooks/telegram.pb.js`
- Create: `backend/pb_hooks/tg.js`
- Modify: `backend/tests/telegram.test.mjs` (append tests)

**Interfaces:**
- Consumes: `tg_profiles`, helpers `hook`, `update`, `from`, `linkOf`, `sent`, `login`, `req`, `tok`.
- Produces: `POST /api/tg/webhook`. `tg.js` exports `{ webhook, leads }` (`leads` is added in Task 3 — export only `webhook` now). Accounts created by the bot have `login = "tg" + <telegram id>`, `role = "student"`, `active = true`.

- [ ] **Step 1: Append failing tests**

Append to `backend/tests/telegram.test.mjs`:

```js
test('webhook rejects calls without the Telegram secret', async () => {
  assert.equal((await hook(update(from(100)), null)).status, 403);
  assert.equal((await hook(update(from(100)), 'wrong')).status, 403);
  assert.equal((await req('GET', '/collections/tg_profiles/records', tok.teacher)).json.totalItems, 0);
  assert.equal(sent.length, 0);
});

test('first message registers the person and sends a working link', async () => {
  assert.equal((await hook(update(from(7123456789)))).status, 200);
  const { login: l, secret } = linkOf(7123456789);
  assert.equal(l, 'tg7123456789');
  const a = await login(l, secret);
  assert.equal(a.record.role, 'student');
  assert.equal(a.record.name, 'Маша');
  tok.lead = a.token; tok.leadId = a.record.id;
  const p = (await req('GET', '/collections/tg_profiles/records', tok.teacher)).json.items;
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].tg_id, p[0].username, p[0].mine, p[0].user], ['7123456789', 'masha_k', false, a.record.id]);
  assert.match(sent.at(-1).text, /privacy\.html/);
  assert.equal(sent.at(-1).path, '/bottest/sendMessage');
});

test('second message returns the same link and creates nothing', async () => {
  const first = linkOf(7123456789);
  await hook(update(from(7123456789, { username: 'masha_new' })));
  assert.deepEqual(linkOf(7123456789), first);
  const p = (await req('GET', '/collections/tg_profiles/records', tok.teacher)).json.items;
  assert.equal(p.length, 1);
  assert.equal(p[0].username, 'masha_new');
  assert.doesNotMatch(sent.at(-1).text, /privacy\.html/);
});

test('long or missing names are stored safely', async () => {
  await hook(update(from(200, { first_name: 'Я'.repeat(200), username: undefined })));
  const a = await login('tg200', linkOf(200).secret);
  assert.equal(a.record.name.length, 80);
  await hook(update({ id: 201, is_bot: false }));
  assert.equal((await login('tg201', linkOf(201).secret)).record.name, 'Ученик');
});

test('group chats, bots and non-message updates are ignored', async () => {
  const n = sent.length;
  assert.equal((await hook(update(from(300), 'group'))).status, 200);
  assert.equal((await hook(update(from(301, { is_bot: true })))).status, 200);
  assert.equal((await hook({ update_id: 5, edited_message: {} })).status, 200);
  assert.equal(sent.length, n);
  const logins = (await req('GET', '/collections/users/records', tok.teacher)).json.items.map(u => u.login);
  assert.ok(!logins.includes('tg300') && !logins.includes('tg301'));
});

test('a disabled account gets no link', async () => {
  await hook(update(from(400)));
  const u = (await req('GET', '/collections/users/records?filter=' + encodeURIComponent('login="tg400"'), tok.teacher)).json.items[0];
  await req('PATCH', `/collections/users/records/${u.id}`, tok.teacher, { active: false });
  await hook(update(from(400)));
  assert.equal(sent.at(-1).chat_id, 400);
  assert.equal(sent.at(-1).reply_markup, undefined);
});

test('a lead sees no profiles and cannot promote themselves', async () => {
  assert.equal((await req('GET', '/collections/tg_profiles/records', tok.lead)).json.totalItems, 0);
  const p = (await req('GET', '/collections/tg_profiles/records', tok.teacher)).json.items.find(x => x.user === tok.leadId);
  assert.ok([403, 404].includes((await req('PATCH', `/collections/tg_profiles/records/${p.id}`, tok.lead, { mine: true })).status));
  assert.equal((await req('PATCH', `/collections/tg_profiles/records/${p.id}`, tok.teacher, { mine: true })).status, 200);
  assert.equal((await req('PATCH', `/collections/tg_profiles/records/${p.id}`, tok.teacher, { mine: false })).status, 200);
  assert.equal((await req('GET', '/collections/users/records', tok.lead)).json.totalItems, 1);
  assert.equal((await req('GET', '/collections/links/records', tok.lead)).json?.totalItems ?? 0, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/telegram.test.mjs`
Expected: the new tests FAIL (webhook route answers 404).

- [ ] **Step 3: Write the hook**

`backend/pb_hooks/telegram.pb.js`:

```js
/// <reference path="../pb_data/types.d.ts" />
// Telegram bot: registration and sign-in links. Logic lives in tg.js because
// PocketBase runs every handler in an isolated scope.
routerAdd("POST", "/api/tg/webhook", (e) => require(`${__hooks}/tg.js`).webhook(e));
```

`backend/pb_hooks/tg.js`:

```js
// Texts the bot sends. Edit here; no other code depends on the wording.
const TEXT = {
  hello: "Привет! Это тренажёр ЕГЭ по математике.\n\nЖми кнопку — откроется тренажёр, прогресс сохранится на всех твоих устройствах. Ссылка личная, никому её не пересылай.\n\nНажимая кнопку, ты соглашаешься с обработкой данных: ",
  again: "Вот твоя ссылка для входа. Прогресс сохранён.",
  off: "Доступ к тренажёру отключён.",
  button: "Открыть тренажёр",
};
const env = (k) => $os.getenv(k);
const site = () => env("SITE_URL") || "https://kirillnyunenkov.github.io/math/";

function send(chatId, text, url) {
  const body = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (url) body.reply_markup = { inline_keyboard: [[{ text: TEXT.button, url: url }]] };
  try {
    $http.send({
      url: (env("TG_API") || "https://api.telegram.org") + "/bot" + env("TG_BOT_TOKEN") + "/sendMessage",
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, timeout: 10,
    });
  } catch (err) { console.log("tg: sendMessage failed"); }   // never log the URL: it holds the token
}

function findProfile(tgId) {
  try { return $app.findFirstRecordByData("tg_profiles", "tg_id", tgId); } catch (_) { return null; }
}

// Returns {profile, created}. One Telegram account = one trainer account.
function ensure(from) {
  const tgId = String(from.id);
  const name = String(from.first_name || "Ученик").slice(0, 80);
  const username = String(from.username || "").slice(0, 64);
  let profile = findProfile(tgId);
  if (profile) {
    if (profile.get("username") !== username || profile.get("first_name") !== name) {
      profile.set("username", username); profile.set("first_name", name); $app.save(profile);
    }
    return { profile: profile, created: false };
  }
  const secret = $security.randomString(32);
  try {
    $app.runInTransaction((tx) => {
      const user = new Record(tx.findCollectionByNameOrId("users"));
      user.set("login", "tg" + tgId); user.set("name", name); user.set("role", "student"); user.set("active", true);
      user.setPassword(secret);
      tx.save(user);
      const link = new Record(tx.findCollectionByNameOrId("links"));
      link.set("user", user.id); link.set("secret", secret);
      tx.save(link);
      const p = new Record(tx.findCollectionByNameOrId("tg_profiles"));
      p.set("user", user.id); p.set("tg_id", tgId); p.set("username", username); p.set("first_name", name); p.set("mine", false);
      tx.save(p);
    });
  } catch (err) {
    // two "Start" taps at once: the unique index rejected the second one
    profile = findProfile(tgId);
    if (!profile) throw err;
    return { profile: profile, created: false };
  }
  return { profile: findProfile(tgId), created: true };
}

function webhook(e) {
  const secret = env("TG_WEBHOOK_SECRET");
  if (!secret || !env("TG_BOT_TOKEN")) return e.json(503, { message: "bot is not configured" });
  if (!$security.equal(e.request.header.get("X-Telegram-Bot-Api-Secret-Token"), secret)) return e.json(403, { message: "forbidden" });
  const msg = (e.requestInfo().body || {}).message;
  if (!msg || !msg.from || msg.from.is_bot || !msg.chat || msg.chat.type !== "private") return e.json(200, { ok: true });
  const r = ensure(msg.from);
  const user = $app.findRecordById("users", r.profile.get("user"));
  if (!user.get("active")) { send(msg.chat.id, TEXT.off); return e.json(200, { ok: true }); }
  const link = $app.findFirstRecordByData("links", "user", user.id);
  const url = site() + "#/login/" + user.get("login") + "." + link.get("secret");
  send(msg.chat.id, r.created ? TEXT.hello + site() + "privacy.html" : TEXT.again, url);
  return e.json(200, { ok: true });
}

module.exports = { webhook: webhook };
```

Note: the name is stored exactly as Telegram sends it (it may contain `<`); every place that renders it must escape it (Tasks 4–5 check this).

- [ ] **Step 4: Run to verify they pass**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/pb_hooks backend/tests/telegram.test.mjs
git commit -m "Add Telegram bot webhook: registration and sign-in link"
```

---

### Task 3: Leads endpoint for the panel

**Files:**
- Modify: `backend/pb_hooks/telegram.pb.js`, `backend/pb_hooks/tg.js`
- Modify: `backend/tests/telegram.test.mjs` (append)

**Interfaces:**
- Produces: `GET /api/ege/leads` (teacher token only, else 403) -> `{ items: [{ id, user, username, mine, created, name, active, marks, last }] }`, newest first. `id` is the `tg_profiles` id, `user` the users id, `marks` = number of non-import mark events, `created`/`last` are `"YYYY-MM-DD HH:MM:SS.mmmZ"` strings (`last` is `""` when there is no activity).

- [ ] **Step 1: Append failing tests**

```js
test('leads list is teacher-only and counts real marks', async () => {
  assert.equal((await req('GET', '/ege/leads')).status, 403);
  assert.equal((await req('GET', '/ege/leads', tok.lead)).status, 403);
  assert.equal((await req('GET', '/ege/leads', tok.su)).status, 403);
  const ev = (uid, source) => ({ user: tok.leadId, uid, ts: 1, kind: 'mark', n: 3, pid: 5, status: 'g', source });
  for (const [uid, src] of [['a', 'check'], ['b', 'manual'], ['c', 'import']])
    assert.equal((await req('POST', '/collections/events/records', tok.lead, ev(uid, src))).status, 200);
  const r = await req('GET', '/ege/leads', tok.teacher);
  assert.equal(r.status, 200);
  const me = r.json.items.find(x => x.user === tok.leadId);
  assert.equal(me.marks, 2);
  assert.equal(me.name, 'Маша');
  assert.equal(me.mine, false);
  assert.equal(me.active, true);
  assert.match(me.last, /^\d{4}-\d\d-\d\d /);
  const idle = r.json.items.find(x => x.name === 'Ученик');
  assert.equal(idle.marks, 0);
  assert.equal(idle.last, '');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/telegram.test.mjs`
Expected: FAIL — `/ege/leads` answers 404.

- [ ] **Step 3: Implement**

Append to `backend/pb_hooks/telegram.pb.js`:

```js
routerAdd("GET", "/api/ege/leads", (e) => require(`${__hooks}/tg.js`).leads(e));
```

In `backend/pb_hooks/tg.js` add before `module.exports` and extend the export:

```js
// Everyone registered through the bot, with a cheap activity summary, so the
// panel does not have to download every lead's journal.
function leads(e) {
  if (!e.auth || e.auth.collection().name !== "users" || e.auth.get("role") !== "teacher") return e.json(403, { message: "forbidden" });
  const rows = arrayOf(new DynamicModel({ id: "", user: "", username: "", mine: false, created: "", name: "", active: false, marks: 0, last: "" }));
  $app.db().newQuery(
    "SELECT p.id, p.user, p.username, p.mine, p.created, u.name, u.active, " +
    "(SELECT COUNT(*) FROM events e WHERE e.user = p.user AND e.kind = 'mark' AND e.source != 'import') AS marks, " +
    "COALESCE((SELECT MAX(e.created) FROM events e WHERE e.user = p.user), '') AS last " +
    "FROM tg_profiles p JOIN users u ON u.id = p.user ORDER BY p.created DESC"
  ).all(rows);
  return e.json(200, { items: rows });
}

module.exports = { webhook: webhook, leads: leads };
```

- [ ] **Step 4: Run to verify it passes**

Run: `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/pb_hooks backend/tests/telegram.test.mjs
git commit -m "Add teacher-only leads endpoint"
```

---

### Task 4: Sign-in wall in the trainer

**Files:**
- Modify: `config.js` (append at the end)
- Modify: `index.html` — CSS near `.help{` (~line 354), account block (~1744–1810), `render()` (~2883), `DOMContentLoaded` (~3433)

**Interfaces:**
- Consumes: globals `auth`, `state`, `setBack`, `statsEl`, `appEl`, `headerEl`, `shareEl`, `resetEl`, `guideEl`, `accountEl`, `installEl`, `burgerEl`, `lastRouteKey`, `scrollTop`.
- Produces: `TG_BOT`, `FREE_CHECKS` (config.js); `markedCount()`, `gated()`, `renderWall()` (index.html).

There is no unit-test harness for `index.html`; verification is in the browser (Step 5).

- [ ] **Step 1: Add config**

(Changed during execution: the two constants go to the top of the wall block in `index.html`, not `config.js` — a cached `config.js` broke the page.) Originally: append to `config.js`:

```js
/* Sign-in wall (see docs/superpowers/specs/2026-10-02-telegram-registration-design.md).
   TG_BOT — the bot's username without "@"; set at deploy, must not stay empty.
   FREE_CHECKS — how many marked tasks a visitor may have before the wall
   appears: 0 = wall at once, 5 = "try five tasks first". */
const TG_BOT = '';
const FREE_CHECKS = 0;
```

- [ ] **Step 2: Add the wall**

In `index.html`, right after the `.help-step` CSS rules add:

```css
  .wall{max-width:560px;margin:0 auto;padding:var(--s12) var(--s6) var(--s16);text-align:center;}
  .wall h2{font-size:var(--fs-3xl);margin-bottom:var(--s3);}
  .wall p{color:var(--ink-2);font-size:var(--fs-md);line-height:1.6;margin:0 0 var(--s6);}
  .wall .wall-go{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 var(--s8);
    border-radius:var(--r-md);background:var(--accent);color:var(--accent-on);font-weight:600;
    font-size:var(--fs-base);text-decoration:none;}
  .wall .wall-go:hover{background:var(--accent-hover);}
  .wall .wall-note{font-size:var(--fs-sm);color:var(--ink-3);margin-top:var(--s5);}
  .wall .wall-note a{color:var(--accent);}
```

Directly above `let variant=null, variantTimerId=null;` add:

```js
/* ---- стена входа ----
   Без входа тренажёр закрыт: вход для всех через Telegram-бота, он присылает
   личную ссылку (#/login/...). FREE_CHECKS>0 пускает попробовать: стена
   встаёт при следующей смене экрана после N отмеченных задач. Это не защита
   содержимого (данные задач лежат в открытых файлах), а точка входа. */
const markedCount=()=>Object.values(state).reduce((s,o)=>s+Object.keys(o||{}).length,0);
const gated=()=>!auth&&markedCount()>=FREE_CHECKS;
function renderWall(){
  setBack(false);statsEl.innerHTML='';headerEl.style.display='';
  [shareEl,resetEl,guideEl,accountEl,burgerEl].forEach(el=>{el.style.display='none';});
  installEl.style.setProperty('display','none','important');
  appEl.innerHTML=`<div class="wall">
    <h2>Тренажёр ЕГЭ по математике</h2>
    <p>Задачи из открытого банка ФИПИ по всем номерам, разборы и пробник с баллами. Войди через Telegram — прогресс сохранится на всех твоих устройствах.</p>
    <a class="wall-go" href="https://t.me/${TG_BOT}?start=site" target="_blank" rel="noopener">Войти через Telegram</a>
    <p class="wall-note">Бот пришлёт личную ссылку для входа. <a href="privacy.html">Какие данные хранятся</a></p>
  </div>`;
}
```

In `render()`, right after the `variantTimerId` line, add:

```js
  if(gated()){if(lastRouteKey!=='wall'){lastRouteKey='wall';scrollTop();}renderWall();return;}
  burgerEl.style.display='';
```

`burgerEl` is declared with `const` further down the script (~line 3414); `render()` first runs on `DOMContentLoaded`, after the whole script has executed, so the reference is safe.

In the `DOMContentLoaded` handler, right after `if(auth)Sync.refreshToken()...;` add:

```js
  /* за стеной ссылку с прогрессом не разбираем: сначала вход */
  if(gated()){render();return;}
```

- [ ] **Step 3: Update texts that mention personal links from the teacher**

In `Sync.expired`, replace the `else note(...)` call text with:

```js
    else note('Нужно войти заново',
      'Напиши боту в Telegram — он пришлёт ссылку для входа. Прогресс на этом устройстве сохранится.');},
```

In `Sync.login`, replace the `r.status!==200` note with:

```js
    if(r.status!==200){note('Ссылка не подошла','Напиши боту в Telegram — он пришлёт актуальную ссылку для входа.');return;}
```

In `accountSheet`, replace the `ih-sub` paragraph text with:
`Прогресс сохраняется на сервере. Чтобы продолжить на другом устройстве, открой там свою ссылку для входа или напиши боту в Telegram.`

and the logout confirmation text with:
`Отметки на этом устройстве останутся. Чтобы вернуться в тренажёр, понадобится снова войти через Telegram.`

Also update the comment at the top of the account block (`Вход только по личной ссылке от преподавателя`) to: `Вход по личной ссылке (#/login/<login>.<secret>), которую присылает Telegram-бот.`

- [ ] **Step 4: Run unit suites (nothing should break)**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 5: Verify in the browser against a local backend**

Start a local backend with the stub (port 8090 is what `index.html` uses on localhost):

```bash
D=$(mktemp -d); A=(--dir $D/pb_data --migrationsDir backend/pb_migrations)
~/.local/pocketbase/pocketbase migrate up $A
TG_API=http://127.0.0.1:8099 TG_BOT_TOKEN=test TG_WEBHOOK_SECRET=s SITE_URL=http://localhost:<preview-port>/ \
  ~/.local/pocketbase/pocketbase serve --http 127.0.0.1:8090 $A --hooksDir backend/pb_hooks --origins 'http://localhost:<preview-port>'
```

(run a one-line node stub on 8099 that prints request bodies, as in `telegram.test.mjs`). Serve the repo with a static dev server via `.claude/launch.json` + `preview_start`. Check, at 375 px and desktop width, light and dark:

1. Fresh profile: any route (`#/`, `#/t/1`, help, variant) shows the wall; header has no burger/share/reset/guide buttons; no console errors.
2. `curl` the webhook with a fake update, take the link from the stub output, open it: trainer opens, "Вход выполнен" note, account button shows the name.
3. Mark a task, reload: still signed in, hub works as before.
4. Account -> "Выйти": wall returns.
5. Temporarily set `FREE_CHECKS = 2` in `config.js`: signed-out visitor can open a task and mark two tasks; going back to the hub then shows the wall; after signing in through a link the two marks are still there. Restore `FREE_CHECKS = 0`.
6. Register a user through the webhook with `first_name` `<img src=x onerror=alert(1)>`, sign in: no alert, the name is shown as text in the header, the greeting note and the account sheet.

Take a screenshot of the wall (phone width) for the owner.

- [ ] **Step 6: Commit**

```bash
git add config.js index.html
git commit -m "Close the trainer behind a Telegram sign-in wall"
```

---

### Task 5: Panel — "Из канала" tab and promote/demote

**Files:**
- Modify: `teacher.html` (CSS block; script from `// ---- данные ----` to the click handler)

**Interfaces:**
- Consumes: `GET /api/ege/leads` item shape from Task 3; `PATCH /collections/tg_profiles/records/<id> {mine}`; `PATCH /collections/users/records/<id> {active}`.
- Produces: routes `#/` (students), `#/leads` (leads), `#/s/<id>` (card, unchanged).

- [ ] **Step 1: Scope data loading to students**

Replace the whole `load()` function with:

```js
/* Student = role "student" with no bot profile (old link accounts) or with a
   profile marked `mine`. Everyone else who came through the bot is a lead:
   only the summary from /ege/leads is loaded for them, never their journals. */
async function load(){
  const [users,links,pr]=await Promise.all([all('users','role="student"'),all('links'),api('/ege/leads')]);
  if(pr.status!==200)throw new Error('leads '+pr.status);
  const profOf={};pr.json.items.forEach(p=>profOf[p.user]=p);
  const students=users.filter(u=>!profOf[u.id]||profOf[u.id].mine);
  const byUser={};
  students.forEach(u=>byUser[u.id]={events:[],variants:[],clears:[]});
  const ids=students.map(u=>u.id),filters=[];
  for(let i=0;i<ids.length;i+=30)filters.push(ids.slice(i,i+30).map(id=>`user="${id}"`).join('||'));
  const own=async c=>(await Promise.all(filters.map(f=>all(c,f)))).flat();
  const [events,variants,clears]=await Promise.all([own('events'),own('variants'),own('variant_clears')]);
  events.forEach(e=>byUser[e.user]&&byUser[e.user].events.push(e));
  variants.forEach(v=>byUser[v.user]&&byUser[v.user].variants.push(v));
  clears.forEach(c=>byUser[c.user]&&byUser[c.user].clears.push(c));
  const linkOf={};links.forEach(l=>linkOf[l.user]=l);
  data={students,leads:pr.json.items.filter(p=>!p.mine),profOf,linkOf,byUser,loaded:Date.now()};
}
```

- [ ] **Step 2: Tabs, leads table, card actions**

CSS, after the `.center{...}` rule:

```css
  .tabs{display:flex;gap:var(--s2);margin-bottom:var(--s5);flex-wrap:wrap;}
  .tabs a{display:inline-flex;align-items:center;gap:var(--s2);min-height:40px;padding:0 var(--s4);
    border:1px solid var(--line-strong);border-radius:var(--r-full);color:var(--ink-2);
    text-decoration:none;font-size:var(--fs-sm);font-weight:600;}
  .tabs a.on{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line);}
  .tabs a span{font-weight:500;color:var(--ink-3);}
  td.acts{text-align:right;white-space:nowrap;}
  td.acts .btn{min-height:32px;padding:0 var(--s3);}
```

Script, above `// ---- список учеников ----`:

```js
const tabs=cur=>`<div class="tabs">
  <a href="#/" class="${cur==='s'?'on':''}">Ученики <span>${data.students.length}</span></a>
  <a href="#/leads" class="${cur==='l'?'on':''}">Из канала <span>${data.leads.length}</span></a></div>`;
/* Telegram usernames are [A-Za-z0-9_]; anything else is shown as plain text. */
const tgLink=un=>/^[A-Za-z0-9_]{1,64}$/.test(un||'')?`<a href="https://t.me/${un}" target="_blank" rel="noopener">@${un}</a>`:'<span class="muted">—</span>';
const pbTime=s=>s?Date.parse(String(s).replace(' ','T')):null;
```

In `renderList()`: put `${tabs('s')}` as the first thing in `app.innerHTML`; delete the `<button class="btn" data-act="add">Добавить ученика</button>` button; replace the empty-state text with
`Учеников пока нет. Открой вкладку «Из канала» и нажми «В мои ученики» у нужного человека.`

Add after `renderList`:

```js
// ---- пришедшие из канала ----
function renderLeads(){
  const rows=data.leads;
  app.innerHTML=`${tabs('l')}
    <p class="lead">Зарегистрировались через бота: ${rows.length}. «В мои ученики» переносит человека в основной список с полной статистикой.</p>
    <div class="panel">
      <div class="toolbar"><div class="grow muted">Обновлено ${fmtDate(data.loaded)}</div>
        <button class="btn quiet" data-act="reload">Обновить</button></div>
      ${rows.length?`<div class="table-wrap"><table>
        <thead><tr><th>Имя</th><th>Telegram</th><th class="hide-m">Регистрация</th><th class="num">Отметок</th><th>Последняя активность</th><th></th></tr></thead>
        <tbody>${rows.map(p=>`<tr class="${p.active?'':'off'}">
          <td><span class="name">${esc(p.name)}</span>${p.active?'':' <span class="chip off">отключён</span>'}</td>
          <td>${tgLink(p.username)}</td>
          <td class="hide-m">${fmtDay(pbTime(p.created))}</td>
          <td class="num">${Number(p.marks)||0}</td>
          <td>${ago(pbTime(p.last))}</td>
          <td class="acts"><button class="btn" data-act="mine" data-id="${esc(p.id)}" data-v="1">В мои ученики</button>
            <button class="btn quiet" data-act="active" data-id="${esc(p.user)}" data-v="${p.active?0:1}">${p.active?'Отключить':'Включить'}</button></td>
        </tr>`).join('')}</tbody></table></div>`
      :'<p class="center muted">Пока никто не зарегистрировался через бота.</p>'}
    </div>`;
}
```

In `renderStudent`, replace the three toolbar buttons with:

```js
      ${data.profOf[id]
        ?`<span class="muted">${tgLink(data.profOf[id].username)}</span>
          <button class="btn quiet" data-act="mine" data-id="${esc(data.profOf[id].id)}" data-v="0">Убрать из учеников</button>`
        :`<button class="btn quiet" data-act="link" data-id="${id}">Ссылка для входа</button>
          <button class="btn quiet" data-act="rotate" data-id="${id}">Новая ссылка</button>`}
      <button class="btn ${u.active===false?'quiet':'danger'}" data-act="active" data-id="${id}" data-v="${u.active===false?1:0}">${u.active===false?'Включить':'Отключить'}</button></div>
```

- [ ] **Step 3: Actions and routing**

Delete `addStudent`, `createStudent` and `toggle`. Add:

```js
async function setMine(pid,on){
  const r=await api('/collections/tg_profiles/records/'+pid,{method:'PATCH',body:{mine:on}});
  if(r.status!==200){sheet(`<h3>Не получилось</h3><p>Сервер ответил ${esc(r.status)}.</p><div class="acts"><button class="btn" data-act="close">Понятно</button></div>`);return;}
  if(!on)location.hash='#/leads';
  await refresh();
}
async function setActive(uid,on){
  await api('/collections/users/records/'+uid,{method:'PATCH',body:{active:on}});
  await refresh();
}
```

`route()` becomes:

```js
function route(){
  const m=location.hash.match(/^#\/s\/([a-z0-9]+)$/);
  if(m)renderStudent(m[1]);else if(location.hash==='#/leads')renderLeads();else renderList();
  window.scrollTo(0,0);
}
```

In the click handler replace the `add`, `create` and `toggle` branches with:

```js
  else if(a==='mine')setMine(id,b.dataset.v==='1');
  else if(a==='active')setActive(id,b.dataset.v==='1');
```

and remove the `Enter` / `new-name` line from the `keydown` handler. `rnd`, `ALNUM`, `rotate`, `rotateGo`, `showLink` stay (old link accounts).

- [ ] **Step 4: Verify in the browser against the local backend from Task 4**

Create a teacher (`backend/deploy/add-user.sh` logic or the superuser API) and three bot users via the webhook, one with `first_name` `<img src=x onerror=alert(1)>` and `username` `a"><script>alert(1)</script>` (send it straight to the webhook; Telegram itself would never allow it). Let one of them post a few events. Then, at 375 px and desktop, light and dark:

1. "Ученики" shows only link-created students; counter in the tab is right.
2. "Из канала" lists the three, newest first; the hostile name renders as text, the hostile username renders as "—", no alert, no console errors.
3. "В мои ученики" moves the person to "Ученики"; the card opens with full stats, shows `@username` and "Убрать из учеников" instead of the link buttons; "Убрать из учеников" returns them to "Из канала".
4. "Отключить" on a lead: row greys out; the webhook now answers that person with the "отключён" text and no button.
5. Network tab: opening "Ученики" requests `events` with a `user="…"` filter only for students (no unfiltered `events` request).

Screenshot both tabs for the owner.

- [ ] **Step 5: Commit**

```bash
git add teacher.html
git commit -m "Panel: channel leads tab, promote to students, scoped data loading"
```

---

### Task 6: Hardening of untrusted history data, privacy page, service worker

**Files:**
- Modify: `index.html` (`histEncode` ~2342, `histCells` ~2379, `toggleHistRow` ~2417)
- Create: `privacy.html`
- Modify: `sw.js`, `backend/deploy/ege-api.service`, `backend/README.md`

**Interfaces:**
- Produces: `qRows(r)` in `index.html` — returns `[[n, id, pts, given], ...]` with `n`, `id`, `pts` coerced to numbers and `given` to a string, whatever shape `r.q` has.

Background: `variants.q` is free-form JSON written by any registered user and synced back into the trainer's local history. `toggleHistRow` interpolates `n`, `id` and `pts` into HTML unescaped. If the teacher ever opens a user's sign-in link in the browser that holds the teacher session, a crafted `q` would run script on the same origin and could read the teacher token. All other user-controlled values were checked on 2026-10-02: `users.name` (escaped in `index.html` via `escapeHtml`/`textContent` and in `teacher.html` via `esc`), `events.given` (`esc`), numeric fields of `events`/`variants` (typed as numbers by the PocketBase schema).

- [ ] **Step 1: Reproduce**

With the local setup from Task 4, signed in as a bot user, run in the page console:

```js
localStorage.setItem('ege_hist_probe','1');
const h=loadHistory();h.push({uid:'x1',t:Date.now(),p:1,s:5,ms:60000,total:12,m:12,
  q:[['1<img src=x onerror="document.title=\'XSS\'">',1,'<b>9</b>','5']]});saveHistory(h);location.reload();
```

Open the variant screen, expand the new history row. Expected before the fix: the tab title becomes `XSS`.

- [ ] **Step 2: Add `qRows` and use it**

Above `function histCells` add:

```js
/* q приходит и с сервера (variants.q — произвольный JSON от любого
   зарегистрированного пользователя), поэтому перед выводом приводим его
   к числам и строке: в разметку не должно попасть ничего, кроме них. */
function qRows(r){return (Array.isArray(r&&r.q)?r.q:[]).filter(Array.isArray)
  .map(x=>[+x[0]||0,+x[1]||0,+x[2]||0,x[3]==null?'':String(x[3])]);}
```

Replace the three raw iterations:
- in the history encoder: `const q=(r.q||[]).slice(0,63);` -> `const q=qRows(r).slice(0,63);`
- in `histCells`: `(r.q||[]).forEach(` -> `qRows(r).forEach(`
- in `toggleHistRow`: `const q=qRows(r);` after the `if(!det||!r||!r.q)return;` line, then use `q.map(x=>x[0])` in the `ensureAll` call and `q.slice().sort(...)` instead of `r.q.slice().sort(...)`.

Run `grep -n "r\.q\b\|h\.q\b" index.html` and confirm the remaining uses are only truthiness checks (`h.q?`, `r.q&&`), not iteration or interpolation.

- [ ] **Step 3: Verify the fix**

Repeat Step 1's reproduction (new `uid`). Expected: title unchanged, the row shows `0`/plain numbers, no console errors; a normal mock exam still shows its details correctly. Remove the probe rows with "очистить".

- [ ] **Step 4: Privacy page**

Find the owner's Telegram contact already used in the trainer: `grep -n "t\.me/" index.html` and reuse that exact href below (do not invent a contact).

`privacy.html`:

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Какие данные хранит тренажёр</title>
<style>
  body{font-family:'Golos Text',system-ui,sans-serif;max-width:680px;margin:0 auto;padding:32px 20px 64px;
    line-height:1.6;color:#22211d;background:#f2efe7;}
  h1{font-size:28px;line-height:1.25;margin:0 0 16px;}
  h2{font-size:19px;margin:28px 0 8px;}
  a{color:#1d4e89;}
  @media (prefers-color-scheme:dark){body{color:#ece9e1;background:#161713;}a{color:#7fb2ea;}}
</style>
</head>
<body>
<h1>Какие данные хранит тренажёр</h1>
<p>Тренажёр ЕГЭ по математике ведёт Кирилл, преподаватель математики. Вход выполняется через Telegram-бота.</p>
<h2>Что сохраняется</h2>
<p>Когда ты нажимаешь «Старт» в боте, сохраняются: номер твоего аккаунта Telegram, имя и ник (если он есть). Телефон, почта и переписка не запрашиваются и не сохраняются.</p>
<p>Во время занятий сохраняется прогресс: какие задачи отмечены, какие ответы введены, результаты пробников.</p>
<h2>Зачем</h2>
<p>Чтобы прогресс был один на всех твоих устройствах и чтобы преподаватель мог связаться с тобой в Telegram.</p>
<h2>Кто видит</h2>
<p>Только преподаватель. Данные не передаются третьим лицам и не публикуются.</p>
<h2>Как удалить</h2>
<p>Напиши преподавателю в Telegram: <a href="OWNER_TG_HREF">написать</a>. Аккаунт и весь прогресс будут удалены.</p>
<p><a href="./">Вернуться в тренажёр</a></p>
</body>
</html>
```

Replace `OWNER_TG_HREF` with the href found by the grep. The wording is a draft: the owner approves it in Task 7.

- [ ] **Step 5: Service worker**

In `sw.js`: bump `VERSION` (`v80` -> `v81`, or one above whatever `master` has after rebasing), add `'./privacy.html'` to `SHELL`, and replace the page mapping line so the privacy page does not overwrite the trainer's offline copy:

```js
    const page = url.pathname.endsWith('/teacher.html') ? './teacher.html'
      : url.pathname.endsWith('/privacy.html') ? './privacy.html' : './index.html';
```

- [ ] **Step 6: Deploy files and docs**

`backend/deploy/ege-api.service`: add under `[Service]`

```
EnvironmentFile=/etc/ege-api.env
```

and append ` --hooksDir /opt/ege-api/pb_hooks` to `ExecStart` (before `--origins`).

`backend/README.md`: add rows to the layout table (`/opt/ege-api/pb_hooks/` — copy of `backend/pb_hooks/`; `/etc/ege-api.env` — `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, root-only), add them to the "Secrets live only in…" sentence, and add a section:

```markdown
## Telegram bot

Registration and sign-in go through a bot implemented in `pb_hooks/tg.js`
(texts are at the top of that file). Telegram calls
`POST /api/tg/webhook`; the call is accepted only with the header
`X-Telegram-Bot-Api-Secret-Token` equal to `TG_WEBHOOK_SECRET`.

Register the webhook once (run on the server; prints only Telegram's answer):

    set -a; . /etc/ege-api.env; set +a
    curl -s "https://api.telegram.org/bot$TG_BOT_TOKEN/setWebhook" \
      -d url=https://api.kirillnyun.space/api/tg/webhook \
      -d secret_token="$TG_WEBHOOK_SECRET" -d 'allowed_updates=["message"]'

A hook change needs the files copied to `/opt/ege-api/pb_hooks/` and
`systemctl restart ege-api`.
```

- [ ] **Step 7: Run everything**

Run: `node --test 'tests/*.test.mjs'`, `PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'`, `node tools/check_solutions.mjs`
Expected: all PASS / 0 errors. In the browser: `privacy.html` opens, then `./` still opens the trainer (wall), also after an offline reload.

- [ ] **Step 8: Commit**

```bash
git add index.html privacy.html sw.js backend/deploy/ege-api.service backend/README.md
git commit -m "Harden mock-exam history rendering; privacy page; sw v81; bot deploy docs"
```

---

### Task 7: Release (every step needs the owner's explicit go-ahead)

This task changes production. Do nothing here without the owner saying yes to that step in chat.

- [ ] **Step 1: Owner approvals.** Show the owner the bot texts (`TEXT` in `tg.js`), the wall text and `privacy.html`; apply their edits, re-run tests, commit.
- [ ] **Step 2: Bot.** The owner creates the bot in BotFather and tells the bot's username (not the token). Set `TG_BOT` in `index.html`; `grep -n "TG_BOT=''" index.html` must print nothing. Commit.
- [ ] **Step 3: Secrets on the server (owner runs it; the token must not appear in chat).** Give the owner this command to run over SSH as root:

```bash
umask 077; printf 'TG_BOT_TOKEN=%s\nTG_WEBHOOK_SECRET=%s\n' "$(read -rsp 'Bot token: ' t; echo "$t")" "$(openssl rand -hex 24)" > /etc/ege-api.env; echo; echo saved
```

- [ ] **Step 4: Read live state (needs SSH approval).** Confirm the live migrations match the repo, check the current `trustedProxy` setting and that Caddy passes `X-Forwarded-For` (default for `reverse_proxy`).
- [ ] **Step 5: Backend deploy.** Back up: `systemctl start ege-api-backup.service` and confirm a fresh `.tgz` in `/opt/ege-api/backups/`. Copy `backend/pb_migrations/1790800004_tg_profiles.js` to `/opt/ege-api/pb_migrations/`, `backend/pb_hooks/*` to `/opt/ege-api/pb_hooks/` (owner `egeapi`), install the new unit file, `systemctl daemon-reload && systemctl restart ege-api`. Verify: `curl -s https://api.kirillnyun.space/api/health` is ok; `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.kirillnyun.space/api/tg/webhook` prints `403`; the Avito CRM still answers. Register the webhook (README command) and check `getWebhookInfo` shows no errors.
- [ ] **Step 6: Bot smoke test before the wall goes live.** The owner presses "Start" in the bot. The link opens the still-open trainer signed in; the person appears in the panel only after Step 7 (the old panel ignores profiles) — that is expected.
- [ ] **Step 7: Site deploy.** `git fetch origin && git rebase origin/master`, bump `sw.js` `VERSION` above master's if needed, run all tests, push, `gh pr create --base master`. After the owner merges: `curl -s https://kirillnyunenkov.github.io/math/sw.js | grep VERSION`, then the real flow end to end on a phone: wall -> bot -> link -> trainer; panel shows the person under "Из канала"; "В мои ученики" works.
- [ ] **Step 8: Memory.** Update `backend_decisions.md`, `project_overview.md`, `telegram_registration.md`, `teacher_account_security.md` (closed items) in the memory directory.
