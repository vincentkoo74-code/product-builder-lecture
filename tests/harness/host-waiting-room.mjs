// Host 대기방 geometry 계측기 (headless Chrome).
//
// ⚠️ 가시성 판정에 getBoundingClientRect() 단독 사용 금지.
//    c-body 는 overflow-y:auto 이고 flex 로 높이 0 까지 수축할 수 있다. 높이 0 컨테이너
//    안의 자식도 rect 는 0이 아닌 값을 갖기 때문에, rect 만 보면 "보인다"고 오판한다
//    (실제로 1차 진단에서 참가자 목록을 VISIBLE 로 잘못 읽었다).
//    → 요소 rect 를 **모든 overflow 조상의 client rect 와 순차 교집합**해서
//      실제 화면에 남는 영역(effective visible)을 계산한다.

export const DEVICES = [
  { name: 'iPhone12',    w: 390, h: 844, top: 47, bottom: 34 },
  { name: 'iPhone15/16', w: 393, h: 852, top: 59, bottom: 34 },
  { name: 'iPhone11/XR', w: 414, h: 896, top: 44, bottom: 34 },
];

// 사용자가 실제로 막히는 시점을 재현한다: 방 생성 → 참가자 1명 입장 → 벌칙 설정 →
// host guide/진행 카드까지 렌더된 상태.
export function buildProbePage(devices) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0"><pre id="out">…</pre><script>
const D=${JSON.stringify(devices)};const rows=[];
function mk(w,h){return new Promise(r=>{const f=document.createElement('iframe');
 f.style.cssText='width:'+w+'px;height:'+h+'px;border:0;position:absolute;left:-9999px';
 f.src='/index.html';f.onload=()=>setTimeout(()=>r(f),1500);document.body.appendChild(f)})}

// ── 클리핑 반영 가시 영역 ────────────────────────────────────────────────
function effectiveVisible(win, el){
  if(!el) return null;
  const r=el.getBoundingClientRect();
  let box={top:r.top,left:r.left,right:r.right,bottom:r.bottom};
  let node=el.parentElement;
  while(node){
    const cs=win.getComputedStyle(node);
    const clips=/(auto|scroll|hidden|clip)/.test(cs.overflowY+cs.overflowX+cs.overflow);
    if(clips){
      const c=node.getBoundingClientRect();
      box.top=Math.max(box.top,c.top); box.left=Math.max(box.left,c.left);
      box.right=Math.min(box.right,c.right); box.bottom=Math.min(box.bottom,c.bottom);
    }
    node=node.parentElement;
  }
  const vw=win.innerWidth, vh=win.innerHeight;
  box.top=Math.max(box.top,0); box.left=Math.max(box.left,0);
  box.right=Math.min(box.right,vw); box.bottom=Math.min(box.bottom,vh);
  const h=Math.max(0,box.bottom-box.top), w=Math.max(0,box.right-box.left);
  return {natH:Math.round(r.height*10)/10, natW:Math.round(r.width*10)/10,
          visH:Math.round(h*10)/10, visW:Math.round(w*10)/10,
          hiddenClass: el.classList.contains('hidden')};
}

(async()=>{for(const d of D){
 const f=await mk(d.w,d.h);const doc=f.contentDocument,win=f.contentWindow;
 try{
  const s=doc.createElement('style');
  s.textContent='.app{--safe-top:'+Math.max(18,d.top+8)+'px;--safe-bottom:'+Math.max(18,d.bottom)+'px}';
  doc.head.appendChild(s);
  doc.querySelectorAll('section.card').forEach(x=>x.classList.add('hidden'));
  doc.querySelectorAll('.mini,.sheet-overlay').forEach(x=>x.classList.add('hidden'));
  const sec=doc.getElementById('screenHostRoom'); sec.classList.remove('hidden');

  // ① 방 코드 + QR (실제 렌더러와 동일 크기 — CSS 가 canvas 를 컨테이너 100% 로 강제한다)
  doc.getElementById('roomCodeText').textContent='A7K2';
  doc.getElementById('fakeQr').innerHTML='<canvas width="210" height="210" style="display:block"></canvas>';
  // ② 참가자 1명 입장
  const mkRow=(n,h)=>'<div class="participant"><span>'+n+(h?' (방장)':'')+'</span><span>대기</span></div>';
  doc.getElementById('hostParticipantList').innerHTML=mkRow('host',true)+mkRow('참가자',false);
  // ③ 벌칙 설정 → penaltyStatusBox 노출 + startGameBtn 노출(showHostRoom else-if 분기와 동일)
  doc.getElementById('penaltyStatusBox').classList.remove('hidden');
  doc.getElementById('hostPenaltyText').textContent='커피 사기';
  doc.getElementById('startGameBtn').classList.remove('hidden');
  // ④ host guide / 진행 카드 렌더
  doc.getElementById('hostRoomGuide').textContent='친구가 들어오면 게임을 시작할 수 있어요';
  // 검정 정보창: 실제 렌더러(renderRoundProgressCards)가 대기방에 내는 compact 마크업과
  // 동일한 구조를 넣는다. 테스트가 renderer 소스에서 이 구조를 별도로 단언해 둘을 묶는다.
  const gp=sec.querySelector('[data-round-progress]');
  // ⚠️ 로드 시 renderRoundProgressCards() 가 방이 없다고 판단해 카드에 hidden 을 붙여 둔다.
  //    그걸 걷지 않으면 display:none 이라 높이 0 으로 측정되고, "정보창이 얇아졌다" 류의
  //    단언이 공허하게 통과한다(실제로 한 번 그렇게 통과했다).
  if(gp){ gp.classList.remove('hidden');
    gp.innerHTML='<div class="game-progress-top"><div class="game-progress-round">1 라운드</div>'+
      '<div class="game-progress-rematch">첫 대결</div></div>'+
      '<div class="game-progress-stats">'+
      '<div class="game-progress-stat safe"><strong>0</strong><span>승</span></div>'+
      '<div class="game-progress-stat draw"><strong>0</strong><span>무</span></div>'+
      '<div class="game-progress-stat"><strong>0</strong><span>패</span></div>'+
      '<div class="game-progress-stat loser"><span>술래 1명</span></div></div>'+
      '<div class="game-progress-lock">게임 시작 전 술래 숫자를 변경할 수 있습니다.</div>'; }

  await new Promise(r=>setTimeout(r,200));

  const app=doc.querySelector('.app');
  const head=sec.querySelector('.c-head'), body=sec.querySelector('.c-body'), foot=sec.querySelector('.c-foot');
  const px=v=>Math.round(v*10)/10;
  const q=x=>sec.querySelector(x);
  const E=x=>effectiveVisible(win,q(x));

  rows.push(JSON.stringify({dev:d.name,w:d.w,h:d.h,
    app:px(app.getBoundingClientRect().height), appOverflow:app.scrollHeight-app.clientHeight,
    head:px(head.getBoundingClientRect().height),
    body:px(body.getBoundingClientRect().height),
    bodyReq:body.scrollHeight, bodyOverflow:body.scrollHeight-body.clientHeight,
    foot:px(foot.getBoundingClientRect().height),
    qr:E('#qrInviteBox'), code:E('#roomCodeText'),
    plist:E('#hostParticipantList'), loser:E('#loserCountBox'),
    start:E('#startGameBtn'), penalty:E('#penaltySetBtn'), home:E('.c-foot .btn-outline'),
    // QR 비율 (원형 왜곡 금지)
    qrImg:(()=>{const c=q('#fakeQr canvas'); if(!c)return null;
      const r=c.getBoundingClientRect(); return {w:px(r.width),h:px(r.height)};})(),
    // at-rest 에서 "더 있다"는 단서: 목록 제목이 조금이라도 드러나는가
    heading:E('.c-body h3'),
    // 스크롤로 실제 도달 가능한가 — c-body 를 끝까지 내린 뒤 재측정한다.
    scrolled:(()=>{
      body.scrollTop=body.scrollHeight;
      const r={plist:effectiveVisible(win,q('#hostParticipantList')),
               loser:effectiveVisible(win,q('#loserCountBox')),
               qr:effectiveVisible(win,q('#qrInviteBox'))};
      body.scrollTop=0; return r;})(),
  }));
 }catch(e){rows.push(JSON.stringify({dev:d.name,err:String(e&&e.message||e)}))}
 f.remove();
}
document.getElementById('out').textContent='RESULTS\\n'+rows.join('\\n')+'\\nEND';})();
</script></body>`;
}
