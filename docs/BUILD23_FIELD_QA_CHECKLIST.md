# BUILD23 실기기 멀티기기 QA 체크리스트

> 대상: TestFlight **build 23** (Delivery UUID `01aa7047-518f-45cd-bfb5-bbb5ed1a41d2`, VALID). 생성 2026-07-15.
> 목적: Build23 Critical Fix(partial replay 중 host "한번더" hard-block)가 실기기 3인 게임에서 실제로
> 재현된 버그(Case A/B)를 해결했는지, 그리고 다중술래(target≥2) 게임에서 새 회귀(codex-critic이
> 발견해 미리 수정한 HIGH 이슈)가 없는지 검증한다.
> 원장: `QA_STATUS.md` Build23 절 / `docs/history/ACTIVE_ISSUES.md` Build23 절.
> **이 빌드는 RC 후보가 아니라 partial replay hard-block 검증용 빌드입니다.** 이 체크리스트 결과로
> RC 확정 여부를 결정합니다. Build22의 5개 항목(countdown/렌더중복/스냅샷/QA리포트)도 회귀 여부만
> 함께 확인합니다(`docs/BUILD22_FIELD_QA_CHECKLIST.md` 참조).

---

## 0. Build22에서 발견된 문제 (이번에 검증할 것)

| # | Build22 문제 | Build23 수정(Fix) | 이번 QA에서 확인할 것 |
|---|---|---|---|
| A | 패자 2명(목표 술래1) 부분 재경기 중 "한번더" 버튼 활성화 → 전체 3명 재경기로 오염 | 버튼 노출·handler 양쪽에 `isTaggerSelectionComplete()` 하드블록 | 1절 Case A |
| B | 확정 술래 1명(목표 술래2) 부분 재경기 중 "한번더" 버튼 활성화 → 전체 3명 재경기로 오염 | 동일 하드블록 | 1절 Case B |
| C(신규 회귀, 사전 수정됨) | 다중술래(target≥2) 게임에서 활성자가 슬롯 이하로 줄어 조기종료(deadlock) 시, 카운트 기반 판정이면 "미완료"로 오판해 재시작 영구 차단 | `isTaggerSelectionComplete()`를 카운트 비교 대신 "활성 풀이 비었는가"로 재정의 | 2절 다중술래 조기종료 |
| D | QA export 분석기가 실제 파일 스키마(`qaMetrics.recent` 중첩)를 못 읽어 게임 로그가 거의 없는 것처럼 보임 | `qa-analyze.mjs` 스키마 수정 + `previousSession` 병합 | 4절 |

---

## 1. [중점] partial replay 중 "한번더" 버튼 — Build22 실기기 재현 시나리오 재검증

3인 게임, Wi-Fi/5G 혼합 기기 권장(Build22와 동일 조건이어야 비교 가능).

### Case A — 술래 1명 목표, 이번 라운드 패자 2명 (tooMany)

- [x] A-1. 술래 목표 1명으로 3인 게임 시작
- [x] A-2. 라운드에서 2명 패배·1명 승리가 나오도록 진행(패자 2명 > 슬롯 1명 → tooMany)
- [x] A-3. **host 화면에 "한번더" 버튼/아이콘이 보이지 않는지** 확인(이전엔 여기서 노출됨)
- [x] A-4/A-5. QA 메트릭으로 부분 재경기 상태 확정(activeCandidateCount=2, participantCount=3 —
      패자 2명만 활성 유지, 3명 전체로 복원되지 않음)

Actual(QA JSON, room 6KVW/build23/deviceCount3): `PLAY_AGAIN_BUTTON_STATE` activeCandidateCount=2,
participantCount=3, confirmedTaggerCount=0, targetTaggerCount=1, reason=partialReplayLosersOnly →
**visible=false, enabled=false**. 결과: ☑PASS ☐FAIL

### Case B — 술래 2명 목표, 이번 라운드 확정 술래 1명 (tooFew)

- [x] B-1. 술래 목표 2명으로 3인 게임 시작
- [x] B-2. 라운드에서 1명만 패배하도록 진행(패자 1명 < 슬롯 2명 → tooFew, 이 1명은 확정 술래로 제외)
- [x] B-3. **host 화면에 "한번더" 버튼/아이콘이 보이지 않는지** 확인
- [x] B-4/B-5. QA 메트릭으로 부분 재경기 상태 확정(activeCandidateCount=2, participantCount=3 —
      남은 2명만 활성 유지)

Actual(QA JSON): `PLAY_AGAIN_BUTTON_STATE` activeCandidateCount=2, participantCount=3,
confirmedTaggerCount=1, targetTaggerCount=2, reason=partialReplayWinnersOnly →
**visible=false, enabled=false**. 결과: ☑PASS ☐FAIL

### 게임 완전 종료 후 — "한번더" 정상 동작 회귀 확인

- [x] C-1. Case A/B가 목표 술래 수를 모두 채우고 게임이 정말 끝나면(gameOver), **이번엔 "한번더" 버튼이 정상적으로 보이는지**
- [ ] C-2. "한번더"를 눌러 전체 참가자로 새 게임이 정상 시작되는지 — 이번 QA 라운드에서 실제 클릭까지는
      명시적으로 로그되지 않음(메트릭상 enabled=true는 확인됨). 다음 QA 라운드에서 실제 클릭 결과까지
      기록 권장.

Actual: complete 상태에서 **host만** `PLAY_AGAIN_BUTTON_STATE` visible=true, enabled=true. participant는
partial/complete 어느 상태에서도 항상 visible=false, enabled=false(host 전용 정상 동작).
결과: ☑PASS(메트릭 기준) ☐FAIL

**→ 종합: Build23 핵심 수정("부분 재경기 중 host 한번더 hard-block")은 PASS로 확정 기록.**

---

## 2. [중점] 다중술래(target≥2) 조기종료 — codex-critic이 발견해 사전 수정한 HIGH 회귀 재검증

이 시나리오는 코드 리뷰로 발견되어 실기기 재현 전에 이미 수정되었지만, 실기기에서 최종 확인 필요.

- [ ] D-1. 술래 목표 2명 이상(예: 4인 게임, 목표 3명)으로 게임 진행
- [ ] D-2. 중도 퇴장 또는 정상 진행으로 활성(미확정) 참가자 수가 남은 목표 술래 수 이하로 줄어드는
      상황을 만든다(예: 남은 활성자 1명, 남은 슬롯 2명)
- [ ] D-3. 이 상황에서 게임이 정상적으로 gameOver로 종료되는지(멈추지 않는지)
- [ ] D-4. **host 화면에서 "한번더"(또는 통계→"다시 초대") 버튼으로 정상적으로 새 게임을 시작할 수
      있는지** — 이 항목이 FAIL이면(버튼이 안 보이거나 눌러도 아무 반응 없으면) 그 방은 복구 불가
      상태이니 반드시 스크린샷/QA JSON과 함께 즉시 보고

Actual: 이번 QA 라운드는 3인/target=1,2 시나리오(1절)만 다뤘고 다중술래(target≥2) 조기종료 시나리오는
포함되지 않음 — **미실시**. 다음 QA 라운드에서 별도 수행 필요(RC 확정 전 필수).
결과: ☐PASS ☐FAIL ☑미실시(NOT TESTED)

---

## 3. 기본 플로우 / 술래 판정 / 동기화 — Build19~22 회귀 확인

- [x] A. 기본 플로우(방 생성/입장/시작/나가기/승계/재입장) — 3인 게임 정상 진행됨(1절 Case A/B 전제)
- [x] B. 술래 판정 4분기 — Case A(tooMany)/Case B(tooFew) 판정 정확히 관찰됨, 판정 알고리즘 회귀 없음
- [ ] C. 동기화: countdown/result/next-round 표시 시각 gap ≤ 1초 — **FAIL 재발**:
  - cross-device result render gap 약 1743ms (Build22 인수기준 ≤1000ms 위반)
  - SYNC_LATE_RENDER: host max 4502ms, participant max 2759ms (Build22 인수기준 0건/duplicate-skip 처리 위반)
  - participant 쪽 nextRound render 1건 serverScheduledTs null
- [ ] D. countdown 동기화 실패 화면 — 이번 라운드에서 관찰 안 됨/미보고(별도 확인 필요)
- [x] E. audioMissing 0건 유지 — 회귀 없음(보고에 언급 없음 = 정상)

Actual: **C(동기화) FAIL** — Build22가 목표했던 인수기준(cross-device gap ≤1000ms, SYNC_LATE_RENDER 0건)이
Build23 실기기에서 재발함. 아래 5절 "RC 보류 사유" 참조. 결과: ☐PASS ☑FAIL(C 항목)

---

## 4. QA JSON 수집 및 분석 (previousSession 병합 수정 검증)

- [ ] host device QA JSON export (`QA💾`)
- [ ] participant device QA JSON export
- [ ] (가능하면) 백그라운드/재시작 직후 export 1회 시도(previousSession 병합 확인용)

**분석 명령**:
```bash
node scripts/qa-analyze.mjs path/to/qa-report-build23-*.json
node scripts/analyze-qa-sync.mjs path/to/host-qa.json path/to/participant-qa.json
```

확인할 것:

| 항목 | 확인 방법 |
|---|---|
| `report.samples`가 실제 플레이한 라운드 수에 걸맞게 큰 값인지(Build22 문제였던 "2~4건" 수준이 아닌지) | `qa-analyze.mjs` 출력 `samples` |
| `playAgainVisibleDuringPartialReplayCount = 0` (Build23 인수기준) | `qa-analyze.mjs` 게이트 "WRPS-PLAYAGAIN-B23 visible during partial replay = 0" |
| `playAgainBlockedCount` — Case A/B에서 실제로 몇 번 차단됐는지(참고용, 0이 아니어도 정상) | `report.playAgainBlockedCount` |
| 앱 재시작 직후 export해도 `previousSessionMerged`로 직전 세션 데이터가 분석에 포함되는지 | `report.previousSessionMerged` |
| Build22 인수기준 4항목(countdownStartServerTs 0 / resultValue null / syncLateRenderOver1000 / GAVE_UP) 회귀 없음 | 기존 게이트 |

**Actual(2026-07-16 QA 라운드, room 6KVW/build23/deviceCount3)**: `playAgainVisibleDuringPartialReplayCount`
관련 위반 관찰 없음(1절 참조, PASS). 그러나 Build22 인수기준 4항목 중 다음이 **재발(FAIL)**:
- `TAGGER_SNAPSHOT_GAVE_UP`: host/participant 각 1회 발생
- `TAGGER_FALLBACK_SOURCE`: localJudge로 떨어진 이벤트 있음(서버 확정 결과 대신 로컬 재계산 경로를 탐)
- `syncLateRenderOver1000`: host max lateRenderMs 4502ms, participant max lateRenderMs 2759ms
- `resultValueNullCount`(host): 2건

→ **5절 "RC 보류 사유" 참조.**

---

## 5. RC 판정 및 다음 단계

**partial replay "한번더" hard-block(Build23 핵심 수정)**: ✅ **PASS로 확정 기록** — 1절 근거.

**최종 RC**: ⏸ **HOLD** (아래 6개 미해결 이슈로 인해 Build23을 최종 RC로 확정하지 않음)

| # | 이슈 | 실측 근거 |
|---|---|---|
| 1 | `TAGGER_SNAPSHOT_GAVE_UP` host/participant 각 1회 발생 | Build22-C 인수기준(0건 또는 안전 fallback) 재발 |
| 2 | `TAGGER_FALLBACK_SOURCE=localJudge` 이벤트 존재 | 서버 확정 결과 대신 로컬 재계산 경로 사용 |
| 3 | `SYNC_LATE_RENDER > 1000ms` | host max 4502ms, participant max 2759ms |
| 4 | cross-device result render gap | 약 1743ms(Build22 인수기준 ≤1000ms 위반) |
| 5 | host `resultValueNullCount` | 2건 |
| 6 | participant nextRound render `serverScheduledTs` null | 1건 |

**다음 작업**: Build24 또는 Build23b에서 sync/snapshot/resultValueNull 안정화를 **별도로** 처리한다.
partial replay guard(이번 Build23 핵심 수정)는 **건드리지 않고** 회귀 테스트만 유지한다.

**금지(다음 빌드 작업 범위 제한, CEO 지시)**:
- voice asset 수정 금지
- ElevenLabs API 호출 금지
- 로그인/서버/UI 대개편 금지
- partial replay guard 재작성 금지

---

## 결과 기록 템플릿 (제출용)

```
[BUILD23 QA 결과]  일시: ____  기기: A(host)=____ B(participant)=____ C=____ (D=____)
빌드번호 확인(23): ☐   QA📋/QA💾 노출: ☐

1. Case A(tooMany, 패자2/목표1)   : 한번더 미노출 ☐  패자만 재경기 ☐  PASS/FAIL
   Case B(tooFew, 확정1/목표2)    : 한번더 미노출 ☐  남은2명만 재경기 ☐  PASS/FAIL
   게임완전종료 후 한번더 정상동작 : PASS/FAIL
2. 다중술래 조기종료(target≥2)     : 정상종료 ☐  한번더/재초대로 복구 가능 ☐  PASS/FAIL
3. 기본플로우/판정/동기화/오디오   : PASS/FAIL  메모:
4. QA JSON samples=____  playAgainVisibleDuringPartialReplayCount=____  playAgainBlockedCount=____

첨부 JSON: A=____ B=____ C=____ (D=____)
```

제출 후: `node scripts/qa-analyze.mjs <qa.json>` → 게이트 전부 PASS 시 **Build23 Critical Fix 검증 완료** →
다음 RC 후보 빌드 논의로 진행.
