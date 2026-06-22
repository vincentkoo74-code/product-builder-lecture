# 🧩 FEATURE DECISION HISTORY — 기능 의사결정 이력

> **버그가 아닌 기능(Feature) 사양의 도입/변경/폐기 이력**을 영구 추적한다.
> 기능 사양을 바꿀 때마다 해당 기능 블록에 **한 줄 추가**(기존 줄 수정 금지). 버그는 `BUG_MASTER_LEDGER.md`로.
> 최초 복원: 2026-06-22 · 근거: git log 전체 + FIXES/QA/GAME_LOGIC/BUILD4·5 문서

상태 값: **활성**(현재 동작) · **폐기**(과거 동작, 대체됨) · **실험**(격리/미활성) · **미머지**(분기에만 존재)

---

## 1. 자동 시작 (Auto-Start) — ⚠️ 3회 번복

| 기능 | Build | 결정 | 승인 | 이유 | 관련 문서/커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| 자동 시작 | Build1/2 | 도입 | 승인 | round>1 전원 ready 시 자동 진행(UX) | `899ed5c`, `3c0ee3a` | **폐기** |
| 자동 시작 | pre-Build3 (06-06) | 제거 | 승인 | 호스트 미클릭 오동작 → 수동 버튼 | `FIXES.md`, `GAME_LOGIC.md §3/§11` | **폐기** |
| 자동 시작 | Build4 (06-13) | 재도입 | QA 승인 | 활성 전원 Ready 시 자동시작+마지막 Ready 트리거 | `BUILD4_P0_QA_MATRIX` 항목3, `triggerReplayIfLastReady`(7879) | **활성** |
| 자동 시작 | Build4~ | 가드 추가 | 승인 | 중복시작 방지 | `autoStartInFlight`, `areAllActivePlayersReady`(4505) | **활성** |
| 시작 트리거 통일 | Build8.2(예정) | **호스트 시작 버튼 폐지 + 호스트 포함 전원 Ready 트리거** | 사양 확정(2026-06-22) | 2인전 등에서 호스트 시작 버튼 흐름 혼란 → 전원 Ready 단일화 | WRPS-042, §11 | **확정(미구현)** |
- 연계 버그: WRPS-011, WRPS-037(stale 오발화 위험), WRPS-041(GAME_LOGIC.md 문서 드리프트 — Build8.1 해소), **WRPS-042(전원 Ready 통일 — Build8.2)**.

## 2. 호스트 승계 (Host Succession)

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| 호스트 이탈 시 승계 | Build2 | 도입 | 승인 | 호스트 떠나면 게임 지속 불가 방지 | `09b1681`(host transfer on leave) | **활성** |
| 미지정 시 랜덤 승계 | Build2 | 도입 | 승인 | 다음 호스트 미선택 대비 | `dbb459a` | **활성** |
| 승계 race 가드 | Build2 | 보강 | 승인 | 게임완료 후 호스트 전환 경쟁 | `eb54a86` | **활성** |
| 다음 호스트 지정 팝업 | 현재 | 유지 | 승인 | 비호스트 존재 시 leave 전 지정 | `showNextHostPopup`(leaveRoom 7984) | **활성** |

## 3. QR 입장 (QR Join)

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| QR 파티 입장 | Build1 | 도입 | 승인 | 핵심 컨셉(QR로 모임) | `32cd8e8` | **활성** |
| 실제 QR 생성 | Build1/2 | 도입 | 승인 | placeholder→실 QR | `ad20c9c` | **활성** |
| jsQR 폴백 | Build3~ | 도입 | 승인 | iOS WKWebView `BarcodeDetector` 미지원 | `index.html`(jsQR 벤더) | **활성** |
| 방코드 수동 입장 | Build1/2 | 도입 | 승인 | QR 불가 환경 대비 | `joinRoom` | **활성** |

## 4. 재게임 초대 (Replay Invite / Reinviting)

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| 탈락자 재초대 | Build2 | 도입 | 승인 | 종료 후 다시 모으기 | `9477f87`(notify recent players) | **활성** |
| reinviting 상태+팝업 | Build2~ | 도입 | 승인 | `status=reinviting`→invitePopup→카운트다운→`ready` | `showInvitePopupForRoom`, `acceptInvite`(7327) | **활성** |
| 중복 초대 정리 | Build2 | 보강 | 승인 | stale 중복 프로필 정리 | `b2fc022`, `fa67af8` | **활성** |
- ⚠️ 연계 버그: **WRPS-013**(수락 후 ready인데 대기화면 고착) — 본류 미반영, P0.

## 5. 다중 술래 (Multi-Loser / Target Loser Count)

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| 목표 술래 수 + 토너먼트 | Build2 | 도입 | 승인 | 술래 N명 소거전 | `231cd75` | **활성** |
| 활성 라운드 중 술래수 잠금 | Build2 | 도입 | 승인 | 진행 중 변경 방지 | `2079b4c` | **활성** |
| 술래 상한 = 비호스트−1 | Build4 | 수정 | 승인 | 호스트 포함 계산 deadlock 제거 | `BUILD4`(WRPS-035) | **활성** |
| ready 상태 술래수 편집 | Build5 | 허용 | 승인 | 벌칙설정 후에도 편집 | `isLoserCountEditable`(WRPS-039) | **활성** |

## 6. 게임 기록 (Game Records / Stats)

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| 참가자 누적 전적 | Build1/2 | 도입 | 승인 | 승/패/무/벌칙 집계 | participants 테이블 | **활성** |
| 계정 전적(Supabase) | Build2 | 도입 | 승인 | 로그인 사용자 영구 기록 | `0d2a0d7`(user_game_stats/history) | **활성** |
| 직전 게임 영속 | Build3 | 도입 | 승인 | 종료 후 홈에서 직전 결과 | `rpsLastCompletedGame`(WRPS-024) | **활성** |
| 전체 라운드 승률 집계 | Build3 | 도입 | 승인 | 현재 라운드만 표시 버그 해소 | `buildRoomStatsSummary`(WRPS-023) | **활성** |
| 회차 스냅샷 보관 | Build3 | 도입 | 승인 | 게임 회차 전환 시 보관 | `rpsRoundStatsArchive` | **활성** |

## 7. Firebase Auth / 8. Anonymous Login (Build8 마이그레이션)

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| Firebase compat SDK 통합 | Build8 | 도입 | 격리 | Supabase→Firebase 점진 이행 준비 | `9797a0c`, `82d7f57` | **실험(격리)** |
| Anonymous Login(Build8) | Build8 | 도입 | 격리 | 익명 인증 PoC | `ASSETS/build8/client.js` | **실험(격리)** |
| 디버그 진입점 게이팅 | Build8 | 도입 | 승인 | `b8debug` 플래그 없이는 비활성 | `index.html`(+36줄) | **활성(격리 보장)** |
- 기존 인증(게스트 + SNS Google/Apple/Kakao/LINE, Supabase Auth)은 **활성** 유지(`5bebaff`, `9d0200d` 등). Build8 Auth는 평상시 미동작.

## 9. Lobby System

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| 게임루프+로비 관리 | Build1/2 | 도입 | 승인 | Phase2 라운드 간 대기 | `b0b11b1` | **활성** |
| 죽은 로비 코드 정리 | Build2 | 정리 | 승인 | 미사용 경로 제거 | `d94eaba` | **활성** |
| 로비 자동시작 | pre-Build3 | 제거 | 승인 | 호스트 수동 전환 | `FIXES.md` | 자동시작 정책(§1) 따름 |

## 10. 기타 주요 기능

| 기능 | Build | 결정 | 승인 | 이유 | 관련 커밋 | 현재 상태 |
|---|---|---|---|---|---|---|
| SNS 로그인(한·일·미) | Build2 | 도입 | 승인 | Google+Apple+Kakao+LINE(WeChat 제거) | `38dd4e1`, `465587c` | **활성** |
| i18n KO/EN/JA | Build2 | 도입 | 승인 | 다국어 시장 | `9245f3b`~`b267401` | **활성** |
| TTS 음성 카운트다운 | Build1/2 | 도입 | 승인 | "안내면 술래" 연출 | `7d86d6d` | **활성**(단 WRPS-014 참가자 무음) |
| 자동선택 타임아웃 | Build1/2 | 도입 | 승인 | 미선택자 5초 후 랜덤 | `autoFillChoices` | **활성** |
| 게임 타입(단판/삼세판/5판3승) | 실험 | 도입 | 미승인 | 세트 개념 | `67e34b6`(origin/agents/yesterday-work-review) | **미머지(실험)** |
| 마루 캐릭터/색동 리디자인 | 실험 | 도입 | 부분 | Auth/Home 키비주얼 | `678c7a4`(origin/ui-redesign) | **미머지(실험)** |

---

## 11. WRPS-042 — 전원 Ready 기반 시작 트리거 통일 (사양 확정 2026-06-22, Build8.2 구현)

### 확정 사양
1. 호스트는 **벌칙 설정 권한만** 가진다.
2. 벌칙 설정 후 **호스트 포함 모든 플레이어**가 각자 게임 준비 버튼을 누른다.
3. 모든 active player가 ready가 되면 **마지막 ready 액션이 게임 시작 트리거**가 된다.
4. **별도 호스트 게임 시작 버튼은 사용하지 않는다.**
5. 재게임에서도 동일 적용.
6. 호스트 고유 권한 = 벌칙 설정 · 한번더/재게임 요청 · 방 관리/승계.

### 현재 코드와의 차이 (불일치 확인됨)
- 호스트가 `computePlayerStatuses`에서 `HOST`로 분류되어 **active/ready 게이트에서 제외**됨.
- `showReadyScreen`이 호스트에게 **시작 버튼(`hostStartBtn`) 노출, 준비 버튼 숨김**.

### Build8.2 구현 옵션 (구현 전 제품 확정 필요)
- **옵션 A (호스트=완전 플레이어)**: `computePlayerStatuses`에서 호스트도 `ACTIVE`로. 호스트가 가위바위보 참여·술래 대상 포함. → **elimination/술래 상한/판정/`elimination.test.mjs`(39) 전면 재검증** 필요. 고위험.
- **옵션 B (호스트=ready만, 비참여 심판)**: 호스트는 게임 준비 버튼을 누르고 ready 게이트에 포함되지만, 소거/술래 대상에선 계속 제외(심판). `showReadyScreen` 버튼만 교체 + ready 게이트에 호스트 포함. → 중위험, elimination 무영향. **권장 후보**.
- 공통 정리 대상: `hostStartBtn`(HTML 2627·ref 6262·showReadyScreen 7803/7807·`updateHostStartButton` 7851), `lobbyHostStartBtn`(HTML 2602·ref 9468), i18n `ready.hostStart`/`ready.rematchStart`, `startGame`/`startFromLobby` 버튼 onclick.
- ⚠️ 옵션 A/B 중 **게임 모델(호스트가 가위바위보를 내는가) 확정** 후 구현. `KNOWN_BEHAVIORS.md` 경계 항목과 직접 연결.

---

## 의사결정 기록 규칙 (Build9+)
1. 기능 사양을 **바꾸기 전** 이 문서에서 과거 결정 이력을 확인(특히 자동시작처럼 번복 이력 있는 항목).
2. 결정 시 한 줄 추가: 기능 | Build | 결정 | 승인주체 | 이유 | 근거문서 | 상태.
3. 폐기/번복 시 이전 줄의 `현재 상태`를 **폐기**로 갱신(줄 삭제 금지 — 이력 보존).
4. 코드와 문서가 어긋나면 `BUG_MASTER_LEDGER.md`에 문서 드리프트(WRPS-041류)로 등록.
