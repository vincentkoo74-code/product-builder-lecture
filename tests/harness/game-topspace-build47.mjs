// Build47 필드QA 정정(항목 3) geometry 계측기 — 게임 화면 상단 사공간 + 중앙 렌더 영역.
// ui-direction-build42.mjs 와 같은 iframe 주입 방식. --safe-top 은 recovery 공식 max(18, inset+4)를 주입한다.
export const DEVICES47 = [
  { name: 'iPhone16',       w: 393, h: 852, top: 59, bottom: 34 },
  { name: 'iPhone16-field', w: 393, h: 818, top: 59, bottom: 0  },
  { name: 'iPhoneSE',       w: 375, h: 667, top: 20, bottom: 0  },
  { name: 'And360x732',     w: 360, h: 732, top: 10, bottom: 0  },
  { name: 'AndTall',        w: 412, h: 915, top: 24, bottom: 0  },
];
export function buildGameProbePage(devices, indexSrc = '/index.html') {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0"><pre id="out">…</pre><script>
const D=${JSON.stringify(devices)};const rows=[];
const px=v=>Math.round(v*10)/10;
function mk(w,h){return new Promise(r=>{const f=document.createElement('iframe');
 f.style.cssText='width:'+w+'px;height:'+h+'px;border:0;position:absolute;left:-9999px';
 f.src=${JSON.stringify(indexSrc)};f.onload=()=>setTimeout(()=>r(f),1200);document.body.appendChild(f)})}
function vis(win,el,root){ if(!el) return {exists:false,clipped:0,top:0,bottom:0,natH:0};
 const r=el.getBoundingClientRect(); let b={top:Math.max(r.top,0),bottom:Math.min(r.bottom,win.innerHeight)};
 const v=Math.max(0,b.bottom-b.top); return {exists:true,top:px(r.top),bottom:px(r.bottom),natH:px(r.height),clipped:px(Math.max(0,r.height-v))}; }
(async()=>{for(const d of D){
 const f=await mk(d.w,d.h);const doc=f.contentDocument,win=f.contentWindow;
 const safeT=Math.max(18,d.top+4), safeB=Math.max(18,d.bottom);
 const st=doc.createElement('style'); st.textContent='.app{--safe-top:'+safeT+'px;--safe-bottom:'+safeB+'px}'; doc.head.appendChild(st);
 try{
  doc.querySelectorAll('section.card').forEach(x=>x.classList.add('hidden'));
  doc.querySelectorAll('.mini,.sheet-overlay,.popup-overlay').forEach(x=>x.classList.add('hidden'));
  const sec=doc.getElementById('screenGame'); sec.classList.remove('hidden');
  const stg=win.eval('state'); Object.assign(stg,{role:'host',round:1,gameRound:2,roomCode:'ABCD',penalty:'청소하기',targetLoserCount:1,currentUserId:'h',
   participants:[{id:'h',name:'호스트'},{id:'a',name:'참가자A'},{id:'b',name:'참가자B'}],roomStatus:'playing',status:'playing'});
  const log=[]; try{win.eval('renderRoundProgressCards()');log.push('renderRoundProgressCards:ok');}catch(e){log.push('renderRoundProgressCards:'+String(e).slice(0,50));}
  doc.getElementById('choiceAnim').innerHTML='<img class="maru-hand-lg" src="ASSETS/rps/scenes/cat-rock-ko.png">';
  await new Promise(r=>setTimeout(r,250));
  const app=doc.querySelector('.app');
  const cbs=[...sec.querySelectorAll('.choice-button')].map(b=>vis(win,b,sec));
  rows.push(JSON.stringify({dev:d.name, vh:d.h, safeT, safeB, log,
   appPadTop:px(parseFloat(win.getComputedStyle(app).paddingTop)),
   topbar:vis(win,doc.querySelector('.topbar'),null), cheadTop:vis(win,sec.querySelector('.c-head'),sec).top,
   choiceAnim:vis(win,doc.getElementById('choiceAnim'),sec),
   choiceBtnBottom:px(Math.max(...cbs.map(c=>c.bottom))), choiceBtnClipped:px(Math.max(...cbs.map(c=>c.clipped))),
   accountDeletePresent:!!doc.querySelector('#accountStatsPopup [onclick="window.deleteAccountWithConfirm()"]'),
   pageScrolls:doc.documentElement.scrollHeight>win.innerHeight+1}));
 }catch(e){rows.push(JSON.stringify({dev:d.name,error:String(e)}))}
 f.remove(); }
 document.getElementById('out').textContent='RESULTS\\n'+rows.join('\\n')+'\\nEND';})();
</script>`;
}
