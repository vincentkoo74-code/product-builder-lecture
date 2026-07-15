# BUILD22 실기기 멀티기기 QA 체크리스트

> 대상: TestFlight **build 22** (Delivery UUID `543c92d6-7f14-48b1-aa23-006e7775b484`, VALID). 생성 2026-07-15.
> 목적: Build22 Critical Fix(A~E: countdown 하드블록/중복렌더 억제/스냅샷 give-up 안전성/QA 리포트 보존성)가
> Build21 필드QA에서 발견된 5개 문제를 실제로 해결했는지 실기기로 재검증한다.
> 원장: `QA_STATUS.md` Build22 절 / `docs/history/ACTIVE_ISSUES.md` Build22 절.
> **이 빌드는 RC 후보가 아니라 Critical Fix 검증용 빌드입니다.** 이 체크리스트 결과로 RC 확정 여부를 결정합니다.

---

## 0. Build21에서 발견된 5개 문제 (이번에 검증할 것)

| # | Build21 문제 | Build22 수정(Fix) | 이번 QA에서 확인할 것 |
|---|---|---|---|
| 1 | 기기간 렌더 gap > 1000ms | A(countdown 하드블록) | C절 gap ≤ 1000ms |
| 2 | 동일 phase에서 lateRenderMs 최대 3444ms(중복 렌더) | B(duplicate render 억제) | E절 `SYNC_RENDER_DUPLICATE_SKIPPED` 존재, `syncLateRenderOver1000Count` |
| 3 | countdownStartServerTs 0인데도 그냥 진행 | A(하드블록) | D절 재시도 화면/자가복구 동작 |
| 4 | TAGGER_SNAPSHOT_GAVE_UP 반복(STALE×9, GAVE_UP×3) | C(snapshot 안전성) | E절 `TAGGER_FALLBACK_SOURCE` |
| 5 | shadowMismatch 1건, recent[] 300캡으로 추적 불가 | D(QA 리포트 보존) | E절 `shadowMismatchEvents`/`lastShadowMismatchEvent` |

---

## 1. 준비 (Setup)

- **기기**: 최소 **2대**(host+participant), 가능하면 **3대 이상**. Wi-Fi 기기 1대 + 5G/LTE 기기 1대 혼합 권장(동기화 gap 재현 목적 — Build21과 동일 조건이어야 비교 가능).
- **빌드**: 모든 기기 TestFlight에서 **build 22** 설치. 설정에서 build 번호 22 확인.
- **QA 계측 확인**: 앱 우하단 `QA📋`/`QA💾` 버튼 노출 확인(이 빌드는 `QA_BUILD=1`로 계측 ON 상태로 빌드됨).
- **원칙**: 사용자는 플레이만 한다. 이상 발생 시 "어느 기기/몇 라운드/무슨 상황"만 메모.

---

## 2. 기본 플로우 (회귀 확인 — Build22는 판정 로직 무변경)

- [ ] A-1. 방 생성(호스트) / A-2. QR·코드 입장(참가자) / A-3. 2인 게임 시작 / A-4. 3인 이상 게임 시작
- [ ] A-5. 참가자 나가기 / A-6. 호스트 나가기(승계) / A-7. 재입장

Actual: ______  결과: ☐PASS ☐FAIL

## 3. 술래 판정 (판정 로직은 Build22에서 변경되지 않음 — 회귀 여부만 확인)

- [ ] B-1~B-4 (무승부/패자>슬롯/패자<슬롯/패자=슬롯) — Build19 QA 체크리스트와 동일 기준

Actual: ______  결과: ☐PASS ☐FAIL

## 4. **[중점] 라운드1-결정 게임 반복** — Fix B(#2) 재발 방지 확인

Build22 이전 버그는 정확히 "라운드1에서 게임이 끝나고, 곧바로 다음 게임도 라운드1에서 끝나는" 패턴에서
재발했다(가장 흔한 케이스). 이 패턴을 의도적으로 여러 번 반복한다.

- [ ] D-1. 2인 게임(술래목표 1명)으로 **라운드1에서 바로 게임 종료**되는 판을 **연속 3회 이상** 진행
- [ ] D-2. 매 게임 종료 후 결과화면이 한 번만 표시되는지(깜빡임·재전환 없음) 육안 확인
- [ ] D-3. 게임 종료 후 `QA📋`로 클립보드 확인 시 `SYNC_LATE_RENDER`가 result phase에서 반복 발생하지 않는지(3초 이상 지연값이 없는지)

Actual: ______  결과: ☐PASS ☐FAIL

## 5. 동기화 (Wi-Fi + 5G 혼합 기기)

- [ ] C-1. 시작(카운트다운) 화면 표시 시각 gap **≤ 1초**
- [ ] C-2. 결과 화면 표시 시각 gap **≤ 1초**
- [ ] C-3. 다음 라운드/재게임 화면 표시 시각 gap **≤ 1초**
- [ ] C-4. 지연/gap 초과 발생 시 **관련 기기 전부 QA JSON export**(7절)

Actual: ______  결과: ☐PASS ☐FAIL

## 6. **[신규] countdown 동기화 실패 화면 — Fix A(#3) 확인**

이 화면은 네트워크 불안정 시에만 나타나므로 강제 재현이 어렵다. **자연 발생 시에만** 아래를 확인한다
(비행기모드 On/Off로 순간 끊었다 살리는 방식으로 유도 시도 가능, 필수 아님).

- [ ] E-1. (host) 만약 동기화 예정시각이 안 들어오면, host 화면은 멈추지 않고 스스로 새 예정시각으로
      재시작하는지(카운트다운이 결국 정상적으로 뜨는지)
- [ ] E-2. (participant) "동기화 지연 — 다시 시도해주세요" 화면 + "다시 시도" 버튼이 뜨는 경우, **버튼을 눌러서
      실제로 선택(가위바위보) 화면까지 정상 도달하는지** — 이 부분이 Build22에서 새로 고친 핵심 지점이다
      (예전엔 재시도 성공해도 화면이 안 넘어가는 버그가 있었음, 코드리뷰로 수정 확인됨 — 실기기 재확인 필요)
- [ ] E-3. 이 화면이 뜨는 동안 준비/카운트다운 음성이 재생되지 않는지(무음이어야 정상)

발생 여부: ☐발생함(위 확인) ☐발생 안 함(자연스러운 정상 케이스 — FAIL 아님)

## 7. QA JSON 수집 및 분석

최소 2대(host + participant) 이상에서 export. 가능하면 Wi-Fi 기기 / 5G 기기 각각 확보.

- [ ] host device QA JSON export (`QA💾`)
- [ ] participant device QA JSON export
- [ ] (가능하면) Wi-Fi 기기 / 5G 기기 각각 export

**분석 명령**:
```bash
node scripts/analyze-qa-sync.mjs path/to/host-qa.json path/to/participant-qa.json
node scripts/qa-analyze.mjs path/to/merged-or-single-qa.json
```

Build22부터 `qa-analyze.mjs`가 아래 4개 항목을 **자동 게이트**로 판정한다(Build21까지는 수동 `jq` 필요했음 —
이번에 자동화됨, `docs/BUILD21_FIELD_QA_CHECKLIST.md` 90행 참조):

| 항목 | Build22 인수기준 | 자동집계 |
|---|---|---|
| `countdownStartServerTs` 0 발생 | 0건 | ✅ `qa-analyze.mjs` 게이트 "WRPS-036-B22 countdownStartServerTs 0 = 0" |
| `resultValue` null | 0건 | ✅ `qa-analyze.mjs` 게이트 "WRPS-026 resultValue null = 0" |
| `SYNC_LATE_RENDER` > 1000ms | 0건, 또는 `SYNC_RENDER_DUPLICATE_SKIPPED`로 처리됨 | ✅ `qa-analyze.mjs` 게이트 "WRPS-SYNC syncLateRenderOver1000 = 0" (+ `syncRenderDuplicateSkippedCount`로 정상 스킵 확인) |
| `TAGGER_SNAPSHOT_GAVE_UP` | 0건, 또는 안전한 fallback(`TAGGER_FALLBACK_SOURCE` 로그로 확인) | ✅ `qa-analyze.mjs` 게이트 "WRPS-072 TAGGER_SNAPSHOT_GAVE_UP = 0" |
| `shadowMismatch` | 0건 | ✅ 기존 게이트("WRPS-026 shadow match = 100%") + 발생 시 앱 내 `QA💾` export의 `summary.shadowMismatchEvents`/`lastShadowMismatchEvent`에서 위치 추적 가능(Build22 신규) |
| `audioMissing` | 0건 유지(회귀 없음) | ✅ 기존 게이트 |

---

## 결과 기록 템플릿 (제출용)

```
[BUILD22 QA 결과]  일시: ____  기기: A(host)=____ B(participant)=____ C=____ (D=____)
빌드번호 확인(22): ☐   QA📋/QA💾 노출: ☐

A 기본플로우      : PASS/FAIL  메모:
B 술래판정        : PASS/FAIL  메모:
D 라운드1 반복(중점): 연속 ____회, 결과 재전환 없음 확인 PASS/FAIL  메모:
C 동기화          : countdown gap=____ms  result gap=____ms  next-round gap=____ms  결과: PASS/FAIL
E countdown 재시도 : 발생 ☐Y ☐N  (발생 시) 재시도 후 선택화면 도달 PASS/FAIL  메모:

countdownStartServerTs 0=____  resultValue null=____  syncLateRenderOver1000=____
TAGGER_SNAPSHOT_GAVE_UP=____  shadowMismatch=____  audioMissing=____

첨부 JSON: A=____ B=____ C=____ (D=____)
```

제출 후: `node scripts/qa-analyze.mjs <qa.json>` → 게이트 전부 PASS 시 **Build22 Critical Fix 검증 완료** →
다음 RC 후보 빌드 논의로 진행.
