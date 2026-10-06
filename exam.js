/* Assigned mock exams, trainer side. The teacher's own exams are opened to one
   student for a fixed window; everything here is rendered from what the server
   returns for the current phase (see backend/pb_hooks/exams.js). Nothing is
   written to the progress state, the event journal or the mock-exam history.
   Globals from index.html: API, auth, appEl, statsEl, setBack, parseRoute, go,
   escapeHtml, render, stageAndMount, IS_IPHONE, ask, note, scrollTop, typeset.
   Other scripts: exam-client-core.js (ExamClientCore), exam-validate.js (ExamValidate). */
(function () {
  'use strict';
  const C = window.ExamClientCore;
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const SEEN_KEY = 'ege_exam_seen_v1';
  const TG = 'https://t.me/kirill_math_tutor';   // the teacher, used on the "missed" screen
  const TG_BOT = 'kirill_repet_bot';             // the sign-in bot that also takes photos of part 2

  const st = { mine: null, mineAt: 0, loading: false, hubTimer: 0, id: null, view: null, offset: 0, synced: false, timers: [],
    queue: null, away: null, photos: [], ftoken: '', ftokenAt: 0, picker: false, saveTimer: 0, saveFail: false,
    shownPhase: '', shownId: '' };

  const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch (e) { return []; } };
  const markSeen = (id) => { try { const s = seen(); if (s.indexOf(id) < 0) { s.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-50))); } } catch (e) {} };

  async function xapi(path, opt) {
    opt = opt || {};
    const r = await fetch(API + '/ege/exams' + path, {
      method: opt.method || 'GET',
      body: opt.form || (opt.body && JSON.stringify(opt.body)),
      headers: Object.assign(opt.form ? {} : { 'content-type': 'application/json' }, auth ? { Authorization: auth.token } : {}),
    });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, json: json };
  }

  // ---- timers owned by the open exam screen ----
  function clearTimers() { st.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); st.timers = []; }
  function later(fn, ms) { const t = setTimeout(fn, Math.max(0, Math.min(ms, 2147483000))); st.timers.push(t); return t; }
  function every(fn, ms) { const t = setInterval(fn, ms); st.timers.push(t); return t; }

  // ---- server clock ----
  // The offset is only trusted after the server told us its time; until then nothing is shown or scheduled from it.
  function setOffset(serverNow) {
    if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return;
    st.offset = C.offsetOf(serverNow, Date.now()); st.synced = true;
  }
  const serverNowMs = () => Date.now() + st.offset;
  // Time left until `untilSec` as "mm:ss" / "h:mm:ss"; '' (never "NaN:NaN") when the server clock is not known yet.
  function leftText(untilSec) {
    if (!st.synced || typeof untilSec !== 'number' || !Number.isFinite(untilSec)) return '';
    return C.fmtLeft(C.leftSec(untilSec, st.offset, Date.now()));
  }

  // ---- teacher-authored HTML ----
  /* Statements, solutions and long-task keys are HTML written by the teacher. Every such field goes
     through ExamValidate.htmlProblem before it reaches innerHTML. If the validator reports a problem, or
     is not loaded at all, the field is shown as escaped plain text with a short note (fail closed).
     `V` is injectable only so that the function can be tried without the page. */
  const NOTE_BAD_HTML = 'Часть условия не удалось показать красиво.';
  function safeHtml(field, V) {
    const s = field == null ? '' : String(field);
    V = V || window.ExamValidate;
    let bad = true;
    try { bad = !V || typeof V.htmlProblem !== 'function' || V.htmlProblem(s) !== ''; } catch (e) { bad = true; }
    if (!bad) return s;
    return '<div class="ex-plain">' + esc(s) + '</div><p class="ex-note">' + NOTE_BAD_HTML + '</p>';
  }
  // Formulas of an inserted container: the same KaTeX pass (and delimiters) as the generator uses.
  function math(root) { if (root && typeof typeset === 'function') typeset(root); }

  // ---- hub banner ----
  const shown = (it) => it.phase === 'scheduled' || it.phase === 'open' || it.phase === 'photos' || it.phase === 'submitted' ||
    (it.phase === 'checked' && seen().indexOf(it.id) < 0);

  // The phase each banner was last drawn with: a changed phase animates in (scheduled -> open is the one that matters).
  const drawnPhase = {};
  function bannerOf(it) {
    const t = esc(it.title);
    const fresh = drawnPhase[it.id] && drawnPhase[it.id] !== it.phase;
    drawnPhase[it.id] = it.phase;
    const row = (title, sub, act) => '<div class="ex-banner' + (fresh ? ' ex-fresh' : '') + '"><div class="ex-b-body"><span class="ex-b-t">' + title + '</span>' +
      (sub ? '<span class="ex-b-s">' + sub + '</span>' : '') + '</div>' +
      (act ? '<button class="btn primary" data-exam="' + esc(it.id) + '">' + act + '</button>' : '') + '</div>';
    if (it.phase === 'scheduled') return row('Пробник «' + t + '»', C.whenText(Number(it.start)) + ' · время московское', '');
    if (it.phase === 'open') return row('Пробник «' + t + '» идёт', 'Время на работу уже идёт', 'Открыть');
    if (it.phase === 'photos') return row('Пробник «' + t + '»', 'Осталось прикрепить фото второй части', 'Открыть');
    if (it.phase === 'submitted') return row('Пробник «' + t + '» сдан', 'Вторую часть проверяет преподаватель', 'Результат');
    return row('Пробник «' + t + '» проверен', 'Баллы и комментарии готовы', 'Результат');
  }

  // Called from renderHub on every render; asks the server at most every 30 s.
  function bannerHTML() {
    if (!auth) return '';
    loadMine();
    return (st.mine || []).filter(shown).slice(0, 3).map(bannerOf).join('');
  }

  async function loadMine(force) {
    if (!auth || st.loading) return;
    if (!force && Date.now() - st.mineAt < 30000) return;
    st.loading = true; st.mineAt = Date.now();          // set even on failure: no retry storm
    const before = JSON.stringify(st.mine);
    try {
      const r = await xapi('/mine');
      if (r.status === 200 && r.json && Array.isArray(r.json.items)) { st.mine = r.json.items; setOffset(r.json.now); }
    } catch (e) { /* offline: keep what we had */ }
    st.loading = false;
    clearTimeout(st.hubTimer);
    const next = (st.mine || []).filter((it) => it.phase === 'scheduled' && Number.isFinite(it.until)).map((it) => it.until).sort((a, b) => a - b)[0];
    if (next && st.synced) st.hubTimer = setTimeout(() => loadMine(true), Math.max(1000, next * 1000 - serverNowMs() + 1500));
    if (JSON.stringify(st.mine) !== before && parseRoute().view === 'hub') render();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && parseRoute().view === 'hub') loadMine();
  });

  // ---- screens ----
  const shell = (inner) => '<div class="vbox">' + inner + '</div>';
  function fail(msg, retry) {
    appEl.innerHTML = shell('<div class="vintro"><h2>Пробник</h2><p class="lead">' + msg + '</p>' +
      '<div class="vactions">' + (retry ? '<button class="btn primary" data-ex-retry>Попробовать снова</button> ' : '') +
      '<button class="btn" data-home>К заданиям</button></div></div>');
  }

  // Stops this module's timers and forgets the open exam. Called by render() before every screen.
  function leave() { clearTimers(); st.id = null; st.view = null; st.queue = null; st.away = null; st.shownPhase = ''; st.shownId = ''; }

  async function renderExam(id) {
    // The same exam re-fetched by its own timer keeps shownPhase, so that a phase change can ease in.
    const keepPhase = st.shownPhase, keepId = st.shownId;
    leave(); st.shownPhase = keepPhase; st.shownId = keepId;
    st.id = id;
    setBack(true); statsEl.innerHTML = '';
    if (!auth) { fail('Чтобы открыть пробник, войди в тренажёр через Telegram.'); return; }
    appEl.innerHTML = '<div class="vbox"><div class="vwait" role="status"><div class="vwait-ring" aria-hidden="true"></div><p>Загружаю пробник…</p></div></div>';
    let r;
    try { r = await xapi('/' + encodeURIComponent(id)); }
    catch (e) { if (st.id === id) fail('Нет связи с сервером. Проверь интернет.', true); return; }
    if (st.id !== id) return;                          // the student already went elsewhere
    if (r.status === 401 || r.status === 403) { fail('Чтобы открыть пробник, войди в тренажёр через Telegram.'); return; }
    if (r.status === 404) { fail('Такого пробника нет, или он назначен не тебе.'); return; }
    if (r.status !== 200 || !r.json || typeof r.json.phase !== 'string') { fail('Не получилось загрузить пробник.', true); return; }
    st.view = r.json;
    setOffset(r.json.now);
    paint(r.json);
  }

  function paint(v) {
    scrollTop();
    if (st.shownPhase && st.shownPhase !== v.phase && st.shownId === v.id) fadeIn();
    st.shownPhase = v.phase; st.shownId = v.id;
    if (v.phase === 'scheduled') return paintScheduled(v);
    if (v.phase === 'missed') return paintMissed(v);
    appEl.innerHTML = shell('<p class="lead">' + esc(v.phase) + '</p>');   // replaced by later tasks
  }

  function paintScheduled(v) {
    appEl.innerHTML = shell('<div class="vintro"><h2>' + esc(v.title) + '</h2>' +
      '<p class="lead">Начало ' + C.whenText(Number(v.start)) + ' (по Москве). Когда время придёт, пробник откроется на этой странице.</p>' +
      '<p class="mode-hint">Подготовь чистые листы и ручку. На работу даётся ' + Math.round(Number(v.duration) / 60) + ' минут, время идёт с назначенного начала.</p>' +
      '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>');
    const id = v.id;
    // No known server clock or no `until`: do not schedule (a NaN delay would fire at once and loop).
    if (st.synced && Number.isFinite(v.until)) later(() => { if (st.id === id) renderExam(id); }, Math.max(1000, v.until * 1000 - serverNowMs() + 1200));
  }

  // A phase change on screen (the scheduled page becoming the exam) eases in instead of a hard cut.
  function fadeIn() {
    appEl.classList.remove('ex-screen-in'); void appEl.offsetWidth; appEl.classList.add('ex-screen-in');
    setTimeout(() => appEl.classList.remove('ex-screen-in'), 700);
  }

  function paintMissed(v) {
    appEl.innerHTML = shell('<div class="vintro"><h2>' + esc(v.title) + '</h2>' +
      '<p class="lead">Время пробника прошло, а ты его не открывал. Напиши преподавателю — договоритесь о новом времени.</p>' +
      '<div class="vactions"><a class="btn primary" href="' + TG + '" target="_blank" rel="noopener">Написать в Telegram</a> ' +
      '<button class="btn" data-home>К заданиям</button></div></div>');
  }

  // ---- clicks on this module's elements ----
  appEl.addEventListener('click', (e) => {
    const open = e.target.closest('[data-exam]');
    if (open) { go('#/exam/' + open.dataset.exam); return; }
    if (e.target.closest('[data-ex-retry]') && st.id) { renderExam(st.id); return; }
  });

  window.ExamUI = { bannerHTML: bannerHTML, render: renderExam, leave: leave, safeHtml: safeHtml };
})();
