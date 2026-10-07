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
// Stub controls: `slow[chat]` delays the answer (ms); a chat in `down` gets 403
// (a person who blocked the bot) and its message lands in `refused`, not `sent`.
const slow = {}, down = new Set(), refused = [];
const nowS = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Polls until fn() is true (the in-server cron may still be inside a send).
async function until(fn, ms = 5000) {
  for (const t0 = Date.now(); !fn() && Date.now() - t0 < ms;) await sleep(50);
}

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
async function mkExam(title = 'Пробник 1', tasks = TASKS) {
  const r = await req('POST', '/collections/exams/records', tok.teacher, { title, full: false, tasks, key: KEY });
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
    q.on('end', () => {
      if (q.method === 'GET' && q.url.includes('/getFile')) {             // getFile: where the bytes are
        if (q.url.includes('file_id=BAD')) { s.setHeader('content-type', 'application/json'); return s.end('{"ok":false}'); }
        s.setHeader('content-type', 'application/json');
        return s.end(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } }));
      }
      if (q.method === 'GET' && q.url.includes('/file/bot')) {            // the bytes themselves
        s.setHeader('content-type', 'image/png');
        return s.end(PNG);
      }
      const m = { path: q.url, ...JSON.parse(b) }, chat = String(m.chat_id);
      if (down.has(chat)) { refused.push(m); s.statusCode = 403; s.end('{"ok":false}'); return; }
      setTimeout(() => { sent.push(m); s.end('{"ok":true}'); }, slow[chat] || 0);
    });
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
  // The auth rate limit (10/min per address) is meant for the real server; this suite logs in many students.
  const st = await req('PATCH', '/settings', tok.su, { rateLimits: { enabled: false } });
  assert.equal(st.status, 200, JSON.stringify(st.json));
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

const view = (id, token) => req('GET', `/ege/exams/${id}`, token);

test('before the start the student sees the time and nothing else', async () => {
  const exam = await mkExam('Пробник А'), s = await student(7000000020), other = await student(7000000021);
  const start = nowS() + 7200;
  const id = (await assign(s.id, exam, start)).json.id;
  const mine = await req('GET', '/ege/exams/mine', s.token);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.items, [{ id, title: 'Пробник А', full: false, start, duration: 600, phase: 'scheduled', via_tg: false, until: start }]);
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

test('without a part 2 there is no photo phase: finishing hands the work in at once', async () => {
  const exam = await mkExam('Короткий', TASKS.slice(0, 2)), s = await student(7000000090);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  await post(id, 'answers', s.token, { answers: { 1: '5', 2: '0,5' } });   // both right: its message to the teacher differs from the other tests'
  assert.equal((await post(id, 'finish', s.token)).status, 200);
  const v = await view(id, s.token);
  assert.equal(v.json.phase, 'submitted');
  assert.equal(v.json.p1, 2);
});

test('the photo phase says whether the student finished early and whether there is a part 2', async () => {
  const early = await started(7000000091);
  await post(early.id, 'finish', early.s.token);
  const e = (await view(early.id, early.s.token)).json;
  assert.equal(e.phase, 'photos'); assert.equal(e.early, true); assert.equal(e.nolong, false);
  const late = await started(7000000092);
  await shift(late.id, { start: nowS() - 700, duration: 650 });                    // the window ended 50 s ago, never finished
  const l = (await view(late.id, late.s.token)).json;
  assert.equal(l.phase, 'photos'); assert.equal(l.early, false);
  const open = await started(7000000093);
  assert.equal((await view(open.id, open.s.token)).json.early, undefined);        // other phases carry neither flag
});

test('an exam that was never opened cannot be finished', async () => {
  const exam = await mkExam(), s = await student(7000000036);
  const id = (await assign(s.id, exam, nowS() - 10)).json.id;
  assert.equal((await post(id, 'finish', s.token)).status, 409);
});

test('rejected writes leave no handler error behind', async () => {
  const { id, s } = await started(7000000037);
  const other = await student(7000000038);
  const rejected = async () => {
    for (const what of ['answers', 'away', 'finish', 'done', 'via-tg']) {
      const body = { answers: { 1: '5' }, n: 1, sec: 5, on: true };
      assert.equal((await post(id, what, null, body)).status, 403, what);
      assert.equal((await post(id, what, other.token, body)).status, 404, what);
    }
  };
  await rejected();
  // wrong phase: 'done' before the photo phase; writes to part 1 after the window; via-tg and done once it is over
  assert.equal((await post(id, 'done', s.token)).status, 409);
  await shift(id, { start: nowS() - 700, duration: 600 });
  for (const what of ['answers', 'away', 'finish']) {
    assert.equal((await post(id, what, s.token, { answers: { 1: '6' }, n: 1, sec: 5, on: true })).status, 409, what);
  }
  await shift(id, { start: nowS() - 1300, duration: 600 });
  assert.equal((await post(id, 'done', s.token)).status, 409);
  assert.equal((await post(id, 'via-tg', s.token, { on: true })).status, 409);
  // request logs are written in batches a few seconds after the request: wait for all 16 of ours
  const q = '/logs?perPage=200&filter=' + encodeURIComponent(`data.url ~ "/ege/exams/${id}/"`);
  let logs;
  for (let i = 0; i < 40; i++) {
    logs = await req('GET', q, tok.su);
    if (logs.status === 200 && logs.json.items.length >= 16) break;
    await new Promise(r => setTimeout(r, 500));
  }
  assert.equal(logs.json.items.length, 16, 'request logs for all rejected calls');
  const bad = logs.json.items.filter(l => l.level >= 4 || (l.data && l.data.error));
  assert.deepEqual(bad.map(l => l.data), []);
  assert.deepEqual((await rowOf(id)).log, null);                  // nothing was written either
});

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
  assert.ok(msgs[0].text.includes('фото — 1'));
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

test('a tick a moment before the start waits for it and sends the opening message at once', async () => {
  const exam = await mkExam('Пробник Ж'), s = await student(7000000099);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  const start = nowS() + 3;
  await shift(id, { start });
  await tick();                                            // returns only after the start
  assert.ok(nowS() >= start);
  await until(() => said(s.chat, '«Пробник Ж» открыт') > 0);
  assert.equal(said(s.chat, '«Пробник Ж» открыт'), 1);
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

// ---- Concurrency: every write re-reads the row; no bot call holds it ----

test('a slow bot message does not undo what the student did meanwhile', async () => {
  const exam = await mkExam('Пробник Г'), s = await student(7000000050);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  slow[String(s.chat)] = 2000;
  try {
    await shift(id, { start: nowS() - 5, m_hour: nowS() });
    const tk = tick();                                   // sends "открыт", which takes 2 s
    await sleep(300);
    const tk2 = tick();                                  // an overlapping run must not send it again
    await sleep(200);
    const t0 = Date.now();
    assert.equal((await view(id, s.token)).json.phase, 'open');
    assert.equal((await post(id, 'answers', s.token, { answers: { 1: '5' } })).status, 200);
    assert.ok(Date.now() - t0 < 1500, 'the student waited for the bot');
    await Promise.all([tk, tk2]);
  } finally { delete slow[String(s.chat)]; }
  const row = await rowOf(id);
  assert.ok(row.opened > 0, 'opened survives');
  assert.deepEqual(row.answers, { 1: '5' });
  assert.deepEqual((row.log || []).map(x => x.slice(1)), [['a', '1', '5']]);
  assert.ok(row.m_open > 0);
  assert.equal((await view(id, s.token)).json.phase, 'open');
  await until(() => said(s.chat, '«Пробник Г» открыт') >= 1);
  assert.equal(said(s.chat, '«Пробник Г» открыт'), 1);
});

// Statements of about 3 MB make every request that reads the exam slow, which
// widens the gap between reading the row and saving it.
async function bigExam(title) {
  const tasks = TASKS.map(x => ({ ...x }));
  tasks[2].cond = '<p>' + 'x'.repeat(3000000) + '</p>';
  const r = await req('POST', '/collections/exams/records', tok.teacher, { title, full: false, tasks, key: KEY });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.id;
}

test('an autosave and an away report sent together both survive', async () => {
  const exam = await bigExam('Пробник Б1'), s = await student(7000000051);
  const id = (await assign(s.id, exam, nowS() - 10)).json.id;
  await view(id, s.token);
  for (let i = 0; i < 6; i++) {
    const [a, w] = await Promise.all([
      post(id, 'answers', s.token, { answers: { 1: String(i) } }),
      post(id, 'away', s.token, { n: 1, sec: i + 1 }),
    ]);
    assert.equal(a.status, 200); assert.equal(w.status, 200);
  }
  const row = await rowOf(id);
  assert.deepEqual(row.answers, { 1: '5' });
  assert.deepEqual(row.log.filter(x => x[1] === 'a').map(x => x[3]), ['0', '1', '2', '3', '4', '5']);
  assert.deepEqual(row.log.filter(x => x[1] === 'w').map(x => x[3]), [1, 2, 3, 4, 5, 6]);
});

test('an autosave and "finish" sent together: neither is lost', async () => {
  const exam = await bigExam('Пробник Б2');
  for (let i = 0; i < 4; i++) {
    const s = await student(7000000052 + i);
    const id = (await assign(s.id, exam, nowS() - 10)).json.id;
    await view(id, s.token);
    const [a, f] = await Promise.all([post(id, 'answers', s.token, { answers: { 1: '7' } }), post(id, 'finish', s.token)]);
    assert.equal(f.status, 200);
    const row = await rowOf(id);
    assert.ok(row.finished > 0, 'finished survives, round ' + i);
    if (a.status === 200) assert.deepEqual(row.answers, { 1: '7' }, 'answer survives, round ' + i);
    else assert.equal(a.status, 409);                  // finish came first: the answer was refused, not lost
  }
});

test('requests that settle the same work together tell the teacher once', async () => {
  const { id, s } = await started(7000000056);
  await post(id, 'answers', s.token, { answers: { 1: '5' } });
  await shift(id, { start: nowS() - 1300, duration: 600 });   // photo grace is over
  await Promise.all([view(id, s.token), view(id, s.token), view(id, s.token),
    req('GET', '/ege/exams/mine', s.token), tick(), tick()]);
  const row = await rowOf(id);
  assert.ok(row.settled > 0); assert.equal(row.p1, 1);
  await sleep(300);
  assert.equal(sent.filter(m => String(m.chat_id) === TEACHER_CHAT && m.reply_markup
    && m.reply_markup.inline_keyboard[0][0].url.endsWith('#/check/' + id)).length, 1);
});

// ---- Bot messages Telegram refused are sent again by the tick ----

test('the teacher\'s "сдал" message is retried after a refusal, and delivered once', async () => {
  const exam = await mkExam('Пробник Д'), s = await student(7000000057);
  const id = (await assign(s.id, exam, nowS() - 10)).json.id;
  await view(id, s.token);
  await post(id, 'answers', s.token, { answers: { 1: '5' } });
  await post(id, 'finish', s.token);
  const text = 'сдал(а) пробник «Пробник Д»';
  down.add(TEACHER_CHAT);
  try {
    assert.equal((await post(id, 'done', s.token)).status, 200);
    await tick();
    const row = await rowOf(id);
    assert.ok(row.settled > 0);
    assert.equal(row.m_done, 0);
    assert.ok(refused.some(m => m.text.includes(text)));
    assert.equal(said(TEACHER_CHAT, text), 0);
  } finally { down.delete(TEACHER_CHAT); }
  await tick();
  await until(() => said(TEACHER_CHAT, text) >= 1);
  assert.equal(said(TEACHER_CHAT, text), 1);
  assert.ok((await rowOf(id)).m_done > 0);
  await tick();
  assert.equal(said(TEACHER_CHAT, text), 1);
});

test('the student\'s "проверен" message is retried after a refusal, and delivered once', async () => {
  const exam = await mkExam('Пробник П'), s = await student(7000000058);
  const id = (await assign(s.id, exam, nowS() - 10)).json.id;
  await view(id, s.token);
  await post(id, 'finish', s.token); await post(id, 'done', s.token);
  const text = '«Пробник П» проверен';
  down.add(String(s.chat));
  try {
    assert.equal((await post(id, 'check', tok.teacher, { part2: { 13: { pts: 2 } } })).status, 200);
    await tick();
    assert.equal((await rowOf(id)).m_checked, 0);
    assert.ok(refused.some(m => m.text.includes(text)));
    assert.equal(said(s.chat, text), 0);
  } finally { down.delete(String(s.chat)); }
  await tick();
  await until(() => said(s.chat, text) >= 1);
  assert.equal(said(s.chat, text), 1);
  assert.ok(sent.some(m => m.text.includes(text + ': 2 из 4')));
  assert.ok((await rowOf(id)).m_checked > 0);
  await tick();
  assert.equal(said(s.chat, text), 1);
});

test('the hour and opening messages are retried after a refusal, and delivered once', async () => {
  const exam = await mkExam('Пробник Р'), s = await student(7000000059);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  const chat = String(s.chat);
  down.add(chat);
  try {
    await shift(id, { start: nowS() + 1800 });
    await tick();
    assert.equal((await rowOf(id)).m_hour, 0);
  } finally { down.delete(chat); }
  await tick();
  await until(() => said(chat, 'Через час пробник «Пробник Р»') >= 1);
  assert.equal(said(chat, 'Через час пробник «Пробник Р»'), 1);
  assert.ok((await rowOf(id)).m_hour > 0);

  down.add(chat);
  try {
    await shift(id, { start: nowS() - 5 });
    await tick();
    assert.equal((await rowOf(id)).m_open, 0);
  } finally { down.delete(chat); }
  await tick();
  await until(() => said(chat, '«Пробник Р» открыт') >= 1);
  assert.equal(said(chat, '«Пробник Р» открыт'), 1);
  assert.ok((await rowOf(id)).m_open > 0);
  await tick();
  assert.equal(said(chat, '«Пробник Р» открыт'), 1);
});

test('no opening message to a student who already opened it, or a quarter of an hour late', async () => {
  const exam = await mkExam('Пробник О1'), s = await student(7000000060);
  const id = (await assign(s.id, exam, nowS() + 7200)).json.id;
  await shift(id, { start: nowS() - 10, opened: nowS() - 5 });   // in one write: the cron cannot slip in between
  await tick();
  assert.ok((await rowOf(id)).m_open > 0);
  const late = await mkExam('Пробник О2');
  const id2 = (await assign(s.id, late, nowS() + 7200, 3600)).json.id;
  await shift(id2, { start: nowS() - 1000 });                    // nobody opened it, 16 min in
  await tick();
  assert.ok((await rowOf(id2)).m_open > 0);
  await sleep(300);
  assert.equal(said(s.chat, '«Пробник О1» открыт'), 0);
  assert.equal(said(s.chat, '«Пробник О2» открыт'), 0);
});

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

const photoUpdate = (tgId, o = {}) => ({ update_id: 1, message: {
  message_id: 1, from: { id: tgId, is_bot: false, first_name: 'Маша' }, chat: { id: tgId, type: 'private' },
  media_group_id: o.group,
  ...(o.doc ? { document: { file_id: 'F1', file_size: o.size || 1000, mime_type: o.doc } }
            : { photo: [{ file_id: 'S', file_size: 10 }, { file_id: o.fileId || 'L', file_size: 1000 }] }) } });
const botHook = (upd) => req('POST', '/tg/webhook', null, upd, { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
const photosOf = async (id, token) => (await req('GET', `/ege/exams/${id}/photos`, token)).json.photos;
async function running(tgId, title = 'Пробник Ф') {
  const exam = await mkExam(title), s = await student(tgId);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  return { exam, s, id };
}

test('a photo sent to the bot lands on the exam, with no task, and the sign-in link is not sent', async () => {
  const { s, id } = await running(7000000300);
  const before = sent.length;
  assert.equal((await botHook(photoUpdate(7000000300))).status, 200);
  const ph = await photosOf(id, s.token);
  assert.equal(ph.length, 1); assert.equal(ph[0].n, '');
  assert.equal(said(s.chat, 'Принял фото к пробнику «Пробник Ф» (всего 1)'), 1);
  assert.equal(sent.slice(before).filter(m => m.chat_id === 7000000300 && m.reply_markup).length, 0);
});

test('an album is answered once; the next photo counts on', async () => {
  const { s, id } = await running(7000000301);
  await botHook(photoUpdate(7000000301, { group: 'g1' }));
  await botHook(photoUpdate(7000000301, { group: 'g1' }));
  await botHook(photoUpdate(7000000301, { group: 'g1' }));
  assert.equal((await photosOf(id, s.token)).length, 3);
  assert.equal(said(s.chat, 'Принял фото к пробнику'), 1);
  assert.equal(said(s.chat, 'всего'), 0);                                            // an album reply states no number
  assert.equal(said(s.chat, 'Все присланные фото видны в тренажёре'), 1);
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

test('no assignment at all: the sign-in flow answers; only a future one: a polite refusal', async () => {
  const s = await student(7000000303);
  const before = sent.length;
  await botHook(photoUpdate(7000000303));
  assert.equal(said(s.chat, 'Сейчас нет пробника'), 0);
  assert.equal(sent.slice(before).filter(m => m.chat_id === 7000000303 && m.reply_markup).length, 1);
  const exam = await mkExam();
  await assign(s.id, exam, nowS() + 7200);
  await botHook(photoUpdate(7000000303));
  assert.equal(said(s.chat, 'Сейчас нет пробника'), 1);
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

test('an album sent after the window closed is refused once, nothing stored', async () => {
  const { s, id } = await running(7000000310);
  await shift(id, { start: nowS() - 1300, duration: 600 });                          // grace is over
  for (let i = 0; i < 3; i++) await botHook(photoUpdate(7000000310, { group: 'late' }));
  assert.equal(said(s.chat, 'Время пробника вышло'), 1);
  assert.equal((await photosOf(id, s.token)).length, 0);
});

test('an album over the cap is refused once, the count stays 15', async () => {
  const { s, id } = await running(7000000311);
  for (let i = 0; i < 15; i++) await botHook(photoUpdate(7000000311));
  for (let i = 0; i < 3; i++) await botHook(photoUpdate(7000000311, { group: 'full' }));
  assert.equal((await photosOf(id, s.token)).length, 15);
  assert.equal(said(s.chat, 'уже прикреплено 15 фото'), 1);
});

test('a failed download does not silence the rest of the album', async () => {
  const { s, id } = await running(7000000312);
  await botHook(photoUpdate(7000000312, { group: 'bad', fileId: 'BAD' }));
  assert.equal(said(s.chat, 'Не получилось забрать фото'), 1);
  assert.equal((await photosOf(id, s.token)).length, 0);
  await botHook(photoUpdate(7000000312, { group: 'bad' }));
  assert.equal((await photosOf(id, s.token)).length, 1);
  assert.equal(said(s.chat, 'Принял фото к пробнику'), 1);
});

test('album parts arriving in parallel cannot push the exam over fifteen photos', async () => {
  const { s, id } = await running(7000000313);
  for (let i = 0; i < 10; i++) await botHook(photoUpdate(7000000313));
  await Promise.all(Array.from({ length: 8 }, () => botHook(photoUpdate(7000000313, { group: 'par' }))));
  assert.equal((await photosOf(id, s.token)).length, 15);
  assert.ok(said(s.chat, 'уже прикреплено 15 фото') <= 1);
});

test('a photo for an exam never opened on the site is refused until it is opened', async () => {
  const exam = await mkExam(), s = await student(7000000320);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;                  // inside its window, never viewed
  for (let i = 0; i < 2; i++) await botHook(photoUpdate(7000000320, { group: 'no' }));
  assert.equal(said(s.chat, 'Сначала открой пробник в тренажёре'), 1);              // album: once
  assert.equal((await rowOf(id)).opened, 0);
  await view(id, s.token);
  assert.equal((await photosOf(id, s.token)).length, 0);
  await botHook(photoUpdate(7000000320));
  assert.equal((await photosOf(id, s.token)).length, 1);
});

test('a disabled student gets the normal "access off" text and nothing is stored', async () => {
  const { s, id } = await running(7000000321);
  const r = await req('PATCH', `/collections/users/records/${s.id}`, tok.su, { active: false });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await botHook(photoUpdate(7000000321));
  assert.equal(said(s.chat, 'Доступ к тренажёру отключён'), 1);
  assert.equal(said(s.chat, 'Принял фото'), 0);
  const ph = await req('GET', `/collections/exam_photos/records?filter=${encodeURIComponent(`assignment = "${id}"`)}`, tok.su);
  assert.equal(ph.json.totalItems, 0);
});

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

// ---- the teacher's photos for the comment of a task ----
const fileStatus = async (token, id, file, coll = 'exam_feedback_photos') => {
  const ft = (await req('POST', '/files/token', token)).json.token;
  return (await fetch(`${B}/files/${coll}/${id}/${file}?token=${encodeURIComponent(ft)}`)).status;
};

test('teacher photos: only the teacher adds them, to a long task, once the work is submitted', async () => {
  const { id, s } = await started(7000000100);
  assert.equal((await upload(id, tok.teacher, 13)).status, 409);                 // not submitted yet
  await post(id, 'answers', s.token, { answers: { 1: '5' } });
  await post(id, 'finish', s.token); await post(id, 'done', s.token);
  assert.equal((await upload(id, tok.teacher, 1)).status, 400);                  // a short task takes no photo
  assert.equal((await upload(id, tok.teacher, 99)).status, 400);
  const ok = await upload(id, tok.teacher, 13);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.n, '13');
  for (let i = 0; i < 4; i++) assert.equal((await upload(id, tok.teacher, 13)).status, 200);
  assert.equal((await upload(id, tok.teacher, 13)).status, 400);                 // five per task
});

test('teacher photos stay hidden from the student until the check, then show up in the view and can be fetched', async () => {
  const { id, s } = await started(7000000101);
  await post(id, 'answers', s.token, { answers: { 1: '5' } });
  await post(id, 'finish', s.token); await post(id, 'done', s.token);
  const up = (await upload(id, tok.teacher, 13)).json;
  assert.equal((await view(id, s.token)).json.fb, undefined);                    // submitted: not in the view
  const list = await req('GET', '/collections/exam_feedback_photos/records', s.token);
  assert.equal(list.json.items.length, 0);                                       // nor through the collection
  assert.equal(await fileStatus(s.token, up.id, up.file), 404);
  assert.equal(await fileStatus(tok.teacher, up.id, up.file), 200);
  await post(id, 'check', tok.teacher, { part2: { 13: { pts: 1, comment: 'см. фото' } } });
  const v = (await view(id, s.token)).json;
  assert.equal(v.phase, 'checked');
  assert.deepEqual(v.fb, [{ id: up.id, n: '13', file: up.file }]);
  assert.equal(await fileStatus(s.token, up.id, up.file), 200);
  const other = await student(7000000102);
  assert.notEqual(await fileStatus(other.token, up.id, up.file), 200);           // someone else's feedback
});

test('teacher photos: only the teacher removes them; a removed one is gone from the view', async () => {
  const { id, s } = await started(7000000103);
  await post(id, 'answers', s.token, { answers: { 1: '5' } });
  await post(id, 'finish', s.token); await post(id, 'done', s.token);
  const up = (await upload(id, tok.teacher, 13)).json;
  await post(id, 'check', tok.teacher, { part2: { 13: { pts: 2, comment: '' } } });
  const del = (token, pid) => req('DELETE', `/ege/exams/${id}/photos/${pid}`, token);
  assert.notEqual((await del(s.token, up.id)).status, 200);                      // the student cannot
  assert.equal((await view(id, s.token)).json.fb.length, 1);
  assert.equal((await del(tok.teacher, 'nosuchid')).status, 404);
  assert.equal((await del(tok.teacher, up.id)).status, 200);
  assert.deepEqual((await view(id, s.token)).json.fb, []);
});

// ---- Review round 2: texts, old bot photos, students without Telegram ----

test('the "assigned" text promises an hour reminder only when there is time for one', async () => {
  const exam = await mkExam('Пробник Н'), s = await student(7000000110), s2 = await student(7000000111);
  await assign(s.id, exam, nowS() + 7200);
  const far = sent.find(m => String(m.chat_id) === String(s.chat) && m.text.includes('Тебе назначен пробник «Пробник Н»'));
  assert.ok(far.text.includes('Напомню за час'));
  await assign(s2.id, exam, nowS() + 900);
  const near = sent.find(m => String(m.chat_id) === String(s2.chat) && m.text.includes('Тебе назначен пробник «Пробник Н»'));
  assert.ok(!near.text.includes('Напомню за час'));
});

test('an exam without part 2: the teacher and the student hear nothing about it', async () => {
  const exam = await mkExam('Без второй', TASKS.slice(0, 2)), s = await student(7000000112);
  const id = (await assign(s.id, exam, nowS() - 10, 600)).json.id;
  await view(id, s.token);
  await post(id, 'answers', s.token, { answers: { 1: '5', 2: '0,5' } });
  await post(id, 'finish', s.token);
  await tick();
  await until(() => said(TEACHER_CHAT, 'сдал(а) пробник «Без второй»') >= 1);
  const m = sent.find(x => String(x.chat_id) === TEACHER_CHAT && x.text.includes('сдал(а) пробник «Без второй»'));
  assert.ok(m.text.includes('Первая часть: 2 из 2'));
  assert.ok(!m.text.includes('Вторая часть'));
  assert.equal((await post(id, 'check', tok.teacher, { part2: {} })).status, 200);
  await until(() => said(s.chat, 'пробник «Без второй» проверен') >= 1);
  const c = sent.find(x => String(x.chat_id) === String(s.chat) && x.text.includes('«Без второй» проверен'));
  assert.ok(!c.text.includes('второй части'));
});

test('a photo to the bot long after the exam gets the ordinary bot answer, not "время вышло"', async () => {
  const s = await student(7000000113), exam = await mkExam('Давний');
  const id = (await assign(s.id, exam, nowS() - 200000, 600)).json.id;
  const before = sent.length;
  await botHook(photoUpdate(7000000113));
  assert.equal(said(s.chat, 'Время пробника вышло'), 0);
  assert.equal(said(s.chat, 'Сейчас нет пробника'), 0);
  assert.equal(sent.slice(before).filter(m => m.chat_id === 7000000113 && m.reply_markup).length, 1);
  assert.equal((await req('GET', `/collections/exam_photos/records?filter=assignment="${id}"`, tok.teacher)).json.totalItems, 0);
});

test('a student without a Telegram chat: the bot messages are not retried', async () => {
  const pw = 'S'.repeat(32), exam = await mkExam('Без чата');
  const u = await req('POST', '/collections/users/records', tok.su,
    { login: 'nochat', role: 'student', name: 'Н', active: true, password: pw, passwordConfirm: pw });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  const id = (await assign(u.json.id, exam, nowS() + 7200)).json.id;
  await shift(id, { start: nowS() + 1800 });
  await tick();
  assert.ok((await rowOf(id)).m_hour > 0);                                  // marked as sent: nobody to send to
  await shift(id, { start: nowS() - 5 });
  await tick();
  assert.ok((await rowOf(id)).m_open > 0);
});
