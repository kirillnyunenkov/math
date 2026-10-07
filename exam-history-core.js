/* "Мои пробники" — scores of one exam per task, the scales and the dashboard numbers. Pure functions shared by
   the trainer page, the server hooks, the import tool and the tests (node/goja: require, browser: window.ExamHistoryCore).
   ES6-plain: the server runs it on goja.

   An item is { scores: {n: points|null}, na: [n], maxes: {n: max}, test: number } (`maxes` and `test` optional; `test` is the fixed
   test score of an archive exam):
   a number = points (0 included), null = the student did not solve it (a blank cell in the owner's sheet),
   n in `na` = the task did not exist in that variant (the "-" of the sheet; task 6 in the old format). */
(function (root) {
  'use strict';

  const MAXES = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4 };
  const NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  // primary -> test score of the current exam (33 points). Same numbers as SEC_SCORE in index.html: a test keeps them equal.
  // Archive exams have no scale here: each carries its own fixed test score.
  const SCALE_33 = [0, 6, 11, 17, 22, 27, 34, 40, 46, 52, 58, 62, 66, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94, 95, 96, 97, 98, 99, 100, 100, 100];

  const isInt = (v) => typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  const naOf = (item) => (item && Array.isArray(item.na) ? item.na : []);

  function maxFor(item, n) {
    const m = item && item.maxes ? item.maxes[n] : undefined;
    return typeof m === 'number' ? m : (MAXES[n] || 0);
  }

  function cellState(item, n) {
    if (naOf(item).indexOf(n) >= 0) return 'na';
    const v = item && item.scores ? item.scores[n] : null;
    if (typeof v !== 'number') return 'blank';
    return v >= maxFor(item, n) ? 'full' : v > 0 ? 'part' : 'zero';
  }

  function primaryOf(item) {
    let s = 0;
    NUMS.forEach(function (n) { if (cellState(item, n) !== 'na' && typeof item.scores[n] === 'number') s += item.scores[n]; });
    return s;
  }
  function maxOfItem(item) {
    let s = 0;
    NUMS.forEach(function (n) { if (naOf(item).indexOf(n) < 0) s += maxFor(item, n); });
    return s;
  }
  function testScore(primary, max) {
    if (max !== 33 || typeof primary !== 'number' || !(primary >= 0)) return null;
    return SCALE_33[Math.min(Math.floor(primary), SCALE_33.length - 1)];
  }
  // An archive exam has its own fixed score; an exam written in the trainer is converted by the 33 scale.
  const testOf = (item) => (item && typeof item.test === 'number' ? item.test : testScore(primaryOf(item), maxOfItem(item)));
  function checkTest(v) { return isInt(v) && v >= 0 && v <= 100 ? '' : 'Тестовый балл: целое число от 0 до 100.'; }

  // The share of the points won on a task over the exams where it was attempted; null when there is none.
  function solvability(items, n) {
    let got = 0, max = 0;
    (items || []).forEach(function (it) {
      const st = cellState(it, n);
      if (st === 'na' || st === 'blank') return;
      got += it.scores[n]; max += maxFor(it, n);
    });
    return max > 0 ? Math.round(got / max * 100) : null;
  }

  // The owner pastes one column of the sheet: 20 comma-separated values for tasks 1..20.
  // Empty = not solved, "-" = not in the variant, a number = points.
  function parseScores(text) {
    const parts = String(text == null ? '' : text).split(',');
    if (parts.length !== NUMS.length) return { error: 'Нужно ровно 20 значений через запятую (по одному на задания 1-20), получено ' + parts.length + '.' };
    const scores = {}, na = [];
    for (let i = 0; i < NUMS.length; i++) {
      const n = NUMS[i], p = parts[i].trim();
      if (p === '-') { na.push(n); scores[n] = null; }
      else if (p === '') scores[n] = null;
      else if (/^[0-9]+$/.test(p)) scores[n] = Number(p);
      else return { error: 'Задание ' + n + ': «' + p + '» — не число, не пусто и не «-».' };
    }
    const bad = checkManual(scores, na);
    return bad ? { error: bad } : { scores: scores, na: na };
  }

  // '' when the row is acceptable, otherwise the reason (Russian: the owner reads it in the terminal).
  function checkManual(scores, na) {
    let any = false;
    for (let i = 0; i < na.length; i++) if (NUMS.indexOf(na[i]) < 0) return 'Задания ' + na[i] + ' не бывает.';
    for (let i = 0; i < NUMS.length; i++) {
      const n = NUMS[i], v = scores[n];
      if (na.indexOf(n) >= 0) { if (v != null) return 'Задание ' + n + ' отмечено как отсутствующее, баллов у него быть не должно.'; continue; }
      if (v == null) continue;
      if (!isInt(v) || v < 0 || v > MAXES[n]) return 'Задание ' + n + ': баллы от 0 до ' + MAXES[n] + '.';
      any = true;
    }
    return any ? '' : 'Ни у одного задания нет баллов.';
  }

  // Per-task scores of a checked exam written in the trainer. `photoNs`: task numbers (strings) that have photos.
  function taskScores(tasks, answers, ok, part2, photoNs) {
    const scores = {}, na = [], maxes = {};
    NUMS.forEach(function (n) {
      let task = null;
      (tasks || []).forEach(function (t) { if (Number(t.n) === n) task = t; });
      if (!task) { na.push(n); scores[n] = null; maxes[n] = MAXES[n]; return; }
      const mx = task.max || 1;
      maxes[n] = mx;
      if (task.kind === 'long') {
        const g = (part2 || {})[n], pts = g && typeof g.pts === 'number' ? g.pts : 0;
        scores[n] = pts > 0 ? Math.min(pts, mx) : ((photoNs || []).indexOf(String(n)) >= 0 ? 0 : null);
      } else {
        const raw = (answers || {})[n], given = (raw == null ? '' : String(raw)).trim();
        scores[n] = given === '' ? null : ((ok || {})[n] ? mx : 0);
      }
    });
    return { scores: scores, na: na, maxes: maxes };
  }

  function validDate(s) {
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(s));
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), t = new Date(Date.UTC(y, mo - 1, d));
    return y >= 2000 && y <= 2100 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  // The day of a manual exam as a moment: 12:00 Moscow time (09:00 UTC), so no timezone moves it to another day.
  function dateToTs(s) {
    const p = String(s).split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 9, 0, 0) / 1000;
  }

  const api = { MAXES: MAXES, NUMS: NUMS, SCALE_33: SCALE_33, maxFor: maxFor, cellState: cellState,
    primaryOf: primaryOf, maxOfItem: maxOfItem, testScore: testScore, testOf: testOf, checkTest: checkTest, solvability: solvability,
    parseScores: parseScores, checkManual: checkManual, taskScores: taskScores, validDate: validDate, dateToTs: dateToTs };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamHistoryCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
