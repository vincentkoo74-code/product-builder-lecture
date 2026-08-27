# MARU RPS V1.0_JP — Backend Modernization Design

CEO 승인(JP-BL-018 / JP-BL-016 / KEEP & MODERNIZE)에 따른 JP 백엔드 현대화 설계.
**작성만 하고 배포하지 않는다.** 라이브 Tokyo 는 이 세션에서 변경하지 않았다.

1차 기준: [JP_TOKYO_LIVE_AUDIT_2026-08-27.md](JP_TOKYO_LIVE_AUDIT_2026-08-27.md) (라이브 실측)

---

## 1. 호출 지점 접근 행렬 (call-site access matrix)

`index.html` 전수 추출: **95개 호출 지점** (participants 54 / rooms 36 / user_game_stats 3 / user_game_history 2).

산출 근거(두 단계 차감이라 혼동하기 쉽다):
`.from(` 부분문자열 출현 **97** → 테이블 리터럴 정규식 매치 **96**(1건은 따옴표 없는 형태)
→ 그중 주석 줄 1건(`index.html:9630`) 제외 → **실제 코드 호출 지점 95**. 무필터 UPDATE/DELETE 는 **0건**
(무필터로 보였던 2건은 다중행 필터와 주석이었다 — 개별 확인).

| actor | table | operation | row relationship | gameplay reason |
|---|---|---|---|---|
| host | `rooms` | INSERT | 새 행(4자 코드 PK) | `createRoom` — 방 생성 |
| all | `rooms` | SELECT | `eq id` / `in id` (14곳) | 방 상태 구독·복귀·재초대 확인 |
| host 주도 | `rooms` | UPDATE | `eq id` (21곳) | status 전이, round 증가, 벌칙 저장, 카운트다운 발행 |
| — | `rooms` | **DELETE** | — | **호출 0건** (방은 status 로만 종료) |
| joiner | `participants` | INSERT | 새 행 | `joinRoom` — 입장 |
| all | `participants` | SELECT | `eq room_id`(12곳) / `eq id` | 참가자 목록, 판정 입력 수집 |
| self + host | `participants` | UPDATE | `eq id` / `in id` / `eq room_id` (27곳) | 선택 제출, ready, 전적 누적, 호스트 승계, 퇴장 예약 |
| self + host | `participants` | DELETE | `eq id` / `in id` / `eq room_id` (10곳) | 퇴장, 중복·유령 정리, 호스트의 방 파기 |
| authenticated | `user_game_stats` | SELECT / UPSERT | `eq user_id` (본인) | 내 전적 조회·누적 |
| authenticated | `user_game_history` | SELECT / INSERT | `eq user_id` (본인) | 최근 80건 조회, 라운드 결과 1행 추가 |
| any | `server_now()` | EXECUTE | — | 시계 동기화(로그인 전에도 필요) |

### 결정적 사실 — 게스트는 `anon` 이다

`playAsGuest()` 는 `setAuthState("guest")` 로 **클라이언트 상태만** 바꾼다.
`signInAnonymously` 는 저장소 전체에 **0건**이고, 라이브 Auth 설정도
`external_anonymous_users_enabled = false`, 익명 사용자 0명이다.

→ **게스트의 모든 `rooms`/`participants` 접근은 `anon` 롤로 수행된다.**
   CEO 기준 "실제 JP 게임플레이 요구가 입증되면 anon 유지"의 **입증이 완료됐다.**
   anon 을 제거하면 QR 로 모여 로그인 없이 노는 제품의 핵심 동선이 즉시 깨진다.

---

## 2. 목표 GRANT 행렬

| 대상 | anon | authenticated | service_role (서버 전용) |
|---|---|---|---|
| `rooms` | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, **DELETE** |
| `participants` | SELECT, INSERT, UPDATE, DELETE | 동일 | SELECT, INSERT, UPDATE, DELETE |
| `user_game_stats` | **없음** | SELECT, INSERT, UPDATE | **없음** |
| `user_game_history` | **없음** | SELECT, INSERT | **없음** |
| `user_game_history_id_seq` | **없음** | USAGE | **없음** |
| `server_now()` | EXECUTE | EXECUTE | EXECUTE |

`service_role` 을 **명시 부여**하는 이유는 스테이징 검증에서 드러났다: 대시보드로 만든
테이블에는 Supabase 가 service_role 기본 권한을 붙여 주지만 **마이그레이션으로 만든
테이블에는 붙지 않는다.** 명시하지 않으면 신규 프로젝트에서 service_role 권한이 0건이 되어
"rooms 정리는 서버 사이드에서"라는 이 설계의 전제가 무너진다. service_role 에도
TRUNCATE/REFERENCES/TRIGGER/MAINTAIN 은 주지 않는다.

**제거되는 것** (라이브 대비): 모든 테이블에서 anon/authenticated 의
`TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` / `rooms` 의 `DELETE` /
계정 전적 2테이블에 대한 anon 의 전 권한.

구현: `revoke all` 후 필요한 것만 재부여(증분 revoke 는 누락이 생긴다) + 자기검증 블록.

---

## 3. 목표 RLS 행렬

| table | cmd | roles | USING | WITH CHECK |
|---|---|---|---|---|
| `rooms` | SELECT | anon, authenticated | `true` | — |
| `rooms` | INSERT | anon, authenticated | — | `now()-1h < created_at <= now()+1m AND (round is null or round>=1)` |
| `rooms` | UPDATE | anon, authenticated | `now()-24h < created_at <= now()+1m` | 동일 + `(round is null or round>=1)` |
| `rooms` | DELETE | — | **정책 없음 → 거부** | — |
| `participants` | SELECT | anon, authenticated | `true` | — |
| `participants` | INSERT | anon, authenticated | — | 최근 24h 방 존재 AND `now()-1h < created_at <= now()+1m` AND 카운터 >= 0 |
| `participants` | UPDATE | anon, authenticated | `now()-24h < created_at <= now()+1m` | 동일 + 카운터 >= 0 |
| `participants` | DELETE | anon, authenticated | `now()-24h < created_at <= now()+1m` | — |
| `user_game_stats` | SELECT/INSERT/UPDATE | **authenticated** | `auth.uid() = user_id` | `auth.uid() = user_id` |
| `user_game_history` | SELECT/INSERT | **authenticated** | `auth.uid() = user_id` | `auth.uid() = user_id` |

### 이 설계가 하지 못하는 것 (정직하게)

**같은 방의 다른 참가자 행을 임의로 고치는 것을 막지 못한다.** 게스트는 `auth.uid()` 가
없고, `participants` 에 소유자 식별 컬럼이 없으며, 호스트가 다른 참가자 행을 쓰는 것이
정상 동작(라운드 판정·레디 초기화)이기 때문이다. Seoul 보안 리스크 등록부의 기존 노출과
동일하며, 실질 해결은 Anonymous Auth + `owner_uid` + host 검증 SECURITY DEFINER RPC
(V2, JP-BL-005)를 요구한다. **이 설계는 그 문제를 푸는 척하지 않는다.**

### 이 설계가 실제로 하는 것 — 폭발 반경 축소

1. allow-all 단일 정책 → **연산별 정책**. `rooms` DELETE 는 정책 부재 + GRANT 회수로 **이중 차단**.
2. 파괴적 연산에 **24시간 창**. 필터 없는 REST UPDATE/DELETE 가 들어와도 최근 24시간 행까지만
   도달한다. 실측 근거: 방 수명 **p50 0.14분 / p95 5.68분 / max 323분**.
   현재 373개 방 **전부**가 24시간을 넘겨 즉시 클라이언트 불변이 된다.
3. `created_at` 을 창 밖으로 옮겨 우회하는 것을 `WITH CHECK` 로 차단.
4. anon 이 계정 전적 테이블에 도달하는 경로를 GRANT 단계에서 완전 제거.

### 의도적으로 하지 않은 것

- **SELECT 시간 창 없음.** 최근 방 코드(`rpsRecentRoomCodes`)에 TTL 이 없어 오래된 코드도
  `checkGlobalReplayInvites` 가 조회한다. 읽기를 제한하면 실기기 검증 없이는 확인 불가한
  UX 변화가 생긴다. 읽기 노출 축소는 신원이 필요하므로 V2 로 미룬다.
- **`status` enum 제약 없음.** 라이브 9종 + 클라이언트 리터럴 `reinviting` 이 확인되지만
  정적 grep 으로 전수를 증명할 수 없다. 불완전한 enum 은 게임을 조용히 깨뜨린다 → JP-BL-025.

---

## 4. 작성된 마이그레이션

| 파일 | 역할 | 라이브 Tokyo 적용 시 |
|---|---|---|
| `20260101000000_jp_v1_baseline_rooms_participants.sql` | `rooms`/`participants` 재현 가능 baseline + 드리프트 가드 | **no-op** (이미 존재) |
| `20260827002000_jp_v1_participants_room_id_index.sql` | `participants.room_id` 인덱스 | 인덱스 1개 추가 |
| `20260827003000_jp_v1_grants_least_privilege.sql` | GRANT 정규화 | **권한 축소** |
| `20260827003500_jp_v1_created_at_immutable.sql` | `created_at` 을 서버 통제 불변으로 고정(트리거) | **트리거 2개 추가** |
| `20260827004000_jp_v1_rls_target.sql` | allow-all → 연산별 정책 | **정책 교체** |
| `20260827005000_jp_v1_realtime_publication.sql` | Realtime publication 멱등 재현 | **no-op** (이미 등록) |

**제거**: `20260824021500_account_game_stats_grants.sql` — KR 전용이며 자체 주석이
"Tokyo 에는 적용하지 않는다"고 명시한다. Tokyo 에서는 `anon` 권한 단언에 걸려 **중단**된다
(라이브 확인: `has_table_privilege('anon','public.user_game_stats','select') = true`).
그 파일의 GRANT 의도는 위 `jp_v1_grants_least_privilege` 가 4개 테이블 전체로 흡수했다.

전 파일 공통: `begin/commit` 트랜잭션, 자기검증 `raise exception` 블록, 멱등,
`drop table`/`truncate`/`delete from` **없음**.

---

## 5. 마이그레이션 원장 복구 전략

### 현재 불일치

```text
supabase_migrations.schema_migrations:  20260528205753  ← 이것 하나뿐
라이브 실제:  server_now() 존재 / participants.leave_after_round 존재 / rooms·participants 존재
```

`20260726104300` 와 `20260806013625` 는 **대시보드 out-of-band 로 적용**됐다.
`rooms`/`participants` 는 애초에 어떤 마이그레이션에도 없었다.

### 복구 절차 (배포 승인 시)

**전략: `repair` 가 아니라 실제 실행.** (codex-critic M-2 반영)

처음에는 `migration repair --status applied` 로 원장만 맞추려 했다. 그러나 `repair` 는
파일 내용과 라이브 실제 상태의 일치를 **전혀 검증하지 않는다.** out-of-band 적용본과 저장소
파일 사이에 감사가 놓친 미세한 차이가 있어도 드러나지 않는다.

두 파일은 스스로 멱등이다(`create or replace function`, `add column if not exists`).
**그냥 실행하게 두면** 라이브를 저장소 정의로 수렴시키면서 원장도 함께 갱신되어
더 안전하고 단계도 하나 줄어든다.

```bash
# 1단계 — 원장과 로컬 파일 정합 확인(적용 전 상태 파악)
supabase migration list

# 2단계 — 순서대로 실제 적용. 20260726104300 / 20260806313625 는 멱등이라 재실행이 안전하며
#          라이브를 저장소 정의로 수렴시킨다. 이어서 신규 6종이 적용된다.
supabase db push --linked

# 3단계 — 원장이 전 파일을 담고 있는지 확인
supabase migration list
```

`repair` 는 **재실행이 위험한 파일이 나타났을 때만** 쓴다. 현재 세트에는 그런 파일이 없다.

**`20260824021500` 처리**: JP 브랜치에서 파일을 제거했으므로 원장에도 등장하지 않는다.
Seoul(KR) 원장에는 그대로 남아 있으며 KR 브랜치는 이 세션에서 건드리지 않았다.

---

## 6. Realtime 재현

라이브: `supabase_realtime` publication 에 `public.rooms`, `public.participants`
(insert/update/delete). 어떤 마이그레이션에도 없던 out-of-band 설정이다.

`20260827005000` 이 멱등 등록으로 이를 코드화한다. 라이브에서는 no-op 이고,
빈 프로젝트에서는 등록을 수행한다.

게임은 **Realtime + 2.6초 폴링 이중 경로**에 의존한다. publication 이 빠지면 게임이 즉시
죽지는 않지만(폴링이 버팀) 동기화 지연 특성이 완전히 달라지는 **조용한 회귀**가 된다.

---

## 7. 인덱스 변경

`participants.room_id` 인덱스 1개 추가. 라이브 실측 근거:

```text
explain (analyze) select ... from participants where room_id = $1
  → Seq Scan on participants, Rows Removed by Filter: 543
대조군: rooms where id = $1 → Index Scan using rooms_pkey
```

이 쿼리는 `subscribeToRoom` 의 **2.6초 폴링**과 Realtime 콜백 양쪽에서 호출된다.
활성 방 1개·참가자 N명이면 2.6초마다 N회의 전체 스캔이 발생하며, 비용이 테이블 크기에
선형 증가한다. 현재 543행에서는 1.2ms 라 체감되지 않는다.

`CONCURRENTLY` 미사용: 트랜잭션 블록 안에서 실행 불가. 현재 규모에서 락은 밀리초 단위다.

---

## 8. 하위 호환 위험

| 위험 | 영향 | 완화 |
|---|---|---|
| **`rooms` DELETE 회수** | 향후 코드가 방을 삭제하려 하면 실패 | 현재 호출 0건(2가지 방법 확인). 테스트가 회귀를 잠근다. 필요해지면 service_role 경유 |
| **24시간 창** | 24시간 넘게 살아 있는 방의 갱신이 거부됨 | 실측 max 수명 323분(5.4h). 여유 4배 이상. 장시간 방은 어차피 유령 방이다 |
| **anon 의 전적 테이블 권한 제거** | 비로그인 상태에서 전적 저장을 시도하면 실패 | 현재도 RLS(`auth.uid()`)가 막고 있어 **동작 변화 없음**. 오류 코드가 42501 로 바뀔 뿐 |
| **정책 대상 롤을 `public` → `anon,authenticated` 명시** | 다른 롤(예: `postgres`)의 접근 경로 변화 | 소유자·service_role 은 RLS 를 우회하므로 영향 없음 |
| **`participants` INSERT 의 rooms 서브쿼리** | 입장마다 rooms 조회 1회 추가 | PK 인덱스 조회. 방당 최대 20명 |
| **PostgREST 스키마 캐시** | 권한 변경이 즉시 반영되지 않으면 일시적 42501 | 두 파일 모두 `notify pgrst, 'reload schema'` |
| **RLS 거부가 무음(silent)** | PostgREST 는 `USING` 이 행을 걸러 0-row 로 끝나도 **에러가 아니다**(200 + 빈 결과). `updateRoomStatus`·`updateParticipantChoice`·`_doLeaveRoom` 등 대부분의 write 는 `error` 조차 검사하지 않아, 24시간 창을 넘긴 세션에서 write 가 "성공한 척" 하고 반영되지 않을 수 있다 (codex-critic M-1) | 방 수명 실측(p95 5.68분, max 323분)상 발생 확률은 낮다. **QA 체크리스트에 "장시간 백그라운드 후 재개" 케이스를 명시**했다. 핵심 상태 전이에 `.select()` 로 0-row 를 구분하는 방어는 별도 과제(JP-BL-027) |
| **실기기 회귀 미검증** | 정책이 예상 못 한 경로를 막을 수 있음 | **배포 전 실기기 QA 필수** — 아래 배포 순서 8단계 |

---

## 8-A. 설계 가정의 라이브 검증

정책과 GRANT 가 의존하는 전제를 추측으로 두지 않고 라이브에서 확인했다(읽기 전용).

### `created_at` 조작에 의한 시간 창 우회 (codex-critic H-1) — **해소됨**

초안은 `created_at > now() - 24h` 로 **하한만** 검사했다. GRANT 가 테이블 전체 UPDATE 이므로
`PATCH /rooms?id=eq.X {"created_at":"2099-01-01"}` 로 그 행을 영구히 창 안에 두는
"불멸 행"을 만들 수 있었다. 그 방으로는 기한 없이 참가자 주입도 가능했다.

상한(`created_at <= now()`)만 추가하는 것으로는 부족하다 — `created_at = now()` 로 갱신하면
창이 다시 24시간 연장되어 반복 갱신으로 같은 결과가 된다.
RLS `WITH CHECK` 는 NEW 행만 보므로 `NEW.created_at = OLD.created_at` 을 표현할 수 없다.

**채택한 해법**: `20260827003500` 의 BEFORE INSERT/UPDATE 트리거가 `created_at` 을
서버 통제 불변으로 고정한다(INSERT → `clock_timestamp()`, UPDATE → `OLD.created_at`).
열거가 필요 없고 완전하다. 정책의 상·하한은 트리거가 제거·우회될 경우를 위한 심층 방어다.

**컬럼 단위 GRANT 를 쓰지 않은 이유**: 클라이언트가 갱신하는 컬럼 전체를 정적으로 완전히
열거해야 하는데, 실제로 추출해 보니 인접 호출의 컬럼이 섞여 신뢰할 수 없었다. 하나라도
빠뜨리면 게임이 깨진다.

### `created_at` 이 nullable 인데 정책이 부등호를 쓴다 — 3값 논리 위험

두 테이블 모두 `created_at timestamptz NULL default now()` 다. NULL 이면
`created_at > now() - interval '24 hours'` 는 NULL 로 평가되고, RLS 는 이를 **거부**로 취급한다.

| 확인 항목 | 결과 |
|---|---|
| `rooms.created_at IS NULL` | **0건** / 373행 |
| `participants.created_at IS NULL` | **0건** / 543행 |
| 클라이언트가 insert 페이로드에 `created_at` 을 넣는가 | **아니오** — `order('created_at')` 으로만 사용, 기본값 `now()` 에 의존 |

→ 현재 NULL 행이 없고, 클라이언트가 NULL 을 만들 경로도 없다.
→ 누군가 `created_at: null` 을 명시적으로 주입하려 해도 INSERT `WITH CHECK` 가 NULL →
   거부로 처리해 **fail-closed** 다. UPDATE 로 NULL 로 바꿔 창을 탈출하는 것도 같은 이유로 막힌다.

**고려했으나 채택하지 않은 대안**: `created_at` 을 `NOT NULL` 로 바꾸면 이 부류의 논리가
아예 사라진다(위반 0건이라 안전한 변경이다). 다만 baseline 을 "라이브 정확 재현"에서
벗어나게 만들고, 현재 위험이 실측 0이라 이번 슬라이스에서는 넣지 않았다.
→ 추가로, `20260827003500` 의 트리거가 INSERT 시 `created_at` 을 항상 채우므로 신규 NULL 은
   구조적으로 발생할 수 없게 됐다. `NOT NULL` 제약 추가는 **CEO 판단 항목**으로 남긴다(JP-BL-026).

### `revoke all ... from anon, authenticated` 가 다른 롤에 영향을 주는가

| 확인 항목 | 결과 |
|---|---|
| `anon` / `authenticated` 의 소속 롤 | **없음** (member_of 비어 있음) → 상속 권한 없음 |
| PUBLIC 에 부여된 테이블 권한 | **0건** → `revoke from anon, authenticated` 로 충분 |
| `authenticator` | `rolinherit = false`, anon/authenticated/service_role 의 멤버 (PostgREST 표준 SET ROLE 구조) — 권한을 누적하지 않는다 |

→ `revoke all` 의 영향 범위가 두 롤로 정확히 한정된다. `service_role`·`postgres` 무영향.
→ 자기검증의 `has_table_privilege('anon', ...)` 이 **상속 때문에 거짓 양성을 낼 수 없다.**

---

## 9. KR / JP 자격증명 분리

**현재**: `supabase-deploy.yml` 이 `region` 입력으로 대상을 고르지만
`SUPABASE_DB_PASSWORD` 는 저장소 단일 secret 을 참조한다. KR/JP 비밀번호가 다르면
한쪽 배포가 실패한다.

**해결에 코드 변경이 필요 없다.** 워크플로가 이미 `environment: supabase-<REGION>` 을
선언하므로, GitHub Environment secret 을 설정하면 **자동으로 저장소 secret 을 덮어쓴다.**

필요한 조치(수동, CEO 또는 소유자):
- `supabase-JP` environment → `SUPABASE_DB_PASSWORD` (Tokyo 값)
- `supabase-KR` environment → `SUPABASE_DB_PASSWORD` (Seoul 값)
- 저장소 레벨 `SUPABASE_DB_PASSWORD` 는 이후 삭제 검토

**로컬 위생**: `~/.rps_seoul_env` 는 파일명이 "seoul" 인데 `RPS_TOKYO_DB_*` 변수를 담고 있다.
사람이 잘못 읽기 쉽다(JP-BL-011). 값은 확인하지 않았고 변경하지 않았다.

---

## 10. Kakao provider 분류

**JP-UNNEEDED.** 근거:
- 사업 기준상 일본은 LINE 중심이며 Kakao 를 쓰지 않는다.
- 라이브 Tokyo 의 **Kakao 사용자 0명** (Apple 3 / Google 3 / Email 2).
- 그럼에도 Tokyo 에는 **네이티브 Kakao provider 가 활성**이고 자격증명이 설정돼 있으며,
  `kakao-auth` Edge Function(v15)도 배포돼 있다.

문서화된 JP 요구사항이 나오기 전까지 **JP-UNNEEDED** 로 분류한다.
비활성화는 Auth 설정 변경이라 이 세션 범위 밖이다 → JP-BL-024 / JP-BL-002.

---

## 11. 제안하는 배포 순서 (승인 후)

```text
0-A. **스테이징 재현 검증 완료** (2026-08-27) — `docs/JP_STAGING_VALIDATION_2026-08-27.md`.
   빈 DB clean bootstrap / 스키마 라이브 완전 일치 / GRANT·RLS 행렬 / allow·deny /
   게스트 10단계 플로우 / 로그인 소유권 격리 / 멱등성 / 롤백·전진복구 전부 통과.
   ⚠️ 지시된 ap-northeast-1 클라우드 스테이징이 아니라 **로컬 격리 Postgres** 였다(§0).
   PostgREST·GoTrue·Realtime 전달 계층은 미검증으로 남는다.

0. 사전 조회(읽기 전용) — 예상 밖 중단 방지 (codex-critic L-3)
   - `public` 스키마 테이블 전수 확인: **2026-08-27 시점 정확히 4개, 전부 RLS 활성**
     (RLS 마이그레이션의 "RLS 꺼진 테이블 0개" 자기검증이 미지의 5번째 테이블에서 중단될 수 있다)
   - `created_at is null` 카운트 재확인 (현재 rooms/participants 모두 **0건**)
1. KR 브랜치 무관 확인 — 이 변경은 JP 브랜치 전용이다
2. GitHub Environment secret 설정 (§9) — supabase-JP 의 SUPABASE_DB_PASSWORD
3. supabase migration list — 적용 전 원장 상태 파악
4. (아래 6단계의 db push 가 원장 복구까지 함께 수행한다. `repair` 는 쓰지 않는다 — §5)
5. 스테이징 검증 — 빈 Supabase 프로젝트에 전 마이그레이션을 처음부터 적용해
   "저장소만으로 재현 가능"을 실증 (Tokyo 아님)
6. supabase-deploy.yml 을 region=JP + 타이핑 확인으로 실행 (required reviewer 승인)
   → 한 번의 `db push` 로 **원장 미기록 2종(20260726104300 / 20260806013625, 멱등 재실행)**과
     **신규 6종(20260827001000 ~ 20260827005000)**이 함께 적용된다
   → 직후 `supabase migration list` 로 원장이 전 파일을 담고 있는지 확인
7. 적용 직후 검증:
   - 권한/정책 재조회 (본 문서 2·3절 행렬과 대조)
   - anon 으로 user_game_stats SELECT → 42501 확인
   - anon 으로 rooms DELETE → 거부 확인
8. **실기기 회귀 QA** — 방 생성·입장·라운드 판정·퇴장·호스트 승계·재초대·전적 저장
   + **장시간 백그라운드 후 재개**(RLS 무음 거부 확인, codex-critic M-1)
   + 24시간 창 경계 근처 방에서의 상태 전이
9. 이상 시 롤백: 각 파일 하단 Rollback 절 참조(allow-all 복구 포함)
```

**5단계를 건너뛰지 말 것.** 이 마이그레이션 세트의 존재 이유가 "저장소만으로 재현 가능"이며,
그것은 빈 프로젝트에 실제로 적용해봐야 증명된다.

---

## 12. 미결 (CEO 판단)

- JP-BL-025 — `status` enum 제약: 전수 증명 방법을 정한 뒤 적용할지
- JP-BL-005 — Anonymous Auth 기반 V2 보안 모델(이 설계가 풀지 못하는 문제의 진짜 해법)
- JP-BL-016 — 외부 베타 전 Pro 승격 (`JP-PROD-GATE`)
- 프로젝트 개명 `maru-rps-jp-prod` 시점
