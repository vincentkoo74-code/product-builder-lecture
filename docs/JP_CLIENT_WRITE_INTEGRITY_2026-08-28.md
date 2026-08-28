# MARU RPS V1.0_JP — Client Write Integrity (JP-BL-027)

`error === null` 은 write 성공의 증거가 아니다. 이 문서는 그 사실이 무엇을 바꿨는지 기록한다.

## 0. 확정된 전제 (실제 PostgREST 16.2 실측)

| 상황 | HTTP | 영향 행 | error |
|---|---|---|---|
| 유효한 방에 write | **200** | 1 | null |
| 24시간 창 밖 방에 write (RLS 거부) | **200** | **0** | **null** |
| 권한 없음 (GRANT 부재) | 401 | — | `42501` |

**HTTP 상태로는 성공과 무음 거부를 구별할 수 없다. 영향 행 수만이 유일한 판별 수단이다.**

## 1. 실패 분류

| 분류 | 조건 | 클라이언트 처리 |
|---|---|---|
| `SUCCESS` | 영향 행 정확히 1건 + 행 id 일치 | 로컬 상태 커밋 |
| `ZERO_ROW_WRITE` | 오류 없음 + 0행(또는 id 불일치/다중 행) | **로컬 커밋 안 함**, 메트릭, 동기화 안내 |
| 하드 오류 | `res.error` 존재 | 기존 오류 처리 경로 |

사용자에게는 `common.syncError`(ko/en/ja 완비)만 노출한다. RLS·PostgREST·42501 같은 내부 용어는 노출하지 않는다.

## 2. Critical write 인벤토리

전체 mutation 호출 **65개**를 재감사했다(이전 세션의 "7개" 목록은 크게 불완전했다 —
`markReadyFromLobby` 라는 **두 번째 ready 진입점**이 누락돼 있었다).

### 이번 슬라이스에서 보호 (9)

| 함수 | 테이블 | 기대 카디널리티 | 이전 탐지 | 새 탐지 |
|---|---|---|---|---|
| `markReady` | participants | 정확히 1 (내 행) | 없음 → 낙관적 커밋 | `.select('id')` + 행 id 대조 + 0행 시 throw·재조회·안내 |
| `markReadyFromLobby` | participants | 정확히 1 (내 행) | 없음 → 낙관적 커밋 | 동일. 0행 시 커밋 전 return |
| `updateParticipantChoice` | participants | 정확히 1 (내 행) | 없음(맨몸 await) | 검증 후 boolean 반환 |
| `updateRoomStatus` | rooms | 정확히 1 (내 방) | 없음(맨몸 await) | 검증 후 boolean 반환 |
| `updateRoomStatusScheduled` | rooms | 정확히 1 (내 방) | 없음(맨몸 await) | 검증 후 boolean 반환 |
| `reserveDeferredLeave` | participants | 정확히 1 (내 행) | `error` 만 | 0행도 throw — 성공 토스트 전에 |
| `startGame` | rooms | 정확히 1 (내 방) | 없음 | 0행 시 throw → 기존 오류 경로 |
| `publishHostRoundResult` | participants | 참가자별 각 1 | 없음 | 미반영 참가자 발견 시 권위 재조회, 로컬 덮어쓰기 안 함 |
| `autoFillChoices` | participants | 참가자별 각 1 | 없음 | 미반영 시 `ZERO_ROW_WRITE` 메트릭 |

### 호출부 수정 (보호가 무력화되던 지점 — codex-critic HIGH-1·2)

| 호출부 | 문제 | 수정 |
|---|---|---|
| `selectChoice` | `updateParticipantChoice` 반환값 무시 + write 전에 로컬 커밋 | 실패 시 **직전 선택으로 롤백** + 안내 |
| `goToReadyScreen` | `updateRoomStatus` 반환값 무시 + `state.status` 무조건 커밋 | `false` 면 커밋 없이 return + 버튼 복구 |
| `_doLeaveRoom` | 방 상태 리셋이 하드닝된 헬퍼를 우회 | `updateRoomStatus('waiting')` 로 통일 |

### 이미 보호됨 (건드리지 않음)

| 함수 | 보호 방식 |
|---|---|
| `promoteParticipantToHost` | `select('id,is_host').single()` 검증 재조회 + `HOST_PROMOTE_WRITE_FAILED` |
| `becomeNextHost` | `verifyExactlyOneHost()` 사후 수렴 검증 |
| `nextRound` | Build29 HIGH-1: `{error}` resolve → throw 승격 + 재시도 안전망 + 메트릭 |

### 0행이 정상인 경로 (승격 금지)

`recordRoundResolution` / `myResult` 의 `.eq('status','result')` 조건부 CAS write.
0행 = "이미 다른 단말이 확정함". 실패로 승격하면 2-writer 레이스 방어가 깨진다.
**테스트로 이 구분을 잠갔다.**

### 게임 상태 비판정 (범위 밖)

`cleanupDroppedParticipants` / `duplicates` / `stale` (유령 정리),
`archiveSource` (백업), `addDemoParticipant` (데모), `confirmedLoserCount` (표시 계산).

## 3. 구현 방식 — 공유 헬퍼를 만들지 않았다

이전 세션의 `writeWithRowCheck` 공유 헬퍼는 회귀 37건을 깨뜨렸다. 원인은 테스트 하니스가
`extractBlock()` 으로 **개별 함수 소스만 잘라 `new Function` 샌드박스에서 평가**하기 때문이다 —
다른 위치의 공유 헬퍼는 그 슬라이스 밖이라 `ReferenceError` 가 된다.

이번에는 CEO §5 지시대로 **호출부 인라인 검증**을 썼다. 중복이 생기지만 각 호출부가
자기 카디널리티 계약을 명시적으로 들고 있어 감사 가능하고, 하니스 구조와 충돌하지 않는다.

## 4. 테스트 대역 변경 (CEO §11 승인)

`rc3-harness-support.mjs` / `build37-a2` / `build37-a3` / `build37-a7` 의 가짜 supabase
클라이언트가 **실제 PostgREST 계약을 모델링**하도록 고쳤다.

```
await update(...).eq(...)          → { error }                  (HTTP 204, 영향 행 정보 없음)
await update(...).eq(...).select() → { data: [영향 행], error }   (0행이어도 error=null)
```

영향 행은 대역의 행 모델에 필터를 **실제로 적용해** 계산한다 — 그래야 "대상이 없어 0행"인
무음 실패를 테스트가 재현할 수 있다. 이것은 약화가 아니라 **실제 동작을 처음으로 모델링한 것**이다.

### build19 소스 계약 강화

| | |
|---|---|
| 기존 가정 | `update({status, penalty})` 한 번이면 원자적 기록이 보장된다 |
| 실증된 실제 동작 | RLS 거부 시에도 오류 없이 성공을 반환한다 — 호출됐다는 것이 기록됐다를 보장하지 않는다 |
| 새 단언 | 원자성 + `.eq('id',…)` + `.select('id')` + 행 수 검사 + `ZERO_ROW_WRITE` 메트릭 |
| 왜 더 강한가 | 검사 항목이 1개 → 5개. 기존 단언은 모두 유지된다 |

## 5. 실제 PostgREST 통합 검증 (§13)

클라이언트의 판정 로직을 그대로 재현해 로컬 스택에 왕복시켰다.

| 시나리오 | HTTP | 판정 |
|---|---|---|
| ready (유효 방) | 200 | **SUCCESS** (1행) |
| ready (25시간 경과 방) | **200** | **ZERO_ROW_WRITE** (0행) |
| choice (유효) / (만료) | 200 / 200 | SUCCESS / **ZERO_ROW_WRITE** |
| roomStatus (유효) / (만료) | 200 / 200 | SUCCESS / **ZERO_ROW_WRITE** |
| leave delete (유효) / (만료) | 200 / 200 | SUCCESS / **ZERO_ROW_WRITE** |
| stats (권한 없음) | 401 | HARD_ERROR `42501` |

**유효/만료가 HTTP 상태로는 완전히 동일**한데 클라이언트가 정확히 갈라낸다.

## 6. 24시간 경계

RLS 규칙은 **약화하지 않았다**(`supabase/migrations/` 무변경). 만료 방은 여전히 백엔드가
거부하고, 이제 클라이언트가 그것을 인지해 거짓 성공으로 진행하지 않는다.

## 7. 남은 한계

- 보호한 3개 함수(`updateRoomStatus`/`updateParticipantChoice`/`updateRoomStatusScheduled`)가
  boolean 을 반환하지만 **기존 호출부는 반환값을 아직 사용하지 않는다.** 이번 슬라이스는
  "무음 실패를 관측 가능하게 만들고 로컬 상태 오염을 막는 것"까지다. 호출부의 대응
  (재시도/화면 되돌리기)은 제품 결정이며 별도 슬라이스다.
- **`JP-REALTIME-VALIDATION — OPEN`**: 실제 Realtime 이벤트 전달은 여전히 미검증이다.
