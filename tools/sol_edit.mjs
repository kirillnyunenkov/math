#!/usr/bin/env node
/* Applies edits to img/tN/sol.js (the solutions are stored there as JSON).
   Usage:  node tools/sol_edit.mjs edits.json
   edits.json is a list of
     {"n": 9, "id": 9, "fig": "img/t9/sol/9.svg", "alt": "..."}   figure right after the "idea" block
     {"n": 11, "id": 94, "find": "...", "replace": "..."}         exact text replacement (must match once)
   A figure that is already in the solution is replaced, so the script can be re-run. */
import fs from 'node:fs';
const edits = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cache = {};
const load = n => {
  if (!cache[n]) { const w = {}; new Function('window', fs.readFileSync(`img/t${n}/sol.js`, 'utf8'))(w); cache[n] = w.SOLDATA[n]; }
  return cache[n];
};
for (const e of edits) {
  const S = load(e.n);
  let h = S[e.id];
  if (!h) throw new Error(`t${e.n} #${e.id}: no solution`);
  if (e.fig) {
    if (!fs.existsSync(e.fig)) throw new Error(`t${e.n} #${e.id}: ${e.fig} does not exist`);
    if (!e.alt) throw new Error(`t${e.n} #${e.id}: figure needs alt text`);
    const tag = `\n<p class="sol-fig"><img src="${e.fig}" alt="${e.alt.replace(/"/g, '&quot;')}"></p>`;
    h = h.replace(/\n<p class="sol-fig">[\s\S]*?<\/p>/, '');
    const out = h.replace(/(<p class="sol-idea">[\s\S]*?<\/p>)/, `$1${tag}`);
    if (out === h) throw new Error(`t${e.n} #${e.id}: no sol-idea block to attach the figure to`);
    h = out;
  } else {
    const parts = h.split(e.find);
    if (parts.length !== 2) throw new Error(`t${e.n} #${e.id}: "find" matched ${parts.length - 1} times, expected 1`);
    h = parts.join(e.replace);
  }
  S[e.id] = h;
  console.log(`t${e.n} #${e.id}: ${e.fig ? 'figure' : 'text'} updated`);
}
for (const n of Object.keys(cache))
  fs.writeFileSync(`img/t${n}/sol.js`, 'window.SOLDATA=window.SOLDATA||{};\n' + `window.SOLDATA[${n}]=` + JSON.stringify(cache[n]) + ';\n');
