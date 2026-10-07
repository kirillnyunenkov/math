// Subprocess tests of tools/exam_api.mjs: the safety gate (nothing may reach the network or the link
// file when the arguments are wrong) and the "no --yes -> exit 3, nothing written" contract against a tiny local stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'exam_api.mjs');
const NO_LINK = join(tmpdir(), 'exam-api-test-no-such-link-file.txt');

// A refusal at argument parsing: exit 2, and neither the link file nor the network was touched.
const gate = (args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args, '--link-file', NO_LINK], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 2, args.join(' ') + ' -> ' + out);
  assert.doesNotMatch(out, /Не нашёл файл со ссылкой/);   // login (link file read) was never reached
  assert.doesNotMatch(out, /Не достучался/);               // no request was made
  assert.doesNotMatch(out, /Сервер:/);                     // not even the write banner: refused before anything
};

test('safety gate: unknown option, bad scheme, plain http to a non-loopback host, missing value', () => {
  gate(['exams', '--apii', 'http://127.0.0.1:1/api']);
  gate(['exams', '--api', 'ftp://x']);
  gate(['exams', '--api', 'http://example.com/api']);
  gate(['exams', '--api', 'http://192.168.0.5/api']);
  gate(['exams', '--api', 'http://user:pw@127.0.0.1:1/api']);
  gate(['assign', '--student']);
  gate(['exams', '--api']);
  gate(['exams', '--bogus']);
  gate(['nonsense']);
  gate([]);
});

test('loopback http is accepted by the gate (it then fails only at the link file)', () => {
  for (const host of ['127.0.0.1:1', 'localhost:1', '[::1]:1']) {
    const r = spawnSync(process.execPath, [TOOL, 'exams', '--api', 'http://' + host + '/api', '--link-file', NO_LINK], { encoding: 'utf8' });
    assert.equal(r.status, 1, host);
    assert.match(r.stderr, /Не нашёл файл со ссылкой/);
  }
});

// ---- exit 3 without --yes, against a local stub that answers login and the lists ----
const run = (args) => new Promise((res) => {
  const p = spawn(process.execPath, [TOOL, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ code, out }));
});

test('assign and delete without --yes print the plan, exit 3 and write nothing', async () => {
  const hits = [];
  const srv = createServer((q, s) => {
    hits.push(q.method + ' ' + q.url.split('?')[0]);
    q.resume();
    s.setHeader('content-type', 'application/json');
    const u = q.url.split('?')[0];
    if (u.endsWith('/auth-with-password')) return s.end(JSON.stringify({ token: 'stub-token', record: { role: 'teacher' } }));
    if (u.endsWith('/collections/exams/records') && q.method === 'GET') return s.end(JSON.stringify({ items: [{ id: 'e1', title: 'Пример', full: false, created: '2026-01-01' }] }));
    if (u.endsWith('/collections/users/records')) return s.end(JSON.stringify({ items: [{ id: 'u1', name: 'Тест Ученик', login: 'stud1', active: true }] }));
    if (u.endsWith('/ege/leads')) return s.end(JSON.stringify({ items: [] }));
    s.statusCode = 500; s.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'exam-api-test-'));
  try {
    const link = join(dir, 'link.txt');
    writeFileSync(link, 'http://localhost:3456/teacher.html#/login/teacher.StubSecret1\n');
    const base = ['--api', 'http://127.0.0.1:' + srv.address().port + '/api', '--link-file', link];
    const at = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) + ' 18:00';
    const a = await run(['assign', '--student', 'тест', '--exam', '1', '--at', at, ...base]);
    assert.equal(a.code, 3, a.out);
    assert.match(a.out, /Назначу: Тест Ученик · №1 · Пример/);
    assert.match(a.out, /Telegram/);
    const d = await run(['delete', '--exam', '№1', ...base]);
    assert.equal(d.code, 3, d.out);
    assert.match(d.out, /Удалю из каталога: №1 · Пример/);
    const bad = await run(['assign', '--student', 'тест', '--exam', '1', '--at', '2026-02-31 10:00', '--yes', ...base]);
    assert.equal(bad.code, 1); assert.match(bad.out, /не бывает/);
    assert.ok(!hits.some((h) => h.startsWith('POST /api/ege') || h.startsWith('DELETE')), 'wrote: ' + hits.join(', '));
    assert.doesNotMatch(a.out + d.out + bad.out, /StubSecret1|stub-token/);
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('delete: a refused request reports the status code, not a guessed reason', async () => {
  const srv = createServer((q, s) => {
    q.resume();
    s.setHeader('content-type', 'application/json');
    const u = q.url.split('?')[0];
    if (u.endsWith('/auth-with-password')) return s.end(JSON.stringify({ token: 'stub-token', record: { role: 'teacher' } }));
    if (u.endsWith('/collections/exams/records') && q.method === 'GET') return s.end(JSON.stringify({ items: [{ id: 'e1', title: 'Пример', full: false, created: '2026-01-01' }] }));
    s.statusCode = 400; s.end('{"message":"internal detail"}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'exam-api-test-'));
  try {
    const link = join(dir, 'link.txt');
    writeFileSync(link, 'http://localhost:3456/teacher.html#/login/teacher.StubSecret1\n');
    const d = await run(['delete', '--exam', '1', '--yes', '--api', 'http://127.0.0.1:' + srv.address().port + '/api', '--link-file', link]);
    assert.equal(d.code, 1, d.out);
    assert.match(d.out, /ответ 400/);
    assert.doesNotMatch(d.out, /internal detail|StubSecret1|stub-token/);
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('history add without --yes prints the check table, exit 3 and writes nothing', async () => {
  const hits = [];
  const srv = createServer((q, s) => {
    hits.push(q.method + ' ' + q.url.split('?')[0]);
    q.resume();
    s.setHeader('content-type', 'application/json');
    const u = q.url.split('?')[0];
    if (u.endsWith('/auth-with-password')) return s.end(JSON.stringify({ token: 'stub-token', record: { role: 'teacher' } }));
    if (u.endsWith('/collections/users/records')) return s.end(JSON.stringify({ items: [{ id: 'u1', name: 'Тест Ученик', login: 'stud1', active: true }] }));
    if (u.endsWith('/ege/leads')) return s.end(JSON.stringify({ items: [] }));
    s.statusCode = 500; s.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'exam-api-test-'));
  try {
    const link = join(dir, 'link.txt');
    writeFileSync(link, 'http://localhost:3456/teacher.html#/login/teacher.StubSecret1\n');
    const base = ['--api', 'http://127.0.0.1:' + srv.address().port + '/api', '--link-file', link];
    const row = '1,1,,1,1,-,1,,,1,0,1,,,,2,,,,';
    const a = await run(['history', 'add', '--student', 'тест', '--date', '2025-10-21', '--title', 'Вариант 1', '--scores', row, '--test', '52', ...base]);
    assert.equal(a.code, 3, a.out);
    assert.match(a.out, /Тест Ученик · Вариант 1 · 2025-10-21/);
    assert.match(a.out, /Первичный балл: 9 из 32/);
    assert.match(a.out, /Тестовый балл: 52 \(как ты указал\)/);
    assert.match(a.out, /№6: —/);
    const bad = await run(['history', 'add', '--student', 'тест', '--date', '2025-02-30', '--title', 'Х', '--scores', row, '--test', '52', ...base]);
    assert.equal(bad.code, 1); assert.match(bad.out, /Дата/);
    const short = await run(['history', 'add', '--student', 'тест', '--date', '2025-10-21', '--title', 'Х', '--scores', '1,2', '--test', '52', ...base]);
    assert.equal(short.code, 1); assert.match(short.out, /ровно 20/);
    const noTest = await run(['history', 'add', '--student', 'тест', '--date', '2025-10-21', '--title', 'Х', '--scores', row, ...base]);
    assert.equal(noTest.code, 1); assert.match(noTest.out, /Тестовый балл/);
    const noSub = await run(['history', ...base]);
    assert.equal(noSub.code, 2); assert.match(noSub.out, /history add/);
    const noId = await run(['history', 'delete', '--student', 'тест', '--id', 'x', ...base]);
    assert.equal(noId.code, 1);
    assert.ok(!hits.some((h) => h.startsWith('POST /api/ege') || h.startsWith('DELETE')), 'wrote: ' + hits.join(', '));
    assert.doesNotMatch(a.out + bad.out + short.out + noTest.out + noSub.out + noId.out, /StubSecret1|stub-token/);
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('history --yes: add sends one exact POST (test score as given, 0 included); delete only for the student\'s own id', async () => {
  const writes = [], bodies = [];
  const srv = createServer((q, s) => {
    let buf = '';
    q.on('data', (c) => { buf += c; });
    q.on('end', () => {
      const u = q.url.split('?')[0];
      s.setHeader('content-type', 'application/json');
      if (u.endsWith('/auth-with-password')) return s.end(JSON.stringify({ token: 'stub-token', record: { role: 'teacher' } }));
      if (u.endsWith('/collections/users/records')) return s.end(JSON.stringify({ items: [{ id: 'u1', name: 'Тест Ученик', login: 'stud1', active: true }] }));
      if (u.endsWith('/ege/leads')) return s.end(JSON.stringify({ items: [] }));
      if (u.endsWith('/ege/exams/history') && q.method === 'GET') {
        assert.match(q.url, /user=u1/);
        return s.end(JSON.stringify({ items: [{ id: 'abcdefghij12345', date: '2025-10-21', title: 'Вариант 1', scores: { 1: 1 }, na: [], test: 52 }] }));
      }
      if (q.method !== 'GET') { writes.push(q.method + ' ' + u); bodies.push(buf); }
      if (u.endsWith('/ege/exams/history')) return s.end(JSON.stringify({ id: 'zzzzzzzzzz00000' }));
      if (q.method === 'DELETE') return s.end('{}');
      s.statusCode = 500; s.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'exam-api-test-'));
  try {
    const link = join(dir, 'link.txt');
    writeFileSync(link, 'http://localhost:3456/teacher.html#/login/teacher.StubSecret1\n');
    const base = ['--api', 'http://127.0.0.1:' + srv.address().port + '/api', '--link-file', link];
    const row = '1,1,,1,1,-,1,,,1,0,1,,,,2,,,,';
    const add = await run(['history', 'add', '--student', 'тест', '--date', '2025-10-21', '--title', 'Вариант 2', '--scores', row, '--test', '0', '--yes', ...base]);
    assert.equal(add.code, 0, add.out);
    assert.deepEqual(writes, ['POST /api/ege/exams/history']);
    const body = JSON.parse(bodies[0]);
    assert.equal(body.user, 'u1'); assert.equal(body.date, '2025-10-21'); assert.equal(body.title, 'Вариант 2');
    assert.strictEqual(body.test, 0); assert.deepEqual(body.na, [6]);
    assert.equal(body.scores['1'], 1); assert.equal(body.scores['16'], 2); assert.equal(body.scores['3'], null);
    writes.length = 0;
    const own = await run(['history', 'delete', '--student', 'тест', '--id', 'abcdefghij12345', '--yes', ...base]);
    assert.equal(own.code, 0, own.out);
    assert.match(own.out, /Удалю: 2025-10-21 · Вариант 1 · тест 52 у Тест Ученик/);
    assert.deepEqual(writes, ['DELETE /api/ege/exams/history/abcdefghij12345']);
    writes.length = 0;
    const other = await run(['history', 'delete', '--student', 'тест', '--id', 'ZZZZZZZZZZ99999', '--yes', ...base]);
    assert.equal(other.code, 1, other.out);
    assert.match(other.out, /нет записи с таким id/);
    const dry = await run(['history', 'delete', '--student', 'тест', '--id', 'abcdefghij12345', ...base]);
    assert.equal(dry.code, 3, dry.out);
    assert.deepEqual(writes, []);
    assert.doesNotMatch(add.out + own.out + other.out + dry.out, /StubSecret1|stub-token/);
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('history add: input errors are refused before any network call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'exam-api-test-'));
  try {
    // port 9 is closed: any attempt to log in would give a different message than the validation one
    const base = ['--api', 'http://127.0.0.1:9/api', '--link-file', join(dir, 'missing.txt')];
    const bad = await run(['history', 'add', '--student', 'x', '--date', '2025-02-30', '--title', 'Х', '--scores', '1', '--test', '5', ...base]);
    assert.equal(bad.code, 1); assert.match(bad.out, /Дата/);
    const badId = await run(['history', 'delete', '--student', 'x', '--id', 'q', ...base]);
    assert.equal(badId.code, 1); assert.match(badId.out, /--id/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
