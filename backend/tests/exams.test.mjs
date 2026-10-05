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
