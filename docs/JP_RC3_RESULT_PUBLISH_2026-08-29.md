# MARU RPS V1.0_JP — RC3 RESULT-PUBLISH FIDELITY REPORT (R1b)

## 1. Baseline

| 항목 | 값 |
|---|---|
| 브랜치 | `feature/rps-jp-line-miniapp` |
| 시작 HEAD | `34583b4` |
| 최종 HEAD | `34583b4` (커밋하지 않음) |
| origin | `34583b4` (동기) |
| 워킹트리 | `tests/` 5개(수정 1 + 신규 4), `docs/` 4개(수정 1 + 신규 3) |

---

## 2. Production Result-Publish Map

`grep -n "publishHostRoundResult(" index.html` 전수 — 자동 트리거는 **정확히 둘**이다.

### Trigger A — `fetchParticipants` (index.html:7334)
| 항목 | 내용 |
|---|---|
| 발원 | `fetchParticipants` 의 host 전용 tail (7321-7336) |
| 전제조건 | `state.role === 'host'`, `state.status === 'playing'` |
| 참가자 조건 | 활성(safe/loser/비참여 제외) 전원이 `getChoiceBase` 를 가짐 |
| 차단 조건 | 활성 중 하나라도 `hasConfirmedRoundResult` → 이미 처리된 라운드 |
| 타이밍 | **활성 전원이 선택을 마친 즉시** (창 종료를 기다리지 않는다) |
| 재발행 가능? | 가능하지만 아래 §공유 가드가 수렴시킴 |
| Realtime/폴링 관계 | `postgres_changes` → 80ms 디바운스 → 재조회 → 이 분기. 2.6s 폴링도 같은 함수를 탐 |
| autoFillChoices 관계 | 창이 끝나기 **전에** 이미 발행돼 있으면 B 는 멱등 가드에 걸림 |

### Trigger B — `autoFillChoices` (index.html:9271)
| 항목 | 내용 |
|---|---|
| 발원 | `beginRoundTimer` 의 선택창 타임아웃 |
| 동작 | 미선택자 행을 자동선택으로 채운 뒤(`isAutoChoice` 인코딩) 발행 |
| 타이밍 | **선택창이 끝났을 때** |
| A 와의 경합 | A 가 먼저 발행했으면 행이 이미 인코딩돼 있어 B 는 ④ 멱등 가드에서 반환 |

### (자동 아님) `hostJudgeRound` — index.html:10640
`window.hostJudgeRound()` 수동 UI 버튼 전용. 자동 트리거가 아니다.

### 공유 가드 / 래치 / CAS — `publishHostRoundResult` (7035~7101)
호출부가 아니라 **함수 자신**이 모든 방어를 갖는다.
1. `role!=='host' || status!=='playing' || !online || !db || !roomCode` → 반환 (7036)
2. **`state.publishingRoundResult` in-flight 래치** (7037-7038, `finally` 에서 해제 7099)
3. **자체 권위 재조회** (7041-7043) — 인자로 받은 스냅샷이 낡았어도 신선한 행으로 대체
4. **멱등 가드**: `active.every(hasConfirmedRoundResult)` → 이미 발행 → status 만 `result` 로 (7053-7056)
5. **전원 선택 가드**: `!active.every(getChoiceBase)` → 반환 (7057)
6. write 후 0행 검증(7081-7092) → 누락 시 로컬 낙관 상태로 덮어쓰지 않고 재조회
7. 마지막에 `updateRoomStatusScheduled("result","result")` (7097)

---

## 3. Previous Harness Gap

| 항목 | 이전 상태 |
|---|---|
| Trigger A | **미배선** |
| Trigger B | 배선됨 (`autoFillChoices` 추출·노출) |
| 44건이 남은 이유 | 프로덕션은 전원 선택 즉시 결과를 확정해 기기 간 스냅샷 격차를 좁히는데, rc3 는 창 종료까지 기다리므로 그 격차가 유지된다 |

이번 슬라이스에서 **또 하나의 선행 격차**를 발견했다: 접합부 ②가 `handleRoomUpdate` 반환 직후, 즉 **카운트다운 진행 중에도** 선택을 제출하고 있었다. 프로덕션에서 `selectChoice()` 의 코드 가드는 status/`isCurrentRoundParticipant` 둘뿐이지만, 선택 버튼은 `runCountdown()` 완주 후 `beginRoundTimer()`(index.html:9017)가 화면을 띄운 다음에야 존재한다 — **UI 가 실질적 게이트**다. Trigger B 만 배선돼 있는 동안에는 발행이 어차피 창 종료까지 기다려 이 조기 제출이 보이지 않았다.

---

## 4. R1b Implementation

**프로덕션 동작 재사용**
- Trigger A 분기: 프로덕션 7327-7336 의 사전 필터를 그대로 옮기고, 최종 판단은 REAL `publishHostRoundResult` 자신의 ①~⑦ 가 수행한다.
- 중복 방어: **프로덕션 기제만** 사용. 하니스 전용 "1회만" 지름길을 만들지 않았다.
- 선택 제출 게이트: REAL `beginRoundTimer` 가 등록하는 `setInterval` 을 가로채 기록하는 **기존 관측치** `rendered.choiceStartByRound[round]` 를 판정 근거로 사용한다(하니스가 발명한 신호가 아니라 실제 코드의 부작용).

**수동 모델링**: 없음.

**시뮬레이터 전용 동작**: `choiceWindowOpenHook` 하나. 선택창이 열리는 순간 제출을 시도하기 위한 훅으로, room row 가 그 뒤 다시 오지 않을 수 있는 하니스 환경 경계 때문에 필요하다. 관측 지점의 원본 흐름을 막지 않도록 마이크로태스크로 분리했다. **판정에는 관여하지 않는다.**

**직접 상태 주입**: 없음. winner/loser/result/outcome/score/host 를 원격 시뮬 기기에 대입하는 코드는 추가하지 않았다. 수렴은 전부 `DB 변경 → participants 이벤트 → 80ms 디바운스 → 권위 재조회 → REAL 로직` 경로를 탄다.

---

## 5. R1b Contract Tests — `tests/rc3-r1b-result-publish.test.mjs` (20개, 전부 통과)

| 항목 | 케이스 |
|---|---|
| A 정상 | host 발행 / 비호스트 미발행 |
| 부분 선택 | 미선택자 있으면 미발행 / 활성 0명이면 미발행 |
| A→B | A 발행 후 재조회는 재발행 없음 |
| B→A | B 가 먼저 인코딩했으면 뒤늦은 A 는 미발행 |
| 거의 동시 | 두 재조회가 겹쳐도 **권위 결과는 하나** |
| 권위 이전 | 옛 host 미발행 / 새 host 가 같은 시점에 발행 |
| 다른 방 | roomCode 불일치 시 미발행 |
| 다른 라운드 | status≠playing 시 미발행 |
| 중복 이벤트 | 3회 재조회에도 권위 결과 하나 |
| 시퀀스 폐기 | 폐기된 재조회는 미발행 |
| **REAL 언스텁 7개** | ① 비호스트/비playing 무기록 · ⑤ 부분선택 무기록 · 정상 인코딩 · **④ 멱등(재호출해도 승패 카운트 불변)** · **② in-flight 래치(겹쳐 호출해도 이중 집계 없음)** · **③ 자체 재조회(낡은 스냅샷을 넘겨도 신선 행으로 판정)** |

**반공허성**: Trigger A 를 끄면 5개가 실패한다. 또한 codex-critic 이 "스텁 교체로 REAL 방어가 검증되지 않는 순환 검증"을 지적해, **REAL `publishHostRoundResult` 를 스텁 없이 직접 호출하는 7개**를 추가했다 — 프로덕션 자신의 래치·멱등·자체 재조회가 실제로 작동함을 실증한다.

§9 기준을 따랐다: "함수 호출 1회"가 아니라 **권위 결과 하나 + 기기 간 모순 없음**을 검증한다. 승계 직후에는 REAL `rearmHostProgressionAuthority()` 가 판정 백스톱을 다시 세워 발행 경로가 둘 이상 열릴 수 있는데, 프로덕션은 그것을 호출 횟수가 아니라 래치/멱등으로 수렴시키므로 테스트도 그 기준으로 썼다.

---

## 6. Strict Experiment

| 회차 | 구성 | 하드 게이트 | 타임아웃 | legacy |
|---|---|---|---|---|
| 역사적 기준 | 전파 없음 | 88 | 0 | — |
| 이전 | 재조회 가드 | 67 | 0 | — |
| 이전 | 2계층 80ms | 90 | 0 | GREEN |
| R1 | + host 권위 전이 | 44 | 0 | GREEN |
| **R1b 실험** | **+ 선택창 게이트 + Trigger A** | **30** | **7** | **5건 실패** |
| **R1b 최종(납품)** | **+ 선택창 게이트만** | **41** | **0** | **GREEN** |

채널(최종): CROSS 596 / PHANTOM 204 / MISSING_COUNTDOWN 80 / MISSING_RESULT 38 / STALL 13 / ROUND_NOT_MONOTONIC 3 / DOUBLE 2.
※ 이 카운트는 의도적 mutation 진단 출력을 포함한다(legacy GREEN 실행에서도 동일 채널이 집계됨).

**결정적 분리 실험**: 선택창 게이트만 켜고 Trigger A 를 끄면 legacy 63/63 GREEN 이 유지된다(실측 1990s). 즉 **회귀 원인은 Trigger A 단독**이며 게이트는 안전한 충실성 개선이다.

---

## 7. Remaining Failures — 분류

§11 기준으로 **Case B**(44 → 30, 감소하되 0 아님)이지만, 그 30 은 legacy 회귀 5건과 타임아웃 7건을 대가로 얻은 수치다. 납품 상태(게이트만)의 하드 게이트는 **41**이다.

| 분류 | 건수 | 근거 |
|---|---|---|
| **H1 — 잔여 하니스 충실성 결함** | **41 (전량)** | 아래 두 격차가 모두 하니스 쪽이며, 그중 하나(Trigger A)를 켜면 수치가 30 으로 더 내려간다. 즉 남은 불일치는 여전히 하니스가 프로덕션 동작을 덜 재현해서 생긴다 |
| P1 — 프로덕션 동시성 경합 | 0 | H1 이 남아 있는 한 승격 근거 없음 |
| P2 — 결정적 프로덕션 로직 결함 | 0 | 해당 없음 |
| U — 미해결 | 0 | 전량 H1 로 귀속 |

**H1 의 내용 (두 격차)**

**H1-a — 선택 제출 지연 모델 부재 (주 원인)**
하니스는 선택창이 열리는 즉시 **전원이 동시에** 제출한다. 실제 사용자의 선택은 5초 창 전체에 분산되는데 그 지연 모델이 없다. Trigger B 만 배선돼 있던 동안에는 발행이 창 종료까지 기다려 이 차이가 보이지 않았다. Trigger A 를 켜면 라운드가 창을 쓰지 않고 t≈0 에 끝나 버려, 창 종료 기준으로 보정된 phase/타이밍 측정이 어긋난다(legacy correctnessPassRate 0.283/0.915/0.94).
§9 는 "타이밍 상수는 프로덕션이나 기존 rc3 지연 모델에서 와야 한다"고 못박았다. **"사람이 손을 내는 데 걸리는 시간"에 해당하는 상수는 프로덕션에도 기존 rc3 모델에도 없다.** 이 값을 발명하는 것은 이번 슬라이스의 권한을 넘으므로 하지 않았다.

**H1-b — N×M 이벤트 팬아웃 (병행, codex-critic 제기)**
`publishHostRoundResult` 는 활성 참가자마다 개별 `update` 를 날린다(7061-7077, N회). 하니스는 write 마다 M개 구독자에게 이벤트를 브로드캐스트하므로 라운드당 최대 N×M 회의 배달 예약이 생긴다. strict 타임아웃 7건(R1 에서는 0건)이 이 성능 열화로 설명될 수 있다. **프로덕션에는 벽시계 예산 자체가 없으므로 이 타임아웃은 정의상 프로덕션 결함일 수 없다.** 미검증 가설로 기록한다.

두 원인은 배타적이지 않다.

---

## 8. strictFilters

- 현재 기본값: `false`
- 권고: **`false` 유지**
- 사유: §12 조건 1·2 모두 미충족. H1-a/H1-b 라는 **알려진 지배적 하니스 격차**가 남아 있고, strict 잔여 41건이 전량 거기 귀속된다. legacy GREEN 을 충실성의 근거로 쓰지 않는다.

---

## 9. Regression — legacy / strict 분리

| 대상 | 결과 |
|---|---|
| R1b 결과발행 계약 | **20/20 통과** (REAL 언스텁 7개 포함) |
| R1 권위 재조회 계약 | **20/20 통과** |
| rc3 쿼리/필터 계약 | **20/20 통과** |
| participants Realtime 계약 | **16/16 통과** |
| 재조회 가드 계약 | **11/11 통과** |
| **rc3 legacy** | **63/63 통과**, 1990s, 타임아웃 0 |
| **rc3 strict** | **10 실패 / 53 통과**, 하드 게이트 41, 타임아웃 0 |
| JP 쓰기 무결성 + 전체 저장소 | **78 파일 / 1401 통과, 1 skipped** |

strict 실패를 전체 GREEN 요약 안에 숨기지 않았다.

---

## 10. Codex-Critic

| 심각도 | 지적 | 조치 |
|---|---|---|
| — | 트리거 3곳·방어 5가지 감사 | 바이트 단위로 정확함을 독립 확인 |
| HIGH | "선택 제출 지연 모델 부재" 가설을 유일 원인으로 단정 불가. N×M 팬아웃이 타임아웃 7건의 더 근본적 원인일 수 있음 | **수용**. §7 을 H1-a(주)/H1-b(병행, 미검증)로 분리 기술 |
| HIGH | strict 잔여 30건을 프로덕션 결함으로 부를 수 없음 | **수용**. 전량 H1 유지, P1/P2 = 0 |
| MEDIUM | 계약 테스트 11개가 `publishHostRoundResult` 를 스텁 교체 → REAL 방어 미검증(순환 검증 위험) | **수용**. REAL 언스텁 테스트 **7개 추가** — 래치·멱등·자체 재조회가 실제로 작동함을 실증 |
| MEDIUM | `rendered.choiceStartByRound` 가 `beginRoundTimer` 와 `startHostJudgeBackstop` 두 REAL `setInterval` 등록을 구분하지 못함 | **확인**: R1b 게이트는 `isCurrentRoundParticipant()` 를 먼저 보므로 비참가 단말이 걸러져 안전. 다른 소비처의 라벨링 영향은 **미검증**으로 기록 |
| LOW | 제출 경합 | 안전 확인(체크~세팅 사이 `await` 없음) |

BLOCKER 없음. HIGH 2건은 리포트 분류에 반영, MEDIUM 1건은 테스트 추가로 해소, 1건은 미검증으로 명시.

---

## 11. Production Source

**PRODUCTION SOURCE UNCHANGED.** `git diff --stat 34583b4 -- index.html supabase/` → 빈 출력.

## 12. JP-BL-027-B

**OPEN — NOT STARTED.**

## 13. JP-REALTIME-VALIDATION

**OPEN.**

## 14. Production Safety

KR·JP 프로덕션 무변경 / 클라우드 리소스 생성·삭제 없음 / 과금 변경 없음 / **추가 비용 0** / Colima 재시도 없음.

---

## 15. Recommendation

**HARNESS FIDELITY NOT READY**

성공 조건은 "rc3 가 두 결과 발행 트리거와 그 상호작용을 충실히 모델링해, 잔여 strict 불일치가 더 이상 알려진 미배선 발행 경로에 지배되지 않는 것"이었다. 절반만 달성했다:
- 두 트리거의 의미·전제·방어를 완전히 매핑했고, Trigger A 를 프로덕션 기제만으로 구현했으며, REAL 함수의 방어를 언스텁으로 실증했다.
- **선행 격차 하나(선택 제출 게이트)를 발견해 바로잡았고, 그것만으로는 무회귀임을 분리 실험으로 증명했다.**
- 그러나 Trigger A 를 켜는 것은 아직 안전하지 않다 — 하니스에 **선택 제출 지연 모델이 없어** 라운드가 창을 쓰지 않고 즉시 끝나기 때문이다. 이 상수는 프로덕션에도 기존 rc3 모델에도 없으므로(§9), 발명하지 않고 멈춘다.

`nextRound` 는 건드리지 않았다. 다음 슬라이스 후보는 **H1-a(선택 제출 지연 모델)** 이며, 그 상수를 어디서 가져올지에 대한 CEO 판단이 선행되어야 한다.
