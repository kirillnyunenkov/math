// tools/exam-cli-lib.mjs — pure helpers of tools/exam_api.mjs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const P = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'exam-panel-core.js'));

// "2026-10-09 18:00" or "2026-10-09T18:00", Moscow time.
// A date that does not exist (02-31) or a clock time past 23:59 would roll over silently, so the timestamp
// must convert back to exactly the same text.
export function parseWhen(s) {
  const text = String(s || '').trim().replace(' ', 'T');
  const ts = P.moscowInputToTs(text);
  return ts !== null && P.tsToMoscowInput(ts) === text ? ts : null;
}

const BAD_WHEN = 'Время: укажи --at "ГГГГ-ММ-ДД ЧЧ:ММ" (по Москве), такой даты или времени не бывает.';
// Same year bounds as the panel's assign form: not 2 years ahead or more, not more than 1 year back
// (anything else is a typo in the year). A start in the past is allowed (the exam opens at once): `past` flags it.
export function checkWhen(s, nowSec) {
  const ts = parseWhen(s);
  if (ts === null) return { error: BAD_WHEN };
  if (ts >= nowSec + 2 * 365 * 86400 || ts < nowSec - 365 * 86400) return { error: 'Время: похоже на опечатку в годе (' + String(s).trim() + '). Можно от года назад до двух лет вперёд.' };
  return { ts, past: ts < nowSec };
}

// An exact (case-insensitive) name wins; otherwise a unique fragment; otherwise an explanation.
export function pickOne(items, query, getName) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { error: 'Не указано, что искать.' };
  const exact = items.filter((x) => getName(x).toLowerCase() === q);
  if (exact.length === 1) return { item: exact[0] };
  const part = items.filter((x) => getName(x).toLowerCase().includes(q));
  if (part.length === 1) return { item: part[0] };
  if (!part.length) return { error: 'Не нашёл «' + query + '». Есть: ' + items.map(getName).join(', ') + '.' };
  return { error: 'Подходит несколько: ' + part.map(getName).join(', ') + '. Уточни.' };
}

// The catalog is numbered 1..N in the order the list is given (creation order, as in the panel).
// "3" or "№3" is a number (a number always wins over a title that happens to be digits);
// anything else goes through pickOne.
export function pickExam(exams, query, getTitle) {
  const q = String(query == null ? '' : query).trim();
  const m = /^№?\s*(\d+)$/.exec(q);
  if (!m) return pickOne(exams, q, getTitle);
  const n = Number(m[1]);
  if (n >= 1 && n <= exams.length) return { item: exams[n - 1] };
  return { error: 'Нет пробника №' + m[1] + '. Есть: ' + (exams.length ? exams.map((e, i) => '№' + (i + 1) + ' · ' + getTitle(e)).join('; ') : 'каталог пуст') + '.' };
}

export function linkFromText(text) {
  const m = /#\/login\/([a-z0-9_-]+)\.([A-Za-z0-9]+)/.exec(String(text || ''));
  return m ? { login: m[1], secret: m[2] } : null;
}

// A link to the solutions: https only, no spaces, no credentials in the address, at most 500 characters.
export function checkSolutionUrl(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return { error: 'Укажи ссылку: --url https://…' };
  if (s.length > 500) return { error: 'Ссылка длиннее 500 символов.' };
  let u; try { u = new URL(s); } catch { return { error: 'Это не ссылка. Нужна вида https://…' }; }
  if (u.protocol !== 'https:' || /\s/.test(s) || u.username || u.password) return { error: 'Нужна ссылка https:// без пробелов, логина и пароля.' };
  return { url: u.href };
}
