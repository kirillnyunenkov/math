---
name: solution-visuals
description: Add or fix visual aids in the solutions (разборы) of the EGE trainer — highlights drawn over the statement figure, diagrams drawn from scratch (probability trees, Euler circles, zone axes, graphs of a formula, unit circle) and data tables (speed/distance/time, debt movement). Use whenever Кирилл asks for «визуализацию», «рисунок», «картинку», «дерево», «круги Эйлера», «табличку», «схему» or «график» in a разбор, says a solution needs to be more наглядным, sends a new prototype that needs a solution with a picture, or complains that a solution figure is small, crooked or mislabelled — even if he names only a task number.
---

# Visual aids in solutions

The reader is a weak 10–11 grade student who failed the task and opened the solution. A picture earns its
place only when it removes a step he would otherwise do in his head: finding the two grid points the text
names, seeing which root lies after the car has stopped, seeing that "at least one" is everything inside
the circles. Кирилл approved this approach on 02.10.2026 ("идеально получилось"); the rules below are what
he approved and what he corrected. Run every command from the repo root. Messages to Кирилл are in Russian.

## What is where

| Thing | Path |
|---|---|
| Solutions: `window.SOLDATA[N] = {id: html}` (a JS file, not pure JSON) | `img/tN/sol.js` |
| Statements and bank answers: `window.TASKDATA[N][id-1] = {art, c, a}` | `img/tN/data.js` |
| Statement drawings | `img/tN/gfx/*.svg` (which file — see `src=` in the statement) |
| Drawing library | `tools/annotate_figs.py` (read it first, it is short) |
| Figure specs, one file per task number, each with a `FIGS` list | `tools/figs/tN.py` |
| Built figures | `img/tN/sol/<id>.svg` |
| Show one task: statement, answer, figure, solution | `tools/sol_show.mjs` |
| Edit helper for `sol.js` | `tools/sol_edit.mjs` |
| Checker | `tools/check_solutions.mjs` |

`id` is the 1-based position of the task in `data.js`. A solution exists only for the prototype
representative (first id of a group in `PROTOTYPES[N]`, `config.js`); similar tasks show the answer only.

## Step 1. Decide whether a picture helps, and which kind

Read the statement and the current solution first — do not parse the data files by hand:

```bash
node tools/sol_show.mjs 5          # prototypes of task 5: id, art, has a visual or not
```

```bash
node tools/sol_show.mjs 5 p7       # prototype 7 (or a plain id): statement, bank answer, figure, solution
```

Кирилл names tasks by prototype number and a nickname («кофейные автоматы», «батарейки»). If the task you
find does not match his description, do not guess — say in the report what the prototype really is.

Then pick one:

| Situation | Visual |
|---|---|
| Statement has a graph on a grid and the solution names points, a slope, intervals, signs | Overlay on the statement figure, in grid coordinates |
| Statement has a geometry drawing and the solution uses an extra construction, an area, specific sides or angles | Overlay on the statement figure |
| Conditional / multi-stage probability (batteries, markers, repeated shots, coin tosses) | Tree, **drawn top-down** |
| "At least one of two", dependent events (coffee machines) | Euler circles |
| "Less than a, less than b, find between" | Axis cut into zones |
| Two dice with a condition | 6×6 outcome grid |
| Quadratic formula problem where the root is chosen by meaning, or the answer is an interval length | Graph of the formula with the level line and the roots |
| Sign of sin/cos by quarter | Unit circle |
| Motion, work, mixtures solved with an equation | Table inside the step that sets up the equation |
| Credit problems (task 13) | Debt table, columns exactly «Долг / Долг после % / Платёж / Долг после платежа» |

Do not draw when the solution is one chain of arithmetic or algebra (most of tasks 7 and 8, "favourable
over total" and "sum of two incompatible events" in task 4, plain substitution in task 10, vectors given
only by coordinates in task 2): a picture there is decoration, and Кирилл does not want decoration. Say so
in the report instead.

The test for a borderline case: name the step of the solution the picture replaces or makes obvious. If
you cannot, do not draw. If you can but the gain is small, draw it and flag it in the report as borderline
so he can drop it with one word — he has kept such extras before (dice grid, bread scale) but wants the
choice.

Do not draw over a statement figure that contradicts the numbers of this task. The bank reuses one drawing
for several prototypes, so a 16° angle may be drawn obtuse or the side labelled 3 may be the longest one.
Labels on such a drawing confuse more than they help — leave the solution as text and report it.

If the request covers many tasks or a new kind of visual, show a pilot first, and take it from clearly
different task types (a graph, a geometry drawing, a text problem), never several tasks of one number:
a format that works on one type says nothing about the others.

## Step 2. Draw

Write one function per figure in `tools/figs/tN.py` and add it to `FIGS`. Before writing a new kind, read
the file that already draws it — helpers live in the spec files, not in the library, so copy the pattern
into your file rather than importing across specs:

| Kind | Where to look |
|---|---|
| Probability tree with products | `_tree` in `tools/figs/t5.py`; full coin tree — `coin_tree` in `t4.py` |
| Zone axis | `zones` in `t4.py` |
| Euler circles, outcome grid | `t5_44`, `t5_26` in `t5.py` |
| Graph of a formula with level line and roots | `_Plot` in `t10.py` |
| Unit circle | `unit_circle` in `t8.py` |
| Labelled grid points, slope triangle | `_mark` in `t12.py`, `t9_9` in `t9.py` |
| Angles, right-angle marks, equal-segment ticks | `_angle`, `_right`, `_tick` in `t1.py` |
| Shaded solids, labelled edges, round bodies | `t3.py` |
| Vectors on a grid | `t2.py` |

- **Overlay on a graph:** `Fig(src, grid=True)`. All coordinates are in grid cells; the origin and the cell
  size are read from the SVG, so `(4, 2)` lands exactly on the node. A curve's own points come from
  `polylines()` (pt) — convert with `f.ox`, `f.oy`, `f.cell`.
- **Overlay on a geometry drawing:** `Fig(src)`, coordinates in the SVG's pt. Take vertices from `dots()`
  and edges from `polylines()`, never by eye; find which dot carries which letter by looking at the PNG.
  Round-body drawings in task 3 are raster images inside the SVG: there `dots()` is empty and positions
  have to be measured on the embedded bitmap.
- **Diagram from scratch:** `Fig.blank(w, h)`. Structure in `INK` (black, like the statement drawings),
  the part the solution is about in `ACCENT`; a background grid, if needed, in `#aaaaaa` like the statement
  grids. Aim for a canvas about 200–260 pt wide with 7–9 pt labels: on a phone the figure shrinks to a
  ~300 px column, and smaller labels stop being readable.
- SVG text quirks: leading and trailing spaces inside a label collapse, so build «7a + b» as one string;
  `label()` has no italic and no over-arrow — for a vector name draw the arrow with `raw()` or write
  «вектор a»; `<` and `>` in a label must be written `&lt;` and `&gt;`.

Rules that came from Кирилл's corrections:

- Draw over the **same** drawing the statement shows, do not redraw it.
- One colour for highlights: `ACCENT` (interface blue). Never red, green or amber — warm colours in the
  trainer mean the student's status.
- Probability trees go **top-down**: root on top, branches downward.
- Every number on the figure is either in the statement or computed in the solution. Put an `assert` with
  the computation next to the drawing code, so a wrong number fails the build instead of reaching a student.
- 2–6 marks per figure. Do not repeat what the drawing already shows.
- Labels are short and in Russian: minus is «−» (U+2212), decimal comma, coordinates as «(−1; 3)».
- Size: a copy of a statement drawing is saved at the width the statement shows it (`width=COND_W`: 520 for
  task 9, 360 for task 12, otherwise the `width` attribute in the statement). A diagram from scratch gets
  no width — `save()` gives it 2 px per pt up to 520 px. "Размер картинки" for Кирилл means size on screen,
  never file weight.

Build and look:

```bash
python3 tools/annotate_figs.py t9
```

```bash
qlmanage -t -s 800 -o <scratchpad dir> img/t9/sol/28.svg
```

The file comes out as `<name>.svg.png` and is always square: a white band under a wide figure is the
thumbnail, not a layout bug. Several SVGs can go in one call. Open the PNG with Read. Look at **every** figure after the final build and fix it if a label sits on a line,
a letter or another label, runs off the edge, or a mark is not where it should be. Checks do not catch this.

## Step 3. Put it into the solution

Figures go right under the "idea" block; the helper replaces an existing figure, so it can be re-run:

```json
[{"n": 9, "id": 28, "fig": "img/t9/sol/28.svg", "alt": "Что показано на рисунке, одной фразой"},
 {"n": 5, "id": 44, "find": "exact fragment of the current text", "replace": "new fragment"}]
```

```bash
node tools/sol_edit.mjs <edits.json>
```

Keep the edits file in the scratchpad, not in the repo. It is JSON, so every LaTeX backslash in `find` and
`replace` is doubled (`\\dfrac`); `find` must match exactly once; several edits for one id can go in one file. Marks must match the steps: same points, same
numbers, same letters. It is fine to add a short pointer to a step («на рисунке это закрашенный треугольник»);
do not change the method, the numbers or the answer.

**Tables** are plain HTML inside the step that needs them:

```html
<div class="table-wrapper"><table><thead><tr><th></th><th>Скорость</th><th>Путь</th><th>Время</th></tr></thead>
<tbody><tr><td>По течению</td><td>$x + 2$</td><td>$80$</td><td>$\dfrac{80}{x + 2}$</td></tr>…</tbody></table></div>
```

- At most four columns, one-word headers without units (units stay in the sentence), row names of 1–2 words.
- Task 13 uses `class="table-wrapper sol-table"` and five columns: «Год» or «Месяц», then the four debt
  columns in that order. «Долг» in a row is «Долг после платежа» of the row above. Long terms: first two
  rows, a row of «…», the last row. Switch to thousands or millions so the cells stay short, and say so
  before the table. For equal payments the equation comes from the last cell being zero.
- On a 375 px phone a step is about 270–300 px wide. Fit the table if you can; a wide debt table may scroll
  sideways inside its own box — Кирилл chose one layout everywhere over a narrower table on phones.
- Split a display formula with several equalities joined by `\qquad` into two when it is longer than about
  40 characters, otherwise it runs off a phone screen.

## Step 4. Verify before saying "done"

1. Every number recomputed in Python (standard library only — numpy and sympy are not installed). For a
   debt table: each row satisfies debt × rate = after-interest, after-interest − payment = remainder,
   the last remainder is zero, and the final answer equals the bank answer in `data.js`.
2. `python3 tools/annotate_figs.py tN` builds without errors. It rewrites every figure of that task, so
   `git status` must show only your new files as changed — an old figure that changed is a regression.
3. `node tools/check_solutions.mjs` — 0 errors (it checks that every figure file exists, has alt text, every
   formula parses, tags are allowed).
4. `node --test tests/*.test.mjs` passes.
5. In the browser pane (`preview_start` with the `math` server) at 375 px: open the changed solutions and
   check that figures load and fit, no `.katex-error`, the page itself does not scroll sideways. The service
   worker serves old `sol.js` — clear `caches` and unregister it, or reload the files with
   `fetch(url, {cache: 'reload'})`, before trusting what you see. Check the dark theme too: figures are
   inverted by a filter there and light shading can get faint.
6. Bump `VERSION` in `sw.js`; after merging master bump it again if master took the same number.

Commit on a branch and open a pull request — merging to master is the deploy.

## Working at scale

For more than a handful of figures give one task number to one subagent (two agents must not write the
same `sol.js` or the same `tools/figs/tN.py`). Each gets: the rules above, its list of ids, the paths, and
the duty to look at every PNG and to report where it is unsure. Review the ones it flags yourself — in
the first rollout the flagged figures were exactly where the real problems were.

## Report to Кирилл

Short, in Russian, plain words: what is shown on which prototype (by prototype number and plain name —
«№5, кофейные автоматы»), where you did not draw and why, how it was checked, what to look at before the
merge. Say honestly which figures you looked at yourself and which were only checked by calculation, which
calls were borderline, and where his description of a task did not match what is in the bank.

## Figures for an assigned exam (пробник)

The same drawing rules apply, but nothing goes into the repository and the file is a PNG, not an SVG: exam HTML accepts only
`data:image/png|jpeg|webp|gif`. Build in `~/math-source/exams/<slug>/` following the `assigned-exam` skill (section «The usual request»):
statement drawings of a Школково variant are dvisvgm SVGs, not the bank's cairo SVGs, so `Fig(src, grid=True)` does not read them;
subclass `Fig`, map grid coordinates to the page yourself (the page group is scaled ×2) and render the result with
`tools/assigned-exam-skill/render_svg.py`. Trees, boxes and other from-scratch figures can reuse the helpers of `tools/figs/*.py`
by loading the spec module (cwd = repo root). Look at every PNG, in the dark theme too (the trainer inverts all `<img>` there).
