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
  assert.equal(C.classifyStatus(429), 'client');
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
