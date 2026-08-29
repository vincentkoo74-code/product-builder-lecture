// 최종 결과 / 탈락·재경기 대기 화면 geometry 계측기 (headless Chrome).
//
// ⚠️ rect 단독 판정 금지 — effectiveVisible() 로 overflow 조상과 교집합한 영역만 본다.
// ⚠️ "삭제됐다"와 "못 찾았다"를 구분하려면 flowFootprint() 로 offsetHeight + margin 을 본다.
//    display:none 이면 0, 빈 박스가 남아 있으면 0 이 아니다.

export const DEVICES = [
  { name: 'iPhone12',    w: 390, h: 844, top: 47, bottom: 34 },
  { name: 'iPhone15/16', w: 393, h: 852, top: 59, bottom: 34 },
];

export function buildProbePage(devices) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0"><pre id="out">…</pre><script>
const D=${JSON.stringify(devices)};const rows=[];
function mk(w,h){return new Promise(r=>{const f=document.createElement('iframe');
 f.style.cssText='width:'+w+'px;height:'+h+'px;border:0;position:absolute;left:-9999px';
 f.src='/index.html';f.onload=()=>setTimeout(()=>r(f),1500);document.body.appendChild(f)})}

function effectiveVisible(win, el){
  if(!el) return null;
  const r=el.getBoundingClientRect();
  let box={top:r.top,left:r.left,right:r.right,bottom:r.bottom};
  let node=el.parentElement;
  while(node){
    const cs=win.getComputedStyle(node);
    if(/(auto|scroll|hidden|clip)/.test(cs.overflowY+cs.overflowX+cs.overflow)){
      const c=node.getBoundingClientRect();
      box.top=Math.max(box.top,c.top); box.left=Math.max(box.left,c.left);
      box.right=Math.min(box.right,c.right); box.bottom=Math.min(box.bottom,c.bottom);
    }
    node=node.parentElement;
  }
  box.top=Math.max(box.top,0); box.left=Math.max(box.left,0);
  box.right=Math.min(box.right,win.innerWidth); box.bottom=Math.min(box.bottom,win.innerHeight);
  const px=v=>Math.round(v*10)/10;
  return {natH:px(r.height), natW:px(r.width), top:px(r.top), bottom:px(r.bottom),
          visH:px(Math.max(0,box.bottom-box.top)), visW:px(Math.max(0,box.right-box.left))};
}

function flowFootprint(win, el){
  if(!el) return {exists:false, offsetH:0, marginTop:0, marginBottom:0, total:0};
  const cs=win.getComputedStyle(el);
  const gone = cs.display==='none';
  const mt=parseFloat(cs.marginTop)||0, mb=parseFloat(cs.marginBottom)||0;
  return {exists:true, display:cs.display, visibility:cs.visibility,
          offsetH: gone?0:(el.offsetHeight||0),
          marginTop: gone?0:mt, marginBottom: gone?0:mb,
          total: gone?0:((el.offsetHeight||0)+mt+mb)};
}

// 최종 결과(술래 확정 = caseType 'gameOver') 상태를 모델링한다.
// 이 상태에서만 finalResultBtns 가 뜨고 roundResultActions 가 숨는다.
function renderFinalResult(doc, win){
  doc.querySelectorAll('section.card').forEach(x=>x.classList.add('hidden'));
  doc.querySelectorAll('.mini,.sheet-overlay,.popup-overlay').forEach(x=>x.classList.add('hidden'));
  const sec=doc.getElementById('screenRoundResult'); sec.classList.remove('hidden');

  doc.getElementById('resultTitle').textContent='술래 확정!';
  doc.getElementById('resultMessage').textContent='벌칙을 준비하세요.';
  const pb=doc.getElementById('resultPenaltyBox'); if(pb) pb.classList.remove('hidden');
  doc.getElementById('resultPenaltyText').textContent='커피 사기';

  const gp=sec.querySelector('[data-round-progress]');
  if(gp) gp.classList.remove('hidden');
  const list=doc.getElementById('roundResultList');
  if(list) list.innerHTML=['호스트','참가자A','참가자B']
    .map(n=>'<div class="participant"><strong>'+n+'</strong><span class="tag">패</span></div>').join('');

  // gameOver 분기와 동일: 라운드 진행용 버튼은 숨고 finalResultBtns 가 뜬다.
  const actions=doc.getElementById('roundResultActions'); if(actions) actions.style.display='none';
  const fin=doc.getElementById('finalResultBtns');
  if(fin){
    fin.classList.remove('hidden');
    // 실제 렌더러(gameOver 분기)가 만드는 버튼 집합을 그대로 넣는다.
    // ⚠️ 여기 마크업과 렌더러가 어긋나면 계측이 무의미해지므로, 테스트가
    //    finalBtns.innerHTML 생성부를 소스에서 별도로 단언해 둘을 묶는다(RED-A4).
    fin.innerHTML =
      '<button class="btn-success btn-full span-full">한번더</button>'+
      '<button class="btn-light btn-full">게임 승률 보기</button>'+
      '<button class="btn-outline btn-full">게임방에서 나가기</button>';
    // 최종 결과에서는 하단 정적 나가기 행이 중복되므로 숨는다(렌더러 계약과 동일).
    const exitRow=sec.querySelector('.c-foot > .action-grid');
    if(exitRow) exitRow.classList.add('hidden');
  }
  return sec;
}

function renderWaitScreen(doc, win, id){
  doc.querySelectorAll('section.card').forEach(x=>x.classList.add('hidden'));
  doc.querySelectorAll('.mini,.sheet-overlay,.popup-overlay').forEach(x=>x.classList.add('hidden'));
  const sec=doc.getElementById(id); sec.classList.remove('hidden');
  const gp=sec.querySelector('[data-round-progress]');
  if(gp) gp.classList.remove('hidden');
  const pt=doc.getElementById('loserWaitPenaltyText'); if(pt) pt.textContent='커피 사기';
  return sec;
}

(async()=>{for(const d of D){
 for(const view of ['finalResult','winnerWait','loserWait']){
  const f=await mk(d.w,d.h);const doc=f.contentDocument,win=f.contentWindow;
  try{
   const s=doc.createElement('style');
   s.textContent='.app{--safe-top:'+Math.max(18,d.top+8)+'px;--safe-bottom:'+Math.max(18,d.bottom)+'px}';
   doc.head.appendChild(s);
   const sec = view==='finalResult' ? renderFinalResult(doc,win)
             : renderWaitScreen(doc,win, view==='winnerWait'?'screenWinnerWait':'screenLoserWait');
   await new Promise(r=>setTimeout(r,200));

   const px=v=>Math.round(v*10)/10;
   const q=x=>sec.querySelector(x);
   const E=x=>effectiveVisible(win,q(x));
   const app=doc.querySelector('.app');
   const appRect=app.getBoundingClientRect(), cardRect=sec.getBoundingClientRect();
   const foot=sec.querySelector('.c-foot');

   // 하단 버튼들: c-foot 안에서 실제로 보이는 button 을 모아 행(top 좌표) 별로 묶는다.
   const btns=[...foot.querySelectorAll('button')].filter(b=>{
     const cs=win.getComputedStyle(b);
     if(cs.display==='none'||cs.visibility==='hidden') return false;
     if(b.classList.contains('hidden')) return false;
     let p=b.parentElement;
     while(p&&p!==sec){ const pcs=win.getComputedStyle(p);
       if(pcs.display==='none'||p.classList.contains('hidden')) return false; p=p.parentElement; }
     return true;
   }).map(b=>{const r=b.getBoundingClientRect();
     return {text:(b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,20),
             top:px(r.top), h:px(r.height), w:px(r.width)};});

   rows.push(JSON.stringify({dev:d.name,view,w:d.w,h:d.h,
     // ① "게임 종료! 결과를 확인하세요." 안내 배너
     guide: flowFootprint(win, doc.getElementById('roundResultGuide')),
     guideText: (()=>{const el=doc.getElementById('roundResultGuide');
       return el?(el.textContent||'').trim():null;})(),
     // ② 외부 "라운드 결과" heading
     outerHeading: (()=>{const hs=[...sec.querySelectorAll('.c-body > h3')];
       const el=hs.find(h=>/라운드 결과|Round results|ラウンド結果/.test(h.textContent||''));
       return el?flowFootprint(win,el):{exists:false,total:0};})(),
     // ③ 검은 카드 (제목 통합 여부는 텍스트로 본다)
     blackCard: E('[data-round-progress]'),
     blackCardText: (()=>{const el=q('[data-round-progress]');
       return el?(el.textContent||'').replace(/\\s+/g,' ').trim():'';})(),
     // ④ 하단 버튼 행 구성
     buttons: btns,
     // ⑤ 흰 오방색 패널이 바닥까지
     surface:{cardBottom:px(cardRect.bottom), appBottom:px(appRect.bottom),
              viewportH:win.innerHeight, gapToViewport:px(win.innerHeight-cardRect.bottom)},
     saekdong:(()=>{const el=sec.querySelector('.saekdong-v'); if(!el)return null;
       const r=el.getBoundingClientRect(); return {bottom:px(r.bottom)};})(),
     // ⑥ 대기 화면 본문 구성
     hero: (()=>{const el=sec.querySelector('.result-hero'); return el?flowFootprint(win,el):{exists:false,total:0};})(),
     heroText: (()=>{const el=sec.querySelector('.result-hero');
       return el?(el.textContent||'').replace(/\\s+/g,' ').trim():'';})(),
     paras: [...sec.querySelectorAll('.result-hero p')].map(p=>({
       cls:p.className, text:(p.textContent||'').replace(/\\s+/g,' ').trim().slice(0,44),
       h:px(p.getBoundingClientRect().height)})),
     // .c-body 는 설계상 스크롤 컨테이너다(참가자 목록). 넘치는 것 자체는 결함이 아니므로
     // 참고값으로만 남기고, 진짜 계약은 .app 이 넘치지 않는가(화면 밖으로 밀리지 않는가)다.
     bodyOverflow: (()=>{const b=sec.querySelector('.c-body'); return b?b.scrollHeight-b.clientHeight:0;})(),
     appOverflow: app.scrollHeight-app.clientHeight,
     footVisible: (()=>{const r=foot.getBoundingClientRect();
       return {top:px(r.top), bottom:px(r.bottom), withinViewport: r.bottom<=win.innerHeight+1};})(),
   }));
  }catch(e){rows.push(JSON.stringify({dev:d.name,view,err:String(e&&e.message||e)}))}
  f.remove();
 }
}
document.getElementById('out').textContent='RESULTS\\n'+rows.join('\\n')+'\\nEND';})();
</script></body>`;
}
