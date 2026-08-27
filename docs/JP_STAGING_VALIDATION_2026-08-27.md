# MARU RPS V1.0_JP — Staging Reconstruction Validation (2026-08-27)

"저장소 상태만으로 JP 백엔드를 재현할 수 있는가"를 실증한 기록.
**라이브 Tokyo(`cmfxhehpreanijwanwrr`)는 이 검증에서 일절 변경하지 않았다.**

## 0. ⚠️ 환경 대체 — CEO 확인 필요

CEO 지시는 "Tokyo / ap-northeast-1 에 격리된 일회용 Supabase 프로젝트"였다.
**생성이 플랫폼에서 차단됐다.**

```
POST /v1/projects → HTTP 400
"The following organization members have reached their maximum limits for the number of
 active free projects ... vincentkoo74-code (2 project limit). To continue, these users will
 need to either delete, pause or upgrade one or more of these projects."
```

주 org 는 free plan 이고 활성 슬롯 2개를 **KR 프로덕션 + JP Tokyo 프로덕션**이 이미 쓰고 있다.
남은 선택지는 전부 CEO 가 금지했거나 승인하지 않은 것이었다 — Pro 승격(이번 세션 과금 변경 금지),
KR 일시정지(프로덕션), Tokyo 일시정지(권위 백엔드 변경 금지). **프로젝트는 생성되지 않았고 과금도 없다.**

그래서 **로컬 격리 PostgreSQL 17.11 클러스터**에 Supabase 환경을 재현해 검증했다.
Docker 가 없어 `supabase start`(로컬 풀스택)도 불가능했다.

### 재현 충실도 — 무엇이 같고 무엇이 다른가

같음: PostgreSQL **17**(라이브 17.6, 스테이징 17.11) / `anon`·`authenticated`·`service_role`·
`authenticator` 롤과 상속 구조 / `auth.uid()`·`auth.role()`·`auth.jwt()` — **라이브 Tokyo 에서
`pg_get_functiondef` 로 읽어온 정의를 그대로 사용** / `wal_level=logical` /
`supabase_realtime` publication / Supabase CLI 로 동일한 마이그레이션 시퀀스 적용.

다름(**검증되지 않은 영역**): PostgREST(REST 표면·0-row 무음 거부) / GoTrue 인증 플로우 /
Realtime 실제 메시지 전달 / Supabase 플랫폼 기본 GRANT·확장·`pgrst` 알림 수신자 /
네트워크·리전 특성.

RLS 는 SQL 레벨에서 `set local role` + `set_config('request.jwt.claims', ...)` 로 검증했다.
이는 PostgREST 가 실제로 하는 것과 같은 메커니즘이지만 **HTTP 계층을 거치지 않는다.**

## 1. 스테이징 정체

| | |
|---|---|
| 종류 | 로컬 격리 PostgreSQL 클러스터 (일회용) |
| 버전 | PostgreSQL 17.11 (Homebrew, aarch64-apple-darwin) |
| 위치 | 세션 스크래치패드, 포트 55432, 유닉스 소켓 격리, `listen_addresses=''` |
| 리전 | **없음** (§0 참조 — 지시된 ap-northeast-1 미충족) |
| 프로덕션 데이터 | **0건** — 전부 테스트 데이터 |
| 프로덕션 자격증명 | **미공유** — DB 비밀번호 신규 생성, 프로덕션 키 미사용 |

## 2. 적용한 마이그레이션 시퀀스

```
20260101000000_jp_v1_baseline_rooms_participants.sql
20260528205753_account_game_stats.sql
20260726104300_server_now_rpc.sql
20260806013625_participants_leave_after_round.sql
20260827002000_jp_v1_participants_room_id_index.sql
20260827003000_jp_v1_grants_least_privilege.sql
20260827003500_jp_v1_created_at_immutable.sql
20260827004000_jp_v1_rls_target.sql
20260827005000_jp_v1_realtime_publication.sql
```

명령: `supabase db push --db-url <staging> --include-all`

## 3. ⛔ Clean bootstrap — 1차 실패, 결함 발견

**첫 시도는 실패했다.**

```
Applying migration 20260806013625_participants_leave_after_round.sql...
ERROR: relation "public.participants" does not exist (SQLSTATE 42P01)
```

원인: baseline 을 `20260827001000` 으로 두었더니 타임스탬프 정렬상 **증분
`20260806013625`(participants 컬럼 추가)가 baseline 보다 먼저** 실행됐다.

**이것은 설계 문서가 "저장소만으로 재현 가능하다"고 주장한 바로 그 지점의 반례였다.**
정적 테스트 44개는 이 결함을 잡지 못했다 — 파일 내용만 검사했고 **적용 순서를 실행해 보지
않았기 때문이다.** 스테이징 검증이 아니었으면 프로덕션 배포에서 드러났을 것이다.

수정: baseline 을 `20260101000000` 으로 재배치(전체 세트 최선두).
회귀 잠금: `[JP-MOD-7] 마이그레이션 정렬 계약` 3건 추가.

**2차 시도: 9종 전부 순서대로 적용 성공.**

## 4. 원장

```
20260101000000  jp_v1_baseline_rooms_participants
20260528205753  account_game_stats
20260726104300  server_now_rpc
20260806013625  participants_leave_after_round
20260827002000  jp_v1_participants_room_id_index
20260827003000  jp_v1_grants_least_privilege
20260827003500  jp_v1_created_at_immutable
20260827004000  jp_v1_rls_target
20260827005000  jp_v1_realtime_publication
```

9종 전부 기록. 재실행 시 `{"upToDate":true,"message":"Remote database is up to date."}`.

## 5. 스키마 대조 — 라이브 Tokyo vs 스테이징

`information_schema.columns` 전체(컬럼명·타입·nullable·기본값) 17행을 두 환경에서 뽑아 `diff`:

```
✅ 완전 일치 — 차이 0
```

기타: 인덱스 5개(PK 4 + `participants_room_id_idx`) / 트리거 2개 / `server_now()` /
`supabase_realtime` 에 `public.rooms`·`public.participants`.

## 6. GRANT 대조

| 대상 | anon | authenticated | service_role |
|---|---|---|---|
| rooms | SELECT, INSERT, UPDATE | 동일 | SELECT, INSERT, UPDATE, **DELETE** |
| participants | SELECT, INSERT, UPDATE, DELETE | 동일 | 동일 |
| user_game_stats | — | SELECT, INSERT, UPDATE | **없음** |
| user_game_history | — | SELECT, INSERT | **없음** |

목표 행렬과 **일치**. `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` 은 세 롤 모두 0건.
검증: `anon` rooms DELETE=false / `anon` stats SELECT=false /
`service_role` stats SELECT=false / `service_role` rooms DELETE=true.

### ⚠️ 발견 2 — service_role divergence

1차 적용 결과 스테이징의 service_role 권한이 **0건**이었다(라이브 Tokyo 는 전 권한 보유).
대시보드 생성 테이블에는 Supabase 가 기본 권한을 붙이지만 **마이그레이션 생성 테이블에는
붙지 않기 때문**이다. 이 설계는 클라이언트에서 rooms DELETE 를 회수하며 "정리는 service_role 로"를
전제하는데, 신규 프로젝트에서는 그 경로가 아예 없었다.

수정: `20260827003000` 에 service_role revoke→명시 재부여 + 자기검증 추가. 두 환경이 수렴한다.

### ⚠️ 발견 3 — 그 수정이 과잉이었고, 기존 테스트가 잡았다

1차 수정에서 service_role 에 **4개 테이블 전부** DML 을 줬다. 그러자 KR 시절부터 있던
`build37-a6-account-stats-grants` 계약 테스트가 실패했다 — *"DELETE / service_role 은
부여하지 않는다(최소 권한)"*.

그 계약이 옳았다. `delete-account` Edge Function 은 `auth.admin.deleteUser()` 만 호출하고
계정 전적 2테이블을 직접 읽거나 쓰지 않으며, 계정 삭제는 `auth.users` 의 ON DELETE CASCADE 가
테이블 소유자 권한으로 처리한다. service_role 에 그 권한을 줄 이유가 없다.

최종: service_role 범위를 **`rooms` / `participants` 로만** 축소하고, 계정 전적 2테이블에
권한이 없음을 자기검증으로 강제했다. 라이브 Tokyo 는 현재 service_role 이 4개 테이블 전부에
권한을 갖고 있으므로, 이 마이그레이션은 계정 전적 2테이블에서 **회수**하게 된다.

## 7. RLS allow / deny 결과

### anon (게스트) — ALLOW
rooms INSERT ✅ / rooms SELECT ✅ / rooms UPDATE ✅ /
participants INSERT ✅ / SELECT ✅ / UPDATE ✅ / DELETE ✅ / `server_now()` ✅

### anon — DENY (전부 거부됨)
| 시도 | 결과 |
|---|---|
| `delete from rooms` | `ERROR: permission denied for table rooms` ✅ |
| `select from user_game_stats` | `ERROR: permission denied for table user_game_stats` ✅ |
| `insert into user_game_history` | `ERROR: permission denied for table user_game_history` ✅ |
| `truncate participants` | `ERROR: permission denied for table participants` ✅ |

### authenticated — 소유권
u1 본인 stats/history 저장·조회·갱신 ✅ / u2 가 보는 u1 데이터 **0행** ✅ /
u2 의 u1 행 UPDATE → **0행** ✅ / u2 가 u1 명의로 INSERT → `new row violates row-level
security policy` ✅ / authenticated 의 history DELETE → `permission denied` ✅

### created_at 불변성 (codex-critic H-1 실증)
| 시도 | 결과 |
|---|---|
| UPDATE 로 `created_at='2099-01-01'` 주입 | 값 불변(`2026-08-27 21:39:51`) ✅ |
| INSERT 로 `created_at='2099-01-01'` 주입 | 서버 시각으로 고정 ✅ |

### 24시간 창
25시간 된 방 시드 후 anon: SELECT 는 보임(설계대로) / rooms UPDATE **0행** /
participants UPDATE **0행** / DELETE **0행** / 옛 방에 참가자 주입 → RLS 위반 ✅
**최근 방은 정상 동작**(UPDATE 1행) — 과잉 차단 아님 ✅

## 8. Realtime

`supabase_realtime` publication 에 `public.rooms`·`public.participants` 등록 확인.
`wal_level=logical` 환경에서 검증. **실제 메시지 전달은 미검증**(§0).

## 9. 게스트 게임 플로우 (전 구간 anon)

방 생성 → 게스트B 입장 → 벌칙 설정·로비 → 레디 ×2 → 게임 시작(초기화) → 선택 제출 ×2 →
판정·전적 누적 → 다음 라운드(round=2) → 퇴장 예약·처리 → 호스트 승계·방 종료.
**10단계 전부 통과.** 실제 클라이언트의 필터 형태(`eq id` / `in id` / `eq room_id`)를 그대로 사용.

## 10. 로그인 사용자 플로우

`server_now()` anon·authenticated 양쪽 ✅ / upsert 누적(games_played 1→3→4) ✅ /
history 2행 영속(시퀀스 권한 포함) ✅ / u2 격리 ✅

## 11. 멱등성

- **원장 기준**: `db push` 재실행 → `upToDate: true`, 적용 0건 ✅
- **직접 재실행**(원장 우회): 9종 전부 2회차 무오류 ✅
- 재실행 후 상태 동일: 정책 12 / 트리거 2 / 인덱스 5 / realtime 2 / 데이터 보존 ✅

## 12. 롤백

각 파일 하단 Rollback 절을 역순 실행 → 정책 7(allow-all 2 복구) / 트리거 0 / 인덱스 0 /
realtime 0 / **데이터 보존 3행** ✅
이어서 4종 재적용(전진 복구) 전부 성공, 최종 정책 12·allow_all 0 ✅

## 13. 남은 프로덕션 배포 위험

| 위험 | 상태 |
|---|---|
| **PostgREST 계층 미검증** | RLS 0-row 무음 거부, REST 동사 매핑, 스키마 캐시 갱신 — 로컬 하니스로는 확인 불가 |
| **GoTrue 실제 JWT 미검증** | `set_config` 로 클레임을 흉내냈다. 실제 토큰 발급·검증 경로는 미확인 |
| **Realtime 실제 전달 미검증** | publication 등록만 확인. 구독·이벤트 수신은 미확인 |
| **리전 미충족** | 지시된 ap-northeast-1 스테이징이 아니다 |
| **실기기 회귀 미수행** | 24시간 창 경계·장시간 백그라운드 재개 케이스 포함 |
| Tokyo `--include-all` 필요 | baseline 이 원장의 최초 항목보다 앞서므로 플래그 필수 |
| free plan 자동 일시정지 | JP-PROD-GATE — 외부 베타 전 Pro 필요 |
