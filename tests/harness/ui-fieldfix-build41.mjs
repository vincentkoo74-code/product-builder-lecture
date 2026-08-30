// Build41 UI 필드픽스 geometry 계측기 (headless Chrome). 실제 렌더러(renderRoundProgressCards /
// updateGuides / renderReadyList / renderInlinePenaltyBox)를 iframe 안에서 호출해 필드 상태를 재현한다.
//
// ⚠️ rect 단독 판정 금지 — vis() 로 overflow 조상(c-body 등)과 교집합한 영역만 "보이는 것"으로 센다.
// ⚠️ 계약 수치는 모두 뷰포트/안전영역에서 유도한다(기기 하드코딩 없음).
//
// 뷰포트 매트릭스(프로토콜 지정): iPhone SE / 11 / 12-13 / 16, Android compact / medium / tall.
export const DEVICES = [
  { name: 'iPhoneSE',    w: 375, h: 667, top: 20, bottom: 0  },
  { name: 'iPhone11',    w: 414, h: 896, top: 48, bottom: 34 },
  { name: 'iPhone12/13', w: 390, h: 844, top: 47, bottom: 34 },
  { name: 'iPhone16',    w: 393, h: 852, top: 59, bottom: 34 },
  { name: 'AndCompact',  w: 360, h: 640, top: 24, bottom: 0  },
  { name: 'AndMedium',   w: 360, h: 780, top: 24, bottom: 0  },
  { name: 'AndTall',     w: 412, h: 915, top: 24, bottom: 0  },
];
export const VIEWS = ['resultLoser', 'resultWinner', 'readyHost', 'readyParticipant', 'gameChosen', 'winnerWait', 'statsPopup'];

export function buildProbePage(devices, indexSrc = '/index.html') {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0"><pre id="out">…</pre><script>
const D=${JSON.stringify(devices)};const rows=[];
function mk(w,h){return new Promise(r=>{const f=document.createElement('iframe');
 f.style.cssText='width:'+w+'px;height:'+h+'px;border:0;position:absolute;left:-9999px';
 f.src=${JSON.stringify(indexSrc)};f.onload=()=>setTimeout(()=>r(f),1200);document.body.appendChild(f)})}
const px=v=>Math.round(v*10)/10;
function vis(win,el){ if(!el) return {exists:false,natH:0,visH:0,clipped:0};
  const r=el.getBoundingClientRect(); let b={top:r.top,bottom:r.bottom}; let n=el.parentElement;
  while(n){ const cs=win.getComputedStyle(n); if(/(auto|scroll|hidden|clip)/.test(cs.overflowY+cs.overflow)){
    const c=n.getBoundingClientRect(); b.top=Math.max(b.top,c.top); b.bottom=Math.min(b.bottom,c.bottom);} n=n.parentElement;}
  b.top=Math.max(b.top,0); b.bottom=Math.min(b.bottom,win.innerHeight); const v=Math.max(0,b.bottom-b.top);
  return {exists:true,natH:px(r.height),visH:px(v),clipped:px(Math.max(0,r.height-v)),top:px(r.top),bottom:px(r.bottom)}; }
function shown(win,el,root){ let p=el; while(p&&p!==root){ const cs=win.getComputedStyle(p); if(cs.display==='none'||p.classList.contains('hidden')) return false; p=p.parentElement;} return true; }
function show(doc,id){ doc.querySelectorAll('section.card').forEach(x=>x.classList.add('hidden'));
  doc.querySelectorAll('.mini,.sheet-overlay,.popup-overlay').forEach(x=>x.classList.add('hidden'));
  const s=doc.getElementById(id); s.classList.remove('hidden'); return s; }
function seed(win, extra){ const st=win.eval('state'); Object.assign(st,{role:'host',round:2,gameRound:2,gameNo:2,roomCode:'ABCD',
  penalty:'커피 사기',targetLoserCount:1,currentUserId:'h',
  participants:[{id:'h',name:'호스트',is_ready:false,is_host:true},{id:'a',name:'참가자A',is_ready:true},{id:'b',name:'참가자B',is_ready:false}],
  confirmedLoserIds:[],confirmedSafeIds:[],roomStatus:'ready',status:'ready'}, extra||{}); return st; }
function call(win,log,expr){ try{ win.eval(expr); log.push(expr.split('(')[0]+':ok'); }catch(e){ log.push(expr.split('(')[0]+':'+String(e).slice(0,50)); } }
function finalBtns(doc,sec){ doc.getElementById('roundResultActions').style.display='none';
  const f=doc.getElementById('finalResultBtns'); f.classList.remove('hidden');
  f.innerHTML='<button class="btn-success btn-full span-full">한번더</button><button class="btn-light btn-full">게임 승률 보기</button><button class="btn-outline btn-full">게임방에서 나가기</button>';
  sec.querySelector('.c-foot > .action-grid')?.classList.add('hidden'); }
const VIEWS={
 resultLoser(doc,win,log){ const s=show(doc,'screenRoundResult'); seed(win,{roomStatus:'result',status:'result',confirmedLoserIds:['h']});
  call(win,log,'renderRoundProgressCards()');
  doc.getElementById('resultTitle').textContent='술래!'; doc.getElementById('resultCap').textContent='술래 확정!';
  doc.getElementById('resultMessage').textContent='벌칙을 준비하세요.';
  doc.getElementById('resultPenaltyBox').classList.remove('hidden'); doc.getElementById('resultPenaltyText').textContent='커피 사기';
  s.querySelector('[data-round-progress]').classList.remove('hidden');
  doc.getElementById('roundResultList').innerHTML=['호스트','참가자A','참가자B'].map(n=>'<div class="participant"><strong>'+n+'</strong><span class="tag">패</span></div>').join('');
  finalBtns(doc,s); return s; },
 resultWinner(doc,win,log){ const s=VIEWS.resultLoser(doc,win,log); doc.getElementById('resultPenaltyBox').classList.add('hidden');
  doc.getElementById('resultTitle').textContent='승리!'; doc.getElementById('resultMessage').textContent='술래 1명이 정해졌어요.'; return s; },
 readyHost(doc,win,log){ const s=show(doc,'screenReady'); seed(win);
  call(win,log,'renderRoundProgressCards()'); call(win,log,'updateGuides()'); call(win,log,'renderReadyList()');
  call(win,log,'renderInlinePenaltyBox(document.getElementById("readyPenaltyBox"))');
  // 필드 상태(IMG_2043): 호스트, round≥2, 강제 시작 노출 + 벌칙 수정 노출
  doc.getElementById('myReadyBtn').classList.add('hidden');
  doc.getElementById('forceStartReplayBtnReady').classList.remove('hidden');
  doc.getElementById('editPenaltyBtn').classList.remove('hidden');
  call(win,log,'updateActionGridLayouts()'); return s; },
 readyParticipant(doc,win,log){ const s=show(doc,'screenReady'); seed(win,{role:'participant',currentUserId:'b'});
  call(win,log,'renderRoundProgressCards()'); call(win,log,'updateGuides()'); call(win,log,'renderReadyList()');
  call(win,log,'renderInlinePenaltyBox(document.getElementById("readyPenaltyBox"))');
  doc.getElementById('forceStartReplayBtnReady').classList.add('hidden'); doc.getElementById('editPenaltyBtn').classList.add('hidden');
  doc.getElementById('myReadyBtn').classList.remove('hidden'); call(win,log,'updateActionGridLayouts()'); return s; },
 gameChosen(doc,win,log){ const s=show(doc,'screenGame'); seed(win,{round:5,gameRound:5,roomStatus:'playing',status:'playing'});
  call(win,log,'renderRoundProgressCards()'); call(win,log,'updateGuides()');
  doc.getElementById('choiceAnim').innerHTML='<img class="maru-hand-lg" src="ASSETS/rps/scenes/cat-rock-ko.png">'; return s; },
 winnerWait(doc,win,log){ const s=show(doc,'screenWinnerWait'); seed(win,{roomStatus:'ready',status:'ready',confirmedSafeIds:['h']});
  call(win,log,'renderRoundProgressCards()'); s.querySelector('[data-round-progress]')?.classList.remove('hidden');
  const fb=doc.getElementById('forceStartReplayBtnWinnerWait'); if(fb) fb.classList.remove('hidden');
  call(win,log,'updateActionGridLayouts()'); return s; },
 statsPopup(doc,win,log){ show(doc,'screenHome'); const ov=doc.getElementById('accountStatsPopup'); ov.classList.remove('hidden');
  doc.getElementById('accountStatsBody').innerHTML='<div class="participant stats-error"><strong>기록 불러오기 실패</strong><span>permission denied for table user_game_stats</span></div>'; return ov; },
};
// 기기당 iframe 1개만 로드한다(뷰마다 새로 띄우면 49회 로드 → Chrome 계측 suite 병렬 실행 시 정체).
// 각 뷰는 show()로 모든 section/popup 을 먼저 숨기고 필요한 요소만 다시 켜므로 같은 문서를 재사용해도 독립적이다.
(async()=>{for(const d of D){
  const f=await mk(d.w,d.h);const doc=f.contentDocument,win=f.contentWindow;
  const st=doc.createElement('style'); st.textContent='.app{--safe-top:'+Math.max(18,d.top+8)+'px;--safe-bottom:'+Math.max(18,d.bottom)+'px}'; doc.head.appendChild(st);
  for(const view of Object.keys(VIEWS)){ const log=[];
  try{
    const sec=VIEWS[view](doc,win,log); await new Promise(r=>setTimeout(r,150)); const safeB=Math.max(18,d.bottom);
    if(view==='statsPopup'){ const st=sec.querySelector('.participant strong'); const sr=st.getBoundingClientRect();
      rows.push(JSON.stringify({dev:d.name,view,strongW:px(sr.width),strongLines:Math.round(sr.height/(parseFloat(win.getComputedStyle(st).lineHeight)||19))})); continue; }
    const q=x=>sec.querySelector(x); const head=q('.c-head'),body=q('.c-body'),foot=q('.c-foot');
    const hr=head.getBoundingClientRect(),br=body.getBoundingClientRect();
    const btns=[...foot.querySelectorAll('button')].filter(b=>shown(win,b,sec)).map(b=>{const r=b.getBoundingClientRect();
      return {t:(b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,14),h:px(r.height),w:px(r.width),top:px(r.top),bottom:px(r.bottom)};});
    const lastBottom=Math.max(...btns.map(b=>b.bottom)), firstTop=Math.min(...btns.map(b=>b.top));
    const card=q('[data-round-progress]'); const cardV=card&&shown(win,card,sec)?vis(win,card):{exists:false,natH:0,visH:0,clipped:0};
    const row={dev:d.name,view,vh:d.h,log,
      headH:px(hr.height), headShare:px(hr.height/d.h*100), bodyVisH:px(br.height), bodyContentH:body.scrollHeight,
      resultCardFullHeight:cardV.natH, resultCardVisibleHeight:cardV.visH, clippedPx:cardV.clipped,
      actionsTop:px(firstTop), actionsBottom:px(lastBottom),
      safeAreaOverlap:px(Math.max(0,lastBottom-(d.h-safeB))), bottomDeadSpace:px(d.h-lastBottom),
      duplicateExitCount:btns.filter(b=>/나가기/.test(b.t)).length, touchTargetHeight:Math.min(...btns.map(b=>b.h)),
      wrappedButtons:btns.filter(b=>b.h>60&&!/가위|바위|보/.test(b.t)).map(b=>b.t), btns};
    if(view.startsWith('result')){ const pen=doc.getElementById('resultPenaltyBox'); row.penaltyShown=shown(win,pen,sec); row.penalty=row.penaltyShown?vis(win,pen):null;
      row.heroH=px(q('.result-hero').getBoundingClientRect().height); row.maruSize=px(doc.getElementById('resultMaru').getBoundingClientRect().height);
      const first=doc.getElementById('roundResultList').firstElementChild; row.firstRow=vis(win,first); }
    if(view.startsWith('ready')){ const list=doc.getElementById('readyParticipantList'); row.participantListVisibleHeight=vis(win,list).visH;
      row.participantListFullHeight=vis(win,list).natH; row.firstRow=vis(win,list.firstElementChild); row.h3=vis(win,q('.c-body h3')); }
    if(view==='gameChosen'){ row.summary=vis(win,q('.summary-row')); const cbs=[...sec.querySelectorAll('.choice-button')].map(b=>vis(win,b));
      row.choiceButtonsVisible=cbs.every(c=>c.clipped===0&&c.bottom<=d.h); row.choiceBtn=cbs[0]; row.anim=vis(win,doc.getElementById('choiceAnim')); }
    rows.push(JSON.stringify(row));
  }catch(e){rows.push(JSON.stringify({dev:d.name,view,error:String(e),log}))} }
  f.remove(); }
  document.getElementById('out').textContent='RESULTS\\n'+rows.join('\\n')+'\\nEND';})();
</script>`;
}
