# MARU RPS V1.0_JP — Live Tokyo Forensic Audit (2026-08-27)

복원 직후 캡처한 **라이브 Tokyo 백엔드의 사실 기록**이다.
JP 통합 마이그레이션은 저장소 마이그레이션이 아니라 **이 문서를 1차 기준**으로 작성한다.

수행 방식: Supabase Management API `POST /v1/projects/{ref}/database/query` 에
`read_only: true` 강제. 접속 롤은 `supabase_read_only_user` 이며, 쓰기는 Postgres 가
`ERROR 25006: cannot execute ... in a read-only transaction` 으로 직접 차단함을 확인했다.
**이 감사에서 백엔드는 일절 변경되지 않았다.** (유일한 쓰기 작업은 CEO 승인된 프로젝트 복원)

## 0. 복원

| | 값 |
|---|---|
| ref | `cmfxhehpreanijwanwrr` |
| region | `ap-northeast-1` (Tokyo) |
| 이전 상태 | `INACTIVE` |
| 현재 상태 | `ACTIVE_HEALTHY` |
| 전이 | `INACTIVE` → `COMING_UP` → `RESTORING` → `ACTIVE_HEALTHY` (약 2분 30초) |
| Postgres | 17.6.1.121 (engine 17, ga) |
| DNS | 1.1.1.1 / 8.8.8.8 / 9.9.9.9 모두 `172.64.149.246` (복원 전 NXDOMAIN) |
| 서비스 health | db / rest / auth(GoTrue v2.195.0) / realtime / storage **전부 ACTIVE_HEALTHY** |

## 1. 데이터 (2026-08-27 기준)

| 테이블 | 행수 | 기간 |
|---|---|---|
| `auth.users` | **8** | 2026-05-26 ~ 2026-08-03 |
| `public.rooms` | **373** | 2026-05-17 ~ 2026-08-07 |
| `public.participants` | **543** | 2026-05-17 ~ 2026-08-06 |
| `public.user_game_history` | **998** | 2026-06-02 ~ 2026-08-06 |
| `public.user_game_stats` | **6** | 2026-06-02 ~ 2026-08-03 |

`user_game_stats` 집계: 계정 6개, 누적 991게임 (승 358 / 패 374 / 무 259), 최종 플레이 2026-08-06.

무결성 실측: `room_id` NULL 0 / orphan participant 0 / 빈 이름 0 / 이름 최대 12자 /
음수 카운터 0 / `round < 1` 0 / **`created_at` NULL 0 (rooms·participants 양쪽)** /
`rooms.id` 최대 4자. `public` 스키마 테이블은 **정확히 4개**이며 전부 RLS 활성.

데이터가 2026-08-07 에서 끊긴다. KR Seoul 전환(`92ae7af`, 2026-08-11) 직전이며,
그 이후 트래픽이 Seoul 로 넘어가 Tokyo 가 미사용 → free plan 자동 일시정지로 이어진 흐름과 일치한다.

## 2. 스키마 (라이브)

### rooms
```
id          text                      NOT NULL   -- PK
status      text                      NULL       default 'waiting'::text
penalty     text                      NULL
round       integer                   NULL       default 1
created_at  timestamp with time zone  NULL       default now()
```

### participants
```
id                 text                      NOT NULL   -- PK
room_id            text                      NULL       -- FK → rooms(id) ON DELETE CASCADE
name               text                      NOT NULL
is_host            boolean                   NULL       default false
choice             text                      NULL
wins               integer                   NULL       default 0
losses             integer                   NULL       default 0
draws              integer                   NULL       default 0
penalties          integer                   NULL       default 0
created_at         timestamp with time zone  NULL       default now()
is_ready           boolean                   NULL       default false
leave_after_round  boolean                   NOT NULL   default false
```

### user_game_stats
```
user_id         uuid       NOT NULL  -- PK, FK → auth.users(id) ON DELETE CASCADE
display_name    text       NULL
games_played    integer    NOT NULL default 0
wins            integer    NOT NULL default 0
losses          integer    NOT NULL default 0
draws           integer    NOT NULL default 0
penalties       integer    NOT NULL default 0
last_played_at  timestamptz NULL
created_at      timestamptz NOT NULL default now()
updated_at      timestamptz NOT NULL default now()
```

### user_game_history
```
id            bigint      NOT NULL default nextval('user_game_history_id_seq')  -- PK
user_id       uuid        NOT NULL  -- FK → auth.users(id) ON DELETE CASCADE
room_id       text        NULL
round         integer     NULL
result        text        NOT NULL  -- CHECK (result IN ('win','lose','draw'))
penalty_text  text        NULL
created_at    timestamptz NOT NULL default now()
```

### 인덱스
**PK 인덱스 4개가 전부다.** `participants.room_id`(모든 방 조회의 조인 키)에 인덱스가 없다.

### 함수 / 트리거 / 시퀀스
- `public.server_now() -> bigint` — VOLATILE, SECURITY INVOKER, `search_path=pg_catalog`.
  EXECUTE: postgres / anon / authenticated / service_role (PUBLIC 회수됨). 저장소 정의와 일치.
- 사용자 트리거 **없음**.
- `user_game_history_id_seq` (bigint).

## 3. RLS / GRANT (라이브)

RLS 는 4개 테이블 모두 **활성**, `FORCE` 는 모두 **비활성**.

| 테이블 | 정책 | cmd | USING | WITH CHECK | 분류 |
|---|---|---|---|---|---|
| `rooms` | `allow_all_rooms` | ALL | `true` | `true` | **LEGACY / UNSAFE** |
| `participants` | `allow_all_participants` | ALL | `true` | `true` | **LEGACY / UNSAFE** |
| `user_game_stats` | 소유자 SELECT/INSERT/UPDATE | 각각 | `auth.uid()=user_id` | `auth.uid()=user_id` | REQUIRED FOR CURRENT GAME |
| `user_game_history` | 소유자 SELECT/INSERT | 각각 | `auth.uid()=user_id` | `auth.uid()=user_id` | REQUIRED FOR CURRENT GAME |

`user_game_stats` / `user_game_history` 에는 **DELETE 정책이 없다** → RLS 가 DELETE 를 거부한다
(계정 삭제는 `auth.users` 의 ON DELETE CASCADE 로 처리).

### GRANT — 저장소와 가장 크게 어긋나는 지점

라이브 Tokyo 는 **4개 테이블 전부**에 대해 `anon` / `authenticated` / `service_role` 에게
다음을 부여하고 있다:

```
DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
```

즉 `anon` 이 `user_game_stats` / `user_game_history` 에도 전 권한을 갖는다.
대시보드로 테이블을 만들 때 붙는 기본 권한이 그대로 남은 것으로 보인다.

`user_game_history_id_seq`: anon / authenticated / service_role 모두 USAGE + SELECT.

**⚠️ TRUNCATE 는 RLS 를 우회한다.** PostgREST 가 TRUNCATE 를 노출하지 않아 현재 실질
공격 경로는 없지만, Seoul 마이그레이션(`20260811010000`)이 의도적으로 회수한 바로 그 권한이다.

## 4. Auth

| | |
|---|---|
| 총 사용자 | **8** |
| provider 분포 | Apple 3 / Google 3 / Email 2 |
| **LINE 사용자** | **0** |
| **Kakao 사용자** | **0** |
| 익명 사용자 | 0 (`external_anonymous_users_enabled = false`) |

provider 설정 (enabled 플래그만, 시크릿 미출력):

| provider | enabled | 자격증명 |
|---|---|---|
| Apple | ✅ | client_id / secret 설정됨 |
| Google | ✅ | client_id / secret 설정됨 |
| **Kakao (네이티브)** | ✅ | client_id / secret 설정됨 |
| Email | ✅ | — |
| Phone | ❌ | — |
| Anonymous | ❌ | — |
| LINE | (Supabase 네이티브 provider 없음 — `line-auth` Edge Function 이 대신함) | secret 설정됨 |

**LINE 로그인은 배포되어 있었으나 실제로 계정을 하나도 만들지 못했다.**
`line_{userId}@maru-rps.local` 형태의 합성 계정이 0건이다.

## 5. Edge Functions

| 함수 | 상태 | 버전 | verify_jwt | 최종 갱신 | 분류 |
|---|---|---|---|---|---|
| `kakao-auth` | ACTIVE | v15 | true | 2026-05-28 | **KR-ONLY** |
| `line-auth` | ACTIVE | v9 | true | 2026-05-28 | **LEGACY** (네이티브 OAuth — MINI App 부적합) |
| `delete-account` | ACTIVE | v3 | true | 2026-05-29 | **KEEP** (리전 중립) |

설정된 secret 이름: `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `LINE_CHANNEL_ID`,
`LINE_CHANNEL_SECRET` + Supabase 자동 주입분(`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`,
`SUPABASE_DB_URL`, `SUPABASE_JWKS`). **값은 조회하지 않았다.**

## 6. Realtime

```
publication supabase_realtime → public.participants, public.rooms
  insert=true update=true delete=true
```

게임 동작은 **Realtime 과 폴링 양쪽에 의존한다(이중 경로)**.
`index.html` 에 `postgres_changes` 구독 3건이 있고, `subscribeToRoom` 이 **2.6초 폴링**을
병행한다. 코드 주석이 두 경로의 경합(STOP-SHIP 라운드 staleness 등)을 명시적으로 다룬다.
→ JP 백엔드에서 publication 등록이 빠지면 게임이 즉시 깨지지는 않지만(폴링이 버팀)
   동기화 지연 특성이 완전히 달라진다.

## 7. Storage

| | |
|---|---|
| 버킷 | `rps-app` — **public**, 2026-05-16 생성 |
| 객체 | 1개, 합계 **0 bytes** (빈 폴더 플레이스홀더로 추정) |
| 클라이언트 참조 | `index.html` 내 `storage.from` / `rps-app` 참조 **0건** |

**Storage 는 사실상 미사용이다.** 다만 public 버킷이 존재한다는 사실 자체는 기록해 둔다.

## 8. 마이그레이션 이력 — 라이브가 저장소와 어긋나 있다

```
supabase_migrations.schema_migrations:
  20260528205753  account_game_stats     ← 이것 하나뿐
```

그런데 라이브에는 `server_now()` 와 `participants.leave_after_round` 가 **둘 다 존재한다.**
→ `20260726104300` 와 `20260806013625` 는 **CLI 가 아니라 대시보드에서 out-of-band 로 적용**됐고,
   마이그레이션 원장이 실제 상태를 반영하지 못한다.

`rooms` / `participants` 도 마찬가지로 어느 마이그레이션에도 CREATE 가 없다(대시보드 생성).

### 지금 `supabase db push --linked` 를 Tokyo 에 실행하면

| 마이그레이션 | 예상 결과 |
|---|---|
| `20260726104300_server_now_rpc` | `create or replace` — 멱등, 통과 |
| `20260806013625_participants_leave_after_round` | `add column if not exists` — 멱등, 통과 |
| `20260824021500_account_game_stats_grants` | **중단(abort)** |

A6 파일의 회귀 방지 블록이

```sql
if has_table_privilege('anon', 'public.user_game_stats', 'select') ... then
  raise exception 'A6: anon 에 권한이 부여됐다 — 이 마이그레이션의 범위가 아니다';
```

인데, Tokyo 에서는 이 조건이 **참**이다(라이브 확인: `anon_stats_select = true`).
이 파일은 애초에 "Tokyo 에는 적용하지 않는다"고 명시돼 있으므로 설계대로 동작하는 것이지만,
**JP 마이그레이션 세트에 그대로 넣으면 안 된다**는 뜻이기도 하다.

## 9. 저장소 ↔ 라이브 Tokyo 대조

### LIVE ONLY (JP 브랜치 마이그레이션으로 재현 불가)
- `public.rooms` 테이블 정의
- `public.participants` 테이블 정의
- `allow_all_rooms` / `allow_all_participants` RLS 정책
- 4개 테이블의 anon/authenticated/service_role 전 권한 GRANT
- `supabase_realtime` publication 등록
- Storage 버킷 `rps-app` (public)
- Kakao **네이티브** Auth provider 활성화
- Apple / Google provider 자격증명

### REPOSITORY ONLY (라이브에 미반영)
- `20260824021500_account_game_stats_grants.sql` — Tokyo 미적용 (설계상 Seoul 전용)
- `config/regions.json` / `active-region.json` / region-guard 일체 (클라이언트·CI 측 자산)

### MATCHING
- `user_game_stats` / `user_game_history` 테이블 정의 (`20260528205753` 과 일치)
- 두 테이블의 소유자 RLS 정책 5개
- `server_now()` 정의 및 EXECUTE 권한 (`20260726104300` 과 일치)
- `participants.leave_after_round` 컬럼 (`20260806013625` 결과와 일치)
- **`feature/rps-kr-seoul-backend` 의 `20260811010000_kr_v1_core_rooms_participants.sql` 은
  라이브 Tokyo 의 `rooms`/`participants` 를 컬럼 순서까지 정확히 재현한다** — 역공학이 정확했다.

### DRIFTED (같은 객체, 정의가 다름)
| 객체 | 라이브 Tokyo | 저장소 |
|---|---|---|
| `user_game_stats` / `user_game_history` GRANT | anon·authenticated·service_role 전 권한 (TRUNCATE 포함) | `20260528205753` 은 GRANT 없음 / `20260824021500` 은 authenticated 최소 권한만 + anon 부재를 단언 |
| `rooms` / `participants` GRANT | TRUNCATE / REFERENCES / TRIGGER / MAINTAIN 포함 | Seoul 재현본은 이들을 명시적으로 REVOKE |
| 마이그레이션 원장 | 1건만 기록 | 4건 존재 |

## 10. 결론 — 과거 JP 프로덕션 데이터 존재 여부

**YES — meaningful historical data confirmed.**

계정 8개, 방 373개, 참가자 543행, 게임 이력 998행, 누적 991게임.
2026-05-17 ~ 2026-08-07 의 실제 개발·운영기 데이터이며 합성 데이터가 아니다.
규모는 작지만 **일본 리전에서 실제로 서비스가 돌았던 증적**이다.

이 세션에서 데이터는 조회만 했고 변경·이관하지 않았다. 감사 전후 행수가 동일하다.
