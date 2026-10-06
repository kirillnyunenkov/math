// Local stack for checking assigned exams (and the teacher panel) in a browser.
//
// Usage (two terminals, both from the repo root):
//   node tools/exam-dev-stack.mjs        # PocketBase on 127.0.0.1:8090 + Telegram stub on 127.0.0.1:8099
//   python3 -m http.server 3456          # the site itself (port 3456 is in .claude/launch.json)
// Then open the printed student or teacher link. Ctrl+C stops the stack and removes its temp dir.
//
// Environment:
//   START_IN  seconds from now to the exam start (default 20, may be negative: exam already open/over)
//   DURATION  exam length in seconds (default 900)
//   PB_BIN    PocketBase binary (default ~/.local/pocketbase/pocketbase, v0.40.x)
//
// The data is made up and lives in a temp dir. The migrations and hooks come from backend/.
// The PocketBase rate limit is switched off for this throwaway instance only.
// If port 8090 or 8099 is busy the script exits and kills nothing.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, openSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PB = process.env.PB_BIN || join(homedir(), '.local/pocketbase/pocketbase');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = join(ROOT, 'backend/pb_migrations'), HOOKS = join(ROOT, 'backend/pb_hooks');
const PORT = 8090, STUB = 8099, B = `http://127.0.0.1:${PORT}/api`;
const START_IN = Number(process.env.START_IN ?? 20), DURATION = Number(process.env.DURATION ?? 900);
const nowS = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!Number.isFinite(START_IN) || !Number.isFinite(DURATION)) { console.error('START_IN and DURATION must be numbers.'); process.exit(1); }
if (!existsSync(PB)) { console.error(`PocketBase binary not found: ${PB} (set PB_BIN).`); process.exit(1); }

const busy = (port) => new Promise((res) => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false));
});
for (const p of [PORT, STUB]) {
  if (await busy(p)) { console.error(`Port ${p} is busy (another PocketBase or dev stack?). Stop it or wait; nothing was killed.`); process.exit(1); }
}

// State to clean up; only what this script started.
let proc = null, stub = null, dir = null, stopping = false;
const cleanup = async () => {
  if (stopping) return; stopping = true;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const gone = new Promise((r) => proc.once('exit', r));
    proc.kill('SIGTERM');
    if (await Promise.race([gone.then(() => true), sleep(5000).then(() => false)]) === false) { proc.kill('SIGKILL'); await gone; }
  }
  if (stub) stub.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
};
// Never let the superuser password reach the terminal, whatever message arrives here.
let rootPw = '';
const scrub = (m) => (rootPw ? String(m).split(rootPw).join('***') : String(m));
const die = async (msg, code = 1) => { console.error(scrub(msg)); await cleanup(); process.exit(code); };
// A PocketBase one-off command; on failure only a fixed message is thrown (the command line carries the password).
const pbCmd = (cmdArgs) => {
  const r = spawnSync(PB, cmdArgs, { stdio: 'ignore' });
  if (r.error || r.status !== 0) throw new Error(`PocketBase setup command failed (migrate or superuser upsert, exit status ${r.status ?? 'none'}). Check PB_BIN (needs v0.40.4) and the migrations.`);
};
process.on('SIGINT', () => cleanup().then(() => process.exit(0)));
process.on('SIGTERM', () => cleanup().then(() => process.exit(0)));

async function req(method, path, token, body) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json)}`);
  return json;
}
const login = async (identity, password, coll = 'users') =>
  (await req('POST', `/collections/${coll}/auth-with-password`, null, { identity, password }));

try {
  // Telegram stub: answers getFile, serves one tiny PNG for every file download, and {"ok":true} to the rest (sendMessage, ...).
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  stub = createServer((q, s) => {
    q.resume();
    q.on('end', () => {
      if (q.url.includes('/getFile')) { s.setHeader('content-type', 'application/json'); return s.end(JSON.stringify({ ok: true, result: { file_path: 'photos/file_1.png' } })); }
      if (q.url.includes('/file/bot')) { s.setHeader('content-type', 'image/png'); return s.end(PNG); }
      s.setHeader('content-type', 'application/json'); s.end('{"ok":true}');
    });
  });
  await new Promise((res, rej) => { stub.once('error', rej); stub.listen(STUB, '127.0.0.1', res); });

  dir = mkdtempSync(join(tmpdir(), 'pbdev-'));
  const log = join(dir, 'pocketbase.log');
  const args = ['--dir', join(dir, 'pb_data'), '--migrationsDir', MIG];
  rootPw = randomBytes(18).toString('hex');   // the superuser password is never printed
  pbCmd(['migrate', 'up', ...args]);
  pbCmd(['superuser', 'upsert', 'root@dev.local', rootPw, ...args]);
  const out = openSync(log, 'a');
  proc = spawn(PB, ['serve', '--http', `127.0.0.1:${PORT}`, ...args, '--hooksDir', HOOKS, '--automigrate=false'], {
    stdio: ['ignore', out, out],
    env: { ...process.env, TG_API: `http://127.0.0.1:${STUB}`, TG_BOT_TOKEN: 'dev', TG_WEBHOOK_SECRET: 'dev', TEACHER_TG_ID: '1' },
  });
  proc.on('exit', (code, sig) => { if (!stopping) die(`PocketBase exited unexpectedly (${sig || code}). Log tail:\n${readFileSync(log, 'utf8').split('\n').slice(-15).join('\n')}`); });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(B + '/health')).ok; } catch {} if (!up) await sleep(100); }
  if (!up) throw new Error(`PocketBase did not come up. Log tail:\n${readFileSync(log, 'utf8').split('\n').slice(-15).join('\n')}`);

  const su = (await login('root@dev.local', rootPw, '_superusers')).token;
  // rate limits would get in the way of repeated logins while testing by hand (this instance only)
  await req('PATCH', '/settings', su, { rateLimits: { enabled: false } });
  const PW = 'P' + 'x'.repeat(31);   // throwaway dev password, also the secret in the login links
  const mkUser = async (login_, role, name) => {
    const u = await req('POST', '/collections/users/records', su, { login: login_, role, name, active: true, password: PW, passwordConfirm: PW });
    await req('POST', '/collections/links/records', su, { user: u.id, secret: PW });
    return { id: u.id, link: `#/login/${login_}.${PW}` };
  };
  const teacher = await mkUser('teacher', 'teacher', 'Преподаватель');
  const stud = await mkUser('stud1', 'student', 'Тест Ученик');
  // a bot profile for the student, so that photos "sent to the bot" can be simulated with the webhook
  await req('POST', '/collections/tg_profiles/records', su, { user: stud.id, tg_id: '7000000001', username: 'stud1', first_name: 'Тест', mine: true });
  const tt = (await login('teacher', PW)).token;

  const TASKS = [
    { n: 1, kind: 'short', max: 1, cond: '<p>Найдите значение выражения $2+3$.</p>' },
    { n: 2, kind: 'short', max: 1, cond: '<p>Решите уравнение $2x=-3$. В ответе укажите $x$.</p>' },
    { n: 3, kind: 'short', max: 1, cond: '<p>Найдите $\\dfrac{1}{2}$ в виде десятичной дроби.</p>' },
    { n: 13, kind: 'long', max: 2, cond: '<p>Решите уравнение $x^2=1$.</p>' },
    { n: 14, kind: 'long', max: 3, cond: '<p>Докажите, что $1+1=2$.</p>' },
  ];
  const KEY = { 1: { a: '5', sol: '<p>$2+3=5$.</p>' }, 2: { a: '-1,5', sol: '<p>$x=-\\dfrac{3}{2}$.</p>' }, 3: { a: '0,5', sol: '<p>$\\dfrac{1}{2}=0{,}5$.</p>' },
    13: { a: '<p>$x=\\pm1$</p>' }, 14: { a: '<p>Очевидно.</p>' } };
  const exam = await req('POST', '/collections/exams/records', tt, { title: 'Тестовый пробник', full: false, tasks: TASKS, key: KEY });
  const asg = await req('POST', '/ege/exams/assign', tt, { user: stud.id, exam: exam.id, start: nowS() + START_IN, duration: DURATION });

  console.log(`\nStack is up. Serve the site:  python3 -m http.server 3456`);
  console.log(`Student: http://localhost:3456/${stud.link}`);
  console.log(`Teacher: http://localhost:3456/teacher.html${teacher.link}`);
  console.log(`Ids: student ${stud.id}, teacher ${teacher.id}, exam ${exam.id}, assignment ${asg.id}`);
  console.log(`Starts in ${START_IN}s, lasts ${DURATION}s. Ctrl+C to stop.`);
  console.log(`Simulate a photo sent to the bot. It is refused until the exam has started AND the student has opened it in the browser
(phase "open" with "opened" set; otherwise the bot answers "Сначала открой пробник..." / "Сейчас нет пробника..."), so with START_IN=${START_IN} wait at least that long:
  curl -s -X POST http://127.0.0.1:${PORT}/api/tg/webhook -H 'X-Telegram-Bot-Api-Secret-Token: dev' -H 'content-type: application/json' \\
    -d '{"update_id":1,"message":{"message_id":1,"from":{"id":7000000001,"is_bot":false,"first_name":"Тест"},"chat":{"id":7000000001,"type":"private"},"photo":[{"file_id":"A","file_size":10},{"file_id":"B","file_size":1000}]}}'\n`);
} catch (err) {
  await die(`Setup failed: ${err.message}`);
}
// Stay alive until Ctrl+C: the stub server and the PocketBase child keep the event loop busy.
