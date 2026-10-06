/* Validation of an assigned-exam file before upload (node: require, browser:
   window.ExamValidate). Teacher-authored HTML ends up in students' pages, so
   the safe-HTML rules here are a real gate, not a nicety. validateExam never
   throws: any JSON input yields a report. */
(function (root) {
  'use strict';

  const MAX_TASKS_JSON = 4800000, MAX_KEY_JSON = 1900000;
  // Maxima of part 2 in the full exam: the same table as PART2_CRIT in index.html (14:2 15:3 16:2 17:2 18:3 19:4 20:4 = 20, plus 13 = 33).
  const FULL_LONG_MAX = { 14: 2, 15: 3, 16: 2, 17: 2, 18: 3, 19: 4, 20: 4 };
  const pointsWord = function (k) { return k === 1 ? 'балл' : k < 5 ? 'балла' : 'баллов'; };
  // The server limits are in bytes of UTF-8, not characters (Cyrillic is 2 bytes a letter).
  const jsonBytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

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
    src: /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+\/=]+$/,
    width: /^\d+(px)?$/, height: /^\d+(px)?$/, colspan: /^\d+$/, rowspan: /^\d+$/, align: /^(left|right|center)$/,
    alt: /^[^"<>]*$/,
  };
  /* An SVG figure is allowed only as the content of an <img src="data:image/svg+xml;base64,...">: a browser never runs
     scripts in an SVG used as an image and never loads anything external for it. The checks below are a second line
     (someone may save the figure and open the file directly): no script, no event handlers, no foreign content,
     no external references, no entities, no CSS escapes. Every check is a single regular expression run over the
     whole text, so the cost is linear and one occurrence cannot hide another. Returns '' when the SVG is fine,
     otherwise the reason. */
  const MAX_SVG_CHARS = 400000;
  function svgProblem(b64) {
    let text;
    try {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) { return 'файл не читается (это не SVG в base64).'; }
    if (text.length > MAX_SVG_CHARS) return 'файл слишком большой (больше ' + (MAX_SVG_CHARS / 1000) + ' тысяч символов).';
    // Character references are decoded first, so an entity cannot spell a forbidden word.
    text = text.replace(/&#[xX]([0-9a-fA-F]+);|&#([0-9]+);/g, function (m, h, d) {
      const cp = h ? parseInt(h, 16) : parseInt(d, 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\uFFFD';
    });
    // The plain W3C DOCTYPE (matplotlib and Batik write it) has no internal subset and is harmless: drop it. Any other one is refused.
    text = text.replace(/^\s*(<\?xml[^>]*\?>\s*)?<!DOCTYPE\s+svg\s+PUBLIC\s+(["'])[^"'\[\]<>]*\2\s+(["'])http:\/\/www\.w3\.org\/[^"'\[\]<>]*\3\s*>/i, '$1');
    if (/<\s*!\s*(entity|doctype)/i.test(text) || /<\s*\?\s*xml-stylesheet/i.test(text)) return 'объявления ENTITY, DOCTYPE (кроме обычного W3C) и таблицы стилей не разрешены.';
    const root = /<svg[\s>][^>]*/i.exec(text);
    if (!root) return 'внутри нет тега <svg>.';
    // The site shows an SVG at the size written on its root tag (it ignores width/height of the <img>), so the size must be there.
    if (!/\swidth\s*=\s*["']?\s*[0-9.]+\s*(px|pt)?\s*["'\s\/>]/i.test(root[0] + ' ') || !/\sheight\s*=\s*["']?\s*[0-9.]+\s*(px|pt)?\s*["'\s\/>]/i.test(root[0] + ' '))
      return 'у корневого тега <svg> нет размера: допиши width и height в пикселях, например width="300" height="200" (без них рисунок растянется на всю ширину).';
    // Element names may carry a namespace prefix (<s:script>); anything in the XHTML namespace is refused.
    if (/<\s*(?:[A-Za-z_][\w.-]*:)?(script|foreignobject|iframe|embed|object|audio|video|link|meta|animate|set|handler|listener)\b/i.test(text) || /http:\/\/www\.w3\.org\/1999\/xhtml/i.test(text))
      return 'внутри есть скрипт, вставка чужого содержимого или анимация (script, foreignObject, iframe, animate и подобное).';
    if (/[\s"'\/]on[a-z]+\s*=/i.test(text)) return 'внутри есть обработчик события (onload и подобные).';
    if (/javascript\s*:/i.test(text)) return 'внутри есть ссылка javascript:.';
    if (/\\/.test(text)) return 'внутри есть обратная косая черта (так прячут запрещённые слова в стилях).';
    // Every reference is checked on its own: only to an element of the same file (#id) or to an embedded raster picture.
    if (/(?:href|src)\s*=\s*(?!"\s*#|'\s*#|"\s*data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=\s]*"|'\s*data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=\s]*')/i.test(text))
      return 'внутри есть внешняя ссылка (разрешены только ссылки на части этого же рисунка и встроенные png/jpeg/webp/gif).';
    if (/url\(\s*["']?\s*(?!#)/i.test(text)) return 'внутри есть внешняя ссылка url(…) (разрешены только url(#id)).';
    if (/(?:image-set|cross-fade|element)\s*\(/i.test(text) || /(?:^|[^\w-])(?:image|src)\s*\(/i.test(text)) return 'внутри есть CSS-функция, которая загружает адрес (image-set, image(), src()).';
    if (/@import/i.test(text)) return 'внутри есть @import.';
    return '';
  }

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
            if (!ATTR_VALUE[an].test(av)) return 'недопустимое значение атрибута «' + an + '»' + (an === 'src' ? ' (картинка — только встроенная data:image png/jpeg/webp/gif/svg+xml в base64)' : '');
            if (an === 'src' && av.indexOf('data:image/svg+xml;base64,') === 0) { const sp = svgProblem(av.slice(26)); if (sp) return 'картинка SVG не подходит: ' + sp; }
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
  /* The platform finds formulas with KaTeX auto-render (delimiters $$ then $, see typeset() in
     index.html), so the formulas worth checking are exactly the ones auto-render finds. This
     section mirrors its algorithm (katex/auto-render.min.js: splitAtDelimiters, findEndOfMath and
     the DOM walker) over the text nodes the browser builds from the HTML:
       - the opening delimiter is the first "$" (a plain search: "\$" does NOT escape it);
       - the closing one is found by findEnd (brace depth, a backslash skips the next character);
         when there is none, auto-render gives up on the rest of that text node;
       - the text is the DECODED text node (entities resolved), adjacent text nodes are merged,
         and the content of pre/code is skipped. */

  // Entities as the browser decodes them in a text node: a few named ones (lt gt amp quot nbsp
  // also without the semicolon), the ones that can hide a formula delimiter, and numeric ones.
  const ENTITY = /&(?:(lt|LT|gt|GT|amp|AMP|quot|QUOT|nbsp);?|(apos|dollar|bsol|lbrace|lcub|rbrace|rcub);|#[xX]([0-9a-fA-F]+);?|#([0-9]+);?)/g;
  const NAMED = { lt: '<', LT: '<', gt: '>', GT: '>', amp: '&', AMP: '&', quot: '"', QUOT: '"', nbsp: ' ', apos: "'",
    dollar: '$', bsol: '\\', lbrace: '{', lcub: '{', rbrace: '}', rcub: '}' };
  function decodeText(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(ENTITY, function (m, n1, n2, hex, dec) {
      if (n1 || n2) return NAMED[n1 || n2];
      const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
    });
  }

  /* The text nodes of an (already gated) HTML string: [{text, ignored}], text decoded. Tags split
     the text; an end tag the parser ignores creates no node, so the texts around it merge (the
     browser does that, and auto-render joins adjacent text nodes); the content of pre/code is
     marked ignored, also when a code element was implicitly closed and then reconstructed by the
     parser. This is a compact model of the browser's open-elements stack for the allowed tags,
     not a full HTML parser: the differential check against a real browser (see the report) is
     what keeps it honest. TABLE STRUCTURE IS OUTSIDE THAT VERIFIED CORPUS beyond the basics
     modelled here (a cell hides the formatting elements of its surroundings and drops its own
     when it ends); foster parenting and stray td/tr are not modelled. Where the model is wrong the
     only effect is that a formula the browser renders is not checked by KaTeX or for forbidden
     commands (KaTeX trust is off on the platform, so those commands are inert anyway).
     Linear time: formatting elements closed implicitly are kept in a list of at most 3 per name
     (the browser's "Noah's Ark" limit), so no operation depends on how many are open. */
  const VOID = { br: 1, hr: 1, img: 1 };
  const FORMATTING = { b: 1, i: 1, em: 1, strong: 1, u: 1, code: 1 };
  const SPECIAL = { p: 1, div: 1, pre: 1, ul: 1, ol: 1, li: 1, blockquote: 1, table: 1, thead: 1, tbody: 1, tr: 1, th: 1, td: 1, h3: 1, h4: 1 };
  const HEADING = { h3: 1, h4: 1 };
  const CLOSES_P = { p: 1, div: 1, pre: 1, ul: 1, ol: 1, blockquote: 1, hr: 1, table: 1, h3: 1, h4: 1, li: 1 };
  const BLOCK = { p: 1, div: 1, pre: 1, ul: 1, ol: 1, li: 1, blockquote: 1, hr: 1, table: 1, thead: 1, tbody: 1, tr: 1, th: 1, td: 1, h3: 1, h4: 1 };
  const CELL = { td: 1, th: 1 };
  function textNodes(html) {
    const s = String(html == null ? '' : html), nodes = [];
    let misnested = false; // a formatting tag closed while a block element is still open inside it
    const stack = [], spec = [], pos = Object.create(null); // names; specials counted up to each index; indices per name
    // Formatting elements closed implicitly, which the parser reopens at the next text. One list per
    // open table cell (a cell hides what was pending outside it and discards its own when it ends).
    const lists = [[]];
    let cur = null;
    const open = function (n) {
      const i = stack.length;
      stack.push(n); spec.push((i ? spec[i - 1] : 0) + (SPECIAL[n] ? 1 : 0));
      (pos[n] || (pos[n] = [])).push(i);
    };
    const isOpen = function (n) { return !!(pos[n] && pos[n].length); };
    const lastIdx = function (n) { return isOpen(n) ? pos[n][pos[n].length - 1] : -1; };
    const specialAbove = function (n) { return spec[stack.length - 1] - spec[lastIdx(n)] > 0; };
    const addPending = function (n) {
      const list = lists[lists.length - 1];
      let count = 0, first = -1;
      for (let j = 0; j < list.length; j++) if (list[j] === n) { if (first < 0) first = j; count++; }
      if (count >= 3) list.splice(first, 1);
      list.push(n);
    };
    const popTo = function (n) {
      let gone = [];
      const flush = function () { for (let j = gone.length - 1; j >= 0; j--) addPending(gone[j]); gone = []; };
      for (;;) {
        const x = stack.pop(); spec.pop(); pos[x].pop();
        if (CELL[x]) { flush(); lists.pop(); } else if (x !== n && FORMATTING[x]) gone.push(x);
        if (x === n) break;
      }
      flush();
    };
    const reopen = function () { const list = lists[lists.length - 1]; lists[lists.length - 1] = []; list.forEach(open); };
    const boundary = function () { if (cur) { nodes.push(cur); cur = null; } };
    const text = function (raw) {
      if (raw === '') return;
      reopen();
      if (cur) cur.text += decodeText(raw);
      else cur = { text: decodeText(raw), ignored: isOpen('pre') || isOpen('code') };
    };
    let start = 0, i = s.indexOf('<'), cut = false;
    while (i !== -1) {
      const closing = s[i + 1] === '/';
      if (/[A-Za-z]/.test(s[i + (closing ? 2 : 1)] || '')) {
        text(s.slice(start, i));
        const e = s.indexOf('>', i);
        if (e === -1) { cut = true; break; }
        const at = i + (closing ? 2 : 1);
        let name = /^[A-Za-z][A-Za-z0-9]*/.exec(s.slice(at, at + 16))[0].toLowerCase();
        if (closing && HEADING[name]) { // </h3> and </h4> close whichever heading is open
          const a = lastIdx('h3'), b = lastIdx('h4');
          if (a !== b) name = a > b ? 'h3' : 'h4';
        }
        if (!closing) {
          boundary();
          if (HEADING[name] && HEADING[stack[stack.length - 1]]) popTo(stack[stack.length - 1]);
          if (CLOSES_P[name] && isOpen('p')) popTo('p');
          if (name === 'td' || name === 'th' || name === 'tr') { // a new cell or row ends the open cell (of the same table)
            const cell = lastIdx('td') > lastIdx('th') ? 'td' : 'th';
            if (lastIdx(cell) > lastIdx('table')) popTo(cell);
            if (name === 'tr' && lastIdx('tr') > lastIdx('table')) popTo('tr');
          }
          if (!BLOCK[name]) reopen();
          if (!VOID[name]) open(name);
          if (CELL[name]) lists.push([]);
        } else if (!isOpen(name)) {
          const list = lists[lists.length - 1], k = list.lastIndexOf(name);
          if (k !== -1) list.splice(k, 1);
          else if (name === 'p' || name === 'br') boundary();
        } else if (name === 'p' || SPECIAL[name]) { popTo(name); boundary(); }
        else if (specialAbove(name)) { if (FORMATTING[name]) { boundary(); misnested = true; } }
        else { popTo(name); boundary(); }
        start = e + 1; i = s.indexOf('<', start);
      } else i = s.indexOf('<', i + 1);
    }
    if (!cut) text(s.slice(start));
    boundary();
    nodes.misnested = misnested;
    return nodes;
  }

  // auto-render's findEndOfMath: the index of the closing delimiter, or -1.
  function findEnd(delim, t, from) {
    let level = 0;
    for (let r = from; r < t.length; r++) {
      if (level <= 0 && t.startsWith(delim, r)) return r;
      const c = t[r];
      if (c === '\\') r++; else if (c === '{') level++; else if (c === '}') level--;
    }
    return -1;
  }

  // -> { formulas: [{tex, display}] in document order, unbalanced: number of text nodes where an
  //      opening delimiter had no closing one }.
  function scanFormulas(html) {
    const formulas = [], tn = textNodes(html);
    let unbalanced = 0;
    tn.forEach(function (node) {
      if (node.ignored) return;
      const t = node.text;
      let pos = 0;
      for (;;) {
        const i = t.indexOf('$', pos);
        if (i === -1) return;
        const left = t.charAt(i + 1) === '$' ? '$$' : '$';
        const j = findEnd(left, t, i + left.length);
        if (j === -1) { unbalanced++; return; }
        formulas.push({ tex: t.slice(i + left.length, j), display: left === '$$' });
        pos = j + left.length;
      }
    });
    return { formulas: formulas, unbalanced: unbalanced, misnested: tn.misnested };
  }

  // Display formulas first, then inline ones (each group in document order).
  function extractFormulas(html) {
    const all = scanFormulas(html).formulas;
    return all.filter(function (f) { return f.display; }).concat(all.filter(function (f) { return !f.display; }));
  }

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
    if (shown && sc.misnested) warnings.push(where + 'теги ' + label + ' вложены неправильно (например, <b> закрыт раньше, чем вложенный в него <p>): формулы рядом могут отобразиться не так, как проверено.');
    if (shown && sc.unbalanced) warnings.push(where + 'непарный $ ' + label + ': формула не закрыта. Чтобы показать знак доллара, пиши его внутри формулы: $\\$5$ (или слово «руб.»).');
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
        // The answer field of the trainer takes digits, a comma and a minus only (a dot is turned into a comma): any other
        // character in the key could never be typed, so the task could never be marked right.
        else if (/[^0-9.,\-\u2212\s]/.test(k.a)) errors.push(where + 'ответ «' + k.a.slice(0, 30) + '» нельзя ввести в поле ответа: допустимы только цифры, запятая и минус. Запиши ответ числом, например -1,5.');
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
    // A full exam has the shape of the real one (the generator's table in index.html: PART2_CRIT): tasks 1-13 are part 1
    // (1 point each), tasks 14-20 are part 2 with their own maxima, 33 primary points in all.
    if (x.full === true) {
      for (let n = 1; n <= 20; n++) if (!seen[n]) errors.push('Полный пробник: нет задания ' + n + ' (в полном варианте ровно 20 заданий, номера 1–20).');
      x.tasks.forEach(function (t) {
        if (!t || typeof t !== 'object' || !isInt(t.n, 1, 40)) return;
        const where = 'Задание ' + t.n + ': ';
        if (t.n > 20) { errors.push(where + 'в полном пробнике заданий больше 20 не бывает (номера 1–20).'); return; }
        const long = t.n >= 14;
        if (t.kind !== (long ? 'long' : 'short')) errors.push(where + (long ? 'в полном пробнике это задание второй части (kind "long").' : 'в полном пробнике это задание первой части (kind "short").'));
        else if (long && t.max !== FULL_LONG_MAX[t.n]) errors.push(where + 'в полном пробнике оно стоит ' + FULL_LONG_MAX[t.n] + ' ' + pointsWord(FULL_LONG_MAX[t.n]) + ' (по таблице генератора).');
      });
    }
    Object.keys(x.key).forEach(function (n) { if (!seen[n]) warnings.push('В key есть ответ для задания ' + n + ', а самого задания нет.'); });

    if (jsonBytes(x.tasks) > MAX_TASKS_JSON) errors.push('Размер условий заданий больше допустимого (картинки лучше ужать).');
    if (jsonBytes(x.key) > MAX_KEY_JSON) errors.push('Размер ключа (ответы и решения) больше допустимого.');
    return done();
  }

  function validateExam(x) {
    try { return validateInner(x); }
    catch (e) { return { errors: ['Файл не удалось проверить: ' + String(e && e.message).slice(0, 100)], warnings: [], stats: { short: 0, long: 0 } }; }
  }

  const api = { validateExam: validateExam, extractFormulas: extractFormulas, scanFormulas: scanFormulas, htmlProblem: htmlProblem };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamValidate = api;
})(typeof self !== 'undefined' ? self : globalThis);
