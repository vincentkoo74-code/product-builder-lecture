# Build 5 QA 작업 명세 — 위임 대상: Qwen-Bulk

> 발주: Claude (Opus 4.8, 오케스트레이터) · 작성일 2026-06-14
> 위임 대상: **Qwen-Bulk** (대량 테스트 케이스 열거/매트릭스 생성 워커)
> 대상 빌드: **Build 5** (iOS Build 번호 3→5 승격 예정, Android 병행)
> 산출물 저장 위치: `docs/BUILD5_*` 및 `tests/build5/*`

---

## 0. 컨텍스트 (위임 시 반드시 전달)

- 앱: 단일 파일 `index.html` 기반 멀티플레이 가위바위보(마루의 가위바위보). Capacitor로 iOS/Android 패키징.
- 역할 모델: **호스트 = 심판**(가위바위보를 내지 않음). "참가자 N명" = **비호스트 플레이어 수**.
- 핵심 규칙: 술래 소거전. 술래 수 상한 = **비호스트 수 − 1**. 술래 확정자는 재게임에서 제외.
- 동기화: Supabase Realtime(`postgres_changes`) + presence + 5초 폴링 백업.
- 로케일: **KO / EN / JA** 3종.
- 판정/소거/전적 로직 단일 소스: `src/game-logic.mjs` ↔ `index.html` 내장 스크립트(동기화 스크립트 `scripts/sync-game-logic.mjs`).
- 단위 테스트: `npm test`(vitest, 현재 39 케이스 통과), 문법: `npm run test:syntax`.

### Build 5 신규/변경 회귀 포인트 (Build 4 대비)
- **BLOCKER-001 (술래 숫자 드롭다운 프리즈) 수정됨** — 반드시 회귀 검증:
  - 원인: `updateLoserCountDropdown()`이 매 `renderAll()`(폴링/Realtime/presence)마다 `<select>.innerHTML`을 파괴·재생성 → iOS WKWebView 네이티브 피커가 열린 동안 프리즈.
  - 수정: 옵션 시그니처(`max|locale`) 변경 시에만 DOM 재생성, 피커 포커스 중(`document.activeElement === sel`)에는 갱신 보류.
  - 부수 수정: `isLoserCountEditable()`에 `"ready"` 상태 추가 → 벌칙 설정 후(게임 시작 전)에도 술래 숫자 편집 가능.

---

## 1. QA 범위 (Scope)

### 포함 (In-scope)
1. **다인전(3/4/5명) 멀티디바이스 실시간 동기화** — 게임시작/재게임(소거)/재매치/중도퇴장/QR재입장/강제종료복구 6동작.
2. **상태 전이 무결성** — `LOBBY→READY→PLAYING→RESULT→NEXT_ROUND→FINISHED`에서 Deadlock/Freeze/Infinite-Waiting 없음.
3. **BLOCKER-001 회귀** — 술래 숫자 드롭다운: 피커 열림 중 폴링·입퇴장에도 프리즈 없음 + ready 상태 편집 가능 + playing 이후 잠금.
4. **술래 숫자 설정 정확성** — 플레이어 수별 노출 옵션 1..(N−1), 변경의 전 기기/DB 전파.
5. **판정·전적 정확성** — 직접/자동선택 혼합, 2종류/3종류, 전원 무승부, 누적 승률, 직전 게임 결과 영속.
6. **로케일 3종(KO/EN/JA)** — 게임/역할/결과/라벨/드롭다운 옵션 문구 일관성.
7. **safe-area/소형기기 UI** — iPhone SE/mini 하단 잘림 없음.
8. **QA_BACKLOG 미해결 항목 검증** — OPEN-01(호스트 빠지는 재대결 BUG-05 실기기), OPEN-02(토스트 하드코딩 한글), OPEN-03(P2 UI 시각).

### 제외 (Out-of-scope) — Qwen-Bulk는 손대지 말 것
- 코드 수정/커밋 금지. `index.html` 로직 변경 금지(테스트 케이스·매트릭스·문서만 산출).
- Swift(`QRScannerPlugin.swift`)·서명(signing)·`pbxproj` 변경 금지.
- 서버 스키마(Supabase 컬럼) 변경 금지. (OPEN-04 `roundId/selectedAt` 도입은 범위 밖.)

---

## 2. 테스트 카테고리 (Categories)

| # | 카테고리 | 검증 방식 | 비고 |
|---|---|---|---|
| C1 | 소거 로직 단위 (elimination) | 자동 (vitest) | `tests/elimination.test.mjs` 확장 |
| C2 | 판정·전적 단위 (judge/stats) | 자동 (vitest) | `tests/stats.test.mjs` 확장 |
| C3 | 인코딩/하위호환 단위 (choice encoding) | 자동 (vitest) | isAuto 인코딩, 레거시 choice |
| C4 | 다인전 멀티디바이스 매트릭스 | 수동 (실기기) | 플레이어×술래×6동작 |
| C5 | 상태전이/Freeze·Deadlock | 수동 (실기기) | BLOCKER-001 포함 |
| C6 | 드롭다운 프리즈 회귀 (BLOCKER-001) | 수동 (실기기, iOS 우선) | 피커 개방 중 폴링 충돌 |
| C7 | 로케일 일관성 (KO/EN/JA) | 수동 + 체크리스트 | 문구/라벨/옵션 |
| C8 | UI/safe-area (소형기기) | 수동 (실기기) | SE/mini |
| C9 | 백로그 회귀 (BUG-01~13, OPEN-01~03) | 수동 + 일부 자동 | 회귀 시나리오 |

---

## 3. 필요한 테스트 수량 (Quantities)

> Qwen-Bulk의 본업 = **대량 케이스 열거**. 아래 수량을 채워 산출할 것.

### 자동(단위) — `tests/build5/`에 신규/확장
- **C1 소거 로직**: 플레이어 3/4/5 × 술래 1..(N−1) = **9 조합**, 각 조합당 시나리오 ≥6 (정상수렴 / 패자초과 / 패자부족 / 중도퇴장 deadlock 방지 / 호스트 비참여 / 전원 술래 종료) → **≥54 케이스**.
- **C2 판정·전적**: 2종류/3종류 × 직접/자동 혼합 × 플레이어 2~5 → **≥40 케이스**. 누적 승률 집계(다라운드) **≥10 케이스**.
- **C3 인코딩/하위호환**: isAuto 인코딩 왕복, `__safe__`/`__loser__` 마커, 레거시 평문 choice → **≥20 케이스**.
- **자동 합계 목표: ≥124 케이스** (기존 39 포함, 신규 ≥85). 전부 `npm test` 통과해야 함.

### 수동(실기기) 매트릭스
- **C4 매트릭스**: 9 조합 × 6 동작 = **54 셀**.
- **C6 BLOCKER-001 회귀**: 아래 6 시나리오 × (iOS/Android) = **12 케이스**
  1. 3명에서 드롭다운 열고 5초+ 유지(폴링 틱 통과) → 프리즈 없음
  2. 드롭다운 연 상태로 참가자 입장 → 멈춤 없음, 닫은 뒤 옵션 갱신
  3. 드롭다운 연 상태로 참가자 퇴장(옵션 수 감소) → 멈춤 없음
  4. 벌칙 설정 후(ready) 술래 숫자 변경 → 비활성 아님, DB·타기기 반영
  5. 게임 시작(playing) 후 → 드롭다운 잠금 + 안내 토스트
  6. 로케일 전환 직후 옵션 라벨 재생성 + 선택값 유지
- **C7 로케일**: 핵심 화면 12개 × 3 로케일 = **36 체크포인트**.
- **C8 UI**: 소형기기 2종(SE/mini) × 핵심 화면 6개 = **12 체크포인트**.
- **C9 백로그 회귀**: QA_BACKLOG 회귀 시나리오 **12개** + OPEN-01~03 **3개** = **15 케이스**.
- **수동 합계 목표: 54 + 12 + 36 + 12 + 15 = 129 항목.**

> 총량(목표): 자동 ≥124 + 수동 129 = **약 253 검증 항목**.

---

## 4. 예상 산출물 (Deliverables)

Qwen-Bulk가 생성/제출할 결과물:

1. **`docs/BUILD5_P0_QA_MATRIX.md`** — Build 4 매트릭스를 Build 5용으로 확장. 9 조합 × 6 동작 표 + 시나리오별 절차/기대결과 + BLOCKER-001 회귀 섹션 + 결과기록 표(빈 셀).
2. **`docs/BUILD5_BLOCKER001_REGRESSION.md`** — C6 12 케이스의 단계별 재현 절차·기대결과·로그 양식.
3. **`docs/BUILD5_LOCALE_CHECKLIST.md`** — C7 36 체크포인트(화면 × KO/EN/JA), 하드코딩 한글(OPEN-02) 적출 표.
4. **`tests/build5/elimination.bulk.test.mjs`** — C1 ≥54 케이스 (vitest, `npm test` 통과).
5. **`tests/build5/judge-stats.bulk.test.mjs`** — C2 ≥50 케이스 (vitest 통과).
6. **`tests/build5/encoding.bulk.test.mjs`** — C3 ≥20 케이스 (vitest 통과).
7. **`docs/BUILD5_QA_SUMMARY.md`** — 카테고리별 케이스 수 / 통과·실패 / 발견 이슈 ID(BLOCKER/BUG/OPEN) 집계.

### 산출물 수용 기준 (Acceptance)
- 모든 자동 케이스가 `npm run test:syntax` + `npm test` 통과(실패 0).
- 매트릭스/체크리스트는 **빈 결과 셀**을 포함(실기기 결과는 사람이 채움 — Qwen-Bulk는 틀과 케이스만).
- 발견 이슈는 `[BLOCKER-/BUG-/OPEN-]NNN` ID·우선순위(P0~P3)·재현율·재현절차 4필드 필수.
- 로직 단위 테스트는 `src/game-logic.mjs`의 **export된 순수 함수만** 호출(내부 DOM/네트워크 모킹 금지).

---

## 5. 위임 핸드오프 체크리스트 (오케스트레이터용)
- [ ] 본 명세 + `docs/BUILD4_P0_QA_MATRIX.md` + `QA_BACKLOG.md` + `src/game-logic.mjs` 전달
- [ ] 제약(no-commit/no-swift/no-signing/no-schema) 강조
- [ ] 산출물 7종 경로·수용 기준 고정 전달
- [ ] 반환 시 `npm test` 그린 여부를 오케스트레이터(Claude)가 검증 후 머지 판단
