// tools/exam-check-lib.mjs — validation plus formula rendering, shared by exam_check.mjs and exam_api.mjs.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const V = require(join(ROOT, 'exam-validate.js'));
const katex = require(join(ROOT, 'katex/katex.min.js'));

// A formula that does not render is an error: it must not reach the students.
export function checkExam(exam) {
  const r = V.validateExam(exam), errors = r.errors.slice(), warnings = r.warnings.slice();
  if (!errors.length) {
    const bad = (where, html) => V.extractFormulas(html).forEach((f) => {
      try { katex.renderToString(f.tex, { throwOnError: true, displayMode: f.display }); }
      catch (e) { errors.push(where + ': формула «' + f.tex.slice(0, 40) + '» не рисуется (' + String(e.message).split('\n')[0] + ')'); }
    });
    exam.tasks.forEach((t) => {
      const k = exam.key[String(t.n)];
      bad('Задание ' + t.n + ', условие', t.cond);
      if (t.kind === 'short') bad('Задание ' + t.n + ', решение', k.sol); else bad('Задание ' + t.n + ', ответ', k.a);
    });
  }
  return { errors: errors, warnings: warnings, stats: r.stats };
}
