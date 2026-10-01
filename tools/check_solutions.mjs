#!/usr/bin/env node
/* Checks img/tN/sol.js against the solutions policy:
     - a solution exists for every prototype representative of tasks 1-13
       and for nothing else (similar tasks show the answer only);
     - no inline images, only whitelisted tags;
     - every formula parses in KaTeX;
     - tasks 1-12 follow the "idea + steps" structure;
     - the bank answer shows up in the solution text.
   Run from the repo root:  node tools/check_solutions.mjs        */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const katex = require('../katex/katex.min.js');

globalThis.window = {};
const cfg = fs.readFileSync('config.js', 'utf8');
const protoList = new Function(cfg + ';return protoList;')();

const ALLOWED = new Set(['img', 'p', 'ol', 'li', 'b', 'br', 'div', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'i', 'em', 'strong', 'sub', 'sup']);
const norm = s => String(s).replace(/<[^>]+>/g, '').replace(/[\s\\$,{}]| |&thinsp;|&nbsp;/g, '').replace(/−|&minus;/g, '-');
let errors = 0, warns = 0, total = 0;
const err = (n, id, m) => { errors++; console.log(`ERROR t${n} #${id}: ${m}`); };
const warn = (n, id, m) => { warns++; console.log(`warn  t${n} #${id}: ${m}`); };

for (let n = 1; n <= 13; n++) {
  new Function('window', fs.readFileSync(`img/t${n}/data.js`, 'utf8'))(window);
  new Function('window', fs.readFileSync(`img/t${n}/sol.js`, 'utf8'))(window);
  const T = window.TASKDATA[n], S = window.SOLDATA[n];
  const reps = protoList(n).map(g => g.ids[0]);
  for (const r of reps) if (!S[r]) err(n, r, 'prototype has no solution');
  for (const k of Object.keys(S)) {
    const id = +k, html = S[k];
    total++;
    if (!reps.includes(id)) { err(n, id, 'solution on a non-prototype task'); continue; }
    if (/base64/.test(html)) err(n, id, 'inline image');
    // the only images allowed are annotated figures made by tools/annotate_figs.py
    for (const m of html.matchAll(/<img\b[^>]*>/g)) {
      const src = (/src="([^"]+)"/.exec(m[0]) || [])[1] || '';
      if (!new RegExp(`^img/t${n}/sol/[\\w-]+\\.svg$`).test(src)) err(n, id, `image src "${src}" is not a solution figure`);
      else if (!fs.existsSync(src)) err(n, id, `figure file ${src} is missing`);
      if (!/alt="[^"]+"/.test(m[0])) err(n, id, 'figure without alt text');
    }
    for (const m of html.matchAll(/<\/?([a-zA-Z][\w-]*)/g))
      if (!ALLOWED.has(m[1].toLowerCase())) err(n, id, `tag <${m[1]}> is not allowed`);
    if (n <= 12) {
      if (!/class="sol-idea"/.test(html)) err(n, id, 'no sol-idea block');
      if (!/<ol class="sol-steps">[\s\S]*<li>[\s\S]*<\/ol>/.test(html)) err(n, id, 'no sol-steps list');
      if (/Ответ:/.test(html)) warn(n, id, 'has its own "Ответ:" line (the trainer already shows the answer)');
    }
    // formulas: $$...$$ first, then $...$
    let rest = html;
    const formulas = [];
    rest = rest.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => { formulas.push([f, true]); return ' '; });
    rest = rest.replace(/\$([^$]+?)\$/g, (_, f) => { formulas.push([f, false]); return ' '; });
    if (rest.includes('$')) err(n, id, 'unbalanced $');
    for (const [f, display] of formulas) {
      if (/<[a-zA-Z\/!]/.test(f)) err(n, id, `"<" right before a letter inside a formula reads as an HTML tag: ${f.slice(0, 50)}`);
      try { katex.renderToString(f, { displayMode: display, throwOnError: true, strict: 'error' }); }
      catch (e) { err(n, id, `KaTeX: ${e.message.slice(0, 120)} — in: ${f.slice(0, 60)}`); }
    }
    if (/\d\.\d/.test(formulas.map(f => f[0]).join(' '))) warn(n, id, 'decimal point instead of comma in a formula');
    const a = norm(T[id - 1].a);
    if (a && !norm(html).includes(a)) warn(n, id, `bank answer "${T[id - 1].a}" not found in the text`);
  }
}
console.log(`\n${total} solutions checked, ${errors} errors, ${warns} warnings`);
process.exit(errors ? 1 : 0);
