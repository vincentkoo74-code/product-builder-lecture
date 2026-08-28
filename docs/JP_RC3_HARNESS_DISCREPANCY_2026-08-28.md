# rc3 Harness Discrepancy Report (Phase A)

**Phase A STOP GATE 에 걸렸다.** 하니스를 프로덕션 쿼리 계약에 맞게 교정하면 rc3 시뮬레이션이
GREEN 이 되지 않는다. 기대치를 약화하지 않았고, Phase B(`nextRound`)로 진행하지 않았다.

## A1. 감사 — 하니스가 모델링하던 것 vs 프로덕션이 실제로 쓰는 것

프로덕션(`index.html`)이 `rooms`/`participants` 에 쓰는 쿼리 형태를 전수 추출했다.

| 형태 | 횟수 | 교정 전 하니스 |
|---|---|---|
| `rooms.update().eq(id)` | 14 | ✅ (단, **컬럼 무시** — 항상 단일 방 매치) |
| `rooms.update().eq(id).eq(status)` (CAS) | 3 | ❌ **체인 미지원 → 가드가 항상 통과** |
| `rooms.update().eq(id).select(id)` | 4 | ✅ |
| `participants.update().eq(id)` | 6 | ✅ (컬럼 무시) |
| `participants.update().eq(room_id)` | 7 | ❌ **id 조회로 처리 → 항상 0행, 무음 누락** |
| `participants.update().eq(room_id).eq(id)` | 1 | ❌ 체인 미지원 |
| `participants.update().in(id)` | 7 | ✅ |
| `participants.delete()...` | 9 | ❌ **delete 자체가 없음** |
| `participants.insert()` / `rooms.insert()` | 5 | ❌ 없음 |
| `select().eq(...).order()/single()` | 20+ | ✅ (컬럼 무시) |

핵심 결함은 **`.eq(column, value)` 가 컬럼명을 무시**한 것이다. 하니스 자신이 이를
`§한계` 주석으로 기록하고 있었고, 한 시나리오에서는 누락된 부작용을 수동으로 흉내내고 있었다.

## A2/A3. 구현

범용 쿼리 빌더로 교체했다 — 컬럼 존중, 체인 조건 AND, `in()` 지원, `delete` 지원,
`.select()` 시 **실제로 영향받은 행만** 반환(0행이면 오류가 아니라 빈 배열).
부작용은 전부 보존했다: host 가드, 오류 주입 키/타이밍, ack 지연,
realtime 브로드캐스트(단 **실제 변경이 있을 때만** — 0행은 커밋도 전파도 아니다).

## A4. 계약 테스트 — `tests/rc3-harness-query-contract.test.mjs` (20건, 전부 통과)

eq 컬럼 정확성 / 체인 AND / 교차 방 격리 / 카디널리티(0·1·N) / `select()` 유무 차이 /
delete 필터 / rooms 부작용이 0행에서 발생하지 않음 / non-host 가드 / 오류 주입 계약.
`nextRound` 와 무관하게 쿼리 계층만 검증한다.

## A5. 회귀 — **GREEN 불가**

프로덕션 소스를 **전혀 바꾸지 않은 상태**로 전체 스위트를 돌린 결과:

```
74/75 파일 통과, rc3-multiparticipant-sim 만 9건 실패
```

### 원인 분리 (결정적)

| 실험 | 결과 |
|---|---|
| participants 만 컬럼 인식 (rooms legacy) | **실패** |
| rooms 만 컬럼 인식 (participants legacy) | **통과** |

→ 원인은 **`participants` 대량 갱신(`.eq('room_id', …)`)이 실제로 적용되기 시작한 것** 하나다.
   rooms 컬럼 인식(CAS 가드 정상화 포함)은 무해했다.

### 드러난 것

하드 게이트에서 **CROSS_DEVICE_OUTCOME_MISMATCH 88건** + STALE_ROW_REGRESSION /
ROUND_NOT_MONOTONIC / DOUBLE_COUNTDOWN_RENDER. 기기 간 라운드 결과 불일치다
(예: `p0:tooMany … p3:tooFew`, `p7:allDraw` 뿐 나머지 `gameOver`). 대부분 round 1 에서 발생하며,
이는 `goToReadyScreen`/`startGame` 의 `.eq('room_id', …)` 대량 리셋이 이제 실제로 적용되기
때문이다.

## 이것이 프로덕션 결함인가 — **단정할 수 없다**

교정된 하니스는 한 축에서 더 충실해졌지만 **다른 축은 여전히 불충실하다**:

> 이 하니스는 `participants` 변경에 **realtime 전파가 없다.** 구독·브로드캐스트가 `rooms` 에만
> 있고, 기기는 `select()` fetch 로만 참가자 변화를 안다. 반면 프로덕션은 `participants` 도
> `postgres_changes` 로 전파된다.

따라서 "대량 리셋이 적용되는 순간"과 "다른 기기가 그것을 인지하는 순간" 사이의 간극을
하니스가 **실제보다 크게** 만든다. 88건의 불일치 중 어디까지가 진짜 프로덕션 레이스이고
어디까지가 이 모델링 공백의 산물인지 지금 증거로는 가를 수 없다.

**그래서 두 가지를 모두 하지 않았다.**
- 기대치를 낮추지 않았다(하드 게이트 단언 무변경).
- "교정했으니 프로덕션 결함이다"라고 단정하지 않았다.

## 현재 저장소 상태

`createDb({ strictFilters })` 플래그로 분리했다.

| 모드 | 사용처 | 상태 |
|---|---|---|
| `strictFilters: false` (기본) | rc3 시뮬레이션 | 기존 동역학 보존 → 회귀 GREEN |
| `strictFilters: true` | 계약 테스트 20건 | 교정된 프로덕션 계약 검증 |

교정 코드는 저장소에 남아 테스트로 보호되지만, 시뮬레이션 기본값은 바뀌지 않는다.

## 다음에 필요한 것 (CEO 판단)

1. **participants realtime 전파 모델링** — 하니스에 참가자 변경 브로드캐스트를 추가한다.
   그래야 `strictFilters: true` 로 켰을 때의 실패가 "진짜 레이스"인지 판별 가능해진다.
2. 그 후 `strictFilters` 기본값을 true 로 전환하고 회귀를 안정화한다.
3. **그다음에야** Phase B(`nextRound` 카디널리티 검증)를 시작한다.

이 순서를 바꾸면 하니스 변화와 프로덕션 변화가 뒤섞여 원인 분리가 불가능해진다 —
이번 슬라이스에서 실제로 그 상황을 만났고, 그래서 여기서 멈춘다.
