# Build 33 (KR V1.0_KR) — Blocker Status

Scope: TestFlight **Internal Testing only**. App Store 제출/심사/릴리스는 이 문서의
범위 밖이며 수행하지 않는다. Tokyo(`cmfxhehpreanijwanwrr`) 변경 금지.

Snapshot: 2026-08-17 (재부팅 후 상태 복구 시점)

## 배포 상태

| 항목 | 값 |
|---|---|
| App | WooriMaru RPS (`com.yeongjookoo.woorimaru.rps`, ASC app id `6779211039`) |
| Build | 33 (`b11a5621-d976-45cd-90ec-2f0325435933`), MARKETING_VERSION 1.0 |
| Uploaded | 2026-08-12 |
| processingState | **VALID** |
| internalBuildState | **IN_BETA_TESTING** — 내부 그룹 `내부테스트1`에 이미 배정됨 |
| 내부 테스터 | 2명, 둘 다 `INSTALLED` |
| externalBuildState | `READY_FOR_BETA_SUBMISSION` — **제출하지 않음** (의도된 상태) |
| Git | branch `fix/replay-force-start-and-confirmed-ids`, HEAD `5296191`, working tree clean |
| ⚠️ Push | 이 브랜치는 **origin에 아직 push되지 않음** (로컬 전용 5커밋) |

## 남은 blocker (실기기 검증 대기)

**해결되어 blocker에서 제거된 항목**
- Kakao 로그인 — 실기기 TRACE PASS
- **Apple 로그인 — 실기기 테스트 완료, 정상 진행 확인 (2026-08-17 제거)**
  수정 `b67b0f3`("로그인 완료" 표시 전 실제 Supabase 세션 요구)이 실기기에서 검증됨.

### BL-2 — 방 나가기 수정본 실기기 재검증 (P0, 코드수정 완료 · **테스트 예정**)
- 수정: `0d75936` — 방을 떠난 뒤 도착하는 stale room update 무시. 3중 가드:
  1. `handleRoomUpdate()`: `!state.roomCode`면 즉시 bail
  2. `fetchParticipants()`: await 이후 roomCode 불일치면 bail
  3. `transferHostAndLeave()`: 누락된 catch 추가(실패해도 clearRealtime+goHome 보장)
- Build 33 배포 asset에 반영 확인됨.
- **테스트 시나리오 (확정)**: 멀티 참가자 게임 진행 중 한 참가자가 **라운드 중간**에 나감.
  확인 항목 ① 이탈 참가자 정상 퇴장 ② 남은 방 상태 유지 ③ 필요 시 host transfer 정상
  ④ 남은 참가자가 다음 라운드 계속 진행 가능 ⑤ stale room/countdown 재발 없음.

### BL-3 — 카운트다운 중복 (**P0, 우선순위 상향**) — 근본원인 확정 · 수정 적용

**실기기 관측 (2026-08-17 갱신)**
- 종전 가설 "6라운드 이후 누적"은 **틀렸다**. 실제로는 **3라운드부터 호스트 기기에서**
  멀티 카운트다운 발생.
- 따라서 장기 누적 문제가 아니라 **라운드 전환 시 countdown trigger 중복 등록/재진입**
  문제로 조사 방향을 전환했다.

**근본원인 (코드 추적으로 확정)**
호스트 전용 countdown 시작 경로를 추적한 결과, 재진입 가드 2개가 **동시에 무력화되는
분기**가 있었다.

1. `enterPlayingStateFromRoomUpdate()`의 재진입 가드(`alreadyEntering`)는 "이번 라운드에
   이미 진입했는가"를 **화면 가시성**으로 판정한다 — `screenGame` / `screenWinnerWait` /
   `screenLoserWait` / `screenParticipantWait` / 카운트다운 오버레이 중 하나가 떠 있어야
   재진입을 막는다.
2. 그런데 `runCountdownThenShowGame()`의 **비참가자 early-return**은 이렇게 되어 있었다:
   ```js
   if (!isCurrentRoundParticipant()) {
     if (isSafeParticipant()) showScreen("screenWinnerWait");
     else if (isConfirmedLoser()) showLoserWaitScreen();
     …
     releaseActiveKey();   // ← 2차 가드(countdownCoroutineActiveKey) 즉시 반납
     return;
   }
   ```
   `isCurrentRoundParticipant()`는 safe/loser 외에 **세 번째 경우**에도 false가 된다 —
   `isWaitingForNextGame()`(WRPS-085 중도참가자의 `'__waiting__'`, 커밋 `d367922`에서 신규
   도입) 또는 `currentUserId` 미확정 순간. 이 경우 **어떤 화면도 띄우지 않는다.**
3. 결과: 화면이 없으므로 ①번 가드는 항상 false(재진입 허용), `releaseActiveKey()` 때문에
   ②번 가드도 이미 반납 → **realtime 에코 + 2.6초 폴링이 같은 'playing' row를 배달할
   때마다 같은 라운드에 무한 재진입**한다. 호스트가 해당 라운드에 참여하지 않는 경우
   (`startHostJudgeBackstop()`이 호스트 전용인 바로 그 상태)에 걸리므로 **호스트 기기에서만**
   드러난다.
4. 동일 결함이 `showGameScreen()`과 카운트다운 완료 직후 분기에도 그대로 복제돼 있었다
   (세 곳 모두 같은 `if(safe) … else if(loser) …` 패턴, else 없음).

**자동 테스트가 이걸 놓친 이유 (테스트 맹점)**
RC-3 시뮬레이션 하니스(`tests/rc3-harness-support.mjs`)는 `showGameScreen`을 **한 번도
참조하지 않는다** — 즉 "이 기기가 카운트다운 후 어느 화면에 있는가"를 전혀 모델링하지
않는다. `alreadyEntering` 가드가 의존하는 `isScreenActive()`가 하니스의 가짜 DOM에서
평가되므로, `DOUBLE_COUNTDOWN_RENDER` 채널이 N=3..20 전 구간 0이면서도 실기기는 RED일 수
있었다. 이 맹점을 닫는 회귀 테스트가 필요하다(미작성 — 아래 잔여 과제).

**적용한 수정 (index.html)**
- 신규 헬퍼 `showNonPlayingRoundScreen()` — "이번 라운드에 참여하지 않는 기기"의 화면을
  한 곳에서 결정한다. safe → `screenWinnerWait`, loser → `screenLoserWait`(기존 유지),
  **호스트 → `screenHostPlaying`**, 그 외(`'__waiting__'` 중도참가자) → `screenParticipantWait`.
  - `screenHostPlaying`은 `renderHostPlayingScreen()`으로 **완전히 구현돼 있으면서도
    `showScreen()` 호출부가 0곳**이라 한 번도 표시된 적 없던 화면이다(비참가 호스트에게
    판정 버튼·선택 현황을 보여주는 용도). 배선하면서 화면 미표시 UX 결함도 함께 해소된다.
- 위 3개 분기를 모두 이 헬퍼로 통일.
- `alreadyEntering` 가드 목록에 `screenHostPlaying` 추가 — 이걸 안 하면 화면을 띄워도
  가드가 여전히 false가 되어 재진입이 열린 채로 남는다.
- `markReady()`/`markReadyFromLobby()`의 동일 패턴은 **의도적으로 손대지 않았다** —
  라운드 진입 경로가 아니라 ready 버튼 게이트(WRPS-053/DR-15)이며, 이번 blocker의 범위 밖.

**재현 및 회귀 테스트 (신규: `tests/build33-countdown-reentry-guard.test.mjs`, 7/7 PASS)**
- index.html의 REAL 소스(`enterPlayingStateFromRoomUpdate` / `runCountdownThenShowGame` /
  `showNonPlayingRoundScreen` / 참가 판정 술어 전부)를 문자열 마커로 추출해 실행하고,
  **기존 RC-3 하니스가 하지 않던 화면 상태 모델링**(hideAll + show one, REAL
  `isScreenActive()`가 그 classList를 그대로 읽음)을 붙였다.
- 핵심 검증: 같은 'playing' row를 realtime 에코 + 폴링으로 **5회 반복 배달**했을 때
  카운트다운 진입이 **정확히 1회**.
- **mutation(반공허성) 증명**: 수정을 되돌려(세 번째 경우에 화면을 띄우지 않게) 실행하면
  같은 조건에서 **5회 배달 → 5회 재진입**이 실제로 재현된다. 즉 이 결함은 실재했고,
  이 수정이 그것을 막고 있다는 직접 증거다.
- 가드 절반만 고치는 경우(화면은 띄우되 `alreadyEntering` 목록에 `screenHostPlaying`
  누락)도 소스 수준 assert로 못 박았다.
- 회귀 확인: safe 확정 기기는 종전대로 `screenWinnerWait`, loser 확정 기기는
  `screenLoserWait` 유지.

**남은 일**
- 실기기 **최소 10라운드 연속** 검증 (수정 후 필수).
- ⚠️ **Build 33은 QA 계측이 꺼져 있다** (`__QA_BUILD__ = false`, 배포 asset에서 확인).
  네이티브 앱에는 `?qa=1` URL도 localStorage 접근도 없으므로 **Build 33에서는 기기
  텔레메트리를 전혀 뽑을 수 없다.** `COUNTDOWN_GENERATION_STARTED` /
  `COUNTDOWN_COROUTINE_DUPLICATE_BLOCKED` 메트릭으로 재진입 경로를 확증하려면
  `QA_BUILD=1`로 빌드한 내부 빌드(Build 34)가 필요하다.
- 테스트 맹점을 닫는 회귀 테스트(화면 상태를 모델링해 재진입을 실제로 재현) 작성.

## 회귀/격리 재확인 (2026-08-17 실행)

| 확인 항목 | 결과 |
|---|---|
| vitest 전체 | **1045/1045 PASS** (59 files, 918s) |
| HTML 문법 검사 | PASS |
| Seoul ref (`sannrfmhevebqgfdqcps`) | source/dist/ios 3계층 모두 존재 |
| Tokyo ref (`cmfxhehpreanijwanwrr`) | 3계층 모두 **0** |
| `service_role` 키 노출 | 3계층 모두 **0** |
| LINE 비활성 | `ENABLE_LINE_LOGIN = false` 3계층 모두 존재, 버튼 hidden, 콜백/딥링크 경로 차단 |
| Google 비활성 | `ENABLE_GOOGLE_LOGIN = false` 3계층 모두 존재 (`ba6d69c`) |
| WRPS-084 (`leave_after_round`) 제외 | 클라이언트 3계층 모두 참조 **0** (SQL 마이그레이션 파일만 git 추적) |
| dist ↔ ios/App/App/public | md5 동일 (`548776…`) |
| source ↔ dist 차이 | engine v2 인라인 주입분(650줄)만 — 로그인/백엔드 차이 없음 |

## ⚠️ Release gate — FAIL (기존 상태, KR V1 회귀 아님)

`npm run test:release-gate` (strict, fail-closed) → **exit 1**

```
gate=timing  profile=Normal  rate=0.7472  required=0.95
```

- 실패 채널은 **timing 전용**. correctness 게이트는 3개 profile 전부 통과.
- 위반 phase는 `result` / `ready` 렌더 지연(≤250ms 초과)이며 N이 클수록 악화:
  N≤7은 0.85~1.0, N=19~20은 0.45~0.50.
- **회귀 여부 확인 완료**: KR V1 작업 이전 커밋(`c452b11`)을 별도 worktree에
  체크아웃해 동일 게이트를 실행한 결과 `rate=0.7472222222222222`로 **비트 단위 동일**.
  → Seoul 이관 / LINE·Google 비활성 / 로그인·방나가기 수정과 **무관한 기존 상태**다.
- Internal Testing은 이 게이트와 무관하게 진행 가능. **외부 배포/스토어 릴리스
  판정에는 이 게이트가 여전히 NO-GO**이므로, 그 단계 전에 별도 과제로 다뤄야 한다.

---

# 📌 기준점 (BASELINE) — 2026-08-18, CEO 승인

이 상태를 이후 작업의 비교 기준으로 삼는다.

| 항목 | 값 |
|---|---|
| 자동 테스트 | **60/60 files, 1056/1056 tests PASS** (실패 0) |
| 자산 동기화 | **dist ↔ ios/App/App/public md5 일치** |
| Android 자산 | **의도적으로 sync 하지 않음** — 2026-08-11 상태로 정지. KR V1 범위는 **iOS TestFlight 전용** |
| Tokyo / JP 설정 / 인증구조 / DB schema | **무변경** |
| 커밋·푸시 | 없음 (working tree에만 존재) |

## 개인정보 문구 감사 결과 (2026-08-17~18)

법무 검토본 원문이 repo에 **없어**, 신규 문구 작성 없이 불일치만 목록화했다.

### 반영 완료 (배선·사실관계 한정)

| 항목 | 파일 | 변경 |
|---|---|---|
| **C-1** 법적 문서 링크 배선 | `index.html` | 로그인 화면에 `privacy.html` / `terms.html` 링크 추가. i18n 키 `auth.legalPrivacy` / `auth.legalTerms`를 ko·en·ja 3개 로케일에 추가. **문서 제목만** 추가했고 동의 문구·수집 고지·국외이전 서술은 일절 작성하지 않음 |
| **C-5** 화면명 사실 수정 | `account-delete.html` | "내 기록" → "내 누적 기록" (실제 앱 화면 제목과 일치) |

C-1 이전 상태: 두 문서가 앱 번들에 포함돼 있으면서도 **여는 경로가 한 곳도 없었다.**

### 법무 최종본 확인 전까지 수정 금지 (CEO 판정)

| 항목 | 내용 |
|---|---|
| **C-2** | `privacy.html`에 국외이전·처리위탁·제3자 제공·보유기간 조항 **부재**. Supabase는 해외 법인 처리위탁 |
| **C-3** | 게스트 기록 문구가 3곳에서 서로 다름 — `index.html` `auth.guestHint`("저장되지 않습니다") / `privacy.html`("기기 안에만 저장됩니다") / `terms.html`("저장되지 않을 수 있습니다"). 실제로는 `saveState()`가 닉네임·방코드·**다른 참가자 이름**을 localStorage에 저장하고, 누적 전적만 로그인을 요구한다 |
| **C-4** | `privacy.html`·`terms.html`이 로그인 제공자를 "SNS 로그인"으로만 표기. Apple/Kakao 미명시 |
| **C-6** | 3개 문서 시행일이 모두 2026-05-29 — Seoul 이관(2026-08-11) 이전 |

⚠️ **Seoul 리전이라는 이유로 "국외이전 없음"을 단정하는 문구를 새로 만들지 않는다** (CEO 지시).

### 확인된 무결 사항

- **Tokyo·일본·해외 저장을 주장하는 표현이 3개 법적 문서 어디에도 없다** — 허위 서술 없음
- LINE/Google을 언급하는 문장이 없어 비활성 제공자에 대한 허위 서술도 없음
- `privacy.html` / `terms.html`은 source·dist·ios·android 4계층 md5 전부 동일
- `Info.plist`의 `NSCameraUsageDescription`(QR 스캔용) 문구는 실제 용도와 일치
- `delete-account` Edge Function은 `auth.admin.deleteUser()`로 계정을 삭제하며
  `account-delete.html`의 설명과 부합

### 다음 단계

최종 법무 문서 원문을 받으면 `privacy.html` / `terms.html` / `account-delete.html` /
`index.html` 문구를 대조 후 반영한다.

## 하지 않은 일 (의도적)

- App Store Production 제출·심사·릴리스 — 금지 지시
- 외부(External) TestFlight 그룹 배포 — 범위 밖
- V2 보안 재설계(R1/R2 ownership 기반 RLS) — `SEOUL_KR_V1_SECURITY_RISK_REGISTER.md`에
  accepted risk로 등록된 상태 유지
- Tokyo 프로젝트 변경 — 금지 지시
- 기존 완료 작업의 되돌림/재설계 — 없음
