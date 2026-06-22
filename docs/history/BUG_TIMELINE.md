# 📅 BUG TIMELINE — Build별 QA 히스토리

> Build별 QA·디버그 이력 누적 문서. 새 Build를 낼 때마다 섹션을 **추가**한다(기존 섹션 수정 금지, 정정은 추가 메모로).
> 최초 복원: 2026-06-22 · 근거: git log 전체 + FIXES.md/QA_BACKLOG/CHANGELOG_BUILD3/BUILD4·5 QA/ GAME_LOGIC.md / fix-game-ready-button CLAUDE.md

ID는 `BUG_MASTER_LEDGER.md`의 `WRPS-NNN`을 참조한다.

---

## Build 1 / Build 2 — 초기 출시 & 1차 안정화 (~2026-06-02)

- **버전**: 1.0 (build 2 = 첫 TestFlight 업로드).
- **단위**: 단일 파일 `index.html`(~9천 줄) 인라인 스크립트.
- **주요 디버그(2026-05-19~05-21, main 트렁크)**:
  - WRPS-005 화면 깜빡임(폴링이 3초마다 is_ready 리셋) — `0d184b5`, `a541007`
  - WRPS-006 호스트 활성참가자 제외/포함 혼란(게임 멈춤) → 심판 모델 확정 — `dcbafda`, `19263cd`
  - WRPS-008 호스트 게임화면 미표시 + 참가자 5초 타이머 무동작 — `ed21c83`
  - WRPS-007 호스트 벌칙 수정 시 참가자 미동기화 — `459c210`
  - WRPS-010 다음게임 호스트 5초 카운트다운 자동진행 차단 — `713eb4d`
  - WRPS-011 무승부 후 자동 재경기 제거(→수동) — `fce00c7`, `3c0ee3a`
  - WRPS-009 게임완료 후 호스트 로비우회 복귀 + 호스트전환 race — `eb54a86`
- **pre-Build3 마감(2026-06-04~06-06, FIXES.md/GAME_LOGIC.md)**:
  - WRPS-001 모달 버튼 텍스트 정렬
  - WRPS-002 모든 라운드 시작 로직 통일 + 호스트 `gameStarting` 타이밍 수정
  - WRPS-003 통계 이중집계 차단(`hasConfirmedRoundResult`)
  - WRPS-004 첫 대결 game_over 오판(`prevLoserIds` 오염) 수정
  - **자동시작 제거 → 호스트 수동 시작 버튼**(GAME_LOGIC.md §3 "자동 시작 로직 완전 제거") ← ⚠️ Build4서 번복됨(WRPS-037)

### ⚠️ Build2 시기의 폐기 분기 — Lineage A (`claude/fix-game-ready-button-bl7zf`, 2026-05-18)
`b07d0e3`에서 분기해 replay/countdown 버그 7건을 수정했으나 **본류에 한 번도 머지되지 않음**. 이후 Build3~6은 이 분기를 모른 채 같은 버그 일부를 독립 재구현. 누락분이 현재 LIVE 후보 버그(WRPS-013/014 등).
- WRPS-012 replay 후 ready버튼 깜빡임 · WRPS-013 재초대 수락 후 대기화면 고착 · WRPS-014 참가자 TTS 미재생 · WRPS-015 카운트다운 시차 · WRPS-016/017 round=1 stale choice · WRPS-018 participantWait 안전망 · WRPS-019 드롭 정리 · WRPS-020 INSERT 병합 · WRPS-021 자동 로그아웃

---

## Build 3 — QA 안정화 (2026-06-12, iOS build 2→3)

- **문서**: `PROJECT_CONTEXT.md`, `QA_BACKLOG.md`, `CHANGELOG_BUILD3.md`
- **피드백 출처**: TestFlight Build 1.0(2) 사용자 피드백
- **해결(BUG-01~13 → WRPS-022~034)**:
  - P0: WRPS-022 자동선택 무승부 오표시 / WRPS-023 승률 현재라운드만 / WRPS-024 직전게임 결과 미기록
  - P1: WRPS-025 새 방 상태 잔류 / WRPS-026 3인 호스트빠짐 프리즈 / WRPS-027 자동선택 라벨 / WRPS-028 safe-area 잘림
  - P2: WRPS-029~033 UI/문구/i18n / WRPS-034 영어 UI 잔존 한글
- **미해결로 이월**: OPEN-01(WRPS-026 실기기), OPEN-02(WRPS-034 토스트), OPEN-03(P2 UI 시각), OPEN-04(roundId/selectedAt 스키마)
- **검증**: `npm test`(문법)·build·cap sync 통과. 멀티디바이스 실기기 미완.

---

## Build 4 — 다인전 멀티디바이스 (2026-06-13)

- **문서**: `docs/BUILD4_P0_QA_MATRIX.md`
- **해결**:
  - WRPS-035 술래 수 상한 deadlock(호스트 포함 계산) → 상한=비호스트−1
  - 술래 소거 루프 전 조합 수렴(`tests/elimination.test.mjs`)
- **설계 변경(중요)**: **WRPS-037 자동 시작 정식 재채택** — 매트릭스 항목 3 "활성 전원 Ready 시 자동 시작 + 마지막 Ready가 트리거". → 2026-06-06의 "자동시작 제거"를 번복. `GAME_LOGIC.md`는 미갱신 → **WRPS-041 문서 드리프트** 발생.
- **미완**: 9조합 × 6동작 = 54셀 실기기 매트릭스 빈칸(WRPS-036).

---

## Build 5 — 드롭다운 프리즈 + 테스트 인프라 (2026-06-14, iOS build 3→5)

- **문서**: `docs/BUILD5_QA_SPEC_QWEN-BULK.md`, `src/game-logic.mjs`, `tests/`
- **해결**:
  - WRPS-038 **BLOCKER-001** 술래 숫자 드롭다운 프리즈(iOS WKWebView 네이티브 피커가 열린 동안 `innerHTML` 재생성으로 프리즈) → 시그니처(`max|locale`) 변경 시에만 재생성 + 피커 포커스 중 갱신 보류(`activeElement===sel`).
  - WRPS-039 ready 상태에서 술래 수 편집 불가 → `isLoserCountEditable`에 `"ready"` 추가.
- **인프라**: 게임 로직 단일소스 `src/game-logic.mjs` ↔ index.html(`scripts/sync-game-logic.mjs`), vitest 39케이스.
- **위임**: Qwen-Bulk에 대량 케이스(목표 ≥253 검증 항목) 생성 명세. 산출물 7종(BUILD5_P0_QA_MATRIX 등)은 **현재 저장소에 미존재**(생성 미완 또는 미반영).

---

## Build 6 — TestFlight Live 스냅샷 (2026-06-21, iOS build 6)

- **커밋**: `ded6154` "snapshot: build6 working tree (TestFlight live, pre-Build8 migration)"
- Build3~6의 모든 미커밋 워킹트리를 **단일 커밋으로 박제**(증분 이력 없음).
- 게임 로직: `serverNow`/`countdownStartAt`/`areAllActivePlayersReady`/`autoStartInFlight` 기반의 진화한 ready/start/countdown 구현 포함.
- **이 스냅샷이 현재 LIVE 기준선.** WRPS-013/014/015 등 Lineage A 누락분이 이 시점에 이미 미반영.

---

## Build 7 / Build 8 — Firebase 마이그레이션 (2026-06-21, build 6→7)

- **브랜치**: `build8-client-migration` (현재 작업 브랜치 `fix/build6-regression-recovery`가 동일 HEAD `35cd68d`)
- **커밋**: `9797a0c`(Firebase compat 벤더+Build8 client 스캐폴딩) → `82d7f57`(index.html 통합) → `87e55df`(config) → `35cd68d`(build 6→7)
- **index.html 변경 = 단 +36줄(2 hunk)**: ① Firebase SDK `<script>`×4 + ② `b8debug` 플래그로 가린 디버그 버튼. **게임 로직 무변경(build6과 byte 동일)**.
- **WRPS-040: 회귀 0.** Build8 클라이언트(`client.js`)는 `Build8.test()` 수동 호출 시에만 동작.
- 즉, 현재 체감되는 "자동시작/카운트다운 시차"는 build8이 만든 게 아니라 build6부터 잠재(WRPS-013/014/015/037).

---

## Build 8.1 — Lineage A 누락분 선별 이식 + 문서 정합 (2026-06-22)

- **브랜치**: `fix/build6-regression-recovery` (build8 기반)
- **성격**: 전체 머지 금지, **국소 패턴만 선별 이식**(no full Lineage A merge).
- **코드 수정 (index.html)**:
  - **WRPS-014** `markReady()` — 모바일 user-gesture 컨텍스트에서 `speechSynthesis` 빈 발화 사전 언락 → 참가자 단말 카운트다운 TTS 재생.
  - **WRPS-013** `acceptInvite()` — status=ready면 `showReadyScreen()`로 진입(대기화면 고착 방지).
  - **WRPS-018** `fetchParticipants()` — 3초 폴링 복구 안전망(ready인데 participantWait 고착 시 준비화면 복구).
- **문서 수정**:
  - **WRPS-041** `docs/GAME_LOGIC.md` §3/§11 — 자동시작 Build4 재채택 정정(문서 드리프트 해소).
- **검증**: 인라인 `<script>` 블록별 문법 OK(2블록), `npm test` 39/39, `npm run build:web` OK, `npx cap sync ios` OK.
  - ⚠️ `npm run test:syntax`(greedy 정규식)는 **build8 마이그레이션 때부터** bare `<script>` 2블록을 한 덩어리로 잡아 실패 — 본 수정과 무관한 기존 결함(별도 개선 필요).
- **미해결 이월**: WRPS-013/014는 **실기기 검증 대기**(코드 수정 완료, RELEASE 체크리스트 3절 통과 시 종결).

---

## (다음) Build 9+ — 여기에 누적

> 새 Build 작업 시작 시 이 아래에 섹션 추가. 형식: 신규 버그 / 해결 버그 / 재발 / 미완 검증 / 릴리즈 판정.
