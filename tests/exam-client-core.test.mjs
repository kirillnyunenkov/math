// tests/exam-client-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../exam-client-core.js');

test('whenText formats Moscow time with the weekday and the right preposition', () => {
  assert.equal(C.whenText(1791558000), 'в пятницу, 9 октября, в 18:00');
  assert.equal(C.whenText(1791579900), 'в субботу, 10 октября, в 0:05');          // day rolls over at midnight MSK
  assert.equal(C.whenText(1798750800), 'в пятницу, 1 января, в 0:00');           // year rolls over
});

test('whenText uses "во" before Tuesday', () => {
  assert.equal(C.whenText(1791558000 + 4 * 86400), 'во вторник, 13 октября, в 18:00');
});

test('the clock offset turns the device clock into the server clock', () => {
  const off = C.offsetOf(1000, 5_000_000);                    // device is way off
  assert.equal(off, 1000 * 1000 - 5_000_000);
  assert.equal(C.leftSec(1100, off, 5_000_000), 100);         // 100 s left by the server clock
  assert.equal(C.leftSec(1100, off, 5_000_000 + 99_500), 1);  // rounds up: never shows 0 early
  assert.equal(C.leftSec(1100, off, 5_000_000 + 200_000), 0); // never negative
});

test('fmtLeft shows hours only when there are some', () => {
  assert.equal(C.fmtLeft(14100), '3:55:00');
  assert.equal(C.fmtLeft(3599), '59:59');
  assert.equal(C.fmtLeft(65), '01:05');
  assert.equal(C.fmtLeft(0), '00:00');
});

test('fitSize scales the long side to the limit and never upscales', () => {
  assert.deepEqual(C.fitSize(4032, 3024, 2000), { w: 2000, h: 1500 });
  assert.deepEqual(C.fitSize(3024, 4032, 2000), { w: 1500, h: 2000 });
  assert.deepEqual(C.fitSize(800, 600, 2000), { w: 800, h: 600 });
});

test('AwayTracker reports the away time once, ignores short blips and repeated hides', () => {
  const t = new C.AwayTracker(2);
  assert.equal(t.show(1000), null);                           // never hidden
  t.hide(10_000, 3);
  t.hide(11_000, 4);                                          // a second hide while hidden changes nothing
  assert.deepEqual(t.show(17_400), { n: 3, sec: 7 });
  assert.equal(t.show(18_000), null);                         // already reported
  t.hide(20_000, 5);
  assert.equal(t.show(20_900), null);                         // under the minimum: a flicker
});

test('SaveQueue keeps values that changed while a save was in flight', () => {
  const q = new C.SaveQueue();
  assert.equal(q.has(), false);
  q.set(1, '5'); q.set(2, '0,5');
  const snap = q.snapshot();
  assert.deepEqual(snap, { 1: '5', 2: '0,5' });
  q.set(2, '0,6');                                            // typed again during the request
  q.ack(snap);
  assert.deepEqual(q.snapshot(), { 2: '0,6' });
  q.ack(q.snapshot());
  assert.equal(q.has(), false);
});

test('nextChangeAt picks the soonest start, window end or photo end, and ignores the rest', () => {
  assert.equal(C.nextChangeAt([{ phase: 'scheduled', until: 500 }, { phase: 'open', until: 300 }, { phase: 'photos', until: 900 }]), 300);
  assert.equal(C.nextChangeAt([{ phase: 'open', until: 700 }]), 700);                  // a running window ends: missed or photos
  assert.equal(C.nextChangeAt([{ phase: 'photos', until: 50 }, { phase: 'scheduled', until: 80 }]), 50);
  assert.equal(C.nextChangeAt([{ phase: 'submitted', until: 0 }, { phase: 'checked', until: 10 }, { phase: 'missed', until: 5 }]), undefined);
  assert.equal(C.nextChangeAt([{ phase: 'open' }, { phase: 'open', until: NaN }, { phase: 'open', until: '9' }, null, 7]), undefined);
  assert.equal(C.nextChangeAt(null), undefined);
  assert.equal(C.nextChangeAt([]), undefined);
});

test('minutesText has the Russian plural forms', () => {
  const t = (n) => C.minutesText(n);
  assert.deepEqual([1, 2, 3, 4, 5, 10, 11, 12, 14, 20, 21, 22, 25, 101, 111, 121].map(t),
    ['1 минута', '2 минуты', '3 минуты', '4 минуты', '5 минут', '10 минут', '11 минут', '12 минут', '14 минут', '20 минут', '21 минута', '22 минуты', '25 минут', '101 минута', '111 минут', '121 минута']);
  assert.equal(t(235 / 1), '235 минут');
  assert.equal(t(1.6), '2 минуты');                    // rounded
  assert.equal(t(NaN), '0 минут');
  assert.equal(t('5'), '0 минут');
});

test('clampDelay keeps every timer inside the 32-bit setTimeout range', () => {
  assert.equal(C.clampDelay(1500.4), 1500);
  assert.equal(C.clampDelay(-5), 0);
  assert.equal(C.clampDelay(3_000_000 * 1000), 2147483000);   // a start 34 days ahead
  assert.equal(C.clampDelay(Infinity), 2147483000);
  assert.equal(C.clampDelay(NaN), 2147483000);                // never 0: that would be a tight loop
  assert.equal(C.clampDelay(undefined), 2147483000);
});

test('refreshDelay waits for a start ahead and backs off 30 s, 60 s for a past or missing until', () => {
  const now = 1_000_000_000_000;
  assert.equal(C.refreshDelay(now / 1000 + 100, now, 0), 101200);              // just after the start
  assert.equal(C.refreshDelay(now / 1000 + 100, now, 0, 1500), 101500);
  assert.equal(C.refreshDelay(now / 1000 + 3_000_000, now, 0), 2147483000);    // far start: clamped
  assert.equal(C.refreshDelay(now / 1000 - 1, now, 1), 30000);                 // still "scheduled" past its start
  assert.equal(C.refreshDelay(now / 1000 - 1, now, 2), 60000);
  assert.equal(C.refreshDelay(now / 1000 - 1, now, 9), 60000);                 // capped
  assert.equal(C.refreshDelay(undefined, now, 1), 30000);
  assert.equal(C.refreshDelay(NaN, now, 2), 60000);
  assert.equal(C.refreshDelay(now / 1000, now, 1), 30000);                     // exactly now counts as past
});

test('wellFormedTasks keeps well-formed tasks and drops the rest without throwing', () => {
  const good = { n: 1, kind: 'short', max: 1, cond: '<p>x</p>' };
  const out = C.wellFormedTasks([
    good,
    { n: 13, kind: 'long', max: 2, cond: '<p>y</p>' },
    { n: 1, kind: 'short', max: 1, cond: 'dup' },                // duplicate number
    { n: '__proto__', kind: 'short', max: 1, cond: 'a' },
    { n: 'constructor', kind: 'short', max: 1, cond: 'a' },
    { n: 0, kind: 'short', max: 1, cond: 'a' },
    { n: 41, kind: 'short', max: 1, cond: 'a' },
    { n: 2.5, kind: 'short', max: 1, cond: 'a' },
    { n: '3', kind: 'short', max: 1, cond: 'a' },                // a string is not a task number
    { n: 4, kind: 'medium', max: 1, cond: 'a' },
    { n: 5, kind: 'short', max: 1, cond: { toString() { return 'x'; } } },
    { n: 6, kind: 'short', max: 1 },                              // no statement
    { n: 7, kind: 'short', max: 1, cond: 'x'.repeat(C.MAX_COND + 1) },
    null, 5, 'x', [], undefined,
  ]);
  assert.deepEqual(out.map((t) => t.n), [1, 13]);
  assert.deepEqual(out[1], { n: 13, kind: 'long', max: 2, cond: '<p>y</p>' });
  assert.deepEqual(C.wellFormedTasks(null), []);
  assert.deepEqual(C.wellFormedTasks({ length: 3 }), []);
  assert.deepEqual(C.wellFormedTasks('abc'), []);
});

test('wellFormedTasks coerces max into a small integer', () => {
  const m = (max) => C.wellFormedTasks([{ n: 13, kind: 'long', max: max, cond: 'c' }])[0].max;
  assert.equal(m(3), 3);
  assert.equal(m(2.6), 3);
  assert.equal(m('9'), 0);                                       // not a number: the label is left out
  assert.equal(m(NaN), 0);
  assert.equal(m(-4), 0);
  assert.equal(m(Infinity), 0);
  assert.equal(m(1e9), 10);                                      // the upload check allows 1..10
});

test('answersOf takes only the typed text of the listed short tasks', () => {
  const tasks = C.wellFormedTasks([{ n: 1, kind: 'short', max: 1, cond: 'a' }, { n: 2, kind: 'short', max: 1, cond: 'b' },
    { n: 13, kind: 'long', max: 2, cond: 'c' }]);
  const raw = JSON.parse('{"1":"5","2":7,"13":"text","99":"x","__proto__":"p","constructor":"c"}');
  assert.deepEqual(C.answersOf(raw, tasks), { 1: '5' });         // a number is not typed text; long and unknown tasks are not answers
  assert.deepEqual(C.answersOf(null, tasks), {});
  assert.deepEqual(C.answersOf('abc', tasks), {});
  assert.deepEqual(C.answersOf([], tasks), {});
  assert.equal(C.answersOf({ 1: 'x'.repeat(100) }, tasks)[1].length, 40);
});

test('retryDelay backs off 5 s, 15 s, 30 s and stays there', () => {
  assert.deepEqual([1, 2, 3, 4, 50].map(C.retryDelay), [5000, 15000, 30000, 30000, 30000]);
  assert.equal(C.retryDelay(0), 5000);
  assert.equal(C.retryDelay(NaN), 5000);
});

test('SaveQueue survives an ack of a value that is not queued any more', () => {
  const q = new C.SaveQueue();
  q.set(1, 'a');
  q.ack({ 1: 'a', 2: 'zzz' });
  assert.equal(q.has(), false);
  q.ack({});
  assert.equal(q.has(), false);
});

test('classifyStatus tells a retry from a permanent answer', () => {
  assert.equal(C.classifyStatus(200), 'ok');
  assert.equal(C.classifyStatus(409), 'closed');
  assert.equal(C.classifyStatus(401), 'auth');
  assert.equal(C.classifyStatus(403), 'auth');
  assert.equal(C.classifyStatus(404), 'gone');
  assert.equal(C.classifyStatus(400), 'client');
  assert.equal(C.classifyStatus(429), 'retry');                  // too many requests: passes by itself
  assert.equal(C.classifyStatus(408), 'retry');                  // request timeout: so does this
  assert.equal(C.classifyStatus(422), 'client');
  assert.equal(C.classifyStatus(500), 'retry');
  assert.equal(C.classifyStatus(503), 'retry');
  assert.equal(C.classifyStatus(null), 'retry');                 // no answer at all: network error or timeout
  assert.equal(C.classifyStatus(undefined), 'retry');
  assert.equal(C.classifyStatus(0), 'retry');
  assert.equal(C.classifyStatus(302), 'retry');
});

test('detachedDelay gives three retries on the 5, 15, 30 s schedule, then stops', () => {
  assert.deepEqual([1, 2, 3].map(C.detachedDelay), [5000, 15000, 30000]);
  assert.equal(C.detachedDelay(4), null);
  assert.equal(C.detachedDelay(99), null);
  assert.equal(C.detachedDelay(0), 5000);
  assert.equal(C.detachedDelay(NaN), null);
});

test('unsentOf keeps only the entries an in-flight request does not carry', () => {
  assert.deepEqual(C.unsentOf({ 1: 'a', 2: 'b' }, { 1: 'a', 2: 'x' }), { 2: 'b' });
  assert.deepEqual(C.unsentOf({ 1: 'a' }, { 1: 'a' }), {});
  assert.deepEqual(C.unsentOf({ 1: 'a', 3: 'c' }, null), { 1: 'a', 3: 'c' });
  assert.deepEqual(C.unsentOf({}, { 1: 'a' }), {});
});

test('pickToken prefers the explicit token, then the signed-in one, never throws', () => {
  assert.equal(C.pickToken('own', { token: 'cur' }), 'own');
  assert.equal(C.pickToken('', { token: 'cur' }), 'cur');
  assert.equal(C.pickToken(undefined, null), '');
  assert.equal(C.pickToken(undefined, { token: 5 }), '');
  assert.equal(C.pickToken(5, { token: 'cur' }), 'cur');
});

test('mergePending lays unsent text over the server text for short tasks only', () => {
  const tasks = C.wellFormedTasks([{ n: 1, kind: 'short', max: 1, cond: 'a' }, { n: 2, kind: 'short', max: 1, cond: 'b' },
    { n: 13, kind: 'long', max: 2, cond: 'c' }]);
  const pend = JSON.parse('{"1":"new","13":"x","99":"y","__proto__":"p","2":7}');
  assert.deepEqual(C.mergePending({ 1: 'old', 2: 'two' }, pend, tasks), { 1: 'new', 2: 'two' });
  assert.deepEqual(C.mergePending({ 1: 'old' }, null, tasks), { 1: 'old' });
  assert.deepEqual(C.mergePending({}, { 2: '' }, tasks), { 2: '' });   // an erased field is also unsent text
});

test('fitSize scales the long side to the limit, never up, never below one pixel', () => {
  assert.deepEqual(C.fitSize(4032, 3024, 2000), { w: 2000, h: 1500 });
  assert.deepEqual(C.fitSize(3024, 4032, 2000), { w: 1500, h: 2000 });
  assert.deepEqual(C.fitSize(800, 600, 2000), { w: 800, h: 600 });          // small: unchanged
  assert.deepEqual(C.fitSize(2000, 2000, 2000), { w: 2000, h: 2000 });
  assert.deepEqual(C.fitSize(1, 20000, 2000), { w: 1, h: 2000 });           // a thin strip keeps one pixel
  assert.deepEqual(C.fitSize(0, 100, 2000), { w: 0, h: 0 });
  assert.deepEqual(C.fitSize(NaN, 100, 2000), { w: 0, h: 0 });
  assert.deepEqual(C.fitSize(100, 100, 0), { w: 0, h: 0 });
  assert.deepEqual(C.fitSize('100', 100, 2000), { w: 0, h: 0 });
});

test('dimsOk accepts normal photos and refuses empty, fractional and absurd sizes', () => {
  assert.equal(C.dimsOk(4032, 3024), true);
  assert.equal(C.dimsOk(12000, 9000), true);
  assert.equal(C.dimsOk(0, 100), false);
  assert.equal(C.dimsOk(100.5, 100), false);
  assert.equal(C.dimsOk(NaN, 100), false);
  assert.equal(C.dimsOk(30000, 30000), false);                              // 900 Mpx: a decompression bomb
  assert.equal(C.dimsOk('4000', 3000), false);
});

test('wellFormedTasks without statements (the photo phase) keeps long tasks with an empty cond', () => {
  const raw = [{ n: 13, kind: 'long', max: 2 }, { n: 14, kind: 'long', max: 3, cond: 'x' }, { n: 15, kind: 'long', max: 2, cond: 5 }];
  assert.deepEqual(C.wellFormedTasks(raw), [{ n: 14, kind: 'long', max: 3, cond: 'x' }]);   // default: cond is required
  assert.deepEqual(C.wellFormedTasks(raw, { noCond: true }), [{ n: 13, kind: 'long', max: 2, cond: '' }, { n: 14, kind: 'long', max: 3, cond: 'x' }]);
});

test('wellFormedPhotos keeps only well-formed items of known tasks or of the bot', () => {
  const known = [13, 14];
  const good = [{ id: 'abc123', n: '13', file: 'a_1.jpg' }, { id: 'def456', n: '', file: 'file_1.png' }, { id: 'g7', n: '14', file: 'b.webp' }];
  assert.deepEqual(C.wellFormedPhotos(good, known), good);
  assert.deepEqual(C.wellFormedPhotos(good, ['13']).map((p) => p.id), ['abc123', 'def456']);   // digit strings work too
  const bad = JSON.parse(`[null, 5, "x", [], {"id":"a1","n":"99","file":"f.jpg"}, {"id":"a2","n":"__proto__","file":"f.jpg"},
    {"id":"a3","n":13,"file":"f.jpg"}, {"id":"a4","n":"13"}, {"id":"a5","n":"13","file":""}, {"id":"a6","n":"13","file":"../x.jpg"},
    {"id":"a7","n":"13","file":"a/b.jpg"}, {"id":"a8","n":"13","file":".."}, {"id":"a9","n":"13","file":"a?b.jpg"},
    {"id":"__proto__","n":"13","file":"f.jpg"}, {"id":"bad id","n":"13","file":"f.jpg"}, {"id":"<img>","n":"13","file":"f.jpg"},
    {"n":"13","file":"f.jpg"}, {"id":7,"n":"13","file":"f.jpg"}, {"id":"ok1","n":"13","file":"f.jpg"}, {"id":"ok1","n":"14","file":"g.jpg"},
    {"id":"c1","n":"toString","file":"f.jpg"}, {"id":"c2","n":"constructor","file":"f.jpg"}]`);
  // "__proto__" as an id has a harmless shape and is kept as a plain string; the rest is dropped; the duplicate id loses
  assert.deepEqual(C.wellFormedPhotos(bad, known).map((p) => p.id), ['__proto__', 'ok1']);
  assert.deepEqual(C.wellFormedPhotos(null, known), []);
  assert.deepEqual(C.wellFormedPhotos({ length: 3 }, known), []);
  assert.deepEqual(C.wellFormedPhotos(good, null).map((p) => p.id), ['def456']);              // no known tasks: only the bot's
  const many = Array.from({ length: 500 }, (_, i) => ({ id: 'p' + i, n: '', file: 'f' + i + '.jpg' }));
  assert.equal(C.wellFormedPhotos(many, known).length, C.PHOTO.LIST_MAX);
  const out = C.wellFormedPhotos(good, known); out[0].id = 'changed';
  assert.equal(good[0].id, 'abc123');                                                         // fresh objects
});

test('photoSig tells equal lists from different ones', () => {
  const a = [{ id: 'a', n: '13', file: 'x.jpg' }, { id: 'b', n: '', file: 'y.jpg' }];
  assert.equal(C.photoSig(a), C.photoSig(a.map((p) => Object.assign({}, p))));
  assert.notEqual(C.photoSig(a), C.photoSig(a.slice(0, 1)));
  assert.notEqual(C.photoSig(a), C.photoSig(a.slice().reverse()));
  assert.equal(C.photoSig([]), '');
});

test('photoRoom counts what the server holds and what is on its way against five', () => {
  assert.equal(C.photoRoom(0, 0), 5);
  assert.equal(C.photoRoom(3, 1), 1);
  assert.equal(C.photoRoom(5, 0), 0);
  assert.equal(C.photoRoom(4, 4), 0);                                       // never negative
  assert.equal(C.photoRoom(undefined, undefined), 5);
});

test('pollDelay is 15 s, then backs off to a 2 minute ceiling', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 50].map(C.pollDelay), [15000, 30000, 60000, 120000, 120000, 120000]);
  assert.equal(C.pollDelay(NaN), 15000);
  assert.equal(C.pollDelay(undefined), 15000);
  assert.equal(C.pollDelay(-1), 15000);
});

test('uploadRetryDelay gives three retries, then null', () => {
  assert.deepEqual([1, 2, 3].map(C.uploadRetryDelay), [3000, 10000, 30000]);
  assert.equal(C.uploadRetryDelay(4), null);
  assert.equal(C.uploadRetryDelay(NaN), null);
  assert.equal(C.uploadRetryDelay('1'), null);
});

test('uploadVerdict reads the refusal codes of the photo route', () => {
  assert.equal(C.uploadVerdict(200), 'ok');
  assert.equal(C.uploadVerdict(409, 'closed'), 'closed');
  assert.equal(C.uploadVerdict(401), 'auth');
  assert.equal(C.uploadVerdict(403, 'forbidden'), 'auth');
  assert.equal(C.uploadVerdict(404, 'not found'), 'gone');
  assert.equal(C.uploadVerdict(400, 'too many'), 'tooMany');
  assert.equal(C.uploadVerdict(400, 'bad task'), 'badTask');
  assert.equal(C.uploadVerdict(400, 'bad file'), 'badFile');
  assert.equal(C.uploadVerdict(400, 'one file expected'), 'badFile');
  assert.equal(C.uploadVerdict(400, undefined), 'badFile');
  assert.equal(C.uploadVerdict(413), 'badFile');
  assert.equal(C.uploadVerdict(429), 'retry');
  assert.equal(C.uploadVerdict(408), 'retry');
  assert.equal(C.uploadVerdict(500), 'retry');
  assert.equal(C.uploadVerdict(null), 'retry');
  assert.equal(C.uploadVerdict(undefined), 'retry');
});

test('canRetry allows three manual tries of a refused photo', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(C.canRetry), [true, true, true, false, false]);
  assert.equal(C.canRetry(undefined), false);
  assert.equal(C.canRetry(NaN), false);
});

test('fileRefusal calls a refusal about type or size only when the server says so', () => {
  assert.equal(C.fileRefusal('bad file'), 'other');
  assert.equal(C.fileRefusal('one file expected'), 'other');
  assert.equal(C.fileRefusal(undefined), 'other');
  assert.equal(C.fileRefusal('file too large'), 'typeSize');
  assert.equal(C.fileRefusal('wrong mime type'), 'typeSize');
  assert.equal(C.fileRefusal('Size limit'), 'typeSize');
  assert.equal(C.fileRefusal('resize failed'), 'other');                 // a word part is not a word
});

test('pickerActive: the dialog mark holds 90 s and never before it was set', () => {
  assert.equal(C.pickerActive(1000, 1000), true);
  assert.equal(C.pickerActive(1000, 90999), true);
  assert.equal(C.pickerActive(1000, 91000), false);
  assert.equal(C.pickerActive(0, 1000), false);
  assert.equal(C.pickerActive(5000, 1000), false);                       // a clock that went back
  assert.equal(C.pickerActive(undefined, 1000), false);
  assert.equal(C.pickerActive(NaN, 1000), false);
});

// ---- the result screen ----
const ExamCore = createRequire(import.meta.url)('../exam-core.js');
const RTASKS = [
  { n: 1, kind: 'short', max: 1, cond: 'a' }, { n: 2, kind: 'short', max: 1, cond: 'b' }, { n: 3, kind: 'short', max: 1, cond: 'c' },
  { n: 13, kind: 'long', max: 2, cond: 'd' }, { n: 14, kind: 'long', max: 3, cond: 'e' },
];
const rview = (extra) => Object.assign({ phase: 'submitted', full: false, tasks: RTASKS, answers: { 1: '5', 2: '1' }, ok: { 1: true, 2: false, 3: false },
  key: { 1: { a: '5', sol: '<p>x</p>' }, 2: { a: '-1,5' }, 3: { a: '0,5' }, 13: { a: '<p>x</p>' }, 14: {} }, p1: 1 }, extra || {});

test('resultOf: a submitted exam has part 1 points and part 2 waiting for the teacher', () => {
  const r = C.resultOf(rview(), C.wellFormedTasks(RTASKS));
  assert.equal(r.checked, false);
  assert.equal(r.p1, 1); assert.equal(r.max1, 3); assert.equal(r.max2, 5); assert.equal(r.hasLong, true);
  assert.equal(r.part2, null); assert.equal(r.total, null); assert.equal(r.second, null);
  assert.deepEqual(r.items.map((i) => i.state), ['ok', 'no', 'no', 'wait', 'wait']);
  assert.deepEqual(r.items.map((i) => i.label), ['верно', 'неверно', 'неверно', 'на проверке', 'на проверке']);
  assert.equal(r.items[1].given, '1'); assert.equal(r.items[1].correct, '-1,5');
  assert.equal(r.items[2].given, '');                                    // never answered
  assert.equal(r.items[0].sol, '<p>x</p>');
  assert.equal(r.items[3].answer, '<p>x</p>'); assert.equal(r.items[4].answer, '');
});

test('resultOf: a checked exam sums part 2 and agrees with ExamCore.total', () => {
  const part2 = { 13: { pts: 2, comment: ' ok\nline2 ' }, 14: { pts: 1, comment: '' } };
  const v = rview({ phase: 'checked', part2: part2 });
  const r = C.resultOf(v, C.wellFormedTasks(RTASKS));
  assert.equal(r.part2, 3);
  assert.deepEqual(r.total, ExamCore.total(RTASKS, 1, part2));
  assert.deepEqual(r.items.slice(3).map((i) => i.state), ['ok', 'part']);
  assert.deepEqual(r.items.slice(3).map((i) => i.label), ['2 из 2', '1 из 3']);
  assert.equal(r.items[3].comment, 'ok\nline2');
  const zero = C.resultOf(rview({ phase: 'checked', part2: { 13: { pts: 0 } } }), C.wellFormedTasks(RTASKS));
  assert.deepEqual(zero.items.slice(3).map((i) => i.state), ['no', 'no']);          // a missing grade is 0
  assert.equal(zero.total.pts, 1);
});

test('resultOf: points are clamped and never NaN, whatever the server sent', () => {
  const t = C.wellFormedTasks(RTASKS);
  const r = C.resultOf(rview({ phase: 'checked', p1: 'many', part2: { 13: { pts: 99 }, 14: { pts: NaN } } }), t);
  assert.equal(r.p1, 1);                                                  // not a number: counted from ok
  assert.equal(r.items[3].pts, 2); assert.equal(r.items[4].pts, 0);
  assert.equal(r.total.pts, 3);
  assert.equal(C.resultOf(rview({ p1: 77 }), t).p1, 3);                   // above the maximum
  assert.equal(C.resultOf(rview({ p1: -4 }), t).p1, 0);
  assert.equal(C.resultOf(rview({ p1: Infinity }), t).p1, 1);
  const neg = C.resultOf(rview({ phase: 'checked', part2: { 13: { pts: -3 }, 14: { pts: 1.6 } } }), t);
  assert.deepEqual([neg.items[3].pts, neg.items[4].pts], [0, 2]);
});

test('resultOf survives hostile objects instead of the promised ones', () => {
  const t = C.wellFormedTasks(RTASKS);
  const bad = [null, 7, 'x', [], [true, true], { __proto__: { 1: true } }, JSON.parse('{"__proto__":{"1":true},"constructor":{"1":true}}')];
  bad.forEach((b) => {
    const r = C.resultOf({ phase: 'checked', tasks: RTASKS, answers: b, ok: b, key: b, part2: b, p1: 0, full: b }, t);
    assert.equal(r.items.filter((i) => i.ok).length, 0);
    assert.equal(r.total.pts, 0); assert.equal(r.second, null);
    r.items.forEach((i) => { assert.equal(typeof i.label, 'string'); assert.ok(!/NaN|undefined/.test(i.label)); });
  });
  assert.doesNotThrow(() => C.resultOf(null, t));
  assert.doesNotThrow(() => C.resultOf({ phase: 'checked' }, []));
  // ok[n] must be exactly true; a string or a number is not "right"
  const r = C.resultOf(rview({ ok: { 1: 'true', 2: 1, 3: {} } }), t);
  assert.equal(r.items.filter((i) => i.ok).length, 0);
  // key entries that are not objects, answers that are not strings
  const k = C.resultOf(rview({ key: { 1: 'x', 2: { a: { x: 1 } }, 3: { a: 7, sol: 5 }, 13: [], 14: { a: null } }, answers: { 1: { a: 1 }, 2: 5 } }), t);
  assert.equal(k.items[0].correct, ''); assert.equal(k.items[1].correct, ''); assert.equal(k.items[2].correct, '7'); assert.equal(k.items[2].sol, '');
  assert.equal(k.items[0].given, ''); assert.equal(k.items[1].given, '');
});

test('resultOf keeps the key answer of a short task as plain text and cuts it', () => {
  const t = C.wellFormedTasks(RTASKS);
  const r = C.resultOf(rview({ key: { 1: { a: '<img src=x onerror=alert(1)>' }, 2: { a: 'y'.repeat(500) } } }), t);
  assert.equal(r.items[0].correct, '<img src=x onerror=alert(1)>');       // not interpreted here: the page escapes it
  assert.equal(r.items[1].correct.length, 200);
});

test('resultOf: a task without a known maximum counts for 1, like the server', () => {
  const tasks = C.wellFormedTasks([{ n: 1, kind: 'short', cond: 'a' }, { n: 13, kind: 'long', cond: 'b' }]);
  const r = C.resultOf({ phase: 'checked', ok: { 1: true }, key: {}, p1: 1, part2: { 13: { pts: 1 } } }, tasks);
  assert.deepEqual(r.total, { pts: 2, max: 2 });
  assert.equal(r.items[1].label, '1 из 1');
});

test('secondaryOf: only a full exam, whole points 0..33 and a sane answer', () => {
  const f = (p) => p * 3;
  assert.equal(C.secondaryOf(true, 10, f), 30);
  assert.equal(C.secondaryOf(true, 0, f), 0);
  assert.equal(C.secondaryOf(true, 33, f), 99);
  assert.equal(C.secondaryOf(false, 10, f), null);
  assert.equal(C.secondaryOf(undefined, 10, f), null);
  assert.equal(C.secondaryOf('true', 10, f), null);
  assert.equal(C.secondaryOf(true, 34, f), null);                        // outside the table
  assert.equal(C.secondaryOf(true, -1, f), null);
  assert.equal(C.secondaryOf(true, 2.5, f), null);
  assert.equal(C.secondaryOf(true, NaN, f), null);
  assert.equal(C.secondaryOf(true, 10, undefined), null);                // the global is missing
  assert.equal(C.secondaryOf(true, 10, () => undefined), null);
  assert.equal(C.secondaryOf(true, 10, () => NaN), null);
  assert.equal(C.secondaryOf(true, 10, () => 101), null);
  assert.equal(C.secondaryOf(true, 10, () => { throw new Error('x'); }), null);
  const sec = [0, 6, 11];
  assert.equal(C.resultOf(rview({ phase: 'checked', full: true, part2: {} }), C.wellFormedTasks(RTASKS), { secondary: (p) => sec[p] }).second, 6);
  assert.equal(C.resultOf(rview({ phase: 'checked', full: false, part2: {} }), C.wellFormedTasks(RTASKS), { secondary: (p) => sec[p] }).second, null);
  assert.equal(C.resultOf(rview({ phase: 'submitted', full: true }), C.wellFormedTasks(RTASKS), { secondary: (p) => sec[p] }).second, null);
});

test('ownGet reads own properties of plain objects only', () => {
  assert.equal(C.ownGet({ 3: 'x' }, 3), 'x');
  assert.equal(C.ownGet({ 3: 'x' }, '3'), 'x');
  assert.equal(C.ownGet({}, 'constructor'), undefined);
  assert.equal(C.ownGet({}, '__proto__'), undefined);
  assert.equal(C.ownGet(['a', 'b'], 1), undefined);
  assert.equal(C.ownGet(null, 1), undefined);
  assert.equal(C.ownGet('abc', 0), undefined);
});

test('pointsOf rounds and clamps, anything else takes the fallback', () => {
  assert.equal(C.pointsOf(1.4, 0, 3, 9), 1);
  assert.equal(C.pointsOf(7, 0, 3, 9), 3);
  assert.equal(C.pointsOf(-1, 0, 3, 9), 0);
  assert.equal(C.pointsOf('2', 0, 3, 9), 9);
  assert.equal(C.pointsOf(NaN, 0, 3, 9), 9);
  assert.equal(C.pointsOf(Infinity, 0, 3, 9), 9);
});

test('mergePhotoLists takes the server list and keeps a photo uploaded here that it does not list yet', () => {
  const known = ['13', '14'];
  const mk = (id, n) => ({ id: id, n: n, file: id + '.jpg' });
  const raw = [mk('a', '13'), mk('bot1', '')];
  const held = [mk('a', '13'), mk('mine', '14'), mk('old', '13')];
  const out = C.mergePhotoLists(raw, held, new Set(['mine', 'a']), known);
  assert.deepEqual(out.map((p) => p.id), ['a', 'bot1', 'mine']);          // `old` has no local preview: the server forgot it
  assert.deepEqual(C.mergePhotoLists(raw, held, [], known).map((p) => p.id), ['a', 'bot1']);
  assert.deepEqual(C.mergePhotoLists(undefined, held, new Set(['mine']), known).map((p) => p.id), ['mine']);
  assert.deepEqual(C.mergePhotoLists(raw, null, null, known).map((p) => p.id), ['a', 'bot1']);
  assert.deepEqual(C.mergePhotoLists([mk('x', '99')], [], null, known), []);   // not a task of the exam
});

// ---- review round 1: the tiles are the server's numbers ----
test('resultOf: the server totals win over the local sums (capped max, duplicate n, unknown kind, n = 41)', () => {
  const E = ExamCore, A = createRequire(import.meta.url)('../answers-core.js');
  const tasks = [{ n: 1, kind: 'short', max: 1, cond: 'a' }, { n: 2, kind: 'short', max: 1, cond: 'b' }, { n: 2, kind: 'short', max: 2, cond: 'dup' },
    { n: 41, kind: 'short', max: 1, cond: 'x' }, { n: 5, kind: 'weird', max: 3, cond: 'u' }, { n: 13, kind: 'long', max: 12, cond: 'c' }];
  const key = { 1: { a: '5' }, 2: { a: '7' }, 41: { a: '1' }, 13: { a: 'z' } }, answers = { 1: '5', 2: '7', 41: '1' };
  const g = A.gradePart1(tasks, key, answers), part2 = { 13: { pts: 11, comment: '' } };
  const v = { phase: 'checked', full: true, tasks: tasks, answers: answers, ok: g.ok, key: key, p1: g.p1, max1: g.max1, part2: part2, total: E.total(tasks, g.p1, part2) };
  assert.deepEqual(v.total, { pts: 16, max: 20 });                           // what the server and Telegram say
  const r = C.resultOf(v, C.wellFormedTasks(tasks), { secondary: (p) => p * 2 });
  assert.deepEqual([r.p1, r.max1, r.part2, r.max2], [5, 5, 11, 15]);
  assert.deepEqual(r.total, { pts: 16, max: 20 });
  assert.equal(r.second, 32);                                                // from the server total
  assert.equal(r.items[r.items.length - 1].label, 'проверено');              // 10 из 10 would contradict 11/15
  assert.equal(r.items[r.items.length - 1].state, 'wait');
});

test('resultOf: a total that matches the page keeps the per-task labels', () => {
  const part2 = { 13: { pts: 1 }, 14: { pts: 1 } };
  const v = rview({ phase: 'checked', part2: part2, p1: 1, max1: 3, total: { pts: 3, max: 8 } });
  const r = C.resultOf(v, C.wellFormedTasks(RTASKS));
  assert.deepEqual([r.part2, r.max2, r.total.pts, r.total.max], [2, 5, 3, 8]);
  assert.deepEqual(r.items.slice(3).map((i) => i.label), ['1 из 2', '1 из 3']);
});

test('resultOf falls back to the local sums when the server numbers are missing or invalid', () => {
  const t = C.wellFormedTasks(RTASKS), part2 = { 13: { pts: 2 }, 14: { pts: 1 } };
  const bad = [undefined, null, 'x', [], { pts: 5 }, { pts: 'a', max: 8 }, { pts: 9, max: 8 }, { pts: -1, max: 8 }, { pts: 2.5, max: 8 },
    { pts: 0, max: 8 },                                                      // below part 1 (1)
    { pts: 3, max: 2 }, { pts: NaN, max: 8 }, { pts: Infinity, max: Infinity }];
  bad.forEach((tot) => {
    const r = C.resultOf(rview({ phase: 'checked', part2: part2, total: tot }), t);
    assert.deepEqual(r.total, { pts: 4, max: 8 }, JSON.stringify(tot));
    assert.equal(r.part2, 3);
    assert.deepEqual(r.items.slice(3).map((i) => i.label), ['2 из 2', '1 из 3']);
  });
  // an invalid p1/max1 pair is ignored too
  const r = C.resultOf(rview({ phase: 'checked', part2: part2, p1: 9, max1: 3 }), t);
  assert.deepEqual([r.p1, r.max1], [3, 3]);
  assert.equal(r.total.max, 8);
});

test('resultOf: a long task never carries a solution, a short one does', () => {
  const t = C.wellFormedTasks(RTASKS);
  const r = C.resultOf(rview({ key: { 1: { a: '5', sol: '<p>s</p>' }, 13: { a: 'x', sol: '<p>long sol</p>' }, 14: { a: 'y', sol: 'z' } } }), t);
  assert.equal(r.items[0].sol, '<p>s</p>');
  assert.deepEqual(r.items.slice(3).map((i) => i.sol), ['', '']);
  const c = C.resultOf(rview({ phase: 'checked', part2: {}, key: { 13: { a: 'x', sol: '<p>long sol</p>' } } }), t);
  assert.equal(c.items[3].sol, '');
});

test('mergePhotoLists accepts the Map of local previews', () => {
  const known = ['13'], mk = (id, n) => ({ id: id, n: n, file: id + '.jpg' });
  const local = new Map([['mine', 'blob:x']]);
  const out = C.mergePhotoLists([mk('bot', '')], [mk('mine', '13'), mk('old', '13')], local, known);
  assert.deepEqual(out.map((p) => p.id), ['bot', 'mine']);                    // `old` has no preview
  assert.deepEqual(C.mergePhotoLists([], [mk('mine', '13')], new Map(), known), []);
});

test('durationText: hours and minutes for a long work, plain minutes for a short one', () => {
  assert.equal(C.durationText(235), '3 ч 55 мин');
  assert.equal(C.durationText(120), '2 ч');
  assert.equal(C.durationText(60), '1 ч');
  assert.equal(C.durationText(45), '45 минут');
  assert.equal(C.durationText(1), '1 минута');
  assert.equal(C.durationText(NaN), '0 минут');
  assert.equal(C.durationText('x'), '0 минут');
});

test('SaveQueue tells about every change, and a throwing listener never breaks typing', () => {
  const q = new C.SaveQueue(); let n = 0;
  q.onChange = () => { n++; };
  q.set('1', '5'); q.set('2', '7');
  assert.equal(n, 2);
  q.ack({ 1: '5' });
  assert.equal(n, 3);
  q.onChange = () => { throw new Error('storage broke'); };
  q.set('3', '9');
  assert.deepEqual(q.snapshot(), { 2: '7', 3: '9' });
});

// A storage like localStorage, in memory.
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, size: () => m.size }; };

test('unsent answers are kept in storage per user and exam, and removed when nothing is left', () => {
  const st = mem(), key = C.pendKey('u1', 'e7');
  assert.notEqual(key, C.pendKey('u2', 'e7'));
  assert.notEqual(key, C.pendKey('u1', 'e8'));
  C.writePending(st, key, { 7: '-44', 9: '12' });
  assert.deepEqual(C.readPending(st, key), { 7: '-44', 9: '12' });
  assert.equal(C.readPending(st, C.pendKey('u2', 'e7')), null);
  C.writePending(st, key, {});
  assert.equal(C.readPending(st, key), null);
  assert.equal(st.size(), 0);
});

test('a stored copy is read back only as short answers under task numbers', () => {
  const st = mem(), key = C.pendKey('u', 'e');
  st.setItem(key, JSON.stringify({ 1: '5', abc: 'x', 100: 'y', 2: 7, 3: 'z'.repeat(41), __proto__: 'p', 4: '0,5' }));
  assert.deepEqual(C.readPending(st, key), { 1: '5', 4: '0,5' });
  st.setItem(key, '[1,2]'); assert.equal(C.readPending(st, key), null);
  st.setItem(key, 'not json'); assert.equal(C.readPending(st, key), null);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(C.readPending(broken, key), null);
  C.writePending(broken, key, { 1: '5' });                      // must not throw
});

test('rejectedNote lists the unsent short answers, nothing for empty or long tasks', () => {
  const tasks = [{ n: 3, kind: 'short' }, { n: 5, kind: 'short' }, { n: 13, kind: 'long' }];
  assert.equal(C.rejectedNote({ 5: '7', 3: '12' }, tasks), 'Время вышло, эти ответы не успели сохраниться: 3 — «12», 5 — «7».');
  assert.equal(C.rejectedNote({ 3: '' }, tasks), '');
  assert.equal(C.rejectedNote({ 13: 'x' }, tasks), '');
  assert.equal(C.rejectedNote({}, tasks), '');
  assert.equal(C.rejectedNote(null, tasks), '');
  assert.ok(C.rejectedNote({ 3: 'x'.repeat(100) }, tasks).includes('«' + 'x'.repeat(40) + '»'));
});
