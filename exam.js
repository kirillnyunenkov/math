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
    save: null, leaving: null, det: {}, listeners: [], saveTimer: 0, retryTimer: 0,
    picker: 0, carry: null,            // picker: when the file dialog was opened; carry: photos handed from the open to the photo screen
    lostBy: Object.create(null),   // photos lost on leaving, per exam, until the note is shown
    shownPhase: '', shownId: '', fade: false, sheets: 0 };   // sheets: confirmation sheets of this module that are open

  const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch (e) { return []; } };
  const markSeen = (id) => { try { const s = seen(); if (s.indexOf(id) < 0) { s.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-50))); } } catch (e) {} };

  // A request that hangs (a connection that went away without an error) is cut after `opt.timeout` ms (default 20 s,
  // 120 s for an upload) and fails like any other network error: nothing waits on it for ever, the save queue backs off
  // and tries again. `opt.token` is the token an exam screen kept: it still works after a sign-out cleared `auth`.
  // `opt.signal` (an AbortSignal of the caller) cancels the request; `opt.root` addresses `path` from the API root
  // (the file token) instead of /ege/exams.
  async function xapi(path, opt) {
    opt = opt || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const cut = ctl ? setTimeout(() => ctl.abort(), C.clampDelay(opt.timeout || (opt.form ? 120000 : 20000))) : 0;
    if (ctl && opt.signal) { if (opt.signal.aborted) ctl.abort(); else opt.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    const tok = C.pickToken(opt.token, auth);
    try {
      const r = await fetch(API + (opt.root ? '' : '/ege/exams') + path, {
        method: opt.method || 'GET',
        body: opt.form || (opt.body && JSON.stringify(opt.body)),
        keepalive: !!opt.keep,                         // lets a save started while the page closes still go out
        signal: ctl ? ctl.signal : undefined,
        headers: Object.assign(opt.form ? {} : { 'content-type': 'application/json' }, tok ? { Authorization: tok } : {}),
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
  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    st.listeners.push(() => target.removeEventListener(type, fn, opts));
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
    // A table wider than the phone must scroll inside its own wrapper (as the trainer's tasks do); otherwise iOS
    // shrinks the whole page to fit it. Wrapped after validation, so the validator still sees the author's markup.
    if (!bad) return s.replace(/<table\b[\s\S]*?<\/table>/gi, '<div class="table-wrapper">$&</div>');
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
    if (it.phase === 'scheduled') return row(t, C.whenText(it.start) + ' · время московское', 'Подробнее');
    if (it.phase === 'open') return row(t + ' открыт', 'Время на работу уже идёт', 'Открыть');
    // `early` / `nolong` come with the photo phase only; an older server sends neither and the plain wording stays.
    if (it.phase === 'photos') return row(t, it.nolong === true ? 'Время работы вышло, открой, чтобы сдать'
      : (it.early === false ? 'Время вышло, осталось прикрепить фото второй части' : 'Осталось прикрепить фото второй части'), 'Открыть');
    if (it.phase === 'submitted') return row(t + ' сдан', 'Идёт проверка', 'Результат');   // /mine has no task data: no word about a part 2
    return row(t + ' проверен', 'Баллы и комментарии готовы', 'Результат');
  }

  // Forgets everything cached for the previous signed-in user. Anything still in flight for him is dropped (gen).
  function resetCache() {
    st.gen++; st.mine = null; st.mineAt = 0; st.loading = false; st.hubMiss = 0; st.offset = 0; st.synced = false;
    clearTimeout(st.hubTimer); st.hubTimer = 0;
    Object.keys(drawnPhase).forEach((k) => { delete drawnPhase[k]; });
  }
  // What the page remembers about one user's exams (not shown to the next user).
  function forgetUser() { st.lostBy = Object.create(null); }
  // Photos that were on their way when the student left an exam: the next time that exam is opened a note says so, once.
  const addLost = (id, n) => { if (n > 0 && typeof id === 'string') st.lostBy[id] = (st.lostBy[id] || 0) + n; };
  function takeLost(id) { const n = st.lostBy[id] || 0; delete st.lostBy[id]; return n; }
  // Sign-out, expiry or a login: the exam screen and the cached list both go.
  function reset() {
    leave();
    // Answers still being sent for an exam of a user who is not signed in any more: the attempt already on its way
    // is left alone, no retries follow, one waiting for its next try is stopped, and nobody else is shown them.
    // The user is compared by id: refreshToken rotates the token of the same user. A plain sign-out (auth is still
    // set when reset() runs) keeps its retries.
    const uid = auth ? String(auth.userId || '') : '';
    Object.keys(st.det).forEach((id) => {
      const d = st.det[id];
      if (!uid || d.uid !== uid) { d.noRetry = true; stopSender(d, true); delete st.det[id]; }
    });
    resetCache(); forgetUser(); st.user = auth ? String(auth.userId || '') : '';
  }

  // Called from renderHub on every render; asks the server at most every 30 s. It must never throw:
  // a broken banner may not take the hub (and every later render) down with it.
  function bannerHTML() {
    try {
      if (!auth || !C) return '';
      if (st.user !== String(auth.userId || '')) { const had = st.user; resetCache(); if (had) forgetUser(); st.user = String(auth.userId || ''); }
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
    // The next moment a banner changes by itself: a start (scheduled -> open), the end of the window (open -> missed or
    // photos), the end of the photo time (photos -> submitted).
    const next = C.nextChangeAt(st.mine);
    // A failed refresh, or a moment that has passed while the server still shows the old phase, counts as a miss: back off.
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
    appear();
  }

  // Stops this module's timers and listeners and forgets the open exam. Called by render() before every screen.
  // Typed answers that are still unsent go on in the background (see drain); renderExam waits a moment for it.
  // `carry`: the photos go on to the next screen (the open phase turning into the photo phase): they are detached, not dropped.
  function leave(carry) {
    clearTimers(); closeZoom();
    st.listeners.splice(0).forEach((off) => off());
    if (st.carry) { addLost(st.carry.id, dropPhotos(st.carry)); st.carry = null; }   // nobody took them over
    // A question of this screen (leave? finish? delete?) does not outlive it: its answer would be about a screen that is gone.
    if (st.sheets > 0) { st.sheets = 0; if (typeof closeSheet === 'function') closeSheet(false); }
    const s = st.save; st.save = null;
    syncAnswerGuard();
    if (s) {
      s.dead = true;
      // Uploads in flight are cancelled, previews and the file token dropped, and the exam remembers that photos were lost.
      if (s.ph) { if (carry === true && !s.ph.dead) { detachPhotos(s.ph); st.carry = s.ph; } else addLost(s.id, dropPhotos(s.ph)); }
      // Unsent answers are handed to a detached sender: it keeps the screen's token and retries a few times (5, 15, 30 s).
      if (!s.closed && !s.fatal && s.q.has()) { st.det[s.id] = s; st.leaving = { id: s.id, p: drain(s) }; }
    }
    if (st.id) st.mineAt = 0;                            // coming back to the hub: the list is read again
    st.req++;                                            // an answer still on its way must not paint
    st.id = null; st.view = null; st.shownPhase = ''; st.shownId = ''; st.fade = false;
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
    // The scheduled page re-fetched by its own timer stays on screen until the next screen is ready: no spinner in between.
    if (!(keepId === id && keepPhase === 'scheduled')) {
      appEl.innerHTML = '<div class="vbox"><div class="vwait" role="status"><div class="vwait-ring" aria-hidden="true"></div><p>Загружаю пробник…</p></div></div>';
    }
    // Answers typed on this exam just before (navigating away and straight back) must reach the server before it is read.
    if (lv) { await Promise.race([lv, new Promise((res) => setTimeout(res, 2500))]); if (st.id !== id || my !== st.req) return; }
    let r;
    try { r = await xapi('/' + encodeURIComponent(id)); }
    catch (e) { if (st.id === id && my === st.req) fail('Нет связи с сервером. Проверь интернет.', true); return; }
    if (st.id !== id || my !== st.req) return;         // the student already went elsewhere
    if (r.status === 401 || r.status === 403) { fail('Чтобы открыть пробник, войди в тренажёр через Telegram.'); return; }
    if (r.status === 404) { fail('Такого пробника нет: возможно, назначение отменили. Если это ошибка, напиши мне.'); return; }
    if (r.status !== 200 || !r.json || typeof r.json.phase !== 'string') { fail('Не получилось загрузить пробник.', true); return; }
    st.view = r.json;
    setOffset(r.json.now);
    paint(r.json);
  }

  function paint(v) {
    scrollTop();
    const again = st.shownPhase === v.phase && st.shownId === v.id;   // the same screen fetched again by its own timer
    st.fade = !!(st.shownPhase && st.shownPhase !== v.phase && st.shownId === v.id);   // eased in by appear() once the new screen is on the page
    st.shownPhase = v.phase; st.shownId = v.id;
    if (v.phase === 'scheduled') return paintScheduled(v, again);
    if (v.phase === 'missed') return paintMissed(v);
    if (v.phase === 'open') return paintOpen(v);
    if (v.phase === 'photos') return paintPhotos(v);
    if (v.phase === 'submitted' || v.phase === 'checked') return paintResult(v);
    appEl.innerHTML = shell('<p class="lead">' + esc(v.phase) + '</p>');   // replaced by later tasks
  }

  const titleOf = (v) => esc((typeof v.title === 'string' ? v.title.trim() : '') || 'Пробник');
  const numOk = (x) => typeof x === 'number' && Number.isFinite(x);

  function paintScheduled(v, again) {
    // Malformed start or duration: the line is left out, never "undefined" or "NaN".
    const when = numOk(v.start) ? 'Начало ' + C.whenText(v.start) + ' (по Москве). ' : '';
    const mins = numOk(v.duration) && v.duration > 0 ? ' На работу даётся ' + C.durationText(v.duration / 60) + ', время идёт с назначенного начала.' : '';
    appEl.innerHTML = shell('<div class="vintro"><h2>' + titleOf(v) + '</h2>' +
      '<p class="lead">' + when + 'Когда время придёт, пробник откроется на этой странице.</p>' +
      '<p class="mode-hint">Приготовь черновики и ручку.' + mins + '</p>' +
      '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>');
    appear();
    const id = v.id;
    // Ask again just after the start. A start already past (the server still says "scheduled", or `until` is
    // missing) is never reused as a deadline: back off 30 s, then 60 s. Without a known server clock: no timer.
    const stale = !(numOk(v.until) && v.until * 1000 > serverNowMs());
    st.schedMiss = stale ? (again ? st.schedMiss + 1 : 1) : 0;
    if (st.synced) later(() => { if (st.id === id) renderExam(id); }, C.refreshDelay(v.until, serverNowMs(), st.schedMiss, 1200));
  }

  // A phase change on screen (the scheduled page becoming the exam) eases in instead of a hard cut.
  // Plays the ease-in once, on the screen that has just been put on the page (not on the one that is being replaced).
  function appear() { if (st.fade) { st.fade = false; fadeIn(); } }
  function fadeIn() {
    appEl.classList.remove('ex-screen-in'); void appEl.offsetWidth; appEl.classList.add('ex-screen-in');
    setTimeout(() => appEl.classList.remove('ex-screen-in'), 700);
  }

  function paintMissed(v) {
    appEl.innerHTML = shell('<div class="vintro"><h2>' + titleOf(v) + '</h2>' +
      '<p class="lead">Время пробника прошло, а работа так и не была открыта. Напиши мне — договоримся о новом времени.</p>' +
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
      (long ? photoBlockHTML(t.n) :
        '<input class="v-input" ' + ansAttrs() + ' maxlength="40" placeholder="Ответ" data-ex-in="' + t.n + '" value="' + esc(typed[t.n]) + '" autocomplete="off" aria-label="Ответ на задание ' + t.n + '">') +
      '</div>';
  }
  // The timer starts empty: it is filled from the server clock only (never "NaN:NaN").
  function barHTML() {
    return '<div class="vbar"><span class="vtimer" id="ex-timer" role="timer"></span>' +
      '<span class="vprog" id="ex-save" role="status" aria-live="polite"></span><span class="spacer"></span>' +
      '<button class="btn primary" data-ex-finish>Завершить</button></div>';
  }

  function paintOpen(v) {
    const id = st.id, tasks = C.wellFormedTasks(v.tasks);
    if (!tasks.length) { fail('Не получилось загрузить задания пробника.', true); return; }
    let typed = C.answersOf(v.answers, tasks);
    const hasLong = tasks.some((t) => t.kind === 'long');
    // Text typed on this exam earlier and never delivered (the screen was left offline) is newer than the server's: it wins.
    const pend = st.det[id];
    let pendSnap = pend ? pend.q.snapshot() : null;
    if (pend) { typed = C.mergePending(typed, pendSnap, tasks); stopSender(pend); delete st.det[id]; }
    else {                                                              // a page that was reloaded or unloaded: the copy in storage
      const kept = C.readPending(localStorage, C.pendKey(auth ? String(auth.userId || '') : '', id));
      if (kept) { pendSnap = kept; typed = C.mergePending(typed, kept, tasks); }
    }
    const dropped = !Array.isArray(v.tasks) || v.tasks.length !== tasks.length;
    const s = st.save = makeSession(id, v, tasks);
    s.ph = newPhotos(id, tasks, v.photos); s.ph.s = s;
    const lost = takeLost(id);
    if (pendSnap) tasks.forEach((t) => {
      const k = String(t.n);
      if (t.kind === 'short' && Object.prototype.hasOwnProperty.call(pendSnap, k) && typeof pendSnap[k] === 'string') s.q.set(k, pendSnap[k]);
    });
    bindOpen(s);
    stageAndMount(shell(barHTML() +
        '<p class="ex-note ex-savehint" id="ex-savehint" role="alert" hidden>Ответы пока не сохранились. Проверь интернет и не закрывай страницу, пока не появится «Сохранено».</p>' +
        (dropped ? '<p class="ex-note">Часть заданий не удалось показать. Напиши мне.</p>' : '') +
        (lost ? '<p class="ex-note">' + LOST_NOTE + '</p>' : '') +
        tasks.map((t) => cardHTML(t, typed)).join('') +
        (hasLong ? tgBlockHTML() : '') +
        '<div style="text-align:center;margin-top:8px"><button class="btn primary" data-ex-finish>Завершить пробник</button></div>'),
      () => st.save === s && !s.dead && parseRoute().view === 'exam',
      () => { appear(); startTimer(s); mountPhotos(s); if (s.q.has()) flush(s, { force: true }); });
  }

  // One session per painted exam screen (open or photo phase): what is typed, what is in flight, the photos, and whether
  // the screen is still ours. `uid` tells whose exam it is; `token` is the one the screen keeps for its requests.
  function makeSession(id, v, tasks) {
    const s = { id: id, phase: v.phase, q: new C.SaveQueue(), busy: null, fails: 0, nextAt: 0, dead: false, closed: false,
      syncing: false, finishing: false, away: new C.AwayTracker(2), until: v.until, tick: null,
      token: (auth && auth.token) || '', uid: auth ? String(auth.userId || '') : '', hasLong: tasks.some((t) => t.kind === 'long'),
      fatal: '', lastKind: '', inflight: null, noRetry: false, stop: false, ph: null };
    s.q.onChange = () => C.writePending(localStorage, C.pendKey(s.uid, id), s.q.snapshot());   // survives a tab that the phone unloads
    return s;
  }
  // The stored copy is useless once the server refuses answers for good (the window is over, the exam is gone).
  const forgetPending = (s) => C.writePending(localStorage, C.pendKey(s.uid, s.id), null);
  // The token a request of this screen goes with: the signed-in one while the screen is alive (it rotates), else the kept one.
  function tokOf(s) { if (live(s) && auth && auth.token) s.token = auth.token; return s.token; }

  // ---- countdown by the server clock ----
  function startTimer(s) {
    const tick = () => {
      if (s.dead) return;
      const e = document.getElementById('ex-timer');
      if (!st.synced || typeof s.until !== 'number' || !Number.isFinite(s.until)) { if (e) e.textContent = ''; return; }
      const sec = C.leftSec(s.until, st.offset, Date.now());
      if (e) { e.textContent = C.fmtLeft(sec); e.classList.toggle('low', sec <= (s.phase === 'photos' ? 120 : 300)); }
      if (sec <= 3 && s.q.has()) flush(s, { force: true });     // the last seconds: whatever is typed goes out now
      if (sec === 0) syncPhase(s);                    // idempotent: one sync cycle at a time
    };
    s.tick = tick; every(tick, 1000); tick();
  }
  const timeLeft = (s) => (st.synced && typeof s.until === 'number' && Number.isFinite(s.until) ? C.leftSec(s.until, st.offset, Date.now()) : -1);

  // The screen takes the next phase from the server, never from the device clock: flush what is typed,
  // ask, and if the server still says the same phase ask again (2 s five times, then every 10 s). Replaces the screen only on a phase change.
  function syncPhase(s) {
    if (!s || s.dead || s.syncing) return;
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
        if (r.json.phase !== s.phase) { s.closed = true; adopt(s.id, r.json); return; }   // this phase is over: the server takes no more answers, nothing is kept for later
        setOffset(r.json.now);
        if (typeof r.json.until === 'number' && Number.isFinite(r.json.until)) s.until = r.json.until;
        if (timeLeft(s) > 0) { s.syncing = false; s.closed = false; if (s.q.has()) flush(s, { force: true }); return; }   // the server says there is time left after all
      }
      tries++;
      later(step, tries < 5 ? 2000 : 10000);
    };
    step();
  }
  // Shows a phase fetched by syncPhase: the same as renderExam, without a second request.
  // Photos still on their way go with it when the next screen is the photo phase (open -> photos); otherwise they are dropped.
  function adopt(id, json) {
    const kp = st.shownPhase, ki = st.shownId;
    leave(json.phase === 'photos');
    st.shownPhase = kp; st.shownId = ki;
    st.id = id; st.req++; st.view = json; setOffset(json.now);
    // Whatever happens while painting, photos the new screen did not take over are dropped here (no uploads or
    // beforeunload guard left behind with nobody to own them); a painting that throws leaves a retry screen.
    try { paint(json); }
    catch (e) { fail('Не получилось показать пробник.', true); }
    finally { if (st.carry) { addLost(id, dropPhotos(st.carry)); st.carry = null; } }
  }

  // ---- autosave of part 1 ----
  // "Сохранено" is shown with a tick, in green, and goes out after a couple of seconds: a status that never changes is not read.
  const SAVED = 'Сохранено';
  let savedTimer = 0;
  const setSaveText = (t, bad) => {
    clearTimeout(savedTimer);
    const e = document.getElementById('ex-save'), ok = t === SAVED;
    if (e) { e.textContent = ok ? '✓ ' + SAVED : t; e.classList.toggle('bad', !!bad); e.classList.toggle('ok', ok); }
    if (ok) savedTimer = setTimeout(() => {
      const x = document.getElementById('ex-save');
      if (x && x.classList.contains('ok')) { x.textContent = ''; x.classList.remove('ok'); }
    }, 2500);
    const h = document.getElementById('ex-savehint');
    if (h) h.hidden = !bad;
  };
  const live = (s) => !!s && !s.dead && st.save === s;
  // ask() of index.html that leave() can close: a confirmation of one screen must not stay on top of the next one.
  async function askHere(o) {
    st.sheets++;
    try { return await ask(o); } finally { if (st.sheets > 0) st.sheets--; }
  }

  // One POST of answers; resolves to the HTTP status, or null for a network error or a timeout. The screen keeps its token
  // (refreshed while it is the signed-in one) so that a sign-out cannot strip it from the last request.
  async function post(s, snap, opt) {
    if (!s.dead && auth && auth.token) s.token = auth.token;
    try { return (await xapi('/' + s.id + '/answers', { method: 'POST', body: { answers: snap }, keep: !!(opt && opt.keep), token: s.token })).status; }
    catch (e) { return null; }
  }
  // What the student sees for a failed save: only a network problem, a timeout or a 5xx is "check the connection".
  const FAIL_TEXT = { retry: 'Не сохранено', client: 'Не принято' };   // short: the bar is one line on a phone

  // One request. Typed answers stay queued until the server says 200; a failure backs off 5 s, 15 s, 30 s and keeps them,
  // a permanent answer (401/403, 404) stops the retries. A stale screen (left, replaced) paints nothing.
  // Returns true when the server took the answers.
  async function send(s, opt) {
    const snap = s.q.snapshot();
    if (live(s)) setSaveText('Сохраняю…');
    s.inflight = snap;
    let status;
    try { status = await post(s, snap, opt); } finally { s.inflight = null; }
    const kind = C.classifyStatus(status);
    if (kind === 'ok') {
      s.q.ack(snap); syncAnswerGuard();
      if (live(s)) { s.fails = 0; s.nextAt = 0; s.lastKind = ''; setSaveText(s.q.has() ? 'Сохраняю…' : 'Сохранено'); }
      return true;
    }
    if (!live(s)) return false;
    if (kind === 'closed') { s.closed = true; forgetPending(s); syncAnswerGuard(); setSaveText(''); syncPhase(s); return false; }   // the window is over: the server decides what comes next
    if (kind === 'gone') forgetPending(s);
    if (kind === 'auth' || kind === 'gone') { s.fatal = ''; fatalStop(s, kind); return false; }
    s.fails++; s.lastKind = kind;
    const d = C.retryDelay(s.fails);
    s.nextAt = Date.now() + d;
    setSaveText(FAIL_TEXT[kind], true);
    clearTimeout(st.retryTimer);
    st.retryTimer = setTimeout(() => flush(s, { force: true }), C.clampDelay(d));
    return false;
  }
  // One request at a time; whatever is typed meanwhile goes out right after it. `force` ignores the back-off (the page is
  // going away, or a button was pressed); `keep` makes the request survive a closing page: with a request already on its
  // way, what it does not carry goes out in a parallel keepalive request (the server takes the same answers twice).
  function flush(s, opt) {
    opt = opt || {};
    if (!s || s.dead || s.closed || s.fatal || !s.q.has()) return Promise.resolve();
    if (s.busy) { if (opt.keep) sendBeside(s); return s.busy; }
    if (!opt.force && Date.now() < s.nextAt) return Promise.resolve();      // backing off: the retry timer will send it
    clearTimeout(st.saveTimer);
    s.busy = (async () => {
      try { while (await send(s, opt) && s.q.has() && !s.dead && !s.closed) { /* typed while the request was out */ } }
      finally { s.busy = null; }
    })();
    return s.busy;
  }
  function sendBeside(s) {
    const extra = C.unsentOf(s.q.snapshot(), s.inflight);
    if (!Object.keys(extra).length) return;
    post(s, extra, { keep: true }).then((status) => { if (status === 200) s.q.ack(extra); });
  }
  // The screen was left with answers still unsent: keep trying in the background with its own token, three retries
  // (5, 15, 30 s) after the first failure, never painting. Stops on a permanent answer, when the window is over (409), when
  // the student comes back to the same exam (`stop`: the new screen takes the text over) or on a sign-out of another user.
  // Stops a detached sender: a request already on its way is left alone, the loop ends. With `onlyWaiting` only a sender
  // that sleeps before its next try is stopped (one that has not made its first attempt yet still makes it).
  function stopSender(d, onlyWaiting) {
    if (onlyWaiting && !d.dres) return;
    d.stop = true; clearTimeout(d.dwait);
    if (d.dres) d.dres();
  }
  async function drain(s) {
    let fails = 0;
    try {
      while (!s.stop) {
        await Promise.resolve(s.busy);               // a request of the live screen still on its way goes first
        if (s.stop || !s.q.has()) break;
        const snap = s.q.snapshot();
        const kind = C.classifyStatus(await post(s, snap));
        if (kind === 'ok') { s.q.ack(snap); fails = 0; continue; }
        if (kind === 'closed' || kind === 'auth' || kind === 'gone') { s.fatal = kind; break; }
        const d = s.noRetry ? null : C.detachedDelay(++fails);
        if (d === null || s.stop) break;
        await new Promise((res) => { s.dres = res; s.dwait = setTimeout(res, C.clampDelay(d)); });
        s.dres = null;
      }
    } finally {
      if ((!s.q.has() || s.fatal) && st.det[s.id] === s) delete st.det[s.id];   // delivered or hopeless; otherwise it is kept for a return
    }
  }

  // ---- finishing early ----
  async function finishNow(s) {
    if (s.finishing || s.dead || s.result) return;
    if (s.fatal) {
      if (s.fatal === 'auth') note('Нужно войти заново', 'Твой вход устарел, пробник не принимает ответы. Войди через ссылку из Telegram и открой пробник снова.');
      else note('Пробник недоступен', 'Сервер не нашёл этот пробник. Напиши мне.');
      return;
    }
    if (uploading(s)) { note('Фото ещё загружаются', 'Подожди, пока загрузка закончится, и нажми «Завершить» ещё раз.'); return; }
    const failedPh = !!s.ph && s.ph.pending.length > 0;
    const blank = [].slice.call(document.querySelectorAll('[data-ex-in]')).filter((i) => !i.value.trim()).map((i) => i.dataset.exIn);
    const ok = await askHere({ title: 'Завершить пробник?',
      text: (blank.length ? 'Без ответа: ' + (blank.length === 1 ? 'задание ' : 'задания ') + blank.join(', ') + '. ' : '') +
        (s.hasLong ? 'Ответы первой части' : 'Ответы') + ' после этого изменить нельзя.' + (s.hasLong ? ' Фото второй части можно будет прикрепить ещё ' + C.minutesText(10) + '.' : '') +
        (failedPh ? ' Фото, которые не загрузились, останутся в списке с кнопкой «Ещё раз».' : ''),
      ok: 'Завершить', cancel: 'Вернуться' });
    if (!ok || s.dead) return;
    s.finishing = true;
    document.querySelectorAll('[data-ex-finish]').forEach((b) => { b.disabled = true; });
    try {
      await flush(s, { force: true });
      if (s.dead) return;
      if (s.fatal) { note('Ответы не сохранились', 'Войди заново: пока не получится ни сохранить ответы, ни завершить пробник.'); return; }
      // Answers that could not be saved must not be cut off by finishing: the student keeps the page and tries again.
      // Only when the server itself refuses them (a 4xx other than the ones above) can he finish and lose them, knowingly.
      if (s.q.has() && !s.closed) {
        if (s.lastKind !== 'client') { note('Ответы пока не сохранились', 'Проверь интернет и нажми «Завершить» ещё раз. Не закрывай эту страницу, пока не появится «Сохранено».'); return; }
        const sure = await askHere({ title: 'Не все ответы сохранились', text: 'Сервер не принял часть ответов. Если завершить сейчас, они пропадут. Завершить всё равно?',
          ok: 'Завершить', cancel: 'Вернуться', danger: true });
        if (!sure || s.dead) return;
      }
      const r = await xapi('/' + s.id + '/finish', { method: 'POST', token: s.token }).catch(() => null);
      if (s.dead) return;
      if (!r || (r.status !== 200 && r.status !== 409)) { note('Не получилось завершить', 'Проверь интернет и нажми «Завершить» ещё раз. Ответы сохранены.'); return; }
      s.closed = true; forgetPending(s); syncAnswerGuard();  // finished: whatever was refused is dropped, nothing is sent after this
      afterFinish(s);                                      // the server says which screen is next; photos on their way go with it
    } finally {
      s.finishing = false;
      if (!s.dead && !s.closed) document.querySelectorAll('[data-ex-finish]').forEach((b) => { b.disabled = false; });   // finished: they stay off until the next screen
    }
  }

  // After /finish: reads the exam and shows the next screen through adopt(), so that photos still uploading (or failed) at this
  // moment go on into the photo phase instead of being cancelled; a failed read falls back to a plain reload of the screen.
  async function afterFinish(s) {
    let r = null;
    try { r = await xapi('/' + encodeURIComponent(s.id)); } catch (e) { r = null; }
    if (s.dead) return;
    if (r && r.status === 200 && r.json && typeof r.json.phase === 'string' && r.json.phase !== s.phase) { adopt(s.id, r.json); return; }
    renderExam(s.id);
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
  // The native file dialog blurs the window (and on a phone may hide the page): that is not "away". The mark expires,
  // so a dialog that never reported its end cannot hide a real absence for ever.
  const pickerOn = () => C.pickerActive(st.picker, Date.now());
  function awayOut(s) { if (openNow(s) && !pickerOn()) s.away.hide(Date.now(), currentTask()); }
  function awayBack(s) {
    if (s.dead) return;
    if (pickerOn()) { st.picker = 0; return; }
    st.picker = 0;
    const a = s.away.show(Date.now());
    if (a && openNow(s)) xapi('/' + s.id + '/away', { method: 'POST', body: { n: a.n, sec: a.sec } }).catch(() => {});
  }

  // Back on the page after a while (a sleeping device, a switched tab): read the server clock again instead of trusting the old offset.
  async function resyncClock(s) {
    if (s.dead || s.resyncing || Date.now() - (s.resyncAt || 0) < 5000) return;
    s.resyncing = true; s.resyncAt = Date.now();
    try {
      const r = await xapi('/mine', { token: s.token });
      if (!s.dead && r.status === 200 && r.json) { setOffset(r.json.now); if (s.tick) s.tick(); }
    } catch (e) { /* the old offset stays */ }
    s.resyncing = false;
  }

  // Everything the open screen listens to; leave() removes all of it.
  function bindOpen(s) {
    listen(appEl, 'input', (e) => {
      const inp = e.target.closest && e.target.closest('[data-ex-in]');
      if (!inp || s.dead) return;
      s.q.set(inp.dataset.exIn, inp.value); syncAnswerGuard();
      if (!s.fails && !s.fatal) setSaveText('Сохраняю…');         // a fatal status (sign in again) is not overwritten
      clearTimeout(st.saveTimer); st.saveTimer = setTimeout(() => flush(s), C.clampDelay(700));
    });
    listen(appEl, 'focusout', (e) => { if (e.target.closest && e.target.closest('[data-ex-in]')) flush(s); });
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') { awayOut(s); flush(s, { force: true, keep: true }); }
      else { awayBack(s); resyncClock(s); if (s.tick) s.tick(); }
    });
    listen(window, 'pagehide', () => flush(s, { force: true, keep: true }));
    listen(window, 'blur', () => awayOut(s));
    listen(window, 'focus', () => awayBack(s));
    listen(window, 'online', () => { flush(s, { force: true }); wakeUploads(s.ph); });
    listen(document, 'click', (e) => leaveGuard(s, e), true);
  }

  // ---- photos of part 2: from the site and from the bot ----
  /* Every long task has a block with its own photos (up to five); photos sent to the bot belong to no task and are shown
     in one more block. The server list is the truth: it is polled every 15 s while this screen is up, the photos attached
     here are shown at once from the local preview.
     All of it lives in one object `P` (the photos of one exam screen): lists, uploads in flight, local previews, the file
     token, timers, AbortControllers. `P.s` is the session of the screen that shows it now. When the open phase turns into
     the photo phase, `P` is handed over to the new session (adopt -> paintPhotos) and the uploads simply go on; every other
     way out of the screen (leave, reset, the end of the photo phase) drops it with dropPhotos(): uploads are aborted,
     previews revoked, the file token forgotten. A late answer for a dead `P` paints nothing. Nothing from the server
     reaches the page other than through esc() / encodeURIComponent, and no selector is built from a task number (blocks
     are found through dataset). */
  const PH = C.PHOTO;
  const BAD_FILE = 'Этот файл не получается обработать. Попробуй другое фото или отправь его боту в Telegram.';
  const TEXT_PH = {
    tooMany: 'К заданию уже прикреплено ' + PH.PER_TASK + ' фото — больше нельзя. Лишнее можно убрать крестиком.',
    badFile: 'Сервер не принял это фото. Нужна картинка JPEG, PNG или WebP до 10 МБ.',
    badFileNeutral: 'Не получилось отправить это фото. Нажми «Ещё раз» или отправь фото боту в Telegram.',
    badFileGiveUp: 'Сервер не принимает это фото. Убери его и отправь фото боту в Telegram.',
    badTask: 'Это задание не принимает фото. Обнови страницу.',
    retry: 'Не загрузилось — проверь интернет и нажми «Ещё раз» на фото.',
    auth: 'Войди в тренажёр заново — пока ты не вошёл, фото не загрузятся.',
    gone: 'Пробник недоступен. Напиши мне.',
    listGone: 'Список фото больше не обновляется: сервер его не нашёл. Показано то, что было загружено; если что-то не так, напиши мне.',
    closed: 'Время для фото вышло. Смотрю, что дальше…',
    delFail: 'Не получилось удалить фото — попробуй ещё раз.',
  };
  const LOST_NOTE = 'Часть фото не успела загрузиться. Прикрепи их ещё раз.';

  const photoBlockHTML = (n) => '<div class="ex-photos" data-ex-ph="' + Number(n) + '">' +
    '<div class="ex-thumbs"></div>' +
    '<div class="ex-row"><button type="button" class="btn ex-add" data-ex-pick>Прикрепить фото</button><span class="ex-cnt"></span></div>' +
    '<input type="file" accept="image/*" multiple hidden data-ex-file="' + Number(n) + '" aria-label="Фото решения, задание ' + Number(n) + '">' +
    '<p class="ex-msg" data-ex-msg role="status" aria-live="polite"></p></div>';

  // Photos can also be sent to the sign-in bot; the page picks them up by polling the list.
  const tgBlockHTML = () => '<div class="vcard ex-tg"><div class="vlabel">Можно отправить фото боту</div>' +
    '<p class="ex-note">Отправь фото решений боту <a href="https://t.me/' + TG_BOT + '" target="_blank" rel="noopener">@' + TG_BOT + '</a> — ' +
    'подпись и номер задания не нужны. Фото появятся ниже, в блоке «Фото, присланные боту» (до ' + PH.BOT_MAX + ' штук).</p></div>' +
    '<div class="vcard ex-tgph" data-ex-bot hidden><div class="vlabel">Фото, присланные боту</div><div class="ex-thumbs"></div>' +
    '<p class="ex-msg" data-ex-msg role="status" aria-live="polite"></p></div>';

  function newPhotos(id, tasks, list) {
    const known = tasks.filter((t) => t.kind === 'long').map((t) => String(t.n));
    return { id: id, s: null, known: known, server: C.wellFormedPhotos(list, known), pending: [], local: new Map(), urls: new Set(), msgs: new Map(),
      deleting: new Set(), ro: false, ctls: new Set(), timers: new Set(), ftoken: '', ftokenAt: 0, tokP: null, rev: 0, seq: 0, busy: null,
      polling: false, pollT: 0, pollFails: 0, polledAt: 0, gen: 0, guard: null, listGone: false, dead: false };
  }
  const phLive = (P) => !!P && !P.dead && !!P.s && live(P.s);
  const uploadingP = (P) => !!P && P.pending.some((x) => x.state !== 'err');
  const uploading = (s) => !!s && uploadingP(s.ph);

  // The page must not be closed or reloaded silently while photos are still on their way (or failed): only while there are any.
  function syncGuard(P) {
    const need = !P.dead && P.pending.length > 0;
    if (need && !P.guard) {
      P.guard = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
      window.addEventListener('beforeunload', P.guard);
    } else if (!need && P.guard) { window.removeEventListener('beforeunload', P.guard); P.guard = null; }
  }

  // The same for typed answers that the server has not confirmed yet (memory only, nothing is stored): the guard is
  // there while the current screen holds unsent text, and goes when it is sent, closed, or the screen is left.
  function syncAnswerGuard() {
    const s = st.save;
    const need = !!s && !s.dead && !s.closed && s.q.has();
    if (need && !st.ansGuard) {
      st.ansGuard = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
      window.addEventListener('beforeunload', st.ansGuard);
    } else if (!need && st.ansGuard) { window.removeEventListener('beforeunload', st.ansGuard); st.ansGuard = null; }
  }

  // Cancels everything a screen holds for its photos; returns how many photos were still on their way or failed (lost).
  function dropPhotos(P) {
    if (!P || P.dead) return 0;
    P.dead = true;
    const lost = P.pending.length;
    P.ctls.forEach((c) => { try { c.abort(); } catch (e) {} }); P.ctls.clear();
    clearTimeout(P.pollT); P.pollT = 0;
    P.timers.forEach((t) => clearTimeout(t)); P.timers.clear();
    P.urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} }); P.urls.clear();
    P.pending = []; P.server = []; P.local.clear(); P.msgs.clear(); P.deleting.clear(); P.ftoken = ''; P.tokP = null; P.s = null;
    syncGuard(P);
    return lost;
  }
  // The open screen goes away but its photos go on: nobody owns them until the next screen takes them over.
  function detachPhotos(P) {
    P.s = null; P.gen++; P.polling = false;
    clearTimeout(P.pollT); P.pollT = 0;
  }
  // A new session takes over photos that were detached: the task list may differ, what does not fit is let go.
  // `raw` is the photo list of the response that brought the new screen: photos the bot received meanwhile show at once.
  function attachPhotos(P, s, tasks, raw) {
    P.s = s; s.ph = P;
    if (P.listGone) { P.listGone = false; P.msgs.forEach((m, k) => { if (m.t === TEXT_PH.listGone) P.msgs.delete(k); }); }   // the new screen asks the list again
    P.known = tasks.filter((t) => t.kind === 'long').map((t) => String(t.n));
    P.server = Array.isArray(raw) ? C.mergePhotoLists(raw, P.server, P.local, P.known) : C.wellFormedPhotos(P.server, P.known);
    P.local.forEach((u, id) => { if (!P.server.some((q) => q.id === id)) { revokeUrl(P, u); P.local.delete(id); } });
    P.pending.filter((x) => P.known.indexOf(x.n) < 0).forEach((x) => dropPending(P, x));
  }
  function dropPending(P, it) {
    if (it.ctl) { try { it.ctl.abort(); } catch (e) {} P.ctls.delete(it.ctl); }
    clearTimeout(it.timer);
    P.pending = P.pending.filter((x) => x !== it);
    revokeUrl(P, it.url);
  }
  function phLater(P, fn, ms) {
    const t = setTimeout(() => { P.timers.delete(t); if (!P.dead) fn(); }, C.clampDelay(ms));
    P.timers.add(t);
    return t;
  }
  function makeUrl(P, blob) {
    if (P.dead) return '';
    try { const u = URL.createObjectURL(blob); P.urls.add(u); return u; } catch (e) { return ''; }
  }
  function revokeUrl(P, u) { if (!u) return; P.urls.delete(u); try { URL.revokeObjectURL(u); } catch (e) {} }

  // ---- file access: a short-lived token, refreshed before it expires (the token itself is never printed or stored) ----
  function freshFileToken(P, maxAge) {
    if (!P || P.dead || !P.s) return Promise.resolve('');
    if (P.ftoken && Date.now() - P.ftokenAt < maxAge) return Promise.resolve(P.ftoken);
    if (P.tokP) return P.tokP;
    const p = (async () => {
      try {
        const r = await xapi('/files/token', { method: 'POST', root: true, token: tokOf(P.s), timeout: 10000 });
        if (!P.dead && r.status === 200 && r.json && typeof r.json.token === 'string' && r.json.token) { P.ftoken = r.json.token; P.ftokenAt = Date.now(); }
      } catch (e) { /* thumbnails stay as they are until the next try */ }
      finally { if (P.tokP === p) P.tokP = null; }
      return P.dead ? '' : P.ftoken;
    })();
    P.tokP = p;
    return p;
  }
  const thumbUrl = (tok, p) => API + '/files/exam_photos/' + encodeURIComponent(p.id) + '/' + encodeURIComponent(p.file) + '?token=' + encodeURIComponent(tok);
  const needsToken = (P) => P.server.some((p) => !P.local.has(p.id)) && (!P.ftoken || Date.now() - P.ftokenAt >= 60000);

  // ---- drawing ----
  // The block of a task (n = '13'), found through dataset, never through a selector built from n; n = '' is the bot's block.
  function phRoot(n) {
    if (n === '') return appEl.querySelector('[data-ex-bot]');
    const all = appEl.querySelectorAll('[data-ex-ph]');
    for (let i = 0; i < all.length; i++) if (all[i].dataset.exPh === n) return all[i];
    return null;
  }
  const altOf = (n) => n === '' ? 'Фото решения, присланное боту' : 'Фото решения, задание ' + n;
  // `tok` is what goes into the thumbnail address; the screen compares tiles with a stand-in token, so a new token alone
  // never redraws (and so never reloads) a tile that is on screen.
  function serverFig(P, p, tok) {
    const src = P.local.get(p.id) || (tok ? thumbUrl(tok, p) : '');
    return '<figure class="ex-thumb' + (src ? ' ex-z' : '') + '">' + (src ? '<img data-ex-img="' + esc(p.id) + '" src="' + esc(src) + '" alt="' + esc(altOf(p.n)) + '" loading="lazy" decoding="async">'
        : '<span class="ex-nopic" aria-hidden="true"></span>') +
      (P.ro ? '' : '<button type="button" class="ex-del" data-ex-del="' + esc(p.id) + '" aria-label="Удалить фото"' + (P.deleting.has(p.id) ? ' disabled' : '') + '>×</button>') + '</figure>';
  }
  function pendFig(x) {
    const bad = x.state === 'err';
    const label = x.state === 'prep' ? 'Готовлю…' : x.state === 'wait' ? 'Ждём связь…' : 'Загружаю…';
    return '<figure class="ex-thumb ' + (bad ? 'ex-err' : 'ex-busy') + (x.url ? ' ex-z' : '') + '">' +
      (x.url ? '<img src="' + esc(x.url) + '" alt="' + esc(altOf(x.n)) + '">' : '<span class="ex-nopic" aria-hidden="true"></span>') +
      (bad ? (x.fatal ? '<span class="ex-st">Не принято</span>' : '<button type="button" class="ex-st ex-retry" data-ex-rt="' + esc(x.key) + '">Ещё раз</button>')
        : '<span class="ex-st">' + label + '</span>') +
      '<button type="button" class="ex-del" data-ex-rm="' + esc(x.key) + '" aria-label="Убрать фото">×</button></figure>';
  }
  function drawBlock(P, n) {
    if (!P || P.dead) return;
    syncGuard(P);
    n = String(n);
    const root = phRoot(n);
    if (!root) return;
    const mine = P.server.filter((p) => p.n === n), pend = P.pending.filter((x) => x.n === n);
    const tail = pend.map(pendFig).join('');
    const html = mine.map((p) => serverFig(P, p, P.ftoken)).join('') + tail;
    const sig = mine.map((p) => serverFig(P, p, P.ftoken ? 'T' : '')).join('') + tail;
    const box = root.querySelector('.ex-thumbs');
    if (box && box._exSig !== sig) { box.innerHTML = html; box._exSig = sig; }
    if (n === '') root.hidden = !mine.length && !pend.length;
    const msg = root.querySelector('[data-ex-msg]');
    if (msg) msg.textContent = (P.msgs.get(n) || {}).t || '';
    if (n === '') return;
    const held = mine.length, coming = pend.filter((x) => x.state !== 'err').length;
    const cnt = root.querySelector('.ex-cnt'), add = root.querySelector('[data-ex-pick]');
    if (cnt) cnt.textContent = held + coming ? (held + coming) + ' из ' + PH.PER_TASK : '';
    if (add) add.disabled = C.photoRoom(held, coming) === 0;
  }
  function drawAll(P) {
    if (!P || P.dead) return;
    P.known.forEach((n) => drawBlock(P, n));
    drawBlock(P, '');
  }
  // The line under a block. A problem stays until the next success or the next try; a `keep` notice (some of the chosen
  // files were left out) also survives the uploads that follow, until the student acts on that block again.
  function putMsg(P, n, text, keep) { if (text) P.msgs.set(String(n), { t: text, keep: !!keep }); else P.msgs.delete(String(n)); }
  function setMsg(P, n, text, keep) {
    if (!P || P.dead) return;
    putMsg(P, n, text, keep);
    drawBlock(P, n);
  }
  // A thumbnail that does not load (the token ran out while the page stayed open) gets one more try with a new token.
  appEl.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-ex-img')) return;
    const P = st.save && st.save.ph;
    if (!phLive(P)) return;
    if (img.dataset.exTried) { img.classList.add('ex-broken'); return; }
    img.dataset.exTried = '1';
    const p = P.server.find((x) => x.id === img.dataset.exImg);
    if (!p) return;
    freshFileToken(P, 10000).then((tok) => { if (phLive(P) && tok && img.isConnected) img.src = thumbUrl(tok, p); });
  }, true);

  // The server list became the truth: show it (the token is looked at next, so that new thumbnails can load).
  function applyList(P, raw) {
    const next = C.wellFormedPhotos(raw, P.known);
    if (C.photoSig(next) === C.photoSig(P.server)) return;
    P.server = next;
    P.local.forEach((u, id) => { if (!next.some((q) => q.id === id)) { revokeUrl(P, u); P.local.delete(id); } });   // gone from the server
    P.deleting.forEach((id) => { if (!next.some((q) => q.id === id)) P.deleting.delete(id); });
    drawAll(P);
    refreshPics(P);
  }
  function refreshPics(P) {
    if (!P || P.dead || !needsToken(P)) return;
    const had = P.ftoken;
    freshFileToken(P, 60000).then((tok) => { if (phLive(P) && tok && !had) drawAll(P); });   // a new token alone redraws nothing
  }

  // A permanent answer to a request of the screen (sign in again / the exam is gone): shown in the status of the bar, no more
  // retries of the answers; the photo poll stops by itself.
  function fatalStop(s, kind) {
    if (!s || s.dead) return;
    s.fatal = s.fatal || kind;
    clearTimeout(st.retryTimer);
    setSaveText(kind === 'auth' ? 'Войди заново' : 'Пробник недоступен', true);
  }

  // ---- the server list every 15 s while the screen is up (paused when the tab is hidden, backs off on failures) ----
  function startPoll(P) {
    const gen = ++P.gen;
    const schedule = (ms) => { clearTimeout(P.pollT); P.pollT = P.dead || gen !== P.gen ? 0 : setTimeout(tick, C.clampDelay(ms)); };
    const tick = async () => {
      if (gen !== P.gen) return;
      P.pollT = 0;
      if (!phLive(P) || P.s.fatal || P.listGone) return;                // a permanent refusal stops the poll for good
      if (P.polling) { schedule(1000); return; }
      if (document.visibilityState === 'hidden') return;                // paused: coming back to the page asks at once
      P.polling = true; P.polledAt = Date.now();
      const rev = P.rev, s = P.s;
      let r = null;
      try { r = await xapi('/' + encodeURIComponent(P.id) + '/photos', { token: tokOf(s), timeout: 15000 }); } catch (e) { r = null; }
      if (gen !== P.gen) return;                                        // superseded (the photos moved to a new screen)
      P.polling = false;
      if (!phLive(P)) return;                                           // stale: the screen is gone
      const kind = C.classifyStatus(r && r.status);
      if (kind === 'ok' && r.json && Array.isArray(r.json.photos)) {
        P.pollFails = 0;
        // An answer older than a photo added or deleted here meanwhile must not undo it: ask again soon instead.
        if (P.rev === rev) applyList(P, r.json.photos);
        schedule(P.rev === rev ? C.pollDelay(0) : 2000);
        return;
      }
      if (kind === 'auth') { fatalStop(P.s, kind); return; }             // nothing to wait for: say so and stop
      // 404 from the photo list only ends the list: the photo blocks say so, answers still go through their own requests
      // (a 404 from /answers or /finish does mean that the exam is gone).
      if (kind === 'gone') { P.listGone = true; P.known.forEach((n) => putMsg(P, n, TEXT_PH.listGone)); putMsg(P, '', TEXT_PH.listGone); drawAll(P); return; }
      if (kind === 'closed') syncPhase(P.s);                            // the server decides which screen is next
      P.pollFails++;
      schedule(C.pollDelay(P.pollFails));
    };
    const resume = () => {
      if (!phLive(P) || P.s.fatal || P.listGone || P.polling || gen !== P.gen) return;
      schedule(Math.max(0, 3000 - (Date.now() - P.polledAt)));          // never faster than every 3 s
    };
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });
    listen(window, 'online', resume);
    schedule(P.polledAt ? 0 : C.pollDelay(0));
  }

  function mountPhotos(s) {
    const P = s.ph;
    if (!phLive(P)) return;
    syncGuard(P);
    if (!P.known.length) return;
    drawAll(P);
    refreshPics(P);
    wakeUploads(P);                                                     // photos carried over from the open phase go on
    startPoll(P);
  }

  // ---- downscale before upload: phone originals are tens of MB; the original is never sent ----
  function decode(file) {
    const viaImg = () => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      let t = 0;
      const clean = () => { clearTimeout(t); img.onload = img.onerror = null; URL.revokeObjectURL(url); };
      t = setTimeout(() => { clean(); reject(new Error('decode')); }, C.clampDelay(30000));
      img.onload = () => { clean(); resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: null }); };
      img.onerror = () => { clean(); reject(new Error('decode')); };
      img.src = url;
    });
    if (typeof createImageBitmap !== 'function') return viaImg();
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((b) => ({ src: b, w: b.width, h: b.height, close: () => b.close() }))
      .catch(() => viaImg());
  }
  // A JPEG blob with the long side at most 2000 px, or an error (not an image, undecodable such as HEIC in most browsers,
  // absurdly large). A transparent PNG is flattened on white.
  async function downscale(file) {
    const d = await decode(file);
    try {
      if (!C.dimsOk(d.w, d.h)) throw new Error('size');
      const z = C.fitSize(d.w, d.h, PH.SIDE), cv = document.createElement('canvas');
      cv.width = z.w; cv.height = z.h;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, z.w, z.h); g.drawImage(d.src, 0, 0, z.w, z.h);
      const toBlob = (q) => new Promise((res) => { try { cv.toBlob(res, 'image/jpeg', q); } catch (e) { res(null); } });
      let blob = await toBlob(0.85);
      if (blob && blob.size > 9 * 1024 * 1024) blob = await toBlob(0.6);
      cv.width = cv.height = 0;
      if (!blob || blob.type !== 'image/jpeg' || blob.size > PH.SERVER_MAX) throw new Error('encode');
      return blob;
    } finally { if (d.close) d.close(); }
  }

  // ---- adding photos: one upload at a time, a bounded number of tries each ----
  function addFiles(P, n, files) {
    if (!phLive(P) || P.known.indexOf(String(n)) < 0) return;
    n = String(n);
    const held = P.server.filter((p) => p.n === n).length, coming = P.pending.filter((x) => x.n === n && x.state !== 'err').length;
    const room = C.photoRoom(held, coming), take = files.slice(0, room);
    if (!take.length) { setMsg(P, n, TEXT_PH.tooMany); return; }
    take.forEach((f) => P.pending.push({ key: 'u' + (++P.seq), n: n, file: f, blob: null, url: '', state: 'queued', tries: 0, manual: 0, bad: false, fatal: false, ctl: null, timer: 0 }));
    putMsg(P, n, take.length < files.length ? 'Прикрепляю ' + take.length + ' из ' + files.length + ': на задание можно не больше ' + PH.PER_TASK + ' фото.' : '', true);
    drawBlock(P, n);
    pump(P);
  }
  function pump(P) {
    if (!phLive(P) || P.busy) return;
    const it = P.pending.find((x) => x.state === 'queued');
    if (!it) return;
    P.busy = it;
    run(P, it).catch(() => { if (phLive(P) && P.pending.indexOf(it) >= 0) { it.state = 'err'; setMsg(P, it.n, TEXT_PH.retry); } })
      .then(() => { if (P.busy === it) P.busy = null; pump(P); });
  }
  async function run(P, it) {
    const n = it.n;
    const alive = () => !P.dead && P.pending.indexOf(it) >= 0;          // the photos still exist and the student did not remove this one
    const drop = (text) => { dropPending(P, it); setMsg(P, n, text); };
    if (!it.blob) {
      it.state = 'prep'; drawBlock(P, n);
      let blob = null;
      try { if (it.file.size > 0 && it.file.size <= PH.SRC_MAX) blob = await downscale(it.file); } catch (e) { blob = null; }
      it.file = null;                                                   // the original is not needed (or sent) any more
      if (!alive()) return;
      if (!blob) { drop(BAD_FILE); return; }
      it.blob = blob; it.url = makeUrl(P, blob);
    }
    it.state = 'up'; drawBlock(P, n);
    const fd = new FormData();
    fd.append('n', n); fd.append('file', it.blob, 'photo.jpg');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) { it.ctl = ctl; P.ctls.add(ctl); }
    let r = null;
    try { r = await xapi('/' + encodeURIComponent(P.id) + '/photos', { method: 'POST', form: fd, token: P.s ? tokOf(P.s) : '', signal: ctl ? ctl.signal : undefined }); } catch (e) { r = null; }
    if (ctl) { P.ctls.delete(ctl); it.ctl = null; }
    if (!alive()) return;                                               // left meanwhile: nothing is painted
    const msg = r && r.json && r.json.message;
    const v = C.uploadVerdict(r && r.status, msg);
    if (v === 'ok') {
      const got = C.wellFormedPhotos([r.json], P.known)[0];
      P.pending = P.pending.filter((x) => x !== it);
      P.rev++;
      if (got && got.n === n) {
        if (!P.server.some((p) => p.id === got.id)) P.server.push(got);   // a poll may have listed it already: never twice
        P.local.set(got.id, it.url);                                    // the thumbnail is the local preview, no download needed
      } else revokeUrl(P, it.url);                                      // an odd answer: the next poll shows what the server has
      if (!(P.msgs.get(n) || {}).keep) P.msgs.delete(n);
      drawBlock(P, n);
      return;
    }
    if (v === 'closed') { it.state = 'err'; it.fatal = true; setMsg(P, n, TEXT_PH.closed); syncPhase(P.s); return; }
    if (v === 'badTask') { drop(TEXT_PH.badTask); return; }
    if (v === 'badFile') {
      // The server did not take it; the photo and its blob stay (a few manual tries), the text stays neutral unless the
      // server's own words are about the type or the size.
      it.state = 'err'; it.bad = true; it.fatal = !C.canRetry(it.manual);
      setMsg(P, n, it.fatal ? TEXT_PH.badFileGiveUp : C.fileRefusal(msg) === 'typeSize' ? TEXT_PH.badFile : TEXT_PH.badFileNeutral);
      return;
    }
    if (v === 'retry') {
      it.tries++;
      const d = C.uploadRetryDelay(it.tries);
      if (d !== null) {
        it.state = 'wait'; drawBlock(P, n);
        it.timer = phLater(P, () => { if (it.state === 'wait' && P.pending.indexOf(it) >= 0) { it.state = 'queued'; pump(P); } }, d);
        return;
      }
    }
    it.state = 'err';                                                   // tooMany, auth, gone, or the tries ran out
    if (v === 'tooMany') it.fatal = true;
    if (v === 'auth' || v === 'gone') fatalStop(P.s, v);
    setMsg(P, n, v === 'tooMany' ? TEXT_PH.tooMany : v === 'auth' ? TEXT_PH.auth : v === 'gone' ? TEXT_PH.gone : TEXT_PH.retry);
  }
  // The connection is back (or the photos just came to a new screen): photos waiting for it go at once.
  function wakeUploads(P) {
    if (!phLive(P)) return;
    P.pending.forEach((x) => { if (x.state === 'wait') { clearTimeout(x.timer); x.state = 'queued'; } });
    pump(P);
  }
  function retryPhoto(P, key) {
    const it = P.pending.find((x) => x.key === key);
    if (!phLive(P) || !it || it.state !== 'err' || it.fatal) return;
    if (it.bad) { if (!C.canRetry(it.manual)) return; it.manual++; }
    it.state = 'queued'; it.tries = 0; putMsg(P, it.n, '');
    drawBlock(P, it.n); pump(P);
  }
  // A photo of the list that is still being prepared or sent: cancelled and forgotten.
  function removePending(P, key) {
    const it = P.pending.find((x) => x.key === key);
    if (!phLive(P) || !it) return;
    dropPending(P, it);
    drawBlock(P, it.n); pump(P);
  }
  async function removePhoto(P, pid) {
    const p = P.server.find((x) => x.id === pid);
    if (!phLive(P) || !p || P.deleting.has(pid)) return;
    const sure = await askHere({ title: 'Удалить фото?', text: 'Оно пропадёт из пробника.', ok: 'Удалить', cancel: 'Оставить', danger: true });
    if (!sure || !phLive(P) || !P.server.some((x) => x.id === pid)) return;
    P.deleting.add(pid); drawBlock(P, p.n);
    let r = null;
    try { r = await xapi('/' + encodeURIComponent(P.id) + '/photos/' + encodeURIComponent(pid), { method: 'DELETE', token: tokOf(P.s) }); } catch (e) { r = null; }
    if (!phLive(P)) return;
    P.deleting.delete(pid);
    const kind = C.classifyStatus(r && r.status);
    if (kind === 'ok' || kind === 'gone') {                              // gone: the photo is not there any more either
      P.server = P.server.filter((x) => x.id !== pid);
      const u = P.local.get(pid); if (u) { revokeUrl(P, u); P.local.delete(pid); }
      P.rev++; putMsg(P, p.n, ''); drawBlock(P, p.n);
      return;
    }
    setMsg(P, p.n, kind === 'closed' ? TEXT_PH.closed : kind === 'auth' ? TEXT_PH.auth : TEXT_PH.delFail);
    if (kind === 'auth') fatalStop(P.s, 'auth');
    if (kind === 'closed') syncPhase(P.s);
  }

  // ---- the photo phase: only photos are left, for a few minutes ----
  function paintPhotos(v) {
    const id = st.id, carry = st.carry;                                 // st.carry is cleared once the new session owns them (adopt drops what is left)
    const raw = Array.isArray(v.tasks) ? v.tasks : [];
    const tasks = C.wellFormedTasks(v.tasks, { noCond: true }).filter((t) => t.kind === 'long');
    const done = '<button class="btn primary" data-ex-done>Готово</button>';
    const bar = '<div class="vbar"><span class="vtimer" id="ex-timer" role="timer"></span>' +
      '<span class="vprog" id="ex-save" role="status" aria-live="polite">' + (tasks.length ? 'Фото решений' : 'Фото не нужны') + '</span><span class="spacer"></span>' + done + '</div>';
    if (!tasks.length) {
      if (carry) { addLost(id, dropPhotos(carry)); st.carry = null; }
      if (raw.length) { fail('Не получилось загрузить задания пробника.', true); return; }
      // An exam without a part 2: nothing to attach, the student just hands the work in.
      const s0 = st.save = makeSession(id, v, []);
      s0.ph = newPhotos(id, [], []); s0.ph.s = s0;
      bindOpen(s0);
      appEl.innerHTML = shell(bar + '<div class="vintro ex-pintro"><h2>Сдаю работу</h2><p class="lead">' + (v.early === false ? 'Время вышло. ' : '') +
        'В этом пробнике нет заданий второй части, поэтому фото не нужны. Если работа не сдалась сама, нажми «Готово».</p></div>');
      appear();
      startTimer(s0);
      doneNow(s0);                                                       // nothing to wait for: hand it in without another tap
      return;
    }
    const lost = takeLost(id);
    const s = st.save = makeSession(id, v, tasks);
    if (carry && !carry.dead) { attachPhotos(carry, s, tasks, v.photos); st.carry = null; } else { s.ph = newPhotos(id, tasks, v.photos); s.ph.s = s; st.carry = null; }
    bindOpen(s);
    appEl.innerHTML = shell(bar +
      '<div class="vintro ex-pintro"><p class="lead">' + (v.early === false ? '<b>Время вышло.</b> ' : '') + 'Ответы первой части сохранены. Сфотографируй решения второй части и прикрепи к заданиям — ' +
      'или отправь фото боту. Сколько времени осталось на фото, показывает таймер вверху.</p>' +
      (lost ? '<p class="ex-note">' + LOST_NOTE + '</p>' : '') + '</div>' +
      tasks.map((t) => '<div class="vcard" data-n="' + t.n + '" data-exn="' + t.n + '"><div class="vlabel">Задание ' + t.n +
        (t.max ? '<span class="vlabel-art"> · максимум ' + t.max + ' ' + ballWordOf(t.max) + '</span>' : '') + '</div>' +
        photoBlockHTML(t.n) + '</div>').join('') + tgBlockHTML() +
      '<div style="text-align:center;margin-top:8px">' + done + '</div>');
    appear();
    startTimer(s); mountPhotos(s);
  }

  async function doneNow(s) {
    if (!live(s) || s.finishing || s.result) return;
    const P = s.ph, wait = () => { note('Фото ещё загружаются', 'Подожди, пока загрузка закончится, и нажми «Готово» ещё раз.'); };
    if (uploading(s)) { wait(); return; }
    if (s.fatal) { note(s.fatal === 'auth' ? 'Нужно войти заново' : 'Пробник недоступен', s.fatal === 'auth' ? 'Войди через ссылку из Telegram и открой пробник снова.' : 'Сервер не нашёл этот пробник. Напиши мне.'); return; }
    if (P && P.known.length) {
      const failed = P.pending.length > 0;
      const have = new Set(P.server.map((p) => p.n).concat(P.pending.filter((x) => x.state !== 'err').map((x) => x.n)));
      const bare = P.known.filter((n) => !have.has(n));
      const warn = bare.length === P.known.length ? 'Ни к одному заданию не прикреплено фото. '
        : bare.length ? 'Без фото: ' + (bare.length === 1 ? 'задание ' : 'задания ') + bare.join(', ') + '. ' : '';
      const ok = await askHere({ title: 'Всё прикреплено?',
        text: warn + 'После этого фото добавить уже нельзя.' + (failed ? ' Фото, которые не загрузились, пропадут.' : ''), ok: 'Готово', cancel: 'Ещё добавлю' });
      if (!ok || !live(s)) return;
      if (uploading(s)) { wait(); return; }                             // a photo was added while the question was open
    }
    s.finishing = true;
    document.querySelectorAll('[data-ex-done]').forEach((b) => { b.disabled = true; });
    try {
      const r = await xapi('/' + encodeURIComponent(s.id) + '/done', { method: 'POST', token: tokOf(s) }).catch(() => null);
      if (!live(s)) return;
      if (!r || (r.status !== 200 && r.status !== 409)) { note('Не получилось', 'Проверь интернет и нажми «Готово» ещё раз.'); return; }
      s.closed = true;
      renderExam(s.id);                                                 // the server says which screen is next
    } finally {
      s.finishing = false;
      if (!s.dead) document.querySelectorAll('[data-ex-done]').forEach((b) => { b.disabled = false; });
    }
  }

  // ---- the result: "submitted" (part 2 waits for the teacher) and "checked" ----
  /* The same blocks as the generator's result (vresult / vscores / vscore / vtag / vans-row). Everything is drawn from
     ExamClientCore.resultOf (plain data, never NaN); the teacher's HTML (statement, solution, long-task key) goes through
     safeHtml, everything else through esc(). The short-task key `a` is plain text by contract and is only ever escaped.
     Photos: the same tiles and file token as the photo phase, read-only (P.ro: no delete button, no clicks). */
  const SUB = 'style="font-size:16px;font-weight:500;opacity:.7"';
  const tile = (k, v) => '<div class="vscore"><div class="vk">' + k + '</div><div class="vv">' + v + '</div></div>';
  const frac = (a, b) => Number(a) + '<span ' + SUB + '>/' + Number(b) + '</span>';
  const CARD = { ok: 'r-ok', part: 'is-o', no: 'r-no', wait: '' };
  const TAGC = { ok: 'ok', part: 'part', no: 'no', wait: 'wait' };

  function resultCard(t, it, P) {
    const n = Number(it.n);
    const head = '<div class="vlabel">Задание ' + n + '<span class="vtag ' + TAGC[it.state] + '">' + esc(it.label) + '</span></div>' +
      '<div class="cond"><div class="tex">' + safeHtml(t.cond) + '</div></div>';
    const sol = it.kind === 'short' && it.sol ? '<details class="ex-sol"><summary>Решение</summary><div class="tex">' + safeHtml(it.sol) + '</div></details>' : '';
    if (it.kind === 'short') {
      return '<div class="vcard ' + CARD[it.state] + '" data-n="' + n + '">' + head +
        '<div class="vans-row"><span class="yours">Твой ответ: ' + (it.given ? esc(it.given) : '—') + '</span> · <span class="right">Верный: ' +
        (it.correct ? esc(it.correct) : '—') + '</span></div>' + sol + '</div>';
    }
    const photos = P.server.some((p) => p.n === String(n)) ? '<div class="ex-photos" data-ex-ph="' + n + '"><div class="ex-thumbs"></div></div>' : '';
    return '<div class="vcard ' + CARD[it.state] + '" data-n="' + n + '">' + head +
      '<div class="answer long tex">Ответ: ' + (it.answer ? safeHtml(it.answer) : 'не указан') + '</div>' + photos +
      (it.comment ? '<div class="ex-comment"><div class="ex-comment-h">Мой комментарий</div>' + esc(it.comment) + '</div>' : '') + '</div>';   // part 2 never shows a solution
  }

  function paintResult(v) {
    const id = st.id, tasks = C.wellFormedTasks(v.tasks);
    if (!tasks.length) { fail('Не получилось загрузить задания пробника.', true); return; }
    const R = C.resultOf(v, tasks, { secondary: typeof secondaryScore === 'function' ? secondaryScore : null });
    const dropped = !Array.isArray(v.tasks) || v.tasks.length !== tasks.length;
    const lost = takeLost(id);
    // A session of its own so that the file token, the thumbnails and the stale-screen checks work as on the other screens;
    // `result` keeps the finish / done buttons of a screen being replaced from acting on it.
    const s = st.save = makeSession(id, v, tasks);
    s.result = true; s.closed = true;
    const P = s.ph = newPhotos(id, tasks, v.photos); P.s = s; P.ro = true;
    const tiles = tile('Часть 1', frac(R.p1, R.max1)) +
      (R.hasLong ? tile('Часть 2', R.checked ? frac(R.part2, R.max2) : '<span class="vv-txt">на проверке</span>') : '') +
      (R.checked ? tile('Первичный балл', frac(R.total.pts, R.total.max)) : '') +
      (R.second !== null ? tile('Тестовый балл', Number(R.second)) : '');
    // Nothing updates by itself: the student is told to come back when the Telegram message arrives.
    const waits = R.checked ? '' : R.hasLong
      ? '<p class="lead">Первая часть проверена. Вторую часть посмотрю я. Когда проверю, тебе придёт сообщение в Telegram: открой этот пробник снова, и здесь будут баллы и комментарии.</p>'
      : '<p class="lead">Работа сдана. Когда я её проверю, тебе придёт сообщение в Telegram: открой этот пробник снова, и здесь будет итог.</p>';
    const bot = P.server.some((p) => p.n === '')
      ? '<div class="vcard ex-tgph" data-ex-bot hidden><div class="vlabel">Фото, присланные боту</div><div class="ex-thumbs"></div></div>' : '';
    stageAndMount(shell('<div class="vresult"><h2>' + titleOf(v) + '</h2><div class="vscores">' + tiles + '</div>' + waits +
        (lost && !R.checked ? '<p class="ex-note">Часть фото не успела загрузиться и в работу не попала.</p>' : '') +
        (dropped ? '<p class="ex-note">Часть заданий не удалось показать. Напиши мне.</p>' : '') +
        '<div class="vactions"><button class="btn" data-home>К заданиям</button></div></div>' +
        tasks.map((t, i) => resultCard(t, R.items[i], P)).join('') + bot),
      () => live(s) && parseRoute().view === 'exam',
      () => {
        if (!live(s)) return;
        appear();
        drawAll(P); refreshPics(P);
        if (R.checked) markSeen(id);                     // the banner on the hub stops showing the checked exam once its result was seen
      });
  }

  // The way out of the screen that can be asked about: the back button, the title and any "К заданиям" button, while photos
  // are still on their way or failed. (A hash change or the browser's own back cannot be held; those leave a note, see takeLost.)
  function leaveGuard(s, e) {
    const t = e.target, P = s.ph;
    if (!t || !t.closest || !phLive(P) || !P.pending.length) return;
    const hit = t.closest('#back, [data-home]') || (t.closest('#home') && !t.closest('a'));
    if (!hit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    askHere({ title: 'Уйти со страницы?', text: uploadingP(P) ? 'Фото ещё загружаются. Уйти и потерять их?' : 'Часть фото не загрузилась. Уйти и потерять их?',
      ok: 'Уйти', cancel: 'Остаться', danger: true }).then((yes) => {
      // The screen may have been replaced while the question was open; and photos that finished meanwhile are not lost.
      if (yes && live(s) && st.save && st.save.id === s.id) go('#/');
    });
  }

  // ---- a photo full size: tap a thumbnail, tap the picture to enlarge it, arrows or a swipe for the next one ----
  const zoomSt = { el: null, pics: [], i: 0, keyH: null };
  function closeZoom() {
    const z = zoomSt;
    if (!z.el) return;
    z.el.remove(); z.el = null; z.pics = [];
    document.removeEventListener('keydown', z.keyH, true); z.keyH = null;
    document.documentElement.classList.remove('ex-lb-open');
  }
  function showZoom(i) {
    const z = zoomSt;
    if (!z.el || !z.pics.length) return;
    z.i = (i + z.pics.length) % z.pics.length;
    const im = z.el.querySelector('.ex-lb-img'), p = z.pics[z.i];
    z.el.classList.remove('zoom');
    im.src = p.src; im.alt = p.alt;
    z.el.querySelector('.ex-lb-cnt').textContent = z.pics.length > 1 ? (z.i + 1) + ' из ' + z.pics.length : '';
    z.el.querySelectorAll('.ex-lb-nav').forEach((b) => { b.hidden = z.pics.length < 2; });
  }
  function openZoom(img) {
    closeZoom();
    const group = img.closest('.ex-thumbs') || img.parentNode;
    const all = [].slice.call(group.querySelectorAll('.ex-z img')).filter((x) => !x.classList.contains('ex-broken') && x.src);
    const z = zoomSt;
    z.pics = all.map((x) => ({ src: x.src, alt: x.alt || 'Фото' }));
    if (!z.pics.length) return;
    const el = document.createElement('div');
    el.className = 'ex-lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Фото');
    el.innerHTML = '<div class="ex-lb-bar"><span class="ex-lb-cnt"></span><button type="button" class="ex-lb-x" data-lb="x" aria-label="Закрыть">×</button></div>' +
      '<div class="ex-lb-stage"><img class="ex-lb-img" alt=""></div>' +
      '<button type="button" class="ex-lb-nav prev" data-lb="prev" aria-label="Предыдущее фото">‹</button>' +
      '<button type="button" class="ex-lb-nav next" data-lb="next" aria-label="Следующее фото">›</button>' +
      '<p class="ex-lb-tip">Нажми на фото, чтобы увеличить</p>';
    z.el = el;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lb]');
      if (b) { const k = b.dataset.lb; if (k === 'x') closeZoom(); else showZoom(z.i + (k === 'next' ? 1 : -1)); return; }
      const stage = e.target.closest('.ex-lb-stage');
      if (!stage) return;
      if (e.target.tagName === 'IMG') {                                    // tap the picture: enlarge (around the tapped point) or back
        const r = e.target.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        const on = el.classList.toggle('zoom');
        if (on) { stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2; stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2; }
      } else if (!el.classList.contains('zoom')) closeZoom();              // the dark area closes
    });
    let x0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 && !el.classList.contains('zoom') ? e.touches[0].clientX : null; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null || !e.changedTouches.length || z.pics.length < 2) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) showZoom(z.i + (dx < 0 ? 1 : -1));
    }, { passive: true });
    z.keyH = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeZoom(); }
      else if (e.key === 'ArrowRight') showZoom(z.i + 1);
      else if (e.key === 'ArrowLeft') showZoom(z.i - 1);
    };
    document.addEventListener('keydown', z.keyH, true);
    document.documentElement.classList.add('ex-lb-open');
    document.body.appendChild(el);
    showZoom(Math.max(0, all.indexOf(img)));
    el.querySelector('.ex-lb-x').focus();
  }

  // ---- clicks on this module's elements ----
  appEl.addEventListener('click', (e) => {
    const t = e.target, s = st.save;
    const open = t.closest('[data-exam]');
    if (open) { go('#/exam/' + open.dataset.exam); return; }
    if (t.closest('[data-ex-retry]') && st.id) { renderExam(st.id); return; }
    if (t.closest('[data-ex-finish]') && s) { finishNow(s); return; }
    if (t.closest('[data-ex-done]') && s) { doneNow(s); return; }
    const pic = t.closest('.ex-z img');
    if (pic && !pic.classList.contains('ex-broken')) { openZoom(pic); return; }       // a photo is opened in every phase, also read-only
    const P = s && s.ph;
    if (!phLive(P) || P.ro) return;                                     // the result shows photos, it never changes them
    const pick = t.closest('[data-ex-pick]');
    if (pick) {
      const box = pick.closest('.ex-photos'), f = box && box.querySelector('input[type="file"]');
      if (f) { st.picker = Date.now(); f.click(); }                     // the dialog blurs the window: not "away"
      return;
    }
    const del = t.closest('[data-ex-del]');
    if (del) { removePhoto(P, del.dataset.exDel); return; }
    const rm = t.closest('[data-ex-rm]');
    if (rm) { removePending(P, rm.dataset.exRm); return; }
    const rt = t.closest('[data-ex-rt]');
    if (rt) { retryPhoto(P, rt.dataset.exRt); return; }
  });
  appEl.addEventListener('change', (e) => {
    const f = e.target.closest && e.target.closest('[data-ex-file]');
    if (!f) return;
    const files = Array.from(f.files || []);
    f.value = '';                                                       // the same file can be chosen again
    st.picker = 0;
    const P = st.save && st.save.ph;
    if (phLive(P) && files.length) addFiles(P, f.dataset.exFile, files);
  });

  window.ExamUI = { bannerHTML: bannerHTML, render: renderExam, leave: leave, safeHtml: safeHtml, reset: reset };
})();
