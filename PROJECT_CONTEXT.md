# PROJECT_CONTEXT.md

> Claude 다음 세션이 바로 이어서 작업할 수 있도록 작성한 인수인계 문서.
> 작성일: 2026-06-12 / 작성자: Claude (Opus 4.8 1M)

---

## 0. 한 줄 요약

QR로 모여서 하는 가위바위보 파티 게임(웹 + iOS/Android Capacitor 앱). 현재 **TestFlight Build 3 준비 중**이며, Build 1.0(2) 피드백 기반 QA 안정화 작업이 **워킹트리에 커밋되지 않은 상태로** 완료되어 있다.

---

## 1. 현재 프로젝트 상태

| 항목 | 값 |
|---|---|
| 현재 브랜치 | `main` |
| 마지막 커밋 | `7fb82d2 chore: prepare android release qa pipeline` |
| 워킹트리 | **커밋 안 됨** (모든 QA 수정이 uncommitted 상태) |
| 앱 이름 / Bundle ID | `마루의 가위바위보` / `com.maru.rps` |
| iOS Version (MARKETING_VERSION) | `1.0` |
| iOS Build (CURRENT_PROJECT_VERSION) | **`2`** → 업로드 전 **`3`으로 올려야 함** |
| package.json version | `1.0.0` |

### 아키텍처 (중요)
- **단일 파일 앱**: 거의 모든 로직 + CSS + i18n이 `index.html`(~9,000줄)의 인라인 `<script>`/`<style>`에 들어있다.
- 빌드: `node scripts/build-web.mjs` → `dist/` 생성. iOS는 `npx cap sync ios`로 `dist`를 `ios/App/App/public`에 복사.
- `npm test`는 **JS 문법 검사만** 한다 (`new Function()`으로 인라인 스크립트 파싱). 단위 테스트 프레임워크 없음.
- i18n: ko/en/ja 3개 로케일 블록(문자열 id 키), `t(key)`로 조회. **새 키는 3개 로케일 모두에 추가해야 함.**
- 백엔드: Supabase (`rooms`, `participants`, `user_game_stats`, `user_game_history` 테이블) + Realtime + 5초 폴링 백업.

### 완료된 기능
- 게스트/SNS 로그인(카카오/LINE/구글/애플), 방 생성·QR 입장·방코드 입장
- 벌칙 설정, 술래 수 설정, 라운드 카운트다운/선택/판정/재대결/최종결과
- 누적 통계(승률/벌칙), 직전 게임 결과, 계정 기록(Supabase)
- 3개 언어(ko/en/ja), 앱 아이콘 언어별 전환
- iOS Capacitor 프로젝트(Debug/Release 컴파일까지 성공)

### 미완료 기능 / 미진행
- 실기기 멀티디바이스 QA (아래 QA_BACKLOG 참조)
- Apple Developer Team 연결 / 서명 / Archive / TestFlight 업로드 (사용자 수동 작업)
- App Store Connect 앱 레코드, 스크린샷, 개인정보 문항 등 심사 준비

---

## 2. QA 현황 요약

상세는 `QA_BACKLOG.md`, 변경 내역은 `CHANGELOG_BUILD3.md` 참조.

| 우선순위 | 항목 | 상태 |
|---|---|---|
| P0 | 자동선택 판정 오류(무승부 오표시) | ✅ 수정 |
| P0 | 게임 중 승률 보기 — 이전 라운드 누락 | ✅ 수정 |
| P0 | 직전 게임 결과 누락 | ✅ 수정 |
| P1 | 새 방 생성/입장 시 이전 상태 잔류 | ✅ 수정 |
| P1 | 3인 게임 판정 누락/프리즈 | ✅ 수정(런타임 재현 검증 필요) |
| P1 | 자동선택 UI "자동" 라벨 | ✅ 수정 |
| P1 | Safe Area / 하단 UI 잘림 | ✅ 수정 |
| P2 | 호스트 상태 표시 | ✅ 검증(이미 충족) |
| P2 | 결과 문구 통일(승리/Win) | ✅ 수정 |
| P2 | 참가자 카드 단순화 | ✅ 수정 |
| P2 | 레이블 크기(Me/방코드/벌칙) | ✅ 수정 |
| P2 | 버튼/상태 문구 정리 | ✅ 수정 |
| P2 | 영어 UI 점검 | ✅ 부분(게임/역할 문구 i18n화) |

**모든 수정은 `index.html` 단일 파일에 있으며 커밋되지 않음.**

---

## 3. 게임 로직 (핵심 — 건드릴 때 반드시 숙지)

### 판정 로직 (단일 authoritative 함수)
- `judgeRound(participants)` — **무승부: 선택이 1종류 OR 3종류 전부**, **승/패: 정확히 2종류**.
- 온라인에서는 **호스트만** `publishHostRoundResult()`로 판정한다. 이 함수는 **DB에서 최신 participants를 재조회**한 뒤 judge하고, 결과를 인코딩해 저장한다. 참가자는 독립 판정하지 않고 인코딩된 결과를 읽기만 한다.
- 동시 호출 방지: `state.publishingRoundResult` 플래그 + 인코딩 결과 존재 시(`alreadyProcessed`) 재호출 차단.

### 자동선택 로직 (타임아웃)
- 선택 제한시간 5초. 만료 시 **호스트만** `autoFillChoices()` 실행.
- `autoFillChoices()`는 **DB를 재조회**해 실제로 비어있는 사람에게만 랜덤 선택을 넣는다 → **이미 제출된 선택을 덮어쓰지 않음**(과거 무승부 오표시 버그의 근본 원인이었음).
- 자동선택은 `encodeRoundChoice(random, "", true)`로 저장(아래 데이터 구조 참조).
- **빠진 호스트 백스톱**: 호스트가 우선안전/술래로 라운드에서 빠지면 선택 타이머가 없어 판정 트리거가 사라지는 문제(P1.5) → `startHostJudgeBackstop()`이 `getCountdownStartAt()+11s`(serverNow 기준)에 판정을 보장.

### 기록 저장 로직
- 라운드 종료 시 누적 전적은 `participants` 테이블(wins/losses/draws/penalties)에 호스트가 1회만 더함.
- 게임 회차 전환 시 직전 회차 스냅샷을 `rpsRoundStatsArchive:{roomCode}`(localStorage)에 보관.
- 게임 종료 시 `rpsLastCompletedGame`(localStorage)에 방 전체 결과 스냅샷 저장.
- 로그인 사용자는 `recordMyAccountGameResult()`로 Supabase `user_game_stats`/`user_game_history`에 누적.

---

## 4. 데이터 구조 변경 사항

### choice 인코딩 (스키마 변경 없이 하위호환)
participants 테이블의 **기존 `choice` 컬럼**에 다음 형식으로 저장:
```
"scissors"               // 선택만
"scissors|win"           // 선택 + 판정결과
"scissors|win|auto"      // + 자동선택 플래그
"scissors|auto"          // 결과 전 자동선택
```
- `parseRoundChoice()`가 세그먼트를 위치 무관하게 스캔 → `{choice, result, auto}` 반환.
- **레거시 행(플래그 없음)은 auto:false로 처리** → 완전 하위호환. DB 마이그레이션 불필요.

### localStorage 키
| 키 | 용도 |
|---|---|
| `rpsLastCompletedGame:{scope}` | (신규) 직전 완료 게임 스냅샷 |
| `rpsRoundStatsArchive:{roomCode}:{scope}` | 방별 라운드 누적 보관 |
| `rpsPartyState:{scope}` | 진행 중 게임 state(재접속용). 새 방 진입 시 정리 |
| `rpsRecentRoomCodes`, `rpsNickname`, `rpsLocale`, `rpsAuthState`, `rpsMuted` 등 | 기존 |

### room state / round state
- `room.status`: `waiting → lobby/ready → playing → result/game_over → stats` (재대결 시 `reinviting`/`ready` 등)
- `room.round`: 재대결(rematch) 회차. `state.gameRound`: 게임 회차(penalty에 인코딩).
- `state.confirmedSafeIds` / `confirmedLoserIds`: 확정 안전/술래. `__safe__`/`__loser__`/`__waiting__`는 비플레이 마커.
- **신규**: `resetRoomLocalState()`가 createRoom/joinRoom 시 위 라운드/선택/판정/타이머/오버레이 상태와 stale `rpsPartyState`를 정리.
- **Supabase 스키마 변경 없음** (이번 작업은 전부 클라이언트 측).

---

## 5. 다음 작업 우선순위

### 즉시 해야 할 일
1. **실기기 멀티디바이스 QA** (특히 P1.5 호스트가 빠지는 재대결에서 판정 멈춤 없는지)
2. iOS `CURRENT_PROJECT_VERSION`을 **3**으로 증가
3. (사용자 결정) 현재 워킹트리 변경을 **커밋할지** 결정 — 지금까지 모든 세션에서 "커밋하지 마" 지시였음

### 권장 작업 순서
1. `npm test && npm run build && npx cap sync ios`로 빌드 무결성 재확인
2. Xcode에서 Team/서명 연결 → Simulator/실기기 실행
3. `QA_BACKLOG.md`의 테스트 시나리오 1~10 수행
4. 이슈 없으면 Build 3 Archive → Validate → TestFlight 업로드
5. 내부 테스터 smoke test

### 예상 리스크
- **P1.5는 런타임 동작**이라 단위 테스트로 끝까지 검증 불가 → 실기기 재현 필수.
- 호스트 백스톱 11초는 카운트다운+선택(~8초) 기준 버퍼. 카운트다운 타이밍 변경 시 재조정 필요.
- choice 문자열 인코딩에 의존 → `parseRoundChoice`/`encodeRoundChoice` 외의 곳에서 `choice`를 직접 비교/파싱하면 깨질 수 있음.
- 다수의 토스트가 여전히 한글 하드코딩(영문 모드 미정리분 잔존).
- P2.10/11 UI는 화면 직접 확인 미완 → 실기기 시각 점검 필요.

---

## 6. 작업 시 반드시 지킬 제약 (매 세션 반복된 지시)
- ❌ `ios/App/App/.../QRScannerPlugin.swift` 수정 금지
- ❌ Xcode signing 설정 변경 금지
- ❌ `git commit` 금지 (명시적 허락 전까지)
- ✅ 수정 후 항상 `npm test` → `npm run build` → `npx cap sync ios` 실행
- ✅ 새 i18n 키는 ko/en/ja 3개 모두 추가

---

## 7. 핵심 함수 위치 빠른 참조 (`index.html`)
| 함수 | 역할 |
|---|---|
| `parseRoundChoice` / `encodeRoundChoice` / `isAutoChoice` | choice 인코딩/파싱 |
| `judgeRound` | 단일 판정 함수 |
| `publishHostRoundResult` | 호스트 authoritative 판정·저장 |
| `autoFillChoices` / `startHostJudgeBackstop` | 자동선택 / 빠진 호스트 백스톱 |
| `buildRoomStatsSummary` / `saveLastCompletedGameResult` / `getStatsViewData` | 기록 집계/저장/조회 |
| `resetRoomLocalState` | 새 방 진입 시 잔류 상태 정리 |
| `handleRoomUpdate` / `fetchParticipants` | Realtime/폴링 상태 반영·판정 트리거 |
| `renderRoundResult` / `showStatsPopup` / `renderStats` | 결과/승률 렌더(자동 라벨 포함) |
