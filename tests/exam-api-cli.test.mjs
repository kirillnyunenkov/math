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
