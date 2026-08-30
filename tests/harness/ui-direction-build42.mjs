// Build42 UI 방향(RIGHTMOST mockup 의도) geometry 계측기 — headless Chrome, 실제 렌더러 호출.
// 상태 8종 × 뷰포트 9종. 계약(§22): hero/penalty/roundResult/participantStatus/actions 좌표, safeAreaTop,
// bottomDeadSpace, unexpectedDeadSpace(슬롯 슬랙+c-foot 잔여), clippedPx, 태거 칩, 미리보기 높이, 플레이 순서.
export const DEVICES = [
  { name: 'iPhoneSE',       w: 375, h: 667, top: 20, bottom: 0  },
  { name: 'iPhone11',       w: 414, h: 896, top: 48, bottom: 34 },
  { name: 'iPhone12/13',    w: 390, h: 844, top: 47, bottom: 34 },
  { name: 'iPhone16',       w: 393, h: 852, top: 59, bottom: 34 },
  { name: 'iPhone16-field', w: 393, h: 818, top: 59, bottom: 0  },
  { name: 'And360x732',     w: 360, h: 732, top: 10, bottom: 0  },
  { name: 'And360x760',     w: 360, h: 760, top: 10, bottom: 0  },
  { name: 'And360x780',     w: 360, h: 780, top: 24, bottom: 0  },
  { name: 'AndTall',        w: 412, h: 915, top: 24, bottom: 0  },
];
export const VIEWS = ['finalLoserHost', 'finalLoserParticipant', 'finalWinnerHost', 'finalWinnerParticipant', 'readyHost', 'readyParticipant', 'gameChosen', 'winnerWait'];

export function buildProbePage(devices, indexSrc = '/index.html') {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0"><pre id="out">…</pre><script>
const D=${JSON.stringify(devices)};const rows=[];
function mk(w,h){return new Promise(r=>{const f=document.createElement('iframe');
 f.style.cssText='width:'+w+'px;height:'+h+'px;border:0;position:absolute;left:-9999px';
 f.src=${JSON.stringify(indexSrc)};f.onload=()=>setTimeout(()=>r(f),1200);document.body.appendChild(f)})}
const px=v=>Math.round(v*10)/10;
function shown(win,el,root){ if(!el) return false; let p=el; while(p&&p!==root){ const cs=win.getComputedStyle(p); if(cs.display==='none'||cs.visibility==='hidden'||p.classList.contains('hidden')) return false; p=p.parentElement;} return true; }
function vis(win,el,root){ if(!el||!shown(win,el,root)) return {exists:!!el,shown:false,top:0,bottom:0,natH:0,visH:0,clipped:0};
  const r=el.getBoundingClientRect(); let b={top:r.top,bottom:r.bottom}; let n=el.parentElement;
  while(n){ const cs=win.getComputedStyle(n); if(/(auto|scroll|hidden|clip)/.test(cs.overflowY+cs.overflow)){const c=n.getBoundingClientRect(); b.top=Math.max(b.top,c.top); b.bottom=Math.min(b.bottom,c.bottom);} n=n.parentElement;}
  b.top=Math.max(b.top,0); b.bottom=Math.min(b.bottom,win.innerHeight); const v=Math.max(0,b.bottom-b.top);
  return {exists:true,shown:true,top:px(r.top),bottom:px(r.bottom),natH:px(r.height),visH:px(v),clipped:px(Math.max(0,r.height-v))}; }
function show(doc,id){ doc.querySelectorAll('section.card').forEach(x=>x.classList.add('hidden')); doc.querySelectorAll('.mini,.sheet-overlay,.popup-overlay').forEach(x=>x.classList.add('hidden')); const s=doc.getElementById(id); s.classList.remove('hidden'); return s; }
function seed(win, extra){ const st=win.eval('state'); Object.assign(st,{role:'host',round:2,gameRound:2,gameNo:2,roomCode:'ABCD',penalty:'청소하기',targetLoserCount:1,currentUserId:'h',
  participants:[{id:'h',name:'호스트',is_ready:false,is_host:true},{id:'a',name:'참가자A',is_ready:true},{id:'b',name:'참가자B',is_ready:false}],
  confirmedLoserIds:[],confirmedSafeIds:[],roomStatus:'ready',status:'ready'}, extra||{}); return st; }
function call(win,log,expr){ try{ win.eval(expr); log.push(expr.split('(')[0]+':ok'); }catch(e){ log.push(expr.split('(')[0]+':'+String(e).slice(0,50)); } }
// 렌더러(gameOver 분기)와 같은 최종 버튼 집합 + slot-final 토글(참가자만). 렌더러 소스 계약은 테스트가 별도로 단언한다.
function finalBtns(doc,sec,host){ doc.getElementById('roundResultActions').style.display='none';
  const f=doc.getElementById('finalResultBtns'); f.classList.remove('hidden');
  f.innerHTML=(host?'<button class="btn-success btn-full span-full">한번더</button>':'')+'<button class="btn-light btn-full">게임 승률 보기</button><button class="btn-outline btn-full">게임방에서 나가기</button>';
  doc.getElementById('verdictActionSlot').classList.toggle('slot-final', !host);
  sec.querySelector('.c-foot > .action-grid')?.classList.add('hidden'); }
function resultBase(doc,win,log,host,lose){ const s=show(doc,'screenRoundResult');
  seed(win,{role:host?'host':'participant',currentUserId:host?'h':'a',roomStatus:'result',status:'result',confirmedLoserIds:[lose?(host?'h':'a'):'b']});
  call(win,log,'renderRoundProgressCards()'); s.querySelector('[data-round-progress]').classList.remove('hidden');
  doc.getElementById('resultCap').textContent=lose?'술래 확정!':'야호~!';
  doc.getElementById('resultTitle').textContent=lose?'술래 확정! (1/1명)':'승리!';
  doc.getElementById('resultMessage').textContent=lose?'축하합니다(?) 벌칙을 수행하세요!':'술래 1명이 모두 결정됐습니다!';
  const pb=doc.getElementById('resultPenaltyBox'); pb.classList.toggle('hidden',!lose); doc.getElementById('resultPenaltyText').textContent='청소하기';
  doc.getElementById('roundResultList').innerHTML=[['호스트',host&&lose?'패':'승'],['참가자A',!host&&lose?'패':'승'],['참가자B',lose?'승':'패']].map(([n,t])=>'<div class="participant"><strong>'+n+'</strong><span class="tag">'+t+'</span></div>').join('');
  finalBtns(doc,s,host); return s; }
const VIEWS={
 finalLoserHost(doc,win,log){ return resultBase(doc,win,log,true,true); },
 finalLoserParticipant(doc,win,log){ return resultBase(doc,win,log,false,true); },
 finalWinnerHost(doc,win,log){ return resultBase(doc,win,log,true,false); },
 finalWinnerParticipant(doc,win,log){ return resultBase(doc,win,log,false,false); },
 readyHost(doc,win,log){ const s=show(doc,'screenReady'); seed(win);
  call(win,log,'renderRoundProgressCards()'); call(win,log,'updateGuides()'); call(win,log,'renderReadyList()');
  call(win,log,'renderInlinePenaltyBox(document.getElementById("readyPenaltyBox"))');
  doc.getElementById('myReadyBtn').classList.add('hidden'); doc.getElementById('forceStartReplayBtnReady').classList.remove('hidden'); doc.getElementById('editPenaltyBtn').classList.remove('hidden');
  call(win,log,'updateActionGridLayouts()'); return s; },
 readyParticipant(doc,win,log){ const s=show(doc,'screenReady'); seed(win,{role:'participant',currentUserId:'b'});
  call(win,log,'renderRoundProgressCards()'); call(win,log,'updateGuides()'); call(win,log,'renderReadyList()');
  call(win,log,'renderInlinePenaltyBox(document.getElementById("readyPenaltyBox"))');
  doc.getElementById('forceStartReplayBtnReady').classList.add('hidden'); doc.getElementById('editPenaltyBtn').classList.add('hidden'); doc.getElementById('myReadyBtn').classList.remove('hidden');
  call(win,log,'updateActionGridLayouts()'); return s; },
 gameChosen(doc,win,log){ const s=show(doc,'screenGame'); seed(win,{round:5,gameRound:5,roomStatus:'playing',status:'playing'});
  call(win,log,'renderRoundProgressCards()'); call(win,log,'updateGuides()');
  doc.getElementById('choiceAnim').innerHTML='<img class="maru-hand-lg" src="ASSETS/rps/scenes/cat-rock-ko.png">'; return s; },
 winnerWait(doc,win,log){ const s=show(doc,'screenWinnerWait'); seed(win,{roomStatus:'ready',status:'ready',confirmedSafeIds:['h']});
  call(win,log,'renderRoundProgressCards()'); s.querySelector('[data-round-progress]')?.classList.remove('hidden');
  const fb=doc.getElementById('forceStartReplayBtnWinnerWait'); if(fb) fb.classList.remove('hidden'); call(win,log,'updateActionGridLayouts()'); return s; },
};
(async()=>{for(const d of D){
  const f=await mk(d.w,d.h);const doc=f.contentDocument,win=f.contentWindow;
  const safeT=Math.max(18,d.top+8), safeB=Math.max(18,d.bottom);
  const st=doc.createElement('style'); st.textContent='.app{--safe-top:'+safeT+'px;--safe-bottom:'+safeB+'px}'; doc.head.appendChild(st);
  for(const view of Object.keys(VIEWS)){ const log=[];
  try{ const sec=VIEWS[view](doc,win,log); await new Promise(r=>setTimeout(r,150));
    const q=x=>sec.querySelector(x); const head=q('.c-head'),body=q('.c-body'),foot=q('.c-foot');
    const btns=[...foot.querySelectorAll('button')].filter(b=>shown(win,b,sec)).map(b=>{const r=b.getBoundingClientRect(); return {t:(b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,14),h:px(r.height),w:px(r.width),top:px(r.top),bottom:px(r.bottom)};});
    const actionsTop=Math.min(...btns.map(b=>b.top)), actionsBottom=Math.max(...btns.map(b=>b.bottom));
    const footR=foot.getBoundingClientRect(), footPadB=parseFloat(win.getComputedStyle(foot).paddingBottom)||0;
    const slot=doc.getElementById('verdictActionSlot'); let slotSlack=0; if(slot&&sec.contains(slot)&&shown(win,slot,sec)){ const fin=doc.getElementById('finalResultBtns'); slotSlack=px(Math.max(0,slot.getBoundingClientRect().bottom-fin.getBoundingClientRect().bottom)); }
    const footInnerSlack=px(Math.max(0,(footR.bottom-footPadB)-actionsBottom));
    const card=q('[data-round-progress]'); const cardV=vis(win,card,sec);
    const row={dev:d.name,view,viewportH:d.h,safeAreaTop:safeT,safeAreaBottom:safeB,log,
      headH:px(head.getBoundingClientRect().height), bodyVisH:px(body.getBoundingClientRect().height), bodyScrollH:body.scrollHeight,
      roundResult:cardV, actions:{top:px(actionsTop),bottom:px(actionsBottom)},
      safeAreaOverlap:px(Math.max(0,actionsBottom-(d.h-safeB))), bottomDeadSpace:px(d.h-actionsBottom),
      // 의도된 하단 = c-foot padding-bottom(flush 화면: 안전영역) + 카드 padding-bottom + 카드 아래 .app 안전 패딩(비-flush 화면)
      intentionalBottomPadding:px(footPadB+(parseFloat(win.getComputedStyle(sec).paddingBottom)||0)+Math.max(0,d.h-sec.getBoundingClientRect().bottom)),
      unexpectedDeadSpace:px(slotSlack+footInnerSlack), touchTargetHeight:Math.min(...btns.map(b=>b.h)),
      duplicateExitCount:btns.filter(b=>/나가기/.test(b.t)).length, wrappedButtons:btns.filter(b=>b.h>60&&!/가위|바위|보/.test(b.t)).map(b=>b.t), btns};
    if(view.startsWith('final')){ const hero=q('.result-hero'), img=doc.getElementById('resultMaru'), pen=doc.getElementById('resultPenaltyBox'), list=doc.getElementById('roundResultList');
      row.hero=Object.assign(vis(win,hero,sec),{imgH:px(img.getBoundingClientRect().height)});
      row.penalty=Object.assign(vis(win,pen,sec),{form:pen.classList.contains('penalty-tail')?'tail':'big',bigForm:pen.getBoundingClientRect().height>=60});
      row.participantStatus=vis(win,list.firstElementChild,sec); row.participantList=vis(win,list,sec);
      row.penaltyBeforeCard = row.penalty.shown ? (row.penalty.bottom<=cardV.top+0.5) : null;
      row.titleLines=Math.round(doc.getElementById('resultTitle').getBoundingClientRect().height/(parseFloat(win.getComputedStyle(doc.getElementById('resultTitle')).lineHeight)||50)); }
    if(view.startsWith('ready')){ const list=doc.getElementById('readyParticipantList'); row.participantStatus=vis(win,list,sec); row.hero=vis(win,q('.maru-corner'),sec);
      const chip=sec.querySelector('[data-tagger-chip]'); row.taggerChip=chip?Object.assign(vis(win,chip,sec),{text:(chip.textContent||'').trim()}):{exists:false,shown:false,text:''}; }
    if(view==='gameChosen'){ const sum=q('.summary-row'), anim=doc.getElementById('choiceAnim'); row.summary=vis(win,sum,sec); row.preview=vis(win,anim,sec); row.hero=row.preview;
      const pimg=anim.querySelector('img'); row.preview.imgH=pimg?px(pimg.getBoundingClientRect().height):0;
      const cbs=[...sec.querySelectorAll('.choice-button')].map(b=>vis(win,b,sec)); row.choiceButtonsVisible=cbs.every(c=>c.clipped===0&&c.bottom<=d.h);
      row.order={summaryBottom:row.summary.bottom, cardTop:cardV.top, cardBottom:cardV.bottom, previewTop:row.preview.top, previewBottom:row.preview.bottom, actionsTop:px(actionsTop)}; }
    if(view==='winnerWait'){ row.hero=vis(win,q('.result-hero'),sec); }
    rows.push(JSON.stringify(row));
  }catch(e){rows.push(JSON.stringify({dev:d.name,view,error:String(e),log}))} }
  f.remove(); }
  document.getElementById('out').textContent='RESULTS\\n'+rows.join('\\n')+'\\nEND';})();
</script>`;
}
