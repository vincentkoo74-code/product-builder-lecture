# MARU RPS V1.0_JP — Tokyo 보안 마이그레이션 사전점검

작성: 2026-09-01 · CRIS · **READ / ANALYZE / PLAN 슬라이스 — 배포하지 않았다**

대상: `cmfxhehpreanijwanwrr` (Tokyo / ap-northeast-1), PostgreSQL 17.6
이 문서 작성 중 Tokyo 에 **쓰기 0건**. 사전/사후 체크섬 동일함을 확인했다.

## 1. 라이브 스냅샷 (읽기 전용)

| 항목 | 값 |
|---|---|
| rooms / participants | 373 / 543 |
| user_game_stats / user_game_history | 6 / 998 |
| auth.users | 8 |
| rooms md5 / participants md5 | `10a6f809…` / `80d4f308…` |
| stats md5 / history md5 | `1c27a57c…` / `83c62a41…` |
| 테이블 크기 | rooms 120 kB · participants 144 kB · DB 12 MB |
| 활성 백엔드 / idle-in-txn | 0 / 0 |
| 마이그레이션 원장 | 2행 (`20260528205753`, `20260830010000`) |

RLS: 4개 테이블 모두 활성(force 아님). 정책 7건.
- `rooms.allow_all_rooms` — ALL / public / USING true / WITH CHECK true
- `participants.allow_all_participants` — ALL / public / USING true / WITH CHECK true
- `user_game_stats` 3건, `user_game_history` 2건 — 모두 `auth.uid() = user_id`, 롤 `public`

GRANT: anon · authenticated · service_role **전부 `SIUDTRGM`**(= ALL) — Supabase 기본값.
시퀀스 `user_game_history_id_seq` USAGE 도 셋 다 보유.

인덱스: `participants_pkey`, `rooms_pkey`, `rooms_invite_token_key`(부분 유니크), stats/history pkey.
**`participants(room_id)` 인덱스 없음.** 트리거 **없음**.
REPLICA IDENTITY: rooms=FULL, participants=FULL (stats/history=DEFAULT).
publication `supabase_realtime`: `public.rooms`, `public.participants` / insert,update,delete,truncate.

## 2. 원장 불일치 (중요)

원장에 없지만 **라이브에 이미 반영된** 마이그레이션 3종:

| 버전 | 파일 | 라이브 증거 |
|---|---|---|
| 20260101000000 | baseline_rooms_participants | rooms/participants 테이블 존재 |
| 20260726104300 | server_now_rpc | 함수 존재 |
| 20260806013625 | participants_leave_after_round | 컬럼 존재 |

이들은 전부 **멱등**이다(`create table if not exists` / `create or replace function` /
`add column if not exists`), 실행되는 파괴적 구문 0건. baseline 에는 policy/grant/alter 구문이 없다.

## 3. 마이그레이션별 분석

### A. `20260827002000_jp_v1_participants_room_id_index`
```
PURPOSE=participants(room_id) 조회 인덱스 — 방 단위 조회/폴링의 주 경로
CURRENT_LIVE_STATE=인덱스 없음
DDL_TO_EXECUTE=create index if not exists participants_room_id_idx on public.participants (room_id)
DDL_ALREADY_SATISFIED=없음
ACTUAL_CHANGE_REQUIRED=인덱스 1개 생성
NO_OP_PORTION=없음
DATA_REWRITE=없음
LOCK_RISK=낮음 — SHARE 락, 543행/144 kB, 예상 수 밀리초. 활성 백엔드 0
RLS_BEHAVIOR_CHANGE=없음
GRANT_BEHAVIOR_CHANGE=없음
REALTIME_BEHAVIOR_CHANGE=없음
ROLLBACK_OR_FORWARD_REPAIR=drop index public.participants_room_id_idx
DEPENDENCIES=participants 테이블
ORDER_REQUIREMENT=없음(어디에 놓아도 안전)
```
CONCURRENTLY 는 트랜잭션 블록 안에서 실행할 수 없다. 이 마이그레이션은 `begin/commit` 으로
감싸여 있고 테이블이 543행이므로 **평문 CREATE INDEX 가 적절**하다. 추가 인덱스는 만들지 않는다.

### B. `20260827003000_jp_v1_grants_least_privilege`
```
PURPOSE=클라이언트 롤에서 파괴적 권한 회수 + DML 최소 재부여
CURRENT_LIVE_STATE=anon/authenticated/service_role 전부 SIUDTRGM (12개 조합 모두 TRUNCATE 보유)
ACTUAL_CHANGE_REQUIRED=12개 테이블×롤 조합 전부 revoke 후 최소 재부여, 시퀀스 USAGE 정리
NO_OP_PORTION=없음
DATA_REWRITE=없음
LOCK_RISK=낮음 — 카탈로그 갱신만(AccessExclusive 아님), 데이터 접근 없음
RLS_BEHAVIOR_CHANGE=없음(정책 자체는 D 가 바꾼다)
REALTIME_BEHAVIOR_CHANGE=없음
ROLLBACK_OR_FORWARD_REPAIR=grant all on <4 테이블> to anon, authenticated, service_role (기본값 복구)
DEPENDENCIES=Supabase 롤 3종 존재(자기검증 DO 블록이 확인)
ORDER_REQUIREMENT=D(RLS)보다 먼저 권장 — 중간 상태에서도 게임플레이가 끊기지 않는다
```

**BEFORE → AFTER 매트릭스** (S I U D T R G M)

| 롤 | 테이블 | BEFORE | AFTER |
|---|---|---|---|
| anon | rooms | `SIUDTRGM` | `SIU-----` |
| anon | participants | `SIUDTRGM` | `SIUD----` |
| anon | user_game_stats | `SIUDTRGM` | `--------` |
| anon | user_game_history | `SIUDTRGM` | `--------` |
| authenticated | rooms | `SIUDTRGM` | `SIU-----` |
| authenticated | participants | `SIUDTRGM` | `SIUD----` |
| authenticated | user_game_stats | `SIUDTRGM` | `SIU-----` |
| authenticated | user_game_history | `SIUDTRGM` | `SI------` |
| service_role | rooms | `SIUDTRGM` | `SIUD----` |
| service_role | participants | `SIUDTRGM` | `SIUD----` |
| service_role | user_game_stats | `SIUDTRGM` | `--------` |
| service_role | user_game_history | `SIUDTRGM` | `--------` |

시퀀스 `user_game_history_id_seq` USAGE: anon `true→false` · authenticated `true→true` · service_role `true→false`.

게임플레이 가능성 확인(로컬 실측, 목표 보안 적용 상태에서 브라우저 E2E 39/39):
방 생성(INSERT) · 조회(SELECT) · 상태 갱신(UPDATE) · 참가자 INSERT/UPDATE/DELETE 전부 가능.
`rooms` DELETE 만 사라지는데, 앱은 방 종료를 **soft tombstone**(`status='destroyed'`)으로 하므로
DELETE 를 쓰지 않는다.

⚠️ 부수효과: **service_role 이 stats/history 접근을 잃는다.** 현재 서버측 잡이 없어 영향 없지만,
장래 서버측 통계 작업이 생기면 명시적 재부여가 필요하다. service_role 은 BYPASSRLS 이므로
rooms/participants 정리 작업(stale-room cron 등)은 계속 가능하다.

### C. `20260827003500_jp_v1_created_at_immutable`
```
PURPOSE=created_at 을 서버 통제 불변 컬럼으로 고정 → D 의 24시간 창이 조작으로 우회되는 것 차단
CURRENT_LIVE_STATE=트리거 없음, 함수 없음
ACTUAL_CHANGE_REQUIRED=함수 1개 + 트리거 2개 생성(rooms, participants / BEFORE INSERT OR UPDATE)
DATA_REWRITE=없음 — 기존 created_at 값은 읽지도 쓰지도 않는다
ROWS_AFFECTED_ON_DEPLOY=0
LOCK_RISK=낮음 — CREATE TRIGGER 는 대상 테이블에 짧은 AccessExclusive 를 잡는다. 활성 백엔드 0
RLS_BEHAVIOR_CHANGE=간접 — D 의 창 조건이 신뢰 가능해진다
ROLLBACK_OR_FORWARD_REPAIR=drop trigger jp_rooms_pin_created_at on public.rooms; (participants 동일); drop function public.jp_pin_created_at()
DEPENDENCIES=없음
ORDER_REQUIREMENT=**D 보다 먼저** — D 배포 후 C 를 넣으면 그 사이 INSERT 가 창 조건을 스스로 만족시켜야 한다
```
BEFORE 트리거가 `NEW.created_at := clock_timestamp()` 로 고정하고, RLS WITH CHECK 는
BEFORE 트리거 **이후**에 평가되므로 D 의 INSERT 조건은 항상 만족된다.

**긴급 타임스탬프 보정 절차(문서화만, 실행 금지):**
```
-- 1) 트리거 비활성화
alter table public.rooms disable trigger jp_rooms_pin_created_at;
-- 2) 최소 범위 보정 (반드시 WHERE 로 한정)
-- 3) 즉시 재활성화
alter table public.rooms enable trigger jp_rooms_pin_created_at;
```
이 절차는 **역사적 타임스탬프 재작성이 아니라 사고 복구용**이며, 승인 없이 실행하지 않는다.
로컬 실측으로 확인: 트리거가 있으면 **테이블 소유자 UPDATE 로도** created_at 이 바뀌지 않는다.

### D. `20260827004000_jp_v1_rls_target`
```
PURPOSE=allow-all 정책 폐기 → 명령·롤·조건이 명시된 목표 정책
CURRENT_LIVE_STATE=rooms/participants allow-all 2건 + stats/history 5건(롤 public)
ACTUAL_CHANGE_REQUIRED=allow-all 2건 drop, jp_* 7건 생성, stats/history 5건 멱등 재선언(롤 public→authenticated)
DATA_REWRITE=없음
LOCK_RISK=낮음 — 정책 DDL 은 카탈로그 갱신
ROLLBACK_OR_FORWARD_REPAIR=jp_* drop 후 allow_all_rooms/allow_all_participants 재생성(ALL/public/true/true)
DEPENDENCIES=C(created_at 불변)에 의존
ORDER_REQUIREMENT=B, C 다음
```

**정책 BEFORE → AFTER**

| 테이블 | OLD | NEW | CMD | ROLE | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| rooms | `allow_all_rooms` | `jp_rooms_select` | SELECT | anon, authenticated | `true` | — |
| rooms | 〃 | `jp_rooms_insert` | INSERT | anon, authenticated | — | 1시간 창 + `round >= 1` |
| rooms | 〃 | `jp_rooms_update` | UPDATE | anon, authenticated | 24시간 창 | 24시간 창 |
| rooms | 〃 | **(DELETE 정책 없음)** | — | — | — | — |
| participants | `allow_all_participants` | `jp_participants_select` | SELECT | anon, authenticated | `true` | — |
| participants | 〃 | `jp_participants_insert` | INSERT | anon, authenticated | — | 부모 방 24시간 내 + 1시간 창 + 카운터 ≥ 0 |
| participants | 〃 | `jp_participants_update` | UPDATE | anon, authenticated | 24시간 창 | 24시간 창 |
| participants | 〃 | `jp_participants_delete` | DELETE | anon, authenticated | 24시간 창 | — |
| user_game_stats | 3건(public) | 동명 3건 | S/I/U | **authenticated** | `auth.uid() = user_id` | 〃 |
| user_game_history | 2건(public) | 동명 2건 | S/I | **authenticated** | `auth.uid() = user_id` | 〃 |

**영향 — 로컬 실측(목표 보안 적용 상태, 브라우저 E2E 39/39)**

| 경로 | 결과 |
|---|---|
| 게스트 방 생성 / 조회 / 갱신 | 가능 |
| 게스트 참가자 INSERT | 가능 |
| 준비(is_ready) / 선택(choice) | 가능 |
| nextRound 다중 write | 가능 — 라운드 진행·choice·is_ready 리셋 확인, 0행 실패 없음 |
| 참가자 퇴장(DELETE) | 가능 |
| 인증 사용자 자기 stats/history | 가능 |
| 타 사용자 접근 | 조회 0행 · 수정 0행 · 타인 명의 INSERT 403 |
| **24시간 지난 방** | **UPDATE/DELETE 가 200 + 0행 (동결)** |

**중단되는 현행 동작:** 게스트의 `rooms` DELETE(앱 미사용) 와 **24시간 지난 방의 모든 변경**.

### E. `20260827005000_jp_v1_realtime_publication`
```
PURPOSE=publication 멤버십 + REPLICA IDENTITY FULL 재현
CURRENT_LIVE_STATE=publication 에 rooms/participants 이미 등록, REPLICA IDENTITY 이미 FULL
DDL_ALREADY_SATISFIED=전부
ACTUAL_CHANGE_REQUIRED=**없음 — 라이브 Tokyo 에서 완전 no-op**
DATA_REWRITE=없음
LOCK_RISK=없음
ROLLBACK_OR_FORWARD_REPAIR=publication drop table + replica identity default (⚠️ 실시간 동기화 퇴화)
ORDER_REQUIREMENT=마지막(관례). 실제로는 순서 무관
```
REPLICA IDENTITY 부분은 JP-E2E-JWT-FIDELITY 에서 추가한 것이다 — Tokyo 는 이미 FULL 이라
no-op 이지만, **저장소만으로 새 백엔드를 세울 때** Tokyo 와 동일해지도록 고정한다.

## 4. 24시간 창 영향 (수치만, 삭제 금지)

| 항목 | 값 |
|---|---|
| 24시간 지난 방 | **373 (전량)** |
| 24시간 이내 방 | **0** |
| 그 방들의 참가자 | **543 (전량)** |
| 가장 오래된 / 최신 방 | 2026-05-17 / **2026-08-07** |
| 최근 1시간 생성 방 | 0 |
| 고아 참가자 | 0 |
| 비-waiting/비-destroyed 상태의 오래된 방 | 192 |

상태 분포(오래된 방): waiting 179 · ready 95 · result 32 · game_over 28 · lobby 20 ·
playing 7 · penalty_setting 7 · stats 3 · destroyed 2.

**해석:** 최신 방조차 25일 전 것이다 — 진행 중인 실사용 세션은 없다. 배포 즉시 동결되는
"현재 활성" 방은 **0** 이다. 192건은 버려진 세션의 잔여 상태일 뿐이다.
동결된 행은 삭제하지 않는다(보고만). service_role 이 BYPASSRLS + rooms/participants DML 을
유지하므로 장래 `JP-INFRA-STALE-ROOM` 정리는 계속 가능하다.

## 5. 데이터 안전 증명

10종 전체에서 **실행되는** 파괴적 구문 **0건**(주석/롤백 노트/권한 이름 문자열 제외):
DROP TABLE 없음 · DROP COLUMN 없음 · TRUNCATE 없음 · DELETE 없음 · 데이터 UPDATE 없음 ·
auth.users 미변경 · stats/history 데이터 미변경 · 역사적 타임스탬프 재작성 없음.

멱등성: 깨끗한 DB 에 10종 적용 후 **10종 전량 재적용** → 오류 0, 상태 불변
(정책 12 · 인덱스 6 · 트리거 2 · GRANT 27 · replica FULL 동일).

## 6. 배포 순서

파일의 연대순(A→B→C→D→E)이 **안전하다**. 근거:
- B(GRANT) → D(RLS): B 직후에도 RLS 는 여전히 allow-all 이므로 게임플레이가 끊기지 않는다
- C(불변) → D(창): D 의 창 조건이 신뢰 가능해진 뒤 적용된다
- A(인덱스)는 순서 무관, E 는 no-op
파일 순서를 재작성하지 않는다.

## 7. 배포 방법 (권고)

```
PROPOSED_DEPLOY_METHOD=마이그레이션별 psql 직접 실행(pooler 경유) + 각 건 검증 후
                        supabase migration repair --status applied <version> 로 원장 기록
MIGRATIONS_INCLUDED=20260827002000, 20260827003000, 20260827003500, 20260827004000, 20260827005000
UNRELATED_MIGRATIONS_INCLUDED=없음
LEDGER_EFFECT=2행 → 7행. 실제 실행된 것만 기록(위조 없음)
ROLLBACK_PLAN=각 마이그레이션의 역DDL(§3에 건별 기재). 데이터 복구 불필요(데이터 미변경)
FORWARD_REPAIR_PLAN=부분 실패 시 실패 지점 이후만 재실행 — 10종 전부 멱등임을 실증했다
```

`supabase db push` 를 쓰지 않는 이유: 원장에 없는 **무관한 3종**(baseline, server_now_rpc,
leave_after_round)까지 함께 실행된다. 셋 다 멱등 no-op 임을 확인했지만, 보안 변경과
무관한 것을 같은 명령에 섞지 않는다. CLI 는 `--db-url` 로 pooler 를 쓸 때만 접속된다
(직접 호스트 `db.<ref>.supabase.co` 는 이 환경에서 도달 불가).

원장의 legacy 3종 불일치는 **별도 슬라이스**로 정리한다 — 실제로 실행(no-op)한 뒤 repair 한다.
실행 없이 repair 하는 것은 위조이므로 하지 않는다.

## 8. 배포 후 검증 계획

기존에 검증된 하니스를 재사용한다(중복 시뮬레이션을 만들지 않는다).

| # | 항목 | 수단 |
|---|---|---|
| A | JWT/RLS 브라우저 E2E | `npm run jp:e2e:bootstrap` + `npm run test:e2e` (39건) |
| B | Tokyo Realtime 2클라이언트 | `playwright.tokyo.config.mjs` (일회용 행) |
| C | 초대 URL 흐름 | A 에 포함 + B 의 실제 Tokyo 경로 |
| D | 게스트 게임플레이 | A + B |
| E | nextRound | A + B |
| F | 소유자 stats/history | A |
| G | 교차 사용자 차단 | A |
| H | 참가자 DELETE / 퇴장 전파 | B (§6-H, deferred leave 포함) |
| I | 과거 데이터 무결성 | 배포 전후 psql 스냅샷 md5 대조 |
| J | 원장 검증 | `supabase migration list --db-url <pooler>` |

추가: JP-RT-PRESUBSCRIBE-GAP 을 보안 적용 상태에서 재측정한다.
B 는 GRANT/RLS 가 좁아진 뒤 **처음** 도는 실제 전송 검증이므로 가장 중요한 항목이다.
