# 🚦 QA_STATUS — 가장 먼저 확인하는 문서

> **개발 시작 전 · 디버그 시작 전 · 버전업 전 · 릴리즈 전, 항상 이 파일을 먼저 연다.**
> 상세는 `docs/history/`(BUG_MASTER_LEDGER / BUG_TIMELINE / ACTIVE_ISSUES / REGRESSION_TRACKER / RELEASE_QA_CHECKLIST / FEATURE_DECISION_HISTORY / KNOWN_BEHAVIORS / README).
>
> 최종 갱신: **2026-07-08 (Build19)** · 기준 브랜치: `fix/build19-critical-rules-sync` (iOS build 19 TestFlight VALID) · 이전 최종 갱신 2026-07-08(Build18)

---

## 🚨 Build19 — Critical Fix Build (음성 TTS override / 다기기 동기화 / 판정 데이터레이스 방지 / QA 계측 강화)

> **상태: RC 아님 — 실기기 QA 대기(Evidence-gated).** TestFlight VALID는 업로드/설치 가능함을 의미할 뿐, 아래 잔여 리스크 4건이 실기기에서 확인되기 전까지 RC로 확정하지 않는다(DR-10).
>
> Build18 RC 중단 후 진행. 지시된 4개 영역 중 2개는 조사 결과가 원래 진단과 달라 **표적 수정**으로 재조정(사용자 승인).

- **WRPS-052-B19(음성)**: `docs/VOICE_QA_CHECKLIST.md`에 이미 인간 청취 확인 기록(06-26/28) 있고 파일 무변경 확인 → 반증 제시 후 "그래도 교체" 결정 + TTS 미구현 발견 → **intro(ko) 한정 TTS_OVERRIDE**("안 내면 술래 가위바위보!!", speechSynthesis) 추가, mp3는 폴백 유지. **DR-6 예외 명시(문서 갱신) + DR-10 Evidence-gated(실기기 가청 확인 전까지 미종결)**.
  - **정정(2026-07-08)**: whisper 전사로 확인 결과 06-26/28 청취 기록이 **오류**였음 — `ko_game_start.mp3`는 "게임을 시작합니다."(풀구호 아님), 음성팩 14개 파일 전체에 "가위바위보" 문구 없음 확정. TTS는 회귀가 아니라 유일한 정확 문구 수단. 사용자 결정: **신규 MC 녹음 준비될 때까지 TTS 유지**. 신규 backlog: MC 성우 재녹음.
- **WRPS-072-B19(판정 규칙)**: 전체 상태머신 재작성 대신, Build18 실측 QA(host vs participant JSON)에서 **host 자신의 참가자 row 데이터레이스**를 확인(host만 resultValue:null 33%, 동일 라운드 18초뒤 다른 결과로 재분류 사례) → `fetchFreshParticipantsForResult()`(최대 2회·300ms 재시도) + `finishRoundLocal()` idempotency 가드(`state.lastRoundResolution`). 판정 알고리즘(`resolveElimination`/`judgeRound`) 자체는 무변경(기존 37개 테스트로 이미 검증됨).
- **WRPS-SYNC-B19(동기화)**: 결과/다음라운드/게임종료 전환에 scheduled-render 전무 확인(지시 정확) → `penalty` blob 재사용(`phaseScheduledAt`/`phaseKind`, DB 스키마 무변경)으로 4개 전환(countdown/result/nextRound/gameOver) 전부 서버시각 동기화. `SYNC_RENDER`/`SYNC_LATE_RENDER` metric + `scripts/analyze-qa-sync.mjs`(다기기 gap 분석기, PASS 기준 ≤1000ms). `syncServerClock()` 1회 재시도, `countdownStartServerTs:0` 시 `INVALID_COUNTDOWN_SERVER_TS` + 1회 복구시도.
- **codex-critic 2R**: 1R FAIL(HIGH 1: TTS가 문서화된 DR-6을 갱신없이 위반+실기기 미검증 · MEDIUM 1: TTS 콜백 stale-race) → 문서화(DR-6 예외+Evidence-gated)+identity-token 수정 → 2R **PASS — HIGH/Critical 0**.
- 판정/서버/인증/UI/QA-persistence 구조 무변경. +29 테스트(신규 3파일), 전체 **209 green**.
- **TestFlight**: build 19 **VALID** (Delivery UUID `a133d610-9e50-40ec-ab2d-594e97730b5b`, commit `2c04341`, 브랜치 `fix/build19-critical-rules-sync`).

### 잔여 리스크 4건(실기기 QA 대기 — RC 확정 조건)
1. **intro TTS 실제 가청 여부** — `speechSynthesis`의 `onend`는 발화 완주만 보장, 실제 소리가 났는지는 미보장(WKWebView 오디오 세션 충돌 시 무음 가능 — WRPS-014/051/052와 동일 실패군). `docs/VOICE_QA_CHECKLIST.md` 6번 항목.
2. **다기기 동기화 gap** — `scripts/analyze-qa-sync.mjs` 코드는 완성했으나 실측 다기기 데이터 없음. PASS 기준 phase별 maxGapMs ≤1000ms.
3. **host 데이터 레이스 재발 여부** — `fetchFreshParticipantsForResult()` 재시도(최대 600ms)로 완화했으나, 그 예산을 초과하는 극단적 지연에서는 여전히 최초(잘못된) 분류가 idempotency 가드로 영구 고정될 수 있음(codex-critic MEDIUM, 수용된 트레이드오프). `TAGGER_SNAPSHOT_GAVE_UP` metric 발생률로 확인 필요.
4. **`resolveElimination()` 미호출(구조적, 회귀 아님)** — `src/game-logic.mjs`의 검증된 순수함수가 `index.html`에 주입만 되고 실제로는 `finishRoundLocal()`의 손 중복구현이 실행됨(현재 조건 일치 확인됨, 향후 drift 위험). Build19에서 의도적으로 미착수 — 차기 전용 세션 권장(`docs/history/REGRESSION_TRACKER.md` Build19 절 참조).

---

## 🎧 Build18 — iOS 음성 재생 복구 + ROUND_RESULT metric 중복 제거 (게임 로직 무변경)

> 목적: Build17 1차 실기기 QA에서 발견된 WRPS-052(audioMissing 반복)·WRPS-072(metric 중복)를 최소 수정으로 해결.

- **WRPS-052**: 음성 mp3는 유효·번들 정상(합성 SFX는 기기에서 재생됨) → 원인은 WebAudio `fetch`+`decodeAudioData` 파이프라인(WKWebView가 일부 mp3 ID3v2.4 태그를 디코드 거부)으로 국한. **HTMLAudioElement fallback**(`playVoiceFallback`) 추가 — 원인에 무관하게 네이티브 미디어 경로로 재생. QA metric에 `audioPlayed`/`audioSource`/`audioMode{muted,ctxState}`/`audioError`/`loadError{stage:fetch|http|decode,status,message}` 추가(무음/볼륨 문제와 코드경로 문제 구분).
- **WRPS-072**: `finishRoundLocal()`은 `result→game_over` 전이로 라운드당 2회+ 호출되는 **설계**(line 6695, WRPS-046 기존 주석). SFX/음성은 이미 `resultVoiceKey`/`resultSfxKey`로 1회 가드되어 있었으나 QA metric은 누락 → `state.resultMetricKey`(동일 패턴)로 가드, 동일 3개 방/게임 리셋 지점에서 초기화(새 방 라운드1 metric 누락 방지).
- **codex-critic 2R**: 1R FAIL(HIGH 2: fallback 채널 우선순위 가드 누락 · `M.seenResult` 미리셋으로 새 방 metric 누락) → 수정 → 2R **PASS — HIGH/Critical 0**.
- 판정/서버/인증/UI/QA persistence 구조 무변경. Build17 persistence PASS 유지(QA-OFF 완전 no-op 재확인). +11 정적계약 테스트, 전체 **179 green**.
- **TestFlight**: build 18 **VALID** (Delivery UUID `ce369251-4cbb-4781-a703-217956b9c49a`, commit `bcb12e1`, 브랜치 `fix/build18-audio-metric-stabilization`).
- **다음**: 실기기 필드 QA로 intro/gameOver/becameLoser 음성 실재생 확인 + audioMissing 재발 여부 + ROUND_RESULT unique eventId 일치 확인.

---

## 🧪 Build17 — QA 기록 자동저장 (필드테스트 인프라, 게임 로직 무변경)

> 목적: 실기기 필드테스트 시 앱 종료/새로고침/강제종료에도 QA JSON을 **자동 확보**. QA 계측(기본 OFF, `__QA_BUILD__`/`?qa=1`)에서만 동작 — production 무영향.

- **Layer 1 지속화**: `window.__qaMetrics` → `localStorage['rpsQAReport.v1']`. emit마다 2s 디바운스 저장, `visibilitychange(hidden)`/`pagehide`/App 백그라운드/게임·방 종료 스냅샷 시 **즉시 flush**(디바운스 취소). 앱 시작 시 직전 세션 복구(`previousSession`/`recoveredAt`, sessionId 분리, 1단계 중첩 캡).
- **Layer 2 파일 export**: `QA💾` 버튼 → `exportFile()` → `qa-report.v1` JSON을 Capacitor Filesystem `Documents`에 저장 + Share Sheet, 실패 시 클립보드 fallback. 파일명 `qa-report-build17-YYYY-MM-DD-HH-MM-SS.json`.
- **스키마** `qa-report.v1`: `{schemaVersion,app,build,buildLabel,createdAt,device,session,qaMetrics,exportReason,previousSession,recoveredAt,userAgent,url,timezone}`.
- 로그 prefix: `[QA-SAVE] [QA-FLUSH] [QA-RESTORE] [QA-REPORT] [QA-METRIC]`.
- 신규 plugin 2개: `@capacitor/filesystem`, `@capacitor/share`. 테스트: `tests/qa-persistence.test.mjs`(실 IIFE 추출 21건, reload-vs-kill 실재현 + QA-OFF no-op), 전체 165 green. codex-critic 2R PASS(HIGH 2 + MEDIUM 1 수정).
- **TestFlight**: build 17 **VALID** (Delivery UUID `f84b6407-e366-4df9-842e-4ad99d58479f`, commit `552973d`, 브랜치 `fix/build17-qa-auto-save` origin push 완료, main 미머지).

### Build17 1차 실기기 QA 결과 (2026-07-07)
- ✅ **QA persistence/export = PASS** — 세션 복구(`gjrjs280`→`4075ozeq` `QA_SESSION_RECOVERED`) 및 background 생존 확인. 게임 판정 신호 정상(shadow 21/21, ordering 0, stale 0, hostChanged 0). → **persistence 목적 종결(닫음)**.
- 🔎 후속(QA persistence와 분리, 게임 무변경): **WRPS-052** VOICE audioMissing 22건 · **WRPS-072** ROUND_RESULT metric 중복(instrumentation) · **WRPS-073** countdownDriftMs 명명/의미 재검토. 상세 `docs/history/ACTIVE_ISSUES.md`(Build17 Device QA 절).

---

## 📊 현재 열린 버그 수

| 우선순위 | 건수 | 비고 |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **2** | WRPS-026(호스트 빠짐) · WRPS-036(멀티디바이스 매트릭스) |
| **P2** | **2** | WRPS-020 · WRPS-034 |
| **P3** | **2** | WRPS-019 · WRPS-021 |
| 합계(미해결) | 6 | + Build8.1/8.2 수정 다수(실기기 검증 대기) |

**실기기 PASS 종결**: WRPS-014(참가자 TTS). ⚠️ WRPS-015(카운트다운 동기화)는 **음성팩 후 재발→WRPS-047(Build8.4)로 추적**.
**Build8.2 코드 수정(실기기 재검증 대기)**: WRPS-042(전원 Ready 통일) · WRPS-043(다중 술래) · WRPS-013/018(재초대 고착).
**Build8.4 코드 수정(실기기 재검증 대기)**: 🔴 **WRPS-047(P0 카운트다운 동기화 회귀)** · WRPS-045/046(한국어 음성 혼재·2회재생) · WRPS-048(버튼음). codex-critic PASS·test 49/49.

> P1 표기 3건은 핵심 미검증 게이트 기준. WRPS-037은 설계상 의도 동작(경쟁조건 보강 검토).

---

## ♻️ 최근 회귀 버그 (Build8.1 처리)

- **수정 완료(실기기 검증 대기)**: WRPS-013(재초대 수락 고착), WRPS-014(참가자 TTS), WRPS-018(고착 안전망), WRPS-041(자동시작 문서 드리프트).
- **구조적 회귀 원인**: Lineage A(`fix-game-ready-button-bl7zf`) 미머지 → Build8.1에서 **국소 패턴만 선별 이식**(전체 머지 금지).
- **build8 마이그레이션 자체 회귀: 여전히 0건**(WRPS-040, 격리 유지).

---

## 🔝 Top 10 위험 버그

| # | ID | 문제 | 위험도 | 상태 |
|---|---|---|---|---|
| 1 | WRPS-013 | 재초대 수락 후 대기화면 고착 | High→**수정** | ✅ Build8.1 수정 · 실기기 검증 대기 |
| 2 | WRPS-014 | 참가자 단말 카운트다운 TTS 미재생 | High→**수정** | ✅ Build8.1 수정 · iOS 실기기 검증 대기 |
| 2.5 | WRPS-042 | 전원 Ready 시작 트리거 통일(호스트 시작 버튼 폐지) | Medium | 사양 확정 · 코드 불일치 → **Build8.2** |
| 3 | WRPS-026 | 3인 호스트 빠짐 판정 프리즈 | Medium | 코드OK · 실기기 미검증 |
| 4 | WRPS-036 | 다인전 멀티디바이스 매트릭스 54셀 미완 | Medium | 미수행 |
| 5 | WRPS-015 | 카운트다운 기기간 시차(late-arrival) | Medium | 부분완화 |
| 6 | WRPS-037 | 자동시작 stale-state 오발화 위험 | Medium | 보강 검토 |
| 7 | WRPS-018 | participantWait 고착 복구 안전망 | Low→**수정** | ✅ Build8.1 수정 |
| 8 | WRPS-020 | 참가자 목록 표시 지연/깜빡임 | Low | 미반영 |
| 9 | WRPS-034 | 영/일 모드 토스트 한글 잔존 | Low | 부분반영 |
| 10 | WRPS-041 | GAME_LOGIC.md 자동시작 문서 드리프트 | Low→**수정** | ✅ Build8.1 정정 |

---

## 🆕 이번 Build(8.1) 신규 버그
- **없음.** (코드 수정은 기존 누락분 이식이며 신규 회귀 미발견 — 문법/단위/빌드/싱크 통과.)

## ✅ 이번 Build(8.1) 해결 버그
- **WRPS-013 · WRPS-014 · WRPS-018**(코드) + **WRPS-041**(문서). 단 13/14는 실기기 검증 통과 시 최종 종결.

---

## 🚦 릴리즈 상태: **Build8.4 (build 13) TestFlight 업로드 완료 · Processing VALID · 실기기 QA 대기**

### Build8.4 코드 게이트 (2026-06-28 — 한국어 음성 실기기 QA 결과)
- ✅ **코드 수정 4건 독립 커밋**: WRPS-047(`db0d16a`,P0)·046(`8c8bc1d`)·045(`baebae2`)·048(`51d5c6a`).
- ✅ **codex-critic 재검토 PASS**(WRPS-046 HIGH·047 MEDIUM 지적 → 보정 → Review Correction Loop 통과, critical/high 0).
- ✅ npm test **49/49** · ✅ 인라인 JS 문법 OK · ✅ DB 스키마/RLS/Firebase/판정(game-logic.mjs) 무변경.

### 빌드/업로드 게이트 (2026-06-28 Build8.4)
- ✅ **ARCHIVE SUCCEEDED**(`build/MaruRPS-Build8.4.xcarchive`) · ✅ **EXPORT SUCCEEDED**(`build/export-build8.4/WooriMaruRPS.ipa`, 49.2MB)
- ✅ **TestFlight UPLOAD SUCCEEDED** — build **13**, Delivery UUID `f99e8308-eb20-46f9-b9c3-36ca25ae83ac`. **충돌 없음.**
- ✅ **Processing = VALID**(ASC API `/v1/builds` 확인). build 13 IPA에 Build8.4 코드 포함 검증 완료.
- ⚠️ **빌드번호 주의**: ExportOptions `manageAppVersionAndBuildNumber=true`로 Export가 ASC 기존 빌드(9~12)를 피해 **archive 10 → IPA 13 자동 증가**. repo `CURRENT_PROJECT_VERSION`는 실제 출하분과 일치하도록 **13**으로 정정. (ASC 실제 이력: build 9~12는 06-22~06-26 업로드분, 13=Build8.4)
- API Key: `8FCAM7NFRL` + Issuer `fbcda81d-…`(`~/.appstoreconnect/asc-upload.env`, git 제외).

### (이전) Build8.3 = ASC build 9, Delivery `eb3547e1-…`(2026-06-22).

### 다음: build 13 설치 후 실기기 QA
- 신규 재검증: **WRPS-047(P0 카운트다운 동기화 — 멀티디바이스 매트릭스)** · WRPS-045/046(한국어 음성) · WRPS-048(버튼음 청취).
- 기존 재검증 대상: WRPS-044/043/042/013/018, 미검증 게이트 WRPS-026/036.
> Internal TestFlight 배포 **완료**. 외부/스토어 릴리즈는 실기기 체크리스트(특히 WRPS-047 P0) 통과 전 **NO-GO**.

---

## 🧭 개발자 운영 규칙 (필수)
1. **개발 시작 전** → 이 파일(`QA_STATUS.md`) 확인
2. **버그 수정 시** → `docs/history/BUG_MASTER_LEDGER.md` 갱신(ID·상태)
3. **릴리즈 전** → `docs/history/RELEASE_QA_CHECKLIST.md` 전 항목 확인
4. **회귀 발생 시** → `docs/history/REGRESSION_TRACKER.md` 회차 추가
5. **기능 변경 시** → `docs/history/FEATURE_DECISION_HISTORY.md` 한 줄 추가
6. 버그 수정은 **독립 커밋**(squash 금지) — Lineage A 누락 재발 방지
