# CHANGELOG — Build 3 (준비 중)

> Version 1.0 / Build 2 → **Build 3** (CURRENT_PROJECT_VERSION을 3으로 올린 뒤 업로드)
> 작성일: 2026-06-12 / 상태: **워킹트리 미커밋**
> 변경 파일: **`index.html` 단독** (빌드 산출물 `dist/`, `ios/App/App/public/`은 자동 갱신)

`git diff --stat index.html` → 약 2,866 insertions / 789 deletions (3개 QA 세션 누적, 모두 미커밋)

---

## 수정 파일

### `index.html` (유일한 소스 변경 파일)
- **목적**: 게임 판정 정확도, 게임 기록 안정화, 방 상태 복구, Safe Area, UI 문구/레이아웃 QA 안정화
- 영역: 인라인 `<script>`(게임 로직), `<style>`(CSS), i18n ko/en/ja 블록

> 그 외 `git status`에 보이는 `.gitignore`, `docs/APP_STORE_READINESS.md`, `oauth-bridge.html`, `package.json`, `scripts/build-web.mjs`, `ios/`, `ASSETS/`, `docs/*.md` 등은 **이번 QA 세션 이전부터** 있던 미커밋/미추적 변경이며 이번 작업 범위 아님.

---

## 주요 변경 내용

### P0 — 판정/기록 (필수)
1. **자동선택 판정 오류 수정**
   - `autoFillChoices()`: DB 재조회 후 빈 선택만 채워 **기제출 선택 덮어쓰기 방지**. 호스트만 수행.
   - choice 인코딩 도입: `base | base|result | base|result|auto | base|auto`
     - 신규/수정: `parseRoundChoice`(세그먼트 위치 무관 스캔, `{choice,result,auto}`), `isAutoChoice`, `encodeRoundChoice(choice,result,auto)`, `randomRoundChoice`
   - 판정은 `judgeRound`(무승부=1·3종류, 승패=2종류) 단일 함수, `publishHostRoundResult`에서 호스트만 1회.
2. **게임 중 승률 보기 전체 라운드 집계**
   - 신규: `getRoomStatsArchive`, `buildRoomStatsSummary(roomCode, live)`, `getStatsViewData`
   - `showStatsPopup`/`renderStats`가 roomCode 기준 누적 합산 사용.
3. **직전 게임 결과 영구 저장/조회**
   - 신규: `saveLastCompletedGameResult`, `getLastCompletedGameResult`, `persistCompletedGameWithRetry`
   - `endGame`에서 `rpsLastCompletedGame` 저장(실패 시 토스트+재시도), 홈 버튼이 스냅샷 로드.

### P1 — 안정화
4. **stale state 정리**: 신규 `resetRoomLocalState()` → `createRoom`/`joinRoom` 시작 시 라운드/선택/판정/타이머/오버레이/`rpsPartyState` 정리(같은 방 재접속 저장본 보존).
5. **3인 판정 멈춤 수정**: 신규 `startHostJudgeBackstop()` — 빠진 호스트도 `getCountdownStartAt()+11s`(serverNow)에 판정 보장. `runCountdownThenShowGame`/`showGameScreen`의 sitting-out 분기에서 호출.
6. **자동선택 라벨**: `renderRoundResult` 결과 카드에 `isAutoChoice` 시 "자동" 칩. i18n `tag.auto`(자동/Auto/自動), CSS `.tag.auto`.
7. **Safe Area**: `body`/`.app` `100dvh` 폴백, `.footer-actions`·`.popup-card`·`.popup-overlay` `env(safe-area-inset-*)`.

### P2 — UI/문구
8. 호스트 표시: `getParticipantBadge`가 호스트 우선 → "👑 호스트" (이미 정상, 검증).
9. 결과 문구 통일: `result.titleSurvived` → **승리!/Win!/勝利！** (ko/en/ja).
10. 참가자 카드: 라운드 결과 목록 **1열 풀폭**, 이름 굵게 + 선택 아이콘·자동·결과 한 줄(CSS specificity 보정).
11. 레이블 크기: `.compact-info-row .label` 12px/700, 값 strong 16px·벌칙 17px 유지.
12. 상태 문구 i18n화: 신규 키 `ready.rematchStart`, `ready.waitingNextGame`, `ready.safeFirst`, `ready.waitingShort` (ko/en/ja). 하드코딩 한글 제거.
13. 영어 UI: 위 i18n화로 게임/역할 문구 정리(토스트류 일부 미정리).

---

## 추가된 i18n 키 (ko/en/ja 전부)
- `tag.auto`
- `stats.empty`, `stats.emptyRecent`, `stats.saveFailed`
- `ready.rematchStart`, `ready.waitingNextGame`, `ready.safeFirst`, `ready.waitingShort`

## 데이터/스키마
- **Supabase 스키마 변경 없음.** isAutoSelected는 기존 `choice` 컬럼 인코딩에 포함(하위호환, 레거시=false).
- 신규 localStorage 키: `rpsLastCompletedGame`.

## 검증
- `npm test` ✅ / `npm run build` ✅ / `npx cap sync ios` ✅
- 판정·인코딩 로직 단위 테스트 통과(2인/3인/2·3종류/자동 혼합/하위호환).
- QRScannerPlugin.swift·signing·pbxproj 미변경, 커밋 안 함.

## 업로드 전 TODO
- [ ] `CURRENT_PROJECT_VERSION` 2 → **3**
- [ ] 실기기 회귀 테스트(QA_BACKLOG 시나리오 1~12, 특히 4·11번)
- [ ] (사용자 결정) 워킹트리 커밋 여부
- [ ] Archive → Validate → TestFlight 업로드
