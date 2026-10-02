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
  assert.match(sent.at(-1).text, /^Привет/);
  assert.equal(sent.at(-1).path, '/bottest/sendMessage');
});

test('second message returns the same link and creates nothing', async () => {
  const first = linkOf(7123456789);
  await hook(update(from(7123456789, { username: 'masha_new' })));
  assert.deepEqual(linkOf(7123456789), first);
  const p = (await req('GET', '/collections/tg_profiles/records', tok.teacher)).json.items;
  assert.equal(p.length, 1);
  assert.equal(p[0].username, 'masha_new');
  assert.match(sent.at(-1).text, /^Вот твоя ссылка/);
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
