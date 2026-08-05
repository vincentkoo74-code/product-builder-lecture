# WRPS-084 Decision Register

> **STATUS: Draft — Implementation Pending**
> 기준 HEAD `f6f7eb759fbe99ea0c8d983bbd82f67271115f75`
> **코드와 DB에 아직 미적용.** 로컬 migration SQL 파일도 아직 생성하지 않았다.
> CEO 결정 반영일: **2026-08-05**

WRPS-084의 미확정 항목을 결정 단위로 추적한다. 상태 머신 본문(`WRPS084_DEFERRED_LEAVE_STATE_MACHINE.md`)은 "무엇이 확정됐는가"를, 이 문서는 "어떤 근거로 그렇게 결정됐는가"를 담는다. **두 문서를 합치지 않는다.**

**결정 상태 표기**: `OPEN`(미결) / `DECIDED`(확정) / `DEFERRED`(범위 밖 이관).

| ID | 항목 | 심각도 | 상태 | 결정일 |
|---|---|---|---|---|
| DR-084-1 | `leave_after_round` DB 마이그레이션 | CRITICAL | **DECIDED**(단계 제한) | 2026-08-05 |
| DR-084-2 | 예약자 퇴장 후 progression / 리셋 범위 | HIGH | **DECIDED** | 2026-08-05 |
| DR-084-3 | `isRoundInProgress()` 판정 범위 | HIGH | **DECIDED**(의미 기반 재설계) | 2026-08-05 |
| DR-084-4 | Host 오프라인 + row 잔존 처리 | MEDIUM | **DECIDED** | 2026-08-05 |
| DR-084-5 | 예약 배지 정책 | LOW | **DECIDED** | 2026-08-05 |
| DR-084-6 | deadlock 분기와 예약자 상호작용 | — | **DECIDED** | 2026-08-05 |

**확인 요청 2건 모두 확정됨(2026-08-05)**: 오프라인 확정 기준은 기존 45,000ms 유예 재사용(DR-084-4), gameNo 보존은 전용 사유 `resetReason='deferred_leave'` 신설(DR-084-2). 미결 항목 **0건**.

---

## DR-084-1 — `leave_after_round` DB 마이그레이션

**심각도: CRITICAL / 상태: DECIDED (단계 제한)**

### CEO 결정
`participants.leave_after_round boolean not null default false`를 **승인**한다.

**이번 단계 허용 범위**
- 로컬 migration SQL 작성
- rollback SQL 또는 rollback 절차 작성
- 기존 row 영향 검증
- shadow / local DB 검증
- PostgREST 컬럼 노출 검증 계획

**금지**: 원격 DB 적용.

> 현재 상태: **로컬 SQL 파일도 아직 생성하지 않았다.** 최종 설계 보고 승인 후 생성한다. 설계는 아래 §부록 A.

### 근거
운영 DB read-only 확인 결과 컬럼이 없다.
```
GET /participants?select=leave_after_round&limit=1
→ 400 {"code":"42703","message":"column participants.leave_after_round does not exist"}
대조군 GET /participants?select=is_ready → 200 [{"is_ready":false}]
```
현재 컬럼 11개: `id, room_id, name, is_host, is_ready, choice, wins, losses, draws, penalties, created_at`

### 기각된 대안
| 안 | 기각 사유 |
|---|---|
| `choice='__leaving__'` | `isNonPlayingChoice`가 예약자를 판정에서 배제 → **확정 규칙 E 위반**(자동 패배와 동치) |
| `is_ready` 재사용 | 준비 의사와 퇴장 의사는 동시 성립 가능 → 표현 불가 |
| `is_host` 재사용 | Host도 예약 가능 → 표현 자체가 불가능 |
| `PLAYER_STATUS.WAITING` 재사용 | WAITING은 "현재 라운드 미참여". 예약자는 참여한다 → 의미 정반대 |
| 로컬 전용(DB 미사용) | 타 단말 배지 표시 성립 불가 |

### 영향 함수 / 테스트
`setLeaveAfterRound`·`toggleLeaveAfterRound`·`processDeferredLeaves`(planned), `getParticipantBadge:10369`(existing), `fetchParticipants:6215`(existing, 수정 0줄)
L2, L5, L6, L7, L8, L10, L18 / Q1, Q5, Q6, Q11, Q14

---

## DR-084-2 — 예약자 퇴장 후 progression / 리셋 범위

**심각도: HIGH / 상태: DECIDED**

### CEO 결정
**기존 progression을 유지한다.** 단 "리셋"의 범위를 아래로 한정한다.

**초기화 허용 (4개)**: `choice` / `is_ready` / 현재 라운드 임시 marker / 다음 ready 상태

**절대 초기화 금지 (6개)**: 완료 전적 / `wins`·`losses`·`draws` / `user_game_history` / `user_game_stats` / 완료 라운드 결과 / **같은 게임의 `gameNo`**

**확정 순서**
```
결과·전적 저장 확인 → 최신 leave_after_round 재조회 → 일반 예약자 제거
→ 참가자 재조회 → Host exactly-one 확인/복구 → 최소 인원 확인 → ready 또는 대기 상태
```

### 구현 시 필수 확인
`getNewGameRoundParticipantPatch:4999`(existing)는 `wins/losses/draws/penalties`를 **0으로 리셋**한다. 이 리셋은 `archiveCurrentRoundStats:5021`가 선행 호출된 뒤에만 안전하다. `beginNewGameRound:5220`은 그 순서를 지키고 있다(archive → 로컬 리셋 → DB patch). **예약자 퇴장 경로가 이 순서를 우회하면 전적이 유실된다.**

### 영향 함수 / 테스트
`shouldResetForParticipantChange:4993`, `beginNewGameRound:5220`, `archiveCurrentRoundStats:5021`, `processDeferredLeaves`(planned)
L9, L21 / Q13

### 문서 반영
`WRPS084_DEFERRED_LEAVE_STATE_MACHINE.md` §7-A "리셋 허용 범위" 표.

### gameNo 보존 — 전용 progression 사유 확정 (2026-08-05)

**퇴장 예약 처리로 참가자가 제거되는 것만으로 gameNo를 증가시키지 않는다.** 전용 사유 `resetReason='deferred_leave'`를 신설한다.

| 이 경로에서 | 조치 |
|---|---|
| gameNo / 완료 round 결과 / `wins`·`losses`·`draws` / `user_game_history` / `user_game_stats` | **유지** |
| `choice` | 초기화 |
| `is_ready` | `false` |
| 임시 confirmed marker | 정리 |
| 남은 참가자 | ready 재구성 |

**범위 제한**: `shouldResetForParticipantChange:4993`의 **일반 정책은 변경하지 않는다.** 중도 이탈·host 승계·강제 종료 등 기존 경로는 지금처럼 새 게임 회차를 시작한다. gameNo를 보존하는 것은 `processDeferredLeaves`가 호출하는 전용 경로 하나뿐이다.

이 결정으로 `RPS_ROOM_LIFECYCLE_ARCHITECTURE.md §14-3`과의 discrepancy가 해소된다 — 두 규칙이 서로 다른 경로에 적용되므로 모순이 아니다.

**구현 주의**: 예약자 삭제를 관측한 **다른 단말**의 `fetchParticipants:6215`가 `shouldResetForParticipantChange`를 통해 일반 리셋을 트리거할 수 있다. 전용 경로가 성립하려면 그 관측 경로에서도 `deferred_leave`로 인한 제거임을 구분할 수 있어야 한다 — 구현 설계에서 식별 수단을 확정해야 한다(mutation Q13 대상).

---

## DR-084-3 — `isRoundInProgress()` 판정 범위

**심각도: HIGH / 상태: DECIDED (의미 기반 재설계)**

### CEO 결정
`["playing","result"]` 단순 열거안은 **반려**. 의미 기반으로 재설계한다.

**진행 중**: 권위적 countdown 시작 확정 시점 / `playing` / `result` / 결과 저장 진행 중 / deferred-leave 처리 시작 전
**진행 중 아님**: `lobby` / `waiting` / countdown 시작 전 `ready` / `game_over` 처리 완료 / `stats` / `destroyed`

### read-only 조사 결과 (7개 지점)

| 지점 | 위치 | 신호 |
|---|---|---|
| countdown 참가자 snapshot 확정 | `startGame:7413-7423` (`choice=null` 일괄 리셋 + 마커 재기록) | 이 write 완료 시 참가 집합 고정 |
| `scheduledStartAt` 생성 | `getNextCountdownStartAt:4549` = `serverNow()+3600` → `startGame:7425` | `penalty.countdownStartAt` |
| `playing` 전환 | `rooms.update({status:'playing', penalty}):7435` → `state.status="playing":7438` → `enterPlayingStateFromRoomUpdate:5500` | `state.status` |
| `result` DB write | `publishHostRoundResult:6149` → `updateRoomStatusScheduled("result","result")` | `state.status` |
| 결과 저장 완료 | `recordRoundResolution` → `state.lastRoundResolution:8590`. gameOver면 `autoSaveGameOverResultOnce:8159` / `persistCompletedGameWithRetry:9969` | idempotency 앵커 |
| deferred-leave 처리 시작 | `processDeferredLeaves`의 `state.leavingProcessing = true` 동기 대입 (planned) | 취소 마감 |
| 취소 마감 | 위와 동일 | §5-B |

### 핵심 발견
**별도의 countdown 상태는 존재하지 않는다.** `startGame:7434-7437`이 `rooms.update({status:'playing', penalty:{countdownStartAt}})`로 **status와 카운트다운 앵커를 단일 write에 원자적으로** 싣는다. 따라서 "권위적 countdown 시작 확정" = `status='playing'` 전이 그 자체다. `nextRound:9904`는 `status:'ready'`에 `phaseScheduledAt`만 싣고 `countdownStartAt`은 넣지 않으므로 **`ready`는 항상 countdown 전**이다.

주의: `getCountdownStartAt()`(무인자, `:4411`)은 `Math.max(parsed, state.countdownStartAt)`의 **sticky max**라 이전 라운드 값이 남는다 → 판정에 사용 금지.

### 결정된 정의 / 진리표
`WRPS084_DEFERRED_LEAVE_STATE_MACHINE.md` §5-A에 정의와 15행 진리표를 기록했다. 핵심은 **행 4·8**이다 — `status`가 이미 다음 단계로 넘어갔지만(`ready`/`game_over`) 이번 라운드의 저장이 아직 살아 있는 구간을 `publishingRoundResult`/`finishingRound`로 잡는다. 단순 열거안이 놓치는 지점이며 R8 위반의 직접 원인이다.

### 영향 함수 / 테스트
`isRoundInProgress`(planned), `leaveRoom:10929`(existing)
L1(status 매트릭스 확장 권고), L2

---

## DR-084-4 — Host 오프라인 + row 잔존 처리

**심각도: MEDIUM / 상태: DECIDED**

### CEO 결정
결정적 orphan 승계로 확정한다.

**7조건**: Host 오프라인 확정 / 결과·전적 저장 완료 / `leave_after_round=true` 또는 dropped 확정 / 다른 온라인 참가자 존재 / `!roomClosing` / `room.status !== 'destroyed'` / 승계·퇴장 처리 중 아님
**후보**: `created_at` asc, 동률 시 `id` asc
**순서**: 새 Host 승격 → SELECT 재검증 → exactly-one 확인 → 기존 Host 권한 제거 → 기존 Host row 정리
**절대 원칙**: 검증 전 기존 Host row 삭제 금지

### 추가된 구현 게이트
7조건을 만족해도 **결정적 후보 본인만 write**한다(`pickDeterministicHostCandidate`의 결과 == `state.currentUserId`). 다단말이 같은 결론에 도달해도 write는 1건이다 — `ensureHostExists:12980`(existing)과 동일 원리.

### 오프라인 확정 기준 — 확정 (2026-08-05)
**기존 `cleanupDroppedParticipants:5541`의 45,000ms 유예 기준을 재사용한다. 별도 임계값을 만들지 않는다.**

조건이 8개로 확정됐다(조건 8 = 처리 직전 동일 Host 오프라인 재확인 추가). 순서에도 ① 결정적 후보 선정이 명시적 단계로 들어갔다.

**복귀 처리**: 45초 이내 복귀 → 권한 유지 / 승계 진행 중 복귀 → 조건 8이 잡아 중단 / 승계 완료 후 복귀 → 일반 참가자(R3·R4 적용, 과거 이력은 권한 근거 아님).

**구현 주의**: `cleanupDroppedParticipants`의 dropped 추적 루프는 `!p.is_host` 필터(`:5527`)로 host를 제외하고 `["waiting","lobby","ready"]` status 게이트(`:5525`)도 있다. 임계값(45,000ms)은 공유하되 **host용 관측 기록은 별도로 채워야 한다.** 매직 넘버 복제 대신 공유 상수 승격을 권고한다.

### 영향 함수 / 테스트
`promoteOfflineHostSuccessor`(planned) / 재사용: `pickDeterministicHostCandidate:10844`, `promoteParticipantToHost:10861`, `verifyExactlyOneHost:10896`, `isParticipantOnline`
L17, L14, L22 / Q8

---

## DR-084-5 — 예약 배지 정책

**심각도: LOW / 상태: DECIDED**

### CEO 결정
- 본인: 고정 퇴장 예약 토글 버튼
- 타인: 참가자 목록 이름 옆 작은 `🚪`
- **단일 공통 helper**
- **DB false 재검증 후** 전 단말 제거
- Host / WAITING / 결과 배지와 **독립**(병기)

### 영향 함수 / 테스트
`getParticipantBadge:10369`(existing), `updateLeaveAfterRoundButtons`(planned) / L6, L8 / Q5, Q11

---

## DR-084-6 — deadlock 분기와 예약자 상호작용

**심각도: — / 상태: DECIDED**

### CEO 결정
퇴장 예약자는 **현재 라운드의 완전한 참가자**다. 기존 deadlock 규칙을 동일하게 적용하고, 정상 결과·전적 저장 뒤에만 퇴장한다.

→ 확정 규칙 A~E로 문서화: `WRPS084_DEFERRED_LEAVE_STATE_MACHINE.md` §1-A, 경계 시나리오 S1~S5는 §8-A.

### 영향 테스트
L3, L4, L10, L21 / Q2, Q3

---

# 부록 A — Migration 설계 (DR-084-1)

> **SQL 파일은 아직 생성하지 않았다.** 이 설계의 승인 후 생성한다.

## A-1. 파일명

기존 규약 `YYYYMMDDHHMMSS_snake_case_description.sql`
```
supabase/migrations/20260528205753_account_game_stats.sql
supabase/migrations/20260726104300_server_now_rpc.sql
```
→ 제안: `supabase/migrations/<timestamp>_participants_leave_after_round.sql`
(timestamp는 생성 시점 UTC로 확정. 기존 두 파일보다 뒤여야 한다.)

## A-2. up SQL

기존 `20260726104300_server_now_rpc.sql`의 스타일을 따른다 — 상단 근거 주석 블록 + `begin;`/`commit;` 원자 적용 + 말미 rollback 주석.

```sql
-- ─────────────────────────────────────────────────────────────────────────
-- WRPS-084 Deferred Leave — participants.leave_after_round
--
-- 배경: 라운드 진행 중 나가기를 "퇴장 예약"으로 전환하고, 라운드 판정과
-- 전적을 정상 완료한 뒤 퇴장시킨다. 예약 상태는 다른 단말에도 보여야
-- 하므로 공유 저장소(DB)가 필요하다.
--
-- 왜 신규 컬럼인가(기존 컬럼 재사용 금지 근거):
--   - choice: 판정 입력이다. 마커를 넣으면 isNonPlayingChoice가 예약자를
--     판정에서 배제해 "퇴장 예약 = 자동 패배"가 된다(확정 규칙 E 위반).
--     이미 __safe__/__loser__/__waiting__ + 결과 인코딩으로 과적재 상태다.
--   - is_ready: 다음 라운드 준비 의사와 퇴장 의사는 동시 성립 가능하다.
--   - is_host: Host도 예약할 수 있어 표현 자체가 불가능하다.
--
-- not null default false 근거:
--   - 기존 row 전부 즉시 유효한 값을 갖는다(NULL 분기 불필요).
--   - 구버전 앱의 insert는 이 컬럼을 명시하지 않으므로 default가 적용된다.
--   - Postgres 11+ 에서 default가 있는 컬럼 추가는 테이블 rewrite 없이
--     카탈로그만 갱신한다(짧은 ACCESS EXCLUSIVE 락).
--
-- 이 마이그레이션의 제약:
--   - 테이블 생성/삭제 없음, 기존 컬럼 변경 없음, 인덱스 추가 없음
--   - RLS 정책 변경 없음(행 단위 정책이므로 신규 컬럼은 자동 상속)
--   - trigger/scheduler/RPC 없음
-- ─────────────────────────────────────────────────────────────────────────

begin;

alter table public.participants
  add column if not exists leave_after_round boolean not null default false;

comment on column public.participants.leave_after_round is
  'WRPS-084: 현재 라운드 종료 후 자동 퇴장 예약. true여도 이번 라운드의 판정·전적에는 '
  '일반 참가자와 완전히 동일하게 포함된다(자동 패배 아님). choice/is_ready/is_host와 '
  '독립된 lifecycle 축이며, 판정 로직(computePlayerStatuses 등)은 이 컬럼을 읽지 않는다.';

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback(참고용 — 이 마이그레이션 파일 자체에서는 실행하지 않음):
--
--   alter table public.participants drop column if exists leave_after_round;
--
-- ─────────────────────────────────────────────────────────────────────────
```

## A-3. Rollback 절차

기존 규약대로 **실행하지 않는 주석**으로만 기재한다(`server_now_rpc.sql`과 동일).

| 단계 | 조치 |
|---|---|
| 1 | 코드를 먼저 롤백한다(이 컬럼을 읽고 쓰는 코드가 없어야 한다) |
| 2 | `alter table public.participants drop column if exists leave_after_round;` |
| 3 | `notify pgrst, 'reload schema';` (필요 시) |
| 4 | `GET /participants?select=leave_after_round` 가 `400/42703`을 반환하는지 확인 |

**데이터 손실 범위**: 이 컬럼의 값(퇴장 예약 여부)만 사라진다. 예약은 라운드 단위 휘발성 의사 표시이므로 영구 데이터가 아니다. `wins/losses/draws/penalties`·전적·이력에는 영향이 없다.

**롤백 안전성**: 컬럼 추가는 다른 컬럼·제약·인덱스를 건드리지 않으므로 drop이 안전하다.

## A-4. 기존 row 영향 검증 SQL

```sql
-- ① 컬럼 존재·타입·기본값·NOT NULL 확인
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'participants'
  and column_name = 'leave_after_round';
-- 기대: boolean / NO / false

-- ② 기존 row가 전부 false로 채워졌는가 (NULL 0건이어야 한다)
select count(*) as total,
       count(*) filter (where leave_after_round is null)  as null_rows,
       count(*) filter (where leave_after_round = false)  as false_rows,
       count(*) filter (where leave_after_round = true)   as true_rows
from public.participants;
-- 기대: null_rows = 0, true_rows = 0, false_rows = total

-- ③ 다른 컬럼이 손상되지 않았는가 (마이그레이션 전후 비교)
select count(*) as participants_total,
       count(distinct room_id) as rooms_referenced,
       count(*) filter (where is_host) as host_rows
from public.participants;

-- ④ 제약/인덱스가 추가되지 않았는가
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.participants'::regclass;
```

## A-5. shadow / local DB 검증

원격 적용 전 다음 순서로 검증한다.

1. **로컬 Postgres 또는 `supabase start`** 로 빈 스키마에 `participants` 테이블을 만들고 마이그레이션 적용
2. A-4의 ①②④ 실행 — 기대값 일치 확인
3. **기존 row가 있는 상태 시뮬레이션**: 더미 row를 넣은 뒤 마이그레이션 적용 → ② 재실행(`null_rows=0`, `false_rows=total`)
4. **구버전 insert 시뮬레이션**: 컬럼을 명시하지 않는 insert가 성공하고 `false`가 들어가는지 확인
   ```sql
   insert into public.participants (id, room_id, name, is_host) values ('t1','TEST','tester',false);
   select leave_after_round from public.participants where id = 't1';  -- 기대: false
   ```
5. **rollback 검증**: drop 후 ①이 0행을 반환하는지, 다른 컬럼이 그대로인지 확인
6. 로컬 검증 테이블 정리

> 현재 로컬에 `supabase` CLI와 `psql`이 모두 설치되어 있지 않다(확인함). 이 단계를 수행하려면 둘 중 하나의 설치가 선행되어야 한다 → 구현 승인 시 함께 결정 필요.

## A-6. PostgREST 컬럼 노출 검증

PostgREST는 스키마 캐시를 보유하므로 DDL 직후 컬럼을 인식하지 못할 수 있다(`PGRST204`). Supabase는 DDL 이벤트 트리거로 자동 `NOTIFY pgrst, 'reload schema'`를 보내며 보통 수 초 내 반영된다.

| 단계 | 명령 | 기대 |
|---|---|---|
| 적용 전 (현재) | `GET /participants?select=leave_after_round&limit=1` | `400` `42703 column does not exist` |
| 적용 직후 | 동일 | `200` `[{"leave_after_round":false}]` |
| 미반영 시 | `notify pgrst, 'reload schema';` 1회 | 데이터 변경 없음 |
| 재확인 | 동일 GET | `200` |
| 쓰기 경로 확인 | 테스트 방에서 `PATCH /participants?id=eq.<test>` with `{"leave_after_round":true}` | `204`. 실패 시 컬럼 단위 GRANT/RLS 이슈 → 정책 확인 필요 |

> 마지막 쓰기 확인은 **원격 적용 승인 이후**에만 수행한다. 현재 단계에서는 금지다.

## A-7. 구버전 앱 호환성

| 관점 | 결과 |
|---|---|
| 구버전이 컬럼을 읽는가 | 아니다. `select('*')`로 받아 무시한다 |
| 구버전이 컬럼을 쓰는가 | 아니다. insert 4곳(`index.html:6579, 7208, 7265, 7298`)이 명시하지 않아 default `false` |
| 구버전 사용자의 체감 | 예약 기능만 없다. 기존 즉시 퇴장이 그대로 동작 |
| 혼합 버전 방(신·구 동시 접속) | 신버전이 예약해도 구버전 화면에는 `🚪` 배지가 안 보인다. **판정·전적은 영향 없음**(확정 규칙 B). 예약자 자동 퇴장은 신버전 본인 단말이 수행하므로 정상 작동 |
| 되돌림(컬럼 drop) 후 신버전 | `select('*')`는 성공하나 `leave_after_round`가 `undefined` → falsy로 평가되어 "예약 없음"으로 동작. 단 update 시 `PGRST204` 발생 → **코드 롤백을 먼저** 해야 한다 |

**결론: DB 선배포가 안전하다.** 구버전은 컬럼을 전혀 참조하지 않으므로 컬럼이 먼저 존재해도 무해하다.

## A-8. 배포 순서 비교

| 방식 | 절차 | 장점 | 위험 | 판정 |
|---|---|---|---|---|
| **DB 선배포** | ① 컬럼 추가 → ② PostgREST 노출 확인 → ③ 코드 배포 | 코드가 올라간 시점에 컬럼이 **반드시 존재**한다. 구버전은 컬럼을 무시하므로 무해. 롤백 시에도 코드만 되돌리면 되고 컬럼은 남겨둬도 문제없다 | 컬럼만 있고 쓰는 코드가 없는 기간이 존재(무해) | **권고** |
| 코드 선배포 | ① 코드 배포 → ② 컬럼 추가 | — | 컬럼 없는 동안 `setLeaveAfterRound`가 `PGRST204`로 전량 실패. 예약 UI가 보이는데 동작하지 않는 구간 발생 | **금지** |
| 동시 배포 | 컬럼 추가와 코드 배포를 같은 창에 | 노출 구간 최소 | PostgREST 스키마 캐시 반영에 수 초 지연이 있어 **동시성이 보장되지 않는다**. 그 몇 초 동안 코드 선배포와 같은 실패가 발생 | **비권고** |

**권고 절차**
```
1. 로컬/shadow DB 검증 (A-5)
2. CEO 원격 적용 승인
3. 원격 DB에 마이그레이션 적용
4. GET /participants?select=leave_after_round 가 200을 반환할 때까지 확인 (A-6)
5. 코드 구현·테스트·커밋
6. 빌드·배포
```
4번이 통과하기 전에는 5번으로 넘어가지 않는다.
