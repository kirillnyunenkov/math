// Owner's tool for Claude Code: work with assigned exams on the server.
//   node tools/exam_api.mjs exams | students | status
//   node tools/exam_api.mjs upload <exam.json>
//   node tools/exam_api.mjs assign --student "Иван" --exam 3 --at "2026-10-09 18:00" [--minutes 235] [--yes]
//   node tools/exam_api.mjs delete --exam 3 [--yes]
// --exam takes a catalog number ("3" or "№3", as in `exams` and in the panel) or a title / fragment.
// DEFAULT TARGET IS PRODUCTION (https://api.kirillnyun.space/api). For tests always pass
// --api http://127.0.0.1:8090/api (local dev stack). Every write command prints the target host first.
// Logs in with the teacher link file; never prints the link, the secret, the password or a token:
// network and server errors are reduced to fixed texts and status codes.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkExam } from './exam-check-lib.mjs';
import { parseWhen, pickOne, pickExam, linkFromText } from './exam-cli-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Core = require(join(ROOT, 'exam-core.js'));
const P = require(join(ROOT, 'exam-panel-core.js'));

const die = (msg, code = 1) => { console.error(msg); process.exit(code); };
// Whatever goes wrong below, no stack trace or raw error text reaches the terminal.
process.on('uncaughtException', () => die('Непредвиденная ошибка инструмента (подробности скрыты, чтобы не показать секреты).'));
process.on('unhandledRejection', () => die('Непредвиденная ошибка инструмента (подробности скрыты, чтобы не показать секреты).'));

// ---- arguments: unknown options are refused (a typo must never silently fall back to production) ----
const VALUE_OPTS = ['api', 'link-file', 'student', 'exam', 'at', 'minutes'], FLAG_OPTS = ['yes'];
const COMMANDS = ['exams', 'students', 'status', 'upload', 'assign', 'delete'];
const USAGE = 'Команды: exams | students | status | upload <exam.json> | assign --student --exam --at [--minutes] [--yes] | delete --exam [--yes]\n'
  + 'Адрес сервера по умолчанию — боевой. Для проверок всегда указывай --api http://127.0.0.1:8090/api';
const raw = process.argv.slice(2), cmd = raw.shift();
const opts = {}, pos = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (!a.startsWith('--')) { pos.push(a); continue; }
  const name = a.slice(2);
  if (FLAG_OPTS.includes(name)) opts[name] = true;
  else if (VALUE_OPTS.includes(name)) {
    const v = raw[i + 1];
    if (v === undefined || v.startsWith('--')) die('У параметра --' + name + ' нет значения.', 2);
    opts[name] = v; i++;
  } else die('Неизвестный параметр ' + a + '.\n' + USAGE, 2);
}
if (!COMMANDS.includes(cmd)) die(USAGE, 2);
const opt = (name, dflt) => (opts[name] === undefined ? dflt : opts[name]);
const flag = (name) => !!opts[name];

let API = String(opt('api', 'https://api.kirillnyun.space/api')).replace(/\/+$/, ''), HOST = '';
try { const u = new URL(API); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw 0; if (u.username || u.password) throw 0; HOST = u.host; }
catch { die('--api должен быть адресом вида https://хост/api (без логина и пароля в адресе).', 2); }
const LINK = opt('link-file', join(homedir(), 'ege-teacher-link.txt'));

const WRITES = ['upload', 'assign', 'delete'];
if (WRITES.includes(cmd)) console.log('Сервер: ' + HOST + (/^(127\.0\.0\.1|localhost)(:|$)/.test(HOST) ? ' (локальный, для проверки)' : ' (БОЕВОЙ)'));

let token = '';
async function call(method, path, body) {
  let r;
  try {
    r = await fetch(API + path, { method, signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
      body: body ? JSON.stringify(body) : undefined });
  } catch { die('Не достучался до сервера ' + HOST + '. Проверь адрес и интернет.'); }
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function login() {
  let text; try { text = readFileSync(LINK, 'utf8'); } catch { die('Не нашёл файл со ссылкой преподавателя (' + LINK + ').'); }
  const l = linkFromText(text);
  if (!l) die('В файле со ссылкой нет ссылки вида #/login/<логин>.<секрет>.');
  const r = await call('POST', '/collections/users/auth-with-password', { identity: l.login, password: l.secret });
  if (r.status !== 200 || !r.json || !r.json.token || !r.json.record || r.json.record.role !== 'teacher') die('Не удалось войти как преподаватель (ответ сервера ' + r.status + ').');
  token = r.json.token;
}
async function all(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await call('GET', path + (path.includes('?') ? '&' : '?') + 'perPage=500&page=' + page + '&skipTotal=1');
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.items)) die('Сервер ответил ' + r.status + ' на ' + path.split('?')[0] + '.');
    out.push(...r.json.items); if (r.json.items.length < 500) return out;
  }
}
const fmt = (ts) => new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
// The catalog order = the numbering shown to the owner and in the panel: ascending creation time, ties by id.
const exams = () => all('/collections/exams/records?sort=created,id&fields=id,title,full,created');
const examName = (list, e) => '№' + (list.indexOf(e) + 1) + ' · ' + e.title;
async function people() {
  const users = await all('/collections/users/records?filter=' + encodeURIComponent('role="student"') + '&fields=id,name,login,active');
  const leads = await call('GET', '/ege/leads');
  const prof = {}; (leads.json && leads.json.items || []).forEach((p) => { prof[p.user] = p; });
  return users.filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name || u.login, login: u.login, lead: !!prof[u.id] && !prof[u.id].mine }));
}

await login();

if (cmd === 'exams') {
  const list = await exams();
  list.forEach((e) => console.log(examName(list, e) + (e.full ? ' (полный вариант)' : '')));
  if (!list.length) console.log('Каталог пуст.');
} else if (cmd === 'students') {
  (await people()).forEach((p) => console.log('• ' + p.name + ' (' + p.login + ')' + (p.lead ? ' — из канала' : '')));
} else if (cmd === 'status') {
  const [asg, ex, ph, ppl] = await Promise.all([all('/collections/exam_assignments/records?fields=id,user,exam,start,duration,opened,finished,photos_done,settled,checked,p1'),
    exams(), all('/collections/exam_photos/records?fields=id,assignment'), people()]);
  const now = Math.floor(Date.now() / 1000);
  asg.sort((a, b) => b.start - a.start).forEach((a) => {
    const phase = Core.phase(a, now), who = (ppl.find((p) => p.id === a.user) || {}).name || '—', e = ex.find((x) => x.id === a.exam);
    console.log('• ' + who + ' · ' + (e ? examName(ex, e) : '—') + ' · ' + fmt(a.start) + ' · ' + P.PHASE_TEXT[phase] + (a.settled ? ' · 1 часть: ' + a.p1 : '') + ' · фото: ' + ph.filter((x) => x.assignment === a.id).length);
  });
  if (!asg.length) console.log('Назначений нет.');
} else if (cmd === 'upload') {
  const file = pos[0]; if (!file || pos.length > 1) die('Укажи один файл: upload <exam.json>', 2);
  let exam; try { exam = JSON.parse(readFileSync(file, 'utf8')); } catch { die('Не прочитал файл как JSON: ' + file); }
  const r = checkExam(exam);
  r.warnings.forEach((w) => console.log('ВНИМАНИЕ: ' + w));
  if (r.errors.length) { r.errors.forEach((e) => console.log('ОШИБКА: ' + e)); die('Не загружаю: в файле есть ошибки (' + r.errors.length + ').'); }
  const before = await exams();
  if (before.some((e) => e.title.trim().toLowerCase() === exam.title.trim().toLowerCase())) die('Пробник с названием «' + exam.title + '» уже есть. Смени название.');
  const res = await call('POST', '/collections/exams/records', { title: exam.title, full: !!exam.full, tasks: exam.tasks, key: exam.key });
  if (res.status === 413) die('Сервер отклонил размер файла (413): на сервере не применена настройка Caddy из backend/README.md.');
  if (res.status !== 200 || !res.json || !res.json.id) die('Сервер ответил ' + res.status + '. Ничего не загружено.');
  const after = await exams(), idx = after.findIndex((e) => e.id === res.json.id);
  console.log('Загружено: №' + (idx + 1) + ' · «' + exam.title + '» (' + r.stats.short + ' + ' + r.stats.long + ' заданий). Ученики его не видят, пока ты не назначишь.');
} else if (cmd === 'assign') {
  const [list, ppl] = await Promise.all([exams(), people()]);
  const s = pickOne(ppl, opt('student'), (p) => p.name), e = pickExam(list, opt('exam'), (x) => x.title);
  if (s.error) die('Ученик: ' + s.error); if (e.error) die('Пробник: ' + e.error);
  const start = parseWhen(opt('at')); if (!start) die('Время: укажи --at "ГГГГ-ММ-ДД ЧЧ:ММ" (по Москве).');
  const minutes = Number(opt('minutes', '235'));
  if (!(minutes >= 1 && minutes <= 360)) die('Минут на работу: от 1 до 360.');
  console.log('Назначу: ' + s.item.name + ' · ' + examName(list, e.item) + ' · ' + fmt(start) + ' (МСК) · ' + minutes + ' мин.');
  console.log('Ученику сразу уйдёт сообщение в Telegram, потом напоминание за час.');
  if (start < Math.floor(Date.now() / 1000)) console.log('ВНИМАНИЕ: это время уже прошло, пробник откроется сразу.');
  if (!flag('yes')) die('Ничего не сделано. Подтверди и добавь --yes.', 3);
  const r = await call('POST', '/ege/exams/assign', { user: s.item.id, exam: e.item.id, start, duration: Math.round(minutes * 60) });
  if (r.status === 400) die('Сервер отказал: такой пробник этому ученику уже назначен, или данные не подошли.');
  if (r.status !== 200) die('Сервер ответил ' + r.status + '.');
  console.log('Назначено. Ученик получил сообщение.');
} else if (cmd === 'delete') {
  const list = await exams(), e = pickExam(list, opt('exam'), (x) => x.title);
  if (e.error) die('Пробник: ' + e.error);
  console.log('Удалю из каталога: ' + examName(list, e.item) + ' (только если его ни разу не назначали). Номера следующих пробников сдвинутся на 1.');
  if (!flag('yes')) die('Ничего не сделано. Подтверди и добавь --yes.', 3);
  const r = await call('DELETE', '/collections/exams/records/' + e.item.id);
  if (r.status !== 204 && r.status !== 200) die(r.status === 400 ? 'Нельзя: пробник уже назначали ученикам.' : 'Сервер ответил ' + r.status + '.');
  console.log('Удалено.');
}
