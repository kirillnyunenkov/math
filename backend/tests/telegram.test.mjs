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
