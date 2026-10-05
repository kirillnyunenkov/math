/* Validation of an assigned-exam file before upload (node: require, browser:
   window.ExamValidate). Teacher-authored HTML ends up in students' pages, so
   the safe-HTML rules here are a real gate, not a nicety. validateExam never
   throws: any JSON input yields a report. */
(function (root) {
  'use strict';

  const MAX_TASKS_JSON = 4800000, MAX_KEY_JSON = 1900000;

  // ---- safe HTML ----------------------------------------------------------
  /* A strict allowlist, deliberately NOT a model of the browser's HTML parser: every "<"
     in a field must open one of the tags below in one rigid spelling, or the field is
     refused. With nothing exotic accepted (no comments, no raw-text elements, no single
     quotes, no entities in attributes) the validator and the browser cannot disagree about
     where a tag ends, so a payload cannot hide in a place only one of them reads. */

  const ALLOWED_ATTRS = {
    img: { src: 1, width: 1, height: 1, alt: 1 },
    th: { colspan: 1, rowspan: 1, align: 1 },
    td: { colspan: 1, rowspan: 1, align: 1 },
  };
  const ALLOWED_TAGS = ('p br hr b i em strong u sup sub span div ul ol li table thead tbody tr th td blockquote pre code h3 h4 img').split(' ');
  const ATTR_VALUE = {
    src: /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/,
    width: /^\d+(px)?$/, height: /^\d+(px)?$/, colspan: /^\d+$/, rowspan: /^\d+$/, align: /^(left|right|center)$/,
    alt: /^[^"<>]*$/,
  };
  // Opening tag: lowercase name, attributes only as ` name="value"` (double quotes, no < > " inside), optional "/".
  const TAG_OPEN = /<([a-z][a-z0-9]*)((?:[ \t\r\n]+[a-z][a-z-]*="[^"<>]*")*)[ \t\r\n]*\/?>/y;
  const TAG_CLOSE = /<\/([a-z][a-z0-9]*)>/y;
  const ATTR = /[ \t\r\n]+([a-z][a-z-]*)="([^"<>]*)"/y;
  const LT_HINT = ' Если это знак «меньше» в формуле, пишите \\lt (или поставьте пробел после <).';

  // Returns a short description of the first problem, or '' when the HTML is acceptable.
  function htmlProblem(html) {
    const s = String(html == null ? '' : html);
    if (s.indexOf('\u0000') !== -1) return 'в тексте нулевой символ';
    let i = s.indexOf('<');
    while (i !== -1) {
      const c = s[i + 1] || '';
      if (c === '!' || c === '?') return 'комментарии и служебные конструкции (<!, <?) запрещены';
      if (c === '/' && !/[A-Za-z]/.test(s[i + 2] || '')) return 'тег, начинающийся с </ без имени, запрещён';
      if (c === '/' || /[A-Za-z]/.test(c)) {
        const closing = c === '/';
        const re = closing ? TAG_CLOSE : TAG_OPEN;
        re.lastIndex = i;
        const m = re.exec(s);
        const nm = /^[A-Za-z0-9]*/.exec(s.slice(i + (closing ? 2 : 1), i + (closing ? 2 : 1) + 24))[0];
        if (!m) return 'тег «' + (closing ? '</' : '<') + nm + '» не разрешён или записан не по правилам (имя строчными, атрибуты только в двойных кавычках).' + LT_HINT;
        const name = m[1];
        if (ALLOWED_TAGS.indexOf(name) === -1) return 'тег «<' + name + '» не разрешён.' + LT_HINT;
        if (!closing) {
          const allowed = ALLOWED_ATTRS[name] || {};
          let seenSrc = false, am;
          ATTR.lastIndex = 0;
          while ((am = ATTR.exec(m[2])) !== null) {
            const an = am[1], av = am[2];
            if (!allowed[an]) return 'атрибут «' + an + '» у тега «' + name + '» не разрешён';
            if (!ATTR_VALUE[an].test(av)) return 'недопустимое значение атрибута «' + an + '»' + (an === 'src' ? ' (картинка — только встроенная data:image png/jpeg/webp/gif в base64)' : '');
            if (an === 'src') seenSrc = true;
          }
          if (name === 'img' && !seenSrc) return 'картинка без встроенного src';
        }
        i = i + m[0].length;
        i = s.indexOf('<', i);
        continue;
      }
      i = s.indexOf('<', i + 1);
    }
    return '';
  }

  // ---- formulas -----------------------------------------------------------
  /* Formulas are read from the TEXT view (what KaTeX auto-render sees): tags are cut out,
     entities decoded, then $$…$$ and $…$ found per text segment. */

  function decodeText(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, function (m, e) {
      const k = e.toLowerCase();
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'amp') return '&';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k === 'nbsp') return ' ';
      const cp = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
  }

  function textSegments(s) {
    const segs = [];
    let start = 0, i = s.indexOf('<');
    while (i !== -1) {
      const c = s[i + 1] || '';
      if (/[A-Za-z]/.test(c) || (c === '/' && /[A-Za-z]/.test(s[i + 2] || ''))) {
        segs.push(s.slice(start, i));
        const e = s.indexOf('>', i);
        if (e === -1) { start = s.length; break; }
        start = e + 1; i = s.indexOf('<', start);
      } else i = s.indexOf('<', i + 1);
    }
    segs.push(s.slice(start));
    return segs;
  }

  // Closing delimiter dl ("$" or "$$") at brace depth 0; a backslash escapes the next char.
  // If only a deeper one exists it is returned anyway, so KaTeX can report the broken braces.
  function findClose(t, from, dl) {
    let depth = 0, fallback = -1;
    for (let j = from; j < t.length; j++) {
      const c = t[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { if (depth > 0) depth--; }
      else if (c === '$' && t.startsWith(dl, j)) { if (fallback < 0) fallback = j; if (depth === 0) return j; }
    }
    return fallback;
  }

  // -> { formulas: [{tex, display}], unbalanced: number } (display ones first, then inline).
  function scanFormulas(html) {
    const display = [], inline = [];
    let unbalanced = 0;
    textSegments(String(html == null ? '' : html)).forEach(function (seg) {
      if (seg.indexOf('$') === -1) return;
      const t = decodeText(seg);
      let rest = '', i = 0;
      while (i < t.length) {
        const c = t[i];
        if (c === '\\') { rest += t.substr(i, 2); i += 2; continue; }
        if (c === '$' && t[i + 1] === '$') {
          const j = findClose(t, i + 2, '$$');
          if (j < 0) { unbalanced++; rest += '  '; i += 2; continue; }
          display.push(t.slice(i + 2, j)); rest += ' '; i = j + 2; continue;
        }
        rest += c; i++;
      }
      i = 0;
      while (i < rest.length) {
        const c = rest[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '$') {
          const j = findClose(rest, i + 1, '$');
          if (j < 0) { unbalanced++; break; }
          inline.push(rest.slice(i + 1, j)); i = j + 1; continue;
        }
        i++;
      }
    });
    return {
      formulas: display.map(function (tex) { return { tex: tex, display: true }; })
        .concat(inline.map(function (tex) { return { tex: tex, display: false }; })),
      unbalanced: unbalanced,
    };
  }

  function extractFormulas(html) { return scanFormulas(html).formulas; }

  // KaTeX renders these as plain text when trust is off (as on the platform) instead of throwing,
  // so a silent failure would reach the students: refuse them up front.
  const BAD_COMMANDS = /\\(href|url|htmlClass|htmlId|htmlStyle|htmlData|includegraphics)(?![a-zA-Z])/;

  // ---- the exam file ------------------------------------------------------

  const isInt = (v, lo, hi) => typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi;
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // Gate for one HTML field: strict allowlist, forbidden formula commands, unpaired dollars (warning).
  // `shown` = students see the formulas of this field (they are the ones worth checking for dollars).
  function checkField(where, label, html, shown, errors, warnings) {
    const p = htmlProblem(html);
    if (p) { errors.push(where + label + ' небезопасный HTML: ' + p.replace(/\.$/, '') + '.'); return; }
    const sc = scanFormulas(html);
    const seenCmd = {};
    sc.formulas.forEach(function (f) {
      const m = BAD_COMMANDS.exec(f.tex);
      if (m && !seenCmd[m[1]]) { seenCmd[m[1]] = true; errors.push(where + label + ' команда \\' + m[1] + ' не поддерживается.'); }
    });
    if (shown && sc.unbalanced) warnings.push(where + 'непарный $ ' + label + ' — формула не закрыта или цена записана без \\$.');
  }

  function validateInner(x) {
    const errors = [], warnings = [], stats = { short: 0, long: 0 };
    const done = function () { return { errors: errors, warnings: warnings, stats: stats }; };
    if (!x || typeof x !== 'object' || Array.isArray(x)) { errors.push('Файл должен содержать объект с полями title, tasks и key.'); return done(); }
    if (!nonEmpty(x.title) || x.title.length > 120) errors.push('Название: непустая строка до 120 символов.');
    else if (/[<>]/.test(x.title)) errors.push('Название должно быть простым текстом, без < и >.');
    if (x.full != null && typeof x.full !== 'boolean') errors.push('Поле full должно быть true или false.');
    if (!Array.isArray(x.tasks) || x.tasks.length < 1 || x.tasks.length > 40) { errors.push('tasks: список из 1–40 заданий.'); return done(); }
    if (!x.key || typeof x.key !== 'object' || Array.isArray(x.key)) { errors.push('key: объект с ответами по номерам заданий.'); return done(); }

    const seen = Object.create(null);
    x.tasks.forEach(function (t, i) {
      const where = 'Задание ' + (t && typeof t === 'object' && isInt(t.n, 1, 40) ? t.n : '#' + (i + 1)) + ': ';
      if (!t || typeof t !== 'object' || Array.isArray(t)) { errors.push(where + 'не объект.'); return; }
      if (!isInt(t.n, 1, 40)) { errors.push(where + 'номер n должен быть целым от 1 до 40.'); return; }
      if (seen[t.n]) { errors.push(where + 'номер повторяется.'); return; }
      seen[t.n] = true;
      if (t.kind !== 'short' && t.kind !== 'long') { errors.push(where + 'kind должен быть "short" или "long".'); return; }
      t.kind === 'short' ? stats.short++ : stats.long++;
      if (!isInt(t.max, 1, 10)) errors.push(where + 'max — целое от 1 до 10.');
      else if (t.kind === 'short' && t.max !== 1) errors.push(where + 'задание первой части стоит 1 балл.');
      if (!nonEmpty(t.cond)) errors.push(where + 'условие cond не должно быть пустым.');
      else checkField(where, 'в условии', t.cond, true, errors, warnings);

      const k = has(x.key, String(t.n)) ? x.key[String(t.n)] : null;
      if (!k || typeof k !== 'object' || Array.isArray(k)) { errors.push(where + 'нет ключа с ответом.'); return; }
      if (!nonEmpty(k.a)) { errors.push(where + 'пустой ответ a.'); return; }
      if (t.kind === 'short') {
        if (/[<>]/.test(k.a)) errors.push(where + 'ответ первой части нужно записать простым текстом, без тегов.');
        else if (!/^-?\d+([.,]\d+)?$/.test(k.a.trim().replace(/−/g, '-')) && k.a.trim().length > 20) warnings.push(where + 'необычный ответ «' + k.a.slice(0, 30) + '» — проверь, что ученик сможет так ввести.');
        if (!nonEmpty(k.sol)) errors.push(where + 'нет решения sol (к первой части решения обязательны).');
        else checkField(where, 'в решении', k.sol, true, errors, warnings);
      } else {
        checkField(where, 'в ответе', k.a, true, errors, warnings);
        if (k.sol != null && k.sol !== '') {
          warnings.push(where + 'решение второй части не показывается ученику, оно будет проигнорировано.');
          // It is still stored on the server, so it goes through the same gate.
          if (typeof k.sol !== 'string') errors.push(where + 'решение sol должно быть строкой.');
          else checkField(where, 'в решении (не показывается, но сохраняется)', k.sol, false, errors, warnings);
        }
      }
    });
    Object.keys(x.key).forEach(function (n) { if (!seen[n]) warnings.push('В key есть ответ для задания ' + n + ', а самого задания нет.'); });

    if (JSON.stringify(x.tasks).length > MAX_TASKS_JSON) errors.push('Размер условий заданий больше допустимого (картинки лучше ужать).');
    if (JSON.stringify(x.key).length > MAX_KEY_JSON) errors.push('Размер ключа (ответы и решения) больше допустимого.');
    return done();
  }

  function validateExam(x) {
    try { return validateInner(x); }
    catch (e) { return { errors: ['Файл не удалось проверить: ' + String(e && e.message).slice(0, 100)], warnings: [], stats: { short: 0, long: 0 } }; }
  }

  const api = { validateExam: validateExam, extractFormulas: extractFormulas };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamValidate = api;
})(typeof self !== 'undefined' ? self : globalThis);
