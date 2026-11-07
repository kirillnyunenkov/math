import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness() {
  const map=new Map(), listeners={}, timers=new Set(); let nextTimer=0, year='2023';
  const app={innerHTML:'', addEventListener(type, fn){listeners[type]=fn;}};
  const exam={subtitle:'Основная волна',items:[{n:1,max:1,long:false,answer:'0',images:['a.png']},{n:2,max:2,long:true,images:['b.png']}]};
  const context={appEl:app, window:{ARCHIVE_EXAMS:{2023:exam}}, localStorage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},
    setBack(){},statsEl:{},typeset(){},armImages(){},syncHeaderH(){},ballWord(){return 'балла';}, escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
    ANS_ATTRS:'type="text"',fmtTime:()=>'',document:{getElementById(){return null;}},variantTimerId:null,
    setInterval(){const n=++nextTimer;timers.add(n);return n;},clearInterval(id){timers.delete(id);},
    parseRoute(){return {view:'archive',year};},go(){},scrollTop(){},ask:()=>Promise.resolve(true),answersEqual:(a,b)=>Number(a.replace(',','.'))===Number(b),Date,console};
  vm.createContext(context); vm.runInContext(readFileSync(new URL('../archive.js',import.meta.url),'utf8')+'\nglobalThis.ui=ArchiveUI;',context);
  function click(dataset,has=[]) {const target={dataset,hasAttribute:k=>has.includes(k),closest(){return this;},parentNode:{querySelectorAll(){return [];}}};listeners.click({target});}
  function input(i,value){const target={dataset:{archiveInput:String(i)},value,closest(){return this;}};listeners.input({target});}
  return {context,app,map,timers,click,input,render:()=>context.ui.render(year),setYear:y=>year=y,scales:context.ui.scales};
}

test('archive attempt resumes, grades zero correctly and does not record result twice', async()=>{
  const h=harness();h.render();h.click({archiveStart:'2023'});assert.equal(h.timers.size,1);
  h.input(0,'0');h.render();assert.equal(h.timers.size,1);assert.match(h.app.innerHTML,/value="0"/);
  h.click({archiveFinish:'2023'});h.click({archiveFinish:'2023'});await Promise.resolve();
  assert.equal(h.timers.size,0);assert.match(h.app.innerHTML,/Ответа для сверки пока нет/);
  h.click({archivePoints:'1',points:'2'},['data-archive-points']);h.click({archiveResult:'2023'});h.click({archiveResult:'2023'});
  const state=JSON.parse(h.map.get('ege_archive_v1_2023'));assert.deepEqual(state.points,[1,2]);
  assert.equal(JSON.parse(h.map.get('ege_archive_v1_2023_history')).length,1);assert.match(h.app.innerHTML,/Тестовый балл/);
});

test('yearly score scales preserve provided conversion',()=>{
  const h=harness();assert.equal(h.scales[2023][12],66);assert.equal(h.scales[2023][29],100);
  assert.equal(h.scales[2024][12],70);assert.equal(h.scales[2024][29],99);assert.equal(h.scales[2024][32],100);
});
