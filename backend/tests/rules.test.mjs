// Access-rule tests: run a throwaway PocketBase with our migrations and
// check that students only ever see and write their own rows.
// Run: PB_BIN=~/.local/pocketbase/pocketbase node --test backend/tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PB = process.env.PB_BIN || join(homedir(), '.local/pocketbase/pocketbase');
const MIG = join(dirname(fileURLToPath(import.meta.url)), '../pb_migrations');
const PORT = 8097, B = `http://127.0.0.1:${PORT}/api`;
let dir, proc;
const tok = {}, ids = {};

async function req(method, path, token, body) {
  const r = await fetch(B + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
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
const PW = { teacher: 'T'.repeat(32), stu1: 'A'.repeat(32), stu2: 'B'.repeat(32) };
const ev = (user, uid, extra = {}) => ({ user, uid, ts: 1, kind: 'mark', n: 3, pid: 5, status: 'g', source: 'manual', ...extra });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pbtest-'));
  const args = ['--dir', join(dir, 'pb_data'), '--migrationsDir', MIG];
  execFileSync(PB, ['migrate', 'up', ...args]);
  execFileSync(PB, ['superuser', 'upsert', 'root@test.local', 'rootpassword123', ...args]);
  proc = spawn(PB, ['serve', '--http', `127.0.0.1:${PORT}`, ...args], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(B + '/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const su = (await login('root@test.local', 'rootpassword123', '_superusers')).token;
  for (const [login_, role] of [['teacher', 'teacher'], ['stu1', 'student'], ['stu2', 'student']]) {
    const r = await req('POST', '/collections/users/records', su,
      { login: login_, role, name: login_.toUpperCase(), active: true, password: PW[login_], passwordConfirm: PW[login_] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    ids[login_] = r.json.id;
  }
  for (const l of ['teacher', 'stu1', 'stu2']) tok[l] = (await login(l, PW[l])).token;
});
after(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }); });

test('student sees only self in users, teacher sees all', async () => {
  assert.equal((await req('GET', '/collections/users/records', tok.stu1)).json.totalItems, 1);
  assert.equal((await req('GET', '/collections/users/records', tok.teacher)).json.totalItems, 3);
});

test('student cannot promote self', async () => {
  const r = await req('PATCH', `/collections/users/records/${ids.stu1}`, tok.stu1, { role: 'teacher' });
  assert.ok([403, 404].includes(r.status));
});

test('student writes own events only', async () => {
  assert.equal((await req('POST', '/collections/events/records', tok.stu1, ev(ids.stu1, 'own1'))).status, 200);
  assert.equal((await req('POST', '/collections/events/records', tok.stu2, ev(ids.stu1, 'forged'))).status, 400);
});

test('events are visible to owner and teacher only', async () => {
  await req('POST', '/collections/events/records', tok.stu2, ev(ids.stu2, 'other1'));
  const s1 = (await req('GET', '/collections/events/records', tok.stu1)).json.items;
  assert.ok(s1.length >= 1 && s1.every(e => e.user === ids.stu1));
  const t = (await req('GET', '/collections/events/records', tok.teacher)).json.items;
  assert.ok(t.some(e => e.user === ids.stu1) && t.some(e => e.user === ids.stu2));
});

test('events are append-only', async () => {
  const r = await req('POST', '/collections/events/records', tok.stu1, ev(ids.stu1, 'ro1'));
  assert.ok([403, 404].includes((await req('PATCH', `/collections/events/records/${r.json.id}`, tok.stu1, { status: 'b' })).status));
  assert.ok([403, 404].includes((await req('DELETE', `/collections/events/records/${r.json.id}`, tok.stu1)).status));
});

test('duplicate uid is rejected as not unique', async () => {
  await req('POST', '/collections/events/records', tok.stu1, ev(ids.stu1, 'dup1'));
  const r = await req('POST', '/collections/events/records', tok.stu1, ev(ids.stu1, 'dup1'));
  assert.equal(r.status, 400);
  assert.equal(r.json.data.uid.code, 'validation_not_unique');
});

test('batch create works', async () => {
  const mk = uid => ({ method: 'POST', url: '/api/collections/events/records', body: ev(ids.stu1, uid) });
  const r = await req('POST', '/batch', tok.stu1, { requests: [mk('b1'), mk('b2')] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test('variants and clears follow the same ownership rules', async () => {
  const v = { user: ids.stu1, uid: 'v1', t: 1, p: 5, s: 27, ms: 1000, total: 12, m: 12, q: [[1, 2, 1, '5']] };
  assert.equal((await req('POST', '/collections/variants/records', tok.stu1, v)).status, 200);
  assert.equal((await req('POST', '/collections/variants/records', tok.stu2, { ...v, uid: 'v2' })).status, 400);
  assert.equal((await req('GET', '/collections/variants/records', tok.stu2)).json.totalItems, 0);
  assert.equal((await req('POST', '/collections/variant_clears/records', tok.stu1, { user: ids.stu1, uid: 'c1', ts: 2 })).status, 200);
});

test('links are teacher-only', async () => {
  const r = await req('POST', '/collections/links/records', tok.teacher, { user: ids.stu1, secret: PW.stu1 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const l = await req('GET', '/collections/links/records', tok.stu1);
  assert.ok(l.status === 403 || l.json.totalItems === 0);
  assert.ok([403, 404].includes((await req('GET', `/collections/links/records/${r.json.id}`, tok.stu1)).status));
  assert.ok([400, 403].includes((await req('POST', '/collections/links/records', tok.stu1, { user: ids.stu2, secret: 'x' })).status));
});

test('deactivated student cannot write', async () => {
  await req('PATCH', `/collections/users/records/${ids.stu2}`, tok.teacher, { active: false });
  assert.equal((await req('POST', '/collections/events/records', tok.stu2, ev(ids.stu2, 'late'))).status, 400);
  await req('PATCH', `/collections/users/records/${ids.stu2}`, tok.teacher, { active: true });
});

test('rotating the password logs old sessions out', async () => {
  const NEW = 'N'.repeat(32);
  const r = await req('PATCH', `/collections/users/records/${ids.stu2}`, tok.teacher, { password: NEW, passwordConfirm: NEW });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await req('POST', '/collections/users/auth-refresh', tok.stu2)).status, 401);
  assert.ok((await login('stu2', NEW)).token);
});
