// 대기실(screenLobby) Host/Participant 역할별 geometry 계측기 (headless Chrome).
//
// ⚠️ 가시성/점유높이 판정에 getBoundingClientRect() 단독 사용 금지.
//    c-head 안의 요소는 조상이 수축해도 rect 가 살아 있어 "차지하고 있다"로 오판한다.
//    → effectiveVisible() 로 모든 overflow 조상과 교집합한 영역만 본다.
//    → "레이아웃 흐름에서 제거됐는가"는 rect 가 아니라 offsetHeight + margin 합으로 본다
//      (visibility:hidden / opacity:0 / 투명 placeholder 는 offsetHeight 가 살아 있어 잡힌다).
//
// 두 역할을 같은 뷰포트에서 각각 렌더해 Y 좌표를 직접 비교한다 — participant 쪽 검은 카드와
// 참가자 목록이 host 보다 **측정 가능하게 위로** 올라와야 한다.

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
  return {natH:px(r.height), top:px(r.top), bottom:px(r.bottom),
          visH:px(Math.max(0,box.bottom-box.top)), visW:px(Math.max(0,box.right-box.left))};
}

// 레이아웃 흐름 점유량: offsetHeight + 상하 margin. display:none 이면 0, visibility:hidden
// 이나 투명 placeholder 면 0 이 아니다 — 사양이 요구한 구분을 이 값 하나로 판정한다.
function flowFootprint(win, el){
  if(!el) return {exists:false, offsetH:0, marginTop:0, marginBottom:0, total:0};
  const cs=win.getComputedStyle(el);
  const mt=parseFloat(cs.marginTop)||0, mb=parseFloat(cs.marginBottom)||0;
  const oh=el.offsetHeight||0;
  const gone = cs.display==='none';
  return {exists:true, display:cs.display, visibility:cs.visibility,
          offsetH: gone?0:oh, marginTop: gone?0:mt, marginBottom: gone?0:mb,
          total: gone?0:(oh+mt+mb)};
}

function renderLobbyAs(doc, win, role){
  doc.querySelectorAll('section.card').forEach(x=>x.classList.add('hidden'));
  doc.querySelectorAll('.mini,.sheet-overlay,.popup-overlay').forEach(x=>x.classList.add('hidden'));
  const sec=doc.getElementById('screenLobby'); sec.classList.remove('hidden');

  // 벌칙 — 실제 대기실은 벌칙이 정해진 뒤 상태가 대부분이다.
  const pen=doc.getElementById('lobbyPenaltyText');
  if(pen) pen.textContent='커피 사기';

  // 술래 숫자 row: host 만 노출. 사양상 participant 는 레이아웃 흐름에서 제거(=display:none).
  // 이 규칙이 renderLobby() 소스와 일치하는지는 테스트가 별도로 단언해 둘을 묶는다.
  const loserBox=doc.getElementById('lobbyLoserCountBox');
  if(loserBox){ if(role==='host') loserBox.classList.remove('hidden');
                else loserBox.classList.add('hidden'); }
  // host 는 "편집 가능한 대기 상태"(isLoserCountEditable()===true)를 모델링한다.
  // 프로브는 앱 내부 state.role 을 설정할 수 없어 앱 초기화가 select 를 disabled 로 둔다 —
  // 그 상태를 그대로 재면 "제품 결함"이 아니라 "프로브가 상태를 못 만든 것"을 재게 된다.
  // 편집 가능 규칙 자체는 테스트가 updateLoserCountDropdown 소스에서 따로 단언한다.
  const sel=doc.getElementById('lobbyLoserCountSelect');
  if(sel && role==='host'){ sel.disabled=false; }

  // 검은 진행 카드 — 로드시 renderRoundProgressCards() 가 방이 없다고 hidden 을 붙여 둔다.
  // 걷지 않으면 높이 0 으로 측정돼 단언이 공허하게 통과한다.
  const gp=sec.querySelector('[data-round-progress]');
  if(gp) gp.classList.remove('hidden');

  // 참가자 목록 3인
  const list=doc.getElementById('lobbyParticipantList');
  if(list) list.innerHTML=['호스트','참가자A','참가자B']
    .map(n=>'<div class="participant"><strong>'+n+'</strong><span class="tag">준비</span></div>').join('');
  const heading=doc.getElementById('lobbyParticipantHeading');
  if(heading) heading.textContent='참여자 목록 (3명)';

  // 하단 버튼: 참가자는 준비 버튼, 호스트는 벌칙 수정까지
  const edit=doc.getElementById('lobbyEditPenaltyBtn');
  if(edit) edit.classList.toggle('hidden', role!=='host');
  return sec;
}

(async()=>{for(const d of D){
 for(const role of ['host','participant']){
  const f=await mk(d.w,d.h);const doc=f.contentDocument,win=f.contentWindow;
  try{
   const s=doc.createElement('style');
   s.textContent='.app{--safe-top:'+Math.max(18,d.top+8)+'px;--safe-bottom:'+Math.max(18,d.bottom)+'px}';
   doc.head.appendChild(s);
   const sec=renderLobbyAs(doc,win,role);
   await new Promise(r=>setTimeout(r,200));

   const app=doc.querySelector('.app');
   const q=x=>sec.querySelector(x);
   const E=x=>effectiveVisible(win,q(x));
   const px=v=>Math.round(v*10)/10;
   const appRect=app.getBoundingClientRect();
   const cardRect=sec.getBoundingClientRect();
   const head=sec.querySelector('.c-head'), body=sec.querySelector('.c-body'), foot=sec.querySelector('.c-foot');

   rows.push(JSON.stringify({dev:d.name,role,w:d.w,h:d.h,
     head:px(head.getBoundingClientRect().height),
     body:px(body.getBoundingClientRect().height),
     bodyOverflow: body.scrollHeight-body.clientHeight,
     foot:px(foot.getBoundingClientRect().height),
     // ① 중복 ID/방코드 row — 제거 대상
     identityRow: (()=>{const el=q('.compact-info-row:not(.compact-penalty-row)');
       return el?flowFootprint(win,el):{exists:false,total:0};})(),
     roomCodeLineEl: !!doc.getElementById('lobbyRoomCodeLine'),
     identityNameEl: !!doc.getElementById('lobbyIdentityName'),
     // ② 술래 숫자 row 점유량
     loserFlow: flowFootprint(win, doc.getElementById('lobbyLoserCountBox')),
     loserVis: E('#lobbyLoserCountBox'),
     selectUsable: (()=>{const s=doc.getElementById('lobbyLoserCountSelect');
       if(!s) return {present:false};
       const cs=win.getComputedStyle(s);
       return {present:true, display:cs.display, disabled:!!s.disabled,
               h:px(s.getBoundingClientRect().height)};})(),
     // ③ 검은 카드 / 참가자 목록 Y 좌표 (역할 간 비교용)
     blackCard: E('[data-round-progress]'),
     blackCardText: (()=>{const el=q('[data-round-progress]'); return el?el.textContent.replace(/\\s+/g,' ').trim():'';})(),
     plist: E('#lobbyParticipantList'),
     heading: E('.c-body h3'),
     penaltyBox: E('#lobbyPenaltyBox'),
     // ④ 흰 오방색 패널이 화면 바닥까지 닿는가
     surface: {cardBottom:px(cardRect.bottom), appBottom:px(appRect.bottom),
               viewportH:win.innerHeight, gapToViewport:px(win.innerHeight-cardRect.bottom)},
     saekdong: (()=>{const el=sec.querySelector('.saekdong-v'); if(!el) return null;
       const r=el.getBoundingClientRect(); return {top:px(r.top),bottom:px(r.bottom),h:px(r.height)};})(),
   }));
  }catch(e){rows.push(JSON.stringify({dev:d.name,role,err:String(e&&e.message||e)}))}
  f.remove();
 }
}
document.getElementById('out').textContent='RESULTS\\n'+rows.join('\\n')+'\\nEND';})();
</script></body>`;
}
