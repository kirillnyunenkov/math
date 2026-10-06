// tools/exam-cli-lib.mjs — pure helpers of tools/exam_api.mjs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const P = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'exam-panel-core.js'));

// "2026-10-09 18:00" or "2026-10-09T18:00", Moscow time.
export const parseWhen = (s) => P.moscowInputToTs(String(s || '').trim().replace(' ', 'T'));

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
