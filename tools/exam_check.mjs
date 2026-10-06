// tools/exam_check.mjs — checks an exam file before it is uploaded:
//   node tools/exam_check.mjs ~/math-source/exams/proba-1/exam.json
// Exit code 1 when there are errors.
import { readFileSync } from 'node:fs';
import { checkExam } from './exam-check-lib.mjs';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/exam_check.mjs <exam.json>'); process.exit(2); }
let exam;
try { exam = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error('Cannot read JSON: ' + e.message); process.exit(1); }

const r = checkExam(exam);
const isObj = exam && typeof exam === 'object' && !Array.isArray(exam);
const tasks = isObj && Array.isArray(exam.tasks) ? exam.tasks : [];
const key = isObj && exam.key && typeof exam.key === 'object' ? exam.key : {};
console.log('«' + (isObj ? exam.title : '?') + '»: ' + r.stats.short + ' заданий первой части, ' + r.stats.long + ' второй' + (isObj && exam.full ? ', полный вариант' : ''));
console.log('Ответы первой части (сверь с исходником):');
tasks.filter((t) => t && t.kind === 'short').forEach((t) => console.log('  ' + t.n + ': ' + (key[String(t.n)] || {}).a));
r.warnings.forEach((w) => console.log('ВНИМАНИЕ: ' + w));
r.errors.forEach((e) => console.log('ОШИБКА: ' + e));
console.log(r.errors.length ? '\nНе загружать: ' + r.errors.length + ' ошибок.' : '\nОшибок нет, можно загружать.');
process.exit(r.errors.length ? 1 : 0);
