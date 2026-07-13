# BUILD21 실기기 멀티기기 QA 체크리스트

> 대상: TestFlight **build 21** (Delivery UUID `10c8fcbe-9df5-408c-aca1-fa644929ac0f`, VALID). 생성 2026-07-13.
> 목적: (A~E) Build21(다국어 음성 + Functional Self-Check 완료) 상태의 최종 RC 확정을 위한 멀티기기 field QA.
> 원장: `QA_STATUS.md` Build21 절 / `docs/history/ACTIVE_ISSUES.md` Build21 절 / `docs/history/REGRESSION_TRACKER.md` Build21 절.
> **음성(ko/ja/en)은 이미 CEO 실기기 직접 청취로 PASS 확인됨** — 이 체크리스트의 D절은 회귀 방지 재확인용이며, 새로 듣고 판단할 필요는 없음.
> 결과는 이 문서 하단 템플릿에 기록 → `node scripts/analyze-qa-sync.mjs <host.json> <participant.json>` 로 동기화 gap 분석.

---

## 0. 준비 (Setup)

- **기기**: 최소 **2대**(host+participant), 가능하면 **3대 이상**(3인+ 다중술래 및 tooMany/tooFew 분기 검증). Wi-Fi 기기 1대 + 5G/LTE 기기 1대 혼합 권장(동기화 gap 재현 목적).
- **빌드**: 모든 기기 TestFlight에서 **build 21** 설치. 설정에서 build 번호 21 확인.
- **QA 계측 확인**: 앱 우하단 `QA📋`/`QA💾` 버튼 노출 확인(계측 ON 정상).
- **원칙**: 사용자는 플레이만 한다. 이상 발생 시 "어느 기기/몇 라운드/무슨 상황"만 메모.

---

## A. 기본 플로우

- [ ] A-1. 방 생성(호스트)
- [ ] A-2. QR 또는 코드로 입장(참가자)
- [ ] A-3. 2인 게임 시작 정상
- [ ] A-4. 3인 이상 게임 시작 정상
- [ ] A-5. 참가자 나가기 정상(목록 즉시 갱신, 남은 인원 게임 진행 가능)
- [ ] A-6. 호스트 나가기 → hostChanged(호스트 승계) 정상, 승계 후 게임 계속 진행 가능
- [ ] A-7. 나간 후 같은 방/코드로 재입장 가능 여부

Actual: ______  결과: ☐PASS ☐FAIL

## B. 술래 판정 (판정 로직은 Build21에서 변경되지 않음 — 회귀 여부만 확인)

- [ ] B-1. 무승부(전원 같은 선택 또는 3종류 전부) → confirmedLosers 변경 없이 **같은 후보 전체 재게임**
- [ ] B-2. 패자 수 > 남은 술래 수 → 승자는 제외, **패자끼리만 재게임**, confirmedLosers 변경 없음
- [ ] B-3. 패자 수 < 남은 술래 수 → 이번 패자는 **확정 술래로 누적**, **승자끼리만 재게임**
- [ ] B-4. 패자 수 == 남은 술래 수 → confirmedLosers에 추가, **게임 종료**

Actual: ______  결과: ☐PASS ☐FAIL

## C. 동기화 (Wi-Fi + 5G 혼합 기기)

- [ ] C-1. 시작(카운트다운) 화면 표시 시각 gap **≤ 1초**
- [ ] C-2. 결과 화면 표시 시각 gap **≤ 1초**
- [ ] C-3. 다음 라운드/재게임 화면 표시 시각 gap **≤ 1초**
- [ ] C-4. 지연/gap 초과 발생 시 **관련 기기 전부 QA JSON export**(아래 E절)

Actual: ______  결과: ☐PASS ☐FAIL

## D. 음성 (이미 실기기 PASS 확인됨 — 회귀 재확인용)

- [ ] D-1. Korean 정상(가청 확인)
- [ ] D-2. Japanese 정상(가청 확인)
- [ ] D-3. English 정상(가청 확인)
- [ ] D-4. countdownRps("안 내면 술래! 가위바위보!" 등)가 상황에 맞게 출력
- [ ] D-5. audioMissing 발생 없음(QA JSON `audioMissing` 필드로 사후 확인)

Actual: ______  결과: ☐PASS ☐FAIL

## E. QA JSON 수집 (각 시나리오 테스트 후 필수)

최소 2대(host + participant) 이상에서 export. 가능하면 Wi-Fi 기기 / 5G 기기 각각 확보.

- [ ] host device QA JSON export
- [ ] participant device QA JSON export
- [ ] (가능하면) Wi-Fi 기기 QA JSON export
- [ ] (가능하면) 5G 기기 QA JSON export

**export 방법**: `QA💾` 버튼(Documents 저장+Share) 또는 `QA📋`(클립보드) 또는 Safari 웹인스펙터 콘솔 `copy(JSON.stringify(__qaMetrics.export()))`.

---

## 분석 명령 (실기기 QA 완료 후)

```bash
node scripts/analyze-qa-sync.mjs path/to/host-qa.json path/to/participant-qa.json
```

반드시 확인할 항목 및 자동집계 여부:

| 항목 | 자동집계 | 확인 방법 |
|---|---|---|
| maxGapMs / countdown gap / result gap / next-round gap | ✅ `analyze-qa-sync.mjs` | phase별 `maxGapMs` 출력, PASS 기준 ≤1000ms |
| shadowMismatch | ✅ `scripts/qa-analyze.mjs` | `shadowTotal - shadowMatch`(또는 `shadowMatchPct` 100% 미만 여부) |
| orderingMismatch | ✅ `scripts/qa-analyze.mjs` | `orderingMismatch` 필드 |
| staleParticipant | ✅ `scripts/qa-analyze.mjs` | `staleParticipant` 필드(카운트만, 0 보장은 실기기 확인 필요) |
| audioMissing | ✅ `scripts/qa-analyze.mjs` | `audioMissing` 필드 |
| audioFallbackUsed | ⚠️ **manual jq required** | `jq '[(.qaMetrics.recent // .recent // [])[] \| select(.audioFallbackUsed==true)] \| length' qa.json` |
| countdownStartServerTs 0/null | ⚠️ **manual jq required** | `jq '[(.qaMetrics.recent // .recent // [])[] \| select(.eventType=="INVALID_COUNTDOWN_SERVER_TS")] \| length' qa.json` |
| resultValue null | ⚠️ **manual jq required** | `jq '[(.qaMetrics.recent // .recent // [])[] \| select(.eventType=="ROUND_RESULT" and .resultValue==null)] \| length' qa.json` |

> `audioFallbackUsed`/`countdownStartServerTs 0`/`resultValue null`은 이번 단계에서 전용 분석 스크립트를 새로 만들지 않았다(사용자 지시). 필요 시 별도 승인 후 `scripts/qa-analyze.mjs` 확장 검토.

---

## 결과 기록 템플릿 (제출용)

```
[BUILD21 QA 결과]  일시: ____  기기: A(host)=____ B(participant)=____ C=____ (D=____)
빌드번호 확인(21): ☐   QA📋/QA💾 노출: ☐

A 기본플로우  : PASS/FAIL  메모:
B 술래판정    : B-1 PASS/FAIL · B-2 PASS/FAIL · B-3 PASS/FAIL · B-4 PASS/FAIL  메모:
C 동기화      : countdown gap=____ms  result gap=____ms  next-round gap=____ms  결과: PASS/FAIL
D 음성        : ko PASS/FAIL · ja PASS/FAIL · en PASS/FAIL · countdownRps 상황일치 PASS/FAIL · audioMissing=____건

shadowMismatch=____  orderingMismatch=____  staleParticipant=____
countdownStartServerTs 0/null=____(manual jq)  resultValue null=____(manual jq)  audioFallbackUsed=____(manual jq)

첨부 JSON: A=____ B=____ C=____ (D=____)
```

제출 후: `node scripts/analyze-qa-sync.mjs <host.json> <participant.json>` → gap 분석 → 전 항목 PASS 시 **Build21 RC 최종 확정** 검토.
