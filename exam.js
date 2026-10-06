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

  const st = { mine: null, mineAt: 0, loading: false, hubTimer: 0, hubMiss: 0, user: '', gen: 0, req: 0, schedMiss: 0, id: null, view: null, offset: 0, synced: false, timers: [],
    save: null, leaving: null, listeners: [], saveTimer: 0, retryTimer: 0,
    photos: [], ftoken: '', ftokenAt: 0, picker: false,
    shownPhase: '', shownId: '' };

  const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch (e) { return []; } };
  const markSeen = (id) => { try { const s = seen(); if (s.indexOf(id) < 0) { s.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-50))); } } catch (e) {} };

  // A request that hangs (a connection that went away without an error) is cut after `opt.timeout` ms (default 20 s)
  // and fails like any other network error: nothing waits on it for ever, the save queue backs off and tries again.
  async function xapi(path, opt) {
    opt = opt || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const cut = ctl ? setTimeout(() => ctl.abort(), C.clampDelay(opt.timeout || 20000)) : 0;
    try {
      const r = await fetch(API + '/ege/exams' + path, {
        method: opt.method || 'GET',
        body: opt.form || (opt.body && JSON.stringify(opt.body)),
        keepalive: !!opt.keep,                         // lets a save started while the page closes still go out
        signal: ctl ? ctl.signal : undefined,
        headers: Object.assign(opt.form ? {} : { 'content-type': 'application/json' }, auth ? { Authorization: auth.token } : {}),
      });
      let json = null; try { json = await r.json(); } catch (e) {}
      return { status: r.status, json: json };
    } finally { clearTimeout(cut); }
  }

  // ---- timers owned by the open exam screen ----
  function clearTimers() {
    st.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); st.timers = [];
    clearTimeout(st.saveTimer); clearTimeout(st.retryTimer); st.saveTimer = 0; st.retryTimer = 0;
  }
  // Listeners of the open screen on document / window / appEl: all removed together by leave().
  function listen(target, type, fn) {
    target.addEventListener(type, fn);
    st.listeners.push(() => target.removeEventListener(type, fn));
  }
  // Every delay goes through ExamClientCore.clampDelay: a NaN or a start weeks away must not fire at once.
  function later(fn, ms) { const t = setTimeout(fn, C.clampDelay(ms)); st.timers.push(t); return t; }
  function every(fn, ms) { const t = setInterval(fn, C.clampDelay(ms)); st.timers.push(t); return t; }

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
  // What needs the student first: a running exam, then one that is coming, then results.
  const PRIO = { open: 0, photos: 0, scheduled: 1, submitted: 2, checked: 3 };
  // Only well-formed items are kept: the page never trusts the shape of the server answer.
  const wellFormed = (it) => !!it && typeof it === 'object' && typeof it.id === 'string' && typeof it.phase === 'string' &&
    typeof it.start === 'number' && Number.isFinite(it.start);

  // The phase each banner was last drawn with: a changed phase animates in (scheduled -> open is the one that matters).
  const drawnPhase = {};
  const nameOf = (it) => { const n = String(it.title == null ? '' : it.title).trim(); return n ? 'Пробник «' + esc(n) + '»' : 'Пробник'; };
  function bannerOf(it) {
    const t = nameOf(it);
    const fresh = drawnPhase[it.id] && drawnPhase[it.id] !== it.phase;
    drawnPhase[it.id] = it.phase;
    const row = (title, sub, act) => '<div class="ex-banner' + (fresh ? ' ex-fresh' : '') + '"><div class="ex-b-body"><span class="ex-b-t">' + title + '</span>' +
      (sub ? '<span class="ex-b-s">' + sub + '</span>' : '') + '</div>' +
      (act ? '<button class="btn primary" data-exam="' + esc(it.id) + '">' + act + '</button>' : '') + '</div>';
    if (it.phase === 'scheduled') return row(t, C.whenText(it.start) + ' · время московское', '');
    if (it.phase === 'open') return row(t + ' идёт', 'Время на работу уже идёт', 'Открыть');
    if (it.phase === 'photos') return row(t, 'Осталось прикрепить фото второй части', 'Открыть');
    if (it.phase === 'submitted') return row(t + ' сдан', 'Вторую часть проверяет преподаватель', 'Результат');
    return row(t + ' проверен', 'Баллы и комментарии готовы', 'Результат');
  }

  // Forgets everything cached for the previous signed-in user. Anything still in flight for him is dropped (gen).
  function resetCache() {
    st.gen++; st.mine = null; st.mineAt = 0; st.loading = false; st.hubMiss = 0; st.offset = 0; st.synced = false;
    clearTimeout(st.hubTimer); st.hubTimer = 0;
    Object.keys(drawnPhase).forEach((k) => { delete drawnPhase[k]; });
  }
  // Sign-out, expiry or a login: the exam screen and the cached list both go.
  function reset() { leave(); resetCache(); st.user = auth ? String(auth.userId || '') : ''; }

  // Called from renderHub on every render; asks the server at most every 30 s. It must never throw:
  // a broken banner may not take the hub (and every later render) down with it.
  function bannerHTML() {
    try {
      if (!auth || !C) return '';
      if (st.user !== String(auth.userId || '')) { resetCache(); st.user = String(auth.userId || ''); }
      loadMine();
      return (st.mine || []).filter(shown).sort((a, b) => PRIO[a.phase] - PRIO[b.phase]).slice(0, 3).map(bannerOf).join('');
    } catch (e) { return ''; }
  }

  async function loadMine(force) {
    if (!auth || !C || st.loading) return;
    if (!force && Date.now() - st.mineAt < 30000) return;
    const gen = st.gen, uid = st.user;
    st.loading = true; st.mineAt = Date.now();          // set even on failure: no retry storm
    const before = JSON.stringify(st.mine);
    let ok = false;
    try {
      const r = await xapi('/mine');
      if (gen !== st.gen) return;                        // signed out or another user meanwhile: not ours any more
      if (r.status === 200 && r.json && Array.isArray(r.json.items)) { st.mine = r.json.items.filter(wellFormed); setOffset(r.json.now); ok = true; }
    } catch (e) { if (gen !== st.gen) return; /* offline: keep what we had */ }
    st.loading = false;
    clearTimeout(st.hubTimer);
    const next = (st.mine || []).filter((it) => it.phase === 'scheduled' && typeof it.until === 'number' && Number.isFinite(it.until))
      .map((it) => it.until).sort((a, b) => a - b)[0];
    // A failed refresh, or a start that has passed while the server still says "scheduled", counts as a miss: back off.
    if (ok && next !== undefined && next * 1000 > serverNowMs()) st.hubMiss = 0; else if (!ok || next !== undefined) st.hubMiss++; else st.hubMiss = 0;
    if (next !== undefined && st.synced && uid === st.user) {
      st.hubTimer = setTimeout(() => loadMine(true), C.refreshDelay(next, serverNowMs(), st.hubMiss, 1500));
    }
    if (JSON.stringify(st.mine) !== before && parseRoute().view === 'hub') render();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && parseRoute().view === 'hub') loadMine();
  });

  // ---- screens ----
  const shell = (inner) => '<div class="vbox">' + inner + '</div>';
  function fail(msg, retry) {
    appEl.innerHTML = shell('<div class="vintro"><h2>Пробник</h2><p class="lead">' + esc(msg) + '</p>' +
      '<div class="vactions">' + (retry ? '<button class="btn primary" data-ex-retry>Попробовать снова</button> ' : '') +
      '<button class="btn" data-home>К заданиям</button></div></div>');
  }

  // Stops this module's timers and listeners and forgets the open exam. Called by render() before every screen.
  // Typed answers that are still unsent get one last try (no retry, nothing painted); renderExam waits for it.
  function leave() {
    clearTimers();
    st.listeners.splice(0).forEach((off) => off());
    const s = st.save; st.save = null;
    if (s) {
      s.dead = true;
      if (!s.closed && s.q.has()) {
        st.leaving = { id: s.id, p: Promise.resolve(s.busy).then(() => (s.q.has() ? send(s, { force: true }) : null)).catch(() => {}) };
      }
    }
    if (st.id) st.mineAt = 0;                            // coming back to the hub: the list is read again
    st.req++;                                            // an answer still on its way must not paint
    st.id = null; st.view = null; st.shownPhase = ''; st.shownId = '';
  }

  async function renderExam(id) {
    // The same exam re-fetched by its own timer keeps shownPhase, so that a phase change can ease in.
    const keepPhase = st.shownPhase, keepId = st.shownId;
    leave(); st.shownPhase = keepPhase; st.shownId = keepId;
    st.id = id;
    const lv = st.leaving && st.leaving.id === id ? st.leaving.p : null; st.leaving = null;
    const my = ++st.req;                               // only the latest request may paint (A -> hub -> A)
    setBack(true); statsEl.innerHTML = '';
    if (!C) { fail('Не получилось загрузить пробник.'); return; }
    if (!auth) { fail('Чтобы открыть пробник, войди в тренажёр через Telegram.'); return; }
    appEl.innerHTML = '<div class="vbox"><div class="vwait" role="status"><div class="vwait-ring" aria-hidden="true"></div><p>Загружаю пробник…</p></div></div>';
    // Answers typed on this exam just before (navigating away and straight back) must reach the server before it is read.
    if (lv) { await Promise.race([lv, new Promise((res) => setTimeout(res, 2500))]); if (st.id !== id || my !== st.req) return; }
    let r;
    try { r = await xapi('/' + encodeURIComponent(id)); }
    catch (e) { if (st.id === id && my === st.req) fail('Нет связи с сервером. Проверь интернет.', true); return; }
    if (st.id !== id || my !== st.req) return;         // the student already went elsewhere
    if (r.status === 401 || r.status === 403) { fail('Чтобы открыть пробник, войди в тренажёр через Telegram.'); return; }
    if (r.status === 404) { fail('Такого пробника нет, или он назначен не тебе.'); return; }
    if (r.status !== 200 || !r.json || typeof r.json.phase !== 'string') { fail('Не получилось загрузить пробник.', true); return; }
    st.view = r.json;
    setOffset(r.json.now);
    paint(r.json);
  }

  function paint(v) {
    scrollTop();
    const again = st.shownPhase === v.phase && st.shownId === v.id;   // the same screen fetched again by its own timer
    if (st.shownPhase && st.shownPhase !== v.phase && st.shownId === v.id) fadeIn();
    st.shownPhase = v.phase; st.shownId = v.id;
    if (v.phase === 'scheduled') return paintScheduled(v, again);
    if (v.phase === 'missed') return paintMissed(v);
    if (v.phase === 'open') return paintOpen(v);
    appEl.innerHTML = shell('<p class="lead">' + esc(v.phase) + '</p>');   // replaced by later tasks
  }

  const titleOf = (v) => esc(String(v.title == null ? '' : v.title).trim() || 'Пробник');
  const numOk = (x) => typeof x === 'number' && Number.isFinite(x);

  function paintScheduled(v, again) {
    // Malformed start or duration: the line is left out, never "undefined" or "NaN".
    const when = numOk(v.start) ? 'Начало ' + C.whenText(v.start) + ' (по Москве). ' : '';
    const mins = numOk(v.duration) && v.duration > 0 ? ' На работу даётся ' + Math.round(v.duration / 60) + ' минут, время идёт с назначенного начала.' : '';
    appEl.innerHTML = shell('<div class="vintro"><h2>' + titleOf(v) + '</h2>' +
      '<p class="lead">' + when + 'Когда время придёт, пробник откроется на этой странице.</p>' +
      '<p class="mode-hint">Подготовь чистые листы и ручку.' + mins + '</p>' +
      '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>');
    const id = v.id;
    // Ask again just after the start. A start already past (the server still says "scheduled", or `until` is
    // missing) is never reused as a deadline: back off 30 s, then 60 s. Without a known server clock: no timer.
    const stale = !(numOk(v.until) && v.until * 1000 > serverNowMs());
    st.schedMiss = stale ? (again ? st.schedMiss + 1 : 1) : 0;
    if (st.synced) later(() => { if (st.id === id) renderExam(id); }, C.refreshDelay(v.until, serverNowMs(), st.schedMiss, 1200));
  }

  // A phase change on screen (the scheduled page becoming the exam) eases in instead of a hard cut.
  function fadeIn() {
    appEl.classList.remove('ex-screen-in'); void appEl.offsetWidth; appEl.classList.add('ex-screen-in');
    setTimeout(() => appEl.classList.remove('ex-screen-in'), 700);
  }

  function paintMissed(v) {
    appEl.innerHTML = shell('<div class="vintro"><h2>' + titleOf(v) + '</h2>' +
      '<p class="lead">Время пробника прошло, а ты его не открывал. Напиши преподавателю — договоритесь о новом времени.</p>' +
      '<div class="vactions"><a class="btn primary" href="' + TG + '" target="_blank" rel="noopener">Написать в Telegram</a> ' +
      '<button class="btn" data-home>К заданиям</button></div></div>');
  }

  // ---- the open phase ----
  // The whole page is made of what the server sent; nothing here is built from it other than through esc() / Number() /
  // safeHtml(), and no selector is ever built from a task number (cards are found through dataset).
  // iPhone has no minus sign on a numeric keypad: always the text keyboard there (same attributes as ansAttrs of the generator).
  const ansAttrs = () => IS_IPHONE ? 'type="text" autocapitalize="off" autocorrect="off" spellcheck="false"'
    : 'type="text" inputmode="decimal"';
  const ballWordOf = (n) => (typeof ballWord === 'function' ? ballWord(n) : 'б.');

  function cardHTML(t, typed) {
    const long = t.kind === 'long';
    return '<div class="vcard" data-n="' + t.n + '" data-exn="' + t.n + '">' +
      '<div class="vlabel">Задание ' + t.n + (long && t.max ? '<span class="vlabel-art"> · максимум ' + t.max + ' ' + ballWordOf(t.max) + '</span>' : '') + '</div>' +
      '<div class="cond"><div class="tex">' + safeHtml(t.cond) + '</div></div>' +
      (long ? photoBlockHTML(t) :
        '<input class="v-input" ' + ansAttrs() + ' maxlength="40" placeholder="Ответ" data-ex-in="' + t.n + '" value="' + esc(typed[t.n]) + '" autocomplete="off" aria-label="Ответ на задание ' + t.n + '">') +
      '</div>';
  }
  const photoBlockHTML = () => '<p class="vlong-hint">Решение записывай на листе. Фото решения прикрепишь к этому заданию.</p>';   // replaced by the photos task
  const tgBlockHTML = () => '';       // filled in by the photos task
  function mountPhotos() {}           // filled in by the photos task

  // The timer starts empty: it is filled from the server clock only (never "NaN:NaN").
  function barHTML() {
    return '<div class="vbar"><span class="vtimer" id="ex-timer" role="timer"></span>' +
      '<span class="vprog" id="ex-save" role="status" aria-live="polite"></span><span class="spacer"></span>' +
      '<button class="btn primary" data-ex-finish>Завершить</button></div>';
  }

  function paintOpen(v) {
    const id = st.id, tasks = C.wellFormedTasks(v.tasks);
    if (!tasks.length) { fail('Не получилось загрузить задания пробника.', true); return; }
    const typed = C.answersOf(v.answers, tasks), hasLong = tasks.some((t) => t.kind === 'long');
    const dropped = !Array.isArray(v.tasks) || v.tasks.length !== tasks.length;
    // One session per painted open screen: what is typed, what is in flight, and whether the screen is still ours.
    const s = st.save = { id: id, q: new C.SaveQueue(), busy: null, fails: 0, nextAt: 0, dead: false, closed: false,
      syncing: false, finishing: false, away: new C.AwayTracker(2), until: v.until, tick: null };
    st.photos = Array.isArray(v.photos) ? v.photos.slice() : [];
    bindOpen(s);
    stageAndMount(shell(barHTML() +
        (dropped ? '<p class="ex-note">Часть заданий не удалось показать. Напиши преподавателю.</p>' : '') +
        tasks.map((t) => cardHTML(t, typed)).join('') +
        (hasLong ? tgBlockHTML(v) : '') +
        '<div style="text-align:center;margin-top:8px"><button class="btn primary" data-ex-finish>Завершить пробник</button></div>'),
      () => st.save === s && !s.dead && parseRoute().view === 'exam',
      () => { startTimer(s); mountPhotos(v); });
  }

  // ---- countdown by the server clock ----
  function startTimer(s) {
    const tick = () => {
      if (s.dead) return;
      const e = document.getElementById('ex-timer');
      if (!st.synced || typeof s.until !== 'number' || !Number.isFinite(s.until)) { if (e) e.textContent = ''; return; }
      const sec = C.leftSec(s.until, st.offset, Date.now());
      if (e) { e.textContent = C.fmtLeft(sec); e.classList.toggle('low', sec <= 300); }
      if (sec === 0) syncPhase(s);                    // idempotent: one sync cycle at a time
    };
    s.tick = tick; every(tick, 1000); tick();
  }
  const timeLeft = (s) => (st.synced && typeof s.until === 'number' && Number.isFinite(s.until) ? C.leftSec(s.until, st.offset, Date.now()) : -1);

  // The screen takes the next phase from the server, never from the device clock: flush what is typed,
  // ask, and if the server still says "open" ask again (2 s five times, then every 10 s). Replaces the screen only on a phase change.
  function syncPhase(s) {
    if (s.dead || s.syncing) return;
    s.syncing = true;
    let tries = 0;
    const step = async () => {
      if (s.dead) return;
      await flush(s, { force: true });
      if (s.dead) return;
      let r = null;
      try { r = await xapi('/' + encodeURIComponent(s.id)); } catch (e) { r = null; }
      if (s.dead) return;
      if (r && r.status === 200 && r.json && typeof r.json.phase === 'string') {
        if (r.json.phase !== 'open') { adopt(s.id, r.json); return; }
        setOffset(r.json.now);
        if (typeof r.json.until === 'number' && Number.isFinite(r.json.until)) s.until = r.json.until;
        if (timeLeft(s) > 0) { s.syncing = false; return; }       // the server says there is time left after all
      }
      tries++;
      later(step, tries < 5 ? 2000 : 10000);
    };
    step();
  }
  // Shows a phase fetched by syncPhase: the same as renderExam, without a second request.
  function adopt(id, json) {
    const kp = st.shownPhase, ki = st.shownId;
    leave(); st.shownPhase = kp; st.shownId = ki;
    st.id = id; st.req++; st.view = json; setOffset(json.now);
    paint(json);
  }

  // ---- autosave of part 1 ----
  const setSaveText = (t, bad) => {
    const e = document.getElementById('ex-save');
    if (e) { e.textContent = t; e.classList.toggle('bad', !!bad); }
  };
  const live = (s) => !s.dead && st.save === s;

  // One request. Typed answers stay queued until the server says 200; a failure backs off 5 s, 15 s, 30 s and keeps them.
  // A stale screen (left, replaced) paints and acks nothing. Returns true when the server took the answers.
  async function send(s, opt) {
    const snap = s.q.snapshot();
    if (live(s)) setSaveText('Сохраняю…');
    let r = null;
    try { r = await xapi('/' + s.id + '/answers', { method: 'POST', body: { answers: snap }, keep: !!(opt && opt.keep) }); } catch (e) { r = null; }
    if (!live(s)) return !!(r && r.status === 200);
    if (r && r.status === 200) {
      s.q.ack(snap); s.fails = 0; s.nextAt = 0;
      setSaveText(s.q.has() ? 'Сохраняю…' : 'Сохранено');
      return true;
    }
    if (r && r.status === 409) { s.closed = true; setSaveText(''); syncPhase(s); return false; }   // the window is over: the server decides what comes next
    s.fails++;
    const d = C.retryDelay(s.fails);
    s.nextAt = Date.now() + d;
    setSaveText('Не сохранено — проверь связь', true);
    clearTimeout(st.retryTimer);
    st.retryTimer = setTimeout(() => flush(s, { force: true }), C.clampDelay(d));
    return false;
  }
  // One request at a time; whatever is typed meanwhile goes out right after it. `force` ignores the back-off (the page is
  // going away, or a button was pressed); `keep` makes the request survive a closing page.
  function flush(s, opt) {
    opt = opt || {};
    if (!s || s.dead || s.closed || !s.q.has()) return Promise.resolve();
    if (s.busy) return s.busy;
    if (!opt.force && Date.now() < s.nextAt) return Promise.resolve();      // backing off: the retry timer will send it
    clearTimeout(st.saveTimer);
    s.busy = (async () => {
      try { while (await send(s, opt) && s.q.has() && !s.dead && !s.closed) { /* typed while the request was out */ } }
      finally { s.busy = null; }
    })();
    return s.busy;
  }

  // ---- finishing early ----
  async function finishNow(s) {
    if (s.finishing || s.dead) return;
    const ok = await ask({ title: 'Завершить пробник?',
      text: 'Ответы первой части после этого изменить нельзя. Фото второй части можно будет прикрепить ещё 10 минут.',
      ok: 'Завершить', cancel: 'Вернуться' });
    if (!ok || s.dead) return;
    s.finishing = true;
    document.querySelectorAll('[data-ex-finish]').forEach((b) => { b.disabled = true; });
    try {
      await flush(s, { force: true });
      if (s.dead) return;
      // Answers that could not be saved must not be cut off by finishing: the student keeps the page and tries again.
      if (s.q.has() && !s.closed) { note('Ответы пока не сохранились', 'Проверь интернет и нажми «Завершить» ещё раз. Не закрывай эту страницу, пока не появится «Сохранено».'); return; }
      const r = await xapi('/' + s.id + '/finish', { method: 'POST' }).catch(() => null);
      if (s.dead) return;
      if (!r || (r.status !== 200 && r.status !== 409)) { note('Не получилось завершить', 'Проверь интернет и нажми «Завершить» ещё раз. Ответы сохранены.'); return; }
      renderExam(s.id);                                    // the server says which screen is next
    } finally {
      s.finishing = false;
      if (!s.dead) document.querySelectorAll('[data-ex-finish]').forEach((b) => { b.disabled = false; });
    }
  }

  // ---- the away journal: when the page is hidden or loses focus ----
  function currentTask() {
    const cards = document.querySelectorAll('[data-exn]');
    for (const c of cards) { if (c.getBoundingClientRect().bottom > 130) return c.dataset.exn; }
    return '';
  }
  // Only while the exam is open by the server clock. The report is one shot: a refusal (for instance 400 for a
  // too long interval, or 409 after the end) is ignored and never retried.
  const openNow = (s) => !s.dead && !!st.view && st.view.phase === 'open' && timeLeft(s) !== 0;
  function awayOut(s) { if (openNow(s) && !st.picker) s.away.hide(Date.now(), currentTask()); }
  function awayBack(s) {
    if (s.dead) return;
    if (st.picker) { st.picker = false; return; }
    const a = s.away.show(Date.now());
    if (a && openNow(s)) xapi('/' + s.id + '/away', { method: 'POST', body: { n: a.n, sec: a.sec } }).catch(() => {});
  }

  // Everything the open screen listens to; leave() removes all of it.
  function bindOpen(s) {
    listen(appEl, 'input', (e) => {
      const inp = e.target.closest && e.target.closest('[data-ex-in]');
      if (!inp || s.dead) return;
      s.q.set(inp.dataset.exIn, inp.value);
      if (!s.fails) setSaveText('Сохраняю…');
      clearTimeout(st.saveTimer); st.saveTimer = setTimeout(() => flush(s), C.clampDelay(700));
    });
    listen(appEl, 'focusout', (e) => { if (e.target.closest && e.target.closest('[data-ex-in]')) flush(s); });
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') { awayOut(s); flush(s, { force: true, keep: true }); }
      else { awayBack(s); if (s.tick) s.tick(); }
    });
    listen(window, 'pagehide', () => flush(s, { force: true, keep: true }));
    listen(window, 'blur', () => awayOut(s));
    listen(window, 'focus', () => awayBack(s));
    listen(window, 'online', () => flush(s, { force: true }));
  }

  // ---- clicks on this module's elements ----
  appEl.addEventListener('click', (e) => {
    const open = e.target.closest('[data-exam]');
    if (open) { go('#/exam/' + open.dataset.exam); return; }
    if (e.target.closest('[data-ex-retry]') && st.id) { renderExam(st.id); return; }
    if (e.target.closest('[data-ex-finish]') && st.save) { finishNow(st.save); return; }
  });

  window.ExamUI = { bannerHTML: bannerHTML, render: renderExam, leave: leave, safeHtml: safeHtml, reset: reset };
})();
