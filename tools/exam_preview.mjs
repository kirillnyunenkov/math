// Static preview of an exam for the owner's review (no server needed, works offline):
//   node tools/exam_preview.mjs ~/math-source/exams/proba-1/exam.json [out.html]   -> preview.html next to the file
// The page embeds the (gate-checked) HTML of each field as is and renders formulas in the browser with the
// repo's KaTeX and the same renderMathInElement call the site uses, so what the owner sees is what the site draws.
// Refuses to build when checkExam reports errors; HTML that fails htmlProblem is never embedded.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { checkExam } from './exam-check-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const V = require(join(ROOT, 'exam-validate.js'));

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/exam_preview.mjs <exam.json> [out.html]'); process.exit(2); }
let exam;
try { exam = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error('Не прочитал файл как JSON: ' + file); process.exit(1); }
const out = resolve(process.argv[3] || join(dirname(resolve(file)), 'preview.html'));
// Exam text must never end up inside the (public) repository checkout.
const rel = relative(ROOT, out);
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) { console.error('Не пишу предпросмотр внутрь репозитория (' + ROOT + '): выбери папку снаружи, например рядом с исходником.'); process.exit(2); }

const r = checkExam(exam);
r.warnings.forEach((w) => console.log('ВНИМАНИЕ: ' + w));
if (r.errors.length) { r.errors.forEach((e) => console.log('ОШИБКА: ' + e)); console.error('Предпросмотр не построен: в файле есть ошибки (' + r.errors.length + ').'); process.exit(1); }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Second line of defence after checkExam: only fields that pass the allowlist gate are embedded.
const embed = (html, where) => {
  const p = V.htmlProblem(html);
  if (p) { console.error('Предпросмотр не построен: ' + where + ': ' + p); process.exit(1); }
  return String(html == null ? '' : html);
};
const url = (p) => pathToFileURL(join(ROOT, p)).href;

const key = (t) => exam.key[String(t.n)];
const short = exam.tasks.filter((t) => t.kind === 'short'), long = exam.tasks.filter((t) => t.kind === 'long');
const script = `(function(){var D=[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}];
var els=document.querySelectorAll('.tex'),bad=0;
if(!window.renderMathInElement){document.getElementById('warn').hidden=false;return;}
for(var i=0;i<els.length;i++){try{renderMathInElement(els[i],{delimiters:D,throwOnError:false});}catch(e){bad++;}}
if(bad){document.getElementById('warn').hidden=false;}})();`;
const scriptHash = createHash('sha256').update(script).digest('base64');

const tasksHtml = exam.tasks.map((t) => {
  const k = key(t), where = 'Задание ' + t.n;
  return `<section class="t" id="t${esc(t.n)}"><h3>Задание ${esc(t.n)} <span class="m">· ${t.kind === 'short' ? 'первая часть, 1 балл' : 'вторая часть, максимум ' + esc(t.max)}</span></h3>
<div class="tex">${embed(t.cond, where + ', условие')}</div>
<div class="k"><b>Ответ:</b> ${t.kind === 'short' ? esc(k.a) : '<div class="tex">' + embed(k.a, where + ', ответ') + '</div>'}</div>
${t.kind === 'short' ? '<div class="k"><b>Решение</b><div class="tex">' + embed(k.sol, where + ', решение') + '</div></div>' : '<p class="m">Решение второй части ученику не показывается.</p>'}</section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline' file:; font-src file:; script-src file: 'sha256-${scriptHash}'">
<title>${esc(exam.title)} — предпросмотр</title>
<link rel="stylesheet" href="${url('katex/katex.min.css')}">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#222}
h1{font-size:24px}h3{margin:0 0 8px;font-size:17px}.t{border:1px solid #ddd;border-radius:12px;padding:16px;margin:16px 0}
.k{background:#f4f7fb;border-radius:8px;padding:8px 12px;margin-top:8px}table{border-collapse:collapse}
td,th{border:1px solid #ccc;padding:4px 10px;text-align:left}.m{color:#666;font-size:14px;font-weight:400}img{max-width:100%}
.wrap{overflow-x:auto}.warn{background:#fff3cd;border:1px solid #e0c36a;border-radius:8px;padding:8px 12px}</style></head>
<body>
<h1>${esc(exam.title)}${exam.full ? ' <span class="m">· полный вариант</span>' : ''}</h1>
<p class="m">Первая часть: ${short.length}, вторая: ${long.length}. Так видишь только ты; ученик увидит ответы и решения после сдачи.</p>
<p class="warn" id="warn" hidden>Формулы не нарисовались (нет KaTeX рядом с репозиторием?). Не загружай этот пробник, пока не откроется нормально.</p>
<h2>Ответы первой части (сверь с источником)</h2>
<div class="wrap"><table><thead><tr><th>Задание</th>${short.map((t) => '<th>' + esc(t.n) + '</th>').join('')}</tr></thead>
<tbody><tr><td>Ответ</td>${short.map((t) => '<td>' + esc(key(t).a) + '</td>').join('')}</tr></tbody></table></div>
<h2>Задания</h2>
${tasksHtml}
<script src="${url('katex/katex.min.js')}"></script>
<script src="${url('katex/auto-render.min.js')}"></script>
<script>${script}</script>
</body></html>`;
writeFileSync(out, html);
console.log('Предпросмотр: ' + out);
