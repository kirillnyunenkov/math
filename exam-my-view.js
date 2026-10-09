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
    const last = items.length - 1, isLast = (i) => items.length > 1 && i === last;   // the newest exam: only its date is marked
    const head = '<tr><th class="my-n"></th>' + items.map((it, i) => '<th' + (isLast(i) ? ' class="my-last"' : '') + ' title="' + esc(it.title) + '">' + dm(it.date) + '</th>').join('') + '<th class="my-sol">Решаемость</th></tr>';
    const rows = H.NUMS.map((n) => {
      const sol = H.solvability(items, n);
      const slc = sol === null ? '' : sol < 50 ? ' my-sl' : sol < 80 ? ' my-sm' : '';
      return '<tr' + (n === 14 ? ' class="my-p2"' : '') + '><th class="my-n">' + n + '</th>' + items.map((it, i) => {
        const s = H.cellState(it, n), v = it.scores[n];
        return '<td class="my-c my-' + s + '">' + (s === 'na' ? '-' : s === 'blank' ? '' : v) + '</td>';
      }).join('') + '<td class="my-sol' + slc + '">' + (sol === null ? '-' : sol + '%') + '</td></tr>';
    }).join('');
    const total = (label, f, first) => '<tr class="my-total' + (first ? ' my-p2' : '') + '"><th class="my-n">' + label + '</th>' + items.map((it) => { const v = f(it); return '<td>' + (v === null ? '' : v) + '</td>'; }).join('') + '<td></td></tr>';
    return '<div class="my-scroll" data-my-scroll><table class="my-tbl">' + head + rows + total('Первичный<br>балл', H.primaryOf, true) + total('Тестовый<br>балл', H.testOf, false) + '</table></div>';
  }

  // Hover a cell with the mouse: everything outside its row and column is dimmed, so a wide table is easy to follow.
  function bindTables(el) {
    if (!el || !el.querySelectorAll) return;
    el.querySelectorAll('table.my-tbl').forEach((tbl) => {
      const clear = () => { tbl.classList.remove('my-focus'); tbl.querySelectorAll('.my-hr,.my-hc').forEach((c) => c.classList.remove('my-hr', 'my-hc')); };
      const show = (cell) => {
        clear();
        tbl.classList.add('my-focus');
        const r = cell.parentNode.rowIndex, c = cell.cellIndex;
        Array.prototype.forEach.call(tbl.rows, (row) => Array.prototype.forEach.call(row.cells, (x) => {
          if (row.rowIndex === r) x.classList.add('my-hr');
          if (x.cellIndex === c) x.classList.add('my-hc');
        }));
      };
      const cellOf = (e) => { const t = e.target && e.target.closest ? e.target.closest('td.my-c') : null; return t && tbl.contains(t) ? t : null; };
      // Mouse only: a finger has no hover, and a tap would leave the dimming stuck.
      tbl.addEventListener('pointerover', (e) => { const c = e.pointerType === 'mouse' ? cellOf(e) : null; if (c) show(c); });
      tbl.addEventListener('pointerleave', clear);
    });
  }

  // Test score by exam, inline SVG. Many exams: wide enough that the labels stay readable, a phone scrolls it sideways.
  function chartHtml(all) {
    const pts = all.filter(isFull).map((it) => ({ it: it, t: H.testOf(it) })).filter((p) => p.t !== null);
    if (pts.length < 2) return '';
    const L = 34, R = 18, T = 20, B = 30, Hh = 210, need = pts.length * 56 + L + R, W = Math.max(340, need);
    // A few points fit any phone: the chart then shrinks with the card instead of scrolling (the axis labels stay in view).
    const fit = need <= 340;
    const x = (i) => L + i * (W - L - R) / (pts.length - 1), y = (t) => T + (100 - t) / 100 * (Hh - T - B);
    const grid = [0, 50, 100].map((g) => '<line class="my-gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '"/><text class="my-gt" x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + g + '</text>').join('');
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.t).toFixed(1)).join(' ');
    const dots = pts.map((p, i) => '<circle class="my-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(p.t).toFixed(1) + '" r="4.5"/>' +
      '<text class="my-vt" x="' + x(i).toFixed(1) + '" y="' + (y(p.t) - 9).toFixed(1) + '" text-anchor="middle">' + p.t + '</text>' +
      '<text class="my-dt" x="' + x(i).toFixed(1) + '" y="' + (Hh - 8) + '" text-anchor="middle">' + dm(p.it.date) + '</text>').join('');
    return '<div class="my-scroll" data-my-scroll><svg class="my-ch' + (fit ? ' my-fit' : '') + '" width="' + W + '" height="' + Hh + '" viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="Тестовый балл по пробникам">' +
      grid + '<path class="my-line" d="' + line + '"/>' + dots + '</svg></div>';
  }

  // readonly: the teacher's view, no "Открыть" buttons (the exam opens in the check page of the panel instead).
  function listHtml(items, seen, readonly) {
    return items.slice().reverse().map((it) => {
      const prim = H.primaryOf(it), max = H.maxOfItem(it), test = H.testOf(it);
      const score = prim + ' из ' + max + (test === null || !isFull(it) ? '' : ' · тест ' + test);
      const isExam = it.kind === 'exam' && !readonly, fresh = isExam && (seen || []).indexOf(it.id) < 0;
      const body = '<span class="my-r-body"><span class="my-r-t">' + esc(it.title) + (fresh ? ' <span class="my-new">новое</span>' : '') + '</span>' +
        '<span class="my-r-s">' + dmy(it.date) + ' · ' + score + (it.kind === 'exam' ? '' : ' · записан вручную') + '</span></span>';
      return isExam ? '<button class="my-row" data-exam="' + esc(it.id) + '">' + body + '<span class="my-r-go">Открыть</span></button>'
        : '<div class="my-row my-manual">' + body + '</div>';
    }).join('');
  }

  // The chart, the task table and the list of exams: the same cards for the student page and the teacher's student card.
  function dashboardHtml(items, opt) {
    const chart = chartHtml(items), table = tableHtml(items);
    return (chart ? '<section class="my-card"><h3>Тестовый балл</h3>' + chart + '</section>' : '') +
      (table ? '<section class="my-card"><h3>Баллы по заданиям</h3>' + table +
      '<p class="my-legend">Зелёный: максимум, жёлтый: часть баллов, красный: 0, пусто: не решал, «-»: задания не было в варианте. Линия перед 14-м заданием отделяет вторую часть. Наведи мышь на ячейку, чтобы выделить её строку и столбец. Решаемость: какую долю баллов за это задание ' + ((opt && opt.readonly) ? 'ученик набрал' : 'ты набрал') + ' по всем пробникам.</p></section>' : '') +
      '<section class="my-card"><h3>Все пробники</h3><div class="my-list">' + listHtml(items, (opt && opt.seen) || [], !!(opt && opt.readonly)) + '</div></section>';
  }

  function pageHtml(list, opt) {
    const items = (Array.isArray(list) ? list : []).filter(wellFormed);
    // opt.top: ready HTML (the exams that are still ahead) shown right under the title.
    const top = (opt && opt.top) || '';
    if (!items.length) return '<div class="vintro"><h2>Мои пробники</h2><p class="lead my-empty">Здесь появятся твои пробники после проверки. Когда я проверю работу, она останется здесь, и её можно будет открыть в любой момент.</p>' +
      '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>' + top;
    return '<div class="vintro"><h2>Мои пробники</h2><p class="lead">Все проверенные работы: баллы, разбор и мои комментарии.</p></div>' + top + dashboardHtml(items, opt);
  }

  const api = { pageHtml: pageHtml, dashboardHtml: dashboardHtml, chartHtml: chartHtml, tableHtml: tableHtml, bindTables: bindTables, listHtml: listHtml };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamMyView = api;
})(typeof self !== 'undefined' ? self : globalThis);
