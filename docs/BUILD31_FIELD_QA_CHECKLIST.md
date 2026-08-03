# Build31 멀티기기 필드 QA 체크리스트

> 작성 2026-08-03 · TestFlight build **31** VALID (Delivery UUID `5baf3492-8ac9-4998-ac01-30be7615b9a3`)
> manifest `git_commit` = `0ba1e82145e43666d7b43dc0a9d291d9a319572c` · `release_mode=qa-testflight` · `qa_enabled=true`

---

## 0. Build31 목적

Build30 이후 `index.html` 실행 코드가 약 **330줄** 변경됐다. 변경분은 전부 **판정·동기화 경로**다.

| 변경 | 내용 |
|---|---|
| WRPS-079 | `handleRoomUpdate` 재진입 generation gate (result + ready 양분기) |
| WRPS-080 | `finishRoundLocal` 내부 await context 재검증 하드닝 |
| WRPS-081 | `game_over` 조건부 write — host 승계 2-writer 레이스 차단 |
| WRPS-082 | `isStaleRoomRow` round + phase 단조성 검사 (dual-path poll race) |
| RC-1 | clock sync min-RTT 방식 + `server_now()` RPC |

자동 검증 상태: `npm test` **882/882 PASS**, correctness 3 profile **100%**, 결정적 detector 정상 20/20 · mutant 20/20 FAIL.

**이 QA의 목적은 단 하나다 — 위 수정이 실기기에서 "게임 진행 안 됨" 증상을 실제로 없앴는지, 그리고 새 회귀를 만들지 않았는지 확인하는 것.** 시뮬레이션은 증거 우선순위 3위이고, 실기기 로그가 1위다.

---

## 1. 테스트 환경 기록

각 회차마다 아래를 기록한다.

| 필드 | 값 |
|---|---|
| 날짜/시간 | |
| Build 번호 | 31 |
| git commit | `0ba1e82` |
| roomCode | |
| sessionId | |
| 기기명 | |
| iOS 버전 | |
| role | host / participant |
| network | Wi-Fi / 5G / LTE |
| foreground/background 전환 | 유 / 무 |

### 최소 구성 (필수)
- **host** — Wi-Fi
- **participant A** — Wi-Fi
- **participant B** — 5G 또는 LTE

### 권장 추가 구성
- 4번째 참가자
- host 변경(승계) 유발
- background ↔ foreground 전환
- 일시적 네트워크 지연(엘리베이터, 지하 등)

---

## 2. WRPS-079 검증 — handleRoomUpdate 재진입 generation gate

| # | 확인 항목 | PASS/FAIL | 실제 관찰 |
|---|---|---|---|
| 2-1 | duplicate result/ready echo 후 진행 정지 없음 | | |
| 2-2 | 화면 중복 전환 없음 | | |
| 2-3 | countdown 중복 없음 | | |
| 2-4 | stale generation이 최신 UI를 덮지 않음 | | |
| 2-5 | 음성 중복 재생 없음 | | |
| 2-6 | 게임 2회 이상 연속 진행 가능 | | |

---

## 3. WRPS-080 검증 — finishRoundLocal await-context hardening

| # | 확인 항목 | PASS/FAIL | 실제 관찰 |
|---|---|---|---|
| 3-1 | await 중 room/game/round 변경 시 과거 결과 미적용 | | |
| 3-2 | resultValue null 없음 | | |
| 3-3 | confirmedSafeIds 보존 | | |
| 3-4 | confirmedLoserIds 보존 | | |
| 3-5 | shadowMismatch 0 | | |
| 3-6 | activeCandidateCount 일관성 | | |

> 참고: 자동 검증에서 이 경로는 "온라인 진입 status가 항상 result/game_over라 내부 await가 실행되지 않는다"는 이유로 **도달 불가 하드닝**으로 판정됐다. 실기기에서 반증되면 그 자체가 중요한 발견이다.

---

## 4. WRPS-081 검증 — game_over conditional write / two-writer race

**필수 조건**: 3명 이상 · host 승계 상황 · "다음 호스트" 벌칙 또는 동등한 host 변경 유발

| # | 확인 항목 | PASS/FAIL | 실제 관찰 |
|---|---|---|---|
| 4-1 | game_over 중복 write 없음 | | |
| 4-2 | 종료 후 이전 라운드 복귀 없음 | | |
| 4-3 | 영구 정지 없음 (제3자 화면 포함) | | |
| 4-4 | 모든 기기 gameOver 일치 | | |
| 4-5 | partial replay 중 전체 reset 없음 | | |

> 이 항목이 원래 필드 증상("게임 진행 안 됨")의 두 뿌리 중 하나다. **가장 우선 확인할 것.**

---

## 5. WRPS-082 검증 — round + phase stale row rejection

| # | 확인 항목 | PASS/FAIL | 실제 관찰 |
|---|---|---|---|
| 5-1 | gameNo 단조 증가 | | |
| 5-2 | round 단조 증가 | | |
| 5-3 | phase 순서 `ready → playing → result` 유지 | | |
| 5-4 | 이전 round echo가 현재 화면을 덮지 않음 | | |
| 5-5 | 두 번째 게임에서도 과거 timestamp / confirmed ids 오염 없음 | | |

> 이 결함은 2.6초 REST 폴링과 realtime 이중 경로의 out-of-order 배달에서 발생한다. **참가자 수가 많을수록 재현 확률이 높다** — 가능하면 4명 이상으로 확인할 것.

---

## 6. RC-1 clock sync

| # | 확인 항목 | 기대값 | 실측 |
|---|---|---|---|
| 6-1 | `CLOCK_SYNC synced` | true | |
| 6-2 | `samples` | ≥ 1 | |
| 6-3 | `server_now` RPC 성공 | 성공 | |
| 6-4 | `COUNTDOWN_SYNC_FAILED` | 0 | |
| 6-5 | `countdownStartServerTs` 0/null | 0건 | |
| 6-6 | 영구 `INVALID_COUNTDOWN_SERVER_TS` | 0건 | |
| 6-7 | 각 기기 countdown 시작 시각 | 기록 | |
| 6-8 | host ↔ participant 실제 차이 | 기록 | |

> `INVALID_COUNTDOWN_SERVER_TS`는 재시도 루프 **선두**에서 emit되는 시도 카운터다. 1회차에 복구되면 정상이므로 **건수 자체를 실패로 보지 않는다.** 재시도를 모두 소진해 복구되지 않은 경우만 실패다.
>
> **정상 foreground에서 반복적으로 1초 이상 차이가 나면 FAIL 후보로 기록한다.**

---

## 7. 핵심 게임 규칙 회귀

### Case A — 3명 / 목표 술래 1명 / 패자 2명
기대: 패자 2명만 재경기 · 안전자 제외 · **전체 재경기 금지**

| 결과 | PASS/FAIL | 관찰 |
|---|---|---|
| | | |

### Case B — 3명 / 목표 술래 2명 / 확정 술래 1명
기대: 남은 후보만 재경기 · 확정 술래와 안전자 제외 · **전체 reset 금지**

| 결과 | PASS/FAIL | 관찰 |
|---|---|---|
| | | |

### Case C — 목표 술래 수 정확히 충족
기대: gameOver · `activeCandidateCount` 0 · 완료 UI 정상 · **partial replay 버튼 미노출**

| 결과 | PASS/FAIL | 관찰 |
|---|---|---|
| | | |

### Case D — 두 게임 이상 연속
기대: gameNo 분리 · confirmed ids 초기화 정상 · 이전 게임 timestamp 오염 없음 · 새 게임 정상 시작

| 결과 | PASS/FAIL | 관찰 |
|---|---|---|
| | | |

---

## 8. UI 및 음성

| # | 확인 항목 | PASS/FAIL | 관찰 |
|---|---|---|---|
| 8-1 | 한국어 / 일본어 / 영어 음성 재생 | | |
| 8-2 | `audioMissing` 0 | | |
| 8-3 | 치명적 `audioDuplicate` 0 | | |
| 8-4 | AbortError 오분류 없음 | | |
| 8-5 | 결과 화면 빈 화면 없음 | | |
| 8-6 | 준비/재경기 버튼이 대상자에게만 노출 | | |
| 8-7 | 게임 진행을 방해하는 화면 지연 없음 | | |

---

## 9. QA JSON 회수

각 기기에서 QA 리포트를 export한다(앱 내 `QA💾` 버튼 또는 background 전환 시 자동 저장).

기기별 파일:
- `host`
- `participant-a`
- `participant-b`
- `participant-c` (있다면)

> **JSON은 저장소에 커밋하지 않는다.** `QA-index/`는 `.gitignore` 대상이며 로컬 분석용이다.

### 필수 분석 필드
`build` · `buildLabel` · `git_commit` · `roomCode` · `sessionId` · `role` · `gameNo` · `round` · `shadowMismatch` · `resultValueNullCount` · `countdownServerTsZeroCount` · `COUNTDOWN_SYNC_FAILED` · `INVALID_COUNTDOWN_SERVER_TS` · `audioMissing` · `audioDuplicate` · round ordering · stale phase events · cross-device render gap · visibility changes

### 분석 명령 예시

```bash
cd /Users/vk/Documents/Codex/2026-06-02/new-chat/product-builder-lecture

# (1) 기본 메타 확인
node -e '
const fs=require("fs");
const f=process.argv[1];
const j=JSON.parse(fs.readFileSync(f,"utf8"));
console.log({build:j.build, label:j.buildLabel, app:j.app,
             session:j.session?.id, role:j.session?.role,
             room:j.session?.roomCode, exportReason:j.exportReason});
' QA-index/qa-report-build31-<host>.json

# (2) 핵심 카운터 집계
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const m=j.qaMetrics||{};
const c=m.counts||m;
for (const k of ["shadowMismatch","resultValueNullCount","countdownServerTsZero",
                 "COUNTDOWN_SYNC_FAILED","audioMissing","audioDuplicate",
                 "orderingMismatch","staleParticipant","hostChanged"]) {
  console.log(k.padEnd(28), c[k] ?? "(없음)");
}
' QA-index/qa-report-build31-<host>.json

# (3) round 시퀀스 단조성 (WRPS-082)
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const ev=(j.qaMetrics?.events)||j.events||[];
const seq=ev.filter(e=>e.eventType==="COUNTDOWN_START").map(e=>e.round);
console.log("countdown round seq:", seq.join(","));
let bad=0; for(let i=1;i<seq.length;i++) if(seq[i]<seq[i-1]) bad++;
console.log("역행 건수:", bad, bad? "→ FAIL 후보":"→ OK");
' QA-index/qa-report-build31-<host>.json

# (4) 기기 간 countdown 시작 시각 비교 (RC-1)
node -e '
const fs=require("fs");
const files=process.argv.slice(1);
const per={};
for (const f of files) {
  const j=JSON.parse(fs.readFileSync(f,"utf8"));
  const ev=(j.qaMetrics?.events)||j.events||[];
  for (const e of ev.filter(x=>x.eventType==="COUNTDOWN_START")) {
    (per[e.round] ||= []).push({role:j.session?.role, ts:e.countdownStartServerTs, client:e.countdownClientStartTs});
  }
}
for (const [r,v] of Object.entries(per)) {
  const ts=v.map(x=>x.client).filter(Boolean);
  const gap = ts.length>1 ? Math.max(...ts)-Math.min(...ts) : null;
  console.log("round",r,"gap(ms):",gap, gap>1000? "→ FAIL 후보":"");
}
' QA-index/qa-report-build31-*.json
```

---

## 10. 판정표

### 필수 PASS (하나라도 위반 시 FAIL)

| # | 항목 | 기준 | 결과 |
|---|---|---|---|
| 10-1 | 게임 진행 정지 | 0 | |
| 10-2 | 판정 오류 | 0 | |
| 10-3 | 전체 참가자 오재경기 | 0 | |
| 10-4 | confirmed ids 소실 | 0 | |
| 10-5 | round 역행 | 0 | |
| 10-6 | shadowMismatch | 0 | |
| 10-7 | resultValueNullCount | 0 | |
| 10-8 | COUNTDOWN_SYNC_FAILED | 0 | |
| 10-9 | audioMissing | 0 | |
| 10-10 | 게임을 방해하는 음성 중복 | 0 | |

### Timing 취급

- **250ms 자동 수치는 단독 blocker로 쓰지 않는다.** 현재 Normal profile 74.72%는 시뮬레이션 측정값이고 correctness는 100%다.
- **반복적인 1초 이상 격차** 또는 **사용자 체감 방해**가 관측되면 blocker로 승격한다.

### 최종 판정

- [ ] **PASS** — App Store 제출 준비 가능
- [ ] **HOLD** — 추가 분석 필요
- [ ] **FAIL** — 수정 빌드 필요

---

## 11. 결과 기록 템플릿

| 시나리오 | 기기 | 네트워크 | 시작 시각 | 결과 | PASS/FAIL | 증거 JSON | 재현 횟수 | 비고 |
|---|---|---|---|---|---|---|---|---|
| WRPS-079 | | | | | | | | |
| WRPS-080 | | | | | | | | |
| WRPS-081 | | | | | | | | |
| WRPS-082 | | | | | | | | |
| RC-1 clock sync | | | | | | | | |
| Case A | | | | | | | | |
| Case B | | | | | | | | |
| Case C | | | | | | | | |
| Case D | | | | | | | | |
| UI/음성 | | | | | | | | |

---

## 12. 금지사항

- QA 중 **코드 수정 금지**
- **threshold 변경 금지**
- **`PHASE_RENDER_BUFFER_MS` 변경 금지**
- **DevOps 작업 재개 금지** (Branch Protection / Ruleset / Environment / SHA Pin / Secret Migration / TELEGRAM / workflow_dispatch / CI / release-gate 구조 — 전부 Build31 Hardening Backlog)
- **QA JSON 저장소 커밋 금지**
- **App Store 제출은 QA 최종 판정 전 금지**

---

## 부록 — 참고 사실

- 프로덕션 `server_now()` RPC는 **존재 확인됨**(HTTP 200). clock sync 전제는 충족돼 있다.
- 이 빌드는 `qa_enabled=true`이므로 QA 계측이 동작한다. Build30 리포트와 동일한 `qaMetrics` 구조로 나온다.
- 자동 검증에서 발견된 결함 4건(WRPS-079/080/081/082)은 전부 수정·검증 완료됐으나, **실기기 확인 전까지 닫지 않는다**(DR-10 추측 수정 금지 원칙).
