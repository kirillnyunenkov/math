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
