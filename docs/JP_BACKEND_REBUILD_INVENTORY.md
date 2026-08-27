# MARU RPS V1.0_JP — Tokyo Backend Reconstruction Inventory

새 JP 백엔드를 **저장소를 단일 기준으로** 재구축하기 위한 부품 목록과 판정.
CEO 검토 전까지 **어떤 것도 배포하지 않는다.**

## ⛔ 가장 중요한 결론 먼저

**현재 JP 브랜치의 마이그레이션 4종을 신규 프로젝트에 그대로 `supabase db push` 하면 실패한다.**

이 4종은 **이미 존재하는 DB 를 전제로 한 증분(incremental) 세트**다.
`rooms` / `participants` 테이블의 `CREATE TABLE` 이 **어느 마이그레이션에도 없다** —
두 테이블은 원래 대시보드에서 out-of-band 로 만들어졌기 때문이다.

실패 지점(예상):
1. `20260806013625` → `alter table public.participants add column …` → 테이블 없음 오류
2. `20260824021500` → `do $$ … to_regclass('public.user_game_stats') is null … raise exception` → 중단

**완전한 스키마는 다른 브랜치에 있다.** `feature/rps-kr-seoul-backend` 의
`20260811010000_kr_v1_core_rooms_participants.sql` 은 **라이브 Tokyo DB 를 읽기 전용
introspection 으로 역공학한 결과물**이며, JP 재구축의 정확한 출발점이다.

---

## 1. Database migrations

| 항목 | 출처 | 판정 |
|---|---|---|
| `rooms` / `participants` 테이블·RLS·GRANT·Realtime | `feature/rps-kr-seoul-backend`: `20260811010000_kr_v1_core_rooms_participants.sql` | **REQUIRES JP ADAPTATION** |
| `user_game_stats` / `user_game_history` 테이블·RLS | JP 브랜치: `20260528205753_account_game_stats.sql` | **REQUIRES JP ADAPTATION** |
| 위 두 테이블의 GRANT + 시퀀스 USAGE | JP 브랜치: `20260824021500_account_game_stats_grants.sql` | **REQUIRES JP ADAPTATION** |
| `server_now()` RPC | JP 브랜치: `20260726104300_server_now_rpc.sql` | **REUSABLE AS-IS** |
| `participants.leave_after_round` 증분 ALTER | JP 브랜치: `20260806013625_…sql` | **LEGACY — DO NOT DEPLOY** |

### 판정 근거

**`20260811010000_kr_v1_core_rooms_participants.sql` — REQUIRES JP ADAPTATION**
내용은 그대로 쓸 수 있다(테이블 2개, allow-all RLS, anon/authenticated/service_role GRANT,
TRUNCATE/REFERENCES/TRIGGER revoke, `supabase_realtime` publication 등록,
`leave_after_round` 를 base 테이블에 접어 넣음). 파일 헤더 주석이 Seoul/KR 전용으로
쓰여 있어 JP 용으로 문구와 파일명을 바꿔야 한다.
⚠️ 이 파일이 이식하는 **allow-all RLS 는 알려진 보안 부채**다
(`docs/SEOUL_KR_V1_SECURITY_RISK_REGISTER.md`). JP 에 그대로 이식하면 같은 노출을 승계한다.
JP-BL-005(서버측 매치메이킹 리전 검증)와 함께 CEO 판단이 필요하다.

**`20260528205753_account_game_stats.sql` — REQUIRES JP ADAPTATION**
테이블과 RLS 정책 5개는 정확하지만 **GRANT 가 한 줄도 없다.** Seoul 은 이 상태로
배포되어 "로그인해도 내 기록이 항상 비어 있음"(42501) 버그를 겪었고 3개월 뒤
`20260824021500` 으로 뒤늦게 고쳤다. **JP 는 이 실수를 반복하지 말고 GRANT 를 처음부터
접어 넣어야 한다.** (참고: Seoul 브랜치의 `20260811010100_kr_v1_account_game_stats.sql`
에도 GRANT 가 없다 — 그대로 베끼면 같은 버그를 만든다.)

**`20260824021500_account_game_stats_grants.sql` — REQUIRES JP ADAPTATION**
GRANT 내용 자체는 JP 에 필요하다. 다만 파일 주석이 *"대상은 Seoul 프로젝트뿐이다.
Tokyo 에는 적용하지 않는다"* 로 명시되어 있고, 회귀 방지용 `do $$` 블록이 anon 권한
부재를 단언한다. 신규 JP 프로젝트에서는 위 account_game_stats 파일에 **병합**하는 것이 옳다.

**`20260806013625_participants_leave_after_round.sql` — LEGACY — DO NOT DEPLOY**
기존 행이 있는 DB 에 컬럼을 덧붙이는 증분이다. 신규 프로젝트에는 base 테이블 정의에
이미 포함되어 있으므로 적용 대상이 아니다(Seoul 도 동일하게 처리했다).

### 권고 — JP 통합 마이그레이션 3종

```text
supabase/migrations/<ts>_jp_v1_core_rooms_participants.sql   ← Seoul 원본에서 JP 로 각색
supabase/migrations/<ts>_jp_v1_account_game_stats.sql        ← 테이블+RLS+GRANT+시퀀스 통합
supabase/migrations/<ts>_jp_v1_server_now_rpc.sql            ← 사실상 그대로
```

기존 Tokyo-dated 4종은 JP 브랜치에서 제거한다(Seoul 이 `c77389d` 로 한 것과 동일한 조치).
**단, 이는 CEO 검토 후 별도 승인 사항이며 이번 세션에서 수행하지 않았다.**

---

## 2. Tables / Indexes / Functions

| 항목 | 상세 | 판정 |
|---|---|---|
| `public.rooms` | `id text PK`, `status`, `penalty`, `round`, `created_at` | REQUIRES JP ADAPTATION |
| `public.participants` | `id text PK`, `room_id FK→rooms ON DELETE CASCADE`, `name`, `is_host`, `choice`, `wins/losses/draws/penalties`, `is_ready`, `leave_after_round`, `created_at` | REQUIRES JP ADAPTATION |
| `public.user_game_stats` | `user_id uuid PK → auth.users ON DELETE CASCADE`, 누적 카운터 | REQUIRES JP ADAPTATION |
| `public.user_game_history` | `id bigserial PK`, `user_id FK`, `room_id`, `round`, `result CHECK(win/lose/draw)`, `penalty_text` | REQUIRES JP ADAPTATION |
| 명시적 인덱스 | **없음** — PK/FK 자동 인덱스만 존재 | UNKNOWN — 성능 검증 필요 |
| `public.server_now()` | bigint epoch-ms, VOLATILE, SECURITY INVOKER, `search_path=pg_catalog` | REUSABLE AS-IS |
| DB trigger / scheduler | **없음** (전 마이그레이션이 명시적으로 없음을 선언) | 해당 없음 |

---

## 3. RLS policies

| 대상 | 정책 | 판정 |
|---|---|---|
| `rooms`, `participants` | `allow_all_*` — `FOR ALL USING(true) WITH CHECK(true)` | **REQUIRES JP ADAPTATION — 보안 부채 승계 여부 CEO 판단** |
| `user_game_stats` | 소유자 기준 SELECT/INSERT/UPDATE (`auth.uid() = user_id`) | REUSABLE AS-IS |
| `user_game_history` | 소유자 기준 SELECT/INSERT | REUSABLE AS-IS |

allow-all 정책은 필터 없는 REST DELETE/UPDATE 로 테이블 전체 파괴가 가능한 상태를
막지 못한다. Seoul/Tokyo 양쪽에 동일하게 존재하던 기존 노출이며, V1 KR 은 CEO 승인 하에
"임시 유지"로 결정됐다. **JP 에 같은 결정을 자동 적용할지는 별도 판단이 필요하다.**

---

## 4. Edge Functions

| 함수 | 필요 env (이름만) | 판정 |
|---|---|---|
| `delete-account` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **REUSABLE AS-IS** |
| `kakao-auth` | `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **LEGACY — DO NOT DEPLOY (JP)** |
| `line-auth` | `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **LEGACY — DO NOT DEPLOY (아직)** |

- `delete-account` 는 리전 중립이다(`auth.admin.deleteUser()` 만 호출).
- `kakao-auth` 는 KR 전용이다. 일본은 Kakao 를 쓰지 않는다(JP-BL-002).
- `line-auth` 는 **네이티브 앱용 OAuth** 구현이다. LINE MINI App(LIFF) 은 identity 검증
  경로가 달라 그대로 재사용할 수 없다. LINE 아키텍처가 승인될 때까지 참조 자료로만 둔다(§9 동결).

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 는 Supabase 가 함수 런타임에 자동 주입한다.
나머지는 프로젝트별 secret 으로 별도 설정해야 한다.

---

## 5. Auth / Provider 설정

| 항목 | 판정 | 비고 |
|---|---|---|
| Apple Sign In | REQUIRES JP ADAPTATION | KR 은 Client ID `com.maru.rps.web`. JP 식별자 분리 여부는 JP-BL-012 |
| Guest(비로그인) | REUSABLE AS-IS | Supabase Anonymous Auth 미사용 — 클라이언트 로컬 처리 |
| LINE | **동결** | §9 — MINI App 아키텍처 승인 전까지 비활성 |
| Kakao | **DO NOT DEPLOY (JP)** | KR 전용 |
| Google | UNKNOWN — NEEDS VERIFICATION | 구 Tokyo 에서 활성이었다는 기록만 있음. JP 에서 필요한지 미정 |

Provider 설정은 **마이그레이션으로 재현되지 않는다** — 대시보드/Management API 작업이다.
저장소가 단일 기준이 될 수 없는 유일한 영역이므로 별도 체크리스트가 필요하다.

---

## 6. Realtime

`rooms` / `participants` 를 `supabase_realtime` publication 에 등록해야 한다.
`20260811010000` 에 포함되어 있다 → **REQUIRES JP ADAPTATION** (해당 파일과 함께 이식).
클라이언트의 방/참가자 동기화가 전적으로 여기에 의존한다.

---

## 7. 환경변수 이름 (값 아님)

| 구분 | 이름 |
|---|---|
| Edge Function secret | `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET` |
| 런타임 자동 주입 | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| GitHub Actions secret | `SUPABASE_ACCESS_TOKEN`(`sbp_` 접두), `SUPABASE_DB_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| 클라이언트 공개 상수 | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LINE_CHANNEL_ID` |

⚠️ **`SUPABASE_DB_PASSWORD` 는 현재 리전별로 분리되어 있지 않다.** 단일 secret 이
`region` 입력과 무관하게 쓰인다 — KR 과 JP 의 DB 비밀번호가 다르면 한쪽 배포가 실패한다.
리전별 secret 분리 또는 environment secret 사용이 필요하다. **UNKNOWN — NEEDS VERIFICATION**

---

## 8. CI/CD 대상 설정

| 항목 | 상태 |
|---|---|
| `supabase-deploy.yml` | 리전 입력 + 레지스트리 도출 + 타이핑 확인 + 브랜치 일치 검사 — **준비 완료** |
| GitHub Environment `supabase-JP` | required reviewer + 브랜치 정책 `feature/rps-jp-*` — **구성 완료** |
| GitHub Environment `supabase-KR` | required reviewer + 브랜치 정책 `feature/rps-kr-*`, `fix/replay-force-start-and-confirmed-ids` — **구성 완료** |
| `config/regions.json` 의 JP ref | 구 프로젝트 ref 를 담고 있음 — **새 ref 로 교체 필요** |

---

## 9. UNKNOWN — 검증 필요 목록

1. 일시정지된 Tokyo 프로젝트를 **복원할 수 있는가**, 복원 시 데이터가 남아 있는가
2. free plan 에서 새 프로젝트 생성이 **과금/플랜 변경을 유발하는가** (org 는 현재 free, 활성 1 / 일시정지 1)
3. Google provider 가 JP 에 필요한가
4. `SUPABASE_DB_PASSWORD` 의 리전별 분리 필요 여부
5. 인덱스 부재가 실사용 규모에서 문제가 되는가
6. allow-all RLS 를 JP 가 승계할 것인가
