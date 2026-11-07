/* Historical papers keep their own answers and attempts: task numbers changed over time. */
const ArchiveUI = (() => {
  const scales = {
    2023: [0,6,11,17,22,27,34,40,46,52,58,64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,96,98,100,100,100],
    2024: [0,6,11,17,22,27,34,40,46,52,58,64,70,72,74,76,78,80,82,84,86,88,90,92,94,95,96,97,98,99,100,100,100]
  };
  const key = year => 'ege_archive_v1_' + year;
  const data = year => (window.ARCHIVE_EXAMS || {})[year];
  const read = year => { try { return JSON.parse(localStorage.getItem(key(year))) || null; } catch (_) { return null; } };
  const history = year => { try { return JSON.parse(localStorage.getItem(key(year)+'_history')) || []; } catch (_) { return []; } };
  const write = (year, value) => { try { localStorage.setItem(key(year), JSON.stringify(value)); } catch (_) {} };
  const ready = exam => exam && exam.items && exam.items.length && exam.items.every(it =>
    (it.image || (Array.isArray(it.images) && it.images.length)) && (it.long || String(it.answer ?? '').trim()));
  const img = it => (it.images || (it.image ? [it.image] : [])).map(src => `<img src="${escapeHtml(src)}" alt="Условие задания ${it.n}">`).join('');
  const condition = it => `<div class="cond">${img(it)}</div>`;
  const cardTitle = it => `<div class="vlabel">Задание ${it.n}${it.long ? `<span class="vlabel-art"> · максимум ${it.max} ${ballWord(it.max)}</span>` : ''}</div>`;
  const mount = (html, after) => { appEl.innerHTML=html; typeset(appEl); armImages(appEl); syncHeaderH(); if(after)after(); };
  function render(year) {
    if(variantTimerId){clearInterval(variantTimerId);variantTimerId=null;}
    setBack(true); statsEl.innerHTML='';
    if (!year) {
      mount(`<div class="vbox"><div class="vintro"><h2>ЕГЭ прошлых лет</h2><p class="lead">Выбери год. Ответы первой части проверяются автоматически, вторую часть оцениваешь сам.</p>
        ${[2024,2023].map(y => { const e=data(y), saved=read(y), hist=history(y).slice(-3).reverse(); return `<div class="vcard"><div class="vlabel">ЕГЭ ${y}</div><p>${e && e.subtitle ? escapeHtml(e.subtitle) : 'Основная волна'}</p><button class="btn primary" data-archive-year="${y}" ${ready(e)?'':'disabled'}>${saved && saved.phase!=='result'?'Продолжить':'Открыть вариант'}</button>${hist.length?`<p>Последние результаты: ${hist.map(h=>`${new Date(h.t).toLocaleDateString('ru-RU')} — ${h.p} перв. / ${scales[y][h.p]} тест.`).join('; ')}</p>`:''}</div>`; }).join('')}</div></div>`);
      return;
    }
    const exam=data(year), saved=read(year);
    if(!ready(exam)){ mount('<div class="vbox"><h2>Вариант пока недоступен</h2><button class="btn" data-archive>К списку</button></div>');return; }
    if(!saved || saved.phase==='result'){
      if(saved && saved.phase==='result'){renderResult(year,exam,saved);return;}
      mount(`<div class="vbox"><div class="vintro"><h2>ЕГЭ ${year}</h2><p class="lead">${escapeHtml(exam.subtitle || 'Основная волна')} · ${exam.items.length} заданий</p><p>Первая часть проверяется автоматически. Вторую часть решай на листе и оцени сам после завершения. Баллы переводятся по шкале ${year} года.</p><button class="btn primary" data-archive-start="${year}">Начать вариант</button></div></div>`);
      return;
    }
    if(saved.phase==='scoring'){renderScoring(year,exam,saved);return;}
    mount(`<div class="vbox"><div class="vbar"><span class="vtimer" id="v-timer">00:00</span><span class="vprog">ЕГЭ ${year} · ${exam.items.length} заданий</span><span class="spacer"></span><button class="btn primary" data-archive-finish="${year}">Завершить</button></div>
      ${exam.items.map((it,i)=>`<div class="vcard">${cardTitle(it)}${condition(it)}${it.long?'<p class="vlong-hint">Решение записывай на листе. После завершения поставишь баллы самостоятельно.</p>':`<input class="v-input" ${ANS_ATTRS} placeholder="Ответ" data-archive-input="${i}" value="${escapeHtml(saved.answers[i] || '')}" autocomplete="off">`}</div>`).join('')}
      <div style="text-align:center;margin-top:8px"><button class="btn primary" data-archive-finish="${year}">Завершить вариант</button></div></div>`,()=>{
        const upd=()=>{const el=document.getElementById('v-timer');if(el)el.textContent=fmtTime(Date.now()-saved.startAt);};upd();variantTimerId=setInterval(upd,1000);
      });
  }
  function renderScoring(year,exam,saved){
    mount(`<div class="vbox"><div class="vintro vscoring-intro"><h2>Оцени вторую часть</h2><p class="lead">Поставь себе баллы после проверки решения. По умолчанию везде 0; автоматической проверки второй части нет.</p></div>
      ${exam.items.map((it,i)=>!it.long?'':`<div class="vcard">${cardTitle(it)}${condition(it)}<div class="answer long tex">${it.answer?`Ответ: ${escapeHtml(String(it.answer))}`:'Ответа для сверки пока нет'}</div><div class="vpts"><span class="vpts-l">Мой балл</span><div class="mode-seg vpts-seg" role="radiogroup" aria-label="Баллы за задание ${it.n}">${Array.from({length:it.max+1},(_,k)=>`<button class="seg${(saved.points[i]||0)===k?' on':''}" role="radio" aria-checked="${(saved.points[i]||0)===k}" data-archive-points="${i}" data-points="${k}">${k}</button>`).join('')}</div></div></div>`).join('')}
      <div style="text-align:center;margin-top:8px"><button class="btn primary" data-archive-result="${year}">Показать результат</button></div></div>`);
  }
  function renderResult(year,exam,saved){
    const sum=saved.points.reduce((a,b)=>a+(b||0),0), max=exam.items.reduce((a,it)=>a+it.max,0), s=scales[year][sum];
    mount(`<div class="vbox"><div class="vresult"><h2>ЕГЭ ${year} · вариант завершён</h2><div class="vscores"><div class="vscore"><div class="vk">Первичный балл</div><div class="vv">${sum}<span style="font-size:16px">/${max}</span></div></div><div class="vscore"><div class="vk">Тестовый балл</div><div class="vv">${s}</div></div><div class="vscore"><div class="vk">Время</div><div class="vv" style="font-size:22px">${fmtTime(saved.elapsed)}</div></div></div><div class="vactions"><button class="btn" data-archive-restart="${year}">Пройти ещё раз</button><button class="btn" data-archive>К вариантам</button></div></div>
      ${exam.items.map((it,i)=>`<div class="vcard ${saved.points[i]===it.max?'r-ok':saved.points[i]?'is-o':'r-no'}"><div class="vlabel">Задание ${it.n}<span class="vtag">${saved.points[i]} из ${it.max}</span></div>${condition(it)}${it.long?`<p>Самооценка: ${saved.points[i]} из ${it.max}</p>${it.answer?`<div class="answer long">Ответ: ${escapeHtml(String(it.answer))}</div>`:''}`:`<div class="vans-row"><span class="yours">Твой ответ: ${escapeHtml(saved.answers[i] || '—')}</span> · <span class="right">Верный: ${escapeHtml(String(it.answer))}</span></div>`}</div>`).join('')}</div>`);
  }
  appEl.addEventListener('input', e=>{const el=e.target.closest('[data-archive-input]');if(!el)return;const year=parseRoute().year, saved=read(year);if(!saved||saved.phase!=='running')return;saved.answers[+el.dataset.archiveInput]=el.value;write(year,saved);});
  appEl.addEventListener('click', e=>{
    const target=e.target.closest('[data-archive],[data-archive-year],[data-archive-start],[data-archive-finish],[data-archive-points],[data-archive-result],[data-archive-restart]');if(!target)return;
    if(target.hasAttribute('data-archive')){go('#/archive');return;}
    if(target.dataset.archiveYear){go('#/archive/'+target.dataset.archiveYear);return;}
    const year=parseRoute().year, exam=data(year);if(!exam)return;
    if(target.dataset.archiveStart){write(year,{phase:'running',startAt:Date.now(),answers:exam.items.map(()=>''),points:exam.items.map(()=>0)});scrollTop();render(year);return;}
    if(target.dataset.archiveRestart){write(year,{phase:'running',startAt:Date.now(),answers:exam.items.map(()=>''),points:exam.items.map(()=>0)});scrollTop();render(year);return;}
    const saved=read(year);if(!saved)return;
    if(target.dataset.archiveFinish){if(saved.phase!=='running')return;ask({title:'Завершить вариант?',text:'Ответы первой части будут проверены, затем ты оценишь вторую часть самостоятельно.',ok:'Завершить'}).then(ok=>{const latest=read(year);if(!ok||!latest||latest.phase!=='running'||parseRoute().year!==year)return;latest.elapsed=Date.now()-latest.startAt;exam.items.forEach((it,i)=>{if(!it.long)latest.points[i]=latest.answers[i] && answersEqual(latest.answers[i],String(it.answer))?1:0;});latest.phase='scoring';write(year,latest);scrollTop();render(year);});return;}
    if(target.hasAttribute('data-archive-points')){if(saved.phase!=='scoring')return;saved.points[+target.dataset.archivePoints]=+target.dataset.points;write(year,saved);target.parentNode.querySelectorAll('.seg').forEach(b=>{const on=b===target;b.classList.toggle('on',on);b.setAttribute('aria-checked',on);});return;}
    if(target.dataset.archiveResult){
      if(saved.phase!=='scoring')return;
      saved.phase='result';write(year,saved);
      const historyKey=key(year)+'_history';
      try{const history=JSON.parse(localStorage.getItem(historyKey)||'[]');history.push({t:Date.now(),p:saved.points.reduce((a,b)=>a+(b||0),0),ms:saved.elapsed});localStorage.setItem(historyKey,JSON.stringify(history.slice(-50)));}catch(_){}
      scrollTop();render(year);
    }
  });
  return {render, scales};
})();
