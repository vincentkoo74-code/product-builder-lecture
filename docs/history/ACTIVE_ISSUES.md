# 🔴 ACTIVE ISSUES — 현재 살아있는 문제만

> **닫히지 않은 문제만** 우선순위별로 관리한다. 해결되면 이 문서에서 제거하고 `BUG_MASTER_LEDGER.md`에 `현재 상태=해결`로 기록한다.
> 기준 코드: `fix/build6-regression-recovery` (= build8) · 갱신: 2026-06-28 (**Build8.4** 코드 수정 — 한국어 음성 실기기 QA 결과)

집계: **P0 0건 · P1 2건 · P2 2건 · P3 2건** (총 6건 미해결) · Build8.2(042/043)·8.3(044)·**8.4(045/046/047/048)** 코드 수정(실기기 재검증 대기)

> ✅ **실기기 PASS 종결(Build8.1)**: WRPS-014(참가자 TTS) · WRPS-015(카운트다운 동기화) — 단 **WRPS-015는 음성팩 적용 후 재발 → WRPS-047(Build8.4)로 추적**.
> ✅ **Build8.4 코드 수정(실기기 재검증 대기)**: WRPS-047(P0 카운트다운 동기화 회귀) · WRPS-045/046(음성) · WRPS-048(버튼음). codex-critic 재검토 PASS, npm test 49/49.
> 📦 **TestFlight**: **Build8.4 = build 13 업로드 완료**(2026-06-28, Delivery UUID `f99e8308-…`, Processing VALID). Export 자동증가로 archive 10→IPA 13. (이전 Build8.3=build 9)

---

## ✅ Build8.4 코드 수정 완료 (한국어 음성 실기기 QA 결과 · 실기기 재검증 대기)

### WRPS-047 (P0) — 멀티단말 카운트다운 비동기 시작 → 보강 [회귀: WRPS-015 회차3]
- **원인**: HTTP `Date` 헤더 초단위 floor로 기기간 clock offset 최대 ~1s 오차 + realtime late-arrival 시 즉시 시작.
- **수정(`db0d16a`)**: `syncServerClock` +500ms 중앙보정·샘플 3→5, `getNextCountdownStartAt` lead 2800→3600ms, `runCountdown` sleep 캡 3000→4000. 판정/Firebase 무변경.
- **잔여**: 런타임 특성상 단위테스트 불가 → **실기기 멀티디바이스 매트릭스(BUILD4_P0_QA_MATRIX) 재검증 필수**. 닫기 전 NO-GO.

### WRPS-045 (P1) — 한국어 MC음성/TTS 혼재 → 수정
- `go`("가위바위보") 등 매핑 공백이 TTS 폴백 → intro(MC)와 혼재. `VOICE_SILENT` 센티넬로 `ko.go` 무음(풀구호 ko_game_start.mp3가 커버). MP3 이벤트는 speechSynthesis 미사용 보장. (`baebae2`)

### WRPS-046 (P1) — 게임 결과 음성 2회 재생 → 수정
- `finishRoundLocal` result→game_over 2회 호출 시 결과음성 무가드. `playResultVoiceOnce`(키=gameRound:round)로 1회. 새 게임/방 경계 3곳서 키 초기화. (`8c8bc1d`)

### WRPS-048 (P2) — 버튼 효과음 개선
- `playButtonClickSound` 합성음 재설계(sine 280→140Hz·lowpass·50ms) + 45ms 연타 디바운스. 음성과 별도 AudioContext. (`51d5c6a`)

---

## ✅ Build8.1 코드 수정 완료 (실기기 검증 대기 — 닫기 전 RELEASE_QA_CHECKLIST 3절 통과 필요)

- **WRPS-013** (구 P0) 재초대 수락 대기화면 고착 → `acceptInvite()` ready-aware 분기 + `fetchParticipants` 안전망(WRPS-018).
- **WRPS-014** (구 P1) 참가자 TTS 미재생 → `markReady()` 제스처 언락(빈 발화) 추가.
- **WRPS-018** (구 P2) participantWait 고착 복구 안전망 → `fetchParticipants` 3초 폴링 복구 추가.
- **WRPS-041** (구 P2) 자동시작 문서 드리프트 → `GAME_LOGIC.md` 정정.
> 위 4건은 **코드/문서상 수정 완료**이나, 실기기 멀티디바이스 검증 통과 전까지 `BUG_MASTER_LEDGER`에서 완전 종결(closed)하지 않는다.

---

## 🟥 P0 — 릴리즈 차단 (Release Blocker)

- **현재 없음.** (WRPS-013 Build8.1에서 수정, 실기기 검증 대기로 전환)

---

## ✅ Build8.2 코드 수정 완료 (실기기 재검증 대기)

### WRPS-043 — 3인 게임 술래 2명 선택 불가 → 수정
- **원인**: `getMaxLoserCount`가 `(비호스트 수)−1`. 호스트 포함 3명 = 비호스트 2명 → 최대 1로 고정.
- **수정(Model P)**: 호스트도 플레이어 → `getMaxLoserCount = 전체 참가자 − 1`(`maxLoserCountFor`). `computePlayerStatuses` 호스트 특례 제거로 판정·소거에 호스트 포함 → 3명 술래 2 = 2술래+1승자(deadlock 없음). vitest 44 통과.

### WRPS-042 — 전원 Ready 시작 트리거 통일 → 수정
- `showReadyScreen`/`renderLobby` 호스트도 게임 준비 버튼 사용, `hostStartBtn`/`lobbyHostStartBtn` 폐지(숨김). 활성 전원(호스트 포함) ready 시 마지막 ready가 자동 시작.
- **잔여**: 호스트룸 초기 `startGameBtn`(setup→ready 진입)은 유지 — 게임 판정 무관, 후속 통일 검토.

> 위 2건 + WRPS-014/015(실기기 PASS)는 Build8.2 빌드로 실기기 재검증 후 최종 종결.

---

## ✅ Build8.3 코드 수정 완료 (실기기 재검증 대기)

### WRPS-044 — 호스트 승계 후 참가자 목록/HOST stale → 수정
- **확정**: Case A(DB 정상/UI 비정상) — Supabase REST 제어 테스트로 쓰기/RLS 정상·승계 후 DB 2행 정확 확인.
- **수정**: ① rooms realtime 리스너에 `scheduleFetchParticipants` 추가(방 변경=호스트 승계 시 확실히 발화) ② `handleRoomUpdate` 상태 전이 시 강제 재조회. 전체 재조회 → `state.participants` 교체 → `renderAll`(목록/HOST 배지 재계산)로 stale 제거. realtime participant DELETE 의존 제거.
- **원칙 준수**: DB 스키마/RLS/REPLICA IDENTITY/판정/Firebase 무변경. 기존 5s 폴링·realtime 유지(`scheduleFetchParticipants` 디바운스 재사용). 테스트 49 통과(WRPS-044 5건 신규).

---

## 🟧 P1 — 주요 (Major)

### WRPS-015 — 카운트다운 기기간 시차 → **실기기 PASS(Build8.1)**
- 2026-06-22 TestFlight 실기기에서 동기화 정상 확인 → **종결**. (late-arrival 보정 코드 미적용이나 실사용 문제 없음 확인)

### WRPS-026 — 3인 호스트 빠짐 판정 프리즈 (실기기 미검증)
- **코드**: `startHostJudgeBackstop`(6362)로 `getCountdownStartAt()+11s` 백스톱 보장 — 로직 존재.
- **갭**: 런타임 동작이라 단위테스트 불가. **호스트가 우선안전/술래로 빠지는 재대결** 실기기 멀티디바이스 검증 미완(OPEN-01).
- **상태**: 🟡 코드 반영 · 실기기 검증 필수

### WRPS-036 — 다인전(3/4/5) 멀티디바이스 동기화 매트릭스 미완
- **갭**: `BUILD4_P0_QA_MATRIX` 9조합×6동작=54셀 실기기 결과 빈칸. 로직(소거/술래상한)은 단위테스트 통과하나 실시간 기기간 동기화 미검증.
- **상태**: 🟡 로직 OK · 실기기 매트릭스 미수행

### WRPS-037 — 자동 시작 stale-state 오발화 위험 (+ 문서 불일치)
- **현황**: `triggerReplayIfLastReady`(7879)가 활성 전원 ready 시 호스트 권위로 `startGame()` 자동 호출(Build4 정식 사양). `autoStartInFlight` 가드 있음.
- **위험**: 재대결 직후 폴링이 stale `is_ready/choice`를 덮어쓰면 `areAllActivePlayersReady()` 오판 → 조기/오발화 가능. Lineage A의 stale 정규화(WRPS-016/017)가 부분대체만 됨.
- **상태**: 🟡 설계상 의도 동작 · 경쟁조건 보강 검토 필요 · (문서 불일치 WRPS-041은 Build8.1에서 해소)

---

## 🟨 P2 — 부차 (Minor)

### WRPS-020 — 참가자 목록 표시 지연/깜빡임
- 실시간 INSERT 즉시 병합(`355a656`) 미반영 → 폴링 재조회 의존(최대 3초 지연/깜빡임).

### WRPS-034 — 영어/일어 모드 토스트 한글 하드코딩 잔존 (OPEN-02)
- 게임/역할 문구는 i18n화됐으나 토스트류 일부 한글 노출.

> ✅ WRPS-018(고착 안전망), WRPS-041(문서 드리프트)는 Build8.1에서 수정 완료 → 상단 "Build8.1 코드 수정 완료" 참조.

---

## 🟦 P3 — 개선/기능 (Low)

### WRPS-019 — 드롭된 참가자 ready/reinviting 상태 정리(gracePeriod) 미반영
### WRPS-021 — 대기실 1분 무조작 자동 로그아웃 [기능] 미도입

---

## 검증 게이트 요약 (릴리즈 전 반드시 실기기로 닫아야 할 것)
1. WRPS-013 재초대 수락 고착 — **Build8.1 수정됨**, 실기기 재현 검증 필요
2. WRPS-014 참가자 TTS — **Build8.1 수정됨**, iOS 실기기 검증 필요
3. WRPS-026 호스트 빠짐 프리즈 (P1) — 코드 OK, 실기기 미검증
4. WRPS-036 멀티디바이스 매트릭스 54셀 (P1) — 미수행

## Build16 Device QA — OPEN (Triage 완료, Fix 미착수) 2026-07-01
> 원장: `docs/BUILD16_QA_PLAN.md`. Critical 10 + Evidence-gated 4 → Release NOT READY.
- **Critical(코드 Root Cause 확정)**: WRPS-053(UI권한), 054(invite), 055(join/leave audio), 056(room lifecycle), 061(결과화면 고착), 062(다중술래), 063(viewport)
- **Critical(Evidence-gated, build15 계측 선행)**: WRPS-058/059/060/064(sync drift·지연)
- **High**: WRPS-050(oauth), 051/052/057(audio), 065(QR), 066(닉네임), 067(직전결과)
- **Medium/Low(Build16 제외 polish)**: WRPS-068/069/070/071

## Build16 (build 16) — 반영 상태 (2026-07-01)
**Fixed & pushed (test+codex-critic 검증)**:
- WRPS-063 viewport lock (c920c08) · WRPS-053 lobby UI 권한 (3b63527)
- WRPS-056 session 기록 분리 + 1인 방 destroy (b55b5c5, critic 4R 종결)
- WRPS-061 결과화면 고착 백스톱 (8d6e829) · WRPS-054 invite dedup lifecycle (78a0401)

**Evidence-gated (build16 실기기 QA 후 착수 — 추측 수정 금지/DR-10)**:
- WRPS-062 다중술래 전체재게임 오전환 (finishRoundLocal 코드결함 미발견 → 런타임 Evidence 필요)
- WRPS-058 선택타이머 drift · WRPS-059 결과전환 drift · WRPS-060 6R 지연급증 · WRPS-064 Zero Doubt 집합

**미착수 (다음 코드 세션)**: WRPS-050 oauth restore, 066 닉네임, 065 QR, 051/052/055/057 audio, 067/068.

## Build17 Device QA — 1차 결과 (2026-07-07)
> Evidence: `qa-report-build17-2026-07-07-05-28-37.json` (build 17 VALID, commit `552973d`, release_mode qa-testflight). Persistence 목적은 달성, 게임 판정 Critical/High 신호 없음. 아래 3건은 **QA persistence와 분리**해 별도 관리.

- ✅ **Build17 QA persistence/export — PASS(1차)**: 새 세션 `4075ozeq`가 이전 세션 `gjrjs280`(roomId QNWB, participant, 523s, metrics 57, exportReason `background`)을 `QA_SESSION_RECOVERED`로 복구. 앱 background/종료 후에도 QA 기록 생존 확인. 수동 `QA💾` export도 동작. **게임 판정**: shadow 21/21 match, orderingMismatch 0, staleParticipant 0, hostChanged 0 → 판정 로직 Critical/High 없음.

### WRPS-052 (High) — VOICE audioMissing 22건 [audio 클러스터] → **Build18 수정 후 Build19 TTS override 추가(둘 다 실기기 재검증 대기)**
- **Build19 추가(WRPS-052-B19)**: Build18 필드QA에서 audioMissing=0 달성했으나 audioFallback 다수 확인(음성은 나오되 fallback 경유). 음성 문구 자체에 대한 재확인 요청 후 `TTS_OVERRIDE`로 intro(ko) 1건만 mp3보다 우선 처리(speechSynthesis, "안 내면 술래 가위바위보!!" 고정). commit `7eba7ed`. **DR-6 예외 명시 + Evidence-gated**(`docs/VOICE_QA_CHECKLIST.md` 6번 항목 — 실기기 가청 확인 전까지 미종결, `audioPlayed:true`가 실제 청취와 일치하는지 대조 필수).
- **정정(2026-07-08)**: 실기기에서 "기계음(TTS)만 들리고 MC 목소리가 아님" 보고 → whisper 전사로 `ASSETS/rps/voice/ko/` 14개 파일 전수 확인. `ko_game_start.mp3`는 실제로 **"게임을 시작합니다."**(풀구호 아님 — 06-26/28 청취 기록이 오류였음)이고, **"가위바위보" 문구를 담은 사람 목소리 파일이 애초에 존재하지 않음**을 확정. TTS_OVERRIDE는 회귀가 아니라 유일한 정확 수단이었음. **사용자 결정: 신규 MC 녹음 준비될 때까지 TTS 유지**(보류). → **신규 backlog: "안 내면 술래 가위바위보!!" MC 성우 재녹음 필요**(성우 섭외/녹음, 코드 작업 아님).
- **Build18 수정**: HTMLAudioElement fallback(`playVoiceFallback`, decode 실패 시 네이티브 미디어 경로) + 진단 필드(`loadError.stage` fetch/http/decode). commit `bcb12e1`, codex-critic 2R PASS, TestFlight build18 VALID(`ce369251-...`). **Evidence-gated**: 실기기 QA로 intro/gameOver/becameLoser 실재생 + `loadError.stage` 분포 확인 전까지 닫지 않음(DR-10).
- **관찰**: 이전 세션 VOICE 22건 전부 `audioMissing=true` (intro 11 / gameOver 6 / becameLoser 5). ko 음성팩(참가자) 기준.
- **코드 지점(무변경, 조사용)**: 두 emit 경로 존재 — `index.html:9044`(WRPS-052: 디코드 버퍼 null → `audioMissing:true`) 와 `index.html:9030`(WRPS-051: clipPath falsy → `audioMissing:!!CLIPS[locale]`, **플래그 의미 혼동 주의**).
- **Root Cause 후보(확정 전)**: (a) Capacitor iOS WebView에서 음성 asset fetch/decode 실패로 buffer 미로딩(가장 유력), (b) clip 경로 누락, (c) QA-OFF/ON 조건 분기. **추측 수정 금지(DR-10)** — 원시 레코드의 `wrps`/`audioKey`/`src` 필드로 경로 확정 후 착수. audio 클러스터(051/052/055/057, [[rps-design-rules]] Audio DR) 연계.

### WRPS-072 (P2→High 재평가) — ROUND_RESULT QA metric 중복 기록 [instrumentation→**host 데이터레이스로 확정**] → **Build19 표적 수정(실기기 재검증 대기)**
- **Build19 확정(WRPS-072-B19)**: Build18 실기기 필드QA(host vs participant JSON 직접 대조)로 원인 확정 — instrumentation 중복이 아니라 **host 자신의 참가자 row가 판정 시점에 최신이 아닌 데이터레이스**. host ROUND_RESULT 39건 중 13건(33%) resultValue:null(participant는 38건 중 0건), 같은 room·같은 eventId("4:1")가 18초 간격으로 다른 outcome(tooFew→tooMany)으로 재분류된 사례 확인. 판정 알고리즘(`resolveElimination`) 자체는 정확함(기존 37개 테스트로 검증). 수정: `fetchFreshParticipantsForResult()`(재조회 재시도, 최대 2×300ms) + `finishRoundLocal()` idempotency 가드(`state.lastRoundResolution`, 동일 round 재계산 금지). commit `f5bb308`, codex-critic 2R PASS. **Evidence-gated**: 실기기 QA로 host resultValue:null 재발 여부 + 동일 eventId 재분류 재발 여부 확인 전까지 닫지 않음.
- **Build18 수정**: `state.resultMetricKey`(WRPS-046 패턴 재사용, 새 방/게임/세션 리셋 지점에서 초기화)로 eventId당 1회 가드. commit `bcb12e1`, codex-critic 2R PASS(1R에서 세션전역 Set 방식의 새 방 라운드1 누락 HIGH 발견→수정). **Evidence-gated**: 실기기 QA로 ROUND_RESULT unique eventId 일치 확인 전까지 닫지 않음.
- **관찰**: ROUND_RESULT 21건 / unique eventId 11 (라운드 1~7,9~11 각 2회, 8 1회). shadowMatch/ordering 정상이라 **판정·DB 커밋 중복 아님**.
- **메커니즘(코드 정독)**: 유일 emit `index.html:7429`(`__engineV2ShadowCompare` 내부). 단일 `finishRoundLocal` 호출당 compare는 1회만 발화(각 분기 return 또는 fall-through 6848 1회). 따라서 **`finishRoundLocal`이 동일 round에 대해 클라이언트에서 ~2회 실행**(낙관적 로컬 resolve + 호스트 결과 apply, 또는 realtime 재수신)되어 매번 compute+compare→metric 재발화한 것으로 판단.
- **조치(향후, Build17 무변경)**: eventId seen-set으로 ROUND_RESULT emit dedupe + `finishRoundLocal` 동일 round 재진입 가드 조사. **finishRoundLocal 영역이라 [[WRPS-062]] 다중술래 오전환과 인접** — 이중호출 경로가 062 Evidence일 수 있어 교차확인. Critical 확대 금지(우선 instrumentation로 관리).

## Build19 — RC 아님, 잔여 리스크 4건(실기기 QA 대기) — 2026-07-08
> **상태: 실기기 QA 대기.** TestFlight build19 VALID(Delivery UUID `a133d610-9e50-40ec-ab2d-594e97730b5b`)는 업로드/설치 가능 상태일 뿐, 아래 4건이 실기기에서 확인되어야 RC로 확정한다(DR-10). 상세는 `QA_STATUS.md` Build19 절 / `docs/history/REGRESSION_TRACKER.md` Build19 절 참조.

1. **intro TTS 실제 가청 여부**(WRPS-052-B19) — `onend`는 발화 완주만 보장, 무음 가능성 있음. (2026-07-08: TTS 자체는 실기기에서 소리는 남을 확인함 — 사용자가 "기계음"이라 표현. 사람 MC 목소리 녹음 부재가 확정되어 신규 녹음 대기로 전환, 별도 backlog.)
2. **다기기 동기화 gap**(WRPS-SYNC-B19) — `scripts/analyze-qa-sync.mjs` 코드 완성, 실측 데이터 없음.
3. **host 데이터 레이스 재발**(WRPS-072-B19) — 재시도 예산(600ms) 초과 시 여전히 발생 가능.
4. **`resolveElimination()` 미호출**(구조적, Build19 미착수) — `finishRoundLocal`의 손 중복구현과 조건 일치는 확인됐으나 향후 drift 위험.

### WRPS-073 (P3, 신규) — countdownDriftMs 의미/명명 재검토 [metric semantics]
- **관찰**: COUNTDOWN_START 11건, countdownDriftAvgMs ≈ -2469ms(−2987~−1506), waitMs 1506~2988ms. 체감 카운트다운 정상.
- **정의(코드)**: `index.html:6418` `countdownDriftMs = scheduledStartAt ? (serverNow() - scheduledStartAt) : null`, `waitMs = max(0, scheduledStartAt - serverNow())`. 즉 클라가 예정시각보다 **먼저 이벤트 수신 후 대기**하는 설계라 음수는 정상(= −waitMs). **실제 drift가 아니라 scheduled lead**.
- **조치(향후)**: 명칭을 `scheduledLeadMs` 또는 `countdownWaitDeltaMs`로 변경 검토 + 음수=정상 설계임을 문서화. 게임/판정 무관, Critical 아님.
