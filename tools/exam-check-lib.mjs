// tools/exam-check-lib.mjs — validation plus formula rendering, shared by exam_check.mjs and exam_api.mjs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const V = require(join(ROOT, 'exam-validate.js'));
const katex = require(join(ROOT, 'katex/katex.min.js'));

const MAX_FORMULA_ERRORS = 30;

// A formula that does not render is an error: it must not reach the students.
// Only the first MAX_FORMULA_ERRORS are listed, the rest is counted in one summary line.
export function checkExam(exam) {
  const r = V.validateExam(exam), errors = r.errors.slice(), warnings = r.warnings.slice();
  if (!errors.length) {
    let broken = 0;
    const bad = (where, html) => V.extractFormulas(html).forEach((f) => {
      try { katex.renderToString(f.tex, { throwOnError: true, displayMode: f.display }); }
      catch (e) {
        if (++broken <= MAX_FORMULA_ERRORS) errors.push(where + ': формула «' + f.tex.slice(0, 40) + '» не рисуется (' + String(e.message).split('\n')[0] + ')');
      }
    });
    exam.tasks.forEach((t) => {
      const k = exam.key[String(t.n)];
      bad('Задание ' + t.n + ', условие', t.cond);
      if (t.kind === 'short') bad('Задание ' + t.n + ', решение', k.sol); else bad('Задание ' + t.n + ', ответ', k.a);
    });
    if (broken > MAX_FORMULA_ERRORS) errors.push('…и ещё ' + (broken - MAX_FORMULA_ERRORS) + ' формул не рисуются');
  }
  return { errors: errors, warnings: warnings, stats: r.stats };
}
