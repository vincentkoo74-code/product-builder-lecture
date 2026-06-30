# 📊 QA_ANALYZER_REPORT (템플릿 + 샘플)

> WES v2.1 QA Analyzer Platform 출력 예시. 실 사용: `node scripts/qa-report.mjs <기기별 metrics.json> --build 14 --device iPhone --scenario "WRPS-026 3인 재대결"`
> 입력은 build14 QA 빌드의 `window.__qaMetrics.copyText()` 결과(또는 [QA-METRIC] 레코드 배열).

---

## 예시 출력 (샘플 메트릭 — 드리프트 초과 시나리오)
```
# QA ANALYZER REPORT
- Build: 14
- Device: iPhone/iPad
- Scenario: WRPS-036 멀티디바이스 카운트다운

## Metrics Summary
- Samples: 8 (sessions 2)
- Countdown Drift: avg 185ms · max 210 · p95 210 · p99 210
- ClockSync Offset: 820ms (max|abs| 820)
- Shadow: 100% (2/2)
- Ordering mismatch: 0
- Audio: delay avg 120ms · max 120 · p95 120 · dup 1 · missing 0
- Lobby: hostChanged 1 · stale 0

## Gate (Metrics)
- [FAIL] WRPS-036 countdownDrift avg < 100ms
- [FAIL] WRPS-036 countdownDrift max < 200ms
- [PASS] WRPS-026 shadow match = 100%
- [PASS] Ordering mismatch = 0
- [FAIL] Audio duplication = 0
- [PASS] Audio missing = 0
- [PASS] Stale participant = 0

## Root Cause Candidate
- #1 [85%] WRPS-052 — 오디오 중복 재생 — dedup 가드 누락(eventId/round-key)
  - evidence: audioDuplicate=1
- #2 [73%] WRPS-036 — Countdown 서버시각 정렬 실패 (clock offset 추정 오차 / 네트워크 jitter)
  - evidence: countdownDriftAvg=185ms, max=210, p95=210, clockOffset=820

## 5 Whys Draft (top, Evidence로 확정 필요)
- WHY1: 같은 사운드가 2회 재생
- WHY2: 동일 이벤트가 2회 트리거(전이/재진입)
- WHY3: eventId 또는 round-key dedup 미적용 경로 존재
- WHY4: side-effect에 idempotency 가드 부재
- WHY5: Root Cause(후보): 중복 호출 가능 전이에 dedup 미적용

## History Match / Regression
- classification: 신규 가능성 (과거 문서에 매칭 없음 — 추가 검색 권장)
- regressionCandidate: false (matches 0)

## Architecture 영향
- 분석 도구 — Server-Authoritative/Replay/Ordering/EventBus/ClockSync/Shadow 무관(변경 0)

## Release Gate
- Critical 0 · High 2 · Medium 2 · Low 2 · Score 58/100
- Verdict: **NOT READY** — High(P1) 2 · Metric gate FAIL 3

## 추천
- 추천 확인: WRPS-052 관련 코드 정독 + 재현 시나리오 반복
- 추천 Fix 여부: 높은 confidence — 코드 정독으로 Root Cause 확정 후 Fix 검토
- 다음 Sprint: Root Cause 확정 시 WES Fix→Regression→Gate 루프
```
