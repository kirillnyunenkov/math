/* Answer comparison — pure functions shared by the trainer, the teacher panel,
   the server hooks and the tests (node/goja: require, browser:
   window.AnswersCore). Keep it ES6-plain: the server runs it on goja. */
(function (root) {
  'use strict';

  function normAns(s) {
    return (s || '').toString().toLowerCase().replace(/−/g, '-').replace(/\s+/g, '').replace(/,/g, '.');
  }

  function parseNum(s) {
    const t = (s || '').toString().replace(/−/g, '-').replace(/\s+/g, '').replace(/,/g, '.').replace(/\.$/, '');
    if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null;
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  function answersEqual(given, correct) {
    const a = parseNum(given), b = parseNum(correct);
    if (a !== null && b !== null) return Math.abs(a - b) < 1e-9;
    return normAns(given) === normAns(correct);
  }

  /* Part 1 of an assigned exam. tasks: [{n, kind, max}], key: {n: {a}},
     answers: {n: typed text}. Long tasks are graded by the teacher. */
  function gradePart1(tasks, key, answers) {
    const ok = {};
    let p1 = 0, max1 = 0;
    (tasks || []).forEach(function (t) {
      if (t.kind !== 'short') return;
      const mx = t.max || 1;
      const raw = (answers || {})[t.n];
      const given = (raw == null ? '' : String(raw)).trim();
      const k = (key || {})[t.n];
      ok[t.n] = given !== '' && !!k && k.a != null && answersEqual(given, String(k.a));
      max1 += mx;
      if (ok[t.n]) p1 += mx;
    });
    return { p1: p1, max1: max1, ok: ok };
  }

  const api = { normAns: normAns, parseNum: parseNum, answersEqual: answersEqual, gradePart1: gradePart1 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnswersCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
