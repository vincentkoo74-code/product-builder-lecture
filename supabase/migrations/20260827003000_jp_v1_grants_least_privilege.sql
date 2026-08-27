-- ─────────────────────────────────────────────────────────────────────────
-- JP V1.0_JP — GRANT 최소 권한 정규화
--
-- 배경(라이브 Tokyo 실측, 2026-08-27): 4개 테이블 **전부**에 대해 anon / authenticated /
-- service_role 이 다음을 갖고 있었다.
--     DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
-- 대시보드 생성 시 붙는 기본 권한이 그대로 남은 것으로 보인다.
--
-- ⚠️ TRUNCATE 는 RLS 를 우회한다. PostgREST 가 TRUNCATE 를 노출하지 않아 현재 실질 공격
--    경로는 없지만, 권한 자체를 남겨둘 이유가 없다.
--
-- CEO 결정(JP-BL-018): least privilege + authenticated-first + 연산 단위 명시 권한.
--   - TRUNCATE / MAINTAIN / REFERENCES / TRIGGER 는 클라이언트 롤에서 제거
--   - anon 접근은 **실제 게임플레이 요구가 입증된 경우에만** 유지
--   - service_role 은 서버 사이드 전용 — 이 파일에서 축소하지 않는다
--
-- anon 유지 근거(입증됨):
--   게스트 플레이는 Supabase 세션 없이 동작한다. index.html 의 playAsGuest() 는
--   setAuthState("guest") 로 클라이언트 상태만 바꾸고, signInAnonymously 는 저장소 전체에
--   0건이며, Auth 설정도 external_anonymous_users_enabled=false 다(라이브 확인).
--   즉 게스트의 모든 rooms/participants 접근은 **anon 롤로 수행된다.**
--   anon 을 제거하면 QR 로 모여 로그인 없이 노는 제품의 핵심 동선이 즉시 깨진다.
--   → V2 에서 Supabase Anonymous Auth 를 도입하면 anon 을 authenticated 로 접을 수 있다(JP-BL-005).
--
-- rooms 의 DELETE 를 제거하는 근거:
--   클라이언트 전수 조사 결과 rooms 에 대한 .delete() 호출이 **0건**이다(2가지 방법으로 확인).
--   방 종료는 rooms.status 갱신 + participants 삭제로 처리한다.
--   participants 의 FK 는 ON DELETE CASCADE 지만, 클라이언트가 rooms 를 지우지 않으므로
--   이 경로는 사용되지 않는다. 서버 사이드 정리는 service_role 로 수행하면 된다.
--
-- 계정 전적 2테이블에서 anon 을 완전히 제거하는 근거:
--   두 테이블은 auth.uid() 소유자 정책으로만 접근한다. anon 은 uid 가 없어 어떤 행에도
--   도달할 수 없다 — 권한만 있고 쓰이지 않는 상태였다.
--
-- 파괴성: 권한 변경만. 테이블/컬럼/데이터/정책 무변경.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- 선행 확인: 잘못된 프로젝트에 붙었을 때 즉시 알아채기 위함이다.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon')
  or not exists (select 1 from pg_roles where rolname='authenticated')
  or not exists (select 1 from pg_roles where rolname='service_role') then
    raise exception 'JP grants: Supabase 롤이 없다 — 접속 대상을 확인하라';
  end if;
  if to_regclass('public.rooms') is null
  or to_regclass('public.participants') is null
  or to_regclass('public.user_game_stats') is null
  or to_regclass('public.user_game_history') is null then
    raise exception 'JP grants: 대상 테이블이 없다 — baseline 마이그레이션이 먼저 적용되어야 한다';
  end if;
end $$;

-- ── 1) 클라이언트 롤의 기존 권한을 전부 회수한 뒤 필요한 것만 다시 부여한다.
--       (증분 revoke 는 누락이 생기기 쉬워 "전부 회수 후 재부여" 로 간다.)
revoke all on public.rooms             from anon, authenticated;
revoke all on public.participants      from anon, authenticated;
revoke all on public.user_game_stats   from anon, authenticated;
revoke all on public.user_game_history from anon, authenticated;
revoke all on sequence public.user_game_history_id_seq from anon, authenticated;

-- ── 2) 게임플레이에 실제로 필요한 권한만 부여
--    rooms: 생성(createRoom) / 조회 / 상태 갱신. DELETE 는 호출 0건이므로 부여하지 않는다.
grant select, insert, update on public.rooms to anon, authenticated;

--    participants: 입장(insert) / 조회 / 상태·전적 갱신 / 퇴장·정리(delete)
grant select, insert, update, delete on public.participants to anon, authenticated;

--    계정 전적: 로그인 사용자 전용. anon 에는 아무 권한도 주지 않는다.
grant select, insert, update on public.user_game_stats   to authenticated;
grant select, insert         on public.user_game_history to authenticated;
--    id 가 bigserial 이라 테이블 INSERT 권한만으로는 nextval() 에서 42501 이 난다.
grant usage on sequence public.user_game_history_id_seq  to authenticated;

-- ── 3) service_role 은 서버 사이드 전용이라 축소하지 않되, 클라이언트에 노출되는
--       파괴적 권한(TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)이 anon/authenticated 에
--       남아 있지 않은지는 아래 자기검증에서 확인한다.

-- ── 4) 자기검증 — 하나라도 어긋나면 롤백시켜 "조용히 적용된 척" 하는 상태를 만들지 않는다.
do $$
declare
  t text; r text; p text;
  seq text := pg_get_serial_sequence('public.user_game_history', 'id');
begin
  -- 시퀀스 이름을 문자열로 가정하지 않고 실제 연결을 되짚어 확인한다.
  if seq is null then
    raise exception 'JP grants: user_game_history.id 에 연결된 시퀀스를 찾을 수 없다';
  end if;
  if seq <> 'public.user_game_history_id_seq' then
    raise exception 'JP grants: 시퀀스 이름이 예상과 다르다 (실제=%) — grant 대상을 재확인하라', seq;
  end if;

  -- 4-1) 클라이언트 롤에 파괴적 권한이 남아 있으면 안 된다.
  foreach t in array array['public.rooms','public.participants',
                           'public.user_game_stats','public.user_game_history'] loop
    foreach r in array array['anon','authenticated'] loop
      foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
        if has_table_privilege(r, t, p) then
          raise exception 'JP grants: % 이 % 에 대해 % 권한을 여전히 갖는다', r, t, p;
        end if;
      end loop;
    end loop;
  end loop;

  -- 4-2) rooms 는 클라이언트가 삭제하지 않는다.
  if has_table_privilege('anon','public.rooms','delete')
  or has_table_privilege('authenticated','public.rooms','delete') then
    raise exception 'JP grants: rooms DELETE 가 클라이언트 롤에 남아 있다';
  end if;

  -- 4-3) anon 은 계정 전적 테이블에 도달할 수 없어야 한다.
  if has_table_privilege('anon','public.user_game_stats','select')
  or has_table_privilege('anon','public.user_game_history','select')
  or has_table_privilege('anon','public.user_game_stats','insert')
  or has_table_privilege('anon','public.user_game_history','insert') then
    raise exception 'JP grants: anon 이 계정 전적 테이블 권한을 갖는다';
  end if;

  -- 4-4) 게임플레이에 필요한 권한은 반드시 있어야 한다(과잉 회수 방지).
  foreach r in array array['anon','authenticated'] loop
    if not (has_table_privilege(r,'public.rooms','select')
        and has_table_privilege(r,'public.rooms','insert')
        and has_table_privilege(r,'public.rooms','update')) then
      raise exception 'JP grants: % 의 rooms 게임플레이 권한이 부족하다', r;
    end if;
    if not (has_table_privilege(r,'public.participants','select')
        and has_table_privilege(r,'public.participants','insert')
        and has_table_privilege(r,'public.participants','update')
        and has_table_privilege(r,'public.participants','delete')) then
      raise exception 'JP grants: % 의 participants 게임플레이 권한이 부족하다', r;
    end if;
  end loop;

  -- 4-5) 로그인 사용자의 전적 저장 경로(Seoul 이 3개월간 겪은 42501 회귀 방지)
  if not (has_table_privilege('authenticated','public.user_game_stats','select')
      and has_table_privilege('authenticated','public.user_game_stats','insert')
      and has_table_privilege('authenticated','public.user_game_stats','update')
      and has_table_privilege('authenticated','public.user_game_history','select')
      and has_table_privilege('authenticated','public.user_game_history','insert')) then
    raise exception 'JP grants: authenticated 의 계정 전적 권한이 부족하다';
  end if;
  if not has_sequence_privilege('authenticated', seq, 'usage') then
    raise exception 'JP grants: user_game_history_id_seq USAGE 부여 실패 — insert 시 42501 이 난다';
  end if;
end $$;

commit;

-- 권한 변경은 PostgREST 스키마 캐시에 반영돼야 즉시 적용된다.
notify pgrst, 'reload schema';
