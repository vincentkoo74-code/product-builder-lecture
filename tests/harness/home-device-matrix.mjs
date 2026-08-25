// Home 화면 device matrix geometry 측정기 (headless Chrome).
//
// ⚠️ 함정 1 — iframe에서는 env(safe-area-inset-*)가 전부 0이고 오버라이드가 불가능하다.
//    Build37 B5 이후 앱은 env()를 .app 에서 한 번만 해석해 --safe-top / --safe-bottom 으로
//    내려보낸다. padding, 하단 mask fade, Home hero 크기가 모두 이 두 변수에서 파생되므로
//    계측기는 이 둘만 주입하면 실기기 조건이 그대로 재현된다.
//    (B5 이전에는 소비처마다 env()를 각자 읽어서, 하나라도 빼먹으면 결과가 낙관적으로
//     왜곡됐다 — 실제로 hero를 304px로 쟀다. 실기기 값은 223px이었다.)
//
// ⚠️ 함정 2 — showScreen/hideAllScreens는 window에 export되어 있지 않다.
//    screenHome의 hidden만 제거하면 screenAuth 등 다른 카드가 함께 보인 채로 측정된다
//    (.card:not(.hidden){flex:1 1 auto} → 세로 예산이 통째로 달라진다).
//    반드시 DOM으로 모든 section.card를 hidden 처리한 뒤 Home만 노출한다.
//
// ⚠️ 함정 3 — ?lang=은 localStorage에 쓴 뒤 detectLocale()을 거친다.
//    적용 여부를 확인하지 않으면 en/ja 행이 ko의 복사본이 되어 공허해진다.
//    측정 결과에 locale 증거 문자열(probeText)을 실어 테스트가 검증한다.

export const DEVICES = [
  // top/bottom = 실기기 safe-area-inset (CSS px)
  { name: 'SE1',         w: 320, h: 568, top: 20, bottom: 0,  kind: 'none'    },
  { name: 'SE3',         w: 375, h: 667, top: 20, bottom: 0,  kind: 'none'    },
  { name: 'iPhone11/XR', w: 414, h: 896, top: 44, bottom: 34, kind: 'notch'   },
  { name: 'iPhone12',    w: 390, h: 844, top: 47, bottom: 34, kind: 'notch'   },
  { name: 'iPhone15/16', w: 393, h: 852, top: 59, bottom: 34, kind: 'island'  },
  { name: '16ProMax',    w: 440, h: 956, top: 62, bottom: 34, kind: 'island'  },
];

export const LOCALES = ['ko', 'en', 'ja'];

// A5 계약: Home 핵심 기능 7종. 각 항목은 첫 viewport 안에서 온전히 보여야 한다.
export const CORE = [
  { key: 'hero',       label: 'Maru hero',          sel: '.maru-hero img',                    tap: false },
  { key: 'nickname',   label: '닉네임/사용자',        sel: '#homeNicknameChip',                 tap: true  },
  { key: 'recentRoom', label: '이전 참가 방 재입장',   sel: '.quick-row .quick-btn:nth-child(1)', tap: true },
  { key: 'lastResult', label: '이전 게임 결과',       sel: '.quick-row .quick-btn:nth-child(2)', tap: true },
  { key: 'myStats',    label: '내 기록/내 전적',      sel: '.quick-row .quick-btn:nth-child(3)', tap: true },
  { key: 'createRoom', label: '방 만들기/호스트 시작', sel: '.c-foot .btn-kparty',               tap: true  },
  { key: 'qrJoin',     label: 'QR 입장',             sel: '.c-foot .btn-light.btn-full',       tap: true  },
];

export function buildProbePage(devices, locales, core) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0"><pre id="out">…</pre><script>
const DEVICES=${JSON.stringify(devices)},LOCALES=${JSON.stringify(locales)},CORE=${JSON.stringify(core)};
const rows=[];

function mk(loc,w,h){return new Promise(r=>{
  try{localStorage.setItem('rpsLocale',loc);}catch(e){}
  const f=document.createElement('iframe');
  f.style.cssText='width:'+w+'px;height:'+h+'px;border:0;position:absolute;left:-9999px;top:0';
  f.src='/index.html?lang='+loc;
  f.onload=()=>setTimeout(()=>r(f),1600);
  document.body.appendChild(f);});}

// 실기기 safe-area 재현 — 주입 지점은 --safe-top / --safe-bottom 단 하나다.
// padding / mask fade / hero 크기는 앱 CSS가 이 둘에서 파생시킨다.
function injectSafeArea(d,dev){
  const padT=Math.max(18,dev.top+8), padB=Math.max(18,dev.bottom);
  const s=d.createElement('style');
  s.id='a5-safearea';
  s.textContent='.app{--safe-top:'+padT+'px;--safe-bottom:'+padB+'px}';
  d.head.appendChild(s);
  return {padT:padT,padB:padB,fade:Math.max(38,padB+4)};
}

// export되지 않은 showScreen을 DOM으로 대체한다.
function showHomeOnly(d){
  d.querySelectorAll('section.card').forEach(s=>s.classList.add('hidden'));
  d.querySelectorAll('.mini,.popup,.sheet-overlay').forEach(s=>s.classList.add('hidden'));
  d.getElementById('screenHome').classList.remove('hidden');
}

function px(v){return Math.round(v*10)/10;}

(async()=>{
 for(const dev of DEVICES){for(const loc of LOCALES){for(const safe of [true,false]){
  let f=null;
  try{
   f=await mk(loc,dev.w,dev.h);
   const d=f.contentDocument,win=f.contentWindow;
   if(!d||!d.getElementById('screenHome')){rows.push(JSON.stringify({dev:dev.name,loc,safe,err:'LOADFAIL'}));f.remove();continue;}
   const geom = safe?injectSafeArea(d,dev):{padT:18,padB:18,fade:Math.max(38,18+4)};
   if(win.setLocale) win.setLocale(loc);
   showHomeOnly(d);
   if(win.syncSettingsUi) win.syncSettingsUi();
   await new Promise(r=>setTimeout(r,180));

   const sec=d.getElementById('screenHome');
   const app=d.querySelector('.app');
   const body=sec.querySelector('.c-body');
   const ab=app.getBoundingClientRect(), bb=body.getBoundingClientRect();

   // .app 하단 mask fade가 시작되는 y (이 아래는 실기기에서 흐려진다)
   const fadeY = ab.top + ab.height - geom.fade;
   // c-body 자체 mask fade (14px)
   const BODY_FADE = 14;

   // mask alpha 모델 — 두 mask가 곱해진다.
   //   .app  : #000 0 → #000 (H - fadePx) → transparent H
   //   .c-body: #000 0 → #000 (H - 14px)  → transparent H
   // 요소 하단 edge에서의 alpha가 그 요소의 최악 가시도다.
   function alphaAt(y, boxTop, boxH, fadeLen){
     const start = boxTop + boxH - fadeLen;
     if(y <= start) return 1;
     if(y >= boxTop + boxH) return 0;
     return 1 - (y - start) / fadeLen;
   }

   const items={}, clipped=[], faded=[], dim=[], smallTap=[], tiny=[];
   for(const c of CORE){
     const el=sec.querySelector(c.sel);
     if(!el){items[c.key]={missing:true};clipped.push(c.key+':MISSING');continue;}
     const r=el.getBoundingClientRect();
     const inBody = body.contains(el);
     // 하드 클리핑 한계: c-body 안이면 c-body 가시영역, 밖이면 app 가시영역
     const hardBottom = inBody ? Math.min(bb.bottom, ab.bottom) : ab.bottom;
     const cs=win.getComputedStyle(el);
     const rec={
       top:px(r.top),bottom:px(r.bottom),h:px(r.height),w:px(r.width),
       inBody:inBody,font:parseFloat(cs.fontSize)||0,
     };
     const over=px(r.bottom-hardBottom);
     const aApp = alphaAt(r.bottom, ab.top, ab.height, geom.fade);
     const aBody = inBody ? alphaAt(r.bottom, bb.top, bb.height, BODY_FADE) : 1;
     const aMin = Math.round(Math.min(aApp, aBody)*100)/100;
     rec.alpha = aMin;
     if(over>0.5){ rec.clipped=over; clipped.push(c.key+':'+over); }
     if(aMin < 0.80) faded.push(c.key+':a'+aMin);      // 눈에 띄게 흐려짐 → 계약 위반
     else if(aMin < 1) dim.push(c.key+':a'+aMin);      // 경미한 감쇠 → 증적만
     if(c.tap&&r.height>0&&r.height<44) smallTap.push(c.key+':'+px(r.height));
     if(c.tap&&rec.font>0&&rec.font<11) tiny.push(c.key+':'+rec.font);
     items[c.key]=rec;
   }

   const heroImg=sec.querySelector('.maru-hero img');
   const hr=heroImg?heroImg.getBoundingClientRect():{width:0,height:0};
   const qi=sec.querySelector('.quick-row .quick-btn .icon');
   const ql=sec.querySelector('.quick-row .quick-btn span:last-child');
   const probeText=(sec.querySelector('[data-i18n="home.quickJoin"]')||{}).textContent||'';

   rows.push(JSON.stringify({
     dev:dev.name,loc,safe,w:dev.w,h:dev.h,kind:dev.kind,
     safeTop:safe?dev.top:0, safeBottom:safe?dev.bottom:0,
     padT:geom.padT,padB:geom.padB,fadePx:geom.fade,
     hero:px(hr.height), heroW:px(hr.width),
     heroRatio: hr.height?px(hr.width/hr.height):0,
     avail:px(bb.height), required:body.scrollHeight,
     overflow:body.scrollHeight-body.clientHeight,
     appOverflow:app.scrollHeight-app.clientHeight,
     iconFont: qi?parseFloat(win.getComputedStyle(qi).fontSize):0,
     labelFont: ql?parseFloat(win.getComputedStyle(ql).fontSize):0,
     probeText:probeText.trim().slice(0,24),
     clipped:clipped, faded:faded, dim:dim, smallTap:smallTap, tiny:tiny,
     items:items,
   }));
  }catch(e){rows.push(JSON.stringify({dev:dev.name,loc,safe,err:String(e&&e.message||e)}));}
  if(f) f.remove();
 }}}
 // ── hero 연속성 스윕 ──────────────────────────────────────────────────
 // 기기 6종 표본만으로는 연속 함수도 계단처럼 보인다(647→759처럼 표본 사이가 112px 비어 있다).
 // 폭·safe-area를 고정하고 높이만 10px씩 훑어 hero 함수 자체의 인접 점프를 잰다.
 for(let h=560;h<=960;h+=10){
  const f=await mk('ko',393,h); const d=f.contentDocument;
  if(d&&d.getElementById('screenHome')){
   injectSafeArea(d,{top:47,bottom:34});
   showHomeOnly(d);
   await new Promise(r=>setTimeout(r,40));
   const img=d.getElementById('screenHome').querySelector('.maru-hero img');
   rows.push(JSON.stringify({sweep:true,h:h,hero:px(img.getBoundingClientRect().height)}));
  } else rows.push(JSON.stringify({sweep:true,h:h,err:'LOADFAIL'}));
  f.remove();
 }
 document.getElementById('out').textContent='RESULTS\\n'+rows.join('\\n')+'\\nEND';
})();
</script></body>`;
}
