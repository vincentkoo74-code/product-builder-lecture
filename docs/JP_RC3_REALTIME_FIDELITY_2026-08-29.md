# MARU RPS V1.0_JP — RC3 REALTIME FIDELITY REPORT (JP-BL-027-C)

작성일: 2026-08-29
브랜치: `feature/rps-jp-line-miniapp` / 기준 커밋: `34583b4`
슬라이스: JP-BL-027-C — rc3 participants Realtime 충실성 (Phase A 한정)

---

## 1. 결론 (선행 요약)

**권고: HARNESS/CLIENT INTEGRITY NOT READY — `nextRound` 로 진행하지 않는다.**

PHASE C STOP GATE 를 통과하지 못했다. 교정된 strict 하니스는 방어 가능한 GREEN 이 아니다.
프로덕션 소스는 이번 슬라이스에서 **한 줄도 변경되지 않았다**.

---

## 2. 범위와 금지사항 준수

| 항목 | 상태 |
|---|---|
| 프로덕션 `nextRound` 수정 | **하지 않음** |
| `index.html` 수정 | **하지 않음** (`git diff 34583b4 -- index.html` 빈 출력) |
| `supabase/` 마이그레이션·RLS·GRANT 수정 | **하지 않음** |
| KR/JP 배포, 과금 변경, 클라우드 프로젝트 생성 | **하지 않음** |
| LINE/LIFF 착수 | **하지 않음** |
| `main` 병합 | **하지 않음** |
| `cap sync` | **하지 않음** |
| 자격증명·PII 노출 | **없음** |

변경 파일은 `tests/` 하위 3개뿐이다.

---

## 3. 프로덕션 Realtime 의미론 감사 (시뮬레이터 설계의 유일한 근거)

`index.html` 실측 결과, participants 변경 전파는 **2계층 + 권위 재조회** 구조다.

### 3.1 구독 (`subscribeToRoom`)
```js
.on('postgres_changes', {event:'*', table:'participants', filter:`room_id=eq.${roomCode}`},
    () => { scheduleFetchParticipants(roomCode); })
```
이벤트 **페이로드로 로컬 상태를 직접 고치지 않는다**. 오직 권위 재조회를 트리거한다.

### 3.2 디바운스 (`scheduleFetchParticipants`, index.html:7103)
```js
function scheduleFetchParticipants(roomCode, delayMs = 80) {
  if (state.fetchParticipantsTimer) clearTimeout(state.fetchParticipantsTimer);
  state.fetchParticipantsTimer = setTimeout(() => { ...; fetchParticipants(roomCode); }, delayMs);
}
```
- **trailing-edge**: 매 알림마다 이전 타이머를 취소하고 다시 건다.
- 병합 창은 네트워크 지연과 무관한 **고정 80ms**.

### 3.3 재조회 경합 가드 (`fetchParticipants`, index.html:7119~)
세 가지 가드가 응답 반영 **전에** 걸린다.
1. `fetchParticipantsBusy` / `fetchParticipantsPending` — 재진입 시 중복 조회 대신 1회 예약
2. `fetchParticipantsSeq` — 더 새로운 요청이 있었으면 늦게 도착한 응답을 폐기
3. `state.roomCode` — `if (!state.roomCode || roomCode !== state.roomCode) return;`
   (roomCode 가 **비어 있는** 경우, 즉 방을 떠난 뒤도 폐기 대상. WRPS-083 후속 실기기 BLOCKER 방어)

### 3.4 보류 재예약 (`finishFetchParticipants`, index.html:7111)
```js
state.fetchParticipantsBusy = false;
if (state.fetchParticipantsPending) { state.fetchParticipantsPending = false; scheduleFetchParticipants(roomCode); }
```
보류는 **즉시 재조회가 아니라 80ms 디바운스 재예약**이다.

---

## 4. 하니스에 반영한 것 (§5 최소 일반 전파)

`nextRound` 전용 특수 처리는 **없다**. 모든 participants write 에 일반적으로 적용된다.

1. **이벤트 발생 조건** — `runMutation` 이 실제로 행을 바꾼 경우에만 전파.
   - 0행 write → 이벤트 없음
   - 오류 주입으로 실패한 write → 이벤트 없음
   - 다른 방(`room_id` 불일치) 대상 변경 → 이 방 구독자에게 가지 않음
2. **2계층 지연** — 1계층 `sampleRealtimeDelayMs`(알림 도착), 2계층 고정 `DEBOUNCE_MS = 80` trailing-edge.
3. **재조회 3중 가드** — busy/pending, seq, roomCode 를 프로덕션과 동일 형태로 구현.
4. **보류 재예약** — `reschedule` 콜백으로 디바운스 스케줄러에 되돌린다(즉시 재시도 아님).

---

## 5. 독립 계약 테스트 (§7)

rc3 시나리오와 분리된 계약 테스트 **47개**, 전부 통과.

| 파일 | 개수 | 고정하는 계약 |
|---|---|---|
| `tests/rc3-harness-query-contract.test.mjs` | 20 | eq 컬럼 정확성, 체인 AND, 교차 방 격리, 카디널리티 0/1/N, select 유무, delete 필터, 비호스트 가드, 오류 주입 |
| `tests/rc3-harness-participant-realtime.test.mjs` | 16 | UPDATE/DELETE 전파, 0행·실패 write 무이벤트, 교차 방 격리, 배달 합침과 순서 보장 |
| `tests/rc3-harness-refetch-guard.test.mjs` | 11 | 재진입 병합, seq 최신성, roomCode 폐기(빈 값 포함), 예외 안전성 |

**어떤 assertion 도 rc3 를 통과시키기 위해 완화하지 않았다.** 반대로 이번 슬라이스에서 계약 테스트 1개는 *더 엄격하게* 뒤집혔다 — "roomCode 미설정이면 반영을 막지 않는다"(내 잘못된 구현을 고정하던 것)를 프로덕션 기준인 "폐기한다"로 교체했다.

---

## 6. strict 모드 실험 결과 (§8) — 프로덕션 무변경 상태에서 측정

`strictFilters` 는 participants 쿼리 필터를 실제 컬럼으로 매칭한다(legacy 는 마지막 필터를 id 로 간주).

| 회차 | 하니스 상태 | rc3 실패 | 하드 게이트 잔여 | 런타임 |
|---|---|---|---|---|
| 기준 (Phase A) | participants 전파 없음 | 9 | **88** | — |
| strict2 | + 전파(leading-edge, 가드 없음) | 9 | **79** | ~1200s |
| strict3 | + 재조회 3중 가드 | 9 | **67** | ~1200s |
| strict4 | + trailing-edge(이벤트당 타이머) | 9 | **98** | 3122s (1건 타임아웃) |
| strict5 | + trailing-edge(단일 타이머) | 9 | (동급) | 1340s |
| **strict6 (최종)** | + 2계층 80ms + roomCode 가드 정정 | **10** | **90** | 2275s |

---

## 7. §9 분류 — **Case C**

CEO §9 의 세 분기 중 **Case C(88 이 실질적으로 해소되지 않음)** 에 해당한다.

판단 근거는 최종 수치(90)가 88 근방이라는 점만이 아니다. **충실성을 높일수록 수치가 단조 감소해야 하는데 실제로는 88 → 79 → 67 → 98 → 90 으로 비단조 이동했다.** 각 단계는 모두 프로덕션 대조로 검증된 *충실성 개선*이었고 그중 어느 것도 의도적 완화가 아니었다. 그럼에도 수치가 오르내린다는 것은,

> 이 측정이 아직 **프로덕션의 안정적 신호가 아니라 하니스 잔여 편차에 지배되고 있다**

는 뜻이다. 따라서 strict 모드의 CROSS_DEVICE_OUTCOME_MISMATCH 를 프로덕션 결함의 증거로 사용할 수 없다. **Realtime 전파 추가가 문제를 해결했다고 가정하지 않는다.**

---

## 8. 남은 실패의 원인 분류 (§9 Case B/C 공통 요구)

| # | 원인 | 분류 | 근거 |
|---|---|---|---|
| R1 | `refreshParticipantsAuthoritative` 가 REAL `fetchParticipants`(243줄, 외부 의존 38개)의 **재조회 부분만** 재현. host 역할 전환, `cleanupDuplicateRoomProfiles`, `shouldResetForParticipantChange`→`beginNewGameRound`, `areAllActivePlayersReady`→`startGame`, `publishHostRoundResult`, `recoverRoundWhenAllPlayersWaiting`, `ensureHostExists` 미재현 | **잔여 하니스 결함 (지배적)** | 프로덕션은 **매 재조회마다** 이 host 권위 로직을 실행한다. 하니스는 `state.participants` 대입만 하고, 그 자리를 트라이얼 글루가 수동으로 메운다. 전파를 켠 순간 이 축약이 처음으로 활성화되었고(이전에는 `pollingEnabled=false` 로 사실상 dead code) 수치가 요동치기 시작했다 |
| R2 | 트라이얼 종료 시 미해소 participants 배달이 조용히 드롭될 가능성 | **잔여 하니스 결함 (미검증)** | fake timer 종료 후 대기 중 체인은 재개되지 않는다. 관측을 **과소 카운트**하는 방향(false negative) |
| R3 | 폴링 경로에서 `reschedule` 부재 시 보류 유실 | **잔여 하니스 결함 (경미)** | 프로덕션은 항상 재예약한다. 폴링 2.6s 주기가 흡수하나 최대 ~2.6s 추가 staleness |
| R4 | `PHANTOM_OR_CORRUPTED_OUTCOME` 413건 중 상당수 | **진단 출력 (결함 아님)** | 변이 민감도 테스트가 의도적으로 유발하는 기대된 출력 |
| R5 | 잔여 `CROSS_DEVICE_OUTCOME_MISMATCH` | **불명 (unknown)** | R1 을 제거하기 전에는 프로덕션 경합인지 하니스 인공물인지 **구분 불가**. 현 시점에 프로덕션 결함으로 단정할 근거가 없다 |

**R1 이 해소되기 전에는 strict 수치로 프로덕션을 판단할 수 없다.** 이것이 이번 슬라이스의 핵심 발견이다.

---

## 9. §10 strictFilters 기본값 전환 — **보류**

기본값은 `false`(legacy)로 유지한다.

- 전환 조건은 "방어 가능한 GREEN"인데 strict 는 10건 실패로 RED 다.
- 동시에, legacy 경로가 정확하다고 주장하지 않는다. legacy 는 participants 필터의 마지막 항목을 id 로 간주하는 **알려진 부정확 근사**이며, 이 사실은 코드 주석과 본 리포트에 명시되어 있다.
- 즉 "GREEN 이 나오니까 부정확한 시뮬레이터를 정상 경로로 둔다"가 아니라, **strict 를 기본값으로 삼을 수 있는 상태가 아직 아니므로 전환을 보류하고 그 사실을 명시적으로 기록**하는 것이다. 전환은 R1 해소 이후 재평가한다.

---

## 10. 회귀 게이트 (§11)

| 대상 | 결과 |
|---|---|
| rc3 시뮬 (legacy 기본값, 최종 하니스) | **63/63 통과**, correctnessPassRate=1.0000, 2067s, 타임아웃 0 |
| 하니스 계약 테스트 3종 | **47/47 통과** |
| 전체 스위트(rc3 제외, `ceo-official-measurement` 포함) | **76 파일 / 1361 통과, 1 skipped** |
| 프로덕션 무변경 | `git diff 34583b4 -- index.html supabase/` **빈 출력** |

런타임은 1255s → 2067s 로 증가했다. 2계층 지연 모델의 비용이며 예산 내다. (이벤트마다 타이머를 거는 순진한 구현은 3065s + 400s 예산 테스트 타임아웃으로 폐기했다.)

---

## 11. codex-critic 검증 (§12) 및 조치

| 지적 | 심각도 | 조치 |
|---|---|---|
| C1 `strictFilters` 기본값이 `true` 로 보임 | CRITICAL | 진행 중이던 측정 실험 상태를 읽은 것. 최종 `false` 복원을 critic 이 직접 재확인 — **해소** |
| C2 축약된 재조회가 전파 추가로 처음 활성화됨 — 수치가 실제 결함인지 인공물인지 구분 불가 | CRITICAL | **수용**. 본 리포트 §8 R1 / §7 Case C 판정의 직접 근거로 채택 |
| H1 보류 재시도가 80ms 재예약이 아니라 즉시 재시도(do/while) | HIGH | **수정**. `reschedule` 콜백으로 디바운스 재예약 |
| H2 디바운스가 trailing-edge 가 아니라 leading-edge | HIGH | **수정**. trailing-edge 로 재구현 |
| H2' 재-arm 지연에 80ms 상수 대신 전파지연 분포 재사용(병합 창 수십~수백 배 과대) | HIGH | **수정**. 2계층 분리, 2계층은 고정 80ms |
| H1' roomCode 가드가 프로덕션과 반대(`&&` 단락평가로 빈 값이 통과), 잘못된 동작을 테스트가 고정 | HIGH | **수정**. `!st.roomCode || ...` 로 정정, 계약 테스트 2개로 교체 |
| M1 축약 자체의 충실성 | MEDIUM | **미해소 — R1 로 등록**. 이번 슬라이스 범위(최소 일반 전파)를 넘어선다 |
| M2 마이크로태스크 틱 하드코딩 | MEDIUM | **해소**. 재작성 과정에서 제거 |
| M3 트라이얼 종료 시 타이머 누수 | MEDIUM | **미해소 — R2 로 등록**. 전 실행 로그에서 unhandled/leaked 경고 0건이나, 이는 부재의 증거일 뿐 drain 보장은 아님 |
| L1 roomCode 커버리지 | LOW | **해소**(일치/불일치/빈 값/조회 중 소실 4케이스) |
| H3 `reschedule()` 이 로컬 80ms 재예약이 아니라 **전파지연을 다시 샘플링** — pessimistic 레짐에서 ~80ms 여야 할 간격이 ~880ms | HIGH | **수정**. 순수 로컬 디바운스 재예약으로 교체. 회귀 방지 계약 테스트 신설, **역검증 완료**(결함 버전 882ms 실패 / 수정본 통과) |
| M4 outOfOrder 레짐에서 wake 최적화가 조기 도착을 놓침 | MEDIUM | **명시적 근사로 문서화**. monotonic(release_gate Normal)에서는 정확한 최적화임을 코드 주석에 불변식과 함께 기록. Degraded/Extreme(informational/stress) 한정 |
| L2 `finally` 루프 재기동 분기가 사실상 도달 불가 | LOW | **유지**. H3 수정으로 `reschedule` 이 루프 밖에서 호출될 수 있어 방어 가치가 생김 |
| L3 폴링 경로 보류 유실을 테스트가 현행 동작으로 고정 | LOW | **R3 해소 시 함께 갱신하도록 표시** |

codex-critic 은 총 3회 실행되었다(초기 검증 → H1/H2 수정 재검토 → 최종 재검토). 최종 재검토에서:
- HIGH-1(roomCode 가드) — **프로덕션과 정확히 동등**으로 통과 확인.
- HIGH-2(2계층 분리) — monotonic 경로의 드레인 로직과 wake 최적화가 **근사가 아니라 정확한 최적화**임을 불변식 근거로 확인.
- 신규 HIGH(H3) 발견 → 수정 → 회귀 방지 계약 테스트로 고정 + 역검증 완료.

남은 지적(M1/R1, M3/R2, R3)은 모두 **이번 슬라이스 범위(§5 최소 일반 전파) 밖**이며 백로그에 등록했다. 이들은 본 리포트의 STOP 권고를 뒤집지 않고 오히려 뒷받침한다.

---

## 12. 열린 항목

- **JP-BL-027-B — OPEN**: 프로덕션 `nextRound` 쓰기 무결성. 본 게이트 미통과로 착수하지 않는다.
- **JP-REALTIME-VALIDATION — OPEN**: 실제 Supabase Realtime 배달 검증. **시뮬레이터 작업으로 닫히지 않는다.**
- **R1 (신규)**: `refreshParticipantsAuthoritative` ↔ REAL `fetchParticipants` 축약 격차. strict 판단의 선행 조건.
- **R2 (신규)**: 트라이얼 종료 시 배달 drain 미보장.
- **R3 (신규)**: 폴링 경로 보류 유실.

---

## 13. 권고 (단일)

**HARNESS/CLIENT INTEGRITY NOT READY.**
`nextRound` 를 포함한 어떤 프로덕션 변경도 진행하지 않는다.
다음 승인 대상으로 제안하는 슬라이스는 **R1 해소**(REAL `fetchParticipants` 의 host 권위 경로를 시뮬레이터가 우회하지 않도록 만드는 것) 하나이며, 그 이후에 strict 수치를 재평가한다.
