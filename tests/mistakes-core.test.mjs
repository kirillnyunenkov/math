// «Работа над ошибками»: which prototypes are open mistakes and what to practise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../mistakes-core.js');

// task 1: prototypes of ids 1-3, 4-6 and 7 alone; task 2: no prototypes
const cfg = { groupOf: (n, pid) => n === 1 ? (pid <= 3 ? [1, 2, 3] : pid <= 6 ? [4, 5, 6] : [7]) : null };
const first = () => 0;                               // rnd stub: always the first candidate

test('groups: one per prototype with a red mark, ordered by task then prototype', () => {
  const state = { 2: { 5: 'b', 3: 'g' }, 1: { 5: 'b', 6: 'b', 1: 'o', 2: 'g' } };
  assert.deepEqual(M.groups(state, cfg), [
    { n: 1, ids: [4, 5, 6], red: [5, 6] },
    { n: 2, ids: [5], red: [5] },
  ]);
});

test('groups: nothing red, nothing to fix', () => {
  assert.deepEqual(M.groups({ 1: { 1: 'g', 4: 'o' }, 2: {} }, cfg), []);
});

test('pick: gives a similar problem the student has not touched yet', () => {
  const state = { 1: { 1: 'b', 2: 'g' } };
  assert.deepEqual(M.pick(M.groups(state, cfg), state, 10, first), [{ n: 1, id: 3, fix: [1] }]);
});

test('pick: falls back to an already marked similar one, never to a red one if avoidable', () => {
  const state = { 1: { 1: 'b', 2: 'b', 3: 'g' } };
  assert.deepEqual(M.pick(M.groups(state, cfg), state, 10, first), [{ n: 1, id: 3, fix: [1, 2] }]);
});

test('pick: gives the same problem when the prototype has no other', () => {
  const state = { 1: { 7: 'b' }, 2: { 4: 'b' } };
  assert.deepEqual(M.pick(M.groups(state, cfg), state, 10, first),
    [{ n: 1, id: 7, fix: [7] }, { n: 2, id: 4, fix: [4] }]);
});

test('pick: at most `limit` items, still in task order', () => {
  const state = { 2: { 1: 'b', 2: 'b', 3: 'b' }, 1: { 1: 'b' } };
  const set = M.pick(M.groups(state, cfg), state, 2, () => 0.99);
  assert.equal(set.length, 2);
  assert.ok(set[0].n < set[1].n || (set[0].n === set[1].n && set[0].id < set[1].id));
});

test('closed: a solved similar problem turns the still-red originals yellow', () => {
  const state = { 1: { 1: 'b', 2: 'o', 3: 'g' } };
  assert.deepEqual(M.closed(state, { n: 1, id: 3, fix: [1, 2] }), [1]);
});

test('closed: nothing while the practised problem is not solved', () => {
  assert.deepEqual(M.closed({ 1: { 1: 'b', 3: 'b' } }, { n: 1, id: 3, fix: [1] }), []);
  assert.deepEqual(M.closed({ 1: { 1: 'b' } }, { n: 1, id: 3, fix: [1] }), []);
});
