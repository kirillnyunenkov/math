import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const A = createRequire(import.meta.url)('../answers-core.js');

test('numbers compare by value: comma, minus sign, spaces, trailing dot', () => {
  assert.equal(A.answersEqual('12,5', '12.5'), true);
  assert.equal(A.answersEqual('−3', '-3'), true);
  assert.equal(A.answersEqual(' 0,50 ', '0.5'), true);
  assert.equal(A.answersEqual('7.', '7'), true);
  assert.equal(A.answersEqual('7', '8'), false);
});

test('non-numbers compare as normalised text', () => {
  assert.equal(A.answersEqual('АБВ', 'абв'), true);
  assert.equal(A.answersEqual('1 3 2', '132'), true);
  assert.equal(A.answersEqual('132', '123'), false);
});

test('parseNum rejects what is not a plain decimal', () => {
  assert.equal(A.parseNum(''), null);
  assert.equal(A.parseNum('1/2'), null);
  assert.equal(A.parseNum('-0,25'), -0.25);
});

test('gradePart1 counts only short tasks and treats an empty answer as wrong', () => {
  const tasks = [{ n: 1, kind: 'short', max: 1 }, { n: 2, kind: 'short', max: 1 },
    { n: 3, kind: 'short', max: 1 }, { n: 13, kind: 'long', max: 2 }];
  const key = { 1: { a: '5' }, 2: { a: '0,5' }, 3: { a: '-1' }, 13: { a: 'x' } };
  const g = A.gradePart1(tasks, key, { 1: '5', 2: '0.6', 13: 'x' });
  assert.deepEqual(g, { p1: 1, max1: 3, ok: { 1: true, 2: false, 3: false } });
});

test('gradePart1 survives missing key and missing answers', () => {
  assert.deepEqual(A.gradePart1([{ n: 1, kind: 'short', max: 1 }], {}, null), { p1: 0, max1: 1, ok: { 1: false } });
  assert.deepEqual(A.gradePart1(null, null, null), { p1: 0, max1: 0, ok: {} });
});
