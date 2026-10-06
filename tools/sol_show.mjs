#!/usr/bin/env node
/* Prints everything needed to work on one solution: the statement, the bank answer,
   the statement figure, the prototype group and the current solution HTML.
   Usage (repo root):  node tools/sol_show.mjs 5 44     task 5, id 44
                       node tools/sol_show.mjs 5 p7     task 5, prototype 7
                       node tools/sol_show.mjs 5        list of prototypes of task 5 */
import fs from 'node:fs';
const [nArg, which] = process.argv.slice(2);
const n = +nArg;
if (!n) { console.error('usage: node tools/sol_show.mjs <task> [<id> | p<prototype>]'); process.exit(1); }
const w = {};
const protoList = new Function(fs.readFileSync('config.js', 'utf8') + ';return protoList;')();
new Function('window', fs.readFileSync(`img/t${n}/data.js`, 'utf8'))(w);
const solPath = `img/t${n}/sol.js`;
if (fs.existsSync(solPath)) new Function('window', fs.readFileSync(solPath, 'utf8'))(w);
const T = w.TASKDATA[n], S = (w.SOLDATA || {})[n] || {};
const text = h => h.replace(/<img[^>]*>/g, ' [рисунок] ').replace(/<\/(p|li|tr)>/g, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&thinsp;|&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/[ \t]+/g, ' ').trim();
const groups = protoList(n) || T.map((_, i) => ({ p: i + 1, ids: [i + 1] }));

if (!which) {
  for (const g of groups) {
    const t = T[g.ids[0] - 1];
    console.log(`p${g.p}\tid ${g.ids[0]}\t${t.art}\t${S[g.ids[0]] ? (/sol-fig|<table/.test(S[g.ids[0]]) ? 'visual' : 'text') : 'NO SOLUTION'}\t${text(t.c).slice(0, 90)}`);
  }
  process.exit(0);
}
const g = /^p\d+$/i.test(which) ? groups.find(x => x.p === +which.slice(1)) : groups.find(x => x.ids.includes(+which));
const id = /^p\d+$/i.test(which) ? g && g.ids[0] : +which;
const t = T[id - 1];
if (!t) { console.error(`task ${n}: nothing found for "${which}"`); process.exit(1); }
const fig = /<img[^>]*src="([^"]+)"[^>]*>/.exec(t.c);
console.log(`TASK ${n}  id ${id}  art ${t.art}  prototype ${g ? g.p : '?'}  group ids: ${g ? g.ids.join(', ') : '?'}`);
if (g && g.ids[0] !== id) console.log(`NOTE: id ${id} is a similar task; solutions belong to the representative, id ${g.ids[0]}`);
console.log(`\nSTATEMENT\n${text(t.c)}`);
console.log(`\nBANK ANSWER: ${text(String(t.a))}`);
console.log(`STATEMENT FIGURE: ${fig ? fig[1] + '  ' + ((/width="(\d+)"/.exec(fig[0]) || [])[1] || '?') + ' px wide' : 'none'}`);
console.log(`\nSOLUTION HTML\n${S[id] || '(none)'}`);
