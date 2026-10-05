/* Assigned mock exams, teacher panel — pure helpers shared with the tests
   (node: require, browser: window.ExamPanelCore). No DOM here. */
(function (root) {
  'use strict';

  // The panel always works in Moscow time (UTC+3 all year), whatever the browser zone is.
  function moscowInputToTs(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s || '');
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000) - 10800;
  }

  function tsToMoscowInput(ts) {
    const d = new Date((ts + 10800) * 1000), p = (x) => String(x).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  /* The server journal: [ts,"a",n,text] — an answer changed; [ts,"w",n,seconds] — the
     page was hidden / lost focus. Facts for the teacher, not proof of anything. */
  function activitySummary(log, start) {
    const away = { count: 0, totalSec: 0, longest: null }, tasks = {};
    if (!Array.isArray(log)) return { away: away, tasks: tasks };
    log.forEach(function (e) {
      if (!Array.isArray(e) || e.length < 4) return;
      const t = e[0], kind = e[1];
      if (typeof t !== 'number' || !isFinite(t)) return;
      if (kind === 'w') {
        const v = e[3], n = String(e[2]);
        if (typeof v === 'number' && isFinite(v) && v > 0) {
          away.count++; away.totalSec += v;
          if (!away.longest || v > away.longest.sec) away.longest = { sec: v, n: n };
        }
      } else if (kind === 'a') {
        const n = e[2];
        if (n !== null && n !== undefined) {
          const nstr = String(n);
          const k = tasks[nstr] || (tasks[nstr] = { changes: 0, firstSec: t - start, lastSec: t - start });
          k.changes++; k.lastSec = t - start;
        }
      }
    });
    return { away: away, tasks: tasks };
  }

  function fmtSec(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60, p = (x) => String(x).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  const PHASE_TEXT = { scheduled: 'назначен', open: 'идёт', photos: 'фото', submitted: 'ждёт проверки', checked: 'проверен', missed: 'пропущен' };

  const api = { moscowInputToTs: moscowInputToTs, tsToMoscowInput: tsToMoscowInput, activitySummary: activitySummary,
    fmtSec: fmtSec, PHASE_TEXT: PHASE_TEXT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamPanelCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
