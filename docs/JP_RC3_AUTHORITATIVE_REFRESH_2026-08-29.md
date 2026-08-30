# MARU RPS V1.0_JP — RC3 AUTHORITATIVE REFRESH FIDELITY REPORT (R1)

## 1. Baseline

| 항목 | 값 |
|---|---|
| 저장소 | `/Users/vk/Documents/Codex/2026-06-02/new-chat/product-builder-lecture` |
| 브랜치 | `feature/rps-jp-line-miniapp` |
| 시작 HEAD | `34583b4` |
| 최종 HEAD | `34583b4` (커밋하지 않음 — 작업물은 워킹트리) |
| origin | `34583b4` (동기) |
| 워킹트리 | `tests/` 4개(수정 1 + 신규 3), `docs/` 3개(수정 1 + 신규 2) |

---

## 2. Real `fetchParticipants` Behavior Map (index.html:7119~7361, 243줄)

| 구간 | 동작 | 분류 | 처리 |
|---|---|---|---|
| 7120-7124 | `fetchParticipantsBusy`/`Pending` 재진입 가드 | A | 이전 슬라이스에서 구현 |
| 7127-7131 | `fetchParticipantsSeq` 최신성 가드 | A | 이전 슬라이스에서 구현 |
| 7137-7139 | `state.roomCode` 방-동일성 폐기(빈 값 포함) | A | 이전 슬라이스에서 구현 |
| 7141-7160 | **호스트 역할 전환** + `rearmHostProgressionAuthority()` | **A** | **이번에 구현** |
| 7161-7166 | `cleanupDuplicateRoomProfiles` | B | rc3 는 이름 중복 없음 |
| 7169-7180 | `recentlyMarkedReady` 자기-덮어쓰기 보호 | D(도달불가) | 유일 입력 `myReadyLocallySetAt` 은 `markReady()`/`markReadyFromLobby()` 에서만 세워지는데 하니스는 그 클릭 체인을 재현하지 않음 → 항상 비활성. 코드 주석에 명시 |
| 7182-7220 | WRPS-056 마지막 1인 정리 래치 → `destroyRoomAndGoHome` | D(도달불가) | rc3 는 참가자 수 고정 |
| 7222-7254 | `shouldResetForParticipantChange` → `beginNewGameRound` | **D** | 두 함수 모두 미추출. rc3 는 라운드 중 참가자 증감 없음 → 미도달. **트립와이어로 전제 붕괴를 감시**(§4) |
| 7256-7276 | 입퇴장 사운드 / QA emit | B | 관측 대상 아님 |
| 7278-7280 | `state.participants = data` + `updateSelectedCount()` + `renderAll()` | **A** | **이번에 구현**(`renderAll` 제외 — 하니스 렌더 모델 별도) |
| 7288 | `ensureHostExists()` | **D** | 미추출. host 0명 상태가 rc3 에 없음 |
| 7294 | `recoverRoundWhenAllPlayersWaiting()` | **D** | 미추출. 트리거 전제(판정 참가자 0 + WAITING 잔존) 미도달 |
| 7296-7319 | WRPS-018/061 화면 고착 복구 | B | 하니스가 화면 전이를 별도 모델로 관측 |
| 7327-7336 | **host 결과 발행** — 활성 전원 선택 완료 시 `publishHostRoundResult(data)` | **A** | **구현했으나 rc3 배선에서만 비활성**(R1b, §4) |
| 7340-7346 | `status='lobby'` → `startFromLobby()` | B | rc3 는 lobby 를 거치지 않음 |
| 7347-7353 | **host 자동 시작** — `status='ready'` + `areAllActivePlayersReady()` → `startGame()` | **A** | **이번에 구현** |
| 7359 | `finishFetchParticipants` → 보류 시 80ms 재예약 | A | 이전 슬라이스에서 구현 |

---

## 3. Production ↔ Harness Equivalence

| 프로덕션 동작 | 이전 하니스 | 새 하니스 | 충실성 |
|---|---|---|---|
| 권위 참가자 조회 | fake DB read | 동일(유지) | ✅ |
| busy/pending 재진입 | 없음 → 구현됨 | 유지 | ✅ |
| seq 최신성 | 없음 → 구현됨 | 유지 | ✅ |
| roomCode 폐기(빈 값 포함) | 없음 → 구현됨 | 유지 | ✅ |
| 호스트 역할 재계산 | **없음** | `me.is_host` 기준 전환 | ✅ |
| 승계 시 host-only 권위 재무장 | **없음** | `rearmHostProgressionAuthority()` | ✅ |
| `state.participants` 대입 | 있음 | 유지 | ✅ |
| `updateSelectedCount()` | **없음** | 호출 | ✅ |
| `areAllActivePlayersReady` → `startGame` | **드라이버 렌더 텔레메트리로 대체** | 프로덕션 경로 추가(드라이버 트리거는 병존) | ⚠️ 부분 |
| 전원 선택 → `publishHostRoundResult` | **없음** | 구현, rc3 배선만 off | ⚠️ **R1b** |
| participant-change reset | 없음 | 없음(+트립와이어) | ❌ class D |
| `ensureHostExists` | 없음 | 없음 | ❌ class D |
| `recoverRoundWhenAllPlayersWaiting` | 없음 | 없음 | ❌ class D |

---

## 4. R1 Implementation

**프로덕션 코드 재사용**: `publishHostRoundResult`, `startGame`, `areAllActivePlayersReady`, `rearmHostProgressionAuthority`, `updateSelectedCount`, `hasConfirmedRoundResult`, `getChoiceBase`, `isNonPlayingChoice` — 전부 기존 추출 블록의 REAL 함수다. `areAllActivePlayersReady`(index.html:5488)는 `activePlayers` 블록(5454-5523), `rearmHostProgressionAuthority`(8786)는 `countdownFull` 블록(8482-9168) 안에 이미 있어 **impl 에 노출만 추가**했다. 새로 추출한 소스는 없다.

**수동 모델링**: 없음. 분기 조건과 가드는 index.html 원문의 구조를 그대로 옮겼다.

**시뮬레이터 전용 동작**: 없음.

**직접 상태 주입**: 없음. 새 코드의 직접 대입은 `st.role`, `st.participants`, `st.autoStartInFlight` 셋뿐이며, 모두 프로덕션이 같은 지점에서 수행하는 대입이다(각각 index.html:7148/7159, 7278, 7343). ready/choice/round/status/host 를 우회 설정하는 지름길은 넣지 않았다.

**R1b — 유일한 미배선 항목**
프로덕션에는 `publishHostRoundResult` 호출부가 셋 있다(grep 전수):
- `index.html:7334` — fetchParticipants, **활성 전원이 선택을 마친 즉시**
- `index.html:9271` — autoFillChoices, **선택창이 끝났을 때**(beginRoundTimer 타임아웃)
- `index.html:10640` — hostJudgeRound, 수동 UI 버튼 전용

rc3 하니스는 9271 경로만 배선돼 있어 라운드 확정 타이밍이 **선택창 종료 시각**에 맞춰져 있다. 7334 를 켜면 결과가 그보다 이르게 발행되는데, 이는 프로덕션이 실제로 하는 동작이지만 rc3 의 phase 관측 모델이 그 트리거를 전제하지 않는다.

격리 진단(mutation A):
- (c-1)만 끔 → 통과 / (c-1)만 켬 → `expected 5 to be greater than or equal to 6` 실패
- (c-2) 자동시작은 켜든 끄든 동일 → **충돌원은 (c-1) 하나**

전체 strict 측정으로도 확인:

| 구성 | 하드 게이트 | correctnessPassRate 최저 |
|---|---|---|
| R1 + (c-1) **활성** | **39** | 0.083 (phase 모델 붕괴) |
| R1 + (c-1) **비활성** | **44** | 0.78 |

즉 (c-1)은 교차기기 불일치를 **더** 줄이지만(44→39), 그 대가로 phase 관측이 무너진다. 이 둘을 동시에 만족시키는 것이 R1b다.

조치: `publishHostResultOnRefresh` 파라미터를 두고 **기본값은 프로덕션 충실한 `true`**(계약 테스트가 이 경로를 검증한다), **rc3 배선만 명시적으로 `false`**. 사유 전문을 코드 주석에 남겼다. 이것은 테스트 완화가 아니라 미해결 구분을 숨기지 않은 채 분리한 것이다.

**class-D 트립와이어**: `shouldResetForParticipantChange`/`ensureHostExists`/`recoverRoundWhenAllPlayersWaiting` 를 미구현으로 두는 근거는 "라운드 진행 중 참가자 증감 없음"이라는 암묵 불변식이다. 그 전제가 깨지면 조용히 프로덕션과 갈라지므로, `status`가 `playing`/`ready`인 동안 참가자 수가 변하면 **즉시 throw** 하도록 감시를 넣고 테스트 2개로 고정했다.

---

## 5. R1 Contract Tests — `tests/rc3-r1-authoritative-refresh.test.mjs` (20개, 전부 통과)

| 항목 | 케이스 |
|---|---|
| 호스트 전환 | A→B 전환 시 A 권위 상실 / B 권위 획득 / 무관 device 미획득 / 불변 시 유지 |
| 준비 수렴 | DB readiness 변화가 재조회로 반영 |
| 전원 준비 시 시작 | host 가 정확히 1회 `startGame` / `gameStarting` 중 미시작 / 미준비 시 미시작 / **비호스트는 시작하지 않음** |
| 결과 발행 | 전원 선택 시 발행 / 미선택 시 미발행 / playing 아니면 미발행 / 이미 인코딩된 라운드 재발행 차단 / **비호스트는 발행하지 않음** |
| 참가자 제거 | 목록에서 제거 / 제거 후 host 판정 재계산 |
| 방 격리 | 다른 방 재조회가 host 권위를 바꾸지 않음 |
| roomCode | 빈 값이면 폐기 |
| 시퀀스 가드 | 오래된 응답이 최신 상태를 덮어쓰지 않음 |
| class-D 트립와이어 | 진행 중 참가자 감소 시 즉시 실패 / 비진행 중에는 미발동 |

**반공허성 역검증**: R1 구현을 비활성화하면 4개(호스트 전환, 제거 후 host 재계산, 결과 발행, 자동 시작)가 실패한다. 나머지는 "일어나면 안 되는 것"을 고정하는 음성 계약이며 codex-critic 이 공허하지 않음을 독립 확인했다.

---

## 6. Strict Experiment

| 회차 | 하니스 상태 | 하드 게이트 | 타임아웃 |
|---|---|---|---|
| 기준 | 전파 없음 | 88 | 0 |
| 이전 최선 | 재조회 3중 가드 | 67 | 0 |
| 이전 최종 | 2계층 80ms + roomCode | 90 | 0 |
| **이번 (R1)** | **+ host 권위 전이** | **44** | **0** |
| (참고) R1 + (c-1) 활성 | 39 | 2 |

**나머지 9개 실패 assertion 은 이전 회차와 바이트 동일하다.** 즉 R1 은 `CROSS_DEVICE_OUTCOME_MISMATCH` 하드 게이트만 **90 → 44 로 절반 이하로 줄였고 다른 어떤 것도 바꾸지 않았다.** 이번 조사에서 처음으로 얻은 단조·귀속 가능한 개선이다.

채널 분포(strict, R1): CROSS 542 / PHANTOM 316 / MISSING_COUNTDOWN 128 / MISSING_RESULT 40 / STALL 18 / ROUND_NOT_MONOTONIC 3 / DOUBLE_COUNTDOWN 2.
※ 이 채널 카운트는 **의도적 mutation 진단 출력을 포함**한다 — legacy GREEN 실행(63/63)에서도 동일 채널이 135/57/52건 집계되므로 하드 게이트 수치와 혼동해서는 안 된다.

---

## 7. Remaining Failures — 분류

잔여 44건은 **전부 `CROSS_DEVICE_OUTCOME_MISMATCH`** 이고, **EG(술래-소거, targetLoserCount=2) 하드 게이트 한 곳에 집중**된다. allDraw baseline 하드 게이트는 **통과**한다.

서명: 20대 중 **1~3대만** 다른 결과를 낸다.
```
round 7: p0..p18 = allDraw, p19 = tooFew
round 3: p4/p8/p12 = tooFew, 나머지 = tooMany
```
소수 기기가 **더 적은 확정 결과**를 본 상태에서 판정한 stale-snapshot 서명이다.

| 분류 | 건수 | 근거 |
|---|---|---|
| **H1 — 잔여 하니스 충실성 결함** | 44 (전량) | (c-1)을 켜면 44 → 39 로 더 줄어든다. 즉 남은 불일치의 일부는 "host 가 전원 선택 즉시 결과를 발행한다"는 **프로덕션 동작이 하니스에 없기 때문**이다. 이 경로가 배선되기 전에는 잔여분을 프로덕션 결함으로 볼 수 없다 |
| P1 — 프로덕션 동시성 경합 | 0 | 위 H1 이 남아 있는 한 P1 로 승격할 근거가 없다 |
| P2 — 결정적 프로덕션 로직 결함 | 0 | 해당 없음 |
| U — 미해결 | 0 | 전량 H1 로 귀속됨 |

**strict 실패를 프로덕션 결함으로 계산하지 않았다.**

---

## 8. strictFilters

- 현재 기본값: `false`
- 권고 기본값: **`false` 유지**
- 사유: §12 전환 조건 2가지 중 (1)이 아직 거짓이다 — R1b 라는 **알려진 충실성 격차**가 남아 있고, strict 잔여 44건이 전량 그 격차에 귀속된다. GREEN 을 얻기 위해 legacy 를 유지하는 것이 아니라, **알려진 격차가 있는 동안 strict 를 기본으로 만들지 않는다**는 §12 후단 규정을 따른 것이다. 격차 해소 후 재평가한다.

---

## 9. Regression — legacy / strict 분리 보고

| 대상 | 결과 |
|---|---|
| R1 권위 재조회 계약 테스트 | **20/20 통과** |
| rc3 하니스 쿼리 계약 | **20/20 통과** |
| participants Realtime 충실성 계약 | **16/16 통과** |
| 재조회 가드 계약 | **11/11 통과** |
| **rc3 legacy** | **63/63 통과**, correctnessPassRate=1.0000, 2164s, 타임아웃 0 |
| **rc3 strict** | **10 실패 / 53 통과**, 하드 게이트 44, 타임아웃 0 |
| JP 쓰기 무결성 + 전체 저장소 스위트 | **77 파일 / 1381 통과, 1 skipped** |

**legacy GREEN 을 strict 충실성이 해결되었다는 근거로 제시하지 않는다.** strict 는 여전히 RED 이며, 그 잔여분은 §7에서 전량 H1 로 분류했다.

---

## 10. Codex-Critic

| 심각도 | 지적 | 조치 |
|---|---|---|
| HIGH | R1b 원인 서술이 `hostJudgeRound`(라인 인용도 9345 로 오기)를 지목했으나, 실제 정의는 10622 이고 수동 UI 버튼 전용. 진짜 자동 트리거는 `beginRoundTimer`→`autoFillChoices`→`publishHostRoundResult`(9271)이며 이는 이미 배선돼 있음 | **수용·정정**. `publishHostRoundResult` 호출부 3곳을 grep 으로 전수 확인해 주석을 사실 기반으로 다시 씀. 미해결 부분(잔여 MISSING_COUNTDOWN_RENDER 가 인공물인지 프로덕션 동작인지)은 단정하지 않고 R1b 의 내용으로 명시 |
| MEDIUM | class-D 미도달 근거가 문서화되지 않은 암묵 불변식에 의존 — 미래에 조용히 깨질 수 있음 | **수용**. 진행 중 참가자 증감 시 즉시 throw 하는 트립와이어 + 테스트 2개 추가 |
| LOW | `recentlyMarkedReady` 가드 누락이 class-D 목록에 미기재 | **수용**. 코드 주석과 §2 표에 명시 |
| — | (a)/(b)/(c-2) 충실성 | 프로덕션과 동등 확인 |
| — | §7 직접 상태 주입 | 위반 없음 확인 |
| — | (c-1) 비활성화가 은폐인지 | 회귀를 독립 재현하고 **은폐 아님** 판정 |
| — | 계약 테스트 20개 | 공허하지 않음 확인 |

BLOCKER 없음. HIGH 1건은 정정 완료.

---

## 11. Production Source

**PRODUCTION SOURCE UNCHANGED.**
`git diff --stat 34583b4 -- index.html supabase/` → 빈 출력. 예외 없음.

---

## 12. JP-BL-027-B

**OPEN — NOT STARTED.** STOP GATE 를 통과하지 못했다(§15 조건 중 "R1 closed"와 "잔여 불일치 0 또는 개별 실증" 미충족).

---

## 13. JP-REALTIME-VALIDATION

**OPEN.** 시뮬레이터 충실성 개선은 실제 Supabase Realtime 배달 검증을 대체하지 않는다.

---

## 14. Production Safety

| 항목 | 상태 |
|---|---|
| KR 프로덕션 | 변경 없음 |
| JP Tokyo 프로덕션 | 변경 없음 |
| 마이그레이션 원장 | 변경 없음 |
| JP 데이터 건수 | 변경 없음(접근하지 않음) |
| 클라우드 리소스 | 변경 없음(생성/삭제 없음) |
| 과금 | 변경 없음 |
| 추가 비용 | **0** |

Colima 대용량 다운로드 재시도하지 않았다.

---

## 15. Recommendation

**HARNESS FIDELITY NOT READY**

R1 은 실질적 진전을 냈다 — 시뮬레이터가 더 이상 host 권위 전이가 빠진 축약 재조회 경로를 쓰지 않으며, 그 효과로 strict 하드 게이트가 **90 → 44** 로 절반 이하가 되었고 나머지 지표는 바이트 단위로 불변이다. 그러나 성공 조건("축약 재조회의 누락된 host/game-state 부작용이 strict 결과를 지배하지 않는다")은 **아직 완전히 충족되지 않았다**: 잔여 44건이 전량, 아직 배선하지 못한 두 번째 결과 발행 트리거(R1b)에 귀속된다.

`nextRound` 는 건드리지 않았고, 다음 슬라이스 후보는 **R1b** 하나다 — rc3 의 phase 관측 모델이 프로덕션의 두 결과 발행 트리거를 모두 전제하도록 만드는 것.
