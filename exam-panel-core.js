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
          // own properties only: a task key such as "__proto__" or "constructor" must stay plain data
          if (!Object.prototype.hasOwnProperty.call(tasks, nstr)) {
            Object.defineProperty(tasks, nstr, { value: { changes: 0, firstSec: t - start, lastSec: t - start }, enumerable: true, writable: true, configurable: true });
          }
          const k = tasks[nstr];
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

  /* A draft of the check form (points and comments typed but not yet sent): kept in the teacher's own browser so that
     "back", a link, or an expired sign-in does not lose it. Read back defensively: only numeric task keys, whole points
     0..100, comments up to the 2000 characters the server takes. */
  const draftKey = function (id) { return 'ck-draft:' + String(id); };
  function readDraft(storage, key) {
    try {
      const raw = JSON.parse(storage.getItem(key));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const out = { pts: {}, note: {} };
      const pick = function (src, dst, ok) {
        if (!src || typeof src !== 'object' || Array.isArray(src)) return;
        Object.keys(src).forEach(function (k) { if (/^\d{1,2}$/.test(k) && ok(src[k])) dst[k] = src[k]; });
      };
      pick(raw.pts, out.pts, function (v) { return Number.isInteger(v) && v >= 0 && v <= 100; });
      pick(raw.note, out.note, function (v) { return typeof v === 'string' && v.length <= 2000; });
      return Object.keys(out.pts).length || Object.keys(out.note).length ? out : null;
    } catch (e) { return null; }
  }
  function writeDraft(storage, key, draft) {
    try {
      if (draft && (Object.keys(draft.pts || {}).length || Object.keys(draft.note || {}).length)) storage.setItem(key, JSON.stringify(draft));
      else storage.removeItem(key);
    } catch (e) { /* storage full or blocked: the form still works, only the safety net is gone */ }
  }
  // True when the draft holds something the server does not have (an untouched blank form is not a draft).
  function draftDiffers(draft, server) {
    if (!draft) return false;
    const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o || {}, k); };
    const cur = function (k) { return has(server, k) && server[k] && typeof server[k] === 'object' ? server[k] : {}; };
    return Object.keys(draft.pts || {}).some(function (k) { return draft.pts[k] !== (Number.isInteger(cur(k).pts) ? cur(k).pts : 0); }) ||
      Object.keys(draft.note || {}).some(function (k) { return draft.note[k] !== (typeof cur(k).comment === 'string' ? cur(k).comment : ''); });
  }

  const api = { moscowInputToTs: moscowInputToTs, tsToMoscowInput: tsToMoscowInput, activitySummary: activitySummary,
    fmtSec: fmtSec, PHASE_TEXT: PHASE_TEXT,
    draftKey: draftKey, readDraft: readDraft, writeDraft: writeDraft, draftDiffers: draftDiffers };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamPanelCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
