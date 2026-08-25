-- ─────────────────────────────────────────────────────────────────────────
-- WRPS-084 / Build37 A6 — user_game_stats · user_game_history 권한(GRANT) 부여
--
-- 배경: 20260528205753_account_game_stats.sql 은 두 테이블을 만들고 RLS 정책을
-- 5개 붙였지만 GRANT를 한 줄도 주지 않았다. RLS와 GRANT는 서로 다른 두 관문이다.
--
--   GRANT  = 그 역할이 이 테이블에 접근할 수 있는가        → 없으면 42501
--   POLICY = 접근 가능한 역할이 어떤 row를 볼 수 있는가     → 막히면 빈 결과
--
-- 정책만 있고 권한이 없으므로 PostgREST가 RLS 평가에 도달하기도 전에 거부한다.
-- 배포 DB 실측(2026-08-23, anon key):
--
--   GET /rest/v1/user_game_stats    → HTTP 401  {"code":"42501",
--        "message":"permission denied for table user_game_stats"}
--   GET /rest/v1/user_game_history  → HTTP 401  {"code":"42501", ...}
--   GET /rest/v1/participants       → HTTP 200  (대조군: 정상)
--   GET /rest/v1/rooms              → HTTP 200  (대조군: 정상)
--
-- participants/rooms 는 권한이 붙어 있다. 두 계정 전적 테이블만 raw SQL
-- 마이그레이션으로 생성되어 기본 권한 부여 경로를 타지 못한 것이 원인이다.
-- 증상은 "로그인해도 내 기록이 언제나 비어 있고, 저장도 되지 않는다".
--
-- 왜 기존 마이그레이션을 고치지 않는가:
--   20260528205753 은 이미 적용된 파일이다. 적용 완료 마이그레이션 편집은
--   히스토리 불일치를 만든다. 권한 부여만 담은 신규 파일로 분리한다.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 부여 범위 근거 (최소 권한)
--
-- user_game_stats — index.html recordMyAccountGameResult() / showAccountStatsPopup()
--   SELECT : 누적치 조회 (.select("games_played,wins,...").eq("user_id", …))
--   INSERT : 첫 저장   ┐ .upsert(nextStats, { onConflict: "user_id" }) 는
--   UPDATE : 갱신      ┘ INSERT … ON CONFLICT DO UPDATE 이므로 둘 다 필요하다.
--
-- user_game_history
--   SELECT : 최근 80건 조회
--   INSERT : 라운드 결과 1행 추가
--
-- user_game_history_id_seq
--   USAGE  : id 가 bigserial 이다. 테이블 INSERT 권한만 주면 nextval() 에서
--            다시 42501 이 난다. 시퀀스 권한은 테이블 권한과 별개다.
--
-- 부여하지 않는 것:
--   DELETE          — 클라이언트는 삭제하지 않는다. 계정 삭제는 auth.users 의
--                     on delete cascade 로 처리되며 FK 제약은 테이블 소유자
--                     권한으로 실행되므로 authenticated 의 DELETE 가 불필요하다.
--   anon 전 권한    — 로그인 사용자 전용 데이터다. 비로그인 노출 경로를 만들지 않는다.
--   service_role    — delete-account 엣지 함수는 auth.admin.deleteUser() 만
--                     호출하고 이 두 테이블을 직접 읽거나 쓰지 않는다.
--
-- 이 마이그레이션의 제약:
--   - 테이블 생성/삭제/변경 없음, 컬럼 변경 없음, 인덱스 없음
--   - RLS 정책 추가·변경·삭제 없음 (기존 owner 정책 5개 그대로 유지)
--   - trigger/scheduler/RPC 없음
--   - 대상은 Seoul 프로젝트(sannrfmhevebqgfdqcps) 뿐이다.
--     Tokyo(cmfxhehpreanijwanwrr) 에는 적용하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- 선행 확인: Supabase 역할이 존재하는 DB인지 먼저 본다. 없으면 grant가 난해한
-- "role does not exist" 로 죽는다. 잘못된 프로젝트/DB에 붙었을 때 즉시 알아채기 위함이다.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'A6: authenticated 역할이 없다 — Supabase 프로젝트가 아니거나 접속 대상이 잘못됐다';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'A6: anon 역할이 없다 — 접속 대상을 확인하라';
  end if;
  if to_regclass('public.user_game_stats') is null
  or to_regclass('public.user_game_history') is null then
    raise exception 'A6: 대상 테이블이 없다 — 20260528205753 이 먼저 적용되어야 한다';
  end if;
end $$;

grant select, insert, update on table public.user_game_stats   to authenticated;
grant select, insert         on table public.user_game_history to authenticated;
grant usage on sequence public.user_game_history_id_seq        to authenticated;

-- 자기검증: 권한이 실제로 붙었는지 같은 트랜잭션에서 확인한다. 시퀀스 이름을
-- 문자열로 가정하지 않고 pg_get_serial_sequence 로 실제 이름을 되짚어 비교한다.
-- 하나라도 어긋나면 예외로 롤백시켜 "조용히 적용된 척"하는 상태를 만들지 않는다.
do $$
declare
  seq text := pg_get_serial_sequence('public.user_game_history', 'id');
begin
  if seq is null then
    raise exception 'A6: user_game_history.id 에 연결된 시퀀스를 찾을 수 없다';
  end if;
  if seq <> 'public.user_game_history_id_seq' then
    raise exception 'A6: 시퀀스 이름이 예상과 다르다 (실제=%). grant 대상을 재확인하라', seq;
  end if;

  if not has_table_privilege('authenticated', 'public.user_game_stats', 'select')
  or not has_table_privilege('authenticated', 'public.user_game_stats', 'insert')
  or not has_table_privilege('authenticated', 'public.user_game_stats', 'update') then
    raise exception 'A6: user_game_stats 권한 부여 실패';
  end if;

  if not has_table_privilege('authenticated', 'public.user_game_history', 'select')
  or not has_table_privilege('authenticated', 'public.user_game_history', 'insert') then
    raise exception 'A6: user_game_history 권한 부여 실패';
  end if;

  if not has_sequence_privilege('authenticated', seq, 'usage') then
    raise exception 'A6: user_game_history_id_seq USAGE 부여 실패';
  end if;

  -- anon 에 권한이 새어 나가지 않았는지도 같이 확인한다(회귀 방지).
  if has_table_privilege('anon', 'public.user_game_stats', 'select')
  or has_table_privilege('anon', 'public.user_game_history', 'select') then
    raise exception 'A6: anon 에 권한이 부여됐다 — 이 마이그레이션의 범위가 아니다';
  end if;
end $$;

commit;

-- PostgREST 스키마 캐시 갱신(권한 변경은 캐시에 반영돼야 즉시 적용된다).
notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────
-- 적용 후 검증 (Seoul 프로젝트에서만):
--   ① anon 은 여전히 거부되어야 한다
--      GET /rest/v1/user_game_stats  (apikey=anon)  → 401 code 42501 유지
--   ② 로그인 계정(authenticated JWT)으로는 200 + [] 또는 본인 row
--      → 42501 이 사라지고 RLS 평가 단계까지 도달하면 성공이다
--   ③ 실기기: 로그인 → 1라운드 완주 → "내 기록" 팝업에 전적이 남는지 확인
--
-- Rollback(참고용 — 이 파일 자체에서는 실행하지 않음):
--   revoke select, insert, update on table public.user_game_stats   from authenticated;
--   revoke select, insert         on table public.user_game_history from authenticated;
--   revoke usage on sequence public.user_game_history_id_seq        from authenticated;
--   notify pgrst, 'reload schema';
-- ─────────────────────────────────────────────────────────────────────────
