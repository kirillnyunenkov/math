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
