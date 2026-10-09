// Invited accounts (link login, placeholder Telegram profile) and binding a real
// Telegram to them. A throwaway PocketBase with our migrations and hooks plus a
// stub standing in for the Telegram Bot API.
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
const PORT = 8092, STUB_PORT = 8093, B = `http://127.0.0.1:${PORT}/api`;
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
// sign-ins are rate limited per address (10 a minute): every call comes from its own
let ipN = 0;
async function login(identity, password, coll = 'users') {
  const r = await req('POST', `/collections/${coll}/auth-with-password`, null, { identity, password },
    { 'X-Forwarded-For': `10.9.${Math.floor(++ipN / 250)}.${ipN % 250 + 1}` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}
const msg = (id, text, extra = {}) => ({ update_id: 1, message: { message_id: 1,
  from: { id, is_bot: false, first_name: 'Рома', username: 'romaperec', ...extra }, chat: { id, type: 'private' }, text } });
const hook = (upd) => req('POST', '/tg/webhook', null, upd, { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
const lastTo = (chat) => [...sent].reverse().find(s => s.chat_id === chat);
const profiles = async () => (await req('GET', '/collections/tg_profiles/records?perPage=200', tok.teacher)).json.items;
const profileOf = async (user) => (await profiles()).find(p => p.user === user);
async function invite(body) { return req('POST', '/ege/invite', tok.teacher, body || {}); }
// an invited student: {id, login, token}
async function invited() {
  const r = await invite();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = await login(r.json.login, r.json.secret);
  return { id: r.json.id, login: r.json.login, secret: r.json.secret, token: a.token };
}
async function linkCode(s) {
  const r = await req('POST', '/ege/tg-link', s.token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.code;
}

before(async () => {
  stub = createServer((q, s) => {
    let b = ''; q.on('data', d => b += d);
    q.on('end', () => { sent.push({ path: q.url, ...JSON.parse(b) }); s.end('{"ok":true}'); });
  }).listen(STUB_PORT, '127.0.0.1');
  dir = mkdtempSync(join(tmpdir(), 'pbinv-'));
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

test('only the teacher can invite', async () => {
  assert.equal((await req('POST', '/ege/invite', null, {})).status, 403);
  assert.equal((await req('POST', '/ege/invite', tok.su, {})).status, 403);
  const s = await invited();
  assert.equal((await req('POST', '/ege/invite', s.token, {})).status, 403);
});

test('an invite makes an account with a working link and a placeholder Telegram profile', async () => {
  const r = await invite();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.login, /^[a-z0-9]{3,40}$/);
  assert.match(r.json.secret, /^[A-Za-z0-9]{32}$/);
  const a = await login(r.json.login, r.json.secret);
  assert.equal(a.record.role, 'student');
  assert.equal(a.record.name, '');
  assert.equal(a.record.id, r.json.id);
  const p = await profileOf(r.json.id);
  assert.match(p.tg_id, /^0\d{15}$/);
  assert.equal(p.mine, false);
  const lead = (await req('GET', '/ege/leads', tok.teacher)).json.items.find(x => x.user === r.json.id);
  assert.equal(lead.placeholder, true);
});

test('each invite gets its own login and placeholder', async () => {
  const a = await invited(), b = await invited();
  assert.notEqual(a.login, b.login);
  assert.notEqual((await profileOf(a.id)).tg_id, (await profileOf(b.id)).tg_id);
});

test('an existing account with no profile gets a placeholder and keeps its progress', async () => {
  const pw = 'S'.repeat(32);
  const u = (await req('POST', '/collections/users/records', tok.teacher,
    { login: 'oldlink', role: 'student', name: 'РомаПерец', active: true, password: pw, passwordConfirm: pw })).json;
  const s = (await login('oldlink', pw)).token;
  const ev = { user: u.id, uid: 'a', ts: 1, kind: 'mark', n: 3, pid: 5, status: 'g', source: 'check' };
  assert.equal((await req('POST', '/collections/events/records', s, ev)).status, 200);
  const r = await invite({ user: u.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.id, u.id);
  assert.match((await profileOf(u.id)).tg_id, /^0\d{15}$/);
  assert.equal((await login('oldlink', pw)).record.name, 'РомаПерец');
  const lead = (await req('GET', '/ege/leads', tok.teacher)).json.items.find(x => x.user === u.id);
  assert.equal(lead.marks, 1);
  assert.equal((await invite({ user: u.id })).status, 409);
});

test('a placeholder cannot be put on a teacher or a missing account', async () => {
  const t = (await req('GET', '/collections/users/records?filter=' + encodeURIComponent('login="teacher"'), tok.teacher)).json.items[0];
  assert.equal((await invite({ user: t.id })).status, 400);
  assert.equal((await invite({ user: 'nope' })).status, 404);
});

test('a student sets their own name once', async () => {
  const s = await invited();
  assert.equal((await req('POST', '/ege/name', s.token, { name: '   ' })).status, 400);
  assert.equal((await req('POST', '/ege/name', s.token, {})).status, 400);
  const r = await req('POST', '/ege/name', s.token, { name: '  Иван   Петров  ' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.name, 'Иван Петров');
  assert.equal((await login(s.login, s.secret)).record.name, 'Иван Петров');
  assert.equal((await req('POST', '/ege/name', s.token, { name: 'Другой' })).status, 403);
  assert.equal((await login(s.login, s.secret)).record.name, 'Иван Петров');
});

test('a long name is cut to 80 and guests and the teacher cannot use it', async () => {
  const s = await invited();
  assert.equal((await req('POST', '/ege/name', s.token, { name: 'Я'.repeat(200) })).json.name.length, 80);
  assert.equal((await req('POST', '/ege/name', null, { name: 'X' })).status, 403);
  assert.equal((await req('POST', '/ege/name', tok.teacher, { name: 'X' })).status, 403);
});

test('the link status says whether a real Telegram is bound', async () => {
  const s = await invited();
  assert.deepEqual((await req('GET', '/ege/tg-link', s.token)).json, { linked: false });
  assert.equal((await req('GET', '/ege/tg-link', null)).status, 403);
});

test('a link code is six digits, names the bot, and is not a sign-in code', async () => {
  const s = await invited();
  const r = await req('POST', '/ege/tg-link', s.token);
  assert.match(r.json.code, /^\d{6}$/);
  assert.equal(r.json.bot, 'kirill_repet_bot');
  const c = await req('POST', '/tg/code', null, { code: r.json.code }, { 'X-Forwarded-For': '10.1.0.1' });
  assert.equal(c.status, 400);
  // the failed sign-in attempt did not burn the link code
  const n = sent.length;
  assert.equal((await hook(msg(7000001, '/start link_' + r.json.code))).status, 200);
  assert.match(lastTo(7000001).text, /^Готово/);
  assert.ok(sent.length > n);
});

test('a new link code replaces the previous one', async () => {
  const s = await invited();
  const old = await linkCode(s);
  const fresh = await linkCode(s);
  await hook(msg(7000002, '/start link_' + old));
  if (old !== fresh) assert.match(lastTo(7000002).text, /не подходит/);
  await hook(msg(7000002, '/start link_' + fresh));
  assert.match(lastTo(7000002).text, /^Готово/);
});

test('binding swaps the placeholder for the real Telegram and keeps the account', async () => {
  const s = await invited();
  const code = await linkCode(s);
  await hook(msg(7000010, '/start link_' + code, { first_name: 'Ромка' }));
  const p = await profileOf(s.id);
  assert.deepEqual([p.tg_id, p.username, p.first_name, p.mine], ['7000010', 'romaperec', 'Ромка', false]);
  assert.equal((await profiles()).filter(x => x.user === s.id).length, 1);
  assert.deepEqual((await req('GET', '/ege/tg-link', s.token)).json, { linked: true });
  const l = lastTo(7000010);
  assert.match(l.text, /^Готово/);
  assert.match(l.reply_markup.inline_keyboard[0][0].url, new RegExp(`#/login/${s.login}\\.${s.secret}$`));
  // the same person writing the bot later lands in the same account
  await hook(msg(7000010, '/start channel'));
  assert.match(lastTo(7000010).reply_markup.inline_keyboard[0][0].url, new RegExp(`#/login/${s.login}\\.`));
  assert.equal((await profiles()).filter(x => x.tg_id === '7000010').length, 1);
  // a linked account has nothing left to bind
  assert.deepEqual((await req('POST', '/ege/tg-link', s.token)).json, { linked: true });
});

test('the code works once', async () => {
  const s = await invited();
  const code = await linkCode(s);
  await hook(msg(7000020, '/start link_' + code));
  assert.match(lastTo(7000020).text, /^Готово/);
  await hook(msg(7000021, '/start link_' + code));
  assert.match(lastTo(7000021).text, /не подходит/);
  assert.equal((await profileOf(s.id)).tg_id, '7000020');
  assert.equal((await profiles()).filter(x => x.tg_id === '7000021').length, 0);
});

test('the typed form /link 123456 works too', async () => {
  const s = await invited();
  const code = await linkCode(s);
  await hook(msg(7000030, '/link ' + code.slice(0, 3) + ' ' + code.slice(3)));
  assert.match(lastTo(7000030).text, /^Готово/);
  assert.equal((await profileOf(s.id)).tg_id, '7000030');
});

test('a Telegram that already has an account cannot be bound to another one', async () => {
  await hook(msg(7000040, '/start channel'));   // registers the person on their own
  const own = (await profiles()).find(p => p.tg_id === '7000040');
  const s = await invited();
  const before = (await profileOf(s.id)).tg_id;
  await hook(msg(7000040, '/start link_' + await linkCode(s)));
  assert.match(lastTo(7000040).text, /уже используется/);
  assert.equal((await profileOf(s.id)).tg_id, before);
  assert.equal((await profiles()).find(p => p.tg_id === '7000040').user, own.user);
});

test('wrong, malformed and expired codes change nothing', async () => {
  const s = await invited();
  const code = await linkCode(s);
  const other = String((Number(code) + 1) % 1000000).padStart(6, '0');
  const before = (await profileOf(s.id)).tg_id;
  await hook(msg(7000050, '/start link_' + other));
  assert.match(lastTo(7000050).text, /не подходит/);
  await hook(msg(7000050, '/link 12ab'));
  assert.match(lastTo(7000050).text, /не подходит/);
  const row = (await req('GET', '/collections/login_codes/records?filter=' + encodeURIComponent(`code="${code}"`), tok.su)).json.items[0];
  assert.equal(row.purpose, 'link');
  await req('PATCH', `/collections/login_codes/records/${row.id}`, tok.su, { expires: 1 });
  await hook(msg(7000051, '/start link_' + code));
  assert.match(lastTo(7000051).text, /не подходит/);
  assert.equal((await profileOf(s.id)).tg_id, before);
  assert.equal((await profiles()).filter(x => ['7000050', '7000051'].includes(x.tg_id)).length, 0);
});

test('a disabled account cannot be bound', async () => {
  const s = await invited();
  const code = await linkCode(s);
  await req('PATCH', `/collections/users/records/${s.id}`, tok.teacher, { active: false });
  await hook(msg(7000060, '/start link_' + code));
  assert.match(lastTo(7000060).text, /отключён/);
  assert.match((await profileOf(s.id)).tg_id, /^0/);
});

test('an account without any profile gets one when it binds', async () => {
  const pw = 'S'.repeat(32);
  const u = (await req('POST', '/collections/users/records', tok.teacher,
    { login: 'oldlink2', role: 'student', name: 'Старый', active: true, password: pw, passwordConfirm: pw })).json;
  const s = { token: (await login('oldlink2', pw)).token };
  assert.deepEqual((await req('GET', '/ege/tg-link', s.token)).json, { linked: false });
  await hook(msg(7000070, '/start link_' + await linkCode(s)));
  assert.match(lastTo(7000070).text, /^Готово/);
  assert.equal((await profileOf(u.id)).tg_id, '7000070');
});

test('the sign-in code still works and is not mixed up with link codes', async () => {
  await hook(msg(7000080, '/start channel'));
  const code = lastTo(7000080).text.match(/код: (\d{6})/)[1];
  const r = await req('POST', '/tg/code', null, { code }, { 'X-Forwarded-For': '10.1.0.2' });
  assert.equal(r.status, 200);
  assert.equal(r.json.login, 'tg7000080');
});
