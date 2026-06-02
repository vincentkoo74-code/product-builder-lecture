# 마루의 가위바위보 코드 색인

이 문서는 `index.html` 중심 앱을 나중에 기능별 파일로 나눌 때 쓰는 기준표다. 현재는 앱스토어 제출 안정성을 위해 동작 검증된 단일 파일 구조를 유지하고, 기능 경계를 먼저 문서로 고정한다.

## 현재 진입점

| 영역 | 파일 | 역할 |
|---|---|---|
| 앱 본체 | `index.html` | 화면, 스타일, i18n, 게임 로직, Supabase 연동 |
| Capacitor 설정 | `capacitor.config.ts` | iOS/Android 앱 래퍼 설정 |
| 웹 빌드 | `scripts/build-web.mjs` | `index.html`, 정적 파일, 정책 페이지를 `dist/`로 복사 |
| Android 빌드 보조 | `scripts/cap-sync-android.mjs`, `scripts/android-gradle.mjs` | Android sync/Gradle 실행 보조 |
| Supabase 함수 | `supabase/functions/*` | Kakao/LINE OAuth, 계정 삭제 |
| DB 마이그레이션 | `supabase/migrations/*` | 계정 승률/게임 기록 테이블과 RLS |

## 화면별 색인

| 화면 ID | 사용자 화면 | 주요 함수 |
|---|---|---|
| `screenAuth` | 로그인/게스트 선택 | `loginWithSns`, `playAsGuest`, `handleKakaoCallback`, `handleLineCallback` |
| `screenHome` | 홈, 방 만들기, QR 입장 | `createRoom`, `showQrScanner`, `showJoinScreen` |
| `screenQrScanner` | QR 스캔 | `showQrScanner`, `stopQrScanner`, `extractRoomCodeFromQr` |
| `screenHostRoom` | 호스트 방/QR/벌칙/술래 수 | `showHostRoom`, `savePenalty`, `onLoserCountChange`, `renderQr` |
| `screenJoin` | 방 참가/지난 방 재입장 | `joinRoom`, `getJoinRoomPreview`, `requestReplayFromJoinedRoom` |
| `screenParticipantWait` | 참가자 대기 | `handleRoomUpdate`, `renderParticipants` |
| `screenLobby` | 새 게임 준비 로비 | `renderLobby`, `markReadyFromLobby`, `startFromLobby` |
| `screenReady` | 재대결 준비 | `showReadyScreen`, `markReady`, `triggerReplayIfLastReady` |
| `screenGame` | 가위/바위/보 선택 | `showGameScreen`, `selectChoice`, `beginRoundTimer` |
| `screenHostPlaying` | 호스트 진행 관전 | `showHostPlayingScreen`, `hostJudgeRound`, `autoFillChoices` |
| `screenRoundResult` | 라운드 결과/최종 술래 | `finishRoundLocal`, `renderRoundResult`, `nextRound`, `endGame` |
| `screenWinnerWait` | 생존자 대기 | `isSafeParticipant`, `handleRoomUpdate` |
| `screenLoserWait` | 확정 술래 대기 | `showLoserWaitScreen`, `isConfirmedLoser` |
| `screenStats` | 방 결과 | `showStats`, `renderStats`, `inviteForReplay` |
| `onboardingPopup` | 첫 사용자 안내 | `showOnboardingGuide`, `closeOnboardingGuide` |

## 기능별 색인

| 기능 | 주요 함수/상태 | 분리 후보 파일 |
|---|---|---|
| 상태 관리 | `state`, `saveState`, `loadState`, `clearRealtime` | `src/state.js` |
| i18n | `i18n`, `t`, `applyI18n`, `setLocale` | `src/i18n.js` |
| Supabase 방/참가자 | `subscribeToRoom`, `fetchParticipants`, `updateRoomStatus`, `cleanupDuplicateRoomProfiles` | `src/supabase-room.js` |
| 게임 판정 | `judgeRound`, `finishRoundLocal`, `getWinningChoice`, `isCurrentRoundParticipant` | `src/game-engine.js` |
| 라운드/로비 | `nextRound`, `startGame`, `startFromLobby`, `markReady` | `src/round-flow.js` |
| QR/참가 | `renderQr`, `showQrScanner`, `joinRoom`, `getJoinRoomPreview` | `src/join-flow.js` |
| 인증 | `loginWithSns`, `handleKakaoCallback`, `handleLineCallback`, `deleteAccountWithConfirm` | `src/auth.js` |
| 계정 기록 | `recordMyAccountGameResult`, `showAccountStatsPopup` | `src/account-stats.js` |
| 오디오/햅틱 | `speak`, `playFanfare`, `playFinalFanfare`, `playButtonClickSound` | `src/device-feedback.js` |
| UI 렌더 | `showScreen`, `renderAll`, `renderParticipants`, `renderGameProgress` | `src/ui-render.js` |

## 리팩터링 순서

1. `i18n`과 순수 유틸 함수부터 분리한다. 앱 상태와 DOM 부작용이 적어 가장 안전하다.
2. `game-engine`을 분리한다. 입력/출력을 객체로 제한하고 Supabase 호출을 넣지 않는다.
3. Supabase 읽기/쓰기 래퍼를 만든다. 모든 DB 호출은 이 파일만 통과하게 한다.
4. 화면 렌더러를 화면별 파일로 나눈다.
5. 마지막에 `index.html`의 inline `onclick`을 이벤트 바인딩으로 바꾼다.

## 주의

- 현재 정상 확인된 앱을 앱스토어에 올리기 전에는 대규모 파일 분할을 한 번에 진행하지 않는다.
- 분리 작업은 `npm.cmd run test`, `npm.cmd run build:web`, Android sync, 실제 QR 멀티기기 테스트가 모두 통과할 때만 병합한다.
