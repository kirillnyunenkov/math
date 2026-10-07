/* "Мои пробники": the HTML of the page as strings (no DOM), so that it can be tried in node.
   Used by exam.js (renderMy); data comes from GET /api/ege/exams/summary. */
(function (root) {
  'use strict';
  const H = typeof module === 'object' && module.exports ? require('./exam-history-core.js') : root.ExamHistoryCore;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = (x) => (x < 10 ? '0' : '') + x;
  // Moscow time is UTC+3 all year round.
  const moscow = (ts) => new Date((ts + 10800) * 1000);
  const dm = (ts) => { const d = moscow(ts); return p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1); };
  const dmy = (ts) => { const d = moscow(ts); return dm(ts) + '.' + d.getUTCFullYear(); };
  const wellFormed = (it) => !!it && typeof it === 'object' && typeof it.id === 'string' && typeof it.date === 'number' && it.scores && typeof it.scores === 'object';

  // Drills (full === false) may be numbered 1..40 and hold any tasks: they do not fit the 20 rows of an exam.
  const isFull = (it) => it.full !== false;

  function tableHtml(all) {
    const items = all.filter(isFull);
    if (!items.length) return '';
    const head = '<tr><th class="my-n"></th>' + items.map((it) => '<th title="' + esc(it.title) + '">' + dm(it.date) + '</th>').join('') + '<th class="my-sol">Решаемость</th></tr>';
    const rows = H.NUMS.map((n) => {
      const sol = H.solvability(items, n);
      return '<tr><th class="my-n">' + n + '</th>' + items.map((it) => {
        const s = H.cellState(it, n), v = it.scores[n];
        return '<td class="my-c my-' + s + '">' + (s === 'na' ? '-' : s === 'blank' ? '' : v) + '</td>';
      }).join('') + '<td class="my-sol">' + (sol === null ? '-' : sol + '%') + '</td></tr>';
    }).join('');
    const total = (label, f) => '<tr class="my-total"><th class="my-n">' + label + '</th>' + items.map((it) => { const v = f(it); return '<td>' + (v === null ? '' : v) + '</td>'; }).join('') + '<td></td></tr>';
    return '<div class="my-scroll" data-my-scroll><table class="my-tbl">' + head + rows + total('Первичный<br>балл', H.primaryOf) + total('Тестовый<br>балл', H.testOf) + '</table></div>';
  }

  // Test score by exam, inline SVG. Wide enough that the labels stay readable: a phone scrolls it sideways.
  function chartHtml(all) {
    const pts = all.filter(isFull).map((it) => ({ it: it, t: H.testOf(it) })).filter((p) => p.t !== null);
    if (pts.length < 2) return '';
    const L = 34, R = 18, T = 20, B = 30, Hh = 210, W = Math.max(340, pts.length * 56 + L + R);
    const x = (i) => L + i * (W - L - R) / (pts.length - 1), y = (t) => T + (100 - t) / 100 * (Hh - T - B);
    const grid = [0, 50, 100].map((g) => '<line class="my-gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '"/><text class="my-gt" x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + g + '</text>').join('');
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.t).toFixed(1)).join(' ');
    const dots = pts.map((p, i) => '<circle class="my-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(p.t).toFixed(1) + '" r="4.5"/>' +
      '<text class="my-vt" x="' + x(i).toFixed(1) + '" y="' + (y(p.t) - 9).toFixed(1) + '" text-anchor="middle">' + p.t + '</text>' +
      '<text class="my-dt" x="' + x(i).toFixed(1) + '" y="' + (Hh - 8) + '" text-anchor="middle">' + dm(p.it.date) + '</text>').join('');
    return '<div class="my-scroll" data-my-scroll><svg class="my-ch" width="' + W + '" height="' + Hh + '" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Тестовый балл по пробникам">' +
      grid + '<path class="my-line" d="' + line + '"/>' + dots + '</svg></div>';
  }

  function listHtml(items, seen) {
    return items.slice().reverse().map((it) => {
      const prim = H.primaryOf(it), max = H.maxOfItem(it), test = H.testOf(it);
      const score = prim + ' из ' + max + (test === null || !isFull(it) ? '' : ' · тест ' + test);
      const isExam = it.kind === 'exam', fresh = isExam && (seen || []).indexOf(it.id) < 0;
      const body = '<span class="my-r-body"><span class="my-r-t">' + esc(it.title) + (fresh ? ' <span class="my-new">новое</span>' : '') + '</span>' +
        '<span class="my-r-s">' + dmy(it.date) + ' · ' + score + (isExam ? '' : ' · записан вручную') + '</span></span>';
      return isExam ? '<button class="my-row" data-exam="' + esc(it.id) + '">' + body + '<span class="my-r-go">Открыть</span></button>'
        : '<div class="my-row my-manual">' + body + '</div>';
    }).join('');
  }

  function pageHtml(list, opt) {
    const items = (Array.isArray(list) ? list : []).filter(wellFormed);
    // opt.top: ready HTML (the exams that are still ahead) shown right under the title.
    const top = (opt && opt.top) || '';
    if (!items.length) return '<div class="vintro"><h2>Мои пробники</h2><p class="lead my-empty">Здесь появятся твои пробники после проверки. Когда я проверю работу, она останется здесь, и её можно будет открыть в любой момент.</p>' +
      '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>' + top;
    const chart = chartHtml(items), table = tableHtml(items);
    return '<div class="vintro"><h2>Мои пробники</h2><p class="lead">Все проверенные работы: баллы, разбор и мои комментарии.</p></div>' + top +
      (chart ? '<section class="my-card"><h3>Тестовый балл</h3>' + chart + '</section>' : '') +
      (table ? '<section class="my-card"><h3>Баллы по заданиям</h3>' + table +
      '<p class="my-legend">Зелёный: максимум, жёлтый: часть баллов, красный: 0, пусто: не решал, «-»: задания не было в варианте. Решаемость: какую долю баллов за это задание ты набрал по всем пробникам.</p></section>' : '') +
      '<section class="my-card"><h3>Все пробники</h3><div class="my-list">' + listHtml(items, (opt && opt.seen) || []) + '</div></section>';
  }

  const api = { pageHtml: pageHtml, chartHtml: chartHtml, tableHtml: tableHtml, listHtml: listHtml };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamMyView = api;
})(typeof self !== 'undefined' ? self : globalThis);
