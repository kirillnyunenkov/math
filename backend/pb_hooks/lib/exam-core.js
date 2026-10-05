/* Assigned mock exams — the phase of an assignment at a given moment. Pure
   functions shared by the trainer, the teacher panel, the server hooks and
   the tests (node/goja: require, browser: window.ExamCore). ES6-plain: the
   server runs it on goja.

   All times are unix seconds, 0 = not set. The window is hard:
   end = start + duration, a late start does not move it. After the window
   (or an early finish) the student has PHOTO_GRACE seconds for photos only. */
(function (root) {
  'use strict';

  const PHOTO_GRACE = 600;
  const DEFAULT_DURATION = 14100;   // 3 h 55 min

  function times(a) {
    const end = a.start + a.duration;
    const stop = a.finished ? Math.min(a.finished, end) : end;
    return { end: end, stop: stop, photoUntil: stop + PHOTO_GRACE };
  }

  function phase(a, now) {
    if (now < a.start) return 'scheduled';
    if (a.checked) return 'checked';
    const t = times(a);
    // never opened: the statements were not seen, so the exam stays reusable
    if (!a.opened) return now < t.end ? 'open' : 'missed';
    if (now < t.stop) return 'open';
    if (!a.photos_done && now < t.photoUntil) return 'photos';
    return 'submitted';
  }

  function total(tasks, p1, part2) {
    let pts = p1 || 0, max = 0;
    (tasks || []).forEach(function (t) {
      const mx = t.max || 1;
      max += mx;
      if (t.kind !== 'long') return;
      const g = (part2 || {})[t.n];
      if (g && g.pts > 0) pts += Math.min(g.pts, mx);
    });
    return { pts: pts, max: max };
  }

  const api = { PHOTO_GRACE: PHOTO_GRACE, DEFAULT_DURATION: DEFAULT_DURATION, times: times, phase: phase, total: total };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
