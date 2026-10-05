/* Validation of an assigned-exam file before upload (node: require, browser:
   window.ExamValidate). Teacher-authored HTML ends up in students' pages, so
   the safe-HTML rules here are a real gate, not a nicety. validateExam never
   throws: any JSON input yields a report. */
(function (root) {
  'use strict';

  const MAX_TASKS_JSON = 4800000, MAX_KEY_JSON = 1900000;

  // Formulas in display ($$…$$) first, so their dollars are not taken for inline ones.
  function extractFormulas(html) {
    const out = [], src = String(html || '');
    const rest = src.replace(/\$\$([\s\S]+?)\$\$/g, function (_, t) { out.push({ tex: t, display: true }); return ' '; });
    rest.replace(/\$([^$\n]+?)\$/g, function (_, t) { out.push({ tex: t, display: false }); return ' '; });
    return out;
  }

  // ---- safe HTML ----------------------------------------------------------

  const BAD_TAGS = /^(script|iframe|object|embed|link|meta|style|svg|math|base|form|frame|frameset|applet)$/i;
  // Attributes that make the browser load or embed something: only <img src="data:image/…"> may use them.
  const LOADING_ATTRS = /^(src|srcset|poster|background)$/i;
  const IMG_DATA_URI = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/;

  // Numeric entities and the few named ones that can hide a URL scheme.
  function decodeEntities(s) {
    return s.replace(/&#x([0-9a-f]+);?|&#(\d+);?|&(colon|tab|newline);?/gi, function (m, hex, dec, name) {
      if (name) return { colon: ':', tab: '\t', newline: '\n' }[name.toLowerCase()];
      const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
  }

  // What a browser would see as the URL: entities decoded, whitespace/control chars dropped, lowercased.
  function urlForm(v) { return decodeEntities(v).replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase(); }

  // Linear scan of the tags of an HTML string, tokenised like a browser does
  // (attributes may follow with no whitespace, ">" may sit inside quotes).
  // Calls cb(tagName, [{name, value}]) for every start/end tag.
  function eachTag(s, cb) {
    const nameRe = /[a-zA-Z][^\s\/>]*/y, skipRe = /[\s\/]*/y;
    const attrRe = /([^\s\/>=][^\s\/>=]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/y;
    let i = s.indexOf('<');
    while (i !== -1) {
      let p = i + 1;
      if (s[p] === '/') p++;
      nameRe.lastIndex = p;
      const nm = nameRe.exec(s);
      if (!nm) { i = s.indexOf('<', i + 1); continue; }
      p = nameRe.lastIndex;
      const attrs = [];
      for (;;) {
        skipRe.lastIndex = p; skipRe.exec(s); p = skipRe.lastIndex;
        if (p >= s.length || s[p] === '>') break;
        attrRe.lastIndex = p;
        const am = attrRe.exec(s);
        if (!am) { p++; continue; }
        p = attrRe.lastIndex;
        attrs.push({ name: am[1], value: am[2] != null ? am[2] : am[3] != null ? am[3] : am[4] != null ? am[4] : '' });
      }
      cb(nm[0], attrs);
      i = s.indexOf('<', p);
    }
  }

  // Returns a short description of the first problem, or '' when the HTML is acceptable.
  function htmlProblem(html) {
    const s = String(html == null ? '' : html);
    // Blunt text checks first (catch tags hidden in comments and anything the tokeniser might miss).
    if (/<\s*(script|iframe|object|embed|link|meta|style|svg|math)\b/i.test(s)) return 'запрещённый тег';
    if (/javascript\s*:/i.test(s)) return 'ссылка javascript:';
    let problem = '';
    eachTag(s, function (tag, attrs) {
      if (problem) return;
      const t = tag.toLowerCase();
      if (BAD_TAGS.test(t)) { problem = 'запрещённый тег'; return; }
      let src = null;
      for (let i = 0; i < attrs.length && !problem; i++) {
        const name = attrs[i].name.toLowerCase(), url = urlForm(attrs[i].value);
        if (/^on/.test(name)) problem = 'обработчик события в атрибуте';
        else if (name === 'srcdoc') problem = 'атрибут srcdoc';
        else if (/^(javascript|vbscript):/.test(url)) problem = 'ссылка javascript:';
        else if (t === 'img' && name === 'src') { src = url; if (!IMG_DATA_URI.test(url)) problem = 'картинка не data:-адресом (допустимы только встроенные)'; }
        else if (url.indexOf('data:') === 0) problem = 'адрес data: допустим только у встроенной картинки';
        else if (LOADING_ATTRS.test(name)) problem = 'внешняя загрузка в атрибуте ' + name + ' (допустимы только встроенные картинки)';
      }
      if (!problem && t === 'img' && src === null) problem = 'картинка без встроенного src';
    });
    return problem;
  }

  // ---- the exam file ------------------------------------------------------

  const isInt = (v, lo, hi) => typeof v === 'number' && Math.floor(v) === v && v >= lo && v <= hi;
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function validateInner(x) {
    const errors = [], warnings = [], stats = { short: 0, long: 0 };
    const done = function () { return { errors: errors, warnings: warnings, stats: stats }; };
    if (!x || typeof x !== 'object' || Array.isArray(x)) { errors.push('Файл должен содержать объект с полями title, tasks и key.'); return done(); }
    if (!nonEmpty(x.title) || x.title.length > 120) errors.push('Название: непустая строка до 120 символов.');
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
      else { const p = htmlProblem(t.cond); if (p) errors.push(where + 'в условии небезопасный HTML: ' + p + '.'); }

      const k = has(x.key, String(t.n)) ? x.key[String(t.n)] : null;
      if (!k || typeof k !== 'object' || Array.isArray(k)) { errors.push(where + 'нет ключа с ответом.'); return; }
      if (!nonEmpty(k.a)) { errors.push(where + 'пустой ответ a.'); return; }
      if (t.kind === 'short') {
        if (/[<>]/.test(k.a)) errors.push(where + 'ответ первой части нужно записать простым текстом, без тегов.');
        else if (!/^-?\d+([.,]\d+)?$/.test(k.a.trim().replace(/−/g, '-')) && k.a.trim().length > 20) warnings.push(where + 'необычный ответ «' + k.a.slice(0, 30) + '» — проверь, что ученик сможет так ввести.');
        if (!nonEmpty(k.sol)) errors.push(where + 'нет решения sol (к первой части решения обязательны).');
        else { const p = htmlProblem(k.sol); if (p) errors.push(where + 'в решении небезопасный HTML: ' + p + '.'); }
      } else {
        const p = htmlProblem(k.a); if (p) errors.push(where + 'в ответе небезопасный HTML: ' + p + '.');
        if (k.sol != null && k.sol !== '') warnings.push(where + 'решение второй части не показывается ученику, оно будет проигнорировано.');
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
