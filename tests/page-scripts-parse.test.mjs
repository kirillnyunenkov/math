// tests/page-scripts-parse.test.mjs
// exam.js runs only in a browser, so no other test loads it: a duplicate name or a stray bracket would take the whole
// exam screen down unnoticed. Compiling it (not running it) catches that class of mistake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

for (const f of ['exam.js', 'exam-client-core.js', 'exam-validate.js', 'exam-panel-core.js']) {
  test(`${f} compiles`, () => {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => new Script(src, { filename: f }));
  });
}
