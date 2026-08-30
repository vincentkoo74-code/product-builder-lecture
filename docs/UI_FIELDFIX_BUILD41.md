# Build41 UI 필드픽스 — 원인분석 · 대안 · 수정 · 검증 기록

대상: Build40 필드 QA 이미지 10장 (Google Drive `Maru RPS / RPS-KR-QA`, 2026-08-30).
기준 커밋: `release/kr-build40-qa` @ `1deba2b`(frozen, 무변경) → 작업 브랜치 `dev/kr-build41-ui-fieldfix`.
프로토콜: 원인분석 → 대안(≥2) → 최소 구조 수정 → 적용 검토 → RED→GREEN 계측 → 보고.
계측기: `tests/harness/ui-fieldfix-build41.mjs` (실제 렌더러 호출, 뷰포트 7종), 테스트 `tests/build41-ui-fieldfix.test.mjs`.
원시 계측·스크린샷(증적 vault, 저장소 밖): `~/Documents/Codex/_maru-rps-evidence/Build41-UI-fieldfix/` (geometry-before-build40-1deba2b.json · geometry-after-build41.json · shots/BEFORE|AFTER_*.png).

## 1. 이미지 전수 조사 (Phase 1)

| # | 파일 | 플랫폼 / 뷰포트(dp) | 역할 | 화면 | 증상 | 영향 | 심각도 |
|---|---|---|---|---|---|---|---|
| 1 | IMG_2011.PNG | iPhone 390×844 | 참가자(술래) | screenRoundResult(gameOver·lose) | 검은 "라운드 결과" 카드가 벌칙 박스 아래 ~40px만 보이고 잘림, 참가자 결과 목록 안 보임 | 결과 확인 불가(스크롤 필요, 스크롤 가능함을 알 수 없음) | P1 |
| 2 | IMG_2012.PNG | iPhone 390×844 | 참가자(승) | screenRoundResult(gameOver·win) | 정상. 잠금 문구 제거 확인. c-body 하단 ~250px 빈 공간 | 없음(정보) | – |
| 3 | IMG_2013.PNG | iPhone 390×844 | 참가자 | screenGame(5라운드, 선택 후) | 큰 손 미리보기가 c-head 를 밀어 요약 행(남은 시간/선택/참가자 숫자)이 위가 잘림; QA fab 이 선택 버튼 위에 겹침 | 타이머 판독 불가, QA 버튼 오탭 | P1 |
| 4 | IMG_2014.PNG | iPhone 390×844 | 참가자(술래) | screenRoundResult(lose) | #1 과 동일(다른 게임) — 재현성 확인 | #1 과 동일 | P1 |
| 5 | IMG_2015.PNG | iPhone 390×844 | 참가자 | 내 누적 기록 팝업 | 백엔드 원문 오류 `permission denied for table user_game_stats`; 라벨이 "기록 불러 / 오기 실패"로 2줄 분절 | 기능 실패(백엔드) + 문구 파손 | P1(백엔드) / P2(UI) |
| 6 | Screenshot_20260830_091037.jpg | Android 360×~760 | 호스트(승) | screenRoundResult(win) | 결과 카드 승/무/패 라벨이 c-body fade 에 걸려 반투명·잘림; QA fab 이 "게임방에서 나가기" 위에 겹침 | 결과 판독 저하, 나가기 오탭 | P1 |
| 7 | IMG_2043.JPG | Android 360×~760 | 호스트 | screenReady(round≥2) | 참가자 준비 현황 목록이 ~15px 만 보임; "나가기"+"게임방에서 나가기" 2개; "⚡ 다시한번! 강제 시작" 2줄 | 누가 안 눌렀는지 알 수 없음, 잘못된 나가기(goHome) 노출 | P0/P1 |
| 8 | IMG_2044.JPG | Android 360×~760 | 호스트(승) | screenRoundResult(win) | #6 과 동일 | #6 과 동일 | P1 |
| 9 | IMG_2045.JPG | Android 360×~760 | 호스트 | screenLobby | 정상 | 없음 | – |
| 10 | IMG_2046.JPG | Android 360×~760 | 호스트 | screenWinnerWait | 강제 시작 버튼 2줄; QA fab 겹침. 그 외 정상 | 경미 | P2 |

### 증상 → 코드 추적 (root cause chain)

레이아웃 계약(Build35): `.c-head{flex:0 0 auto}` / `.c-body{flex:1 1 auto;min-height:0;overflow-y:auto; mask 14px}` / `.c-foot{flex:0 0 auto}`.
→ **c-head 는 절대 수축하지 않고, 부족분은 전부 c-body 가 흡수한다.** 따라서 c-head 에 들어간 블록의 높이 합이 곧 c-body 손실이다.

| 증상 | DOM owner | CSS rule | JS/render path | 조건 | root cause |
|---|---|---|---|---|---|
| 결과 카드 잘림 (#1,#4,#6,#8) | `#screenRoundResult .c-head` = `.result-hero`(maru 170/104px + cap + title 42/28px + `.lead` + padding) **+ `#resultPenaltyBox`**(93/70px) | `.result-maru{170px}` / `@media(max-height:700px){104px}`, `.penalty-box{padding:18px;margin:14px 0}`, `.lead{margin-bottom:20px}` | 결과 렌더러가 술래에게 `penaltyBox.classList.remove("hidden")` | 모든 높이 (실측 c-head 334~484px = 뷰포트의 50~62%) | 데이터 블록(벌칙)이 고정 head 에 있음 + hero 가 기기 고정값 |
| 준비 목록 안 보임 (#7) | `#screenReady .c-head` = corner img + cap + sub + `#readyGuide`(47~65) + `#readyPenaltyBox`(45+14) + **`[data-round-progress]`(139+24)** | `.game-progress-card{margin:12px 0}` | `renderRoundProgressCards()` full 변형 | c-head 359~376px (40~59%) + c-foot 5버튼 168~182px → 360×640 에선 c-foot 이 뷰포트 밖(-11px) | 진행 카드(맥락 정보)가 고정 head 에 있음 |
| 요약 행 잘림 (#3) | `#screenGame .c-head` = cap + h2 + sub + guide + **card(139)** + **`#choiceAnim`(120+16)** | `.choice-anim{height:120px;margin-bottom:16px}` | `selectChoice()` 가 `#choiceAnim` 에 96px 손 이미지 삽입 | c-head 455px (50~71%) | 장식(미리보기)+맥락(카드)이 고정 head 에 있음 |
| 나가기 2개 (#7) | `#screenReady .c-foot` | – | `goHome()`(로컬 세션 폐기만, 서버 미통지) vs `leaveRoom()` | 항상 | 의미가 다른 두 출구가 같은 화면에 공존; goHome 은 방에 유령 참가자를 남김 |
| 강제 시작 2줄 (#7,#10) | `.action-grid`(2열 grid) 안의 `#forceStartReplayBtn*` | `.action-grid{grid-template-columns:repeat(2,1fr)}` | `updateActionGridLayouts()` 홀수 보정 | 폭 ≤393 에서 셀 ~150px | 호스트의 주 CTA 가 반폭 셀에 배치 |
| QA fab 겹침 (#3,#6,#8,#10) | `document.body` 직속 `#qaSaveBtn`/복사 버튼 | 인라인 `position:fixed;right:8px;bottom:8/44px;z-index:99999` | QA 계측 활성 시 생성 | 항상 (선택 버튼 13~104px, 나가기 25~41px 겹침) | 하단 고정 = c-foot CTA 영역과 동일 좌표 |
| 팝업 라벨 2줄 (#5) | `#accountStatsBody .participant` | `.participant{display:flex;justify-content:space-between}` | catch 블록의 오류 행 innerHTML | 긴 오류 문자열 | `<strong>` 이 flex 수축으로 57~71px 폭 |
| 42501 (#5) | – | – | `user_game_stats` SELECT grant 미적용(Seoul) | – | 백엔드(별도 트랙, UI 아님) |

### 클러스터

- **RC-A c-head 과성장** (#1 #3 #4 #6 #7 #8): 데이터/맥락/장식 블록이 수축 불가 head 에 있다.
- **RC-B 나가기 중복** (#7): goHome vs leaveRoom.
- **RC-C QA fab 겹침** (#3 #6 #8 #10): QA 빌드 한정.
- **RC-D 팝업 오류 행 레이아웃** (#5).
- **RC-E 42501** (#5): 백엔드 grant — 이 문서 범위 밖(Seoul Dashboard SQL 적용 대기).
- **RC-G 반폭 셀 줄바꿈** (#7 #10).

## 2. 대안 비교 (Phase 2)

| 클러스터 | 대안 | 최소 변경 | 구조적 | 부작용 | 선택 |
|---|---|---|---|---|---|
| RC-A1 결과 | ① 벌칙 박스만 c-body 로 (형태 유지 93px) | ○ | ○ | 360×640/360×780 에서 여전히 카드+벌칙 미수용(실측 부족 16~23px) | ✗ |
| | ② hero 만 축소(벌칙은 head 유지) | ○ | △ | AndTall/iPhone11 외 전부 잘림 유지 | ✗ |
| | ③ **벌칙을 c-body 의 카드 꼬리(한 줄 42px)로 + `.lead` 마진을 hero 가 소유 + hero 이미지 예산 clamp(Home `--home-hero` 선례)** | ○ | ◎ | 720px 미만 기기에서 maru 64~150px 로 축소(정체성 상한 170 유지) | **✓** |
| | ④ 벌칙을 카드 innerHTML 에 병합(렌더러 수정) | △ | ○ | 렌더러/테스트 계약(`#resultPenaltyBox` 토글) 변경, 상태 플래그 필요 | ✗ |
| RC-A2 준비 | ① 카드를 head 에 두고 compact 변형(hostRoom 방식) | ○ | ○ | 전적/재대결 정보 손실, 360×640 에서 목록 1.5행 | ✗ |
| | ② **카드를 c-body 로, 목록 먼저 → 카드** | ○ | ◎ | 카드가 스크롤 아래로(맥락 정보 = 2차) | **✓** |
| RC-A3 플레이 | ① 미리보기 제거 | ○ | △ | 기능(선택 피드백) 삭제 — 콘텐츠 결정 | ✗ |
| | ② **미리보기+카드를 c-body 로(요약 행 → 미리보기 → 카드)** | ○ | ◎ | 작은 기기에서 미리보기가 스크롤 아래 | **✓** |
| RC-B | ① goHome 유지, leaveRoom 제거 | ○ | ✗ | 유령 참가자 잔존 경로만 남음 | ✗ |
| | ② **goHome 버튼 삭제, btn-quiet 를 grid 의 leaveRoom(44px+)로 통합** | ○ | ◎ | 없음(다른 게임 화면과 동일 패턴) | **✓** |
| RC-C | ① z-index 만 낮춤 | ○ | ✗ | 여전히 겹침 | ✗ |
| | ② **topbar 아래 우측 도크(`--device-ui-fade-end`) 로 이동** | ○ | ◎ | hero 우측 상단과 겹칠 수 있음(장식 영역) | **✓** |
| RC-D | ① `<strong>` nowrap | ○ | △ | 긴 메시지가 잘림 | ✗ |
| | ② **오류 행 세로 스택(`.stats-error`)** | ○ | ◎ | 없음 | **✓** |
| RC-G | ① 문구 축약 | ○ | ✗ | 카피 결정, 3 locale | ✗ |
| | ② **강제 시작 = `span-full`(주 CTA 는 전폭: "한번더" 선례)** | ○ | ◎ | 없음 | **✓** |

설계 원칙(적용): **c-head 는 정체성(hero/캡/부제/한 줄 안내)만, 데이터·맥락·장식 블록은 c-body 가 소유하고 핵심 → 맥락 → 장식 순으로 놓는다.** 숫자는 예산에서 유도(`--result-maru`), 기기 하드코딩 없음.

## 3. 변경 목록 (Phase 3, `index.html` 만)

| 태그 | 위치 | 변경 |
|---|---|---|
| E1 | `#screenRoundResult` DOM | `#resultPenaltyBox` 를 c-head → c-body(카드 직후), class `penalty-tail` 추가. id/hidden 토글/텍스트 id 무변경 |
| E1 | CSS `.result-hero` | `--result-maru: clamp(64px, calc(100dvh − safe-top − safe-bottom − 580px), 170px)`; `.result-hero .lead{margin-bottom:0}` |
| E1 | CSS `.result-maru` | `width/height: var(--result-maru)`; `@media(max-height:700px)` 의 104px 고정값 제거(margin 만 유지) |
| E1 | CSS | `#screenRoundResult .penalty-tail{display:flex;…;margin:0 0 var(--action-gap)}` + small/strong inline |
| E2 | `#screenReady` DOM | 진행 카드 c-head → c-body(목록 뒤); goHome "나가기"·btn-quiet 삭제 → grid 의 `leaveRoom` 1개 |
| E2/G | DOM ×3 | `#forceStartReplayBtn{Ready,WinnerWait,LoserWait}` 에 `span-full` |
| E3 | `#screenGame` DOM | `[data-round-progress]`·`#choiceAnim` c-head → c-body(요약 행 뒤: 미리보기 → 카드) |
| E4 | QA fab JS | 두 버튼을 `#qaFabDock`(fixed, `top:var(--device-ui-fade-end)`, 세로 flex) 에 수납. 하단 고정 좌표 제거 |
| E5 | 누적 기록 팝업 | 오류 행 `class="participant stats-error"` + 세로 스택 CSS |

비-UI 로직 diff: **없음** (렌더러·realtime·판정·QA 계측 코드 무변경). 유일한 동작 변화 = screenReady 에서 `goHome()` 진입점 제거(서버에 알리지 않는 퇴장 경로 제거).

## 4. 적용 검토 (Phase 4)

- Host/Participant: 준비 화면 foot — 참가자 `[✋ 준비 | 나가기]` 1행(종전과 동일), 호스트 round≥2 `[⚡ 강제 시작(전폭)] [벌칙 수정 | 나가기]`. `updateActionGridLayouts()` 는 span-full 을 홀짝 계산에서 제외하므로 보정 불필요.
- 결과 화면 렌더러: `penaltyBox` 토글·`resultPenaltyText` 텍스트·`finalBtns.innerHTML` 생성 무변경 → build30-rc2 / build30-phase-e / build35 / build39 계약 유지.
- `renderRoundProgressCards()`: 카드 변형은 `closest("#screenX")` 로 결정 → c-head/c-body 이동에 영향 없음.
- winnerWait/loserWait: 카드 위치 무변경, 강제 시작만 전폭.
- 작은 기기(≤720px 높이): 결과 hero 이미지 64~150px 로 축소. 큰 기기(≥844): 170px 유지.
- 키보드/스크롤: c-body 스크롤 구조 그대로, fade mask 그대로.
- 회귀 테스트 갱신 1건: `build35-layout-contract` 의 btn-quiet 개수 3→2 (screenReady 통합에 따른 구조 핀 갱신, 임계값 하향 아님).

## 5. 계측 (Phase 5) — BEFORE(Build40 `1deba2b`) → AFTER(Build41)

결과(술래) 화면 — 결과 카드 clippedPx / 벌칙 가시 / c-head 점유율

| 기기 | BEFORE 카드 clip | AFTER 카드 clip | BEFORE 벌칙 | AFTER 벌칙 clip | c-head % B→A | maru B→A |
|---|---|---|---|---|---|---|
| iPhone SE 375×667 | 61.7 | **0** | 70/70 | **0** | 50→28 | 104→64 |
| iPhone 11 414×896 | 28.5 | **0** | 93/93 | **0** | 54→38 | 170→170 |
| iPhone 12/13 390×844 | 79.5 | **0** | 93/93 | **0** | 57→41 | 170→170 |
| iPhone 16 393×852 | 83.5 | **0** | 93/93 | **0** | 57→40 | 170→170 |
| Android compact 360×640 | 92.7 | **0** | 70/70 | **0** | 52→29 | 104→64 |
| Android medium 360×780 | 104.5 | **0** | 93/93 | **0** | 62→41 | 170→150 |
| Android tall 412×915 | 0 | **0** | 93/93 | **0** | 53→37 | 170→170 |

준비(호스트, round≥2) — 참가자 목록 가시/전체, 나가기 수, 2줄 버튼

| 기기 | BEFORE 목록 | AFTER 목록 | 나가기 B→A | 2줄 버튼 B→A | c-foot 뷰포트 밖 B→A |
|---|---|---|---|---|---|
| SE | 0/100 | **100/100** | 2→1 | 2→0 | 0→0 |
| 11 | 100/100 | 100/100 | 2→1 | 0→0 | 0→0 |
| 12/13 | 86.6/100 | **100/100** | 2→1 | 2→0 | 0→0 |
| 16 | 100/100 | 100/100 | 2→1 | 2→0 | 0→0 |
| compact | 0/100 | **100/100** | 2→1 | 2→0 | **−11.4px→0** |
| medium | 61.6/100 | **100/100** | 2→1 | 2→0 | 0→0 |
| tall | 100/100 | 100/100 | 2→1 | 0→0 | 0→0 |

플레이(5라운드, 선택 후) — 요약 행 clip / 선택 버튼 3개 온전 / safe overlap

| 기기 | BEFORE 요약 clip | AFTER | BEFORE 선택 버튼 | AFTER | safeOverlap B→A |
|---|---|---|---|---|---|
| SE | 85 | **0** | 뷰포트 밖 | **온전** | 17→0 |
| 11 | 0 | 0 | 온전 | 온전 | 0→0 |
| 12/13 | 11 | **0** | 온전 | 온전 | 0→0 |
| 16 | 15 | **0** | 온전 | 온전 | 0→0 |
| compact | 85 | **0** | 뷰포트 밖(−30px) | **온전** | 48→0 |
| medium | 36 | **0** | 온전 | 온전 | 0→0 |
| tall | 0 | 0 | 온전 | 온전 | 0→0 |

누적 기록 오류 행 라벨: 7기기 모두 2줄 → **1줄**. 터치 타깃 최소: 44→48(준비 foot), 결과 48, 플레이 112.
QA fab: 하단 고정(선택 버튼과 13~104px 겹침) → topbar 아래 도크(c-foot 과 겹침 0).

이미지별 판정: #1 FIXED · #2 (문제 없음) · #3 FIXED · #4 FIXED · #5 UI FIXED / 백엔드 OPEN(RC-E) · #6 FIXED · #7 FIXED · #8 FIXED · #9 (문제 없음) · #10 FIXED.

## 6. 잔여/미해결

- RC-E: `user_game_stats` SELECT grant(Seoul) — `supabase/migrations/20260824021500_account_game_stats_grants.sql` Dashboard 적용 대기. 오류 원문 노출은 grant 적용으로 사라짐(문구 자체는 i18n `account.loadFailed` 유지).
- 360×640 결과(술래): 벌칙 꼬리 하단이 c-body 가장자리 9px 위 — 텍스트 자체는 fade(14px) 밖(18px 위)이라 판독 영향 없음.
- Android 런처 아이콘(KR-ANDROID-LAUNCHER-ICON): 별도 백로그.
