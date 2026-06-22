# ✅ RELEASE QA CHECKLIST — 릴리즈 전 필수 확인

> 모든 Build를 Archive/TestFlight/스토어에 올리기 **전** 이 체크리스트를 통과해야 한다.
> 한 항목이라도 ❌면 `QA_STATUS.md` 판정은 **NO-GO**.
> 갱신: 2026-06-22

> 📦 **Build8.1 릴리즈 로그**: Archive ✅ → IPA export ✅ → **TestFlight 업로드 ✅**(2026-06-22, build 7, Delivery UUID `8432a629-20d7-4320-bbac-0a5dcaaa2e7a`, API Key `8FCAM7NFRL`). 0~2·6·7절 통과. **3절(실기기) QA 대기** — 외부/스토어 릴리즈는 3절 통과 후.

---

## 0. 게이트 진입 전
- [ ] `QA_STATUS.md` 최신화 + GO 판정 확인
- [ ] `ACTIVE_ISSUES.md`에 **P0 0건** (P0가 1건이라도 있으면 자동 NO-GO)
- [ ] `BUG_MASTER_LEDGER.md`에 이번 Build 신규/해결 버그 반영
- [ ] `REGRESSION_TRACKER.md`에 이번 Build 회귀 점검 완료

## 1. 빌드 무결성
- [ ] `npm run test:syntax` (인라인 스크립트 문법) 통과
- [ ] `npm test` (vitest, 39+ 케이스) 그린
- [ ] `npm run build` → `dist/` 생성
- [ ] `npx cap sync ios` 통과
- [ ] `QRScannerPlugin.swift` / signing / `pbxproj` **미변경** 확인
- [ ] `CURRENT_PROJECT_VERSION`(iOS build 번호) 증가 확인

## 2. 회귀 — 코드 유지 확인 (자동 grep 가능)
- [ ] WRPS-022 `autoFillChoices` (DB 재조회 자동선택)
- [ ] WRPS-023 `buildRoomStatsSummary` (전체 라운드 승률)
- [ ] WRPS-024 `rpsLastCompletedGame` (직전 결과 영속)
- [ ] WRPS-025 `resetRoomLocalState` (새 방 상태 정리)
- [ ] WRPS-026 `startHostJudgeBackstop` (호스트 빠짐 백스톱)
- [ ] WRPS-028 `100dvh` / `safe-area-inset`
- [ ] WRPS-038 `activeElement === sel` (드롭다운 프리즈 가드)
- [ ] WRPS-039 `isLoserCountEditable` ready 편집

## 3. 회귀 — 실기기 멀티디바이스 (수동, 최소 2~6대)
> ⚠️ 단위테스트로 검증 불가. **반드시 실기기**.
- [ ] **WRPS-013** 재게임 초대 카운트다운 만료 후 "수락" → 준비화면 정상 진입(대기화면 고착 없음) **[P0]**
- [ ] **WRPS-014** 게임 시작 시 **참가자 폰에서 카운트다운 음성** 재생(iOS Safari/WKWebView)
- [ ] **WRPS-026** 호스트가 우선안전/술래로 빠지는 재대결 → 판정 멈춤 없음
- [ ] **WRPS-036** 3/4/5명 × 술래 1..(N−1) 매트릭스: 게임시작/재게임/재매치/중도퇴장/QR재입장/강제종료
- [ ] **WRPS-015** 동시 시작 시 기기간 카운트다운 단계 일치(시차 체감 없음)
- [ ] **WRPS-037** 재대결 직후 자동시작 오발화/조기시작 없음
- [ ] **WRPS-020** 참가자 입·퇴장 시 목록 즉시 갱신

## 4. 기능 시나리오 (QA_BACKLOG 회귀 1~12)
- [ ] 2인 직접선택 승/패 정확 · 2인 자동선택 라벨 정확
- [ ] 3인 술래 1/2명 정확 판정 · 3종류 선택 전원 무승부
- [ ] 5라운드+ 후 승률 전체 누적 · 종료 후 홈 직전결과 표시 · 강제종료 후 유지
- [ ] 새 방 생성/입장 이전 상태 잔류 없음
- [ ] 작은 화면(SE/mini) 하단 잘림 없음

## 5. 로케일 (KO/EN/JA)
- [ ] 핵심 화면 12개 × 3로케일 문구/라벨/드롭다운 옵션 일관
- [ ] WRPS-034 토스트 한글 잔존 점검(영/일 모드)

## 6. 마이그레이션 격리 (Build7+ Firebase 관련)
- [ ] Build8 클라이언트가 `b8debug` 플래그 없이는 비활성(평상시 앱 동작 무영향) 확인
- [ ] `index.html` 게임 로직 영역이 직전 LIVE 빌드와 diff상 무변경(WRPS-040 격리 유지)

## 7. 문서 동기화
- [ ] `GAME_LOGIC.md`가 현재 자동시작 동작과 일치(WRPS-041 해소)
- [ ] `BUG_TIMELINE.md`에 이번 Build 섹션 추가

---

## GO / NO-GO 규칙
- **P0 1건 이상 → NO-GO** (예외 없음)
- 3절(실기기) **미수행 항목 존재 → 조건부 NO-GO** (내부 테스트만 한정 허용)
- 위 전부 ✅ + `QA_STATUS.md` GO → 릴리즈 진행
